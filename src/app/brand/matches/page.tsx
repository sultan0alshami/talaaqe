import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { CampaignPlanningError } from "@/lib/campaign-planning/contracts";
import { selectLegacyOwnerCampaign } from "@/lib/campaign-planning/legacy";
import { loadMatchingPage } from "@/lib/matching/page";
import { MatchesScreen } from "@/components/infame/matches-screen";
import { MatchesScreen as EmptyMatches } from "@/components/screens/client/matches-screen";

export default async function BrandMatchesPage({ searchParams }: { searchParams: Promise<{ campaign?: string | string[] }> }) {
  const actor = await requirePageSession("BRAND"), { campaign: campaignId } = await searchParams;
  if (Array.isArray(campaignId) || (campaignId?.length ?? 0) > 200) notFound();
  let row;
  try { row = await selectLegacyOwnerCampaign(actor, { campaignId, approvedOnly: !campaignId }); }
  catch (error) { if (error instanceof CampaignPlanningError && error.code === "NOT_FOUND") notFound(); throw error; }
  if (!row) return <EmptyMatches key="empty" matches={[]} projectId={null} titleAr="" titleEn="" />;
  const { summary, run, accessUnavailable, readinessError } = await loadMatchingPage(actor.userId, row.id, actor);
  return <MatchesScreen key={row.id} initialCampaign={summary} initialRun={run} accessUnavailable={accessUnavailable} initialReadinessError={readinessError} />;
}
