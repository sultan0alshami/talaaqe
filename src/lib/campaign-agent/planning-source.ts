// Internal S2 source hydration; the genuine native frame owns every DB wait.
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { readAiPlanningNativeFrame, type AiPlanningNativeFrame } from "@/lib/ai-budget/ledger";
import { planningScopeInternals, planningMissing, type PlanningBoundScopeProof,
  type PlanningScopeView } from "@/lib/campaign-planning/scope";
import { CampaignDraftFieldsSchema, CampaignFieldsSchema, type CampaignDraftFields } from "@/lib/campaigns/contracts";
import { ApprovedBrandContextVersionSchema, BrandContextNameSchema, BrandContextContentSchema } from "@/lib/brand-context/contracts";
import { OrganizationIdSchema as id, OrganizationRevisionSchema as revision } from "@/lib/organizations/contracts";
import { UtcDateTimeSchema } from "@/lib/contracts/vocabulary";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { planningPlainJsonSchema } from "@/lib/planning/output-contracts";
import { AgentBindingSchema, AgentSnapshotSchema, CampaignAgentStateSchema, CustomerTextSourceSchema,
  type AgentBinding, type AgentSnapshot, type CampaignAgentState, type CustomerTextSource } from "./contracts";
import { CampaignAgentError, CampaignAgentBatchSchema, type CampaignAgentBatch } from "./native-contracts";

type Tx = Prisma.TransactionClient;
type Native = Awaited<ReturnType<typeof readAiPlanningNativeFrame>>;
type DeepReadonly<T> = T extends readonly (infer U)[] ? readonly DeepReadonly<U>[]
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
type ApprovedContext = z.infer<typeof ApprovedBrandContextVersionSchema>;
export type CampaignAgentPlanningMaterial = DeepReadonly<{
  binding: AgentBinding; current: { snapshot: AgentSnapshot; fields: CampaignDraftFields };
  agent: { id: string; revision: number; stateHash: string }; preferences: CampaignAgentState["preferences"];
  coverage: "UNCONFIRMED" | "CURRENT" | "STALE"; sources: CustomerTextSource[];
  confirmation: CampaignAgentBatch | null; context: ApprovedContext | null;
}>;
declare const campaignAgentPlanningProofBrand: unique symbol;
export type CampaignAgentPlanningProof = Readonly<{ [campaignAgentPlanningProofBrand]: true }>;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const reference = z.object({ id, sourceHash: hash }).strict();
const inputSchema = planningPlainJsonSchema(z.object({ campaignId: id,
  sourceReferences: z.array(reference).max(64)
    .refine(rows => rows.every((row, index) => index === 0 || rows[index - 1]!.id < row.id)),
}).strict(), 65536);
type Input = z.infer<typeof inputSchema>;
const campaignSchema = planningPlainJsonSchema(z.object({ id, brandId: id, revision,
  schemaVersion: z.literal(1), fieldsRevision: revision,
  fields: CampaignDraftFieldsSchema.refine(fields => new TextEncoder().encode(JSON.stringify(fields)).byteLength <= 65536),
}).strict().refine(row => row.fieldsRevision <= row.revision), 131072);
const agentSchema = z.object({ id, campaignId: id, workspaceId: id, revision, stateHash: hash,
  createdAt: UtcDateTimeSchema, updatedAt: UtcDateTimeSchema }).strict();
const batchSchema = z.object({ id, agentId: id, campaignId: id, workspaceId: id, confirmedByUserId: id,
  contentHash: hash, confirmedAt: UtcDateTimeSchema, sourceReferences: z.array(reference).max(120) }).strict();
type AgentPin = z.infer<typeof agentSchema>;
type BatchPin = z.infer<typeof batchSchema>;
type Current = { snapshot: AgentSnapshot; fields: CampaignDraftFields };
type ContextPin = { versionId: string; submissionId: string; contextId: string };
type State = { frame: AiPlanningNativeFrame; tx: Tx; scopeProof: PlanningBoundScopeProof;
  actor: Native["actor"]; input: Input; view: PlanningScopeView; binding: AgentBinding;
  current: Current; agent: AgentPin; retained: CampaignAgentState; batch: BatchPin | null;
  references: { id: string; sourceHash: string }[]; contextPin: ContextPin | null;
  material: CampaignAgentPlanningMaterial };
