# Infame shared contracts v1

Updated 2026-10-01. Status: frozen specification approved for implementation; runtime exports, database constraints and acceptance evidence still require integration. This document does not claim the inherited Talaqee code already conforms. Authority and reviewable defaults are in `DECISIONS.md`.

Coordinator owns the single runtime definitions under `src/lib/contracts/**`, their export adapter in `src/lib/domain.ts`, schema/migrations and DTO composer. Domain owners import these definitions. Never duplicate weights, currencies, city keys, handle policy, offer validation or enum spellings. Contract changes need an explicit version/rationale and affected tests/migration review.

## 1. Canonical vocabulary

```ts
type Role = 'CREATOR' | 'BRAND' | 'ADMIN';
type Platform = 'INSTAGRAM' | 'TIKTOK' | 'YOUTUBE' | 'SNAPCHAT' | 'X';
type DealFormat = 'STORY' | 'POST' | 'REEL' | 'LIVE' | 'CAMPAIGN' | 'VIDEO' | 'SHORT';
type InterfaceLanguage = 'ar' | 'en';
type EvidenceSource = 'API' | 'SCREENSHOT_VERIFIED' | 'SELF_REPORTED' | 'PUBLIC_IMPORT';
type OwnershipStatus = 'UNPROVED' | 'PENDING' | 'VERIFIED' | 'REJECTED' | 'REVOKED';
type FactReviewStatus = 'PROPOSED' | 'APPROVED' | 'EXCLUDED' | 'REJECTED';
type Visibility = 'PRIVATE' | 'BRAND_ONLY' | 'PUBLIC';
type PublicationStatus = 'DRAFT' | 'PUBLISHED' | 'HIDDEN';
type ClaimStatus = 'UNCLAIMED' | 'CLAIMED';
type LicenceStatus = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED' | 'REVOKED' | 'NEEDS_RECHECK';
type BusinessVerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED' | 'NEEDS_RECHECK';
type RepresentationStatus = 'UNPROVED' | 'PENDING' | 'VERIFIED' | 'REJECTED' | 'REVOKED';
type CampaignStatus = 'DRAFT' | 'BRIEF_GENERATED' | 'BRIEF_APPROVED' | 'SHORTLISTED'
  | 'IN_DEALS' | 'COMPLETED' | 'CANCELLED';
type CampaignGoal = 'AWARENESS' | 'SALES' | 'APP_INSTALLS' | 'EVENT' | 'LAUNCH';
type DealStatus = 'OFFERED' | 'COUNTERED' | 'ACCEPTED' | 'AGREED' | 'DELIVERED'
  | 'COMPLETED' | 'DECLINED' | 'CANCELLED';
type OfferStatus = 'PENDING' | 'SUPERSEDED' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED';
type DealOrigin = 'MATCH' | 'DIRECT' | 'INVITE';
type MatchDecision = 'NONE' | 'SAVED' | 'DISMISSED' | 'OFFER_SENT';
type QuoteCoverage = 'FULL' | 'PARTIAL' | 'MISSING';
type CreatorTier = 'NANO' | 'MICRO' | 'MACRO' | 'MEGA';
type Availability = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
type ImportJobStatus = 'QUEUED' | 'RUNNING' | 'PARTIAL' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'STALE';
type VoiceStatus = 'READY' | 'LISTENING' | 'PROCESSING' | 'SPEAKING' | 'PAUSED' | 'RECONNECTING' | 'ERROR';
type GeneratedAssetStatus = 'DRAFT' | 'APPROVED' | 'STALE';
type NotificationStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'CANCELLED';
type AiPurpose = 'ONBOARDING_VOICE' | 'TRANSCRIPTION' | 'SPEECH' | 'FACT_EXTRACTION'
  | 'PORTFOLIO' | 'CAMPAIGN_CHAT' | 'CAMPAIGN_EXTRACTION' | 'BRIEF'
  | 'MATCH_EXPLANATION' | 'CONTENT_THEME' | 'SCREENSHOT_EXTRACTION';
type AudienceAgeBucket = '13-17' | '18-24' | '25-34' | '35-44' | '45-54' | '55-64' | '65+';
type AudienceGender = 'FEMALE' | 'MALE' | 'OTHER' | 'UNKNOWN';
type FameIndustry = 'sports' | 'acting' | 'music' | 'media' | 'business' | 'religion'
  | 'academia' | 'gaming' | 'cooking' | 'fashion' | 'travel' | 'social-only';
type ContentStyle = 'review' | 'comedy' | 'vlog' | 'tutorial' | 'unboxing' | 'podcast'
  | 'challenge' | 'lifestyle' | 'educational' | 'news';
type ArabicDialect = 'ar-SA-central' | 'ar-SA-western' | 'ar-SA-eastern' | 'ar-SA-southern'
  | 'ar-SA-northern' | 'ar-Gulf' | 'ar-EG' | 'ar-Levant' | 'ar-IQ'
  | 'ar-Maghreb' | 'ar-SD' | 'ar-Formal';
```

The dialect labels are curated product IDs, not a claim that each is an ISO/BCP47 language tag. Other self-declared languages use validated BCP47 tags and an optional display-only dialect label. Never infer ethnicity/nationality/dialect from names/photos. Niche taxonomy uses stable lowercase slugs, bilingual labels, parent relations and one explicit related/fame-derived mapping. Avoid fake database-ID mappings.

| Platform | Allowed initial formats |
|---|---|
| INSTAGRAM | STORY, POST, REEL, LIVE, CAMPAIGN |
| TIKTOK | VIDEO, LIVE, CAMPAIGN |
| YOUTUBE | VIDEO, SHORT, LIVE, CAMPAIGN |
| SNAPCHAT | STORY, VIDEO, CAMPAIGN |
| X | POST, CAMPAIGN |

