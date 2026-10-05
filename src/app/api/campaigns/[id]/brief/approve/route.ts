import { parseBody, requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { approveCampaignBrief } from "@/lib/campaigns/service";
import { prisma } from "@/lib/prisma";
import { resolveCampaignPolicyReview } from "@/lib/policies";
import { ApprovalInputSchema, CampaignIdSchema, type CampaignRouteContext } from "../../../_schemas";

export const POST = domainHandler(async (request: Request, context: CampaignRouteContext) => {
  const session = await requireRole("BRAND");
  const { id } = await context.params;
  // Policy review comes only from a reviewed server resolver when available.
  return approveCampaignBrief(session.userId, CampaignIdSchema.parse(id), await parseBody(request, ApprovalInputSchema), prisma,
    { channel: "FORM", policyReviewResolver: resolveCampaignPolicyReview, serverAuth: session });
});
