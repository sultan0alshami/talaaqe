import { notFound, redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { CampaignPlanningOwnerReviewsScreen } from "@/components/infame/campaign-planning";
import { getCampaignOwnerReviewsPageContext, campaignPlanningPageError } from "@/lib/campaign-planning/page-context";

export default async function CampaignReviewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageSession("BRAND");
  let props;
  try { props = await getCampaignOwnerReviewsPageContext(actor, await searchParams); }
  catch (error) {
    const code = campaignPlanningPageError(error);
    if (code === "UNAUTHENTICATED") redirect("/login");
    if (code === "NOT_FOUND" || code === "VALIDATION") notFound();
    throw error;
  }
  return <CampaignPlanningOwnerReviewsScreen key={actor.userId} {...props} />;
}
