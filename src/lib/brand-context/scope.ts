import { randomUUID } from "node:crypto";
import { Prisma, type PlanningWorkspace } from "@prisma/client";
import { z } from "zod";
import { withClientAuthority } from "@/lib/organizations/authority";
import { ClientAuthoritySchema, OrganizationError, OrganizationIdSchema, type ClientAuthorityDTO } from "@/lib/organizations/contracts";
import { captureOrganizationActor, checkOrganizationActor, lockStoredOrganization, organizationAwait,
  organizationDb, validateClientDelegation, withOrganizationTransaction,
  type OrganizationActor, type OrganizationOptions } from "@/lib/organizations/context";
import { lockOrganizationRows } from "@/lib/organizations/service";
import { BrandContextError, PlanningScopeSchema, parseBrandContextInput, type PlanningScope } from "./contracts";

export type BrandContextScopeContext = {
  scope: PlanningScope; brandId: string; organizationId: string | null; clientId: string | null;
  currentAuthority: ClientAuthorityDTO | null; ownerIds: ReadonlySet<string>; reviewerIds: ReadonlySet<string>;
  targetOwnerUserId: string; targetOwnerSessionVersion: number; currentClientRevision: number | null;
};
type ScopeCallback<T> = (tx: Prisma.TransactionClient, context: BrandContextScopeContext) => Promise<T>;
export type BrandContextScopeOperation<T> = {
  write: boolean; expectedAuthority?: unknown; checkpoint: () => void;
  userIds?: readonly string[]; reviewerIds?: readonly string[];
  replay?: ScopeCallback<{ found: false } | { found: true; result: T }>;
  execute: ScopeCallback<T>;
};
export const contextReviewBindingSelect = {
  id: true, contextId: true, workspaceId: true, inputRevision: true, contentHash: true,
  targetOwnerUserId: true, targetOwnerSessionVersion: true, clientRevision: true,
  state: true, revision: true, createdAt: true, decidedAt: true,
} as const;
export const contextParentBindingSelect = {
  id: true, workspaceId: true, revision: true, inputRevision: true, archived: true,
} as const;
export type ContextOwnerReviewBinding = {
  submission: Prisma.BrandContextSubmissionGetPayload<{ select: typeof contextReviewBindingSelect }>;
  context: Prisma.BrandContextGetPayload<{ select: typeof contextParentBindingSelect }>;
  workspace: PlanningWorkspace;
  scope: PlanningScope;
  targetOwnerUserId: string; targetOwnerSessionVersion: number; currentClientRevision: number | null;
};
const missing = (): never => { throw new BrandContextError("NOT_FOUND", 404); };
const retry = (): never => { throw new BrandContextError("RETRY_REQUIRED", 503); };

async function targetOwner(tx: Prisma.TransactionClient, brandId: string, owners: ReadonlySet<string>, checkpoint: () => void, expectedOwner?: string) {
  const brand = await organizationAwait(checkpoint, () => tx.brand.findUnique({ where: { id: brandId }, select: { userId: true } }));
  if (!brand) return missing();
  if (expectedOwner !== undefined && brand.userId !== expectedOwner) return missing();
  if (!owners.has(brand.userId)) return retry();
  const owner = await organizationAwait(checkpoint, () => tx.user.findUnique({ where: { id: brand.userId },
    select: { id: true, active: true, role: true, sessionVersion: true } }));
  if (!owner?.active || owner.role !== "BRAND") return missing();
  return { targetOwnerUserId: owner.id, targetOwnerSessionVersion: owner.sessionVersion };
}

