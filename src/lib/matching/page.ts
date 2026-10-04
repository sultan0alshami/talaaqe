import { notFound } from "next/navigation";
import type { MatchingCampaignSummary } from "@/components/infame/matches-screen";
import { CampaignError, getCampaign } from "@/lib/campaigns/service";
import { MatchingError, getCampaignMatches } from "@/lib/matching/persistence";
import { reviewedMatchingPolicies } from "@/lib/policies";

// Reused by the campaign leaf and Talaqee's original sidebar destination.
// Both domain reads recheck the active actor and owned campaign independently.
export async function loadMatchingPage(actorUserId: string, campaignId: string) {
  let campaign;
  try { campaign = await getCampaign(actorUserId, campaignId); }
  catch (error) {
    if (error instanceof CampaignError && ["NOT_FOUND", "BRAND_PROFILE_REQUIRED"].includes(error.code)) notFound();
    throw error;
  }
  let run = null, accessUnavailable = false, readinessError: string | null = null;
  try { run = await getCampaignMatches(actorUserId, campaignId, undefined, { policyReader: reviewedMatchingPolicies }); }
  catch (error) {
    if (error instanceof MatchingError && error.code === "NOT_FOUND") notFound();
    if (error instanceof MatchingError && error.code === "FORBIDDEN") accessUnavailable = true;
    else if (error instanceof Error && "code" in error && error.code === "POLICY_UNAVAILABLE") readinessError = "POLICY_UNAVAILABLE";
    else throw error;
  }
  const summary: MatchingCampaignSummary = { id: campaign.id, title: campaign.title, revision: campaign.revision, currentBriefVersion: campaign.currentBriefVersion, status: campaign.status,
    policyReviewed: !!campaign.briefs.find((brief) => brief.version === campaign.currentBriefVersion)?.content.policyReview };
  return { summary, run, accessUnavailable, readinessError };
}
