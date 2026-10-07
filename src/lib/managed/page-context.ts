import { z } from "zod";
import { captureOrganizationActor, checkOrganizationActor, organizationAwait, organizationDb,
  type OrganizationActor, type OrganizationOptions } from "@/lib/organizations/context";
import { getOwnReferences } from "@/lib/organizations/management";
import { OrganizationIdSchema } from "@/lib/organizations/contracts";
import { withBrandContextScope, resolvePlanningWorkspace } from "@/lib/brand-context/scope";
import type { PlanningScope } from "@/lib/brand-context/contracts";
import { createEvidenceReceiptReader } from "@/lib/evidence/receipt-reader";
import { ManagedOrderListSchema } from "./contracts";
import { getManagedOrder, listManagedOrders } from "./orders";
import type { ManagedRequestPageContext } from "./ui-contract";
import { ManagedCustomerError } from "./customer-scope";
const detailQuery = z.object({ clientId: OrganizationIdSchema.optional() }).strict();
const listQuery = detailQuery.extend({ after: OrganizationIdSchema.optional() }).strict();
type Call = { actor: Readonly<OrganizationActor>; options: OrganizationOptions; checkpoint: () => void };
function capture(actor: OrganizationActor, options: OrganizationOptions): Call {
  const reader = createEvidenceReceiptReader();
  return { actor: captureOrganizationActor(actor), options: { client: organizationDb(options) }, checkpoint: () => reader.checkpoint() };
}
function parsed<T>(packet: z.ZodSafeParseResult<T>, call: Call): T {
  call.checkpoint(); if (!packet.success) throw new ManagedCustomerError("VALIDATION", 422); return packet.data;
}
async function scopeFor(call: Call, clientId?: string): Promise<PlanningScope | null> {
  if (clientId !== undefined) return { kind: "CLIENT", clientId };
  const references = await organizationAwait(call.checkpoint, () => getOwnReferences(call.actor, call.options));
  return references.brandId ? { kind: "OWN_BRAND", brandId: references.brandId } : null;
}
function props(call: Call, scope: PlanningScope | null, fields: Partial<Pick<ManagedRequestPageContext, "initialList" | "initialDetail" | "profileRequired">>): ManagedRequestPageContext {
  call.checkpoint(); return { actorReference: call.actor.userId, scope, initialList: null, initialDetail: null,
    profileRequired: scope === null, ...fields };
}
export async function getManagedRequestListPageContext(actor: OrganizationActor, query: unknown,
  options: OrganizationOptions = {}): Promise<ManagedRequestPageContext> {
  const call = capture(actor, options), packet = listQuery.safeParse(query);
  await checkOrganizationActor(call.actor, call.options, call.checkpoint);
  const input = parsed(packet, call), scope = await scopeFor(call, input.clientId);
  if (!scope) {
    if (input.after !== undefined) throw new ManagedCustomerError("NOT_FOUND", 404);
    return props(call, null, {});
  }
  // A view-authorized new workspace remains absent: do not manufacture a row
  // or mistake current CLIENT denial for an OWN empty-state fallback.
  const empty = await withBrandContextScope(call.actor, scope, "view", { write: false, checkpoint: call.checkpoint,
    execute: async (tx, frame) => {
      const workspace = await resolvePlanningWorkspace(tx, frame, false, call.checkpoint);
      if (workspace) return null;
      if (input.after !== undefined) throw new ManagedCustomerError("NOT_FOUND", 404);
      return ManagedOrderListSchema.parse({ asOf: new Date().toISOString(), scope: frame.scope,
        currentAuthority: frame.currentAuthority, orders: [], nextCursor: null });
    } }, call.options);
  const initialList = empty ?? await organizationAwait(call.checkpoint, () => listManagedOrders(call.actor,
    { scope, ...(input.after === undefined ? {} : { after: input.after }) }, call.options));
  return props(call, scope, { initialList });
}
export async function getManagedRequestDetailPageContext(actor: OrganizationActor, orderId: string, query: unknown,
  options: OrganizationOptions = {}): Promise<ManagedRequestPageContext> {
  const call = capture(actor, options), packet = detailQuery.safeParse(query), idPacket = OrganizationIdSchema.safeParse(orderId);
  await checkOrganizationActor(call.actor, call.options, call.checkpoint);
  const input = parsed(packet, call), id = parsed(idPacket, call), scope = await scopeFor(call, input.clientId);
  if (!scope) throw new ManagedCustomerError("NOT_FOUND", 404);
  const initialDetail = await organizationAwait(call.checkpoint, () => getManagedOrder(call.actor, { scope, orderId: id }, call.options));
  return props(call, scope, { initialDetail });
}
