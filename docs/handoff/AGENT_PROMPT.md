# Ready-to-paste Talaqee adaptation prompt — Infame / إنفيم

Copy this prompt into the agent and attach `REBUILD_PLAN.md`. Give it access to the existing Talaqee repository and an isolated Infame conversion branch/checkout. The specification also works independently, but code adaptation requires the actual repository.

---

You are the lead product engineer and multi-agent coordinator adapting the **existing Talaqee application into Infame / إنفيم**, a Saudi-founded platform for Arab creators and brands reaching Arab audiences worldwide. Reuse the working application infrastructure to deliver the specified MVP efficiently.

The founder has already brainstormed this product and selected its name. The canonical domain is **infame.sa**. The preferred social username is **@infame.sa**, subject to platform availability. The exact legal CR registration/status must be verified separately. Use **إنفيم** exactly as written. Put the identity in one typed brand configuration; a proposed support address is `hello@infame.sa` pending setup. Use distinct app identities such as `infame_session`, `infame_lang`, package `infame`, and a separate Infame database.

Your assignment is a complete usable Infame V1 through repository adaptation, implementation, independent review, testing and handover. The former blank-project rebuild direction is superseded. Continue through routine decisions/fixes. Work in an isolated Infame branch/clone/worktree based on Talaqee, preserving the original main/tag/checkout and existing user work. Keep inherited code/history and extend or replace modules according to a documented reuse inventory. Do not start with a new Next scaffold or rewrite working foundations without a concrete reason.

Generate new Infame secrets and separate databases. Inspect inherited schema/migrations/runner/seed scripts; preserve migration history and evolve it intentionally unless a documented clean baseline for an empty isolated Infame database is justified. Never copy `.env` credentials, run destructive demo seeds blindly, or use shared/source production data.

Read **REBUILD_PLAN.md** if attached. The founder wants **Talaqee's existing code, app system and agent planning/execution system** adapted to this product. Current instructions override old names, inline-style contracts, fresh-extraction scripts and dated status claims. All specified Infame journeys still need acceptance evidence; reuse is not an exemption from correctness/security work.

Verified source at planning time: `C:/Users/Asus/Claude_Code/Talaaqe/talaqi`, remote `https://github.com/sultan0alshami/talaaqe.git`; `main` and `v1.0-demo` at `b001002526c7952da97268c75dbeb9ae21414d9b`. Recheck live access/revision. In Cloud, use the remote source rather than assuming Windows paths exist. Prefer an isolated branch such as `infame/mvp`; inspect an existing branch before using it and never overwrite its work. A separate Infame destination repository can receive this inherited code/history if already selected. Record source/revision and conversion decisions in `docs/REUSE_INVENTORY.md`.

## First task: prepare the new Codex Cloud development environment

Use **new Codex Cloud** for the Talaqee-to-Infame adaptation. Prepare a reusable environment from the inherited repository and lockfile before product changes. Cloud development and production deployment are separate.

On web/desktop, use **Work in > Cloud > Select environment > Create environment**, select the repository containing the inherited Talaqee code and begin setup. Use the Infame conversion branch as the coding task's base, leaving Talaqee main intact. Keep access private initially. If GitHub connection/repository selection requires the founder, give exact steps and continue independent preparation without claiming setup complete. Inspect existing configuration before changes.

Inspect repository instructions, manifests, lockfiles, runtime declarations and installed APIs before selecting versions or commands. Do not assume reference Windows paths, local processes, credentials or personal skills exist in Cloud. Keep reusable project instructions and appropriate skills in the repository.

If the selected destination is empty, populate it from the verified Talaqee source/history rather than scaffolding a replacement app. If setup needs source/manifest/lockfile changes, make them in the isolated coding branch and return to setup. Record the revision used for validation. If source access is missing, report that dependency and prepare contracts/design meanwhile.

Prepare and test:

1. **Development tools:** use inherited runtime/package-manager declarations and locked compatible dependencies. Reproduce available baseline checks; add required Vitest/Playwright tooling because the audited source lacks it. Upgrade only for a documented compatibility/security requirement. Identify checks needing desktop/another environment.
2. **Disposable PostgreSQL:** inspect the inherited embedded-Postgres runner first; adapt it to distinct Infame names/data directories/ports/task targets and verify Cloud support. It must not connect to the source's persistent `talaqi` on port `5544`. Alternatively use a supported task-local PostgreSQL service. Do not assume Docker/systemd/packages; prove connectivity and isolation.
3. **Isolation:** create fresh Infame development and separate test/E2E targets with development-only credentials. Never connect setup, tests or seeds to reference/shared production/customer databases. Use synthetic data, not real users, private screenshots or production backups. New parallel tasks must not share a mutable test database.
4. **Fallback:** if task-local PostgreSQL cannot run, record the actual limitation and prepare a separately provisioned disposable-development-database option. Verify the connection path; an HTTPS hostname allowlist or VPN setting does not prove native PostgreSQL connectivity. Do not purchase a paid service without authorization. Continue independent code work while an external dependency is pending.
5. **Configuration:** maintain a safe complete `.env.example` with key names and nonsecret placeholders. Supply real runtime values through Cloud environment configuration or the account's Personal vault. Generated local configuration files must be Git-ignored. Never print credentials or include them in committed files, setup reports or reusable instructions.
6. **Secret types:** use environment variables for values read directly by processes, including database URLs. Network secrets provide proxy placeholders for credentials sent to approved HTTPS services; they are not raw credentials for local database clients. New Cloud secret handling must not inherit Legacy Cloud's setup-only behavior.
7. **Networking:** start with the Package managers preset and add exact official download/documentation/development-service hosts only as required. Verify destination access separately from authentication. Keep production integration credentials out of the development environment.
8. **Integrations:** where live development credentials are absent, supply labeled development-only email/SMS/social/storage/AI fixtures or adapters and honest unavailable states. Production must reject these modes. Mocked checks never count as live provider evidence.

