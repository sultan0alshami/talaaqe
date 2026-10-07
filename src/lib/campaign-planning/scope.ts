// Identities only until current native scope/target binding; no journals or TX nesting.
import { Prisma, type PlanningWorkspace } from "@prisma/client";
import { z } from "zod";
import { captureOrganizationActor, checkOrganizationActor, lockStoredOrganization, organizationAwait,
  organizationDb, validateClientDelegation, withOrganizationTransaction,
  type OrganizationActor, type OrganizationOptions } from "@/lib/organizations/context";
import { lockOrganizationRows } from "@/lib/organizations/service";
import { OrganizationError, OrganizationIdSchema } from "@/lib/organizations/contracts";
import { createEvidenceReceiptReader, type EvidenceReceiptReader } from "@/lib/evidence/receipt-reader";
import type { EvidenceActorLocks } from "@/lib/evidence/readiness";
import type { CampaignCoreBrand } from "@/lib/campaigns/core";
import { PlanningScopeSchema, type PlanningScope } from "@/lib/brand-context/contracts";
import { contextParentBindingSelect, lockPlanningRows, resolvePlanningWorkspace, withBrandContextScope,
  type BrandContextScopeContext } from "@/lib/brand-context/scope";
import { CampaignPlanningError, PlanningContextChoiceSchema, parsePlanning } from "./contracts";

export type PlanningCheckpoint = () => void;
export const PLANNING_SCOPE_LIMITS = Object.freeze({ campaigns: 2, contexts: 4, reviews: 22, reviewContexts: 44,
  reviewers: 2412, owners: 63 });
export type PlanningCall = { actor: Readonly<OrganizationActor>; options: OrganizationOptions; now: Date;
  reader: EvidenceReceiptReader; checkpoint: PlanningCheckpoint };
export const planningRetry = (): never => { throw new CampaignPlanningError("RETRY_REQUIRED", 503); };
export const planningMissing = (): never => { throw new CampaignPlanningError("NOT_FOUND", 404); };
export async function beginPlanningCall(actorInput: OrganizationActor, options: OrganizationOptions & { now?: Date } = {}): Promise<PlanningCall> {
  const actor = captureOrganizationActor(actorInput), capturedOptions = { client: organizationDb(options) }, requestedNow = options.now;
  const now = requestedNow === undefined ? new Date() : requestedNow instanceof Date ? new Date(requestedNow.getTime()) : null;
  const reader = createEvidenceReceiptReader(), checkpoint = () => reader.checkpoint();
  await checkOrganizationActor(actor, capturedOptions, checkpoint);
  if (!now || !Number.isFinite(now.getTime())) throw new CampaignPlanningError("INVALID_CLOCK", 400);
  checkpoint(); return { actor, options: capturedOptions, now, reader, checkpoint };
}
export const planningCampaignBindingSelect = { id: true, brandId: true, revision: true, status: true,
  currentBriefVersion: true, updatedAt: true } as const;
export const planningStateBindingSelect = { campaignId: true, workspaceId: true, revision: true,
  selectionId: true, selectionRevision: true } as const;
export const planningVersionBindingSelect = { id: true, contextId: true, workspaceId: true, submissionId: true,
  version: true, inputRevision: true, contentHash: true, approvedByUserId: true, approvedAt: true } as const;
export const campaignReviewBindingSelect = { id: true, campaignId: true, workspaceId: true, briefId: true,
  selectionId: true, selectionRevision: true, inputRevision: true, campaignRevision: true, contentHash: true,
  targetOwnerUserId: true, targetOwnerSessionVersion: true, clientRevision: true, state: true, revision: true,
  createdAt: true, decidedAt: true } as const;
export type PlanningCampaignIdentity = Prisma.CampaignGetPayload<{ select: typeof planningCampaignBindingSelect }>;
export type PlanningStateIdentity = Prisma.CampaignPlanningStateGetPayload<{ select: typeof planningStateBindingSelect }>;
export type PlanningVersionIdentity = Prisma.BrandContextVersionGetPayload<{ select: typeof planningVersionBindingSelect }>;
export type PlanningContextIdentity = Prisma.BrandContextGetPayload<{ select: typeof contextParentBindingSelect }>;
export type PlanningSelectionIdentity = Prisma.CampaignContextSelectionGetPayload<Record<string, never>>;
export type PlanningBindingIdentity = Prisma.CampaignPlanningBindingGetPayload<Record<string, never>>;
export type PlanningDependencyIdentity = Prisma.CampaignProposalDependencyGetPayload<Record<string, never>>;
export type CampaignReviewIdentity = Prisma.CampaignPlanningSubmissionGetPayload<{ select: typeof campaignReviewBindingSelect }>;
const workspaceIdentitySelect = { id: true, scope: true, brandId: true, organizationId: true, clientId: true } as const;
type WorkspaceIdentity = Prisma.PlanningWorkspaceGetPayload<{ select: typeof workspaceIdentitySelect }>;
type ContextChoice = z.infer<typeof PlanningContextChoiceSchema>;
export type PlanningCaptureRequest = { campaignIds?: readonly string[]; choice?: ContextChoice;
  proposalId?: string; proposalCampaignId?: string; includePolicies?: boolean };
