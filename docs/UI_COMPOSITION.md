# Infame / إنفيم UI composition and acceptance map

Specification: both original handoffs read completely, 2026-10-01. This is the design/behavior contract for adapting Talaqee; it is not a statement that every mapped route, integration or acceptance test is implemented. Existing server ownership/authorization and domain state machines remain authoritative. Catalog provenance and source/dependency boundaries are in [SHADCN_RESEARCH.md](SHADCN_RESEARCH.md).

## Foundations and composition contract

The default experience is Arabic RTL with an immediately available English LTR switch. The app serves Arab creators globally and brands reaching Arab audiences. Saudi residence and موثوق are explicit regional facts rather than defaults inferred from Arabic UI. Canonical product/domain is Infame / إنفيم, infame.sa.

| Token / foundation | Light | Dark | Usage and constraints |
| --- | --- | --- | --- |
| Background | #FAF9F4 | #0E0E10 | Page and quiet canvas |
| Primary text | #121214 | #F2F1EA | Body/title/icon foreground; measure actual contrast |
| Card surface | #FFFFFF | #19191E | Design proposal; align with root semantic CSS rather than literal per-screen colours |
| Action/accent | #FFFC00 | #FFFC00 | Dark #121214 text; 48 px preferred primary target |
| Campaign/creator accent | #F58529 → #DD2A7B → #8134AF | Same hue family | Decoration and selected identity accents; never sole state indicator |
| Destructive/error | #D62828 | Token-adjusted readable foreground/surface pair | Error copy + icon + correction, not colour alone |
| Decorative gold | #B88A00 | Review per surface | Fails ordinary-text contrast on warm white; never normal status/body text |
| Arabic typography | IBM Plex Sans Arabic | Same | Required product font, no Arabic letter-spacing |
| Latin typography | IBM Plex Sans | Same | Handles/URLs remain readable; avoid faux synthetic typography |
| Type scale | Body/input 16 px; secondary 14; title 24–32 | Same | Arabic line height approximately 1.7; use content-fit titles rather than clipping |
| Spacing | 4/8/12/16/24/32/48 px | Same | Mobile page inset16; 328 px content inside360 px screen |
| Touch/focus | 44 px minimum, 48 px primary | Same | Visible keyboard focus; checkbox/icon targets include label/wrapper |

Root centralizes Button/Card/Input/Textarea/Checkbox/Dialog/Sheet/Direction and semantic colours. Use Studio layouts and Figma atoms after adaptation. Button `asChild` preserves link semantics; modal title/description/focus return are required. Ordinary onboarding contextual input is an inline bottom card, not a focus-trapping drawer. The Radix Sheet is reserved for a deliberate expanded editor or filters. Do not combine Base Drawer or React Aria signatures into the same wrappers.

Desktop uses a restrained top header/sidebar with a bounded reading column; tablet collapses navigation; mobile uses a bottom navigation strip where an authenticated journey needs it. Onboarding's contextual input replaces competing navigation/CTA furniture where necessary. Support360 px without horizontal scrolling and 200% text zoom. Avoid rigid100vh: use dynamic viewport height, safe-area padding, scrollable content and reserved bottom space. Composer/CTA position reacts to the software keyboard and VisualViewport rather than overlaying focused input or the last transcript turn.

All table rows have a card/list alternative at mobile sizes. Date/amount/currency/timezone presentation comes from explicit saved campaign/deal values. Localizing UI must not change deal money, date interpretation, platform handle spelling or current draft version.

## Global states applied to every screen

