// Browser-safe codecs use actual WebCrypto canonical parity. Server/native
// contracts are type-only imports. Durable recovery lives in browser-storage
// and browser-transport; the older memory adapter remains an unused pure seam.
// Browser hashes never confer native authority or owner approval.

import { z } from "zod";
import { CampaignDraftFieldsSchema, CampaignFieldsSchema, CampaignFieldObjectSchema } from "@/lib/campaigns/contracts";
import { PlanningScopeSchema, OwnPlanningScopeSchema, ClientPlanningScopeSchema } from "@/lib/brand-context/contracts";
import { PlanningSelectionSchema } from "@/lib/campaign-planning/contracts";
import { ClientAuthoritySchema, OrganizationIdSchema as id, OrganizationRevisionSchema as revision } from "@/lib/organizations/contracts";
import { OriginalTextSchema, UtcDateTimeSchema } from "@/lib/contracts/vocabulary";
import type { AgentBinding, CampaignAgentState, CampaignAgentFieldKey, CustomerTextSource } from "@/lib/campaign-agent/contracts";
import type { CampaignAgentCommand, CampaignAgentResult } from "@/lib/campaign-agent/native-contracts";
import type { CampaignAgentRead, CampaignAgentSourcePage } from "@/lib/campaign-agent/service";

type PlainJson = null | string | number | boolean | PlainJson[] | { [key: string]: PlainJson };
type ReviewRow = { field: CampaignAgentFieldKey; valueHash: string; present: boolean };
type Captured = { command: CampaignAgentCommand; body: string; phase: "UNKNOWN" | "CONFIRMED" | "CONFLICT";
  receipt: CampaignAgentResult | null; reviewed: boolean };
export class CampaignAgentBrowserError extends Error {
  constructor(readonly code = "INVALID_RESPONSE") { super(code); }
}
const bad = (): never => { throw new CampaignAgentBrowserError(); };
const utf8Bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

export function checkedBrowserJson(value: unknown, maximum = 524288): PlainJson {
  function walk(item: unknown, depth: number): void {
    if (depth > 12) bad();
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (Array.isArray(item)) {
      if (Object.getPrototypeOf(item) !== Array.prototype || Object.getOwnPropertySymbols(item).length) bad();
      if (Object.keys(item).length !== item.length || Object.getOwnPropertyNames(item).length !== item.length + 1) bad();
      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return bad();
        walk(descriptor.value, depth + 1);
      }
      return;
    }
    if (typeof item === "object" && Object.getPrototypeOf(item) === Object.prototype) {
      if (Object.getOwnPropertySymbols(item).length) bad();
      for (const key of Object.getOwnPropertyNames(item)) {
        if (["__proto__", "prototype", "constructor"].includes(key)) bad();
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return bad();
        walk(descriptor.value, depth + 1);
      }
      return;
    }
    bad();
  }
  walk(value, 0);
  if (utf8Bytes(value) > maximum) bad();
  return value as PlainJson;
}
export function browserCanonicalJson(value: unknown): string {
  function order(item: PlainJson): PlainJson {
    if (Array.isArray(item)) return item.map(order);
    if (item !== null && typeof item === "object") return Object.fromEntries(Object.keys(item).sort().map(key => [key, order(item[key]!) ]));
    return item;
  }
  return JSON.stringify(order(checkedBrowserJson(value)));
}
export async function browserCanonicalHash(value: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(browserCanonicalJson(value));
  if (!globalThis.crypto?.subtle) throw new CampaignAgentBrowserError("BROWSER_CRYPTO_UNAVAILABLE");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
const same = (left: unknown, right: unknown) => browserCanonicalJson(left) === browserCanonicalJson(right);
function parse<T>(schema: z.ZodType<T>, value: unknown, maximum: number): T {
  checkedBrowserJson(value, maximum);
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : bad();
}
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const utc = UtcDateTimeSchema.refine(value => /^[0-9]{4}-/.test(value) && Number(value.slice(0, 4)) >= 1 && Number(value.slice(0, 4)) <= 9999);
const keys = Object.freeze(CampaignFieldObjectSchema.keyof().options);
const bindingShape = z.object({ scope: PlanningScopeSchema, workspaceId: id, campaignId: id }).strict();
const snapshotShape = z.object({ campaignRevision: revision, fieldsRevision: revision, planningRevision: revision,
  selection: PlanningSelectionSchema, fieldsHash: hash }).strict().refine(value => value.fieldsRevision <= value.campaignRevision);
const preferencesShape = z.object({ input: z.enum(["TEXT", "MEDIA", "VOICE_MESSAGE", "LIVE_VOICE"]),
  output: z.enum(["TEXT", "VOICE", "TEXT_AND_VOICE"]) }).strict();
const referenceShape = z.object({ id, sourceHash: hash }).strict();
const references = (maximum: number) => z.array(referenceShape).max(maximum).refine(items => new Set(items.map(item => item.id)).size === items.length);
const originalShape = OriginalTextSchema.extend({ text: z.string().min(1).max(20000)
  .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+$/).refine(value => value.trim().length > 0) }).strict();
