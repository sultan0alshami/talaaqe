import { randomUUID } from "node:crypto";
import { Prisma, type MetricsSnapshot } from "@prisma/client";
import { afterEach, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { CampaignRequirementsSchema } from "@/lib/campaigns/contracts";
import { loadEligibleCreator } from "@/lib/matching/persistence";
import { acceptedOwnershipProof, uploadPrivateAsset, createOwnershipChallenge, submitOwnershipProof, reviewOwnershipProof,
  submitMetricsScreenshot, reviewMetricsScreenshot, approveMetricsSnapshot } from "@/lib/evidence/service";
import { cleanup, fixture, now, png, user } from "./fixtures";

afterEach(cleanup);
const note = { text: "مراجعة لقطة مصطنعة للاختبار فقط", language: "ar" };
const key = () => randomUUID();
const period = { startsAt: "2026-10-10T00:00:00.000Z", endsAt: "2026-10-20T00:00:00.000Z", timeZone: "Asia/Riyadh" };
async function setup(metrics: Record<string, unknown> = { followers: "10000" }) {
  const f = await fixture(), screenshotAdmin = await user("ADMIN");
  const upload = async (purpose: string) => (await uploadPrivateAsset(f.owner, { operationKey: key(), purpose, contentType: "image/png", bytes: png }, f.options)).asset;
  const ownershipAsset = await upload("OWNERSHIP_PROOF");
  const challenge = (await createOwnershipChallenge(f.owner, { operationKey: key(), accountId: f.account.id, expectedMappingRevision: 1, expectedEvidenceRevision: 1 }, f.options)).challenge;
  await submitOwnershipProof(f.owner, challenge.id, { operationKey: key(), expectedRevision: 1, assetId: ownershipAsset.id }, f.options);
  await reviewOwnershipProof(f.admin, challenge.id, { operationKey: key(), expectedRevision: 2, decision: "VERIFIED", observedChallengeCode: challenge.challengeCode, note }, f.options);
  const screenshot = await upload("SCREENSHOT"), before = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
  const parent = (await submitMetricsScreenshot(f.owner, { operationKey: key(), accountId: f.account.id, expectedMappingRevision: 1,
    expectedEvidenceRevision: before.evidenceRevision, evidenceAssetId: screenshot.id, observedAt: now.toISOString(), ...metrics }, f.options)).snapshot;
  const revision = (await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } })).evidenceRevision;
  const child = (await reviewMetricsScreenshot(screenshotAdmin, parent.id, { operationKey: key(), expectedEvidenceRevision: revision, decision: "VERIFIED", note }, f.options)).snapshot;
  await approveMetricsSnapshot(f.owner, child.id, { operationKey: key(), expectedMappingRevision: 1, expectedEvidenceRevision: revision + 1, visibility: { followers: "BRAND_ONLY" } }, f.options);
  await prisma.user.update({ where: { id: f.owner }, data: { isTest: false, emailVerifiedAt: now } });
  await prisma.creator.update({ where: { id: f.creator.id }, data: { isTest: false, state: "PUBLISHED", brandVisible: true, publicConsentAt: now,
    primaryAccountId: f.account.id, timeZone: period.timeZone, languages: ["ar"], availability: { status: "AVAILABLE", ...period, confirmedAt: now.toISOString() }, profileFacts: { ratesVisibility: "BRAND_ONLY" } } });
  await prisma.socialAccount.update({ where: { id: f.account.id }, data: { brandVisible: true, supportedFormats: ["REEL"] } });
  await prisma.creatorRate.create({ data: { creatorId: f.creator.id, platform: "INSTAGRAM", format: "REEL", currency: "SAR", amountMinor: BigInt(10000) } });
  const requirements = CampaignRequirementsSchema.parse({ campaignId: key(), version: 1, originalLanguage: "ar", title: "اختبار مصدر لقطة",
    productService: "Synthetic screenshot test", goal: "AWARENESS", summary: "Synthetic confidence boundary", brandCountryCode: "KW", marketCountryCodes: ["KW"],
    targetAgeBuckets: [], targetGenders: [], targetCountryCodes: [], targetCityKeys: [], contentLanguages: ["ar"], dialects: [], nicheSlugs: [],
    deliverables: [{ platform: "INSTAGRAM", format: "REEL", count: 1 }], budget: { amountMinor: "10000", currencyCode: "SAR" }, desiredCreatorCount: 1,
    impressionsTarget: null, period, physicalPresenceRequired: false, presenceCountryCodes: [], travelAllowed: false, tone: "Synthetic",
    noGoTopics: [], preferredTiers: [], dataVerificationRequired: true, preferredLicencePolicyIds: [], mandatoryPolicyVersionIds: [], usageRights: "Synthetic",
    kpis: [], assumptions: [], openQuestions: [] });
  const load = () => prisma.$transaction(tx => loadEligibleCreator(tx, requirements, f.creator.id, now));
  const ownership = async () => {
    const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    return prisma.$transaction(tx => acceptedOwnershipProof(tx, account, f.owner, now));
  };
  return { ...f, screenshotAdmin, screenshot, parent, child, load, ownership };
}
function observation(row: MetricsSnapshot) {
  return { accountId: row.accountId, mappingRevision: row.mappingRevision, observedAt: row.observedAt, importedAt: row.importedAt,
    followers: row.followers, averageViews: row.averageViews, engagementRate: row.engagementRate,
    demographics: row.demographics === null ? Prisma.DbNull : row.demographics,
    formatMetrics: row.formatMetrics === null ? Prisma.DbNull : row.formatMetrics,
    engagementContext: row.engagementContext === null ? Prisma.DbNull : row.engagementContext, evidenceAssetId: row.evidenceAssetId };
}

