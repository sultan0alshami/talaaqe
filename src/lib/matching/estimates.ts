import type { Deliverable } from "../contracts/vocabulary";
import { FALLBACK_FORMATS, HYPOTHESIS_VERSION, VIEW_FALLBACKS } from "./benchmarks";
import { asciiCompare, followerValue, nonnegative, usableFact, validateMetricContext } from "./evidence";
import type { EstimateRow, ImpressionsEstimate, MatchingAccount } from "./types";

export function estimateImpressions(accounts: readonly MatchingAccount[], deliverables: readonly Deliverable[], now: string): ImpressionsEstimate {
  const rows: EstimateRow[] = deliverables.map((deliverable) => {
    const available = accounts.filter((account) => account.platform === deliverable.platform && account.supportedFormats.includes(deliverable.format)).map((account) => {
      const observations = account.averageViews.filter((view) => view.format === deliverable.format && usableFact(view.value, now));
      if (observations.length > 1) throw new Error("Duplicate observed average per account/format");
      const observed = observations[0] ?? null;
      if (observed) {
        if (!["VIEWS", "IMPRESSIONS"].includes(observed.unit)) throw new Error("Observed average requires supported source unit");
        validateMetricContext(observed, observed.value.evidence);
        nonnegative(observed.value.value, "Observed average views");
      }
      return { account, observed, followers: followerValue(account.followers, now) };
    }).sort((left, right) => Number(right.observed !== null) - Number(left.observed !== null) || (right.followers ?? -1) - (left.followers ?? -1) || asciiCompare(left.account.id, right.account.id));
    // A basket row denotes one placement count, not that count on every same-platform account.
    const selected = available.find((row) => row.observed || (FALLBACK_FORMATS.has(deliverable.format) && row.followers !== null));
    if (!selected) return { deliverable, estimatedImpressions: null, basis: "UNKNOWN", accountId: null, observedUnit: null, definition: null, window: null, evidence: [] };
    const value = selected.observed ? selected.observed.value.value : selected.followers! * VIEW_FALLBACKS[deliverable.platform];
    const estimatedImpressions = value * deliverable.count;
    if (!Number.isFinite(estimatedImpressions) || estimatedImpressions > Number.MAX_SAFE_INTEGER) throw new Error("Estimated impressions overflow safe range");
    return { deliverable, estimatedImpressions, basis: selected.observed ? "OBSERVED_AVERAGE" : "FOLLOWER_HYPOTHESIS", accountId: selected.account.id, observedUnit: selected.observed?.unit ?? null, definition: selected.observed?.definition ?? `Platform hypothesis: ${VIEW_FALLBACKS[deliverable.platform]} impressions per follower per ${deliverable.format.toLowerCase()}`, window: selected.observed?.window ?? null, evidence: [selected.observed?.value.evidence ?? selected.account.followers!.evidence] };
  });
  const known = rows.filter((row) => row.estimatedImpressions !== null);
  const knownSubtotal = known.length ? known.reduce((total, row) => total + row.estimatedImpressions!, 0) : null;
  if (knownSubtotal !== null && (!Number.isFinite(knownSubtotal) || knownSubtotal > Number.MAX_SAFE_INTEGER)) throw new Error("Estimated impressions total overflow");
  return { label: "ESTIMATED_IMPRESSIONS", total: rows.length && known.length === rows.length ? knownSubtotal : null, knownSubtotal, rows, hypothesisVersion: HYPOTHESIS_VERSION, uniqueAudience: false };
}
