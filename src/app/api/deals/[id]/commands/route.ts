import { parseBody, requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { DealCommandSchema } from "@/lib/deals/contracts";
import { applyDealCommand } from "@/lib/deals/service";
import { reviewedDealPolicies, reviewedMatchingPolicies } from "@/lib/policies";

export const POST = domainHandler(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const actor = await requireRole("BRAND", "CREATOR");
    return applyDealCommand(
      actor.userId,
      (await context.params).id,
      await parseBody(request, DealCommandSchema),
      {
        serverAuth: actor,
      policyVerifier: reviewedDealPolicies,
        policyReader: reviewedMatchingPolicies,
      },
    );
  },
);