| State | Required UI behavior | Evidence/acceptance |
| --- | --- | --- |
| Loading | Preserve layout and user input; honest spinner/skeleton attached to actual request; source imports show per-platform progress | No invented countdown/fake finished values; reduced-motion version |
| Empty | Explain what exists and offer the authorized next action | No fake seed KPI/testimonial presented as real; unknown is not zero |
| Invalid | Persistent field label, specific correction, `aria-invalid`, described error, focus first invalid control after submit | Keyboard and screen reader can recover; values preserved |
| Partial data | Known facts with per-field source/date/confidence; unknowns visibly marked | Missing statistics never silently become0; unsupported edits become self-reported |
| Provider unavailable | Manual path, retry and clear unavailable source status | No fabricated import, transcript, ownership or verification |
| Permission denied | Explain exact denied capability and equivalent text/manual path | Mic is only requested when Speak is selected; no repeated prompt loop |
| Unauthorized/forbidden | Server rejects direct URL/API and UI offers sign-in or authorized context | Hiding a button is not authorization; brand A cannot see brand B campaign/deal |
| Expired/stale/conflict | Explain expiry or changed version, refetch safely, require current-version approval | No automatic reuse of acceptance/confirmation after counteroffer/version edit |
| Offline/reconnecting | Retain unsent input/private draft, make unavailable network actions explicit | Replay only idempotent safe operations; never silently submit deal acceptance |
| Success | Show actual persisted outcome and next useful action | Distinguish private save, publication, accepted ownership, delivered/completed, self-paid/received |
| Resume | Restore last persisted state + current input safely; stale/provider facts revalidated | New tab/reload test; language/voice mode switch does not lose progress |

## Public, auth and cross-role screen map

Route names below describe intended product surfaces; reconcile with actual router before linking navigation. Inherited route names can be adapted through aliases/redirects, but product semantics and server authorization must remain clear.

| Screen / route | Composition mapping | Critical states and constraints |
| --- | --- | --- |
| Landing `/` | Studio hero/features/CTA/FAQ/navbar/footer; core Card/Button | Two clear creator/brand entries; original Arabic copy; no unearned logos, counts or revenue claims; EN/light/dark/mobile equivalents |
| About `/about` | About/story sections + semantic long-form text | Explain global Arab audience and evidence-led matching; actual company details only |
| Brands `/for-brands` | Compare/features/workflow/CTA | Campaign form/chat parity, transparent quote coverage and versioned agreements; no payout promises |
| Creators `/for-creators` | Portfolio/features/CTA | Reusable portfolio, permission-led imports and real invitations; ownership/publication requirements explained |
| Pricing `/pricing` | Pricing overview + FAQ | Only approved current offering; no invented plans/payments/checkout; V1 payment handling excluded |
| Privacy `/privacy`, Terms `/terms` | Readable long-form layout | Real authored policy content; sections readable in both locales, no placeholder legal assurances |
| Sign in/register | Auth layout + Field/Input/Button | Existing auth validation/session semantics; role entry does not grant arbitrary admin/company rights |
| Email verification | Verify-email block/Alert | Token expiry, resend cooldown, verified success, already-used token; verification does not prove a platform account |
| Forgot/reset password | Recovery blocks/Input/Button | Generic recovery response, expiry, invalid/reused token, retained safe error; no secrets in client logs |
| Role selection | Card/Radio/Buttons | Creator/company choices clear and reversible before protected setup; admin not self-selected |
| Creator public `/@handle` | Portfolio/Card/Badge/Avatar/media gallery | Public eligible facts only; essential fields, email verified, accepted primary ownership and separate consent required; private/unproved accounts excluded |
| Company public `/brands/[slug]` | Company portfolio/services/Card | Company representative verification distinct from Saudi CR verification; opt-in public publication; website absent is supported |
| Invitation/claim | Invitation summary + auth/proof form | Expired/revoked/claimed/unauthorized, duplicate claim, explicit role and invited resource; unclaimed imported creator cannot enter active deal |
| Account/settings | Account-settings forms/Checkbox/Dialog | Profile, email, locale/theme, notification preferences, ownership/licence proof states, export and deletion; persist actual preferences |
| Offline/install | Alert/Empty/Button | Install when browser capability exists, offline read-only/private draft behavior, reconnect/error; assets not a promise of offline network operations |
| Notifications/referrals | List/Card/Badge | Actual unread states/deep links with auth; referral attribution and invite lifecycle audit; no fabricated counts |

