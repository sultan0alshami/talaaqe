import { CountryCodeSchema, DateRangeSchema, OwnershipStatusSchema, PlatformSchema, PLATFORM_FORMATS, UtcDateTimeSchema, VisibilitySchema } from "../contracts/vocabulary";
import { asciiCompare, followerValue, isEvidenceUsable, isRecordedEvidence, unique, usableFact, validId, validNow } from "./evidence";
import type { CampaignInput, CreatorInput, CreatorTier, MatchingAccount } from "./types";

export function accountHasUsableMetrics(account: MatchingAccount, now: string): boolean {
  // A snapshot label cannot verify independently corrected metrics. At least one usable
  // metric must actually retain the declared snapshot source; mixed fields keep their own source.
  return [account.followers, account.engagementPct, ...account.averageViews.map((view) => view.value), ...Object.values(account.audience)].some((fact) => fact && fact.evidence.source === account.evidence?.source && usableFact<unknown>(fact, now) && (typeof fact.value === "number" ? Number.isFinite(fact.value) && fact.value >= 0 : Array.isArray(fact.value) && fact.value.length > 0));
}
export function relevantAccounts(campaign: CampaignInput, creator: CreatorInput, now: string): MatchingAccount[] {
  validNow(now);
  const requestedPlatforms = new Set(campaign.deliverables.map((row) => row.platform));
  if (creator.accounts.length > 100 || new Set(creator.accounts.map((row) => row.id)).size !== creator.accounts.length) throw new Error("Invalid bounded unique account identities");
  return creator.accounts.filter((account) => {
    validId(account.id); PlatformSchema.parse(account.platform); OwnershipStatusSchema.parse(account.ownershipStatus); VisibilitySchema.parse(account.visibility);
    if (!requestedPlatforms.has(account.platform) || account.approved !== true || account.visibility === "PRIVATE" || !isEvidenceUsable(account.evidence, now) || !accountHasUsableMetrics(account, now)) return false;
    if (creator.claimStatus === "CLAIMED" && account.ownershipStatus !== "VERIFIED") return false;
    if (creator.claimStatus === "UNCLAIMED" && ["REJECTED", "REVOKED"].includes(account.ownershipStatus)) return false;
    if (!Array.isArray(account.supportedFormats) || account.supportedFormats.some((format) => !PLATFORM_FORMATS[account.platform].includes(format)) || new Set(account.supportedFormats).size !== account.supportedFormats.length) throw new Error("Invalid unique creator-supported formats");
    return true;
  }).sort((left, right) => asciiCompare(left.id, right.id));
}
export function creatorTier(accounts: readonly MatchingAccount[], now: string): CreatorTier | null {
  const followers = accounts.map((account) => followerValue(account.followers, now)).filter((value): value is number => value !== null);
  if (!followers.length) return null;
  const maximum = Math.max(...followers);
  return maximum < 10000 ? "NANO" : maximum < 100000 ? "MICRO" : maximum < 1000000 ? "MACRO" : "MEGA";
}
function policyPasses(campaign: CampaignInput, creator: CreatorInput, accounts: readonly MatchingAccount[], versionId: string, now: string): boolean {
  const outcomes = creator.policyOutcomes.filter((row) => row.versionId === versionId);
  if (outcomes.length !== 1) return false;
  const outcome = outcomes[0];
  return outcome.reviewed === true && outcome.status === "PASS" && accounts.every((account) => outcome.accountIds.includes(account.id)) && (outcome.validUntil === null || (UtcDateTimeSchema.safeParse(outcome.validUntil).success && Date.parse(outcome.validUntil) >= Math.max(Date.parse(now), Date.parse(campaign.period.endsAt))));
}
export function eligibilityExclusions(campaign: CampaignInput, creator: CreatorInput, accounts: readonly MatchingAccount[], now: string): string[] {
  const exclusions: string[] = []; validId(creator.id); CountryCodeSchema.parse(creator.residenceCountryCode);
  if (creator.hidden !== false || creator.suspended !== false || creator.isTest !== false || creator.eligible !== true || creator.brandVisible !== true) exclusions.push("CREATOR_NOT_VISIBLE_OR_ELIGIBLE");
  if (!["CLAIMED", "UNCLAIMED"].includes(creator.claimStatus)) exclusions.push("INVALID_CLAIM_STATUS");
  if (!campaign.approved) exclusions.push("BRIEF_NOT_APPROVED");
  if (!accounts.length) exclusions.push("NO_ELIGIBLE_RELEVANT_ACCOUNT");
  if (!campaign.deliverables.some((row) => accounts.some((account) => account.platform === row.platform && account.supportedFormats.includes(row.format)))) exclusions.push("NO_SUPPORTED_DELIVERABLE");
  if (creator.claimStatus === "CLAIMED") {
    const availability = creator.availability;
    if (availability.status !== "AVAILABLE" || !availability.period || !DateRangeSchema.safeParse(availability.period).success || !availability.confirmedAt || !UtcDateTimeSchema.safeParse(availability.confirmedAt).success || Date.parse(availability.confirmedAt) > Date.parse(now) || Date.parse(availability.period.startsAt) > Date.parse(campaign.period.startsAt) || Date.parse(availability.period.endsAt) < Date.parse(campaign.period.endsAt)) exclusions.push("AVAILABILITY_NOT_CONFIRMED_FOR_PERIOD");
  }
  // A declared campaign set permits any selected language/dialect; requiring all would
  // reject bilingual campaigns unnecessarily. No fuzzy identity/ethnicity inference.
  const creatorLanguages = new Set(creator.contentLanguages.map((language) => Intl.getCanonicalLocales(language)[0]));
  if (campaign.contentLanguages.length && !campaign.contentLanguages.some((language) => creatorLanguages.has(Intl.getCanonicalLocales(language)[0]))) exclusions.push("CONTENT_LANGUAGE_UNSUPPORTED");
  if (campaign.dialects.length && !campaign.dialects.some((dialect) => creator.dialects.includes(dialect))) exclusions.push("DIALECT_UNSUPPORTED");
  if (campaign.physicalPresenceRequired) {
    const local = campaign.presenceCountryCodes.includes(creator.residenceCountryCode);
    const travel = campaign.travelAllowed && creator.travelWilling && campaign.presenceCountryCodes.some((country) => creator.travelCountryCodes.includes(country));
    if (!local && !travel) exclusions.push("PHYSICAL_PRESENCE_UNSUPPORTED");
  }
  const tier = creatorTier(accounts, now);
  if (campaign.preferredTiers.length && (!tier || !campaign.preferredTiers.includes(tier))) exclusions.push("PREFERRED_TIER_UNSATISFIED");
  if (campaign.dataVerificationRequired && accounts.some((account) => account.evidence && !["API", "SCREENSHOT_VERIFIED"].includes(account.evidence.source))) exclusions.push("VERIFIED_DATA_REQUIRED");
  for (const versionId of unique(campaign.mandatoryPolicyVersionIds)) if (!policyPasses(campaign, creator, accounts, versionId, now)) exclusions.push(`MANDATORY_POLICY_UNSATISFIED:${versionId}`);
  for (const policyId of unique(campaign.preferredLicencePolicyIds)) {
    const validLicence = creator.licences.some((licence) => licence.policyIds.includes(policyId) && campaign.marketCountryCodes.includes(licence.jurisdiction) && licence.status === "VERIFIED" && licence.reviewedAt && UtcDateTimeSchema.safeParse(licence.reviewedAt).success && Date.parse(licence.reviewedAt) <= Date.parse(now) && accounts.every((account) => licence.accountIds.includes(account.id)) && (licence.expiresAt === null || (UtcDateTimeSchema.safeParse(licence.expiresAt).success && Date.parse(licence.expiresAt) >= Math.max(Date.parse(now), Date.parse(campaign.period.endsAt)))));
    if (!validLicence) exclusions.push(`PREFERRED_LICENCE_UNSATISFIED:${policyId}`);
  }
  // Moderation findings are persistent reviewed policy inputs, not analytics. Private
  // supporting evidence stays private and does not lose force after the metric90-day window.
  if (creator.safetyExclusions.some((flag) => flag.reviewed && flag.policyVersionId.trim() && campaign.noGoTopics.includes(flag.topic) && isRecordedEvidence(flag.evidence, now))) exclusions.push("REVIEWED_SAFETY_EXCLUSION");
  return exclusions;
}
