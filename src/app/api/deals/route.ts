import { parseBody, requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { CreateDealSchema } from "@/lib/deals/contracts";
import { createDealOffer, listDeals } from "@/lib/deals/service";
import { reviewedDealPolicies, reviewedMatchingPolicies } from "@/lib/policies";
import { listQuery } from "./_schemas";

export const GET = domainHandler(async (request: Request) => {
  const actor = await requireRole("BRAND", "CREATOR");
  return listDeals(actor.userId, listQuery(request));
});
export const POST = domainHandler(async (request: Request) => {
  const actor = await requireRole("BRAND");
  return createDealOffer(
    actor.userId,
    await parseBody(request, CreateDealSchema),
    {
      policyVerifier: reviewedDealPolicies,
      policyReader: reviewedMatchingPolicies,
    },
  );
});
