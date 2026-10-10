import type { AgentBinding } from "./contracts";
import type { CampaignAgentResult } from "./native-contracts";
import type { CampaignAgentRecoveryKey, CampaignAgentBarrierResult } from "./recovery-contracts";
import { z } from "zod";
import { PlanningScopeSchema } from "@/lib/brand-context/contracts";
import { PlanningSelectionSchema } from "@/lib/campaign-planning/contracts";
import { CampaignFieldObjectSchema } from "@/lib/campaigns/contracts";
import { ClientAuthoritySchema, OrganizationIdSchema as id, OrganizationRevisionSchema as revision } from "@/lib/organizations/contracts";
import { UtcDateTimeSchema } from "@/lib/contracts/vocabulary";
import { browserCanonicalJson, checkedBrowserJson, parseCampaignAgentBrowserCommand, decodeCampaignAgentReceipt,
  CampaignAgentBrowserError } from "./browser";

export type CampaignAgentRecoveryPacket = { kind: "COMMAND" | "RECOVERY_BARRIER"; body: string;
  phase: "UNKNOWN" | "CONFIRMED" | "CONFLICT"; receipt: CampaignAgentResult | CampaignAgentBarrierResult | null; reviewed: boolean };
export type CampaignAgentEncryptedEnvelope = { schemaVersion: 1; actorReference: string; binding: AgentBinding;
  keyId: string; ivBase64Url: string; ciphertextBase64Url: string };
const fail = (): never => { throw new CampaignAgentBrowserError("INVALID_RECOVERY_PACKET"); };
const same = (a: unknown, b: unknown) => browserCanonicalJson(a) === browserCanonicalJson(b);
function parsed<T>(schema: z.ZodType<T>, value: unknown, maximum = 270336): T {
  checkedBrowserJson(value, maximum); const result = schema.safeParse(value); return result.success ? result.data : fail();
}
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const bindingShape = z.object({ scope: PlanningScopeSchema, workspaceId: id, campaignId: id }).strict();
const prefs = z.object({ input: z.enum(["TEXT", "MEDIA", "VOICE_MESSAGE", "LIVE_VOICE"]), output: z.enum(["TEXT", "VOICE", "TEXT_AND_VOICE"]) }).strict();
const snapshot = z.object({ campaignRevision: revision, fieldsRevision: revision, planningRevision: revision,
  selection: PlanningSelectionSchema, fieldsHash: hash }).strict().refine(value => value.fieldsRevision <= value.campaignRevision);
const plan = ClientAuthoritySchema.extend({ capability: z.literal("plan") }).strict();
const ref = z.object({ id, sourceHash: hash }).strict();
const choice = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CUSTOMER_FIELD_CHOICE"), capturedValueHash: hash }).strict(),
  z.object({ kind: z.literal("CUSTOMER_TEXT"), references: z.array(ref).min(1).max(4)
    .refine(items => items.every((item, index) => index === 0 || items[index - 1]!.id < item.id)) }).strict(),
]);
const choices = z.array(z.object({ field: CampaignFieldObjectSchema.keyof(), valueHash: hash, source: choice }).strict())
  .length(30).refine(items => items.every((item, index) => item.field === CampaignFieldObjectSchema.keyof().options[index]));
const meta = { operationKey: z.uuid(), commandHash: hash, expectedSnapshot: snapshot, expectedAuthority: plan.optional() };
const target = z.discriminatedUnion("action", [
  z.object({ ...meta, action: z.literal("INITIALIZE"), expectedAgentRevision: z.literal(0), payload: z.object({ preferences: prefs }).strict() }).strict(),
  z.object({ ...meta, action: z.literal("SET_PREFERENCES"), expectedAgentRevision: revision, payload: z.object({ preferences: prefs }).strict() }).strict(),
  z.object({ ...meta, action: z.literal("APPEND_TEXT"), expectedAgentRevision: revision, payload: z.object({ originalTextHash: hash }).strict() }).strict(),
  z.object({ ...meta, action: z.literal("CONFIRM_FIELDS"), expectedAgentRevision: revision, payload: z.object({ fields: choices }).strict() }).strict(),
  z.object({ ...meta, action: z.literal("GENERATE_PROFILE"), expectedAgentRevision: revision, payload: z.object({ confirmationBatchId: id }).strict() }).strict(),
]);
const barrier = z.object({ operationKey: z.uuid(), scope: PlanningScopeSchema, campaignId: id,
  expectedAgentRevision: z.number().int().min(0).max(2147483646), expectedSnapshot: snapshot, expectedAuthority: plan.optional(),
  target, initialPreferences: prefs.nullable() }).strict().refine(value => value.operationKey.toLowerCase() !== value.target.operationKey.toLowerCase()
    && (value.scope.kind === "OWN_BRAND" ? value.expectedAuthority === undefined && value.target.expectedAuthority === undefined
      : value.expectedAuthority?.clientId === value.scope.clientId && value.target.expectedAuthority?.clientId === value.scope.clientId));
