import { ENGAGEMENT_BASELINES } from "./benchmarks";
import { followerValue, nonnegative, unique, usableFact, validateMetricContext } from "./evidence";
import type { AggregatedAudience, AggregatedDimension, Evidence, MatchingAccount } from "./types";

export const clamp = (value: number): number => Math.min(1, Math.max(0, value));
const share = (dimension: AggregatedDimension, targets: readonly string[]) => dimension.buckets.filter((row) => targets.includes(row.key)).reduce((sum, row) => sum + row.percent, 0);
export function ageFit(targets: readonly string[], dimension: AggregatedDimension | null): number | null {
  const keys = unique(targets); if (!keys.length || !dimension) return null;
  const audience = new Map(dimension.buckets.map((row) => [row.key, row.percent]));
  return clamp(keys.reduce((sum, key) => sum + Math.min(audience.get(key) ?? 0, 100 / keys.length), 0) / 100);
}
export function genderFit(targets: readonly string[], dimension: AggregatedDimension | null): number | null { return !targets.length || !dimension ? null : clamp(share(dimension, unique(targets)) / 100); }
export function geographyFit(cities: readonly string[], countries: readonly string[], audience: AggregatedAudience): { score: number | null; basis: "CITY" | "COUNTRY" | "COUNTRY_FALLBACK" | "UNKNOWN"; evidence: Evidence[] } {
  if (cities.length && audience.cities) return { score: clamp(share(audience.cities, unique(cities)) / 100), basis: "CITY", evidence: audience.cities.evidence };
  if (countries.length && audience.countries) return { score: clamp(share(audience.countries, unique(countries)) / 100) * (cities.length ? .8 : 1), basis: cities.length ? "COUNTRY_FALLBACK" : "COUNTRY", evidence: audience.countries.evidence };
  return { score: null, basis: "UNKNOWN", evidence: [] };
}
export function nicheFit(campaign: readonly string[], creator: readonly string[], relatedTargetSlugs: readonly string[], fameRelatedTargetSlugs: readonly string[]): number | null {
  const targets = unique(campaign); if (!targets.length) return null;
  const held = new Set(creator); const related = new Set([...relatedTargetSlugs, ...fameRelatedTargetSlugs]);
  const exact = targets.filter((slug) => held.has(slug)).length;
  const halfHits = targets.filter((slug) => !held.has(slug) && related.has(slug)).length;
  return clamp((exact + .5 * halfHits) / new Set([...targets, ...held]).size);
}
export function engagementFit(accounts: readonly MatchingAccount[], now: string): { score: number | null; evidence: Evidence[] } {
  const available = accounts.flatMap((account) => {
    const rate = usableFact(account.engagementPct, now); const followers = followerValue(account.followers, now);
    if (rate) {
      if (!account.engagementContext || account.engagementContext.unit !== "PERCENT") throw new Error("Engagement requires an explicit percent unit/context");
      validateMetricContext(account.engagementContext, rate.evidence);
    }
    return !rate || followers === null ? [] : [{ score: clamp(nonnegative(rate.value, "Engagement percent") / (2 * ENGAGEMENT_BASELINES[account.platform])), weight: Math.max(1, followers), evidence: [rate.evidence, account.followers!.evidence] }];
  });
  if (!available.length) return { score: null, evidence: [] };
  const weight = available.reduce((sum, row) => sum + row.weight, 0);
  return { score: clamp(available.reduce((sum, row) => sum + row.score * row.weight / weight, 0)), evidence: available.flatMap((row) => row.evidence) };
}
