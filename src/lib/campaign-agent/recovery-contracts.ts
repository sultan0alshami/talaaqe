import type { AgentBinding, AgentSnapshot, CampaignAgentState } from "./contracts";
import type { CampaignAgentCommand, CampaignAgentResult } from "./native-contracts";
import type { PlanningScope } from "@/lib/brand-context/contracts";
import type { ClientAuthorityDTO } from "@/lib/organizations/contracts";
import { z } from "zod";
import { ClientAuthoritySchema, OrganizationIdSchema as id, OrganizationRevisionSchema as revision } from "@/lib/organizations/contracts";
import { PlanningScopeSchema } from "@/lib/brand-context/contracts";
import { CampaignFieldObjectSchema } from "@/lib/campaigns/contracts";
import { AgentBindingSchema, AgentSnapshotSchema, CampaignAgentFieldKeys, CampaignAgentPreferencesSchema, CampaignAgentSourceChoiceSchema } from "./contracts";
import { CampaignAgentResultSchema } from "./native-contracts";
import { UtcDateTimeSchema } from "@/lib/contracts/vocabulary";
import { checkedJson } from "@/lib/onboarding/drafts";

export type CampaignAgentRecoveryKey = { schemaVersion: 1; asOf: string; binding: AgentBinding;
  actorReference: string; algorithm: "AES-GCM"; keyId: string; keyBase64Url: string };
type RecoveryTargetFor<C extends CampaignAgentCommand> = C extends CampaignAgentCommand
  ? Omit<C, "scope" | "campaignId" | "payload"> & { commandHash: string; payload: C["action"] extends "APPEND_TEXT"
    ? { originalTextHash: string } : C["payload"] } : never;
export type CampaignAgentRecoveryTarget = RecoveryTargetFor<CampaignAgentCommand>;
type OriginalOutcomeInput = { scope: PlanningScope; campaignId: string; target: CampaignAgentRecoveryTarget };
export type CampaignAgentOutcomeInput = { scope: PlanningScope; campaignId: string; target: CampaignAgentRecoveryTarget
  | { kind: "RECOVERY_BARRIER"; command: CampaignAgentBarrierCommand; commandHash: string } };
export type CampaignAgentOutcome = { binding: AgentBinding } & (
  { status: "COMMITTED"; receipt: CampaignAgentResult | CampaignAgentBarrierResult } | { status: "UNKNOWN"; receipt: null });
export type CampaignAgentBarrierCommand = OriginalOutcomeInput & { operationKey: string; expectedAgentRevision: number;
  expectedSnapshot: AgentSnapshot; expectedAuthority?: ClientAuthorityDTO; initialPreferences: CampaignAgentState["preferences"] | null };
export type CampaignAgentBarrierResult = { action: "RECOVERY_BARRIER"; agentId: string; campaignId: string; workspaceId: string;
  agentRevision: number; campaignRevision: number; planningRevision: number; targetOperationKey: string;
  targetCommandHash: string; targetOutcome: "COMMITTED" | "FENCED"; originalReceipt: CampaignAgentResult | null; replayed: boolean };

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const plan = ClientAuthoritySchema.extend({ capability: z.literal("plan") }).strict();
const choices = z.array(z.object({ field: CampaignFieldObjectSchema.keyof(), valueHash: hash,
  source: CampaignAgentSourceChoiceSchema }).strict()).length(CampaignAgentFieldKeys.length)
  .refine(items => items.every((item, index) => item.field === CampaignAgentFieldKeys[index]));
