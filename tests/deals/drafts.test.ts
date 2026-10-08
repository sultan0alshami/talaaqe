import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getOfferDraft, saveOfferDraft } from "@/lib/deals/drafts";
import { createDealOffer } from "@/lib/deals/service";
import { cleanup, nativeFixture as fixture, user } from "./fixtures";
import { nativeDealActor } from "./native-actors";
afterAll(cleanup);
describe("private incomplete offer drafts", () => {
  it("durably resumes incomplete original-language form data while trusted policy is unavailable", async () => {
    const f = await fixture(), input = { campaignId: f.campaign.id, creatorId: f.target.id, expectedRevision: 0, operationKey: randomUUID(),
      patch: { note: { text: "مسودة خاصة", language: "ar" }, amount: { currencyCode: "KWD" } } };
    const saved = await saveOfferDraft(f.brandUserId, input, { now: f.options.now, serverAuth: f.brandSession.actor });
    expect(saved.draft.terms).toEqual(input.patch); expect(saved.draft.revision).toBe(1);
    expect(await getOfferDraft(f.brandUserId, saved.draft.id, { serverAuth: f.brandSession.actor })).toEqual(saved.draft);
    expect((await saveOfferDraft(f.brandUserId, input, { serverAuth: f.brandSession.actor })).replayed).toBe(true);
    await expect(createDealOffer(f.brandUserId, f.input, { now: f.options.now, serverAuth: f.brandSession.actor })).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE" });
    expect(await prisma.deal.count({ where: { campaignId: f.campaign.id } })).toBe(0);
    const outsider = await user("BRAND"), outsiderSession = await nativeDealActor(outsider);
    await expect(getOfferDraft(outsider, saved.draft.id, { serverAuth: outsiderSession.actor })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getOfferDraft(f.target.userId, saved.draft.id, { serverAuth: f.creatorSession.actor })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("gives one winner for separate-connection revisions, retains failed proposals and rejects policy/model overrides", async () => {
    const f = await fixture(), second = new PrismaClient(), base = { campaignId: f.campaign.id, creatorId: f.target.id, expectedRevision: 0, operationKey: randomUUID(), patch: {} };
    const initial = await saveOfferDraft(f.brandUserId, base, { serverAuth: f.brandSession.actor });
    try {
      const results = await Promise.allSettled([
        saveOfferDraft(f.brandUserId, { ...base, expectedRevision: 1, operationKey: randomUUID(), patch: { usageRights: "أول" } }, { serverAuth: f.brandSession.actor }),
        saveOfferDraft(f.brandUserId, { ...base, expectedRevision: 1, operationKey: randomUUID(), patch: { usageRights: "ثاني" } }, { client: second, serverAuth: f.brandSession.actor }),
      ]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "STALE_VERSION" });
      const retained = await getOfferDraft(f.brandUserId, initial.draft.id, { serverAuth: f.brandSession.actor });
      await expect(saveOfferDraft(f.brandUserId, { ...base, expectedRevision: 2, operationKey: randomUUID(), patch: { policyReviewed: true } }, { serverAuth: f.brandSession.actor })).rejects.toMatchObject({ code: "INVALID_COMMAND" });
      await expect(saveOfferDraft(f.brandUserId, { ...base, expectedRevision: 2, operationKey: randomUUID(), patch: { amount: { amountMinor: "1.2", currencyCode: "KWD" } } }, { serverAuth: f.brandSession.actor })).rejects.toMatchObject({ code: "INVALID_COMMAND" });
      expect(await getOfferDraft(f.brandUserId, initial.draft.id, { serverAuth: f.brandSession.actor })).toEqual(retained);
    } finally { await second.$disconnect(); }
  });
  it("permits a private prospect draft without making an executable deal, and rechecks active author on replay", async () => {
    const f = await fixture(); await prisma.creator.update({ where: { id: f.target.id }, data: { userId: null, state: "PRIVATE" } });
    const input = { campaignId: f.campaign.id, creatorId: f.target.id, expectedRevision: 0, operationKey: randomUUID(), patch: f.terms };
    const draft = await saveOfferDraft(f.brandUserId, input, { serverAuth: f.brandSession.actor });
    expect(draft.draft.terms).toEqual(f.terms);
    await expect(createDealOffer(f.brandUserId, f.input, f.options)).rejects.toMatchObject({ code: "CREATOR_NOT_EXECUTABLE" });
    await prisma.creator.update({ where: { id: f.target.id }, data: { userId: f.target.userId } });
    await prisma.user.update({ where: { id: f.brandUserId }, data: { active: false } });
    await expect(saveOfferDraft(f.brandUserId, input, { serverAuth: f.brandSession.actor })).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  });
});
