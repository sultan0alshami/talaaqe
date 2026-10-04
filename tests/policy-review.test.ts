import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { CampaignRequirementsSchema, type CampaignRequirementsDTO } from "@/lib/campaigns/contracts";
import { campaignFields } from "./campaigns/fixtures";
import { resolveCampaignPolicyReview, reviewedDealPolicies } from "@/lib/policies";
import { offerVerificationSatisfied, phoneVerificationTarget } from "@/lib/offer-verification";
import type { AgreementContent, DealPolicyContext } from "@/lib/deals/contracts";

// Independent catalog witnesses. Every legal/OTP/evidence record below is a
// synthetic isolated database fixture, never a live review or provider proof.
const users: string[] = [], policies: string[] = [], assets: string[] = [], campaigns: string[] = [];
const originalSms = process.env.SMS_SUPPORTED_COUNTRIES;
const createdAt = new Date("2026-08-01T00:00:00.000Z"), reviewedAt = new Date("2026-08-02T00:00:00.000Z");
async function actor(role: "BRAND" | "CREATOR" | "ADMIN") {
  const id = randomUUID(); users.push(id);
  await prisma.user.create({ data: { id, role, active: true, isTest: true, email: `${id}@example.invalid`, name: "Independent synthetic policy witness", passwordHash: "not-a-login", emailVerifiedAt: reviewedAt } });
  return id;
}
async function policy(kind: "MARKET" | "GOVERNING_TERMS" | "PHONE_FALLBACK", admin: string, content: object, overrides: Record<string, unknown> = {}) {
  const evidence = await prisma.privateAsset.create({ data: { ownerUserId: admin, purpose: "LEGAL_POLICY_REVIEW", storageKey: `synthetic-independent/${randomUUID()}`, contentType: "text/plain", size: 1, checksum: "a".repeat(64), createdAt } }); assets.push(evidence.id);
  const id = `policy-witness-${randomUUID()}`; policies.push(id);
  await prisma.policyVersion.create({ data: { id, kind, countryCodes: ["KW"], status: "VERIFIED", reviewedBy: admin, evidenceAssetId: evidence.id, reviewedAt, createdAt, content: JSON.parse(JSON.stringify(content)), ...overrides } });
  return { id, evidenceId: evidence.id };
}
const market = (required = false) => ({ schemaVersion: 1, kind: "MARKET", marketCountryCode: "KW", brandCountryCodes: ["KW"], creatorCountryCodes: ["KW"],
  licenceRequired: required, licencePolicyId: required ? "synthetic-required-licence" : null, reviewedBasis: "FOUNDER_APPROVED_LEGAL_REVIEW", reviewReference: "Synthetic witness only; not legal advice or actual review" });
