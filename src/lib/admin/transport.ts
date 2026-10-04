import { requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { AdminReadError } from "./contracts";
import { getAdminOverview } from "./overview";

export const loadAdminOverview = domainHandler(async (request: Request) => {
  const actor = await requireRole("ADMIN");
  if (new URL(request.url).search) throw new AdminReadError("VALIDATION", 422);
  return getAdminOverview(actor);
});
