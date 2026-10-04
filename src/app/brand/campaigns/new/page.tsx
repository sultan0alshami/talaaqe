import { CampaignScreen } from "@/components/infame/campaign-screen";
import { requirePageSession } from "@/lib/auth";

export default async function NewCampaignPage() {
  await requirePageSession("BRAND");
  return <CampaignScreen initialCampaign={null} />;
}
