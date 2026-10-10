// Exactly four pure groups; the fourth uses actual frozen recovery encryption.
// Root alone adopts/runs. Actual WebCrypto and actual Node canonicalHash parity;
// Node imports below are test-only, never browser product value imports.
import { expect, it } from "vitest";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { CampaignDraftFieldsSchema, CampaignFieldsSchema, CampaignFieldObjectSchema,
  type CampaignDraftFields } from "@/lib/campaigns/contracts";
import { OriginalTextSchema } from "@/lib/contracts/vocabulary";
import { CampaignAgentCommandSchema, type CampaignAgentCommand, type CampaignAgentResult } from "@/lib/campaign-agent/native-contracts";
import { CampaignAgentStateSchema, CustomerTextSourceSchema,
  type AgentBinding, type AgentSnapshot, type CampaignAgentState } from "@/lib/campaign-agent/contracts";
import type { CampaignAgentRead } from "@/lib/campaign-agent/service";
import { browserCanonicalHash, browserCanonicalJson, checkedBrowserJson,
  decodeCampaignAgentRead, decodeCampaignAgentSources, decodeCampaignAgentReceipt,
  parseCampaignAgentBrowserCommand, campaignAgentReviewRows, campaignAgentAcknowledges } from "@/lib/campaign-agent/browser";
import { sealCampaignAgentPacket, openCampaignAgentPacket,
  type CampaignAgentRecoveryPacket, type CampaignAgentEncryptedEnvelope } from "@/lib/campaign-agent/browser-recovery";
import { CampaignAgentBarrierCommandSchema, CampaignAgentBarrierResultSchema,
  CampaignAgentRecoveryTargetSchema, type CampaignAgentRecoveryKey } from "@/lib/campaign-agent/recovery-contracts";
import { campaignFields } from "../campaigns/fixtures";

const instant = "2026-10-08T10:11:12.000Z";
const binding: AgentBinding = { scope: { kind: "OWN_BRAND", brandId: "brand~original" },
  workspaceId: "workspace~original", campaignId: "campaign~original" };
const operationKey = "11111111-1111-4111-8111-111111111111";
const keys = Object.keys(CampaignFieldObjectSchema.shape) as Array<keyof typeof CampaignFieldObjectSchema.shape>;
const fields = CampaignFieldsSchema.parse({ ...campaignFields,
  title: "  فكرة أصلية\nOriginal untouched title  ", impressionsTarget: null,
  budget: { amountMinor: "9223372036854775807", currencyCode: "KWD" } });
const fieldHash = (field: string, value: unknown) => canonicalHash({ domain: "infame-campaign-field-value-v1", field, value });
function snapshot(value: CampaignDraftFields = fields): AgentSnapshot {
  return { campaignRevision: 7, fieldsRevision: 7, planningRevision: 5,
    selection: { id: "selection~original", revision: 3, kind: "NONE", versionId: null, contentHash: null },
    fieldsHash: canonicalHash({ domain: "infame-campaign-fields-v1", fields: value }) };
}
function signedState(body: Omit<CampaignAgentState, "stateHash">): CampaignAgentState {
  return CampaignAgentStateSchema.parse({ ...body,
    stateHash: canonicalHash({ domain: "infame-campaign-agent-state-v1", ...body }) });
}
function state(reviewed = false, value: CampaignDraftFields = fields, current = snapshot(value),
  exactBinding = binding, revision = 2): CampaignAgentState {
  return signedState({ schemaVersion: 1, id: "agent~original", revision, binding: exactBinding,
    snapshot: current, fields: value, preferences: { input: "TEXT", output: "TEXT" },
    assistance: { kind: "MANUAL_GUIDANCE", agent: "UNAVAILABLE" }, textSourceReferences: [],
    confirmation: reviewed ? { kind: "REVIEWED_SET", confirmationBatchId: "batch~original", reviewedSnapshot: current,
      fields: keys.map(field => ({ field, id: "confirmation~" + field, valueHash: fieldHash(field, value[field]),
        // Read DTO contains opaque retained-record pins, not full records.
        // Browser coverage must never claim their existence or authorship.
        confirmationHash: canonicalHash({ domain: "synthetic-opaque-confirmation-pin", field }) })) }
      : { kind: "UNCONFIRMED" }, updatedAt: instant });
}
function read(reviewed = false, value: CampaignDraftFields = fields): CampaignAgentRead {
  return { asOf: instant, binding, current: { snapshot: snapshot(value), fields: value },
    retained: state(reviewed, value), coverage: reviewed ? "CURRENT" : "UNCONFIRMED" };
}
function source(id = "source~00", text = "  كلمات أصلية\nExact original words  ") {
  const body = { schemaVersion: 1 as const, id, binding, capturedSnapshot: snapshot(),
    authorUserId: "user~original", kind: "CUSTOMER_TEXT" as const,
    originalText: { text, language: "ar" }, createdAt: instant };
  return CustomerTextSourceSchema.parse({ ...body, sourceHash: canonicalHash({ domain: "infame-customer-text-v1", ...body }) });
}
function page(items = [source()], nextCursor: string | null = null) {
  return { asOf: instant, binding, agentId: "agent~original", sources: items, nextCursor };
}
function command(action: string, payload: unknown): CampaignAgentCommand {
  return CampaignAgentCommandSchema.parse({ operationKey, scope: binding.scope, campaignId: binding.campaignId,
    expectedAgentRevision: action === "INITIALIZE" ? 0 : 1, expectedSnapshot: snapshot(), action, payload });
}
function receipt(original: CampaignAgentCommand): CampaignAgentResult {
  return { agentId: "agent~original", campaignId: binding.campaignId, workspaceId: binding.workspaceId, action: original.action,
    agentRevision: original.expectedAgentRevision + 1,
    campaignRevision: original.expectedSnapshot.campaignRevision + (original.action === "GENERATE_PROFILE" ? 1 : 0),
    planningRevision: original.expectedSnapshot.planningRevision + (original.action === "GENERATE_PROFILE" ? 1 : 0),
    sourceId: original.action === "APPEND_TEXT" ? "source~00" : null,
    confirmationBatchId: original.action === "CONFIRM_FIELDS" || original.action === "GENERATE_PROFILE" ? "batch~original" : null,
    briefId: original.action === "GENERATE_PROFILE" ? "brief~original" : null,
    briefVersion: original.action === "GENERATE_PROFILE" ? 2 : null, replayed: false };
}
function rehashState(value: CampaignAgentState): CampaignAgentState {
  const { stateHash: discarded, ...body } = value; void discarded;
  // Return raw shape intentionally: malformed coverage must reach browser decoder.
  return { ...body, stateHash: canonicalHash({ domain: "infame-campaign-agent-state-v1", ...body }) };
}

