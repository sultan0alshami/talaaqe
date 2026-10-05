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


## 11. Approved managed commercial extension (D048, 2026-10-05)

The founder-approved [managed plan09](plans/09-managed-platform.md) supersedes historical free/direct-payment-only restrictions for new campaigns. Infame is the service principal; the company retail order and confidential Infame–creator subcontract are separate aggregates, parties, terms, commands and DTO audiences. Preserve accepted historical direct deals and their exact parties, versions, access and declarations. A saved payment report is not provider settlement. No administrator impersonates a company approval or creator signature. New managed work cannot fall through legacy direct-offer APIs.

The quote freezes scope, exact currency/net/tax/gross, item retail allocations summing exactly to the order, rights, review and both remedy policies before payment. Client approval of the roster precedes supplier booking; supplier acceptance creates a retained financial commitment distinct from execution confirmations. One consolidated creative round per item and two Riyadh business days apply; silence pauses publication and never approves. Rights run30 days from first authorized publication on named channels; other rights are separately quoted. Cancellation stages are explicit monotonic noncumulative total liabilities bounded by item net value, before-commit zero. Inability refunds undelivered agreed retail value (full before any commitment), never private supplier savings. Refund, tax adjustment, supplier payable and campaign completion are independent recorded obligations.

Economics compare exact VAT-exclusive revenue and all direct costs with30% target/25% commitment floor; the latter is not markup. Existing liabilities persist through a failed forecast. Reserve one of five pilot slots before checkout; uncertain payment retains its reservation until reconciliation. Closure releases operational capacity only through reviewed resolution and does not erase financial liabilities. Real funded loss/refund capacity is a live prerequisite.

Optional pooled organization/agency AI plans: SAR99/299/999 EX-VAT,3/15/75 sessions per billing cycle, one free trial session without monthly rollover. Session includes at most ten successful chat turns and one brief, strategy, ideas pack and combined refinement. Existing five-question brief clarification maximum remains independent. Reserve entitlement and trusted spend before invocation; consume a session once the first validated output is persisted. Each turn/artifact has its own payload-bound operation identity; identical retries resume without repeat consumption/invocation. Unknown execution remains held for reconciliation. Manual edits/matching are free and saved work survives expiry. Operational staff AI is separately authorized/attributed campaign cost. Anthropic quality and full-session cost evidence precede billing; disabled providers/global spend caps override a paid subscription. OpenAI remains disabled.

Reach taxonomy `infame-reach-v2` is per dated platform/account observation: Nano1,000–<10,000, Micro10,000–<100,000, Mid100,000–<500,000, Macro500,000–<1,000,000, Mega>=1,000,000. Unknown/sub1,000 remain unclassified; no follower sums, fame/quality inference or A/B/C grading. Preserve v1 four-band historical classifications and matching strategy snapshots; integration requires a new version. Rate evidence retains original source follower bounds, platform/format/unit/rights/date/currency and source class; asking, vendor estimate, agreed and achieved prices are distinct, never an unexplained Saudi average.

Implementation approval authorizes local reversible code, migrations on guarded Infame targets and tests. Merchant/recurring, tax/legal/licence, funded refund/liability, private storage/retention, email/phone, actual provider/voice and deployment evidence remain launch dependencies. Do not advertise gated features as usable, infer real publication/outreach/contracts/funds from fixtures or create source-era demo fallbacks.

## 12. Canonical admin creator metadata v1 (D049)

GET `/api/admin/creators` and SSR `/admin/providers` use the shared current ADMIN User/AuthSession locked RepeatableRead boundary with real-clock final authorization and private no-store. Strict DTO `{asOf,scope:ALL_STORED_RECORDS,creators,nextCursor}` returns at most30 ascending-ID rows and a strict exclusive `after` cursor. Row allowlist: `{id,displayName,handle,state,countryCode,cityLabel,claimStatus,accountCounts}`. Display name/handle remain original text; state uses the four central stored ProfileState values. Country is independently validated central ISO or null; city projects only a nonblank original `city.label` of at most100 characters or null, without coercion/translation/repair or audience inference.

