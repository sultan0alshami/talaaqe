import { notFound } from "next/navigation";
import { MatchingCampaignSummarySchema, summarizeMatchingCampaign } from "./contracts";
import { CampaignError, getCampaign, type CampaignServerAuth } from "@/lib/campaigns/service";
import { MatchingError, getCampaignMatches } from "@/lib/matching/persistence";
import { reviewedMatchingPolicies } from "@/lib/policies";
import { CampaignPlanningError } from "@/lib/campaign-planning/contracts";

// Reused by the campaign leaf and Talaqee's original sidebar destination.
// Both domain reads recheck the active actor and owned campaign independently.
export async function loadMatchingPage(actorUserId: string, campaignId: string, serverAuth?: CampaignServerAuth) {
  let campaign;
  try { campaign = await getCampaign(actorUserId, campaignId, undefined, serverAuth); }
  catch (error) {
    if ((error instanceof CampaignError || error instanceof CampaignPlanningError) && ["NOT_FOUND", "BRAND_PROFILE_REQUIRED"].includes(error.code)) notFound();
    throw error;
  }
  let run = null, accessUnavailable = false, readinessError: string | null = null;
  try { run = await getCampaignMatches(actorUserId, campaignId, undefined, { policyReader: reviewedMatchingPolicies, serverAuth }); }
  catch (error) {
    if ((error instanceof MatchingError || error instanceof CampaignPlanningError) && error.code === "NOT_FOUND") notFound();
    if (error instanceof MatchingError && error.code === "FORBIDDEN") accessUnavailable = true;
    else if (error instanceof Error && "code" in error && error.code === "POLICY_UNAVAILABLE") readinessError = "POLICY_UNAVAILABLE";
    else throw error;
  }
  const summary = MatchingCampaignSummarySchema.parse(summarizeMatchingCampaign(campaign));
  return { summary, run, accessUnavailable, readinessError };
}
