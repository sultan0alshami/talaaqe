import { randomUUID } from "node:crypto";
import { Prisma, type Campaign, type CampaignAgent } from "@prisma/client";
import { z } from "zod";
import { CampaignDraftFieldsSchema, CampaignFieldsSchema, type CampaignDraftFields } from "@/lib/campaigns/contracts";
import { campaignEditable, campaignStateOf, campaignBriefDTO, generateCampaignBriefCore } from "@/lib/campaigns/core";
import { CampaignError } from "@/lib/campaigns/errors";
import { organizationAwait, validateClientDelegation, type OrganizationActor, type OrganizationOptions } from "@/lib/organizations/context";
import { canonicalHash, inputJson } from "@/lib/onboarding/drafts";
import { beginPlanningCall, capturePlanningScope, withPlanningScope, planningMissing,
  type PlanningCall, type PlanningScopeFrame } from "@/lib/campaign-planning/scope";
import { loadPlanningCampaignRow, loadSelectedPlanningContext, projectPlanningSelection, makePlanningOwnerSnapshot } from "@/lib/campaign-planning/projection";
import { AgentSnapshotSchema, CampaignAgentStateSchema, CustomerTextSourceSchema, FieldConfirmationSchema,
  type AgentBinding, type AgentSnapshot, type CampaignAgentState, type CustomerTextSource } from "./contracts";
import { CampaignAgentError, CampaignAgentCommandSchema, CampaignAgentQuerySchema, CampaignAgentSourcesQuerySchema,
  CampaignAgentBatchSchema, CampaignAgentReceiptSchema, CampaignAgentResultSchema,
  type CampaignAgentCommand, type CampaignAgentBatch, type CampaignAgentResult } from "./native-contracts";

export type CampaignAgentOptions = OrganizationOptions & { now?: Date; channel: "FORM" | "AGENT_TOOL" };
export type CampaignAgentRead = { asOf: string; binding: AgentBinding;
  current: { snapshot: AgentSnapshot; fields: CampaignDraftFields }; retained: CampaignAgentState | null;
  coverage: "NOT_INITIALIZED" | "UNCONFIRMED" | "CURRENT" | "STALE" };
export type CampaignAgentSourcePage = { asOf: string; binding: AgentBinding; agentId: string;
  sources: CustomerTextSource[]; nextCursor: string | null };

type Tx = Prisma.TransactionClient;
type Frame = { binding: AgentBinding; current: CampaignAgentRead["current"]; campaign: Campaign;
  bound: NonNullable<ReturnType<PlanningScopeFrame["campaigns"]["get"]>>; row: CampaignAgent | null;
  retained: CampaignAgentState | null };
const fail = (code: string, status = 409): never => { throw new CampaignAgentError(code, status); };
function parse<T>(schema: z.ZodType<T>, input: unknown, stored = false): T {
  const parsed = schema.safeParse(input);
  return parsed.success ? parsed.data : fail(stored ? "INVALID_STORED_AGENT" : "VALIDATION", stored ? 503 : 422);
}
function next(revision: number) { if (revision >= 2147483646) return fail("VERSION_EXHAUSTED"); return revision + 1; }
function now(options: { now?: Date }) { return options.now === undefined ? new Date() : new Date(options.now.getTime()); }
function same(left: unknown, right: unknown) { return canonicalHash(left) === canonicalHash(right); }
function stateHash(input: Omit<CampaignAgentState, "stateHash"> & { stateHash?: string }): CampaignAgentState {
  const { stateHash: previousHash, ...content } = input;
  void previousHash;
  return parse(CampaignAgentStateSchema, { ...content, stateHash: canonicalHash({ domain: "infame-campaign-agent-state-v1", ...content }) });
}

