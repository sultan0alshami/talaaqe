import { randomUUID } from "node:crypto";
import { Prisma, type Campaign, type CampaignBrief } from "@prisma/client";
import type { z } from "zod";
import { organizationAwait, organizationDb, type OrganizationActor, type OrganizationOptions } from "@/lib/organizations/context";
import type { CampaignCommandContext } from "@/lib/campaigns/service";
import { canonicalHash, inputJson } from "@/lib/onboarding/drafts";
import { CampaignFieldsSchema } from "@/lib/campaigns/contracts";
import { CampaignError } from "@/lib/campaigns/errors";
import { approveCampaignBriefCore, campaignBriefDTO, campaignEditable, campaignStateOf, createCampaignCore,
  generateCampaignBriefCore, mutateCampaignCore, updateCampaignCore } from "@/lib/campaigns/core";
import { CampaignPlanningCommandSchema, CampaignPlanningReceiptSchema, CampaignPlanningResultSchema,
  PlanningCampaignListQuerySchema, PlanningCampaignQuerySchema, CampaignOwnerReviewsQuerySchema,
  CampaignOwnerReviewQuerySchema, CampaignOwnerReviewSchema, CampaignOwnerReviewCommandSchema,
  CampaignOwnerReviewReceiptSchema, CampaignOwnerReviewResultSchema, CampaignPlanningError,
  type CampaignPlanningCommand, type CampaignPlanningResult, type PlanningCampaignList, type PlanningCampaign,
  type CampaignOwnerReviews, type CampaignOwnerReview, type CampaignOwnerReviewResult } from "./contracts";
import { beginPlanningCall, capturePlanningScope, withPlanningScope, captureCampaignOwnerReviewScope,
  withCampaignOwnerReviewScope, lockCampaignPlanningRows, planningMissing, planningRetry,
  type PlanningCall, type PlanningCheckpoint, type PlanningScopeFrame, type PlanningSelectionIdentity,
  type CampaignOwnerScopeFrame } from "./scope";
import { loadPlanningCampaignRow, loadScopedPlanningContextVersion, loadSelectedPlanningContext,
  makePlanningOwnerSnapshot, projectPlanningCampaign, projectPlanningCampaignList, campaignOwnerSourceStale,
  projectCampaignOwnerReview, projectCampaignOwnerReviewList, validatePlanningOutput } from "./projection";