const proofs = new WeakMap<object, State>();
const fail = (code = "INVALID_STORED_AGENT", status = 503): never => { throw new CampaignAgentError(code, status); };
function stored<T>(schema: z.ZodType<T>, input: unknown): T {
  const value = schema.safeParse(input); return value.success ? value.data : fail();
}
function iso(date: Date): string { return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : fail(); }
const equal = (left: unknown, right: unknown) => canonicalHash(left) === canonicalHash(right);
function freeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value as DeepReadonly<T>;
}
const agentSelect = { id: true, campaignId: true, workspaceId: true, revision: true,
  stateHash: true, createdAt: true, updatedAt: true } as const;
function agentPin(row: Prisma.CampaignAgentGetPayload<{ select: typeof agentSelect }>): AgentPin {
  return stored(agentSchema, { ...row, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) });
}
function selected(view: PlanningScopeView, campaignId: string) {
  const campaign = view.campaigns.find(row => row.id === campaignId), binding = view.bindings.find(row => row.campaignId === campaignId),
    state = view.states.find(row => row.campaignId === campaignId);
  const selection = state && view.selections.find(row => row.id === state.selectionId);
  if (!campaign || !binding || !state || !selection || campaign.brandId !== view.brandId ||
      binding.brandId !== view.brandId || binding.workspaceId !== view.workspace.id || state.workspaceId !== view.workspace.id ||
      selection.campaignId !== campaignId || selection.workspaceId !== view.workspace.id || selection.revision !== state.selectionRevision) return planningMissing();
  if (campaign.status === "COMPLETED" || campaign.status === "CANCELLED") return fail("CAMPAIGN_TERMINAL", 409);
  return { campaign, state, selection };
}
async function current(tx: Tx, view: PlanningScopeView, campaignId: string): Promise<Current> {
  const bound = selected(view, campaignId);
  const rows = await tx.$queryRaw<unknown[]>`SELECT id, "brandId", revision,
    "input"->'schemaVersion' AS "schemaVersion", "input"->'fieldsRevision' AS "fieldsRevision", "input"->'fields' AS fields
    FROM "Campaign" WHERE id=${campaignId} AND "brandId"=${view.brandId}`;
  if (rows.length !== 1) return planningMissing();
  const row = stored(campaignSchema, rows[0]);
  if (row.revision !== bound.campaign.revision) return fail("RETRY_REQUIRED");
  const snapshot = stored(AgentSnapshotSchema, { campaignRevision: row.revision, fieldsRevision: row.fieldsRevision,
    planningRevision: bound.state.revision, fieldsHash: canonicalHash({ domain: "infame-campaign-fields-v1", fields: row.fields }),
    selection: { id: bound.selection.id, revision: bound.selection.revision,
      kind: bound.selection.contextVersionId === null ? "NONE" : "APPROVED_CONTEXT",
      versionId: bound.selection.contextVersionId, contentHash: bound.selection.contentHash } });
  return { snapshot, fields: row.fields };
}
async function retained(tx: Tx, binding: AgentBinding, pin: AgentPin): Promise<CampaignAgentState> {
  const held = await tx.campaignAgent.findFirst({ where: { id: pin.id, campaignId: binding.campaignId, workspaceId: binding.workspaceId },
    select: agentSelect });
  if (!held || !equal(agentPin(held), pin)) return fail("RETRY_REQUIRED");
  const row = await tx.campaignAgent.findFirst({ where: { id: pin.id, campaignId: binding.campaignId, workspaceId: binding.workspaceId },
    select: { ...agentSelect, state: true } });
  if (!row) return fail("RETRY_REQUIRED");
  const { state: body, ...metadata } = row;
  if (!equal(agentPin(metadata), pin)) return fail("RETRY_REQUIRED");
  const value = stored(CampaignAgentStateSchema, body);
  if (value.id !== pin.id || value.revision !== pin.revision || value.stateHash !== pin.stateHash ||
      value.updatedAt !== pin.updatedAt || !equal(value.binding, binding)) return fail();
  return value;
}
async function batchPin(tx: Tx, binding: AgentBinding, agentId: string, batchId: string): Promise<BatchPin> {
  const rows = await tx.$queryRaw<Array<{ id: string; agentId: string; campaignId: string; workspaceId: string;
    confirmedByUserId: string; contentHash: string; confirmedAt: Date; sourceReferences: unknown }>>`
    SELECT id, "agentId", "campaignId", "workspaceId", "confirmedByUserId", "contentHash", "confirmedAt",
      jsonb_path_query_array(content, '$.confirmations[*].source.references[*]') AS "sourceReferences"
    FROM "CampaignAgentConfirmationBatch" WHERE id=${batchId} AND "agentId"=${agentId}
      AND "campaignId"=${binding.campaignId} AND "workspaceId"=${binding.workspaceId}`;
  if (rows.length !== 1) return fail();
  return stored(batchSchema, { ...rows[0]!, confirmedAt: iso(rows[0]!.confirmedAt) });
}
function closure(retainedState: CampaignAgentState, batch: BatchPin | null) {
  const reached = new Map<string, string>();
  for (const item of [...retainedState.textSourceReferences, ...(batch?.sourceReferences ?? [])]) {
    if (reached.has(item.id) && reached.get(item.id) !== item.sourceHash) return fail();
    reached.set(item.id, item.sourceHash);
  }
  if (reached.size > 64) return fail();
  return [...reached].map(([id, sourceHash]) => ({ id, sourceHash })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
async function sources(tx: Tx, binding: AgentBinding, agentId: string, references: readonly { id: string; sourceHash: string }[]) {
  if (!references.length) return [];
  const rows = await tx.campaignAgentTextSource.findMany({ where: { id: { in: references.map(row => row.id) }, agentId,
    campaignId: binding.campaignId, workspaceId: binding.workspaceId },
    select: { id: true, agentId: true, campaignId: true, workspaceId: true, authorUserId: true, sourceHash: true, createdAt: true, content: true },
    take: references.length });
  if (rows.length !== references.length) return fail();
  return references.map(ref => {
    const row = rows.find(item => item.id === ref.id); if (!row) return fail();
    const value = stored(CustomerTextSourceSchema, row.content);
    if (row.agentId !== agentId || row.campaignId !== binding.campaignId || row.workspaceId !== binding.workspaceId ||
        value.id !== row.id || value.sourceHash !== row.sourceHash || value.sourceHash !== ref.sourceHash ||
        value.authorUserId !== row.authorUserId || value.createdAt !== iso(row.createdAt) || !equal(value.binding, binding)) return fail();
    return value;
  });
}
async function confirmation(tx: Tx, binding: AgentBinding, pin: BatchPin | null, state: CampaignAgentState,
  sourceValues: readonly CustomerTextSource[]): Promise<CampaignAgentBatch | null> {
  if (!pin) { if (state.confirmation.kind !== "UNCONFIRMED") return fail(); return null; }
  const row = await tx.campaignAgentConfirmationBatch.findFirst({ where: { id: pin.id, agentId: pin.agentId,
    campaignId: binding.campaignId, workspaceId: binding.workspaceId },
    select: { id: true, agentId: true, campaignId: true, workspaceId: true, confirmedByUserId: true, contentHash: true, confirmedAt: true, content: true } });
  if (!row || state.confirmation.kind !== "REVIEWED_SET") return fail();
  const { content: body, ...metadata } = row;
  const scalar = { ...metadata, confirmedAt: iso(metadata.confirmedAt) };
  const { sourceReferences: previousRefs, ...previousScalars } = pin; void previousRefs;
  if (!equal(scalar, previousScalars)) return fail();
  const value = stored(CampaignAgentBatchSchema, body);
  if (value.id !== pin.id || value.agentId !== pin.agentId || value.contentHash !== pin.contentHash ||
      value.confirmedByUserId !== pin.confirmedByUserId || value.confirmedAt !== pin.confirmedAt || !equal(value.binding, binding) ||
      value.id !== state.confirmation.confirmationBatchId || !equal(value.reviewedSnapshot, state.confirmation.reviewedSnapshot) ||
      !equal(value.confirmations.map(item => ({ field: item.field, id: item.id, valueHash: item.valueHash, confirmationHash: item.confirmationHash })), state.confirmation.fields)) return fail();
  const fields = stored(CampaignFieldsSchema, Object.fromEntries(value.confirmations.map(item => [item.field, item.value])));
  if (value.reviewedSnapshot.fieldsHash !== canonicalHash({ domain: "infame-campaign-fields-v1", fields }) || !equal(fields, state.fields)) return fail();
  const bodyRefs = value.confirmations.flatMap(item => item.source.kind === "CUSTOMER_TEXT" ? item.source.references : []);
  if (!equal(bodyRefs, pin.sourceReferences)) return fail();
  for (const ref of bodyRefs) if (!sourceValues.some(source => source.id === ref.id && source.sourceHash === ref.sourceHash)) return fail();
  return value;
}
function selectedContext(view: PlanningScopeView, campaignId: string): ContextPin | null {
  const selection = selected(view, campaignId).selection;
  if (selection.contextVersionId === null) return null;
  const version = view.versions.find(row => row.id === selection.contextVersionId), parent = version && view.contexts.find(row => row.id === version.contextId),
    submission = version && view.submissions.find(row => row.id === version.submissionId);
  if (!version || !parent || !submission || version.workspaceId !== view.workspace.id || parent.workspaceId !== view.workspace.id ||
      version.contentHash !== selection.contentHash) return fail("RETRY_REQUIRED");
  if (parent.archived) return fail("ARCHIVED", 409);
  return { versionId: version.id, submissionId: submission.id, contextId: parent.id };
}
async function context(tx: Tx, view: PlanningScopeView, pin: ContextPin | null): Promise<ApprovedContext | null> {
  if (!pin) return null;
  const version = view.versions.find(row => row.id === pin.versionId), submission = view.submissions.find(row => row.id === pin.submissionId),
    parent = view.contexts.find(row => row.id === pin.contextId);
  if (!version || !submission || !parent || parent.archived) return parent?.archived ? fail("ARCHIVED", 409) : fail("RETRY_REQUIRED");
  const row = await tx.brandContextSubmission.findFirst({ where: { id: pin.submissionId, contextId: pin.contextId, workspaceId: view.workspace.id },
    select: { id: true, contextId: true, workspaceId: true, inputRevision: true, contentHash: true, state: true,
      decidedByUserId: true, decidedAt: true, name: true, nameLanguage: true, content: true } });
  if (!row || !row.decidedAt) return fail("RETRY_REQUIRED");
  const { name, nameLanguage, content: body, ...metadata } = row;
  if (!equal({ ...metadata, decidedAt: iso(row.decidedAt) }, submission) || version.submissionId !== row.id ||
      version.contextId !== row.contextId || version.workspaceId !== row.workspaceId || version.inputRevision !== row.inputRevision ||
      version.contentHash !== row.contentHash || version.approvedByUserId !== row.decidedByUserId || version.approvedAt !== iso(row.decidedAt)) return fail("RETRY_REQUIRED");
  const nameOriginal = stored(BrandContextNameSchema, { text: name, language: nameLanguage }), content = stored(BrandContextContentSchema, body);
  if (canonicalHash({ nameOriginal, content }) !== version.contentHash) return fail("RETRY_REQUIRED");
  return stored(ApprovedBrandContextVersionSchema, { id: version.id, contextId: version.contextId, version: version.version,
    inputRevision: version.inputRevision, nameOriginal, content, contentHash: version.contentHash, approvedAt: version.approvedAt });
}
function material(binding: AgentBinding, current: Current, agent: AgentPin, state: CampaignAgentState,
  requested: Input["sourceReferences"], sourceValues: CustomerTextSource[], batch: CampaignAgentBatch | null, selected: ApprovedContext | null): CampaignAgentPlanningMaterial {
  const coverage = state.confirmation.kind === "UNCONFIRMED" ? "UNCONFIRMED"
    : equal(state.snapshot, current.snapshot) && equal(state.fields, current.fields) && batch && equal(batch.reviewedSnapshot, current.snapshot) ? "CURRENT" : "STALE";
  return freeze({ binding, current, agent: { id: agent.id, revision: agent.revision, stateHash: agent.stateHash },
    preferences: state.preferences, coverage, sources: requested.map(ref => {
      const source = sourceValues.find(value => value.id === ref.id && value.sourceHash === ref.sourceHash); return source ?? fail();
    }), confirmation: coverage === "CURRENT" ? batch : null, context: selected });
}
function sameMaterial(left: CampaignAgentPlanningMaterial, right: CampaignAgentPlanningMaterial) {
  // Each source is independently bounded and hashed. The complete selected
  // source collection can legitimately exceed the canonical helper's512KiB cap.
  return equal(left.binding, right.binding) && equal(left.current, right.current) && equal(left.agent, right.agent) &&
    equal(left.preferences, right.preferences) && left.coverage === right.coverage &&
    equal(left.sources.map(row => ({ id: row.id, sourceHash: row.sourceHash })), right.sources.map(row => ({ id: row.id, sourceHash: row.sourceHash }))) &&
    equal(left.confirmation, right.confirmation) && equal(left.context, right.context);
}
async function bindSourcesInFrame(frame: AiPlanningNativeFrame, scopeProof: PlanningBoundScopeProof,
  input: { campaignId: string; sourceReferences: { id: string; sourceHash: string }[] }): Promise<CampaignAgentPlanningProof> {
  // Capture plain caller values before any wait; native authority wins malformed input.
  const parsed = inputSchema.safeParse(input);
  const base = await readAiPlanningNativeFrame(frame), view = await planningScopeInternals.readPlanningProof(frame, scopeProof);
  if (!parsed.success) return fail("VALIDATION", 422);
  const captured = parsed.data, contextPin = selectedContext(view, captured.campaignId), currentFields = await current(base.tx, view, captured.campaignId);
  const binding = stored(AgentBindingSchema, { scope: view.scope, campaignId: captured.campaignId, workspaceId: view.workspace.id });
  const first = await base.tx.campaignAgent.findFirst({ where: { campaignId: binding.campaignId, workspaceId: binding.workspaceId }, select: agentSelect });
  if (!first) return fail("AGENT_REQUIRED", 409);
  const agent = agentPin(first);
  await base.tx.$queryRaw`SELECT id FROM "CampaignAgent" WHERE id=${agent.id} AND "campaignId"=${binding.campaignId}
    AND "workspaceId"=${binding.workspaceId} FOR UPDATE`;
  const state = await retained(base.tx, binding, agent);
  for (const ref of captured.sourceReferences) if (!state.textSourceReferences.some(value => value.id === ref.id && value.sourceHash === ref.sourceHash)) return fail("VALIDATION", 422);
  const pin = state.confirmation.kind === "REVIEWED_SET" ? await batchPin(base.tx, binding, agent.id, state.confirmation.confirmationBatchId) : null;
  const refs = closure(state, pin), ids = refs.map(row => row.id);
  if (ids.length) {
    const locked = await base.tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "CampaignAgentTextSource"
      WHERE id IN (${Prisma.join(ids)}) AND "agentId"=${agent.id} AND "campaignId"=${binding.campaignId}
      AND "workspaceId"=${binding.workspaceId} ORDER BY id COLLATE "C" FOR SHARE`);
    if (!equal(locked.map(row => row.id), ids)) return fail();
  }
  if (pin) await base.tx.$queryRaw`SELECT id FROM "CampaignAgentConfirmationBatch" WHERE id=${pin.id} AND "agentId"=${agent.id}
    AND "campaignId"=${binding.campaignId} AND "workspaceId"=${binding.workspaceId} FOR SHARE`;
  const sourceValues = await sources(base.tx, binding, agent.id, refs), batch = await confirmation(base.tx, binding, pin, state, sourceValues),
    approved = await context(base.tx, view, contextPin);
  const value = material(binding, currentFields, agent, state, captured.sourceReferences, sourceValues, batch, approved);
  const proof = Object.freeze({}) as CampaignAgentPlanningProof;
  proofs.set(proof, { frame, tx: base.tx, scopeProof, actor: base.actor, input: captured, view, binding,
    current: currentFields, agent, retained: state, batch: pin, references: refs, contextPin, material: value });
  try { await recheckSourcesProof(frame, proof); } catch (error) { proofs.delete(proof); throw error; }
  return proof;
}
async function proofState(frame: AiPlanningNativeFrame, proof: CampaignAgentPlanningProof) {
  const base = await readAiPlanningNativeFrame(frame), state = proof !== null && typeof proof === "object" ? proofs.get(proof) : undefined;
  if (!state || state.frame !== frame || state.tx !== base.tx || state.actor.userId !== base.actor.userId || state.actor.role !== base.actor.role ||
      state.actor.sessionId !== base.actor.sessionId || state.actor.sessionVersion !== base.actor.sessionVersion) return fail("SCOPE_PROOF_UNAVAILABLE");
  await planningScopeInternals.recheckPlanningProof(frame, state.scopeProof);
  return { base, state };
}
async function recheckSourcesProof(frame: AiPlanningNativeFrame, proof: CampaignAgentPlanningProof): Promise<void> {
  const { base, state } = await proofState(frame, proof);
  const currentFields = await current(base.tx, state.view, state.binding.campaignId);
  if (!equal(currentFields, state.current)) return fail("RETRY_REQUIRED");
  const value = await retained(base.tx, state.binding, state.agent);
  if (!equal(value, state.retained)) return fail("RETRY_REQUIRED");
  const sourceValues = await sources(base.tx, state.binding, state.agent.id, state.references),
    batch = await confirmation(base.tx, state.binding, state.batch, value, sourceValues), approved = await context(base.tx, state.view, state.contextPin);
  const next = material(state.binding, currentFields, state.agent, value, state.input.sourceReferences, sourceValues, batch, approved);
  if (!sameMaterial(next, state.material)) return fail();
  await planningScopeInternals.recheckPlanningProof(frame, state.scopeProof); await base.assertCurrent();
}
async function readSourcesProof(frame: AiPlanningNativeFrame, proof: CampaignAgentPlanningProof): Promise<CampaignAgentPlanningMaterial> {
  await recheckSourcesProof(frame, proof);
  return (await proofState(frame, proof)).state.material;
}
export const campaignAgentPlanningInternals = Object.freeze({ bindSourcesInFrame, readSourcesProof, recheckSourcesProof });
