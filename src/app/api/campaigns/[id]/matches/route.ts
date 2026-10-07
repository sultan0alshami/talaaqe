import { z } from "zod";
import { parseBody, requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { getCampaignMatches, runCampaignMatching } from "@/lib/matching/persistence";
import { reviewedMatchingPolicies } from "@/lib/policies";

type Context = { params: Promise<{ id: string }> };
// Bounded body reading happens here; the domain's strict command schema remains
// authoritative and accepts no policy capability, actor identity or clock.
export const GET = domainHandler(async (request: Request, context: Context) => {
  const actor = await requireRole("BRAND"), { id } = await context.params;
  const query = z.object({ runId: z.string().min(1).max(200).optional() }).strict().parse(Object.fromEntries(new URL(request.url).searchParams));
  return getCampaignMatches(actor.userId, id, query.runId, { policyReader: reviewedMatchingPolicies, serverAuth: actor });
});
export const POST = domainHandler(async (request: Request, context: Context) => {
  const actor = await requireRole("BRAND"), { id } = await context.params;
  return runCampaignMatching(actor.userId, id, await parseBody(request, z.unknown()), { policyReader: reviewedMatchingPolicies, serverAuth: actor });
});
