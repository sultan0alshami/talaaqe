import { z } from "zod";
import type { AgentBinding } from "./contracts";
import type { CampaignAgentBrowserAdapter } from "@/components/infame/campaign-agent-interview";
import type { CampaignAgentRecoveryStub } from "./browser-storage";
import type { CampaignAgentRecoveryPacket } from "./browser-recovery";
import { PlanningScopeSchema } from "@/lib/brand-context/contracts";
import { ClientAuthoritySchema, OrganizationIdSchema as id } from "@/lib/organizations/contracts";
import { browserCanonicalJson, checkedBrowserJson, parseCampaignAgentBrowserCommand, decodeCampaignAgentRead,
  decodeCampaignAgentSources, decodeCampaignAgentReceipt, campaignAgentReviewRows, campaignAgentAcknowledges,
  CampaignAgentBrowserError } from "./browser";
import { createCampaignAgentEncryptedJournal, parseCampaignAgentRecoveryBarrier, decodeCampaignAgentBarrierReceipt,
  parseCampaignAgentRecoveryPacket, createCampaignAgentRecoveryStub, decodeCampaignAgentRecoveryStub,
  parseCampaignAgentRecoveryTarget, decodeCampaignAgentRecoveryOriginalReceipt } from "./browser-storage";

export type CampaignAgentRecoveryAdapterOptions = { actorReference: string; binding: AgentBinding;
  storage: Storage; onDeny: (status: number) => void };

const fail = (code = "INVALID_RESPONSE"): never => { throw new CampaignAgentBrowserError(code); };
const same = (a: unknown, b: unknown) => browserCanonicalJson(a) === browserCanonicalJson(b);
const bindingSchema = z.object({ scope: PlanningScopeSchema, workspaceId: id, campaignId: id }).strict();
const planSchema = ClientAuthoritySchema.extend({ capability: z.literal("plan") }).strict();
const deniedStatuses = new Set([401, 403, 404]);
const requestId = z.uuid();
type Captured = ReturnType<CampaignAgentBrowserAdapter["captureFromPacket"]>;
function parse<T>(schema: z.ZodType<T>, value: unknown, maximum = 65536): T {
  checkedBrowserJson(value, maximum); const result = schema.safeParse(value); return result.success ? result.data : fail();
}
function json(body: string): unknown {
  if (new TextEncoder().encode(body).byteLength > 65536) return fail();
  try { const value: unknown = JSON.parse(body); checkedBrowserJson(value, 65536); return value; } catch { return fail(); }
}
function aborted(signal: AbortSignal) { if (signal.aborted) throw new DOMException("Request aborted", "AbortError"); }

// Returns the complete standard envelope. Denial callers clear synchronously
// before invoking it. No denial body is consumed, including malformed bodies.
export async function readCampaignAgentResponse(response: Response, signal: AbortSignal, maximum = 262144): Promise<unknown> {
  aborted(signal);
  if (deniedStatuses.has(response.status)) return fail(response.status === 401 ? "UNAUTHENTICATED" : "DENIED");
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 2097152) return fail();
  const headerId = response.headers.get("x-request-id"), cache = response.headers.get("cache-control")?.toLowerCase()
    .split(",").map(value => value.trim()) ?? [];
  if (!headerId || !requestId.safeParse(headerId).success || !cache.includes("private") || !cache.includes("no-store")
    || cache.includes("public") || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get("content-type") ?? "")) return fail();
  const wireMaximum = response.ok ? maximum + 1024 : 8192, reader = response.body?.getReader();
  if (!reader) return fail();
  const chunks: Uint8Array[] = []; let length = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      aborted(signal); const item = await reader.read(); aborted(signal);
      if (item.done) break;
      length += item.value.byteLength;
      if (length > wireMaximum) { await reader.cancel(); return fail(); }
      chunks.push(item.value);
    }
    const joined = new Uint8Array(length); let position = 0;
    for (const chunk of chunks) { joined.set(chunk, position); position += chunk.byteLength; }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined)); } catch { return fail(); }
    checkedBrowserJson(value, wireMaximum);
    if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
    const record = value as Record<string, unknown>;
    if (record.requestId !== headerId) return fail();
    if (response.ok) {
      if (Object.keys(record).sort().join(",") !== "data,requestId") return fail();
      checkedBrowserJson(record.data, maximum);
    } else {
      if (Object.keys(record).sort().join(",") !== "error,requestId" || !record.error || typeof record.error !== "object" || Array.isArray(record.error)) return fail();
      const error = record.error as Record<string, unknown>;
      if (Object.keys(error).sort().join(",") !== "code,message,requestId,retryable" || typeof error.code !== "string"
        || !/^[A-Z][A-Z0-9_]{0,79}$/.test(error.code) || error.message !== error.code || error.requestId !== headerId
        || error.retryable !== (response.status === 503 || response.status === 429)) return fail();
    }
    aborted(signal); return value;
  } catch (error) {
    if (signal.aborted) throw new DOMException("Request aborted", "AbortError");
    if (error instanceof CampaignAgentBrowserError) throw error;
    return fail();
  } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}

