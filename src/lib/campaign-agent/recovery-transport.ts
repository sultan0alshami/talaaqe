import { z } from "zod";
import { parseBody, requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { CampaignAgentError } from "./native-contracts";
import { checkOrganizationActor } from "@/lib/organizations/context";
import { getCampaignAgentRecoveryKey, getCampaignAgentCommandOutcome, executeCampaignAgentRecoveryBarrier } from "./recovery";

async function actor() { const current = await requireRole("BRAND"); await checkOrganizationActor(current); return current; }
function noQuery(request: Request) { if (new URL(request.url).search) throw new CampaignAgentError("VALIDATION", 422); }
export const loadCampaignAgentRecoveryKey = domainHandler(async (request: Request) => {
  const current = await actor(), entries = [...new URL(request.url).searchParams];
  if (new Set(entries.map(([key]) => key)).size !== entries.length || entries.some(([key]) => !["scope", "brandId", "clientId", "campaignId"].includes(key))) throw new CampaignAgentError("VALIDATION", 422);
  const values = Object.fromEntries(entries), scope = values.scope === "OWN_BRAND" && values.brandId !== undefined && values.clientId === undefined
    ? { kind: "OWN_BRAND", brandId: values.brandId }
    : values.scope === "CLIENT" && values.clientId !== undefined && values.brandId === undefined ? { kind: "CLIENT", clientId: values.clientId } : null;
  if (!scope) throw new CampaignAgentError("VALIDATION", 422);
  return getCampaignAgentRecoveryKey(current, { scope, campaignId: values.campaignId });
});
export const loadCampaignAgentOutcome = domainHandler(async (request: Request) => {
  const current = await actor(); noQuery(request);
  return getCampaignAgentCommandOutcome(current, await parseBody(request, z.unknown()));
});
export const commandCampaignAgentRecoveryBarrier = domainHandler(async (request: Request) => {
  const current = await actor(); noQuery(request);
  return executeCampaignAgentRecoveryBarrier(current, await parseBody(request, z.unknown()), { channel: "FORM" });
});
