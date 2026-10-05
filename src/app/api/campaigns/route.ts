import { parseBody, requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { createCampaign, listCampaigns } from "@/lib/campaigns/service";
import { CreateInputSchema, ListInputSchema } from "./_schemas";

export const GET = domainHandler(async (request: Request) => {
  const session = await requireRole("BRAND");
  const query = ListInputSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return listCampaigns(session.userId, query, undefined, session);
});
export const POST = domainHandler(async (request: Request) => {
  const session = await requireRole("BRAND");
  return createCampaign(session.userId, await parseBody(request, CreateInputSchema), undefined, session);
});
