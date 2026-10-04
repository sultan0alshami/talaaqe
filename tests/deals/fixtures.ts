import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { createCampaign, generateCampaignBrief, approveCampaignBrief } from "@/lib/campaigns/service";
import { campaignFields } from "../campaigns/fixtures";
import type { DealPolicyVerifier } from "@/lib/deals/contracts";

export const users: string[] = [];
export const now = new Date("2026-10-05T12:00:00.000Z");
export const syntheticPolicy: DealPolicyVerifier = async (_tx, _actor, _campaign, _creator, terms) => ({
  governingTerms: { id: terms?.governingTermsVersionId ?? "fixture-reviewed-terms-v1", language: "ar", content: "شروط اختبار مصطنعة وليست شروطاً قانونية حية" },
  marketPolicyVersions: [{ id: "synthetic-market-v1", jurisdiction: "KW" }], licenceSnapshots: [], policyVersion: "synthetic-test-only-v1",
});
export async function user(role: "BRAND" | "CREATOR" | "ADMIN") {
  const id = randomUUID(); users.push(id);
  await prisma.user.create({ data: { id, name: "Synthetic deals actor", email: `${id}@example.invalid`, passwordHash: "not-a-login", role,
    isTest: false, emailVerifiedAt: new Date(now.getTime() - 1000) } });
  return id;
}
export async function creator() {
  const userId = await user("CREATOR"), reviewerId = await user("ADMIN"), past = new Date(now.getTime() - 1000);
  const row = await prisma.creator.create({ data: { userId, handle: `deal_${userId.slice(0, 8)}`, displayName: "منشئ اختبار مصطنع",
    countryCode: "KW", timeZone: "Asia/Kuwait", languages: ["ar"], dialects: ["ar-Gulf"], state: "PUBLISHED", brandVisible: true,
    isTest: false, publicConsentAt: past, publishedAt: past,
    availability: { status: "AVAILABLE", startsAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-12-01T00:00:00.000Z", confirmedAt: past.toISOString() },
  } });
  const handle = `fixture_${userId.slice(0, 8)}`, providerAccountId = `synthetic-provider-${userId}`;
  const account = await prisma.socialAccount.create({ data: { creatorId: row.id, platform: "INSTAGRAM", handle, providerAccountId,
    ownershipStatus: "VERIFIED", ownershipReviewedBy: reviewerId, ownershipReviewedAt: past,
    ownershipIdentityHash: canonicalHash({ platform: "INSTAGRAM", providerAccountId, normalizedHandle: handle, confirmedOrigin: null }),
    intendedConfirmedAt: past, consentAt: past, brandVisible: true, factsApprovedAt: past, supportedFormats: ["STORY", "POST"],
  } });
  await prisma.creator.update({ where: { id: row.id }, data: { primaryAccountId: account.id } });
  await prisma.metricsSnapshot.create({ data: { accountId: account.id, mappingRevision: 1, source: "PUBLIC_IMPORT", providerObservationId: "synthetic-test-only",
    observedAt: past, reviewStatus: "VERIFIED", approvedAt: past, approvedBy: reviewerId, followers: BigInt(1000) } });
  return { id: row.id, userId, accountId: account.id, reviewerId };
}
export async function fixture(count = 2, budget = "10001") {
  const brandUserId = await user("BRAND");
  const brand = await prisma.brand.create({ data: { userId: brandUserId, slug: `deal-brand-${brandUserId.slice(0, 8)}`, name: "شركة اختبار أصلية", countryCode: "KW", isTest: false } });
  const created = (await createCampaign(brandUserId, { operationKey: randomUUID(), fields: { ...campaignFields, budget: { amountMinor: budget, currencyCode: "KWD" }, desiredCreatorCount: count } })).campaign;
  const generated = await generateCampaignBrief(brandUserId, created.id, { operationKey: randomUUID(), expectedRevision: created.revision });
  const approved = await approveCampaignBrief(brandUserId, created.id, { operationKey: randomUUID(), expectedRevision: generated.campaign.revision,
    briefId: generated.brief.id, expectedBriefVersion: generated.brief.version });
  const target = await creator();
  const terms = { deliverables: [{ platform: "INSTAGRAM" as const, format: "STORY" as const, count: 2 }], amount: { amountMinor: "5000", currencyCode: "KWD" },
    period: campaignFields.period, usageRights: "للحملة فقط", note: { text: "عرض أصلي واحد", language: "ar" }, governingTermsVersionId: "fixture-reviewed-terms-v1", licencePolicyVersionIds: [] };
  return { brandUserId, brandId: brand.id, target, campaign: approved.campaign, terms,
    input: { operationKey: randomUUID(), campaignId: created.id, creatorId: target.id, expectedCampaignRevision: approved.campaign.revision,
      expectedBriefVersion: generated.brief.version, terms }, options: { now, policyVerifier: syntheticPolicy } };
}
export async function cleanup() {
  await prisma.outboxEvent.deleteMany({ where: { OR: users.map((id) => ({ payload: { path: ["actorUserId"], equals: id } })) } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: users } } });
  await prisma.deal.deleteMany({ where: { brand: { userId: { in: users } } } });
  await prisma.offerDraft.deleteMany({ where: { actorUserId: { in: users } } });
  await prisma.campaign.deleteMany({ where: { brand: { userId: { in: users } } } });
  await prisma.creator.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
}
