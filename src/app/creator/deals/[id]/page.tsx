import { notFound } from "next/navigation";
import { DealScreen } from "@/components/infame/deal-screen";
import { requirePageSession } from "@/lib/auth";
import { DealError } from "@/lib/deals/contracts";
import { getDeal } from "@/lib/deals/service";
import { getDealComposeContext } from "@/lib/deals/readiness";

export default async function CreatorDealPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requirePageSession("CREATOR"),
    { id } = await params;
  let deal;
  try {
    deal = await getDeal(actor.userId, id);
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
    });
  } catch (error) {
    if (!(error instanceof DealError)) throw error;
    unavailable =
      error.code === "NOT_FOUND"
        ? "COMMERCIAL_CONTEXT_UNAVAILABLE"
        : error.code;
  }
  return (
    <DealScreen
      initialDeal={deal}
      actorUserId={actor.userId}
      role="CREATOR"
      initialDraft={context?.draft}
      readiness={{
        requirements: context?.requirements ?? null,
        templates: context?.templates ?? [],
        mandatoryPolicyVersionIds:
          context?.requirements?.mandatoryPolicyVersionIds ?? [],
        blockedReasons: context?.readiness.blockedReasons ?? [unavailable],
      }}
    />
  );
}