## Creator onboarding: one continuous journey

One top-level orchestration persists facts and current state. Voice and typed input submit to the same parser/validator/domain transitions. The transcript remains visible with one sentence/question and one contextual bottom card. Keep “اكتب بدل الصوت”, Back/Edit, mute/stop/replay, captions, exit/resume and language controls available without filling the screen with duplicate primary buttons.

| State | Visible content and component mapping | Persisted evidence / recovery |
| --- | --- | --- |
| WELCOME | Original Arabic female guide introduction, mode choices; hero/avatar accent + two Button choices | Explain microphone only needed for speaking; typed path immediately usable; no celebrity imitation |
| NAME | “وش اسمك اللي تحب يظهر في ملفك؟” + bottom Input | Display name editable; validation/saved draft, back/resume |
| PRIMARY_HANDLE | Platform-aware handle/URL Input with example isolated LTR | Normalize platform URL to handle; invalid URL/platform mismatch; input does not prove ownership |
| PLATFORMS | Checkbox rows/platform icons in 44 px targets | Selected additional platforms stored separately; more/fewer selections do not change already confirmed facts |
| HANDLE_MAPPING | Same-handle toggle + per-platform overrides | Show actual intended handle per platform; no silent assumption all accounts share primary username |
| ACCOUNT_CONFIRMATION | Candidate Card: photo/name/handle/platform/URL, “هذا حسابي” or choose another | Confirm intended account only; ambiguous/not found/manual states; distinct ownership evidence |
| IMPORT_PERMISSION | Precisely described public import sources/data, explicit Checkbox/Button | Record permission/version/timestamp; decline continues manual draft; no prechecked consent |
| IMPORTING | Per-platform status, cancel/retry/manual path; Progress/Spinner/Alert | Real ready/loading/success/partial/failure states; no fabricated progress or provider data |
| FACT_REVIEW | Source-stamped metric/account cards, editable factual summary | Missing values unknown; unsupported edits self-reported; immutable imported evidence separate |
| MISSING_ESSENTIALS | One contextual country/city/niche/audience-language/service field at a time | Separate residence vs audience geography; country-specific موثوق prompts only where relevant |
| PORTFOLIO_DRAFT | Editable bio/services/social/approved-work sections | AI generates grounded prose from facts only, user retains edits; generation unavailable supports manual input |
| PREVIEW | Real draft portfolio, private/public toggle and eligibility checklist | Preview is private; show exact missing gate and proof queue status |
| PUBLISHED | Successful public URL + actual visibility state | Email verified + essential fields + handle + primary ownership accepted + separate publication consent |
| SAVED_DRAFT | Private save success + resume link | Always available when import/proof/provider absent; no implication of publication/ownership approval |

A Saudi creator may see موثوق number/evidence/status, but it is a distinct licence verification object; residence, intended account, platform ownership and eligibility remain separately labelled. Rejected/expired/pending proof needs specific corrective UI. Manual facts never receive a verified badge simply because the user typed them.

## Company onboarding

| Step / screen | Composition | Required states and boundary |
| --- | --- | --- |
| Welcome and company identity | Same orchestration shell + Input | Company name, industry, company country/city and representative identity; save/resume |
| Website optional | URL Input + “ما عندنا موقع حالياً” | Skip proceeds without penalty; invalid/unavailable site; no automatic domain proof from entered URL |
| Platforms/handles | Checkbox/Input platform mapping | Shared vs platform-specific handles; candidate confirmation distinct from representative authority |
| Import consent and review | Explicit consent + source cards + per-source progress | Preserve manual path; website/social facts include provenance/date/unknowns |
| Essentials | Contextual company/service/market/contact fields | Campaign country/currency/timezone saved explicitly, never inferred from Arabic |
| Editable portfolio | Card sections/services/about | No invented clients/results/awards/campaign statistics; approved content only |
| Private save/publication | Preview + eligibility/proof checklist | Email verified and representative proof accepted separately; Saudi CR status is another regional object; publication is opt-in |
| Optional first campaign | Equal Form and Chat mode choices | Company can finish setup without forced campaign or payments; draft survives mode switches |

