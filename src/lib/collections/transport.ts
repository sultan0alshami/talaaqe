import { z } from "zod";
import { parseBody, requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { checkOrganizationActor } from "@/lib/organizations/context";
import { CollectionError } from "./contracts";
import { applyCollectionCommand } from "./service";
import { compareCollectionEntries, getCollectionEntries, getCollectionHeaders } from "./loaders";

// URL values are an adapter only. Domain schemas own all identity and bounds.
function query(request: Request, allowed: readonly string[]) {
  const entries = [...new URL(request.url).searchParams];
  if (new Set(entries.map(([key]) => key)).size !== entries.length || entries.some(([key]) => !allowed.includes(key))) {
    throw new CollectionError("VALIDATION", 422);
  }
  const values = Object.fromEntries(entries);
  const scope = values.scope === "OWN_BRAND" && values.brandId !== undefined && values.clientId === undefined
    ? { kind: "OWN_BRAND", brandId: values.brandId }
    : values.scope === "CLIENT" && values.clientId !== undefined && values.brandId === undefined
      ? { kind: "CLIENT", clientId: values.clientId } : null;
  if (!scope || values.archived !== undefined && !["true", "false"].includes(values.archived)
    || values.limit !== undefined && !/^[1-9][0-9]?$/.test(values.limit)) throw new CollectionError("VALIDATION", 422);
  return { scope, ...(values.archived === undefined ? {} : { archived: values.archived === "true" }),
    ...(values.after === undefined ? {} : { after: values.after }),
    ...(values.limit === undefined ? {} : { limit: Number(values.limit) }),
    ...(values.collectionId === undefined ? {} : { collectionId: values.collectionId }) };
}
async function actor() { const current = await requireRole("BRAND"); await checkOrganizationActor(current); return current; }
export const loadCollectionHeaders = domainHandler(async (request: Request) => {
  const current = await actor();
  return getCollectionHeaders(current, query(request, ["scope", "brandId", "clientId", "archived", "after", "limit"]));
});
export const loadCollectionEntries = domainHandler(async (request: Request) => {
  const current = await actor();
  return getCollectionEntries(current, query(request, ["scope", "brandId", "clientId", "collectionId", "after", "limit"]));
});
export const commandCollection = domainHandler(async (request: Request) => {
  const current = await actor();
  if (new URL(request.url).search) throw new CollectionError("VALIDATION", 422);
  return applyCollectionCommand(current, await parseBody(request, z.unknown()));
});
export const loadCollectionComparison = domainHandler(async (request: Request) => {
  const current = await actor();
  if (new URL(request.url).search) throw new CollectionError("VALIDATION", 422);
  return compareCollectionEntries(current, await parseBody(request, z.unknown()));
});