it("matches actual server canonical SHA256 for literal JSON and central parsed values while rejecting unsupported browser transport without touching getters", async () => {
  expect(globalThis.crypto?.subtle).toBeDefined();
  const inputs = [null, false, [], -0, "  العربية\noriginal\t ", { amountMinor: "9223372036854775807", currencyCode: "KWD" },
    { "10": "ten", "2": "two", z: "last", a: "first" }, { astral: "🙂𐐷", lone: "\ud800", nul: "\u0000" },
    { a: [null, false, [], { y: "نص", x: 1 }], z: "original" }];
  for (const input of inputs) expect(await browserCanonicalHash(input)).toBe(canonicalHash(input));
  expect(browserCanonicalJson({ "10": "ten", "2": "two", a: "first" })).toBe('{"2":"two","10":"ten","a":"first"}');
  expect(await browserCanonicalHash({ z: 2, a: 1 })).toBe(await browserCanonicalHash({ a: 1, z: 2 }));
  expect(await browserCanonicalHash([1, 2])).not.toBe(await browserCanonicalHash([2, 1]));
  expect(await browserCanonicalHash(" كلمة ")).not.toBe(await browserCanonicalHash("كلمة"));
  const rawDeliverables = [{ platform: "INSTAGRAM", format: "STORY", count: 1 },
    { platform: "TIKTOK", format: "VIDEO", count: 2 }, { platform: "INSTAGRAM", format: "STORY", count: 3 }];
  const central = CampaignFieldObjectSchema.shape.deliverables.parse(rawDeliverables);
  expect(central).toEqual([{ platform: "INSTAGRAM", format: "STORY", count: 4 }, { platform: "TIKTOK", format: "VIDEO", count: 2 }]);
  expect(await browserCanonicalHash({ field: "deliverables", value: central })).toBe(canonicalHash({ field: "deliverables", value: central }));
  expect(await browserCanonicalHash({ field: "deliverables", value: rawDeliverables })).not.toBe(await browserCanonicalHash({ field: "deliverables", value: central }));
  const exact = "x".repeat(524286); expect(new TextEncoder().encode(JSON.stringify(exact)).byteLength).toBe(524288);
  expect(await browserCanonicalHash(exact)).toBe(canonicalHash(exact));
  expect(() => checkedBrowserJson(exact + "x")).toThrow();
  let deep: unknown = 0; for (let index = 0; index < 12; index++) deep = { next: deep };
  expect(await browserCanonicalHash(deep)).toBe(canonicalHash(deep));
  expect(() => checkedBrowserJson({ next: deep })).toThrow();
  let accessed = false; const accessor = Object.defineProperty({}, "value", { enumerable: true, get: () => { accessed = true; return "unsafe"; } });
  const nonEnumerable = Object.defineProperty({}, "value", { enumerable: false, value: "hidden" });
  const sparse = new Array(2), extended = Object.assign([1], { extra: true });
  for (const invalid of [undefined, Number.NaN, Number.POSITIVE_INFINITY, BigInt(1), new Date(instant), new Map(), () => 1,
    Object.create(null), Object.create({ inherited: "not parsed JSON" }), accessor, nonEnumerable, sparse, extended,
    { [Symbol("hidden")]: "unsafe" }, JSON.parse('{"__proto__":{}}'), { constructor: {} }, { prototype: {} }]) {
    expect(() => checkedBrowserJson(invalid)).toThrow();
  }
  expect(accessed).toBe(false);
});

