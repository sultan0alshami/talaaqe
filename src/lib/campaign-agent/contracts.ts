import { z } from "zod";
import { CampaignDraftFieldsSchema, CampaignFieldObjectSchema, CampaignFieldsSchema, type CampaignDraftFields } from "@/lib/campaigns/contracts";
import { PlanningScopeSchema, type PlanningScope } from "@/lib/brand-context/contracts";
import { PlanningSelectionSchema } from "@/lib/campaign-planning/contracts";
import { OriginalTextSchema, UtcDateTimeSchema, type OriginalText } from "@/lib/contracts/vocabulary";
import { OrganizationIdSchema as id, OrganizationRevisionSchema as revision } from "@/lib/organizations/contracts";
import { canonicalHash, checkedJson } from "@/lib/onboarding/drafts";

// Server-side pure declarations. Hash equality proves structure, never authority,
// source entailment, provider readiness or a customer's actual confirmation.
export const CampaignAgentFieldKeys = Object.freeze(CampaignFieldObjectSchema.keyof().options);
export type CampaignAgentFieldKey = keyof typeof CampaignFieldObjectSchema.shape;
export type AgentBinding = { scope: PlanningScope; workspaceId: string; campaignId: string };
export type AgentSnapshot = { campaignRevision: number; fieldsRevision: number; planningRevision: number;
  selection: z.infer<typeof PlanningSelectionSchema>; fieldsHash: string };
type SourceReference = { id: string; sourceHash: string };
export type CustomerTextSource = { schemaVersion: 1; id: string; binding: AgentBinding; capturedSnapshot: AgentSnapshot;
  authorUserId: string; kind: "CUSTOMER_TEXT"; originalText: OriginalText; createdAt: string; sourceHash: string };
type ConfirmationSource = { kind: "CUSTOMER_FIELD_CHOICE"; capturedValueHash: string }
  | { kind: "CUSTOMER_TEXT"; references: SourceReference[] };
type ConfirmationBase = { schemaVersion: 1; id: string; binding: AgentBinding; confirmationBatchId: string;
  reviewedSnapshot: AgentSnapshot; valueHash: string; source: ConfirmationSource; confirmedByUserId: string;
  confirmedAt: string; confirmationHash: string };
export type FieldConfirmation = { [K in CampaignAgentFieldKey]: ConfirmationBase & {
  field: K; value: z.output<typeof CampaignFieldObjectSchema.shape[K]>;
} }[CampaignAgentFieldKey];
type ReviewedSet = { kind: "REVIEWED_SET"; confirmationBatchId: string; reviewedSnapshot: AgentSnapshot;
  fields: { field: CampaignAgentFieldKey; id: string; valueHash: string; confirmationHash: string }[] };
export type CampaignAgentState = { schemaVersion: 1; id: string; revision: number; binding: AgentBinding;
  snapshot: AgentSnapshot; fields: CampaignDraftFields; preferences: {
    input: "TEXT" | "MEDIA" | "VOICE_MESSAGE" | "LIVE_VOICE"; output: "TEXT" | "VOICE" | "TEXT_AND_VOICE";
  }; assistance: { kind: "MANUAL_GUIDANCE"; agent: "UNAVAILABLE" }; textSourceReferences: SourceReference[];
  confirmation: { kind: "UNCONFIRMED" } | ReviewedSet; updatedAt: string; stateHash: string };

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const digest = (value: unknown) => {
  try { return canonicalHash(value); } catch { return null; }
};
function jsonGuard<T extends z.ZodType>(schema: T, maximum: number) {
  return z.unknown().superRefine((input, context) => {
    try { checkedJson(input, maximum); } catch {
      context.addIssue({ code: "custom", message: "Expected bounded plain JSON" });
    }
  }).pipe(schema);
}
export const AgentBindingSchema = jsonGuard(z.object({ scope: PlanningScopeSchema, workspaceId: id, campaignId: id }).strict(), 4096);
export const AgentSnapshotSchema = jsonGuard(z.object({ campaignRevision: revision, fieldsRevision: revision,
  planningRevision: revision, selection: PlanningSelectionSchema, fieldsHash: hash }).strict()
  .refine(value => value.fieldsRevision <= value.campaignRevision, "Field revision exceeds campaign revision"), 4096);
const reference = z.object({ id, sourceHash: hash }).strict();
const uniqueReferences = (maximum: number) => z.array(reference).max(maximum)
  .refine(items => new Set(items.map(item => item.id)).size === items.length, "Duplicate source reference");
const originalText = OriginalTextSchema.extend({ text: z.string().min(1).max(20000)
  .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+$/)
  .refine(value => value.trim().length > 0, "Empty original text") }).strict();
export const CustomerTextSourceSchema = jsonGuard(z.object({ schemaVersion: z.literal(1), id,
  binding: AgentBindingSchema, capturedSnapshot: AgentSnapshotSchema, authorUserId: id,
  kind: z.literal("CUSTOMER_TEXT"), originalText, createdAt: UtcDateTimeSchema, sourceHash: hash }).strict()
  .refine(value => {
    const { sourceHash, ...content } = value;
    return sourceHash === digest({ domain: "infame-customer-text-v1", ...content });
  }, "Customer text source hash mismatch"), 65536);

const confirmationSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CUSTOMER_FIELD_CHOICE"), capturedValueHash: hash }).strict(),
  z.object({ kind: z.literal("CUSTOMER_TEXT"), references: uniqueReferences(4).min(1)
    .refine(items => items.every((item, index) => index === 0 || items[index - 1]!.id < item.id), "Source references must be ordered") }).strict(),
]);
const confirmationBase = { schemaVersion: z.literal(1), id, binding: AgentBindingSchema, confirmationBatchId: id,
  reviewedSnapshot: AgentSnapshotSchema, valueHash: hash, source: confirmationSource, confirmedByUserId: id,
  confirmedAt: UtcDateTimeSchema, confirmationHash: hash };
function confirmedField<K extends CampaignAgentFieldKey>(field: K) {
  return z.object({ ...confirmationBase, field: z.literal(field), value: CampaignFieldObjectSchema.shape[field] }).strict();
}
// Values use the exact central schemas, including existing deliverable merging.
// This concrete tuple keeps each literal field/value relationship in TypeScript.
const confirmation = z.discriminatedUnion("field", [
  confirmedField("originalLanguage"), confirmedField("title"), confirmedField("productService"), confirmedField("goal"),
  confirmedField("summary"), confirmedField("marketCountryCodes"), confirmedField("targetAgeBuckets"), confirmedField("targetGenders"),
  confirmedField("targetCountryCodes"), confirmedField("targetCityKeys"), confirmedField("contentLanguages"), confirmedField("dialects"),
  confirmedField("nicheSlugs"), confirmedField("deliverables"), confirmedField("budget"), confirmedField("desiredCreatorCount"),
  confirmedField("impressionsTarget"), confirmedField("period"), confirmedField("physicalPresenceRequired"), confirmedField("presenceCountryCodes"),
  confirmedField("travelAllowed"), confirmedField("tone"), confirmedField("noGoTopics"), confirmedField("preferredTiers"),
  confirmedField("dataVerificationRequired"), confirmedField("preferredLicencePolicyIds"), confirmedField("usageRights"),
  confirmedField("kpis"), confirmedField("assumptions"), confirmedField("openQuestions"),
]).refine(value => value.valueHash === digest({ domain: "infame-campaign-field-value-v1", field: value.field, value: value.value }), "Confirmed value hash mismatch")
  .refine(value => value.source.kind !== "CUSTOMER_FIELD_CHOICE" || value.source.capturedValueHash === value.valueHash, "Captured field choice mismatch")
  .refine(value => {
    const { confirmationHash, value: duplicateValue, ...content } = value;
    void duplicateValue;
    return confirmationHash === digest({ domain: "infame-field-confirmation-v1", ...content });
  }, "Confirmation hash mismatch");
export const FieldConfirmationSchema = jsonGuard(confirmation, 65536);

const coverage = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("UNCONFIRMED") }).strict(),
  z.object({ kind: z.literal("REVIEWED_SET"), confirmationBatchId: id, reviewedSnapshot: AgentSnapshotSchema,
    fields: z.array(z.object({ field: CampaignFieldObjectSchema.keyof(), id, valueHash: hash, confirmationHash: hash }).strict())
      .length(CampaignAgentFieldKeys.length)
      .refine(items => new Set(items.map(item => item.id)).size === items.length, "Duplicate confirmation ID")
      .refine(items => items.every((item, index) => item.field === CampaignAgentFieldKeys[index]), "Complete ordered review required") }).strict(),
]);
const state = z.object({ schemaVersion: z.literal(1), id, revision, binding: AgentBindingSchema, snapshot: AgentSnapshotSchema,
  fields: CampaignDraftFieldsSchema.refine(value => bytes(value) <= 65536, "Campaign fields exceed64KiB"),
  preferences: z.object({ input: z.enum(["TEXT", "MEDIA", "VOICE_MESSAGE", "LIVE_VOICE"]),
    output: z.enum(["TEXT", "VOICE", "TEXT_AND_VOICE"]) }).strict(),
  assistance: z.object({ kind: z.literal("MANUAL_GUIDANCE"), agent: z.literal("UNAVAILABLE") }).strict(),
  textSourceReferences: uniqueReferences(64), confirmation: coverage, updatedAt: UtcDateTimeSchema, stateHash: hash,
}).strict().refine(value => value.snapshot.fieldsHash === digest({ domain: "infame-campaign-fields-v1", fields: value.fields }), "Fields snapshot hash mismatch")
  .refine(value => {
    if (value.confirmation.kind === "UNCONFIRMED") return true;
    const fields = CampaignFieldsSchema.safeParse(value.fields);
    return fields.success && digest(value.confirmation.reviewedSnapshot) === digest(value.snapshot)
      && value.confirmation.fields.every(item => item.valueHash === digest({ domain: "infame-campaign-field-value-v1",
        field: item.field, value: fields.data[item.field] }));
  }, "Review does not cover the exact complete current fields")
  .refine(value => {
    const { stateHash, ...content } = value;
    return stateHash === digest({ domain: "infame-campaign-agent-state-v1", ...content });
  }, "Agent state hash mismatch");
export const CampaignAgentStateSchema = jsonGuard(state, 131072);
