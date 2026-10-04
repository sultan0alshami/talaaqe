import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { campaignFields } from "../campaigns/fixtures";
import { resolveCampaignPolicyReview } from "@/lib/policies";
import { CampaignRequirementsSchema } from "@/lib/campaigns/contracts";
import { cleanupReviewedEvidence, reviewedOwnershipFixture } from "../helpers/reviewed-evidence";
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession }));
import { GET as read, POST as run } from "@/app/api/campaigns/[id]/matches/route";
import { POST as decide } from "@/app/api/campaigns/[id]/matches/decisions/route";

// Mock only the session issuer; domain ownership, privacy, journal and decisions
// execute on guarded PostgreSQL. Synthetic reviewed context is not legal evidence.
const users: string[] = [], campaigns: string[] = [], creators: string[] = [], policies: string[] = [], assets: string[] = [];
const origin = "http://localhost:3100", now = new Date();
const context = (id: string) => ({ params: Promise.resolve({ id }) });
function request(id: string, body?: unknown, subpath = "", requestOrigin = origin) {
  return new Request(`${origin}/api/campaigns/${id}/matches${subpath}`, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? {} : { origin: requestOrigin, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function actor(role: "BRAND" | "CREATOR" | "ADMIN" = "BRAND") {
  const id = randomUUID(); users.push(id);
  await prisma.user.create({ data: { id, role, name: "Synthetic matching transport", email: `${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: now, isTest: false } });
  getSession.mockResolvedValue({ userId: id, role });
  return id;
}
async function fixture(reviewed = true) {
  const owner = await actor(), id = randomUUID(); campaigns.push(id);
  const brand = await prisma.brand.create({ data: { userId: owner, slug: `synthetic-api-${id.slice(0,8)}`, name: "Synthetic transport brand", countryCode: "KW" } });
  const requirements = CampaignRequirementsSchema.parse({ ...campaignFields, campaignId: id, version: 1, brandCountryCode: "KW", mandatoryPolicyVersionIds: [] });
  let policyReview = null;
  let evidenceAssetId: string | null = null;
  if (reviewed) {
    const reviewer = await actor("ADMIN"), policyId = randomUUID(); policies.push(policyId);
    const evidence = await prisma.privateAsset.create({ data: { ownerUserId: reviewer, purpose: "LEGAL_POLICY_REVIEW", contentType: "text/plain", size: 1, storageKey: `synthetic:${policyId}`, checksum: "synthetic-no-live-legal-evidence" } });
    assets.push(evidence.id); evidenceAssetId = evidence.id;
    await prisma.policyVersion.create({ data: { id: policyId, kind: "MARKET", countryCodes: ["KW"], status: "VERIFIED", evidenceAssetId: evidence.id, reviewedBy: reviewer, reviewedAt: now, createdAt: new Date(now.getTime() - 60000), expiresAt: new Date(campaignFields.period.endsAt), content: { schemaVersion: 1, kind: "MARKET", marketCountryCode: "KW", brandCountryCodes: ["KW"], creatorCountryCodes: ["GB"], licenceRequired: false, licencePolicyId: null, reviewReference: "Synthetic test-only policy reference", reviewedBasis: "FOUNDER_APPROVED_LEGAL_REVIEW" } } });
    policyReview = await prisma.$transaction((tx) => resolveCampaignPolicyReview(tx, requirements));
    expect(policyReview).not.toBeNull(); requirements.mandatoryPolicyVersionIds = policyReview!.mandatoryPolicyVersionIds;
  }
  await prisma.campaign.create({ data: { id, brandId: brand.id, title: requirements.title, status: "BRIEF_APPROVED", currentBriefVersion: 1, input: { schemaVersion: 1, fieldsRevision: 1, fields: campaignFields, proposals: [], clarificationCount: 0 } } });
  await prisma.campaignBrief.create({ data: { campaignId: id, version: 1, inputRevision: 1, approvedAt: now, approvedByUserId: owner, content: { schemaVersion: 1, requirements, inputRevision: 1, approvedByUserId: owner, policyReview } } });
  getSession.mockResolvedValue({ userId: owner, role: "BRAND" });
  return { id, owner, evidenceAssetId, command: { operationKey: randomUUID(), expectedBriefVersion: 1, expectedCampaignRevision: 1 } };
}
async function candidate() {
  const userId = await actor("CREATOR"), reviewerId = await actor("ADMIN"), id = randomUUID(), handle = `synthetic_${id.replaceAll("-", "").slice(0,18)}`; creators.push(id);
  // isTest=false intentionally exercises production eligibility only inside the
  // exact guarded task database; name/source remain explicitly synthetic.
  await prisma.creator.create({ data: { id, userId, displayName: "Synthetic permitted API creator", handle, countryCode: "GB", timeZone: "Asia/Kuwait", languages: ["ar"], dialects: ["ar-Gulf"], state: "PUBLISHED", isTest: false, brandVisible: true, publicConsentAt: now, availability: { status: "AVAILABLE", ...campaignFields.period, confirmedAt: now.toISOString() }, profileFacts: { ratesVisibility: "BRAND_ONLY", nicheSlugs: { value: ["beauty"], source: "SELF_REPORTED", evidenceAt: now.toISOString(), approvedAt: now.toISOString(), brandVisible: true, publicVisible: false } } } });
  const account = await prisma.socialAccount.create({ data: { creatorId: id, platform: "INSTAGRAM", handle, intendedConfirmedAt: now, consentAt: now, factsApprovedAt: now, brandVisible: true, supportedFormats: ["STORY"] } });
  await reviewedOwnershipFixture(prisma, userId, reviewerId, account.id, "test", now);
  await prisma.socialAccount.update({ where: { id: account.id }, data: { brandVisible: true } });
  await prisma.creator.update({ where: { id }, data: { primaryAccountId: account.id } });
  const dimension = (key: string) => ({ value: [{ key, percent: 100 }], visibility: "BRAND_ONLY" });
  const window = { startsAt: new Date(now.getTime() - 30 * 86400000).toISOString(), endsAt: now.toISOString(), timeZone: "Asia/Kuwait" };
  await prisma.metricsSnapshot.create({ data: { accountId: account.id, source: "SELF_REPORTED", observedAt: now, approvedAt: now, approvedBy: "synthetic-review", reviewStatus: "VERIFIED", mappingRevision: 1, followers: BigInt(10000), engagementRate: "3.2", engagementContext: { unit: "PERCENT", window, definition: "Synthetic engagements/followers", visibility: "BRAND_ONLY" }, demographics: { age: dimension("18-24"), gender: dimension("FEMALE"), countries: dimension("KW") }, formatMetrics: [{ format: "STORY", value: 5000, unit: "IMPRESSIONS", window, definition: "Synthetic story mean", visibility: "BRAND_ONLY" }] } });
  await prisma.creatorRate.create({ data: { creatorId: id, platform: "INSTAGRAM", format: "STORY", currency: "KWD", amountMinor: BigInt(10000) } });
  return { id, accountId: account.id };
}
afterEach(async () => {
  await prisma.campaign.deleteMany({ where: { id: { in: campaigns.splice(0) } } });
  await prisma.creator.deleteMany({ where: { id: { in: creators.splice(0) } } });
  await prisma.policyVersion.deleteMany({ where: { id: { in: policies.splice(0) } } });
  await cleanupReviewedEvidence(prisma, users, "test");
  await prisma.privateAsset.deleteMany({ where: { id: { in: assets.splice(0) } } });
  await prisma.user.deleteMany({ where: { id: { in: users.splice(0) } } });
});

describe("matching transport with mocked session issuer and real PostgreSQL", () => {
  it("has private envelopes, read-only empty GET and active brand ownership enforcement", async () => {
    const f = await fixture();
    const empty = await read(request(f.id), context(f.id));
    expect(empty.status).toBe(200); expect(empty.headers.get("cache-control")).toBe("private, no-store");
    const envelope = await empty.json(); expect(envelope.data).toBeNull(); expect(envelope.requestId).toBe(empty.headers.get("x-request-id"));
    expect(await prisma.matchRun.count({ where: { campaignId: f.id } })).toBe(0);
    await actor(); expect((await read(request(f.id), context(f.id))).status).toBe(404);
    await actor("CREATOR"); expect((await read(request(f.id), context(f.id))).status).toBe(403);
    getSession.mockResolvedValue(null); expect((await read(request(f.id), context(f.id))).status).toBe(401);
    getSession.mockResolvedValue({ userId: f.owner, role: "BRAND" });
    await prisma.user.update({ where: { id: f.owner }, data: { active: false } });
    expect((await run(request(f.id, f.command), context(f.id))).status).toBe(403);
  });
  it("requires same Origin, bounded strict commands and trusted server policy", async () => {
    const f = await fixture(false);
    expect((await run(request(f.id, f.command, "", "https://unrelated.invalid"), context(f.id))).status).toBe(403);
    for (const extra of [{ actorUserId: f.owner }, { policyReview: { reviewed: true } }, { policyReader: "FORGED" }, { now: now.toISOString() }]) {
      expect((await run(request(f.id, { ...f.command, ...extra }), context(f.id))).status).toBe(400);
    }
    const policy = await run(request(f.id, f.command), context(f.id)); expect(policy.status).toBe(409); expect((await policy.json()).error.code).toBe("POLICY_REVIEW_REQUIRED");
    expect((await run(request(f.id, { ...f.command, extra: "x".repeat(66000) }), context(f.id))).status).toBe(413);
    expect(await prisma.matchRun.count({ where: { campaignId: f.id } })).toBe(0);
  });
  it("persists exact empty results without padding and replays the same immutable command", async () => {
    const f = await fixture();
    const result = (await (await run(request(f.id, f.command), context(f.id))).json()).data;
    expect(result.results).toEqual([]); expect(result.allocationBasis).toBe("FIRST_SLOT_COMPARISON");
    const replay = (await (await run(request(f.id, f.command), context(f.id))).json()).data;
    expect(replay.runId).toBe(result.runId); expect(replay.replayed).toBe(true);
    expect(await prisma.matchRun.count({ where: { campaignId: f.id } })).toBe(1);
    const invalid = await run(request(f.id, { ...f.command, operationKey: randomUUID(), expectedCampaignRevision: 999 }), context(f.id));
    expect(invalid.status).toBe(409); expect((await invalid.json()).error.code).toBe("STALE_VERSION");
  });
  it("saves explicit decisions, rejects stale or forged decisions and immediately removes revoked identity/evidence", async () => {
    const f = await fixture(), c = await candidate(); getSession.mockResolvedValue({ userId: f.owner, role: "BRAND" });
    const response = await run(request(f.id, f.command), context(f.id)); expect(response.status).toBe(200);
    const result = (await response.json()).data; expect(result.results.map((row: { creatorId: string }) => row.creatorId)).toEqual([c.id]);
    expect(result.results[0].creator.displayName).toBe("Synthetic permitted API creator");
    const command = { operationKey: randomUUID(), expectedBriefVersion: 1, runId: result.runId, creatorId: c.id, expectedDecisionRevision: 0, decision: "SAVED" };
    expect((await decide(request(f.id, command, "/decisions"), context(f.id))).status).toBe(200);
    expect((await (await decide(request(f.id, command, "/decisions"), context(f.id))).json()).data.replayed).toBe(true);
    expect((await decide(request(f.id, { ...command, operationKey: randomUUID(), decision: "DISMISSED" }, "/decisions"), context(f.id))).status).toBe(409);
    expect((await decide(request(f.id, { ...command, operationKey: randomUUID(), decision: "OFFER_SENT" }, "/decisions"), context(f.id))).status).toBe(400);
    await prisma.socialAccount.update({ where: { id: c.accountId }, data: { brandVisible: false } });
    const current = (await (await read(request(f.id), context(f.id))).json()).data;
    expect(current.results).toEqual([]); expect(current.stale).toBe(true);
    const replay = (await (await run(request(f.id, f.command), context(f.id))).json()).data;
    expect(replay.results).toEqual([]);
  });
  it("rechecks current policy review evidence even with no candidates and fails closed after revocation", async () => {
    const f = await fixture();
    const result = await run(request(f.id, f.command), context(f.id)); expect(result.status).toBe(200);
    await prisma.privateAsset.update({ where: { id: f.evidenceAssetId! }, data: { deletedAt: new Date() } });
    const unavailable = await read(request(f.id), context(f.id)); expect(unavailable.status).toBe(503);
    expect((await unavailable.json()).error.code).toBe("POLICY_UNAVAILABLE");
    expect(await prisma.matchRun.count({ where: { campaignId: f.id } })).toBe(1);
  });
});
