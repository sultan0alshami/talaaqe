import { z } from "zod";
import { parseBody, requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { checkOrganizationActor } from "@/lib/organizations/context";
import { ManagedCustomerError } from "./customer-scope";
import { getManagedOrder, listManagedOrders, submitManagedOrder } from "./orders";

function query(request: Request, extra: readonly string[]) {
  const entries = [...new URL(request.url).searchParams];
  const allowed = ["scope", "brandId", "clientId", ...extra];
  if (new Set(entries.map(([key]) => key)).size !== entries.length || entries.some(([key]) => !allowed.includes(key)))
    throw new ManagedCustomerError("VALIDATION", 422);
  const values = Object.fromEntries(entries);
  const scope = values.scope === "OWN_BRAND" && values.brandId !== undefined && values.clientId === undefined
    ? { kind: "OWN_BRAND", brandId: values.brandId }
    : values.scope === "CLIENT" && values.clientId !== undefined && values.brandId === undefined
      ? { kind: "CLIENT", clientId: values.clientId } : null;
  if (!scope || values.limit !== undefined && !/^[1-9][0-9]?$/.test(values.limit)) throw new ManagedCustomerError("VALIDATION", 422);
  const { scope: _scope, brandId: _brandId, clientId: _clientId, ...fields } = values;
  void _scope; void _brandId; void _clientId;
  return { ...fields, scope, ...(values.limit === undefined ? {} : { limit: Number(values.limit) }) };
}
async function actor() {
  const current = await requireRole("BRAND");
  await checkOrganizationActor(current);
  return current;
}
export const loadManagedOrders = domainHandler(async (request: Request) => {
  const current = await actor();
  return listManagedOrders(current, query(request, ["after", "limit", "campaignId"]));
});
export const loadManagedOrder = domainHandler(async (request: Request) => {
  const current = await actor();
  return getManagedOrder(current, query(request, ["orderId"]));
});
export const commandManagedOrder = domainHandler(async (request: Request) => {
  const current = await actor();
  if (new URL(request.url).search) throw new ManagedCustomerError("VALIDATION", 422);
  return submitManagedOrder(current, await parseBody(request, z.unknown()));
});
