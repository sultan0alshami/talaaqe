import { z } from "zod";
import { CampaignBriefContentSchema, CampaignDraftFieldsSchema, CampaignFieldObjectSchema,
  type CampaignDraftFields, type CampaignBriefContent } from "@/lib/campaigns/contracts";
import { MoneySchema, CurrencyCodeSchema } from "@/lib/contracts/money";
import { OriginalTextSchema, CampaignStatusSchema, ContentLanguageSchema, UtcDateTimeSchema, DateRangeSchema,
  DeliverableSchema, CreatorTierSchema, AvailabilitySchema, MatchDecisionSchema, QuoteCoverageSchema,
  EvidenceSourceSchema, FactReviewStatusSchema, VisibilitySchema, AudienceAgeBucketSchema, AudienceGenderSchema,
  CountryCodeSchema, CURATED_CITIES } from "@/lib/contracts/vocabulary";
import type { MatchResult, Evidence } from "./types";
import { THRESHOLD, MAX_RESULTS } from "./benchmarks";

// Existing command validation is extracted without widening or tightening it.
export const MatchingOperationKeySchema = z.string().min(1).max(120).regex(/^[A-Za-z0-9_:-]+$/);
export const MatchingIdSchema = z.string().min(1).max(200).regex(/^[\x21-\x7e]+$/);
export const RunCommandSchema = z.object({ operationKey: MatchingOperationKeySchema,
  expectedBriefVersion: z.number().int().positive(), expectedCampaignRevision: z.number().int().positive() }).strict();
export const DecisionCommandSchema = z.object({ operationKey: MatchingOperationKeySchema,
  expectedBriefVersion: z.number().int().positive(), runId: MatchingIdSchema, creatorId: MatchingIdSchema,
  expectedDecisionRevision: z.number().int().nonnegative(), decision: z.enum(["NONE", "SAVED", "DISMISSED"]) }).strict();
export type MatchingRunCommand = z.infer<typeof RunCommandSchema>;
export type MatchingDecisionCommand = z.infer<typeof DecisionCommandSchema>;
export type MatchingDecisionDTO = { creatorId: string; decision: string; revision: number; runId: string | null; updatedAt: string };
export type MatchingDecisionReceipt = MatchingDecisionDTO & { replayed: boolean };
export type MatchingCreatorIdentity = { displayName: string; handle: string };
export type MatchingRunDTO = {
  runId: string; briefVersion: number; strategyId: string; createdAt: string; replayed: boolean; stale: boolean;
  readiness: string; allocationBasis: "FIRST_SLOT_COMPARISON"; desiredCreatorCount: number;
  results: (MatchResult & { stale: boolean; creator: MatchingCreatorIdentity; provenance: Evidence[]; decision: MatchingDecisionDTO | null })[];
};
export type MatchingCampaignResponse = {
  id: string; revision: number; title: string; status: z.infer<typeof CampaignStatusSchema>;
  fields: CampaignDraftFields; fieldsRevision: number;
  proposals: { id: string; patch: CampaignDraftFields; originalText: z.infer<typeof OriginalTextSchema>;
    basedOnFieldsRevision: number; createdAt: string; appliedAt: string | null }[];
  clarificationCount: number; missingFields: string[];
  conversation: { role: "user" | "assistant"; kind: "GREETING" | "CLARIFICATION" | "PROPOSAL";
    text: string; language: string | null; field: string | null; ts: number }[];
  currentBriefVersion: number | null; updatedAt: string;
  briefs: { id: string; campaignId: string; version: number; inputRevision: number; content: CampaignBriefContent;
    approvedAt: string | null; approvedByUserId: string | null; createdAt: string }[];
};
export type MatchingCampaignSummary = Pick<MatchingCampaignResponse, "id" | "title" | "revision" | "currentBriefVersion" | "status"> & { policyReviewed: boolean };

const positive = z.number().int().positive();
const storedRevision = positive.max(2147483647);
const unit = z.number().finite().min(0).max(1);
const estimate = z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER);
const criteria = ["age", "niche", "geography", "gender", "engagement", "budget", "exposure"] as const;
const CriterionSchema = z.enum(criteria);
const observedKeys = new Set(["criterion", "subscore", "missingDataPolicy", "dimension", "buckets", "unreportedPercent",
  "excludedAccountIds", "discountFactor", "coverage", "currencyCode", "subtotalMinor", "totalMinor", "allocationMinor",
  "minimumKnown", "unsupported", "total", "knownSubtotal", "hypothesisVersion", "allocatedTarget", "availability"]);
