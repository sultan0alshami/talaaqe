// Exactly six pure contract groups; no DB,
// providers, registered test-module imports or runtime authorization claims.
import { expect, it } from "vitest";
import {
  AgentBindingSchema, AgentSnapshotSchema, CustomerTextSourceSchema,
  FieldConfirmationSchema, CampaignAgentStateSchema, CampaignAgentFieldKeys,
} from "@/lib/campaign-agent/contracts";
import { CampaignDraftFieldsSchema, CampaignFieldObjectSchema, CampaignFieldsSchema,
  type CampaignDraftFields } from "@/lib/campaigns/contracts";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { campaignFields } from "../campaigns/fixtures";

const instant = "2026-10-08T10:11:12.000Z";
const binding = { scope: { kind: "OWN_BRAND", brandId: "brand~original" },
  workspaceId: "workspace~original", campaignId: "campaign~original" };
const keys = Object.keys(CampaignFieldObjectSchema.shape);
const fullFields = CampaignFieldsSchema.parse({ ...campaignFields,
  title: "  حملة أصلية\nOriginal words  ", impressionsTarget: null,
  budget: { amountMinor: "9223372036854775807", currencyCode: "KWD" } });
const valueHash = (field: string, value: unknown) => canonicalHash({ domain: "infame-campaign-field-value-v1", field, value });
const fieldsHash = (fields: CampaignDraftFields) => canonicalHash({ domain: "infame-campaign-fields-v1", fields });

function resign<T extends object>(input: T, hashField: string, domain: string, excluded: string[] = []) {
  const body: Record<string, unknown> = Object.fromEntries(Object.entries(input));
  for (const field of [hashField, ...excluded]) delete body[field];
  return { ...input, [hashField]: canonicalHash({ domain, ...body }) } as T & Record<string, string>;
}
function snapshot(fields: CampaignDraftFields = fullFields, revision = 7) {
  return { campaignRevision: revision, fieldsRevision: revision, planningRevision: 5,
    selection: { id: "selection~original", revision: 3, kind: "NONE", versionId: null, contentHash: null },
    fieldsHash: fieldsHash(fields) };
}
function source(originalText = { text: "  فكرة أصلية\nMy exact original words  ", language: "ar" as string | null }) {
  return resign({ schemaVersion: 1, id: "source~original", binding, capturedSnapshot: snapshot(),
    authorUserId: "user~original", kind: "CUSTOMER_TEXT", originalText, createdAt: instant },
  "sourceHash", "infame-customer-text-v1");
}
function confirmation(field: string, value: unknown, refs?: Array<{ id: string; sourceHash: string }>) {
  const hash = valueHash(field, value);
  return resign({ schemaVersion: 1, id: "confirmation~" + field, binding, confirmationBatchId: "batch~original",
    reviewedSnapshot: snapshot(), field, value, valueHash: hash,
    source: refs ? { kind: "CUSTOMER_TEXT", references: refs } : { kind: "CUSTOMER_FIELD_CHOICE", capturedValueHash: hash },
    confirmedByUserId: "user~original", confirmedAt: instant }, "confirmationHash", "infame-field-confirmation-v1", ["value"]);
}
function state(fields: CampaignDraftFields = fullFields, reviewed = false) {
  const current = snapshot(fields);
  const confirmations = reviewed ? keys.map(field => confirmation(field, fields[field as keyof CampaignDraftFields])) : [];
  return resign({ schemaVersion: 1, id: "agent~original", revision: 1, binding, snapshot: current, fields,
    preferences: { input: "TEXT", output: "TEXT" }, assistance: { kind: "MANUAL_GUIDANCE", agent: "UNAVAILABLE" },
    textSourceReferences: [] as Array<{ id: string; sourceHash: string }>,
    confirmation: reviewed ? { kind: "REVIEWED_SET", confirmationBatchId: "batch~original", reviewedSnapshot: current,
      fields: confirmations.map(item => ({ field: item.field, id: item.id, valueHash: item.valueHash, confirmationHash: item.confirmationHash })) }
      : { kind: "UNCONFIRMED" }, updatedAt: instant }, "stateHash", "infame-campaign-agent-state-v1");
}
function rejected(schema: { safeParse(input: unknown): { success: boolean } }, input: unknown) {
  // Malformed/oversized transport remains a recoverable schema failure. It must
  // not escape as BigInt/JSON/codec/prototype or hashing exceptions.
  expect(() => schema.safeParse(input)).not.toThrow();
  expect(schema.safeParse(input).success).toBe(false);
}
const stateResign = <T extends object>(input: T) => resign(input, "stateHash", "infame-campaign-agent-state-v1");

