import { notFound } from "next/navigation";
import { DealScreen } from "@/components/infame/deal-screen";
import { requirePageSession } from "@/lib/auth";
import { DealError } from "@/lib/deals/contracts";
import { getDeal } from "@/lib/deals/service";
import { getDealComposeContext } from "@/lib/deals/readiness";

export default async function BrandDealPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requirePageSession("BRAND"),
    { id } = await params;
  let deal;
  try {
    deal = await getDeal(actor.userId, id, { serverAuth: actor });
  } catch (error) {
    if (error instanceof DealError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  let context,
    unavailable = "POLICY_UNAVAILABLE";
  try {
    context = await getDealComposeContext(actor.userId, {
      campaignId: deal.campaignId,
      creatorId: deal.creatorId,
      dealId: deal.id,
      view: "CURRENT_EXECUTION",
    }, undefined, undefined, { serverAuth: actor });
  } catch (error) {
    if (!(error instanceof DealError) || error.status === 401 || error.status === 403) throw error;
    unavailable =
      error.code === "NOT_FOUND"
        ? "COMMERCIAL_CONTEXT_UNAVAILABLE"
        : error.code;
  }
  const current = context?.kind === "CURRENT" ? context : undefined;
  return (
    <DealScreen
      initialDeal={deal}
      actorUserId={actor.userId}
      role="BRAND"
      initialDraft={current?.draft}
      readiness={{
        requirements: deal.approvedBrief.content.requirements,
        templates: current?.templates ?? [],
        mandatoryPolicyVersionIds:
          current?.requirements?.mandatoryPolicyVersionIds ?? [],
        blockedReasons: current?.readiness.blockedReasons ?? [unavailable],
      }}
    />
  );
}
