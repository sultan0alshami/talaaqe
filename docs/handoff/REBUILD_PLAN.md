# Infame / إنفيم — product plan and Talaqee adaptation

Prepared 2026-10-01 as a portable handoff for an MVP built on the existing Talaqee repository.

This document incorporates the founder's latest direction: **Infame / إنفيم**, **infame.sa**, worldwide Arab creator access with deeper Saudi **موثوق** support, voice-guided onboarding, shadcn-based UI, new Codex Cloud setup, and adaptation of **the existing Talaqee codebase and its agent execution process**. Talaqee is the starting implementation, including reusable infrastructure and flows. The former blank-project rebuild instruction is superseded.

## 1. Decision authority and how to use this plan

Use this order when sources disagree:

1. The founder's latest instructions, including the Infame rename.
2. The confirmed product decisions stated here.
3. The explicit implementation defaults and unresolved decisions stated here.
4. Earlier vision, plans, and implementation as supporting evidence.

Source-era documents contain dated status claims, conflicting instructions and implementation gaps. Historical passing checks do not prove the adapted Infame app or live integrations work. This product specification is self-contained, but the implementation requires the actual Talaqee repository. If access is unavailable, prepare contracts/design and report the exact access dependency; do not silently substitute a new scaffold.

**Latest product direction:** worldwide availability for Arab creators and brands reaching Arab audiences, with a deeper Saudi-market experience including reviewed **موثوق** licence badges. V1 remains Arabic-first with an instant English interface toggle, free, mobile-first responsive web/PWA, and without money movement. The signature first-login experience is a female Arabic AI voice guide, live transcript and interactive input cards, followed by approved data collection and an editable generated creator or company portfolio. It also includes sourced creator metrics, form/chat campaigns, deterministic matching, deals, delivery/ratings, profiles/media kits, and creator/brand/admin roles. This replaces the earlier Saudi-only/SAR-only scope and conventional form-only onboarding.

**Working defaults:** an isolated Infame branch/checkout derived from Talaqee; reuse audited infrastructure and replace developer-specific contracts; global onboarding/discovery; Saudi-focused acquisition/support; explicit country/currency/timezone contracts; one currency per deal without FX; approved art direction; shadcn composition; confidence-floor matching and beta targets. Re-estimate delivery after reuse/voice audits rather than repeating the historical eight-week envelope.

**Open decisions:** the legal registered business name/status, domain ownership and social-handle availability, final Arabic logo lettering, beta vertical, model configuration and cost cap, privacy/retention terms, and all V2 commercial/payment decisions.

## 2. The idea

Infame is a Saudi-founded platform connecting Arab creators worldwide with brands seeking Arab audiences. Brands find creators whose audiences fit a campaign, then manage the agreement and collaboration in one place. Creator residence, audience location, campaign market, and brand location are separate facts; Saudi residence or citizenship is not a global signup requirement.

A brand describes what it wants to promote, who it wants to reach, the campaign market, content language/dialect, budget and currency, and timing. The system turns that into an editable structured brief. A deterministic engine evaluates creator audience, niche, geography, engagement, comparable rates, and expected exposure. Every recommendation shows its reasoning and underlying data quality. The brand and creator negotiate in a deal room, confirm an agreement, record delivery, and rate the experience.

Creators get something valuable before receiving an offer: a professional public profile, clear rate cards, a media kit, verified account connections, a portfolio, and an organized collaboration inbox.

The product promise is: **Describe your campaign → approve the brief → understand the shortlist → agree with the creator → complete the collaboration.**

Possible shared Arabic positioning copy, to refine during design: **إنفيم يجمع المؤثرين العرب والعلامات التجارية، من كل مكان.** Saudi campaign copy can retain: **اوصف حملتك، واعرف مين يناسبها، واتفق معه في مكان واحد.**

## 3. Identity

| Item | Rebuild requirement |
|---|---|
| Latin name | Infame |
| Arabic wordmark | إنفيم, confirmed by the founder |
| Canonical domain | infame.sa; selected by the founder, ownership/DNS status to verify |
| Trade/CR identity | Founder intends the Infame identity; record the exact approved Arabic/English legal name and CR separately when registered |
| Preferred social username | @infame.sa wherever the platform permits and the handle is available |
| Support email | hello@infame.sa is a proposed default; enable only after the mailbox/domain is configured |
| App identity defaults | package/database `infame`, session cookie `infame_session`, language cookie `infame_lang` |
| Default interface | Arabic, RTL; understandable shared copy and Saudi Arabic in Saudi-market flows |
| Other interface | English, LTR, instant toggle |

One typed `BRAND` configuration owns the name, Arabic wordmark, domain, and support address. Derive visible copy, metadata, emails, media kits, agreements, and canonical links from it. Give Infame its own database, secrets, OAuth registrations, and deployment configuration.

Create an isolated Infame branch/clone/worktree from the verified Talaqee revision, retaining inherited application code and Git provenance. Keep Talaqee's original checkout/main/tag intact. Generate new Infame secrets and separate development/test/production targets. Retain migration history and deliberately evolve the schema unless a documented clean Infame baseline is justified for an empty isolated database. Inspect inherited database/seed scripts before running them. Read `.env.example` for key names only; never copy secrets or use an existing production database.

Domains, registration approvals, trademark clearance, and handles are verification tasks. Selection of a name is not evidence that those actions are complete.

## 4. What “the same system as Talaqee” means

Use Talaqee's existing application as the MVP foundation and adapt its interaction/engineering system to the influencer domain. Start with a reuse inventory; preserve working code where it meets Infame's contracts. Scaffold only missing capabilities rather than replacing the application foundation.

| Talaqee concept | Infame equivalent |
|---|---|
| Client | Brand / المعلن |
| Service provider | Creator / المؤثر |
| Service request or project | Marketing campaign / الحملة |
| AI clarification conversation | Arabic campaign interview adapted to the selected market, with Saudi Arabic for Saudi campaigns |
| Structured project brief | Structured campaign brief |
| Provider recommendation | Creator shortlist based on audience and campaign fit |
| Proposal request | Structured creator offer |
| Execution/proposal workflow | Deal room, agreement, delivery, ratings |
| Public shell and role dashboards | Public website plus brand, creator, and admin dashboards |
| Shared component foundation | Token-based, responsive Infame component system |
| Screen-agent assignments | Bounded tasks with file ownership, independent review, and integration gates |

Preserve thin server pages, interactive screen components, typed DTOs, centralized route handling, role/ownership checks, bilingual UI infrastructure, activity history, and reusable primitives.

Evolve inherited schemas, dictionaries, prompts, DTOs, routes and screens into the influencer domain. The earlier inline-style screen contract is superseded by shadcn-backed primitives, Tailwind and semantic tokens. Remove demo fallbacks/fake metrics/credentials and developer-procurement terminology in the Infame branch. Reuse real AI briefing and auth/ownership patterns after checking their current behavior; source code is not exempt from acceptance criteria.

### 4.1 Verified Talaqee starting point

Read-only repository audit on 2026-10-01 identified:

