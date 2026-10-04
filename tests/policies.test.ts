import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { campaignFields } from "./campaigns/fixtures";
import type { CampaignRequirementsDTO } from "@/lib/campaigns/contracts";
import { resolveCampaignPolicyReview, reviewedMatchingPolicies } from "@/lib/policies";
import { cleanupReviewedEvidence, reviewedLicenceFixture, uploadSyntheticEvidence } from "./helpers/reviewed-evidence";

const users: string[] = [], policies: string[] = [], assets: string[] = [];
const now = new Date("2026-10-04T08:00:00.000Z"), createdAt = new Date("2026-10-01T08:00:00.000Z"), reviewedAt = new Date("2026-10-02T08:00:00.000Z");
function requirements(overrides: Partial<CampaignRequirementsDTO> = {}): CampaignRequirementsDTO {
  return { ...campaignFields, campaignId: "synthetic-policy-test", version: 1, brandCountryCode: "KW", mandatoryPolicyVersionIds: [], ...overrides } as CampaignRequirementsDTO;
}
async function fixture(required = false) {
  const adminId = randomUUID(); users.push(adminId);
  await prisma.user.create({ data: { id: adminId, role: "ADMIN", active: true, isTest: true, email: `${adminId}@example.invalid`, passwordHash: "test-only-no-login", name: "Synthetic policy reviewer" } });
  const evidence = await uploadSyntheticEvidence(prisma, adminId, "LEGAL_POLICY_REVIEW", "test", reviewedAt);
  const policyId = `synthetic-market-${randomUUID()}`; policies.push(policyId);
  await prisma.policyVersion.create({ data: { id: policyId, kind: "MARKET", countryCodes: ["KW"], createdAt, status: "VERIFIED", reviewedAt, reviewedBy: adminId, evidenceAssetId: evidence.id,
    content: { schemaVersion: 1, kind: "MARKET", marketCountryCode: "KW", brandCountryCodes: ["KW"], creatorCountryCodes: ["KW"], licenceRequired: required, licencePolicyId: required ? "synthetic-licence-v1" : null,
      reviewedBasis: "FOUNDER_APPROVED_LEGAL_REVIEW", reviewReference: "Synthetic database fixture; never real legal review" } } });
  return { adminId, policyId, evidenceId: evidence.id, r: requirements({ mandatoryPolicyVersionIds: [policyId] }) };
}
afterEach(async () => {
  await prisma.policyVersion.deleteMany({ where: { id: { in: policies } } });
  await prisma.privateAsset.deleteMany({ where: { id: { in: assets } } });
  await prisma.creator.deleteMany({ where: { userId: { in: users } } });
  await cleanupReviewedEvidence(prisma, users, "test");
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  users.length = 0; policies.length = 0; assets.length = 0;
});
describe("reviewed market policy registry on guarded PostgreSQL", () => {
  it("does not invent policy for an unsupported market or absent registry", async () => {
    expect(await prisma.$transaction((tx) => resolveCampaignPolicyReview(tx, requirements({ marketCountryCodes: ["AE"] }), now))).toBeNull();
    await expect(prisma.$transaction((tx) => reviewedMatchingPolicies(tx, requirements({ marketCountryCodes: ["AE"], mandatoryPolicyVersionIds: ["absent-reviewed-policy"] }), []))).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE", status: 503 });
  });
  it("requires exact market/brand scope, active reviewer and available private review evidence", async () => {
    const f = await fixture();
    expect((await prisma.$transaction((tx) => resolveCampaignPolicyReview(tx, f.r, now)))?.mandatoryPolicyVersionIds).toContain(f.policyId);
    expect(await prisma.$transaction((tx) => resolveCampaignPolicyReview(tx, { ...f.r, brandCountryCode: "EG" }, now))).toBeNull();
    expect(await prisma.$transaction((tx) => resolveCampaignPolicyReview(tx, { ...f.r, marketCountryCodes: ["KW", "AE"] }, now))).toBeNull();
    await prisma.privateAsset.update({ where: { id: f.evidenceId }, data: { deletedAt: now } });
    expect(await prisma.$transaction((tx) => resolveCampaignPolicyReview(tx, f.r, now))).toBeNull();
    await prisma.privateAsset.update({ where: { id: f.evidenceId }, data: { deletedAt: null } });
    await prisma.user.update({ where: { id: f.adminId }, data: { active: false } });
    expect(await prisma.$transaction((tx) => resolveCampaignPolicyReview(tx, f.r, now))).toBeNull();
  });
  it("keeps creator residence outside reviewed coverage unknown and enforces each licence's scope/evidence/expiry", async () => {
    const f = await fixture(true), userId = randomUUID(); users.push(userId);
    await prisma.user.create({ data: { id: userId, role: "CREATOR", active: true, isTest: true, email: `${userId}@example.invalid`, passwordHash: "test-only-no-login", name: "Synthetic policy creator" } });
    const creator = await prisma.creator.create({ data: { userId, handle: `policy_${userId.slice(0, 8)}`, displayName: "Synthetic policy creator", countryCode: "EG" } });
    const account = await prisma.socialAccount.create({ data: { creatorId: creator.id, platform: "INSTAGRAM", handle: `policy_${userId.slice(0, 8)}`, intendedConfirmedAt: reviewedAt, consentAt: reviewedAt, brandVisible: true } });
    const load = () => prisma.$transaction((tx) => reviewedMatchingPolicies(tx, f.r, [creator.id]));
    expect((await load()).outcomes[creator.id][0].status).toBe("UNKNOWN");
    await prisma.creator.update({ where: { id: creator.id }, data: { countryCode: "KW" } });
    expect((await load()).outcomes[creator.id][0].status).toBe("FAIL");
    const reviewed = await reviewedLicenceFixture({ client: prisma, owner: userId, reviewer: f.adminId, creatorId: creator.id, accountIds: [account.id], marketVersionId: f.policyId, jurisdiction: "KW", target: "test", now: reviewedAt, expiresAt: new Date("2026-12-01T00:00:00.000Z") });
    const licence = { id: reviewed.licenceId };
    expect((await load()).outcomes[creator.id][0].status).toBe("PASS");
    await prisma.advertisingLicence.update({ where: { id: licence.id }, data: { accountIds: [] } });
    expect((await load()).outcomes[creator.id][0].status).toBe("FAIL");
    await prisma.advertisingLicence.update({ where: { id: licence.id }, data: { accountIds: [account.id], expiresAt: new Date("2026-11-02T00:00:00.000Z") } });
    expect((await load()).outcomes[creator.id][0].status).toBe("FAIL");
  });
  it("rejects current policy revocation and any attempt to mutate a verified policy's reviewed content", async () => {
    const f = await fixture();
    await expect(prisma.policyVersion.update({ where: { id: f.policyId }, data: { content: { fake: true } } })).rejects.toThrow();
    await prisma.policyVersion.update({ where: { id: f.policyId }, data: { status: "REVOKED" } });
    expect(await prisma.$transaction((tx) => resolveCampaignPolicyReview(tx, f.r, now))).toBeNull();
  });
});