All counts are positive safe integers, initial maximum1000 per deliverable row. Merge duplicates by `(platform, format)` before pricing; total count must stay within bounds. Shared offer validation rejects unsupported combinations. A campaign-format package needs its own explicit creator-owned rate and estimate; do not silently count it as a story or add it over identical already-priced rows.

## 2. JSON, country, money and time types

```ts
type Id = string;
type IsoCountryCode = string; // exactly two uppercase letters, present in curated ISO3166-1 alpha2 vocabulary
type CurrencyCode = string;   // exactly three uppercase letters, present in versioned ISO4217 vocabulary
type UtcIsoDateTime = string; // canonical ISO8601 UTC with trailing Z, validated actual instant
type IanaTimeZone = string;   // explicitly validated IANA zone; UTC is permitted
type ContentLanguage = string | null; // declared BCP47; null means not declared, not inferred
type Money = { amountMinor: string; currencyCode: CurrencyCode };
type City = { key: string; countryCode: IsoCountryCode; ar: string; en: string };
type Location = {
  countryCode: IsoCountryCode;
  cityKey: string | null; // curated country-qualified key only
  cityLabel: string | null; // display-only free text, never a matchable bucket
  timeZone: IanaTimeZone;
};
type Deliverable = { platform: Platform; format: DealFormat; count: number };
type ChatMessage = { role: 'user' | 'assistant'; text: string; ts: number; chips?: string[] };
type Kpi = { name: string; target: string };
type OriginalText = { text: string; language: ContentLanguage };
type DateRange = { startsAt: UtcIsoDateTime; endsAt: UtcIsoDateTime; timeZone: IanaTimeZone };
```

Money: Prisma `BigInt`/PostgreSQL `BIGINT`, constrained `0..9223372036854775807`; positive where a rate/offer requires it. DTO regex `^(0|[1-9][0-9]*)$`; never JS numbers for money, exponent notation, signs or commas. Central parser converts user decimal text using the currency's exact exponent and rejects excess fraction digits; it does not round input silently. SAR/USD use2, JPY0, KWD3 as precision fixtures. ISO vocabulary/precision has a source date/version; implementation verifies the current authoritative source. `Intl.NumberFormat` presentation does not define storage/settlement precision. Overflow is rejected on every sum/product/allocation; totals remain derived. No FX.

Each campaign/deal/counter/agreement has exactly one currency. Matching compares only complete matching-currency rates/minimums. An optional minimum explicitly absent is zero for comparison; an existing minimum in a different currency is unknown until same-currency terms are supplied. Quotations/allocations/fair ranges carry currency labels. Two equal nominal amounts in different currencies are not comparable.

Allocation: planned creator count1–12, default1. For budget `B` and `N` planned slots, `q=B/N`, `r=B%N` using integer arithmetic; slots with immutable ordinals `0..r-1` receive `q+1`, others `q`. Thus allocations sum exactly to B independent of match ordering. Explicit allocations require matching currency, known slot IDs and sum≤B; display remaining budget. Impressions integer target allocates with the same remainder rule. Changing count/allocations creates a new material brief version.

All timestamps persist UTC instants; user/campaign timezone persists explicitly. `ChatMessage.ts` is Unix epoch milliseconds as a safe integer, not seconds. Date ranges require `startsAt<endsAt`. Local wall-time entry resolves in the selected timezone; reject nonexistent DST times and require explicit offset choice for repeated times. Do not use browser/server timezone as campaign timezone. Deadline labels display timezone; agreement snapshots freeze UTC instants plus timezone. Seven-day rating reveal means7×24h elapsed from first submission, not local-calendar midnight.

City keys are `COUNTRY:stable-slug`; country must agree with Location.countryCode. Initial Saudi keys: `SA:riyadh`, `SA:jeddah`, `SA:mecca`, `SA:medina`, `SA:dammam`, `SA:khobar`, `SA:dhahran`, `SA:al-ahsa`, `SA:qatif`, `SA:jubail`, `SA:taif`, `SA:yanbu`, `SA:tabuk`, `SA:buraydah`, `SA:unaizah`, `SA:hail`, `SA:abha`, `SA:khamis-mushait`, `SA:najran`, `SA:jazan`, `SA:al-baha`, `SA:hafar-al-batin`, `SA:arar`, `SA:sakaka`. Future curated keys such as `EG:cairo` need bilingual records before use. Country-only plus display-only city is valid globally. Free labels must not enter audience-city filters.

Infame handle: trim, remove a single leading `@`, lowercase ASCII,3–30 characters, regex `^[a-z0-9][a-z0-9_]*$`; normalize once before uniqueness checks. Reserved names include `admin`, `api`, `auth`, `brand`, `brands`, `campaigns`, `creator`, `creators`, `deals`, `infame`, `invite`, `login`, `logout`, `onboarding`, `privacy`, `settings`, `signup`, `support`, `terms`, `www`. Reservation/publication use a transaction and unique index; report conflict without overwriting another owner. Public canonical route is `/@handle`; internal route may map it. Company slug policy is separate lowercase ASCII3–50 (`[a-z0-9-]`, no leading/trailing/double hyphen), unique at `/brands/[slug]`, with conflict handling.

Social handles use one platform-aware normalizer and allowlisted profile URL parser, not the Infame handle grammar. Platform lengths/characters/domain/URL forms must be verified against current official capability docs before enabling that parser. Record supported formats centrally. Store stable provider account ID independently of mutable username. A shared username prefills rows only; URLs/tokens/ownership are not guessed.