export type PlanningScopeCapture = { scope: PlanningScope; campaignIds: readonly string[]; contextIds: readonly string[];
  versions: readonly PlanningVersionIdentity[]; selections: readonly PlanningSelectionIdentity[];
  reviewerIds: readonly string[]; includePolicies: boolean; choice: ContextChoice | null;
  dependency: PlanningDependencyIdentity | null };
export type BoundPlanningCampaign = { campaign: PlanningCampaignIdentity; binding: PlanningBindingIdentity | null;
  state: PlanningStateIdentity | null; selection: PlanningSelectionIdentity | null };
export type PlanningScopeFrame = BrandContextScopeContext & { workspace: PlanningWorkspace | null; brand: CampaignCoreBrand;
  campaigns: ReadonlyMap<string, BoundPlanningCampaign>; contexts: ReadonlyMap<string, PlanningContextIdentity>;
  selections: ReadonlyMap<string, PlanningSelectionIdentity>; versions: ReadonlyMap<string, PlanningVersionIdentity>;
  dependency: PlanningDependencyIdentity | null; evidenceActors: EvidenceActorLocks; capturedContextIds: ReadonlySet<string> };

export function planningWorkspaceMatches(workspace: WorkspaceIdentity, scope: PlanningScope): boolean {
  return scope.kind === "OWN_BRAND" ? workspace.scope === "OWN_BRAND" && workspace.brandId === scope.brandId
    && workspace.organizationId === null && workspace.clientId === null
    : workspace.scope === "CLIENT" && workspace.clientId === scope.clientId && workspace.organizationId !== null;
}
export async function capturePlanningPolicyReviewers(db: Pick<Prisma.TransactionClient, "$queryRaw">, checkpoint: PlanningCheckpoint): Promise<string[]> {
  const rows = await organizationAwait(checkpoint, () => db.$queryRaw<Array<{ id: string }>>`
    SELECT DISTINCT "reviewedBy" AS id FROM "PolicyVersion"
    WHERE kind='MARKET' AND status='VERIFIED' AND "reviewedBy" IS NOT NULL
    ORDER BY "reviewedBy" LIMIT 2413`);
  if (rows.length > PLANNING_SCOPE_LIMITS.reviewers) return planningRetry();
  const ids = parsePlanning(z.array(OrganizationIdSchema).max(PLANNING_SCOPE_LIMITS.reviewers), rows.map(row => row.id));
  checkpoint(); return ids;
}
export async function assertPlanningPolicyCoverage(tx: Prisma.TransactionClient, actors: EvidenceActorLocks, checkpoint: PlanningCheckpoint) {
  const ids = await capturePlanningPolicyReviewers(tx, checkpoint);
  if (ids.some(id => !actors.reviewerIds.has(id))) return planningRetry();
  checkpoint();
}
const campaignTableKeys = { Campaign: "id", CampaignPlanningBinding: "campaignId", CampaignPlanningState: "campaignId",
  CampaignContextSelection: "id", CampaignBrief: "id", CampaignBriefProvenance: "briefId", CampaignPlanningSubmission: "id" } as const;
