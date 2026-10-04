import { requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { getOfferDraft } from "@/lib/deals/drafts";

export const GET = domainHandler(
  async (_request: Request, context: { params: Promise<{ id: string }> }) => {
    const actor = await requireRole("BRAND", "CREATOR");
    return getOfferDraft(actor.userId, (await context.params).id);
  },
);