`claimStatus:CLAIMED` means only that Creator.userId is nonnull, not completed claim/proven ownership. Count actual SocialAccount records for returned30 IDs only, grouped by central ownershipStatus in the same snapshot. `accountCounts` has total and all five fixed nonnegative safe-integer status keys, with total equal to their sum. Raw stored VERIFIED/PUBLISHED remain descriptive even if current proof/consent/visibility was withdrawn. Include all private/test/hidden/unclaimed/suspended-owner records with explicit scope; exclude owner identity/contact, metrics/tier, rates/ratings, biography, licences/facts/assets/proof and raw JSON.

Transactional audit `admin.creators_accessed / CreatorList / platform` contains only `{asOf,after,returned,nextCursor,scope}`. Read failures/invalid DTO retain prior snapshot; HTTP401/403 clears rows/time before body parsing. Default and cursor screen keys are disjoint. Evidence link is the actual `/admin/evidence` route without invented filtering. Legacy `/api/admin/providers` and approve/reject controls remain retired; this slice adds no mutations, migrations, publication or provider activation.


## 13. Client-scoped organization authority v1 (D050)

M01 adds Organization (BUSINESS/AGENCY, original name, immutable owner, active/revision), OrganizationMembership (PENDING/ACTIVE/REVOKED, immutable org/user association), OrganizationClient (PENDING/ACTIVE/REVOKED, immutable org/Brand), seven-boolean ClientGrant and immutable actor/key OrganizationCommand receipts. Brand.userId and historical deals are unchanged. Grants' composite foreign keys bind membership and client to the same organization; positive next revisions prevent identity changes/ABA reuse. The original owner membership remains ACTIVE and ordinary commands cannot revoke it. There is no organization/receipt deletion API; the receipt FK blocks cascading history loss. Qualified retention/deletion remains a later distinct policy.

Capabilities are independently explicit: view, plan, approveShortlist, reviewContent, signCustomer, financial and manageGrants. An organization owner or billing payer has no implicit client view/action. The current actual Brand owner authorizes the agency association and exact delegation; a proposed association alone grants nothing and its DTO excludes Brand name/contact/private content. The owned-Brand shortcut is only for the same actual Brand and organization owner; it creates an association with the owner's delegable permissions but no automatic seat grant. Only the current Brand owner or the organization owner with accepted manageGrants authority can assign a subset to an active consenting member. Initial M01 does not grant administrative power to an arbitrary member with a manageGrants flag; extension requires its own reviewed bounds. Signing/paying/reviewing are never inferred from viewing or planning.

Association authorization captures actual Brand-owner ID and sessionVersion; every delegated access also checks current Brand.userId, active BRAND role and version. A transfer, suspension or changed version invalidates old delegation until the actual owner explicitly reauthorizes. Membership proposal by the organization owner is not member consent; only the proposed current BRAND user can accept the current PENDING revision. Revocation is versioned and does not delete history; re-proposal creates a new PENDING revision. No invitations are sent by local acceptance.

Membership revocation atomically retires every active grant for that member with the next grant revision, while the membership/organization advance once and produce one parent receipt/audit/event. Already inactive grants and other members remain untouched. Re-proposal and acceptance do not revive former grants; explicit current grant commands are required. Historical receipt replay never reactivates authority. Exhausted supported revisions reject as VERSION_EXHAUSTED409 instead of wrapping.

The private organization directory returns at most30 original organization records and the actor's own PENDING/ACTIVE membership, in exclusive organization-ID order. Only current active BRAND organization owners are included; no other member contact or client content appears. Pending members may read this invitation metadata but cannot use active-member organization/client loaders. The directory audit records only time/cursor/count. GET `/api/organizations`, `/api/organizations/[id]`, `/api/organizations/[id]/clients` and `/api/organization-clients/[id]/authority` and POST `/api/organizations/commands` preserve strict queries/command resources, current native authentication before parsing/preflight, origin checks, bounded bodies, request IDs and private no-store.