export async function lockCampaignPlanningRows(tx: Prisma.TransactionClient, table: keyof typeof campaignTableKeys,
  ids: readonly string[], write: boolean, checkpoint: PlanningCheckpoint) {
  const ordered = [...new Set(ids)].sort(); if (!ordered.length) { checkpoint(); return; }
  const column = campaignTableKeys[table];
  await organizationAwait(checkpoint, () => tx.$queryRaw(Prisma.sql`SELECT ${Prisma.raw('"' + column + '"')} AS id
    FROM ${Prisma.raw('"' + table + '"')} WHERE ${Prisma.raw('"' + column + '"')} IN (${Prisma.join(ordered)})
    ORDER BY ${Prisma.raw('"' + column + '"')} ${write ? Prisma.raw("FOR UPDATE") : Prisma.raw("FOR SHARE")}`));
}
async function versionIdentities(db: Prisma.TransactionClient | ReturnType<typeof organizationDb>, ids: readonly string[], checkpoint: PlanningCheckpoint) {
  if (!ids.length) return [];
  return organizationAwait(checkpoint, () => db.brandContextVersion.findMany({ where: { id: { in: [...new Set(ids)] } },
    select: planningVersionBindingSelect, take: ids.length }));
}
export async function capturePlanningScope(call: PlanningCall, scopeInput: PlanningScope,
  request: PlanningCaptureRequest = {}): Promise<PlanningScopeCapture> {
  const scope = Object.freeze(parsePlanning(PlanningScopeSchema, scopeInput));
  const campaignIds = [...new Set(parsePlanning(z.array(OrganizationIdSchema).max(PLANNING_SCOPE_LIMITS.campaigns), request.campaignIds ?? []))].sort();
  const choice = request.choice === undefined ? null : parsePlanning(PlanningContextChoiceSchema, request.choice);
  const proposalId = request.proposalId === undefined ? undefined : parsePlanning(OrganizationIdSchema, request.proposalId);
  const proposalCampaignId = request.proposalCampaignId === undefined ? request.campaignIds?.[0]
    : parsePlanning(OrganizationIdSchema, request.proposalCampaignId);
  const includePolicies = request.includePolicies === true, db = organizationDb(call.options), checkpoint = call.checkpoint;
  const bindings = campaignIds.length ? await organizationAwait(checkpoint, () => db.campaignPlanningBinding.findMany({
    where: { campaignId: { in: campaignIds } }, select: { campaignId: true, workspace: { select: workspaceIdentitySelect } }, take: campaignIds.length,
  })) : [];
  const scopedIds = bindings.filter(row => planningWorkspaceMatches(row.workspace, scope)).map(row => row.campaignId);
  const states = scopedIds.length ? await organizationAwait(checkpoint, () => db.campaignPlanningState.findMany({
    where: { campaignId: { in: scopedIds } }, select: planningStateBindingSelect, take: scopedIds.length,
  })) : [];
  const dependency = proposalId && proposalCampaignId && scopedIds.includes(proposalCampaignId)
    ? await organizationAwait(checkpoint, () => db.campaignProposalDependency.findUnique({ where: {
      campaignId_proposalId: { campaignId: proposalCampaignId, proposalId },
    } })) : null;
  const selectionIds = [...new Set([...states.map(row => row.selectionId), ...(dependency ? [dependency.selectionId] : [])])];
  const selections = selectionIds.length ? await organizationAwait(checkpoint, () => db.campaignContextSelection.findMany({
    where: { id: { in: selectionIds } }, take: selectionIds.length,
  })) : [];
  const wanted = [...new Set([...selections.flatMap(row => row.contextVersionId ? [row.contextVersionId] : []),
    ...(choice?.kind === "APPROVED_CONTEXT" ? [choice.versionId] : [])])];
  const firstVersions = await versionIdentities(db, wanted, checkpoint);
  const workspaceIds = [...new Set(firstVersions.map(row => row.workspaceId))];
  const workspaces = workspaceIds.length ? await organizationAwait(checkpoint, () => db.planningWorkspace.findMany({
    where: { id: { in: workspaceIds } }, select: workspaceIdentitySelect, take: workspaceIds.length,
  })) : [];
  const versions = firstVersions.filter(row => workspaces.some(workspace => workspace.id === row.workspaceId && planningWorkspaceMatches(workspace, scope)));
  const contextIds = [...new Set(versions.map(row => row.contextId))].sort();
  if (contextIds.length > PLANNING_SCOPE_LIMITS.contexts || wanted.length > PLANNING_SCOPE_LIMITS.contexts) return planningRetry();
  const reviewerIds = includePolicies ? await capturePlanningPolicyReviewers(db, checkpoint) : [];
  checkpoint(); return { scope, campaignIds, contextIds, versions, selections, reviewerIds, includePolicies, choice, dependency };
}
export async function lockScopedCampaignMetadata(tx: Prisma.TransactionClient, frame: Pick<PlanningScopeFrame, "workspace" | "brandId" | "scope">,
  campaignIds: readonly string[], write: boolean, checkpoint: PlanningCheckpoint, allowUnboundOwnIds: ReadonlySet<string> = new Set()) {
  const ids = [...new Set(campaignIds)].sort();
  await lockCampaignPlanningRows(tx, "Campaign", ids, write, checkpoint);
  const campaigns = ids.length ? await organizationAwait(checkpoint, () => tx.campaign.findMany({ where: { id: { in: ids } },
    select: planningCampaignBindingSelect, take: ids.length })) : [];
  await lockCampaignPlanningRows(tx, "CampaignPlanningBinding", ids, write, checkpoint);
  const bindings = ids.length ? await organizationAwait(checkpoint, () => tx.campaignPlanningBinding.findMany({ where: { campaignId: { in: ids } }, take: ids.length })) : [];
  await lockCampaignPlanningRows(tx, "CampaignPlanningState", ids, write, checkpoint);
  const states = ids.length ? await organizationAwait(checkpoint, () => tx.campaignPlanningState.findMany({ where: { campaignId: { in: ids } },
    select: planningStateBindingSelect, take: ids.length })) : [];
  const selectionIds = [...new Set(states.map(row => row.selectionId))];
  const selections = selectionIds.length ? await organizationAwait(checkpoint, () => tx.campaignContextSelection.findMany({ where: { id: { in: selectionIds } }, take: selectionIds.length })) : [];
  const result = new Map<string, BoundPlanningCampaign>();
  for (const id of ids) {
    const campaign = campaigns.find(row => row.id === id), binding = bindings.find(row => row.campaignId === id), state = states.find(row => row.campaignId === id);
    if (!campaign || campaign.brandId !== frame.brandId) return planningMissing();
    if (!binding) {
      if (frame.scope.kind !== "OWN_BRAND" || !allowUnboundOwnIds.has(id) || state) return planningMissing();
      result.set(id, { campaign, binding: null, state: null, selection: null }); continue;
    }
    if (!frame.workspace || binding.workspaceId !== frame.workspace.id || binding.brandId !== frame.brandId) return planningMissing();
    const selection = state ? selections.find(row => row.id === state.selectionId) : undefined;
    if (!state || state.workspaceId !== binding.workspaceId || !selection || selection.campaignId !== id
      || selection.workspaceId !== binding.workspaceId || selection.revision !== state.selectionRevision) return planningRetry();
    result.set(id, { campaign, binding, state, selection });
  }
  checkpoint(); return result;
}
export type PlanningScopeOperation<T> = { write: boolean; expectedAuthority?: unknown; allowUnboundOwnIds?: readonly string[];
  replay?: (tx: Prisma.TransactionClient, frame: PlanningScopeFrame) => Promise<{ found: false } | { found: true; result: T }>;
  execute: (tx: Prisma.TransactionClient, frame: PlanningScopeFrame) => Promise<T> };
