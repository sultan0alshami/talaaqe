import { z } from "zod";

export const RoleSchema = z.enum(["CREATOR", "BRAND", "ADMIN"]);
export const PlatformSchema = z.enum(["INSTAGRAM", "TIKTOK", "YOUTUBE", "SNAPCHAT", "X"]);
export const DealFormatSchema = z.enum(["STORY", "POST", "REEL", "LIVE", "CAMPAIGN", "VIDEO", "SHORT"]);
export const InterfaceLanguageSchema = z.enum(["ar", "en"]);
// Database aggregate adapter: DRAFT is unfinished; PRIVATE is a saved unpublished
// draft (canonical PublicationStatus DRAFT); PUBLISHED/HIDDEN retain those publication
// states. Field Visibility and ClaimStatus remain independent permission/trust axes.
// A PUBLIC field inside DRAFT/PRIVATE does not authorize public profile exposure.
export const ProfileStateSchema = z.enum(["DRAFT", "PRIVATE", "PUBLISHED", "HIDDEN"]);
export const EvidenceSourceSchema = z.enum(["API", "SCREENSHOT_VERIFIED", "SELF_REPORTED", "PUBLIC_IMPORT"]);
export const OwnershipStatusSchema = z.enum(["UNPROVED", "PENDING", "VERIFIED", "REJECTED", "REVOKED"]);
export const FactReviewStatusSchema = z.enum(["PROPOSED", "APPROVED", "EXCLUDED", "REJECTED"]);
export const VisibilitySchema = z.enum(["PRIVATE", "BRAND_ONLY", "PUBLIC"]);
export const PublicationStatusSchema = z.enum(["DRAFT", "PUBLISHED", "HIDDEN"]);
export const ClaimStatusSchema = z.enum(["UNCLAIMED", "CLAIMED"]);
export const LicenceStatusSchema = z.enum(["PENDING", "VERIFIED", "REJECTED", "EXPIRED", "REVOKED", "NEEDS_RECHECK"]);
export const BusinessVerificationStatusSchema = z.enum(["PENDING", "VERIFIED", "REJECTED", "EXPIRED", "NEEDS_RECHECK"]);
export const RepresentationStatusSchema = z.enum(["UNPROVED", "PENDING", "VERIFIED", "REJECTED", "REVOKED"]);
export const CampaignStatusSchema = z.enum(["DRAFT", "BRIEF_GENERATED", "BRIEF_APPROVED", "SHORTLISTED", "IN_DEALS", "COMPLETED", "CANCELLED"]);
export const CampaignGoalSchema = z.enum(["AWARENESS", "SALES", "APP_INSTALLS", "EVENT", "LAUNCH"]);
export const DealStatusSchema = z.enum(["OFFERED", "COUNTERED", "ACCEPTED", "AGREED", "DELIVERED", "COMPLETED", "DECLINED", "CANCELLED"]);
export const OfferStatusSchema = z.enum(["PENDING", "SUPERSEDED", "ACCEPTED", "DECLINED", "CANCELLED"]);
export const DealOriginSchema = z.enum(["MATCH", "DIRECT", "INVITE"]);
export const MatchDecisionSchema = z.enum(["NONE", "SAVED", "DISMISSED", "OFFER_SENT"]);
export const QuoteCoverageSchema = z.enum(["FULL", "PARTIAL", "MISSING"]);
export const CreatorTierSchema = z.enum(["NANO", "MICRO", "MACRO", "MEGA"]);
export const AvailabilitySchema = z.enum(["AVAILABLE", "UNAVAILABLE", "UNKNOWN"]);
export const ImportJobStatusSchema = z.enum(["QUEUED", "RUNNING", "PARTIAL", "SUCCEEDED", "FAILED", "CANCELLED", "STALE"]);
export const VoiceStatusSchema = z.enum(["READY", "LISTENING", "PROCESSING", "SPEAKING", "PAUSED", "RECONNECTING", "ERROR"]);
export const GeneratedAssetStatusSchema = z.enum(["DRAFT", "APPROVED", "STALE"]);
export const NotificationStatusSchema = z.enum(["QUEUED", "SENDING", "SENT", "FAILED", "CANCELLED"]);
export const AiPurposeSchema = z.enum(["ONBOARDING_VOICE", "TRANSCRIPTION", "SPEECH", "FACT_EXTRACTION", "PORTFOLIO", "CAMPAIGN_CHAT", "CAMPAIGN_EXTRACTION", "BRIEF", "MATCH_EXPLANATION", "CONTENT_THEME", "SCREENSHOT_EXTRACTION"]);
export const AudienceAgeBucketSchema = z.enum(["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"]);
export const AudienceGenderSchema = z.enum(["FEMALE", "MALE", "OTHER", "UNKNOWN"]);
export const FameIndustrySchema = z.enum(["sports", "acting", "music", "media", "business", "religion", "academia", "gaming", "cooking", "fashion", "travel", "social-only"]);
export const ContentStyleSchema = z.enum(["review", "comedy", "vlog", "tutorial", "unboxing", "podcast", "challenge", "lifestyle", "educational", "news"]);
export const ArabicDialectSchema = z.enum(["ar-SA-central", "ar-SA-western", "ar-SA-eastern", "ar-SA-southern", "ar-SA-northern", "ar-Gulf", "ar-EG", "ar-Levant", "ar-IQ", "ar-Maghreb", "ar-SD", "ar-Formal"]);
export type Role = z.infer<typeof RoleSchema>;
export type Platform = z.infer<typeof PlatformSchema>;
export type DealFormat = z.infer<typeof DealFormatSchema>;
export type InterfaceLanguage = z.infer<typeof InterfaceLanguageSchema>;
export type ProfileState = z.infer<typeof ProfileStateSchema>;
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;
export type OwnershipStatus = z.infer<typeof OwnershipStatusSchema>;
export type FactReviewStatus = z.infer<typeof FactReviewStatusSchema>;
export type Visibility = z.infer<typeof VisibilitySchema>;
export type PublicationStatus = z.infer<typeof PublicationStatusSchema>;
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;
export type LicenceStatus = z.infer<typeof LicenceStatusSchema>;
export type BusinessVerificationStatus = z.infer<typeof BusinessVerificationStatusSchema>;
export type RepresentationStatus = z.infer<typeof RepresentationStatusSchema>;
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;
export type CampaignGoal = z.infer<typeof CampaignGoalSchema>;
export type DealStatus = z.infer<typeof DealStatusSchema>;
export type OfferStatus = z.infer<typeof OfferStatusSchema>;
export type DealOrigin = z.infer<typeof DealOriginSchema>;
export type MatchDecision = z.infer<typeof MatchDecisionSchema>;
export type QuoteCoverage = z.infer<typeof QuoteCoverageSchema>;
export type CreatorTier = z.infer<typeof CreatorTierSchema>;
export type Availability = z.infer<typeof AvailabilitySchema>;
export type ImportJobStatus = z.infer<typeof ImportJobStatusSchema>;
export type VoiceStatus = z.infer<typeof VoiceStatusSchema>;
export type GeneratedAssetStatus = z.infer<typeof GeneratedAssetStatusSchema>;
export type NotificationStatus = z.infer<typeof NotificationStatusSchema>;
export type AiPurpose = z.infer<typeof AiPurposeSchema>;
export type AudienceAgeBucket = z.infer<typeof AudienceAgeBucketSchema>;
export type AudienceGender = z.infer<typeof AudienceGenderSchema>;
export type FameIndustry = z.infer<typeof FameIndustrySchema>;
export type ContentStyle = z.infer<typeof ContentStyleSchema>;
export type ArabicDialect = z.infer<typeof ArabicDialectSchema>;

