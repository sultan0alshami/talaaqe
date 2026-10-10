// Three pure groups. Global fetch is a Response-only transport seam; actual
// WebCrypto hashes run. No provider/native/browser acceptance or product edits.
import { createHash, randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createCampaignAgentRecoveryBrowserAdapter } from "@/lib/campaign-agent/browser-transport";
import type { AgentBinding, CampaignAgentState } from "@/lib/campaign-agent/contracts";
import type { CampaignAgentRead } from "@/lib/campaign-agent/service";
import type { CampaignAgentRecoveryPacket } from "@/lib/campaign-agent/browser-recovery";
import type { CampaignAgentRecoveryStub } from "@/lib/campaign-agent/browser-storage";
import { CampaignAgentCommandSchema } from "@/lib/campaign-agent/native-contracts";
import { CampaignAgentBarrierCommandSchema } from "@/lib/campaign-agent/recovery-contracts";
import { canonicalHash } from "@/lib/onboarding/drafts"; // Independent server parity, test-only.
import { CampaignFieldsSchema } from "@/lib/campaigns/contracts";
import { campaignFields } from "../campaigns/fixtures";

const actor = "actor~transport", binding: AgentBinding = { scope: { kind: "OWN_BRAND", brandId: "brand~transport" }, workspaceId: "workspace~transport", campaignId: "campaign~transport" };
const fields = CampaignFieldsSchema.parse(campaignFields);
const snapshot = { campaignRevision: 7, fieldsRevision: 6, planningRevision: 5,
  selection: { id: "selection~transport", revision: 3, kind: "NONE" as const, versionId: null, contentHash: null }, fieldsHash: canonicalHash({ domain: "infame-campaign-fields-v1", fields }) };
const words = "  Synthetic unchanged wire words\nنص أصلي محفوظ  ";
const command = CampaignAgentCommandSchema.parse({ operationKey: randomUUID(), scope: binding.scope, campaignId: binding.campaignId,
  action: "APPEND_TEXT", expectedAgentRevision: 2, expectedSnapshot: snapshot, payload: { originalText: { text: words, language: "ar" } } });
const body = JSON.stringify(Object.fromEntries(Object.entries(command).reverse()), null, 2);
const unknown: CampaignAgentRecoveryPacket = { kind: "COMMAND", body, phase: "UNKNOWN", receipt: null, reviewed: false };
const receipt = { agentId: "agent~transport", campaignId: binding.campaignId, workspaceId: binding.workspaceId,
  action: "APPEND_TEXT" as const, agentRevision: 3, campaignRevision: 7, planningRevision: 5, sourceId: "source~committed",
  confirmationBatchId: null, briefId: null, briefVersion: null, replayed: true };
class MemoryStorage implements Storage {
  readonly items = new Map<string, string>();
  get length() { return this.items.size; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
  clear() { this.items.clear(); }
}
function adapter(bound = binding, who = actor) { return createCampaignAgentRecoveryBrowserAdapter({ actorReference: who, binding: bound, storage: new MemoryStorage(), onDeny: (_status: number) => { void _status; } }); }
async function fails(action: () => unknown | Promise<unknown>) {
  let failure: unknown = null; try { await action(); } catch (error) { failure = error; }
  expect(failure instanceof Error).toBe(true);
}
afterEach(() => vi.unstubAllGlobals());

it("sends exact original valid JSON bytes/order with fixed scoped URLs and no-store credentials while rejecting foreign/malformed inputs before dispatch", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(input), init }); return new Response("{}", { status: 200 }); });
  const transport = adapter(), signal = new AbortController().signal;
  await transport.getState(binding, signal); await transport.getSources(binding, "source~after", signal);
  expect(new URL(calls[0]!.url, "https://fixture.invalid").pathname).toBe("/api/campaign-agent");
  const sourceURL = new URL(calls[1]!.url, "https://fixture.invalid"); expect(sourceURL.pathname).toBe("/api/campaign-agent/sources");
  expect(sourceURL.searchParams.get("scope")).toBe("OWN_BRAND"); expect(sourceURL.searchParams.get("brandId")).toBe("brand~transport"); expect(sourceURL.searchParams.get("after")).toBe("source~after");
  await transport.sendCommand(body, signal);
  const alternativeOrder = JSON.stringify(command, null, 1); await transport.sendCommand(alternativeOrder, signal);
  expect(calls[2]!.url).toBe("/api/campaign-agent/commands"); expect(calls[2]!.init?.body === body).toBe(true); expect(calls[3]!.init?.body === alternativeOrder).toBe(true);
  expect(await transport.getPlan(binding, signal)).toBeNull(); expect(calls).toHaveLength(4);
  for (const call of calls) expect(call.init).toMatchObject({ credentials: "same-origin", cache: "no-store", redirect: "error", signal });
  const beforeBad = calls.length;
  await fails(() => transport.getState({ ...binding, workspaceId: "workspace~foreign" }, signal));
  await fails(() => transport.sendCommand(JSON.stringify({ ...command, campaignId: "campaign~foreign" }), signal));
  await fails(() => transport.sendCommand(JSON.stringify({ ...command, channel: "FORM" }), signal));
  await fails(() => transport.sendCommand("{malformed wire", signal)); expect(calls.length).toBe(beforeBad);
  const clientBinding: AgentBinding = { scope: { kind: "CLIENT", clientId: "client~/transport" }, campaignId: "campaign~client", workspaceId: "workspace~client" };
  const client = adapter(clientBinding); await client.getPlan(clientBinding, signal);
  expect(calls.at(-1)!.url).toBe("/api/organization-clients/client~%2Ftransport/authority?capability=plan");
  const target = { operationKey: command.operationKey, commandHash: canonicalHash({ domain: "infame-campaign-agent-command-v1", actorUserId: actor, command }),
    action: command.action, expectedAgentRevision: command.expectedAgentRevision, expectedSnapshot: command.expectedSnapshot,
    payload: { originalTextHash: canonicalHash({ domain: "infame-agent-recovery-text-v1", originalText: command.action === "APPEND_TEXT" ? command.payload.originalText : null }) } };
  const barrier = CampaignAgentBarrierCommandSchema.parse({ operationKey: randomUUID(), scope: binding.scope, campaignId: binding.campaignId,
    expectedAgentRevision: 2, expectedSnapshot: snapshot, target, initialPreferences: null });
  const wireBarrier = JSON.stringify(Object.fromEntries(Object.entries(barrier).reverse()), null, 3);
  await transport.sendBarrier(wireBarrier, signal); expect(calls.at(-1)!.url).toBe("/api/campaign-agent/recovery-barrier"); expect(calls.at(-1)!.init?.body === wireBarrier).toBe(true);
  const stub = await transport.stubForPacket(unknown); await transport.getOutcome(stub, signal);
  expect(calls.at(-1)!.url).toBe("/api/campaign-agent/outcome"); expect(calls.at(-1)!.init?.method).toBe("POST");
  const outcomeWire = JSON.parse(String(calls.at(-1)!.init?.body)); expect(outcomeWire).toEqual({ scope: binding.scope, campaignId: binding.campaignId, target: stub.metadata });
  expect(JSON.stringify(outcomeWire).includes(words) || JSON.stringify(outcomeWire).includes('"originalText":')).toBe(false);
});