export async function withPlanningScope<T>(call: PlanningCall, capture: PlanningScopeCapture, operation: PlanningScopeOperation<T>): Promise<T> {
  const { write, execute, replay, expectedAuthority } = operation;
  const allowed = new Set(parsePlanning(z.array(OrganizationIdSchema).max(PLANNING_SCOPE_LIMITS.campaigns), operation.allowUnboundOwnIds ?? []));
  const cache = new WeakMap<object, Promise<PlanningScopeFrame>>();
  const prepare = (tx: Prisma.TransactionClient, context: BrandContextScopeContext) => {
    const known = cache.get(tx); if (known) return known;
    const prepared = (async (): Promise<PlanningScopeFrame> => {
      const checkpoint = call.checkpoint, workspace = await resolvePlanningWorkspace(tx, context, write, checkpoint);
      const brand = await organizationAwait(checkpoint, () => tx.brand.findUnique({ where: { id: context.brandId }, select: { id: true, userId: true, countryCode: true } }));
      if (!brand || brand.userId !== context.targetOwnerUserId) return planningMissing();
      if (!context.ownerIds.has(brand.userId)) return planningRetry();
      await lockPlanningRows(tx, "BrandContext", capture.contextIds, write, checkpoint);
      const contexts = capture.contextIds.length ? await organizationAwait(checkpoint, () => tx.brandContext.findMany({ where: { id: { in: [...capture.contextIds] } },
        select: contextParentBindingSelect, take: capture.contextIds.length })) : [];
      if (contexts.some(row => !workspace || row.workspaceId !== workspace.id) || contexts.length !== capture.contextIds.length) return planningRetry();
      const campaigns = await lockScopedCampaignMetadata(tx, { ...context, workspace }, capture.campaignIds, write, checkpoint, allowed);
      const actualSelectionIds = [...new Set([...capture.selections.map(row => row.id), ...[...campaigns.values()].flatMap(row => row.selection ? [row.selection.id] : [])])];
      const actualSelections = actualSelectionIds.length ? await organizationAwait(checkpoint, () => tx.campaignContextSelection.findMany({
        where: { id: { in: actualSelectionIds } }, take: actualSelectionIds.length,
      })) : [];
      if (actualSelections.some(row => !workspace || row.workspaceId !== workspace.id)) return planningRetry();
      const versionIds = [...new Set([...capture.versions.map(row => row.id), ...actualSelections.flatMap(row => row.contextVersionId ? [row.contextVersionId] : [])])];
      const actualVersions = await versionIdentities(tx, versionIds, checkpoint), capturedContextIds = new Set(capture.contextIds);
      if (actualVersions.some(row => !workspace || row.workspaceId !== workspace.id || !capturedContextIds.has(row.contextId))) return planningRetry();
      await lockCampaignPlanningRows(tx, "CampaignContextSelection", actualSelectionIds, write, checkpoint);
      await lockPlanningRows(tx, "BrandContextVersion", versionIds, false, checkpoint);
      await lockPlanningRows(tx, "BrandContextSubmission", actualVersions.map(row => row.submissionId), false, checkpoint);
      const evidenceActors: EvidenceActorLocks = { ownerIds: context.ownerIds, reviewerIds: context.reviewerIds,
        creatorOwners: new Map(), brandOwners: new Map([[brand.id, brand.userId]]) };
      if (capture.includePolicies) await assertPlanningPolicyCoverage(tx, evidenceActors, checkpoint);
      checkpoint(); return { ...context, workspace, brand, campaigns, contexts: new Map(contexts.map(row => [row.id, row])),
        selections: new Map(actualSelections.map(row => [row.id, row])), versions: new Map(actualVersions.map(row => [row.id, row])),
        dependency: capture.dependency, evidenceActors, capturedContextIds };
    })();
    cache.set(tx, prepared); return prepared;
  };
  return withBrandContextScope(call.actor, capture.scope, write ? "plan" : "view", {
    write, expectedAuthority, checkpoint: call.checkpoint,
    reviewerIds: capture.reviewerIds,
    replay: replay ? async (tx, context) => replay(tx, await prepare(tx, context)) : undefined,
    execute: async (tx, context) => execute(tx, await prepare(tx, context)),
  }, call.options);
}

