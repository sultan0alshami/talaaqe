import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterEach, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { decideCampaignMatch, getCampaignMatches, runCampaignMatching } from "@/lib/matching/persistence";

// Disposable PostgreSQL fixtures only; no providers or live acceptance claim.
const users: string[] = [], campaigns: string[] = [];
const now = new Date("2026-10-04T08:00:00.000Z");
afterEach(async () => {
  await prisma.campaign.deleteMany({ where: { id: { in: campaigns.splice(0) } } });
  await prisma.user.deleteMany({ where: { id: { in: users.splice(0) } } });
});
function latch() {
  let release!: () => void;
  return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
}
async function fixture() {
  const owner = randomUUID(), replacement = randomUUID(), campaignId = randomUUID();
  users.push(owner, replacement); campaigns.push(campaignId);
  await prisma.user.createMany({ data: [owner, replacement].map(id => ({ id, name: "Synthetic matching ownership wait", email: `${id}@example.invalid`, passwordHash: "not-a-login", role: "BRAND" as const, emailVerifiedAt: now, isTest: true })) });
  const brand = await prisma.brand.create({ data: { userId: owner, slug: `brand-${owner}`, name: "Private synthetic matching company", countryCode: "GB" } });
  const requirements = { campaignId, version: 1, originalLanguage: "ar", title: "Private synthetic matching campaign", productService: "Synthetic product", goal: "AWARENESS", summary: "Synthetic requirements", brandCountryCode: "GB", marketCountryCodes: ["SA"], targetAgeBuckets: ["18-24"], targetGenders: ["FEMALE"], targetCountryCodes: ["SA"], targetCityKeys: ["SA:riyadh"], contentLanguages: ["ar"], dialects: ["ar-Gulf"], nicheSlugs: ["beauty"], deliverables: [{ platform: "INSTAGRAM", format: "REEL", count: 1 }], budget: { amountMinor: "10000", currencyCode: "SAR" }, desiredCreatorCount: 1, impressionsTarget: 10000, period: { startsAt: "2026-10-10T00:00:00.000Z", endsAt: "2026-10-20T00:00:00.000Z", timeZone: "Asia/Riyadh" }, physicalPresenceRequired: false, presenceCountryCodes: [], travelAllowed: false, tone: "Synthetic", noGoTopics: [], preferredTiers: [], dataVerificationRequired: false, preferredLicencePolicyIds: [], mandatoryPolicyVersionIds: [], usageRights: "Synthetic no publication", kpis: [], assumptions: [], openQuestions: [] };
  await prisma.campaign.create({ data: { id: campaignId, brandId: brand.id, title: requirements.title, input: { schemaVersion: 1, fieldsRevision: 1, fields: {}, proposals: [], clarificationCount: 0 }, status: "BRIEF_APPROVED", currentBriefVersion: 1 } });
  await prisma.campaignBrief.create({ data: { campaignId, version: 1, inputRevision: 1, approvedAt: now, approvedByUserId: owner, content: { schemaVersion: 1, requirements, approvedByUserId: owner, inputRevision: 1, policyReview: { reviewed: true, resolverVersion: "synthetic-no-mandatory-rules", reviewedAt: now.toISOString(), marketCountryCodes: ["SA"], mandatoryPolicyVersionIds: [] } } } });
  const command = { operationKey: randomUUID(), expectedBriefVersion: 1, expectedCampaignRevision: 1 };
  const run = await runCampaignMatching(owner, campaignId, command, { now });
  expect(run.results).toEqual([]);
  return { owner, replacement, brand, campaignId, command, run };
}
it.each(["GET", "RUN", "DECIDE"] as const)("withdraws former-owner %s access after waiting for a concurrent brand reassignment", async action => {
  const f = await fixture(), held = latch(), release = latch(), readOwner = latch();
  let ownerReads = 0;
  const client = prisma.$extends({ query: { brand: { async findUnique({ args, query }) {
    const row = await query(args);
    // First lookup discovers evidence actors; second is the authorization read
    // immediately before the blocked Brand lock, still observing the old owner.
    if (args.where.userId === f.owner && ++ownerReads === 2) readOwner.release();
    return row;
  } } } }) as unknown as PrismaClient;
  const holding = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Brand" WHERE id=${f.brand.id} FOR UPDATE`;
    held.release(); await release.promise;
    await tx.brand.update({ where: { id: f.brand.id }, data: { userId: f.replacement } });
  });
  try {
    await held.promise;
    const request = action === "GET" ? getCampaignMatches(f.owner, f.campaignId, f.run.runId, { now, client })
      : action === "RUN" ? runCampaignMatching(f.owner, f.campaignId, { ...f.command, operationKey: randomUUID() }, { now, client })
      : decideCampaignMatch(f.owner, f.campaignId, { operationKey: randomUUID(), expectedBriefVersion: 1, runId: f.run.runId, creatorId: randomUUID(), expectedDecisionRevision: 0, decision: "SAVED" }, { now, client });
    const operation = request.then(value => ({ value, code: "EXPOSED" }), (error: unknown) => error);
    await readOwner.promise;
    release.release(); await holding;
    expect(await operation).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(await prisma.matchRun.count({ where: { campaignId: f.campaignId } })).toBe(1);
    expect(await prisma.matchDecisionRecord.count({ where: { campaignId: f.campaignId } })).toBe(0);
  } finally { release.release(); await holding; }
});
