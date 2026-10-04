import { createHash } from "node:crypto";
import { Prisma, PrismaClient, type Campaign, type Creator, type MatchRun, type MetricsSnapshot } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { CampaignRequirementsSchema, parseBriefContent, type CampaignRequirementsDTO } from "@/lib/campaigns/contracts";
import { MoneySchema } from "@/lib/contracts/money";
import { ArabicDialectSchema, AudienceAgeBucketSchema, AudienceGenderSchema, AvailabilitySchema, ContentLanguageSchema, CountryCodeSchema, DateRangeSchema, DealFormatSchema, FameIndustrySchema, UtcDateTimeSchema, VisibilitySchema } from "@/lib/contracts/vocabulary";
import { NICHE_BY_SLUG, NICHE_SOURCE } from "@/lib/contracts/taxonomy";
import { FRESHNESS_MS, STRATEGY_ID } from "./benchmarks";
import { prepareEligibility, shortlist } from "./strategy";
import type { AudienceInput, Bucket, CampaignInput, CreatorInput, Evidence, Fact, MatchingAccount, MatchResult, PolicyOutcome, SafetyExclusion, ViewObservation } from "./types";

export class MatchingError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); this.name = "MatchingError"; }
}
type Transaction = Prisma.TransactionClient;
// Trusted server adapter: reads reviewed records in this transaction only. Never
// request/model input; no provider/model calls or writes, including on GET.
export type MatchingPolicyReader = (tx: Transaction, requirements: CampaignRequirementsDTO, creatorIds: readonly string[]) => Promise<{ version:string; outcomes:Record<string,PolicyOutcome[]>; safetyExclusions:Record<string,SafetyExclusion[]> }>;
export type MatchingPersistenceOptions = { client?:PrismaClient; now?:Date; policyReader?:MatchingPolicyReader };
const KeySchema=z.string().min(1).max(120).regex(/^[A-Za-z0-9_:-]+$/);
const IdSchema=z.string().min(1).max(200).regex(/^[\x21-\x7e]+$/);
const RunCommandSchema=z.object({operationKey:KeySchema,expectedBriefVersion:z.number().int().positive(),expectedCampaignRevision:z.number().int().positive()}).strict();
const DecisionCommandSchema=z.object({operationKey:KeySchema,expectedBriefVersion:z.number().int().positive(),runId:IdSchema,creatorId:IdSchema,expectedDecisionRevision:z.number().int().nonnegative(),decision:z.enum(["NONE","SAVED","DISMISSED"])}).strict();
export type MatchingRunCommand=z.infer<typeof RunCommandSchema>;
export type MatchingDecisionCommand=z.infer<typeof DecisionCommandSchema>;
export type MatchingDecisionDTO={creatorId:string;decision:string;revision:number;runId:string|null;updatedAt:string};
export type MatchingCreatorIdentity={displayName:string;handle:string};
export type MatchingRunDTO={runId:string;briefVersion:number;strategyId:string;createdAt:string;replayed:boolean;stale:boolean;readiness:string;allocationBasis:"FIRST_SLOT_COMPARISON";desiredCreatorCount:number;results:(MatchResult & {stale:boolean;creator:MatchingCreatorIdentity;provenance:Evidence[];decision:MatchingDecisionDTO|null})[]};
const visible=(brand:boolean,publicField:boolean):Evidence["visibility"]=>publicField?"PUBLIC":brand?"BRAND_ONLY":"PRIVATE";
const record=(value:unknown):Record<string,unknown>=>value && typeof value==="object" && !Array.isArray(value)?value as Record<string,unknown>:{};
function fieldPermission(value:unknown,key:string,original:Evidence["visibility"]):Evidence["visibility"] {
  const permissions=record(value);if(!Object.hasOwn(permissions,key))return original;
  const current=VisibilitySchema.safeParse(permissions[key]);
  if(!current.success || current.data==="PRIVATE" || original==="PRIVATE")return "PRIVATE";
  return current.data==="BRAND_ONLY" || original==="BRAND_ONLY"?"BRAND_ONLY":"PUBLIC";
}
function hash(value:unknown):string {
  const canonical=(item:unknown):unknown=>Array.isArray(item)?item.map(canonical):item && typeof item==="object"?Object.fromEntries(Object.keys(item).sort().map(key=>[key,canonical((item as Record<string,unknown>)[key])])):item;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
const json=(value:unknown):Prisma.InputJsonValue=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function parse<T>(schema:z.ZodType<T>,value:unknown):T {const result=schema.safeParse(value);if(!result.success)throw new MatchingError("VALIDATION",400);return result.data;}
const instant=(value:unknown):string|null=>UtcDateTimeSchema.safeParse(value).success?value as string:null;
const past=(date:Date|null,now:Date):boolean=>date!==null && date<=now;
function fresh(value:unknown,now:Date):string|null {const date=instant(value);return date && Date.parse(date)<=now.getTime() && now.getTime()-Date.parse(date)<=FRESHNESS_MS?date:null;}
function clock(options:MatchingPersistenceOptions):Date {const now=options.now??new Date();if(!Number.isFinite(now.getTime()))throw new MatchingError("VALIDATION",400);return now;}
function campaignInput(r:CampaignRequirementsDTO):CampaignInput {
  return {id:r.campaignId,briefVersion:r.version,approved:true,budget:r.budget,desiredCreatorCount:r.desiredCreatorCount,allocationOrdinal:0,impressionsTarget:r.impressionsTarget,period:r.period,deliverables:r.deliverables,targetAgeBuckets:r.targetAgeBuckets,targetGenders:r.targetGenders,targetCountryCodes:r.targetCountryCodes,targetCityKeys:r.targetCityKeys,contentLanguages:r.contentLanguages,dialects:r.dialects,nicheSlugs:r.nicheSlugs,marketCountryCodes:r.marketCountryCodes,physicalPresenceRequired:r.physicalPresenceRequired,presenceCountryCodes:r.presenceCountryCodes,travelAllowed:r.travelAllowed,preferredTiers:r.preferredTiers,dataVerificationRequired:r.dataVerificationRequired,preferredLicencePolicyIds:r.preferredLicencePolicyIds,mandatoryPolicyVersionIds:r.mandatoryPolicyVersionIds,noGoTopics:r.noGoTopics};
}
async function owned(tx:Transaction,actorUserId:string,campaignId:string,write:boolean):Promise<Campaign> {
  parse(IdSchema,actorUserId);parse(IdSchema,campaignId);
  if(write)await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actorUserId} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actorUserId} FOR SHARE`;
  const user=await tx.user.findUnique({where:{id:actorUserId},select:{active:true,role:true,emailVerifiedAt:true}});
  if(!user?.active || user.role!=="BRAND" || !user.emailVerifiedAt)throw new MatchingError("FORBIDDEN",403);
  const brand=await tx.brand.findUnique({where:{userId:actorUserId},select:{id:true}});
  if(!brand)throw new MatchingError("NOT_FOUND",404);
  await tx.$queryRaw`SELECT id FROM "Brand" WHERE id=${brand.id} FOR SHARE`;
  if(!await tx.campaign.findFirst({where:{id:campaignId,brandId:brand.id},select:{id:true}}))throw new MatchingError("NOT_FOUND",404);
  if(write)await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id=${campaignId} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id=${campaignId} FOR SHARE`;
  return tx.campaign.findUniqueOrThrow({where:{id:campaignId}});
}
async function approved(tx:Transaction,campaign:Campaign,actorUserId:string,command:MatchingRunCommand,now:Date) {
  if(campaign.revision!==command.expectedCampaignRevision || campaign.currentBriefVersion!==command.expectedBriefVersion)throw new MatchingError("STALE_VERSION");
  if(!["BRIEF_APPROVED","SHORTLISTED","IN_DEALS"].includes(campaign.status))throw new MatchingError("INVALID_STATE");
  const brief=await tx.campaignBrief.findUnique({where:{campaignId_version:{campaignId:campaign.id,version:command.expectedBriefVersion}}});
  if(!brief || !past(brief.approvedAt,now) || brief.approvedByUserId!==actorUserId || brief.inputRevision!==record(campaign.input).fieldsRevision)throw new MatchingError("BRIEF_NOT_APPROVED");
  let content;try{content=parseBriefContent(brief.content);}catch{throw new MatchingError("INVALID_APPROVED_BRIEF");}
  if(content.requirements.campaignId!==campaign.id || content.requirements.version!==brief.version || content.inputRevision!==brief.inputRevision || content.approvedByUserId!==actorUserId)throw new MatchingError("INVALID_APPROVED_BRIEF");
  const review=content.policyReview;
  if(!review || Date.parse(review.reviewedAt)>now.getTime() || hash([...review.marketCountryCodes].sort())!==hash([...content.requirements.marketCountryCodes].sort()) || hash([...review.mandatoryPolicyVersionIds].sort())!==hash([...content.requirements.mandatoryPolicyVersionIds].sort()))throw new MatchingError("POLICY_REVIEW_REQUIRED");
  return content;
}
function profileFact<T>(profile:Record<string,unknown>,key:string,schema:z.ZodType<T>,creatorId:string,now:Date):Fact<T>|null {
  const row=record(profile[key]),date=fresh(row.evidenceAt,now),approval=instant(row.approvedAt),value=schema.safeParse(row.value);
  // A creator JSON assertion can never promote typed declarations into API data.
  if(!date || !approval || Date.parse(approval)>now.getTime() || Date.parse(approval)<Date.parse(date) || row.source!=="SELF_REPORTED" || !value.success)return null;
  const visibility=visible(row.brandVisible===true,row.publicVisible===true);if(visibility==="PRIVATE")return null;
  return {value:value.data,evidence:{source:"SELF_REPORTED",evidenceAt:date,reviewStatus:"APPROVED",visibility,version:`profile:${creatorId}:${key}:${hash(row)}`}};
}
const SlugsSchema=z.array(z.string().refine(slug=>Object.hasOwn(NICHE_BY_SLUG,slug))).max(20).refine(rows=>new Set(rows).size===rows.length);
const BucketSchema=z.object({key:z.string().min(1).max(200),percent:z.number().finite().min(0).max(100)}).strict();
const DimensionSchema=z.object({value:z.array(BucketSchema).max(300),visibility:VisibilitySchema,roundingToleranceDocumented:z.boolean().optional()}).strict();
function dimension(value:unknown,evidence:Evidence,permission?:Evidence["visibility"]):Fact<Bucket[]>|null {
  const parsed=DimensionSchema.safeParse(value);if(!parsed.success || parsed.data.visibility==="PRIVATE" || !parsed.data.value.length)return null;
  const visibility=permission??parsed.data.visibility;if(visibility==="PRIVATE")return null;
  return {value:parsed.data.value,evidence:{...evidence,visibility},...(parsed.data.roundingToleranceDocumented?{roundingToleranceDocumented:true}:{})};
}
const ContextSchema=z.object({unit:z.literal("PERCENT"),window:DateRangeSchema,definition:z.string().trim().min(1).max(500),visibility:VisibilitySchema}).strict();
const ViewSchema=z.object({format:DealFormatSchema,value:z.number().finite().nonnegative(),unit:z.enum(["VIEWS","IMPRESSIONS"]),window:DateRangeSchema,definition:z.string().trim().min(1).max(500),visibility:VisibilitySchema}).strict();
function views(value:unknown,evidence:Evidence,permissions:unknown={}):ViewObservation[] {
  const rows=z.array(ViewSchema).max(20).safeParse(value);if(!rows.success)return [];
  return rows.data.filter(row=>fieldPermission(permissions,`formatMetrics.${row.format}`,row.visibility)!=="PRIVATE" && Date.parse(row.window.endsAt)<=Date.parse(evidence.evidenceAt)).map(row=>({format:row.format,value:{value:row.value,evidence:{...evidence,visibility:fieldPermission(permissions,`formatMetrics.${row.format}`,row.visibility)}},unit:row.unit,window:row.window,definition:row.definition}));
}