const sourceChoiceShape = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CUSTOMER_FIELD_CHOICE"), capturedValueHash: hash }).strict(),
  z.object({ kind: z.literal("CUSTOMER_TEXT"), references: references(4).min(1)
    .refine(items => items.every((item, index) => index === 0 || items[index - 1]!.id < item.id)) }).strict(),
]);
const coveredFieldShape = z.object({ field: CampaignFieldObjectSchema.keyof(), id, valueHash: hash, confirmationHash: hash }).strict();
const confirmationShape = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("UNCONFIRMED") }).strict(),
  z.object({ kind: z.literal("REVIEWED_SET"), confirmationBatchId: id, reviewedSnapshot: snapshotShape,
    fields: z.array(coveredFieldShape).length(keys.length)
      .refine(items => items.every((item, index) => item.field === keys[index]) && new Set(items.map(item => item.id)).size === items.length) }).strict(),
]);
const stateShape = z.object({ schemaVersion: z.literal(1), id, revision, binding: bindingShape,
  snapshot: snapshotShape, fields: CampaignDraftFieldsSchema, preferences: preferencesShape,
  assistance: z.object({ kind: z.literal("MANUAL_GUIDANCE"), agent: z.literal("UNAVAILABLE") }).strict(),
  textSourceReferences: references(64), confirmation: confirmationShape, updatedAt: utc, stateHash: hash }).strict();
const sourceShape = z.object({ schemaVersion: z.literal(1), id, binding: bindingShape, capturedSnapshot: snapshotShape,
  authorUserId: id, kind: z.literal("CUSTOMER_TEXT"), originalText: originalShape, createdAt: utc, sourceHash: hash }).strict();
const readShape = z.object({ asOf: utc, binding: bindingShape,
  current: z.object({ snapshot: snapshotShape, fields: CampaignDraftFieldsSchema }).strict(), retained: stateShape.nullable(),
  coverage: z.enum(["NOT_INITIALIZED", "UNCONFIRMED", "CURRENT", "STALE"]) }).strict();
const pageShape = z.object({ asOf: utc, binding: bindingShape, agentId: id,
  sources: z.array(sourceShape).max(20), nextCursor: id.nullable() }).strict();