export const PLATFORM_FORMATS: Readonly<Record<Platform, readonly DealFormat[]>> = Object.freeze({
  INSTAGRAM: Object.freeze(["STORY", "POST", "REEL", "LIVE", "CAMPAIGN"] as const),
  TIKTOK: Object.freeze(["VIDEO", "LIVE", "CAMPAIGN"] as const),
  YOUTUBE: Object.freeze(["VIDEO", "SHORT", "LIVE", "CAMPAIGN"] as const),
  SNAPCHAT: Object.freeze(["STORY", "VIDEO", "CAMPAIGN"] as const),
  X: Object.freeze(["POST", "CAMPAIGN"] as const),
});
export const DeliverableSchema = z.object({ platform: PlatformSchema, format: DealFormatSchema, count: z.number().int().min(1).max(1000) }).strict().refine((row) => PLATFORM_FORMATS[row.platform].includes(row.format), "Unsupported platform format");
export type Deliverable = z.infer<typeof DeliverableSchema>;
export const DeliverablesSchema = z.array(DeliverableSchema).min(1).max(100).transform((rows, context) => {
  const merged = new Map<string, Deliverable>();
  for (const row of rows) {
    const key = `${row.platform}:${row.format}`;
    const previous = merged.get(key);
    const count = (previous?.count ?? 0) + row.count;
    if (count > 1000) { context.addIssue({ code: "custom", message: "Combined deliverable count exceeds1000" }); return z.NEVER; }
    merged.set(key, { ...row, count });
  }
  return [...merged.values()];
});

