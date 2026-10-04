import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCampaign } from "@/lib/campaigns/service";
import { CampaignScreen } from "@/components/infame/campaign-screen";
import { BriefScreen } from "@/components/screens/client/brief-screen";

export default async function BrandBriefPage({ searchParams }: { searchParams: Promise<{ campaign?: string | string[] }> }) {
  const actor = await requirePageSession("BRAND"), { campaign: campaignId } = await searchParams;
  if (Array.isArray(campaignId) || (campaignId?.length ?? 0) > 200) notFound();
  const row = await prisma.campaign.findFirst({ where: { brand: { userId: actor.userId }, ...(campaignId ? { id: campaignId } : {}) },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }], select: { id: true } });
  if (campaignId && !row) notFound();
  if (!row) return <BriefScreen key="empty" brief={null} projectId={null} />;
  return <CampaignScreen key={row.id} initialCampaign={await getCampaign(actor.userId, row.id)} />;
}