const ordinaryReceipt = z.object({ agentId: id, campaignId: id, workspaceId: id,
  action: z.enum(["INITIALIZE", "SET_PREFERENCES", "APPEND_TEXT", "CONFIRM_FIELDS", "GENERATE_PROFILE"]),
  agentRevision: revision, campaignRevision: revision, planningRevision: revision, sourceId: id.nullable(), confirmationBatchId: id.nullable(),
  briefId: id.nullable(), briefVersion: revision.nullable(), replayed: z.boolean() }).strict()
  .refine(value => (value.sourceId !== null) === (value.action === "APPEND_TEXT")
    && (value.confirmationBatchId !== null) === ["CONFIRM_FIELDS", "GENERATE_PROFILE"].includes(value.action)
    && (value.briefId !== null) === (value.action === "GENERATE_PROFILE") && (value.briefVersion !== null) === (value.briefId !== null));
const barrierReceipt = z.object({ action: z.literal("RECOVERY_BARRIER"), agentId: id, campaignId: id, workspaceId: id,
  agentRevision: revision, campaignRevision: revision, planningRevision: revision, targetOperationKey: z.uuid(), targetCommandHash: hash,
  targetOutcome: z.enum(["COMMITTED", "FENCED"]), originalReceipt: ordinaryReceipt.nullable(), replayed: z.boolean() }).strict()
  .refine(value => (value.targetOutcome === "COMMITTED") === (value.originalReceipt !== null));
const packetShape = z.object({ kind: z.enum(["COMMAND", "RECOVERY_BARRIER"]), body: z.string().min(1).max(65536),
  phase: z.enum(["UNKNOWN", "CONFIRMED", "CONFLICT"]), receipt: z.unknown().nullable(), reviewed: z.boolean() }).strict();
function packet(value: unknown, binding: AgentBinding): CampaignAgentRecoveryPacket {
  const result = parsed(packetShape, value, 196608);
  if (new TextEncoder().encode(result.body).byteLength > 65536) return fail();
  let body: unknown;
  try { body = JSON.parse(result.body); } catch { return fail(); }
  checkedBrowserJson(body, 65536);
  const command = result.kind === "COMMAND" ? parseCampaignAgentBrowserCommand(body) : parsed(barrier, body, 65536);
  if (!same(body, command) || command.campaignId !== binding.campaignId || !same(command.scope, binding.scope)
    || result.phase === "UNKNOWN" && result.reviewed || (result.phase === "CONFIRMED") !== (result.receipt !== null)) return fail();
  let receipt: CampaignAgentResult | CampaignAgentBarrierResult | null = null;
  if (result.receipt !== null) {
    if (result.kind === "COMMAND") receipt = decodeCampaignAgentReceipt(result.receipt, parseCampaignAgentBrowserCommand(body), binding);
    else {
      const original = parsed(barrier, body, 65536), value = parsed(barrierReceipt, result.receipt, 4096);
      if (value.campaignId !== binding.campaignId || value.workspaceId !== binding.workspaceId || value.agentRevision !== original.expectedAgentRevision + 1
        || value.campaignRevision !== original.expectedSnapshot.campaignRevision || value.planningRevision !== original.expectedSnapshot.planningRevision
        || value.targetOperationKey !== original.target.operationKey || value.targetCommandHash !== original.target.commandHash
        || value.originalReceipt && (value.originalReceipt.agentId !== value.agentId || value.originalReceipt.campaignId !== value.campaignId
          || value.originalReceipt.workspaceId !== value.workspaceId || value.originalReceipt.agentRevision >= value.agentRevision)) return fail();
      if (value.originalReceipt) {
        const receipt = value.originalReceipt, target = original.target, generation = target.action === "GENERATE_PROFILE" ? 1 : 0;
        if (receipt.action !== target.action || receipt.agentRevision !== target.expectedAgentRevision + 1
          || receipt.campaignRevision !== target.expectedSnapshot.campaignRevision + generation
          || receipt.planningRevision !== target.expectedSnapshot.planningRevision + generation
          || target.action === "GENERATE_PROFILE" && receipt.confirmationBatchId !== target.payload.confirmationBatchId) return fail();
      }
      receipt = value;
    }
  }
  return { ...result, receipt };
}
const materialShape = z.object({ schemaVersion: z.literal(1), asOf: UtcDateTimeSchema, binding: bindingShape, actorReference: id,
  algorithm: z.literal("AES-GCM"), keyId: hash, keyBase64Url: z.string().length(43).regex(/^[A-Za-z0-9_-]+$/) }).strict();
