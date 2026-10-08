import { requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { getDeal } from "@/lib/deals/service";

export const GET = domainHandler(
  async (_request: Request, context: { params: Promise<{ id: string }> }) => {
    const actor = await requireRole("BRAND", "CREATOR");
    return getDeal(actor.userId, (await context.params).id, { serverAuth: actor });
  },
);
