import "./clock";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { createDealOffer, getDeal, listDeals, applyDealCommand, materializeRatingReveal } from "@/lib/deals/service";
import { applyCampaignMutation, generateCampaignBrief, approveCampaignBrief } from "@/lib/campaigns/service";
import { cleanup, creator, fixture, now, user } from "./fixtures";
afterAll(cleanup);
const command = (deal: { version: number }, action: string, extra: Record<string, unknown> = {}) => ({ operationKey: randomUUID(), expectedVersion: deal.version, action, ...extra });
const offer = (deal: { currentOffer: { id: string; version: number } }) => ({ offerId: deal.currentOffer.id, expectedOfferVersion: deal.currentOffer.version });
async function accepted(f: Awaited<ReturnType<typeof fixture>>) {
  const created = (await createDealOffer(f.brandUserId, f.input, f.options)).deal;
  return (await applyDealCommand(f.target.userId, created.id, command(created, "ACCEPT", offer(created)), f.options)).deal;
}
async function agreed(f: Awaited<ReturnType<typeof fixture>>) {
  let deal = await accepted(f);
  const agreement = { agreementId: deal.agreement!.id, expectedAgreementVersion: deal.agreement!.version };
  deal = (await applyDealCommand(f.brandUserId, deal.id, command(deal, "CONFIRM", agreement), f.options)).deal;
  return (await applyDealCommand(f.target.userId, deal.id, command(deal, "CONFIRM", agreement), f.options)).deal;
}
async function completed(f: Awaited<ReturnType<typeof fixture>>) {
  let deal = await agreed(f);
  deal = (await applyDealCommand(f.target.userId, deal.id, command(deal, "DELIVER", { evidence: { text: { text: "أتممت النشر", language: "ar" }, links: ["https://example.invalid/synthetic-delivery"] } }), f.options)).deal;
  return (await applyDealCommand(f.brandUserId, deal.id, command(deal, "COMPLETE"), f.options)).deal;
}
describe("atomic recipient-owned deals against guarded PostgreSQL", () => {
  it("creates once under separate connections, rejects changed replay and keeps origin/allocation independent of ranking", async () => {
    const f = await fixture(), second = new PrismaClient();
    try {
      const results = await Promise.all([createDealOffer(f.brandUserId, f.input, f.options), createDealOffer(f.brandUserId, f.input, { ...f.options, client: second })]);
      expect(results[0].deal.id).toBe(results[1].deal.id); expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
      expect(results[0].deal).toMatchObject({ status: "OFFERED", origin: "DIRECT", matchRunId: null, slotOrdinal: 0 });
      await expect(createDealOffer(f.brandUserId, { ...f.input, terms: { ...f.terms, amount: { ...f.terms.amount, amountMinor: "4999" } } }, f.options)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
      expect(await prisma.outboxEvent.count({ where: { type: "deal.offered", payload: { path: ["aggregateId"], equals: results[0].deal.id } } })).toBe(1);
    } finally { await second.$disconnect(); }
  });
  it("blocks absent trusted policy, unclaimed/private creators, fabricated MATCH origin and unsupported currency/format", async () => {
    const f = await fixture();
    await expect(createDealOffer(f.brandUserId, f.input, { now })).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE" });
    await expect(createDealOffer(f.brandUserId, { ...f.input, origin: "MATCH", matchRunId: randomUUID() }, f.options)).rejects.toMatchObject({ code: "INVALID_MATCH_ORIGIN" });
    await expect(createDealOffer(f.brandUserId, { ...f.input, terms: { ...f.terms, amount: { amountMinor: "5000", currencyCode: "SAR" } } }, f.options)).rejects.toMatchObject({ code: "INVALID_TERMS" });
    await expect(createDealOffer(f.brandUserId, { ...f.input, terms: { ...f.terms, deliverables: [{ platform: "INSTAGRAM", format: "REEL", count: 1 }] } }, f.options)).rejects.toMatchObject({ code: "UNSUPPORTED_DELIVERABLE" });
    await prisma.creator.update({ where: { id: f.target.id }, data: { userId: null } });
    await expect(createDealOffer(f.brandUserId, f.input, f.options)).rejects.toMatchObject({ code: "CREATOR_NOT_EXECUTABLE" });
    await prisma.creator.update({ where: { id: f.target.id }, data: { userId: f.target.userId, state: "PRIVATE" } });
    await expect(createDealOffer(f.brandUserId, f.input, f.options)).rejects.toMatchObject({ code: "CREATOR_NOT_EXECUTABLE" });
    expect(await prisma.deal.count({ where: { campaignId: f.campaign.id } })).toBe(0);
  });
  it("does not let outsider/admin read, list another party, accept own offer, or replay after suspension", async () => {
    const f = await fixture(), deal = (await createDealOffer(f.brandUserId, f.input, f.options)).deal, outsider = await user("BRAND"), admin = await user("ADMIN");
    await expect(getDeal(outsider, deal.id, f.options)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getDeal(admin, deal.id, f.options)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await listDeals(outsider, {}, f.options)).deals).toEqual([]);
    await expect(applyDealCommand(f.brandUserId, deal.id, command(deal, "ACCEPT", offer(deal)), f.options)).rejects.toMatchObject({ code: "RECIPIENT_ONLY" });
    await prisma.user.update({ where: { id: f.brandUserId }, data: { active: false } });
    await expect(createDealOffer(f.brandUserId, f.input, f.options)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("has one winner for accept versus counter and cannot accept stale offer IDs", async () => {
    const f = await fixture(), deal = (await createDealOffer(f.brandUserId, f.input, f.options)).deal, second = new PrismaClient();
    try {
      const results = await Promise.allSettled([
        applyDealCommand(f.target.userId, deal.id, command(deal, "ACCEPT", offer(deal)), f.options),
        applyDealCommand(f.brandUserId, deal.id, command(deal, "COUNTER", { ...offer(deal), terms: { ...f.terms, amount: { ...f.terms.amount, amountMinor: "4999" } } }), { ...f.options, client: second }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "STALE_VERSION" });
      const current = await getDeal(f.brandUserId, deal.id, f.options);
      if (current.status === "COUNTERED") await expect(applyDealCommand(f.target.userId, current.id, command(current, "ACCEPT", offer(deal)), f.options)).rejects.toMatchObject({ code: "STALE_OFFER" });
      expect(await prisma.dealOffer.count({ where: { dealId: deal.id, status: "PENDING" } })).toBeLessThanOrEqual(1);
    } finally { await second.$disconnect(); }
  });
  it("freezes one agreement with actual identities, policy and hash, and atomically joins two confirmations", async () => {
    const f = await fixture(), deal = await accepted(f), agreement = deal.agreement!, second = new PrismaClient();
    expect(agreement).toMatchObject({ language: "ar", acceptedOfferId: deal.currentOffer.id, brandCountryCode: "KW", creatorCountryCode: "KW", campaignMarketCountryCodes: ["KW"] });
    expect(agreement.contentHash).toMatch(/^[a-f0-9]{64}$/); expect(deal.currentOffer.acceptedAt).toBe(now.toISOString());
    try {
      const extra = { agreementId: agreement.id, expectedAgreementVersion: agreement.version };
      const results = await Promise.allSettled([applyDealCommand(f.brandUserId, deal.id, command(deal, "CONFIRM", extra), f.options), applyDealCommand(f.target.userId, deal.id, command(deal, "CONFIRM", extra), { ...f.options, client: second })]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      let current = await getDeal(f.brandUserId, deal.id, f.options);
      const missing = current.confirmations[0].userId === f.brandUserId ? f.target.userId : f.brandUserId;
      current = (await applyDealCommand(missing, deal.id, command(current, "CONFIRM", extra), f.options)).deal;
      expect(current.status).toBe("AGREED"); expect(current.confirmations).toHaveLength(2);
      const repeated = await applyDealCommand(missing, deal.id, command(current, "CONFIRM", extra), f.options);
      expect(repeated.deal.version).toBe(current.version);
      await expect(prisma.agreementSnapshot.update({ where: { id: agreement.id }, data: { content: { overwritten: true } } })).rejects.toBeDefined();
      expect(await prisma.outboxEvent.count({ where: { type: "deal.agreed", payload: { path: ["aggregateId"], equals: deal.id } } })).toBe(1);
    } finally { await second.$disconnect(); }
  });
  it("rechecks trusted policy before accept/confirm and preserves frozen agreement after profile/brief changes", async () => {
    const f = await fixture(), offered = (await createDealOffer(f.brandUserId, f.input, f.options)).deal;
    const denied = { ...f.options, policyVerifier: async () => { throw Object.assign(new Error("Policy expired"), { code: "POLICY_UNAVAILABLE", status: 503 }); } };
    await expect(applyDealCommand(f.target.userId, offered.id, command(offered, "ACCEPT", offer(offered)), denied)).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE" });
    let deal = (await applyDealCommand(f.target.userId, offered.id, command(offered, "ACCEPT", offer(offered)), f.options)).deal;
    const before = await prisma.agreementSnapshot.findUniqueOrThrow({ where: { id: deal.agreement!.id } });
    await prisma.creator.update({ where: { id: f.target.id }, data: { displayName: "اسم لاحق" } });
    await expect(applyDealCommand(f.brandUserId, deal.id, command(deal, "CONFIRM", { agreementId: deal.agreement!.id, expectedAgreementVersion: 1 }), denied)).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE" });
    expect(await prisma.agreementSnapshot.findUniqueOrThrow({ where: { id: deal.agreement!.id } })).toEqual(before);
    deal = (await applyDealCommand(f.brandUserId, deal.id, command(deal, "CANCEL", { reason: { text: "إلغاء", language: "ar" } }), f.options)).deal;
    expect(deal.status).toBe("CANCELLED"); expect(deal.agreement).toEqual(expect.objectContaining({ contentHash: before.content && (before.content as {contentHash:string}).contentHash }));
  });
  it("reserves unique ordinals under campaign races and never reuses completed accepted obligations across revised briefs", async () => {
    const f = await fixture(1, "5000"), other = await creator(), second = new PrismaClient();
    try {
      const results = await Promise.allSettled([createDealOffer(f.brandUserId, f.input, f.options), createDealOffer(f.brandUserId, { ...f.input, operationKey: randomUUID(), creatorId: other.id }, { ...f.options, client: second })]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "CAMPAIGN_SLOTS_FULL" });
    } finally { await second.$disconnect(); }
    const h = await fixture(1, "5000"), done = await completed(h), next = await creator();
    const updated = await applyCampaignMutation(h.brandUserId, h.campaign.id, { action: "UPDATE_FIELDS", operationKey: randomUUID(), expectedRevision: (await prisma.campaign.findUniqueOrThrow({ where: { id: h.campaign.id } })).revision,
      payload: { patch: { title: "Brief revision after completion" } } });
    const generated = await generateCampaignBrief(h.brandUserId, h.campaign.id, { operationKey: randomUUID(), expectedRevision: updated.campaign.revision });
    const approved = await approveCampaignBrief(h.brandUserId, h.campaign.id, { operationKey: randomUUID(), expectedRevision: generated.campaign.revision, briefId: generated.brief.id, expectedBriefVersion: generated.brief.version });
    await expect(createDealOffer(h.brandUserId, { ...h.input, operationKey: randomUUID(), creatorId: next.id, expectedCampaignRevision: approved.campaign.revision, expectedBriefVersion: approved.brief.version }, h.options)).rejects.toMatchObject({ code: "CAMPAIGN_SLOTS_FULL" });
    expect((await getDeal(h.brandUserId, done.id, h.options)).status).toBe("COMPLETED");
  });
  it("enforces delivery/completion roles, retains postterminal original-language messages and records payment as declarations", async () => {
    const f = await fixture(), deal = await agreed(f);
    await expect(applyDealCommand(f.target.userId, deal.id, command(deal, "DECLARE_PAID"), f.options)).rejects.toMatchObject({ code: "ROLE_ONLY" });
    const paid = (await applyDealCommand(f.brandUserId, deal.id, command(deal, "DECLARE_PAID"), f.options)).deal;
    expect(paid.status).toBe("AGREED"); expect(paid.brandPaymentReportedAt).toBe(now.toISOString());
    await expect(applyDealCommand(f.brandUserId, deal.id, command(paid, "DELIVER", { evidence: { text: { text: "Wrong role", language: "en" }, links: [] } }), f.options)).rejects.toMatchObject({ code: "ROLE_ONLY" });
    const delivered = (await applyDealCommand(f.target.userId, deal.id, command(paid, "DELIVER", { evidence: { text: { text: "تم", language: "ar" }, links: [] } }), f.options)).deal;
    await expect(applyDealCommand(f.brandUserId, deal.id, command(delivered, "CANCEL", { reason: { text: "Too late", language: "en" } }), f.options)).rejects.toMatchObject({ code: "INVALID_STATE" });
    const done = (await applyDealCommand(f.brandUserId, deal.id, command(delivered, "COMPLETE"), f.options)).deal;
    const messaged = (await applyDealCommand(f.target.userId, deal.id, command(done, "MESSAGE", { text: { text: "شكراً", language: "ar" } }), f.options)).deal;
    expect(messaged.status).toBe("COMPLETED"); expect(messaged.messages[0].text).toEqual({ text: "شكراً", language: "ar" });
    expect(JSON.stringify(messaged)).not.toContain("paymentVerified");
  });
  it("seals opposing rating, events and outbox until exact seven-day boundary; reveal materialization is idempotent", async () => {
    const f = await fixture(), done = await completed(f), rated = (await applyDealCommand(f.brandUserId, done.id, command(done, "RATE", { stars: 2, comment: { text: "sealed unique private comment", language: "en" } }), f.options)).deal;
    expect(rated.ratings).toHaveLength(1); expect(rated.ratingsRevealed).toBe(false);
    const early = new Date(now.getTime() + 7 * 24 * 3600_000 - 1), boundary = new Date(early.getTime() + 1);
    const hidden = await getDeal(f.target.userId, done.id, { ...f.options, now: early });
    expect(hidden.ratings).toEqual([]); expect(JSON.stringify(hidden)).not.toContain("sealed unique private comment");
    const outbox = await prisma.outboxEvent.findMany({ where: { type: "rating.submitted", payload: { path: ["aggregateId"], equals: done.id } } });
    expect(JSON.stringify(outbox)).not.toContain("sealed unique private comment"); expect(JSON.stringify(outbox)).not.toContain('"stars":2');
    expect((await getDeal(f.target.userId, done.id, { ...f.options, now: boundary })).ratings).toHaveLength(1);
    expect(await materializeRatingReveal(done.id, { ...f.options, now: early })).toEqual({ revealed: false, changed: false });
    expect(await materializeRatingReveal(done.id, { ...f.options, now: boundary })).toEqual({ revealed: true, changed: true });
    expect(await materializeRatingReveal(done.id, { ...f.options, now: boundary })).toEqual({ revealed: true, changed: false });
  });
  it("reveals both ratings atomically and denies duplicate submissions and current role revocation", async () => {
    const f = await fixture(), done = await completed(f), first = (await applyDealCommand(f.brandUserId, done.id, command(done, "RATE", { stars: 5, comment: null }), f.options)).deal;
    const second = (await applyDealCommand(f.target.userId, done.id, command(first, "RATE", { stars: 4, comment: { text: "أصلي", language: "ar" } }), f.options)).deal;
    expect(second.ratingsRevealed).toBe(true); expect(second.ratings).toHaveLength(2);
    await expect(applyDealCommand(f.target.userId, done.id, command(second, "RATE", { stars: 1, comment: null }), f.options)).rejects.toMatchObject({ code: "ALREADY_RATED" });
    await prisma.user.update({ where: { id: f.target.userId }, data: { role: "BRAND" } });
    await expect(getDeal(f.target.userId, done.id, f.options)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("changes recipient on a creator counter, denies own decline and releases only never-accepted cancelled slots", async () => {
    const f = await fixture(1, "5000"), first = (await createDealOffer(f.brandUserId, f.input, f.options)).deal;
    const countered = (await applyDealCommand(f.target.userId, first.id, command(first, "COUNTER", { ...offer(first), terms: { ...f.terms, amount: { ...f.terms.amount, amountMinor: "4999" } } }), f.options)).deal;
    expect(countered.currentOffer.recipientUserId).toBe(f.brandUserId); expect(countered.offers.map(o => o.status)).toEqual(["SUPERSEDED", "PENDING"]);
    await expect(applyDealCommand(f.target.userId, first.id, command(countered, "DECLINE", { ...offer(countered), reason: { text: "Own proposal", language: "en" } }), f.options)).rejects.toMatchObject({ code: "RECIPIENT_ONLY" });
    const cancelled = (await applyDealCommand(f.brandUserId, first.id, command(countered, "CANCEL", { reason: { text: "تعذر التعاون", language: "ar" } }), f.options)).deal;
    expect(cancelled.currentOffer.status).toBe("CANCELLED");
    const replacement = (await createDealOffer(f.brandUserId, { ...f.input, operationKey: randomUUID() }, f.options)).deal;
    expect(replacement.slotOrdinal).toBe(0); expect(replacement.id).not.toBe(first.id);
    expect((await getDeal(f.target.userId, first.id, f.options)).status).toBe("CANCELLED");
  });
  it("rejects duplicate active pairs across different operation keys and exact ordinal remainder over-allocation", async () => {
    const f = await fixture(), second = new PrismaClient();
    try {
      const results = await Promise.allSettled([createDealOffer(f.brandUserId, f.input, f.options), createDealOffer(f.brandUserId, { ...f.input, operationKey: randomUUID() }, { ...f.options, client: second })]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "ACTIVE_DEAL_EXISTS" });
    } finally { await second.$disconnect(); }
    const next = await creator();
    await expect(createDealOffer(f.brandUserId, { ...f.input, creatorId: next.id, operationKey: randomUUID(), terms: { ...f.terms, amount: { ...f.terms.amount, amountMinor: "5001" } } }, f.options)).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
    const ok = (await createDealOffer(f.brandUserId, { ...f.input, creatorId: next.id, operationKey: randomUUID() }, f.options)).deal;
    expect(ok.slotOrdinal).toBe(1); expect(ok.currentOffer.terms.amount.amountMinor).toBe("5000");
  });
  it("binds entire immutable snapshot hash and blocks missing reviewed English instead of relabeling Arabic", async () => {
    const f = await fixture(), created = (await createDealOffer(f.brandUserId, f.input, f.options)).deal;
    await expect(applyDealCommand(f.target.userId, created.id, command(created, "ACCEPT", { ...offer(created), language: "en" }), f.options)).rejects.toMatchObject({ code: "REVIEWED_LANGUAGE_UNAVAILABLE" });
    const deal = (await applyDealCommand(f.target.userId, created.id, command(created, "ACCEPT", offer(created)), f.options)).deal;
    const raw = (await prisma.agreementSnapshot.findUniqueOrThrow({ where: { id: deal.agreement!.id } })).content as Record<string, unknown>;
    const fields = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "contentHash"));
    expect(canonicalHash(fields)).toBe(deal.agreement!.contentHash);
    expect(canonicalHash({ ...fields, terms: { ...f.terms, usageRights: "Changed rights" } })).not.toBe(raw.contentHash);
    expect(canonicalHash(raw.content)).not.toBe(raw.contentHash);
  });
  it("linearizes current creator-role revocation against recipient acceptance on separate connections", async () => {
    const f = await fixture(), deal = (await createDealOffer(f.brandUserId, f.input, f.options)).deal, second = new PrismaClient();
    try {
      const [result] = await Promise.allSettled([
        applyDealCommand(f.target.userId, deal.id, command(deal, "ACCEPT", offer(deal)), f.options),
        second.user.update({ where: { id: f.target.userId }, data: { role: "BRAND" } }),
      ]);
      const persisted = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
      if (result.status === "fulfilled") { expect(persisted.status).toBe("ACCEPTED"); expect(await prisma.agreementSnapshot.count({ where: { dealId: deal.id } })).toBe(1); }
      else { expect(result.reason).toMatchObject({ code: "FORBIDDEN" }); expect(persisted.status).toBe("OFFERED"); expect(await prisma.agreementSnapshot.count({ where: { dealId: deal.id } })).toBe(0); }
      await expect(getDeal(f.target.userId, deal.id, f.options)).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally { await second.$disconnect(); }
  });
  it("rechecks current ownership identity and availability before executable acceptance", async () => {
    const f = await fixture(), deal = (await createDealOffer(f.brandUserId, f.input, f.options)).deal;
    await prisma.socialAccount.update({ where: { id: f.target.accountId }, data: { providerAccountId: "changed-without-new-proof" } });
    await expect(applyDealCommand(f.target.userId, deal.id, command(deal, "ACCEPT", offer(deal)), f.options)).rejects.toMatchObject({ code: "CREATOR_NOT_EXECUTABLE" });
    await prisma.socialAccount.update({ where: { id: f.target.accountId }, data: { providerAccountId: `synthetic-provider-${f.target.userId}` } });
    await prisma.creator.update({ where: { id: f.target.id }, data: { availability: { status: "UNKNOWN" } } });
    await expect(applyDealCommand(f.target.userId, deal.id, command(deal, "ACCEPT", offer(deal)), f.options)).rejects.toMatchObject({ code: "AVAILABILITY_REQUIRED" });
    expect(await prisma.agreementSnapshot.count({ where: { dealId: deal.id } })).toBe(0);
  });
  it("does not transfer historical negotiation or sealed feedback to a replacement profile owner", async () => {
    const f = await fixture(), deal = (await createDealOffer(f.brandUserId, f.input, f.options)).deal, replacement = await user("CREATOR");
    await prisma.creator.update({ where: { id: f.target.id }, data: { userId: replacement } });
    await expect(getDeal(replacement, deal.id, f.options)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listDeals(replacement, {}, f.options)).deals).toEqual([]);
    await expect(applyDealCommand(replacement, deal.id, command(deal, "ACCEPT", offer(deal)), f.options)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getDeal(f.brandUserId, deal.id, f.options)).currentOffer.recipientUserId).toBe(f.target.userId);
    expect((await getDeal(f.target.userId, deal.id, f.options)).currentOffer.recipientUserId).toBe(f.target.userId);
    await expect(applyDealCommand(f.brandUserId, deal.id, command(deal, "COUNTER", { ...offer(deal), terms: f.terms }), f.options)).rejects.toMatchObject({ code: "STALE_PARTICIPANTS" });
  });
  it("applies the shared direct eligibility loader to verified-data, tier, preferred licence and granular privacy requirements", async () => {
    for (const patch of [{ dataVerificationRequired: true }, { preferredTiers: ["MEGA"] }, { preferredLicencePolicyIds: ["missing-reviewed-preference"] }]) {
      const f = await fixture();
      const edited = await applyCampaignMutation(f.brandUserId, f.campaign.id, { action: "UPDATE_FIELDS", expectedRevision: f.campaign.revision, operationKey: randomUUID(), payload: { patch } });
      const generated = await generateCampaignBrief(f.brandUserId, f.campaign.id, { expectedRevision: edited.campaign.revision, operationKey: randomUUID() });
      const approved = await approveCampaignBrief(f.brandUserId, f.campaign.id, { expectedRevision: generated.campaign.revision, operationKey: randomUUID(), briefId: generated.brief.id, expectedBriefVersion: generated.brief.version });
      await expect(createDealOffer(f.brandUserId, { ...f.input, expectedCampaignRevision: approved.campaign.revision, expectedBriefVersion: approved.brief.version }, f.options)).rejects.toMatchObject({ code: "CREATOR_NOT_ELIGIBLE" });
    }
    const privateMetrics = await fixture();
    await prisma.socialAccount.update({ where: { id: privateMetrics.target.accountId }, data: { fieldVisibility: { followers: "PRIVATE" } } });
    await expect(createDealOffer(privateMetrics.brandUserId, privateMetrics.input, privateMetrics.options)).rejects.toMatchObject({ code: "CREATOR_NOT_ELIGIBLE" });
  });
});
