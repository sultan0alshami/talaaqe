import { parseBody, requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { generateCampaignBrief } from "@/lib/campaigns/service";
import { CampaignIdSchema, CommandInputSchema, type CampaignRouteContext } from "../../../_schemas";

export const POST = domainHandler(async (request: Request, context: CampaignRouteContext) => {
  const session = await requireRole("BRAND");
  const { id } = await context.params;
  // Deterministic generation uses the complete explicit fields; there is no AI call.
  return generateCampaignBrief(session.userId, CampaignIdSchema.parse(id), await parseBody(request, CommandInputSchema), undefined, session);
});
