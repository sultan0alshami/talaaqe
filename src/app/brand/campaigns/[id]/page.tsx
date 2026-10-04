import { notFound } from "next/navigation";
import { CampaignScreen } from "@/components/infame/campaign-screen";
import { requirePageSession } from "@/lib/auth";
import { CampaignError, getCampaign } from "@/lib/campaigns/service";

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requirePageSession("BRAND");
  const { id } = await params;
  let campaign;
  try {
    campaign = await getCampaign(actor.userId, id);
  } catch (error) {
    if (
      error instanceof CampaignError &&
      (error.code === "NOT_FOUND" || error.code === "BRAND_PROFILE_REQUIRED")
    )
      notFound();
    throw error;
  }
  return <CampaignScreen key={campaign.id} initialCampaign={campaign} />;
}