- Actual repository: `C:/Users/Asus/Claude_Code/Talaaqe/talaqi`.
- Remote: [sultan0alshami/talaaqe](https://github.com/sultan0alshami/talaaqe), `main`, with HEAD and `v1.0-demo` at `b001002526c7952da97268c75dbeb9ae21414d9b`. Recheck the current revision and working tree before conversion.
- Lockfile-resolved baseline: Next `16.2.10`, React `19.2.4`, Prisma/client `6.19.3`, TypeScript `5.9.3`, Tailwind `4.3.2`; no local `node_modules` at audit time, so these are not proven installed/running versions.
- Existing architecture includes server pages/client screens, Prisma/Postgres, JWT httpOnly auth, role/ownership helpers, JSON DTOs, Arabic-first interface toggle, AI interview/briefing, dashboards and admin patterns.
- shadcn is not currently installed: no `components.json` or shadcn/Radix/Base UI dependency set. The source UI uses handwritten primitives and substantial inline styles.
- Source has no Vitest/Playwright/test scripts. Existing shell demo checks are not Infame release evidence. Add missing meaningful test tooling incrementally.

| Existing Talaqee responsibility | Reuse and conversion |
|---|---|
| Auth, JWT sessions, route/API ownership guards | Retain reviewed primitives; remap roles/cookies and add email/phone verification, recovery, stronger password policy, revocation and distributed limits |
| Public/dashboard shells, navigation, reusable screens | Reuse structure/composition; adapt creator/brand roles and progressively introduce Infame shadcn primitives, mobile/PWA and accessibility |
| Arabic/English interface toggle and logical layout | Retain; replace paired Arabic/English business-content fields with original-language content rather than requiring duplicated translations |
| Server-side Anthropic interview → validated structured brief | Reuse pipeline; replace service/developer prompts, schemas and nominal SAR assumptions; add voice/onboarding/source review |
| Brief approval, matching orchestration and explanation surfaces | Reuse orchestration only; replace skill/experience scoring and padded fallback with influencer evidence/fit/no-padding contracts |
| Proposal/opportunity API and activity history | Reuse ownership/event patterns; source proposal send changes status without terms, so implement real offers/counters/agreements/delivery |
| Provider portfolio and generic approval admin | Adapt into creator/company assets with distinct account, metric, company and advertising-licence verification |
| Prisma/Postgres migrations and local database runner | Reuse tooling after review; isolate Infame database names, directories and ports; replace destructive demo seeding with idempotent synthetic seeds |

The inherited runner uses persistent `talaqi` data on port `5544`; do not point an Infame task at that source instance. An untracked `scripts/check-fork.sh` encodes an older extraction workflow requiring one fresh commit and no inherited migrations. Preserve the source file but do not adopt it as acceptance for this adaptation.

### 4.2 Conversion sequence and MVP reuse inventory

1. Verify source access, instructions, revision, tracked/untracked changes and dependency lock. Create the isolated Infame conversion branch/checkout from an agreed source revision; record provenance in `docs/REUSE_INVENTORY.md`.
2. Prepare Cloud from the inherited repository/lockfile and separate disposable databases. Run available baseline checks and record missing tooling/failures before modifications. Introduce the required test harness rather than claiming absent tests passed.
3. Classify each relevant module as **reuse**, **adapt**, **replace**, **add**, or **retire from the Infame journey**, with paths, owner, reason, dependency and acceptance evidence. Keep shared infrastructure unless a concrete incompatibility/security finding requires change.
4. Freeze client→brand, provider→creator, project→campaign, proposal→offer/deal mappings, original-language content, country/currency, verification and database migration contracts. Do not globally replace strings without reviewing behavior and stored types.
5. Inventory shadcn/catalog/account resources, preserve useful inherited component contracts with adapters, and migrate primitives/shells by working screen. A premium block is a starting composition, not proof that role/state/RTL/accessibility behavior works.
6. Deliver one complete Infame slice: creator profile → brand approved brief → evidence-based shortlist → real offer/agreement/delivery. Integrate signature onboarding/import/portfolio capabilities and remaining required V1 modules through the same shared foundation.
7. Retire obsolete developer-facing routes/copy in the Infame branch, test the merged journeys, verify live integrations and hand over deployment readiness. The original Talaqee project remains available through its original revision.

Reuse should reduce repeated infrastructure work; measure savings after the inventory. No fixed percentage of source completion or guaranteed timeline is assumed.

## 5. Users, positioning, and launch strategy

**Creators:** Arab creators worldwide, including diaspora creators, who need a credible profile, clear pricing, trust in their data, and a manageable way to handle brand offers. Include emerging creators as well as famous personalities; audience relevance matters more than fame alone. Snapchat, TikTok, Instagram, and YouTube are first-class profile platforms. X can use manual/screenshot data in V1.

**Brands:** businesses worldwide seeking Arab audiences, including Saudi SMEs, local businesses, and Salla/Zid merchants. Initial acquisition and hands-on support focus on the founder's Saudi network and Riyadh/Jeddah while global users can join and collaborate. Saudi merchants are the first acquisition cohort, not the only permitted businesses.

**Admins/operators:** the founder and authorized staff who review evidence, maintain taxonomy, moderate profiles, support users, and monitor funnel health and AI costs.

The initial advantage combines voice-guided profile creation, editable generated creator/company portfolios, Arabic creator discovery, Snapchat support, explainable audience matching, creator-owned rates and visible provenance. Saudi campaigns receive deeper local support: Saudi copy/seasons, curated cities, SAR defaults, reviewed موثوق evidence, and applicable agreement/disclosure handling. AI assists collection, explanation and drafting while users control accepted facts and publication.

Global availability increases potential distribution; completed collaborations still require relevant supply and brand demand in the same audience/market segment. Recruit focused cohorts first and measure qualified briefs, offers, response times, and completed deals by campaign market. A global signup count alone does not establish marketplace health.

The original “Arab creators” strategy should be implemented through self-declared language/dialect, location, and campaign relevance. Do not infer ethnicity or nationality from names, photos, or model guesses.

## 6. Product principles and V1 boundaries

1. Every metric shows its source and freshness. Verification of an account, of a screenshot, and of a licence are distinct claims.
2. Explain the facts behind every match. A score is not a probability of success.
3. The creator is a customer: profile, media kit, rates, and inbox must be useful independently.
4. An empty shortlist is valid. Never fill it with candidates below the threshold.
5. The brand can edit all material campaign requirements before approval.
6. UI is Arabic-first, with broadly understandable shared copy and Saudi Arabic for Saudi-market flows. User content is stored once in its original language; interface language does not translate or duplicate bios, briefs, offers, or messages.
7. Rates belong to the creator. An advisory benchmark is not a forced price.
8. Every important action checks actor, ownership, and current state on the server.
9. V1 is free. Brands and creators arrange payment directly; Infame only records their paid/received declarations.
10. Every launched capability has working configured-environment evidence or an honest unavailable/fallback state.

V1 includes worldwide onboarding, discovery, and the complete direct-payment collaboration journey with country-aware data. Payments, custody, escrow, commissions, wallets, invoices, automated tax/e-invoicing, WhatsApp Business integration, native apps, and deeper country-specific commercial operations belong to later phases. Global availability does not constitute a promise that one agreement or licence applies to every country; record supported operational markets and reviewed terms explicitly.

## 7. Account and onboarding system

Roles are `CREATOR`, `BRAND`, and `ADMIN`. Provide signup, login, logout, email verification, password reset, account settings, and immediate session revocation when an account is suspended or a password is reset.

Use password hashing, bounded login/OTP attempts, expiring one-use verification/reset tokens, and secure httpOnly sessions. A twelve-character password minimum is the working baseline. Signup cannot create an admin role. Admin accounts are provisioned through a separate controlled operation.

Brand onboarding collects contact name, company name, sector, email, E.164 phone, country, timezone, website/social links, and optional city/business registration. Use the same country-only and display-only uncurated-city rules as creator locations. Define one server-side `offerVerificationSatisfied` gate: verified email plus country-supported phone OTP or an explicitly approved documented verification fallback. Freeze the Saudi-market verification policy before enabling Saudi offers. International users are not required to obtain Saudi numbers. A typed registration number alone does not earn a business badge.

Creator onboarding follows the voice-and-card journey below, collecting profile essentials and mapping external accounts before data import and portfolio generation. An external social username is separate from the unique Infame profile handle. Save progress incrementally and show what remains before publishing. Voice and text modes use the same data and readiness rules.

### 7.1 Signature voice onboarding and interaction surface

On the first authenticated visit, introduce a clearly identified **Infame AI guide** with a warm, professional female Arabic voice. Use an original Infame visual treatment inspired by live conversational interfaces: a restrained reactive voice indicator, readable transcript, current-step/progress label, and a contextual input card at the bottom above the keyboard/safe area. Do not copy another product's branding or screen design.

The entry screen offers **ابدأ بالصوت** and **كمل بالكتابة**. Start audio on user interaction; ask for microphone permission only when the user chooses to speak. Listening to the guide and typing answers must work without microphone access. Default to Arabic; use understandable shared copy and Saudi phrasing in Saudi contexts. Offer an immediate English interface/guide-language toggle while preserving existing answers and transcripts in their original language.

Suggested Saudi welcome, to refine and test: **ياهلا فيك في إنفيم! أنا مساعدتك الذكية. بساعدك تجهّز ملفك، وتراجع معلوماتك، وتتعرف على فرص التعاون. نبدأ باسمك؟** Keep the introduction brief, with skip/replay controls. Say what will happen and when approval is needed; do not promise complete access to every social platform.

Show assistant speech as a live transcript and voice replies as provisional text until finalized/confirmed. Clearly distinguish ready, listening, processing, speaking, paused, reconnecting, and failed states. Provide microphone mute, stop/interrupt playback, replay, type instead, back/edit, exit/resume, and a visible language toggle. A voice indicator follows actual audio/state rather than a simulated connection.

Each question displays one suitable input card: text/URL field, platform checkboxes, shared-handle choice, per-platform account list, account confirmation, currency/location picker, evidence upload, or fact-review card. Speech can populate conversational drafts, but usernames, URLs, amounts, licence details and publication need explicit confirmation through an accessible on-screen control. Edits update the structured draft; a transcript is not the source of truth. Keep the typed path as capable as voice, including imports and portfolio generation.

### 7.2 Influencer customer journey

| Step | Guide and screen | Persisted outcome / rule |
|---|---|---|
| 1. Welcome and name | Explain the platform briefly; ask the name to display publicly in a bottom input card | Confirmed display name; do not assume a legal name |
| 2. Main username | Ask for the main social username; accept a handle or supported profile URL | Confirmed handle candidate; platform-specific normalization, separate from Infame handle |
| 3. Platforms | Show Instagram, TikTok, YouTube, Snapchat and X checkboxes; ask whether selected platforms share that username | Selected platforms and shared-handle choice |
| 4. Account mapping | If shared, prefill every selected row; otherwise ask for each platform's username/link | Editable per-platform map; shared text does not imply the accounts exist or belong to the user |
| 5. Account confirmation and permission | Show candidate avatar/name/handle/source link where available; creator selects **هذا حسابي** or corrects it. Explain available public import and connection permissions | Confirmed intended accounts and scoped import consent; ownership verification remains separate |
| 6. Data collection | Run approved per-platform jobs, with actual progress and independent results; offer OAuth where required and screenshot/manual alternatives | Dated source facts, job status, ownership/evidence status; one failure preserves other results |
| 7. Fact approval | Show editable account/profile/metric cards with sources and missing values; approve, exclude, correct, reconnect or retry | Accepted facts and visibility choices; approving an imported claim does not verify it |
| 8. Missing essentials | Ask only for absent location/timezone, languages/dialects, niches, availability/travel, currency and optional rates/work/licence evidence | Validated profile essentials; residence stays separate from audience; موثوق is introduced when relevant |
| 9. Portfolio generation | Propose/edit/reserve a unique Infame handle, resolve conflicts/reserved names and show `/@handle`; draft bio/sections/platform summaries/categories/selected work and media-kit preview | Confirmed Infame handle and versioned editable fact-based draft with sources; ownership/readiness checked before public sharing |
| 10. Approval and next action | Allow section editing/regeneration; show what will be public; offer **انشر ملفي** or **احفظ كمسودة**, then profile sharing or one useful next step | Explicit publication subject to existing readiness/visibility rules; no forced full analytics connection |

The result is a usable public-profile/media-kit draft even when metrics are missing. If generation fails or AI budget is exhausted, render a deterministic fact-based template with manual editing, saving and readiness-gated publication without another model call. A generated portfolio is not proof of past paid work. Public posts become samples only after creator selection/approval and when usable for that purpose. Never invent customers, collaborations, rates, awards, licences, demographics or performance.

### 7.3 Company customer journey

Use the same voice/transcript/input-card system, adapted to a company representative and business facts.

| Step | Guide and screen | Persisted outcome / rule |
|---|---|---|
| 1. Welcome and identity | Ask company name, contact name and role with short input cards | Company draft and representative; a conversation does not prove authority |
| 2. Website | Ask for the company website in a bottom URL field; offer **ما عندنا موقع حالياً** | Confirmed website or an explicit no-website path; social-only businesses can continue |
| 3. Social accounts | Show relevant platform checkboxes and shared/per-platform username mapping | Editable business social-account map and candidate confirmations |
| 4. Collection permission | Explain bounded public website/account collection and which connections need authorization | Confirmed sources/consent; a website URL is not a verified-business badge |
| 5. Collect and review | Retrieve permitted public overview/products/services/sectors/assets/links; show source-linked facts and missing/conflicting values | Approved company facts, selected assets, edits/exclusions; treat website content as untrusted data |
| 6. Missing essentials | Ask country/timezone, private contact/verification, target markets, preferred currency, and optional business registration | Country-aware brand profile and verification state; do not infer market/currency from Arabic UI |
| 7. Generate company portfolio | Draft approved overview, products/services, brand identity and links; add only genuine approved examples | Editable versioned company portfolio; no invented customers, logos, testimonials, certifications or results |
| 8. Preview and save/share | Confirm visible sections, edit/regenerate, save private profile or explicitly publish/share an allowed portfolio | Private contacts/proof stay private; public sharing is opt-in and observes company visibility rules |
| 9. First campaign | Offer **ابدأ أول حملة** to enter the existing campaign form/chat using approved company context | Profile can be saved without a campaign; offer sending still requires verified-brand eligibility |

Company portfolio generation supports websites, social-only businesses and manual information, including a deterministic editable template if AI generation fails. Public company portfolios are opt-in and require email verification plus accepted representation proof, such as a verified contact at the company-owned domain, an authorized company account with accepted scope, or documented admin review. A generic mailbox or supplied website URL alone is insufficient. This proof is separate from legal-registration verification. Reserve a stable unique portfolio slug with conflict handling; use a URL such as `/brands/[slug]` under the route contract and visibility-aware exports/indexing. Private drafting is available while proof is pending.

### 7.4 Data collection, review and trust

The founder's request to collect social information automatically supersedes a blanket ban on all collection. Implement a **provider capability matrix**, checked against current official documentation and access terms: permitted public/API retrieval, creator-authorized analytics, required scopes/review, available fields, limits, freshness, and honest fallback. Public website extraction is part of company onboarding. Do not implement an unrestricted all-platform scraper, bypass access controls, reuse user passwords/session cookies, or claim a username reveals private analytics.

Keep four distinct states: account candidate found, user confirmed the intended account, account ownership proved, and individual metric/evidence validated. Discovering or confirming a handle never earns an ownership or analytics badge. A shared username is only a prefill. OAuth/accepted ownership proof and scope-specific analytics must remain explicit. An imported field retains its original provenance after user approval; an unsupported correction becomes self-reported.

Each imported fact records source platform/URL or API reference, retrieval/evidence dates, value and units, capability used, confidence/evidence class and review/visibility status. Preserve the immutable observed value/evidence separately from any user override; editing a number must not rewrite its API source snapshot. Show unknowns rather than zero; do not infer private demographics or sensitive identity/licence/representation facts from a bio. AI can suggest editable descriptions/categories with draft status and sources; it cannot manufacture metrics.

Only approved supported facts feed matching, profiles and generated assets. Suggested/source-observed/public-approved/account-verified/metric-verified claims must have distinct labels. Website/public-import evidence must not be promoted to official API analytics. Retain source references internally without exposing tokens or private proof.

Website retrieval is limited to the user-confirmed public HTTPS domain on port 443 and a small reviewed page/depth/size/time budget. Reject other schemes/ports unless a narrowly reviewed exception is documented. Validate addresses and redirects; block localhost, private/reserved/link-local/metadata addresses, embedded credentials and arbitrary downloads. Enforce destination validation at connection time and across redirects to resist DNS rebinding; apply the same guards to remote logos/images. Honor access/crawl requirements. Do not forward credentials or fetch arbitrary page-supplied URLs. Treat pages/captions as data, never instructions; strip executable content, validate extraction and let users select assets. Verify against [OWASP SSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

### 7.5 State, voice and job architecture

Use a shared server-authoritative onboarding orchestrator with role-specific steps and schemas. A realtime voice model can ask questions and request narrowly allowlisted tools, but cannot authorize account linking, imports, money changes or publication itself. Validate each tool request against actor, current step, confirmed inputs, consent and idempotency. Voice, typed cards and a conventional edit form use the same commands/DTOs.

Creator state sequence:

```text
WELCOME -> NAME -> PRIMARY_HANDLE -> PLATFORMS -> HANDLE_MAPPING
-> ACCOUNT_CONFIRMATION -> IMPORT_PERMISSION -> IMPORTING -> FACT_REVIEW
-> MISSING_ESSENTIALS -> PORTFOLIO_DRAFT -> PREVIEW -> PUBLISHED / SAVED_DRAFT
```

The company variant adds representative/website capture and business fact review, then company draft/preview/save or opt-in publication, followed by optional first campaign. Back/edit invalidates dependent facts/jobs/draft sections; changing a handle cannot retain former-account metrics. Bind each import to source identity and draft/account-mapping revision, rejecting stale completions after edits. Changed facts make generated sections stale until refreshed/reapproved. Use durable operation keys/checkpoints and supported provider idempotency; reuse completed results on resume. Bound billed retries and reconcile/report uncertainty before retrying; do not promise exactly-once external billing.

Use a provider-neutral voice adapter. Browser WebRTC with short-lived server-issued credentials is one candidate; verify supported models, Arabic quality and available female voice samples centrally. Current reference options include [Realtime](https://developers.openai.com/api/docs/guides/realtime), [browser WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc), and [speech generation](https://developers.openai.com/api/docs/guides/text-to-speech). Test Saudi pronunciation and actual handles; API support alone is not Arabic UX validation. Keep Anthropic's brief/extraction/explanation roles unless a documented decision changes them. Standard keys stay server-only. Browser speech features cannot be the sole experience. Text continues when audio, permissions, networking or budget fail; streaming transcription/TTS can share the orchestrator.

Do not store raw audio by default. Keep minimal consented transcript/answers under retention/deletion rules; exclude private transcripts from public exports, shared caches and logs. Meter voice/audio/import/generation within atomic AI budgets. Enforce voice usage/session limits through trusted controls and actual session termination; browser timers and credential expiry alone cannot be the spending boundary. Select an integration with demonstrable provider-side/trusted limits or bounded server-controlled speech calls. Persist approved facts/drafts, pause audio on backgrounding, and resume safely.

The campaign chat's five-question budget does not cap onboarding; onboarding asks only missing questions and supports skipping optional work. Separate conversational interruption from cancelling a confirmed collection job. Each job has visible queued/running/partial/succeeded/failed/cancelled status; show real completion rather than invented percentages. Account connection can be completed later without discarding the portfolio draft.

### 7.6 UX and acceptance criteria

Keep bottom cards visible above the mobile keyboard at 360px, with large touch targets, labels, keyboard/focus operation, contrast and reduced-motion support. Transcript scrolling respects user position; screen readers receive concise completed-turn/status announcements rather than every streamed token. Speech and captions carry the same meaning. Entered usernames/URLs use appropriate LTR islands in RTL layouts. Provide a complete text path when the microphone is denied.

Verify both roles end to end: shared and different handles, wrong account correction, partial provider failure, unavailable analytics, no-website company, edit/reapproval, draft save, explicit publication, resume after refresh/background, language toggle without translating stored answers, currency/location/licence correctness, safe website retrieval, prompt-injection resistance, voice interruption and access/consent/ownership checks. A user cannot publish another person's verified account claim merely by saying **هذا حسابي**.

Run formative usability sessions with 5–8 representative users across creators and company representatives, including Saudi and non-Saudi Arabic speakers, before treating the interaction as validated. Measure time to usable approved draft, completion/abandonment by step, corrections, voice/text switching, speech comprehension and perceived control. Test representative phone microphones, headphones, noisy environments and weak connectivity. Set voice latency/cost targets from a working prototype and measured budget; do not advertise an untested completion-time or quality promise.

## 8. Creator experience

### 8.1 Profile

The profile supports:

- Display name, handle, avatar, bio, and social links.
- Creator country/city/timezone, optional birth year/gender, languages, dialect, niches, fame industry, and content styles.
- Availability, on-location/travel willingness, preferred quoting currency, and currency-qualified minimum deal amounts.
- Per-platform followers, total views, average views, engagement, source, evidence date, and last sync.
- Aggregated audience age, gender, country, and city buckets where supplied by the source.
- Platform/format rate cards, portfolio collaborations, and ratings from completed deals.
- Optional jurisdiction-scoped advertising licence evidence, with Saudi Mawthooq number/scope/expiry/review status and a badge only when reviewed. See section 11.1.

Totals across accounts are derived. Sum-of-followers is an account total, not a claim of unique people. Missing values display as unknown rather than zero.

Canonical age buckets: `13-17`, `18-24`, `25-34`, `35-44`, `45-54`, `55-64`, `65+`. These describe aggregate audience age; they do not authorize minor creator registration. Creator age eligibility is a terms/legal decision to record separately.

Use ISO country codes and country-qualified stable city keys, such as `SA:riyadh` and `EG:cairo`, with translated labels. Allow country-only location and an optional display-only city label where a curated city is absent; do not fabricate a matchable city bucket. Saudi Arabia retains the first curated city list: Riyadh, Jeddah, Mecca, Medina, Dammam, Khobar, Dhahran, Al-Ahsa, Qatif, Jubail, Taif, Yanbu, Tabuk, Buraydah, Unaizah, Hail, Abha, Khamis Mushait, Najran, Jazan, Al-Baha, Hafar Al-Batin, Arar, and Sakaka.

Use one curated bilingual niche taxonomy, approximately 30 parent niches with sub-tags. Reuse the existing curated taxonomy as reference if available. Fame-industry values are sports, acting, music, media, business, religion, academia, gaming, cooking, fashion, travel, and social-only. Maintain the related-niche mapping once, using stable slugs rather than invented database IDs.

Initial content-style options: review, comedy, vlog, tutorial, unboxing, podcast, challenge, lifestyle, educational, news. Dialects include Saudi regional, general Gulf, Egyptian, Levantine, Iraqi, Maghrebi, Sudanese, and formal Arabic. Allow other declared languages and dialects, including multilingual diaspora content. These are user declarations, not model classifications.

### 8.2 Platform connections and evidence

Create capability-aware adapters for Instagram, TikTok, YouTube, Snapchat and optional X lookup, with official OAuth where needed for required scopes. Check current documentation before implementing endpoints, scopes, review requirements or demographics. Login/account identity does not automatically grant analytics access. This research matrix guides onboarding and is not evidence of a live Infame integration:

| Platform | Candidate collection path | Required boundary |
|---|---|---|
| Instagram | Official professional-account connection and supported profile/insights/discovery | Verify current account eligibility, scopes and fields. Meta pages were rate-limited during this planning review; capability remains unverified. [Official docs](https://developers.facebook.com/docs/instagram-platform/) |
| TikTok | Authorized profile and permitted video import with scope-qualified basic/profile/stat fields | Display API requires creator OAuth; profile statistics are not a general audience-demographics feed. [User Info](https://developers.tiktok.com/docs/en/tiktok-api-v2-get-user-info) |
| YouTube | Public handle/channel discovery, metadata/content/statistics; supported connected-owner analytics | Analytics requires owner authorization; retain viewer-versus-follower definitions and documented rounding. [Channels](https://developers.google.com/youtube/v3/docs/channels/list), [Analytics](https://developers.google.com/youtube/analytics/channel_reports) |
| Snapchat | Approved Public Profile API public subset; authorized/opt-in detailed fields | Application allowlisting and endpoint eligibility are required; a public profile is not full analytics access. [Getting started](https://developers.snap.com/marketing-api/Public-Profile-API/GetStarted) |
| X | Optional approved-app username lookup for public profile/follower data; manual/screenshot fallback | Configure actual access/entitlements; lookup does not establish ownership or private demographics. [Lookup](https://docs.x.com/x-api/users/lookup/introduction) |

Use PKCE and CSRF state where supported, encrypted token storage, reconnect/disconnect actions, and bounded retries. A scheduled sync refreshes approved metrics and records snapshots.

V1 source labels:

| Source | Meaning | Baseline confidence |
|---|---|---:|
| API | Metrics received through a permitted official API | 1.0 |
| SCREENSHOT_VERIFIED | Screenshot evidence accepted by an admin | 0.7 |
| SELF_REPORTED | Creator-entered or unreviewed extracted data | 0.4 |
| PUBLIC_IMPORT | Dated non-API public information retrieved through a permitted adapter | 0.4, reviewable default; not ownership or API verification |

Capture provenance for demographics and other independently entered fields too. Connecting one account must not make separately typed figures “API verified.” Retain source/evidence dates separately from the upload or synchronization timestamp.

Screenshot path: upload private evidence → optional AI extraction → show extracted values to the creator → admin reviews handle/account, date, legibility, and metrics → accept or reject with a reason. Extraction alone does not verify anything. Provide manual entry/review when AI is unavailable. Do not refresh old evidence merely by uploading it again.

Snapchat analytics may depend on provider approval; screenshots are a deliberate fallback. X uses manual/screenshot data unless an approved lookup capability is configured. Collection follows section 7.4's provider/access/source rules; unavailable fields remain unknown. There is no universal full-data scraping promise.

### 8.3 Rate cards and portfolio

Rates use an explicit ISO currency and a platform-valid format. Default Saudi-market pricing to SAR; other users choose their quoting currency. A creator can maintain rates in more than one currency:

| Platform | Initial formats |
|---|---|
| Instagram | Story, post, reel, live, campaign |
| TikTok | Video, live, campaign |
| YouTube | Video, short, live, campaign |
| Snapchat | Story, video, campaign |
| X | Post, campaign |

Validate uniqueness by creator/platform/format/currency, positive amounts, currency precision, and supported formats. Store exact amounts without floating-point money. Add a CPM-based advisory range only where market/currency assumptions are available, with an update date. The creator can set a different rate.

V1 uses one currency per campaign and deal, including every counter and accepted agreement. Compare a basket and minimum deal amount only when all amounts use that currency. A currency mismatch is an unknown quote until the creator supplies a matching-currency rate/offer; never silently convert, compare bare numbers, or claim converted funds will settle. Automatic FX and settlement are later work.

Portfolio entries support brand name, description, platform, public work link, and date; validate URLs without arbitrary server-side fetching.

### 8.4 Public profile, media kit, visibility

Use `/@handle` as the shareable URL, implemented through a canonical creator route if convenient. Generate the public profile, PDF media kit, and optional badge from the same permitted data. Arabic export must shape/join letters correctly and embed suitable fonts.

Public visitors can see approved profile fields, platform summaries, portfolio, and public rates. Detailed audience data, creator discovery, and offers require appropriate authenticated access. Private contact data and screenshots never appear publicly.

Unclaimed seeds are brand/admin-only, labeled unverified and excluded from public indexing. Hidden profiles disappear from discovery/public routes. Creator publication requires verified email, consent, a valid reserved Infame handle, required profile fields, and accepted ownership proof for the primary social account via authorized connection or reviewed challenge. An accepted official connection can satisfy this without separate manual profile approval. Additional imported accounts remain private/pending until ownership proof is accepted; do not publish their avatar/bio/metrics/work as another person's unverified claimed identity. Private draft generation remains available before proof. User confirmation **هذا حسابي** is not ownership proof.

## 9. Brand campaign and brief experience

Form-first and chat-first entry points have equal prominence and converge on one campaign model.

Campaign inputs include product/service, goal, campaign markets, audience age/gender/countries/country-qualified cities, content languages/dialects, niche, platforms, deliverables, budget with currency, desired creator count, optional impressions target, dates/timezone, on-location/travel requirements, tone, direction, no-go topics, and optional tier/data-verification/jurisdiction-specific licence preferences. Do not infer audience location from creator residence.

Campaign goals cover awareness, sales, app installs, events, and launch. Adapt seasonal prompts to the selected market: Ramadan/Eid where relevant and Saudi National Day/Riyadh Season in Saudi contexts. Do not force a campaign template.

The chat asks one focused question per turn, with useful answer chips and market-appropriate language. Count actual clarification questions; greetings do not consume the five-question budget. Show missing required inputs rather than inventing them; never guess a country or currency from interface language. A paragraph can prefill the same editable form. Form entry and saving work when the model is unavailable.

Generated brief sections: title, summary, objective, audience, content direction, platforms/deliverables, budget, dates/timeline, KPIs, restrictions, and open assumptions/questions. The brand reviews and can edit every material field before approval. Typed content is stored once.

Approval freezes a version, validates prerequisites, and enables matching. Subsequent material edits create a new version and make the old shortlist's version clear. Signed deals retain their accepted terms rather than following later brief edits.

Campaign lifecycle: draft → brief generated → brief approved → shortlisted → in deals → completed, with explicit cancellation behavior.

## 10. Matching system

### 10.1 Responsibility

The matching core is a pure deterministic module. AI summarizes content and explains computed facts; it cannot choose scores, fabricate demographics, set prices, or override filters.

Input is an approved campaign version plus eligible creator data. Output is a ranked shortlist, per-criterion breakdown, raw confidence, data completeness, quote coverage, and estimated impressions. Keep a versioned strategy identifier with results.

### 10.2 Eligibility first

Exclude hidden/suspended creators and unavailable creators for the campaign period. Require at least one requested platform with usable, dated metrics no older than 90 days. Apply mandatory reviewed campaign-market licence/eligibility rules as well as optional tier, data-verification and jurisdiction-specific licence preferences, content language/dialect requirements, physical presence/travel requirements, and defined safety/no-go exclusions. Creator residence outside a campaign market is eligible unless an explicit physical-presence or reviewed applicable policy requires otherwise.

Approved brand-visible unclaimed seeds can appear as explicitly unclaimed prospects when their evidence passes the stated filters; their availability is unknown until confirmed. Their CTA creates a proposed-offer/claim invitation, not an executable agreement. Keep unknown availability visible and require the claimed creator to confirm availability before an active offer/deal proceeds. Brands can also invite outside a qualifying shortlist through the separate path in section 11.

Only surviving relevant accounts contribute to scores, confidence, demographics, and estimates. A creator can satisfy a subset of a multi-platform campaign; make that supported deliverable basket explicit. An offer must contain only supported deliverables.

Safety flags use a documented product policy and evidence. They are not a legal certification. Keep creator location separate from audience geography; a creator living in Riyadh does not imply a Riyadh audience.

### 10.3 Starting weights and formula

| Criterion | Weight |
|---|---:|
| Audience age overlap | 25% |
| Niche and related fame-industry fit | 20% |
| Audience geography | 15% |
| Audience gender fit | 10% |
| Engagement quality | 10% |
| Creator rate versus allocated budget | 10% |
| Estimated impressions versus campaign goal | 10% |

All subscores are in `0..1`. Weights sum to one. Initial missing-data policy: retain `null` in the facts and use a centrally declared neutral `0.5` only for scoring, with explicit completeness and unknown labels.

Use the documented later implementation default:

```text
weightedFit = sum(weight[criterion] * subscore[criterion])
rawConfidence = weakest applicable evidence confidence
confidenceFactor = 0.5 + 0.5 * rawConfidence
finalScore = round(100 * weightedFit * confidenceFactor)
```

API, screenshot, and typed data therefore have effective factors of `1.0`, `0.85`, and `0.70`. Persist/display the raw confidence too. Screenshot extraction legibility is a review signal, not an undeclared additional score factor.

This is an explicit departure from the original raw multiplication, which caps typed candidates at 40. Keep the floor in the decision ledger and review it before beta. Do not quietly relax it to make fixtures appear stronger.

Threshold: **60**. Maximum initial shortlist: **12**. Sort descending with a stable tie-break. Never pad. Explain an empty result and let the brand revise requirements or invite a creator without calling that creator a strong match.

### 10.4 Subscore definitions and estimation defaults

- Age: histogram overlap between selected target age buckets and available audience buckets.
- Gender: reported audience share in the selected genders.
- Geography: target city share; explicitly labeled discounted country fallback when city data is unavailable. Initial fallback factor `0.8`.
- Niche: exact curated-niche overlap, with smaller parent/child/sibling or fame-derived credit. Exact hit `1`; related hit `0.5` within the overlap calculation.
- Engagement: normalize against a platform benchmark, weighted over eligible accounts and capped at `1`.
- Budget: compare the complete supported creator basket and minimum deal amount with allocated budget only in the campaign currency. A missing rate or mismatched currency remains unknown.
- Exposure: observed average views times deliverable count where possible; use labeled platform assumptions otherwise. Compare with an explicit impressions target or a documented market/currency-specific benchmark. Without either, exposure fit is unknown.

For reproducible starting math, percentages are stored as `0..100`, subscores/confidence as `0..1`, and all inputs are validated/deduplicated. Define `clamp(x) = min(1, max(0, x))`. Initial equations are:

```text
accountWeight = max(1, followers)
mergedBucketPct = sum(accountWeight * bucketPct) / sum(contributingAccountWeights)
ageScore = clamp(sum(min(audiencePct[b], 100 / numberOfTargetBuckets)) / 100)
genderScore = clamp(sum(audiencePct[g] for targeted genders) / 100)
geoScore = clamp(sum(cityPct[c] for targeted cities) / 100)
countryFallback = clamp(sum(countryPct[c] for targeted countries) / 100)
                 * (city targets specified ? 0.8 : 1)
nicheScore = clamp((exactTargetHits + 0.5 * relatedTargetHits)
                  / size(union(campaignNiches, creatorNiches)))
engagementScore = followerWeightedMean(clamp(engagementPct / (2 * platformBaselinePct)))
priceRatio = max(completeSameCurrencyBasketPrice, sameCurrencyMinimumDeal) / allocatedCreatorBudget
budgetScore = priceRatio <= 1 ? 1 : clamp((1.5 - priceRatio) / 0.5)
impressions = sum((observedAverageViews ?? followers * fallbackViewRate) * count)
exposureScore = clamp(impressions / perCreatorImpressionsTarget)
```

Missing required inputs return unknown, not a division by zero or a fabricated metric. The uniform age target and follower-weighting are declared starting assumptions. Do not multiply them by confidence a second time. Exact and related niche hits are disjoint; fame-derived credit never adds an exact hit or enlarges the union. If no relevant creator niche/fame information exists, niche fit is zero for a specified campaign niche.

The Infame adaptation prices a defined supported deliverable subset. Unknown rows retain partial coverage and a neutral unknown budget score; no extrapolation is presented as a quote. This deliberately replaces the earlier influencer reference implementation's partial-basket extrapolation and `0.75` discount; it is not inherited Talaqee behavior. Keep the change in the decision ledger.

The historical numeric defaults below are starting assumptions for reproducibility, not independently validated Saudi market benchmarks:

| Platform | Engagement baseline | Views/followers fallback |
|---|---:|---:|
| Instagram | 1.6% | 0.30 |
| TikTok | 4.6% | 0.50 |
| YouTube | 1.8% | 0.25 |
| Snapchat | 2.5% | 0.35 |
| X | 0.6% | 0.10 |

Global V1 allocation: the brand selects a desired creator count from 1–12, initially 1 and editable. Divide the campaign budget using exact minor-unit arithmetic and a deterministic remainder rule; allow explicit per-creator allocations and show remaining budget. Retire the earlier `sqrt(budgetSar / 5000)` heuristic as the global default. Full budget-fit credit ends at allocation and decays to zero at `1.5 × allocation`.

Prefer an explicit campaign impressions target, allocated across planned creators. Historical per-SAR exposure assumptions (awareness `4`, launch `3`, event `2.5`, app installs `2`, sales `1.5`) may be retained only as labeled, versioned hypotheses for Saudi/SAR campaigns; do not reuse nominal numbers for other currencies or markets. Without an explicit target or a reviewed matching market/currency benchmark, the exposure subscore is unknown. These assumptions do not predict sales or installs.

Use one audience aggregation function: follower-weighted means for accounts reporting each dimension, with source confidence handled separately. Profile totals may use all eligible accounts while matching uses the explicitly selected subset; label that subset. Preserve unknown/unreported share rather than turning partial demographic observations into a complete population.

Rates are summed as price × count. Label full, partial, or missing quote coverage. Never show a partial quote as the total campaign price. Format-specific estimation assumptions, if used, must be shared or explicitly differentiated from the fair-price advisory model.

### 10.5 Shortlist behavior

Show persona groups (primary niche × follower tier), source/freshness and licence badges, audience-fit breakdown, creator residence separately from audience geography, currency-qualified rates/quote coverage, estimated impressions, and a short market-appropriate Arabic explanation. Initial tiers: nano under 10K, micro 10K–under 100K, macro 100K–under 1M, mega 1M+ on the largest eligible account.

Reasons cite observed facts and disclose missing evidence. Separate marginal age, gender, and city percentages; do not invent a joint “women aged 18–24 in Riyadh” percentage from separate distributions.

Save/dismiss/send-offer decisions survive reruns. Cache explanations by brief/strategy/evidence version. GET requests read existing results; explicit mutations run matching. Provide creator search using the same trust and visibility rules.

## 11. Deal room and completion

An owned eligible match or explicit creator selection/invitation starts the offer workflow. The first offer prepopulates supported deliverables, amount/currency, dates/timezone, usage rights, and a note. Validate ownership, country-aware brand verification, visibility, supported formats, duplicate creation, and applicable campaign licence requirements. A global account is not required to have a Saudi phone number.

For an unclaimed seed, store proposed terms on a pending invitation and ask the creator to prove ownership, claim the profile, and confirm availability. Create the active deal only after authenticated claim and revalidation. For an already claimed invited creator outside the shortlist, permit an explicitly labeled direct offer after eligibility/visibility checks; it does not earn a threshold-clearing match score. An active deal records its match/direct/invite origin and keeps a nullable match reference where appropriate.

Both sides can message and review offer history. Either can counter. New counters supersede previous pending offers atomically. The other party can accept or decline with a reason; nobody accepts their own offer.

| Action | From state | Permitted actor | Result |
|---|---|---|---|
| Send initial offer | Eligible claimed creator, no duplicate active deal | Verified brand | Offered |
| Counter | Offered/countered | Either party | Countered, previous pending offer superseded |
| Accept current offer | Offered/countered | Other party | Accepted, terms frozen |
| Decline current offer | Offered/countered | Other party | Declined |
| Confirm agreement | Accepted | Each party separately | Accepted after first; agreed after both confirmations |
| Mark delivery with evidence/link | Agreed | Creator | Delivered |
| Confirm delivery | Delivered | Brand | Completed |
| Cancel eligible deal | Offered/countered/accepted/agreed | Party or authorized admin under the policy | Cancelled, reason/event recorded |

Declined, cancelled, and completed are terminal for negotiation/delivery transitions. Payment declarations and allowed rating submissions remain separate actions on the appropriate states. Reject stale-offer IDs and invalid transitions atomically; repeated confirmations are idempotent. Permit at most one active deal per campaign/creator; a permitted later collaboration uses a distinct deal rather than rewriting terminal history.

The agreement is generated once from accepted terms: party identities/countries, campaign markets, deliverables, amount/currency, dates/timezone, usage rights, delivery/review obligations, reviewed licence evidence, and applicable disclosure requirements. Arabic is the default with an English option. Snapshot the actual agreed language/version and explicit market-reviewed governing terms; do not silently apply a Saudi-law template to every international collaboration. Include Saudi disclosure wording such as `#إعلان` where applicable after review. Have agreement/confirmation language professionally reviewed before live use. App confirmation is an audit record, not a promised legal e-signature guarantee.

Store explicit per-party agreement confirmations tied to the agreement version, with unique constraints and atomic state updates. Later profile/campaign changes do not rewrite agreed terms.

V1 payment marks are idempotent role-gated timestamps: the brand declares paid; the creator declares received. These are user reports, not verified transfers. Money goes directly between the parties.

Ratings are allowed after completion: 1–5 stars and optional comment. Each side submits once. Hide the other rating until both submit or seven days after the first rating, using a defined reveal policy. Record actor-bearing events for offers, confirmations, delivery, payment declarations, cancellation, and ratings.

### 11.1 Saudi موثوق badge and contracting experience

The badge represents a reviewed Saudi advertising licence claim. It is separate from account ownership, identity checks, API analytics verification, and business-registration verification. Infame does not issue the licence or imply regulator endorsement.

Store issuer, jurisdiction, licence type/number, holder and relevant account scope, status, expiry when applicable, review method, reviewer, review date, and private evidence. Suggested states are pending, verified, rejected, expired, revoked, and needs recheck. A typed number earns no badge. V1 uses documented manual review against regulator verification and/or accepted evidence; do not assume a public API or scrape a registry. Start from the [regulator's licence-verification service](https://elaam.gmedia.gov.sa/?check-celebrity-license=) and verify current access and applicable rules during implementation; a dated search result is not live badge evidence.

Brands running Saudi-market campaigns can filter for a currently reviewed موثوق badge, inspect its scope and review date, and reuse validated details in an agreement snapshot, wherever the brand is based. Notify creators before recorded expiry, invalidate a known expired/revoked badge, and recheck applicable status before agreement confirmation under the recorded policy. Show unknown/unreviewed states honestly and retain an audit trail.

موثوق is not a universal signup requirement. Determine requirements for a Saudi campaign from current reviewed rules and the actual parties/activity/licence scope, rather than residence or nationality alone. A brand preference for licensed creators and a mandatory eligibility rule are distinct. Other countries' local licences must keep their own jurisdiction/issuer labels.

## 12. Admin, growth, and notifications

Admin screens provide a real-data overview, users, creator moderation, campaign visibility, niche management, screenshot/licence/CR verification queues, CSV seed import, settings, and audit history. Suspension immediately invalidates sessions. Administrative mutations require role checks and leave an audit event.

Imports support a preview/dry run, line-specific errors, normalized handles, duplicate detection, and idempotent natural-key upserts. Importing a creator creates a clearly unclaimed/unverified entry, not a consenting verified user. Founder-supplied seed data must have an appropriate permission/publication basis recorded.

Growth loops:

1. Creator shares their public profile, media kit, and verified badge.
2. A brand invites a creator by handle/link.
3. An offer to an unclaimed profile produces a claim-invite workflow after authorized contact routing.
4. A tokenized claim securely verifies account ownership and transfers the profile atomically.
5. Referral links attribute real signups without inventing rewards or commissions.
6. The founder personally onboards early creators and works with talent agencies.

Notifications fan out to in-app, locale-appropriate email, and opt-in PWA push. Store timestamps in UTC and display deadlines in explicit user/campaign timezones, with daylight-saving-safe handling. Use idempotent event keys, record failures, and retry safely. A notification failure does not roll back a deal action. WhatsApp link sharing is possible; automated integration is V2.

SEO includes public marketing metadata, indexable claimed/published profiles, sitemap, canonical links, and share previews. Exclude hidden/unclaimed/test profiles and all private dashboards. Programmatic city/niche/platform acquisition pages follow later after usable supply exists.

## 13. Screen and route inventory

Routes are a working information architecture; keep the user journey stable if internal routing changes.

| Area | Required screens/routes |
|---|---|
| Public | `/`, `/about`, `/for-brands`, `/for-creators`, `/pricing`, `/privacy`, `/terms`, login, signup, email verification, password reset, creator profile, explicitly published company portfolio, invite/claim, provider-required data-deletion handling |
| Creator | First-login voice/text onboarding, account mapping/import/fact review, generated portfolio preview/editor, dashboard, connections, profile editor, rates, work, deals, settings, media-kit export, referral/share |
| Brand | First-login voice/text onboarding, website/account import/review, company portfolio preview/editor/visibility, dashboard, profile/verification, campaign form/chat/brief, matches/search, deals, settings |
| Admin | Overview, users, creators, campaigns, niches, verification queue, import, settings, audit details |
| Shared | Notifications, loading/empty/error states, offline page, install prompt, language toggle |

The pricing page explains the free V1 and direct payment between parties. It does not advertise undecided V2 fees. Dashboards compute real counts; public proof/social statistics require real evidence or are omitted.

## 14. Design and accessibility

Carry over Talaqee's reusable shell/component approach with the influencer product's visual direction:

- Ink `#121214`, warm off-white `#FAF9F4`, dark ground `#0E0E10`, dark text `#F2F1EA`.
- Action yellow `#FFFC00`; `#B88A00` may be used decoratively, but ordinary yellow-family text needs a darker contrast-tested semantic token. The historical `#B88A00` on warm off-white does not meet ordinary-text contrast.
- Verified/AI gradient `#F58529 → #DD2A7B → #8134AF`, used sparingly.
- Danger `#D62828`; reserve pure YouTube red for its platform identity.
- IBM Plex Sans Arabic/IBM Plex Sans for interface; Arabic bold headlines and a suitable Latin display face; readable numerical typography.

These are working art-direction defaults, not a finished Infame logo. Build semantic tokens for backgrounds, surfaces, borders, foregrounds, accent, danger, success, and focus. Components consume those tokens and platform tint classes.

Core primitives: button, card, input, textarea, field, select, badge, avatar, table, stat, toast, icon/platform icon, fit bar, reason modal, notification bell, and bottom navigation. Shared dashboard shell takes typed role/nav/account props.

Every screen must work at 360px. Mobile creator/brand dashboards use bottom navigation; tables become usable cards or controlled scroll views. Use logical spacing, appropriate LTR islands for handles/URLs, real labels, keyboard focus, contrast, reduced motion, and accessible modal behavior. Never letter-space Arabic.

Provide loading, empty, unavailable, validation, success, and retry states. Use actual async progress rather than invented generation completion timers. Disable duplicate submissions while work is in flight and still enforce idempotency server-side.

The PWA supports installation, safe offline navigation, and opt-in push. Do not cache private dashboard/API responses into public/shared offline caches. Native applications remain later work.

### 14.1 shadcn access, complete catalog research and UI composition

The founder confirms full access to **[shadcn Studio](https://shadcnstudio.com/)** through the existing email-connected account, including its resources usable in the connected **Figma** workspace, and authorizes their use for Infame. Use available authenticated access and its actual licensed assets. Public shadcn/ui is the underlying implementation reference. Check connections in the execution environment; an existing web/desktop account connection does not prove a new Cloud task is authenticated. Keep credentials out of project documents.

Before choosing components, **crawl/index the full accessible shadcn Studio website/catalog and official shadcn/ui website/catalog**, including docs, component/variant overviews, examples, blocks/templates, theming, RTL, accessibility, CLI/registries and Figma resources. Inventory Studio's authenticated resources as well as public ones. This is development research rather than an Infame end-user scraper or an instruction to install everything.

Start with [Studio's catalog index](https://shadcnstudio.com/llms.txt), [components](https://shadcnstudio.com/components), [blocks](https://shadcnstudio.com/blocks), [pages](https://shadcnstudio.com/pages), [templates](https://shadcnstudio.com/templates) and [Figma kit](https://shadcnstudio.com/figma), alongside the public [shadcn documentation index](https://ui.shadcn.com/llms.txt), [components](https://ui.shadcn.com/docs/components) and [blocks](https://ui.shadcn.com/blocks). Enumerate accessible registry items with pagination; fetch/cache docs in bounded batches, deduplicate variants and record failures. Read all overviews and selected APIs/examples/source. Report indexed versus read coverage accurately.

Verify current [CLI syntax](https://ui.shadcn.com/docs/cli) and `--help` against the inherited runtime. Candidate read-only commands include `npx shadcn@latest info`, `search @shadcn --limit 100 --offset 0`, `view button card dialog`, `docs drawer`, and `add drawer --dry-run`; advance search offsets to finish enumeration. Use the inherited package manager and record the resolved CLI version. The [MCP server](https://ui.shadcn.com/docs/mcp) can assist where actually connected; do not assume local MCP configuration automatically exists in Codex Cloud.

Deliver `docs/SHADCN_RESEARCH.md` with date, Studio/public registries and access status, indexed/read/unavailable URLs, component/variant inventory, source/licence/dependency notes and selections. Deliver `docs/UI_COMPOSITION.md` mapping every required screen/state to components, layout, tokens, responsive/RTL/accessibility and acceptance. Use summaries/references rather than committing a website mirror.

Use connected **Figma** and Studio kits/variables/variants/slots to prototype onboarding, account/fact review, portfolios, discovery, briefs and deals. Begin with Arabic mobile frames plus English/desktop/loading/error/permission/resume states. Map Infame tokens/fonts to Figma variables and inherited code tokens; record file/frame/component links, interactions and implementation paths. Follow Studio's [design-to-code workflow](https://shadcnstudio.com/docs/documentation-figma/design-to-code-workflow), [variables](https://shadcnstudio.com/docs/documentation-figma/variables) and [plugin guide](https://shadcnstudio.com/docs/documentation-figma/figma-to-shadcn-plugin). Original blocks can use documented CLI lookup; customized frames need actual design context and reviewed code adaptation. Do not replace Talaqee with a full Studio starter template. Follow relevant Figma skills before mutations. If Cloud lacks tools, use the connected companion and attach its handoff.

| Infame journey/surface | Components/compositions to evaluate |
|---|---|
| Live voice and transcript | Message/Bubble/Message Scroller where available, Buttons/Progress; custom accessible real voice-status indicator |
| Bottom input cards | Drawer on mobile, inline Card/Dialog on desktop, Field/Input Group/Input/Textarea; avoid a modal for every sentence |
| Platform and username mapping | Checkbox, Radio Group/Switch, Field, editable per-platform rows; Questionnaire can render step inputs while Infame owns branching/persistence |
| Import progress and approved facts | Card/Item, Badge, Accordion, editable fields, Alert; source/unknown/conflict states are visible |
| Creator/company portfolio | Avatar, Aspect Ratio, Card, Tabs, Badge, Separator, responsive previews and section editor |
| Creator discovery | Combobox/Select/Checkbox, mobile filter Sheet, Pagination and media-forward cards |
| Briefs, offers and agreements | Field/Textarea/date controls, Tabs/Card and accessible explicit confirmation; AlertDialog for consequential actions |
| Admin verification | Sidebar/Data Table/Dropdown Menu, review Sheet, provenance/status badges and genuine summaries |
| Loading, failure and empty results | Skeleton/Spinner/Empty/Alert, persistent inline errors; supplementary toasts never replace actionable errors |

Some names/variants are current catalog candidates, not dependencies already installed in Talaqee. Select a compatible primitive family centrally and verify every chosen variant; do not mix incompatible APIs or migrate a working primitive solely to obtain a block. Catalog indexes can lag implementation details: actual variant docs/source and installed versions determine usage.

The audit found no existing `components.json`, so add shadcn deliberately to the inherited app. Inspect globals/fonts/aliases and preview initialization effects. Use noninteractive flags confirmed by the current CLI; do not blindly force-overwrite styles, dependency files or components. Install only selected reviewed components, preserve useful legacy signatures with adapters, and migrate affected callers incrementally. Review each diff and dependency change; do not run `add --all` as a design strategy.

Keep Infame palette, IBM Plex Arabic/Latin and light/dark modes through semantic tokens. Apply current [theming](https://ui.shadcn.com/docs/theming) and public [RTL](https://ui.shadcn.com/docs/rtl) guidance. **Studio does not provide official RTL support; migration alone is insufficient for its blocks/templates**, per its [CLI guide](https://shadcnstudio.com/docs/getting-started/how-to-use-shadcn-cli). Adapt and test spacing/arrows/portals/focus/calendars/pagination/sidebar, long Arabic names, English toggle and keyboards manually. Primitives still require tested labels/states/composition.

Studio's documented namespaces include `@shadcn-studio`, `@ss-components`, `@ss-blocks`, `@ss-pages`, `@ss-illustrations` and `@ss-themes`; premium access uses the registered email plus licence key through environment-variable interpolation. Follow the [Studio CLI guide](https://shadcnstudio.com/docs/getting-started/how-to-use-shadcn-cli) and actual [asset licence](https://shadcnstudio.com/license); keep credential values out of Git/reports/client code/install URLs. Verify tool compatibility: [Studio MCP](https://shadcnstudio.com/docs/getting-started/shadcn-studio-mcp-server) documentation does not establish Codex Cloud support. Use authenticated CLI/registry and connected Figma as fallbacks. Continue public work while any private access dependency is resolved.

UI acceptance requires real Arabic RTL/English LTR browser evidence for touch, keyboard, screen reader, reduced motion, voice/text/mic-denied states, partial imports, edit/reapproval and saved-progress recovery. Judge components by task completion and clarity; access to a large catalog is not usability evidence.

## 15. Technical architecture and data model

Architecture starts with Talaqee's Next App Router/React/TypeScript/Tailwind/Prisma-Postgres/Anthropic code and lockfile. Preserve compatible working infrastructure. Add shadcn source components, missing Vitest/Testing Library/Playwright/CI, private evidence storage, voice and provider imports where absent. Supabase private storage and Vercel remain selected infrastructure targets, subject to inspected inherited configuration. Upgrade dependencies only for recorded compatibility/security reasons after reproducing baseline checks; verify current official/installed APIs.

For Next 16, read installed guides in `node_modules/next/dist/docs/` before coding. Talaqee has root `proxy.ts`; preserve its placement unless the installed framework/project configuration requires change. Confirm async cookies and promised route params against the actual release. The path map below describes responsibilities; preserve working inherited paths rather than reorganizing solely to match this example.

```text
src/app/                    server pages, role layouts, API endpoints
src/components/ui/          shared primitives
src/components/shells/      public and dashboard shells
src/components/screens/     public, creator, brand, admin screens
src/components/deals/       shared deal UI
src/lib/config/             brand and capability configuration
src/lib/dictionary/{ar,en}/  domain-owned UI translations
src/lib/auth/ or equivalents identity, sessions, roles, tokens
src/lib/social/             provider adapters, provenance, sync
src/lib/onboarding/         server-owned steps, consent, drafts and review
src/lib/voice/              realtime/STT/TTS adapters and safe session setup
src/lib/imports/            bounded provider/website jobs and source facts
src/lib/campaign/           validation and brief workflow
src/lib/matching/           pure scoring, loaders, persistence
src/lib/deals/              offers, state machine, agreements, events
src/lib/ai/                 model routing, validation, cost enforcement
src/lib/dto/                visibility-aware serialization
src/lib/ownership/          reusable server ownership checks
src/lib/notifications/      event delivery and retries
prisma/                     schema, migrations, safe seeds
tests/                      cross-domain acceptance/contract tests
e2e/                        browser journeys
docs/                       decisions, plans, progress, handover, runbooks
```

Entity families:

| Family | Entities |
|---|---|
| Identity/operations | User, Session/version mechanism, verification/reset tokens, OtpCode, RateLimitBucket, ActivityLog, AdminSetting, AiUsageLog |
| Supply | Creator, SocialAccount, MetricsSnapshot, AudienceDemographic, ContentThemeSummary, RateCard, PortfolioItem |
| Local trust | Jurisdiction-scoped AdvertisingLicenceEvidence and BusinessVerification records, review events and private proof |
| Taxonomy | Niche, CreatorNiche, CampaignNiche |
| Demand | Brand, Campaign, CampaignBrief/version, Conversation |
| Collaboration | Match, Deal, DealOffer, AgreementConfirmation, Message, Rating |
| Growth/delivery | Referral, Invite, Notification, PushSubscription |

The entity list describes responsibilities, not an obligation to reproduce an exact historical table count. Add tokens/confirmations/versioning where they clarify correctness. Onboarding also needs durable role-specific OnboardingDraft/Session, per-source ImportJob, source-linked ProposedFact/review records, and versioned GeneratedPortfolio assets or equivalent responsibilities. Reuse canonical creator/brand facts after approval; avoid an independently drifting AI profile database. Store stable provider account IDs separately from mutable usernames.

Freeze shared shapes before delegation:

```ts
type Deliverable = { platform: Platform; format: DealFormat; count: number };
type ChatMessage = { role: 'user' | 'assistant'; text: string; ts: number; chips?: string[] };
type Kpi = { name: string; target: string };
type City = { key: string; countryCode: string; ar: string; en: string };
type Money = { amountMinor: string; currencyCode: string };
```

Choose one exact KPI target type during contract setup. `Money.amountMinor` is an exact integer string at the DTO boundary, backed by an exact database type; validate ISO currency precision and rounding centrally. Freeze countries, city keys, currencies, UTC/timezone handling, content-language requirements, and campaign market policy before parallel work. Profile location, audience geography, campaign market, and interface language remain separate contracts.

Unique constraints protect handles, creator/platform accounts, creator/platform/format/currency rates, campaign/creator matches, one active deal per campaign/creator, ratings, invitations, confirmations, and idempotent events. Use transactions for multi-step state changes. User content is stored once in its original language; controlled UI/taxonomy translations are separate.

### 15.1 Codex Cloud development setup

Use **new Codex Cloud** for the repository containing inherited Talaqee code and the isolated Infame conversion branch. Its publication/secrets/networking differ from Legacy Cloud. The prompt includes the full first-task checklist; verify current [Cloud environment documentation](https://learn.chatgpt.com/docs/environments/cloud-environments) during execution.

Inspect inherited runtime/manifests/lockfile and database scripts before setup. Review/adapt the embedded-Postgres runner to distinct Infame names, task data directories and ports; verify Cloud support without touching source `talaqi` data. A supported task-local PostgreSQL service is an alternative. Do not assume Docker/systemd/native connectivity through HTTPS allowlists. If unsupported, document it and verify an isolated disposable database option.

Development and test/E2E targets must be distinct and isolated from production/reference data and from parallel tasks. Generate fresh development credentials, use synthetic idempotent fixtures, and refuse resets against ambiguous/non-disposable targets. Task resume must preserve existing work. Runtime values belong in Cloud environment configuration or the Personal vault; database clients need process-readable values, not HTTPS network-secret placeholders. Keep ignored local files and committed examples free of real credentials.

Capture tested install in the **Install script** and startup/readiness/current-checkout reconciliation in the **Start skill**. Prove isolated connectivity, reviewed migrations, safe seeding and inherited app startup/checks. Replace destructive demo seeds; add missing test harnesses and record the source baseline. Pass all four gates before adaptation commits. Record pending browser/live checks separately and finish them in supported environments.

Deliver `docs/CLOUD_SETUP.md` and `docs/DEVELOPMENT.md` with versions, commands, isolation, safe reset and evidence. Prepare **Save > Publish**, then validate service startup and data isolation in a fresh task. Republish setup changes for new tasks; existing tasks retain their own state. The founder can select the published environment on mobile and reopen the same task across devices. Commit useful progress because task state is not source control. Cloud development does not replace a separate production deployment.

## 16. AI, privacy, configuration, and security

AI jobs: onboarding voice/transcription/speech, proposed-fact extraction, portfolio drafting/regeneration, campaign chat/extraction, brief, explanations, themes and screenshots. Actual Talaqee inheritance is Haiku chat and Sonnet brief generation; other jobs are Infame additions. Earlier influencer plans suggest light models for explanations/themes and stronger structured-output/vision for briefs/screenshots as reviewable defaults. Add a voice adapter, centralize all models/voices/prices and verify actual features; no silent substitution or duplicate IDs.

Require schema-validated structured output, bounded retries, timeouts, size limits, and honest failure states. The structured campaign form remains a usable path if AI is unavailable. Deterministic explanations can replace failed explanation calls, provided they use only observed facts and disclose unknowns.

Every AI call records purpose, model, text/audio usage or duration as billed, estimated dollar cost, and request/onboarding/campaign context. Enforce one atomic per-user/platform budget across voice, imports/extraction, portfolios and background jobs; reserve spend so concurrency cannot bypass caps and reconcile actual use. Limit voice session duration and offer text continuation on exhaustion. The historical $2/user/day is reviewable and needs re-estimation for voice, not a validated business budget.

For campaign matching/explanations, send brief requirements and aggregate audience facts with creator identity fields excluded. Onboarding speech may process the user's consented name/answers, and portfolio generation may use approved public identity/company facts for that specific purpose; do not send unrelated private proof or contacts. Minimize context/captions. Screenshot vision needs consent and real crop/redaction/minimization; image bytes can identify users despite sanitized text. Provide manual review when minimization is unsuitable.

Privacy work includes collection purpose/consent versions, per-field visibility, private proof storage, expiring signed access, token disconnection, deletion/export procedures, retention and purge jobs, and subprocessor documentation. The historical 13-month snapshot idea is provisional pending the approved policy. Obtain current professional review for privacy, agreements, advertising/licence handling, and later payments; this plan does not certify legal compliance.

Security requirements:

- Central validated `env` configuration and a complete safe `.env.example`; secrets stay server-side.
- Production rejects social mocks, fixed/test OTP, console-only delivery, weak secrets, and unsafe seed modes.
- Enabled providers must have valid credentials; deliberately unavailable optional capabilities show an honest disabled/fallback state.
- Independent role/ownership checks in API/domain code in addition to route navigation guards.
- Secure cookies, immediate session revocation, origin/CSRF protection, bounded authentication/AI/upload rates, and request IDs.
- Postgres-backed OTP/rate limits; no Redis dependency in V1.
- Official API allowlists, controlled public-site retrieval with SSRF/DNS/redirect protections, validated uploads, authenticated crons, scoped voice credentials/tool authorization, and safe logs without credentials, private proof or onboarding transcripts.
- Separate local, test/E2E, preview, and production data. Production receives taxonomy/admin provisioning rather than demo fixtures.
- Restricted browser database access; server database credentials still require application authorization checks. RLS is defense in depth, not a replacement for those checks.
- Compatible security headers/CSP, dependency checks, backups, restore and rollback rehearsals.

## 17. Agent planning and execution process

The main agent acts as coordinator, contract owner, and integrator. Specialists execute bounded assignments and reviewers independently verify them. Use available concurrency when paths and dependencies permit.

Before implementation, create:

1. `AGENTS.md`/project conventions for Infame, derived from this plan and current tooling.
2. `docs/DECISIONS.md`, marking confirmed decisions, defaults, unresolved questions, and later overrides.
3. `docs/CONTRACTS.md`: enums, shapes, visibility rules, component signatures, env accessor, matching formula, event vocabulary.
4. `docs/OWNERSHIP.md`: one owner for each shared file/module and declared handoff points.
5. `docs/plans/00-08` and `docs/PROGRESS.md`: dependency-ordered tasks and evidence.

Every implementation task specifies purpose, prerequisites, allowed paths, API/contracts, failing acceptance test, implementation steps, failure states, validation, and reviewer. Split tasks into concrete reviewable outputs; do not hide many screens behind “follow the same pattern.”

Suggested ownership:

| Owner | Responsibility |
|---|---|
| Coordinator/foundation | Dependencies, schema/migrations, auth/signup, brand/env, voice/onboarding contracts and shared shell/orchestrator, primitives/dictionaries, CI/deployment |
| Creator track | Creator onboarding steps, account mapping/collection/review, social adapters/sync, creator portfolio/profile/DTOs/ownership/dictionary |
| Brand track | Company onboarding steps, bounded website review, company portfolio, brand/campaign screens/schema/brief jobs/dictionaries |
| Matching track | All matching types/strategy/tests, shortlist/search UI and routes, explanation/theme jobs, match dictionary |
| Deal track | Shared offer validation, deal state/agreement/events, deal routes/screens, deal dictionary |
| Admin/growth track | Admin routes/screens, verification/import/invite/referral/notification logic, admin dictionary, SEO integration through the declared owner |
| Independent reviewer/verifier | Read-only correctness/security review and reproducible acceptance evidence; implementation edits return to the assigned owner |

The coordinator owns shared signup and mounts both role-specific onboarding flows. This removes the historical creator/brand signup collision. Choose the shared offer-schema owner before matching and deals start; both import it.

Dictionary ownership is per domain, with flat unique keys and Arabic/English parity. One owner composes the modules. Matching weights and vocabularies live once. Agents are explicitly told they share the workspace and must preserve other agents' edits.

Use isolated branches/worktrees when useful, with one writer per shared path. Define intended changes and inspect repository state before edits. Integrate dependency-complete vertical slices so commits retain working imports and a green build.

Implementation loop: write the meaningful failing test → run it → implement → run relevant tests → independent review → fix findings → run the full four gates → commit a coherent task when committing is authorized. Use truthful authorship metadata. Record commands/results and unfinished integrations. After a merge, run the union suite; per-track green is insufficient.

The four required commit gates are:

```bash
npx tsc --noEmit
npx eslint . --max-warnings 0
npx vitest run
npx next build
```

Continue through routine reversible decisions, fixing failures and updating documentation. Ask the founder when a missing product decision materially changes behavior or an external action requires their input. Continue independent work while credentials or provider approvals are pending. Agent work can prepare outreach assets and account checklists; sending messages, making purchases, or submitting registrations requires the founder's explicit scope.

## 18. Build phases and acceptance

The historical eight-week envelope is a dependency sequencing guide, not a delivery estimate for the expanded global/voice scope. Re-estimate after the voice/import prototype. Provider reviews and founder tasks run in parallel and may outlast implementation.

| Phase | Work | Exit evidence |
|---|---|---|
| 00 — Reuse/foundation | Talaqee branch/provenance/reuse audit, inherited Cloud baseline, contracts/owners, missing tests/CI, shadcn inventory, early voice/cards/draft prototype | Source baseline recorded; inherited app starts; isolation proven; research/component map; voice feasibility; four gates for commits |
| 01 — Domain adaptation | Evolve schema/DTO/auth/routes/dictionaries, original-language content, countries/currencies/timezones, audience and licence evidence, safe seeds | Reviewed migration on isolated DB; mappings/visibility/verification tests; working inherited-plus-adapted contracts |
| 02 — UI adaptation | Reuse shells; shadcn tokens/primitives and screen migration, public/auth, shared voice/cards, navigation and PWA | RTL/LTR at 360px; accessibility/mic-denied/text and offline states; no silent theme or contract regression |
| 03 — Creator | Voice/text onboarding, mapped account collection/approval, connections/evidence, profile/rates, generated portfolio/media kit | Both paths produce editable approved draft; source/ownership accurate; partial/resume flows; explicit publication; Arabic PDF |
| 04 — Brand | Company voice/text onboarding, bounded website collection/review, portfolio, verification, campaign form/chat and brief | Website and no-website paths work; approval/visibility safe; both campaign paths reach valid brief; verification gates |
| 05 — Matching | Pure scoring, eligibility, versions, explanations, shortlist/search, save/dismiss and reruns | Exact scoring fixtures pass; zero-padding empty state; unknown/partial data labeled; decisions survive reruns |
| 06 — Deals | Offers/counters/messages, immutable agreement, two confirmations, delivery, paid/received, sealed ratings | Full two-party flow works; state/actor/race tests pass; no money-moving feature; signed terms stay fixed |
| 07 — Operations | Verification/admin, claim/import/referral, notifications, SEO | Admin audit trail; atomic claims; idempotent imports/events; no test/unclaimed profiles indexed |
| 08 — Hardening/beta | Failure/security checks, E2E, live provider evidence, domain/deployment/runbooks, performance, beta onboarding | Release criteria below met; honest unresolved-blocker list; reproducible handover |

Dependency order: foundations → data/contracts → design shells → creator and brand tracks in parallel → matching → deals → admin/growth integration → final verification. Independent leaves can run concurrently; schema/auth/shared contracts are integrated by their owner first. Build security foundations early and broaden verification in phase 08.

## 19. Testing and release acceptance

Test domain behavior, not incidental implementation. Required tests cover onboarding state/consent/tool authorization, account correction and invalidation, collection/source review, safe URL/redirect/DNS handling, untrusted-content extraction, portfolio generation/publication, resume/idempotency, voice budget/failure, matching, provenance/visibility, ownership/auth, tokens/OTP, seeds, campaigns, deal races/confirmations/ratings, uploads/claims/notifications and all AI caps.

Playwright exercises Arabic mobile and English desktop: signup/profile/verification, form/chat brief, matching/reruns, offer/counter/agreement, delivery/rating, admin review, and visibility. Include non-Saudi creator/brand signup, a diaspora creator reaching Saudi audiences, same-currency quotes, mismatched-currency unknowns, amount precision, timezone/date boundaries, international phone verification/fallback, expired licence filters, and non-Saudi licence labels. Mocked OAuth/SMS do not prove live providers work. Required suites cannot silently skip and count as acceptance.

Code-complete evidence: four gates green, relevant dependency/security findings addressed, migrations/seeds safe, role-specific voice/text onboarding and collaboration E2E complete, no bundled secrets/fabricated business metrics, and independent acceptance report. Include section 7.6's shared/different handles, partial imports, mic-denied/text, no-website company, original-language preservation and explicit publication cases.

Operational launch evidence:

- infame.sa domain/HTTPS/canonical redirects and the correct application origin configured.
- Clean production database and separate test data; private evidence storage; scoped access proven.
- Approved credentials/callbacks and live connect, expected supported metrics, sync/reconnect, and disconnect evidence for each enabled provider. Platform-specific pending approvals are disclosed and the screenshot/manual fallback is tested.
- Real email verification/reset/notifications, Saudi phone OTP, and international OTP for each advertised supported country or a tested disclosed reviewed fallback.
- Real dynamic Arabic voice, live transcript and interruption on supported phones, tested permission/network/background/text paths, measured audio cost/latency, source-accurate actual imports and reviewed generated portfolios. A fake voice animation or mocked provider does not satisfy the signature onboarding launch bar.
- Real opt-in push delivery on supported devices if push is enabled.
- Production health, actual cron execution, observed sync failures/reconnect, AI budget logging, monitoring, backup restore, and rollback.
- Published founder-approved terms/privacy, required provider data-deletion handling, and professionally reviewed agreement/required licence handling.
- Lighthouse on the production-shaped environment: performance ≥0.85, accessibility ≥0.95, SEO ≥0.95, LCP ≤3s, CLS ≤0.1, transfer budget ≤900KB.

Final handover includes setup, env key names (never secrets), architecture map, user journeys, decision ledger, tests/results, known gaps, provider evidence, deploy/rollback instructions, and the next prioritized backlog.

## 20. Founder track, beta, and success metrics

Start external setup at kickoff: domain and social-handle verification; exact CR/trade identity and name diligence; provider applications/reviews; separate Supabase/Vercel projects; email-domain authentication; SMS sender/provider approval; VAPID keys; storage/privacy policy; agreement review; founder seed list; creator/agency outreach preparation; merchant recruitment.

Track actual status, date, owner, request/reference ID, and evidence. A completed checklist item needs a real outcome. Use new Infame callbacks and email branding throughout.

Initial private beta: **30–50 creators and five brands**, founder-led, with Saudi demand and relevant Arab creator cohorts recruited wherever they live. Global signup remains available while acquisition/support deepen one market at a time. A ten-minute onboarding should reach signup, connection/evidence, profile, rates, portfolio/licence, public profile/media kit, and sharing. Service verification daily and segment conversion/deal metrics by campaign market.

Suggested beta exit, carried from the original runbook: in the same week, 50 connected or screenshot-verified creators, five approved briefs, ten offers, three completed mutually rated deals, and zero P1 incidents. Validate matching through observed shortlist/offer/acceptance behavior, not average match score alone.

Original growth aspirations: by day 90, 300 OAuth-verified creators and 30 brand briefs; by month six, 1,000 creators and 150 briefs. These are targets, not existing traction. Founder personally onboards the first 100 and develops agency/referral/invite channels.

Track creator signup→publish, connection/evidence success, profile/rate completeness, brand signup→approved brief, time to brief/shortlist, empty shortlist rate, save/offer rate, creator response/counter/acceptance, completed collaborations, repeat brands, referral acquisition, verification queue age, support incidents, and AI cost per approved brief/completed deal.

Tune weights after at least 20 observations and two weeks of stable signal; document the dataset and tradeoffs. Initial guardrail: change each weight by at most ±0.05, renormalize, rerun fixture benchmarks, and version the strategy.

Budget planning should model hosting/database/storage, AI tokens, SMS, email, operations, and founder time separately. The old competitor prices, market sizes, provider fees, forecasts, and rules are dated research; obtain current evidence before budgeting or making investor claims.

## 21. Later roadmap and unresolved commercial model

**V2, after proven beta demand:** Saudi-provider marketplace payments and settlement, defined review/dispute workflow, appropriate verification/KYC, invoicing/tax requirements reviewed for the actual entity, WhatsApp notifications, pre-publication content approval, creator UTM/promo tracking, Salla/Zid order ingestion, improved Snapchat data access, and useful Arabic acquisition pages.

The original payment direction was a fee inside the negotiated gross budget, provider-held funds, and a proposed 72-hour delivery-review window. Its pricing study proposed 12% self-serve, 25% concierge, initially 0% creator commission, and a SAR5,000 campaign floor. Those figures were explicitly undecided. Validate with ten brand pricing interviews and creator feedback; do not advertise or implement them in V1.

When payments arrive, provider webhooks replace user-reported paid/received marks, signatures/idempotency become mandatory, and the accepted offer remains the amount of record. Do not treat V1 timestamps as a financial ledger.

**V3:** deeper country-specific commercial operations, local payment/verification/contract support after review, agency workspaces/white-label, reporting, opt-in dialect/content-fit assistance, creator bundles, discovery API, and native apps when justified. Worldwide onboarding/discovery and country/currency contracts already belong to V1; local operational maturity is a separate roadmap.

## 22. Rebuild risks and explicit corrections

| Risk learned from the earlier work | Required correction |
|---|---|
| Different agents invent incompatible shapes | Freeze contracts, vocabulary, event types, owners, and dependency order before parallel work |
| Green per-track tests fail after integration | Run the complete merged suite and all four gates |
| Good-looking demo has fake rankings or numbers | Real matcher generates fixture scores; show genuine metrics or omit them |
| OAuth identity falsely verifies manual data | Attach provenance to every independently supplied metric/bucket |
| Old screenshots become fresh at upload time | Validate original evidence date; store it separately |
| Missing metrics produce confident explanations | Retain unknown facts and ground every fallback sentence |
| Profile and matcher show inconsistent audience math | Share canonical aggregation and label the selected account subset |
| Partial rate basket is treated as total price | Display quote coverage and allocate creator-specific deliverables |
| Summed exposures are advertised as unique reach/results | Label estimated impressions and limitations |
| Availability/country/language fields are collected but ignored | Enforce declared eligibility and use relevant requirements explicitly |
| Concurrent AI calls bypass budget checks | Atomically reserve/enforce budgets across every model job |
| Two agreement confirmations race | Unique version-bound records plus transactional transitions |
| Configured app silently lacks email/OAuth/storage/push | Capability-aware boot validation and honest unavailable states |
| Tests or seeds contaminate live SEO/data | Separate environments and whitelist published profiles for indexing |
| Screenshots leak identity to a model despite text sanitization | Implement consent/minimization and a manual-review alternative |
| Stale handover describes old pass results as current | Record dated commands and live evidence for Infame itself |

## 23. Source provenance

These sources substantiate requirements. The founder's latest directions include worldwide/Saudi specialization, voice onboarding, shadcn Studio/Figma and adaptation of the actual Talaqee repository. They override Saudi-only and blank-project reconstruction assumptions. Infame supersedes historical names; Mashhoor sources inform influencer-specific behavior, while Talaqee supplies the actual starting code. Keep that distinction in the reuse inventory.

- `docs/spec/vision.md`, identical to `C:/Users/Asus/Claude_Code/Talaaqe/Docs/Mashhoor Vision 2026-09-03.md`: original brainstorm, decision ledger, product, art direction, business-model proposals, roadmap.
- `CLAUDE.md`: conventions, terminology, configuration, dictionary and shared-contract rules.
- `docs/HANDOVER.md`: architecture map, flows, invariants, implementation lessons, launch dependencies.
- `docs/spec/plans/00-08` and `REVIEW.md`: task breakdown, dependencies, ownership and documented overrides.
- Earlier Mashhoor `src/lib/matching/strategy.ts`, `subscores.ts`, `benchmarks.ts`, `filters.ts`: influencer matching reference defaults, not implemented Talaqee scoring.
- `prisma/schema.prisma`, `src/lib/deals/state.ts`, `src/lib/creator-options.ts`: entity/lifecycle/vocabulary evidence.
- `docs/v1-final-gate.md`, `docs/runbooks/beta.md`, `docs/runbooks/launch-checklist.md`, `docs/v2-handoff.md`: historical evidence, beta/release criteria, deliberate financial deferrals.
- `C:/Users/Asus/Claude_Code/Talaaqe/talaqi/README.md` and `specs/agent-contract.md`: original app and agent system, with superseded practices identified above.

The old freeze disagreement came from inspecting different directories. The actual nested repository and demo tag are now identified in section 4.1. Keep that source revision/provenance intact while implementing the Infame conversion branch. A tag's existence does not certify production readiness.
