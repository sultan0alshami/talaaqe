import { AudienceAgeBucketSchema, AudienceGenderSchema, CountryCodeSchema, CURATED_CITIES } from "../contracts/vocabulary";
import { asciiCompare, followerValue, usableFact, validNow } from "./evidence";
import type { AggregatedAudience, AggregatedDimension, AudienceInput, Bucket, MatchingAccount } from "./types";

const cities = new Set(CURATED_CITIES.map((city) => city.key));
export function validateBuckets(rows: Bucket[], dimension: keyof AudienceInput, tolerance: boolean): void {
  if (!Array.isArray(rows) || rows.length > 300) throw new Error("Invalid bounded demographic buckets");
  const keys = new Set<string>(); let total = 0;
  for (const row of rows) {
    if (!row || typeof row.key !== "string" || !Number.isFinite(row.percent) || row.percent < 0 || row.percent > 100 || keys.has(row.key)) throw new Error("Invalid/duplicate demographic percentage");
    if (dimension === "age") AudienceAgeBucketSchema.parse(row.key);
    if (dimension === "gender") AudienceGenderSchema.parse(row.key);
    if (dimension === "countries") CountryCodeSchema.parse(row.key);
    if (dimension === "cities" && !cities.has(row.key)) throw new Error("Audience city must be curated and country-qualified");
    keys.add(row.key); total += row.percent;
  }
  if (total > 100 + (tolerance ? .01 : 0) + 1e-10) throw new Error("Demographic dimension exceeds100%; documented rounding tolerance only");
}
export function aggregateDimension(accounts: readonly MatchingAccount[], dimension: keyof AudienceInput, now: string): AggregatedDimension | null {
  const contributions = accounts.flatMap((account) => {
    const fact = usableFact(account.audience[dimension], now);
    if (!fact) return [];
    validateBuckets(fact.value, dimension, fact.roundingToleranceDocumented === true);
    if (!fact.value.length) return [];
    const followers = followerValue(account.followers, now);
    return followers === null ? [] : [{ account, fact, weight: Math.max(1, followers) }];
  });
  if (!contributions.length) return null;
  const totalWeight = contributions.reduce((total, row) => total + row.weight, 0);
  const percentages = new Map<string, number>();
  for (const row of contributions) for (const bucket of row.fact.value) percentages.set(bucket.key, (percentages.get(bucket.key) ?? 0) + row.weight / totalWeight * bucket.percent);
  const contributingAccountIds = contributions.map((row) => row.account.id).sort(asciiCompare);
  const buckets = [...percentages].map(([key, percent]) => ({ key, percent })).sort((left, right) => asciiCompare(left.key, right.key));
  return { buckets, unreportedPercent: Math.max(0, 100 - buckets.reduce((sum, row) => sum + row.percent, 0)), contributingAccountIds, excludedAccountIds: accounts.filter((account) => !contributingAccountIds.includes(account.id)).map((account) => account.id).sort(asciiCompare), evidence: contributions.flatMap((row) => [row.fact.evidence, row.account.followers!.evidence]) };
}
// Shared by profile projection and matcher. Caller chooses already-authorized all-account
// or campaign-relevant subset; this function never infers uniqueness or joint demographics.
export function aggregateAudience(accounts: readonly MatchingAccount[], now: string): AggregatedAudience {
  validNow(now);
  if (new Set(accounts.map((account) => account.id)).size !== accounts.length) throw new Error("Duplicate account identity");
  return { age: aggregateDimension(accounts, "age", now), gender: aggregateDimension(accounts, "gender", now), countries: aggregateDimension(accounts, "countries", now), cities: aggregateDimension(accounts, "cities", now) };
}