it("uses the exact central 30 field keys and strict scope/snapshot grammar without implicit defaults or fabricated authority", () => {
  expect(keys).toHaveLength(30); expect(CampaignAgentFieldKeys).toEqual(keys);
  expect(AgentBindingSchema.parse(binding)).toEqual(binding);
  const client = { ...binding, scope: { kind: "CLIENT", clientId: "client~original" } };
  expect(AgentBindingSchema.parse(client)).toEqual(client);
  for (const bad of [{ ...binding, campaignId: "" }, { ...binding, workspaceId: "x".repeat(201) },
    { ...binding, campaignId: "unsafe id" }, { ...binding, scope: { ...binding.scope, clientId: "client~foreign" } },
    { ...client, scope: { ...client.scope, brandId: "brand~foreign" } }, { ...binding, approved: true }]) rejected(AgentBindingSchema, bad);
  expect(AgentSnapshotSchema.parse(snapshot())).toEqual(snapshot());
  for (const bad of [{ ...snapshot(), campaignRevision: 0 }, { ...snapshot(), fieldsRevision: 8 },
    { ...snapshot(), planningRevision: "5" }, { ...snapshot(), fieldsHash: "A".repeat(64) },
    { ...snapshot(), selection: { ...snapshot().selection, kind: "APPROVED_CONTEXT" } },
    { ...snapshot(), selection: { ...snapshot().selection, versionId: "version~foreign" } },
    { ...snapshot(), sessionVersion: 1 }]) rejected(AgentSnapshotSchema, bad);
  const empty = state({}, false);
  expect(CampaignAgentStateSchema.parse(empty).fields).toEqual({});
  expect(empty.snapshot.fieldsHash).not.toBe(fieldsHash({ desiredCreatorCount: 1 }));
});

it("binds immutable original customer text, author and historical snapshot hashes while rejecting forged origins, coercion and unsafe text", () => {
  const original = source(), parsed = CustomerTextSourceSchema.parse(original);
  expect(parsed.originalText).toEqual(original.originalText); expect(parsed).toEqual(original);
  expect(CustomerTextSourceSchema.parse(source({ text: "Exact undeclared words", language: null })).originalText.language).toBeNull();
  for (const changed of [{ id: "source~foreign" }, { binding: { ...binding, campaignId: "campaign~foreign" } },
    { authorUserId: "user~foreign" }, { capturedSnapshot: { ...snapshot(), campaignRevision: 8 } },
    { originalText: { ...original.originalText, text: original.originalText.text.trim() } },
    { originalText: { ...original.originalText, language: "en" } }, { createdAt: "2026-10-08T10:11:13.000Z" },
    { sourceHash: "a".repeat(64) }]) rejected(CustomerTextSourceSchema, { ...original, ...changed });
  for (const changed of [{ kind: "MEDIA" }, { kind: "VOICE_MESSAGE" }, { createdAt: "2026-02-30T00:00:00.000Z" },
    { originalText: { text: " \n\t ", language: null } }, { originalText: { text: "unsafe\u0001words", language: "ar" } },
    { originalText: { text: "x".repeat(20001), language: "ar" } }, { originalText: { text: "Original", language: 123 } },
    { providerEnabled: true }, { rawProviderResponse: {} }]) rejected(CustomerTextSourceSchema, { ...original, ...changed });
  // Historical capture and a later explicit rereview may have different epochs;
  // pure hashes do not authenticate the stated author or resolve source access.
  const later = resign({ ...original, capturedSnapshot: { ...snapshot(), campaignRevision: 9 } }, "sourceHash", "infame-customer-text-v1");
  expect(CustomerTextSourceSchema.parse(later).capturedSnapshot.campaignRevision).toBe(9);
});