The retained company Settings page links to organization creation, pending-membership acceptance and a read-only view-authorized client list. These controls do not widen historical campaign/deal access or activate a global client switch. Unknown command replies retain the exact key/body and input for replay. A confirmed receipt followed by a failed reload blocks fresh mutations until a successful authorized reload; recovery reads the saved state without repeating the command. Denial clears client data before parsing the response. Invitation delivery, client-association/grant management screens and shared-shell switching remain distinct follow-on integration, not completed by these initial controls.

Trusted actor is the current native user/session/version. Perform early current authentication before private preflight; preflight IDs acquire locks only and never establish authority. Lock required Users in ascending identity order, then actor AuthSession, Organization, Membership(s), Client(s), Grant(s), and Brand(s); recheck captured ownership and all states under those locks. Reads use RepeatableRead; DB-only writes use Serializable with at most two conflict retries. Real-clock final session authorization after domain/audit/event work rolls back expired actions. Missing/wrong scope404, genuine wrong role403, invalidated identity401, invalid input422, stale revision/key conflict409, exceeded delegation403, exhausted native conflicts503. Exact replay requires current authority and returns its historical receipt without another mutation/audit/event.

Read DTOs are private/no-store, bounded and allowlisted. getOrganization exposes only original org metadata and the actor's saved membership after current active membership authorization. getOrganizationClients returns at most30 ID-ordered currently view-authorized clients, exact original Brand names, snapshot UTC and exclusive cursor; owner without a grant sees none. getClientAuthority exposes only organization/client/Brand/member/grant IDs, selected capability and four authority revisions; no private parties, proof/contact/cost/raw JSON. Missing current delegation fails closed, not a global role fallback. Each read has a purpose-specific metadata audit. Commands atomically store payload-bound receipts, minimized authority audit and pending event; delivery remains after commit and separately gated.

Buyer, payer, beneficiary Brand, billing organization, actual signatory and reviewer are separate future order bindings, not aliases for organization ownership. This authority layer alone does not widen existing campaign/deal APIs, approve commercial terms, reserve money, send outreach or enable checkout.

### M01B usable agency consent and administration (D051)

An authenticated BRAND user may read their own shareable User/Brand references. Known references address an existing account and confer no permission; no email lookup, autocomplete, contact directory or invitation delivery is implemented. Team/client proposals remain on-platform PENDING records. Exact recipients may decline or leave, including an inactive organization, with immutable owner protection. A current actual Brand owner may reject/revoke any own association despite invalid former delegation, Brand transfer or inactive agency. This rights-removal path locks the stored organization identity without authorizing its owner, verifies the current Brand owner under native locks, atomically retires active grants and advances association/organization once with one payload-bound parent receipt/audit/event. An active organization owner may withdraw a PENDING proposal. Reauthorization never revives revoked grants. Historical receipts grant no present authority.

After any association withdrawal, new authorization requires a fresh explicit agency proposal followed by current customer approval. A customer cannot undo the agency's withdrawn request or restore either party's withdrawn association alone. This narrows the earlier positive authorization service's REVOKED renewal behavior; historical exact replay remains read-only and the same-owner shortcut represents both actual parties explicitly. New proposal/approval still cannot revive retired seat grants.

Separate private reads return snapshot UTC and at most30 ascending-ID rows with an exclusive cursor: own references; organization-owner members; organization-owner associations; actual Brand-owner associations; selected-client grants. Preflight is at most31 rows and at most63 additional User identities, never an unbounded member×client product. PENDING members expose references/state but no name/contact; original member name requires active membership and current active BRAND user. Pending/invalid client associations never expose a private Brand name to an organization owner. Current actual Brand owner or a currently view-granted owner may see that original name. Saved capabilities/state remain descriptive and CURRENT/RENEWAL_REQUIRED distinguishes current authority. A current Brand owner may inspect own historical grant metadata even if delegation/agency is invalid, with effective flags false and assignment disabled; an organization owner requires CURRENT accepted manageGrants for the grants read. Effective flags require active organization/owner, member/current user, grant and captured current Brand-owner/version, intersected with the accepted seven-capability ceiling. Every list is independent and purpose-audited with time/cursor/count, without private names or contacts in audit snapshots.

