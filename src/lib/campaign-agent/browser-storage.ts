import type { AgentBinding } from "./contracts";
import type { CampaignAgentRecoveryTarget, CampaignAgentBarrierCommand, CampaignAgentBarrierResult, CampaignAgentRecoveryKey } from "./recovery-contracts";
import type { CampaignAgentResult } from "./native-contracts";
import { sealCampaignAgentPacket, openCampaignAgentPacket, type CampaignAgentRecoveryPacket, type CampaignAgentEncryptedEnvelope } from "./browser-recovery";
import { z } from "zod";
import { browserCanonicalHash, browserCanonicalJson, checkedBrowserJson, parseCampaignAgentBrowserCommand,
  decodeCampaignAgentReceipt, CampaignAgentBrowserError } from "./browser";
import { PlanningScopeSchema } from "@/lib/brand-context/contracts";
import { PlanningSelectionSchema } from "@/lib/campaign-planning/contracts";
import { CampaignFieldObjectSchema } from "@/lib/campaigns/contracts";
import { ClientAuthoritySchema, OrganizationIdSchema as id, OrganizationRevisionSchema as revision } from "@/lib/organizations/contracts";
import { UtcDateTimeSchema } from "@/lib/contracts/vocabulary";

export type CampaignAgentRecoveryStub = { schemaVersion: 1; actorReference: string; binding: AgentBinding;
  kind: "COMMAND" | "RECOVERY_BARRIER"; operationKey: string; commandHash: string; bodyHash: string;
  phase: "UNKNOWN" | "CONFIRMED" | "CONFLICT"; receipt: CampaignAgentResult | CampaignAgentBarrierResult | null;
  metadata: CampaignAgentRecoveryTarget | CampaignAgentBarrierCommand; originalBody?: string };
export type CampaignAgentJournalOptions = { actorReference: string; binding: AgentBinding; storage: Storage;
  fetchKey: (signal: AbortSignal) => Promise<Response>; onDeny: (status: number) => void };
export type CampaignAgentJournalRead = { packet: CampaignAgentRecoveryPacket | null; stub: CampaignAgentRecoveryStub | null };
const fail = (): never => { throw new CampaignAgentBrowserError("RECOVERY_STORAGE_UNAVAILABLE"); };
const same = (left: unknown, right: unknown) => browserCanonicalJson(left) === browserCanonicalJson(right);
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
function parse<T>(schema: z.ZodType<T>, value: unknown, maximum: number): T {
  checkedBrowserJson(value, maximum); const result = schema.safeParse(value); return result.success ? result.data : fail();
}
function json(value: string, maximum: number): unknown {
  if (bytes(value) > maximum) return fail();
  try { const result: unknown = JSON.parse(value); checkedBrowserJson(result, maximum); return result; } catch { return fail(); }
}
function clone<T>(value: T): T { checkedBrowserJson(value, 196608); return JSON.parse(JSON.stringify(value)) as T; }
async function bodyHash(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) return fail();
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
}
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const bindingShape = z.object({ scope: PlanningScopeSchema, workspaceId: id, campaignId: id }).strict();
const preferences = z.object({ input: z.enum(["TEXT", "MEDIA", "VOICE_MESSAGE", "LIVE_VOICE"]), output: z.enum(["TEXT", "VOICE", "TEXT_AND_VOICE"]) }).strict();
const snapshot = z.object({ campaignRevision: revision, fieldsRevision: revision, planningRevision: revision,
  selection: PlanningSelectionSchema, fieldsHash: hash }).strict().refine(value => value.fieldsRevision <= value.campaignRevision);
const authority = ClientAuthoritySchema.extend({ capability: z.literal("plan") }).strict();
const sourceChoice = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CUSTOMER_FIELD_CHOICE"), capturedValueHash: hash }).strict(),
  z.object({ kind: z.literal("CUSTOMER_TEXT"), references: z.array(z.object({ id, sourceHash: hash }).strict()).min(1).max(4)
    .refine(items => items.every((item, index) => index === 0 || items[index - 1]!.id < item.id)) }).strict(),
]);
const fieldKeys = CampaignFieldObjectSchema.keyof().options;
const review = z.array(z.object({ field: CampaignFieldObjectSchema.keyof(), valueHash: hash, source: sourceChoice }).strict())
  .length(fieldKeys.length).refine(items => items.every((item, index) => item.field === fieldKeys[index]));