it("decodes only exact scoped current or historical DTOs and bounded exclusive source pages with verified hashes and truthful coverage", async () => {
  const current = read(true); expect(await decodeCampaignAgentRead(current, binding)).toEqual(current);
  const partial = read(false, {}); expect(await decodeCampaignAgentRead(partial, binding)).toEqual(partial);
  const absent: CampaignAgentRead = { ...partial, retained: null, coverage: "NOT_INITIALIZED" };
  expect(await decodeCampaignAgentRead(absent, binding)).toEqual(absent);
  const returned = { ...snapshot(), campaignRevision: 9, fieldsRevision: 9 };
  const stale: CampaignAgentRead = { ...current, current: { snapshot: returned, fields }, coverage: "STALE" };
  expect(returned.fieldsHash).toBe(current.current.snapshot.fieldsHash);
  expect(await decodeCampaignAgentRead(stale, binding)).toEqual(stale);
  const changedValue = { ...fields, title: "Changed current title" };
  const badValuePin = rehashState({ ...current.retained!, confirmation: current.retained!.confirmation.kind === "REVIEWED_SET"
    ? { ...current.retained!.confirmation, fields: current.retained!.confirmation.fields.map((item, index) => index === 0 ? { ...item, valueHash: "a".repeat(64) } : item) }
    : current.retained!.confirmation });
  const duplicateID = rehashState({ ...current.retained!, confirmation: current.retained!.confirmation.kind === "REVIEWED_SET"
    ? { ...current.retained!.confirmation, fields: current.retained!.confirmation.fields.map(item => ({ ...item, id: "duplicate~confirmation" })) }
    : current.retained!.confirmation });
  const foreign: AgentBinding = { ...binding, workspaceId: "workspace~foreign", campaignId: "campaign~foreign" };
  for (const malformed of [{ ...current, binding: foreign }, { ...current, current: { ...current.current, fields: changedValue } },
    { ...current, retained: { ...current.retained!, stateHash: "b".repeat(64) } }, { ...current, retained: badValuePin },
    { ...current, retained: duplicateID }, { ...stale, coverage: "CURRENT" }, { ...absent, coverage: "CURRENT" },
    { ...partial, coverage: "CURRENT" }, { ...current, readyForBrief: true }, { ...current, providerEnabled: true },
    { ...current, retained: { ...current.retained!, assistance: { kind: "AI", agent: "RUNNING" } } },
    { ...current, current: { ...current.current, fields: { ...fields, budget: { amountMinor: 123, currencyCode: "KWD" } } } }]) {
    await expect(decodeCampaignAgentRead(malformed, binding)).rejects.toThrow();
  }
  const row = source(), exactPage = page([row]); expect(await decodeCampaignAgentSources(exactPage, binding, "agent~original", null)).toEqual(exactPage);
  expect(row.originalText.text).toBe("  كلمات أصلية\nExact original words  ");
  const twenty = Array.from({ length: 20 }, (_, index) => source("source~" + String(index).padStart(2, "0")));
  expect((await decodeCampaignAgentSources(page(twenty, twenty.at(-1)!.id), binding, "agent~original", null)).sources).toHaveLength(20);
  const large = Array.from({ length: 5 }, (_, index) => source("large~" + index, "漢".repeat(19000)));
  const withinBytes = page(large.slice(0, 4), large[3]!.id), overBytes = page(large);
  expect(new TextEncoder().encode(JSON.stringify(withinBytes)).byteLength).toBeLessThan(262144);
  expect(new TextEncoder().encode(JSON.stringify(overBytes)).byteLength).toBeGreaterThan(262144);
  expect((await decodeCampaignAgentSources(withinBytes, binding, "agent~original", null)).sources[0]!.originalText.text).toBe(large[0]!.originalText.text);
  for (const malformed of [overBytes, page([...twenty, source("source~20")]), page([row, row]), page([...twenty].reverse()),
    page([row], "source~foreign"), page([], "source~00"), { ...exactPage, agentId: "agent~foreign" },
    { ...exactPage, binding: foreign }, { ...exactPage, sources: [{ ...row, sourceHash: "a".repeat(64) }] },
    { ...exactPage, sources: [{ ...row, originalText: { ...row.originalText, text: row.originalText.text.trim() } }] },
    { ...exactPage, sources: [{ ...row, kind: "VOICE_MESSAGE" }] }, { ...exactPage, limit: 20 }]) {
    await expect(decodeCampaignAgentSources(malformed, binding, "agent~original", null)).rejects.toThrow();
  }
  await expect(decodeCampaignAgentSources(exactPage, binding, "agent~original", row.id)).rejects.toThrow();
  expect(await decodeCampaignAgentSources(page([], null), binding, "agent~original", row.id)).toEqual(page([], null));
});

