// Every function is DB-only inside an already-authorized native scope frame.
import { Prisma, type Campaign } from "@prisma/client";
import type { z } from "zod";
import { organizationAwait } from "@/lib/organizations/context";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { campaignStateOf, campaignBriefDTO } from "@/lib/campaigns/core";
import { CampaignBriefContentSchema, CampaignFieldObjectSchema, CampaignFieldsSchema } from "@/lib/campaigns/contracts";
import { ApprovedBrandContextVersionSchema, BrandContextContentSchema, BrandContextNameSchema } from "@/lib/brand-context/contracts";
import {
  CampaignPlanningError, PLANNING_LIMITS, PlanningSelectionSchema, BriefPlanningProvenanceSchema, ManualNarrativeSchema,
  PlanningCampaignHeaderSchema, PlanningCampaignListSchema, PlanningCampaignSchema, CampaignPlanningSnapshotSchema,
  CampaignOwnerReviewHeaderSchema, CampaignOwnerReviewDetailSchema, CampaignOwnerReviewsSchema,
  type PlanningCampaign, type PlanningCampaignList, type CampaignOwnerReviews,
} from "./contracts";
import {
  planningMissing, planningRetry, lockScopedCampaignMetadata, lockCampaignPlanningRows,
  planningBriefBindingSelect, type PlanningCall, type PlanningCheckpoint, type PlanningScopeFrame,
  type PlanningSelectionIdentity, type CampaignOwnerScopeFrame, type CampaignOwnerBinding,
} from "./scope";