const nonblank = z.string().refine(value => value.trim().length > 0);
const uniqueStrings = <S extends z.ZodType<string>>(item: S, max?: number) => {
  const schema = z.array(item);
  return (max === undefined ? schema : schema.max(max)).refine(values => new Set(values).size === values.length);
};
const fieldNames = Object.keys(CampaignFieldObjectSchema.shape);
const field = z.string().refine(value => fieldNames.includes(value));
const BriefResponseSchema = z.object({ id: MatchingIdSchema, campaignId: MatchingIdSchema,
  version: storedRevision, inputRevision: storedRevision, content: CampaignBriefContentSchema,
  approvedAt: UtcDateTimeSchema.nullable(), approvedByUserId: MatchingIdSchema.nullable(), createdAt: UtcDateTimeSchema,
}).strict().refine(row => row.campaignId === row.content.requirements.campaignId
  && row.version === row.content.requirements.version && row.inputRevision === row.content.inputRevision
  && row.approvedByUserId === row.content.approvedByUserId && Boolean(row.approvedAt) === Boolean(row.approvedByUserId));
export const MatchingCampaignResponseSchema: z.ZodType<MatchingCampaignResponse> = z.object({
  id: MatchingIdSchema, revision: storedRevision, title: z.string(), status: CampaignStatusSchema,
  fields: CampaignDraftFieldsSchema, fieldsRevision: positive,
  proposals: z.array(z.object({ id: z.string(), patch: CampaignDraftFieldsSchema, originalText: OriginalTextSchema,
    basedOnFieldsRevision: positive, createdAt: UtcDateTimeSchema, appliedAt: UtcDateTimeSchema.nullable() }).strict()).max(50),
  clarificationCount: z.number().int().min(0).max(5), missingFields: uniqueStrings(field, fieldNames.length),
  conversation: z.array(z.object({ role: z.enum(["user", "assistant"]), kind: z.enum(["GREETING", "CLARIFICATION", "PROPOSAL"]),
    text: z.string().max(20000), language: ContentLanguageSchema, field: field.nullable(),
    ts: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict()).max(200),
  currentBriefVersion: storedRevision.nullable(), briefs: z.array(BriefResponseSchema), updatedAt: UtcDateTimeSchema,
}).strict().refine(campaign => campaign.briefs.every((brief, index, rows) => brief.campaignId === campaign.id
  && (index === 0 || brief.version > rows[index - 1]!.version)));
export const MatchingCampaignSummarySchema: z.ZodType<MatchingCampaignSummary> = z.object({
  id: MatchingIdSchema, title: z.string(), revision: storedRevision, currentBriefVersion: storedRevision.nullable(),
  status: CampaignStatusSchema, policyReviewed: z.boolean(),
}).strict();
const EvidenceSchema = z.object({ source: EvidenceSourceSchema, evidenceAt: UtcDateTimeSchema,
  reviewStatus: FactReviewStatusSchema, visibility: VisibilitySchema, version: nonblank }).strict();
const accountIds = uniqueStrings(MatchingIdSchema, 100);
const cities = new Set(CURATED_CITIES.map(city => city.key));
function dimension(key: z.ZodType<string>) {
  return z.object({ buckets: z.array(z.object({ key, percent: z.number().finite().min(0).max(100 + 1e-10) }).strict()).max(300),
    unreportedPercent: z.number().finite().min(0).max(100), contributingAccountIds: accountIds,
    excludedAccountIds: accountIds, evidence: z.array(EvidenceSchema).max(200),
  }).strict().refine(row => new Set(row.buckets.map(bucket => bucket.key)).size === row.buckets.length
    && row.buckets.reduce((sum, bucket) => sum + bucket.percent, 0) <= 100.01 + 1e-10
    && row.contributingAccountIds.every(id => !row.excludedAccountIds.includes(id)));
}
const AudienceSchema = z.object({ age: dimension(AudienceAgeBucketSchema).nullable(),
  gender: dimension(AudienceGenderSchema).nullable(), countries: dimension(CountryCodeSchema).nullable(),
  cities: dimension(z.string().refine(value => cities.has(value))).nullable(),
}).strict();
// Output arrays validate without the input parser's duplicate-merging transform.
const deliverables = z.array(DeliverableSchema).max(100);
const QuoteSchema = z.object({ coverage: QuoteCoverageSchema, currencyCode: CurrencyCodeSchema,
  supported: deliverables, unsupported: deliverables,
  rows: z.array(z.object({ deliverable: DeliverableSchema, amount: MoneySchema.nullable(),
    missingReason: z.literal("NO_MATCHING_CURRENCY_RATE").nullable() }).strict()
    .refine(row => (row.amount === null) === (row.missingReason !== null))).max(100),
  subtotal: MoneySchema.nullable(), total: MoneySchema.nullable(), minimum: MoneySchema.nullable(),
  minimumKnown: z.boolean(), comparisonAmount: MoneySchema.nullable(),
}).strict().refine(quote => [...quote.rows.map(row => row.amount), quote.subtotal, quote.total, quote.minimum, quote.comparisonAmount]
  .every(amount => amount === null || amount.currencyCode === quote.currencyCode));
const EstimateRowSchema = z.object({ deliverable: DeliverableSchema, estimatedImpressions: estimate.nullable(),
  basis: z.enum(["OBSERVED_AVERAGE", "FOLLOWER_HYPOTHESIS", "UNKNOWN"]), accountId: MatchingIdSchema.nullable(),
  observedUnit: z.enum(["VIEWS", "IMPRESSIONS"]).nullable(), definition: z.string().nullable(),
  window: DateRangeSchema.nullable(), evidence: z.array(EvidenceSchema).max(1),
}).strict();
const EstimateSchema = z.object({ label: z.literal("ESTIMATED_IMPRESSIONS"), total: estimate.nullable(),
  knownSubtotal: estimate.nullable(), rows: z.array(EstimateRowSchema).max(100), hypothesisVersion: nonblank,
  uniqueAudience: z.literal(false),
}).strict();
const DecisionSchema = z.object({ creatorId: MatchingIdSchema, decision: MatchDecisionSchema, revision: storedRevision,
  runId: MatchingIdSchema.nullable(), updatedAt: UtcDateTimeSchema,
}).strict();
export const MatchingDecisionReceiptSchema: z.ZodType<MatchingDecisionReceipt> = DecisionSchema.extend({ replayed: z.boolean() }).strict();
const ResultSchema = z.object({ creatorId: MatchingIdSchema, strategyId: nonblank, briefVersion: storedRevision,
  score: z.number().int().min(THRESHOLD).max(100), weightedFit: unit, rawConfidence: unit,
  subscores: z.object({ age: unit.nullable(), niche: unit.nullable(), geography: unit.nullable(), gender: unit.nullable(),
    engagement: unit.nullable(), budget: unit.nullable(), exposure: unit.nullable() }).strict(),
  completeness: z.object({ known: z.number().int().min(0).max(7), total: z.literal(7),
    unknownCriteria: uniqueStrings(CriterionSchema, 7) }).strict(),
  relevantAccountIds: accountIds.refine(ids => ids.length > 0), evidenceVersions: uniqueStrings(nonblank), policyVersions: uniqueStrings(nonblank),
  audience: AudienceSchema, geographyBasis: z.enum(["CITY", "COUNTRY", "COUNTRY_FALLBACK", "UNKNOWN"]),
  quote: QuoteSchema, allocation: MoneySchema, allocatedImpressionsTarget: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  estimatedImpressions: EstimateSchema, tier: CreatorTierSchema.nullable(), prospect: z.boolean(), availability: AvailabilitySchema,
  executableOffer: z.boolean(), reasons: z.array(z.object({ kind: z.string(), criterion: CriterionSchema.nullable(),
    text: z.object({ ar: z.string(), en: z.string() }).strict(),
    observed: z.record(z.string().refine(key => observedKeys.has(key)), z.union([z.string(), z.number().finite(), z.array(z.string()), z.null()])),
  }).strict()), stale: z.boolean(), creator: z.object({ displayName: z.string(), handle: z.string() }).strict(),
  provenance: z.array(EvidenceSchema), decision: DecisionSchema.nullable(),
}).strict().refine(row => row.quote.currencyCode === row.allocation.currencyCode
  && (row.decision === null || row.decision.creatorId === row.creatorId)
  && row.completeness.known === 7 - row.completeness.unknownCriteria.length
  && criteria.every(key => (row.subscores[key] === null) === row.completeness.unknownCriteria.includes(key)));
export const MatchingRunSchema: z.ZodType<MatchingRunDTO> = z.object({ runId: MatchingIdSchema, briefVersion: storedRevision,
  strategyId: nonblank, createdAt: UtcDateTimeSchema, replayed: z.boolean(), stale: z.boolean(),
  readiness: z.enum(["READY", "POLICY_OUTCOMES_UNAVAILABLE"]), allocationBasis: z.literal("FIRST_SLOT_COMPARISON"),
  desiredCreatorCount: CampaignFieldObjectSchema.shape.desiredCreatorCount, results: z.array(ResultSchema).max(MAX_RESULTS),
}).strict().refine(run => new Set(run.results.map(row => row.creatorId)).size === run.results.length
  && run.results.every((row, index, rows) => row.briefVersion === run.briefVersion && row.strategyId === run.strategyId
    && (index === 0 || rows[index - 1]!.score > row.score
      || rows[index - 1]!.score === row.score && rows[index - 1]!.creatorId < row.creatorId)));
export function summarizeMatchingCampaign(campaign: MatchingCampaignResponse): MatchingCampaignSummary {
  return { id: campaign.id, title: campaign.title, revision: campaign.revision, currentBriefVersion: campaign.currentBriefVersion,
    status: campaign.status, policyReviewed: !!campaign.briefs.find(brief => brief.version === campaign.currentBriefVersion)?.content.policyReview };
}
export function matchesDecisionReceipt(command: MatchingDecisionCommand, receipt: MatchingDecisionReceipt): boolean {
  return receipt.creatorId === command.creatorId && receipt.decision === command.decision && receipt.runId === command.runId
    && Number.isSafeInteger(command.expectedDecisionRevision + 1) && receipt.revision === command.expectedDecisionRevision + 1;
}
export function matchesRunReceipt(command: MatchingRunCommand, receipt: MatchingRunDTO): boolean {
  return receipt.briefVersion === command.expectedBriefVersion;
}
