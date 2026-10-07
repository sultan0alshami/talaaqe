import { notFound, redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { getCampaignBriefPageContext, campaignPlanningPageError } from "@/lib/campaign-planning/page-context";
import { CampaignScreen } from "@/components/infame/campaign-screen";
import { CampaignPlanningScreen, PlanningCampaignListScreen } from "@/components/infame/campaign-planning";
import { BriefScreen } from "@/components/screens/client/brief-screen";

export default async function BrandBriefPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageSession("BRAND");
  let page;
  try { page = await getCampaignBriefPageContext(actor, await searchParams); }
  catch (error) {
    const code = campaignPlanningPageError(error);
    if (code === "UNAUTHENTICATED") redirect("/login");
    if (code === "NOT_FOUND" || code === "VALIDATION") notFound();
    throw error;
  }
  if (page.kind === "EMPTY") return <BriefScreen key="empty" brief={null} projectId={null} />;
  if (page.kind === "LEGACY") return <CampaignScreen key={page.initialCampaign.id} initialCampaign={page.initialCampaign} />;
  if (page.kind === "PLANNING") return <CampaignPlanningScreen key={`${actor.userId}:${page.props.scope?.kind === "CLIENT" ? page.props.scope.clientId : "own"}:${page.props.campaignId}`} {...page.props} actorReference={actor.userId} />;
  if (page.kind === "PLANNING_LIST") return <PlanningCampaignListScreen key={`${actor.userId}:${page.props.scope?.kind === "CLIENT" ? page.props.scope.clientId : "own"}`} {...page.props} />;
  return <BriefScreen key="empty" brief={null} projectId={null} />;
}