## Campaign, discovery and matching

| Screen | Mapping | Domain-specific behavior and states |
| --- | --- | --- |
| Brand dashboard/campaign list | Application shell + real statistics/list/Empty | Actual campaign/deal counts; first-campaign CTA; role scoped to company |
| Create campaign entry | Radio/Tabs or two equally prominent Buttons | Form and Chat equally available, same resulting brief fields, saves and validation |
| Form brief | Input/Textarea/native Select + date/timezone controls | Goal, product, target audience, markets, language, platform/service baskets, deliverables, budget, currency, dates/timezone, usage rights, restrictions; contextual errors |
| Chat brief | Transcript/Bubble-like surfaces + contextual composer | At most **five actual clarification questions**; user answer turns/greetings/retries are not clarification count; cap applies to campaign chat, not onboarding |
| Brief review/approval | Structured Card sections + inline editor | Versioned full structured brief before matching; edit creates a new version/invalidates stale approval; duplicate submit safe |
| Matching loading | Saved approved brief + actual worker/request status | No fabricated candidate cards or matching “AI thinking” wave without real state |
| Match results | Creator cards/filter Sheet/evidence summaries | Deterministic score `round(100 * weightedFit * (0.5 + 0.5 * rawConfidence))`, threshold 60, max 12; no padding with weak matches |
| Match explanations | Card detail/Accordion-like disclosure | Fit factors, evidence/confidence, fresh source dates, missing-neutral 0.5 labelled unknown; separate residence and audience |
| Cost/coverage | Requested service basket + money table | Complete/partial/missing quote coverage, unmatched currencies separate, no FX guessing; unknown quote not 0/free |
| Forecasts | Labelled estimates + methodology disclosure | Estimated impressions; never guaranteed views or deduplicated unique reach; only defensible observed evidence |
| No/weak matches | Empty state + edit brief CTA | Explain constraints and useful changes; no fabricated creators or arbitrary threshold relaxation |
| Creator details/discovery | Portfolio + supported services/evidence | Public opted-in facts only; manually discover/invite eligible creators without representing a threshold match |
| Direct invitation | Separate invitation Card/status | Explicitly “دعوة مباشرة”; link intended recipient; unclaimed creator must accept claim/prove relevant ownership before active deal |
| Creator campaign invitations | Inbox/List + brief snapshot | Actual invitation state, expiry, decline/accept/new deal transitions; no access to unrelated company campaigns |

## Deals, agreements, delivery and ratings

| Screen / state | Composition | Required semantics |
| --- | --- | --- |
| Service basket | Card/native form/money lines | Supported platform/service quantities, exact amount/currency, dates/timezone, usage/revisions; estimates visibly distinct from accepted quote |
| Draft offer | Structured form + version preview | Validation, save, recipient, actual author permissions and audit; no offer sent solely by UI click without persisted transaction |
| Sent offer / received offer | Read-only version Card + Accept/Decline/Counter buttons | Only current recipient can respond; creator/company scopes enforced server-side |
| Counteroffer | Editable next-version form + diff | Preserve prior immutable version; changed price/date/usage creates new version, resets prior confirmations |
| Acceptance/agreement | Immutable agreement snapshot + two confirmations | Acceptance bound to exact offer/version; each party separately confirms latest agreement; stale/conflicting/duplicate requests deterministic |
| Active deal timeline | Timeline/List + agreement detail | Both required confirmations recorded before active workflow; no unclaimed creator progression |
| Delivery evidence | Upload/file/URL fields + actual storage state | Creator marks delivered with valid evidence; upload errors/size/type/permission handled, not a fake successful file |
| Brand completion | Delivery review + explicit completion action | Brand alone completes; creator delivered and brand completed are distinct events |
| Payment self-report | Two separate labelled reports | “Brand reports paid” and “Creator reports received”; no escrow, charging, payouts or verified settlement claim |
| Pending sealed rating | Rating controls + Textarea | Eligible completed agreement/version, one party's submission not revealed early; other party status without score leak |
| Published rating | Review cards | Reveal after both submit or 7 days; eligibility, repeated submission and privacy validated server-side |
| Declined/cancelled/expired/error | Status Card + allowed next action | Exact domain transition/version displayed; no optimistic “active” on failed server response |
| Counterparty permissions | Same layouts with authorized actions | Direct endpoint/version tampering tests, duplicate submit concurrency, unrelated user access prohibited |

