// Real WebCrypto and bounded Storage/Response seams;
// no provider mock, actual native authorization, live browser or UI acceptance.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createCampaignAgentEncryptedJournal } from "@/lib/campaign-agent/browser-storage";
import type { CampaignAgentRecoveryPacket, CampaignAgentEncryptedEnvelope } from "@/lib/campaign-agent/browser-recovery";
import type { CampaignAgentRecoveryKey } from "@/lib/campaign-agent/recovery-contracts";
import type { AgentBinding } from "@/lib/campaign-agent/contracts";
import { canonicalHash } from "@/lib/onboarding/drafts"; // Test-only Node parity, never a client import.

const actor = "actor~storage", binding: AgentBinding = { scope: { kind: "OWN_BRAND", brandId: "brand~storage" }, workspaceId: "workspace~storage", campaignId: "campaign~storage" };
const signal = () => new AbortController().signal;
const words = "  Synthetic exact original words\nكلمات أصلية لا تحفظ كنص صريح  ";
const command = { operationKey: randomUUID(), scope: binding.scope, campaignId: binding.campaignId, action: "APPEND_TEXT",
  expectedAgentRevision: 2, expectedSnapshot: { campaignRevision: 7, fieldsRevision: 6, planningRevision: 5,
    selection: { id: "selection~storage", revision: 3, kind: "NONE", versionId: null, contentHash: null }, fieldsHash: "a".repeat(64) },
  payload: { originalText: { text: words, language: "ar" } } };
const unknown: CampaignAgentRecoveryPacket = { kind: "COMMAND", body: JSON.stringify(command, null, 2), phase: "UNKNOWN", receipt: null, reviewed: false };
const receipt = { agentId: "agent~storage", campaignId: binding.campaignId, workspaceId: binding.workspaceId, action: "APPEND_TEXT" as const,
  agentRevision: 3, campaignRevision: 7, planningRevision: 5, sourceId: "source~committed", confirmationBatchId: null, briefId: null, briefVersion: null, replayed: false };
const confirmed: CampaignAgentRecoveryPacket = { ...unknown, phase: "CONFIRMED", receipt, reviewed: false };

