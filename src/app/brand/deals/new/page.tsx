import { notFound } from "next/navigation";
import { DealCompose } from "@/components/infame/deal-compose";
import { requirePageSession } from "@/lib/auth";
import { DealError } from "@/lib/deals/contracts";
import { getDealComposeContext } from "@/lib/deals/readiness";

export default async function NewDealPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePageSession("BRAND");
  let context;
  try {
    context = await getDealComposeContext(actor.userId, await searchParams);
  } catch (error) {
    if (
      error instanceof DealError &&
      ["NOT_FOUND", "VALIDATION", "INVALID_MATCH_ORIGIN"].includes(error.code)
    )
      notFound();
    throw error;
  }
  return <DealCompose initialContext={context} actorUserId={actor.userId} />;
}