it("preserves strict original commands, independent modes and complete review hashes while accepting receipts only for their exact scoped revisions and current acknowledgment", async () => {
  const current = await decodeCampaignAgentRead(read(true), binding), rows = await campaignAgentReviewRows(current);
  expect(rows.map(item => item.field)).toEqual(keys); expect(rows.every(item => item.present)).toBe(true);
  for (const row of rows) expect(row.valueHash).toBe(fieldHash(row.field, fields[row.field]));
  const missing = await campaignAgentReviewRows({ ...read(false, {}), retained: null, coverage: "NOT_INITIALIZED" });
  expect(missing).toHaveLength(30); expect(missing.every(item => !item.present && item.valueHash === "0".repeat(64))).toBe(true);
  const choices = rows.map(item => ({ field: item.field, valueHash: item.valueHash,
    source: { kind: "CUSTOMER_FIELD_CHOICE", capturedValueHash: item.valueHash } }));
  const text = { text: "  Exact original retry words\nكلمات أصلية  ", language: "ar" };
  const commands = [command("INITIALIZE", { preferences: { input: "TEXT", output: "TEXT" } }),
    command("SET_PREFERENCES", { preferences: { input: "MEDIA", output: "VOICE" } }),
    command("APPEND_TEXT", { originalText: text }), command("CONFIRM_FIELDS", { fields: choices }),
    command("GENERATE_PROFILE", { confirmationBatchId: "batch~original" })];
  for (const original of commands) {
    expect(parseCampaignAgentBrowserCommand(original)).toEqual(original);
    const value = receipt(original), decoded = decodeCampaignAgentReceipt(value, original, binding); expect(decoded).toEqual(value);
    const snap = { ...original.expectedSnapshot, campaignRevision: value.campaignRevision, planningRevision: value.planningRevision };
    let saved = state(original.action === "CONFIRM_FIELDS", fields, snap, binding, value.agentRevision);
    if (original.action === "INITIALIZE" || original.action === "SET_PREFERENCES") saved = rehashState({ ...saved, preferences: original.payload.preferences });
    if (original.action === "APPEND_TEXT") saved = rehashState({ ...saved, textSourceReferences: [{ id: value.sourceId!, sourceHash: source().sourceHash }] });
    const observed = await decodeCampaignAgentRead({ asOf: instant, binding, current: { snapshot: snap, fields }, retained: saved,
      coverage: original.action === "CONFIRM_FIELDS" ? "CURRENT" : "UNCONFIRMED" }, binding);
    expect(campaignAgentAcknowledges(original, decoded, observed)).toBe(true);
    expect(campaignAgentAcknowledges(original, { ...decoded, agentId: "agent~foreign" }, observed)).toBe(false);
    // A separately valid foreign-scoped read cannot acknowledge this command,
    // even when its technical counters and declared fields happen to match.
    const foreignBinding: AgentBinding = { ...binding, workspaceId: "workspace~foreign", campaignId: "campaign~foreign" };
    const foreignState = rehashState({ ...saved, binding: foreignBinding });
    const foreignRead = await decodeCampaignAgentRead({ ...observed, binding: foreignBinding, retained: foreignState }, foreignBinding);
    expect(campaignAgentAcknowledges(original, decoded, foreignRead)).toBe(false);
    for (const changed of [{ campaignId: "campaign~foreign" }, { workspaceId: "workspace~foreign" },
      { agentRevision: value.agentRevision + 1 }, { campaignRevision: value.campaignRevision + 1 },
      { planningRevision: value.planningRevision + 1 }, { actorUserId: "forged~actor" }, { approved: true }]) {
      expect(() => decodeCampaignAgentReceipt({ ...value, ...changed }, original, binding)).toThrow();
    }
  }
  const appended = commands.find(item => item.action === "APPEND_TEXT")!;
  if (appended.action !== "APPEND_TEXT") throw new Error("Expected original APPEND fixture");
  expect((parseCampaignAgentBrowserCommand(appended) as typeof appended).payload.originalText).toEqual(text);
  for (const extra of [{ channel: "FORM" }, { workspaceId: binding.workspaceId }, { authorUserId: "forged~author" },
    { confirmedByUserId: "forged~actor" }, { now: instant }, { serverAuth: {} }, { sourceHash: "a".repeat(64) }]) {
    expect(() => parseCampaignAgentBrowserCommand({ ...appended, ...extra })).toThrow();
  }
  for (const input of ["TEXT", "MEDIA", "VOICE_MESSAGE", "LIVE_VOICE"] as const) for (const output of ["TEXT", "VOICE", "TEXT_AND_VOICE"] as const) {
    const original = command("SET_PREFERENCES", { preferences: { input, output } });
    expect(parseCampaignAgentBrowserCommand(original)).toEqual(original);
  }
  const overText = { text: "\ud800".repeat(12000), language: null };
  expect(OriginalTextSchema.safeParse(overText).success).toBe(true);
  const overBody = { ...appended, payload: { originalText: overText } };
  expect(new TextEncoder().encode(JSON.stringify(overBody)).byteLength).toBeGreaterThan(65536);
  expect(() => parseCampaignAgentBrowserCommand(overBody)).toThrow();
  expect(CampaignDraftFieldsSchema.parse(fields).budget).toEqual(fields.budget);
});

