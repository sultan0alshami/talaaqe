import { z } from "zod";
import { parseBody, requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { checkOrganizationActor } from "@/lib/organizations/context";
import { CampaignAgentError } from "./native-contracts";
import { executeCampaignAgentCommand, getCampaignAgent, getCampaignAgentTextSources } from "./service";

async function actor() {
  const current = await requireRole("BRAND");
  await checkOrganizationActor(current);
  return current;
}
function query(request: Request, sources = false) {
  const entries = [...new URL(request.url).searchParams], allowed = ["scope", "brandId", "clientId", "campaignId", ...(sources ? ["after"] : [])];
  if (new Set(entries.map(([key]) => key)).size !== entries.length || entries.some(([key]) => !allowed.includes(key))) throw new CampaignAgentError("VALIDATION", 422);
  const values = Object.fromEntries(entries);
  const scope = values.scope === "OWN_BRAND" && values.brandId !== undefined && values.clientId === undefined
    ? { kind: "OWN_BRAND", brandId: values.brandId }
    : values.scope === "CLIENT" && values.clientId !== undefined && values.brandId === undefined
      ? { kind: "CLIENT", clientId: values.clientId } : null;
  if (!scope) throw new CampaignAgentError("VALIDATION", 422);
  return { scope, campaignId: values.campaignId, ...(values.after === undefined ? {} : { after: values.after }) };
}
export const loadCampaignAgent = domainHandler(async (request: Request) => {
  const current = await actor();
  return getCampaignAgent(current, query(request));
});
export const loadCampaignAgentSources = domainHandler(async (request: Request) => {
  const current = await actor();
  return getCampaignAgentTextSources(current, query(request, true));
});
export const commandCampaignAgent = domainHandler(async (request: Request) => {
  const current = await actor();
  if (new URL(request.url).search) throw new CampaignAgentError("VALIDATION", 422);
  return executeCampaignAgentCommand(current, await parseBody(request, z.unknown()), { channel: "FORM" });
});
