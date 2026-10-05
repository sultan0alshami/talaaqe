import type { Prisma } from "@prisma/client";
import { checkOrganizationActor, organizationAwait, withOrganizationTransaction,
  type OrganizationActor, type OrganizationOptions } from "@/lib/organizations/context";
import { withClientAuthority } from "@/lib/organizations/authority";
import { lockOrganizationRows } from "@/lib/organizations/service";
import type { ClientAuthorityDTO } from "@/lib/organizations/contracts";
import type { EvidenceReceiptReader } from "@/lib/evidence/receipt-reader";
import { CollectionError, CollectionScopeSchema, parseCollectionInput, type CollectionScope } from "./contracts";

export type CollectionScopeContext = {
  scope: CollectionScope; brandId: string; organizationId: string | null; clientId: string | null;
  currentAuthority: ClientAuthorityDTO | null; ownerIds: ReadonlySet<string>; reviewerIds: ReadonlySet<string>;
};
type ScopeCallback<T> = (tx: Prisma.TransactionClient, context: CollectionScopeContext) => Promise<T>;
export type CollectionScopeOperation<T> = {
  write: boolean; expectedAuthority?: unknown; userIds?: readonly string[]; reviewerIds?: readonly string[];
  reader: EvidenceReceiptReader; replay?: ScopeCallback<{ found: false } | { found: true; result: T }>;
  execute: ScopeCallback<T>;
};
export async function withCollectionScope<T>(
  actor: OrganizationActor, scopeInput: CollectionScope, capability: "view" | "plan",
  operation: CollectionScopeOperation<T>, options: OrganizationOptions = {},
): Promise<T> {
  const checkpoint = () => operation.reader.checkpoint();
  await checkOrganizationActor(actor, options, checkpoint);
  const scope = parseCollectionInput(CollectionScopeSchema, scopeInput);
  const context = (current: ClientAuthorityDTO, ownerIds: ReadonlySet<string>, reviewerIds: ReadonlySet<string>): CollectionScopeContext => ({
    scope, brandId: current.brandId, organizationId: current.organizationId, clientId: current.clientId,
    currentAuthority: current, ownerIds, reviewerIds,
  });
  if (scope.kind === "CLIENT") {
    const execute = (tx: Prisma.TransactionClient, current: ClientAuthorityDTO, owners: ReadonlySet<string>, reviewers: ReadonlySet<string>) =>
      operation.execute(tx, context(current, owners, reviewers));
    const shared = { checkpoint, userIds: operation.userIds, reviewerIds: operation.reviewerIds, execute };
    if (!operation.write) return withClientAuthority(actor, scope.clientId, capability, { ...shared, write: false }, options);
    return withClientAuthority(actor, scope.clientId, capability, { ...shared, write: true,
      expectedAuthority: operation.expectedAuthority,
      replay: operation.replay ? (tx, current, owners, reviewers) => operation.replay!(tx, context(current, owners, reviewers)) : undefined,
    }, options);
  }
  if (operation.expectedAuthority !== undefined) throw new CollectionError("VALIDATION", 422);
  return withOrganizationTransaction(actor, options, { write: operation.write,
    userIds: operation.userIds ? [...operation.userIds] : [],
    reviewerIds: operation.reviewerIds ? [...operation.reviewerIds] : [], checkpoint,
  }, async (tx, ownerIds, reviewerIds) => {
    await lockOrganizationRows(tx, "Brand", [scope.brandId], operation.write, checkpoint);
    const brand = await organizationAwait(checkpoint, () => tx.brand.findUnique({ where: { id: scope.brandId }, select: { id: true, userId: true } }));
    if (!brand || brand.userId !== actor.userId) throw new CollectionError("NOT_FOUND", 404);
    const current: CollectionScopeContext = { scope, brandId: brand.id, organizationId: null, clientId: null,
      currentAuthority: null, ownerIds, reviewerIds };
    if (operation.replay) {
      const previous = await operation.replay(tx, current);
      if (previous.found) return previous.result;
    }
    checkpoint();
    return operation.execute(tx, current);
  });
}