Record tested reusable setup in Cloud's **Install script** and **Start skill**:

- The install script installs locked dependencies and prepares development assets.
- The start skill starts required services, checks readiness, validates configuration, and reconciles the current checkout before development/tests. Running services must be restarted in each new task rather than assumed to survive publication.
- Generate Prisma's client and apply the reviewed inherited-plus-Infame migration strategy only to the isolated targets. Replace destructive demo seeds with a small idempotent synthetic seed.
- Never silently reset data on task resume. A reset command must verify a known disposable database identifier and environment, refusing production or ambiguous targets. Keep development and test/E2E targets separate.
- Make setup repeatable without overwriting existing task work. Record how database state persists within a task and how a new task receives an isolated target.

Before declaring readiness, prove connectivity/isolation, migrations, repeatable seeding, inherited app startup and available baseline checks. Record missing/failing source checks honestly and add the required test harness. Pass all four gates before adaptation commits; run supported browser checks and record pending desktop verification.

Deliver `docs/CLOUD_SETUP.md` and `docs/DEVELOPMENT.md`: exact tested versions/commands, service startup/readiness, isolation design, configuration key names without values, safe reset instructions, checks/results, current repo revision and unresolved dependencies.

Prepare the reusable environment for review and explain **Save > Publish**. After publication, validate startup and isolation in a fresh task. Edit and republish changed setup, then validate another new task; existing tasks retain their own state.

For phone management, explain that the founder first creates/publishes the environment on web or desktop, then opens Codex on mobile and selects the available environment. Reopen the same task to continue across devices; new tasks start separate work. Save important progress in source control because task state does not replace Git. Cloud tasks run remotely without depending on the founder's PC staying awake.

