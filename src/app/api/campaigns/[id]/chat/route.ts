import { requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { CampaignError, getCampaign } from "@/lib/campaigns/service";
import { CampaignIdSchema, type CampaignRouteContext } from "../../_schemas";

export const POST = domainHandler(async (_request: Request, context: CampaignRouteContext) => {
  void _request;
  const session = await requireRole("BRAND");
  const { id } = await context.params;
  await getCampaign(session.userId, CampaignIdSchema.parse(id));
  throw new CampaignError("CAPABILITY_UNAVAILABLE", 503);
});
