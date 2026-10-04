# Phase04 — company onboarding, portfolios and approved campaign briefs

Status: planned. Owner: brand/campaign specialist for assigned leaves; coordinator shared schema/auth/env/orchestrator; independent security/UX reviewer. Prerequisites: phase01 shared foundation + phase02 UI; parallel with creator03 after exclusive assignment.

## 04.1 Company voice/text identity, sources and resume

- Objective: company/contact/role→optional website→social mapping→confirmation/consent→review→missing country/timezone/private verification/markets/currency→portfolio→private save/eligible share→optional first campaign.
- Prerequisites: shared server draft/input cards/jobs; representation and country-aware verification interfaces.
- Allowed paths: brand onboarding domain/screens/routes/dictionary/tests; shared signup/orchestrator/config/schema read-only.
- Contracts: no-website/social-only/manual path equal capability; conversation does not prove authority; voice/text same commands; private contacts; sourced edits invalidate dependency versions; original language preserved.
- Failing acceptance: no website can finish private portfolio; URL/generic email alone cannot public-publish; same/different social rows remain editable; provider partial/resume survives; mic-denied typed path and language toggle preserve answers; forged tool/import without consent rejected.
- Implementation: short role-specific cards/validators, editable account map/source confirmation, private contact/country/timezone/markets/currency questions only when absent, pending business/representative proof separate statuses.
- Failure states: permission/provider/verification/representation/session error→private draft/manual/resume; no forced campaign/publication.
- Validation/review: Arabic360 and English desktop no-website/social/manual paths, denied mic/refresh/background; independent reviewer checks permissions and source invalidation.

## 04.2 Bounded safe website import and fact review

- Objective: consented public company facts/assets collected without SSRF/prompt instruction leakage.
- Prerequisites: current security guidance reviewed, central consent/jobs/caps, reviewed destination-validation transport and byte/time budgets.
- Allowed paths: `src/lib/imports/website/**`, brand fact review screens/DTO/tests; shared network/env/storage/schema modifications coordinated centrally.
- Contracts: confirmed HTTPS origin443, initial5pages/depth1/3redirects/1MiBresponse/5MiBtotal/20s; connection-time DNS/IP validation every redirect including assets; no forwarded credentials; downloaded content untrusted; source/date/approval retained.
- Failing acceptance: localhost/private/metadata/IPv6-mapped/rebinding/redirect-to-private/embedded credentials/other port rejected; oversized/slow response bounded; page instruction cannot change tool/publish/verification; imported logo not fetched unrestricted; missing conflicting facts remainunknown.
- Implementation: canonical URL validation/public-origin crawl/access policy, constrained retrieval and selected asset pipeline, schema-validated overview/products/services/sectors/links extraction, source-linked editable fact cards and exclusion; manual data when absent.
- Failure states: blocked URL/robots/access requirements/DNS/timeout/quota/extraction/cap→visible unavailable/partial/manual; no arbitrary authenticated fetching.
- Validation/review: controlled synthetic servers/DNS fixtures and actual adversarial retrieval tests; independent SSRF/security review; prove connection-time protections, not regex-only URL tests.

## 04.3 Company generated portfolio and representation-gated sharing

- Objective: editable approved-source company portfolio with private default and explicit publication.
- Prerequisites: reviewed facts/unique slug/schema; shared generated asset/projection; approved representation proof methods.
- Allowed paths: brand portfolio/profile/verification modules/screens/API/DTO/tests; assigned `/brands/[slug]` route; coordinator public export/SEO mounts.
- Contracts: no invented clients/logos/testimonials/certificates/results; manual template if AI unavailable; email+accepted representation proof for public, independently of CR; unique slug; private contacts/proof excluded.
- Failing acceptance: conflicting slug rejects atomically; generic mailbox/website-only record cannotpublish; fact edit stales generated sections; AI failure still manual/save; private data excluded public/export/index; optional campaign does not gate profile save.
- Implementation: versioned fact-based sections/products/brand links/genuine examples, per-section edit/regenerate/reapprove, visibility preview/private save/publish/share with proof status; source-approved context for first campaign.
- Failure states: generation/cap/slug/proof/network→manual/pending/private draft; published proof revocation invalidates projection/cache.
- Validation/review: own versus unrelated/company public projections, generation/error/visibility browser; independent reviewer checks real representation proof and publication conditions.

## 04.4 Equal form/chat/paragraph campaign input and immutable approval

- Objective: three entry methods converge on complete editable original-language requirements and versioned approved brief.
- Prerequisites: central CampaignRequirementsDTO/money/time/taxonomy; inherited Anthropic pipeline reviewed; approved company context and ownership.
- Allowed paths: brand campaign/brief/screens/API/dictionary/tests; root schema/env/models/money unchanged by track.
- Contracts: explicit markets/audience/languages/dialects/platforms/deliverables/currency/budget/count1–12/impressions target/dates/timezone/travel/tone/no-go/tier/trust/licence/usage/KPI; one focus/turn≤5 actual clarification questions; no guessed country/currency; every material field editable.
- Failing acceptance: paragraph/chat cannot invent missing market/currency; AI failure leaves formsave/approval path; greetings don't consume five; sixth clarification prohibited; invalid format/precision/date rejects; nonowner cannotapprove; material edit creates new version/stales old match without rewriting deal.
- Implementation: equally prominent form/chat, validated paragraph extraction/prefill, missing-required prompts/market-sensitive chips, structured brief generation/edit/manual fallback, owned explicit approval freezing revision; campaign lifecycle helpers.
- Failure states: invalid/missing/AI/network/cap/session→editable partial draft/retry/manual; duplicate approval idempotent. No automatic matchingGET/unguarded lifecycle PATCH.
- Validation/review: form and chat reach same valid model, non-Saudi markets/currencies/timezones, original-language toggle, revision/conflict/race tests; independent reviewer compares schema/UI completeness and immutable approved version.

Phase exit: website/no-website/private/public proof paths reviewed; form/chat produce editable approved version; source safety/verification/visibility accurate; four gates plus appropriate browser/DB tests. Current market legal/verification/provider evidence remains separately pending if absent.