export async function withBrandContextScope<T>(actorInput: OrganizationActor, scopeInput: PlanningScope, capability: "view" | "plan",
  operation: BrandContextScopeOperation<T>, options: OrganizationOptions = {}): Promise<T> {
  const actor = captureOrganizationActor(actorInput);
  const scope = Object.freeze(parseBrandContextInput(PlanningScopeSchema, scopeInput));
  const capturedOptions = { client: organizationDb(options) };
  const { checkpoint, write, execute, replay } = operation;
  const userIds = operation.userIds ? [...operation.userIds] : undefined;
  const reviewerIds = operation.reviewerIds ? [...operation.reviewerIds] : undefined;
  const expected = operation.expectedAuthority === undefined ? undefined : ClientAuthoritySchema.safeParse(operation.expectedAuthority);
  await checkOrganizationActor(actor, capturedOptions, checkpoint);
  if (expected && !expected.success) throw new BrandContextError("VALIDATION", 422);
  const expectedAuthority = expected?.success ? Object.freeze(expected.data) : undefined;
  if (capability !== (write ? "plan" : "view")) throw new BrandContextError("VALIDATION", 422);
  if (scope.kind === "CLIENT") {
    const context = async (tx: Prisma.TransactionClient, current: ClientAuthorityDTO,
      ownerIds: ReadonlySet<string>, reviewerIds: ReadonlySet<string>): Promise<BrandContextScopeContext> => ({
      scope, brandId: current.brandId, organizationId: current.organizationId, clientId: current.clientId,
      currentAuthority: current, ownerIds, reviewerIds,
      ...await targetOwner(tx, current.brandId, ownerIds, checkpoint), currentClientRevision: current.clientRevision,
    });
    const action = async (tx: Prisma.TransactionClient, current: ClientAuthorityDTO,
      owners: ReadonlySet<string>, reviewers: ReadonlySet<string>) => execute(tx, await context(tx, current, owners, reviewers));
    if (!write) return withClientAuthority(actor, scope.clientId, "view", { write: false, checkpoint, userIds, reviewerIds, execute: action }, capturedOptions);
    return withClientAuthority(actor, scope.clientId, "plan", { write: true, checkpoint, userIds, reviewerIds, expectedAuthority,
      replay: replay ? async (tx, current, owners, reviewers) => replay(tx, await context(tx, current, owners, reviewers)) : undefined,
      execute: action }, capturedOptions);
  }
  if (expectedAuthority !== undefined) throw new BrandContextError("VALIDATION", 422);
  return withOrganizationTransaction(actor, capturedOptions, { write, checkpoint,
    userIds: userIds ? [...userIds] : undefined, reviewerIds: reviewerIds ? [...reviewerIds] : undefined }, async (tx, ownerIds, reviewerIds) => {
    await lockOrganizationRows(tx, "Brand", [scope.brandId], write, checkpoint);
    const owner = await targetOwner(tx, scope.brandId, ownerIds, checkpoint, actor.userId);
    if (owner.targetOwnerUserId !== actor.userId) return missing();
    const current: BrandContextScopeContext = { scope, brandId: scope.brandId, organizationId: null, clientId: null,
      currentAuthority: null, ownerIds, reviewerIds, ...owner, currentClientRevision: null };
    if (replay) {
      const previous = await replay(tx, current);
      if (previous.found) return previous.result;
    }
    return execute(tx, current);
  });
}

