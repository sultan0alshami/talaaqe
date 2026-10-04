import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { applyDealCommand, createDealOffer, getDeal } from "@/lib/deals/service";
import { cleanup, fixture, user } from "./fixtures";

afterEach(cleanup);
describe("commercial actions adopt current accepted account proof", () => {
  it("rejects a VERIFIED snapshot whose reviewed challenge was deleted", async () => {
    const f = await fixture();
    await prisma.ownershipChallenge.deleteMany({ where: { accountId: f.target.accountId } });
    await expect(createDealOffer(f.brandUserId, f.input, f.options)).rejects.toMatchObject({ code: "CREATOR_NOT_EXECUTABLE" });
    expect(await prisma.deal.count({ where: { campaignId: f.campaign.id } })).toBe(0);
  });
  it("blocks acceptance after proof deletion or reviewer suspension while preserving party history", async () => {
    const f = await fixture(), deal = (await createDealOffer(f.brandUserId, f.input, f.options)).deal;
    const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.target.accountId } });
    const accept = () => applyDealCommand(f.target.userId, deal.id, { operationKey: randomUUID(), expectedVersion: deal.version, action: "ACCEPT", offerId: deal.currentOffer.id, expectedOfferVersion: deal.currentOffer.version }, f.options);
    await prisma.privateAsset.update({ where: { id: account.ownershipProofAssetId! }, data: { deletedAt: f.options.now } });
    await expect(accept()).rejects.toMatchObject({ code: "CREATOR_NOT_EXECUTABLE" });
    expect((await getDeal(f.target.userId, deal.id, f.options)).status).toBe("OFFERED");
    await prisma.privateAsset.update({ where: { id: account.ownershipProofAssetId! }, data: { deletedAt: null } });
    await prisma.user.update({ where: { id: f.target.reviewerId }, data: { active: false } });
    await expect(accept()).rejects.toMatchObject({ code: "CREATOR_NOT_EXECUTABLE" });
    expect((await getDeal(f.brandUserId, deal.id, f.options)).currentOffer.id).toBe(deal.currentOffer.id);
    expect(await prisma.agreementSnapshot.count({ where: { dealId: deal.id } })).toBe(0);
  });
  it("does not grant a replacement owner commercial rights through the previous owner's proof", async () => {
    const f = await fixture(), replacement = await user("CREATOR");
    await prisma.creator.update({ where: { id: f.target.id }, data: { userId: replacement } });
    await expect(createDealOffer(f.brandUserId, f.input, f.options)).rejects.toMatchObject({ code: "CREATOR_NOT_EXECUTABLE" });
    expect(await prisma.deal.count({ where: { campaignId: f.campaign.id } })).toBe(0);
  });
});