const envelopeShape = z.object({ schemaVersion: z.literal(1), actorReference: id, binding: bindingShape, keyId: hash,
  ivBase64Url: z.string().length(16).regex(/^[A-Za-z0-9_-]+$/),
  ciphertextBase64Url: z.string().min(22).max(262166).regex(/^[A-Za-z0-9_-]+$/) }).strict();
function encoded(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let at = 0; at < bytes.length; at += 8192) chunks.push(String.fromCharCode(...bytes.subarray(at, at + 8192)));
  return btoa(chunks.join("")).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function decoded(value: string, maximum: number): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return fail();
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4)), char => char.charCodeAt(0)); }
  catch { return fail(); }
  if (bytes.length > maximum || encoded(bytes) !== value) return fail(); return bytes;
}
async function key(material: CampaignAgentRecoveryKey, actorReference: string, binding: AgentBinding): Promise<CryptoKey> {
  const value = parsed(materialShape, material, 8192), expected = parsed(bindingShape, binding, 4096);
  parsed(id, actorReference, 256);
  if (value.actorReference !== actorReference || !same(value.binding, expected) || !globalThis.crypto?.subtle) return fail();
  const bytes = decoded(value.keyBase64Url, 32); if (bytes.length !== 32) return fail();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
  if (digest !== value.keyId) return fail();
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
function aad(actorReference: string, binding: AgentBinding, keyId: string) {
  return new TextEncoder().encode(browserCanonicalJson({ domain: "infame-campaign-agent-packet-v1", schemaVersion: 1, actorReference, binding, keyId }));
}
export async function sealCampaignAgentPacket(material: CampaignAgentRecoveryKey, actorReference: string,
  binding: AgentBinding, packet: CampaignAgentRecoveryPacket): Promise<CampaignAgentEncryptedEnvelope> {
  const capturedMaterial = parsed(materialShape, material, 8192), value = parsed(bindingShape, binding, 4096), original = packetValue(packet, value);
  const cryptoKey = await key(capturedMaterial, actorReference, value), iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(original));
  if (plaintext.length > 196608) return fail();
  const bytes = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(actorReference, value, capturedMaterial.keyId), tagLength: 128 }, cryptoKey, plaintext);
  return parsed(envelopeShape, { schemaVersion: 1, actorReference, binding: value, keyId: capturedMaterial.keyId,
    ivBase64Url: encoded(iv), ciphertextBase64Url: encoded(new Uint8Array(bytes)) });
}
const packetValue = packet;
export async function openCampaignAgentPacket(material: CampaignAgentRecoveryKey, actorReference: string,
  binding: AgentBinding, envelope: CampaignAgentEncryptedEnvelope): Promise<CampaignAgentRecoveryPacket> {
  const capturedMaterial = parsed(materialShape, material, 8192), expected = parsed(bindingShape, binding, 4096), value = parsed(envelopeShape, envelope);
  if (value.actorReference !== actorReference || !same(value.binding, expected) || value.keyId !== capturedMaterial.keyId) return fail();
  const cryptoKey = await key(capturedMaterial, actorReference, expected);
  const iv = decoded(value.ivBase64Url, 12), cipher = decoded(value.ciphertextBase64Url, 196624);
  if (iv.length !== 12 || cipher.length < 16) return fail();
  try {
    const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad(actorReference, expected, value.keyId), tagLength: 128 }, cryptoKey, cipher);
    if (bytes.byteLength > 196608) return fail();
    return packet(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), expected);
  } catch { return fail(); }
}
