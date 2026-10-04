import { z } from "zod";
import { parseBody, requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { decideCampaignMatch } from "@/lib/matching/persistence";
import { reviewedMatchingPolicies } from "@/lib/policies";

export const POST = domainHandler(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const actor = await requireRole("BRAND"), { id } = await context.params;
  return decideCampaignMatch(actor.userId, id, await parseBody(request, z.unknown()), { policyReader: reviewedMatchingPolicies });
});
