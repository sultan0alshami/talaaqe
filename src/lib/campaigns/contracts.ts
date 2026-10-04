import { z } from "zod";
import { MoneySchema } from "@/lib/contracts/money";
import {
  AudienceAgeBucketSchema, AudienceGenderSchema, ArabicDialectSchema, CampaignGoalSchema, ContentLanguageSchema,
  CountryCodeSchema, CreatorTierSchema, CURATED_CITIES, DateRangeSchema, DeliverablesSchema, KpiSchema, UtcDateTimeSchema,
} from "@/lib/contracts/vocabulary";
import { NICHE_TAXONOMY } from "@/lib/contracts/taxonomy";

const text = z.string().min(1).max(5_000).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+$/);
const policyId = z.string().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
const unique = <T extends z.ZodType>(item: T, maximum: number) => z.array(item).max(maximum).refine((items) => new Set(items.map((value) => JSON.stringify(value))).size === items.length, "Duplicate selection");
const cityKeys = new Set(CURATED_CITIES.map((city) => city.key));
const niches = new Set(NICHE_TAXONOMY.map((niche) => niche.slug));
export const CampaignFieldObjectSchema = z.object({
  originalLanguage: ContentLanguageSchema,
  title: text.max(200), productService: text, goal: CampaignGoalSchema, summary: text,
  marketCountryCodes: unique(CountryCodeSchema, 50).refine((items) => items.length > 0, "Choose campaign markets"),
  targetAgeBuckets: unique(AudienceAgeBucketSchema, 7), targetGenders: unique(AudienceGenderSchema, 4),
  targetCountryCodes: unique(CountryCodeSchema, 50),
  targetCityKeys: unique(z.string().refine((value) => cityKeys.has(value), "Unknown curated city"), 50),
  contentLanguages: unique(ContentLanguageSchema.unwrap(), 20).refine((items) => items.length > 0, "Choose content languages"),
  dialects: unique(ArabicDialectSchema, 12),
  nicheSlugs: unique(z.string().refine((value) => niches.has(value), "Unknown curated niche"), 20),
  deliverables: DeliverablesSchema, budget: MoneySchema,
  desiredCreatorCount: z.number().int().min(1).max(12), impressionsTarget: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  period: DateRangeSchema, physicalPresenceRequired: z.boolean(), presenceCountryCodes: unique(CountryCodeSchema, 50),
  travelAllowed: z.boolean(), tone: text.max(500), noGoTopics: unique(text.max(200), 50),
  preferredTiers: unique(CreatorTierSchema, 4), dataVerificationRequired: z.boolean(), preferredLicencePolicyIds: unique(policyId, 50),
  usageRights: text.max(10_000), kpis: z.array(KpiSchema).max(30),
  assumptions: z.array(text.max(500)).max(30), openQuestions: z.array(text.max(500)).max(30),
}).strict();

function crossFields(fields: Partial<z.infer<typeof CampaignFieldObjectSchema>>, context: z.RefinementCtx): void {
  if (fields.targetCityKeys && fields.targetCountryCodes && fields.targetCityKeys.some((key) => !fields.targetCountryCodes!.includes(key.slice(0, 2)))) {
    context.addIssue({ code: "custom", path: ["targetCityKeys"], message: "City target must belong to an explicitly selected target country" });
  }
  if (fields.physicalPresenceRequired && fields.presenceCountryCodes && !fields.presenceCountryCodes.length) {
    context.addIssue({ code: "custom", path: ["presenceCountryCodes"], message: "Choose required presence countries" });
  }
}
export const CampaignFieldsSchema = CampaignFieldObjectSchema.superRefine(crossFields);
export const CampaignDraftFieldsSchema = CampaignFieldObjectSchema.partial().superRefine(crossFields);
export type CampaignFields = z.infer<typeof CampaignFieldsSchema>;
export type CampaignDraftFields = z.infer<typeof CampaignDraftFieldsSchema>;
export const CampaignRequirementsSchema = CampaignFieldObjectSchema.extend({
  campaignId: z.string().min(1).max(200), version: z.number().int().positive(), brandCountryCode: CountryCodeSchema,
  mandatoryPolicyVersionIds: unique(policyId, 50),
}).superRefine(crossFields);
export type CampaignRequirementsDTO = z.infer<typeof CampaignRequirementsSchema>;

// This metadata is supplied by a reviewed server resolver. It is never part of a
// form/chat proposal. Null explicitly means no legal eligibility has been asserted.
export const CampaignPolicyReviewSchema = z.object({
  reviewed: z.literal(true), resolverVersion: policyId, reviewedAt: UtcDateTimeSchema,
  marketCountryCodes: unique(CountryCodeSchema, 50), mandatoryPolicyVersionIds: unique(policyId, 50),
}).strict();
export type CampaignPolicyReview = z.infer<typeof CampaignPolicyReviewSchema>;
export const CampaignBriefContentSchema = z.object({
  schemaVersion: z.literal(1), requirements: CampaignRequirementsSchema, approvedByUserId: z.string().min(1).max(200).nullable(),
  inputRevision: z.number().int().positive(), policyReview: CampaignPolicyReviewSchema.nullable(),
}).strict().superRefine((content, context) => {
  const sameSet = (left: string[], right: string[]) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
  if (!content.policyReview && content.requirements.mandatoryPolicyVersionIds.length) {
    context.addIssue({ code: "custom", path: ["policyReview"], message: "Mandatory assertions require a reviewed server policy context" });
  } else if (content.policyReview && (!sameSet(content.policyReview.marketCountryCodes, content.requirements.marketCountryCodes)
    || !sameSet(content.policyReview.mandatoryPolicyVersionIds, content.requirements.mandatoryPolicyVersionIds))) {
    context.addIssue({ code: "custom", path: ["policyReview"], message: "Policy review scope and mandatory versions must match requirements" });
  }
});
export type CampaignBriefContent = z.infer<typeof CampaignBriefContentSchema>;
export function parseBriefContent(input: unknown): CampaignBriefContent { return CampaignBriefContentSchema.parse(input); }

export const CampaignProposalSchema = z.object({
  type: z.literal("PROPOSE_FIELDS"), patch: CampaignDraftFieldsSchema,
  originalText: z.object({ text: z.string().min(1).max(20_000), language: ContentLanguageSchema }).strict(),
}).strict();
