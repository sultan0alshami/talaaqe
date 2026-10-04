import { notFound } from "next/navigation";
import { MatchesScreen, type MatchingCampaignSummary } from "@/components/infame/matches-screen";
import { requirePageSession } from "@/lib/auth";
import { CampaignError, getCampaign } from "@/lib/campaigns/service";
import { MatchingError, getCampaignMatches } from "@/lib/matching/persistence";
import { reviewedMatchingPolicies } from "@/lib/policies";

export default async function MatchesPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageSession("BRAND"), { id } = await params;
  let campaign;
  try { campaign = await getCampaign(actor.userId, id); }
  catch (error) {
    if (error instanceof CampaignError && ["NOT_FOUND", "BRAND_PROFILE_REQUIRED"].includes(error.code)) notFound();
    throw error;
  }
  let run = null, accessUnavailable = false, readinessError: string | null = null;
  try { run = await getCampaignMatches(actor.userId, id, undefined, { policyReader: reviewedMatchingPolicies }); }
  catch (error) {
    if (error instanceof MatchingError && error.code === "NOT_FOUND") notFound();
    if (error instanceof MatchingError && error.code === "FORBIDDEN") accessUnavailable = true;
    else if (error instanceof Error && "code" in error && error.code === "POLICY_UNAVAILABLE") readinessError = "POLICY_UNAVAILABLE";
    else throw error;
  }
  const summary: MatchingCampaignSummary = { id: campaign.id, title: campaign.title, revision: campaign.revision, currentBriefVersion: campaign.currentBriefVersion, status: campaign.status,
    policyReviewed: !!campaign.briefs.find((brief) => brief.version === campaign.currentBriefVersion)?.content.policyReview };
  // No onboarding transcript, draft proposals or mutable requirement input crosses
  // into this screen. The domain projects current permissions on every read.
  return <MatchesScreen key={campaign.id} initialCampaign={summary} initialRun={run} accessUnavailable={accessUnavailable} initialReadinessError={readinessError} />;
}