// Owner review scope is metadata only: no Campaign.input,
// narrative or submitted content is read before the authorized binding map.
const ownerWorkspaceSelect = { ...workspaceIdentitySelect, brand: { select: { id: true, userId: true, countryCode: true } },
  client: { select: { organization: { select: { ownerUserId: true } } } } } as const;
type OwnerWorkspaceIdentity = Prisma.PlanningWorkspaceGetPayload<{ select: typeof ownerWorkspaceSelect }>;
export const planningBriefBindingSelect = { id: true, campaignId: true, version: true, inputRevision: true,
  approvedAt: true, approvedByUserId: true, createdAt: true } as const;
export type PlanningBriefIdentity = Prisma.CampaignBriefGetPayload<{ select: typeof planningBriefBindingSelect }>;
export type CampaignOwnerScopeCapture = { submissionIds: readonly string[]; submissions: readonly CampaignReviewIdentity[];
  workspaces: readonly OwnerWorkspaceIdentity[]; versions: readonly PlanningVersionIdentity[];
  contextIds: readonly string[]; reviewerIds: readonly string[]; includePolicies: boolean };
export type CampaignOwnerBinding = { submission: CampaignReviewIdentity; workspace: PlanningWorkspace; scope: PlanningScope;
  brand: CampaignCoreBrand; campaign: PlanningCampaignIdentity; state: PlanningStateIdentity;
  currentSelection: PlanningSelectionIdentity; submittedSelection: PlanningSelectionIdentity;
  brief: PlanningBriefIdentity; provenance: Prisma.CampaignBriefProvenanceGetPayload<Record<string, never>>;
  targetOwnerUserId: string; targetOwnerSessionVersion: number; currentClientRevision: number | null };
export type CampaignOwnerScopeFrame = { bindings: ReadonlyMap<string, CampaignOwnerBinding>;
  contexts: ReadonlyMap<string, PlanningContextIdentity>; versions: ReadonlyMap<string, PlanningVersionIdentity>;
  selections: ReadonlyMap<string, PlanningSelectionIdentity>; evidenceActors: EvidenceActorLocks;
  capturedContextIds: ReadonlySet<string> };

