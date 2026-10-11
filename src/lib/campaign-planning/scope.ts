// Identities only until current native scope/target binding; no journals or TX nesting.
import { Prisma, type PlanningWorkspace } from "@prisma/client";
import { z } from "zod";
import { readAiPlanningNativeFrame, type AiPlanningNativeFrame } from "@/lib/ai-budget/ledger";
import { CampaignStatusSchema, UtcDateTimeSchema } from "@/lib/contracts/vocabulary";
import { checkedJson } from "@/lib/onboarding/drafts";
import { captureOrganizationActor, checkOrganizationActor, lockStoredOrganization, organizationAwait,
  organizationDb, validateClientDelegation, withOrganizationTransaction,
  type OrganizationActor, type OrganizationOptions } from "@/lib/organizations/context";
import { lockOrganizationRows } from "@/lib/organizations/service";
import { OrganizationError, OrganizationIdSchema, OrganizationRevisionSchema } from "@/lib/organizations/contracts";
import { createEvidenceReceiptReader, type EvidenceReceiptReader } from "@/lib/evidence/receipt-reader";
import type { EvidenceActorLocks } from "@/lib/evidence/readiness";
import type { CampaignCoreBrand } from "@/lib/campaigns/core";
import { PlanningScopeSchema, type PlanningScope } from "@/lib/brand-context/contracts";
import { contextParentBindingSelect, lockPlanningRows, resolvePlanningWorkspace, withBrandContextScope, brandContextScopeInternals,
  type BrandContextScopeContext, type BrandContextPlanningProof, type BrandScopeView } from "@/lib/brand-context/scope";
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

// Fixed current-selection metadata lane. It does not consult the legacy prepare
// cache, create a workspace, hydrate source bodies or authorize later dispatch.
const nativeId = OrganizationIdSchema, nativeRevision = OrganizationRevisionSchema;
const nativeHash = z.string().regex(/^[a-f0-9]{64}$/);
const nativeActor = z.object({ userId: nativeId, role: z.enum(["BRAND", "CREATOR", "ADMIN"]),
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{43}$/), sessionVersion: z.number().int().min(1).max(2147483647) }).strict();
const nativeWorkspace = z.object({ id: nativeId, scope: z.enum(["OWN_BRAND", "CLIENT"]), brandId: nativeId,
  organizationId: nativeId.nullable(), clientId: nativeId.nullable() }).strict();
const nativeCampaign = z.object({ id: nativeId, brandId: nativeId, revision: nativeRevision, status: CampaignStatusSchema,
  currentBriefVersion: nativeRevision.nullable(), updatedAt: UtcDateTimeSchema }).strict();
const nativeBinding = z.object({ campaignId: nativeId, workspaceId: nativeId, brandId: nativeId }).strict();
const nativeState = z.object({ campaignId: nativeId, workspaceId: nativeId, revision: nativeRevision,
  selectionId: nativeId, selectionRevision: nativeRevision }).strict();
const nativeContext = z.object({ id: nativeId, workspaceId: nativeId, archived: z.boolean() }).strict();
const nativeSelection = z.object({ id: nativeId, campaignId: nativeId, workspaceId: nativeId, revision: nativeRevision,
  contextVersionId: nativeId.nullable(), contentHash: nativeHash.nullable() }).strict();
const nativeVersion = z.object({ id: nativeId, contextId: nativeId, workspaceId: nativeId, submissionId: nativeId,
  version: nativeRevision, inputRevision: nativeRevision, contentHash: nativeHash, approvedByUserId: nativeId, approvedAt: UtcDateTimeSchema }).strict();
const nativeSubmission = z.object({ id: nativeId, contextId: nativeId, workspaceId: nativeId, inputRevision: nativeRevision,
  contentHash: nativeHash, state: z.literal("APPROVED"), decidedByUserId: nativeId, decidedAt: UtcDateTimeSchema }).strict();
const nativeIds = (maximum: number) => z.array(nativeId).max(maximum)
  .refine(ids => ids.every((id, index) => index === 0 || ids[index - 1]! < id));
