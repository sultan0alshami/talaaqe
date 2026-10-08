import { z } from "zod";
import { CampaignFieldObjectSchema } from "@/lib/campaigns/contracts";
import { PlanningScopeSchema, OwnPlanningScopeSchema, ClientPlanningScopeSchema } from "@/lib/brand-context/contracts";
import { ClientAuthoritySchema, OrganizationIdSchema as id, OrganizationRevisionSchema as revision } from "@/lib/organizations/contracts";
import { OriginalTextSchema, UtcDateTimeSchema } from "@/lib/contracts/vocabulary";
import { canonicalHash, checkedJson } from "@/lib/onboarding/drafts";
import { AgentBindingSchema, AgentSnapshotSchema, CampaignAgentFieldKeys, CampaignAgentPreferencesSchema,
  CampaignAgentSourceChoiceSchema, FieldConfirmationSchema } from "./contracts";

export class CampaignAgentError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); this.name = "CampaignAgentError"; }
}
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const bounded = <T extends z.ZodType>(schema: T, maximum: number) => z.unknown().superRefine((input, context) => {
  try { checkedJson(input, maximum); } catch { context.addIssue({ code: "custom", message: "Expected bounded plain JSON" }); }
}).pipe(schema);
const text = OriginalTextSchema.extend({ text: z.string().min(1).max(20000)
  .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+$/).refine(value => value.trim().length > 0) }).strict();
const choices = z.array(z.object({ field: CampaignFieldObjectSchema.keyof(), valueHash: hash,
  source: CampaignAgentSourceChoiceSchema }).strict()).length(CampaignAgentFieldKeys.length)
  .refine(items => items.every((item, index) => item.field === CampaignAgentFieldKeys[index]));
const expected = { campaignId: id, expectedSnapshot: AgentSnapshotSchema };
const actions = [
  { action: z.literal("INITIALIZE"), expectedAgentRevision: z.literal(0), payload: z.object({ preferences: CampaignAgentPreferencesSchema }).strict() },
  { action: z.literal("SET_PREFERENCES"), expectedAgentRevision: revision, payload: z.object({ preferences: CampaignAgentPreferencesSchema }).strict() },
  { action: z.literal("APPEND_TEXT"), expectedAgentRevision: revision, payload: z.object({ originalText: text }).strict() },
  { action: z.literal("CONFIRM_FIELDS"), expectedAgentRevision: revision, payload: z.object({ fields: choices }).strict() },
  { action: z.literal("GENERATE_PROFILE"), expectedAgentRevision: revision, payload: z.object({ confirmationBatchId: id }).strict() },
] as const;
const own = { operationKey: z.uuid(), scope: OwnPlanningScopeSchema, ...expected };
const client = { operationKey: z.uuid(), scope: ClientPlanningScopeSchema, ...expected,
  expectedAuthority: ClientAuthoritySchema.extend({ capability: z.literal("plan") }).strict() };
export const CampaignAgentCommandSchema = bounded(z.union([
  z.discriminatedUnion("action", [z.object({ ...own, ...actions[0] }).strict(), z.object({ ...own, ...actions[1] }).strict(),
    z.object({ ...own, ...actions[2] }).strict(), z.object({ ...own, ...actions[3] }).strict(), z.object({ ...own, ...actions[4] }).strict()]),
  z.discriminatedUnion("action", [z.object({ ...client, ...actions[0] }).strict(), z.object({ ...client, ...actions[1] }).strict(),
    z.object({ ...client, ...actions[2] }).strict(), z.object({ ...client, ...actions[3] }).strict(), z.object({ ...client, ...actions[4] }).strict()])
    .refine(value => value.scope.clientId === value.expectedAuthority.clientId),
]), 65536);
export type CampaignAgentCommand = z.infer<typeof CampaignAgentCommandSchema>;
export const CampaignAgentQuerySchema = z.object({ scope: PlanningScopeSchema, campaignId: id }).strict();
export const CampaignAgentSourcesQuerySchema = CampaignAgentQuerySchema.extend({ after: id.optional() }).strict();
const receipt = z.object({ agentId: id, campaignId: id, workspaceId: id,
  action: z.enum(["INITIALIZE", "SET_PREFERENCES", "APPEND_TEXT", "CONFIRM_FIELDS", "GENERATE_PROFILE"]),
  agentRevision: revision, campaignRevision: revision, planningRevision: revision, sourceId: id.nullable(),
  confirmationBatchId: id.nullable(), briefId: id.nullable(), briefVersion: revision.nullable() }).strict()
  .refine(value => (value.sourceId !== null) === (value.action === "APPEND_TEXT"))
  .refine(value => (value.confirmationBatchId !== null) === ["CONFIRM_FIELDS", "GENERATE_PROFILE"].includes(value.action))
  .refine(value => (value.briefId !== null) === (value.action === "GENERATE_PROFILE") && (value.briefVersion !== null) === (value.briefId !== null));
export const CampaignAgentReceiptSchema = receipt;
export const CampaignAgentResultSchema = receipt.safeExtend({ replayed: z.boolean() }).strict();
export type CampaignAgentResult = z.infer<typeof CampaignAgentResultSchema>;
export const CampaignAgentBatchSchema = bounded(z.object({ schemaVersion: z.literal(1), id, agentId: id,
  binding: AgentBindingSchema, reviewedSnapshot: AgentSnapshotSchema, confirmedByUserId: id, confirmedAt: UtcDateTimeSchema,
  confirmations: z.array(FieldConfirmationSchema).length(CampaignAgentFieldKeys.length), contentHash: hash }).strict()
  .refine(value => value.confirmations.every((item, index) => item.field === CampaignAgentFieldKeys[index]
    && item.confirmationBatchId === value.id && item.confirmedByUserId === value.confirmedByUserId && item.confirmedAt === value.confirmedAt
    && canonicalHash(item.binding) === canonicalHash(value.binding) && canonicalHash(item.reviewedSnapshot) === canonicalHash(value.reviewedSnapshot))
    && new Set(value.confirmations.map(item => item.id)).size === value.confirmations.length)
  .refine(value => {
    const { contentHash, ...content } = value;
    try { return contentHash === canonicalHash({ domain: "infame-campaign-confirmation-batch-v1", ...content }); } catch { return false; }
  }), 262144);
export type CampaignAgentBatch = z.infer<typeof CampaignAgentBatchSchema>;
