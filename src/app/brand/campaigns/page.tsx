import { CampaignList } from "@/components/infame/campaign-list";
import { PlanningCampaignListScreen } from "@/components/infame/campaign-planning";
import { notFound, redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { getCampaignListPageContext, campaignPlanningPageError } from "@/lib/campaign-planning/page-context";

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageSession("BRAND");
  let page;
  try {
    page = await getCampaignListPageContext(actor, await searchParams);
  } catch (error) {
    const code = campaignPlanningPageError(error);
    if (code === "UNAUTHENTICATED") redirect("/login");
    if (code === "NOT_FOUND" || code === "VALIDATION") notFound();
    throw error;
  }
  return page.kind === "LEGACY_LIST" ? <CampaignList initialList={page.initialList} profileRequired={page.profileRequired} />
    : <PlanningCampaignListScreen key={`${actor.userId}:${page.props.scope?.kind === "CLIENT" ? page.props.scope.clientId : "own"}`} {...page.props} />;
}
