import { Prisma, type PolicyVersion } from "@prisma/client";
import { z } from "zod";
import { CountryCodeSchema, PlatformSchema } from "@/lib/contracts/vocabulary";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { parseBriefContent, type CampaignPolicyReview, type CampaignRequirementsDTO } from "@/lib/campaigns/contracts";
import type { MatchingPolicyReader } from "@/lib/matching/persistence";
import type { PolicyOutcome } from "@/lib/matching/types";
import { DealError, type DealPolicyVerifier } from "@/lib/deals/contracts";
import { offerVerificationSatisfied } from "@/lib/offer-verification";

const REGISTRY_VERSION = "reviewed-registry-v1";
const uniqueCountries = z.array(CountryCodeSchema).min(1).max(249).refine((rows) => new Set(rows).size === rows.length);
const reviewReference = z.string().trim().min(1).max(1000);
export const MarketPolicyContentSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal("MARKET"),
  marketCountryCode: CountryCodeSchema, brandCountryCodes: uniqueCountries, creatorCountryCodes: uniqueCountries,
  licenceRequired: z.boolean(), licencePolicyId: z.string().min(1).max(200).nullable(),
  reviewReference, reviewedBasis: z.literal("FOUNDER_APPROVED_LEGAL_REVIEW"),
}).strict().refine((row) => !row.licenceRequired || row.licencePolicyId !== null, "Required licence must identify its reviewed policy");
export const GoverningTermsContentSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal("GOVERNING_TERMS"),
  brandCountryCodes: uniqueCountries, creatorCountryCodes: uniqueCountries, marketCountryCodes: uniqueCountries,
  translations: z.object({ ar: z.string().trim().min(1).max(100_000), en: z.string().trim().min(1).max(100_000).optional() }).strict(),
  reviewReference, reviewedBasis: z.literal("FOUNDER_APPROVED_LEGAL_REVIEW"),
}).strict();
type Transaction = Prisma.TransactionClient;
type Market = { record: PolicyVersion; content: z.infer<typeof MarketPolicyContentSchema> };