it("validates exact actor/binding/receipt/outcome hashes and builds safe original metadata without treating structured labels as native producer proof", async () => {
  const transport = adapter(), stub = await transport.stubForPacket(unknown);
  expect(stub).toMatchObject({ schemaVersion: 1, actorReference: actor, binding, kind: "COMMAND", operationKey: command.operationKey, phase: "UNKNOWN", receipt: null });
  expect(stub.commandHash).toBe(canonicalHash({ domain: "infame-campaign-agent-command-v1", actorUserId: actor, command }));
  expect(stub.bodyHash).toBe(createHash("sha256").update(body, "utf8").digest("hex")); expect(stub.originalBody).toBeUndefined();
  expect(JSON.stringify(stub).includes(words) || JSON.stringify(stub).includes('"originalText":')).toBe(false);
  expect(transport.captureFromPacket(unknown)).toMatchObject({ kind: "COMMAND", command, body, phase: "UNKNOWN", receipt: null });
  const reordered = await transport.stubForPacket({ ...unknown, body: JSON.stringify(command) });
  expect(reordered.commandHash).toBe(stub.commandHash); expect(reordered.bodyHash === stub.bodyHash).toBe(false);
  expect(transport.decodeReceipt(receipt, command)).toEqual(receipt);
  expect(await transport.decodeOutcome({ status: "COMMITTED", binding, receipt }, stub)).toEqual({ status: "COMMITTED", binding, receipt });
  expect(await transport.decodeOutcome({ status: "UNKNOWN", binding, receipt: null }, stub)).toEqual({ status: "UNKNOWN", binding, receipt: null });
  for (const data of [{ status: "COMMITTED", binding: { ...binding, workspaceId: "workspace~foreign" }, receipt },
    { status: "COMMITTED", binding, receipt: { ...receipt, agentRevision: 4 } }, { status: "UNKNOWN", binding, receipt },
    { status: "COMMITTED", binding, receipt: { ...receipt, action: "INITIALIZE", sourceId: null } }]) await fails(() => transport.decodeOutcome(data, stub));
  for (const bad of [{ ...stub, actorReference: "actor~foreign" }, { ...stub, binding: { ...binding, campaignId: "campaign~foreign" } },
    { ...stub, commandHash: "b".repeat(64) }, { ...stub, operationKey: randomUUID() }, { ...stub, originalBody: body }]) {
    await fails(() => transport.decodeOutcome({ status: "UNKNOWN", binding, receipt: null }, bad));
  }
  const planBinding: AgentBinding = { scope: { kind: "CLIENT", clientId: "client~transport" }, workspaceId: "workspace~client", campaignId: "campaign~client" };
  const client = adapter(planBinding), plan = { organizationId: "organization~transport", clientId: "client~transport", brandId: "brand~client", membershipId: "membership~transport", grantId: "grant~transport",
    capability: "plan", organizationRevision: 3, clientRevision: 2, membershipRevision: 2, grantRevision: 1 };
  expect(client.decodePlan(plan, planBinding)).toEqual(plan);
  await fails(() => client.decodePlan({ ...plan, clientId: "client~foreign" }, planBinding));
  await fails(() => client.decodePlan({ ...plan, capability: "view" }, planBinding));
  await fails(() => transport.captureFromPacket({ ...unknown, phase: "CONFIRMED", receipt: null }));
  await fails(() => transport.captureFromPacket({ ...unknown, reviewed: true }));
});

