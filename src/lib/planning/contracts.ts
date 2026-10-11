import { z } from "zod";
import { COMMERCIAL_POLICY_VERSION, PLANNING_PLANS } from "@/lib/commercial/contracts";
import { OrganizationIdSchema as id, OrganizationRevisionSchema as revision } from "@/lib/organizations/contracts";
import { UtcDateTimeSchema as instant } from "@/lib/contracts/vocabulary";

// Declarations describe retained records, never authority or activation. Native
// subjects keep their full grammar; ledger identifiers are a separate concern.
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const reference = id.refine(value => !value.includes("://"), "Use opaque references, not URLs");
const minorPattern = /^(0|[1-9][0-9]{0,18})$/;
const minor = z.string().regex(minorPattern)
  .refine(value => minorPattern.test(value) && BigInt(value) <= BigInt("9223372036854775807"));
const base = { id, revision, createdAt: instant, updatedAt: instant };
const chronology = (value: { createdAt: string; updatedAt: string }) => Date.parse(value.updatedAt) >= Date.parse(value.createdAt);
const terms = {
  planId: z.enum(["TRIAL", "STARTER", "GROWTH", "PRO"]),
  policyVersion: z.literal(COMMERCIAL_POLICY_VERSION), priceVersion: reference.nullable(),
  netAmountMinor: minor.nullable(), currency: z.literal("SAR").nullable(),
};
type Terms = z.infer<z.ZodObject<typeof terms>>;
function validTerms(value: Terms) {
  if (value.planId === "TRIAL") return value.priceVersion === null && value.netAmountMinor === null && value.currency === null;
  const plan = PLANNING_PLANS.find(item => item.id === value.planId);
  return !!plan && value.priceVersion !== null && value.netAmountMinor === plan.netMonthly.amountMinor && value.currency === "SAR";
}

export const PlanningAiPoolSchema = z.object({ ...base, scope: z.enum(["OWN_BRAND", "CLIENT"]),
  brandId: id.nullable(), organizationId: id.nullable(), state: z.enum(["ACTIVE", "CLOSED"]),
}).strict().refine(chronology, "Updated time precedes creation").refine(value => value.scope === "OWN_BRAND"
  ? value.brandId !== null && value.organizationId === null
  : value.brandId === null && value.organizationId !== null, "Exactly one native pool subject is required");
export const PlanningAiEnrollmentSchema = z.object({ ...base, ...terms, poolId: id,
  acceptingOwnerUserId: id, subscriberUserId: id, kind: z.enum(["TRIAL", "PAID"]),
  state: z.enum(["ACTIVE", "CLOSED"]), acceptanceReference: reference, acceptanceHash: hash, acceptedAt: instant,
}).strict().refine(chronology, "Updated time precedes creation").refine(validTerms, "Exact accepted commercial terms required")
  .refine(value => (value.kind === "TRIAL") === (value.planId === "TRIAL"), "Enrollment kind and plan must agree");
export const PlanningAiSeatSchema = z.object({ ...base, poolId: id, userId: id,
  organizationId: id.nullable(), membershipId: id.nullable(), state: z.enum(["ACTIVE", "REVOKED"]),
}).strict().refine(chronology, "Updated time precedes creation")
  .refine(value => (value.organizationId === null) === (value.membershipId === null), "Complete native membership binding required");
export const PlanningAiTrialClaimSchema = z.object({ id, poolId: id, enrollmentId: id, ownerUserId: id,
  readinessReference: reference, consentHash: hash, claimedAt: instant,
}).strict();
export const PlanningAiCycleSchema = z.object({ ...base, ...terms, poolId: id, enrollmentId: id,
  trialClaimId: id.nullable(), source: z.enum(["TRIAL", "MERCHANT"]), sourceEventId: reference,
  subscriptionId: reference.nullable(), allowance: z.number().int().min(1).max(75),
  held: z.number().int().min(0).max(75), consumed: z.number().int().min(0).max(75),
  state: z.enum(["ACTIVE", "VOIDED"]), startsAt: instant, endsAt: instant,
}).strict().refine(chronology, "Updated time precedes creation").refine(validTerms, "Exact accepted commercial terms required")
  .refine(value => Date.parse(value.startsAt) < Date.parse(value.endsAt), "Positive half-open period required")
  .refine(value => value.held + value.consumed <= value.allowance, "Pooled allowance exceeded")
  .refine(value => value.state !== "VOIDED" || value.held + value.consumed === 0, "Occupied cycles cannot be voided")
  .refine(value => value.source === "TRIAL"
    ? value.planId === "TRIAL" && value.allowance === 1 && value.trialClaimId !== null && value.subscriptionId === null
    : value.planId !== "TRIAL" && value.trialClaimId === null && value.subscriptionId !== null
      && PLANNING_PLANS.some(plan => plan.id === value.planId && plan.sessions === value.allowance), "Cycle source and allowance must match accepted terms");
export type PlanningAiPool = z.infer<typeof PlanningAiPoolSchema>;
export type PlanningAiEnrollment = z.infer<typeof PlanningAiEnrollmentSchema>;
export type PlanningAiSeat = z.infer<typeof PlanningAiSeatSchema>;
export type PlanningAiTrialClaim = z.infer<typeof PlanningAiTrialClaimSchema>;
export type PlanningAiCycle = z.infer<typeof PlanningAiCycleSchema>;

// Shape consistency only; actual result lineage and allowance counts use native
// retained-row guards. These declarations grant no authority or execution proof.
export const PlanningAiSessionSchema = z.object({ ...base, poolId: id, cycleId: id,
  scope: z.enum(["OWN_BRAND", "CLIENT"]), brandId: id, organizationId: id.nullable(), clientId: id.nullable(),
  workspaceId: id, campaignId: id, agentId: id, createdByUserId: id, creationSeatId: id,
  creationKey: z.uuid(), allowanceState: z.enum(["HELD", "CONSUMED", "RELEASED"]), firstAttachedResultId: id.nullable(),
}).strict().refine(chronology, "Updated time precedes creation")
  .refine(value => value.scope === "OWN_BRAND" ? value.organizationId === null && value.clientId === null
    : value.organizationId !== null && value.clientId !== null, "Complete native scope required")
  .refine(value => (value.allowanceState === "CONSUMED") === (value.firstAttachedResultId !== null), "Consumed sessions retain their first result");
export const PlanningAiOperationKindSchema = z.enum(["REPLY", "BRIEF", "STRATEGY", "IDEAS_PACK", "COMBINED_REFINEMENT"]);
export const PlanningAiOperationSchema = z.object({ ...base, sessionId: id, kind: PlanningAiOperationKindSchema,
  ordinal: z.number().int().min(1).max(10), state: z.enum(["OPEN", "SUCCEEDED"]), successfulResultId: id.nullable(),
}).strict().refine(chronology, "Updated time precedes creation")
  .refine(value => value.kind === "REPLY" || value.ordinal === 1, "Artifacts have one inclusion slot")
  .refine(value => (value.state === "SUCCEEDED") === (value.successfulResultId !== null), "Successful slots retain their result");
export type PlanningAiSession = z.infer<typeof PlanningAiSessionSchema>;
export type PlanningAiOperation = z.infer<typeof PlanningAiOperationSchema>;