type ContextSnapshot = z.infer<typeof ApprovedBrandContextVersionSchema>;
type Provenance = z.infer<typeof BriefPlanningProvenanceSchema>;
type OwnerHeader = z.infer<typeof CampaignOwnerReviewHeaderSchema>;
type OwnerDetail = z.infer<typeof CampaignOwnerReviewDetailSchema>;
export function validatePlanningOutput<T>(schema: z.ZodType<T>, value: unknown, checkpoint: PlanningCheckpoint): T {
  checkpoint(); const parsed = schema.safeParse(value); checkpoint();
  return parsed.success ? parsed.data : planningRetry();
}
function iso(date: Date, checkpoint: PlanningCheckpoint) {
  checkpoint(); if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return planningRetry();
  const result = date.toISOString(); checkpoint(); return result;
}
function canonical(value: unknown, checkpoint: PlanningCheckpoint) {
  checkpoint(); const result = canonicalHash(value); checkpoint(); return result;
}
function readScope(frame: PlanningScopeFrame) { return { scope: frame.scope, currentAuthority: frame.currentAuthority }; }
function boundCampaign(frame: PlanningScopeFrame, id: string) {
  const result = frame.campaigns.get(id);
  if (!result || result.campaign.brandId !== frame.brandId) return planningMissing();
  if (result.binding && (!frame.workspace || result.binding.workspaceId !== frame.workspace.id || result.binding.brandId !== frame.brandId)) return planningMissing();
  return result;
}
export async function loadPlanningCampaignRow(tx: Prisma.TransactionClient, frame: PlanningScopeFrame,
  campaignId: string, checkpoint: PlanningCheckpoint): Promise<Campaign> {
  const bound = boundCampaign(frame, campaignId);
  // A null binding is admitted only by the native frame's explicit BIND_OWN
  // allow-list. It never becomes an invented selection in read projections.
  if (!bound.binding && (frame.scope.kind !== "OWN_BRAND" || bound.state || bound.selection)) return planningMissing();
  const row = await organizationAwait(checkpoint, () => tx.campaign.findUnique({ where: { id: campaignId, brandId: frame.brandId } }));
  if (!row || row.revision !== bound.campaign.revision) return planningRetry();
  checkpoint();
  try { campaignStateOf(row); } catch { return planningRetry(); }
  checkpoint(); return row;
}
export function projectPlanningSelection(selection: PlanningSelectionIdentity, checkpoint: PlanningCheckpoint) {
  return validatePlanningOutput(PlanningSelectionSchema, { id: selection.id, revision: selection.revision,
    kind: selection.contextVersionId === null ? "NONE" : "APPROVED_CONTEXT", versionId: selection.contextVersionId,
    contentHash: selection.contentHash }, checkpoint);
}
async function contextVersion(tx: Prisma.TransactionClient, call: PlanningCall,
  frame: Pick<PlanningScopeFrame, "contexts" | "versions" | "capturedContextIds">, workspaceId: string,
  versionId: string, contentHash: string, allowArchived: boolean): Promise<ContextSnapshot> {
  const metadata = frame.versions.get(versionId), checkpoint = call.checkpoint;
  if (!metadata || metadata.workspaceId !== workspaceId || metadata.contentHash !== contentHash) return planningMissing();
  if (!frame.capturedContextIds.has(metadata.contextId)) return planningRetry();
  const parent = frame.contexts.get(metadata.contextId);
  if (!parent || parent.workspaceId !== workspaceId) return planningRetry();
  if (!allowArchived && parent.archived) throw new CampaignPlanningError("ARCHIVED", 409);
  // Context/Version/Submission locks were acquired in the scope phase, not here.
  const row = await organizationAwait(checkpoint, () => tx.brandContextVersion.findUnique({ where: { id: versionId }, select: {
    id: true, contextId: true, workspaceId: true, submissionId: true, version: true, inputRevision: true, contentHash: true,
    approvedAt: true, approvedByUserId: true, submission: { select: { id: true, contextId: true, workspaceId: true,
      inputRevision: true, name: true, nameLanguage: true, content: true, contentHash: true, state: true, decidedByUserId: true, decidedAt: true } },
  } }));
  if (!row || row.contextId !== metadata.contextId || row.workspaceId !== workspaceId || row.submissionId !== metadata.submissionId
    || row.version !== metadata.version || row.inputRevision !== metadata.inputRevision || row.contentHash !== contentHash) return planningRetry();
  const source = row.submission, nameOriginal = validatePlanningOutput(BrandContextNameSchema, { text: source.name, language: source.nameLanguage }, checkpoint);
  const content = validatePlanningOutput(BrandContextContentSchema, source.content, checkpoint);
  if (source.id !== row.submissionId || source.contextId !== row.contextId || source.workspaceId !== workspaceId
    || source.inputRevision !== row.inputRevision || source.state !== "APPROVED" || source.contentHash !== row.contentHash
    || source.decidedByUserId !== row.approvedByUserId || !source.decidedAt || source.decidedAt.getTime() !== row.approvedAt.getTime()
    || canonical({ nameOriginal, content }, checkpoint) !== contentHash) return planningRetry();
  return validatePlanningOutput(ApprovedBrandContextVersionSchema, { id: row.id, contextId: row.contextId, version: row.version,
    inputRevision: row.inputRevision, nameOriginal, content, contentHash, approvedAt: iso(row.approvedAt, checkpoint) }, checkpoint);
}
export async function loadScopedPlanningContextVersion(tx: Prisma.TransactionClient, call: PlanningCall, frame: PlanningScopeFrame,
  versionId: string, contentHash: string, allowArchived = false) {
  if (!frame.workspace) return planningMissing();
  return contextVersion(tx, call, frame, frame.workspace.id, versionId, contentHash, allowArchived);
}
export async function loadSelectedPlanningContext(tx: Prisma.TransactionClient, call: PlanningCall,
  frame: PlanningScopeFrame | CampaignOwnerScopeFrame, selection: PlanningSelectionIdentity, allowArchived = true): Promise<ContextSnapshot | null> {
  projectPlanningSelection(selection, call.checkpoint);
  if ("workspace" in frame) {
    if (!frame.workspace || selection.workspaceId !== frame.workspace.id || !frame.selections.has(selection.id)) return planningMissing();
  } else {
    // The owner lane reveals only the submitted pin, never a later draft selection.
    if (![...frame.bindings.values()].some(binding => binding.submittedSelection.id === selection.id
      && binding.workspace.id === selection.workspaceId && binding.submission.selectionRevision === selection.revision)) return planningMissing();
  }
  if (selection.contextVersionId === null) return null;
  if (selection.contentHash === null) return planningRetry();
  return contextVersion(tx, call, frame, selection.workspaceId, selection.contextVersionId, selection.contentHash, allowArchived);
}
export function makePlanningOwnerSnapshot(contentInput: unknown, provenanceInput: unknown, checkpoint: PlanningCheckpoint) {
  const content = validatePlanningOutput(CampaignBriefContentSchema, contentInput, checkpoint);
  const provenance = validatePlanningOutput(BriefPlanningProvenanceSchema, provenanceInput, checkpoint);
  if (content.approvedByUserId !== null) throw new CampaignPlanningError("INVALID_STATE", 409);
  checkpoint(); const bytes = new TextEncoder().encode(JSON.stringify(content)).byteLength; checkpoint();
  if (bytes > 65536) throw new CampaignPlanningError("SNAPSHOT_TOO_LARGE", 422);
  return { content, provenance, contentHash: canonical({ content, provenance }, checkpoint) };
}
function provenanceFor(selection: PlanningSelectionIdentity, checkpoint: PlanningCheckpoint): Provenance {
  return validatePlanningOutput(BriefPlanningProvenanceSchema, { selectionId: selection.id, selectionRevision: selection.revision,
    versionId: selection.contextVersionId, contentHash: selection.contentHash }, checkpoint);
}
async function briefPage(tx: Prisma.TransactionClient, call: PlanningCall, frame: PlanningScopeFrame, campaignId: string, after?: string) {
  if (!frame.workspace) return planningMissing();
  const checkpoint = call.checkpoint;
  let before: number | undefined;
  if (after !== undefined) {
    const cursor = await organizationAwait(checkpoint, () => tx.campaignBrief.findUnique({ where: { id: after }, select: { campaignId: true, version: true } }));
    if (!cursor || cursor.campaignId !== campaignId) return planningMissing(); before = cursor.version;
  }
  const where = { campaignId, ...(before === undefined ? {} : { version: { lt: before } }) };
  const identities = await organizationAwait(checkpoint, () => tx.campaignBrief.findMany({ where, orderBy: { version: "desc" },
    select: planningBriefBindingSelect, take: PLANNING_LIMITS.briefs }));
  const ids = identities.map(row => row.id), last = identities.at(-1);
  const more = last ? await organizationAwait(checkpoint, () => tx.campaignBrief.findFirst({ where: { campaignId, version: { lt: last.version } }, select: { id: true } })) : null;
  await lockCampaignPlanningRows(tx, "CampaignBrief", ids, false, checkpoint);
  await lockCampaignPlanningRows(tx, "CampaignBriefProvenance", ids, false, checkpoint);
  const rows = ids.length ? await organizationAwait(checkpoint, () => tx.campaignBrief.findMany({ where: { id: { in: ids }, campaignId },
    orderBy: { version: "desc" }, take: PLANNING_LIMITS.briefs })) : [];
  const provenances = ids.length ? await organizationAwait(checkpoint, () => tx.campaignBriefProvenance.findMany({ where: { briefId: { in: ids } }, take: PLANNING_LIMITS.briefs })) : [];
  const selectionIds = [...new Set(provenances.map(row => row.selectionId))];
  // History selectors are immutable FK-retained metadata only. No late Context,
  // Version or Selection lock is acquired to hydrate an old context body.
  const selections = selectionIds.length ? await organizationAwait(checkpoint, () => tx.campaignContextSelection.findMany({
    where: { id: { in: selectionIds } }, take: PLANNING_LIMITS.briefs,
  })) : [];
  const briefs = rows.map(row => {
    const identity = identities.find(first => first.id === row.id); if (!identity || row.version !== identity.version || row.inputRevision !== identity.inputRevision) return planningRetry();
    let brief: ReturnType<typeof campaignBriefDTO>;
    try { brief = campaignBriefDTO(row); } catch { return planningRetry(); }
    checkpoint();
    const stored = provenances.find(value => value.briefId === row.id);
    if (!stored) return { ...brief, provenance: null }; // Historical rows have no inferred pin.
    const selection = selections.find(value => value.id === stored.selectionId);
    if (stored.campaignId !== campaignId || stored.workspaceId !== frame.workspace!.id || !selection || selection.campaignId !== campaignId
      || selection.workspaceId !== frame.workspace!.id || selection.revision !== stored.selectionRevision) return planningRetry();
    return { ...brief, provenance: provenanceFor(selection, checkpoint) };
  });
  if (rows.length !== identities.length) return planningRetry();
  return { briefs, briefsAfter: more && last ? last.id : null };
}
export async function projectPlanningCampaign(tx: Prisma.TransactionClient, call: PlanningCall, frame: PlanningScopeFrame,
  campaignId: string, briefsAfter?: string): Promise<PlanningCampaign> {
  const bound = boundCampaign(frame, campaignId), checkpoint = call.checkpoint;
  if (!frame.workspace || !bound.binding || !bound.state || !bound.selection) return planningMissing();
  const row = await loadPlanningCampaignRow(tx, frame, campaignId, checkpoint);
  let state: ReturnType<typeof campaignStateOf>;
  try { state = campaignStateOf(row); } catch { return planningRetry(); }
  checkpoint();
  const current = await organizationAwait(checkpoint, () => tx.campaignPlanningState.findUnique({ where: { campaignId },
    select: { campaignId: true, workspaceId: true, revision: true, selectionId: true, selectionRevision: true, narrative: true } }));
  if (!current || current.workspaceId !== frame.workspace.id || current.revision !== bound.state.revision
    || current.selectionId !== bound.selection.id || current.selectionRevision !== bound.selection.revision) return planningRetry();
  const narrative = current.narrative === null ? null : validatePlanningOutput(ManualNarrativeSchema, current.narrative, checkpoint);
  const selectedContext = await loadSelectedPlanningContext(tx, call, frame, bound.selection, true);
  const dependencies = await organizationAwait(checkpoint, () => tx.campaignProposalDependency.findMany({
    where: { campaignId, workspaceId: frame.workspace!.id, proposalId: { in: state.proposals.map(row => row.id) } }, take: PLANNING_LIMITS.proposals,
  }));
  const proposals = state.proposals.map(proposal => {
    const dependency = dependencies.find(row => row.proposalId === proposal.id);
    return { ...proposal, origin: dependency ? "CONTEXT_TONE" : "HUMAN", dependency: dependency ? {
      fieldsRevision: dependency.fieldsRevision, selectionId: dependency.selectionId, selectionRevision: dependency.selectionRevision,
    } : null };
  });
  const missingFields = Object.keys(CampaignFieldObjectSchema.shape).filter(field => !Object.hasOwn(state.fields, field));
  const complete = CampaignFieldsSchema.safeParse(state.fields); checkpoint();
  if (!complete.success && !missingFields.length) return planningRetry();
  const briefs = await briefPage(tx, call, frame, campaignId, briefsAfter);
  return validatePlanningOutput(PlanningCampaignSchema, { ...readScope(frame), asOf: iso(call.now, checkpoint), campaign: {
    id: row.id, title: row.title, status: row.status, revision: row.revision, fieldsRevision: state.fieldsRevision, fields: state.fields,
    missingFields, clarificationCount: state.clarificationCount, conversation: row.conversation,
    currentBriefVersion: row.currentBriefVersion, updatedAt: iso(row.updatedAt, checkpoint),
  }, planning: { revision: current.revision, selection: projectPlanningSelection(bound.selection, checkpoint), selectedContext, narrative }, proposals, ...briefs }, checkpoint);
}
export async function projectPlanningCampaignList(tx: Prisma.TransactionClient, call: PlanningCall, frame: PlanningScopeFrame,
  query: { after?: string; limit: number }): Promise<PlanningCampaignList> {
  const checkpoint = call.checkpoint;
  if (!frame.workspace) {
    if (query.after) return planningMissing();
    return validatePlanningOutput(PlanningCampaignListSchema, { ...readScope(frame), asOf: iso(call.now, checkpoint), campaigns: [], nextCursor: null }, checkpoint);
  }
  if (query.after) {
    const cursor = await organizationAwait(checkpoint, () => tx.campaignPlanningBinding.findUnique({
      where: { campaignId: query.after }, select: { workspaceId: true },
    }));
    if (!cursor || cursor.workspaceId !== frame.workspace.id) return planningMissing();
  }
  const candidates = await organizationAwait(checkpoint, () => tx.campaignPlanningBinding.findMany({ where: { workspaceId: frame.workspace!.id,
    ...(query.after === undefined ? {} : { campaignId: { gt: query.after } }) }, orderBy: { campaignId: "asc" }, select: { campaignId: true }, take: query.limit + 1 }));
  const selected = candidates.slice(0, query.limit), bound = await lockScopedCampaignMetadata(tx, frame,
    [...(query.after ? [query.after] : []), ...selected.map(row => row.campaignId)], false, checkpoint);
  const rows = selected.length ? await organizationAwait(checkpoint, () => tx.campaign.findMany({ where: { id: { in: selected.map(row => row.campaignId) }, brandId: frame.brandId },
    select: { id: true, title: true }, take: query.limit })) : [];
  const campaigns = selected.map(candidate => {
    const current = bound.get(candidate.campaignId), row = rows.find(value => value.id === candidate.campaignId);
    if (!current?.binding || !current.state || !current.selection || !row) return planningRetry();
    return validatePlanningOutput(PlanningCampaignHeaderSchema, { id: row.id, title: row.title, status: current.campaign.status,
      revision: current.campaign.revision, planningRevision: current.state.revision, selectionRevision: current.selection.revision,
      currentBriefVersion: current.campaign.currentBriefVersion, updatedAt: iso(current.campaign.updatedAt, checkpoint) }, checkpoint);
  });
  return validatePlanningOutput(PlanningCampaignListSchema, { ...readScope(frame), asOf: iso(call.now, checkpoint), campaigns,
    nextCursor: candidates.length > query.limit ? selected.at(-1)!.campaignId : null }, checkpoint);
}
export function campaignOwnerSourceStale(binding: CampaignOwnerBinding, checkpoint: PlanningCheckpoint) {
  const submission = binding.submission, stale = binding.campaign.revision !== submission.campaignRevision
    || binding.state.selectionId !== submission.selectionId || binding.state.selectionRevision !== submission.selectionRevision
    || binding.brief.inputRevision !== submission.inputRevision || submission.targetOwnerSessionVersion !== binding.targetOwnerSessionVersion
    || submission.clientRevision !== binding.currentClientRevision || ["COMPLETED", "CANCELLED"].includes(binding.campaign.status);
  checkpoint(); return stale;
}
export async function projectCampaignOwnerReview(tx: Prisma.TransactionClient, call: PlanningCall, frame: CampaignOwnerScopeFrame,
  submissionId: string, detail: true): Promise<OwnerDetail>;
