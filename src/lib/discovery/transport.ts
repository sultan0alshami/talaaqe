import { requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { checkOrganizationActor } from "@/lib/organizations/context";
import { DiscoveryError } from "./contracts";
import { getDiscoveryPage } from "./service";

export const loadDiscoveryCreators = domainHandler(async (request: Request) => {
  const actor = await requireRole("BRAND");
  await checkOrganizationActor(actor);
  const entries = [...new URL(request.url).searchParams];
  if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new DiscoveryError("VALIDATION", 422);
  return getDiscoveryPage(actor, Object.fromEntries(entries));
});
