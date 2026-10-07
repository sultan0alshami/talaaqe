import { z } from "zod";
import { ApiError, parseBody, requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { checkOrganizationActor } from "@/lib/organizations/context";
import { BrandContextError } from "./contracts";
import { executeBrandContextCommand, listBrandContexts, getBrandContext, getApprovedBrandContextVersion,
  listContextOwnerReviews, getContextOwnerReview, decideContextOwnerReview } from "./service";

function query(request: Request, allowed: readonly string[]): Record<string, string | number> {
  const entries = [...new URL(request.url).searchParams];
  if (new Set(entries.map(([key]) => key)).size !== entries.length || entries.some(([key]) => !allowed.includes(key))) {
    throw new BrandContextError("VALIDATION", 422);
  }
  const values = Object.fromEntries(entries);
  if (values.limit !== undefined && !/^[1-9][0-9]?$/.test(values.limit)) throw new BrandContextError("VALIDATION", 422);
  return { ...values, ...(values.limit === undefined ? {} : { limit: Number(values.limit) }) };
}
function scopedQuery(request: Request, extra: readonly string[]) {
  const values = query(request, ["scope", "brandId", "clientId", ...extra]);
  const scope = values.scope === "OWN_BRAND" && values.brandId !== undefined && values.clientId === undefined
    ? { kind: "OWN_BRAND", brandId: values.brandId }
    : values.scope === "CLIENT" && values.clientId !== undefined && values.brandId === undefined
      ? { kind: "CLIENT", clientId: values.clientId } : null;
  if (!scope || values.archived !== undefined && !["true", "false"].includes(String(values.archived))) {
    throw new BrandContextError("VALIDATION", 422);
  }
  const { scope: _scope, brandId: _brandId, clientId: _clientId, archived, ...fields } = values;
  void _scope; void _brandId; void _clientId;
  return { ...fields, scope, ...(archived === undefined ? {} : { archived: archived === "true" }) };
}
async function actor() {
  const current = await requireRole("BRAND");
  await checkOrganizationActor(current);
  return current;
}
function noQuery(request: Request) {
  if (new URL(request.url).search) throw new BrandContextError("VALIDATION", 422);
}

// This purpose has up to64KiB original content plus the strict command envelope.
// Keep the shared64KiB parser unchanged; only context commands allow96KiB wire
// JSON. The domain still enforces the exact64KiB compact content limit.
async function contextBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "Missing JSON body");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 98304) { await reader.cancel(); throw new ApiError(413, "Context request exceeds96KiB"); }
      chunks.push(value);
    }
    const joined = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "Invalid JSON body");
  } finally { reader.releaseLock(); }
}
export const loadBrandContexts = domainHandler(async (request: Request) => {
  const current = await actor();
  return listBrandContexts(current, scopedQuery(request, ["archived", "after", "limit"]));
});
export const loadBrandContext = domainHandler(async (request: Request) => {
  const current = await actor();
  return getBrandContext(current, scopedQuery(request, ["contextId", "versionsAfter"]));
});
export const loadApprovedBrandContextVersion = domainHandler(async (request: Request) => {
  const current = await actor();
  return getApprovedBrandContextVersion(current, scopedQuery(request, ["versionId"]));
});
export const commandBrandContext = domainHandler(async (request: Request) => {
  const current = await actor(); noQuery(request);
  return executeBrandContextCommand(current, await contextBody(request));
});
export const loadContextOwnerReviews = domainHandler(async (request: Request) => {
  const current = await actor();
  return listContextOwnerReviews(current, query(request, ["after", "limit"]));
});
export const loadContextOwnerReview = domainHandler(async (request: Request) => {
  const current = await actor();
  return getContextOwnerReview(current, query(request, ["submissionId"]));
});
export const commandContextOwnerReview = domainHandler(async (request: Request) => {
  const current = await actor(); noQuery(request);
  return decideContextOwnerReview(current, await parseBody(request, z.unknown()));
});