DTOs contain only JSON primitives/arrays/objects: convert Date to UTC string and BigInt to integer string; do not leak Prisma rows, session tokens or `undefined`. Nullable unknowns are explicit `null`, never fabricated zero. Original business text remains one text value; controlled labels use Arabic/English dictionaries. KPI target is a descriptive string; the optional numeric impressions target is a separate validated field. Language toggle re-renders UI only.

## 3. Authentication, capabilities and errors

`infame_session` is httpOnly, secure in deployed HTTPS, sameSite=lax with CSRF/origin protection on mutations; `infame_lang` stores `ar|en`. Sessions include user ID/role and revocable session/version identity, validated against active user/current version on protected work. Suspension/password reset revokes immediately; proxy navigation alone is insufficient. Password baseline12 characters; email normalized for uniqueness, hashed passwords, bounded distributed login/OTP/reset attempts. Expiring one-use hashed email/reset/OTP tokens. Public signup accepts CREATOR/BRAND only; ADMIN provisioning is a controlled operation.

`offerVerificationSatisfied(user, brand, campaignMarkets)` is central and server-only: active authenticated BRAND, verified email and country-supported verified E.164 phone OTP or a specifically reviewed fallback record; add applicable reviewed campaign policy. Fallback carries method, jurisdiction, reviewer/date/policy version and expiry if applicable. Missing policy blocks affected live offers honestly; it does not demand Saudi numbers globally. Public company sharing additionally requires accepted representative proof. Birth/registration-age eligibility is independent of audience metrics; provisional18+ attestation policy awaits legal approval.

Capability registry contains environment, provider ID, enabled status, mode (`LIVE|DEVELOPMENT_FIXTURE|UNAVAILABLE`), allowed operations/scopes/fields, limits, docs/checked date and fallback. Production rejects development fixture/OTP/console delivery/unsafe seed/weak-secret configuration. Optional unconfigured capabilities are explicitly unavailable. Keys stay server-only; encrypted social tokens, supported PKCE/state, revoke/disconnect handling, timeouts and bounded retries. No username proves access to private analytics. Mock evidence is never labeled live API verification in production.

All mutations authenticate, authorize role/ownership, validate state/version and origin independently. Unauthorized ownership lookups may return404 to avoid enumeration; wrong role403; bad input422; stale version/state409; limit429; unavailable503. Stable API result shape:

```ts
type ApiErrorDTO = { error: { code: string; message: string; requestId: string;
  fieldErrors?: Record<string, string[]>; retryable: boolean } };
type ApiSuccess<T> = { data: T; requestId: string };
// Application codes include UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, VALIDATION,
// STALE_VERSION, INVALID_STATE, VERIFICATION_REQUIRED, OWNERSHIP_REQUIRED,
// CONSENT_REQUIRED, CAPABILITY_UNAVAILABLE, RATE_LIMITED, BUDGET_EXHAUSTED.
```

Adapters may preserve legacy API signatures temporarily, with documented callers; no mixed error envelopes within a new endpoint. Safe request IDs/logs exclude secrets/private proof/transcripts. Reads do not trigger imports, matching, model jobs or changes.

Canonical admin users/status v1 (2026-10-05): GET `/api/admin/users` returns a private current-ADMIN snapshot, at most30 original-name rows in immutable ID order and an exclusive `after` cursor. Rows contain only ID, original name, email, role, access status, joining UTC and `statusVersion` (current `User.sessionVersion`). Counts/list scope includes private, synthetic and suspended stored records. This is operational data, not publication or trust approval.

PATCH `/api/admin/users/[id]` requires a UUID operation key, expected active state and version, the opposite requested state and a bounded2..2000-character original-language reason. Self/ADMIN targets, role changes and provisioning are protected. Under current actor/session authorization, the nonadmin target User is locked before the ADMIN actor User/session. State change, version increment, every existing target session/token invalidation, durable unique actor/key `AdminCommand` receipt, private reason audit and pending account event are atomic. Reactivation advances the version and cannot restore old credentials. Token issuance captures/rechecks the user version/destination under the same User lock; callers with earlier captured identity bind it explicitly. Old credentials and reads that cross a status ABA must fail closed.

Exact command replay returns its immutable historical receipt without repeating mutation/audit/event. Reusing a key with changed target/content returns409 `IDEMPOTENCY_CONFLICT`; changed active state or version returns409 `STALE_VERSION`. Original reason text is preserved solely in private audit; the outbox carries status metadata and no reason/credentials. The account event vocabulary adds `account.reactivated`. A receipt describes the recorded action, so clients reload authoritative current rows before displaying saved status, preserve uncertain commands exactly and compare stale versions explicitly. HTTP401/403 hides all protected cached rows/time before parsing the response body. Other legacy admin endpoints remain retired until reviewed individually. This extends D031 with an additive command journal; it does not authorize delivery or ADMIN provisioning.

Canonical admin campaigns metadata v1 (2026-10-05): GET `/api/admin/campaigns` and SSR `/admin/projects` share the current ADMIN locked RepeatableRead boundary and actual-clock final authorization. The private no-store DTO is `{asOf,scope:ALL_STORED_RECORDS,campaigns,nextCursor}` with at most30 canonical rows in ascending ID order and a strict exclusive `after` cursor. Each row contains only `{id,title,brandName,status,revision,createdAt,budget,budgetSource}`. Title and Brand.name remain exactly their original content; all seven central stored CampaignStatus values are descriptive. Private/test/draft/suspended-owner records are included explicitly rather than interpreted as publication or offer eligibility.

