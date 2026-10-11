import { z } from "zod";
import { createHash } from "node:crypto";
import { MoneySchema } from "@/lib/contracts/money";
import { UtcDateTimeSchema } from "@/lib/contracts/vocabulary";
import { OrganizationIdSchema as id } from "@/lib/organizations/contracts";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { planningPlainJsonSchema, PlanningProviderWireSchema, PlanningRetainedContentSchema } from "./output-contracts";

// Declaration consistency only. Actual execution/review provenance is established
// by trusted native producers, not by an opaque reference or a valid hash.
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const reference = id.refine(value => !value.includes("://"), "Opaque evidence reference required");
const execution = z.object({ executionBasis: z.enum(["TRUSTED_PRE_CALL_STOP", "PROVIDER_CONFIRMED_NO_CALL",
  "PROVIDER_TERMINAL_RESPONSE", "REVIEWED_EXECUTION_RESOLUTION"]), reference, evidenceHash: hash,
  resolvedAt: UtcDateTimeSchema, reservationId: id }).strict();
export const PlanningExecutionEvidenceSchema = planningPlainJsonSchema(execution, 2048);
const billing = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("RELEASED"), noCallReason: z.enum(["FAILED_BEFORE_INVOCATION", "PROVIDER_CONFIRMED_NO_CALL", "RECONCILED_NO_CHARGE"]) }).strict(),
  z.object({ kind: z.literal("SETTLED"), settlementHash: hash, actualMicros: MoneySchema.shape.amountMinor }).strict(),
]);
export const PlanningTerminalEvidenceSchema = planningPlainJsonSchema(execution.extend({ billingBasis: billing }).strict()
  .refine(value => {
    if (value.executionBasis === "TRUSTED_PRE_CALL_STOP") return value.billingBasis.kind === "RELEASED" && value.billingBasis.noCallReason === "FAILED_BEFORE_INVOCATION";
    if (value.executionBasis === "PROVIDER_CONFIRMED_NO_CALL") return value.billingBasis.kind === "RELEASED" && value.billingBasis.noCallReason === "PROVIDER_CONFIRMED_NO_CALL";
    if (value.executionBasis === "PROVIDER_TERMINAL_RESPONSE") return value.billingBasis.kind === "SETTLED";
    return true;
  }, "Execution and billing declarations disagree"), 4096);
export const PlanningResultDispositionSchema = z.enum(["ATTACHED", "DENIED", "STALE", "INVALID"]);
export const PlanningDeniedReasonSchema = z.enum(["AUTH_UNAVAILABLE", "SCOPE_UNAVAILABLE", "SEAT_INELIGIBLE", "ENTITLEMENT_INACTIVE", "CYCLE_EXPIRED"]);
export const PlanningStaleReasonSchema = z.enum(["AUTHORITY_CHANGED", "SNAPSHOT_CHANGED", "AGENT_CHANGED", "SOURCE_CHANGED", "CONFIRMATION_CHANGED", "ARTIFACT_BASE_CHANGED"]);
export const PlanningInvalidReasonSchema = z.enum(["MALFORMED_OUTPUT", "OUTPUT_TOO_LARGE", "WRONG_KIND", "INVALID_FIELD_VALUE",
  "SOURCE_REFERENCE_MISMATCH", "INVALID_ARTIFACT_SET", "INVALID_LANGUAGE", "REFUSAL", "TRUNCATED_OUTPUT", "PAUSED_OUTPUT"]);
export type PlanningExecutionEvidence = z.infer<typeof PlanningExecutionEvidenceSchema>;
export type PlanningTerminalEvidence = z.infer<typeof PlanningTerminalEvidenceSchema>;

export function planningRawOutputHash(completeProviderText: string): string {
  if (typeof completeProviderText !== "string") throw new TypeError("Complete provider text required");
  return createHash("sha256").update(completeProviderText, "utf8").digest("hex");
}
export function planningWireFromRetainedContent(input: unknown) {
  const output = PlanningRetainedContentSchema.parse(input).output;
  if (output.kind === "BRIEF") return PlanningProviderWireSchema.parse({ kind: "BRIEF", narrative: output.narrative });
  if (output.kind === "COMBINED_REFINEMENT") return PlanningProviderWireSchema.parse({ kind: "COMBINED_REFINEMENT",
    changes: output.changes.map(item => ({ base: item.base, revised: item.revised.kind === "BRIEF"
      ? { kind: "BRIEF", narrative: item.revised.narrative } : item.revised })) });
  return PlanningProviderWireSchema.parse(output);
}
export function planningNormalizedWireHash(input: unknown): string {
  return canonicalHash(planningWireFromRetainedContent(input));
}