The actor's existing directory adds `isOwner:boolean` and `available:boolean`, computed under current native organization/membership and owner User locks. Own PENDING/ACTIVE membership metadata remains visible when the organization/owner is unavailable so the exact recipient can decline/leave; other memberships, revoked seats, owner identities/contacts and client data stay excluded. This supersedes M01's active-organization-only directory filter solely for own rights-removal history. Positive acceptance/view/management still require availability and their existing native authority checks; the protected owner cannot leave. Grant editors retain entered values on transient reads but require clear/reselect after a changed client/grant revision, reduced permission ceiling or withdrawn member eligibility. They never send a now-forbidden checked bit from an old editor. Action-specific successful receipts must match the captured resource, expected next revision/state and grant capability payload; malformed200 responses retain exact-key recovery instead of claiming confirmation.

GET `/api/organizations/references`, `/api/organizations/[id]/members`, `/api/organizations/[id]/associations`, `/api/brand/organization-associations` and `/api/organization-clients/[id]/grants` share native authentication-before-parsing, strict queries, private no-store and current/final authorization. POST organization actions add WITHDRAW_MEMBERSHIP, REVOKE_CLIENT and WITHDRAW_CLIENT_PROPOSAL with expected revision and exact operation identity. Existing commands still require active organization/owners for positive authority. Rights withdrawal cannot be blocked by requiring renewal of the rights being removed.

The UI reuses the original720px Settings/card composition. It shows all seven permissions explicitly; proposals/role ownership do not select permissions silently. Unknown replies retain an exact captured command for retry. Confirmed commands with failed reload preserve input and block fresh actions until GET-only recovery succeeds. Malformed denial clears private data before parsing. Same-tick navigation checks the synchronous command/mutation guard. These screens do not impersonate a client or widen legacy agreements. Shared client-scoped domain callbacks must validate native authority and perform their mutation/receipt/audit within the same transaction, never a detached authority read followed by a write.

### M01C atomic client-domain boundary (D052)

Internal `withClientAuthority(actor,clientId,capability,operation,options)` composes the existing native authority predicate with a domain callback in one transaction. A read operation supplies `write:false` and an execute callback; a write requires `write:true`, a strict captured ClientAuthority DTO and an optional DB-only exact-receipt replay callback. Native current authentication precedes validation/private preflight. Preflight identities acquire sorted User locks only; combined organization-owner, current Brand-owner and optional bounded domain User identities must fit the existing63-identity bound. The active organization, consenting member, client, active scoped grant and current captured Brand-owner/session version are rechecked in User→AuthSession→Organization→Membership→Client→Grant→Brand order. Selected capability requires both grant and accepted ceiling; ownership does not substitute.

For writes, all five authority identities and selected capability must match current native scope before either callback. A domain-owned exact actor/key/payload-hash/resource replay may then return its immutable historical result without another mutation. Only a fresh operation compares all four captured authority revisions before executing. Syntactically valid mismatch returns STALE_VERSION409; malformed expected authority422; current missing permission404 or invalid session401 takes precedence over stored history. The helper never advances organization revisions for domain activity and never journals automatically. Domain callbacks validate their own resource's Brand/client binding, input/revision and captured operation identity, and atomically persist their own receipt/audit/outbox. Every callback is DB-only, may run up to three times on genuine Serializable conflicts and must perform no nested transaction or external invocation. Final real-clock session authorization rolls back callback effects on expiry.

The existing authority read delegates to this predicate and retains its single metadata audit/allowlisted DTO. Legacy campaign/deal APIs and organization grant-administration rules remain unchanged; `manageGrants` on an arbitrary seat does not authorize those owner-only commands. Signing/financial flags do not establish commercial-party, legal, merchant or provider readiness. This internal boundary enables separately scoped future integrations; it does not by itself activate customer switching, billing or a new domain.

### M02A exact observation sharing (D054)

New APPROVE_SCREENSHOT_FIELDS receipts add explicit action, current owner/account/mapping/identity, immutable snapshot-scope hash, both expected revisions and the complete original command visibility map. Existing snapshot DTOs and public identity remain unchanged; no receipt/private evidence metadata is returned publicly. Original legacy receipts are preserved and never upgraded by guessing.

