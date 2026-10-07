import { notFound, redirect } from "next/navigation";
import { CampaignPlanningScreen } from "@/components/infame/campaign-planning";
import { requirePageSession } from "@/lib/auth";
import { getNewCampaignPageContext, campaignPlanningPageError } from "@/lib/campaign-planning/page-context";

export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageSession("BRAND");
  let props;
  try { props = await getNewCampaignPageContext(actor, await searchParams); }
  catch (error) {
    const code = campaignPlanningPageError(error);
    if (code === "UNAUTHENTICATED") redirect("/login");
    if (code === "NOT_FOUND" || code === "VALIDATION") notFound();
    throw error;
  }
  return <CampaignPlanningScreen key={`${actor.userId}:${props.scope?.kind}:${props.scope?.kind === "CLIENT" ? props.scope.clientId : props.scope?.brandId ?? "none"}:new`} {...props} actorReference={actor.userId} />;
}
