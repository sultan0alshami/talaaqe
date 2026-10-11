import { z } from "zod";

export const MAX_LEDGER_INTEGER = BigInt("9223372036854775807");
export const MicrosSchema = z.string().regex(/^(0|[1-9][0-9]{0,18})$/).refine(value => BigInt(value) <= MAX_LEDGER_INTEGER, "Exceeds PostgreSQL signed BigInt");
const PositiveIntegerSchema = MicrosSchema.refine(value => BigInt(value) > BigInt(0), "Must be positive");
// An estimate is bounded JSON, not a database charge column. Six bounded
// quantity × price ratios can exceed signed BigInt without invalidating a bill.
const EstimatedMicrosSchema = z.string().regex(/^(0|[1-9][0-9]{0,39})$/);
const IdentifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/).refine(value => !value.includes("://"), "Use opaque identifiers, not URLs");
const DateStringSchema = z.iso.datetime({ offset: true }).max(40);
export const AiPurposeSchema = z.enum(["ONBOARDING_VOICE", "TRANSCRIPTION", "SPEECH", "FACT_EXTRACTION", "PORTFOLIO", "CAMPAIGN_CHAT", "CAMPAIGN_EXTRACTION", "BRIEF", "MATCH_EXPLANATION", "CONTENT_THEME", "SCREENSHOT_EXTRACTION"]);
export const AiStatusSchema = z.enum(["RESERVED", "RUNNING", "UNKNOWN", "SETTLED", "RELEASED"]);
export const AiActorSchema = z.object({ userId: IdentifierSchema, role: z.enum(["BRAND", "CREATOR", "ADMIN"]), sessionVersion: z.number().int().min(1).max(2147483647), sessionId: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
export type AiActor = z.infer<typeof AiActorSchema>;
export const AiBudgetCapsSchema = z.object({ userDailyMicros: MicrosSchema, platformDailyMicros: MicrosSchema }).strict();
export type AiBudgetCaps = z.infer<typeof AiBudgetCapsSchema>;
const UnitSchema = z.enum(["INPUT_TOKENS", "OUTPUT_TOKENS", "INPUT_AUDIO_MILLISECONDS", "OUTPUT_AUDIO_MILLISECONDS", "IMAGES", "REQUESTS"]);
const uniqueUnits = (values: { unit: string }[]) => new Set(values.map(value => value.unit)).size === values.length;
export const AiUsageSchema = z.array(z.object({ unit: UnitSchema, quantity: MicrosSchema }).strict()).min(1).max(6).refine(uniqueUnits, "Duplicate usage unit");
export const AiPricingSchema = z.object({
  version: IdentifierSchema, modelId: IdentifierSchema, asOf: z.iso.date(), currency: z.literal("USD"),
  prices: z.array(z.object({ unit: UnitSchema, quantity: PositiveIntegerSchema, priceMicros: MicrosSchema }).strict()).min(1).max(6).refine(uniqueUnits, "Duplicate price unit"),
}).strict();
export const AiContextSchema = z.object({ resourceType: z.enum(["ONBOARDING", "CAMPAIGN", "CREATOR", "JOB", "SYSTEM"]), resourceId: IdentifierSchema, sourceRevision: z.number().int().min(0).max(2147483647) }).strict();
export const ReserveAiSchema = z.object({
  operationKey: IdentifierSchema, purpose: AiPurposeSchema, payloadHash: z.string().regex(/^[a-f0-9]{64}$/), reservedMicros: PositiveIntegerSchema,
  pricing: AiPricingSchema, context: AiContextSchema, executionTimeoutMs: z.number().int().min(1000).max(300000),
}).strict();
export const SettlementSchema = z.object({ reservationId: IdentifierSchema, actualMicros: MicrosSchema, usage: AiUsageSchema, pricing: AiPricingSchema }).strict();
export const QuarantineSchema = z.object({ reservationId: IdentifierSchema, reason: z.enum(["TIMEOUT", "BILLING_UNCERTAIN"]) }).strict();
export const NoCallSchema = z.object({ reservationId: IdentifierSchema, reason: z.enum(["FAILED_BEFORE_INVOCATION", "PROVIDER_CONFIRMED_NO_CALL"]) }).strict();
export const ReconcileSchema = z.object({
  reservationId: IdentifierSchema, reviewReference: IdentifierSchema,
  resolution: z.discriminatedUnion("kind", [z.object({ kind: z.literal("NO_CHARGE") }).strict(), SettlementSchema.omit({ reservationId: true }).extend({ kind: z.literal("CHARGE") }).strict()]),
}).strict();
export const ResolveOverrunSchema = z.object({ reservationId: IdentifierSchema, expectedActualMicros: MicrosSchema, reviewReference: IdentifierSchema }).strict();
const ReconciliationSchema = z.object({ adminUserId: IdentifierSchema, reviewReference: IdentifierSchema, auditId: IdentifierSchema, resolvedAt: DateStringSchema, kind: z.enum(["NO_CHARGE", "CHARGE", "OVERRUN_ACCEPTED"]) }).strict();
export const AiLedgerMetadataSchema = z.object({
  schemaVersion: z.literal(1), actorRole: AiActorSchema.shape.role, actorSessionVersion: AiActorSchema.shape.sessionVersion,
  requestHash: z.string().regex(/^[a-f0-9]{64}$/), pricing: AiPricingSchema, context: AiContextSchema, executionTimeoutMs: ReserveAiSchema.shape.executionTimeoutMs,
  executionTokenHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), claimedAt: DateStringSchema.nullable(), deadlineAt: DateStringSchema.nullable(),
  quarantineReason: QuarantineSchema.shape.reason.nullable(), settlementHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  usage: AiUsageSchema.nullable(), settlementPricing: AiPricingSchema.nullable(), estimatedActualMicros: EstimatedMicrosSchema.nullable(),
  noCallReason: z.enum(["OWNER_CANCELLED_UNCLAIMED", "FAILED_BEFORE_INVOCATION", "PROVIDER_CONFIRMED_NO_CALL", "RECONCILED_NO_CHARGE"]).nullable(),
  overrun: z.boolean(), overrunResolved: z.boolean(), reconciliation: ReconciliationSchema.nullable(),
}).strict();
export type AiLedgerMetadata = z.infer<typeof AiLedgerMetadataSchema>;

// These are conservative development hypotheses, not validated business prices.
// Runtime configuration is read once by the trusted server adapter, never a body.
export function readAiBudgetCaps(env: Record<string, string | undefined> = process.env): AiBudgetCaps {
  const environment = env.INFAME_ENV;
  if (!["development", "test", "preview", "production"].includes(environment ?? "")) throw new Error("Explicit AI budget environment required");
  if (env.NODE_ENV === "production" && environment !== "preview" && environment !== "production") throw new Error("Production AI ledger refuses development defaults");
  const production = environment === "production" || environment === "preview";
  if (production && (env.AI_USER_DAILY_CAP_MICROS === undefined || env.AI_PLATFORM_DAILY_CAP_MICROS === undefined)) throw new Error("Explicit production AI budget caps required");
  return AiBudgetCapsSchema.parse({ userDailyMicros: env.AI_USER_DAILY_CAP_MICROS ?? "1000000", platformDailyMicros: env.AI_PLATFORM_DAILY_CAP_MICROS ?? "10000000" });
}

export function calculateUsageCostMicros(usageInput: unknown, pricingInput: unknown): string {
  const usage = AiUsageSchema.parse(usageInput), pricing = AiPricingSchema.parse(pricingInput);
  let cost = BigInt(0);
  for (const item of usage) {
    const price = pricing.prices.find(row => row.unit === item.unit);
    if (!price) throw new Error("Missing usage unit price");
    const numerator = BigInt(item.quantity) * BigInt(price.priceMicros), denominator = BigInt(price.quantity);
    cost += (numerator + denominator - BigInt(1)) / denominator;
  }
  return EstimatedMicrosSchema.parse(cost.toString());
}