export async function projectCampaignOwnerReview(tx: Prisma.TransactionClient, call: PlanningCall, frame: CampaignOwnerScopeFrame,
  submissionId: string, detail: false): Promise<OwnerHeader>;
export async function projectCampaignOwnerReview(tx: Prisma.TransactionClient, call: PlanningCall, frame: CampaignOwnerScopeFrame,
  submissionId: string, detail: boolean): Promise<OwnerHeader | OwnerDetail> {
  const binding = frame.bindings.get(submissionId), checkpoint = call.checkpoint;
  if (!binding) return planningMissing();
  const row = await organizationAwait(checkpoint, () => tx.campaignPlanningSubmission.findUnique({ where: { id: submissionId }, select: {
    id: true, campaignId: true, workspaceId: true, briefId: true, selectionId: true, selectionRevision: true, inputRevision: true,
    campaignRevision: true, content: true, contentHash: true,
  } }));
  const metadata = binding.submission;
  if (!row || row.campaignId !== metadata.campaignId || row.workspaceId !== metadata.workspaceId || row.briefId !== metadata.briefId
    || row.selectionId !== metadata.selectionId || row.selectionRevision !== metadata.selectionRevision || row.inputRevision !== metadata.inputRevision
    || row.campaignRevision !== metadata.campaignRevision || row.contentHash !== metadata.contentHash) return planningRetry();
  const content = validatePlanningOutput(CampaignPlanningSnapshotSchema, row.content, checkpoint), provenance = provenanceFor(binding.submittedSelection, checkpoint);
  if (content.approvedByUserId !== null || content.requirements.campaignId !== row.campaignId || content.requirements.version !== binding.brief.version
    || content.inputRevision !== row.inputRevision || canonical({ content, provenance }, checkpoint) !== row.contentHash) return planningRetry();
  const stale = campaignOwnerSourceStale(binding, checkpoint);
  const header = validatePlanningOutput(CampaignOwnerReviewHeaderSchema, { id: row.id, campaignId: row.campaignId, briefId: row.briefId, scope: binding.scope,
    titleOriginal: { text: content.requirements.title, language: content.requirements.originalLanguage }, version: content.requirements.version,
    inputRevision: row.inputRevision, campaignRevision: row.campaignRevision, selectionRevision: row.selectionRevision, revision: metadata.revision,
    state: metadata.state, sourceStale: stale, approvalAvailable: metadata.state === "PENDING" && !stale,
    createdAt: iso(metadata.createdAt, checkpoint), decidedAt: metadata.decidedAt ? iso(metadata.decidedAt, checkpoint) : null }, checkpoint);
  if (!detail) return header;
  const selectedContext = await loadSelectedPlanningContext(tx, call, frame, binding.submittedSelection, true);
  return validatePlanningOutput(CampaignOwnerReviewDetailSchema, { ...header, content, contentHash: row.contentHash, provenance, selectedContext }, checkpoint);
}
export async function projectCampaignOwnerReviewList(tx: Prisma.TransactionClient, call: PlanningCall, frame: CampaignOwnerScopeFrame,
  submissionIds: readonly string[], nextCursor: string | null): Promise<CampaignOwnerReviews> {
  if (submissionIds.length > PLANNING_LIMITS.reviews || submissionIds.some(id => !frame.bindings.has(id))) return planningRetry();
  if (nextCursor !== null && nextCursor !== submissionIds.at(-1)) return planningRetry();
  const reviews: OwnerHeader[] = [];
  for (const id of submissionIds) reviews.push(await projectCampaignOwnerReview(tx, call, frame, id, false));
  return validatePlanningOutput(CampaignOwnerReviewsSchema, { asOf: iso(call.now, call.checkpoint), reviews, nextCursor }, call.checkpoint);
}