// Curated assigned ISO3166-1 alpha2 vocabulary. No user-assigned/reserved region codes.
// https://www.iso.org/iso-3166-country-codes.html ; checked2026-10-01.
export const COUNTRY_CODES: readonly string[] = Object.freeze("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" "));
const countries = new Set(COUNTRY_CODES);
export const CountryCodeSchema = z.string().regex(/^[A-Z]{2}$/).refine((code) => countries.has(code), "Unknown assigned ISO country code");
export type IsoCountryCode = z.infer<typeof CountryCodeSchema>;

export const TimeZoneSchema = z.string().max(100).refine((zone) => {
  if (zone !== "UTC" && !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+$/.test(zone)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(); return true; } catch { return false; }
}, "Invalid explicit IANA timezone");
export type IanaTimeZone = z.infer<typeof TimeZoneSchema>;
export const UtcDateTimeSchema = z.iso.datetime({ offset: false }).refine((value) => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return false;
  return parsed.toISOString() === value.replace(/Z$/, value.includes(".") ? "Z" : ".000Z");
}, "Expected a real canonical UTC instant");
export const DateRangeSchema = z.object({ startsAt: UtcDateTimeSchema, endsAt: UtcDateTimeSchema, timeZone: TimeZoneSchema }).strict().refine((period) => Date.parse(period.startsAt) < Date.parse(period.endsAt), "Start must precede end");
export type DateRange = z.infer<typeof DateRangeSchema>;

export const CitySchema = z.object({ key: z.string().regex(/^[A-Z]{2}:[a-z0-9]+(?:-[a-z0-9]+)*$/), countryCode: CountryCodeSchema, ar: z.string().min(1).max(100), en: z.string().min(1).max(100) }).strict().refine((city) => city.key.startsWith(`${city.countryCode}:`), "City country mismatch");
export type City = z.infer<typeof CitySchema>;
const saudiRows = [
  ["riyadh", "الرياض", "Riyadh"], ["jeddah", "جدة", "Jeddah"], ["mecca", "مكة", "Mecca"], ["medina", "المدينة", "Medina"],
  ["dammam", "الدمام", "Dammam"], ["khobar", "الخبر", "Khobar"], ["dhahran", "الظهران", "Dhahran"], ["al-ahsa", "الأحساء", "Al-Ahsa"],
  ["qatif", "القطيف", "Qatif"], ["jubail", "الجبيل", "Jubail"], ["taif", "الطائف", "Taif"], ["yanbu", "ينبع", "Yanbu"],
  ["tabuk", "تبوك", "Tabuk"], ["buraydah", "بريدة", "Buraydah"], ["unaizah", "عنيزة", "Unaizah"], ["hail", "حائل", "Hail"],
  ["abha", "أبها", "Abha"], ["khamis-mushait", "خميس مشيط", "Khamis Mushait"], ["najran", "نجران", "Najran"], ["jazan", "جازان", "Jazan"],
  ["al-baha", "الباحة", "Al-Baha"], ["hafar-al-batin", "حفر الباطن", "Hafar Al-Batin"], ["arar", "عرعر", "Arar"], ["sakaka", "سكاكا", "Sakaka"],
] as const;
export const SAUDI_CITIES: readonly Readonly<City>[] = Object.freeze(saudiRows.map(([slug, ar, en]) => Object.freeze({ key: `SA:${slug}`, countryCode: "SA", ar, en })));
export const CURATED_CITIES: readonly Readonly<City>[] = SAUDI_CITIES;
const curatedCities = new Map(CURATED_CITIES.map((city) => [city.key, city]));
export const LocationSchema = z.object({ countryCode: CountryCodeSchema, cityKey: z.string().nullable(), cityLabel: z.string().trim().min(1).max(100).nullable(), timeZone: TimeZoneSchema }).strict().refine((location) => location.cityKey === null || curatedCities.get(location.cityKey)?.countryCode === location.countryCode, "City must be curated and belong to selected country");
export type Location = z.infer<typeof LocationSchema>;