it("validates each confirmation against its own central value type and exact domain hashes, with explicit unknown, false and empty choices", () => {
  for (const field of keys) expect(FieldConfirmationSchema.parse(confirmation(field, fullFields[field as keyof typeof fullFields])).field).toBe(field);
  for (const [field, value] of [["impressionsTarget", null], ["travelAllowed", false], ["noGoTopics", []], ["originalLanguage", null]] as const) {
    const item = confirmation(field, value); expect(FieldConfirmationSchema.parse(item).value).toEqual(value);
  }
  const exact = confirmation("budget", fullFields.budget);
  expect(FieldConfirmationSchema.parse(exact).value).toEqual({ amountMinor: "9223372036854775807", currencyCode: "KWD" });
  const invalidValues: Array<[string, unknown]> = [["budget", { amountMinor: 123456, currencyCode: "KWD" }], ["budget", { amountMinor: "001", currencyCode: "KWD" }],
    ["travelAllowed", "false"], ["targetCountryCodes", false], ["title", []], ["unknown", "invented"],
    ["impressionsTarget", -1], ["desiredCreatorCount", 0]];
  for (const [field, value] of invalidValues) rejected(FieldConfirmationSchema, confirmation(field, value));
  const rawDeliverables = [{ platform: "INSTAGRAM", format: "STORY", count: 1 },
    { platform: "TIKTOK", format: "VIDEO", count: 2 }, { platform: "INSTAGRAM", format: "STORY", count: 3 }];
  const normalizedDeliverables = CampaignFieldObjectSchema.shape.deliverables.parse(rawDeliverables);
  expect(normalizedDeliverables).toEqual([{ platform: "INSTAGRAM", format: "STORY", count: 4 },
    { platform: "TIKTOK", format: "VIDEO", count: 2 }]);
  const canonicalChoice = confirmation("deliverables", normalizedDeliverables);
  // The central value schema merges duplicate rows before checking hashes.
  // A caller must pin that displayed canonical value, not raw transport rows.
  const parsedChoice = FieldConfirmationSchema.parse({ ...canonicalChoice, value: rawDeliverables });
  expect(parsedChoice.value).toEqual(normalizedDeliverables);
  expect(parsedChoice.valueHash).toBe(valueHash("deliverables", normalizedDeliverables));
  expect(parsedChoice.confirmationHash).toBe(canonicalChoice.confirmationHash);
  rejected(FieldConfirmationSchema, confirmation("deliverables", rawDeliverables));
  rejected(FieldConfirmationSchema, { ...canonicalChoice, value: [...normalizedDeliverables].reverse() });
  const title = confirmation("title", fullFields.title);
  for (const changed of [{ value: fullFields.title.trim() }, { field: "summary" }, { valueHash: "a".repeat(64) },
    { confirmationHash: "b".repeat(64) }, { confirmationBatchId: "batch~foreign" },
    { binding: { ...binding, campaignId: "campaign~foreign" } }, { confirmedByUserId: "user~foreign" },
    { confirmedAt: "2026-10-08T10:11:13.000Z" }, { source: { kind: "CUSTOMER_FIELD_CHOICE", capturedValueHash: "c".repeat(64) } },
    { approved: true }]) rejected(FieldConfirmationSchema, { ...title, ...changed });
  const refs = [{ id: "source~a", sourceHash: "a".repeat(64) }, { id: "source~b", sourceHash: "b".repeat(64) }];
  expect(FieldConfirmationSchema.parse(confirmation("title", fullFields.title, refs)).source).toEqual({ kind: "CUSTOMER_TEXT", references: refs });
  for (const bad of [[], [...refs].reverse(), [refs[0]!, refs[0]!],
    Array.from({ length: 5 }, (_, i) => ({ id: "source~" + i, sourceHash: "a".repeat(64) }))]) rejected(FieldConfirmationSchema, confirmation("title", fullFields.title, bad));
  rejected(FieldConfirmationSchema, resign({ ...title, source: { kind: "AI", references: refs } }, "confirmationHash", "infame-field-confirmation-v1", ["value"]));
});