it("recovers exact technical barrier wire after ciphertext loss, rejects recursive/substituted metadata and validates nonregressing explicit handoff epochs", async () => {
  const transport = adapter(), originalStub = await transport.stubForPacket(unknown), target = transport.targetForStub(originalStub);
  const barrier = transport.parseBarrier({ operationKey: randomUUID(), scope: binding.scope, campaignId: binding.campaignId,
    expectedAgentRevision: 2, expectedSnapshot: snapshot, target, initialPreferences: null });
  const exactWire = JSON.stringify(Object.fromEntries(Object.entries(barrier).reverse()), null, 4);
  const packet: CampaignAgentRecoveryPacket = { kind: "RECOVERY_BARRIER", body: exactWire, phase: "UNKNOWN", receipt: null, reviewed: false };
  const stub = await transport.stubForPacket(packet), captured = await transport.barrierFromStub(stub);
  expect(stub.originalBody === exactWire && captured.body === exactWire).toBe(true); expect(captured.kind).toBe("RECOVERY_BARRIER");
  if (captured.kind !== "RECOVERY_BARRIER") throw new Error("Expected a verified barrier capture");
  expect(captured.command).toEqual(barrier); expect(stub.commandHash).toBe(canonicalHash({ domain: "infame-campaign-agent-recovery-barrier-v1", actorUserId: actor, command: barrier }));
  expect(stub.bodyHash).toBe(createHash("sha256").update(exactWire, "utf8").digest("hex")); expect(transport.originalTarget(stub)).toEqual(target);
  await fails(() => transport.targetForStub(stub)); // Never produce barrier-of-barrier targets.
  for (const bad of [{ ...stub, originalBody: JSON.stringify(barrier) }, { ...stub, commandHash: "c".repeat(64) },
    { ...stub, bodyHash: "d".repeat(64) }, { ...stub, actorReference: "actor~foreign" },
    { ...stub, metadata: { ...barrier, target: { kind: "RECOVERY_BARRIER", command: barrier, commandHash: stub.commandHash } } }]) await fails(() => transport.barrierFromStub(bad as unknown as CampaignAgentRecoveryStub));
  const result = { action: "RECOVERY_BARRIER" as const, agentId: receipt.agentId, campaignId: binding.campaignId, workspaceId: binding.workspaceId,
    agentRevision: 3, campaignRevision: 7, planningRevision: 5, targetOperationKey: command.operationKey,
    targetCommandHash: originalStub.commandHash, targetOutcome: "FENCED" as const, originalReceipt: null, replayed: true };
  expect(transport.decodeBarrierReceipt(result, barrier)).toEqual(result);
  expect(await transport.decodeOutcome({ status: "COMMITTED", binding, receipt: result }, stub)).toEqual({ status: "COMMITTED", binding, receipt: result });
  for (const changed of [{ targetOperationKey: randomUUID() }, { targetCommandHash: "a".repeat(64) }, { agentRevision: 4 },
    { originalReceipt: receipt }, { workspaceId: "workspace~foreign" }]) await fails(() => transport.decodeBarrierReceipt({ ...result, ...changed }, barrier));
  await fails(() => transport.parseBarrier({ ...barrier, operationKey: barrier.target.operationKey.toUpperCase() }));
  const stateBody: Omit<CampaignAgentState, "stateHash"> = { schemaVersion: 1, id: receipt.agentId, revision: 2, binding, snapshot, fields,
    preferences: { input: "TEXT", output: "TEXT" }, assistance: { kind: "MANUAL_GUIDANCE", agent: "UNAVAILABLE" },
    textSourceReferences: [], confirmation: { kind: "UNCONFIRMED" }, updatedAt: "2026-10-08T12:34:56.000Z" };
  const current: CampaignAgentRead = { asOf: stateBody.updatedAt, binding, current: { snapshot, fields },
    retained: { ...stateBody, stateHash: canonicalHash({ domain: "infame-campaign-agent-state-v1", ...stateBody }) }, coverage: "UNCONFIRMED" };
  expect(transport.permitsBarrierHandoff(captured, current)).toBe(false);
  const later = { ...current, current: { ...current.current, snapshot: { ...snapshot, campaignRevision: 8 } } };
  expect(transport.permitsBarrierHandoff(captured, later)).toBe(true);
  expect(transport.permitsBarrierHandoff(captured, { ...later, current: { ...later.current, snapshot: { ...later.current.snapshot, planningRevision: 4 } } })).toBe(false);
  expect(transport.permitsBarrierHandoff({ ...captured, phase: "CONFIRMED", receipt: result }, later)).toBe(false);
});