async function validateState(value: CampaignAgentState, expected: AgentBinding): Promise<void> {
  if (!same(value.binding, expected)) bad();
  checkedBrowserJson(value.binding, 4096); checkedBrowserJson(value.snapshot, 4096); checkedBrowserJson(value.fields, 65536);
  if (value.snapshot.fieldsHash !== await browserCanonicalHash({ domain: "infame-campaign-fields-v1", fields: value.fields })) bad();
  const { stateHash, ...content } = value;
  if (stateHash !== await browserCanonicalHash({ domain: "infame-campaign-agent-state-v1", ...content })) bad();
  if (value.confirmation.kind === "REVIEWED_SET") {
    if (!same(value.confirmation.reviewedSnapshot, value.snapshot)) bad();
    const fields = CampaignFieldsSchema.safeParse(value.fields); if (!fields.success) return bad();
    for (const item of value.confirmation.fields) if (item.valueHash !== await browserCanonicalHash({ domain: "infame-campaign-field-value-v1",
      field: item.field, value: fields.data[item.field] })) bad();
  }
}
async function validateSource(value: CustomerTextSource, expected: AgentBinding): Promise<void> {
  if (!same(value.binding, expected)) bad();
  checkedBrowserJson(value, 65536); checkedBrowserJson(value.binding, 4096); checkedBrowserJson(value.capturedSnapshot, 4096);
  const { sourceHash, ...content } = value;
  if (sourceHash !== await browserCanonicalHash({ domain: "infame-customer-text-v1", ...content })) bad();
}
export async function decodeCampaignAgentRead(data: unknown, expectedBinding: AgentBinding): Promise<CampaignAgentRead> {
  const expected = parse(bindingShape, expectedBinding, 4096), value = parse(readShape, data, 262144);
  if (!same(value.binding, expected)) bad();
  checkedBrowserJson(value.current.snapshot, 4096); checkedBrowserJson(value.current.fields, 65536);
  if (value.current.snapshot.fieldsHash !== await browserCanonicalHash({ domain: "infame-campaign-fields-v1", fields: value.current.fields })) bad();
  if (value.retained) await validateState(value.retained, expected);
  const actualCoverage = !value.retained ? "NOT_INITIALIZED" : value.retained.confirmation.kind === "UNCONFIRMED" ? "UNCONFIRMED"
    : same(value.retained.snapshot, value.current.snapshot) ? "CURRENT" : "STALE";
  if (value.coverage !== actualCoverage) bad();
  if (value.retained && (value.retained.snapshot.campaignRevision > value.current.snapshot.campaignRevision
    || value.retained.snapshot.fieldsRevision > value.current.snapshot.fieldsRevision || value.retained.snapshot.planningRevision > value.current.snapshot.planningRevision
    || value.retained.snapshot.selection.revision > value.current.snapshot.selection.revision)) bad();
  return value;
}
// First authorized HTTP read resolves workspace metadata; it is not a caller
// supplied authority. The complete decoder still verifies all shapes and hashes.
export async function decodeCampaignAgentReadForScope(data: unknown, expectedScope: AgentBinding["scope"], campaignId: string): Promise<CampaignAgentRead> {
  const scope = parse(PlanningScopeSchema, expectedScope, 4096), expectedId = parse(id, campaignId, 256), value = parse(readShape, data, 262144);
  if (!same(value.binding.scope, scope) || value.binding.campaignId !== expectedId) return bad();
  return decodeCampaignAgentRead(value, value.binding);
}
export async function decodeCampaignAgentSources(data: unknown, expectedBinding: AgentBinding, agentId: string,
  after: string | null): Promise<CampaignAgentSourcePage> {
  const expected = parse(bindingShape, expectedBinding, 4096), value = parse(pageShape, data, 262144);
  parse(id, agentId, 256); if (after !== null) parse(id, after, 256);
  if (!same(value.binding, expected) || value.agentId !== agentId
    || value.sources.some((item, index, all) => after !== null && item.id <= after || index > 0 && item.id <= all[index - 1]!.id)
    || value.nextCursor !== null && (value.sources.length === 0 || value.nextCursor !== value.sources.at(-1)!.id)) bad();
  for (const item of value.sources) await validateSource(item, expected);
  return value;
}
export async function campaignAgentReviewRows(read: CampaignAgentRead): Promise<readonly ReviewRow[]> {
  const value = await decodeCampaignAgentRead(read, read.binding);
  const rows: ReviewRow[] = [];
  for (const field of keys) {
    const present = Object.hasOwn(value.current.fields, field);
    rows.push({ field, present, valueHash: present
      ? await browserCanonicalHash({ domain: "infame-campaign-field-value-v1", field, value: value.current.fields[field] })
      : "0".repeat(64) });
  }
  // The missing-field marker is UI-only. CONFIRM_FIELDS cannot emit any row until
  // every field is present and the complete central fields schema passes.
  return rows;
}