Budget is exact central Money from current saved `input.fields.budget` only: input must be an object with schemaVersion1, positive safe fieldsRevision<=current Campaign.revision and strict central CampaignDraftFieldsSchema-valid partial fields. Otherwise budget is null and budgetSource UNAVAILABLE; a readable value uses SAVED_INPUT. Never coerce numeric money, assume a currency, use a generated proposal or approved historical brief, or repair private stored content during a read. Conversation/proposals/briefs/evidence/user credentials stay outside this DTO. The access audit `admin.campaigns_accessed` / CampaignList / platform contains only `{asOf,after,returned,nextCursor,scope}` in the same transaction. Temporary or malformed responses retain the old snapshot; HTTP401/403 clears private rows/time before body parsing. Cursor screen keys use distinct namespaces from the default page so a valid literal cursor cannot retain a different snapshot on navigation. The original table has no campaign mutations or cross-role resource links; legacy `/api/admin/projects` remains retired. D047 records this bounded mapping, not full admin or live readiness.

## 4. Provenance and visibility

```ts
type Provenance = {
  source: EvidenceSource; platform: Platform | null;
  sourceUrl: string | null; sourceReference: string | null;
  capabilityId: string; retrievedAt: UtcIsoDateTime; evidenceAt: UtcIsoDateTime;
  windowStart: UtcIsoDateTime | null; windowEnd: UtcIsoDateTime | null;
  rawConfidence: number; // mapped source baseline; extraction legibility is not this field
};
type FactValue = string | number | boolean | string[] | Record<string, number> | null;
type ApprovedFactDTO = {
  id: Id; fieldKey: string; observedValue: FactValue; approvedValue: FactValue;
  unit: string | null; provenance: Provenance; reviewStatus: FactReviewStatus;
  visibility: Visibility; overridden: boolean; revision: number;
};
type AdvertisingLicenceDTO = {
  id: Id; jurisdiction: IsoCountryCode; issuer: string; type: string;
  number: string; holder: string; accountIds: Id[]; status: LicenceStatus;
  expiresAt: UtcIsoDateTime | null; reviewedAt: UtcIsoDateTime | null;
  reviewMethod: string | null; scope: string; // private proof/reviewer identifiers omitted from public view
};
type ViewerContext =
  | { kind: 'PUBLIC' }
  | { kind: 'OWNER'; userId: Id }
  | { kind: 'BRAND'; userId: Id; brandId: Id }
  | { kind: 'ADMIN'; userId: Id };
```

ViewerContext is built from trusted server session/ownership, never accepted from a client request. Observations/evidence remain immutable, corrections are separate revisions. Unsupported edits create SELF_REPORTED provenance rather than replacing observed API/screenshot facts. User review never promotes confidence/source/ownership. EvidenceAt is original measurement/capture date, not upload date; future/invalid dates rejected. Uploading old evidence does not make it fresh. Private source references are projected separately; no public signed proof URLs.

| Viewer/surface | Allowed data |
|---|---|
| Public profile/SEO/share/export | Claimed, published, nonhidden, nonsuspended, nontest, email-verified creator with primary proof and consent; approved PUBLIC fields, ownership-proved approved account summaries, selected work, public rates, visible ratings, current reviewed scoped badge. Never contact/proof/private transcripts/detailed audience. |
| Authenticated eligible brand discovery | Approved brand-visible data; detailed audience only under explicit visibility/permission. Unclaimed approved seeds are labeled unverified/unclaimed prospects, not public pages or executable offers. Hidden/suspended/private/test data excluded. |
| Owner editor | Own drafts/approved facts/source status, pending private accounts and private proof through scoped short-lived access. No other user's proof. |
| Authorized admin | Assigned operational data/proof with audit/access scope. Administrative authority does not grant public visibility. |
| Company public portfolio | Explicitly published approved PUBLIC sections, email verified and representative proof accepted; private contacts/proof/CR evidence excluded. |

One projection contract powers public pages, media kits, company exports, badges, search, sitemap and cached share previews. Serialization alone does not authorize visibility. Changing visibility/suspension/ownership invalidates affected cached public projections; private responses are no-store and never shared offline caches. Unclaimed/test/hidden content absent from indexing. Discovery and public approval can be stricter than an owner draft; keep DTOs separate.

Licence badge requires VERIFIED, current unexpired status, accepted scope/account and policy recheck; no typed number/extraction-only badge. Expired/revoked/needs-recheck records remain visible to owner/admin as such and are not current badges. Mandatory campaign-market requirements come from a reviewed versioned policy with actual parties/activity/scope, not nationality/residence. Optional brand licence preference is separate. Never label other jurisdictions موثوق or imply Infame/regulator endorsement.

## 5. Server-authoritative onboarding and jobs