const metadataBase = { operationKey: z.uuid(), commandHash: hash, expectedSnapshot: snapshot, expectedAuthority: authority.optional() };
const targetShape = z.discriminatedUnion("action", [
  z.object({ ...metadataBase, action: z.literal("INITIALIZE"), expectedAgentRevision: z.literal(0), payload: z.object({ preferences }).strict() }).strict(),
  z.object({ ...metadataBase, action: z.literal("SET_PREFERENCES"), expectedAgentRevision: revision, payload: z.object({ preferences }).strict() }).strict(),
  z.object({ ...metadataBase, action: z.literal("APPEND_TEXT"), expectedAgentRevision: revision, payload: z.object({ originalTextHash: hash }).strict() }).strict(),
  z.object({ ...metadataBase, action: z.literal("CONFIRM_FIELDS"), expectedAgentRevision: revision, payload: z.object({ fields: review }).strict() }).strict(),
  z.object({ ...metadataBase, action: z.literal("GENERATE_PROFILE"), expectedAgentRevision: revision, payload: z.object({ confirmationBatchId: id }).strict() }).strict(),
]);
const authorityMatches = (binding: AgentBinding, value: z.infer<typeof authority> | undefined) => binding.scope.kind === "OWN_BRAND"
  ? value === undefined : value !== undefined && value.clientId === binding.scope.clientId;
const barrierShape = z.object({ operationKey: z.uuid(), scope: PlanningScopeSchema, campaignId: id,
  expectedAgentRevision: z.number().int().min(0).max(2147483646), expectedSnapshot: snapshot, expectedAuthority: authority.optional(),
  target: targetShape, initialPreferences: preferences.nullable() }).strict().refine(value => value.operationKey.toLowerCase() !== value.target.operationKey.toLowerCase());
const ordinaryReceipt = z.object({ agentId: id, campaignId: id, workspaceId: id,
  action: z.enum(["INITIALIZE", "SET_PREFERENCES", "APPEND_TEXT", "CONFIRM_FIELDS", "GENERATE_PROFILE"]), agentRevision: revision,
  campaignRevision: revision, planningRevision: revision, sourceId: id.nullable(), confirmationBatchId: id.nullable(),
  briefId: id.nullable(), briefVersion: revision.nullable(), replayed: z.boolean() }).strict().refine(value =>
  (value.sourceId !== null) === (value.action === "APPEND_TEXT")
  && (value.confirmationBatchId !== null) === ["CONFIRM_FIELDS", "GENERATE_PROFILE"].includes(value.action)
  && (value.briefId !== null) === (value.action === "GENERATE_PROFILE") && (value.briefVersion !== null) === (value.briefId !== null));
const barrierReceipt = z.object({ action: z.literal("RECOVERY_BARRIER"), agentId: id, campaignId: id, workspaceId: id,
  agentRevision: revision, campaignRevision: revision, planningRevision: revision, targetOperationKey: z.uuid(), targetCommandHash: hash,
  targetOutcome: z.enum(["COMMITTED", "FENCED"]), originalReceipt: ordinaryReceipt.nullable(), replayed: z.boolean() }).strict()
  .refine(value => (value.targetOutcome === "COMMITTED") === (value.originalReceipt !== null));
const packetShape = z.object({ kind: z.enum(["COMMAND", "RECOVERY_BARRIER"]), body: z.string().min(1).max(65536),
  phase: z.enum(["UNKNOWN", "CONFIRMED", "CONFLICT"]), receipt: z.unknown().nullable(), reviewed: z.boolean() }).strict();
const stubShape = z.object({ schemaVersion: z.literal(1), actorReference: id, binding: bindingShape,
  kind: z.enum(["COMMAND", "RECOVERY_BARRIER"]), operationKey: z.uuid(), commandHash: hash, bodyHash: hash,
  phase: z.enum(["UNKNOWN", "CONFIRMED", "CONFLICT"]), receipt: z.unknown().nullable(), metadata: z.unknown(), originalBody: z.string().max(65536).optional() }).strict();
const materialShape = z.object({ schemaVersion: z.literal(1), asOf: UtcDateTimeSchema, binding: bindingShape, actorReference: id,
  algorithm: z.literal("AES-GCM"), keyId: hash, keyBase64Url: z.string().length(43).regex(/^[A-Za-z0-9_-]+$/) }).strict();