Internal metadata-only `acceptedSnapshotFieldConsent(tx,account,snapshot,owner,field,now,minimumVisibility,locked?)` returns a boolean. It uses current owner→reviewer User locks before Creator→SocialAccount→MetricsSnapshot, rechecks active CREATOR ownership and exact current account/snapshot binding, rejects excluded/future/substituted observations and validates original command hashes/revisions/timestamps through current facts approval. The immutable importedAt is the receipt chronology lower bound; mutable SELF_REPORTED approvedAt cannot erase earlier consent after an unrelated approval. Original chosen-field visibility intersects current account-wide sharing. PUBLIC requires both PUBLIC; BRAND_ONLY permits BRAND_ONLY or PUBLIC. Select the greatest valid account evidence revision explicitly approving that chosen snapshot/field; PRIVATE or insufficient sharing at that revision wins over earlier PUBLIC. Approval of an unrelated field leaves prior explicit chosen-field consent intact. Missing original bindings and duplicate valid same-revision receipts at/above the selected revision, including unrelated-field commands, fail closed. This proves sharing only; independent ownership, screenshot confidence/freshness and publication checks remain required.

Opaque newer chosen-snapshot owner receipts form a fail-closed barrier by timestamp OR recorded revision: an unverifiable low revision cannot suppress newer chronological uncertainty or silently fall back to an older PUBLIC approval. A subsequent complete chosen-field command may supersede earlier uncertainty; a complete unrelated-field command is nonblocking. Same-clock opaque history remains conservatively unknown. The shared extraction-only approval schema and field vocabulary retain existing native command validation.

This prerequisite is not mounted to a public API. Its initial metadata scans are internal; the following M02 bounded-reader slice must impose one projection-wide receipt/time budget before discovery use. Existing public-profile and historical matching projections retain their reviewed behavior.

### M02B bounded receipt reading (D055)

`createEvidenceReceiptReader({maxRows?,maxElapsedMs?,clock?})` supplies an internal bounded metadata adapter. Defaults/hard maxima are16,384 full hydrated rows and10,000 monotonic milliseconds; positive safe-integer rows and positive finite elapsed milliseconds may lower them. The trusted test-only clock hook never comes from user/provider input. Every sampled clock is finite and nondecreasing; the deadline begins at reader creation and equality means exhaustion. Invalid initial configuration produces generic INVALID_RECEIPT_READ_CONFIG without values. Runtime clock/budget exhaustion uses metadata-only EvidenceReceiptReadError with code RETRY_REQUIRED/status503.

ReceiptScope binds resource type/ID, actor and optional exact timestamp. Async scan uses ascending ID/exclusive cursors and at most32 rows per page. All hydrated rows, including rejected/unconsumed history, charge the same projection budget before yielding. At zero remaining capacity, a scalar EXISTS query with the identical scope/cursor proves completion or throws without another hydrated receipt. Serialized fetch/probe decisions prevent concurrent/interleaved oversubscription. Check monotonic time around queries, each consumer/predicate step, early iterator return and final proof return; lock waits and canonical hashing count. No provider, byte-storage or canonical JSON SQL implementation.

The inherited receipt createdAt column is UTC civil TIMESTAMP(3). Scalar exact-time probes bind UTC ISO text as timestamp(3), matching Prisma's ORM family under UTC or Asia/Riyadh session timezones; a raw Date/timestamptz comparison must not convert the scope into local civil time. After a domain lock/read exhausts the deadline, checkpoint before issuing another metadata query.

The same optional adapter propagates through evidenceJournal, privateAssetAccepted, acceptedOwnershipProof, acceptedScreenshotProof and exact snapshot-field consent. Legacy omitted-reader behavior remains unchanged. Bounded screenshot journals use one timestamp-family scan with the same original JS acceptance predicates; two valid submission bindings throw503 rather than choosing an unspecified first row. Only a completed scan may prove no matching receipt. Exhaustion/ambiguity aborts the entire future discovery projection; do not omit a candidate, emit partial identities or use an older observation. The following identity/API/UI slice must supply one shared reader and enforce its final checkpoint before exposing any result.