it("accepts actual reviewed screenshot confidence with independent current ownership and screenshot reviewers", async () => {
  const window = { startsAt: "2026-10-01T00:00:00.000Z", endsAt: now.toISOString(), timeZone: "Asia/Riyadh" };
  const f = await setup({ followers: "10000", averageViews: "1234", engagementRate: "2.50000000",
    engagementContext: { unit: "PERCENT", window, definition: "Synthetic definition" },
    demographics: { age: { value: [{ key: "25-34", percent: 40 }], visibility: "BRAND_ONLY" }, gender: null },
    formatMetrics: [{ format: "REEL", value: 1234, unit: "VIEWS", window, definition: "Synthetic average" }] });
  expect(f.admin).not.toBe(f.screenshotAdmin);
  expect(await f.ownership()).toBe(true);
  expect((await f.load())?.accounts[0]?.evidence?.source).toBe("SCREENSHOT_VERIFIED");
});

it.each(["deleted-asset", "suspended-reviewer", "changed-reviewer-role"] as const)("withdraws verified-data eligibility for %s while ownership remains accepted", async reason => {
  const f = await setup();
  expect((await f.load())?.id).toBe(f.creator.id);
  if (reason === "deleted-asset") await prisma.privateAsset.update({ where: { id: f.screenshot.id }, data: { deletedAt: now } });
  else await prisma.user.update({ where: { id: f.screenshotAdmin }, data: reason === "suspended-reviewer" ? { active: false } : { role: "CREATOR" } });
  expect(await f.ownership()).toBe(true);
  expect(await f.load()).toBeNull();
});

it("rejects a raw SCREENSHOT_VERIFIED child carrying flags and a genuine asset without submission/review journals", async () => {
  const f = await setup(), child = await prisma.metricsSnapshot.findUniqueOrThrow({ where: { id: f.child.id } });
  await prisma.metricsSnapshot.update({ where: { id: child.id }, data: { excludedAt: now } });
  await prisma.metricsSnapshot.create({ data: { id: "zz-raw-" + key(), ...observation(child), supersedesId: f.parent.id, source: "SCREENSHOT_VERIFIED",
    reviewStatus: "VERIFIED", approvedAt: now, approvedBy: f.screenshotAdmin } });
  expect(await f.ownership()).toBe(true);
  expect(await f.load()).toBeNull();
});

it.each(["child-observation", "parent-id"] as const)("rejects substituted %s despite copied private receipt metadata", async substitution => {
  const f = await setup(), child = await prisma.metricsSnapshot.findUniqueOrThrow({ where: { id: f.child.id } });
  await prisma.metricsSnapshot.update({ where: { id: child.id }, data: { excludedAt: now } });
  let parentId = f.parent.id;
  if (substitution === "parent-id") {
    const parent = await prisma.metricsSnapshot.findUniqueOrThrow({ where: { id: f.parent.id } });
    parentId = "zz-parent-" + key();
    await prisma.metricsSnapshot.create({ data: { id: parentId, ...observation(parent), source: "SELF_REPORTED", reviewStatus: "VERIFIED", excludedAt: now } });
    const submission = await prisma.evidenceCommand.findFirstOrThrow({ where: { actorUserId: f.owner, resourceType: "MetricsSnapshot", resourceId: parent.id } });
    await prisma.evidenceCommand.update({ where: { id: submission.id }, data: { resourceId: parentId, resultJson: { ...(submission.resultJson as Prisma.JsonObject), resourceId: parentId } } });
  }
  const substituted = await prisma.metricsSnapshot.create({ data: { id: "zz-child-" + key(), ...observation(child),
    ...(substitution === "child-observation" ? { followers: BigInt(99999) } : {}), supersedesId: parentId, source: "SCREENSHOT_VERIFIED", reviewStatus: "VERIFIED", approvedAt: now, approvedBy: f.screenshotAdmin } });
  const review = await prisma.evidenceCommand.findFirstOrThrow({ where: { actorUserId: f.screenshotAdmin, resourceType: "MetricsSnapshot", resourceId: child.id } });
  await prisma.evidenceCommand.update({ where: { id: review.id }, data: { resourceId: substituted.id,
    resultJson: { ...(review.resultJson as Prisma.JsonObject), resourceId: substituted.id, parentId } } });
  expect(await f.ownership()).toBe(true);
  expect(await f.load()).toBeNull();
});