```ts
type CreatorStep = 'WELCOME' | 'NAME' | 'PRIMARY_HANDLE' | 'PLATFORMS' | 'HANDLE_MAPPING'
  | 'ACCOUNT_CONFIRMATION' | 'IMPORT_PERMISSION' | 'IMPORTING' | 'FACT_REVIEW'
  | 'MISSING_ESSENTIALS' | 'PORTFOLIO_DRAFT' | 'PREVIEW' | 'PUBLISHED' | 'SAVED_DRAFT';
type BrandStep = 'WELCOME' | 'COMPANY_IDENTITY' | 'WEBSITE' | 'PLATFORMS' | 'HANDLE_MAPPING'
  | 'ACCOUNT_CONFIRMATION' | 'IMPORT_PERMISSION' | 'IMPORTING' | 'FACT_REVIEW'
  | 'MISSING_ESSENTIALS' | 'PORTFOLIO_DRAFT' | 'PREVIEW' | 'PUBLISHED' | 'SAVED_DRAFT';
type SourceIdentity = { platform: Platform | null; providerAccountId: string | null;
  normalizedHandle: string | null; confirmedOrigin: string | null };
type OnboardingCommand = { operationKey: string; expectedRevision: number;
  action: 'SET_ANSWER' | 'CONFIRM_ACCOUNT' | 'GRANT_IMPORT_CONSENT' | 'START_IMPORT'
    | 'REVIEW_FACT' | 'GENERATE_PORTFOLIO' | 'EDIT_SECTION' | 'APPROVE_SECTION'
    | 'SAVE_DRAFT' | 'PUBLISH' | 'BACK' | 'PAUSE'; payload: Record<string, unknown> };
type OnboardingDraftDTO = { id: Id; role: 'CREATOR' | 'BRAND'; revision: number;
  mappingRevision: number; step: CreatorStep | BrandStep; voiceStatus: VoiceStatus;
  transcript: ChatMessage[]; facts: ApprovedFactDTO[]; jobs: ImportJobDTO[];
  missingFields: string[]; updatedAt: UtcIsoDateTime };
type ImportJobDTO = { id: Id; operationKey: string; status: ImportJobStatus;
  source: SourceIdentity; draftRevision: number; mappingRevision: number;
  completedItems: number; totalItems: number | null; errorCode: string | null };
type GeneratedPortfolioDTO = { id: Id; version: number; factsRevision: number;
  status: GeneratedAssetStatus; sections: { id: Id; text: OriginalText;
    sourceFactIds: Id[]; approved: boolean; manuallyEdited: boolean }[] };
```

Commands have role-specific validated schemas; generic payload in transport is not arbitrary tool authority. Server checks actor/current step/revision/confirmed account/consent/capability/readiness. Voice tools can propose answers or allowlisted commands, never authorize linking/import/money/publication themselves. Material sensitive fields (handles/URLs/money/licences/publication) require explicit accessible on-screen confirmation. Same commands serve voice/cards/form; transcript is not source of truth.

Editing account mapping increments mapping/draft revision, cancels/marks affected jobs stale, detaches affected facts and invalidates derived portfolio sections. Completion compares exact source identity and current relevant revisions inside a transaction; mismatches →STALE with no canonical fact attachment. Fact changes increment facts revision; affected generated sections become STALE and require refresh/reapproval. Different-provider unaffected successful facts survive. A previously accepted observation may be reused only for unchanged identity/revision/consent under declared freshness.

Idempotency unique `(actorId, purpose, operationKey)` plus payload hash; same key/same request returns stored result/status, same key/different payload409. Durable checkpoints survive refresh/task resume. Queued/running/partial/success/error counts reflect actual work; unknown totals do not become fake percentages. Cancellation of speech is separate from cancellation of an authorized import. Billed uncertain external results are reconciled before bounded retry; no exactly-once billing guarantee.

Website import: confirmed exact HTTPS origin on443; no embedded credentials, nonapproved ports/schemes, authenticated fetches or arbitrary page-supplied domains. Initial conservative bounds: maximum5 pages, depth1, redirects3, per-response1MiB, total5MiB, overall20s; reviewed configuration can tighten them. Check destination IP/DNS at connection time and every redirect; reject local/private/reserved/link-local/metadata/IPv4-mapped bypasses/rebinding. Same policy for selected remote images/logos. Honor crawl/access requirements. Strip executable content; extraction treats content as data with bounded schema validation/source citations. No website is a supported brand path.

Voice starts after interaction; mic permission only for speaking; listening+typing supported. Real states drive the indicator. Mute/stop/interrupt/replay/back/exit/resume/language toggle exist; background pauses audio. Provider-neutral adapter authenticates trusted user/session, scopes short-lived credentials/tools, enforces trusted session duration/spend termination and reserves/reconciles atomic text/audio budgets. If realtime trusted spend controls cannot be demonstrated, choose bounded server-controlled speech calls. No browser-only timer as spend boundary. Text/fact-based manual completion works through permission/network/provider/budget failure. No raw audio retained by default; minimal consented transcript retention follows reviewed policy.

Creator publish requires email/consent/valid reserved unique handle/essentials/accepted primary ownership; imported additional unproved identity stays private. Brand publish requires email/representative proof/slug/explicit visible sections. Portfolio never invents customers/collaborations/rates/awards/licences/demographics/results. Draft save is available before proof; failed generation renders editable deterministic approved-fact template without another model call.

Website observation clarification (2026-10-04): for a `WEBSITE` job, the allowlisted public text fields `website.pageTitle`, `website.pageDescription`, `website.pageHeadings` and `website.pageText` may preserve `evidenceAt:null` when the original publication/measurement instant is unknown. They must carry a separate actual nonfuture UTC `retrievedAt`, exact same-origin public HTTPS citation and raw-response SHA256 `sourceHash`. These private `PROPOSED`/`PUBLIC_IMPORT` observations cannot establish metrics, ownership, licence or business verification. All social/analytics measurement observations still require a validated known evidence date; retrieval never freshens them. This is a JSON observation contract clarification, not a schema reset or a change to confidence/metric freshness rules.

## 6. Campaign and approved brief contract