### M02C1 shared public identity gates (D056)

Internal `creatorPublicationCore(tx,{initialId,creator,accounts,portfolio,actors,now,reader?})` validates preloaded current models and returns either null or `{portfolio:PortfolioContent,accounts:SocialAccount[]}`. Internal account records are never a public DTO. Creator input retains its User active/role/isTest/emailVerifiedAt projection; accounts include the scoped primary even if private. Caller must select the latest portfolio version and own the existing native locks; the future bounded caller adds selected actor/domain bounds. The optional reader is the same projection-wide instance, and metadata/domain awaits/predicates respect its deadline.

Share the existing current captured owner/claimed CREATOR, published/non-test creator, active/non-test owner, nonfuture public consent/verified email, primary intent/consent/accepted ownership and latest portfolio approval/schema gates. Existing no-draft behavior passes; when a draft exists its entire sources hash must equal profileFacts.mappingHash. Do not introduce essentials, generatedSectionsStale, inputRevision or command-only revision checks into reads. No fallback to an older portfolio. Public accounts require original visibility/dates and independently accepted ownership; failed secondary accounts are omitted, while a failed primary denies identity. Preserve existing role/ownership/date inclusivity and canonical hash behavior.

Extract the exact existing ProfileTextSchema/PortfolioContentSchema without changing transforms, lengths, control characters or untrimmed bio/section text. profiles.ts re-exports its existing portfolio API and retains all legacy locks/queries, requested-handle behavior and explicit public DTO/rates/work. New bounded adapter consumes the same gates rather than copying a second predicate. This extraction is not itself public discovery/follower authorization.

### M02C2 public discovery identity (D057)

Internal `loadPublicCreatorIdentities(tx,creatorIds,now,reader)` accepts at most12 unique IDs and returns strict public cards for currently permitted identities. The required same reader covers the entire batch and all nested publication/ownership/confidence/sharing work. Preflight all owners and selected account/observation reviewers before any domain lock; acquire all owner Users sorted, then all selected reviewer Users sorted, then Creator→selected SocialAccount→selected latest portfolio/chosen snapshot locks. This batch order avoids owner/reviewer inversion across creators. No broad historical reviewer/licence traversal or late User lock. Bound at most12 owners and2,412 selected reviewers.

Per creator hydrate at most100 public accounts; scalar overflow proof rejects a101st public account without hydrating it. Fetch a separate scoped primary when absent, allowing101 selected accounts including one nonpublic primary. Load only latest portfolio version/approval/content and draft input.sources needed by the shared core; supplied-reader mode excludes transcript/answers/proposed facts while omitted-reader full draft query remains unchanged. No rates/work/licences/private-account collection/portfolio history. Capture and recheck owner, primary, selected account set/identity/mapping/evidence/reviewer and selected observation fingerprints under native locks. Changed lock/selection scope throws metadata-only RETRY_REQUIRED503 for the whole batch, never another User lock or partial result.

Select one newest nonexcluded observation for each selected public account's current mapping, ordering observedAt DESC/importedAt DESC/id ASC. Apply no source/status/approval/freshness/follower filter during selection. Chosen pending/unsupported/null/future/stale values remain unknown; do not search an older eligible value. Only SCREENSHOT_VERIFIED with accepted screenshot proof, exact chosen followers PUBLIC consent and inclusive90-day/nonfuture observedAt exposes a nonnegative exact follower string, source/date/infame-reach-v2 band. Zero and sub1,000 are known counts with null band; unknown is null observation. Residence, audience geography, market, fame, fit and licence remain separate.

DTO contains only Creator id/handle/displayName/approved bio/valid-or-unknown residence country/original languages/niches and public accounts with platform/handle/current ownership VERIFIED plus nullable dated follower observation. No owner/contact/provider/account/snapshot/reviewer/receipt/asset IDs, raw draft/portfolio metadata, asking rates/work URLs, scores or supplier economics. Existing public profile remains the real linked destination. Page service adds native active BRAND authentication before parsing, private no-store, bounded scans/encrypted query-and-actor-bound continuation and metadata-only audit; no client private data or campaign matching access follows from this public scope.
