import { allocateIntegerTarget, allocateMoney, currencyPrecision, MoneySchema, type Money } from "../contracts/money";
import { NICHE_BY_SLUG, NICHE_TAXONOMY } from "../contracts/taxonomy";
import { AudienceAgeBucketSchema, AudienceGenderSchema, CampaignGoalSchema, ContentLanguageSchema, CountryCodeSchema, CURATED_CITIES, DateRangeSchema, DeliverablesSchema, FameIndustrySchema, UtcDateTimeSchema } from "../contracts/vocabulary";
import { aggregateAudience } from "./aggregation";
import { FAME_RELATED_NICHES, MAX_RESULTS, STRATEGY_ID, THRESHOLD, UNKNOWN_SUBSTITUTION, WEIGHTS } from "./benchmarks";
import { asciiCompare, unique, usableFact, validId, validNow, weakestConfidence } from "./evidence";
import { estimateImpressions } from "./estimates";
import { creatorTier, eligibilityExclusions, relevantAccounts } from "./filters";
import { budgetFit, quoteBasket } from "./quote";
import { ageFit, clamp, engagementFit, genderFit, geographyFit, nicheFit } from "./subscores";
import type { CampaignInput, CreatorInput, Criterion, EligibilityResult, Evidence, MatchReason, MatchResult, MatchingOptions, Subscores } from "./types";