const meta = { operationKey: z.uuid(), commandHash: hash, expectedSnapshot: AgentSnapshotSchema, expectedAuthority: plan.optional() };
const target = z.discriminatedUnion("action", [
  z.object({ ...meta, action: z.literal("INITIALIZE"), expectedAgentRevision: z.literal(0), payload: z.object({ preferences: CampaignAgentPreferencesSchema }).strict() }).strict(),
  z.object({ ...meta, action: z.literal("SET_PREFERENCES"), expectedAgentRevision: revision, payload: z.object({ preferences: CampaignAgentPreferencesSchema }).strict() }).strict(),
  z.object({ ...meta, action: z.literal("APPEND_TEXT"), expectedAgentRevision: revision, payload: z.object({ originalTextHash: hash }).strict() }).strict(),
  z.object({ ...meta, action: z.literal("CONFIRM_FIELDS"), expectedAgentRevision: revision, payload: z.object({ fields: choices }).strict() }).strict(),
  z.object({ ...meta, action: z.literal("GENERATE_PROFILE"), expectedAgentRevision: revision, payload: z.object({ confirmationBatchId: id }).strict() }).strict(),
]);
const bounded = <T extends z.ZodType>(schema: T, maximum: number) => z.unknown().superRefine((input, context) => {
  try { checkedJson(input, maximum); } catch { context.addIssue({ code: "custom", message: "Expected bounded recovery metadata" }); }
}).pipe(schema);
export const CampaignAgentRecoveryTargetSchema = bounded(target, 32768);
const validAuthority = (scope: PlanningScope, authority: z.infer<typeof plan> | undefined) => scope.kind === "OWN_BRAND"
  ? authority === undefined : authority !== undefined && authority.clientId === scope.clientId;
const barrier = z.object({ operationKey: z.uuid(), scope: PlanningScopeSchema, campaignId: id,
  expectedAgentRevision: z.number().int().min(0).max(2147483646), expectedSnapshot: AgentSnapshotSchema,
  expectedAuthority: plan.optional(), target: CampaignAgentRecoveryTargetSchema, initialPreferences: CampaignAgentPreferencesSchema.nullable() }).strict()
  .refine(value => value.operationKey.toLowerCase() !== value.target.operationKey.toLowerCase() && validAuthority(value.scope, value.expectedAuthority)
    && validAuthority(value.scope, value.target.expectedAuthority));
export const CampaignAgentBarrierCommandSchema = bounded(barrier, 65536);
export const CampaignAgentOutcomeInputSchema = bounded(z.object({ scope: PlanningScopeSchema, campaignId: id,
  target: z.union([CampaignAgentRecoveryTargetSchema, z.object({ kind: z.literal("RECOVERY_BARRIER"),
    command: CampaignAgentBarrierCommandSchema, commandHash: hash }).strict()]) }).strict().refine(value => "kind" in value.target
    ? value.target.command.campaignId === value.campaignId && JSON.stringify(value.target.command.scope) === JSON.stringify(value.scope)
    : validAuthority(value.scope, value.target.expectedAuthority)), 65536);
export const CampaignAgentRecoveryKeySchema = z.object({ schemaVersion: z.literal(1), asOf: UtcDateTimeSchema,
  binding: AgentBindingSchema, actorReference: id, algorithm: z.literal("AES-GCM"), keyId: hash,
  keyBase64Url: z.string().length(43).regex(/^[A-Za-z0-9_-]+$/) }).strict();
const barrierReceipt = z.object({ action: z.literal("RECOVERY_BARRIER"), agentId: id, campaignId: id, workspaceId: id,
  agentRevision: revision, campaignRevision: revision, planningRevision: revision, targetOperationKey: z.uuid(), targetCommandHash: hash,
  targetOutcome: z.enum(["COMMITTED", "FENCED"]), originalReceipt: CampaignAgentResultSchema.nullable() }).strict()
  .refine(value => (value.targetOutcome === "COMMITTED") === (value.originalReceipt !== null));
export const CampaignAgentBarrierReceiptSchema = barrierReceipt;
export const CampaignAgentBarrierResultSchema = barrierReceipt.safeExtend({ replayed: z.boolean() }).strict();
export const CampaignAgentOutcomeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("COMMITTED"), binding: AgentBindingSchema, receipt: z.union([CampaignAgentResultSchema, CampaignAgentBarrierResultSchema]) }).strict(),
  z.object({ status: z.literal("UNKNOWN"), binding: AgentBindingSchema, receipt: z.null() }).strict(),
]);