export async function lockPlanningRows(tx: Prisma.TransactionClient,
  table: "PlanningWorkspace" | "BrandContext" | "BrandContextSubmission" | "BrandContextVersion",
  ids: readonly string[], write: boolean, checkpoint: () => void): Promise<void> {
  const ordered = [...new Set(ids)].sort();
  if (!ordered.length) return;
  await organizationAwait(checkpoint, () => tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw('"' + table + '"')}
    WHERE id IN (${Prisma.join(ordered)}) ORDER BY id ${write ? Prisma.raw("FOR UPDATE") : Prisma.raw("FOR SHARE")}`));
}

export async function resolvePlanningWorkspace(tx: Prisma.TransactionClient, context: BrandContextScopeContext,
  write: boolean, checkpoint: () => void): Promise<PlanningWorkspace | null> {
  const where = { scope: context.scope.kind, brandId: context.brandId,
    organizationId: context.organizationId, clientId: context.clientId };
  const initial = await organizationAwait(checkpoint, () => tx.planningWorkspace.findFirst({ where, select: { id: true } }));
  if (initial) {
    await lockPlanningRows(tx, "PlanningWorkspace", [initial.id], write, checkpoint);
    return await organizationAwait(checkpoint, () => tx.planningWorkspace.findFirst({ where: { ...where, id: initial.id } })) ?? retry();
  }
  if (!write) return null;
  // The owning Brand/CLIENT authority is already held exclusively. Partial
  // unique indexes make this exact tuple unique without nullable-key bypasses.
  return organizationAwait(checkpoint, () => tx.planningWorkspace.create({ data: { id: randomUUID(), ...where } }));
}

const ownerReviewPreflightSelect = {
  id: true, contextId: true, workspaceId: true, targetOwnerUserId: true,
  context: { select: { workspace: { select: {
    id: true, scope: true, brandId: true, organizationId: true, clientId: true,
    brand: { select: { userId: true } },
    client: { select: { organization: { select: { ownerUserId: true } } } },
  } } } },
} as const;

export async function withContextOwnerReviews<T>(actorInput: OrganizationActor, submissionIds: readonly string[], write: boolean,
  action: (tx: Prisma.TransactionClient, bindings: ReadonlyMap<string, ContextOwnerReviewBinding>) => Promise<T>,
  options: OrganizationOptions = {}, checkpoint: () => void): Promise<T> {
  const actor = captureOrganizationActor(actorInput);
  const capturedIds = [...submissionIds], capturedOptions = { client: organizationDb(options) };
  await checkOrganizationActor(actor, capturedOptions, checkpoint);
  const ids = [...new Set(parseBrandContextInput(z.array(OrganizationIdSchema).max(22), capturedIds))].sort();
  const initial = ids.length ? await organizationAwait(checkpoint, () => capturedOptions.client.brandContextSubmission.findMany({
    where: { id: { in: ids }, targetOwnerUserId: actor.userId }, select: ownerReviewPreflightSelect, take: 22,
  })) : [];
  const owners = [...new Set(initial.flatMap(row => [row.context.workspace.brand.userId,
    ...(row.context.workspace.client ? [row.context.workspace.client.organization.ownerUserId] : [])]))].sort();
  return withOrganizationTransaction(actor, capturedOptions, { write, userIds: owners, checkpoint }, async (tx, lockedUsers) => {
    // Group every table's locks across the batch before entering the next
    // table. Per-review Org->Context loops would invert another command's order.
    const organizations = new Map<string, boolean>();
    const orgIds = [...new Set(initial.map(row => row.context.workspace.organizationId).filter((id): id is string => id !== null))].sort();
    for (const id of orgIds) {
      const organization = await lockStoredOrganization(tx, id, lockedUsers, write, checkpoint);
      const owner = await organizationAwait(checkpoint, () => tx.user.findUnique({ where: { id: organization.ownerUserId },
        select: { active: true, role: true } }));
      organizations.set(id, organization.active && !!owner?.active && owner.role === "BRAND");
    }
    const clientIds = [...new Set(initial.map(row => row.context.workspace.clientId).filter((id): id is string => id !== null))].sort();
    await lockOrganizationRows(tx, "OrganizationClient", clientIds, write, checkpoint);
    const clients = clientIds.length ? await organizationAwait(checkpoint, () => tx.organizationClient.findMany({
      where: { id: { in: clientIds } }, select: { id: true, organizationId: true, brandId: true, state: true, revision: true,
        authorizingUserId: true, authorizingSessionVersion: true, allowedCapabilities: true }, take: 22,
    })) : [];
    const brandIds = [...new Set(initial.map(row => row.context.workspace.brandId))].sort();
    await lockOrganizationRows(tx, "Brand", brandIds, write, checkpoint);
    const brands = brandIds.length ? await organizationAwait(checkpoint, () => tx.brand.findMany({
      where: { id: { in: brandIds } }, select: { id: true, userId: true }, take: 22,
    })) : [];
    for (const brand of brands) if (!lockedUsers.has(brand.userId)) return retry();
    const validClients = new Map<string, typeof clients[number]>();
    for (const client of clients) {
      if (!organizations.get(client.organizationId) || client.authorizingUserId !== actor.userId) continue;
      try {
        const current = await validateClientDelegation(tx, client, lockedUsers, checkpoint);
        if (current.brand.userId === actor.userId && current.capabilities.plan) validClients.set(client.id, client);
      } catch (error) {
        if (!(error instanceof OrganizationError && error.code === "NOT_FOUND")) throw error;
      }
    }
    const workspaceIds = [...new Set(initial.map(row => row.workspaceId))].sort();
    await lockPlanningRows(tx, "PlanningWorkspace", workspaceIds, write, checkpoint);
    const workspaces = workspaceIds.length ? await organizationAwait(checkpoint, () => tx.planningWorkspace.findMany({
      where: { id: { in: workspaceIds } }, take: 22,
    })) : [];
    const contextIds = [...new Set(initial.map(row => row.contextId))].sort();
    await lockPlanningRows(tx, "BrandContext", contextIds, write, checkpoint);
    const contexts = contextIds.length ? await organizationAwait(checkpoint, () => tx.brandContext.findMany({
      where: { id: { in: contextIds } }, select: contextParentBindingSelect, take: 22,
    })) : [];
    await lockPlanningRows(tx, "BrandContextSubmission", initial.map(row => row.id), write, checkpoint);
    const submissions = initial.length ? await organizationAwait(checkpoint, () => tx.brandContextSubmission.findMany({
      where: { id: { in: initial.map(row => row.id) } }, select: contextReviewBindingSelect, take: 22,
    })) : [];
    const bindings = new Map<string, ContextOwnerReviewBinding>();
    for (const first of initial) {
      const workspace = workspaces.find(row => row.id === first.workspaceId);
      const context = contexts.find(row => row.id === first.contextId && row.workspaceId === first.workspaceId);
      const submission = submissions.find(row => row.id === first.id && row.contextId === first.contextId && row.workspaceId === first.workspaceId);
      const brand = brands.find(row => row.id === workspace?.brandId);
      if (!workspace || !context || !submission || brand?.userId !== actor.userId || submission.targetOwnerUserId !== actor.userId) continue;
      const original = first.context.workspace;
      if (workspace.scope !== original.scope || workspace.brandId !== original.brandId
        || workspace.clientId !== original.clientId || workspace.organizationId !== original.organizationId) return retry();
      let scope: PlanningScope, currentClientRevision: number | null = null;
      if (workspace.scope === "OWN_BRAND") {
        if (workspace.organizationId !== null || workspace.clientId !== null) return retry();
        scope = { kind: "OWN_BRAND", brandId: workspace.brandId };
      } else {
        const client = workspace.clientId ? validClients.get(workspace.clientId) : undefined;
        if (!client || client.brandId !== workspace.brandId || client.organizationId !== workspace.organizationId) continue;
        scope = { kind: "CLIENT", clientId: client.id }; currentClientRevision = client.revision;
      }
      bindings.set(submission.id, { submission, context, workspace, scope, targetOwnerUserId: actor.userId,
        targetOwnerSessionVersion: actor.sessionVersion, currentClientRevision });
    }
    return action(tx, bindings);
  });
}