const choicesShape = z.array(z.object({ field: CampaignFieldObjectSchema.keyof(), valueHash: hash, source: sourceChoiceShape }).strict())
  .length(keys.length).refine(items => items.every((item, index) => item.field === keys[index]));
const commandActions = [
  { action: z.literal("INITIALIZE"), expectedAgentRevision: z.literal(0), payload: z.object({ preferences: preferencesShape }).strict() },
  { action: z.literal("SET_PREFERENCES"), expectedAgentRevision: revision, payload: z.object({ preferences: preferencesShape }).strict() },
  { action: z.literal("APPEND_TEXT"), expectedAgentRevision: revision, payload: z.object({ originalText: originalShape }).strict() },
  { action: z.literal("CONFIRM_FIELDS"), expectedAgentRevision: revision, payload: z.object({ fields: choicesShape }).strict() },
  { action: z.literal("GENERATE_PROFILE"), expectedAgentRevision: revision, payload: z.object({ confirmationBatchId: id }).strict() },
] as const;
const commandBase = { operationKey: z.uuid(), campaignId: id, expectedSnapshot: snapshotShape };
const own = { ...commandBase, scope: OwnPlanningScopeSchema };
const client = { ...commandBase, scope: ClientPlanningScopeSchema, expectedAuthority: ClientAuthoritySchema.extend({ capability: z.literal("plan") }).strict() };
const commandShape = z.union([
  z.discriminatedUnion("action", [z.object({ ...own, ...commandActions[0] }).strict(), z.object({ ...own, ...commandActions[1] }).strict(),
    z.object({ ...own, ...commandActions[2] }).strict(), z.object({ ...own, ...commandActions[3] }).strict(), z.object({ ...own, ...commandActions[4] }).strict()]),
  z.discriminatedUnion("action", [z.object({ ...client, ...commandActions[0] }).strict(), z.object({ ...client, ...commandActions[1] }).strict(),
    z.object({ ...client, ...commandActions[2] }).strict(), z.object({ ...client, ...commandActions[3] }).strict(), z.object({ ...client, ...commandActions[4] }).strict()])
    .refine(value => value.scope.clientId === value.expectedAuthority.clientId),
]);
export function parseCampaignAgentBrowserCommand(data: unknown): CampaignAgentCommand { return parse(commandShape, data, 65536); }
const receiptShape = z.object({ agentId: id, campaignId: id, workspaceId: id,
  action: z.enum(["INITIALIZE", "SET_PREFERENCES", "APPEND_TEXT", "CONFIRM_FIELDS", "GENERATE_PROFILE"]),
  agentRevision: revision, campaignRevision: revision, planningRevision: revision, sourceId: id.nullable(),
  confirmationBatchId: id.nullable(), briefId: id.nullable(), briefVersion: revision.nullable(), replayed: z.boolean() }).strict()
  .refine(value => (value.sourceId !== null) === (value.action === "APPEND_TEXT"))
  .refine(value => (value.confirmationBatchId !== null) === ["CONFIRM_FIELDS", "GENERATE_PROFILE"].includes(value.action))
  .refine(value => (value.briefId !== null) === (value.action === "GENERATE_PROFILE") && (value.briefVersion !== null) === (value.briefId !== null));
