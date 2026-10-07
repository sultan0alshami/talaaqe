import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { captureOrganizationActor, checkOrganizationActor, organizationAwait, organizationDb, withOrganizationTransaction,
  type OrganizationActor, type OrganizationOptions } from "@/lib/organizations/context";
import { ClientAuthoritySchema, type ClientAuthorityDTO } from "@/lib/organizations/contracts";
import { withClientAuthority } from "@/lib/organizations/authority";
import { lockOrganizationRows } from "@/lib/organizations/service";
import { PlanningScopeSchema, type PlanningScope } from "@/lib/brand-context/contracts";
import { lockPlanningRows } from "@/lib/brand-context/scope";
import { createEvidenceReceiptReader } from "@/lib/evidence/receipt-reader";

export type ManagedCustomerCapability = "view" | "signCustomer" | "approveShortlist" | "financial";
export type ManagedCustomerScopeContext = {
  scope: PlanningScope; brandId: string; organizationId: string | null; clientId: string | null;
  workspaceId: string; currentAuthority: ClientAuthorityDTO | null; ownerIds: ReadonlySet<string>;
};
type Callback<T> = (tx: Prisma.TransactionClient, scope: ManagedCustomerScopeContext) => Promise<T>;
export type ManagedCustomerOperation<T> = { write: boolean; expectedAuthority?: ClientAuthorityDTO;
  checkpoint?: () => void; replay?: Callback<{ found: false } | { found: true; result: T }>; execute: Callback<T> };
export class ManagedCustomerError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); this.name = "ManagedCustomerError"; }
}
export async function withManagedCustomerScope<T>(actor: OrganizationActor, scope: PlanningScope,
  capability: ManagedCustomerCapability, operation: ManagedCustomerOperation<T>, options: OrganizationOptions = {}): Promise<T> {
  // Copy all caller identities/callbacks before any native authentication wait.
  const currentActor = captureOrganizationActor(actor), capturedOptions = { client: organizationDb(options) },
    scopePacket = PlanningScopeSchema.safeParse(scope), capabilityPacket = z.enum(["view", "signCustomer", "approveShortlist", "financial"]).safeParse(capability),
    write = operation.write, execute = operation.execute, replay = operation.replay,
    authorityPacket = operation.expectedAuthority === undefined ? null : ClientAuthoritySchema.safeParse(operation.expectedAuthority),
    callerCheckpoint = operation.checkpoint;
  const reader = createEvidenceReceiptReader();
  const checkpoint = () => { reader.checkpoint(); callerCheckpoint?.(); reader.checkpoint(); };
  await checkOrganizationActor(currentActor, capturedOptions, checkpoint);
  if (!scopePacket.success || !capabilityPacket.success || typeof write !== "boolean" || typeof execute !== "function"
    || replay !== undefined && typeof replay !== "function" || authorityPacket && !authorityPacket.success
    || (capabilityPacket.data === "view") !== !write) throw new ManagedCustomerError("VALIDATION", 422);
  const fixedScope = Object.freeze(scopePacket.data), fixedCapability = capabilityPacket.data;
  const expectedAuthority = authorityPacket?.success ? Object.freeze(authorityPacket.data) : undefined;
  if (fixedScope.kind === "OWN_BRAND" && expectedAuthority !== undefined
    || fixedScope.kind === "CLIENT" && write && expectedAuthority === undefined) throw new ManagedCustomerError("VALIDATION", 422);
  const frame = async (tx: Prisma.TransactionClient, brandId: string, organizationId: string | null, clientId: string | null,
    authority: ClientAuthorityDTO | null, ownerIds: ReadonlySet<string>): Promise<ManagedCustomerScopeContext> => {
    const where = { scope: fixedScope.kind, brandId, organizationId, clientId };
    const first = await organizationAwait(checkpoint, () => tx.planningWorkspace.findFirst({ where, select: { id: true } }));
    if (!first) throw new ManagedCustomerError("NOT_FOUND", 404);
    await lockPlanningRows(tx, "PlanningWorkspace", [first.id], write, checkpoint);
    const workspace = await organizationAwait(checkpoint, () => tx.planningWorkspace.findFirst({ where: { ...where, id: first.id }, select: { id: true } }));
    if (!workspace) throw new ManagedCustomerError("RETRY_REQUIRED", 503);
    return Object.freeze({ scope: fixedScope, brandId, organizationId, clientId, workspaceId: workspace.id, currentAuthority: authority, ownerIds });
  };
  if (fixedScope.kind === "CLIENT") {
    const act = async (tx: Prisma.TransactionClient, authority: Readonly<ClientAuthorityDTO>, owners: ReadonlySet<string>) =>
      execute(tx, await frame(tx, authority.brandId, authority.organizationId, authority.clientId, authority, owners));
    if (!write) return withClientAuthority(currentActor, fixedScope.clientId, "view", { write: false, checkpoint, execute: act }, capturedOptions);
    return withClientAuthority<T>(currentActor, fixedScope.clientId, fixedCapability, { write: true, expectedAuthority, checkpoint,
      replay: replay ? async (tx, authority, owners) => replay(tx, await frame(tx, authority.brandId, authority.organizationId,
        authority.clientId, authority, owners)) : undefined,
      execute: act }, capturedOptions);
  }
  return withOrganizationTransaction(currentActor, capturedOptions, { write, checkpoint }, async (tx, owners) => {
    await lockOrganizationRows(tx, "Brand", [fixedScope.brandId], write, checkpoint);
    const brand = await organizationAwait(checkpoint, () => tx.brand.findUnique({ where: { id: fixedScope.brandId }, select: { userId: true } }));
    if (!brand || brand.userId !== currentActor.userId || !owners.has(brand.userId)) throw new ManagedCustomerError("NOT_FOUND", 404);
    const context = await frame(tx, fixedScope.brandId, null, null, null, owners);
    if (write && replay) { const previous = await replay(tx, context); if (previous.found) return previous.result; }
    return execute(tx, context);
  });
}