Use the current official [Codex Cloud environment documentation](https://learn.chatgpt.com/docs/environments/cloud-environments) to verify UI names and supported capabilities during setup. Report exactly what was prepared, published and tested; separate development readiness from live-provider and production-launch readiness.

## The product

Infame helps brands worldwide find Arab creators whose audiences fit a campaign and manage the collaboration. Creator residence, audience location, brand location, and campaign market are separate facts. Saudi residence/citizenship is not a global signup requirement. The journey is:

**Describe campaign → editable structured brief → brand approval → deterministic explained shortlist → offer/counter and messaging → Arabic agreement confirmed by both → delivery → mutual ratings.**

Creators get a public profile, connected-account metrics, transparent rate cards, a portfolio, a media kit, and a collaboration inbox. Brands get campaign planning, understandable matching, creator discovery, and a deal room. Admins review evidence, manage trust/taxonomy/users, and monitor real activity.

V1 is **globally available to Arab creators and brands reaching Arab audiences, free, Arabic-first RTL with an instant English interface toggle, mobile-first responsive web and installable PWA**. Saudi Arabia receives a deeper local experience, including reviewed **موثوق** licence badges. User bios, briefs, offers, and messages are stored once in their original language. Use broadly understandable Arabic for shared flows and Saudi Arabic for Saudi-market copy. Initial acquisition/support focus on Saudi demand and relevant creator cohorts worldwide; global signup alone is not a success metric.

**No money moves through Infame in V1.** Payment happens directly between the parties. “Paid” and “received” are role-gated self-reported timestamps. Payments, custody, escrow, fees, wallets, invoices, automated tax/e-invoicing, WhatsApp Business integration, native apps, automatic FX and deeper country-specific commercial operations remain later phases. Global onboarding/discovery and explicit country/currency/timezone contracts belong to V1.

## Reuse the Talaqee system

Retain its architecture/code: public/role dashboards, thin server pages, JSON DTO serialization, shared shells, reviewed auth/API/ownership helpers, Arabic/English toggle, real Anthropic interview/briefing and activity patterns. Add Infame's visibility enforcement to DTO/API contracts; serialization alone does not enforce it. Use bounded assignments/ownership/review/gates and classify modules as reuse/adapt/replace/add/retire before rewriting.

Adapt client→brand, provider→creator, project→campaign, proposal→offer/deal deliberately across schema/DTO/auth/routes/screens. Source matching uses developer skills/experience and a padded fallback: replace its scoring with the influencer contract below. Source proposal send has no real terms: implement offers/counters/agreements, not a label change. Replace paired Arabic/English business content with original-language storage. Add missing recovery/email/phone verification and stronger auth acceptance; the source accepts six-character passwords. Evolve inherited screens/primitives toward shadcn, tokens and responsive UI. Remove demo fallbacks/credentials/destructive seeds and obsolete developer language in the Infame branch. Ignore the old untracked `scripts/check-fork.sh` fresh-commit/no-migration rule; it is not acceptance for this adaptation.

## shadcn Studio access, Figma and interface research

The founder confirms **full access to https://shadcnstudio.com/** through the existing email-connected account, including its resources usable in the connected **Figma** workspace. Use that existing access and approved component/design assets to build Infame's interface. Public shadcn/ui documentation remains the underlying implementation reference. Do not assume that the Studio account is already authenticated inside a new Cloud task; check available connections and continue public research/code work while resolving any actual access dependency.

**Study the full accessible shadcn Studio website/catalog and official shadcn/ui catalog before selecting the UI.** Use documentation/sitemap/registry indexes first, enumerate components, blocks, templates, variants, themes, examples and Figma resources, then fetch/cache relevant pages in bounded batches. Read all component/block overviews and complete API/examples/source for selected items. Track indexed versus actually read pages and unavailable resources; do not claim a complete scrape when coverage is incomplete. Inventory account-accessible Studio resources as well as public ones. Research informs composition; do not install every component or duplicate the site into the repository.

Start with `https://shadcnstudio.com/llms.txt`, `/components`, `/blocks`, `/pages`, `/templates`, `/figma`, Studio docs and authenticated assets, plus `https://ui.shadcn.com/llms.txt` and public components/CLI/RTL/theming docs. Verify CLI `--help`; candidate discovery is `info`, paginated `search @shadcn --limit 100 --offset 0`, `view`, `docs`, and `add <component> --dry-run` through the inherited package manager. Studio namespaces include `@shadcn-studio` and `@ss-components/@ss-blocks/@ss-pages/@ss-illustrations/@ss-themes`; verify current registry configuration. Premium auth uses registered email/licence key through environment interpolation. Follow https://shadcnstudio.com/docs/getting-started/how-to-use-shadcn-cli without committing credential values. Studio MCP support in Codex Cloud is unproven; authenticated registry/CLI and connected Figma remain fallbacks.

Deliver `docs/SHADCN_RESEARCH.md` with sources/date, complete inventory/coverage, available account assets, primitive variants/dependencies/licences and selected/rejected choices. Deliver `docs/UI_COMPOSITION.md` mapping every Infame screen and state to components, responsive layout, tokens, RTL/LTR behavior, accessibility and acceptance evidence.

**Use Figma for concrete handoff:** inspect Studio kits/variables/variants/slots and compose onboarding/cards/account/fact review, portfolios, discovery, campaigns and deals. Build Arabic mobile-first frames plus English/desktop/loading/error/empty/permission/resume states. Map Infame palette/fonts/tokens to Figma variables and inherited code. Prototype journeys; record file/frame/component links, interactions and implementation paths. Follow Studio's design-to-code/plugin docs and available Figma skills before mutations. CLI lookup applies to original blocks; customized frames need actual design context and reviewed code adaptation. Do not replace Talaqee with a full Studio starter template. If Cloud lacks Figma tools, use the connected companion and attach its handoff.

Talaqee currently has handwritten primitives and no `components.json`/shadcn dependencies. Add/configure shadcn incrementally after reviewing aliases/globals/fonts/lockfile; choose a compatible primitive family centrally and verify Studio block compatibility. Preserve useful legacy contracts with adapters while migrating callers. Preview CLI changes, install selected components only, and avoid blind force-overwrites, wholesale theme resets or `add --all`.

Evaluate Drawer/inline Card/Dialog for input cards; Field/Input/Input Group/Textarea for inputs; Checkbox/Radio Group for platforms/shared handles; Message Scroller or compatible transcript patterns for conversation; Card/Badge/Accordion/Alert for sourced fact review; Avatar/Aspect Ratio/Tabs for portfolios; Combobox/Select/Sheet/Pagination for discovery; date/field controls and confirmation dialogs for offers; Sidebar/Data Table/Dropdown Menu for admin; Skeleton/Spinner/Empty/Alert for non-happy states. Choose from actually documented compatible variants, not names alone. Custom real voice visualization and orchestration remain Infame responsibilities.

Preserve Infame palette, IBM Plex Arabic/Latin and light/dark modes through tokens. Studio explicitly lacks official RTL support, and migration alone is insufficient: manually adapt/test its selected blocks. Verify RTL/LTR, portals/arrows/focus, screen readers, touch/reduced motion, long handles, keyboards/safe area and voice/text/mic-denied/partial/resume states. Respect actual asset licence and review exported code; access/Figma frames do not replace tested journeys.

## Signature first-login onboarding and customer journeys

Build this as a core V1 experience for **both influencers and company representatives**. On first login, an original Infame live-voice surface presents a warm professional **female Arabic AI guide**, a live transcript, progress/step label, and contextual input cards at the bottom above the mobile keyboard/safe area. The guide briefly explains Infame and helps the user finish with an approved, editable portfolio. Use conversational interaction patterns without copying Gemini/ChatGPT branding.

Offer **ابدأ بالصوت** and **كمل بالكتابة**. Start audio after interaction; request microphone permission only for speaking. Listening plus typed replies works without microphone access. Show actual listening/processing/speaking/paused/reconnecting/error states, with mute, interrupt/stop, replay, back/edit, exit/resume, text mode and instant English toggle. Preserve existing answers/transcripts in their original language. Voice and text use the same data, imports, validation and portfolio outcome.

Suggested Saudi welcome: **ياهلا فيك في إنفيم! أنا مساعدتك الذكية. بساعدك تجهّز ملفك، وتراجع معلوماتك، وتتعرف على فرص التعاون. نبدأ باسمك؟** Adapt shared wording to the chosen market. Keep the welcome brief and skippable.

**Influencer journey, in this order:**

1. Ask the display name in a bottom input card; do not assume a legal name.
2. Ask the primary social username; accept a normalized handle or supported profile URL. This is separate from the Infame profile handle.
3. Show Instagram/TikTok/YouTube/Snapchat/X checkboxes and ask whether all selected platforms use the same username.
4. If yes, prefill each platform; if no, show per-platform username fields. Every row stays editable. A shared handle is not proof of account existence/ownership.
5. Show candidate avatar/name/handle/source link where available; ask **هذا حسابي** or allow correction. Explain which public fields can be collected and which analytics need an authorized account connection. Obtain scoped import consent.
6. Run per-platform collection jobs with real progress and independent outcomes. Offer permitted public/API imports, OAuth where required, and screenshot/manual alternatives. Partial failure preserves successes.
7. Present source-linked dated fact/metric cards for approval, correction or exclusion, with unknowns visible. User approval does not create a verification badge; unsupported metric edits remain self-reported.
8. Ask only for missing location/timezone, language/dialect, niche, availability/travel, quoting currency, and optional rates/work/licence evidence. Introduce موثوق when relevant without making it a worldwide signup gate.
9. Propose/edit/reserve a unique Infame handle, handle conflicts/reserved names and show `/@handle`. Generate editable bio, sections, platform summaries, categories and selected work with profile/media-kit previews. If AI fails or budget is exhausted, offer a fact-based editable template without another model call. Do not invent collaborations, customers, rates, awards, licences, demographics or results.
10. Allow individual section edits/regeneration, explain public visibility, and offer **انشر ملفي** or **احفظ كمسودة**. Apply readiness rules and require explicit publication. Finish with the shareable profile and one useful next action.

**Company journey:** welcome → company/contact name and representative role → website URL card with **ما عندنا موقع حالياً** → social-platform/shared-or-per-platform handles → account/source confirmation and collection consent → bounded website/account collection → fact approval → missing country/timezone/contact/verification/target markets/currency → editable company portfolio → preview/private save or explicit eligible publication → **ابدأ أول حملة**. A website is optional. Generate approved overview/products/services/assets/links and genuine examples; never invent clients/logos/testimonials/certifications/results. Supply a deterministic manual-editable template if generation fails. Public company portfolios require verified email plus accepted representative proof (company-owned-domain contact, authorized company account, or documented review), separately from business-registration badges. A supplied URL/generic mailbox alone is insufficient. Reserve a unique share slug, keep contacts/proof private, and allow profile saving without a campaign. Offer eligibility remains enforced.

**Acquisition contract:** automatic collection replaces the older blanket no-collection rule with a capability/access matrix checked against current official provider docs. Use official or documented permitted public-data adapters; no access-control bypass, password/session-cookie capture, or unsupported universal scraper. TikTok Display profile import requires creator OAuth; YouTube can resolve public handles but owner analytics need authorization and retain viewer/follower definitions; Snapchat API depends on allowlisting; X lookup needs actual app access; Instagram's exact current eligibility/scopes/fields remain an implementation verification gate. Do not claim a username reveals every platform's demographics or detailed performance.

Keep discovery, user confirmation, ownership proof and per-field evidence separate. Store stable provider IDs alongside handles; retain source/method/dates/units/window/confidence/review/visibility. Preserve immutable observed values/evidence separately from corrections. Metric classes are official API `1`, verified screenshot `.7`, self-reported `.4`, permitted non-API public import `.4` as a reviewable default. Approval never promotes source status. AI text/categories remain draft until accepted; work samples require selection/approval. Creator publication requires verified email, consent, a reserved Infame handle, essential fields, and primary-account ownership proved via accepted connection or reviewed challenge. Additional unproved imported accounts stay private/pending. **هذا حسابي** alone cannot publish another person's claimed account. Private generation remains available before proof.

Website collection stays within the confirmed public HTTPS domain on port 443 and a small page/depth/size/time budget; reject other schemes/ports unless narrowly reviewed. Validate actual destination addresses and redirects; block local/private/reserved/link-local/metadata addresses and embedded credentials. Prevent DNS rebinding; guard imported images/logos too. Respect access/crawl requirements. No arbitrary authenticated fetching. Downloaded content is untrusted data, never instructions. Validate extraction and show sources before portfolio use.

**Implementation contract:** one server-authoritative state machine/draft, validated allowlisted tools, per-source jobs, proposed facts/review and generated versions. Voice/cards/forms share commands/DTOs. Back/edit invalidates dependent facts/sections; bind jobs to source identity and mapping/draft revision, rejecting stale completions rather than attaching old metrics to a corrected handle. Use operation keys/checkpoints, result reuse and supported provider idempotency. Reload must not replay completed calls. Bound/reconcile uncertain billed retries; do not guarantee exactly-once external billing. Save before interruptions; one provider failure cannot block manual completion.

Use a provider-neutral voice adapter and test Arabic/female voice quality. Browser WebRTC with short-lived server-issued credentials is one candidate; keys stay server-only and supported APIs must be verified. Preserve Anthropic's existing roles unless a documented decision changes them. Meter audio/import/generation within atomic caps; enforce trusted session/usage limits and termination, not only browser timers or expiring credentials. Use bounded server-controlled speech calls if reliable realtime spending controls are unavailable. No raw audio by default; retain minimal consented transcript/answers under policy. Permission/service/network/budget failure allows text and fact-based/manual portfolio completion. Campaign chat's five-question cap does not apply to onboarding.

**UX/verification:** accurate live transcript; confirm handles/URLs/amounts/licence/publication through accessible on-screen controls; cards at 360px, complete captions/text, labels/focus/keyboard, concise screen-reader announcements, reduced motion and LTR islands. Backgrounding pauses audio; resume preserves progress. Verify shared/different handles, wrong accounts, partial imports, denied mic, unknown analytics, no-website company, language toggle, edit/reapproval, ownership/visibility, generation failure/manual completion, safe URLs/untrusted content, expired sessions and resumed OAuth. Test real Arabic voice on supported phones, not a fake connection animation. Use formative usability checks and measured completion/corrections/control before claiming superior UX.

## Required product modules

1. **Identity and account system:** creator/brand signup, login/logout, email verification, password reset, E.164 phones, country-aware brand verification, settings, immediate session revocation on suspension/reset, controlled admin provisioning. Require email verification plus supported-country OTP or a documented reviewed fallback before offers; keep the reviewed Saudi-market verification policy. Never require a Saudi number from every global account. Hash passwords and bound authentication attempts.
2. **Creator onboarding/profile:** name/handle/avatar/bio, country/city/timezone, languages/dialect, niches, fame industry, content style, availability/travel willingness, preferred quoting currency, currency-qualified minimums, social links, audience demographics, metrics, rate cards, portfolio, optional jurisdiction-scoped advertising licences, ratings. Arab and diaspora creators self-declare language/dialect; never infer ethnicity/nationality from photos/names. Include emerging creators as well as famous personalities.
3. **Connections/evidence:** capability-aware permitted public/API collection and account connections as above; Snapchat screenshot/manual fallback where needed; optional configured X lookup and manual/screenshot support. Source/evidence dates accompany every field. Private screenshot upload, optional AI extraction, creator correction, admin acceptance/rejection; extraction never equals verification.
4. **Generated assets:** voice-guided approved creator/company portfolio drafts, section editing/regeneration and explicit visibility/publication; shareable creator `/@handle`, Arabic PDF media kit, optional company portfolio URL/export, referral links and source-accurate badges. Assets use the same visibility-aware approved data. Unclaimed seeds are brand/admin-only; hidden/test/private assets are excluded from public indexing. Audience detail/contact/proof require permission.
5. **Brand/campaign:** company/contact/country profile, optional jurisdiction-specific reviewed business-registration badge, campaign dashboard, equally prominent form/chat, paragraph extraction, full editing, brief approval/versioning. Inputs: product/service, goal, campaign markets, target ages/genders/countries/country-qualified cities, content languages/dialects, niches, platforms, deliverables, budget/currency, desired creator count, optional impressions target, dates/timezone, physical presence/travel, tone/no-go topics, optional tier/data-verification/jurisdiction-specific licence preferences. Adapt seasons and chat copy to the selected market; never guess country/currency from UI language.
6. **Matching/discovery:** the deterministic contract below, grouped shortlist, audience breakdown separately from creator residence, market-appropriate Arabic explanations, freshness, reviewed licence filters, currency-qualified quote coverage and estimated impressions, save/dismiss/rerun, search, honest empty state. Decisions survive reruns. A creator outside the campaign market remains eligible unless physical presence or a reviewed applicable rule requires otherwise.
7. **Deals:** supported creator-specific basket, amount/currency/dates/timezone/usage rights, full messaging/history, atomic counter supersession, recipient-only accept/decline, immutable agreement from accepted terms with Arabic default and English option, unique version-bound confirmations, creator delivery, brand completion, payment declarations, sealed ratings. Snapshot countries, campaign markets, reviewed licence details and explicitly agreed market-reviewed governing terms; do not apply a Saudi-law template to every global deal. Reveal ratings after both submit or seven days after the first submission. Enforce actor/state transitions transactionally. Allow match-based and labeled direct/invited offers. Unclaimed seeds receive pending invitation terms; active deals require authenticated ownership and confirmed eligibility/availability. Maintain one active deal per campaign/creator and preserve terminal history.
8. **Admin/growth:** genuine dashboard counts, users/suspension, creator moderation, screenshot/Mawthooq/CR queues, expiry tracking, bilingual niche tree, safe idempotent CSV import with preview/errors, secure ownership-proven profile claims, invites/referrals, audit history. In-app/email/opt-in push notifications with idempotency and observable retries. Notification failure must not undo the deal action.
9. **Public/PWA/SEO:** landing/about/for-brands/for-creators/free-pricing/auth/profile/invite/privacy/terms and required data-deletion surfaces, role navigation, offline/install/push, metadata/canonical/sitemap. Do not cache private responses in shared offline caches. All nav targets exist; no fake traction claims.
10. **Saudi موثوق experience:** separate advertising-licence evidence from account/identity/API/business verification. Store jurisdiction, issuer, type/number, holder/account scope, status, expiry where applicable, private evidence, review method/reviewer/date. A typed number earns no badge. Manually review using regulator verification/accepted evidence without assuming an API or scraping. Let brands running Saudi-market campaigns filter current reviewed badges, inspect scope/date, and reuse validated details in agreements. Track expiry/revocation/recheck and reminders with audit events. موثوق is not a universal signup gate; applicable Saudi campaign eligibility depends on current reviewed rules and actual parties/activity/scope, not residence/nationality alone. Brand preferences and mandatory rules remain distinct. Infame does not issue licences or imply regulator endorsement; other countries retain their own licence labels.

## Frozen shared contracts

Roles: `CREATOR | BRAND | ADMIN`. Platforms: Instagram, TikTok, YouTube, Snapchat, X. One curated bilingual niche taxonomy, ISO country/currency vocabularies, country-qualified city keys (such as `SA:riyadh`, `EG:cairo`), one handle normalizer/reserved-name policy, and one platform-valid format list. Keep the 24-city Saudi list as the first curated region; allow country-only location and an optional display-only city label elsewhere. Uncurated labels cannot masquerade as matchable audience-city data. Include Saudi/Gulf, Egyptian, Levantine, Iraqi, Maghrebi, Sudanese and formal Arabic dialect options plus other self-declared languages.

```text
Deliverable: { platform, format, count }
Chat message: { role, text, ts: number, chips?: string[] }
Brief KPI: { name, target }
City: { key, countryCode, ar, en }
Money: { amountMinor: string, currencyCode: string }
```

Choose exact types once in the contract phase. Canonical audience age buckets: 13–17, 18–24, 25–34, 35–44, 45–54, 55–64, 65+. These are aggregate audience buckets; record creator registration age eligibility separately. Fame vocabulary: sports, acting, music, media, business, religion, academia, gaming, cooking, fashion, travel, social-only. Map related niches once using stable slugs.

Use unique constraints and transactions for accounts/rates/matches/deals/offers/ratings/claims/confirmations. Rates are unique by creator/platform/format/currency. Use exact minor-unit storage/DTOs, ISO precision and deterministic allocation rounding, never floating-point money. Each campaign/deal/counter/agreement uses one currency. SAR is the Saudi-market default, not a worldwide restriction. Compare matching-currency amounts only; mismatched prices/minimums remain unknown until quoted in campaign currency. Do not silently convert or claim settlement. Store UTC timestamps and display explicit user/campaign timezones. Derived totals remain derived; followers/impressions are not unique audience.

## Matching contract

Weights: age overlap `.25`, niche/fame fit `.20`, audience geography `.15`, gender `.10`, engagement `.10`, rate-versus-budget `.10`, estimated exposure-versus-goal `.10`. Pure subscores are `0..1`; retain unavailable values as unknown, with one declared initial neutral `.5` substitution for scoring. Never turn unknowns into claims of fit.

Baseline raw evidence confidence: official API `1`, admin-verified screenshot `.7`, self-reported `.4`, permitted non-API public import `.4` as a reviewable default. Keep evidence independent of ownership/draft approval. Use the weakest applicable source among eligible inputs. The earlier influencer-plan working default, to implement in the adapted matcher, is:

```text
finalScore = round(100 * weightedFit * (0.5 + 0.5 * rawConfidence))
```

Display raw confidence separately. This is the documented confidence-floor revision, not raw score×confidence. Record it as a reviewable beta decision. Threshold **60**, maximum **12**, stable tie-break, **never pad**.

Hard eligibility checks include hidden/suspended/ineligible creators, availability, requested supported platforms, usable evidence no older than 90 days, mandatory reviewed campaign-market licence/eligibility rules plus optional tier/data-verification/licence preferences, declared content language/dialect, physical presence/travel and defined safety/no-go rules. Score only eligible relevant accounts. A creator may cover a campaign subset, which must be explicit in quotes/offers. Do not treat creator residence as audience location.

Use consistent audience aggregation and clear missing data. Rates come from creator-owned rate cards. Separate advisory fair range, partial quote, full supported basket, and campaign allocation. Label exposure estimates as estimated impressions rather than guaranteed people/sales. Reasons must be grounded in observed facts and cannot infer joint demographic percentages from separate distributions.

Baseline math: demographics `0..100`; age histogram intersection against equal target-bin shares; niche `(exactHits + .5*relatedHits) / unionSize`; engagement follower-weighted `clamp(rate/(2*platformBaseline))`; complete matching-currency basket/minimum budget fit `1` inside allocation then linear decay to zero at `1.5*allocation`; exposure `clamp(estimatedImpressions/perCreatorImpressionsTarget)`. Let the brand choose 1–12 planned creators, initially 1 and editable. Allocate exact minor units and an explicit impressions target across that count. Without a target or reviewed market/currency-specific benchmark, exposure fit is unknown. Retire the historical SAR5,000 creator-count heuristic globally; historical impressions-per-SAR assumptions can only be labeled Saudi/SAR hypotheses. Incomplete/mismatched pricing remains partial/unknown, never an extrapolated quote. Use one aggregation and benchmark module.

Deal state permissions: offered/countered permits counter, recipient acceptance or decline; accepted permits unique agreement confirmations; after both it becomes agreed; agreed permits creator delivery; delivered permits brand completion. Cancellation is permitted from offered/countered/accepted/agreed under the declared policy. Declined/cancelled/completed are terminal for negotiation and delivery; payment declarations/ratings follow their separate eligibility rules.

The attached full plan contains reproducible baseline engagement/exposure/allocation assumptions. If unavailable, choose and document conservative versioned benchmarks before implementing; treat them as hypotheses to calibrate, not market facts. Persist strategy/brief/evidence versions and cache explanation against those inputs. Model calls never rank creators.

## Design and technical baseline

Start with Talaqee's inherited Next App Router/React/TypeScript/Tailwind/Prisma-Postgres/Anthropic stack and lockfile. Add shadcn/Studio source components, voice/provider imports, private evidence storage and missing Vitest/Testing Library/Playwright/CI. Supabase private storage and Vercel remain targets, subject to inspected inherited setup. Verify current supported APIs/security; preserve compatible dependencies instead of automatically upgrading everything. Read installed Next guides before code; source is Next 16, so confirm proxy/async cookies/promised params against the actual release.

Working art direction: ink/black and warm off-white surfaces, Snapchat-yellow primary actions, restrained Instagram-gradient verified/AI accents, readable red alerts, light/dark modes, IBM Plex Arabic/Latin, media-forward creator cards, mobile bottom navigation. Use semantic CSS tokens and classes. Every screen works at 360px. Never letter-space Arabic. Include labels, keyboard/focus behavior, contrast, reduced motion, and meaningful loading/empty/error/retry states.

Actual inherited AI routing is Haiku chat and Sonnet brief generation. Voice, source extraction, portfolios, explanations, themes and screenshots are Infame additions. Earlier influencer plans suggest light models for explanations/themes and stronger structured-output/vision for briefs/screenshots as reviewable defaults. Centralize/verify model and voice IDs/features/prices. Require validated output, bounded retries, honest failure and manual paths.

Exclude creator identity from campaign matching/explanation model inputs. Onboarding may process consented names/answers, and portfolio drafting may use approved public identity/company facts for that purpose; minimize context and unrelated private data. Define screenshot consent/crop/redaction/minimization; images can contain identity. Keep proof private with manual alternatives. Meter text/audio usage and enforce atomic caps for all jobs.

One validated env accessor and complete safe example; server-only secrets; encrypted social tokens; OAuth state/PKCE as supported; role and ownership checks independently of navigation; secure cookies; origin/CSRF checks; Postgres rate limits/OTP; bounded uploads/outbound requests; authenticated crons; request IDs/safe logs; backups and rollback. Separate development, preview, E2E and production databases. Production rejects test OTP/social mocks and validates configured enabled capabilities. Obtain current privacy/agreement/licence review before live use; old research does not certify compliance.

## Agent execution process

First inspect the actual Talaqee source/Infame branch and read the plan. Adapt project instructions and create/update `AGENTS.md`, `docs/DECISIONS.md`, `docs/CONTRACTS.md`, `docs/OWNERSHIP.md`, `docs/PROGRESS.md`, `docs/REUSE_INVENTORY.md`, shadcn research/UI composition and dependency-ordered conversion plans 00–08. Preserve useful existing documentation and record superseded rules explicitly. Plans describe current product/tools rather than stale task numbers.

The coordinator owns shared schema/migrations, auth/signup, brand/env, dependency files, shells/primitives, dictionary composers, CI and deployment config. Assign exclusive domain paths to creator, brand, matching, deal and admin specialists. Assign an independent reviewer/verifier. Explicitly tell workers they share the codebase and must preserve other agents' work. Declare cross-track handoffs and integrate shared foundations before dependent tasks. Use isolated branches/worktrees when appropriate.

Each task has objective, prerequisites, allowed paths, contracts, meaningful failing acceptance tests, implementation steps, failure states, validation and reviewer. Work test-first. Integrate working vertical slices; keep imports/routes/build coherent. Run the full union suite after merges. Fix concrete review findings before completion; use truthful authorship metadata.

Phases:

0. Talaqee provenance/reuse inventory, inherited Cloud baseline, contracts/owners/missing tests/CI, Studio/Figma research and early voice/card/draft prototype.
1. Deliberate schema/migration/auth/DTO/route adaptation, original-language content, countries/currencies/timezones, taxonomy/licence evidence and safe seeds.
2. Figma component/interaction handoff; adapt inherited shells/screens with reviewed shadcn/Studio primitives, public/auth/mobile/RTL and PWA.
3. Creator voice/text onboarding, account mapping, collection/approval, connections/evidence/profile/rates and generated portfolio/export.
4. Company voice/text onboarding, website collection/approval and generated portfolio, verification, campaign form/chat and brief approval.
5. Matching, shortlist/search, explanations and rerun decisions.
6. Deal room, offers/agreement, delivery/payment marks and ratings.
7. Admin/verification/import/claims/growth/notifications/SEO.
8. Hardening, E2E, live integration evidence, deployment readiness and beta handover.

Creator and brand tracks may run in parallel after shared contracts and signup are ready. Other independent leaves may run concurrently within ownership boundaries. Start provider reviews/domain/email/SMS/storage/legal setup in a founder checklist from day one; external approvals do not prevent continuing independent code work.

Run all four gates before each commit:

```bash
npx tsc --noEmit
npx eslint . --max-warnings 0
npx vitest run
npx next build
```

Also verify appropriate browser, dependency/security, migration, ownership, failure and concurrency paths. Do not count skipped required tests or mocked provider calls as live acceptance. Keep progress updates concise and record actual evidence.

## Completion and launch bar

Deliver a reproducible complete app, reviewed voice/text creator and company journeys, passing gates/E2E, safe database setup, architecture map, decisions, known gaps, setup/env key names without secrets, founder dependency checklist, deployment/rollback runbooks and backlog. The signature voice launch requires real dynamic Arabic speech/transcript/interrupt behavior on supported phones, measured cost/latency, durable resumption and tested text fallback. Mock voice/provider checks do not constitute live acceptance.

Exercise Arabic mobile and English desktop journeys through a completed rated deal. Include non-Saudi creator/brand signup, diaspora creators reaching Saudi audiences, currency mismatch/precision, UTC/timezone boundaries, international phone verification/fallback, expired badge filtering, and non-Saudi licence labels. Live readiness requires clean production data; real connect/metrics/sync/reconnect/disconnect evidence for enabled providers with tested fallbacks; real email/Saudi SMS and supported international OTP or disclosed reviewed alternatives; private evidence access; actual crons; push if enabled; infame.sa HTTPS/origin; reviewed terms/privacy/data-deletion/agreements and applicable licence handling; restore/rollback evidence. Lighthouse budgets: performance `.85`, accessibility `.95`, SEO `.95`, LCP `3s`, CLS `.1`, transfer `900KB`.

Private beta target: 30–50 creators/five brands, recruiting Saudi demand and relevant Arab creators worldwide. Track conversion and completed deals by campaign market. Suggested exit is 50 connected or screenshot-verified creators, five approved briefs, ten offers, three completed mutually rated deals and no P1 incidents in the same week. Original growth aspirations are 300 OAuth-verified creators/30 briefs by day90 and 1,000/150 by month6; never present targets as achieved traction. Re-estimate timing for expanded scope.

V2 payments/WhatsApp/content approval/tracking and V3 deeper local commercial operations/agency workspaces/reporting/API remain a backlog. Global availability and country/currency support already belong to V1. Old 12%/25% fee ideas and SAR5,000 paid-campaign floor are undecided proposals.

Start with the contract and dependency plan, then implement through the phases. Ask only for decisions or external input that materially block dependent work, and continue useful independent work while waiting. Do not send outreach, buy domains, submit registrations, publish externally, or move money without explicit authorization for that action. Report code completion and operational blockers accurately.