export function decodeCampaignAgentReceipt(data: unknown, originalInput: CampaignAgentCommand, bindingInput: AgentBinding): CampaignAgentResult {
  const original = parseCampaignAgentBrowserCommand(originalInput), binding = parse(bindingShape, bindingInput, 4096), result = parse(receiptShape, data, 4096);
  if (!same(original.scope, binding.scope) || original.campaignId !== binding.campaignId || result.campaignId !== binding.campaignId
    || result.workspaceId !== binding.workspaceId || result.action !== original.action || result.agentRevision !== original.expectedAgentRevision + 1
    || result.campaignRevision !== original.expectedSnapshot.campaignRevision + (original.action === "GENERATE_PROFILE" ? 1 : 0)
    || result.planningRevision !== original.expectedSnapshot.planningRevision + (original.action === "GENERATE_PROFILE" ? 1 : 0)
    || original.action === "GENERATE_PROFILE" && result.confirmationBatchId !== original.payload.confirmationBatchId) bad();
  return result;
}
export function campaignAgentAcknowledges(original: CampaignAgentCommand, receipt: CampaignAgentResult, current: CampaignAgentRead): boolean {
  if (!same(original.scope, current.binding.scope) || original.campaignId !== current.binding.campaignId
    || receipt.campaignId !== current.binding.campaignId || receipt.workspaceId !== current.binding.workspaceId) return false;
  const state = current.retained; if (!state || state.id !== receipt.agentId || state.revision !== receipt.agentRevision
    || current.current.snapshot.campaignRevision !== receipt.campaignRevision || current.current.snapshot.planningRevision !== receipt.planningRevision
    || current.current.snapshot.fieldsRevision !== original.expectedSnapshot.fieldsRevision
    || current.current.snapshot.fieldsHash !== original.expectedSnapshot.fieldsHash || !same(current.current.snapshot.selection, original.expectedSnapshot.selection)
    || !same(state.snapshot, current.current.snapshot)) return false;
  switch (original.action) {
    case "INITIALIZE": return same(state.preferences, original.payload.preferences) && state.confirmation.kind === "UNCONFIRMED" && state.textSourceReferences.length === 0;
    case "SET_PREFERENCES": return same(state.preferences, original.payload.preferences);
    case "APPEND_TEXT": return state.confirmation.kind === "UNCONFIRMED" && state.textSourceReferences.some(item => item.id === receipt.sourceId);
    case "CONFIRM_FIELDS": return current.coverage === "CURRENT" && state.confirmation.kind === "REVIEWED_SET"
      && state.confirmation.confirmationBatchId === receipt.confirmationBatchId
      && state.confirmation.fields.every((item, index) => item.field === original.payload.fields[index]?.field && item.valueHash === original.payload.fields[index]?.valueHash);
    case "GENERATE_PROFILE": return state.confirmation.kind === "UNCONFIRMED" && receipt.confirmationBatchId === original.payload.confirmationBatchId;
  }
}