function snapshotAccount(account:Prisma.SocialAccountGetPayload<{include:{corrections:true}}>,snapshot:MetricsSnapshot,creator:Creator,now:Date):MatchingAccount {
  const evidence:Evidence={source:snapshot.source,evidenceAt:snapshot.observedAt.toISOString(),reviewStatus:"APPROVED",visibility:visible(account.brandVisible,account.publicVisible),version:`snapshot:${snapshot.id}:mapping:${snapshot.mappingRevision}`};
  const demographic=record(snapshot.demographics),context=ContextSchema.safeParse(snapshot.engagementContext);
  const followerVisibility=fieldPermission(account.fieldVisibility,"followers",evidence.visibility);
  const followers=followerVisibility!=="PRIVATE" && snapshot.followers!==null && snapshot.followers>=BigInt(0) && snapshot.followers<=BigInt(Number.MAX_SAFE_INTEGER)?{value:Number(snapshot.followers),evidence:{...evidence,visibility:followerVisibility}}:null;
  const permitted=(key:string)=>fieldPermission(account.fieldVisibility,`demographics.${key}`,VisibilitySchema.safeParse(record(demographic[key]).visibility).success?record(demographic[key]).visibility as Evidence["visibility"]:"PRIVATE");
  const audience:AudienceInput={age:dimension(demographic.age,evidence,permitted("age")) as AudienceInput["age"],gender:dimension(demographic.gender,evidence,permitted("gender")) as AudienceInput["gender"],countries:dimension(demographic.countries,evidence,permitted("countries")),cities:dimension(demographic.cities,evidence,permitted("cities"))};
  const engagementVisibility=context.success?fieldPermission(account.fieldVisibility,"engagementRate",context.data.visibility):"PRIVATE";
  const engagement=context.success && engagementVisibility!=="PRIVATE" && Date.parse(context.data.window.endsAt)<=snapshot.observedAt.getTime() && snapshot.engagementRate!==null?{value:Number(snapshot.engagementRate),evidence:{...evidence,visibility:engagementVisibility}}:null;
  const result:MatchingAccount={id:account.id,platform:account.platform,ownershipStatus:account.ownershipStatus,approved:true,visibility:evidence.visibility,evidence,supportedFormats:account.supportedFormats,followers,engagementPct:engagement,engagementContext:engagement && context.success?{unit:"PERCENT",window:context.data.window,definition:context.data.definition}:null,averageViews:views(snapshot.formatMetrics,evidence,account.fieldVisibility),audience};
  const applied=new Set<string>();
  for(const correction of [...account.corrections].sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime() || (a.id<b.id?-1:1))) {
    if(applied.has(correction.field) || correction.reportedBy!==creator.userId || !past(correction.approvedAt,now) || correction.createdAt>now || correction.approvedAt!<correction.createdAt || (!correction.brandVisible && !correction.publicVisible))continue;
    const row=record(correction.value),date=fresh(row.evidenceAt,now);
    if(!date || row.mappingRevision!==account.mappingRevision || correction.approvedAt!.getTime()<Date.parse(date))continue;
    const permission=fieldPermission(account.fieldVisibility,correction.field,visible(correction.brandVisible,correction.publicVisible));if(permission==="PRIVATE")continue;
    const corrected:Evidence={source:"SELF_REPORTED",evidenceAt:date,reviewStatus:"APPROVED",visibility:permission,version:`correction:${correction.id}:mapping:${account.mappingRevision}`};
    if(correction.field==="followers" && Number.isSafeInteger(row.value) && (row.value as number)>=0)result.followers={value:row.value as number,evidence:corrected};
    else if(correction.field==="engagementRate") {
      const parsed=ContextSchema.safeParse({...record(row.context),visibility:corrected.visibility});
      if(!parsed.success || typeof row.value!=="number" || !Number.isFinite(row.value) || row.value<0 || Date.parse(parsed.data.window.endsAt)>Date.parse(date))continue;
      result.engagementPct={value:row.value,evidence:corrected};result.engagementContext={unit:"PERCENT",window:parsed.data.window,definition:parsed.data.definition};
    } else if(correction.field.startsWith("demographics.")) {
      const key=correction.field.slice("demographics.".length) as keyof AudienceInput;
      if(!["age","gender","countries","cities"].includes(key))continue;
      const fact=dimension({value:row.value,visibility:corrected.visibility,...(row.roundingToleranceDocumented===true?{roundingToleranceDocumented:true}:{})},corrected);
      if(!fact)continue;result.audience[key]=fact as Fact<Bucket<never>[]>;
    } else if(correction.field.startsWith("formatMetrics.")) {
      const format=correction.field.slice("formatMetrics.".length),correctedViews=views([{...record(row.context),format,value:row.value,visibility:corrected.visibility}],corrected,account.fieldVisibility);
      if(!correctedViews.length)continue;result.averageViews=[...result.averageViews.filter(view=>view.format!==format),...correctedViews];
    } else continue;
    applied.add(correction.field);
  }
  return result;
}
const MAX_CANDIDATES=500;
async function candidates(tx:Transaction,requirements:CampaignRequirementsDTO,now:Date,options:MatchingPersistenceOptions,creatorId?:string):Promise<{inputs:CreatorInput[];identities:Record<string,MatchingCreatorIdentity>;readiness:string;policyVersion:string|null}> {
  const candidateRows=await tx.creator.findMany({where:{...(creatorId?{id:creatorId}:{}),state:"PUBLISHED",isTest:false,brandVisible:true,OR:[{userId:null},{user:{active:true,role:"CREATOR",emailVerifiedAt:{not:null},isTest:false}}]},select:{id:true,userId:true,accounts:{select:{ownershipReviewedBy:true}},licences:{select:{reviewedBy:true}}},orderBy:{id:"asc"},take:MAX_CANDIDATES+1});
  if(candidateRows.length>MAX_CANDIDATES)throw new MatchingError("CANDIDATE_LIMIT_EXCEEDED",503);
  if(!candidateRows.length){const policy=options.policyReader?await options.policyReader(tx,requirements,[]):null;return {inputs:[],identities:{},readiness:requirements.mandatoryPolicyVersionIds.length && !policy?"POLICY_OUTCOMES_UNAVAILABLE":"READY",policyVersion:policy?.version??null};}
  // Owner User -> reviewer User -> Creator -> Account -> facts. Groups are each
  // sorted; the ownership ordering must also match manual review commands.
  const ownerIds=[...new Set(candidateRows.flatMap(row=>row.userId?[row.userId]:[]))].sort();
  const reviewerIds=[...new Set(candidateRows.flatMap(row=>[...row.accounts.flatMap(account=>account.ownershipReviewedBy?[account.ownershipReviewedBy]:[]),...row.licences.flatMap(licence=>licence.reviewedBy?[licence.reviewedBy]:[])]))].filter(id=>!ownerIds.includes(id)).sort(),ids=candidateRows.map(row=>row.id);
  if(ownerIds.length)await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(ownerIds)}) ORDER BY id FOR SHARE`);
  if(reviewerIds.length)await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(reviewerIds)}) ORDER BY id FOR SHARE`);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "Creator" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "SocialAccount" WHERE "creatorId" IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`);
  await tx.$queryRaw(Prisma.sql`SELECT s.id FROM "MetricsSnapshot" s JOIN "SocialAccount" a ON a.id=s."accountId" WHERE a."creatorId" IN (${Prisma.join(ids)}) ORDER BY s.id FOR SHARE OF s`);
  await tx.$queryRaw(Prisma.sql`SELECT f.id FROM "FactCorrection" f JOIN "SocialAccount" a ON a.id=f."accountId" WHERE a."creatorId" IN (${Prisma.join(ids)}) ORDER BY f.id FOR SHARE OF f`);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "CreatorRate" WHERE "creatorId" IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "AdvertisingLicence" WHERE "creatorId" IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`);
  const rows=await tx.creator.findMany({where:{id:{in:ids},state:"PUBLISHED",isTest:false,brandVisible:true},include:{user:{select:{active:true,role:true,emailVerifiedAt:true,isTest:true}},accounts:{include:{corrections:true}},rates:true,licences:true},orderBy:{id:"asc"}});
  const reviewers=new Set((await tx.user.findMany({where:{id:{in:reviewerIds},active:true,role:"ADMIN"},select:{id:true}})).map(user=>user.id));
  const assetIds=[...new Set(rows.flatMap(row=>row.licences.flatMap(licence=>licence.evidenceAssetId?[licence.evidenceAssetId]:[])))].sort();
  if(assetIds.length)await tx.$queryRaw(Prisma.sql`SELECT id FROM "PrivateAsset" WHERE id IN (${Prisma.join(assetIds)}) ORDER BY id FOR SHARE`);
  const licenceEvidence=await tx.privateAsset.findMany({where:{id:{in:assetIds},purpose:"ADVERTISING_LICENCE",deletedAt:null},select:{id:true,ownerUserId:true}});
  const acceptedProof=(account:{platform:string;providerAccountId:string|null;handle:string;ownershipIdentityHash:string|null;ownershipReviewedBy:string|null})=>account.ownershipReviewedBy!==null && reviewers.has(account.ownershipReviewedBy) && account.ownershipIdentityHash===hash({platform:account.platform,providerAccountId:account.providerAccountId,normalizedHandle:account.handle,confirmedOrigin:null});
  const policy=options.policyReader?await options.policyReader(tx,requirements,ids):null,inputs:CreatorInput[]=[],identities:Record<string,MatchingCreatorIdentity>={};
  for(const row of rows) {
    if(!CountryCodeSchema.safeParse(row.countryCode).success || !z.array(ContentLanguageSchema.unwrap()).max(20).safeParse(row.languages).success || !z.array(ArabicDialectSchema).max(12).safeParse(row.dialects).success)continue;
    const claimed=row.userId!==null;
    if(claimed && (!row.user?.active || row.user.role!=="CREATOR" || !row.user.emailVerifiedAt || row.user.isTest || !past(row.publicConsentAt,now) || !row.primaryAccountId))continue;
    const primary=row.accounts.find(account=>account.id===row.primaryAccountId);
    if(claimed && (!primary || primary.ownershipStatus!=="VERIFIED" || !acceptedProof(primary) || !past(primary.ownershipReviewedAt,now) || !past(primary.intendedConfirmedAt,now) || !past(primary.consentAt,now)))continue;
    const accounts:MatchingAccount[]=[];
    for(const account of row.accounts) {
      if(!account.brandVisible || !past(account.factsApprovedAt,now) || !past(account.intendedConfirmedAt,now) || !past(account.consentAt,now) || claimed && (account.ownershipStatus!=="VERIFIED" || !acceptedProof(account) || !past(account.ownershipReviewedAt,now)))continue;
      const snapshot=await tx.metricsSnapshot.findFirst({where:{accountId:account.id,mappingRevision:account.mappingRevision,reviewStatus:"VERIFIED",approvedAt:{not:null,lte:now},approvedBy:{not:null},excludedAt:null,observedAt:{gte:new Date(now.getTime()-FRESHNESS_MS),lte:now}},orderBy:[{observedAt:"desc"},{id:"asc"}]});
      if(!snapshot || snapshot.approvedAt!<snapshot.observedAt)continue;
      const result=snapshotAccount(account,snapshot,row,now);
      if(result.audience.age && !result.audience.age.value.every(bucket=>AudienceAgeBucketSchema.safeParse(bucket.key).success))continue;
      if(result.audience.gender && !result.audience.gender.value.every(bucket=>AudienceGenderSchema.safeParse(bucket.key).success))continue;
      accounts.push(result);
    }
    const profile=record(row.profileFacts),availability=record(row.availability),travel=record(row.travel);
    const period=DateRangeSchema.safeParse({startsAt:availability.startsAt,endsAt:availability.endsAt,timeZone:row.timeZone}),status=AvailabilitySchema.safeParse(availability.status);
    const shareRates=profile.ratesVisibility==="PUBLIC" || profile.ratesVisibility==="BRAND_ONLY";
    const rates=shareRates?row.rates.flatMap(rate=>{const amount=MoneySchema.safeParse({amountMinor:rate.amountMinor.toString(),currencyCode:rate.currency});return amount.success?[{creatorId:row.id,platform:rate.platform,format:rate.format,amount:amount.data}]:[];}):[];
    const minimum=shareRates && row.currency && row.minimumMinor!==null?MoneySchema.safeParse({amountMinor:row.minimumMinor.toString(),currencyCode:row.currency}):null;
    const licences=row.licences.filter(licence=>licence.status==="VERIFIED" && licence.policyVersion && licence.reviewMethod==="MANUAL_REVIEW" && licence.reviewedBy && reviewers.has(licence.reviewedBy) && past(licence.reviewedAt,now) && licence.reviewedAt!>=licence.createdAt && (!licence.validFrom || licence.validFrom<=new Date(requirements.period.startsAt)) && licence.evidenceAssetId && licenceEvidence.some(asset=>asset.id===licence.evidenceAssetId && (asset.ownerUserId===row.userId || asset.ownerUserId===licence.reviewedBy)) && licence.accountIds.length>0 && licence.accountIds.every(id=>row.accounts.some(account=>account.id===id && licence.platformScope.includes(account.platform)))).map(licence=>({id:licence.id,policyIds:[licence.policyVersion!],jurisdiction:licence.jurisdiction,status:"VERIFIED" as const,accountIds:licence.accountIds,reviewedAt:licence.reviewedAt!.toISOString(),expiresAt:licence.expiresAt?.toISOString()??null}));
    const input:CreatorInput={id:row.id,claimStatus:claimed?"CLAIMED":"UNCLAIMED",hidden:false,suspended:false,isTest:false,eligible:true,brandVisible:true,residenceCountryCode:row.countryCode!,contentLanguages:row.languages,dialects:row.dialects,availability:{status:status.success?status.data:"UNKNOWN",period:period.success?period.data:null,confirmedAt:instant(availability.confirmedAt)},travelWilling:travel.willing===true,travelCountryCodes:z.array(CountryCodeSchema).max(50).safeParse(travel.countryCodes).success?travel.countryCodes as string[]:[],nicheSlugs:profileFact(profile,"nicheSlugs",SlugsSchema,row.id,now),fameIndustries:profileFact(profile,"fameIndustries",z.array(FameIndustrySchema).max(12),row.id,now),accounts,rates,minimumDeal:minimum?.success?minimum.data:null,minimumDealKnown:shareRates && (row.minimumMinor===null || minimum?.success===true),licences,policyOutcomes:policy?.outcomes[row.id]??[],safetyExclusions:policy?.safetyExclusions[row.id]??[]};
    try {if(!prepareEligibility(campaignInput(requirements),input,now.toISOString()).eligibility.eligible)continue;}catch{continue;}
    inputs.push(input);
    identities[row.id]={displayName:row.displayName,handle:row.handle};
  }
  return {inputs,identities,readiness:requirements.mandatoryPolicyVersionIds.length && !policy?"POLICY_OUTCOMES_UNAVAILABLE":"READY",policyVersion:policy?.version??null};
}