// Planning's write frame establishes plan; view is independently required before
// any private Campaign.input or agent body is hydrated. Locks already exist.
async function requireView(tx: Tx, call: PlanningCall, frame: PlanningScopeFrame) {
  if (frame.scope.kind === "OWN_BRAND") return;
  const authority = frame.currentAuthority;
  if (!authority) return planningMissing();
  const grant = await organizationAwait(call.checkpoint, () => tx.clientGrant.findUnique({ where: { id: authority.grantId } }));
  const client = await organizationAwait(call.checkpoint, () => tx.organizationClient.findUnique({ where: { id: authority.clientId } }));
  if (!grant?.active || !grant.view || !client || grant.clientId !== client.id || grant.membershipId !== authority.membershipId
    || grant.organizationId !== authority.organizationId) return planningMissing();
  const delegation = await validateClientDelegation(tx, client, frame.ownerIds, call.checkpoint);
  if (!delegation.capabilities.view) return planningMissing();
}
async function load(tx: Tx, call: PlanningCall, frame: PlanningScopeFrame, campaignId: string, write: boolean): Promise<Frame> {
  await requireView(tx, call, frame);
  const bound = frame.campaigns.get(campaignId);
  if (!bound?.binding || !bound.state || !bound.selection || !frame.workspace) return planningMissing();
  const campaign = await loadPlanningCampaignRow(tx, frame, campaignId, call.checkpoint);
  const core = campaignStateOf(campaign), fields = parse(CampaignDraftFieldsSchema, core.fields, true);
  const binding: AgentBinding = { scope: frame.scope, campaignId, workspaceId: frame.workspace.id };
  const snapshot = parse(AgentSnapshotSchema, { campaignRevision: campaign.revision, fieldsRevision: core.fieldsRevision,
    planningRevision: bound.state.revision, selection: projectPlanningSelection(bound.selection, call.checkpoint),
    fieldsHash: canonicalHash({ domain: "infame-campaign-fields-v1", fields }) }, true);
  await organizationAwait(call.checkpoint, () => tx.$queryRaw(Prisma.sql`SELECT id FROM "CampaignAgent"
    WHERE "campaignId"=${campaignId} AND "workspaceId"=${binding.workspaceId} ${Prisma.raw(write ? "FOR UPDATE" : "FOR SHARE")}`));
  const row = await organizationAwait(call.checkpoint, () => tx.campaignAgent.findUnique({ where: { campaignId } }));
  const retained = row ? parse(CampaignAgentStateSchema, row.state, true) : null;
  if (row && (!retained || row.workspaceId !== binding.workspaceId || row.id !== retained.id || row.revision !== retained.revision
    || row.stateHash !== retained.stateHash || row.updatedAt.toISOString() !== retained.updatedAt || !same(retained.binding, binding))) return fail("INVALID_STORED_AGENT", 503);
  return { binding, current: { snapshot, fields }, campaign, bound, row, retained };
}
async function source(tx: Tx, call: PlanningCall, frame: Frame, id: string, hash?: string, choice = false): Promise<CustomerTextSource> {
  if (!frame.row) return fail(choice ? "VALIDATION" : "INVALID_STORED_AGENT", choice ? 422 : 503);
  await organizationAwait(call.checkpoint, () => tx.$queryRaw`SELECT id FROM "CampaignAgentTextSource"
    WHERE id=${id} AND "campaignId"=${frame.binding.campaignId} AND "workspaceId"=${frame.binding.workspaceId} FOR SHARE`);
  const row = await organizationAwait(call.checkpoint, () => tx.campaignAgentTextSource.findFirst({ where: { id,
    agentId: frame.row!.id, campaignId: frame.binding.campaignId, workspaceId: frame.binding.workspaceId } }));
  if (!row || !frame.row || row.agentId !== frame.row.id || row.campaignId !== frame.binding.campaignId || row.workspaceId !== frame.binding.workspaceId) {
    return fail(choice ? "VALIDATION" : "INVALID_STORED_AGENT", choice ? 422 : 503);
  }
  const value = parse(CustomerTextSourceSchema, row.content, true);
  if (value.id !== row.id || value.sourceHash !== row.sourceHash || value.authorUserId !== row.authorUserId
    || value.createdAt !== row.createdAt.toISOString() || !same(value.binding, frame.binding)) return fail("INVALID_STORED_AGENT", 503);
  if (hash !== undefined && hash !== value.sourceHash) return fail(choice ? "VALIDATION" : "INVALID_STORED_AGENT", choice ? 422 : 503);
  return value;
}
async function batch(tx: Tx, call: PlanningCall, frame: Frame, id: string): Promise<CampaignAgentBatch> {
  if (!frame.row) return fail("INVALID_STORED_AGENT", 503);
  await organizationAwait(call.checkpoint, () => tx.$queryRaw`SELECT id FROM "CampaignAgentConfirmationBatch"
    WHERE id=${id} AND "campaignId"=${frame.binding.campaignId} AND "workspaceId"=${frame.binding.workspaceId} FOR SHARE`);
  const row = await organizationAwait(call.checkpoint, () => tx.campaignAgentConfirmationBatch.findFirst({ where: { id,
    agentId: frame.row!.id, campaignId: frame.binding.campaignId, workspaceId: frame.binding.workspaceId } }));
  if (!row || !frame.row || row.agentId !== frame.row.id || row.campaignId !== frame.binding.campaignId || row.workspaceId !== frame.binding.workspaceId) return fail("INVALID_STORED_AGENT", 503);
  const value = parse(CampaignAgentBatchSchema, row.content, true);
  if (value.id !== row.id || value.agentId !== row.agentId || value.contentHash !== row.contentHash
    || value.confirmedByUserId !== row.confirmedByUserId || value.confirmedAt !== row.confirmedAt.toISOString()
    || !same(value.binding, frame.binding)) return fail("INVALID_STORED_AGENT", 503);
  const fields = CampaignFieldsSchema.safeParse(Object.fromEntries(value.confirmations.map(item => [item.field, item.value])));
  if (!fields.success || value.reviewedSnapshot.fieldsHash !== canonicalHash({ domain: "infame-campaign-fields-v1", fields: fields.data })) return fail("INVALID_STORED_AGENT", 503);
  for (const item of value.confirmations) if (item.source.kind === "CUSTOMER_TEXT") {
    for (const ref of item.source.references) await source(tx, call, frame, ref.id, ref.sourceHash);
  }
  return value;
}
async function retainedLineage(tx: Tx, call: PlanningCall, frame: Frame) {
  const state = frame.retained;
  if (!state) return;
  for (const ref of state.textSourceReferences) await source(tx, call, frame, ref.id, ref.sourceHash);
  if (state.confirmation.kind !== "REVIEWED_SET") return;
  const coverage = state.confirmation, value = await batch(tx, call, frame, coverage.confirmationBatchId);
  if (!same(value.reviewedSnapshot, coverage.reviewedSnapshot)
    || !same(value.confirmations.map(item => ({ field: item.field, id: item.id, valueHash: item.valueHash, confirmationHash: item.confirmationHash })), coverage.fields)) return fail("INVALID_STORED_AGENT", 503);
}
function coverage(frame: Frame): CampaignAgentRead["coverage"] {
  if (!frame.retained) return "NOT_INITIALIZED";
  if (frame.retained.confirmation.kind === "UNCONFIRMED") return "UNCONFIRMED";
  return same(frame.retained.snapshot, frame.current.snapshot) ? "CURRENT" : "STALE";
}
async function save(tx: Tx, call: PlanningCall, frame: Frame, state: CampaignAgentState, date: Date) {
  if (!frame.row) {
    await organizationAwait(call.checkpoint, () => tx.campaignAgent.create({ data: { id: state.id, campaignId: frame.binding.campaignId,
      workspaceId: frame.binding.workspaceId, revision: 1, state: inputJson(state), stateHash: state.stateHash, createdAt: date, updatedAt: date } }));
  } else {
    const changed = await organizationAwait(call.checkpoint, () => tx.campaignAgent.updateMany({ where: { id: frame.row!.id, revision: frame.row!.revision },
      data: { revision: state.revision, state: inputJson(state), stateHash: state.stateHash, updatedAt: date } }));
    if (changed.count !== 1) return fail("STALE_VERSION");
  }
}
async function record(tx: Tx, call: PlanningCall, command: CampaignAgentCommand, payloadHash: string, receipt: z.infer<typeof CampaignAgentReceiptSchema>, date: Date) {
  const value = parse(CampaignAgentReceiptSchema, receipt), id = randomUUID();
  await organizationAwait(call.checkpoint, () => tx.campaignAgentCommand.create({ data: { id, actorUserId: call.actor.userId,
    operationKey: command.operationKey, payloadHash, agentId: value.agentId, campaignId: value.campaignId, workspaceId: value.workspaceId,
    action: value.action, result: inputJson(value), createdAt: date } }));
  const type = "campaign_agent." + command.action.toLowerCase();
  await organizationAwait(call.checkpoint, () => tx.adminAudit.create({ data: { actorUserId: call.actor.userId, action: type,
    resourceType: "Campaign", resourceId: value.campaignId, snapshot: inputJson(value), createdAt: date } }));
  await organizationAwait(call.checkpoint, () => tx.outboxEvent.create({ data: { deduplicationKey: "campaign-agent:" + id, type,
    payload: inputJson({ id, type, actorUserId: call.actor.userId, recipientUserIds: [call.actor.userId], aggregateType: "Campaign",
      aggregateId: value.campaignId, aggregateVersion: value.agentRevision, occurredAt: date.toISOString(), payload: value }),
    createdAt: date, availableAt: date } }));
  return parse(CampaignAgentResultSchema, { ...value, replayed: false });
}
async function replay(tx: Tx, call: PlanningCall, frame: Frame, command: CampaignAgentCommand, payloadHash: string): Promise<
  { found: false } | { found: true; result: CampaignAgentResult }> {
  const prior = await organizationAwait(call.checkpoint, () => tx.campaignAgentCommand.findUnique({ where: {
    actorUserId_operationKey: { actorUserId: call.actor.userId, operationKey: command.operationKey } } }));
  if (!prior) return { found: false as const };
  if (!frame.row || prior.agentId !== frame.row.id || prior.campaignId !== frame.binding.campaignId || prior.workspaceId !== frame.binding.workspaceId) return planningMissing();
  if (prior.payloadHash !== payloadHash || prior.action !== command.action) return fail("OPERATION_KEY_REUSED");
  const value = parse(CampaignAgentReceiptSchema, prior.result, true);
  if (value.agentId !== prior.agentId || value.campaignId !== prior.campaignId || value.workspaceId !== prior.workspaceId || value.action !== prior.action
    || value.agentRevision !== command.expectedAgentRevision + 1 || value.campaignRevision !== command.expectedSnapshot.campaignRevision + (command.action === "GENERATE_PROFILE" ? 1 : 0)
    || value.planningRevision !== command.expectedSnapshot.planningRevision + (command.action === "GENERATE_PROFILE" ? 1 : 0)) return fail("INVALID_STORED_AGENT", 503);
  if (value.agentRevision > frame.row.revision || value.campaignRevision > frame.current.snapshot.campaignRevision
    || value.planningRevision > frame.current.snapshot.planningRevision) return fail("INVALID_STORED_AGENT", 503);
  if (value.sourceId) {
    const material = await source(tx, call, frame, value.sourceId);
    if (command.action !== "APPEND_TEXT" || material.authorUserId !== call.actor.userId
      || !same(material.originalText, command.payload.originalText) || !same(material.capturedSnapshot, command.expectedSnapshot)
      || material.createdAt !== prior.createdAt.toISOString()) return fail("INVALID_STORED_AGENT", 503);
  }
  const material = value.confirmationBatchId ? await batch(tx, call, frame, value.confirmationBatchId) : null;
  if (material) {
    if (!same(material.reviewedSnapshot, command.expectedSnapshot)) return fail("INVALID_STORED_AGENT", 503);
    if (command.action === "CONFIRM_FIELDS" && (material.confirmedByUserId !== call.actor.userId || material.confirmedAt !== prior.createdAt.toISOString()
      || !same(material.confirmations.map(item => ({ field: item.field, valueHash: item.valueHash, source: item.source })), command.payload.fields))) return fail("INVALID_STORED_AGENT", 503);
    if (command.action === "GENERATE_PROFILE" && command.payload.confirmationBatchId !== material.id) return fail("INVALID_STORED_AGENT", 503);
  }
  if (value.briefId) {
    const brief = await organizationAwait(call.checkpoint, () => tx.campaignBrief.findFirst({ where: {
      id: value.briefId!, campaignId: frame.binding.campaignId, version: value.briefVersion! } }));
    const pin = await organizationAwait(call.checkpoint, () => tx.campaignBriefProvenance.findFirst({ where: {
      briefId: value.briefId!, campaignId: frame.binding.campaignId, workspaceId: frame.binding.workspaceId } }));
    if (!brief || brief.campaignId !== value.campaignId || brief.version !== value.briefVersion || !pin || pin.workspaceId !== value.workspaceId
      || pin.selectionId !== command.expectedSnapshot.selection.id || pin.selectionRevision !== command.expectedSnapshot.selection.revision) return fail("INVALID_STORED_AGENT", 503);
    const expectedFields = material ? Object.fromEntries(material.confirmations.map(item => [item.field, item.value])) : null;
    try {
      const dto = campaignBriefDTO(brief), requirements = dto.content.requirements;
      if (!material || brief.inputRevision !== material.reviewedSnapshot.fieldsRevision
        || !same(Object.fromEntries(material.confirmations.map(item => [item.field, requirements[item.field]])), expectedFields)) return fail("INVALID_STORED_AGENT", 503);
    } catch { return fail("INVALID_STORED_AGENT", 503); }
  }
  return { found: true as const, result: parse(CampaignAgentResultSchema, { ...value, replayed: true }, true) };
}

