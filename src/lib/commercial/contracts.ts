import { z } from "zod";
import { MoneySchema } from "@/lib/contracts/money";
import { DealFormatSchema, PlatformSchema } from "@/lib/contracts/vocabulary";

export const COMMERCIAL_POLICY_VERSION = "infame-commercial-v1-2026-10-05" as const;
export const REACH_TAXONOMY_VERSION = "infame-reach-v2" as const;
export const ReachBandSchema = z.enum(["NANO", "MICRO", "MID", "MACRO", "MEGA"]);
export type ReachBand = z.infer<typeof ReachBandSchema>;
export function bandForFollowers(followers: bigint | null): ReachBand | null {
  if (followers === null || followers < BigInt(1000)) return null;
  if (followers < BigInt(10000)) return "NANO";
  if (followers < BigInt(100000)) return "MICRO";
  if (followers < BigInt(500000)) return "MID";
  if (followers < BigInt(1000000)) return "MACRO";
  return "MEGA";
}
const nonblank = z.string().refine(value => value.trim().length > 0);
export const ReachObservationSchema = z.object({
  accountId: nonblank.max(200), platform: PlatformSchema,
  followers: MoneySchema.shape.amountMinor.nullable(), observedAt: z.iso.datetime(),
  taxonomyVersion: z.literal(REACH_TAXONOMY_VERSION), band: ReachBandSchema.nullable(),
}).strict().refine(value => {
  const followers = MoneySchema.shape.amountMinor.nullable().safeParse(value.followers);
  return followers.success && value.band === bandForFollowers(followers.data === null ? null : BigInt(followers.data));
}, "Band must describe the dated account observation under this taxonomy");

// Every direct-cost category is explicit. Omission is not a zero-cost claim.
export const DirectCostsSchema = z.object({
  creator: MoneySchema, production: MoneySchema, labor: MoneySchema, paymentFees: MoneySchema,
  operationsAi: MoneySchema, rework: MoneySchema, nonrecoverableTax: MoneySchema, contingency: MoneySchema,
}).strict();
export type DirectCosts = z.infer<typeof DirectCostsSchema>;
export const TaxTreatmentSchema = z.object({
  policyVersionId: nonblank.max(200), reviewedAt: z.iso.datetime(),
  treatment: z.enum(["STANDARD_RATE", "ZERO_RATED", "EXEMPT", "OUT_OF_SCOPE"]),
  rateBasisPoints: z.number().int().min(0).max(10000),
}).strict().refine(value => value.treatment === "STANDARD_RATE" ? value.rateBasisPoints > 0 : value.rateBasisPoints === 0);
export type TaxTreatment = z.infer<typeof TaxTreatmentSchema>;
export const CancellationStageSchema = z.enum(["BEFORE_COMMITMENT", "BOOKED", "DRAFT", "APPROVED", "PUBLISHED_COMPLETED"]);
export const CancellationScheduleSchema = z.object({
  policyVersion: z.literal(COMMERCIAL_POLICY_VERSION), itemNet: MoneySchema,
  stages: z.object({ BEFORE_COMMITMENT: MoneySchema, BOOKED: MoneySchema, DRAFT: MoneySchema, APPROVED: MoneySchema, PUBLISHED_COMPLETED: MoneySchema }).strict(),
}).strict().superRefine((value, context) => {
  // Zod may run refinements after a recoverable nested format failure.
  // Invalid money must remain a validation result, never escape as BigInt syntax errors.
  if (!MoneySchema.safeParse(value.itemNet).success || Object.values(value.stages).some(stage => !MoneySchema.safeParse(stage).success)) return;
  let previous = BigInt("0");
  for (const stage of CancellationStageSchema.options) {
    const current = value.stages[stage];
    const amount = BigInt(current.amountMinor);
    if (current.currencyCode !== value.itemNet.currencyCode || amount < previous || amount > BigInt(value.itemNet.amountMinor)
      || (stage === "BEFORE_COMMITMENT" && amount !== BigInt("0"))) {
      context.addIssue({ code: "custom", message: "Stage liabilities must use item currency, start at zero, increase monotonically and stay within item net value", path: ["stages", stage] });
    }
    previous = amount;
  }
});
export type CancellationSchedule = z.infer<typeof CancellationScheduleSchema>;