async function fixture() {
  const admin = await actor("ADMIN"), brandUserId = await actor("BRAND"), creatorUserId = await actor("CREATOR");
  const brand = await prisma.brand.create({ data: { userId: brandUserId, slug: `policy-witness-${brandUserId.slice(0, 8)}`, name: "Original synthetic brand", countryCode: "KW" } });
  const creator = await prisma.creator.create({ data: { userId: creatorUserId, handle: `witness_${creatorUserId.slice(0, 8)}`, displayName: "Original synthetic creator", countryCode: "KW" } });
  const account = await prisma.socialAccount.create({ data: { creatorId: creator.id, platform: "INSTAGRAM", handle: `witness_${creatorUserId.slice(0, 8)}`, consentAt: reviewedAt, intendedConfirmedAt: reviewedAt, brandVisible: true } });
  const m = await policy("MARKET", admin, market()), g = await policy("GOVERNING_TERMS", admin, { schemaVersion: 1, kind: "GOVERNING_TERMS", brandCountryCodes: ["KW"], creatorCountryCodes: ["KW"], marketCountryCodes: ["KW"],
    translations: { ar: "شروط شاهد مصطنع عربي" }, reviewedBasis: "FOUNDER_APPROVED_LEGAL_REVIEW", reviewReference: "Synthetic policy test; never an actual legal template" });
  const campaignId = randomUUID(); campaigns.push(campaignId);
  const r = CampaignRequirementsSchema.parse({ ...campaignFields, campaignId, version: 1, brandCountryCode: "KW", mandatoryPolicyVersionIds: [m.id] });
  await prisma.campaign.create({ data: { id: campaignId, brandId: brand.id, title: r.title, input: { fieldsRevision: 1 }, currentBriefVersion: 1, status: "BRIEF_APPROVED" } });
  await prisma.campaignBrief.create({ data: { campaignId, version: 1, inputRevision: 1, approvedByUserId: brandUserId, approvedAt: reviewedAt,
    content: { schemaVersion: 1, requirements: r, inputRevision: 1, approvedByUserId: brandUserId, policyReview: { reviewed: true, resolverVersion: "synthetic-witness", reviewedAt: reviewedAt.toISOString(), marketCountryCodes: ["KW"], mandatoryPolicyVersionIds: [m.id] } } } });
  process.env.SMS_SUPPORTED_COUNTRIES = "KW";
  const phone = "+96555550001";
  await prisma.user.update({ where: { id: brandUserId }, data: { phone, phoneVerifiedAt: reviewedAt } });
  await prisma.authToken.create({ data: { userId: brandUserId, purpose: "PHONE_VERIFY", tokenHash: "b".repeat(64), destination: phoneVerificationTarget(phone, "KW"),
    expiresAt: new Date("2027-01-01T00:00:00.000Z"), usedAt: reviewedAt, createdAt } });
  const terms = { deliverables: r.deliverables, amount: { amountMinor: "1000", currencyCode: "KWD" }, period: r.period, usageRights: "Synthetic rights",
    note: { text: "Original synthetic note", language: "en" }, governingTermsVersionId: g.id, licencePolicyVersionIds: [m.id] };
  const frozen: AgreementContent = { schemaVersion: 1, acceptedOfferId: "synthetic-independent-offer", language: "ar", terms, brandCountryCode: "KW", creatorCountryCode: "KW", campaignMarketCountryCodes: ["KW"],
    partiesSnapshot: { brandUserId, creatorUserId, brandName: brand.name, creatorName: creator.displayName }, reviewedLicenceSnapshots: [], marketPolicyVersions: [{ id: m.id }], policyVersion: "synthetic-witness",
    governingTermsVersionId: g.id, content: "شروط شاهد مصطنع عربي", contentHash: canonicalHash("synthetic-only"), acceptedAt: reviewedAt.toISOString() };
  const context: DealPolicyContext = { requirements: r, dealId: "synthetic-independent-deal", agreement: frozen };
  return { admin, brandUserId, creatorUserId, creatorId: creator.id, campaignId, accountId: account.id, m, g, r, terms, context };
}
afterEach(async () => {
  await prisma.verificationFallback.deleteMany({ where: { userId: { in: users } } });
  await prisma.campaign.deleteMany({ where: { id: { in: campaigns } } });
  await prisma.policyVersion.deleteMany({ where: { id: { in: policies } } });
  await prisma.privateAsset.deleteMany({ where: { id: { in: assets } } });
  await prisma.creator.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  users.length = 0; policies.length = 0; assets.length = 0; campaigns.length = 0;
  if (originalSms === undefined) delete process.env.SMS_SUPPORTED_COUNTRIES; else process.env.SMS_SUPPORTED_COUNTRIES = originalSms;
});
describe("independent reviewed policy regression witnesses", () => {
  it("uses frozen accepted scope for confirmation while a new campaign brief remains unapproved", async () => {
    const f = await fixture();
    const run = () => prisma.$transaction(tx => reviewedDealPolicies(tx, f.brandUserId, f.campaignId, f.creatorId, f.terms, "CONFIRM", "ar", f.context));
    expect((await run()).governingTerms.id).toBe(f.g.id);
    await prisma.campaign.update({ where: { id: f.campaignId }, data: { currentBriefVersion: null, status: "BRIEF_GENERATED", revision: { increment: 1 } } });
    expect((await run()).governingTerms.id).toBe(f.g.id);
  });
  it("rejects currently expired policy even if its expiry covered an already-ended campaign", async () => {
    const admin = await actor("ADMIN"), row = await policy("MARKET", admin, market(), { expiresAt: new Date("2026-10-03T00:00:00.000Z") });
    const r: CampaignRequirementsDTO = CampaignRequirementsSchema.parse({ ...campaignFields, campaignId: "independent-expiry-witness", version: 1, brandCountryCode: "KW", mandatoryPolicyVersionIds: [row.id],
      period: { startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-09-02T00:00:00.000Z", timeZone: "Asia/Kuwait" } });
    expect(await prisma.$transaction(tx => resolveCampaignPolicyReview(tx, r, new Date("2026-10-04T00:00:00.000Z")))).toBeNull();
  });
  it("does not silently select conflicting simultaneous current market versions by lexical ID", async () => {
    const f = await fixture(); await policy("MARKET", f.admin, market(true));
    await expect(prisma.$transaction(tx => resolveCampaignPolicyReview(tx, f.r))).rejects.toMatchObject({ code: "POLICY_AMBIGUOUS" });
  });
  it("holds reviewed status stable until a policy-dependent transaction ends, across real connections", async () => {
    const f = await fixture(), db = new Client({ connectionString: process.env.DATABASE_URL });
    let ready!: () => void, release!: () => void;
    const observed = new Promise<void>(resolve => { ready = resolve; }), barrier = new Promise<void>(resolve => { release = resolve; });
    const reader = prisma.$transaction(async tx => { const result = await resolveCampaignPolicyReview(tx, f.r); ready(); await barrier; return result; }, { timeout: 5000 });
    await observed; await db.connect(); let error: unknown;
    try { await db.query("BEGIN"); await db.query("SET LOCAL lock_timeout = '150ms'");
      try { await db.query('UPDATE "PolicyVersion" SET status=\'REVOKED\' WHERE id=$1', [f.m.id]); } catch (caught) { error = caught; }
    } finally { await db.query("ROLLBACK"); await db.end(); release(); await reader; }
    expect(error).toMatchObject({ code: "55P03" });
  });
  it.each(["FALLBACK", "POLICY"])("rejects expired contact %s after an already-ended campaign", async (expiredRecord) => {
      const f = await fixture();
      await prisma.user.update({ where: { id: f.brandUserId }, data: { phone: null, phoneVerifiedAt: null } });
      const p = await policy("PHONE_FALLBACK", f.admin, { schemaVersion: 1, kind: "PHONE_FALLBACK", countryCode: "KW", marketCountryCodes: ["KW"],
        reviewedBasis: "FOUNDER_APPROVED_LEGAL_REVIEW", reviewReference: "Synthetic independent fallback only", method: "DOCUMENTED_ADMIN_REVIEW", description: "Synthetic review, no live contact validation" },
        expiredRecord === "POLICY" ? { expiresAt: new Date("2026-10-03T00:00:00.000Z") } : {});
      const evidence = await prisma.privateAsset.create({ data: { ownerUserId: f.brandUserId, purpose: "CONTACT_VERIFICATION", storageKey: `synthetic-independent-contact/${randomUUID()}`, contentType: "text/plain", size: 1, checksum: "c".repeat(64), createdAt } }); assets.push(evidence.id);
      await prisma.verificationFallback.create({ data: { userId: f.brandUserId, countryCode: "KW", policyVersion: p.id, status: "VERIFIED", reviewedBy: f.admin, reviewedAt,
        evidenceAssetId: evidence.id, expiresAt: expiredRecord === "FALLBACK" ? new Date("2026-10-03T00:00:00.000Z") : null } });
      const r = { ...f.r, period: { startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-09-02T00:00:00.000Z", timeZone: "Asia/Kuwait" } };
      expect(await prisma.$transaction(tx => offerVerificationSatisfied(tx, f.brandUserId, r, new Date("2026-10-04T00:00:00.000Z")))).toBe(false);
  });
  it("keeps a previously reviewed policy version immutable after revocation", async () => {
    const f = await fixture();
    await prisma.policyVersion.update({ where: { id: f.m.id }, data: { status: "REVOKED" } });
    await expect(prisma.policyVersion.update({ where: { id: f.m.id }, data: { content: market(true) } })).rejects.toBeDefined();
  });
  it("keeps missing reviewed English, deleted evidence and changed party jurisdiction unavailable", async () => {
    const f = await fixture();
    const run = (language: "ar" | "en" = "ar") => prisma.$transaction(tx => reviewedDealPolicies(tx, f.brandUserId, f.campaignId, f.creatorId, f.terms, "CONFIRM", language,
      { ...f.context, agreement: { ...f.context.agreement!, language } }));
    await expect(run("en")).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE" });
    await prisma.privateAsset.update({ where: { id: f.g.evidenceId }, data: { deletedAt: new Date() } });
    await expect(run()).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE" });
    await prisma.privateAsset.update({ where: { id: f.g.evidenceId }, data: { deletedAt: null } });
    await prisma.creator.update({ where: { id: f.creatorId }, data: { countryCode: "EG" } });
    await expect(run()).rejects.toMatchObject({ status: 409 });
  });
});
