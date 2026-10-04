import { DateRangeSchema, EvidenceSourceSchema, FactReviewStatusSchema, UtcDateTimeSchema, VisibilitySchema } from "../contracts/vocabulary";
import { FRESHNESS_MS, SOURCE_CONFIDENCE } from "./benchmarks";
import type { Evidence, Fact, MetricContext } from "./types";

export function validNow(now: string): number { return Date.parse(UtcDateTimeSchema.parse(now)); }
export function isRecordedEvidence(evidence: Evidence | null, now: string): evidence is Evidence {
  if (!evidence || !EvidenceSourceSchema.safeParse(evidence.source).success || !FactReviewStatusSchema.safeParse(evidence.reviewStatus).success || !VisibilitySchema.safeParse(evidence.visibility).success || !UtcDateTimeSchema.safeParse(evidence.evidenceAt).success || typeof evidence.version !== "string" || !evidence.version.trim()) return false;
  return evidence.reviewStatus === "APPROVED" && Date.parse(evidence.evidenceAt) <= validNow(now);
}
export function isEvidenceUsable(evidence: Evidence | null, now: string): evidence is Evidence {
  if (!isRecordedEvidence(evidence, now)) return false;
  const age = validNow(now) - Date.parse(evidence.evidenceAt);
  return evidence.visibility !== "PRIVATE" && age >= 0 && age <= FRESHNESS_MS;
}
export function usableFact<T>(fact: Fact<T> | null, now: string): Fact<T> | null { return fact && isEvidenceUsable(fact.evidence, now) ? fact : null; }
export function nonnegative(value: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and nonnegative`);
  return value;
}
export function followerValue(fact: Fact<number> | null, now: string): number | null {
  const available = usableFact(fact, now);
  if (!available) return null;
  if (!Number.isSafeInteger(available.value) || available.value < 0) throw new Error("Followers must be a nonnegative safe integer");
  return available.value;
}
export function weakestConfidence(evidence: Evidence[]): number {
  if (!evidence.length) throw new Error("No applicable evidence; candidate is ineligible");
  return Math.min(...evidence.map((item) => SOURCE_CONFIDENCE[item.source]));
}
export function asciiCompare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
export function unique(values: readonly string[]): string[] { return [...new Set(values)].sort(asciiCompare); }
export function validId(id: string): void { if (typeof id !== "string" || !/^[\x21-\x7e]{1,200}$/.test(id)) throw new Error("Immutable identifier must be nonempty ASCII"); }
export function validateMetricContext(context: MetricContext, evidence: Evidence): void {
  DateRangeSchema.parse(context.window);
  if (typeof context.definition !== "string" || !context.definition.trim() || context.definition.length > 500 || Date.parse(context.window.endsAt) > Date.parse(evidence.evidenceAt)) throw new Error("Metric requires an explicit definition and valid measurement window");
}
