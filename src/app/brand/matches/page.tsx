import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadMatchingPage } from "@/lib/matching/page";
import { MatchesScreen } from "@/components/infame/matches-screen";
import { MatchesScreen as EmptyMatches } from "@/components/screens/client/matches-screen";

export default async function BrandMatchesPage({ searchParams }: { searchParams: Promise<{ campaign?: string | string[] }> }) {
  const actor = await requirePageSession("BRAND"), { campaign: campaignId } = await searchParams;
  if (Array.isArray(campaignId) || (campaignId?.length ?? 0) > 200) notFound();
  const where = { brand: { userId: actor.userId }, ...(campaignId ? { id: campaignId } : {}) };
  const row = await prisma.campaign.findFirst({ where: { ...where, ...(!campaignId ? { currentBriefVersion: { not: null } } : {}) },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }], select: { id: true } });
  if (campaignId && !row) notFound();
  if (!row) return <EmptyMatches key="empty" matches={[]} projectId={null} titleAr="" titleEn="" />;
  const { summary, run, accessUnavailable, readinessError } = await loadMatchingPage(actor.userId, row.id);
  return <MatchesScreen key={row.id} initialCampaign={summary} initialRun={run} accessUnavailable={accessUnavailable} initialReadinessError={readinessError} />;
}
