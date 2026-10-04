import { requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { getCampaign } from "@/lib/campaigns/service";
import { CampaignIdSchema, type CampaignRouteContext } from "../_schemas";

export const GET = domainHandler(async (_request: Request, context: CampaignRouteContext) => {
  void _request;
  const session = await requireRole("BRAND");
  const { id } = await context.params;
  return getCampaign(session.userId, CampaignIdSchema.parse(id));
});