```ts
type CampaignRequirementsDTO = {
  campaignId: Id; version: number; originalLanguage: ContentLanguage;
  title: string; productService: string; goal: CampaignGoal; summary: string;
  brandCountryCode: IsoCountryCode; marketCountryCodes: IsoCountryCode[];
  targetAgeBuckets: AudienceAgeBucket[]; targetGenders: AudienceGender[];
  targetCountryCodes: IsoCountryCode[]; targetCityKeys: string[];
  contentLanguages: string[]; dialects: string[]; nicheSlugs: string[];
  deliverables: Deliverable[]; budget: Money; desiredCreatorCount: number;
  impressionsTarget: number | null; period: DateRange;
  physicalPresenceRequired: boolean; presenceCountryCodes: IsoCountryCode[];
  travelAllowed: boolean; tone: string; noGoTopics: string[];
  preferredTiers: CreatorTier[]; dataVerificationRequired: boolean;
  preferredLicencePolicyIds: string[]; mandatoryPolicyVersionIds: string[];
  usageRights: string; kpis: Kpi[]; assumptions: string[]; openQuestions: string[];
};
type CampaignBriefDTO = { id: Id; campaignId: Id; version: number;
  requirements: CampaignRequirementsDTO; approvedAt: UtcIsoDateTime | null;
  approvedByUserId: Id | null; createdAt: UtcIsoDateTime };
```

Single campaign model supports equally prominent form/chat/paragraph prefill. All material fields editable before approval; no inferred country/currency. Chat asks one clarification/turn, maximum5 actual questions, greetings excluded; unresolved required fields return to form. Onboarding is not capped at5. AI failure leaves editable manual form/brief. Approval checks owned brand and complete valid requirements and freezes a version. Material postapproval edits create new version; old matches remain labeled versioned/stale and accepted deals remain unchanged. Brief/strategy/evidence versions key match explanation caches. Cancellation behavior has explicit actor/state policy; no direct lifecycle jump through API PATCH.

## 7. Deterministic matching

Strategy ID initial `infame-fit-v1-confidence-floor`; version every change. Inputs are approved brief plus relevant eligible account snapshots approved for brand access; no identity in AI matching/explanation contexts. Output contains score0–100, raw confidence, known/unknown subscores/completeness, relevant account IDs/evidence version, supported basket/coverage, estimated impressions, eligibility/prospect status and observed fact reasons. Store match decisions separately from replaceable score runs by campaign/creator.

Eligibility before scoring: reject hidden/suspended/test/ineligible creators; claimed creators must confirm availability for period; satisfy content language/dialect, mandatory reviewed market rules and optional tier/verification/licence preferences, physical-presence/travel and documented evidence-bearing safety/no-go exclusions. Require≥1 requested platform with approved usable evidence no older than90×24h at calculation; timestamp exactly90 days is allowed, future evidence rejected. Only relevant eligible accounts contribute. Residence is not audience geography. Campaign subset is allowed but explicit; offer contains only supported rows.

Approved brand-visible unclaimed seeds can be labeled prospects when evidence passes other filters. Their availability is UNKNOWN; an invitation/proposed offer can proceed, not an active executable deal. Claimed offer creation must recheck availability/proof/eligibility. Direct/invited offers outside a qualifying shortlist get a distinct origin and no invented match score.

```text
weights = { age:.25, niche:.20, geography:.15, gender:.10,
            engagement:.10, budget:.10, exposure:.10 }
unknownSubscore = null               // displayed/stored unknown
scoringSubstitution = .5             // once, only when computing weightedFit
rawConfidence = min(applicable approved source baselines)
weightedFit = sum(weights[c] * (knownSubscore[c] ?? .5))
finalScore = round(100 * weightedFit * (.5 + .5 * rawConfidence))
sourceConfidence = { API:1, SCREENSHOT_VERIFIED:.7, SELF_REPORTED:.4, PUBLIC_IMPORT:.4 }
threshold = 60; maximumResults = 12
sort = score descending, immutable creatorId ASCII ascending
```

Unknown values never become reasons claiming fit. Confidence applies once, not again to each demographic/engagement value. Raw confidence is weakest applicable source among actual used eligible inputs, not unrelated stale/private accounts. Approved usable metrics establish evidence for eligible accounts; no evidence/source means ineligible, not default API confidence. Extraction legibility is a review signal. Tie-break and rounding use the centralized pure module; no AI scoring and no padding below60.

Demographics are finite percentages0–100 with keys deduplicated; each known dimension sum≤100 plus only0.01 tolerance for documented source rounding. No renormalizing incomplete reports to100; unknown residual is retained. Empty/unreported dimension is `null`. Follower counts are nonnegative safe integers; averages/engagement finite nonnegative numbers with validated units/window. Missing weighting followers makes that contribution unknown/excluded with disclosure, not a fictitious follower count. For reported known-weight dimensions:

```text
clamp(x) = min(1,max(0,x))
accountWeight = max(1,followers)
mergedBucketPct = sum(accountWeight*bucketPct) / sum(contributingAccountWeights)
age = clamp(sum(min(audiencePct[b],100/numberOfTargetBuckets))/100)
gender = clamp(sum(audiencePct[g] for selected genders)/100)
geography = clamp(sum(cityPct[c] for target cities)/100)
countryFallback = clamp(sum(countryPct[c] for target countries)/100)
                  * (city targets present ? .8 : 1)
niche = clamp((exactTargetHits + .5*relatedTargetHits)/size(union(campaignNiches,creatorNiches)))
engagement = followerWeightedMean(clamp(engagementPct/(2*platformBaselinePct)))
priceRatio = max(completeSameCurrencySupportedBasket,sameCurrencyMinimum)/allocation
budget = priceRatio<=1 ? 1 : clamp((1.5-priceRatio)/.5)
estimatedImpressions = sum((observedAverageViews ?? followers*fallbackViewRate)*count)
exposure = clamp(estimatedImpressions/perCreatorImpressionsTarget)
```