const criteria = Object.keys(WEIGHTS) as Criterion[];
const cities = new Set(CURATED_CITIES.map((city) => city.key));
function decimalParts(value: number): { numerator: bigint; scale: number } {
  const [mantissa, exponentText = "0"] = value.toString().split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  const scale = fraction.length - Number(exponentText);
  const numerator = BigInt(`${whole}${fraction}`);
  return scale >= 0 ? { numerator, scale } : { numerator: numerator * BigInt(10) ** BigInt(-scale), scale: 0 };
}
function roundedScore(subscores: Subscores, confidence: number): number {
  const parts = criteria.map((key) => ({ ...decimalParts(subscores[key] ?? UNKNOWN_SUBSTITUTION), weight: Math.round(WEIGHTS[key] * 100) }));
  const scale = Math.max(...parts.map((part) => part.scale));
  const weightedPercentNumerator = parts.reduce((total, part) => total + BigInt(part.weight) * part.numerator * BigInt(10) ** BigInt(scale - part.scale), BigInt(0));
  const confidenceParts = decimalParts(confidence); const confidenceDenominator = BigInt(10) ** BigInt(confidenceParts.scale);
  const numerator = weightedPercentNumerator * (confidenceDenominator + confidenceParts.numerator);
  const denominator = BigInt(10) ** BigInt(scale) * confidenceDenominator * BigInt(2);
  // Exactly round the canonical decimal numeric inputs, half upward, with no epsilon.
  // This avoids59.5 becoming59.49999999999999 through binary multiplication.
  return Number((BigInt(2) * numerator + denominator) / (BigInt(2) * denominator));
}
function validateStrings(values: readonly string[]): void { if (!Array.isArray(values) || values.length > 300 || values.some((value) => typeof value !== "string" || !value.trim() || value.length > 200)) throw new Error("Expected bounded nonempty string list"); }
function validateSlugs(values: readonly string[]): void {
  validateStrings(values);
  if (values.some((value) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || !Object.hasOwn(NICHE_BY_SLUG, value))) throw new Error("Expected known canonical niche slug");
}
const canonicalNicheParents = new Map(NICHE_TAXONOMY.map(({ slug, parentSlug }) => [slug, parentSlug]));
function nicheParents(options: MatchingOptions): ReadonlyMap<string, string | null> {
  if (options.nicheTaxonomy === undefined) return canonicalNicheParents;
  const rows = options.nicheTaxonomy;
  if (!Array.isArray(rows) || !rows.length || rows.length > NICHE_TAXONOMY.length) throw new Error("Invalid bounded taxonomy snapshot");
  const parents = new Map<string, string | null>();
  for (const row of rows) {
    validateSlugs([row.slug]);
    if (row.parentSlug !== null) validateSlugs([row.parentSlug]);
    if (parents.has(row.slug)) throw new Error("Duplicate taxonomy niche slug");
    parents.set(row.slug, row.parentSlug);
  }
  for (const slug of parents.keys()) {
    const visited = new Set<string>(); let current: string | null = slug;
    while (current !== null) {
      if (visited.has(current)) throw new Error("Cyclic taxonomy niche references");
      if (!parents.has(current)) throw new Error("Missing taxonomy parent niche");
      visited.add(current); current = parents.get(current)!;
    }
  }
  return parents;
}
function validateCampaign(campaign: CampaignInput): CampaignInput {
  validId(campaign.id); MoneySchema.parse(campaign.budget); DateRangeSchema.parse(campaign.period);
  if (!Number.isSafeInteger(campaign.briefVersion) || campaign.briefVersion < 1) throw new Error("Approved brief version must be positive");
  if (!Number.isInteger(campaign.desiredCreatorCount) || campaign.desiredCreatorCount < 1 || campaign.desiredCreatorCount > 12 || !Number.isInteger(campaign.allocationOrdinal) || campaign.allocationOrdinal < 0 || campaign.allocationOrdinal >= campaign.desiredCreatorCount) throw new Error("Invalid immutable allocation ordinal/count");
  if (campaign.impressionsTarget !== null && (!Number.isSafeInteger(campaign.impressionsTarget) || campaign.impressionsTarget < 0)) throw new Error("Invalid integer impressions target");
  if (campaign.explicitAllocation) {
    const amount = MoneySchema.parse(campaign.explicitAllocation);
    if (amount.currencyCode !== campaign.budget.currencyCode || BigInt(amount.amountMinor) > BigInt(campaign.budget.amountMinor)) throw new Error("Invalid explicit matching-currency allocation");
  }
  if (campaign.explicitImpressionsAllocation !== undefined && (!Number.isSafeInteger(campaign.explicitImpressionsAllocation) || campaign.explicitImpressionsAllocation < 0 || campaign.impressionsTarget === null || campaign.explicitImpressionsAllocation > campaign.impressionsTarget)) throw new Error("Invalid explicit impressions allocation");
  for (const values of [campaign.targetAgeBuckets, campaign.targetGenders, campaign.targetCountryCodes, campaign.targetCityKeys, campaign.contentLanguages, campaign.dialects, campaign.marketCountryCodes, campaign.presenceCountryCodes, campaign.preferredTiers, campaign.preferredLicencePolicyIds, campaign.mandatoryPolicyVersionIds, campaign.noGoTopics]) validateStrings(values);
  campaign.targetAgeBuckets.forEach((key) => AudienceAgeBucketSchema.parse(key)); campaign.targetGenders.forEach((key) => AudienceGenderSchema.parse(key));
  [...campaign.targetCountryCodes, ...campaign.marketCountryCodes, ...campaign.presenceCountryCodes].forEach((key) => CountryCodeSchema.parse(key));
  if (campaign.targetCityKeys.some((key) => !cities.has(key))) throw new Error("Campaign audience city must be curated");
  campaign.contentLanguages.forEach((language) => ContentLanguageSchema.parse(language)); validateSlugs(campaign.nicheSlugs);
  if (campaign.preferredTiers.some((tier) => !["NANO", "MICRO", "MACRO", "MEGA"].includes(tier))) throw new Error("Invalid creator tier");
  if (campaign.physicalPresenceRequired && !campaign.presenceCountryCodes.length) throw new Error("Physical presence requires explicit countries");
  return { ...campaign, deliverables: DeliverablesSchema.parse(campaign.deliverables) };
}
export function calculateFit(subscores: Subscores, rawConfidence: number): { weightedFit: number; score: number } {
  if (!Number.isFinite(rawConfidence) || rawConfidence < 0 || rawConfidence > 1) throw new Error("Invalid raw confidence");
  for (const key of criteria) { const score = subscores[key]; if (score !== null && (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1)) throw new Error(`Invalid ${key} subscore`); }
  // Integer percentage weights keep the documented all-known/all-unknown identities
  // exact instead of summing .1 seven times into .9999999999999999.
  const weightedFit = criteria.reduce((total, key) => total + (WEIGHTS[key] * 100) * (subscores[key] ?? UNKNOWN_SUBSTITUTION), 0) / 100;
  return { weightedFit, score: roundedScore(subscores, rawConfidence) };
}
function nicheScore(campaign: CampaignInput, creator: CreatorInput, now: string, options: MatchingOptions): { score: number | null; evidence: Evidence[] } {
  const parentBySlug = nicheParents(options);
  if (!campaign.nicheSlugs.length) return { score: null, evidence: [] };
  const declared = usableFact(creator.nicheSlugs, now); const fame = usableFact(creator.fameIndustries, now);
  const held = declared?.value ?? []; validateSlugs(held);
  fame?.value.forEach((value) => FameIndustrySchema.parse(value));
  const fameSlugs = unique((fame?.value ?? []).flatMap((value) => FAME_RELATED_NICHES[value] ?? []));
  if ([...campaign.nicheSlugs, ...held].some((slug) => !parentBySlug.has(slug))) throw new Error("Applicable niche is missing from taxonomy snapshot");
  const related = campaign.nicheSlugs.filter((target) => held.some((slug) => parentBySlug.get(slug) === target || parentBySlug.get(target) === slug || (!!parentBySlug.get(target) && parentBySlug.get(target) === parentBySlug.get(slug))));
  const fameRelated = campaign.nicheSlugs.filter((target) => fameSlugs.includes(target) || (!!parentBySlug.get(target) && fameSlugs.includes(parentBySlug.get(target)!)));
  return { score: nicheFit(campaign.nicheSlugs, held, related, fameRelated), evidence: [...(declared ? [declared.evidence] : []), ...(fame && fameRelated.some((slug) => !held.includes(slug) && !related.includes(slug)) ? [fame.evidence] : [])] };
}
function impressionsTarget(campaign: CampaignInput, allocation: Money, now: string, options: MatchingOptions): number | null {
  if (campaign.impressionsTarget !== null) return campaign.explicitImpressionsAllocation ?? allocateIntegerTarget(campaign.impressionsTarget, campaign.desiredCreatorCount)[campaign.allocationOrdinal];
  const benchmark = options.exposureBenchmark;
  if (!benchmark || !benchmark.reviewed || !benchmark.enabled) return null;
  CampaignGoalSchema.parse(options.campaignGoal); MoneySchema.parse({ amountMinor: "0", currencyCode: benchmark.currencyCode });
  if (benchmark.currencyCode !== allocation.currencyCode || benchmark.goal !== options.campaignGoal || !campaign.marketCountryCodes.length || !campaign.marketCountryCodes.every((country) => benchmark.marketCountryCodes.includes(country))) return null;
  if (!benchmark.id.trim() || !benchmark.version.trim() || !UtcDateTimeSchema.safeParse(benchmark.reviewedAt).success || Date.parse(benchmark.reviewedAt) > Date.parse(now)) throw new Error("Benchmark must have reviewed dated version");
  const rational = benchmark.impressionsPerMajorUnit;
  if (![rational.numerator, rational.denominator].every((value) => /^[1-9][0-9]{0,18}$/.test(value))) throw new Error("Invalid positive rational impressions benchmark");
  const result = BigInt(allocation.amountMinor) * BigInt(rational.numerator) / (BigInt(10) ** BigInt(currencyPrecision(allocation.currencyCode)) * BigInt(rational.denominator));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Benchmark target exceeds safe integer range");
  return Number(result);
}
function buildReasons(result: Omit<MatchResult, "reasons">): MatchReason[] {
  const reasons: MatchReason[] = [];
  const add = (kind: string, criterion: Criterion | null, ar: string, en: string, observed: MatchReason["observed"]) => reasons.push({ kind, criterion, text: { ar, en }, observed });
  for (const criterion of criteria) {
    const value = result.subscores[criterion];
    if (value === null) add("UNKNOWN", criterion, "البيانات اللازمة لهذا المعيار غير متاحة؛ قيمة الحساب المحايدة ليست دليلاً على التوافق.", "Required data for this criterion is unknown; the neutral scoring substitution is not evidence of fit.", { criterion });
    else if (criterion === "niche" && value === 0) add("NICHE_NO_DOCUMENTED_OVERLAP", criterion, "لا يوجد توافق موثّق مع مجال الحملة المحدد؛ تُقيّم المعلومات المفقودة أو غير المرتبطة بصفر وفق قاعدة هذا المعيار.", "No documented overlap with the specified campaign niche; missing or unrelated information scores zero under this criterion's rule.", { criterion, subscore: value, missingDataPolicy: "ZERO_FOR_SPECIFIED_NICHE" });
    else add(`${criterion.toUpperCase()}_OBSERVED`, criterion, "حُسب هذا المعيار من البيانات المعتمدة المتاحة، دون توقع نجاح الحملة.", "This criterion was computed from available approved inputs; it does not predict campaign success.", { criterion, subscore: value });
  }
  for (const [key, dimension] of [["age", result.audience.age], ["gender", result.audience.gender], ["cities", result.audience.cities], ["countries", result.audience.countries]] as const) {
    if (dimension) add("SEPARATE_MARGINAL", key === "cities" || key === "countries" ? "geography" : key, "هذا توزيع مستقل للجمهور؛ لا نستنتج نسبة تجمع العمر والجنس والموقع.", "This is a separate marginal audience distribution; no joint age/gender/location share is inferred.", { dimension: key, buckets: dimension.buckets.map((row) => `${row.key}:${row.percent}`), unreportedPercent: dimension.unreportedPercent, excludedAccountIds: dimension.excludedAccountIds });
  }
  if (result.geographyBasis === "COUNTRY_FALLBACK") add("COUNTRY_FALLBACK", "geography", "بيانات المدن غير متاحة؛ استُخدمت حصة الدولة بخصم 20٪.", "City data is unavailable; country share is used with a20% discount.", { discountFactor: .8 });
  add("SUPPORTED_BASKET", "budget", "التسعير يخص صيغ المحتوى المدعومة فقط؛ المجموع الجزئي ليس عرضاً كاملاً.", "Pricing covers supported formats only; a partial subtotal is not a complete quote.", { coverage: result.quote.coverage, currencyCode: result.quote.currencyCode, subtotalMinor: result.quote.subtotal?.amountMinor ?? null, totalMinor: result.quote.total?.amountMinor ?? null, allocationMinor: result.allocation.amountMinor, minimumKnown: String(result.quote.minimumKnown), unsupported: result.quote.unsupported.map((row) => `${row.platform}:${row.format}:${row.count}`) });
  add("ESTIMATED_IMPRESSIONS", "exposure", "مرات الظهور تقديرية، وليست جمهوراً فريداً أو مبيعات مضمونة؛ افتراضات المنصات قابلة للمراجعة.", "Impressions are estimates, not unique audience or guaranteed sales; platform hypotheses are reviewable.", { total: result.estimatedImpressions.total, knownSubtotal: result.estimatedImpressions.knownSubtotal, hypothesisVersion: result.estimatedImpressions.hypothesisVersion, allocatedTarget: result.allocatedImpressionsTarget });
  if (result.prospect) add("UNCLAIMED_PROSPECT", null, "الملف غير مطالب به والتوفر غير معلوم؛ الإجراء المتاح دعوة مقترحة.", "This unclaimed prospect has unknown availability; only a proposed invitation may proceed.", { availability: "UNKNOWN" });
  return reasons;
}
// Shared, unscored preparation for matching and direct deal eligibility. It must
// select the same actually-contributing evidence before strict verification.
// No final confidence multiplier, threshold, ranking or match record is produced.
export function prepareEligibility(campaignInput: CampaignInput, creator: CreatorInput, now: string, options: MatchingOptions = {}) {
  validNow(now); const campaign = validateCampaign(campaignInput);
  validId(creator.id);
  if (creator.hidden !== false || creator.suspended !== false || creator.isTest !== false || creator.eligible !== true || creator.brandVisible !== true) return { eligibility: { eligible: false, exclusions: ["CREATOR_NOT_VISIBLE_OR_ELIGIBLE"], relevantAccounts: [], prospect: creator.claimStatus === "UNCLAIMED", availability: "UNKNOWN" as const, executableOffer: false }, prepared: null };
  validateStrings(creator.contentLanguages); validateStrings(creator.dialects); validateStrings(creator.travelCountryCodes);
  const accounts = relevantAccounts(campaign, creator, now);
  const prospect = creator.claimStatus === "UNCLAIMED";
  const exclusions = eligibilityExclusions(campaign, creator, accounts, now);
  const base = { eligible: exclusions.length === 0, exclusions, relevantAccounts: accounts, prospect, availability: prospect ? "UNKNOWN" as const : creator.availability.status, executableOffer: exclusions.length === 0 && !prospect };
  if (exclusions.length) return { eligibility: base, prepared: null };
  const audience = aggregateAudience(accounts, now); const geo = geographyFit(campaign.targetCityKeys, campaign.targetCountryCodes, audience); const niche = nicheScore(campaign, creator, now, options); const engagement = engagementFit(accounts, now);
  const quote = quoteBasket(creator, campaign.deliverables, accounts, campaign.budget.currencyCode);
  const allocation = campaign.explicitAllocation ?? allocateMoney(campaign.budget, campaign.desiredCreatorCount)[campaign.allocationOrdinal];
  const target = impressionsTarget(campaign, allocation, now, options); const estimatedImpressions = estimateImpressions(accounts, quote.supported, now);
  const subscores: Subscores = { age: ageFit(campaign.targetAgeBuckets, audience.age), niche: niche.score, geography: geo.score, gender: genderFit(campaign.targetGenders, audience.gender), engagement: engagement.score, budget: budgetFit(quote, allocation), exposure: target !== null && target > 0 && estimatedImpressions.total !== null ? clamp(estimatedImpressions.total / target) : null };
  const evidence: Evidence[] = [...accounts.map((account) => account.evidence!), ...(subscores.age !== null ? audience.age!.evidence : []), ...(subscores.gender !== null ? audience.gender!.evidence : []), ...geo.evidence, ...niche.evidence, ...engagement.evidence, ...estimatedImpressions.rows.flatMap((row) => row.evidence)];
  if (campaign.dataVerificationRequired && evidence.some((item) => !["API", "SCREENSHOT_VERIFIED"].includes(item.source))) return { eligibility: { ...base, eligible: false, executableOffer: false, exclusions: ["VERIFIED_DATA_REQUIRED"] }, prepared: null };
  return { eligibility: base, prepared: { campaign, audience, geo, quote, allocation, target, estimatedImpressions, subscores, evidence } };
}
export function evaluateCreator(campaignInput: CampaignInput, creator: CreatorInput, now: string, options: MatchingOptions = {}): EligibilityResult {
  const { eligibility: base, prepared } = prepareEligibility(campaignInput, creator, now, options);
  if (!prepared) return { ...base, match: null };
  const { campaign, audience, geo, quote, allocation, target, estimatedImpressions, subscores, evidence } = prepared;
  const accounts = base.relevantAccounts, prospect = base.prospect;
  const rawConfidence = weakestConfidence(evidence); const fit = calculateFit(subscores, rawConfidence);
  const unknownCriteria = criteria.filter((key) => subscores[key] === null);
  const result: Omit<MatchResult, "reasons"> = { creatorId: creator.id, strategyId: STRATEGY_ID, briefVersion: campaign.briefVersion, ...fit, rawConfidence, subscores, completeness: { known: 7 - unknownCriteria.length, total: 7, unknownCriteria }, relevantAccountIds: accounts.map((account) => account.id), evidenceVersions: unique(evidence.map((item) => item.version)), policyVersions: unique(campaign.mandatoryPolicyVersionIds), audience, geographyBasis: geo.basis, quote, allocation, allocatedImpressionsTarget: target, estimatedImpressions, tier: creatorTier(accounts, now), prospect, availability: base.availability, executableOffer: base.executableOffer };
  return { ...base, match: { ...result, reasons: buildReasons(result) } };
}
export function shortlist(campaign: CampaignInput, creators: readonly CreatorInput[], now: string, options: MatchingOptions = {}): MatchResult[] {
  validateCampaign(campaign); validNow(now);
  if (new Set(creators.map((creator) => creator.id)).size !== creators.length) throw new Error("Duplicate immutable creator identity");
  return creators.map((creator) => evaluateCreator(campaign, creator, now, options).match).filter((result): result is MatchResult => result !== null && result.score >= THRESHOLD).sort((left, right) => right.score - left.score || asciiCompare(left.creatorId, right.creatorId)).slice(0, MAX_RESULTS);
}
