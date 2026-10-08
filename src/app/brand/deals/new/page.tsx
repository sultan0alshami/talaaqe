import { notFound } from "next/navigation";
import { z } from "zod";
import { DealCompose } from "@/components/infame/deal-compose";
import { requirePageSession } from "@/lib/auth";
import { DealError } from "@/lib/deals/contracts";
import { getDealComposeContext } from "@/lib/deals/readiness";
import { CampaignPlanningError } from "@/lib/campaign-planning/contracts";

const id = z.string().min(1).max(200).regex(/^[\x21-\x7e]+$/);
// This page creates a new offer. Historical deal context belongs to the actual
// deal-detail/counter lane and cannot select HISTORY for this fresh composer.
const NewDealQuerySchema = z.object({ campaignId: id, creatorId: id, matchRunId: id.optional() }).strict();

export default async function NewDealPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePageSession("BRAND");
  const query = NewDealQuerySchema.safeParse(await searchParams);
  if (!query.success) notFound();
  let context;
  try {
    context = await getDealComposeContext(actor.userId, query.data, undefined, undefined, { serverAuth: actor });
  } catch (error) {
    if (
      (error instanceof DealError || error instanceof CampaignPlanningError) &&
      ["NOT_FOUND", "VALIDATION", "INVALID_MATCH_ORIGIN", "MANAGED_CAMPAIGN_REQUIRED"].includes(error.code)
    )
      notFound();
    throw error;
  }
  if (context.kind !== "CURRENT") notFound();
  return <DealCompose initialContext={context} actorUserId={actor.userId} />;
}