Exact and related niche hits are disjoint; fame-derived mapping yields related-only credit and does not enlarge union. Specified niche with no relevant creator niche/fame data has score0. Missing inputs/empty targets/zero allocation or target produce null unless an explicitly valid zero-price case is defined; no division by zero/NaN. Country fallback only when target city data unavailable, visibly discounted; do not mix city+country double counts. Unknown geography/gender/age remains unknown. Never multiply marginal age/gender/city shares into an invented joint percentage.

| Platform | Engagement baseline percent | View/follower fallback |
|---|---:|---:|
| INSTAGRAM |1.6|.30|
| TIKTOK |4.6|.50|
| YOUTUBE |1.8|.25|
| SNAPCHAT |2.5|.35|
| X |.6|.10|

These are versioned reproducibility hypotheses, not verified market facts. Formats without a defensible explicit average/fallback return unknown estimates; never manufacture a campaign-package count. Preserve observed definitions/view windows; estimates label estimated impressions, not guaranteed unique people/sales. Exposure requires explicit allocated impressions target or reviewed matching market/currency benchmark. Historical Saudi/SAR awareness4/launch3/event2.5/app2/sales1.5 per-SAR hypotheses remain disabled unless explicitly reviewed/enabled/versioned and labeled; never apply them globally.

Supported basket quotes use exact creator-owned matching-currency rates×count; `FULL` only when every supported row/minimum comparison is known, `PARTIAL` with known subtotal+missing rows, `MISSING` with no priced row. Partial is not total; no extrapolation or historical.75 discount. Unsupported requested rows are listed separately from supported subset. Budget score null if supported basket is incomplete/mismatched. Advisory fair range, quote subtotal/full total and campaign allocation are separate labeled fields. Tier uses largest eligible account: nano<10k, micro10k..<100k, macro100k..<1m, mega≥1m.

Matching runs only explicit owned mutation against approved version; GET reads. Persist run strategy/brief/evidence/policy versions and stable decisions; rerun updates scores without losing save/dismiss/offer history. Explanations cite only observed facts and unknowns, excluded creator identity; deterministic explanations work without model. Profile and matcher share aggregation but explicitly label all-account versus relevant-subset totals. Followers/impressions are not unique audience.

## 8. Offers, state machine, agreements, payment and ratings

```ts
type OfferTermsDTO = { deliverables: Deliverable[]; amount: Money; period: DateRange;
  usageRights: string; note: OriginalText; governingTermsVersionId: Id;
  licencePolicyVersionIds: Id[] };
type DealOfferDTO = { id: Id; dealId: Id; version: number; proposerUserId: Id;
  recipientUserId: Id; status: OfferStatus; terms: OfferTermsDTO;
  createdAt: UtcIsoDateTime; acceptedAt: UtcIsoDateTime | null };
type AgreementDTO = { id: Id; dealId: Id; version: number; acceptedOfferId: Id;
  language: InterfaceLanguage; terms: OfferTermsDTO; brandCountryCode: IsoCountryCode;
  creatorCountryCode: IsoCountryCode; campaignMarketCountryCodes: IsoCountryCode[];
  partiesSnapshot: Record<string,string>; reviewedLicenceSnapshots: AdvertisingLicenceDTO[];
  content: string; contentHash: string; createdAt: UtcIsoDateTime };
type RatingDTO = { id: Id; dealId: Id; authorUserId: Id; stars: 1|2|3|4|5;
  comment: OriginalText | null; submittedAt: UtcIsoDateTime };
```

Coordinator owns single offer schema; deals implementation owns transactional behavior. No active deal for unclaimed prospects: invitation stores proposed terms separately until ownership claim and eligibility/availability revalidation. Claimed initial offer requires verified owned brand/campaign, visible eligible creator, supported creator-specific formats, current reviewed rules and no active duplicate. MATCH/DIRECT/INVITE origin persists; match reference nullable when appropriate. Campaign and offer currencies agree; counter cannot change currency. Stale current offer/version IDs reject409.

| Action | Current state | Authorized actor | Transactional result |
|---|---|---|---|
| Initial offer | Eligible claimed creator, no active duplicate | Verified campaign-owning brand | DealOFFERED + pending offer + event/outbox |
| Counter | OFFERED/COUNTERED | Brand or creator party | Lock current deal/offer; supersede pending; create new pending with proposer/other recipient; COUNTERED |
| Accept | OFFERED/COUNTERED | Current offer recipient only | Current pending→ACCEPTED, dealACCEPTED, freeze terms/create immutable agreement once |
| Decline | OFFERED/COUNTERED | Current offer recipient only | Current pending→DECLINED, dealDECLINED, reason/event |
| Confirm agreement | ACCEPTED | Each party for exact agreement/version | Unique confirmation; first keepsACCEPTED, both atomicallyAGREED; repeat same confirmation idempotent |
| Mark delivery | AGREED | Creator party | Valid bounded evidence/link, dealDELIVERED and event |
| Complete | DELIVERED | Brand party | dealCOMPLETED and event |
| Cancel | OFFERED/COUNTERED/ACCEPTED/AGREED | Either party or authorized admin, reason required | dealCANCELLED; pending offer cancelled; terminal history retained |
| Declare paid | AGREED/DELIVERED/COMPLETED | Brand party only | Set once timestamp; idempotent user report |
| Declare received | AGREED/DELIVERED/COMPLETED | Creator party only | Set once timestamp; idempotent user report |
| Submit rating | COMPLETED | Either party once | Unique author/deal rating sealed under reveal policy |

