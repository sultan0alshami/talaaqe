import { z } from "zod";
import { requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { getDealComposeContext } from "@/lib/deals/readiness";

export const GET = domainHandler(async (request: Request) => {
  const actor = await requireRole("BRAND", "CREATOR"),
    params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => params.getAll(key).length !== 1))
    throw new z.ZodError([
      { code: "custom", path: [], message: "Duplicate query parameter" },
    ]);
  return getDealComposeContext(actor.userId, Object.fromEntries(params), undefined, undefined, { serverAuth: actor });
});