it("uses actual AES256-GCM with fresh96-bit nonces and frozen AAD for exact private command and nonrecursive barrier recovery, rejecting tampering or invalid lineage", async () => {
  expect(globalThis.crypto?.subtle).toBeDefined();
  const actorReference = "user~original", privateToken = "synthetic-private-token-canary";
  const originalText = { text: "  Exact private retry words\nكلمات الاستعادة الأصلية  " + privateToken, language: "ar" };
  const original = command("APPEND_TEXT", { originalText });
  const packet: CampaignAgentRecoveryPacket = { kind: "COMMAND", body: JSON.stringify(original),
    phase: "UNKNOWN", receipt: null, reviewed: false };
  const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
  const encoded = (value: Uint8Array) => Buffer.from(value).toString("base64url");
  const decoded = (value: string) => new Uint8Array(Buffer.from(value, "base64url"));
  async function material(): Promise<CampaignAgentRecoveryKey> {
    const raw = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const hashBytes = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", raw));
    const keyId = Array.from(hashBytes, byte => byte.toString(16).padStart(2, "0")).join("");
    return { schemaVersion: 1, asOf: instant, binding, actorReference, algorithm: "AES-GCM",
      keyId, keyBase64Url: encoded(raw) };
  }
  const keyMaterial = await material(), first = await sealCampaignAgentPacket(keyMaterial, actorReference, binding, packet);
  const second = await sealCampaignAgentPacket(keyMaterial, actorReference, binding, packet);
  expect(Object.keys(first).sort()).toEqual(["schemaVersion", "actorReference", "binding", "keyId", "ivBase64Url", "ciphertextBase64Url"].sort());
  expect(first.schemaVersion).toBe(1); expect(first.actorReference).toBe(actorReference); expect(first.binding).toEqual(binding);
  expect(first.keyId === keyMaterial.keyId).toBe(true);
  expect(decoded(first.ivBase64Url).byteLength).toBe(12); expect(first.ivBase64Url).toMatch(/^[A-Za-z0-9_-]{16}$/);
  expect(first.ivBase64Url !== second.ivBase64Url).toBe(true);
  expect(first.ciphertextBase64Url !== second.ciphertextBase64Url).toBe(true);
  expect(decoded(first.ciphertextBase64Url).byteLength).toBe(bytes(JSON.stringify(packet)) + 16);
  const serializedEnvelope = JSON.stringify(first);
  for (const forbidden of [packet.body, originalText.text, "Exact private retry words", privateToken, keyMaterial.keyBase64Url, "originalText"]) {
    // Boolean assertions cannot dump key material or private packet words.
    expect(!serializedEnvelope.includes(forbidden)).toBe(true);
  }
  const opened = await openCampaignAgentPacket(keyMaterial, actorReference, binding, first);
  expect(browserCanonicalJson(opened) === browserCanonicalJson(packet)).toBe(true);
  const restoredCommand = parseCampaignAgentBrowserCommand(JSON.parse(opened.body));
  expect(restoredCommand.operationKey).toBe(original.operationKey); expect(restoredCommand.action).toBe("APPEND_TEXT");
  if (restoredCommand.action !== "APPEND_TEXT") throw new Error("Expected restored APPEND command");
  expect(restoredCommand.payload.originalText.text === originalText.text).toBe(true);
  expect(restoredCommand.payload.originalText.language).toBe(originalText.language);
  expect(opened.phase).toBe("UNKNOWN"); expect(opened.receipt).toBeNull(); expect(opened.reviewed).toBe(false);

  // Independent real AES decryption proves the exact frozen AAD and 128-bit tag,
  // not merely agreement between two potentially wrong application helpers.
  const cryptoKey = await globalThis.crypto.subtle.importKey("raw", decoded(keyMaterial.keyBase64Url), { name: "AES-GCM" }, false, ["decrypt"]);
  expect(cryptoKey.extractable).toBe(false);
  const aad = new TextEncoder().encode(browserCanonicalJson({ domain: "infame-campaign-agent-packet-v1",
    schemaVersion: first.schemaVersion, actorReference, binding, keyId: first.keyId }));
  const plaintext = await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv: decoded(first.ivBase64Url),
    additionalData: aad, tagLength: 128 }, cryptoKey, decoded(first.ciphertextBase64Url));
  expect(browserCanonicalJson(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext))) === browserCanonicalJson(packet)).toBe(true);
  const originalReceipt = receipt(original), confirmed: CampaignAgentRecoveryPacket = { ...packet,
    phase: "CONFIRMED", receipt: originalReceipt, reviewed: false };
  const confirmedEnvelope = await sealCampaignAgentPacket(keyMaterial, actorReference, binding, confirmed);
  const confirmedRead = await openCampaignAgentPacket(keyMaterial, actorReference, binding, confirmedEnvelope);
  expect(browserCanonicalJson(confirmedRead) === browserCanonicalJson(confirmed)).toBe(true);
  const conflict: CampaignAgentRecoveryPacket = { ...packet, phase: "CONFLICT", receipt: null, reviewed: true };
  expect(browserCanonicalJson(await openCampaignAgentPacket(keyMaterial, actorReference, binding,
    await sealCampaignAgentPacket(keyMaterial, actorReference, binding, conflict))) === browserCanonicalJson(conflict)).toBe(true);

  async function rejected(operation: Promise<unknown>) {
    const error: unknown = await operation.then(() => null, (failure: unknown) => failure);
    expect(error instanceof Error).toBe(true);
    const message = error instanceof Error ? error.message : "";
    for (const forbidden of [originalText.text, privateToken, keyMaterial.keyBase64Url]) expect(!message.includes(forbidden)).toBe(true);
  }
  const foreignBinding: AgentBinding = { ...binding, campaignId: "campaign~foreign", workspaceId: "workspace~foreign" };
  await rejected(openCampaignAgentPacket(keyMaterial, "user~foreign", binding, first));
  await rejected(openCampaignAgentPacket(keyMaterial, actorReference, foreignBinding, first));
  await rejected(sealCampaignAgentPacket(keyMaterial, "user~foreign", binding, packet));
  await rejected(sealCampaignAgentPacket(keyMaterial, actorReference, foreignBinding, packet));
  const otherKey = await material();
  await rejected(openCampaignAgentPacket(otherKey, actorReference, binding, { ...first, keyId: otherKey.keyId }));
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const tail = keyMaterial.keyBase64Url.at(-1)!;
  const noncanonicalKey = keyMaterial.keyBase64Url.slice(0, -1) + alphabet[alphabet.indexOf(tail) | 1]!;
  expect(encoded(decoded(noncanonicalKey)) === keyMaterial.keyBase64Url).toBe(true);
  for (const malformed of [{ ...keyMaterial, keyId: "f".repeat(64) },
    { ...keyMaterial, keyBase64Url: keyMaterial.keyBase64Url + "=" }, { ...keyMaterial, keyBase64Url: noncanonicalKey },
    { ...keyMaterial, keyBase64Url: encoded(new Uint8Array(31)) }, { ...keyMaterial, algorithm: "AES-CBC" },
    { ...keyMaterial, actorReference: "user~foreign" }, { ...keyMaterial, binding: foreignBinding }]) {
    await rejected(sealCampaignAgentPacket(malformed as CampaignAgentRecoveryKey, actorReference, binding, packet));
    await rejected(openCampaignAgentPacket(malformed as CampaignAgentRecoveryKey, actorReference, binding, first));
  }
  const alteredCipher = decoded(first.ciphertextBase64Url); alteredCipher[0] = alteredCipher[0]! ^ 1;
  const alteredTag = decoded(first.ciphertextBase64Url); alteredTag[alteredTag.length - 1] = alteredTag[alteredTag.length - 1]! ^ 1;
  const alteredIv = decoded(first.ivBase64Url); alteredIv[0] = alteredIv[0]! ^ 1;
  for (const malformed of [{ ...first, actorReference: "user~foreign" }, { ...first, binding: foreignBinding },
    { ...first, keyId: "f".repeat(64) }, { ...first, ivBase64Url: encoded(new Uint8Array(11)) },
    { ...first, ivBase64Url: first.ivBase64Url + "=" }, { ...first, ivBase64Url: encoded(alteredIv) },
    { ...first, ciphertextBase64Url: encoded(alteredCipher) }, { ...first, ciphertextBase64Url: encoded(alteredTag) },
    { ...first, ciphertextBase64Url: encoded(new Uint8Array(15)) }, { ...first, ciphertextBase64Url: first.ciphertextBase64Url + "=" },
    { ...first, ciphertextBase64Url: "A".repeat(270337) }, { ...first, plaintext: packet.body },
    Object.assign(Object.create({ inherited: true }), first), { ...first, constructor: {} }]) {
    await rejected(openCampaignAgentPacket(keyMaterial, actorReference, binding, malformed as CampaignAgentEncryptedEnvelope));
  }
  for (const malformed of [{ ...packet, reviewed: true }, { ...packet, receipt: originalReceipt },
    { ...confirmed, receipt: null }, { ...confirmed, receipt: { ...originalReceipt, sourceId: null } },
    { ...confirmed, receipt: { ...originalReceipt, workspaceId: "workspace~foreign" } },
    { ...confirmed, receipt: { ...originalReceipt, agentRevision: originalReceipt.agentRevision + 1 } },
    { ...packet, phase: "RUNNING" }, { ...packet, command: original }, { ...packet, body: "{}" },
    { ...packet, body: JSON.stringify({ ...original, channel: "FORM" }) },
    Object.assign(Object.create({ inherited: true }), packet), { ...packet, constructor: {} }]) {
    await rejected(sealCampaignAgentPacket(keyMaterial, actorReference, binding, malformed as CampaignAgentRecoveryPacket));
  }
  const excessiveText = { text: "\ud800".repeat(12000), language: null };
  expect(OriginalTextSchema.safeParse(excessiveText).success).toBe(true);
  const excessiveBody = JSON.stringify({ ...original, payload: { originalText: excessiveText } });
  expect(bytes(excessiveBody)).toBeGreaterThan(65536);
  await rejected(sealCampaignAgentPacket(keyMaterial, actorReference, binding, { ...packet, body: excessiveBody }));

  const target = CampaignAgentRecoveryTargetSchema.parse({ operationKey: original.operationKey, action: original.action,
    expectedAgentRevision: original.expectedAgentRevision, expectedSnapshot: original.expectedSnapshot,
    commandHash: canonicalHash({ domain: "infame-campaign-agent-command-v1", actorUserId: actorReference, command: original }),
    payload: { originalTextHash: canonicalHash({ domain: "infame-agent-recovery-text-v1", originalText }) } });
  const barrier = CampaignAgentBarrierCommandSchema.parse({ operationKey: "22222222-2222-4222-8222-222222222222",
    scope: binding.scope, campaignId: binding.campaignId, expectedAgentRevision: 1, expectedSnapshot: snapshot(), target, initialPreferences: null });
  const barrierPacket: CampaignAgentRecoveryPacket = { kind: "RECOVERY_BARRIER", body: JSON.stringify(barrier),
    phase: "UNKNOWN", receipt: null, reviewed: false };
  expect(browserCanonicalJson(await openCampaignAgentPacket(keyMaterial, actorReference, binding,
    await sealCampaignAgentPacket(keyMaterial, actorReference, binding, barrierPacket))) === browserCanonicalJson(barrierPacket)).toBe(true);
  const barrierReceipt = CampaignAgentBarrierResultSchema.parse({ action: "RECOVERY_BARRIER", agentId: "agent~original",
    campaignId: binding.campaignId, workspaceId: binding.workspaceId, agentRevision: 2, campaignRevision: snapshot().campaignRevision,
    planningRevision: snapshot().planningRevision, targetOperationKey: target.operationKey, targetCommandHash: target.commandHash,
    targetOutcome: "FENCED", originalReceipt: null, replayed: false });
  const confirmedBarrier: CampaignAgentRecoveryPacket = { ...barrierPacket, phase: "CONFIRMED", receipt: barrierReceipt };
  expect(browserCanonicalJson(await openCampaignAgentPacket(keyMaterial, actorReference, binding,
    await sealCampaignAgentPacket(keyMaterial, actorReference, binding, confirmedBarrier))) === browserCanonicalJson(confirmedBarrier)).toBe(true);
  // An original APPEND committed first: an explicitly refreshed barrier has a
  // later agent horizon and must pin exactly that original producer receipt.
  const committedBarrier = CampaignAgentBarrierCommandSchema.parse({ ...barrier, expectedAgentRevision: originalReceipt.agentRevision });
  const committedReceipt = CampaignAgentBarrierResultSchema.parse({ ...barrierReceipt,
    agentRevision: committedBarrier.expectedAgentRevision + 1, targetOutcome: "COMMITTED", originalReceipt });
  const committedPacket: CampaignAgentRecoveryPacket = { ...barrierPacket, body: JSON.stringify(committedBarrier),
    phase: "CONFIRMED", receipt: committedReceipt };
  expect(browserCanonicalJson(await openCampaignAgentPacket(keyMaterial, actorReference, binding,
    await sealCampaignAgentPacket(keyMaterial, actorReference, binding, committedPacket))) === browserCanonicalJson(committedPacket)).toBe(true);
  const generatedCommand = command("GENERATE_PROFILE", { confirmationBatchId: "batch~original" });
  const generatedReceipt = receipt(generatedCommand);
  const generatedTarget = CampaignAgentRecoveryTargetSchema.parse({ operationKey: generatedCommand.operationKey, action: generatedCommand.action,
    expectedAgentRevision: generatedCommand.expectedAgentRevision, expectedSnapshot: generatedCommand.expectedSnapshot,
    commandHash: canonicalHash({ domain: "infame-campaign-agent-command-v1", actorUserId: actorReference, command: generatedCommand }),
    payload: { confirmationBatchId: "batch~original" } });
  const generatedBarrier = CampaignAgentBarrierCommandSchema.parse({ ...barrier, expectedAgentRevision: generatedReceipt.agentRevision,
    expectedSnapshot: { ...snapshot(), campaignRevision: generatedReceipt.campaignRevision, planningRevision: generatedReceipt.planningRevision }, target: generatedTarget });
  const generatedBarrierReceipt = CampaignAgentBarrierResultSchema.parse({ ...barrierReceipt,
    agentRevision: generatedBarrier.expectedAgentRevision + 1, campaignRevision: generatedReceipt.campaignRevision,
    planningRevision: generatedReceipt.planningRevision, targetCommandHash: generatedTarget.commandHash,
    targetOutcome: "COMMITTED", originalReceipt: generatedReceipt });
  const generatedPacket: CampaignAgentRecoveryPacket = { ...barrierPacket, body: JSON.stringify(generatedBarrier),
    phase: "CONFIRMED", receipt: generatedBarrierReceipt };
  expect(browserCanonicalJson(await openCampaignAgentPacket(keyMaterial, actorReference, binding,
    await sealCampaignAgentPacket(keyMaterial, actorReference, binding, generatedPacket))) === browserCanonicalJson(generatedPacket)).toBe(true);
  const cjkCommand = command("APPEND_TEXT", { originalText: { text: "漢".repeat(15000), language: "zh" } });
  const compactCjkBody = JSON.stringify(cjkCommand);
  expect(bytes(compactCjkBody)).toBeLessThan(65536);
  const paddedCjkBody = compactCjkBody + " ".repeat(65537 - bytes(compactCjkBody));
  expect(bytes(paddedCjkBody)).toBe(65537); expect(paddedCjkBody.length).toBeLessThan(65536);
  expect(CampaignAgentCommandSchema.parse(JSON.parse(paddedCjkBody))).toEqual(cjkCommand);
  const wrongActionReceipt = receipt(command("INITIALIZE", { preferences: { input: "TEXT", output: "TEXT" } }));
  const mismatchCases: Array<{ name: string; packet: CampaignAgentRecoveryPacket }> = [
    { name: "committed-original-action", packet: { ...committedPacket, receipt: { ...committedReceipt, originalReceipt: wrongActionReceipt } } },
    { name: "committed-original-agent-revision", packet: { ...committedPacket, receipt: { ...committedReceipt,
      originalReceipt: { ...originalReceipt, agentRevision: originalReceipt.agentRevision - 1 } } } },
    { name: "committed-original-campaign-revision", packet: { ...committedPacket, receipt: { ...committedReceipt,
      originalReceipt: { ...originalReceipt, campaignRevision: originalReceipt.campaignRevision + 1 } } } },
    { name: "committed-original-planning-revision", packet: { ...committedPacket, receipt: { ...committedReceipt,
      originalReceipt: { ...originalReceipt, planningRevision: originalReceipt.planningRevision + 1 } } } },
    { name: "committed-generate-batch", packet: { ...generatedPacket, receipt: { ...generatedBarrierReceipt,
      originalReceipt: { ...generatedReceipt, confirmationBatchId: "batch~foreign" } } } },
    { name: "exact-wire-utf8-overflow", packet: { ...packet, body: paddedCjkBody } },
  ];
  // Exercise both review findings before asserting; report only safe case labels
  // and booleans, never ciphertext keys or the retained customer words.
  const outcomes = await Promise.all(mismatchCases.map(async item => ({ name: item.name,
    rejected: await sealCampaignAgentPacket(keyMaterial, actorReference, binding, item.packet).then(() => false, () => true) })));
  expect(outcomes).toEqual(mismatchCases.map(item => ({ name: item.name, rejected: true })));
  // WebCrypto digest/import awaits must not make caller-owned objects become
  // late input. Mutation is immediate and crypto remains entirely real.
  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const sealMaterial = clone(keyMaterial), sealBinding = clone(binding), sealPacket = clone(packet);
  const sealing = sealCampaignAgentPacket(sealMaterial, actorReference, sealBinding, sealPacket);
  sealMaterial.keyId = "f".repeat(64); sealMaterial.binding.campaignId = "campaign~changed-key-input";
  sealBinding.campaignId = "campaign~changed-binding"; sealBinding.workspaceId = "workspace~changed-binding";
  sealPacket.body = JSON.stringify({ ...original, campaignId: sealBinding.campaignId,
    payload: { originalText: { text: "Mutated transient customer words", language: "en" } } });
  const openMaterial = clone(keyMaterial), openBinding = clone(binding), openEnvelope = clone(first);
  const opening = openCampaignAgentPacket(openMaterial, actorReference, openBinding, openEnvelope);
  openMaterial.keyId = "f".repeat(64); openMaterial.binding.campaignId = "campaign~changed-key-input";
  openBinding.campaignId = "campaign~changed-binding"; openBinding.workspaceId = "workspace~changed-binding";
  openEnvelope.keyId = "f".repeat(64); openEnvelope.binding = clone(openBinding);
  openEnvelope.ivBase64Url = confirmedEnvelope.ivBase64Url; openEnvelope.ciphertextBase64Url = confirmedEnvelope.ciphertextBase64Url;
  // A separately valid later envelope isolates the ciphertext-pointer race:
  // no invalid metadata is necessary to restore the wrong captured phase.
  const pointerEnvelope = clone(first);
  const pointerOpening = openCampaignAgentPacket(keyMaterial, actorReference, binding, pointerEnvelope);
  pointerEnvelope.ivBase64Url = confirmedEnvelope.ivBase64Url;
  pointerEnvelope.ciphertextBase64Url = confirmedEnvelope.ciphertextBase64Url;
  const mutationOutcomes = await Promise.all([
    sealing.then(async saved => ({ name: "seal-entry-material-binding-body", preserved:
      saved.keyId === keyMaterial.keyId && browserCanonicalJson(saved.binding) === browserCanonicalJson(binding)
      && browserCanonicalJson(await openCampaignAgentPacket(keyMaterial, actorReference, binding, saved)) === browserCanonicalJson(packet) }))
      .catch(() => ({ name: "seal-entry-material-binding-body", preserved: false })),
    opening.then(saved => ({ name: "open-entry-material-binding-envelope", preserved: browserCanonicalJson(saved) === browserCanonicalJson(packet) }))
      .catch(() => ({ name: "open-entry-material-binding-envelope", preserved: false })),
    pointerOpening.then(saved => ({ name: "open-entry-valid-cipher-pointers", preserved: browserCanonicalJson(saved) === browserCanonicalJson(packet) }))
      .catch(() => ({ name: "open-entry-valid-cipher-pointers", preserved: false })),
  ]);
  expect(mutationOutcomes).toEqual([
    { name: "seal-entry-material-binding-body", preserved: true },
    { name: "open-entry-material-binding-envelope", preserved: true },
    { name: "open-entry-valid-cipher-pointers", preserved: true },
  ]);
  await rejected(sealCampaignAgentPacket(keyMaterial, actorReference, binding, { ...confirmedBarrier, receipt: originalReceipt }));
  await rejected(sealCampaignAgentPacket(keyMaterial, actorReference, binding, { ...confirmed, receipt: barrierReceipt }));
  await rejected(sealCampaignAgentPacket(keyMaterial, actorReference, binding, { ...barrierPacket,
    body: JSON.stringify({ ...barrier, target: { kind: "RECOVERY_BARRIER", command: barrier, commandHash: target.commandHash } }) }));
});
