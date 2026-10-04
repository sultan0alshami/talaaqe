import { CampaignList } from "@/components/infame/campaign-list";
import { requirePageSession } from "@/lib/auth";
import { CampaignError, listCampaigns } from "@/lib/campaigns/service";

export default async function CampaignsPage() {
  const actor = await requirePageSession("BRAND");
  let list = null;
  let profileRequired = false;
  try {
    list = await listCampaigns(actor.userId);
  } catch (error) {
    if (
      error instanceof CampaignError &&
      error.code === "BRAND_PROFILE_REQUIRED"
    )
      profileRequired = true;
    else throw error;
  }
  return <CampaignList initialList={list} profileRequired={profileRequired} />;
}