const nativeOrdered = <T extends z.ZodType>(schema: T, maximum: number, key: "id" | "campaignId") => z.array(schema).max(maximum)
  .refine(rows => rows.every((row, index) => index === 0 || String((rows[index - 1] as Record<string, unknown>)[key]) < String((row as Record<string, unknown>)[key])));
const nativeCaptureBody = z.object({ actor: nativeActor, scope: PlanningScopeSchema, campaignIds: nativeIds(2).min(1), workspace: nativeWorkspace,
  campaigns: nativeOrdered(nativeCampaign, 2, "id"), bindings: nativeOrdered(nativeBinding, 2, "campaignId"), states: nativeOrdered(nativeState, 2, "campaignId"),
  contextIds: nativeIds(4), contexts: nativeOrdered(nativeContext, 4, "id"), selections: nativeOrdered(nativeSelection, 2, "id"),
  versions: nativeOrdered(nativeVersion, 4, "id"), submissions: nativeOrdered(nativeSubmission, 4, "id"), reviewerIds: nativeIds(2412) }).strict();
function sameNativeMetadata(left: unknown, right: unknown) { return JSON.stringify(left) === JSON.stringify(right); }
function nativeReachedIds(values: readonly string[]) { return [...new Set(values)].sort(); }
function sortNativeMetadata<T extends object>(rows: readonly T[], key: keyof T): T[] {
  return [...rows].sort((left, right) => String(left[key]) < String(right[key]) ? -1 : String(left[key]) > String(right[key]) ? 1 : 0);
}
function nativeRelationships(value: z.infer<typeof nativeCaptureBody>) {
  const w = value.workspace;
  if (!planningWorkspaceMatches(w, value.scope) || !sameNativeMetadata(value.campaignIds, value.campaigns.map(row => row.id))
    || !sameNativeMetadata(value.campaignIds, value.bindings.map(row => row.campaignId))
    || !sameNativeMetadata(value.campaignIds, value.states.map(row => row.campaignId))) return false;
  for (const campaign of value.campaigns) {
    const binding = value.bindings.find(row => row.campaignId === campaign.id), state = value.states.find(row => row.campaignId === campaign.id);
    const selected = state && value.selections.find(row => row.id === state.selectionId);
    if (campaign.brandId !== w.brandId || !binding || binding.workspaceId !== w.id || binding.brandId !== w.brandId
      || !state || state.workspaceId !== w.id || !selected || selected.campaignId !== campaign.id || selected.workspaceId !== w.id
      || selected.revision !== state.selectionRevision || (selected.contextVersionId === null) !== (selected.contentHash === null)) return false;
  }
  if (!sameNativeMetadata(nativeReachedIds(value.states.map(row => row.selectionId)), value.selections.map(row => row.id))
    || !sameNativeMetadata(nativeReachedIds(value.selections.flatMap(row => row.contextVersionId ? [row.contextVersionId] : [])), value.versions.map(row => row.id))
    || !sameNativeMetadata(nativeReachedIds(value.versions.map(row => row.contextId)), value.contextIds)
    || !sameNativeMetadata(value.contextIds, value.contexts.map(row => row.id))
    || !sameNativeMetadata(nativeReachedIds(value.versions.map(row => row.submissionId)), value.submissions.map(row => row.id))) return false;
  for (const version of value.versions) {
    const context = value.contexts.find(row => row.id === version.contextId), submission = value.submissions.find(row => row.id === version.submissionId);
    if (!context || context.workspaceId !== w.id || version.workspaceId !== w.id || !submission || submission.contextId !== context.id
      || submission.workspaceId !== w.id || submission.inputRevision !== version.inputRevision || submission.contentHash !== version.contentHash
      || submission.decidedByUserId !== version.approvedByUserId || submission.decidedAt !== version.approvedAt) return false;
  }
  return value.selections.every(row => row.contextVersionId === null || value.versions.some(version => version.id === row.contextVersionId && version.contentHash === row.contentHash));
}
const nativeCaptureSchema = z.unknown().superRefine((value, ctx) => {
  try { checkedJson(value, 524288); } catch { ctx.addIssue({ code: "custom", message: "Bounded planning metadata required" }); }
}).pipe(nativeCaptureBody.refine(nativeRelationships, "Exact current source relationships required"));
type NativeReadonly<T> = T extends readonly (infer U)[] ? readonly NativeReadonly<U>[] : T extends object ? { readonly [K in keyof T]: NativeReadonly<T[K]> } : T;
export type PlanningNativeScopeCapture = NativeReadonly<z.infer<typeof nativeCaptureSchema>>;
type PlanningNativeRows = Omit<z.infer<typeof nativeCaptureBody>, "actor" | "scope" | "campaignIds" | "contextIds" | "reviewerIds">;
export type PlanningScopeView = NativeReadonly<BrandScopeView & PlanningNativeRows & { policyReviewerIds: readonly string[] }>;
declare const planningBoundScopeBrand: unique symbol;
export type PlanningBoundScopeProof = Readonly<{ [planningBoundScopeBrand]: true }>;
function freezeNativeMetadata<T>(value: T): NativeReadonly<T> {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freezeNativeMetadata(child); Object.freeze(value); }
  return value as NativeReadonly<T>;
}
function sameNativeActor(left: OrganizationActor, right: OrganizationActor) {
  return left.userId === right.userId && left.role === right.role && left.sessionId === right.sessionId && left.sessionVersion === right.sessionVersion;
}
const nativeScopeUnavailable = (): never => { throw new CampaignPlanningError("SCOPE_PROOF_UNAVAILABLE", 503); };
const nativeContextSelect = { id: true, workspaceId: true, archived: true } as const;
const nativeBindingSelect = { campaignId: true, workspaceId: true, brandId: true } as const;
const nativeSelectionSelect = { id: true, campaignId: true, workspaceId: true, revision: true, contextVersionId: true, contentHash: true } as const;
const nativeSubmissionSelect = { id: true, contextId: true, workspaceId: true, inputRevision: true, contentHash: true,
  state: true, decidedByUserId: true, decidedAt: true } as const;
