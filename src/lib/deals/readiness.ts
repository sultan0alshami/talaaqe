import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseBriefContent } from "@/lib/campaigns/contracts";
import { publicCreator } from "@/lib/onboarding/profiles";
import { record } from "@/lib/onboarding/drafts";
import { loadEligibleCreator } from "@/lib/matching/persistence";
import { offerVerificationSatisfied } from "@/lib/offer-verification";
import { reviewedGoverningOptions, reviewedMatchingPolicies, resolveCampaignPolicyReview } from "@/lib/policies";
import { DealError } from "./contracts";
import { dealParticipantContext, getDeal } from "./service";
import { OfferDraftTermsSchema } from "./drafts";

const id = z.string().min(1).max(200).regex(/^[\x21-\x7e]+$/);
const QuerySchema = z.object({ campaignId: id, creatorId: id, dealId: id.optional(), matchRunId: id.optional() }).strict();
export async function getDealComposeContext(actorUserId: string, input: unknown, client: PrismaClient = prisma, now = new Date()) {
  const parsed = QuerySchema.safeParse(input);
  if (!parsed.success) throw new DealError("VALIDATION", 400);
  const query = parsed.data;
  if (!Number.isFinite(now.getTime())) throw new DealError("INVALID_CLOCK", 400);
  const ownDeal = query.dealId ? await getDeal(actorUserId, query.dealId, { client, now }) : null;
  if (ownDeal && (ownDeal.campaignId !== query.campaignId || ownDeal.creatorId !== query.creatorId)) throw new DealError("NOT_FOUND", 404);
  return client.$transaction(async (tx) => {
    const originalCreatorUserId = ownDeal?.offers.find((offer) => offer.version === 1)?.recipientUserId;
    const ctx = await dealParticipantContext(tx, actorUserId, query.campaignId, query.creatorId, false, originalCreatorUserId);
    if (ctx.role === "CREATOR" && !ownDeal) throw new DealError("NOT_FOUND", 404);
    const visible = !ctx.creator.isTest && ctx.creator.state === "PUBLISHED" && ctx.creator.brandVisible && (!ctx.creator.userId || !!await publicCreator(ctx.creator.handle, tx));
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
      if (!await offerVerificationSatisfied(tx, ctx.brandUserId, requirements, now)) blockedReasons.push("BRAND_CONTACT_VERIFICATION_REQUIRED");
      try {
        const review = await resolveCampaignPolicyReview(tx, requirements, now);
        if (!review || review.mandatoryPolicyVersionIds.slice().sort().join("|") !== requirements.mandatoryPolicyVersionIds.slice().sort().join("|")) blockedReasons.push("POLICY_REVIEW_REQUIRED");
        else if (ctx.creator.userId && !await loadEligibleCreator(tx, requirements, ctx.creator.id, now, { policyReader: reviewedMatchingPolicies })) blockedReasons.push("CREATOR_NOT_ELIGIBLE");
        if (ctx.creator.countryCode) templates = await reviewedGoverningOptions(tx, requirements, ctx.creator.countryCode, now);
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
    return { campaign: { id: ctx.campaign.id, title: ctx.campaign.title, revision: ctx.campaign.revision, currentBriefVersion: ctx.campaign.currentBriefVersion },
      creator: { id: ctx.creator.id, displayName: ownDeal?.agreement?.partiesSnapshot.creatorName ?? (visible ? ctx.creator.displayName : ""), handle: ownDeal?.agreement?.partiesSnapshot.creatorHandle ?? (visible ? ctx.creator.handle : ""), claimed: ctx.creator.userId !== null }, requirements,
      draft: saved ? { id: saved.id, campaignId: saved.campaignId, creatorId: saved.creatorId, revision: saved.revision, terms: OfferDraftTermsSchema.parse(saved.terms), createdAt: saved.createdAt.toISOString(), updatedAt: saved.updatedAt.toISOString() } : null,
      templates, readiness: { canSend: blockedReasons.length === 0, blockedReasons: [...new Set(blockedReasons)] }, origin: query.matchRunId ? "MATCH" as const : "DIRECT" as const, matchRunId: query.matchRunId ?? null };
  }, { maxWait: 10_000, timeout: 20_000 });
}
export type DealComposeDTO = Awaited<ReturnType<typeof getDealComposeContext>>;