export const ContentLanguageSchema = z.string().min(2).max(100).refine((language) => {
  try { return Intl.getCanonicalLocales(language).length === 1; } catch { return false; }
}, "Expected declared BCP47 language").nullable();
export const OriginalTextSchema = z.object({ text: z.string().max(20000), language: ContentLanguageSchema }).strict();
export type OriginalText = z.infer<typeof OriginalTextSchema>;
export const ChatMessageSchema = z.object({ role: z.enum(["user", "assistant"]), text: z.string().min(1).max(20000), ts: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), chips: z.array(z.string().max(500)).max(20).optional() }).strict();
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export const KpiSchema = z.object({ name: z.string().trim().min(1).max(200), target: z.string().trim().min(1).max(1000) }).strict();
export type Kpi = z.infer<typeof KpiSchema>;

export const RESERVED_HANDLES: readonly string[] = Object.freeze(["admin", "api", "auth", "brand", "brands", "campaigns", "creator", "creators", "deals", "infame", "invite", "login", "logout", "onboarding", "privacy", "settings", "signup", "support", "terms", "www"]);
const reservedHandles = new Set(RESERVED_HANDLES);
export function normalizeInfameHandle(input: string): string {
  const handle = z.string().max(100).parse(input).trim().replace(/^@/, "").toLowerCase();
  if (handle.length < 3 || handle.length > 30 || !/^[a-z0-9][a-z0-9_]*$/.test(handle) || reservedHandles.has(handle)) throw new Error("Invalid or reserved Infame handle");
  return handle;
}
export function normalizeBrandSlug(input: string): string {
  const slug = z.string().max(100).parse(input).trim().toLowerCase();
  if (slug.length < 3 || slug.length > 50 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || reservedHandles.has(slug)) throw new Error("Invalid or reserved brand slug");
  return slug;
}

// Resolve explicit local wall time; require chosen east-of-UTC offset on repeated DST times.
export function resolveLocalDateTime(local: string, zoneInput: string, chosenOffsetMinutes?: number): string {
  const zone = TimeZoneSchema.parse(zoneInput);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(local)) throw new Error("Local date-time must include date and seconds");
  const nominal = Date.parse(`${local}.000Z`);
  if (!Number.isFinite(nominal) || new Date(nominal).toISOString() !== `${local}.000Z`) throw new Error("Invalid local calendar date-time");
  if (chosenOffsetMinutes !== undefined && (!Number.isInteger(chosenOffsetMinutes) || Math.abs(chosenOffsetMinutes) > 1440)) throw new Error("Invalid chosen UTC offset");
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: zone, calendar: "gregory", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const wallAt = (epoch: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(epoch).map((part) => [part.type, part.value]));
    return `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  };
  const offsets = new Set<number>();
  // Sample both sides of every nearby transition; timezone offsets stay independent of UI/server zone.
  for (let hours = -36; hours <= 36; hours += 6) {
    const epoch = nominal + hours * 3600000;
    offsets.add((Date.parse(`${wallAt(epoch)}.000Z`) - epoch) / 60000);
  }
  const candidates = [...offsets].map((offset) => ({ offset, epoch: nominal - offset * 60000 })).filter(({ epoch }) => wallAt(epoch) === local);
  if (candidates.length === 0) throw new Error("Nonexistent local time in selected timezone");
  if (candidates.length > 1 && chosenOffsetMinutes === undefined) throw new Error("Ambiguous local time; choose explicit UTC offset");
  const selected = chosenOffsetMinutes === undefined ? candidates[0] : candidates.find((candidate) => candidate.offset === chosenOffsetMinutes);
  if (!selected) throw new Error("Chosen UTC offset does not match local time");
  return new Date(selected.epoch).toISOString();
}