const memoryJournal = new Map<string, string>();
function memoryKey(actorReference: string, binding: AgentBinding): string {
  parse(id, actorReference, 256); parse(bindingShape, binding, 4096);
  return "infame-campaign-agent:memory:v1:" + [actorReference, binding.scope.kind,
    binding.scope.kind === "OWN_BRAND" ? binding.scope.brandId : binding.scope.clientId,
    binding.workspaceId, binding.campaignId].map(encodeURIComponent).join(":");
}
function parseCapture(value: unknown, actorReference: string, binding: AgentBinding): Captured {
  const packet = parse(z.object({ command: z.unknown(), body: z.string().max(65536), phase: z.enum(["UNKNOWN", "CONFIRMED", "CONFLICT"]),
    receipt: z.unknown().nullable(), reviewed: z.boolean() }).strict(), value, 262144);
  parse(id, actorReference, 256);
  const command = parseCampaignAgentBrowserCommand(packet.command);
  if (!same(command.scope, binding.scope) || command.campaignId !== binding.campaignId || packet.body !== JSON.stringify(command)
    || packet.phase === "UNKNOWN" && packet.reviewed || (packet.phase === "CONFIRMED") !== (packet.receipt !== null)) bad();
  const bodyCommand = parseCampaignAgentBrowserCommand(JSON.parse(packet.body));
  if (!same(command, bodyCommand)) bad();
  return { command, body: packet.body, phase: packet.phase, receipt: packet.receipt === null ? null : decodeCampaignAgentReceipt(packet.receipt, command, binding), reviewed: packet.reviewed };
}
export function createCampaignAgentMemoryJournal() {
  return {
    load(actorReference: string, binding: AgentBinding): Captured | null {
      const value = memoryJournal.get(memoryKey(actorReference, binding));
      return value === undefined ? null : parseCapture(JSON.parse(value), actorReference, binding);
    },
    save(actorReference: string, binding: AgentBinding, input: Captured): void {
      const key = memoryKey(actorReference, binding), value = parseCapture(input, actorReference, binding), previous = memoryJournal.get(key);
      if (previous !== undefined) {
        const old = parseCapture(JSON.parse(previous), actorReference, binding);
        if (old.body !== value.body || old.command.operationKey !== value.command.operationKey
          || old.phase !== "UNKNOWN" && old.phase !== value.phase || old.phase === "CONFIRMED" && !same(old.receipt, value.receipt)) bad();
      }
      // Store a string even in memory so future object mutation cannot change it.
      memoryJournal.set(key, JSON.stringify(value));
    },
    clear(actorReference: string, binding: AgentBinding): void { memoryJournal.delete(memoryKey(actorReference, binding)); },
  };
}

export function createCampaignAgentBrowserAdapter(options: { actorReference: string; binding: AgentBinding;
  paths: { state: string; sources: string; commands: string } }) {
  const fixed = parse(bindingShape, options.binding, 4096); parse(id, options.actorReference, 256);
  function path(value: string) {
    if (!/^\/api\/[A-Za-z0-9/_-]+$/.test(value) || value.includes("//")) bad(); return value;
  }
  const paths = { state: path(options.paths.state), sources: path(options.paths.sources), commands: path(options.paths.commands) };
  function query(binding: AgentBinding, after?: string | null) {
    if (!same(binding, fixed)) bad();
    const search = new URLSearchParams(binding.scope.kind === "OWN_BRAND" ? { scope: binding.scope.kind, brandId: binding.scope.brandId }
      : { scope: binding.scope.kind, clientId: binding.scope.clientId });
    search.set("campaignId", binding.campaignId); if (after !== undefined && after !== null) { parse(id, after, 256); search.set("after", after); }
    return search;
  }
  const request = (url: string, signal: AbortSignal, body?: string) => fetch(url, { method: body === undefined ? "GET" : "POST",
    credentials: "same-origin", redirect: "error", cache: "no-store", signal,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body }) });
  return {
    getState: (binding: AgentBinding, signal: AbortSignal) => request(paths.state + "?" + query(binding), signal),
    getSources: (binding: AgentBinding, after: string | null, signal: AbortSignal) => request(paths.sources + "?" + query(binding, after), signal),
    sendCommand: (originalBody: string, signal: AbortSignal) => {
      const original = parseCampaignAgentBrowserCommand(JSON.parse(originalBody));
      if (!same(original.scope, fixed.scope) || original.campaignId !== fixed.campaignId || JSON.stringify(original) !== originalBody) bad();
      return request(paths.commands, signal, originalBody);
    },
    decodeRead: decodeCampaignAgentRead,
    decodeSources: decodeCampaignAgentSources,
    decodeReceipt: (data: unknown, original: CampaignAgentCommand) => decodeCampaignAgentReceipt(data, original, fixed),
    parseCommand: parseCampaignAgentBrowserCommand,
    reviewRows: campaignAgentReviewRows,
    acknowledges: campaignAgentAcknowledges,
    journal: createCampaignAgentMemoryJournal(),
  };
}