export async function executeCampaignAgentCommand(actor: OrganizationActor, input: unknown,
  options: CampaignAgentOptions): Promise<CampaignAgentResult> {
  const dateOptions = { now: options.now === undefined ? undefined : new Date(options.now.getTime()) }, channel = options.channel;
  const call = await beginPlanningCall(actor, { ...options, ...dateOptions });
  if (channel !== "FORM") return fail("VALIDATION", 422);
  const command = parse(CampaignAgentCommandSchema, input), payloadHash = canonicalHash({ domain: "infame-campaign-agent-command-v1", actorUserId: call.actor.userId, command });
  const capture = await capturePlanningScope(call, command.scope, { campaignIds: [command.campaignId] });
  return withPlanningScope(call, capture, { write: true, expectedAuthority: "expectedAuthority" in command ? command.expectedAuthority : undefined,
    replay: async (tx, scope) => replay(tx, call, await load(tx, call, scope, command.campaignId, true), command, payloadHash),
    execute: async (tx, scope) => {
      const frame = await load(tx, call, scope, command.campaignId, true);
      if ((frame.row?.revision ?? 0) !== command.expectedAgentRevision || !same(frame.current.snapshot, command.expectedSnapshot)) return fail("STALE_VERSION");
      if (command.action !== "INITIALIZE" && !frame.retained) return fail("AGENT_REQUIRED");
      if (command.action === "INITIALIZE" && frame.retained) return fail("STALE_VERSION");
      try { campaignEditable(frame.campaign, command.expectedSnapshot.campaignRevision); } catch (error) {
        if (error instanceof CampaignError) return fail(error.code, error.status); throw error;
      }
      await retainedLineage(tx, call, frame);
      const date = now(dateOptions), id = frame.row?.id ?? randomUUID(), agentRevision = next(frame.row?.revision ?? 0);
      let state = stateHash({ schemaVersion: 1, id, revision: agentRevision, binding: frame.binding, snapshot: frame.current.snapshot,
        fields: frame.current.fields, preferences: command.action === "INITIALIZE" || command.action === "SET_PREFERENCES"
          ? command.payload.preferences : frame.retained!.preferences,
        assistance: { kind: "MANUAL_GUIDANCE", agent: "UNAVAILABLE" }, textSourceReferences: frame.retained?.textSourceReferences ?? [],
        confirmation: { kind: "UNCONFIRMED" }, updatedAt: date.toISOString() });
      let sourceId: string | null = null, confirmationBatchId: string | null = null, briefId: string | null = null, briefVersion: number | null = null;
      if (command.action === "INITIALIZE") await save(tx, call, frame, state, date);
      else if (command.action === "SET_PREFERENCES" && coverage(frame) === "CURRENT") {
        const version = frame.bound.selection!.contextVersionId;
        const context = version ? scope.versions.get(version) : null;
        const archived = context ? scope.contexts.get(context.contextId)?.archived === true : false;
        if (!archived) {
          await loadSelectedPlanningContext(tx, call, scope, frame.bound.selection!, false);
          state = stateHash({ ...state, confirmation: frame.retained!.confirmation });
        }
      } else if (command.action === "APPEND_TEXT") {
        if (state.textSourceReferences.length >= 64 || await organizationAwait(call.checkpoint, () => tx.campaignAgentTextSource.count({ where: { agentId: id } })) >= 64) return fail("TEXT_SOURCE_LIMIT", 429);
        sourceId = randomUUID();
        const body = { schemaVersion: 1 as const, id: sourceId, binding: frame.binding, capturedSnapshot: frame.current.snapshot,
          authorUserId: call.actor.userId, kind: "CUSTOMER_TEXT" as const, originalText: command.payload.originalText, createdAt: date.toISOString() };
        const value = parse(CustomerTextSourceSchema, { ...body, sourceHash: canonicalHash({ domain: "infame-customer-text-v1", ...body }) });
        await organizationAwait(call.checkpoint, () => tx.campaignAgentTextSource.create({ data: { id: sourceId!, agentId: id,
          campaignId: frame.binding.campaignId, workspaceId: frame.binding.workspaceId, authorUserId: call.actor.userId,
          content: inputJson(value), sourceHash: value.sourceHash, createdAt: date } }));
        state = stateHash({ ...state, textSourceReferences: [...state.textSourceReferences, { id: value.id, sourceHash: value.sourceHash }] });
      } else if (command.action === "CONFIRM_FIELDS") {
        const fields = CampaignFieldsSchema.safeParse(frame.current.fields);
        if (!fields.success) return fail("MISSING_REQUIREMENTS", 422);
        await loadSelectedPlanningContext(tx, call, scope, frame.bound.selection!, false);
        confirmationBatchId = randomUUID();
        const confirmations = [];
        for (const choice of command.payload.fields) {
          const value = fields.data[choice.field], valueHash = canonicalHash({ domain: "infame-campaign-field-value-v1", field: choice.field, value });
          if (valueHash !== choice.valueHash || choice.source.kind === "CUSTOMER_FIELD_CHOICE" && choice.source.capturedValueHash !== valueHash) return fail("VALIDATION", 422);
          if (choice.source.kind === "CUSTOMER_TEXT") for (const ref of choice.source.references) await source(tx, call, frame, ref.id, ref.sourceHash, true);
          const body = { schemaVersion: 1 as const, id: randomUUID(), binding: frame.binding, confirmationBatchId,
            reviewedSnapshot: frame.current.snapshot, field: choice.field, valueHash, source: choice.source,
            confirmedByUserId: call.actor.userId, confirmedAt: date.toISOString() };
          confirmations.push(parse(FieldConfirmationSchema, { ...body, value, confirmationHash: canonicalHash({ domain: "infame-field-confirmation-v1", ...body }) }));
        }
        const body = { schemaVersion: 1 as const, id: confirmationBatchId, agentId: id, binding: frame.binding,
          reviewedSnapshot: frame.current.snapshot, confirmedByUserId: call.actor.userId, confirmedAt: date.toISOString(), confirmations };
        const value = parse(CampaignAgentBatchSchema, { ...body, contentHash: canonicalHash({ domain: "infame-campaign-confirmation-batch-v1", ...body }) });
        await organizationAwait(call.checkpoint, () => tx.campaignAgentConfirmationBatch.create({ data: { id: value.id, agentId: id,
          campaignId: frame.binding.campaignId, workspaceId: frame.binding.workspaceId, confirmedByUserId: call.actor.userId,
          confirmedAt: date, content: inputJson(value), contentHash: value.contentHash } }));
        state = stateHash({ ...state, fields: fields.data, confirmation: { kind: "REVIEWED_SET", confirmationBatchId: value.id,
          reviewedSnapshot: value.reviewedSnapshot, fields: confirmations.map(item => ({ field: item.field, id: item.id, valueHash: item.valueHash, confirmationHash: item.confirmationHash })) } });
      } else if (command.action === "GENERATE_PROFILE") {
        if (frame.retained!.confirmation.kind !== "REVIEWED_SET") {
          const prior = await organizationAwait(call.checkpoint, () => tx.campaignAgentConfirmationBatch.findFirst({ where: {
            id: command.payload.confirmationBatchId, agentId: id }, select: { id: true } }));
          return fail(prior ? "STALE_CONFIRMATION" : "CONFIRMATION_REQUIRED");
        }
        const value = await batch(tx, call, frame, command.payload.confirmationBatchId);
        if (!frame.retained || frame.retained.confirmation.kind !== "REVIEWED_SET"
          || frame.retained.confirmation.confirmationBatchId !== value.id || coverage(frame) !== "CURRENT" || !same(value.reviewedSnapshot, frame.current.snapshot)) return fail("STALE_CONFIRMATION");
        await loadSelectedPlanningContext(tx, call, scope, frame.bound.selection!, false);
        const generated = await generateCampaignBriefCore(tx, frame.campaign, scope.brand,
          { expectedRevision: frame.campaign.revision, allowLatestReuse: false, checkpoint: call.checkpoint });
        const selection = frame.bound.selection!;
        makePlanningOwnerSnapshot(campaignBriefDTO(generated.brief).content, { selectionId: selection.id, selectionRevision: selection.revision,
          versionId: selection.contextVersionId, contentHash: selection.contentHash }, call.checkpoint);
        await organizationAwait(call.checkpoint, () => tx.campaignBriefProvenance.create({ data: { briefId: generated.brief.id,
          campaignId: command.campaignId, workspaceId: frame.binding.workspaceId, selectionId: selection.id, selectionRevision: selection.revision, createdAt: date } }));
        const planningRevision = next(frame.bound.state!.revision);
        const changed = await organizationAwait(call.checkpoint, () => tx.campaignPlanningState.updateMany({ where: { campaignId: command.campaignId, revision: frame.bound.state!.revision }, data: { revision: planningRevision, updatedAt: date } }));
        if (changed.count !== 1) return fail("STALE_VERSION");
        state = stateHash({ ...state, snapshot: { ...state.snapshot, campaignRevision: generated.campaign.revision, planningRevision }, confirmation: { kind: "UNCONFIRMED" } });
        confirmationBatchId = value.id; briefId = generated.brief.id; briefVersion = generated.brief.version;
      }
      if (command.action !== "INITIALIZE") await save(tx, call, frame, state, date);
      return record(tx, call, command, payloadHash, { agentId: id, campaignId: command.campaignId, workspaceId: frame.binding.workspaceId,
        action: command.action, agentRevision, campaignRevision: state.snapshot.campaignRevision, planningRevision: state.snapshot.planningRevision,
        sourceId, confirmationBatchId, briefId, briefVersion }, date);
    } });
}
export async function getCampaignAgent(actor: OrganizationActor, input: unknown,
  options: OrganizationOptions & { now?: Date } = {}): Promise<CampaignAgentRead> {
  const copied = { now: options.now === undefined ? undefined : new Date(options.now.getTime()) }, call = await beginPlanningCall(actor, { ...options, ...copied });
  const query = parse(CampaignAgentQuerySchema, input), capture = await capturePlanningScope(call, query.scope, { campaignIds: [query.campaignId] });
  return withPlanningScope(call, capture, { write: false, execute: async (tx, scope) => {
    const frame = await load(tx, call, scope, query.campaignId, false); await retainedLineage(tx, call, frame);
    return { asOf: now(copied).toISOString(), binding: frame.binding, current: frame.current, retained: frame.retained, coverage: coverage(frame) };
  } });
}
export async function getCampaignAgentTextSources(actor: OrganizationActor, input: unknown,
  options: OrganizationOptions & { now?: Date } = {}): Promise<CampaignAgentSourcePage> {
  const copied = { now: options.now === undefined ? undefined : new Date(options.now.getTime()) }, call = await beginPlanningCall(actor, { ...options, ...copied });
  const query = parse(CampaignAgentSourcesQuerySchema, input), capture = await capturePlanningScope(call, query.scope, { campaignIds: [query.campaignId] });
  return withPlanningScope(call, capture, { write: false, execute: async (tx, scope) => {
    const frame = await load(tx, call, scope, query.campaignId, false);
    if (!frame.row) return fail("AGENT_REQUIRED");
    if (query.after && !await organizationAwait(call.checkpoint, () => tx.campaignAgentTextSource.findFirst({ where: { id: query.after, agentId: frame.row!.id }, select: { id: true } }))) return planningMissing();
    const rows = await organizationAwait(call.checkpoint, () => tx.campaignAgentTextSource.findMany({ where: { agentId: frame.row!.id,
      ...(query.after ? { id: { gt: query.after } } : {}) }, orderBy: { id: "asc" }, take: 21, select: { id: true } }));
    const asOf = now(copied).toISOString(), sources: CustomerTextSource[] = []; let more = false;
    for (const row of rows) {
      if (sources.length === 20) { more = true; break; }
      const value = await source(tx, call, frame, row.id);
      const candidate = { asOf, binding: frame.binding, agentId: frame.row.id, sources: [...sources, value], nextCursor: row.id };
      if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > 262144) { more = true; break; }
      sources.push(value);
    }
    return { asOf, binding: frame.binding, agentId: frame.row.id, sources, nextCursor: more ? sources.at(-1)!.id : null };
  } });
}

// Internal DB-only recovery composition. Only recovery.ts calls these after the
// same native scope/session locks; they are not transport or model-tool exports.
export const campaignAgentRecoveryInternals = Object.freeze({ load, source, replay, retainedLineage, save, stateHash, coverage });
