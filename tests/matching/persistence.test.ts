import { createHash, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { decideCampaignMatch, getCampaignMatches, loadEligibleCreator, runCampaignMatching } from "@/lib/matching/persistence";
import { CampaignRequirementsSchema } from "@/lib/campaigns/contracts";

// Intentional isolated-domain fixtures, never seed/live evidence. Named synthetic,
// no providers, source SELF_REPORTED, cleaned after each guarded PostgreSQL test.
const now = new Date("2026-10-04T08:00:00.000Z");
const period = { startsAt:"2026-10-10T00:00:00.000Z", endsAt:"2026-10-20T00:00:00.000Z", timeZone:"Asia/Riyadh" };
const campaigns: string[] = [], creators: string[] = [], users: string[] = [], assets: string[] = [];
const options = { now };
async function actor(role: "BRAND" | "CREATOR" | "ADMIN" = "BRAND") {
  const id=randomUUID(); users.push(id);
  await prisma.user.create({data:{id,name:"Synthetic matching actor",email:`${id}@example.invalid`,passwordHash:"not-a-login-hash",role,emailVerifiedAt:now,isTest:false}});
  return id;
}
async function fixture(policy: {mandatoryIds?:string[];preferredIds?:string[];reviewed?:boolean}={}) {
  const owner=await actor(), campaignId=randomUUID(); campaigns.push(campaignId);
  const brand=await prisma.brand.create({data:{userId:owner,slug:`synthetic-${owner.slice(0,8)}`,name:"Synthetic matching brand",countryCode:"GB",isTest:false}});
  const requirements={campaignId,version:1,originalLanguage:"ar",title:"حملة اصطناعية للاختبار",productService:"Synthetic product",goal:"AWARENESS",summary:"Synthetic requirements",brandCountryCode:"GB",marketCountryCodes:["SA"],targetAgeBuckets:["18-24"],targetGenders:["FEMALE"],targetCountryCodes:["SA"],targetCityKeys:["SA:riyadh"],contentLanguages:["ar"],dialects:["ar-Gulf"],nicheSlugs:["beauty"],deliverables:[{platform:"INSTAGRAM",format:"REEL",count:1}],budget:{amountMinor:"10000",currencyCode:"SAR"},desiredCreatorCount:1,impressionsTarget:10000,period,physicalPresenceRequired:false,presenceCountryCodes:[],travelAllowed:false,tone:"Synthetic",noGoTopics:[],preferredTiers:[],dataVerificationRequired:false,preferredLicencePolicyIds:policy.preferredIds??[],mandatoryPolicyVersionIds:policy.mandatoryIds??[],usageRights:"Synthetic no publication",kpis:[],assumptions:[],openQuestions:[]};
  await prisma.campaign.create({data:{id:campaignId,brandId:brand.id,title:requirements.title,input:{schemaVersion:1,fieldsRevision:1,fields:{budget:{amountMinor:"1",currencyCode:"JPY"}},proposals:[],clarificationCount:0},status:"BRIEF_APPROVED",currentBriefVersion:1}});
  await prisma.campaignBrief.create({data:{campaignId,version:1,inputRevision:1,approvedAt:now,approvedByUserId:owner,content:{schemaVersion:1,requirements,approvedByUserId:owner,inputRevision:1,policyReview:policy.reviewed===false?null:{reviewed:true,resolverVersion:"synthetic-no-mandatory-rules",reviewedAt:now.toISOString(),marketCountryCodes:["SA"],mandatoryPolicyVersionIds:requirements.mandatoryPolicyVersionIds}}}});
  return {owner,campaignId,requirements,command:{operationKey:randomUUID(),expectedBriefVersion:1,expectedCampaignRevision:1}};
}
async function candidate(overrides: {brandVisible?:boolean;isTest?:boolean;state?:"PUBLISHED"|"HIDDEN";ownershipStatus?:"VERIFIED"|"UNPROVED";emptyMetrics?:boolean;observedAt?:Date}={}) {
  const userId=await actor("CREATOR"), id=randomUUID(); creators.push(id);
  const fact={value:["beauty"],source:"SELF_REPORTED",evidenceAt:now.toISOString(),approvedAt:now.toISOString(),brandVisible:true,publicVisible:false};
  await prisma.creator.create({data:{id,userId,handle:`synthetic_${id.replaceAll("-","").slice(0,18)}`,displayName:"Synthetic matching creator",countryCode:"GB",timeZone:"Asia/Riyadh",languages:["ar"],dialects:["ar-Gulf"],state:overrides.state??"PUBLISHED",isTest:overrides.isTest??false,brandVisible:overrides.brandVisible??true,publicConsentAt:now,availability:{status:"AVAILABLE",startsAt:period.startsAt,endsAt:period.endsAt,confirmedAt:now.toISOString()},travel:{willing:false,countryCodes:[]},profileFacts:{nicheSlugs:fact,ratesVisibility:"BRAND_ONLY"}}});
  const reviewerId=await actor("ADMIN"), handle=`synthetic_${id.slice(0,8)}`;
  const ownershipIdentityHash=createHash("sha256").update(JSON.stringify({confirmedOrigin:null,normalizedHandle:handle,platform:"INSTAGRAM",providerAccountId:null})).digest("hex");
  const account=await prisma.socialAccount.create({data:{creatorId:id,platform:"INSTAGRAM",handle,ownershipIdentityHash,ownershipStatus:overrides.ownershipStatus??"VERIFIED",ownershipReviewedBy:reviewerId,ownershipReviewedAt:now,intendedConfirmedAt:now,consentAt:now,factsApprovedAt:now,brandVisible:true,supportedFormats:["REEL"]}});
  await prisma.creator.update({where:{id},data:{primaryAccountId:account.id}});
  const dimension=(key:string)=>({value:[{key,percent:100}],visibility:"BRAND_ONLY"});
  const observedAt=overrides.observedAt??now;
  const window={startsAt:new Date(observedAt.getTime()-30*24*60*60*1000).toISOString(),endsAt:observedAt.toISOString(),timeZone:"Asia/Riyadh"};
  const snapshot=await prisma.metricsSnapshot.create({data:{accountId:account.id,source:"SELF_REPORTED",observedAt,mappingRevision:1,providerObservationId:`synthetic:${randomUUID()}`,approvedAt:now,approvedBy:"synthetic-review",reviewStatus:"VERIFIED",followers:BigInt(10000),...(!overrides.emptyMetrics?{engagementRate:"3.2",engagementContext:{unit:"PERCENT",window,definition:"Synthetic engagements/followers",visibility:"BRAND_ONLY"},formatMetrics:[{format:"REEL",value:10000,unit:"IMPRESSIONS",window,definition:"Synthetic mean impressions",visibility:"BRAND_ONLY"}],demographics:{age:dimension("18-24"),gender:dimension("FEMALE"),countries:dimension("SA"),cities:dimension("SA:riyadh")}}:{})}});
  await prisma.creatorRate.create({data:{creatorId:id,platform:"INSTAGRAM",format:"REEL",currency:"SAR",amountMinor:BigInt(10000)}});
  return {id,userId,reviewerId,accountId:account.id,snapshotId:snapshot.id};
}
afterEach(async()=>{
  await prisma.campaign.deleteMany({where:{id:{in:campaigns.splice(0)}}});
  await prisma.creator.deleteMany({where:{id:{in:creators.splice(0)}}});
  await prisma.privateAsset.deleteMany({where:{id:{in:assets.splice(0)}}});
  await prisma.user.deleteMany({where:{id:{in:users.splice(0)}}});
});

describe("owned explicit matching persistence on guarded PostgreSQL",()=>{
  it("requires actual scoped licence evidence, supported review method and a current independent ADMIN reviewer",async()=>{
    const f=await fixture({preferredIds:["synthetic-licence-policy"]}), c=await candidate(), reviewer=await actor("ADMIN");
    const requirements=CampaignRequirementsSchema.parse(f.requirements);
    const asset=await prisma.privateAsset.create({data:{ownerUserId:c.userId,purpose:"ADVERTISING_LICENCE",contentType:"text/plain",size:1,storageKey:`synthetic-licence:${randomUUID()}`,checksum:"synthetic-test-only-evidence"}});assets.push(asset.id);
    const base={creatorId:c.id,issuer:"Synthetic test issuer",holderName:"Synthetic test holder",licenceNumber:"synthetic-test-only",jurisdiction:"SA",status:"VERIFIED" as const,policyVersion:"synthetic-licence-policy",reviewMethod:"MANUAL_REVIEW",reviewedBy:reviewer,reviewedAt:now,createdAt:new Date(now.getTime()-60000),expiresAt:new Date(period.endsAt),evidenceAssetId:asset.id,accountIds:[c.accountId],platformScope:["INSTAGRAM" as const]};
    const licence=await prisma.advertisingLicence.create({data:base});
    const load=()=>prisma.$transaction(tx=>loadEligibleCreator(tx,requirements,c.id,now));
    expect((await load())?.id).toBe(c.id);
    const run=await runCampaignMatching(f.owner,f.campaignId,f.command,options);expect(run.results.map(row=>row.creatorId)).toEqual([c.id]);
    for(const override of [{reviewMethod:"UNSUPPORTED"},{evidenceAssetId:null},{reviewedBy:c.userId},{platformScope:["YOUTUBE" as const]},{accountIds:[]}]) {
      await prisma.advertisingLicence.update({where:{id:licence.id},data:{...base,...override}});
      expect(await load()).toBeNull();
    }
    await prisma.advertisingLicence.update({where:{id:licence.id},data:base});
    for(const metadata of [{purpose:"OWNERSHIP_PROOF",ownerUserId:c.userId},{purpose:"ADVERTISING_LICENCE",ownerUserId:f.owner}]) {
      const wrongAsset=await prisma.privateAsset.create({data:{...metadata,contentType:"text/plain",size:1,storageKey:`synthetic-licence-rejected:${randomUUID()}`,checksum:"synthetic-test-only-rejected-evidence"}});assets.push(wrongAsset.id);
      await prisma.advertisingLicence.update({where:{id:licence.id},data:{evidenceAssetId:wrongAsset.id}});
      expect(await load()).toBeNull();
    }
    await prisma.advertisingLicence.update({where:{id:licence.id},data:{evidenceAssetId:asset.id}});
    await prisma.privateAsset.update({where:{id:asset.id},data:{deletedAt:now}});
    expect(await load()).toBeNull();
    await prisma.privateAsset.update({where:{id:asset.id},data:{deletedAt:null}});
    expect((await load())?.id).toBe(c.id);
    await prisma.user.update({where:{id:reviewer},data:{active:false}});
    expect(await load()).toBeNull();
    expect((await getCampaignMatches(f.owner,f.campaignId,run.runId,options))?.results).toEqual([]);
    expect((await prisma.user.findUniqueOrThrow({where:{id:c.reviewerId}})).active).toBe(true); // Ownership reviewer is independent.
  });
  it("loads exactly one currently eligible claimed creator for direct paths without a score or writes",async()=>{
    const f=await fixture(), c=await candidate(), requirements=CampaignRequirementsSchema.parse(f.requirements);
    const load=()=>prisma.$transaction(tx=>loadEligibleCreator(tx,requirements,c.id,now));
    expect((await load())?.id).toBe(c.id);
    expect(JSON.stringify(await load())).not.toContain('"score":');
    await prisma.creator.update({where:{id:c.id},data:{availability:{status:"AVAILABLE",startsAt:period.startsAt,endsAt:period.endsAt}}});
    expect(await load()).toBeNull();
    await prisma.creator.update({where:{id:c.id},data:{availability:{status:"AVAILABLE",startsAt:period.startsAt,endsAt:period.endsAt,confirmedAt:now.toISOString()}}});
    await prisma.socialAccount.update({where:{id:c.accountId},data:{fieldVisibility:{followers:"PRIVATE","engagementRate":"PRIVATE","demographics.age":"PRIVATE","demographics.gender":"PRIVATE","demographics.countries":"PRIVATE","demographics.cities":"PRIVATE","formatMetrics.REEL":"PRIVATE"}}});
    expect(await load()).toBeNull();
    await prisma.socialAccount.update({where:{id:c.accountId},data:{fieldVisibility:{}}});
    await prisma.creator.update({where:{id:c.id},data:{userId:null}});
    expect(await load()).toBeNull(); // Proposed prospects cannot enter claimed deal paths.
    expect(await prisma.matchRun.count({where:{campaignId:f.campaignId}})).toBe(0);
    expect(await prisma.creatorMatch.count({where:{run:{campaignId:f.campaignId}}})).toBe(0);
  });
  it("rejects unrelated/inactive/creator actors before writes",async()=>{
    const f=await fixture(); await candidate();
    await expect(runCampaignMatching(await actor(),f.campaignId,f.command,options)).rejects.toMatchObject({code:"NOT_FOUND"});
    await expect(runCampaignMatching(await actor("CREATOR"),f.campaignId,f.command,options)).rejects.toMatchObject({code:"FORBIDDEN"});
    await prisma.user.update({where:{id:f.owner},data:{active:false}});
    await expect(runCampaignMatching(f.owner,f.campaignId,f.command,options)).rejects.toMatchObject({code:"FORBIDDEN"});
    expect(await prisma.matchRun.count({where:{campaignId:f.campaignId}})).toBe(0);
  });
  it("uses only exact approved immutable brief and excludes private/test/unproved profiles",async()=>{
    const f=await fixture(), allowed=await candidate();
    const privateCreator=await candidate({brandVisible:false}), test=await candidate({isTest:true}), unproved=await candidate({ownershipStatus:"UNPROVED"});
    const run=await runCampaignMatching(f.owner,f.campaignId,f.command,options);
    expect(run.results.map(row=>row.creatorId)).toEqual([allowed.id]);
    expect(run.results[0]).toMatchObject({score:70,allocation:{amountMinor:"10000",currencyCode:"SAR"}});
    expect(run.results[0].creator).toMatchObject({displayName:"Synthetic matching creator"});
    expect(run.results[0].provenance.length).toBeGreaterThan(0);
    expect(run.results[0].provenance.map(item=>item.version).sort()).toEqual([...run.results[0].evidenceVersions].sort());
    expect(run.results[0].provenance.every(item=>item.source==="SELF_REPORTED" && item.evidenceAt===now.toISOString() && item.visibility!=="PRIVATE")).toBe(true);
    expect(run.allocationBasis).toBe("FIRST_SLOT_COMPARISON");
    const stored=await prisma.matchRun.findUniqueOrThrow({where:{id:run.runId},include:{results:true}});
    const json=JSON.stringify(stored.requirementSnapshot)+JSON.stringify(stored.results);
    expect(json).not.toContain(privateCreator.id); expect(json).not.toContain(test.id); expect(json).not.toContain(unproved.id);
    expect(json).not.toContain("Synthetic matching creator");
    expect(JSON.stringify(stored.requirementSnapshot)).not.toContain('"currencyCode":"JPY"');
  });
  it("never pads unknown/below-threshold metrics and GET does not create a run",async()=>{
    const f=await fixture(); await candidate({emptyMetrics:true});
    expect(await getCampaignMatches(f.owner,f.campaignId,undefined,options)).toBeNull();
    expect((await runCampaignMatching(f.owner,f.campaignId,f.command,options)).results).toEqual([]);
    const count=await prisma.matchRun.count({where:{campaignId:f.campaignId}});
    expect((await getCampaignMatches(f.owner,f.campaignId,undefined,options))!.results).toEqual([]);
    expect(await prisma.matchRun.count({where:{campaignId:f.campaignId}})).toBe(count);
  });
  it("serializes concurrent replay by actual campaign locks and rejects changed request keys",async()=>{
    const f=await fixture(); await candidate(); const second=new PrismaClient();
    try {
      const [a,b]=await Promise.all([runCampaignMatching(f.owner,f.campaignId,f.command,options),runCampaignMatching(f.owner,f.campaignId,f.command,{...options,client:second})]);
      expect(a.runId).toBe(b.runId); expect([a.replayed,b.replayed].sort()).toEqual([false,true]);
      expect(await prisma.matchRun.count({where:{campaignId:f.campaignId}})).toBe(1);
      await expect(runCampaignMatching(f.owner,f.campaignId,{...f.command,expectedBriefVersion:2},options)).rejects.toMatchObject({code:"IDEMPOTENCY_CONFLICT"});
    } finally {await second.$disconnect();}
  });
  it("hides newly private/suspended results immediately and replay cannot return cached private data",async()=>{
    const f=await fixture(), c=await candidate(), run=await runCampaignMatching(f.owner,f.campaignId,f.command,options);
    await prisma.socialAccount.update({where:{id:c.accountId},data:{brandVisible:false}});
    const read=await getCampaignMatches(f.owner,f.campaignId,run.runId,options);
    expect(read).toMatchObject({stale:true,results:[]});
    expect(await runCampaignMatching(f.owner,f.campaignId,f.command,options)).toMatchObject({runId:run.runId,replayed:true,stale:true,results:[]});
    await expect(getCampaignMatches(await actor(),f.campaignId,run.runId,options)).rejects.toMatchObject({code:"NOT_FOUND"});
  });
  it("marks new approved evidence stale and does not promote private/unapproved corrections",async()=>{
    const f=await fixture(), c=await candidate(), run=await runCampaignMatching(f.owner,f.campaignId,f.command,options);
    await prisma.factCorrection.create({data:{accountId:c.accountId,field:"followers",reportedBy:c.userId,value:{value:1,evidenceAt:now.toISOString(),mappingRevision:1},brandVisible:true,createdAt:now}});
    expect((await getCampaignMatches(f.owner,f.campaignId,run.runId,options))!.stale).toBe(false);
    await prisma.factCorrection.create({data:{accountId:c.accountId,field:"followers",reportedBy:c.userId,value:{value:1,evidenceAt:now.toISOString(),mappingRevision:1},approvedAt:now,brandVisible:false,createdAt:now}});
    expect((await getCampaignMatches(f.owner,f.campaignId,run.runId,options))!.stale).toBe(false);
    await prisma.factCorrection.create({data:{accountId:c.accountId,field:"followers",reportedBy:c.userId,value:{value:20000,evidenceAt:now.toISOString(),mappingRevision:1},approvedAt:now,brandVisible:true,createdAt:now}});
    expect(await getCampaignMatches(f.owner,f.campaignId,run.runId,options)).toMatchObject({stale:true,results:[]});
    const newer=await runCampaignMatching(f.owner,f.campaignId,{...f.command,operationKey:randomUUID()},options);
    expect(newer.results[0].rawConfidence).toBe(0.4);
  });
  it("requires current exact brief/revision and labels old results stale after material changes",async()=>{
    const f=await fixture(); await candidate(); const run=await runCampaignMatching(f.owner,f.campaignId,f.command,options);
    await prisma.campaign.update({where:{id:f.campaignId},data:{revision:2,currentBriefVersion:null,status:"DRAFT"}});
    expect((await getCampaignMatches(f.owner,f.campaignId,run.runId,options))!.stale).toBe(true);
    await expect(runCampaignMatching(f.owner,f.campaignId,{...f.command,operationKey:randomUUID()},options)).rejects.toMatchObject({code:"STALE_VERSION"});
  });
  it("preserves decisions across reruns and decision replay never overwrites a newer action",async()=>{
    const f=await fixture(), c=await candidate(), run=await runCampaignMatching(f.owner,f.campaignId,f.command,options);
    const command={operationKey:randomUUID(),expectedBriefVersion:1,runId:run.runId,creatorId:c.id,expectedDecisionRevision:0,decision:"SAVED" as const};
    const saved=await decideCampaignMatch(f.owner,f.campaignId,command,options);
    expect(saved).toMatchObject({decision:"SAVED",revision:1,replayed:false});
    await expect(decideCampaignMatch(f.owner,f.campaignId,{...command,operationKey:randomUUID(),decision:"DISMISSED"},options)).rejects.toMatchObject({code:"STALE_VERSION"});
    await decideCampaignMatch(f.owner,f.campaignId,{...command,operationKey:randomUUID(),expectedDecisionRevision:1,decision:"DISMISSED"},options);
    expect((await decideCampaignMatch(f.owner,f.campaignId,command,options)).replayed).toBe(true);
    const newer=await runCampaignMatching(f.owner,f.campaignId,{...f.command,operationKey:randomUUID()},options);
    expect(newer.results[0].decision).toMatchObject({decision:"DISMISSED",revision:2});
    await expect(decideCampaignMatch(f.owner,f.campaignId,{...command,operationKey:randomUUID(),expectedDecisionRevision:2},options)).rejects.toMatchObject({code:"STALE_RUN"});
  });
  it("uses original90-day evidence dates and rejects older/future observations",async()=>{
    const f=await fixture(), boundary=new Date(now.getTime()-90*24*60*60*1000);
    const good=await candidate({observedAt:boundary});
    await candidate({observedAt:new Date(boundary.getTime()-1)});await candidate({observedAt:new Date(now.getTime()+1)});
    expect((await runCampaignMatching(f.owner,f.campaignId,f.command,options)).results.map(row=>row.creatorId)).toEqual([good.id]);
  });
  it("does not apply corrections approved before reporting, on another mapping or by another owner",async()=>{
    const f=await fixture(), c=await candidate(), run=await runCampaignMatching(f.owner,f.campaignId,f.command,options);
    for(const fields of [{createdAt:new Date(now.getTime()+1)},{value:{value:1,evidenceAt:now.toISOString(),mappingRevision:2}},{reportedBy:await actor("CREATOR")}]) {
      await prisma.factCorrection.create({data:{accountId:c.accountId,field:"followers",reportedBy:c.userId,value:{value:1,evidenceAt:now.toISOString(),mappingRevision:1},approvedAt:now,brandVisible:true,createdAt:now,...fields}});
    }
    expect(await getCampaignMatches(f.owner,f.campaignId,run.runId,options)).toMatchObject({stale:false});
  });
  it("preserves unknown minimum currency as partial quote and null budget",async()=>{
    const f=await fixture(), c=await candidate();
    await prisma.creator.update({where:{id:c.id},data:{minimumMinor:BigInt(12000),currency:null}});
    const run=await runCampaignMatching(f.owner,f.campaignId,f.command,options);
    expect(run.results[0]).toMatchObject({subscores:{budget:null},quote:{coverage:"PARTIAL",minimumKnown:false,total:null,subtotal:{amountMinor:"10000",currencyCode:"SAR"}}});
  });
  it("requires reviewed policy metadata and never accepts creator-supplied mandatory PASS",async()=>{
    const unreviewed=await fixture({reviewed:false});
    await expect(runCampaignMatching(unreviewed.owner,unreviewed.campaignId,unreviewed.command,options)).rejects.toMatchObject({code:"POLICY_REVIEW_REQUIRED"});
    const f=await fixture({mandatoryIds:["synthetic-rule-v1"]}), c=await candidate();
    await prisma.creator.update({where:{id:c.id},data:{profileFacts:{policyOutcomes:[{versionId:"synthetic-rule-v1",reviewed:true,status:"PASS",accountIds:[c.accountId]}]}}});
    expect(await runCampaignMatching(f.owner,f.campaignId,f.command,options)).toMatchObject({readiness:"POLICY_OUTCOMES_UNAVAILABLE",results:[]});
  });
  it("keeps chat metadata revisions separate from immutable material field revision",async()=>{
    const f=await fixture();await candidate();
    await prisma.campaign.update({where:{id:f.campaignId},data:{revision:2}});
    const run=await runCampaignMatching(f.owner,f.campaignId,{...f.command,expectedCampaignRevision:2},options);
    await prisma.campaign.update({where:{id:f.campaignId},data:{revision:3}});
    expect((await getCampaignMatches(f.owner,f.campaignId,run.runId,options))!.stale).toBe(false);
  });
  it("does not turn an unclaimed prospect into an executable offer or a fake offer decision",async()=>{
    const f=await fixture(), c=await candidate();
    await prisma.creator.update({where:{id:c.id},data:{userId:null,availability:{status:"UNKNOWN"}}});
    const run=await runCampaignMatching(f.owner,f.campaignId,f.command,options);
    expect(run.results[0]).toMatchObject({prospect:true,availability:"UNKNOWN",executableOffer:false});
    await expect(decideCampaignMatch(f.owner,f.campaignId,{operationKey:randomUUID(),expectedBriefVersion:1,runId:run.runId,creatorId:c.id,expectedDecisionRevision:0,decision:"OFFER_SENT"},options)).rejects.toMatchObject({code:"VALIDATION"});
  });
  it("rechecks the exact proof identity even when the handle and mapping revision did not change",async()=>{
    const f=await fixture(), c=await candidate(), run=await runCampaignMatching(f.owner,f.campaignId,f.command,options);
    await prisma.socialAccount.update({where:{id:c.accountId},data:{providerAccountId:"synthetic-different-stable-id"}});
    expect(await getCampaignMatches(f.owner,f.campaignId,run.runId,options)).toMatchObject({stale:true,results:[]});
  });
  it("does not accept an ownership reviewer who is no longer an active administrator",async()=>{
    const f=await fixture(), c=await candidate(), run=await runCampaignMatching(f.owner,f.campaignId,f.command,options);
    await prisma.user.update({where:{id:c.reviewerId},data:{role:"CREATOR"}});
    expect(await getCampaignMatches(f.owner,f.campaignId,run.runId,options)).toMatchObject({stale:true,results:[]});
  });
  it("intersects current granular permission with immutable observed field permission",async()=>{
    const f=await fixture(), c=await candidate(), run=await runCampaignMatching(f.owner,f.campaignId,f.command,options);
    await prisma.socialAccount.update({where:{id:c.accountId},data:{fieldVisibility:{"demographics.age":"PRIVATE"}}});
    expect(await getCampaignMatches(f.owner,f.campaignId,run.runId,options)).toMatchObject({stale:true,results:[]});
    const next=await runCampaignMatching(f.owner,f.campaignId,{...f.command,operationKey:randomUUID()},options);
    expect(next.results[0]).toMatchObject({score:61,subscores:{age:null},audience:{age:null}});
    expect(next.results[0].reasons).toContainEqual(expect.objectContaining({kind:"UNKNOWN",criterion:"age"}));
  });
  it("orders runs by serialized execution even when a competing transaction opened earlier",async()=>{
    const f=await fixture();await candidate();const second=new PrismaClient();
    let release!:()=>void,opened!:()=>void;
    const barrier=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{opened=resolve;});
    const delayedClient={$transaction:(operation:(tx:Prisma.TransactionClient)=>Promise<unknown>)=>second.$transaction(async tx=>{
      await tx.$queryRaw`SELECT transaction_timestamp()`;opened();await barrier;return operation(tx);
    },{timeout:20000})} as unknown as PrismaClient;
    const laterExecution=runCampaignMatching(f.owner,f.campaignId,{...f.command,operationKey:randomUUID()},{...options,client:delayedClient});
    try {
      await started;await runCampaignMatching(f.owner,f.campaignId,f.command,options);release();
      const later=await laterExecution,latest=await getCampaignMatches(f.owner,f.campaignId,undefined,options);
      expect({runId:latest!.runId,stale:latest!.stale}).toEqual({runId:later.runId,stale:false});
    } finally {release();await laterExecution.catch(()=>{});await second.$disconnect();}
  });
});
