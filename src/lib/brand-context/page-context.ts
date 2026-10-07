import { z } from "zod";
import { captureOrganizationActor, checkOrganizationActor, type OrganizationActor } from "@/lib/organizations/context";
import { OrganizationIdSchema } from "@/lib/organizations/contracts";
import { getClientAuthority } from "@/lib/organizations/loaders";
import { getOwnReferences } from "@/lib/organizations/management";
import { BrandContextError, parseBrandContextInput, type PlanningScope } from "./contracts";
import { listBrandContexts } from "./service";
import type { BrandContextScreenProps } from "./ui-contract";

export async function getBrandContextPageContext(actorInput: OrganizationActor,
  search: Record<string, string | string[] | undefined>): Promise<BrandContextScreenProps> {
  const actor = captureOrganizationActor(actorInput);
  await checkOrganizationActor(actor);
  const query = parseBrandContextInput(z.object({ clientId: OrganizationIdSchema.optional() }).strict(), search);
  let scope: PlanningScope | null = null;
  if (query.clientId !== undefined) scope = { kind: "CLIENT", clientId: query.clientId };
  else {
    const own = await getOwnReferences(actor);
    if (own.brandId) scope = { kind: "OWN_BRAND", brandId: own.brandId };
  }
  if (!scope) return { scope: null, initialPage: null, planAuthority: null };
  let planAuthority = null;
  if (scope.kind === "CLIENT") {
    try { planAuthority = await getClientAuthority(actor, scope.clientId, "plan"); }
    catch (error) {
      if (!(error instanceof Error && "status" in error && error.status === 404)) throw error;
    }
  }
  // Finish with the authorized view read: a failed optional plan lookup must
  // never leave an earlier private view snapshot as the last authority check.
  const initialPage = await listBrandContexts(actor, { scope });
  if (planAuthority && initialPage.currentAuthority) {
    const current = initialPage.currentAuthority;
    const fields = ["organizationId", "clientId", "brandId", "membershipId", "grantId", "organizationRevision",
      "membershipRevision", "clientRevision", "grantRevision"] as const;
    if (fields.some(field => planAuthority![field] !== current[field])) planAuthority = null;
  }
  return { scope, initialPage, planAuthority };
}
export function brandContextPageError(error: unknown): string {
  if (error instanceof Error && "status" in error) {
    if (error.status === 401) return "UNAUTHENTICATED";
    if (error.status === 403) return "FORBIDDEN";
    if (error.status === 404) return "NOT_FOUND";
  }
  return error instanceof BrandContextError && error.code === "VALIDATION" ? "VALIDATION" : "RETRY_REQUIRED";
}