// Source bounds remain the source's vocabulary, independently of Infame reach bands.
export const RateGuidanceSchema = z.object({
  sourceClass: z.enum(["CREATOR_ASK", "VENDOR_ESTIMATE", "AGREED_SUBCONTRACT", "ACHIEVED_TRANSACTION"]),
  sourceReference: nonblank.max(2000), sourceDate: z.iso.datetime(),
  followerBounds: z.object({ minimum: MoneySchema.shape.amountMinor.nullable(), maximumExclusive: MoneySchema.shape.amountMinor.nullable() }).strict(),
  platform: PlatformSchema, format: DealFormatSchema, unit: z.enum(["CONTENT_ITEM", "SEQUENCE", "CAMPAIGN", "DAY", "WEEK", "PRODUCTION"]),
  rights: nonblank.max(2000), amount: MoneySchema,
}).strict().refine(value => {
  const minimum = MoneySchema.shape.amountMinor.nullable().safeParse(value.followerBounds.minimum);
  const maximum = MoneySchema.shape.amountMinor.nullable().safeParse(value.followerBounds.maximumExclusive);
  return minimum.success && maximum.success && (maximum.data === null || BigInt(minimum.data ?? "0") < BigInt(maximum.data));
});

export const PLANNING_SESSION_LIMITS = Object.freeze({ chatTurns: 10, brief: 1, strategy: 1, ideasPack: 1, combinedRefinement: 1 });
export const PLANNING_PLANS = Object.freeze([
  Object.freeze({ id: "STARTER", policyVersion: COMMERCIAL_POLICY_VERSION, netMonthly: Object.freeze({ amountMinor: "9900", currencyCode: "SAR" }), sessions: 3 }),
  Object.freeze({ id: "GROWTH", policyVersion: COMMERCIAL_POLICY_VERSION, netMonthly: Object.freeze({ amountMinor: "29900", currencyCode: "SAR" }), sessions: 15 }),
  Object.freeze({ id: "PRO", policyVersion: COMMERCIAL_POLICY_VERSION, netMonthly: Object.freeze({ amountMinor: "99900", currencyCode: "SAR" }), sessions: 75 }),
] as const);
export const COMMERCIAL_LIMITS = Object.freeze({ targetMarginBasisPoints: 3000, commitmentFloorBasisPoints: 2500,
  pilotSlots: 5, trialSessions: 1, rollover: false, variableAiCostTargetBasisPoints: 1000 });

// Inert activation gates until each integration has real independent acceptance.
// An environment key, paid subscription or synthetic fixture cannot enable them.
export const COMMERCIAL_CAPABILITIES = Object.freeze({
  managedCheckout: Object.freeze({ mode: "UNAVAILABLE", reason: "MERCHANT_AND_MANAGED_ORDER_ACCEPTANCE_REQUIRED" }),
  recurringBilling: Object.freeze({ mode: "UNAVAILABLE", reason: "RECURRING_MERCHANT_ACCEPTANCE_REQUIRED" }),
  anthropicPlanning: Object.freeze({ mode: "UNAVAILABLE", reason: "PLANNING_QUALITY_COST_AND_ORCHESTRATION_ACCEPTANCE_REQUIRED" }),
  openai: Object.freeze({ mode: "UNAVAILABLE", reason: "FOUNDER_DISABLED" }),
  voice: Object.freeze({ mode: "UNAVAILABLE", reason: "VOICE_PROVIDER_AND_TRUSTED_SPEND_ACCEPTANCE_REQUIRED" }),
  manualPlanning: Object.freeze({ mode: "AVAILABLE", price: "FREE" }),
  deterministicMatching: Object.freeze({ mode: "AVAILABLE", price: "FREE" }),
} as const);
