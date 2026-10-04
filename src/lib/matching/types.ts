import type { z } from "zod";
import type { Money } from "../contracts/money";
import type { AudienceAgeBucketSchema, AudienceGenderSchema, AvailabilitySchema, EvidenceSourceSchema, FactReviewStatusSchema, FameIndustrySchema, LicenceStatusSchema, OwnershipStatusSchema, QuoteCoverageSchema, VisibilitySchema, DateRange, Deliverable, DealFormat, Platform } from "../contracts/vocabulary";

export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;
export type AudienceAgeBucket = z.infer<typeof AudienceAgeBucketSchema>;
export type AudienceGender = z.infer<typeof AudienceGenderSchema>;
export type Availability = z.infer<typeof AvailabilitySchema>;
export type Evidence = { source: EvidenceSource; evidenceAt: string; reviewStatus: z.infer<typeof FactReviewStatusSchema>; visibility: z.infer<typeof VisibilitySchema>; version: string };
export type Fact<T> = { value: T; evidence: Evidence; roundingToleranceDocumented?: boolean };
export type Bucket<K extends string = string> = { key: K; percent: number };
export type AudienceInput = { age: Fact<Bucket<AudienceAgeBucket>[]> | null; gender: Fact<Bucket<AudienceGender>[]> | null; countries: Fact<Bucket[]> | null; cities: Fact<Bucket[]> | null };
export type MetricContext = { window: DateRange; definition: string };
export type ViewObservation = MetricContext & { format: DealFormat; value: Fact<number>; unit: "VIEWS" | "IMPRESSIONS" };
export type MatchingAccount = { id: string; platform: Platform; ownershipStatus: z.infer<typeof OwnershipStatusSchema>; approved: boolean; visibility: z.infer<typeof VisibilitySchema>; evidence: Evidence | null; supportedFormats: DealFormat[]; followers: Fact<number> | null; engagementPct: Fact<number> | null; engagementContext: (MetricContext & { unit: "PERCENT" }) | null; averageViews: ViewObservation[]; audience: AudienceInput };
export type CreatorTier = "NANO" | "MICRO" | "MACRO" | "MEGA";
// These records are loaded from a reviewed policy engine, never supplied by a brand request.
// The pure matcher verifies version/scope/status/time; it does not invent jurisdiction rules.
export type PolicyOutcome = { policyId: string; versionId: string; reviewed: boolean; status: "PASS" | "FAIL" | "UNKNOWN"; accountIds: string[]; validUntil: string | null };
export type MatchingLicence = { id: string; policyIds: string[]; jurisdiction: string; status: z.infer<typeof LicenceStatusSchema>; accountIds: string[]; reviewedAt: string | null; expiresAt: string | null };
export type SafetyExclusion = { topic: string; policyVersionId: string; reviewed: boolean; evidence: Evidence };
export type Rate = { creatorId: string; platform: Platform; format: DealFormat; amount: Money };
export type CreatorInput = { id: string; claimStatus: "CLAIMED" | "UNCLAIMED"; hidden: boolean; suspended: boolean; isTest: boolean; eligible: boolean; brandVisible: boolean; residenceCountryCode: string; contentLanguages: string[]; dialects: string[]; availability: { status: Availability; period: DateRange | null; confirmedAt: string | null }; travelWilling: boolean; travelCountryCodes: string[]; nicheSlugs: Fact<string[]> | null; fameIndustries: Fact<z.infer<typeof FameIndustrySchema>[]> | null; accounts: MatchingAccount[]; rates: Rate[]; minimumDeal: Money | null; minimumDealKnown?: boolean; licences: MatchingLicence[]; policyOutcomes: PolicyOutcome[]; safetyExclusions: SafetyExclusion[] };
export type CampaignInput = { id: string; briefVersion: number; approved: boolean; budget: Money; desiredCreatorCount: number; allocationOrdinal: number; explicitAllocation?: Money; impressionsTarget: number | null; explicitImpressionsAllocation?: number; period: DateRange; deliverables: Deliverable[]; targetAgeBuckets: AudienceAgeBucket[]; targetGenders: AudienceGender[]; targetCountryCodes: string[]; targetCityKeys: string[]; contentLanguages: string[]; dialects: string[]; nicheSlugs: string[]; marketCountryCodes: string[]; physicalPresenceRequired: boolean; presenceCountryCodes: string[]; travelAllowed: boolean; preferredTiers: CreatorTier[]; dataVerificationRequired: boolean; preferredLicencePolicyIds: string[]; mandatoryPolicyVersionIds: string[]; noGoTopics: string[] };
export type Criterion = "age" | "niche" | "geography" | "gender" | "engagement" | "budget" | "exposure";
export type Subscores = Record<Criterion, number | null>;
export type AggregatedDimension = { buckets: Bucket[]; unreportedPercent: number; contributingAccountIds: string[]; excludedAccountIds: string[]; evidence: Evidence[] };
export type AggregatedAudience = { age: AggregatedDimension | null; gender: AggregatedDimension | null; countries: AggregatedDimension | null; cities: AggregatedDimension | null };
export type QuoteRow = { deliverable: Deliverable; amount: Money | null; missingReason: "NO_MATCHING_CURRENCY_RATE" | null };
export type BasketQuote = { coverage: z.infer<typeof QuoteCoverageSchema>; currencyCode: string; supported: Deliverable[]; unsupported: Deliverable[]; rows: QuoteRow[]; subtotal: Money | null; total: Money | null; minimum: Money | null; minimumKnown: boolean; comparisonAmount: Money | null };
export type EstimateRow = { deliverable: Deliverable; estimatedImpressions: number | null; basis: "OBSERVED_AVERAGE" | "FOLLOWER_HYPOTHESIS" | "UNKNOWN"; accountId: string | null; observedUnit: "VIEWS" | "IMPRESSIONS" | null; definition: string | null; window: DateRange | null; evidence: Evidence[] };
export type ImpressionsEstimate = { label: "ESTIMATED_IMPRESSIONS"; total: number | null; knownSubtotal: number | null; rows: EstimateRow[]; hypothesisVersion: string; uniqueAudience: false };
export type MatchReason = { kind: string; criterion: Criterion | null; text: { ar: string; en: string }; observed: Record<string, string | number | string[] | null> };
export type MatchResult = { creatorId: string; strategyId: string; briefVersion: number; score: number; weightedFit: number; rawConfidence: number; subscores: Subscores; completeness: { known: number; total: 7; unknownCriteria: Criterion[] }; relevantAccountIds: string[]; evidenceVersions: string[]; policyVersions: string[]; audience: AggregatedAudience; geographyBasis: "CITY" | "COUNTRY" | "COUNTRY_FALLBACK" | "UNKNOWN"; quote: BasketQuote; allocation: Money; allocatedImpressionsTarget: number | null; estimatedImpressions: ImpressionsEstimate; tier: CreatorTier | null; prospect: boolean; availability: Availability; executableOffer: boolean; reasons: MatchReason[] };
export type EligibilityResult = { eligible: boolean; exclusions: string[]; relevantAccounts: MatchingAccount[]; prospect: boolean; availability: Availability; executableOffer: boolean; match: MatchResult | null };
export type NicheTaxon = { slug: string; parentSlug: string | null };
export type ExposureBenchmark = { id: string; version: string; reviewed: boolean; enabled: boolean; reviewedAt: string; marketCountryCodes: string[]; currencyCode: string; goal: string; impressionsPerMajorUnit: { numerator: string; denominator: string } };
export type MatchingOptions = { nicheTaxonomy?: readonly NicheTaxon[]; exposureBenchmark?: ExposureBenchmark; campaignGoal?: string };