type Target = z.infer<typeof targetShape>;
type Barrier = z.infer<typeof barrierShape>;
function barrier(value: unknown, binding: AgentBinding): Barrier {
  const result = parse(barrierShape, value, 65536); checkedBrowserJson(result.target, 32768);
  if (!same(result.scope, binding.scope) || result.campaignId !== binding.campaignId
    || !authorityMatches(binding, result.expectedAuthority) || !authorityMatches(binding, result.target.expectedAuthority)) return fail();
  return result;
}
function validateOrdinaryReceipt(value: unknown, target: Target, binding: AgentBinding): CampaignAgentResult {
  const result = parse(ordinaryReceipt, value, 4096), generated = target.action === "GENERATE_PROFILE";
  if (result.campaignId !== binding.campaignId || result.workspaceId !== binding.workspaceId || result.action !== target.action
    || result.agentRevision !== target.expectedAgentRevision + 1 || result.campaignRevision !== target.expectedSnapshot.campaignRevision + (generated ? 1 : 0)
    || result.planningRevision !== target.expectedSnapshot.planningRevision + (generated ? 1 : 0)
    || target.action === "GENERATE_PROFILE" && result.confirmationBatchId !== target.payload.confirmationBatchId) return fail();
  return result;
}
function validateBarrierReceipt(value: unknown, command: Barrier, binding: AgentBinding): CampaignAgentBarrierResult {
  const result = parse(barrierReceipt, value, 4096);
  if (result.campaignId !== binding.campaignId || result.workspaceId !== binding.workspaceId || result.agentRevision !== command.expectedAgentRevision + 1
    || result.campaignRevision !== command.expectedSnapshot.campaignRevision || result.planningRevision !== command.expectedSnapshot.planningRevision
    || result.targetOperationKey !== command.target.operationKey || result.targetCommandHash !== command.target.commandHash) return fail();
  if (result.originalReceipt) {
    const original = validateOrdinaryReceipt(result.originalReceipt, command.target, binding);
    if (original.agentId !== result.agentId || original.agentRevision >= result.agentRevision) return fail();
  }
  return result;
}
function capturePacket(value: unknown, binding: AgentBinding): CampaignAgentRecoveryPacket {
  const result = parse(packetShape, value, 196608), body = json(result.body, 65536);
  if (result.phase === "UNKNOWN" && result.reviewed || (result.phase === "CONFIRMED") !== (result.receipt !== null)) return fail();
  let receipt: CampaignAgentResult | CampaignAgentBarrierResult | null = null;
  if (result.kind === "COMMAND") {
    const command = parseCampaignAgentBrowserCommand(body);
    if (!same(body, command) || !same(command.scope, binding.scope) || command.campaignId !== binding.campaignId) return fail();
    if (result.receipt !== null) receipt = decodeCampaignAgentReceipt(result.receipt, command, binding);
  } else {
    const command = barrier(body, binding); if (!same(body, command)) return fail();
    if (result.receipt !== null) receipt = validateBarrierReceipt(result.receipt, command, binding);
  }
  return { ...result, receipt };
}
async function makeStub(packet: CampaignAgentRecoveryPacket, actorReference: string, binding: AgentBinding): Promise<CampaignAgentRecoveryStub> {
  const body = json(packet.body, 65536), exactBodyHash = await bodyHash(packet.body);
  let metadata: CampaignAgentRecoveryTarget | CampaignAgentBarrierCommand; let commandHash: string; let operationKey: string;
  if (packet.kind === "COMMAND") {
    const command = parseCampaignAgentBrowserCommand(body);
    commandHash = await browserCanonicalHash({ domain: "infame-campaign-agent-command-v1", actorUserId: actorReference, command });
    const { scope: discardedScope, campaignId: discardedCampaign, payload, ...technical } = command;
    void discardedScope; void discardedCampaign;
    metadata = { ...technical, commandHash, payload: command.action === "APPEND_TEXT"
      ? { originalTextHash: await browserCanonicalHash({ domain: "infame-agent-recovery-text-v1", originalText: command.payload.originalText }) } : payload } as CampaignAgentRecoveryTarget;
    operationKey = command.operationKey;
  } else {
    metadata = barrier(body, binding) as CampaignAgentBarrierCommand; operationKey = metadata.operationKey;
    commandHash = await browserCanonicalHash({ domain: "infame-campaign-agent-recovery-barrier-v1", actorUserId: actorReference, command: metadata });
  }
  return { schemaVersion: 1, actorReference, binding, kind: packet.kind, operationKey, commandHash, bodyHash: exactBodyHash,
    phase: packet.phase, receipt: packet.receipt, metadata, ...(packet.kind === "RECOVERY_BARRIER" ? { originalBody: packet.body } : {}) };
}
async function readStub(value: unknown, actorReference: string, binding: AgentBinding): Promise<CampaignAgentRecoveryStub> {
  const result = parse(stubShape, value, 131072);
  if (result.actorReference !== actorReference || !same(result.binding, binding) || (result.phase === "CONFIRMED") !== (result.receipt !== null)) return fail();
  if (result.kind === "RECOVERY_BARRIER") {
    if (result.originalBody === undefined) return fail();
    const metadata = barrier(result.metadata, binding), original = barrier(json(result.originalBody, 65536), binding);
    if (!same(metadata, original) || result.operationKey !== metadata.operationKey || result.bodyHash !== await bodyHash(result.originalBody)
      || result.commandHash !== await browserCanonicalHash({ domain: "infame-campaign-agent-recovery-barrier-v1", actorUserId: actorReference, command: metadata })) return fail();
    return { ...result, metadata: metadata as CampaignAgentBarrierCommand,
      receipt: result.receipt === null ? null : validateBarrierReceipt(result.receipt, metadata, binding) };
  }
  if (result.originalBody !== undefined) return fail();
  const metadata = parse(targetShape, result.metadata, 32768);
  if (!authorityMatches(binding, metadata.expectedAuthority) || result.operationKey !== metadata.operationKey || result.commandHash !== metadata.commandHash) return fail();
  if (metadata.action !== "APPEND_TEXT") {
    const { commandHash: discardedHash, ...technical } = metadata; void discardedHash;
    const command = parseCampaignAgentBrowserCommand({ ...technical, scope: binding.scope, campaignId: binding.campaignId });
    if (result.commandHash !== await browserCanonicalHash({ domain: "infame-campaign-agent-command-v1", actorUserId: actorReference, command })) return fail();
  }
  return { ...result, metadata: metadata as CampaignAgentRecoveryTarget,
    receipt: result.receipt === null ? null : validateOrdinaryReceipt(result.receipt, metadata, binding) };
}
// The HTTP adapter and Storage use one browser-safe recovery codec. These
// wrappers capture caller input before WebCrypto waits and expose no key cache.
export function parseCampaignAgentRecoveryBarrier(value: unknown, binding: AgentBinding): CampaignAgentBarrierCommand {
  return barrier(value, parse(bindingShape, binding, 4096)) as CampaignAgentBarrierCommand;
}
export function decodeCampaignAgentBarrierReceipt(value: unknown, command: CampaignAgentBarrierCommand, binding: AgentBinding): CampaignAgentBarrierResult {
  const bound = parse(bindingShape, binding, 4096);
  return validateBarrierReceipt(value, barrier(command, bound), bound);
}
export function parseCampaignAgentRecoveryPacket(value: unknown, binding: AgentBinding): CampaignAgentRecoveryPacket {
  return capturePacket(value, parse(bindingShape, binding, 4096));
}
export function createCampaignAgentRecoveryStub(value: CampaignAgentRecoveryPacket, actorReference: string, binding: AgentBinding): Promise<CampaignAgentRecoveryStub> {
  const actor = parse(id, actorReference, 256), bound = parse(bindingShape, binding, 4096), captured = capturePacket(value, bound);
  return makeStub(captured, actor, bound);
}
export function decodeCampaignAgentRecoveryStub(value: unknown, actorReference: string, binding: AgentBinding): Promise<CampaignAgentRecoveryStub> {
  const actor = parse(id, actorReference, 256), bound = parse(bindingShape, binding, 4096), captured = clone(value);
  return readStub(captured, actor, bound);
}
export function parseCampaignAgentRecoveryTarget(value: unknown, binding: AgentBinding): CampaignAgentRecoveryTarget {
  const bound = parse(bindingShape, binding, 4096), target = parse(targetShape, value, 32768);
  if (!authorityMatches(bound, target.expectedAuthority)) return fail();
  return target as CampaignAgentRecoveryTarget;
}
export function decodeCampaignAgentRecoveryOriginalReceipt(value: unknown, target: CampaignAgentRecoveryTarget, binding: AgentBinding): CampaignAgentResult {
  const bound = parse(bindingShape, binding, 4096);
  return validateOrdinaryReceipt(value, parseCampaignAgentRecoveryTarget(target, bound), bound);
}
// Bootstrap uses only current-authorized bound metadata and immediately drops
// the response key. The journal refetches and cryptographically validates its
// own key for every save/restore; this helper never caches or returns the key.
export function campaignAgentRecoveryKeyBinding(value: unknown, actorReference: string, scope: AgentBinding["scope"], campaignId: string): AgentBinding {
  const material = parse(materialShape, value, 8192), actor = parse(id, actorReference, 256);
  const expectedScope = parse(PlanningScopeSchema, scope, 4096), expectedId = parse(id, campaignId, 256);
  if (material.actorReference !== actor || !same(material.binding.scope, expectedScope) || material.binding.campaignId !== expectedId) return fail();
  return material.binding;
}
// Plaintext/key never enter Storage. Serialization and epoch checks prevent an
// awaited old operation from restoring data after clear or account denial.
export function createCampaignAgentEncryptedJournal(options: CampaignAgentJournalOptions) {
  const actorReference = parse(id, options.actorReference, 256), binding = parse(bindingShape, options.binding, 4096);
  const storage = options.storage, fetchKey = options.fetchKey, onDeny = options.onDeny;
  const prefix = "infame:agent-recovery:v1:" + [actorReference, binding.scope.kind,
    binding.scope.kind === "OWN_BRAND" ? binding.scope.brandId : binding.scope.clientId, binding.workspaceId, binding.campaignId].map(encodeURIComponent).join(":");
  const stubKey = prefix + ":stub", cipherKey = prefix + ":cipher";
  let epoch = 0, memoryPacket: CampaignAgentRecoveryPacket | null = null, memoryStub: CampaignAgentRecoveryStub | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  function check(signal: AbortSignal, generation: number) { if (signal.aborted || epoch !== generation) return fail(); }
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation); queue = result.catch(() => undefined); return result;
  }
  function getItem(key: string): string | null { try { return storage.getItem(key); } catch { return fail(); } }
  function clear(keepUnknownBarrier: boolean) {
    epoch++; memoryPacket = null;
    let failed = false;
    if (keepUnknownBarrier && memoryStub) {
      try { storage.setItem(stubKey, JSON.stringify(memoryStub)); } catch { failed = true; }
    }
    try { storage.removeItem(cipherKey); } catch { failed = true; }
    if (!keepUnknownBarrier) {
      try { storage.removeItem(stubKey); } catch { failed = true; }
      if (!failed) memoryStub = null;
    }
    if (failed) return fail();
  }
  async function existing(generation: number, signal: AbortSignal): Promise<CampaignAgentRecoveryStub | null> {
    check(signal, generation); const raw = getItem(stubKey);
    const stored = raw === null ? null : await readStub(json(raw, 131072), actorReference, binding);
    check(signal, generation);
    if (memoryStub && memoryStub.phase !== "UNKNOWN" && stored && memoryStub.kind === stored.kind && memoryStub.operationKey === stored.operationKey
      && memoryStub.commandHash === stored.commandHash && memoryStub.bodyHash === stored.bodyHash) {
      if (stored.phase !== "UNKNOWN" && (stored.phase !== memoryStub.phase || !same(stored.receipt, memoryStub.receipt))) return fail();
      return clone(memoryStub);
    }
    return stored ?? (memoryStub ? clone(memoryStub) : null);
  }
  async function authorizedKey(generation: number, signal: AbortSignal): Promise<CampaignAgentRecoveryKey> {
    check(signal, generation); const response = await fetchKey(signal); check(signal, generation);
    if ([401, 403, 404].includes(response.status)) {
      try { onDeny(response.status); } finally { clear(true); }
      return fail();
    }
    const requestId = response.headers.get("x-request-id");
    if (response.status !== 200 || response.headers.get("cache-control") !== "private, no-store" || !requestId || !z.uuid().safeParse(requestId).success) return fail();
    const reader = response.body?.getReader(); if (!reader) return fail();
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      for (;;) {
        const part = await reader.read(); check(signal, generation); if (part.done) break;
        length += part.value.byteLength; if (length > 8192) { await reader.cancel(); return fail(); } chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const joined = new Uint8Array(length); let at = 0; for (const chunk of chunks) { joined.set(chunk, at); at += chunk.length; }
    let text: string; try { text = new TextDecoder("utf-8", { fatal: true }).decode(joined); } catch { return fail(); }
    const envelope = parse(z.object({ data: materialShape, requestId: z.uuid() }).strict(), json(text, 8192), 8192);
    if (envelope.requestId !== requestId || envelope.data.actorReference !== actorReference || !same(envelope.data.binding, binding)) return fail();
    check(signal, generation); return envelope.data;
  }
  function transition(old: CampaignAgentRecoveryStub | null, next: CampaignAgentRecoveryStub) {
    if (!old) return;
    if (old.kind === "COMMAND" && next.kind === "RECOVERY_BARRIER" && old.phase !== "CONFIRMED") {
      const target = (next.metadata as CampaignAgentBarrierCommand).target;
      if (next.operationKey.toLowerCase() === old.operationKey.toLowerCase() || !same(target, old.metadata)) return fail(); return;
    }
    if (old.kind === "RECOVERY_BARRIER" && next.kind === "RECOVERY_BARRIER" && old.operationKey !== next.operationKey && old.phase !== "CONFIRMED") {
      if (old.operationKey.toLowerCase() === next.operationKey.toLowerCase()) return fail();
      const before = old.metadata as CampaignAgentBarrierCommand, after = next.metadata as CampaignAgentBarrierCommand;
      const beforeEpochs = [before.expectedAgentRevision, before.expectedSnapshot.campaignRevision, before.expectedSnapshot.fieldsRevision,
        before.expectedSnapshot.planningRevision, before.expectedSnapshot.selection.revision];
      const afterEpochs = [after.expectedAgentRevision, after.expectedSnapshot.campaignRevision, after.expectedSnapshot.fieldsRevision,
        after.expectedSnapshot.planningRevision, after.expectedSnapshot.selection.revision];
      if (!same(before.target, after.target) || afterEpochs.some((value, index) => value < beforeEpochs[index]!)
        || !afterEpochs.some((value, index) => value > beforeEpochs[index]!)) return fail(); return;
    }
    if (old.kind !== next.kind || old.operationKey !== next.operationKey || old.commandHash !== next.commandHash
      || old.bodyHash !== next.bodyHash || !same(old.metadata, next.metadata)
      || old.phase !== "UNKNOWN" && old.phase !== next.phase || old.phase === "CONFIRMED" && !same(old.receipt, next.receipt)) return fail();
  }
  return {
    load(signal: AbortSignal): Promise<CampaignAgentJournalRead> {
      const generation = epoch;
      return serial(async () => {
        const capturedStub = getItem(stubKey);
        const stub = await existing(generation, signal), cipher = getItem(cipherKey);
        if (!stub) { if (cipher !== null) return fail(); return { packet: null, stub: null }; }
        const material = await authorizedKey(generation, signal); check(signal, generation);
        let packet: CampaignAgentRecoveryPacket | null = null;
        if (cipher !== null) {
          try {
            const envelope = json(cipher, 270336) as CampaignAgentEncryptedEnvelope;
            const opened = await openCampaignAgentPacket(material, actorReference, binding, envelope);
            const derived = await makeStub(opened, actorReference, binding); check(signal, generation);
            if (same(derived, stub)) packet = opened;
          } catch { check(signal, generation); }
        }
        if (!packet && stub.phase === "CONFIRMED" && memoryPacket && memoryStub && same(memoryStub, stub)) packet = clone(memoryPacket);
        if (getItem(stubKey) !== capturedStub || getItem(cipherKey) !== cipher) return fail();
        check(signal, generation); memoryStub = clone(stub); if (packet) memoryPacket = clone(packet);
        return { packet: packet ? clone(packet) : null, stub: clone(stub) };
      });
    },
    async save(input: CampaignAgentRecoveryPacket, signal: AbortSignal): Promise<void> {
      // Capture synchronously before queue, key fetch or WebCrypto waits.
      const packet = capturePacket(input, binding), generation = epoch;
      return serial(async () => {
        check(signal, generation); const priorRaw = getItem(stubKey), prior = await existing(generation, signal), next = await makeStub(packet, actorReference, binding);
        check(signal, generation); transition(prior, next);
        if (getItem(stubKey) !== priorRaw) return fail();
        // Keep validated known history in memory even when storage fails. The
        // trusted caller must still reconcile current native reads before reuse.
        memoryPacket = clone(packet); memoryStub = clone(next);
        try { storage.setItem(stubKey, JSON.stringify(next)); } catch { return fail(); }
        const material = await authorizedKey(generation, signal), envelope = await sealCampaignAgentPacket(material, actorReference, binding, packet);
        check(signal, generation);
        if (getItem(stubKey) !== JSON.stringify(next)) return fail();
        try { storage.setItem(cipherKey, JSON.stringify(envelope)); } catch { return fail(); }
        check(signal, generation);
      });
    },
    clear,
  };
}