export async function captureCampaignOwnerReviewScope(call: PlanningCall, submissionIdsInput: readonly string[],
  options: { includePolicies?: boolean } = {}): Promise<CampaignOwnerScopeCapture> {
  const includePolicies = options.includePolicies === true;
  const submissionIds = [...new Set(parsePlanning(z.array(OrganizationIdSchema).max(PLANNING_SCOPE_LIMITS.reviews), [...submissionIdsInput]))].sort();
  const db = organizationDb(call.options), checkpoint = call.checkpoint;
  const submissions = submissionIds.length ? await organizationAwait(checkpoint, () => db.campaignPlanningSubmission.findMany({
    where: { id: { in: submissionIds }, targetOwnerUserId: call.actor.userId }, select: campaignReviewBindingSelect, take: submissionIds.length,
  })) : [];
  const workspaceIds = [...new Set(submissions.map(row => row.workspaceId))];
  const workspaces = workspaceIds.length ? await organizationAwait(checkpoint, () => db.planningWorkspace.findMany({
    where: { id: { in: workspaceIds } }, select: ownerWorkspaceSelect, take: workspaceIds.length,
  })) : [];
  const campaignIds = [...new Set(submissions.map(row => row.campaignId))];
  const states = campaignIds.length ? await organizationAwait(checkpoint, () => db.campaignPlanningState.findMany({
    where: { campaignId: { in: campaignIds } }, select: planningStateBindingSelect, take: campaignIds.length,
  })) : [];
  const selectionIds = [...new Set([...submissions.map(row => row.selectionId), ...states.map(row => row.selectionId)])];
  const selections = selectionIds.length ? await organizationAwait(checkpoint, () => db.campaignContextSelection.findMany({
    where: { id: { in: selectionIds } }, take: selectionIds.length,
  })) : [];
  const versions = await versionIdentities(db, [...new Set(selections.flatMap(row => row.contextVersionId ? [row.contextVersionId] : []))], checkpoint);
  const contextIds = [...new Set(versions.map(row => row.contextId))].sort();
  if (contextIds.length > PLANNING_SCOPE_LIMITS.reviewContexts) return planningRetry();
  const reviewerIds = includePolicies ? await capturePlanningPolicyReviewers(db, checkpoint) : [];
  checkpoint(); return { submissionIds, submissions, workspaces, versions, contextIds, reviewerIds, includePolicies };
}
export async function withCampaignOwnerReviewScope<T>(call: PlanningCall, capture: CampaignOwnerScopeCapture, write: boolean,
  action: (tx: Prisma.TransactionClient, frame: CampaignOwnerScopeFrame) => Promise<T>): Promise<T> {
  const checkpoint = call.checkpoint;
  const userIds = [...new Set(capture.workspaces.flatMap(row => [row.brand.userId,
    ...(row.client ? [row.client.organization.ownerUserId] : [])]))].sort();
  if (userIds.length > PLANNING_SCOPE_LIMITS.owners) return planningRetry();
  return withOrganizationTransaction(call.actor, call.options, { write, userIds, reviewerIds: [...capture.reviewerIds], checkpoint },
    async (tx, ownerIds, reviewerIds) => {
      const orgIds = [...new Set(capture.workspaces.flatMap(row => row.organizationId ? [row.organizationId] : []))].sort();
      const organizations = new Map<string, boolean>();
      for (const id of orgIds) {
        const organization = await lockStoredOrganization(tx, id, ownerIds, write, checkpoint);
        const owner = await organizationAwait(checkpoint, () => tx.user.findUnique({ where: { id: organization.ownerUserId }, select: { active: true, role: true } }));
        organizations.set(id, organization.active && !!owner?.active && owner.role === "BRAND");
      }
      const clientIds = [...new Set(capture.workspaces.flatMap(row => row.clientId ? [row.clientId] : []))].sort();
      await lockOrganizationRows(tx, "OrganizationClient", clientIds, write, checkpoint);
      const clients = clientIds.length ? await organizationAwait(checkpoint, () => tx.organizationClient.findMany({
        where: { id: { in: clientIds } }, select: { id: true, organizationId: true, brandId: true, state: true, revision: true,
          authorizingUserId: true, authorizingSessionVersion: true, allowedCapabilities: true }, take: clientIds.length,
      })) : [];
      const brandIds = [...new Set(capture.workspaces.map(row => row.brandId))].sort();
      await lockOrganizationRows(tx, "Brand", brandIds, write, checkpoint);
      const brands = brandIds.length ? await organizationAwait(checkpoint, () => tx.brand.findMany({ where: { id: { in: brandIds } },
        select: { id: true, userId: true, countryCode: true }, take: brandIds.length })) : [];
      const currentBrands = brands.filter(row => row.userId === call.actor.userId);
      if (currentBrands.some(row => !ownerIds.has(row.userId))) return planningRetry();
      const validClients = new Map<string, typeof clients[number]>();
      for (const client of clients) {
        const expected = capture.workspaces.find(workspace => workspace.clientId === client.id);
        if (!expected || client.brandId !== expected.brandId || client.organizationId !== expected.organizationId) return planningRetry();
        if (!organizations.get(client.organizationId) || client.authorizingUserId !== call.actor.userId) continue;
        try { const current = await validateClientDelegation(tx, client, ownerIds, checkpoint);
          if (current.brand.userId === call.actor.userId && current.capabilities.plan) validClients.set(client.id, client);
        } catch (error) { if (!(error instanceof OrganizationError && error.code === "NOT_FOUND")) throw error; }
      }
      const workspaceIds = capture.workspaces.map(row => row.id);
      await lockPlanningRows(tx, "PlanningWorkspace", workspaceIds, write, checkpoint);
      const workspaces = workspaceIds.length ? await organizationAwait(checkpoint, () => tx.planningWorkspace.findMany({
        where: { id: { in: workspaceIds } }, take: workspaceIds.length,
      })) : [];
      const authorized = new Map<string, { workspace: PlanningWorkspace; scope: PlanningScope; brand: CampaignCoreBrand; clientRevision: number | null }>();
      for (const workspace of workspaces) {
        const first = capture.workspaces.find(row => row.id === workspace.id);
        if (!first || workspace.scope !== first.scope || workspace.brandId !== first.brandId || workspace.organizationId !== first.organizationId || workspace.clientId !== first.clientId) return planningRetry();
        const brand = currentBrands.find(row => row.id === workspace.brandId); if (!brand) continue;
        if (workspace.scope === "OWN_BRAND") {
          if (workspace.clientId !== null || workspace.organizationId !== null) return planningRetry();
          authorized.set(workspace.id, { workspace, scope: { kind: "OWN_BRAND", brandId: brand.id }, brand, clientRevision: null });
        } else {
          const client = workspace.clientId ? validClients.get(workspace.clientId) : undefined;
          if (!client || client.brandId !== workspace.brandId || client.organizationId !== workspace.organizationId) continue;
          authorized.set(workspace.id, { workspace, scope: { kind: "CLIENT", clientId: client.id }, brand, clientRevision: client.revision });
        }
      }
      // Lock all captured contexts before any Campaign, including the stale
      // submitted pin and current selection. This never discovers a late lock.
      await lockPlanningRows(tx, "BrandContext", capture.contextIds, write, checkpoint);
      const contexts = capture.contextIds.length ? await organizationAwait(checkpoint, () => tx.brandContext.findMany({
        where: { id: { in: [...capture.contextIds] } }, select: contextParentBindingSelect, take: capture.contextIds.length,
      })) : [];
      const relevant = capture.submissions.filter(row => authorized.has(row.workspaceId));
      const campaignIds = [...new Set(relevant.map(row => row.campaignId))].sort();
      await lockCampaignPlanningRows(tx, "Campaign", campaignIds, write, checkpoint);
      const campaigns = campaignIds.length ? await organizationAwait(checkpoint, () => tx.campaign.findMany({ where: { id: { in: campaignIds } },
        select: planningCampaignBindingSelect, take: campaignIds.length })) : [];
      await lockCampaignPlanningRows(tx, "CampaignPlanningBinding", campaignIds, write, checkpoint);
      const bindings = campaignIds.length ? await organizationAwait(checkpoint, () => tx.campaignPlanningBinding.findMany({ where: { campaignId: { in: campaignIds } }, take: campaignIds.length })) : [];
      await lockCampaignPlanningRows(tx, "CampaignPlanningState", campaignIds, write, checkpoint);
      const states = campaignIds.length ? await organizationAwait(checkpoint, () => tx.campaignPlanningState.findMany({
        where: { campaignId: { in: campaignIds } }, select: planningStateBindingSelect, take: campaignIds.length,
      })) : [];
      const selectionIds = [...new Set([...relevant.map(row => row.selectionId), ...states.map(row => row.selectionId)])];
      const selections = selectionIds.length ? await organizationAwait(checkpoint, () => tx.campaignContextSelection.findMany({ where: { id: { in: selectionIds } }, take: selectionIds.length })) : [];
      const versionIds = [...new Set(selections.flatMap(row => row.contextVersionId ? [row.contextVersionId] : []))];
      const versions = await versionIdentities(tx, versionIds, checkpoint), capturedContextIds = new Set(capture.contextIds);
      if (versions.some(row => !capturedContextIds.has(row.contextId)) || versions.some(row => !contexts.some(parent => parent.id === row.contextId && parent.workspaceId === row.workspaceId))) return planningRetry();
      await lockCampaignPlanningRows(tx, "CampaignContextSelection", selectionIds, write, checkpoint);
      await lockPlanningRows(tx, "BrandContextVersion", versionIds, false, checkpoint);
      await lockPlanningRows(tx, "BrandContextSubmission", versions.map(row => row.submissionId), false, checkpoint);
      const briefIds = [...new Set(relevant.map(row => row.briefId))];
      await lockCampaignPlanningRows(tx, "CampaignBrief", briefIds, write, checkpoint);
      const briefs = briefIds.length ? await organizationAwait(checkpoint, () => tx.campaignBrief.findMany({ where: { id: { in: briefIds } },
        select: planningBriefBindingSelect, take: briefIds.length })) : [];
      await lockCampaignPlanningRows(tx, "CampaignBriefProvenance", briefIds, write, checkpoint);
      const provenances = briefIds.length ? await organizationAwait(checkpoint, () => tx.campaignBriefProvenance.findMany({ where: { briefId: { in: briefIds } }, take: briefIds.length })) : [];
      const submissionIds = relevant.map(row => row.id);
      await lockCampaignPlanningRows(tx, "CampaignPlanningSubmission", submissionIds, write, checkpoint);
      const submissions = submissionIds.length ? await organizationAwait(checkpoint, () => tx.campaignPlanningSubmission.findMany({
        where: { id: { in: submissionIds } }, select: campaignReviewBindingSelect, take: submissionIds.length,
      })) : [];
      const result = new Map<string, CampaignOwnerBinding>();
      for (const first of relevant) {
        const current = authorized.get(first.workspaceId)!, submission = submissions.find(row => row.id === first.id), campaign = campaigns.find(row => row.id === first.campaignId);
        const binding = bindings.find(row => row.campaignId === first.campaignId), state = states.find(row => row.campaignId === first.campaignId);
        if (!submission || submission.targetOwnerUserId !== call.actor.userId) continue;
        if (submission.campaignId !== first.campaignId || submission.workspaceId !== first.workspaceId || submission.briefId !== first.briefId
          || submission.selectionId !== first.selectionId || submission.selectionRevision !== first.selectionRevision) return planningRetry();
        const selected = selections.find(row => row.id === submission.selectionId), currentSelection = state ? selections.find(row => row.id === state.selectionId) : undefined;
        const brief = briefs.find(row => row.id === submission.briefId), provenance = provenances.find(row => row.briefId === submission.briefId);
        if (!campaign || campaign.brandId !== current.brand.id || !binding || binding.workspaceId !== current.workspace.id || binding.brandId !== current.brand.id
          || !state || state.workspaceId !== current.workspace.id || !currentSelection || currentSelection.campaignId !== campaign.id || currentSelection.workspaceId !== current.workspace.id
          || currentSelection.revision !== state.selectionRevision || !selected || selected.campaignId !== campaign.id || selected.workspaceId !== current.workspace.id
          || selected.revision !== submission.selectionRevision || !brief || brief.campaignId !== campaign.id || !provenance || provenance.campaignId !== campaign.id
          || provenance.workspaceId !== current.workspace.id || provenance.selectionId !== submission.selectionId || provenance.selectionRevision !== submission.selectionRevision) return planningRetry();
        result.set(submission.id, { submission, workspace: current.workspace, scope: current.scope, brand: current.brand, campaign, state,
          currentSelection, submittedSelection: selected, brief, provenance, targetOwnerUserId: call.actor.userId,
          targetOwnerSessionVersion: call.actor.sessionVersion, currentClientRevision: current.clientRevision });
      }
      const evidenceActors: EvidenceActorLocks = { ownerIds, reviewerIds, creatorOwners: new Map(), brandOwners: new Map(currentBrands.map(row => [row.id, row.userId])) };
      if (capture.includePolicies) await assertPlanningPolicyCoverage(tx, evidenceActors, checkpoint);
      checkpoint(); return action(tx, { bindings: result, contexts: new Map(contexts.map(row => [row.id, row])), versions: new Map(versions.map(row => [row.id, row])),
        selections: new Map(selections.map(row => [row.id, row])), evidenceActors, capturedContextIds });
    });
}
