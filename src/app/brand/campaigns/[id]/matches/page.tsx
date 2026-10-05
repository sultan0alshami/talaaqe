import { MatchesScreen } from "@/components/infame/matches-screen";
import { requirePageSession } from "@/lib/auth";
import { loadMatchingPage } from "@/lib/matching/page";

export default async function MatchesPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageSession("BRAND"), { id } = await params;
  const { summary, run, accessUnavailable, readinessError } = await loadMatchingPage(actor.userId, id, actor);
  // No onboarding transcript, draft proposals or mutable requirement input crosses
  // into this screen. The domain projects current permissions on every read.
  return <MatchesScreen key={summary.id} initialCampaign={summary} initialRun={run} accessUnavailable={accessUnavailable} initialReadinessError={readinessError} />;
}