Nobody accepts/declines their own proposal. Terminal DECLINED/CANCELLED/COMPLETED reject negotiation/delivery. Payment declarations and eligible ratings are separate commands and do not alter lifecycle. No ordinary cancellation after delivery. Unauthorized admin powers need explicit audit policy. Message posting remains allowed for parties under declared postterminal history/support policy, not negotiation state jumps; admin access audited.

Agreement generated once from accepted terms with Arabic default/English option, exact selected language/version and content hash. Snapshot actual party identity/countries, campaign markets, currency/dates/timezone, supported basket, rights/delivery/review obligations, reviewed applicable licence/disclosure and explicit market-reviewed governing terms. No automatic Saudi-law template for global users; professionally reviewed language before live use. Later campaign/profile/licence edits do not rewrite content; current mandatory policy/licence recheck before confirmation can block confirmation honestly. App confirmation is an audit record, not an asserted guaranteed legal e-signature.

Ratings: one1–5/comment per authenticated party after completion. Author may see own sealed submission; opposing rating/content and aggregates exclude sealed values. Reveal when both exist OR currentUTC≥earliestSubmittedUTC+7×24h. Boundary exact; no editable opposing peek via DTO/API/export/admin public summary. Store revealAt/shared projection consistently; idempotent reveal job only materializes same rule. Ratings do not unlock offers or impersonate trust.

## 9. Transactions, uniqueness and events

Required database invariants: normalized unique user email/profile handle/company slug; unique creator/platform/stable account identity and globally accepted ownership proof conflict handling; unique creator/platform/format/currency rate; unique campaign/creator current match decision; unique run/creator scored result; one active deal per campaign/creator via PostgreSQL partial unique index over OFFERED/COUNTERED/ACCEPTED/AGREED/DELIVERED; unique deal/version offer; at most one PENDING offer per deal; unique agreement acceptedOfferId and deal/version; unique agreement/version/user confirmation; unique deal/author rating; hashed one-use invite/claim/verification tokens; idempotent import natural keys and event/operation keys.

Migration owner implements constraints intentionally, including SQL partial indexes/check constraints where Prisma schema cannot express them. Keep terminal deals distinct so subsequent collaboration does not overwrite history. Lock/version-check relevant rows or use serializable transactions with bounded conflict retry; rely on constraints, not precheck alone. Concurrent accept/counter/confirm/claim/import/spend tests exercise actual separate connections on disposable PostgreSQL. Cross-track API calls alone do not make multistep work atomic.

Domain events envelope: `{ id, type, actorUserId, aggregateType, aggregateId, aggregateVersion, idempotencyKey, occurredAt, payload }`; trusted actor and sanitized bounded payload. Event vocabulary includes `account.suspended`, `email.verified`, `ownership.reviewed`, `onboarding.updated`, `import.finished`, `facts.approved`, `portfolio.published`, `brief.approved`, `matching.completed`, `deal.offered`, `deal.countered`, `deal.accepted`, `deal.declined`, `agreement.confirmed`, `deal.agreed`, `deal.delivered`, `deal.completed`, `deal.cancelled`, `payment.paid_declared`, `payment.received_declared`, `rating.submitted`, `ratings.revealed`, `licence.reviewed`, `licence.expired`, `claim.completed`, `invite.created`.

State mutation+audit+outbox enqueue are one database transaction; email/push/provider network delivery is after commit. Unique `(eventId, channel, recipientId)` prevents duplicate notifications; observable bounded retry/backoff and failure reason. Delivery failure never undoes domain action. In-app locale-aware notifications/email and opt-in push; no WhatsApp automation. Authenticated cron/sync/reveal/expiry/reconciliation routes; runtime readiness requires actual execution evidence.

Atomic AI budget ledger reserves before every job/session, consumes/reconciles actual billed usage and releases known unused reservation. Unknown billing persists reconciliation-required state and bounded trusted limit; concurrent calls cannot bypass caps. Central model IDs/voices/prices/currency date, purpose/usage/duration/cost/request context. No per-browser-only caps.

## 10. Component, route and acceptance integration

Thin async server pages query authorized loaders/visibility-aware DTOs; client screens get plain JSON and typed commands. Installed Next guides govern async cookies/promised params/proxy. Shared shell signature: `{ role, account, nav, children }`, nav domain links complete, Arabic/English/theme controls and mobile bottom navigation. Shared primitives consume semantic tokens, support direction/loading/disabled/focus/reduced motion; component APIs are frozen after documented catalog/source review, not guessed from a name.

Public routes include `/`, `/about`, `/for-brands`, `/for-creators`, `/pricing`, `/privacy`, `/terms`, `/login`, `/signup`, verification/reset, `/@handle`, `/brands/[slug]`, invite/claim/data-deletion. Creator/brand/admin route leaves follow ownership map. Public marketing claims use observed data or omit counts. PWA caches only declared public shell/assets; no shared private API/dashboard/transcript/proof cache.

Every screen: loading/empty/unavailable/validation/success/retry,360px Arabic RTL and English LTR, keyboard/focus/labels/contrast, long names/handles, correct LTR input islands/safe area/mobile keyboard. Voice/cards include mic-denied/partial/resume/source-approval/stale/error/manual paths. Figma composition records actual frame/variable/component links, not invented links.

Acceptance crosswalk and failing tests are in plans00–08. Required commits run `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`, `npx next build`, plus relevant database/browser/reviewer checks. Source-era pass claims or unavailable/skipped suites are not proof. Code readiness and real provider/Cloud/deployment/legal/voice launch readiness remain separate recorded gates.
