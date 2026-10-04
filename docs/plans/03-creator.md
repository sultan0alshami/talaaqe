# Phase03 — creator onboarding, connections, evidence and assets

Status: planned. Owner: creator specialist for assigned domain leaves; coordinator shared schema/auth/orchestrator/config/primitives; independent reviewer. Prerequisites: reviewed phase01 contracts/migrations/identity/visibility/jobs/caps and phase02 shared UI. Brand04 can run in parallel with separate paths. Exact allowed paths narrowed on activation; no shared signup/schema/dependency edits.

## 03.1 Ordered creator voice/text steps and durable account mapping

- Objective: welcome→display name→primary social handle→platforms→shared/different handle mapping→candidate confirmation/permission→review→missing essentials→portfolio→preview→publish/save.
- Prerequisites: shared commands/server revisions/input cards; platform-aware handle policy/capability matrix.
- Allowed paths: `src/lib/onboarding/creator/**`, `src/components/screens/creator/onboarding*`, assigned creator onboarding routes, creator dictionary and `tests/creator/onboarding*`; schema/shared changes requested centrally.
- Contracts: same voice/text commands; external handle separate from Infame handle; scoped source consent; `هذا حسابي` not ownership; original transcripts/answers; only missing questions, no campaign five-question cap.
- Failing acceptance: shared handle does not verify other rows; different mappings stay editable; wrong-account correction stales prior imports/sections; denied mic→typed flow; resume does not duplicate job/call; English toggle does not translate saved answers; forged voice tool cannot import/publish.
- Implementation: role-specific step validation/renderers, editable normalized per-platform map and candidate source links, explicit account/consent controls, location/timezone/language/dialect/niche/availability/travel/currency prompts, optional rates/work/licence without blocking draft.
- Failure states: candidate not found/incorrect handle/partial import/pending proof/provider unavailable/session expiry→manual source review/save/resume. No forced full analytics connection.
- Validation/review: shared/different/wrong handles,360px keyboard/safe area and text/voice lifecycle in integration/browser tests; independent reviewer checks unauthorized steps and stale adoption.

## 03.2 Capability matrix and five independent platform adapters

- Objective: permitted sourced imports with honest available fields and OAuth/sync/reconnect/disconnect boundaries.
- Prerequisites: current official docs/access terms researched; central encrypted tokens/PKCE/state/jobs/caps and allowed endpoints; live credentials separate from fixtures.
- Allowed paths: `src/lib/social/**`, `src/lib/imports/social/**`, creator connections API/screens/dictionary/tests. Provider/env/cron/schema requests go to coordinator.
- Contracts: Instagram current professional eligibility/scopes/fields verified before enabled; TikTok authorized Display profile/video with no unsupported demographics; YouTube public channel discovery versus owner analytics definitions/rounding; Snapchat approved Public Profile subset/allowlisting; X optional entitled lookup with manual/screenshot default. Account identity does not verify unrelated typed metrics.
- Failing acceptance: each adapter separately rejects missing scope/state/replayed OAuth, wrong stable account mapping, stale completion and unsupported field claims; one platform failure preserves others; disconnect makes tokens unusable; screenshot upload cannot freshen old evidence. Public import never becomes API ownership.
- Implementation: per-provider normalized identity, consented calls/snapshots/evidence/window/source/unit, retries/status/capability unavailable and manual alternatives; independent job progress; approved scheduled refresh with source dates. Record official docs/source/check date and real configured capabilities.
- Failure states: provider approval/quota/token expiry/missing scope/network/rate limit→partial/error/reconnect/manual. Do not claim a universal username scraper or live access from mocks.
- Validation/review: targeted adapter/output/authorization/failure tests plus actual connect→expected metrics→sync→reconnect→disconnect evidence for enabled providers. Independent verifier reviews scopes and distinctions; pending approval remains launch dependency.

## 03.3 Private evidence, approval and editable profile/rate cards

- Objective: source-aware facts and creator-owned exact prices with real trust and visibility.
- Prerequisites: shared storage/provenance/projection, coordinator schema/rate uniqueness, admin review mutation contract.
- Allowed paths: creator profile/rates/evidence modules/API/screens/DTO/dictionary and `tests/creator/**`; private storage/config/schema owner coordinator; admin review implementation admin track.
- Contracts: immutable observation versus correction; original evidence date; optional consent/minimized screenshot vision; manual fallback; country/dialect not inferred; rates unique creator/platform/format/currency, exact positive amount; advertising licence distinct from ownership/API.
- Failing acceptance: unrelated user/proof URL denied; extracted/unreviewed screenshot has no badge; changing API number becomes SELF_REPORTED; unknown demographic staysnull; currency mismatch cannot quoted total; duplicate/unsupported rate rejected; hidden/suspended/proof-unaccepted publication denied.
- Implementation: editable sourced fact review/exclusion/corrections, private evidence consent/crop/redaction/upload/status, profile location/languages/styles/taxonomy/availability/travel, demographics with unknown residual, creator-owned multi-currency rates and public visibility; optional reviewed scoped licence details.
- Failure states: upload/vision/cap/review rejection/expired proof→manual edit/reupload/pending; no inherited approved-provider catchall verification.
- Validation/review: DB uniqueness/ownership/visibility/precision and real private storage scoped access; Arabic/English profile/rates browser; independent review of correction provenance and source dates.

## 03.4 Generated portfolio, handle publication and Arabic media kit

- Objective: usable editable fact-based creator asset before an offer, explicit eligible publication and permission-consistent exports.
- Prerequisites: approved source facts; unique Infame handle reservation; shared generated-version/projection; researched Arabic PDF/font pipeline.
- Allowed paths: creator portfolio/profile/media-kit modules/screens/routes/DTO/tests and dictionary; coordinator public/SEO mount/config changes.
- Contracts: manual template if generation fails/cap exhausted; approved sources only/no invented clients/work/results; per-section revision/source links; primary proof publication and extra unproved account exclusion; `/@handle`; exports same visibility projection.
- Failing acceptance: reserved/conflicting handle cannot takeover; material fact edit marks generated section stale; generation failure still creates editable template; draft save never implicitly publishes; public/PDF omit private contacts/screenshots/audience/unproved imported identity; Arabic PDF shaping/fonts legible.
- Implementation: handle proposal/reservation/edit, approved sections/regeneration/preview/visibility, selected genuine portfolio work, draft/publish controls and sharing/referral next action; exact rates/current scoped badges in media kit, source freshness labels.
- Failure states: model/handle/proof/export/network→manual draft/correct/resume/download retry; incomplete metrics not zero; no forced publish.
- Validation/review: creator full voice/text/no-analytics paths, explicit publication/ownership/visibility negative tests; visual Arabic PDF/browser export evidence; reviewer checks actual content sources and public/index parity.

Phase exit: two capable modes produce editable approved draft, per-platform partial/resume/manual paths, source/ownership accurate, public/rates/export safe, relevant four gates and independent review. Real enabled connections/voice/storage evidence required for live launch; fixture passes stay labeled.