class MemoryStorage implements Storage {
  readonly items = new Map<string, string>();
  readonly writes: Array<{ key: string; value: string }> = [];
  failRead = false;
  failCipherWrite = false;
  failEveryWrite = false;
  get length() { return this.items.size; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  getItem(key: string) { if (this.failRead) throw new Error("Synthetic storage read failure"); return this.items.get(key) ?? null; }
  setItem(key: string, value: string) {
    this.writes.push({ key, value });
    if (this.failEveryWrite || this.failCipherWrite && value.includes('"ciphertextBase64Url"')) throw new Error("Synthetic storage quota failure");
    this.items.set(key, value);
  }
  removeItem(key: string) { this.items.delete(key); }
  clear() { this.items.clear(); }
}
async function material(who = actor, bound = binding): Promise<CampaignAgentRecoveryKey> {
  expect(globalThis.crypto?.subtle !== undefined).toBe(true);
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
  return { schemaVersion: 1, asOf: "2026-10-08T12:34:56.000Z", binding: structuredClone(bound), actorReference: who,
    algorithm: "AES-GCM", keyId: hash, keyBase64Url: Buffer.from(bytes).toString("base64url") };
}
function success(value: CampaignAgentRecoveryKey) {
  const requestId = randomUUID();
  return new Response(JSON.stringify({ data: value, requestId }), { status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", "X-Request-Id": requestId } });
}
function purposeEntries(storage: MemoryStorage) {
  const own = [...storage.items].filter(([key]) => key.startsWith("infame:agent-recovery:v1"));
  const cipher = own.find(([, value]) => { try { return "ciphertextBase64Url" in JSON.parse(value); } catch { return false; } });
  const stub = own.find(([, value]) => { try { return "metadata" in JSON.parse(value) && "commandHash" in JSON.parse(value); } catch { return false; } });
  return { own, cipher, stub };
}
function noPlaintext(storage: MemoryStorage, keyMaterial: CampaignAgentRecoveryKey) {
  // Boolean-only checks never dump a leaked key, nonce, packet or source words.
  const persisted = [...storage.items.values()].join("\n"), attempted = storage.writes.map(item => item.value).join("\n");
  for (const content of [persisted, attempted]) {
    expect(content.includes(words) || content.includes(unknown.body) || content.includes(keyMaterial.keyBase64Url)).toBe(false);
    expect(content.includes('"originalText":') || content.includes('"keyBase64Url":') || content.includes('"body":')).toBe(false);
  }
}
async function failure(action: Promise<unknown>) {
  const rejected: unknown = await action.then(() => null, (error: unknown) => error);
  expect(rejected instanceof Error).toBe(true); // No rejected/resolved key DTO printing.
}

it("does not lose terminal phases on failed stub writes or treat UUID case aliases as a new recovery operation", async () => {
  const keyMaterial = await material();
  for (const terminal of [{ ...unknown, phase: "CONFLICT" as const }, confirmed]) {
    const storage = new MemoryStorage(), journal = createCampaignAgentEncryptedJournal({ actorReference: actor, binding, storage,
      fetchKey: async () => success(keyMaterial), onDeny: () => undefined });
    await journal.save(unknown, signal()); storage.failEveryWrite = true;
    await failure(journal.save(terminal, signal())); storage.failEveryWrite = false;
    const loaded = await journal.load(signal());
    expect(loaded.stub?.phase).toBe(terminal.phase);
    expect(loaded.packet === null || loaded.packet.phase === terminal.phase).toBe(true);
  }
  const storage = new MemoryStorage(), journal = createCampaignAgentEncryptedJournal({ actorReference: actor, binding, storage,
    fetchKey: async () => success(keyMaterial), onDeny: () => undefined });
  await journal.save(unknown, signal());
  const target = (await journal.load(signal())).stub!.metadata;
  const alias = { operationKey: command.operationKey.toUpperCase(), scope: binding.scope, campaignId: binding.campaignId,
    expectedAgentRevision: 2, expectedSnapshot: command.expectedSnapshot, target, initialPreferences: null };
  await failure(journal.save({ kind: "RECOVERY_BARRIER", body: JSON.stringify(alias), phase: "UNKNOWN", receipt: null, reviewed: false }, signal()));
  let announce!: () => void, resume!: () => void;
  const started = new Promise<void>(resolve => { announce = resolve; });
  const held = new Promise<void>(resolve => { resume = resolve; });
  const delayed = createCampaignAgentEncryptedJournal({ actorReference: actor, binding, storage,
    fetchKey: async () => { announce(); await held; return success(keyMaterial); }, onDeny: () => undefined });
  const obsolete = delayed.load(signal()); await started;
  const sibling = createCampaignAgentEncryptedJournal({ actorReference: actor, binding, storage,
    fetchKey: async () => success(keyMaterial), onDeny: () => undefined });
  await sibling.save(confirmed, signal()); resume();
  await failure(obsolete);
  expect((await sibling.load(signal())).stub?.phase).toBe("CONFIRMED");
});

it("persists only scoped ciphertext plus safe immutable stub, uses fresh authorized keys/nonces, restores exact bodies without dispatch and isolates actors/bindings", async () => {
  const storage = new MemoryStorage(), keyMaterial = await material(), calls: AbortSignal[] = [], denials: number[] = [];
  storage.setItem("unrelated:existing-planning-packet", "untouched reference"); storage.writes.length = 0;
  const options = { actorReference: actor, binding, storage, fetchKey: async (requestSignal: AbortSignal) => { calls.push(requestSignal); return success(keyMaterial); }, onDeny: (status: number) => { denials.push(status); } };
  const journal = createCampaignAgentEncryptedJournal(options), saving = signal();
  await journal.save(unknown, saving); expect(calls).toHaveLength(1); expect(calls[0] === saving).toBe(true);
  let entries = purposeEntries(storage); expect(entries.own).toHaveLength(2); expect(entries.cipher !== undefined && entries.stub !== undefined).toBe(true);
  expect(storage.writes[0]?.value.includes('"metadata"')).toBe(true); expect(storage.writes[1]?.value.includes('"ciphertextBase64Url"')).toBe(true);
  const firstCipher = JSON.parse(entries.cipher![1]) as CampaignAgentEncryptedEnvelope;
  const firstStub = JSON.parse(entries.stub![1]);
  expect(firstStub).toMatchObject({ schemaVersion: 1, actorReference: actor, binding, kind: "COMMAND", operationKey: command.operationKey,
    commandHash: canonicalHash({ domain: "infame-campaign-agent-command-v1", actorUserId: actor, command }), phase: "UNKNOWN", receipt: null });
  expect(firstStub.metadata.payload).toEqual({ originalTextHash: canonicalHash({ domain: "infame-agent-recovery-text-v1", originalText: command.payload.originalText }) });
  noPlaintext(storage, keyMaterial);
  await journal.save(unknown, signal()); entries = purposeEntries(storage);
  const secondCipher = JSON.parse(entries.cipher![1]) as CampaignAgentEncryptedEnvelope;
  expect(firstCipher.ivBase64Url === secondCipher.ivBase64Url).toBe(false);
  expect(calls).toHaveLength(2); noPlaintext(storage, keyMaterial);
  const reloaded = createCampaignAgentEncryptedJournal(options), beforeReload = [...storage.items], loading = signal();
  const restored = await reloaded.load(loading);
  expect(restored.packet).toEqual(unknown); expect(restored.stub).toMatchObject({ operationKey: command.operationKey, phase: "UNKNOWN" });
  expect(calls).toHaveLength(3); expect(calls[2] === loading).toBe(true); expect([...storage.items]).toEqual(beforeReload);
  // The only injected request capability is key fetch. load neither calls save
  // nor mutates storage nor invents a business/abandonment dispatch.
  await reloaded.save(confirmed, signal()); noPlaintext(storage, keyMaterial);
  const resumedConfirmed = await createCampaignAgentEncryptedJournal(options).load(signal());
  expect(resumedConfirmed.packet).toEqual(confirmed); expect(resumedConfirmed.stub?.receipt).toEqual(receipt);
  const knownStorage = [...storage.items];
  await failure(reloaded.save(unknown, signal())); // No CONFIRMED→UNKNOWN downgrade.
  await failure(reloaded.save({ ...confirmed, receipt: { ...receipt, sourceId: "source~substituted" } }, signal()));
  await failure(reloaded.save({ ...confirmed, body: JSON.stringify(command) }, signal())); // Exact original body, not just semantic JSON.
  await failure(reloaded.save({ ...unknown, body: JSON.stringify({ ...command, operationKey: randomUUID() }) }, signal()));
  expect([...storage.items]).toEqual(knownStorage);
  const otherActor = "actor~other", otherMaterial = await material(otherActor), otherJournal = createCampaignAgentEncryptedJournal({ ...options, actorReference: otherActor, fetchKey: async () => success(otherMaterial) });
  expect(await otherJournal.load(signal())).toEqual({ packet: null, stub: null }); otherJournal.clear(true); expect([...storage.items]).toEqual(knownStorage);
  const otherBinding = { ...binding, campaignId: "campaign~other" }, otherBoundMaterial = await material(actor, otherBinding);
  const foreignJournal = createCampaignAgentEncryptedJournal({ ...options, binding: otherBinding, fetchKey: async () => success(otherBoundMaterial) });
  expect(await foreignJournal.load(signal())).toEqual({ packet: null, stub: null }); foreignJournal.clear(false); expect([...storage.items]).toEqual(knownStorage);
  const preserved = { ...binding, scope: { ...binding.scope } }, entryCaptured = createCampaignAgentEncryptedJournal({ ...options, binding: preserved });
  preserved.campaignId = "campaign~mutated-after-factory";
  const entryRestored = await entryCaptured.load(signal()); expect(entryRestored.packet).toEqual(confirmed);
  expect(denials).toEqual([]); expect(storage.getItem("unrelated:existing-planning-packet")).toBe("untouched reference");
  // This explicit caller action stands for completed current read reconciliation;
  // the storage module never guesses that a missing outcome implies permission.
  reloaded.clear(false); expect(purposeEntries(storage).own).toHaveLength(0); expect(storage.getItem("unrelated:existing-planning-packet")).toBe("untouched reference");
  const handStorage = new MemoryStorage(), handJournal = createCampaignAgentEncryptedJournal({ ...options, storage: handStorage });
  await handJournal.save(unknown, signal());
  const target = { operationKey: command.operationKey, action: command.action, expectedAgentRevision: command.expectedAgentRevision,
    expectedSnapshot: command.expectedSnapshot, commandHash: canonicalHash({ domain: "infame-campaign-agent-command-v1", actorUserId: actor, command }),
    payload: { originalTextHash: canonicalHash({ domain: "infame-agent-recovery-text-v1", originalText: command.payload.originalText }) } };
  const barrierBody = { operationKey: randomUUID(), scope: binding.scope, campaignId: binding.campaignId, expectedAgentRevision: 2,
    expectedSnapshot: command.expectedSnapshot, target, initialPreferences: null };
  const handoff: CampaignAgentRecoveryPacket = { kind: "RECOVERY_BARRIER", body: JSON.stringify(barrierBody, null, 2), phase: "UNKNOWN", receipt: null, reviewed: false };
  const beforeInvalidHandoff = [...handStorage.items];
  await failure(handJournal.save({ ...unknown, body: JSON.stringify({ ...command, operationKey: randomUUID() }) }, signal()));
  await failure(handJournal.save({ ...handoff, body: JSON.stringify({ ...barrierBody, target: { ...target, commandHash: "b".repeat(64) } }) }, signal()));
  await failure(handJournal.save({ ...handoff, body: JSON.stringify({ ...barrierBody, target: { ...target, operationKey: randomUUID() } }) }, signal()));
  expect([...handStorage.items]).toEqual(beforeInvalidHandoff);
  await handJournal.save(handoff, signal()); noPlaintext(handStorage, keyMaterial);
  const handoffReload = await createCampaignAgentEncryptedJournal({ ...options, storage: handStorage }).load(signal());
  expect(handoffReload.packet).toEqual(handoff);
  expect(handoffReload.stub).toMatchObject({ kind: "RECOVERY_BARRIER", operationKey: barrierBody.operationKey,
    commandHash: canonicalHash({ domain: "infame-campaign-agent-recovery-barrier-v1", actorUserId: actor, command: barrierBody }), metadata: barrierBody });
  handJournal.clear(true);
  const lostBarrierCipher = await createCampaignAgentEncryptedJournal({ ...options, storage: handStorage }).load(signal());
  expect(lostBarrierCipher.packet).toBeNull(); expect(lostBarrierCipher.stub?.metadata).toEqual(barrierBody);
  const barrierReceipt = { action: "RECOVERY_BARRIER" as const, agentId: receipt.agentId, campaignId: binding.campaignId,
    workspaceId: binding.workspaceId, agentRevision: 3, campaignRevision: 7, planningRevision: 5,
    targetOperationKey: command.operationKey, targetCommandHash: target.commandHash, targetOutcome: "FENCED" as const, originalReceipt: null, replayed: false };
  await handJournal.save({ ...handoff, phase: "CONFIRMED", receipt: barrierReceipt, reviewed: true }, signal());
  handJournal.clear(false); expect(purposeEntries(handStorage).own).toHaveLength(0);
});

it("retains conservative barriers through tampering, rotation, denial, missing/corrupt storage and persistence failure while preserving phase and known receipts", async () => {
  const storage = new MemoryStorage(), keyMaterial = await material();
  const options = { actorReference: actor, binding, storage, fetchKey: async (_signal: AbortSignal) => { void _signal; return success(keyMaterial); }, onDeny: (_status: number) => { void _status; } };
  const journal = createCampaignAgentEncryptedJournal(options); await journal.save(unknown, signal());
  const entries = purposeEntries(storage), originalCipher = entries.cipher![1], originalStub = entries.stub![1], cipherKey = entries.cipher![0], stubKey = entries.stub![0];
  const envelope = JSON.parse(originalCipher) as CampaignAgentEncryptedEnvelope;
  const changedCipher = (envelope.ciphertextBase64Url[0] === "A" ? "B" : "A") + envelope.ciphertextBase64Url.slice(1);
  for (const tampered of [{ ...envelope, ciphertextBase64Url: changedCipher }, { ...envelope, ivBase64Url: "A".repeat(16) },
    { ...envelope, actorReference: "actor~foreign" }, { ...envelope, binding: { ...binding, workspaceId: "workspace~foreign" } }]) {
    storage.items.set(cipherKey, JSON.stringify(tampered));
    const loaded = await createCampaignAgentEncryptedJournal(options).load(signal());
    expect(loaded.packet).toBeNull(); expect(loaded.stub).toMatchObject({ operationKey: command.operationKey, phase: "UNKNOWN" });
    expect(storage.getItem(stubKey) === originalStub).toBe(true); noPlaintext(storage, keyMaterial);
  }
  storage.items.set(cipherKey, originalCipher);
  const rotated = await material(), rotationJournal = createCampaignAgentEncryptedJournal({ ...options, fetchKey: async () => success(rotated) });
  const rotation = await rotationJournal.load(signal()); expect(rotation.packet).toBeNull(); expect(rotation.stub).toMatchObject({ operationKey: command.operationKey, phase: "UNKNOWN" });
  storage.items.delete(cipherKey);
  const missingCipher = await createCampaignAgentEncryptedJournal(options).load(signal()); expect(missingCipher.packet).toBeNull(); expect(missingCipher.stub).not.toBeNull();
  storage.items.set(cipherKey, "not valid encrypted JSON");
  const corruptCipher = await createCampaignAgentEncryptedJournal(options).load(signal()); expect(corruptCipher.packet).toBeNull(); expect(corruptCipher.stub).not.toBeNull();
  storage.items.set(cipherKey, originalCipher); storage.items.set(stubKey, "not valid barrier JSON");
  await failure(createCampaignAgentEncryptedJournal(options).load(signal()));
  expect(storage.items.has(stubKey)).toBe(true); // Corruption cannot become empty/unlocked.
  storage.items.set(stubKey, originalStub);
  journal.clear(true); expect(storage.items.has(cipherKey)).toBe(false); expect(storage.getItem(stubKey) === originalStub).toBe(true);
  expect((await createCampaignAgentEncryptedJournal(options).load(signal())).stub).not.toBeNull();
  storage.items.set(cipherKey, originalCipher);
  for (const status of [401, 403, 404]) {
    const order: string[] = [], denied = new Response("Synthetic protected body must not be parsed", { status });
    for (const method of ["json", "text", "arrayBuffer", "blob", "formData"] as const) Object.defineProperty(denied, method, { value: async () => { order.push("body"); throw new Error("Denied body accessed"); } });
    const denying = createCampaignAgentEncryptedJournal({ ...options, fetchKey: async () => denied, onDeny: (observed: number) => {
      expect(observed).toBe(status); order.push("deny"); denying.clear(true); // The trusted parent privacy handler.
    } });
    await failure(denying.load(signal())); expect(order).toEqual(["deny"]);
    expect(storage.items.has(cipherKey)).toBe(false); expect(storage.getItem(stubKey) === originalStub).toBe(true);
    storage.items.set(cipherKey, originalCipher);
  }
  const failingStorage = new MemoryStorage(), failedJournal = createCampaignAgentEncryptedJournal({ ...options, storage: failingStorage });
  failingStorage.failCipherWrite = true; await failure(failedJournal.save(unknown, signal()));
  expect(failingStorage.writes[0]?.value.includes('"metadata"')).toBe(true);
  expect(purposeEntries(failingStorage).stub !== undefined && purposeEntries(failingStorage).cipher === undefined).toBe(true);
  noPlaintext(failingStorage, keyMaterial);
  failingStorage.failCipherWrite = false; expect((await createCampaignAgentEncryptedJournal({ ...options, storage: failingStorage }).load(signal())).stub).not.toBeNull();
  await failedJournal.save(unknown, signal()); failingStorage.failCipherWrite = true;
  await failure(failedJournal.save(confirmed, signal()));
  failingStorage.failCipherWrite = false;
  const retainedKnown = await failedJournal.load(signal());
  expect(retainedKnown.stub?.phase).toBe("CONFIRMED"); expect(retainedKnown.stub?.receipt).toEqual(receipt);
  expect(retainedKnown.packet === null || retainedKnown.packet.phase === "CONFIRMED").toBe(true); // Never restore obsolete UNKNOWN over a known receipt.
  noPlaintext(failingStorage, keyMaterial);
  const noStorage = new MemoryStorage(); noStorage.failEveryWrite = true;
  await failure(createCampaignAgentEncryptedJournal({ ...options, storage: noStorage }).save(unknown, signal()));
  expect(noStorage.items.size).toBe(0); noPlaintext(noStorage, keyMaterial);
  const cannotRead = new MemoryStorage(); cannotRead.failRead = true;
  await failure(createCampaignAgentEncryptedJournal({ ...options, storage: cannotRead }).load(signal()));
  const conflictStorage = new MemoryStorage(), conflictJournal = createCampaignAgentEncryptedJournal({ ...options, storage: conflictStorage });
  await conflictJournal.save(unknown, signal()); const conflict: CampaignAgentRecoveryPacket = { ...unknown, phase: "CONFLICT", reviewed: false };
  await conflictJournal.save(conflict, signal()); await failure(conflictJournal.save(unknown, signal()));
  expect((await conflictJournal.load(signal())).packet?.phase).toBe("CONFLICT");
  const abort = new AbortController(); abort.abort(); const beforeAbort = [...conflictStorage.items];
  await failure(conflictJournal.load(abort.signal)); expect([...conflictStorage.items]).toEqual(beforeAbort);
});
