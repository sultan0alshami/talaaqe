import { parseBody, requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { applyCampaignMutation } from "@/lib/campaigns/service";
import { CampaignIdSchema, FormMutationSchema, type CampaignRouteContext } from "../../_schemas";

export const POST = domainHandler(async (request: Request, context: CampaignRouteContext) => {
  const session = await requireRole("BRAND");
  const { id } = await context.params;
  // Browser form input cannot supply a model/server capability or actor context.
  return applyCampaignMutation(session.userId, CampaignIdSchema.parse(id), await parseBody(request, FormMutationSchema));
});
