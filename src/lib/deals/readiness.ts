import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseBriefContent } from "@/lib/campaigns/contracts";
import { publicCreator } from "@/lib/onboarding/profiles";
import { record } from "@/lib/onboarding/drafts";
import { loadEligibleCreator } from "@/lib/matching/persistence";
import { offerVerificationSatisfied } from "@/lib/offer-verification";
import { reviewedGoverningOptions, reviewedMatchingPolicies, resolveCampaignPolicyReview } from "@/lib/policies";
import { DealError, DealComposeQuerySchema, type DealOptions, type RetainedDealComposeDTO } from "./contracts";
import { dealParticipantContext, dealDTO, type DealDTO } from "./service";
import { captureHistoricalDeal, lockHistoricalUsers, lockHistoricalDeal } from "./history";
import { lockEvidenceActors } from "@/lib/evidence/readiness";
import { beginDealSession, withDealSession, lockDealSession } from "./session";
import { OfferDraftTermsSchema } from "./drafts";

type ComposeQuery = z.infer<typeof DealComposeQuerySchema>;
type CurrentContext = Awaited<ReturnType<typeof dealParticipantContext>>;
async function currentCompose(tx: Parameters<typeof dealParticipantContext>[0], actorUserId: string, query: ComposeQuery,
  resourceNow: Date | undefined, ctx: CurrentContext, ownDeal: DealDTO | null) {
    const originalCreatorUserId = ownDeal?.offers.find(offer => offer.version === 1)?.recipientUserId;
    const now = resourceNow ?? new Date();
    if (ctx.role === "CREATOR" && !ownDeal) throw new DealError("NOT_FOUND", 404);
    const visible = !ctx.creator.isTest && ctx.creator.state === "PUBLISHED" && ctx.creator.brandVisible && (!ctx.creator.userId || !!await publicCreator(ctx.creator.handle, tx, ctx.evidenceActors));
    if (!visible && !ownDeal) throw new DealError("NOT_FOUND", 404);
    // Historical participants may read their frozen deal even when today's
    // public profile is withdrawn. Confirmation uses that deal's approved brief.
    const version = ownDeal?.briefVersion ?? ctx.campaign.currentBriefVersion;
    const frozen = !!ownDeal?.agreement;
    const row = version ? await tx.campaignBrief.findUnique({ where: { campaignId_version: { campaignId: ctx.campaign.id, version } } }) : null;
    const content = row ? parseBriefContent(row.content) : null;
    let requirements = row?.approvedAt && row.approvedAt <= now && row.approvedByUserId === ctx.brandUserId && content?.approvedByUserId === ctx.brandUserId && content.inputRevision === row.inputRevision ? content.requirements : null;
    if (requirements && (requirements.campaignId !== ctx.campaign.id || requirements.version !== row!.version)) requirements = null;
    const blockedReasons: string[] = [];
    if (!requirements) blockedReasons.push("BRIEF_NOT_APPROVED");
    if (!visible) blockedReasons.push("CREATOR_NOT_EXECUTABLE");
    if (ownDeal && ctx.creator.userId !== originalCreatorUserId) blockedReasons.push("STALE_PARTICIPANTS");
    if (!frozen && requirements && (version !== ctx.campaign.currentBriefVersion || row?.inputRevision !== record(ctx.campaign.input).fieldsRevision || !["BRIEF_APPROVED", "SHORTLISTED", "IN_DEALS"].includes(ctx.campaign.status) || ctx.brand.countryCode !== requirements.brandCountryCode)) blockedReasons.push("STALE_BRIEF");
    if (frozen && requirements && (ctx.brand.countryCode !== ownDeal.agreement!.brandCountryCode || ctx.creator.countryCode !== ownDeal.agreement!.creatorCountryCode)) blockedReasons.push("POLICY_REVIEW_REQUIRED");
    if (!ctx.creator.userId) blockedReasons.push("CREATOR_UNCLAIMED");
    let templates: Awaited<ReturnType<typeof reviewedGoverningOptions>> = [];
    if (requirements) {
      if (!await offerVerificationSatisfied(tx, ctx.brandUserId, requirements, now, ctx.evidenceActors)) blockedReasons.push("BRAND_CONTACT_VERIFICATION_REQUIRED");
      try {
        const review = await resolveCampaignPolicyReview(tx, requirements, now, ctx.evidenceActors);
        if (!review || review.mandatoryPolicyVersionIds.slice().sort().join("|") !== requirements.mandatoryPolicyVersionIds.slice().sort().join("|")) blockedReasons.push("POLICY_REVIEW_REQUIRED");
        else if (ctx.creator.userId && !await loadEligibleCreator(tx, requirements, ctx.creator.id, now, { policyReader: reviewedMatchingPolicies, evidenceActors: ctx.evidenceActors, liveClock: resourceNow === undefined })) blockedReasons.push("CREATOR_NOT_ELIGIBLE");
        if (ctx.creator.countryCode) templates = await reviewedGoverningOptions(tx, requirements, ctx.creator.countryCode, now, ctx.evidenceActors);
        if (!templates.length) blockedReasons.push("REVIEWED_TERMS_UNAVAILABLE");
      } catch (error) {
        blockedReasons.push(error instanceof DealError ? error.code : "POLICY_UNAVAILABLE");
      }
    }
    if (query.matchRunId) {
      const run = await tx.matchRun.findUnique({ where: { id: query.matchRunId }, include: { results: { where: { creatorId: query.creatorId }, select: { score: true } } } });
      if (!run || run.campaignId !== query.campaignId || run.briefVersion !== requirements?.version || record(run.requirementSnapshot).fieldsRevision !== record(ctx.campaign.input).fieldsRevision || !run.results.some((result) => result.score >= 60)) throw new DealError("INVALID_MATCH_ORIGIN", 404);
    }
    const saved = await tx.offerDraft.findUnique({ where: { actorUserId_campaignId_creatorId: { actorUserId, campaignId: query.campaignId, creatorId: query.creatorId } } });
    return { kind: "CURRENT" as const, campaign: { id: ctx.campaign.id, title: ctx.campaign.title, revision: ctx.campaign.revision, currentBriefVersion: ctx.campaign.currentBriefVersion },
      creator: { id: ctx.creator.id, displayName: ownDeal?.agreement?.partiesSnapshot.creatorName ?? (visible ? ctx.creator.displayName : ""), handle: ownDeal?.agreement?.partiesSnapshot.creatorHandle ?? (visible ? ctx.creator.handle : ""), claimed: ctx.creator.userId !== null }, requirements,
      draft: saved ? { id: saved.id, campaignId: saved.campaignId, creatorId: saved.creatorId, revision: saved.revision, terms: OfferDraftTermsSchema.parse(saved.terms), createdAt: saved.createdAt.toISOString(), updatedAt: saved.updatedAt.toISOString() } : null,
      templates, readiness: { canSend: blockedReasons.length === 0, blockedReasons: [...new Set(blockedReasons)] }, origin: query.matchRunId ? "MATCH" as const : "DIRECT" as const, matchRunId: query.matchRunId ?? null };
}
export type CurrentDealComposeDTO = Awaited<ReturnType<typeof currentCompose>>;
export type DealComposeDTO = CurrentDealComposeDTO | RetainedDealComposeDTO;

