import { parseBody, requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { saveOfferDraft } from "@/lib/deals/drafts";
import { DraftSchema } from "../_schemas";

export const POST = domainHandler(async (request: Request) => {
  const actor = await requireRole("BRAND", "CREATOR");
  return saveOfferDraft(actor.userId, await parseBody(request, DraftSchema), { serverAuth: actor });
});
