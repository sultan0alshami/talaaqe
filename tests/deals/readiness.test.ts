import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getDealComposeContext } from "@/lib/deals/readiness";
import { applyDealCommand, createDealOffer, getDeal } from "@/lib/deals/service";
import { applyCampaignMutation } from "@/lib/campaigns/service";
import { cleanup, nativeFixture as fixture, user } from "./fixtures";
import { nativeDealActor } from "./native-actors";

afterAll(cleanup);
describe("participant-safe deal readiness on guarded PostgreSQL", () => {
  it("keeps an accepted deal's original approved requirements after a material current brief change", async () => {
    const f = await fixture();
    const offered = (await createDealOffer(f.brandUserId, f.input, f.options)).deal;
    const accepted = (await applyDealCommand(f.target.userId, offered.id, { action: "ACCEPT", operationKey: randomUUID(), expectedVersion: offered.version,
      offerId: offered.currentOffer.id, expectedOfferVersion: offered.currentOffer.version }, f.creatorOptions)).deal;
    const liveCampaign = await prisma.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } });
    await applyCampaignMutation(f.brandUserId, f.campaign.id, { action: "UPDATE_FIELDS", operationKey: randomUUID(), expectedRevision: liveCampaign.revision,
      payload: { patch: { title: "Later campaign title" } } });
    const compose = await getDealComposeContext(f.target.userId, { campaignId: f.campaign.id, creatorId: f.target.id, dealId: accepted.id, view: "CURRENT_EXECUTION" }, prisma, f.options.now, { serverAuth: f.creatorSession.actor });
    expect(compose.kind).toBe("CURRENT");
    if (compose.kind !== "CURRENT") throw new Error("Accepted readiness witness requires current execution composition");
    expect(compose.requirements).toMatchObject({ campaignId: f.campaign.id, version: accepted.briefVersion, title: f.campaign.title });
    expect(compose.readiness.blockedReasons).not.toContain("BRIEF_NOT_APPROVED");
    expect(compose.readiness.blockedReasons).not.toContain("STALE_BRIEF");
    // This synthetic domain fixture has no reviewed public portfolio/contact or
    // legal registry, so availability must remain honestly blocked.
    expect(compose.readiness.canSend).toBe(false);
    expect(compose.templates).toEqual([]);
    expect((await getDeal(f.target.userId, accepted.id, f.creatorOptions)).agreement?.contentHash).toBe(accepted.agreement!.contentHash);
  });
  it("retains original participant history but disables commercial readiness after ownership reassignment", async () => {
    const f = await fixture(), replacement = await user("CREATOR"), replacementSession = await nativeDealActor(replacement);
    const offered = (await createDealOffer(f.brandUserId, f.input, f.options)).deal;
    await prisma.creator.update({ where: { id: f.target.id }, data: { userId: replacement, state: "PRIVATE", brandVisible: false, displayName: "Replacement private identity" } });
    const query = { campaignId: f.campaign.id, creatorId: f.target.id, dealId: offered.id };
    const old = await getDealComposeContext(f.target.userId, query, prisma, f.options.now, { serverAuth: f.creatorSession.actor });
    expect(old.kind).toBe("HISTORY_ONLY");
    if (old.kind !== "HISTORY_ONLY") throw new Error("Transferred actual party requires retained composition");
    expect(old.readiness).toEqual({ canSend: false, blockedReasons: ["HISTORY_ONLY"] });
    expect(old.approvedBrief).toEqual(offered.approvedBrief);
    expect(old.approvedBrief).toMatchObject({ campaignId: f.campaign.id, version: offered.briefVersion,
      content: { requirements: { title: f.campaign.title } } });
    expect(old.parties).toMatchObject({ brand: { userId: f.brandUserId }, creator: { userId: f.target.userId } });
    expect(JSON.stringify(old)).not.toContain("Replacement private identity");
    await expect(getDealComposeContext(replacement, query, prisma, f.options.now, { serverAuth: replacementSession.actor })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getDealComposeContext(f.target.userId, { ...query, view: "CURRENT_EXECUTION" }, prisma, f.options.now,
      { serverAuth: f.creatorSession.actor })).rejects.toMatchObject({ status: 409, code: "CURRENT_EXECUTION_UNAVAILABLE" });
    expect((await getDeal(f.target.userId, offered.id, f.creatorOptions)).currentOffer.id).toBe(offered.currentOffer.id);
  });
  it("allows a visible unclaimed target to show its explicit blockers without creating a deal", async () => {
    const f = await fixture();
    await prisma.creator.update({ where: { id: f.target.id }, data: { userId: null } });
    const value = await getDealComposeContext(f.brandUserId, { campaignId: f.campaign.id, creatorId: f.target.id }, prisma, f.options.now, { serverAuth: f.brandSession.actor });
    expect(value.kind).toBe("CURRENT");
    if (value.kind !== "CURRENT") throw new Error("Fresh unclaimed target requires current composition");
    expect(value.creator.claimed).toBe(false);
    expect(value.readiness.blockedReasons).toEqual(expect.arrayContaining(["CREATOR_UNCLAIMED", "POLICY_REVIEW_REQUIRED", "REVIEWED_TERMS_UNAVAILABLE"]));
    expect(await prisma.deal.count({ where: { campaignId: f.campaign.id } })).toBe(0);
    await prisma.creator.update({ where: { id: f.target.id }, data: { userId: f.target.userId } });
  });
  it("rejects outsider ownership, private/test profiles and a fabricated match origin", async () => {
    const f = await fixture(), outsider = await user("BRAND"), outsiderSession = await nativeDealActor(outsider);
    const query = { campaignId: f.campaign.id, creatorId: f.target.id };
    await expect(getDealComposeContext(outsider, query, prisma, f.options.now, { serverAuth: outsiderSession.actor })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getDealComposeContext(f.brandUserId, query, prisma, f.options.now, { serverAuth: f.brandSession.actor })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await prisma.creator.update({ where: { id: f.target.id }, data: { userId: null } });
    await expect(getDealComposeContext(f.brandUserId, { ...query, matchRunId: randomUUID() }, prisma, f.options.now, { serverAuth: f.brandSession.actor })).rejects.toMatchObject({ code: "INVALID_MATCH_ORIGIN" });
    await prisma.creator.update({ where: { id: f.target.id }, data: { userId: f.target.userId, isTest: true } });
    await expect(getDealComposeContext(f.brandUserId, query, prisma, f.options.now, { serverAuth: f.brandSession.actor })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