## Admin screen/state map

Admin layout uses one centralized Sidebar/application shell with logical RTL docking and mobile Sheet. Navigation visibility does not grant authorization. Each queue/list has loading, empty, error, filtering, pagination, unauthorized and audit states. Counts come from actual queries.

| Admin surface | Composition | Critical operations and evidence |
| --- | --- | --- |
| Overview | Statistics/cards | Real counts of users, campaigns, claims/proof/licence/CR queues and deal lifecycle; no static seeded KPI masquerading as live |
| Users/roles | Table/list + confirmation Dialog | Creator/company/admin permissions; explicit role change with audit and protection against arbitrary client role escalation |
| Creator/company moderation | Table/detail Cards | Source/publication/proof distinction, consent, reject reason, pending/accepted/rejected states |
| Campaign review | Table/brief detail | Company ownership, version and actual match/job states |
| Niches/categories | Table/form | Real niche IDs/labels in Arabic/English, sort/enable/edit validation, references preserved |
| Ownership proof queue | Evidence file/viewer + decision form | Platform account + proof method/requester/version, admin audit/reason, no intended-account checkbox approval shortcut |
| موثوق verification queue | Regional licence review | Licence evidence/date/issuer/status distinct from ownership |
| Saudi CR queue | Company record review | CR status distinct from representative proof and opt-in publication |
| Creator CSV import | File input + preview/errors Table | Dry-run field mapping, malformed URLs/duplicates/required columns, idempotent apply; imported entries unclaimed, no published personal data |
| Claims/invitations/referrals | Table/status/event list | Expiry/revocation/claimed duplicate handling, claims tied to invited records, referral attribution retained |
| Notifications/settings | Forms/Checkbox/List | Actual configuration and delivery states; errors visible, no real external sends through test fixture |
| Audit | Filtered append-only event list | Actor/resource/action/date/version/reason; sensitive evidence access role scoped and tokens redacted |
| Data deletion/export | Destructive Dialog + request progress | Explicit user-owned data handling, error/retry/complete status; no destructive unscoped DB action |

## Voice state, focus and safe-area specification

| Provider/session state | What the user sees | Available controls |
| --- | --- | --- |
| ready | Visible next question and ready to speak/type | Speak, typed equivalent, language, back/edit |
| listening | Real microphone capture indicator + live transcript | Stop listening, type instead, mute/exit; cancel cleans capture |
| processing | Retained submitted transcript + real pending status | Cancel/retry where safe, edit transcript, no fake generated reply |
| speaking | Captioned generated reply while actual audio plays | Stop, mute, replay, text path; avoid competing microphone capture |
| paused | Last transcript/question preserved | Resume or type; no fake listening waveform |
| reconnecting | Connection status, retained private draft | Retry/back to text; no silent duplicate answer submission |
| error / unavailable | Plain localized explanation | Manual typed continuation; settings help only relevant to denied capability |