it("requires complete ordered current 30-field review references and exact displayed values, never treating defaults or partial coverage as profile-ready", () => {
  const reviewed = state(fullFields, true); expect(CampaignAgentStateSchema.parse(reviewed)).toEqual(reviewed);
  expect(reviewed.confirmation.fields?.map(item => item.field)).toEqual(keys);
  const references = reviewed.confirmation.fields!;
  for (const changed of [{ ...reviewed.confirmation, fields: references.slice(0, -1) },
    { ...reviewed.confirmation, fields: [...references].reverse() },
    { ...reviewed.confirmation, fields: [references[0]!, ...references.slice(0, -1)] },
    { ...reviewed.confirmation, fields: references.map((item, i) => i === 1 ? { ...item, id: references[0]!.id } : item) },
    { ...reviewed.confirmation, fields: references.map((item, i) => i === 0 ? { ...item, field: "unknown" } : item) },
    { ...reviewed.confirmation, fields: references.map((item, i) => i === 0 ? { ...item, valueHash: "a".repeat(64) } : item) },
    { ...reviewed.confirmation, reviewedSnapshot: { ...reviewed.snapshot, planningRevision: 6 } }]) {
    rejected(CampaignAgentStateSchema, stateResign({ ...reviewed, confirmation: changed }));
  }
  const partial = { ...fullFields }; delete (partial as Partial<typeof fullFields>).desiredCreatorCount;
  rejected(CampaignAgentStateSchema, stateResign({ ...reviewed, fields: partial, snapshot: snapshot(partial),
    confirmation: { ...reviewed.confirmation, reviewedSnapshot: snapshot(partial) } }));
  rejected(CampaignAgentStateSchema, stateResign({ ...reviewed, fields: { ...fullFields, title: "Different current title" },
    snapshot: snapshot({ ...fullFields, title: "Different current title" }),
    confirmation: { ...reviewed.confirmation, reviewedSnapshot: snapshot({ ...fullFields, title: "Different current title" }) } }));
  rejected(CampaignAgentStateSchema, { ...reviewed, stateHash: "f".repeat(64) });
  rejected(CampaignAgentStateSchema, { ...reviewed, readyForBrief: true });
  // Reference shape cannot prove persisted records, author identity or entailment.
});