type NativeMetadataDb = Prisma.TransactionClient | ReturnType<typeof organizationDb>;
function nativeIso(date: Date) { if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return planningRetry(); return date.toISOString(); }
function encodeNativeCampaign<T extends { updatedAt: Date }>(row: T) { return { ...row, updatedAt: nativeIso(row.updatedAt) }; }
function encodeNativeVersion<T extends { approvedAt: Date }>(row: T) { return { ...row, approvedAt: nativeIso(row.approvedAt) }; }
function encodeNativeSubmission<T extends { decidedAt: Date | null }>(row: T) { return { ...row, decidedAt: row.decidedAt ? nativeIso(row.decidedAt) : null }; }
async function readNativeRows(db: NativeMetadataDb, capture: PlanningNativeScopeCapture, checkpoint: PlanningCheckpoint): Promise<PlanningNativeRows> {
  const workspace = await organizationAwait(checkpoint, () => db.planningWorkspace.findUnique({ where: { id: capture.workspace.id }, select: workspaceIdentitySelect }));
  if (!workspace) return planningMissing();
  const contexts = capture.contextIds.length ? await organizationAwait(checkpoint, () => db.brandContext.findMany({ where: { id: { in: [...capture.contextIds] } },
    select: nativeContextSelect, orderBy: { id: "asc" }, take: capture.contextIds.length })) : [];
  const campaigns = await organizationAwait(checkpoint, () => db.campaign.findMany({ where: { id: { in: [...capture.campaignIds] } },
    select: planningCampaignBindingSelect, orderBy: { id: "asc" }, take: capture.campaignIds.length }));
  const bindings = await organizationAwait(checkpoint, () => db.campaignPlanningBinding.findMany({ where: { campaignId: { in: [...capture.campaignIds] } },
    select: nativeBindingSelect, orderBy: { campaignId: "asc" }, take: capture.campaignIds.length }));
  const states = await organizationAwait(checkpoint, () => db.campaignPlanningState.findMany({ where: { campaignId: { in: [...capture.campaignIds] } },
    select: planningStateBindingSelect, orderBy: { campaignId: "asc" }, take: capture.campaignIds.length }));
  const selections = await organizationAwait(checkpoint, () => db.campaignContextSelection.findMany({ where: { id: { in: capture.selections.map(row => row.id) } },
    select: nativeSelectionSelect, orderBy: { id: "asc" }, take: capture.selections.length }));
  const versions = capture.versions.length ? await organizationAwait(checkpoint, () => db.brandContextVersion.findMany({ where: { id: { in: capture.versions.map(row => row.id) } },
    select: planningVersionBindingSelect, orderBy: { id: "asc" }, take: capture.versions.length })) : [];
  const submissions = capture.submissions.length ? await organizationAwait(checkpoint, () => db.brandContextSubmission.findMany({ where: { id: { in: capture.submissions.map(row => row.id) } },
    select: nativeSubmissionSelect, orderBy: { id: "asc" }, take: capture.submissions.length })) : [];
  if (campaigns.length !== capture.campaignIds.length || bindings.length !== capture.campaignIds.length
    || campaigns.some(row => row.brandId !== workspace.brandId) || bindings.some(row => row.workspaceId !== workspace.id || row.brandId !== workspace.brandId)) return planningMissing();
  const parsed = nativeCaptureSchema.safeParse({ ...capture, workspace, contexts: sortNativeMetadata(contexts, "id"),
    campaigns: sortNativeMetadata(campaigns.map(encodeNativeCampaign), "id"), bindings: sortNativeMetadata(bindings, "campaignId"),
    states: sortNativeMetadata(states, "campaignId"), selections: sortNativeMetadata(selections, "id"),
    versions: sortNativeMetadata(versions.map(encodeNativeVersion), "id"), submissions: sortNativeMetadata(submissions.map(encodeNativeSubmission), "id") });
  if (!parsed.success) return planningRetry();
  const { actor, scope, campaignIds, contextIds, reviewerIds, ...rows } = parsed.data;
  void actor; void scope; void campaignIds; void contextIds; void reviewerIds; return rows;
}
async function captureNativePlanningIdentity(call: PlanningCall, scopeInput: PlanningScope, idsInput: readonly string[]): Promise<PlanningNativeScopeCapture> {
  const actor = captureOrganizationActor(call.actor), scope = Object.freeze(parsePlanning(PlanningScopeSchema, scopeInput));
  const campaignIds = parsePlanning(nativeIds(2).min(1), [...idsInput].sort()), options = { client: organizationDb(call.options) }, checkpoint = call.checkpoint;
  const copiedCall = { ...call, actor, options, checkpoint };
  await checkOrganizationActor(actor, options, checkpoint);
  const captured = await capturePlanningScope(copiedCall, scope, { campaignIds, includePolicies: true });
  const bound = await organizationAwait(checkpoint, () => options.client.campaignPlanningBinding.findMany({ where: { campaignId: { in: campaignIds } },
    select: { ...nativeBindingSelect, workspace: { select: workspaceIdentitySelect } }, orderBy: { campaignId: "asc" }, take: campaignIds.length }));
  if (bound.length !== campaignIds.length || !bound.length || bound.some(row => row.workspaceId !== bound[0]!.workspaceId
    || !planningWorkspaceMatches(row.workspace, scope) || row.brandId !== row.workspace.brandId)) return planningMissing();
  const db = options.client, workspace = bound[0]!.workspace;
  const contexts = captured.contextIds.length ? await organizationAwait(checkpoint, () => db.brandContext.findMany({ where: { id: { in: [...captured.contextIds] } },
    select: nativeContextSelect, orderBy: { id: "asc" }, take: captured.contextIds.length })) : [];
  const campaigns = await organizationAwait(checkpoint, () => db.campaign.findMany({ where: { id: { in: campaignIds } }, select: planningCampaignBindingSelect, orderBy: { id: "asc" }, take: campaignIds.length }));
  const states = await organizationAwait(checkpoint, () => db.campaignPlanningState.findMany({ where: { campaignId: { in: campaignIds } }, select: planningStateBindingSelect, orderBy: { campaignId: "asc" }, take: campaignIds.length }));
  const submissions = captured.versions.length ? await organizationAwait(checkpoint, () => db.brandContextSubmission.findMany({ where: { id: { in: captured.versions.map(row => row.submissionId) } },
    select: nativeSubmissionSelect, orderBy: { id: "asc" }, take: captured.versions.length })) : [];
  const input = { actor, scope, campaignIds, workspace, campaigns: sortNativeMetadata(campaigns.map(encodeNativeCampaign), "id"),
    bindings: sortNativeMetadata(bound.map(({ campaignId, workspaceId, brandId }) => ({ campaignId, workspaceId, brandId })), "campaignId"),
    states: sortNativeMetadata(states, "campaignId"), contextIds: [...captured.contextIds].sort(), contexts: sortNativeMetadata(contexts, "id"),
    selections: sortNativeMetadata(captured.selections.map(({ id, campaignId, workspaceId, revision, contextVersionId, contentHash }) => ({ id, campaignId, workspaceId, revision, contextVersionId, contentHash })), "id"),
    versions: sortNativeMetadata(captured.versions.map(encodeNativeVersion), "id"),
    submissions: sortNativeMetadata(submissions.map(encodeNativeSubmission), "id"), reviewerIds: [...captured.reviewerIds].sort() };
  const parsed = nativeCaptureSchema.safeParse(input); if (!parsed.success) return planningRetry();
  return freezeNativeMetadata(parsed.data);
}
type NativePlanningProofState = { frame: AiPlanningNativeFrame; tx: Prisma.TransactionClient; brandProof: BrandContextPlanningProof;
  capture: PlanningNativeScopeCapture; checkpoint: PlanningCheckpoint; rows: PlanningNativeRows; view: PlanningScopeView };
