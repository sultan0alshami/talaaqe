import { notFound, redirect } from "next/navigation";
import { CampaignScreen } from "@/components/infame/campaign-screen";
import { CampaignPlanningScreen } from "@/components/infame/campaign-planning";
import { requirePageSession } from "@/lib/auth";
import { getCampaignDetailPageContext, campaignPlanningPageError } from "@/lib/campaign-planning/page-context";

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePageSession("BRAND");
  const { id } = await params;
  let page;
  try {
    page = await getCampaignDetailPageContext(actor, id, await searchParams);
  } catch (error) {
    const code = campaignPlanningPageError(error);
    if (code === "UNAUTHENTICATED") redirect("/login");
    if (code === "NOT_FOUND" || code === "VALIDATION") notFound();
    throw error;
  }
  return page.kind === "LEGACY" ? <CampaignScreen key={page.initialCampaign.id} initialCampaign={page.initialCampaign} />
    : <CampaignPlanningScreen key={`${actor.userId}:${page.props.scope?.kind === "CLIENT" ? page.props.scope.clientId : "own"}:${page.props.campaignId}`} {...page.props} />;
}