export type CampaignPlanningOptions = OrganizationOptions & { now?: Date; policyReviewResolver?: CampaignCommandContext["policyReviewResolver"] };
type Tx = Prisma.TransactionClient;
type Receipt = z.infer<typeof CampaignPlanningReceiptSchema>;
type ReviewCommand = z.infer<typeof CampaignOwnerReviewCommandSchema>;
type ReviewReceipt = z.infer<typeof CampaignOwnerReviewReceiptSchema>;
type Choice = Extract<CampaignPlanningCommand, { action: "CREATE" }>["payload"]["selection"];
function fail(code: string, status = 409): never { throw new CampaignPlanningError(code, status); }
function captured<T>(value: { success: true; data: T } | { success: false }, checkpoint: PlanningCheckpoint): T {
  checkpoint(); return value.success ? value.data : fail("VALIDATION", 422);
}
function hash(value: unknown, checkpoint: PlanningCheckpoint) { checkpoint(); const result = canonicalHash(value); checkpoint(); return result; }
function next(value: number, checkpoint: PlanningCheckpoint) {
  checkpoint(); if (!Number.isInteger(value) || value < 1 || value > 2147483646) return planningRetry();
  if (value === 2147483646) return fail("REVISION_EXHAUSTED"); return value + 1;
}
function stateOf(campaign: Campaign, checkpoint: PlanningCheckpoint) {
  checkpoint(); try { const result = campaignStateOf(campaign); checkpoint(); return result; } catch { return planningRetry(); }
}
async function core<T>(checkpoint: PlanningCheckpoint, operation: () => Promise<T>): Promise<T> {
  try { return await organizationAwait(checkpoint, operation); } catch (error) {
    if (error instanceof CampaignError) {
      if (error.code.startsWith("INVALID_STORED")) return planningRetry();
      return fail(error.code, error.status);
    }
    throw error;
  }
}
function provenance(selection: PlanningSelectionIdentity) {
  return { selectionId: selection.id, selectionRevision: selection.revision,
    versionId: selection.contextVersionId, contentHash: selection.contentHash };
}
async function effects(tx: Tx, call: PlanningCall, receiptId: string, type: string, resourceId: string, revision: number,
  metadata: Receipt | ReviewReceipt) {
  await organizationAwait(call.checkpoint, () => tx.adminAudit.create({ data: { actorUserId: call.actor.userId, action: type,
    resourceType: "Campaign", resourceId, snapshot: inputJson(metadata), createdAt: call.now } }));
  await organizationAwait(call.checkpoint, () => tx.outboxEvent.create({ data: { deduplicationKey: "campaign-planning:" + receiptId, type,
    payload: inputJson({ id: receiptId, type, actorUserId: call.actor.userId, recipientUserIds: [call.actor.userId], aggregateType: "Campaign",
      aggregateId: resourceId, aggregateVersion: revision, occurredAt: call.now.toISOString(), payload: metadata }), createdAt: call.now, availableAt: call.now } }));
}
async function record(tx: Tx, call: PlanningCall, command: CampaignPlanningCommand, payloadHash: string, workspaceId: string, value: Receipt) {
  const receipt = validatePlanningOutput(CampaignPlanningReceiptSchema, value, call.checkpoint), id = randomUUID();
  await organizationAwait(call.checkpoint, () => tx.campaignPlanningCommand.create({ data: { id, actorUserId: call.actor.userId,
    operationKey: command.operationKey, payloadHash, workspaceId, campaignId: receipt.campaignId, action: command.action,
    result: inputJson(receipt), createdAt: call.now }, select: { id: true } }));
  await effects(tx, call, id, "campaign_planning." + command.action.toLowerCase(), receipt.campaignId, receipt.campaignRevision, receipt);
  return validatePlanningOutput(CampaignPlanningResultSchema, { ...receipt, replayed: false }, call.checkpoint);
}
async function replay(tx: Tx, call: PlanningCall, frame: PlanningScopeFrame, command: CampaignPlanningCommand, payloadHash: string): Promise<
  { found: false } | { found: true; result: CampaignPlanningResult }> {
  const prior = await organizationAwait(call.checkpoint, () => tx.campaignPlanningCommand.findUnique({ where: {
    actorUserId_operationKey: { actorUserId: call.actor.userId, operationKey: command.operationKey } },
    select: { campaignId: true, workspaceId: true, payloadHash: true, action: true, result: true } }));
  if (!prior) return { found: false };
  if (!frame.workspace || prior.workspaceId !== frame.workspace.id) return planningMissing();
  const binding = frame.campaigns.get(prior.campaignId);
  if (!binding) return planningRetry();
  if (!binding.binding || binding.binding.workspaceId !== prior.workspaceId) return planningMissing();
  if (prior.payloadHash !== payloadHash || prior.action !== command.action
    || command.action !== "CREATE" && prior.campaignId !== command.campaignId) return fail("OPERATION_KEY_REUSED");
  const receipt = validatePlanningOutput(CampaignPlanningReceiptSchema, prior.result, call.checkpoint);
  const selectionRevision = command.action === "CREATE" || command.action === "BIND_OWN" ? 1
    : command.expectedSelectionRevision + (command.action === "SET_SELECTION" ? 1 : 0);
  if (receipt.campaignId !== prior.campaignId || receipt.action !== command.action
    || receipt.campaignRevision !== command.expectedCampaignRevision + 1 || receipt.planningRevision !== command.expectedPlanningRevision + 1
    || receipt.selectionRevision !== selectionRevision || receipt.inputRevision > binding.campaign.revision) return planningRetry();
  if (command.action === "APPLY_PROPOSAL" && receipt.proposalId !== command.payload.proposalId) return planningRetry();
  if (command.action === "SUBMIT_BRIEF" && (receipt.briefId !== command.payload.briefId
    || receipt.version !== command.payload.expectedBriefVersion)) return planningRetry();
  if (receipt.briefId) {
    if (command.expectedSelectionId === null) return planningRetry();
    const brief = await organizationAwait(call.checkpoint, () => tx.campaignBrief.findUnique({ where: { id: receipt.briefId! },
      select: { campaignId: true, version: true, inputRevision: true } }));
    if (!brief || brief.campaignId !== receipt.campaignId || brief.version !== receipt.version || brief.inputRevision !== receipt.inputRevision) return planningRetry();
    // Provenance is immutable metadata. Replay never acquires a later Context
    // lock or hydrates historical selected context content to validate it.
    const pin = await organizationAwait(call.checkpoint, () => tx.campaignBriefProvenance.findUnique({ where: { briefId: receipt.briefId! },
      select: { briefId: true, campaignId: true, workspaceId: true, selectionId: true, selectionRevision: true } }));
    if (!pin || pin.briefId !== receipt.briefId || pin.campaignId !== receipt.campaignId || pin.workspaceId !== frame.workspace.id
      || pin.selectionId !== command.expectedSelectionId || pin.selectionRevision !== command.expectedSelectionRevision) return planningRetry();
  }
  if (receipt.submissionId) {
    const submission = await organizationAwait(call.checkpoint, () => tx.campaignPlanningSubmission.findUnique({ where: { id: receipt.submissionId! },
      select: { campaignId: true, workspaceId: true, briefId: true, inputRevision: true, campaignRevision: true, selectionId: true, selectionRevision: true } }));
    if (!submission || submission.campaignId !== receipt.campaignId || submission.workspaceId !== frame.workspace.id
      || submission.briefId !== receipt.briefId || submission.inputRevision !== receipt.inputRevision
      || submission.campaignRevision !== receipt.campaignRevision || submission.selectionId !== command.expectedSelectionId
      || submission.selectionRevision !== receipt.selectionRevision) return planningRetry();
  }
  return { found: true, result: validatePlanningOutput(CampaignPlanningResultSchema, { ...receipt, replayed: true }, call.checkpoint) };
}
async function validateChoice(tx: Tx, call: PlanningCall, frame: PlanningScopeFrame, choice: Choice) {
  if (choice.kind === "APPROVED_CONTEXT") await loadScopedPlanningContextVersion(tx, call, frame, choice.versionId, choice.contentHash, false);
}
async function appendSelection(tx: Tx, call: PlanningCall, workspaceId: string, campaignId: string, revision: number, choice: Choice) {
  return organizationAwait(call.checkpoint, () => tx.campaignContextSelection.create({ data: { id: randomUUID(), workspaceId,
    campaignId, revision, contextVersionId: choice.kind === "NONE" ? null : choice.versionId,
    contentHash: choice.kind === "NONE" ? null : choice.contentHash, createdAt: call.now } }));
}
async function updateState(tx: Tx, call: PlanningCall, campaignId: string, expectedRevision: number, selection: PlanningSelectionIdentity,
  narrative?: Prisma.InputJsonValue | typeof Prisma.DbNull) {
  const revision = next(expectedRevision, call.checkpoint);
  const changed = await organizationAwait(call.checkpoint, () => tx.campaignPlanningState.updateMany({ where: { campaignId, revision: expectedRevision },
    data: { revision, selectionId: selection.id, selectionRevision: selection.revision, updatedAt: call.now,
      ...(narrative === undefined ? {} : { narrative }) } }));
  if (changed.count !== 1) return fail("STALE_VERSION"); return revision;
}
async function pinBrief(tx: Tx, call: PlanningCall, brief: CampaignBrief, selection: PlanningSelectionIdentity) {
  await organizationAwait(call.checkpoint, () => tx.campaignBriefProvenance.create({ data: { briefId: brief.id, campaignId: brief.campaignId,
    workspaceId: selection.workspaceId, selectionId: selection.id, selectionRevision: selection.revision, createdAt: call.now } }));
}
function receiptFor(command: CampaignPlanningCommand, campaign: Campaign, planningRevision: number, selection: PlanningSelectionIdentity,
  proposalId: string | null = null, brief: CampaignBrief | null = null, submissionId: string | null = null): Receipt {
  return { campaignId: campaign.id, action: command.action, campaignRevision: campaign.revision, planningRevision,
    inputRevision: campaignStateOf(campaign).fieldsRevision, selectionRevision: selection.revision, proposalId,
    briefId: brief?.id ?? null, version: brief?.version ?? null, submissionId };
}
async function executeFresh(tx: Tx, call: PlanningCall, frame: PlanningScopeFrame, command: CampaignPlanningCommand, payloadHash: string) {
  if (!frame.workspace) return planningRetry();
  const workspaceId = frame.workspace.id;
  if (command.action === "CREATE") {
    await validateChoice(tx, call, frame, command.payload.selection);
    const campaign = await core(call.checkpoint, () => createCampaignCore(tx, frame.brand, command.payload.fields, call.checkpoint));
    await organizationAwait(call.checkpoint, () => tx.campaignPlanningBinding.create({ data: { campaignId: campaign.id, workspaceId, brandId: frame.brandId, createdAt: call.now } }));
    const selection = await appendSelection(tx, call, workspaceId, campaign.id, 1, command.payload.selection);
    await organizationAwait(call.checkpoint, () => tx.campaignPlanningState.create({ data: { campaignId: campaign.id, workspaceId, revision: 1,
      selectionId: selection.id, selectionRevision: 1, narrative: Prisma.DbNull, createdAt: call.now, updatedAt: call.now } }));
    return record(tx, call, command, payloadHash, workspaceId, receiptFor(command, campaign, 1, selection));
  }
  const bound = frame.campaigns.get(command.campaignId);
  if (!bound) return planningMissing();
  let campaign = await loadPlanningCampaignRow(tx, frame, command.campaignId, call.checkpoint);
  await core(call.checkpoint, async () => { campaignEditable(campaign, command.expectedCampaignRevision); });
  next(campaign.revision, call.checkpoint);
  if (command.action === "BIND_OWN") {
    if (frame.scope.kind !== "OWN_BRAND" || bound.binding || bound.state || bound.selection) return fail("ALREADY_BOUND");
    await validateChoice(tx, call, frame, command.payload.selection);
    await organizationAwait(call.checkpoint, () => tx.campaignPlanningBinding.create({ data: { campaignId: campaign.id, workspaceId, brandId: frame.brandId, createdAt: call.now } }));
    const selection = await appendSelection(tx, call, workspaceId, campaign.id, 1, command.payload.selection);
    campaign = await core(call.checkpoint, () => updateCampaignCore(tx, campaign, command.expectedCampaignRevision, { status: "DRAFT", currentBriefVersion: null }, call.checkpoint));
    await organizationAwait(call.checkpoint, () => tx.campaignPlanningState.create({ data: { campaignId: campaign.id, workspaceId, revision: 1,
      selectionId: selection.id, selectionRevision: 1, narrative: Prisma.DbNull, createdAt: call.now, updatedAt: call.now } }));
    return record(tx, call, command, payloadHash, workspaceId, receiptFor(command, campaign, 1, selection));
  }
  if (!bound.binding || !bound.state || !bound.selection) return planningMissing();
  if (bound.state.revision !== command.expectedPlanningRevision || bound.selection.id !== command.expectedSelectionId
    || bound.selection.revision !== command.expectedSelectionRevision) return fail("STALE_VERSION");
  next(bound.state.revision, call.checkpoint);
  let selection = bound.selection, proposalId: string | null = null, brief: CampaignBrief | null = null, submissionId: string | null = null;
  let narrative: Prisma.InputJsonValue | typeof Prisma.DbNull | undefined;
  if (command.action === "SET_SELECTION") {
    const revision = next(selection.revision, call.checkpoint);
    await validateChoice(tx, call, frame, command.payload.selection);
    selection = await appendSelection(tx, call, workspaceId, campaign.id, revision, command.payload.selection);
    campaign = await core(call.checkpoint, () => updateCampaignCore(tx, campaign, command.expectedCampaignRevision, { status: "DRAFT", currentBriefVersion: null }, call.checkpoint));
  } else if (command.action === "SAVE_NARRATIVE") {
    narrative = command.payload.narrative === null ? Prisma.DbNull : inputJson(command.payload.narrative);
    campaign = await core(call.checkpoint, () => updateCampaignCore(tx, campaign, command.expectedCampaignRevision, {}, call.checkpoint));
  } else if (command.action === "GENERATE_BRIEF") {
    const latest = await organizationAwait(call.checkpoint, () => tx.campaignBrief.findFirst({ where: { campaignId: campaign.id }, orderBy: { version: "desc" }, select: { id: true } }));
    const priorPin = latest ? await organizationAwait(call.checkpoint, () => tx.campaignBriefProvenance.findUnique({ where: { briefId: latest.id } })) : null;
    const reusable = !!priorPin && priorPin.workspaceId === workspaceId && priorPin.campaignId === campaign.id
      && priorPin.selectionId === selection.id && priorPin.selectionRevision === selection.revision;
    const generated = await core(call.checkpoint, () => generateCampaignBriefCore(tx, campaign, frame.brand,
      { expectedRevision: command.expectedCampaignRevision, allowLatestReuse: reusable, checkpoint: call.checkpoint }));
    campaign = generated.campaign; brief = generated.brief;
    if (generated.created) await pinBrief(tx, call, brief, selection);
  } else if (command.action === "SUBMIT_BRIEF") {
    const state = stateOf(campaign, call.checkpoint);
    const latest = await organizationAwait(call.checkpoint, () => tx.campaignBrief.findFirst({ where: { campaignId: campaign.id }, orderBy: { version: "desc" }, select: { id: true } }));
    if (latest?.id !== command.payload.briefId) return fail("STALE_BRIEF");
    await lockCampaignPlanningRows(tx, "CampaignBrief", [command.payload.briefId], true, call.checkpoint);
    await lockCampaignPlanningRows(tx, "CampaignBriefProvenance", [command.payload.briefId], true, call.checkpoint);
    brief = await organizationAwait(call.checkpoint, () => tx.campaignBrief.findUnique({ where: { id: command.payload.briefId } }));
    const pin = await organizationAwait(call.checkpoint, () => tx.campaignBriefProvenance.findUnique({ where: { briefId: command.payload.briefId } }));
    if (!brief || brief.campaignId !== campaign.id || brief.version !== command.payload.expectedBriefVersion || brief.inputRevision !== state.fieldsRevision
      || brief.approvedAt || brief.approvedByUserId || !pin || pin.campaignId !== campaign.id || pin.workspaceId !== workspaceId
      || pin.selectionId !== selection.id || pin.selectionRevision !== selection.revision) return fail("STALE_BRIEF");
    const dto = await core(call.checkpoint, async () => campaignBriefDTO(brief!));
    const fields = CampaignFieldsSchema.safeParse(state.fields);
    if (!fields.success || hash({ ...fields.data, campaignId: campaign.id, version: brief.version, brandCountryCode: frame.brand.countryCode,
      mandatoryPolicyVersionIds: dto.content.requirements.mandatoryPolicyVersionIds }, call.checkpoint) !== hash(dto.content.requirements, call.checkpoint)) return fail("STALE_BRIEF");
    const snapshot = makePlanningOwnerSnapshot(dto.content, provenance(selection), call.checkpoint);
    campaign = await core(call.checkpoint, () => updateCampaignCore(tx, campaign, command.expectedCampaignRevision, {}, call.checkpoint));
    submissionId = randomUUID();
    await organizationAwait(call.checkpoint, () => tx.campaignPlanningSubmission.create({ data: { id: submissionId!, campaignId: campaign.id,
      workspaceId, briefId: brief!.id, selectionId: selection.id, selectionRevision: selection.revision, inputRevision: state.fieldsRevision,
      campaignRevision: campaign.revision, content: inputJson(snapshot.content), contentHash: snapshot.contentHash,
      submittedByUserId: call.actor.userId, targetOwnerUserId: frame.targetOwnerUserId, targetOwnerSessionVersion: frame.targetOwnerSessionVersion,
      clientRevision: frame.currentClientRevision, createdAt: call.now } }));
  } else {
    let action: "UPDATE_FIELDS" | "PROPOSE_FIELDS" | "APPLY_PROPOSAL", payload: Record<string, unknown>, keep = false;
    if (command.action === "PROPOSE_CONTEXT_TONE") {
      const context = await loadSelectedPlanningContext(tx, call, frame, selection, false), tone = context?.content.tone.text;
      if (!tone || !tone.trim()) return fail("CONTEXT_TONE_UNAVAILABLE");
      action = "PROPOSE_FIELDS"; payload = { type: "PROPOSE_FIELDS", patch: { tone }, originalText: { text: tone, language: context!.content.tone.language } };
    } else if (command.action === "APPLY_PROPOSAL") {
      const dependency = await organizationAwait(call.checkpoint, () => tx.campaignProposalDependency.findUnique({ where: {
        campaignId_proposalId: { campaignId: campaign.id, proposalId: command.payload.proposalId } } }));
      const capturedDependency = frame.dependency;
      if (dependency && (!capturedDependency || dependency.campaignId !== capturedDependency.campaignId
        || dependency.proposalId !== capturedDependency.proposalId || dependency.workspaceId !== capturedDependency.workspaceId
        || dependency.fieldsRevision !== capturedDependency.fieldsRevision || dependency.selectionId !== capturedDependency.selectionId
        || dependency.selectionRevision !== capturedDependency.selectionRevision
        || dependency.createdAt.getTime() !== capturedDependency.createdAt.getTime())) return planningRetry();
      if (!dependency && capturedDependency) return planningRetry();
      if (dependency) {
        if (dependency.workspaceId !== workspaceId) return planningRetry();
        if (dependency.fieldsRevision !== stateOf(campaign, call.checkpoint).fieldsRevision || dependency.selectionId !== selection.id
          || dependency.selectionRevision !== selection.revision) return fail("STALE_PROPOSAL");
        if (command.payload.toneDecision === null) return fail("VALIDATION", 422);
        const context = await loadSelectedPlanningContext(tx, call, frame, selection, false);
        const proposal = stateOf(campaign, call.checkpoint).proposals.find(row => row.id === command.payload.proposalId);
        if (!proposal || Object.keys(proposal.patch).length !== 1 || proposal.patch.tone !== context?.content.tone.text) return planningRetry();
        keep = command.payload.toneDecision === "KEEP";
      } else if (command.payload.toneDecision !== null) return fail("VALIDATION", 422);
      action = "APPLY_PROPOSAL"; payload = { proposalId: command.payload.proposalId };
    } else { action = command.action; payload = command.payload; }
    const result = await core(call.checkpoint, () => mutateCampaignCore(tx, campaign, frame.brand,
      { expectedRevision: command.expectedCampaignRevision, action, payload },
      { keepProposalFields: keep, appendProposalConversation: false, checkpoint: call.checkpoint, now: call.now }));
    campaign = result.campaign; proposalId = result.proposalId;
    for (const created of result.createdBriefs) await pinBrief(tx, call, created, selection);
    brief = result.createdBriefs.at(-1) ?? null;
    if (command.action === "PROPOSE_CONTEXT_TONE") {
      if (!proposalId) return planningRetry();
      await organizationAwait(call.checkpoint, () => tx.campaignProposalDependency.create({ data: { campaignId: campaign.id, proposalId: proposalId!,
        workspaceId, fieldsRevision: stateOf(campaign, call.checkpoint).fieldsRevision, selectionId: selection.id,
        selectionRevision: selection.revision, createdAt: call.now } }));
    }
  }
  const planningRevision = await updateState(tx, call, campaign.id, bound.state.revision, selection, narrative);
  return record(tx, call, command, payloadHash, workspaceId, receiptFor(command, campaign, planningRevision, selection, proposalId, brief, submissionId));
}
export async function executeCampaignPlanningCommand(actor: OrganizationActor, input: unknown, options: CampaignPlanningOptions = {}): Promise<CampaignPlanningResult> {
  const packet = CampaignPlanningCommandSchema.safeParse(input), call = await beginPlanningCall(actor, options);
  const command = captured(packet, call.checkpoint), payloadHash = hash({ purpose: "CAMPAIGN_PLANNING_COMMAND_V1", actorUserId: call.actor.userId, command }, call.checkpoint);
  const prior = await organizationAwait(call.checkpoint, () => organizationDb(call.options).campaignPlanningCommand.findUnique({ where: {
    actorUserId_operationKey: { actorUserId: call.actor.userId, operationKey: command.operationKey } }, select: { campaignId: true } }));
  const ids = [...new Set([...(command.action === "CREATE" ? [] : [command.campaignId]), ...(prior ? [prior.campaignId] : [])])];
  const choice = command.action === "CREATE" || command.action === "BIND_OWN" || command.action === "SET_SELECTION" ? command.payload.selection : undefined;
  const capture = await capturePlanningScope(call, command.scope, { campaignIds: ids, choice,
    ...(command.action === "APPLY_PROPOSAL" ? { proposalId: command.payload.proposalId, proposalCampaignId: command.campaignId } : {}) });
  return withPlanningScope(call, capture, { write: true, expectedAuthority: "expectedAuthority" in command ? command.expectedAuthority : undefined,
    allowUnboundOwnIds: command.action === "BIND_OWN" ? [command.campaignId] : [],
    replay: (tx, frame) => replay(tx, call, frame, command, payloadHash), execute: (tx, frame) => executeFresh(tx, call, frame, command, payloadHash) });
}
export async function listPlanningCampaigns(actor: OrganizationActor, input: unknown, options: CampaignPlanningOptions = {}): Promise<PlanningCampaignList> {
  const packet = PlanningCampaignListQuerySchema.safeParse(input), call = await beginPlanningCall(actor, options), query = captured(packet, call.checkpoint);
  const capture = await capturePlanningScope(call, query.scope, { campaignIds: query.after === undefined ? [] : [query.after] });
  return withPlanningScope(call, capture, { write: false, execute: (tx, frame) => projectPlanningCampaignList(tx, call, frame, query) });
}
export async function getPlanningCampaign(actor: OrganizationActor, input: unknown, options: CampaignPlanningOptions = {}): Promise<PlanningCampaign> {
  const packet = PlanningCampaignQuerySchema.safeParse(input), call = await beginPlanningCall(actor, options), query = captured(packet, call.checkpoint);
  const capture = await capturePlanningScope(call, query.scope, { campaignIds: [query.campaignId] });
  return withPlanningScope(call, capture, { write: false, execute: (tx, frame) => projectPlanningCampaign(tx, call, frame, query.campaignId, query.briefsAfter) });
}
function ownerInboxWhere(actor: Readonly<OrganizationActor>): Prisma.CampaignPlanningSubmissionWhereInput {
  return { targetOwnerUserId: actor.userId, provenance: { selection: { binding: { workspace: { brand: { userId: actor.userId }, OR: [
    { scope: "OWN_BRAND" }, { scope: "CLIENT", client: { is: { state: "ACTIVE", authorizingUserId: actor.userId,
      authorizingSessionVersion: actor.sessionVersion, allowedCapabilities: { path: ["plan"], equals: true },
      organization: { active: true, owner: { active: true, role: "BRAND" } } } } },
  ] } } } } };
}
export async function listCampaignOwnerReviews(actor: OrganizationActor, input: unknown = {}, options: CampaignPlanningOptions = {}): Promise<CampaignOwnerReviews> {
  const packet = CampaignOwnerReviewsQuerySchema.safeParse(input), call = await beginPlanningCall(actor, options), query = captured(packet, call.checkpoint);
  const where = ownerInboxWhere(call.actor), db = organizationDb(call.options);
  if (query.after !== undefined && !await organizationAwait(call.checkpoint, () => db.campaignPlanningSubmission.findFirst({ where: { ...where, id: query.after }, select: { id: true } }))) return planningMissing();
  const rows = await organizationAwait(call.checkpoint, () => db.campaignPlanningSubmission.findMany({ where: { ...where,
    ...(query.after === undefined ? {} : { id: { gt: query.after } }) }, select: { id: true }, orderBy: { id: "asc" }, take: query.limit + 1 }));
  const ids = [...rows.map(row => row.id), ...(query.after === undefined ? [] : [query.after])];
  const capture = await captureCampaignOwnerReviewScope(call, ids);
  return withCampaignOwnerReviewScope(call, capture, false, async (tx, frame) => {
    if (ids.some(id => !frame.bindings.has(id))) return planningRetry();
    const selected = rows.slice(0, query.limit).map(row => row.id);
    return projectCampaignOwnerReviewList(tx, call, frame, selected, rows.length > query.limit ? selected.at(-1)! : null);
  });
}
export async function getCampaignOwnerReview(actor: OrganizationActor, input: unknown, options: CampaignPlanningOptions = {}): Promise<CampaignOwnerReview> {
  const packet = CampaignOwnerReviewQuerySchema.safeParse(input), call = await beginPlanningCall(actor, options), query = captured(packet, call.checkpoint);
  const capture = await captureCampaignOwnerReviewScope(call, [query.submissionId]);
  return withCampaignOwnerReviewScope(call, capture, false, async (tx, frame) => validatePlanningOutput(CampaignOwnerReviewSchema,
    { asOf: call.now.toISOString(), review: await projectCampaignOwnerReview(tx, call, frame, query.submissionId, true) }, call.checkpoint));
}
async function replayOwnerReview(tx: Tx, call: PlanningCall, frame: CampaignOwnerScopeFrame,
  command: ReviewCommand, payloadHash: string, capturedIds: ReadonlySet<string>): Promise<CampaignOwnerReviewResult | null> {
  const previous = await organizationAwait(call.checkpoint, () => tx.planningReviewCommand.findUnique({ where: {
    actorUserId_operationKey: { actorUserId: call.actor.userId, operationKey: command.operationKey } },
    select: { campaignSubmissionId: true, contextSubmissionId: true, workspaceId: true, payloadHash: true, action: true, result: true } }));
  if (!previous) return null;
  if (previous.campaignSubmissionId && !capturedIds.has(previous.campaignSubmissionId)) return planningRetry();
  const binding = previous.campaignSubmissionId ? frame.bindings.get(previous.campaignSubmissionId) : undefined;
  if (previous.campaignSubmissionId && (!binding || binding.workspace.id !== previous.workspaceId)) return planningMissing();
  if (!binding || previous.contextSubmissionId !== null || previous.campaignSubmissionId !== command.submissionId
    || previous.action !== command.decision || previous.payloadHash !== payloadHash) return fail("OPERATION_KEY_REUSED");
  const receipt = validatePlanningOutput(CampaignOwnerReviewReceiptSchema, previous.result, call.checkpoint);
  if (receipt.campaignId !== binding.campaign.id || receipt.submissionId !== command.submissionId || receipt.briefId !== binding.brief.id
    || receipt.version !== binding.brief.version || receipt.revision !== command.expectedRevision + 1
    || binding.submission.revision !== receipt.revision || binding.submission.state !== receipt.state
    || receipt.state !== (command.decision === "APPROVE" ? "APPROVED" : "DECLINED")
    || receipt.campaignRevision > binding.campaign.revision || receipt.planningRevision > binding.state.revision
    || receipt.selectionRevision > binding.currentSelection.revision) return planningRetry();
  if (command.decision === "APPROVE" && (binding.brief.approvedByUserId !== call.actor.userId || !binding.brief.approvedAt
    || !binding.submission.decidedAt || binding.brief.approvedAt.getTime() !== binding.submission.decidedAt.getTime())) return planningRetry();
  return validatePlanningOutput(CampaignOwnerReviewResultSchema, { ...receipt, replayed: true }, call.checkpoint);
}
async function recordOwnerReview(tx: Tx, call: PlanningCall, command: ReviewCommand, payloadHash: string,
  workspaceId: string, value: ReviewReceipt) {
  const receipt = validatePlanningOutput(CampaignOwnerReviewReceiptSchema, value, call.checkpoint), id = randomUUID();
  await organizationAwait(call.checkpoint, () => tx.planningReviewCommand.create({ data: { id, actorUserId: call.actor.userId,
    operationKey: command.operationKey, payloadHash, workspaceId, contextSubmissionId: null, campaignSubmissionId: command.submissionId,
    action: command.decision, result: inputJson(receipt), createdAt: call.now }, select: { id: true } }));
  await effects(tx, call, id, command.decision === "APPROVE" ? "campaign_planning.review_approved" : "campaign_planning.review_declined",
    receipt.campaignId, receipt.campaignRevision, receipt);
  return validatePlanningOutput(CampaignOwnerReviewResultSchema, { ...receipt, replayed: false }, call.checkpoint);
}
export async function decideCampaignOwnerReview(actor: OrganizationActor, input: unknown, options: CampaignPlanningOptions = {}): Promise<CampaignOwnerReviewResult> {
  const packet = CampaignOwnerReviewCommandSchema.safeParse(input), policyReviewResolver = options.policyReviewResolver;
  const call = await beginPlanningCall(actor, options), command = captured(packet, call.checkpoint);
  const payloadHash = hash({ purpose: "CAMPAIGN_PLANNING_OWNER_REVIEW_V1", actorUserId: call.actor.userId, command,
    serverPolicyResolver: policyReviewResolver ? "reviewed-registry-v1" : null }, call.checkpoint);
  const previous = await organizationAwait(call.checkpoint, () => organizationDb(call.options).planningReviewCommand.findUnique({ where: {
    actorUserId_operationKey: { actorUserId: call.actor.userId, operationKey: command.operationKey } }, select: { campaignSubmissionId: true } }));
  const ids = [...new Set([command.submissionId, ...(previous?.campaignSubmissionId ? [previous.campaignSubmissionId] : [])])];
  const capturedIds = new Set(ids), capture = await captureCampaignOwnerReviewScope(call, ids,
    { includePolicies: command.decision === "APPROVE" && policyReviewResolver !== undefined });
  return withCampaignOwnerReviewScope(call, capture, true, async (tx, frame) => {
    const binding = frame.bindings.get(command.submissionId);
    if (!binding) return planningMissing();
    const replayed = await replayOwnerReview(tx, call, frame, command, payloadHash, capturedIds);
    if (replayed) return replayed;
    if (binding.submission.revision !== command.expectedRevision) return fail("STALE_VERSION");
    if (binding.submission.state !== "PENDING") return fail("REVIEW_DECIDED");
    const revision = next(binding.submission.revision, call.checkpoint);
    if (revision !== 2) return planningRetry();
    next(binding.campaign.revision, call.checkpoint); next(binding.state.revision, call.checkpoint);
    if (command.decision === "APPROVE" && campaignOwnerSourceStale(binding, call.checkpoint)) return fail("STALE_REVIEW");
    // This internal draft is read only after actual current target authorization.
    // It is never part of the owner submitted-snapshot projection.
    let campaign = await organizationAwait(call.checkpoint, () => tx.campaign.findUnique({ where: { id: binding.campaign.id, brandId: binding.brand.id } }));
    if (!campaign || campaign.revision !== binding.campaign.revision || binding.targetOwnerUserId !== call.actor.userId) return planningRetry();
    if (command.decision === "APPROVE") {
      const state = stateOf(campaign, call.checkpoint);
      if (state.fieldsRevision !== binding.submission.inputRevision || binding.brief.approvedAt || binding.brief.approvedByUserId) return fail("STALE_REVIEW");
      const snapshot = await projectCampaignOwnerReview(tx, call, frame, command.submissionId, true);
      const brief = await organizationAwait(call.checkpoint, () => tx.campaignBrief.findUnique({ where: { id: binding.brief.id } }));
      const latest = await organizationAwait(call.checkpoint, () => tx.campaignBrief.findFirst({ where: { campaignId: campaign!.id }, orderBy: { version: "desc" }, select: { id: true } }));
      if (!brief || latest?.id !== brief.id || brief.campaignId !== campaign.id || brief.version !== binding.brief.version
        || brief.inputRevision !== binding.submission.inputRevision || brief.approvedAt || brief.approvedByUserId) return fail("STALE_REVIEW");
      const content = (await core(call.checkpoint, async () => campaignBriefDTO(brief))).content;
      if (hash(content, call.checkpoint) !== hash(snapshot.content, call.checkpoint)
        || hash({ content, provenance: snapshot.provenance }, call.checkpoint) !== binding.submission.contentHash) return planningRetry();
      const currentCampaign = campaign;
      const approved = await core(call.checkpoint, () => approveCampaignBriefCore(tx, currentCampaign, binding.brand, call.actor.userId,
        { expectedRevision: currentCampaign.revision, briefId: brief.id, expectedBriefVersion: brief.version },
        { key: command.operationKey, policyReview: null, policyReviewResolver, evidenceActors: frame.evidenceActors,
          checkpoint: call.checkpoint, now: call.now }));
      campaign = approved.campaign;
    } else {
      const currentCampaign = campaign;
      campaign = await core(call.checkpoint, () => updateCampaignCore(tx, currentCampaign, currentCampaign.revision, {}, call.checkpoint));
    }
    const planningRevision = await updateState(tx, call, campaign.id, binding.state.revision, binding.currentSelection);
    const state = command.decision === "APPROVE" ? "APPROVED" : "DECLINED";
    await organizationAwait(call.checkpoint, () => tx.campaignPlanningSubmission.update({ where: { id: command.submissionId },
      data: { state, revision, decidedByUserId: call.actor.userId, decidedAt: call.now }, select: { id: true } }));
    return recordOwnerReview(tx, call, command, payloadHash, binding.workspace.id, { campaignId: campaign.id, submissionId: command.submissionId,
      briefId: binding.brief.id, version: binding.brief.version, revision: 2, state, campaignRevision: campaign.revision,
      planningRevision, selectionRevision: binding.currentSelection.revision });
  });
}