const nativePlanningProofs = new WeakMap<object, NativePlanningProofState>();
function nativeBrandMatches(capture: PlanningNativeScopeCapture, brand: BrandScopeView) {
  const workspace = capture.workspace;
  return sameNativeMetadata(capture.scope, brand.scope) && workspace.scope === brand.scope.kind && workspace.brandId === brand.brandId
    && workspace.organizationId === brand.organizationId && workspace.clientId === brand.clientId;
}
async function prepareNativePlanningInFrame(frame: AiPlanningNativeFrame, brandProof: BrandContextPlanningProof, call: PlanningCall,
  input: PlanningNativeScopeCapture): Promise<PlanningBoundScopeProof> {
  const parsed = nativeCaptureSchema.safeParse(input), copiedActor = nativeActor.safeParse(call.actor), checkpoint = call.checkpoint;
  const base = await readAiPlanningNativeFrame(frame), brand = await brandContextScopeInternals.readPlanningProof(frame, brandProof);
  if (!parsed.success || !copiedActor.success) throw new CampaignPlanningError("VALIDATION", 422);
  const capture = freezeNativeMetadata(parsed.data);
  if (!sameNativeActor(copiedActor.data, base.actor) || !sameNativeActor(capture.actor, base.actor) || !nativeBrandMatches(capture, brand)) return nativeScopeUnavailable();
  if (capture.reviewerIds.some(id => !base.ownerIds.includes(id) && !base.reviewerIds.includes(id))) return planningRetry();
  const evidenceActors: EvidenceActorLocks = { ownerIds: new Set(base.ownerIds), reviewerIds: new Set(capture.reviewerIds),
    creatorOwners: new Map(), brandOwners: new Map([[brand.brandId, brand.targetOwnerUserId]]) };
  await assertPlanningPolicyCoverage(base.tx, evidenceActors, checkpoint);
  await lockPlanningRows(base.tx, "PlanningWorkspace", [capture.workspace.id], true, checkpoint);
  const currentWorkspace = await organizationAwait(checkpoint, () => base.tx.planningWorkspace.findUnique({ where: { id: capture.workspace.id }, select: workspaceIdentitySelect }));
  if (!currentWorkspace || !sameNativeMetadata(currentWorkspace, capture.workspace)) return planningMissing();
  await lockPlanningRows(base.tx, "BrandContext", capture.contextIds, true, checkpoint);
  await lockCampaignPlanningRows(base.tx, "Campaign", capture.campaignIds, true, checkpoint);
  await lockCampaignPlanningRows(base.tx, "CampaignPlanningBinding", capture.campaignIds, true, checkpoint);
  await lockCampaignPlanningRows(base.tx, "CampaignPlanningState", capture.campaignIds, true, checkpoint);
  await lockCampaignPlanningRows(base.tx, "CampaignContextSelection", capture.selections.map(row => row.id), true, checkpoint);
  await lockPlanningRows(base.tx, "BrandContextVersion", capture.versions.map(row => row.id), false, checkpoint);
  await lockPlanningRows(base.tx, "BrandContextSubmission", capture.submissions.map(row => row.id), false, checkpoint);
  const rows = await readNativeRows(base.tx, capture, checkpoint);
  const { actor: capturedActor, scope, campaignIds, contextIds, reviewerIds, ...capturedRows } = capture;
  void capturedActor; void scope; void campaignIds; void contextIds; void reviewerIds;
  if (!sameNativeMetadata(rows, capturedRows)) return planningRetry();
  await brandContextScopeInternals.recheckPlanningProof(frame, brandProof);
  await assertPlanningPolicyCoverage(base.tx, evidenceActors, checkpoint); await base.assertCurrent();
  const proof = Object.freeze({}) as PlanningBoundScopeProof;
  nativePlanningProofs.set(proof, { frame, tx: base.tx, brandProof, capture, checkpoint, rows,
    view: freezeNativeMetadata({ ...brand, ...rows, policyReviewerIds: [...capture.reviewerIds] }) });
  return proof;
}
async function nativePlanningProofState(frame: AiPlanningNativeFrame, proof: PlanningBoundScopeProof) {
  const base = await readAiPlanningNativeFrame(frame);
  const state = proof !== null && typeof proof === "object" ? nativePlanningProofs.get(proof) : undefined;
  if (!state || state.frame !== frame || state.tx !== base.tx || !sameNativeActor(state.capture.actor, base.actor)) return nativeScopeUnavailable();
  await brandContextScopeInternals.recheckPlanningProof(frame, state.brandProof); return { base, state };
}
async function recheckNativePlanningProof(frame: AiPlanningNativeFrame, proof: PlanningBoundScopeProof): Promise<void> {
  const { base, state } = await nativePlanningProofState(frame, proof);
  const actors: EvidenceActorLocks = { ownerIds: new Set(base.ownerIds), reviewerIds: new Set(state.capture.reviewerIds),
    creatorOwners: new Map(), brandOwners: new Map([[state.view.brandId, state.view.targetOwnerUserId]]) };
  await assertPlanningPolicyCoverage(base.tx, actors, state.checkpoint);
  const rows = await readNativeRows(base.tx, state.capture, state.checkpoint);
  if (!sameNativeMetadata(rows, state.rows)) return planningRetry();
  await brandContextScopeInternals.recheckPlanningProof(frame, state.brandProof); await base.assertCurrent();
}
async function readNativePlanningProof(frame: AiPlanningNativeFrame, proof: PlanningBoundScopeProof): Promise<PlanningScopeView> {
  await recheckNativePlanningProof(frame, proof);
  return (await nativePlanningProofState(frame, proof)).state.view;
}
export const planningScopeInternals = Object.freeze({ capturePlanningIdentity: captureNativePlanningIdentity,
  preparePlanningInFrame: prepareNativePlanningInFrame, readPlanningProof: readNativePlanningProof, recheckPlanningProof: recheckNativePlanningProof });