export async function getDealComposeContext(actorUserId: string, input: unknown, client: PrismaClient = prisma, resourceNow?: Date,
  trusted: Pick<DealOptions, "serverAuth"> = {}): Promise<DealComposeDTO> {
  const session = await beginDealSession(actorUserId, { client, now: resourceNow, ...trusted });
  resourceNow = session.options.now;
  const parsed = DealComposeQuerySchema.safeParse(input);
  if (!parsed.success) throw new DealError("VALIDATION", 400);
  const query = parsed.data;
  if (!Number.isFinite((resourceNow ?? new Date()).getTime())) throw new DealError("INVALID_CLOCK", 400);
  return withDealSession(session, false, async tx => {
    if (!query.dealId) {
      const ctx = await dealParticipantContext(tx, actorUserId, query.campaignId, query.creatorId, false, undefined, "FRESH_READ");
      return currentCompose(tx, actorUserId, query, resourceNow, ctx, null);
    }
    const capture = await captureHistoricalDeal(tx, query.dealId);
    if (query.view !== "CURRENT_EXECUTION" || !capture) {
      const owners = await lockHistoricalUsers(tx, actorUserId, [capture], false);
      const frame = await lockHistoricalDeal(tx, capture, session.actor, false, owners);
      if (frame.deal.campaignId !== query.campaignId || frame.deal.creatorId !== query.creatorId) throw new DealError("NOT_FOUND", 404);
      if (query.matchRunId && query.matchRunId !== frame.deal.matchRunId) throw new DealError("INVALID_MATCH_ORIGIN", 404);
      const deal = await dealDTO(tx, frame.deal, actorUserId, resourceNow ?? new Date());
      const parties = deal.agreement?.partiesSnapshot;
      const history: RetainedDealComposeDTO = { kind: "HISTORY_ONLY", dealId: deal.id, approvedBrief: deal.approvedBrief,
        campaign: { id: deal.campaignId, title: deal.approvedBrief.content.requirements.title, briefVersion: deal.briefVersion },
        parties: { brand: { userId: frame.brandUserId, name: parties?.brandName ?? null },
          creator: { userId: frame.creatorUserId, name: parties?.creatorName ?? null, handle: parties?.creatorHandle ?? null } },
        readiness: { canSend: false, blockedReasons: ["HISTORY_ONLY"] }, origin: deal.origin, matchRunId: deal.matchRunId };
      return history;
    }
    // This explicitly requested current lane captures every original/current
    // owner and reviewer before the one native session lock. A history read
    // never enters it automatically, nor locks replacement-only identities.
    const actors = await lockEvidenceActors(tx, { brandIds: [capture.brandId], creatorIds: [capture.creatorId],
      otherOwnerIds: [actorUserId, capture.first.proposerUserId, capture.first.recipientUserId], includePolicies: true });
    await lockDealSession(tx);
    // Preserve current domain ordering before Deal, without private hydration.
    await tx.$queryRaw`SELECT id FROM "Brand" WHERE id=${capture.brandId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "Creator" WHERE id=${capture.creatorId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id=${capture.campaignId} FOR SHARE`;
    const frame = await lockHistoricalDeal(tx, capture, session.actor, false, actors.ownerIds);
    if (frame.deal.campaignId !== query.campaignId || frame.deal.creatorId !== query.creatorId) throw new DealError("NOT_FOUND", 404);
    if (actors.brandOwners.get(capture.brandId) !== frame.brandUserId || actors.creatorOwners.get(capture.creatorId) !== frame.creatorUserId) {
      throw new DealError("CURRENT_EXECUTION_UNAVAILABLE");
    }
    const ctx = await dealParticipantContext(tx, actorUserId, query.campaignId, query.creatorId, false,
      frame.creatorUserId, "HISTORY", actors);
    const deal = await dealDTO(tx, frame.deal, actorUserId, resourceNow ?? new Date());
    return currentCompose(tx, actorUserId, query, resourceNow, ctx, deal);
  });
}