it("preserves original multibyte content and enforces source cardinality and field byte bounds without throwing on malformed JSON", () => {
  const original = source({ text: "  " + "汉".repeat(15000) + "\n", language: "zh" });
  expect(CustomerTextSourceSchema.parse(original).originalText).toEqual(original.originalText);
  const listed = stateResign({ ...state(), textSourceReferences: Array.from({ length: 64 }, (_, i) => ({ id: "source~" + i, sourceHash: "a".repeat(64) })) });
  expect(CampaignAgentStateSchema.parse(listed).textSourceReferences).toHaveLength(64);
  rejected(CampaignAgentStateSchema, stateResign({ ...listed, textSourceReferences: [...listed.textSourceReferences, { id: "source~extra", sourceHash: "b".repeat(64) }] }));
  rejected(CampaignAgentStateSchema, stateResign({ ...listed, textSourceReferences: [listed.textSourceReferences[0]!, listed.textSourceReferences[0]!] }));
  const tooLarge = CampaignFieldsSchema.parse({ ...fullFields, productService: "汉".repeat(5000), summary: "汉".repeat(5000),
    usageRights: "汉".repeat(5000), assumptions: Array.from({ length: 30 }, () => "汉".repeat(500)) });
  expect(CampaignDraftFieldsSchema.safeParse(tooLarge).success).toBe(true);
  expect(new TextEncoder().encode(JSON.stringify(tooLarge)).byteLength).toBeGreaterThan(65536);
  rejected(CampaignAgentStateSchema, state(tooLarge));
  for (const bad of [{ ...source(), originalText: { text: "Original", language: undefined } },
    { ...source(), constructor: {} }, { ...source(), prototype: {} },
    JSON.parse('{"__proto__":{},"schemaVersion":1}'), { ...source(), createdAt: Number.NaN }]) rejected(CustomerTextSourceSchema, bad);
  for (const bad of [{ ...state(), fields: { ...fullFields, budget: { amountMinor: undefined, currencyCode: "KWD" } } },
    { ...state(), fields: { ...fullFields, impressionsTarget: Number.POSITIVE_INFINITY } },
    { ...state(), fields: { ...fullFields, constructor: {} } }]) rejected(CampaignAgentStateSchema, bad);
});

it("invalidates old review on revision/context ABA and keeps every independent input/output preference honest about unavailable assistance", () => {
  const reviewed = state(fullFields, true);
  for (const changed of [{ ...reviewed.snapshot, campaignRevision: 8 },
    { ...reviewed.snapshot, campaignRevision: 8, fieldsRevision: 8 }, { ...reviewed.snapshot, planningRevision: 6 },
    { ...reviewed.snapshot, selection: { ...reviewed.snapshot.selection, revision: 4 } },
    { ...reviewed.snapshot, selection: { ...reviewed.snapshot.selection, kind: "APPROVED_CONTEXT", versionId: "context-version~new", contentHash: "a".repeat(64) } }]) {
    rejected(CampaignAgentStateSchema, stateResign({ ...reviewed, snapshot: changed }));
  }
  // Value A came back, but its current field/campaign epochs are new. Retained
  // old review coverage must not revive merely because the fields hash matches.
  const returned = { ...reviewed.snapshot, campaignRevision: 9, fieldsRevision: 9 };
  expect(returned.fieldsHash).toBe(reviewed.snapshot.fieldsHash);
  rejected(CampaignAgentStateSchema, stateResign({ ...reviewed, snapshot: returned }));
  expect(CampaignAgentStateSchema.parse(stateResign({ ...reviewed, snapshot: returned,
    confirmation: { kind: "UNCONFIRMED" } })).fields).toEqual(fullFields);
  for (const input of ["TEXT", "MEDIA", "VOICE_MESSAGE", "LIVE_VOICE"] as const) {
    for (const output of ["TEXT", "VOICE", "TEXT_AND_VOICE"] as const) {
      const chosen = stateResign({ ...state(), preferences: { input, output } });
      expect(CampaignAgentStateSchema.parse(chosen).preferences).toEqual({ input, output });
      expect(CampaignAgentStateSchema.parse(chosen).assistance).toEqual({ kind: "MANUAL_GUIDANCE", agent: "UNAVAILABLE" });
    }
  }
  for (const changed of [{ preferences: { input: "TEXT" } }, { preferences: { input: "TEXT", output: "AUTO" } },
    { assistance: { kind: "AI", agent: "COMPLETE" } }, { assistance: { kind: "MANUAL_GUIDANCE", agent: "RUNNING" } },
    { assistance: { kind: "MANUAL_GUIDANCE", agent: "UNAVAILABLE", openai: "ENABLED" } },
    { providerEnabled: true }, { microphoneConsent: true }, { quotaAvailable: true }]) rejected(CampaignAgentStateSchema, stateResign({ ...state(), ...changed }));
});
