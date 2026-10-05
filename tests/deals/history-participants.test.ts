import "./clock";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { applyDealCommand, createDealOffer, getDeal } from "@/lib/deals/service";
import { cleanup, fixture, user } from "./fixtures";
afterAll(cleanup);
describe("immutable historical negotiation participants", () => {
  it("keeps historical messaging with the original creator and permits brand cancellation after reassignment", async () => {
    const f = await fixture(), replacement = await user("CREATOR");
    let deal = (await createDealOffer(f.brandUserId, f.input, f.options)).deal;
    await prisma.creator.update({ where: { id: f.target.id }, data: { userId: replacement, state: "PRIVATE", brandVisible: false } });
    deal = (await applyDealCommand(f.target.userId, deal.id, { action: "MESSAGE", operationKey: randomUUID(), expectedVersion: deal.version,
      text: { text: "Original participant history", language: "en" } }, f.options)).deal;
    expect(deal.messages[0].senderUserId).toBe(f.target.userId);
    await expect(prisma.dealMessage.create({ data: { dealId: deal.id, senderUserId: replacement, text: "replacement cannot join" } })).rejects.toBeDefined();
    await expect(prisma.dealOffer.update({ where: { id: deal.currentOffer.id }, data: { recipientUserId: replacement } })).rejects.toBeDefined();
    deal = (await applyDealCommand(f.brandUserId, deal.id, { action: "CANCEL", operationKey: randomUUID(), expectedVersion: deal.version,
      reason: { text: "Original collaboration ended", language: "en" } }, f.options)).deal;
    expect(deal.status).toBe("CANCELLED");
    expect(deal.currentOffer.status).toBe("CANCELLED");
    expect((await getDeal(f.target.userId, deal.id, f.options)).messages[0].text.text).toBe("Original participant history");
    await expect(getDeal(replacement, deal.id, f.options)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
