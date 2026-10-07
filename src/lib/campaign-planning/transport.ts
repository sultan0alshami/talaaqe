import { z } from "zod";
import { ApiError, parseBody, requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { checkOrganizationActor } from "@/lib/organizations/context";
import { resolveCampaignPolicyReview } from "@/lib/policies";
import { CampaignPlanningError } from "./contracts";
import { executeCampaignPlanningCommand, listPlanningCampaigns, getPlanningCampaign,
  listCampaignOwnerReviews, getCampaignOwnerReview, decideCampaignOwnerReview } from "./service";

function query(request: Request, allowed: readonly string[]): Record<string, string | number> {
  const entries = [...new URL(request.url).searchParams];
  if (new Set(entries.map(([key]) => key)).size !== entries.length || entries.some(([key]) => !allowed.includes(key)))
    throw new CampaignPlanningError("VALIDATION", 422);
  const values = Object.fromEntries(entries);
  if (values.limit !== undefined && !/^[1-9][0-9]?$/.test(values.limit)) throw new CampaignPlanningError("VALIDATION", 422);
  return { ...values, ...(values.limit === undefined ? {} : { limit: Number(values.limit) }) };
}
function scopedQuery(request: Request, extra: readonly string[]) {
  const values = query(request, ["scope", "brandId", "clientId", ...extra]);
  const scope = values.scope === "OWN_BRAND" && values.brandId !== undefined && values.clientId === undefined
    ? { kind: "OWN_BRAND", brandId: values.brandId }
    : values.scope === "CLIENT" && values.clientId !== undefined && values.brandId === undefined
      ? { kind: "CLIENT", clientId: values.clientId } : null;
  if (!scope) throw new CampaignPlanningError("VALIDATION", 422);
  const { scope: _scope, brandId: _brandId, clientId: _clientId, ...fields } = values;
  void _scope; void _brandId; void _clientId;
  return { ...fields, scope };
}
async function actor() {
  const current = await requireRole("BRAND");
  await checkOrganizationActor(current);
  return current;
}
function noQuery(request: Request) {
  if (new URL(request.url).search) throw new CampaignPlanningError("VALIDATION", 422);
}
// Campaign fields and an original proposal can exceed the shared64KiB wire
// budget, especially in Arabic. This purpose alone allows512KiB, then strict
// domain schemas constrain every field. Submitted snapshots still cap at64KiB.
async function planningBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "Missing JSON body");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 524288) { await reader.cancel(); throw new ApiError(413, "Planning request exceeds512KiB"); }
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
export const loadPlanningCampaigns = domainHandler(async (request: Request) => {
  const current = await actor();
  return listPlanningCampaigns(current, scopedQuery(request, ["after", "limit"]));
});
export const loadPlanningCampaign = domainHandler(async (request: Request) => {
  const current = await actor();
  return getPlanningCampaign(current, scopedQuery(request, ["campaignId", "briefsAfter"]));
});
export const commandPlanningCampaign = domainHandler(async (request: Request) => {
  const current = await actor(); noQuery(request);
  return executeCampaignPlanningCommand(current, await planningBody(request));
});
export const loadCampaignOwnerReviews = domainHandler(async (request: Request) => {
  const current = await actor();
  return listCampaignOwnerReviews(current, query(request, ["after", "limit"]));
});
export const loadCampaignOwnerReview = domainHandler(async (request: Request) => {
  const current = await actor();
  return getCampaignOwnerReview(current, query(request, ["submissionId"]));
});
export const commandCampaignOwnerReview = domainHandler(async (request: Request) => {
  const current = await actor(); noQuery(request);
  return decideCampaignOwnerReview(current, await parseBody(request, z.unknown()), { policyReviewResolver: resolveCampaignPolicyReview });
});