// A VERIFIED flag alone is insufficient: review evidence, an active administrator
// and explicit scope/expiry must still be current. No jurisdiction has a default.
async function reviewedRecords(tx: Transaction, kind: string, through: Date, now: Date): Promise<PolicyVersion[]> {
  const cutoff = new Date(Math.max(through.getTime(), now.getTime()));
  let rows = await tx.policyVersion.findMany({ where: { kind, status: "VERIFIED", reviewedAt: { lte: now },
    reviewedBy: { not: null }, evidenceAssetId: { not: null }, OR: [{ expiresAt: null }, { expiresAt: { gte: cutoff } }] },
    orderBy: [{ reviewedAt: "desc" }, { id: "asc" }] });
  const reviewerIds = [...new Set(rows.flatMap((r) => r.reviewedBy ? [r.reviewedBy] : []))].sort();
  if (reviewerIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(reviewerIds)}) ORDER BY id FOR SHARE`);
  const ids = rows.map((r) => r.id).sort();
  if (ids.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM "PolicyVersion" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`);
  rows = await tx.policyVersion.findMany({ where: { id: { in: ids }, status: "VERIFIED", reviewedBy: { in: reviewerIds }, reviewedAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gte: cutoff } }] }, orderBy: [{ reviewedAt: "desc" }, { id: "asc" }] });
  const evidenceIds = rows.flatMap((r) => r.evidenceAssetId ? [r.evidenceAssetId] : []).sort();
  if (evidenceIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM "PrivateAsset" WHERE id IN (${Prisma.join(evidenceIds)}) ORDER BY id FOR SHARE`);
  const reviewers = new Set((await tx.user.findMany({ where: { id: { in: rows.flatMap((r) => r.reviewedBy ? [r.reviewedBy] : []) }, active: true, role: "ADMIN" }, select: { id: true } })).map((u) => u.id));
  const assets = await tx.privateAsset.findMany({ where: { id: { in: rows.flatMap((r) => r.evidenceAssetId ? [r.evidenceAssetId] : []) }, purpose: "LEGAL_POLICY_REVIEW", deletedAt: null }, select: { id: true, ownerUserId: true } });
  return rows.filter((r) => r.reviewedAt! >= r.createdAt && reviewers.has(r.reviewedBy!) && assets.some((a) => a.id === r.evidenceAssetId && a.ownerUserId === r.reviewedBy));
}
async function markets(tx: Transaction, requirements: CampaignRequirementsDTO, now: Date): Promise<Market[] | null> {
  const rows = await reviewedRecords(tx, "MARKET", new Date(requirements.period.endsAt), now), selected: Market[] = [];
  for (const country of requirements.marketCountryCodes) {
    const applicable = rows.filter((r) => {
      const result = MarketPolicyContentSchema.safeParse(r.content);
      return result.success && result.data.marketCountryCode === country && r.countryCodes.includes(country) && result.data.brandCountryCodes.includes(requirements.brandCountryCode);
    });
    if (applicable.length > 1) throw new DealError("POLICY_AMBIGUOUS", 503);
    if (applicable.length === 0) return null;
    const record = applicable[0];
    selected.push({ record, content: MarketPolicyContentSchema.parse(record.content) });
  }
  return selected;
}
function version(rows: readonly Market[]): string { return `${REGISTRY_VERSION}:${canonicalHash(rows.map((r) => r.record.id).sort()).slice(0, 32)}`; }
export async function resolveCampaignPolicyReview(tx: Transaction, requirements: CampaignRequirementsDTO, now = new Date()): Promise<CampaignPolicyReview | null> {
  const selected = await markets(tx, requirements, now);
  if (!selected?.length) return null;
  return { reviewed: true, resolverVersion: version(selected), reviewedAt: new Date(Math.max(...selected.map((r) => r.record.reviewedAt!.getTime()))).toISOString(),
    marketCountryCodes: [...requirements.marketCountryCodes], mandatoryPolicyVersionIds: selected.map((r) => r.record.id).sort() };
}
async function outcomes(tx: Transaction, requirements: CampaignRequirementsDTO, creatorIds: readonly string[], now: Date) {
  const selected = await markets(tx, requirements, now);
  if (!selected || canonicalHash(selected.map((r) => r.record.id).sort()) !== canonicalHash([...requirements.mandatoryPolicyVersionIds].sort())) throw new DealError("POLICY_UNAVAILABLE", 503);
  let creators = await tx.creator.findMany({ where: { id: { in: [...creatorIds] } }, include: { accounts: true, licences: true } });
  const reviewerIds = [...new Set(creators.flatMap((c) => c.licences.flatMap((l) => l.reviewedBy ? [l.reviewedBy] : [])))].sort();
  if (reviewerIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(reviewerIds)}) ORDER BY id FOR SHARE`);
  const licenceIds = creators.flatMap((c) => c.licences.map((l) => l.id)).sort();
  if (licenceIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM "AdvertisingLicence" WHERE id IN (${Prisma.join(licenceIds)}) ORDER BY id FOR SHARE`);
  // Review/revocation may have completed while acquiring these locks. Never
  // freeze the earlier status or introduce a newly seen, unlocked reviewer.
  creators = await tx.creator.findMany({ where: { id: { in: [...creatorIds] } }, include: { accounts: true, licences: { where: { id: { in: licenceIds } } } } });
  const reviewers = new Set((await tx.user.findMany({ where: { id: { in: reviewerIds }, active: true, role: "ADMIN" }, select: { id: true } })).map((u) => u.id));
  const evidenceIds = [...new Set(creators.flatMap((c) => c.licences.flatMap((l) => l.evidenceAssetId ? [l.evidenceAssetId] : [])))].sort();
  if (evidenceIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM "PrivateAsset" WHERE id IN (${Prisma.join(evidenceIds)}) ORDER BY id FOR SHARE`);
  const evidence = await tx.privateAsset.findMany({ where: { id: { in: evidenceIds }, purpose: "ADVERTISING_LICENCE", deletedAt: null }, select: { id: true, ownerUserId: true } });
  const byCreator: Record<string, PolicyOutcome[]> = {}, licenceSnapshots: Record<string, Prisma.JsonValue[]> = {};
  const starts = new Date(requirements.period.startsAt), ends = new Date(Math.max(Date.parse(requirements.period.endsAt), now.getTime()));
  for (const creator of creators) {
    const accounts = creator.accounts.filter((a) => requirements.deliverables.some((d) => d.platform === a.platform) && a.brandVisible && a.consentAt && a.intendedConfirmedAt);
    const scoped = new Set(accounts.map((a) => a.id));
    licenceSnapshots[creator.id] = [];
    byCreator[creator.id] = selected.map<PolicyOutcome>(({ record, content }) => {
      const licence = creator.licences.find((l) => l.status === "VERIFIED" && l.reviewedBy && reviewers.has(l.reviewedBy) && l.reviewedAt && l.reviewedAt <= now && l.reviewedAt >= l.createdAt && l.evidenceAssetId && evidence.some((a) => a.id === l.evidenceAssetId && (a.ownerUserId === creator.userId || a.ownerUserId === l.reviewedBy)) && l.reviewMethod === "MANUAL_REVIEW" && l.policyVersion === content.licencePolicyId && l.jurisdiction === content.marketCountryCode && (!l.validFrom || l.validFrom <= starts) && (!l.expiresAt || l.expiresAt >= ends) && accounts.every((a) => l.accountIds.includes(a.id) && PlatformSchema.safeParse(a.platform).success && l.platformScope.includes(a.platform)));
      const covered = creator.countryCode !== null && content.creatorCountryCodes.includes(creator.countryCode);
      if (licence) licenceSnapshots[creator.id].push({ id: licence.id, jurisdiction: licence.jurisdiction, policyVersion: licence.policyVersion, accountIds: licence.accountIds.filter((id) => scoped.has(id)), platformScope: licence.platformScope, reviewedAt: licence.reviewedAt!.toISOString(), expiresAt: licence.expiresAt?.toISOString() ?? null });
      return { policyId: content.licencePolicyId ?? record.id, versionId: record.id, reviewed: true,
        status: !covered ? "UNKNOWN" : content.licenceRequired && !licence ? "FAIL" : "PASS", accountIds: accounts.map((a) => a.id), validUntil: record.expiresAt?.toISOString() ?? null };
    });
  }
  return { selected, byCreator, licenceSnapshots };
}
export const reviewedMatchingPolicies: MatchingPolicyReader = async (tx, requirements, creatorIds) => {
  const result = await outcomes(tx, requirements, creatorIds, new Date());
  return { version: version(result.selected), outcomes: result.byCreator, safetyExclusions: {} };
};
export async function reviewedGoverningOptions(tx: Transaction, requirements: CampaignRequirementsDTO, creatorCountryCode: string, now = new Date()) {
  return (await reviewedRecords(tx, "GOVERNING_TERMS", new Date(requirements.period.endsAt), now)).flatMap((record) => {
    const parsed = GoverningTermsContentSchema.safeParse(record.content);
    if (!parsed.success || !parsed.data.brandCountryCodes.includes(requirements.brandCountryCode) || !parsed.data.creatorCountryCodes.includes(creatorCountryCode) || !requirements.marketCountryCodes.every((country) => parsed.data.marketCountryCodes.includes(country) && record.countryCodes.includes(country))) return [];
    return [{ id: record.id, availableLanguages: parsed.data.translations.en ? ["ar", "en"] as const : ["ar"] as const, translations: parsed.data.translations }];
  });
}
export const reviewedDealPolicies: DealPolicyVerifier = async (tx, _actorUserId, campaignId, creatorId, terms, stage, language = "ar", context) => {
  if (!terms) throw new DealError("POLICY_UNAVAILABLE", 503);
  const campaign = await tx.campaign.findUnique({ where: { id: campaignId }, include: { brand: true } });
  if (!campaign) throw new DealError("BRIEF_NOT_APPROVED");
  let requirements = context?.requirements;
  if (!requirements) {
    if (!campaign.currentBriefVersion) throw new DealError("BRIEF_NOT_APPROVED");
    const brief = await tx.campaignBrief.findUnique({ where: { campaignId_version: { campaignId, version: campaign.currentBriefVersion } } });
    if (!brief?.approvedAt) throw new DealError("BRIEF_NOT_APPROVED");
    requirements = parseBriefContent(brief.content).requirements;
  }
  const now = new Date();
  if (requirements.campaignId !== campaignId || (stage === "CONFIRM" && (!context?.agreement || !context.dealId))) throw new DealError("POLICY_UNAVAILABLE", 503);
  if (campaign.brand.countryCode !== requirements.brandCountryCode || (context?.agreement && (context.agreement.brandCountryCode !== campaign.brand.countryCode || context.agreement.language !== language))) throw new DealError("POLICY_REVIEW_REQUIRED");
  if (!await offerVerificationSatisfied(tx, campaign.brand.userId, requirements, now)) throw new DealError("BRAND_CONTACT_VERIFICATION_REQUIRED");
  const result = await outcomes(tx, requirements, [creatorId], now);
  if (!result.byCreator[creatorId]?.length || result.byCreator[creatorId].some((o) => o.status !== "PASS")) throw new DealError("POLICY_ELIGIBILITY_REQUIRED");
  if (canonicalHash([...terms.licencePolicyVersionIds].sort()) !== canonicalHash([...requirements.mandatoryPolicyVersionIds].sort())) throw new DealError("POLICY_VERSION_MISMATCH");
  const creator = await tx.creator.findUnique({ where: { id: creatorId } });
  if (context?.agreement && creator?.countryCode !== context.agreement.creatorCountryCode) throw new DealError("POLICY_REVIEW_REQUIRED");
  const row = (await reviewedRecords(tx, "GOVERNING_TERMS", new Date(terms.period.endsAt), now)).find((r) => r.id === terms.governingTermsVersionId);
  const content = GoverningTermsContentSchema.safeParse(row?.content);
  if (!row || !content.success || !creator?.countryCode || !campaign.brand.countryCode || !content.data.brandCountryCodes.includes(campaign.brand.countryCode) || !content.data.creatorCountryCodes.includes(creator.countryCode) || !requirements.marketCountryCodes.every((c) => content.data.marketCountryCodes.includes(c) && row.countryCodes.includes(c)) || !content.data.translations[language]) throw new DealError("POLICY_UNAVAILABLE", 503);
  return { governingTerms: { id: row.id, language, content: content.data.translations[language]! }, policyVersion: version(result.selected),
    marketPolicyVersions: result.selected.map((r) => ({ id: r.record.id, jurisdiction: r.content.marketCountryCode, reviewedAt: r.record.reviewedAt!.toISOString(), expiresAt: r.record.expiresAt?.toISOString() ?? null })), licenceSnapshots: result.licenceSnapshots[creatorId] };
};
