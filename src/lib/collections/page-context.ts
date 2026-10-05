import { z } from "zod";
import { checkOrganizationActor, type OrganizationActor } from "@/lib/organizations/context";
import { OrganizationIdSchema, type ClientAuthorityDTO } from "@/lib/organizations/contracts";
import { getClientAuthority } from "@/lib/organizations/loaders";
import { getOwnReferences } from "@/lib/organizations/management";
import { CollectionError, parseCollectionInput, type CollectionHeadersPage, type CollectionScope } from "./contracts";
import { getCollectionHeaders } from "./loaders";

export type CollectionPageContext = {
  scope: CollectionScope | null; initialPage: CollectionHeadersPage | null; planAuthority: ClientAuthorityDTO | null;
};
export async function getCollectionPageContext(actor: OrganizationActor,
  search: Record<string, string | string[] | undefined>): Promise<CollectionPageContext> {
  await checkOrganizationActor(actor);
  const query = parseCollectionInput(z.object({ clientId: OrganizationIdSchema.optional() }).strict(), search);
  let scope: CollectionScope | null = null;
  if (query.clientId !== undefined) scope = { kind: "CLIENT", clientId: query.clientId };
  else {
    const references = await getOwnReferences(actor);
    if (references.brandId) scope = { kind: "OWN_BRAND", brandId: references.brandId };
  }
  if (!scope) return { scope: null, initialPage: null, planAuthority: null };
  const initialPage = await getCollectionHeaders(actor, { scope });
  let planAuthority: ClientAuthorityDTO | null = null;
  if (scope.kind === "CLIENT") {
    try { planAuthority = await getClientAuthority(actor, scope.clientId, "plan"); }
    catch (error) {
      if (!(error instanceof Error && "status" in error && error.status === 404)) throw error;
    }
  }
  return { scope, initialPage, planAuthority };
}
export function collectionPageError(error: unknown): string {
  if (error instanceof Error && "status" in error) {
    if (error.status === 401) return "UNAUTHENTICATED";
    if (error.status === 403) return "FORBIDDEN";
    if (error.status === 404) return "NOT_FOUND";
  }
  return error instanceof CollectionError && error.code === "VALIDATION" ? "VALIDATION" : "RETRY_REQUIRED";
}