// Internal domain integration, not an HTTP capability. Caller owns actor/campaign
// authorization and its transaction. Current visibility, proof, metrics, dates,
// preferences and contributing-source checks are identical to matching; a direct
// path gets no score, threshold, reservation, provider call or stored match.
export async function loadEligibleCreator(tx:Transaction,requirements:CampaignRequirementsDTO,creatorId:string,now:Date,options:Pick<MatchingPersistenceOptions,"policyReader">={}):Promise<CreatorInput|null> {
  parse(IdSchema,creatorId);clock({now});
  const approvedRequirements=parse(CampaignRequirementsSchema,requirements);
  const loaded=await candidates(tx,approvedRequirements,now,options,creatorId);
  return loaded.inputs.find(input=>input.id===creatorId && input.claimStatus==="CLAIMED")??null;
}

type RequirementSnapshot={schemaVersion:1;requirements:CampaignRequirementsDTO;campaignRevision:number;fieldsRevision:number;allocationBasis:"FIRST_SLOT_COMPARISON";candidateFingerprint:string;taxonomyVersion:string};
type MatchSnapshot={schemaVersion:1;inputFingerprint:string;result:MatchResult};
function requirementSnapshot(run:MatchRun):RequirementSnapshot {
  const raw=record(run.requirementSnapshot);
  if(raw.schemaVersion!==1 || raw.allocationBasis!=="FIRST_SLOT_COMPARISON" || typeof raw.candidateFingerprint!=="string" || typeof raw.fieldsRevision!=="number")throw new MatchingError("INVALID_RUN_SNAPSHOT");
  return {...raw,requirements:parse(CampaignRequirementsSchema,raw.requirements)} as RequirementSnapshot;
}
async function project(tx:Transaction,campaign:Campaign,run:MatchRun,now:Date,options:MatchingPersistenceOptions,replayed:boolean):Promise<MatchingRunDTO> {
  const stored=requirementSnapshot(run),current=await candidates(tx,stored.requirements,now,options),byId=new Map(current.inputs.map(input=>[input.id,input]));
  const latest=await tx.matchRun.findFirst({where:{campaignId:campaign.id},orderBy:[{createdAt:"desc"},{id:"desc"}],select:{id:true}});
  const policy=record(run.policySnapshot);
  const stale=campaign.currentBriefVersion!==run.briefVersion || record(campaign.input).fieldsRevision!==stored.fieldsRevision || run.algorithmVersion!==STRATEGY_ID || stored.taxonomyVersion!==NICHE_SOURCE.version || stored.candidateFingerprint!==hash(current.inputs) || policy.readerVersion!==current.policyVersion || latest?.id!==run.id || !["BRIEF_APPROVED","SHORTLISTED","IN_DEALS"].includes(campaign.status);
  const rows=await tx.creatorMatch.findMany({where:{runId:run.id},orderBy:[{score:"desc"},{creatorId:"asc"}]}),decisions=await tx.matchDecisionRecord.findMany({where:{campaignId:campaign.id,creatorId:{in:rows.map(row=>row.creatorId)}}}),results:MatchingRunDTO["results"]=[];
  for(const row of rows) {
    const snapshot=record(row.snapshot) as unknown as MatchSnapshot,input=byId.get(row.creatorId);
    // Revoked/changed data is omitted, not exposed from a historical cache. GET
    // validates permission/fingerprints only; it never scores/ranks or writes.
    if(!input || snapshot.schemaVersion!==1 || snapshot.inputFingerprint!==hash(input) || snapshot.result?.creatorId!==row.creatorId || snapshot.result.score!==row.score)continue;
    const decision=decisions.find(item=>item.creatorId===row.creatorId);
    const facts:(Fact<unknown>|null)[]=[input.nicheSlugs,input.fameIndustries,...input.accounts.flatMap(account=>[account.followers,account.engagementPct,...Object.values(account.audience),...account.averageViews.map(view=>view.value)])];
    // Only sources that actually contributed to the immutable result, still
    // permitted by today's exact loader. No account/provider or proof identifiers.
    const provenance=[...new Map(facts.filter((fact):fact is Fact<unknown>=>!!fact && fact.evidence.visibility!=="PRIVATE" && snapshot.result.evidenceVersions.includes(fact.evidence.version)).map(fact=>[fact.evidence.version,fact.evidence])).values()];
    results.push({...snapshot.result,stale,creator:current.identities[row.creatorId],provenance,decision:decision?{creatorId:decision.creatorId,decision:decision.decision,revision:decision.revision,runId:decision.runId,updatedAt:decision.updatedAt.toISOString()}:null});
  }
  return {runId:run.id,briefVersion:run.briefVersion,strategyId:run.algorithmVersion,createdAt:run.createdAt.toISOString(),replayed,stale,readiness:current.readiness,allocationBasis:"FIRST_SLOT_COMPARISON",desiredCreatorCount:stored.requirements.desiredCreatorCount,results};
}
async function replay(tx:Transaction,campaignId:string,actorUserId:string,key:string,payloadHash:string):Promise<Record<string,unknown>|null> {
  const previous=await tx.matchCommand.findUnique({where:{campaignId_operationKey:{campaignId,operationKey:key}}});
  if(!previous)return null;
  if(previous.actorUserId!==actorUserId || previous.payloadHash!==payloadHash)throw new MatchingError("IDEMPOTENCY_CONFLICT");
  return record(previous.result);
}
async function storeCommand(tx:Transaction,campaignId:string,actorUserId:string,key:string,payloadHash:string,result:unknown) {
  await tx.matchCommand.create({data:{campaignId,actorUserId,operationKey:key,payloadHash,result:json(result)}});
}
export async function runCampaignMatching(actorUserId:string,campaignId:string,rawCommand:unknown,options:MatchingPersistenceOptions={}):Promise<MatchingRunDTO> {
  const command=parse(RunCommandSchema,rawCommand),now=clock(options),payloadHash=hash({action:"RUN",...command,campaignId});
  return (options.client??prisma).$transaction(async(tx)=>{
    const campaign=await owned(tx,actorUserId,campaignId,true),previous=await replay(tx,campaignId,actorUserId,command.operationKey,payloadHash);
    if(previous) {const run=await tx.matchRun.findFirst({where:{id:previous.runId as string,campaignId}});if(!run)throw new MatchingError("NOT_FOUND",404);return project(tx,campaign,run,now,options,true);}
    const brief=await approved(tx,campaign,actorUserId,command,now),loaded=await candidates(tx,brief.requirements,now,options),matches:MatchResult[]=[];
    // One malformed profile cannot promote a synthetic fallback or break all
    // other approved candidates. Normal eligibility filtering already occurred.
    for(const input of loaded.inputs) {try{matches.push(...shortlist(campaignInput(brief.requirements),[input],now.toISOString()));}catch{/* unusable candidate */}}
    matches.sort((a,b)=>b.score-a.score || (a.creatorId<b.creatorId?-1:a.creatorId>b.creatorId?1:0));
    const run=await tx.matchRun.create({data:{campaignId,briefVersion:brief.requirements.version,algorithmVersion:STRATEGY_ID,requirementSnapshot:json({schemaVersion:1,requirements:brief.requirements,campaignRevision:campaign.revision,fieldsRevision:brief.inputRevision,allocationBasis:"FIRST_SLOT_COMPARISON",candidateFingerprint:hash(loaded.inputs),taxonomyVersion:NICHE_SOURCE.version} satisfies RequirementSnapshot),policySnapshot:json({review:brief.policyReview,readerVersion:loaded.policyVersion,readiness:loaded.readiness})}});
    await tx.creatorMatch.createMany({data:matches.slice(0,12).map(result=>({runId:run.id,creatorId:result.creatorId,score:result.score,snapshot:json({schemaVersion:1,inputFingerprint:hash(loaded.inputs.find(input=>input.id===result.creatorId)),result} satisfies MatchSnapshot)}))});
    await storeCommand(tx,campaignId,actorUserId,command.operationKey,payloadHash,{runId:run.id});
    return project(tx,campaign,run,now,options,false);
  },{maxWait:10_000,timeout:20_000});
}
export async function getCampaignMatches(actorUserId:string,campaignId:string,runId?:string,options:MatchingPersistenceOptions={}):Promise<MatchingRunDTO|null> {
  if(runId)parse(IdSchema,runId);const now=clock(options);
  return (options.client??prisma).$transaction(async(tx)=>{
    const campaign=await owned(tx,actorUserId,campaignId,false),run=runId?await tx.matchRun.findFirst({where:{id:runId,campaignId}}):await tx.matchRun.findFirst({where:{campaignId},orderBy:[{createdAt:"desc"},{id:"desc"}]});
    if(!run){if(runId)throw new MatchingError("NOT_FOUND",404);return null;}
    return project(tx,campaign,run,now,options,false);
  },{maxWait:10_000,timeout:20_000});
}
export async function decideCampaignMatch(actorUserId:string,campaignId:string,rawCommand:unknown,options:MatchingPersistenceOptions={}):Promise<MatchingDecisionDTO & {replayed:boolean}> {
  const command=parse(DecisionCommandSchema,rawCommand),now=clock(options),payloadHash=hash({action:"DECISION",...command,campaignId});
  return (options.client??prisma).$transaction(async(tx)=>{
    const campaign=await owned(tx,actorUserId,campaignId,true),previous=await replay(tx,campaignId,actorUserId,command.operationKey,payloadHash);
    if(previous)return {...previous,replayed:true} as MatchingDecisionDTO & {replayed:boolean};
    if(campaign.currentBriefVersion!==command.expectedBriefVersion || !["BRIEF_APPROVED","SHORTLISTED","IN_DEALS"].includes(campaign.status))throw new MatchingError("STALE_VERSION");
    const latest=await tx.matchRun.findFirst({where:{campaignId},orderBy:[{createdAt:"desc"},{id:"desc"}]});
    if(!latest || latest.id!==command.runId || latest.briefVersion!==command.expectedBriefVersion)throw new MatchingError("STALE_RUN");
    const view=await project(tx,campaign,latest,now,options,false);
    if(view.stale || !view.results.some(result=>result.creatorId===command.creatorId))throw new MatchingError("STALE_RUN");
    const prior=await tx.matchDecisionRecord.findUnique({where:{campaignId_creatorId:{campaignId,creatorId:command.creatorId}}});
    if((prior?.revision??0)!==command.expectedDecisionRevision)throw new MatchingError("STALE_VERSION");
    if(prior?.decision==="OFFER_SENT")throw new MatchingError("OFFER_ALREADY_SENT");
    const saved=prior?await tx.matchDecisionRecord.update({where:{id:prior.id},data:{decision:command.decision,actorUserId,runId:command.runId,revision:{increment:1}}}):await tx.matchDecisionRecord.create({data:{campaignId,creatorId:command.creatorId,actorUserId,decision:command.decision,runId:command.runId}});
    const result:MatchingDecisionDTO={creatorId:saved.creatorId,decision:saved.decision,revision:saved.revision,runId:saved.runId,updatedAt:saved.updatedAt.toISOString()};
    await storeCommand(tx,campaignId,actorUserId,command.operationKey,payloadHash,result);
    return {...result,replayed:false};
  },{maxWait:10_000,timeout:20_000});
}
