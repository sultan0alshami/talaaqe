import "./clock";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getDealComposeContext } from "@/lib/deals/readiness";
import { applyDealCommand, createDealOffer, getDeal } from "@/lib/deals/service";
import { applyCampaignMutation } from "@/lib/campaigns/service";
import { cleanup, fixture, now, user } from "./fixtures";

afterAll(cleanup);
describe("participant-safe deal readiness on guarded PostgreSQL", () => {
  it("keeps an accepted deal's original approved requirements after a material current brief change", async () => {
    const f = await fixture();
    const offered = (await createDealOffer(f.brandUserId, f.input, f.options)).deal;
    const accepted = (await applyDealCommand(f.target.userId, offered.id, { action: "ACCEPT", operationKey: randomUUID(), expectedVersion: offered.version,
      offerId: offered.currentOffer.id, expectedOfferVersion: offered.currentOffer.version }, f.options)).deal;
    const liveCampaign = await prisma.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } });
    await applyCampaignMutation(f.brandUserId, f.campaign.id, { action: "UPDATE_FIELDS", operationKey: randomUUID(), expectedRevision: liveCampaign.revision,
      payload: { patch: { title: "Later campaign title" } } });
    const compose = await getDealComposeContext(f.target.userId, { campaignId: f.campaign.id, creatorId: f.target.id, dealId: accepted.id }, prisma, now);
    expect(compose.requirements).toMatchObject({ campaignId: f.campaign.id, version: accepted.briefVersion, title: f.campaign.title });
    expect(compose.readiness.blockedReasons).not.toContain("BRIEF_NOT_APPROVED");
    expect(compose.readiness.blockedReasons).not.toContain("STALE_BRIEF");
    // This synthetic domain fixture has no reviewed public portfolio/contact or
    // legal registry, so availability must remain honestly blocked.
    expect(compose.readiness.canSend).toBe(false);
    expect(compose.templates).toEqual([]);
    expect((await getDeal(f.target.userId, accepted.id, f.options)).agreement?.contentHash).toBe(accepted.agreement!.contentHash);
  });
  it("retains original participant history but disables commercial readiness after ownership reassignment", async () => {
    const f = await fixture(), replacement = await user("CREATOR");
    const offered = (await createDealOffer(f.brandUserId, f.input, f.options)).deal;
    await prisma.creator.update({ where: { id: f.target.id }, data: { userId: replacement, state: "PRIVATE", brandVisible: false, displayName: "Replacement private identity" } });
    const query = { campaignId: f.campaign.id, creatorId: f.target.id, dealId: offered.id };
    const old = await getDealComposeContext(f.target.userId, query, prisma, now);
    expect(old.readiness.blockedReasons).toEqual(expect.arrayContaining(["STALE_PARTICIPANTS", "CREATOR_NOT_EXECUTABLE"]));
    expect(JSON.stringify(old)).not.toContain("Replacement private identity");
    await expect(getDealComposeContext(replacement, query, prisma, now)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getDeal(f.target.userId, offered.id, f.options)).currentOffer.id).toBe(offered.currentOffer.id);
  });
  it("allows a visible unclaimed target to show its explicit blockers without creating a deal", async () => {
    const f = await fixture();
    await prisma.creator.update({ where: { id: f.target.id }, data: { userId: null } });
    const value = await getDealComposeContext(f.brandUserId, { campaignId: f.campaign.id, creatorId: f.target.id }, prisma, now);
    expect(value.creator.claimed).toBe(false);
    expect(value.readiness.blockedReasons).toEqual(expect.arrayContaining(["CREATOR_UNCLAIMED", "POLICY_REVIEW_REQUIRED", "REVIEWED_TERMS_UNAVAILABLE"]));
    expect(await prisma.deal.count({ where: { campaignId: f.campaign.id } })).toBe(0);
    await prisma.creator.update({ where: { id: f.target.id }, data: { userId: f.target.userId } });
  });
  it("rejects outsider ownership, private/test profiles and a fabricated match origin", async () => {
    const f = await fixture(), outsider = await user("BRAND");
    const query = { campaignId: f.campaign.id, creatorId: f.target.id };
    await expect(getDealComposeContext(outsider, query, prisma, now)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getDealComposeContext(f.brandUserId, query, prisma, now)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await prisma.creator.update({ where: { id: f.target.id }, data: { userId: null } });
    await expect(getDealComposeContext(f.brandUserId, { ...query, matchRunId: randomUUID() }, prisma, now)).rejects.toMatchObject({ code: "INVALID_MATCH_ORIGIN" });
    await prisma.creator.update({ where: { id: f.target.id }, data: { userId: f.target.userId, isTest: true } });
    await expect(getDealComposeContext(f.brandUserId, query, prisma, now)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