export function createCampaignAgentRecoveryBrowserAdapter(options: CampaignAgentRecoveryAdapterOptions): CampaignAgentBrowserAdapter {
  const captured = parse(bindingSchema, options.binding, 4096), fixed: AgentBinding = Object.freeze({ ...captured, scope: Object.freeze(captured.scope) });
  const actorReference = parse(id, options.actorReference, 256);
  const onDeny = options.onDeny, storage = options.storage;
  let denied = false;
  function notifyDenial(status: number) {
    if (denied) return;
    denied = true; onDeny(status); // Trusted parent invokes every synchronous private invalidator.
  }
  async function request(url: string, signal: AbortSignal, body?: string): Promise<Response> {
    aborted(signal); if (denied) return fail("DENIED");
    const response = await fetch(url, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
      redirect: "error", signal, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body }) });
    aborted(signal); if (deniedStatuses.has(response.status)) notifyDenial(response.status);
    return response;
  }
  function bound(value: AgentBinding) { const parsed = parse(bindingSchema, value, 4096); if (!same(parsed, fixed)) return fail(); return parsed; }
  function query(value: AgentBinding, after?: string | null) {
    const actual = bound(value), search = new URLSearchParams(actual.scope.kind === "OWN_BRAND"
      ? { scope: actual.scope.kind, brandId: actual.scope.brandId } : { scope: actual.scope.kind, clientId: actual.scope.clientId });
    search.set("campaignId", actual.campaignId);
    if (after !== undefined && after !== null) search.set("after", parse(id, after, 256));
    return search;
  }
  function command(body: string) {
    const raw = json(body), parsed = parseCampaignAgentBrowserCommand(raw);
    if (!same(raw, parsed) || parsed.campaignId !== fixed.campaignId || !same(parsed.scope, fixed.scope)) return fail(); return parsed;
  }
  function barrier(body: string) { const raw = json(body), parsed = parseCampaignAgentRecoveryBarrier(raw, fixed); if (!same(raw, parsed)) return fail(); return parsed; }
  const journal = createCampaignAgentEncryptedJournal({ actorReference, binding: fixed, storage,
    fetchKey: async signal => {
      const response = await request("/api/campaign-agent/recovery-key?" + query(fixed), signal);
      if (deniedStatuses.has(response.status)) return response; // Storage also denies before any body.
      const envelope = await readCampaignAgentResponse(response, signal, 8192);
      return new Response(JSON.stringify(envelope), { status: response.status, statusText: response.statusText, headers: response.headers });
    }, onDeny: notifyDenial });
  function captureFromPacket(value: CampaignAgentRecoveryPacket): Captured {
    const packet = parseCampaignAgentRecoveryPacket(value, fixed);
    if (packet.kind === "COMMAND") return { ...packet, kind: "COMMAND", command: command(packet.body),
      receipt: packet.receipt === null ? null : decodeCampaignAgentReceipt(packet.receipt, command(packet.body), fixed) };
    const original = barrier(packet.body);
    return { ...packet, kind: "RECOVERY_BARRIER", command: original,
      receipt: packet.receipt === null ? null : decodeCampaignAgentBarrierReceipt(packet.receipt, original, fixed) };
  }
  const stub = (value: CampaignAgentRecoveryStub) => decodeCampaignAgentRecoveryStub(value, actorReference, fixed);
  function targetForStub(value: CampaignAgentRecoveryStub) {
    if (value.actorReference !== actorReference || !same(value.binding, fixed) || value.kind !== "COMMAND" || value.originalBody !== undefined) return fail();
    const target = parseCampaignAgentRecoveryTarget(value.metadata, fixed);
    if (target.operationKey !== value.operationKey || target.commandHash !== value.commandHash) return fail(); return target;
  }
  function originalTarget(value: CampaignAgentRecoveryStub) {
    if (value.kind === "COMMAND") return targetForStub(value);
    if (value.actorReference !== actorReference || !same(value.binding, fixed) || value.kind !== "RECOVERY_BARRIER") return fail();
    const original = parseCampaignAgentRecoveryBarrier(value.metadata, fixed);
    if (original.operationKey !== value.operationKey || !value.originalBody || !same(original, barrier(value.originalBody))) return fail();
    return original.target;
  }
  return {
    getState: (value, signal) => request("/api/campaign-agent?" + query(value), signal),
    getSources: (value, after, signal) => request("/api/campaign-agent/sources?" + query(value, after), signal),
    sendCommand: (body, signal) => { command(body); return request("/api/campaign-agent/commands", signal, body); },
    sendBarrier: (body, signal) => { barrier(body); return request("/api/campaign-agent/recovery-barrier", signal, body); },
    getPlan: (value, signal) => { const actual = bound(value); return actual.scope.kind === "OWN_BRAND" ? Promise.resolve(null)
      : request("/api/organization-clients/" + encodeURIComponent(actual.scope.clientId) + "/authority?capability=plan", signal); },
    getOutcome: async (value, signal) => {
      const actual = await stub(value); aborted(signal);
      const target = actual.kind === "COMMAND" ? targetForStub(actual) : { kind: "RECOVERY_BARRIER", command: parseCampaignAgentRecoveryBarrier(actual.metadata, fixed), commandHash: actual.commandHash };
      const body = { scope: fixed.scope, campaignId: fixed.campaignId, target }; checkedBrowserJson(body, 65536);
      return request("/api/campaign-agent/outcome", signal, JSON.stringify(body));
    },
    decodeRead: (data, value) => decodeCampaignAgentRead(data, bound(value)),
    decodeSources: (data, value, agentId, after) => decodeCampaignAgentSources(data, bound(value), agentId, after),
    decodeReceipt: (data, original) => decodeCampaignAgentReceipt(data, original, fixed),
    parseCommand: data => { const parsed = parseCampaignAgentBrowserCommand(data); if (parsed.campaignId !== fixed.campaignId || !same(parsed.scope, fixed.scope)) return fail(); return parsed; },
    parseBarrier: data => parseCampaignAgentRecoveryBarrier(data, fixed),
    decodeBarrierReceipt: (data, original) => decodeCampaignAgentBarrierReceipt(data, parseCampaignAgentRecoveryBarrier(original, fixed), fixed),
    decodeOutcome: async (data, value) => {
      const actual = await stub(value); checkedBrowserJson(data, 8192);
      if (!data || typeof data !== "object" || Array.isArray(data)) return fail();
      const result = data as Record<string, unknown>;
      if (Object.keys(result).sort().join(",") !== "binding,receipt,status" || !same(result.binding, fixed)) return fail();
      if (result.status === "UNKNOWN") { if (result.receipt !== null) return fail(); return { status: "UNKNOWN", binding: fixed, receipt: null }; }
      if (result.status !== "COMMITTED") return fail();
      const receipt = actual.kind === "COMMAND" ? decodeCampaignAgentRecoveryOriginalReceipt(result.receipt, targetForStub(actual), fixed)
        : decodeCampaignAgentBarrierReceipt(result.receipt, parseCampaignAgentRecoveryBarrier(actual.metadata, fixed), fixed);
      return { status: "COMMITTED", binding: fixed, receipt };
    },
    decodePlan: (data, value) => { const actual = bound(value), permission = parse(planSchema, data, 4096);
      if (actual.scope.kind !== "CLIENT" || permission.clientId !== actual.scope.clientId) return fail(); return permission; },
    captureFromPacket,
    stubForPacket: packet => createCampaignAgentRecoveryStub(parseCampaignAgentRecoveryPacket(packet, fixed), actorReference, fixed),
    barrierFromStub: async value => { const actual = await stub(value); if (actual.kind !== "RECOVERY_BARRIER" || !actual.originalBody) return fail();
      return captureFromPacket({ kind: "RECOVERY_BARRIER", body: actual.originalBody, phase: actual.phase, receipt: actual.receipt, reviewed: false }); },
    targetForStub,
    originalTarget,
    permitsBarrierHandoff: (old, fresh) => {
      if (old.kind !== "RECOVERY_BARRIER" || old.phase === "CONFIRMED" || old.receipt !== null || !same(fresh.binding, fixed)) return false;
      const previous = parseCampaignAgentRecoveryBarrier(old.command, fixed), actual = fresh.current.snapshot;
      const before = [previous.expectedAgentRevision, previous.expectedSnapshot.campaignRevision, previous.expectedSnapshot.fieldsRevision,
        previous.expectedSnapshot.planningRevision, previous.expectedSnapshot.selection.revision];
      const after = [fresh.retained?.revision ?? 0, actual.campaignRevision, actual.fieldsRevision, actual.planningRevision, actual.selection.revision];
      return after.every((revision, index) => revision >= before[index]!) && after.some((revision, index) => revision > before[index]!);
    },
    reviewRows: campaignAgentReviewRows,
    acknowledges: campaignAgentAcknowledges,
    journal,
  };
}