Provider events drive state and motion. Processing animation never implies a provider session is connected. Screen-reader `aria-live` announces meaningful turn/status changes politely; transcript does not continuously steal focus. Focus moves into the contextual field only when the user begins input, returns to current action after a modal, and remains stable during streaming. Stop/replay/captions have localized labels. Reduced motion removes pulsing/waveform motion without hiding state. Microphone denial/offline/provider failure must still produce the same saved facts and editable portfolio through typing.

## Connected Figma evidence and limits

Editable source/component mappings were read from the private [Nova kit copy](https://www.figma.com/design/oR5Z7suB4fJ7B40KLDk7Ol). Exact local source IDs:

| Atom | Actual source node / property contract | Required adaptation |
| --- | --- | --- |
| Solid Button | `39679:24382` inside set `39679:23835`; label TEXT `¶ label#310:196`, axes style/size/state |48 px target, IBM Plex, yellow/ink primary, localized name/loading/icon slots |
| Default Input | `414:12803` in set `414:12784`; Text/Placeholder TEXT, label booleans, input-container SLOT | Native accessible label,16 px text,44 px target, RTL/LTR data islands |
| Card | `38526:288` in set `335:31760`; header/body/footer SLOT | Provenance/unknown badges, Infame surface/text, logical padding |
| Checkbox | `36447:12644` in set `36447:12571`; Label/Description TEXT, size/variant/state/checked axes |44 px row, consent independent from ownership and publication |
| Textarea | `38939:4554` in set `38939:4553`; Text/Placeholder TEXT + textarea slot | Composer growth, saved typed transcript, description/error |

Successful MCP foundation creation added `Infame / Primitives` collection `VariableCollectionId:44509:70` and `Infame / Semantic paired themes` collection `VariableCollectionId:44509:71`, with ten primitives and eleven semantic aliases. Scopes were explicit, code syntax uses `var(...)`, and colours use proper normalized values. Starter allows one mode for new collections, so preview themes are paired semantic names; this is not a working Light/Dark mode-toggle library. The proposed primary/surface token names and all code syntax require final root CSS alignment before code/design parity can pass.

MCP then hit the Starter tool-call quota; adding a new page in the 80-page inherited kit was also rejected. IBM Plex Sans Arabic was absent from returned available fonts and the browser font search. These limits do not require changing the product font or purchasing a plan. Exact persisted workflow IDs and pending acceptance are in the ignored `.research/figma-state.json`.

Normal browser editing created a limited [English layout study in the separate Infame draft](https://www.figma.com/design/45Fzr1m0v4EgPUpm3pYBoG?node-id=1-907). Verified frame `1:907` uses vertical auto layout, fixed 360 × 800 dimensions, 16 px padding, 10 px gap and #FAF9F4 surface. Text `2:947` uses IBM Plex Sans Latin Medium, 16/26 typography, 328 px width, auto height and #121214 foreground. Actual Studio Solid Button instances `2:949` and `2:957` retain their source component connection; both fill 328 px width with fixed 48 px height and #FFFC00 / #121214 overrides. Labels are Speak and Type instead. Original vendor components were not edited. A malformed text layer created during composition was removed, and cut/paste reordered the final text before both actions. No flattened screenshot or fabricated component was substituted.

This study verifies component access, editable composition, basic light palette and two equivalent action targets. It intentionally remains a layout study: final welcome/name states must be separated, the contextual card belongs at the bottom, proper type hierarchy and Arabic variants remain pending, and tokens in the kit copy are not yet bound into this separate draft. Canvas screenshots were inspected in tool output. Two bounded normal PNG export attempts returned no download event/path, so no saved image artifact is claimed. The live draft was retained for review.

Full Figma screen/state coverage, Arabic font fidelity, visual review, responsive equivalents, prototype focus/keyboard behavior and Code Connect are **not yet accepted**. This document specifies all of them; documentation alone does not satisfy them.

## Public implementation evidence

The converted public route group now uses `PublicShell`, `InfameLanding` and `InformationPage` for `/`, `/about`, `/for-brands`, `/for-creators`, `/pricing` and `/contact`. Legacy `/for-clients` and `/for-providers` redirect to the matching Infame audience pages. The landing route no longer queries procurement categories or renders fabricated category counts. All copy is original Arabic-first interface copy with an immediate English alternative; campaign and portfolio content is not translated by the public locale switch.

The root layout loads both IBM Plex Sans Arabic and IBM Plex Sans Latin through Next's font loader. Semantic light/dark tokens, local LTR identifiers, logical spacing, native FAQ/menu disclosures, a skip link, reduced motion and 360 px layout rules are implemented. Theme and locale persist with their separate cookies. Landing actions point to distinct `company` and `creator` signup choices. The offering describes the approved free V1 platform and direct participant payment without invented prices, proof logos, testimonials, guarantees or settlement claims.

Input-boundary tokens were corrected to `#88877F` in light mode and `#72727C` in dark mode. Calculated sRGB contrast is 3.42:1 against the light page, 3.61:1 against white cards, 3.07:1 against light muted surfaces, 3.68:1 against dark cards and 3.08:1 against dark secondary surfaces. These exceed the unrounded 3:1 threshold for necessary control boundaries; softer decorative card borders are distinct. This calculation is not a complete accessibility audit. [W3C non-text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

The implementation follows the reviewed Radix Button/Card source contracts and the actual licensed Figma atom mapping; it does not claim fidelity to an accepted full Figma public-page frame, because that frame set remains incomplete. Auth, onboarding, protected domain screens and server authorization are separate owned phases.

Targeted ESLint checks for the owned public components, routes, copy, brand constants and root layout passed. Whitespace checks passed. The aggregate TypeScript check encountered then-in-progress onboarding test imports, with no public UI diagnostics; this is not an aggregate typecheck pass.

### Running public browser checks — 2026-10-04

Checks use the coordinator's managed server at `http://localhost:3210`, Chrome, and explicit 360 × 800 and 1440 × 1000 viewports. No separate server or production account was used. Exact observed results:

| Check | Observed result |
| --- | --- |
| Arabic landing first paint | `lang=ar`, `dir=rtl`; computed IBM Plex Sans Arabic family, `document.fonts.status=loaded`; readable screenshot |
| Mobile reflow | Both Arabic/light and English/dark landing have no horizontal overflow; browser content width 345 px within the 360 px viewport with its vertical scrollbar |
| Primary actions | Both landing signup targets are 48 px high; distinct company/creator hrefs |
| Keyboard skip | First Tab reveals the localized skip link with solid visible outline; Enter moves focus to `#infame-main` |
| Instant language switch | Button changes document to `lang=en`, `dir=ltr`, English heading/copy and IBM Plex Sans Latin family without navigation |
| Preference persistence | Reload retains English and dark mode; computed dark body background `rgb(14, 14, 16)` and screenshot confirmed |
| Branding | Rendered landing text contains no Talaqee name; Infame wordmark/domain and both audience journeys visible |
| Mobile menu | Open English menu lies within viewport (left about 99 px, right about 329 px); readable labels and six real navigation links |
| Secondary routes | `/about`, `/for-brands`, `/for-creators`, `/pricing` and `/contact` visually inspected in Arabic/light at 360 px and English/dark at 1440 px; all navigated to their canonical paths and had no horizontal overflow |
| Desktop landing | Arabic/light and English/dark screenshots inspected at 1440 px; two-column hero, visible full header navigation, 48 px primary actions, no horizontal overflow |
| Menu keyboard completion | Enter opens; Escape closes and returns focus to the summary with solid outline. Tab from open summary reaches For brands; Enter completes navigation and closes the menu |
| FAQ keyboard | Space opens the Arabic payment disclosure and exposes its real direct-payment explanation; Space closes it; summary retains solid focus outline |
| Signup/login appearance | Arabic/light at 360 px, persistent labels, 48 px inputs and submission controls, 16 px input text, email LTR, no horizontal overflow. No credentials entered and no form submitted |
| Legacy audience URLs | Browser navigation to `/for-clients` reaches `/for-brands`; `/for-providers` reaches `/for-creators` |

Three concrete issues were corrected during the browser pass: native menu Escape did not dismiss it, inherited Card text made explanatory paragraphs 14 px, and wordmark/language targets were below 44 px. The owned shell handles Escape and returns focus; public journey/information paragraphs now explicitly use 16 px; wordmarks and the language switch now keep a minimum 44 px target. The final stylesheet was confirmed after reload. Representative post-change checks cover English/dark desktop contact and English/dark plus Arabic/light mobile creator pages, with no overflow and computed 16 px card copy. A rendered-target scan of the final Arabic mobile creator page found no visible product links/buttons/summaries below 44 px in either dimension. Scoped ESLint for the modified shell passed.

Native summary is exposed as a button by the browser accessibility tree but as a generic by the Playwright DOM snapshot; selector tests should use its label or `.infame-mobile-menu summary`. CUA's screenshot backend sometimes included outer whitespace after viewport changes; clipping the observed app region produced readable, correctly sized screenshots for visual inspection. The Next development indicator is framework UI and is not fabricated Infame activity.

One late home-link navigation stalled during active development rendering, while an independent GET `/` still returned 200. A full page load restored navigation; a fresh header click cycle `/` → `/for-creators` → `/` then completed successfully. This is recorded as a development-session anomaly rather than a clean uninterrupted navigation pass. Coordinator automation should use a stable server/build after edits.

Screenshots were visually inspected through CUA; saved Playwright artifact production and aggregate browser automation remain coordinator-owned and are not claimed here. No full accessibility certification is claimed: screen-reader/phone testing, 200% zoom/text-spacing, actual reduced-motion preference, auth errors/submissions and exhaustive locale/theme combinations remain separate checks. Protected creator/brand/admin journeys and incomplete Figma screen acceptance remain outside this public browser pass. The temporary viewport override and test locale/theme are restored before handoff.

## Acceptance ledger for implementation and review

| Gate | Concrete acceptance | Required evidence |
| --- | --- | --- |
| Baseline/reuse | Isolated branch, original changes preserved, inherited infra mapped, disposable DBs verified | Root reuse/environment/Git records; design report is supplemental |
| UI foundations | Correct IBM fonts, semantic light/dark, RTL portal navigation,360 px, focus/labels/contrast | Browser screenshots and interaction tests for AR/EN/light/dark; no hardcoded Talaqee design leakage |
| Onboarding | Voice/text facts/import/draft outcome parity, no website works, ownership/consent/email/publication separation | Reload/resume, mic denied, provider failure, manual/import partial, rejected proof tests |
| Campaign/matching | Equal form/chat, clarification cap, approved version, deterministic score/threshold/max 12, quote/confidence caveats | Domain/unit + browser/API tests including unknown/empty/mixed currencies |
| Deals | Recipient/version auth, immutable agreement, dual confirmation, creator delivery/brand completion, role self-reports, sealed rating | Cross-user tampering/concurrent duplicate/stale version + lifecycle tests |
| Admin/import | All real count/queue/settings screens, idempotent CSV preview/apply/claim, audit | Role/API tests, malformed/duplicate imports, private unclaimed record checks |
| Release | Build/type/lint/security/tests reviewed, documented integration blocks, server-backed route acceptance | Root phase/review/test ledger; mock voice/import can verify adapters only, not live integration |

For every mapped screen, a reviewer should check the actual implementation URL, role, locale, theme, viewport, loaded source/evidence state, interaction, network/server result and persisted domain record. A static Figma screen or passing build cannot establish a complete journey.

