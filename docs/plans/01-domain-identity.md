# Phase01 — canonical domain, migration, identity and privacy foundation

Status: planned. Owner: coordinator/foundation. Prerequisites: phase00 source/environment/harness/contracts review. Design research may continue independently; no domain track invents schema/auth/shared types. Read relevant installed Next guides before changes. Preserve inherited migrations; additive canonical models plus deliberate Role value mapping, legacy route retirement deferred until replacement slices.

## 01.1 Runtime contracts and reviewed migration

- Objective: implement `CONTRACTS.md` exact enum/shape/money/location/time/provenance/state responsibilities and necessary constraints.
- Prerequisites:00.4 freeze; isolated migrated development/test DB; schema requests from domains collected centrally.
- Allowed paths: coordinator `src/lib/contracts/**`, `domain.ts`, `format.ts`, `prisma/schema.prisma`, migrations; shared contract/migration tests.
- Contracts: RoleBRAND/CREATOR mapping; original-language content; exact BigInt/string money; stable country/city/currency vocabularies; full/partial quote; one active deal/offer/confirm/rating uniqueness.
- Failing acceptance: currencyJPY fractional/KWD fourth decimal rejected; sum overflow rejected; deterministic allocation conserves budget; invalid country-city/format/timezone/DST rejected; old paired business text cannot satisfy new DTO; migration from inherited history maps roles and does not delete source tables/data unexpectedly.
- Implementation: central parsers/Zod schemas; reviewed migration diff and SQL checks/partial indexes; create canonical creator/brand/social/evidence/campaign/version/deal/job/token entities incrementally; migration strategy/backfill documented. Do not depend on unreviewed clean reset.
- Failure states: migration drift/ambiguous data/nonrepresentable old fields →report/explicit mapping, never wipe or guess. Precision/country unknown →validation error, no silent FX/default inference.
- Validation/review: empty isolated DB and inherited-synthetic fixture upgrade; migrate deploy repeat; Prisma generate/typecheck; independent schema reviewer validates constraints/history and rollback implications.

## 01.2 Auth/signup/recovery and revocable verification

- Objective: strong creator/brand account creation, immediate revocation and country-aware offer gate.
- Prerequisites:01.1 identity/token/rate-limit schema; reviewed verification capability/policy interface; isolated email/OTP fixtures labeled development-only.
- Allowed paths: coordinator auth/jwt/API/ownership/rate-limit/proxy/config; shared auth API/pages; auth tests. Domain specialists read only shared signup.
- Contracts: signup neverADMIN, password≥12, email/reset/OTP one-use expiry/hashed storage, secure sessions/current user/version, E.164, trusted `offerVerificationSatisfied`; not universal Saudi phone.
- Failing acceptance: forgedADMIN signup, six-character password, revoked/suspended session, reset replay, OTP brute force/expiry, cross-origin mutation and arbitrary unsupported-country offer reject. Approved documented fallback test must be distinct from typed unverified phone; non-Saudi signup valid.
- Implementation: adapt inherited primitives after review; central normalized email/session/version helpers; verification/reset flows and bounded DB-backed limits; controlled admin provisioning; country-supported live/fixture/unavailable delivery adapters and explicit fallback record.
- Failure states: email/SMS unavailable, network/bad code/expired token, unsupported country, pending policy →honest pending/resend/text instructions; prevent offer until reviewed gate. No fixture in production.
- Validation/review: actual DB token/concurrency/revocation tests; browser signup/login/logout/reset/verification states; independent auth/security review. Real email/Saudi/international OTP evidence separate from fixture correctness.

## 01.3 Visibility-aware DTO projections and domain route bridge

- Objective: keep JSON serialization while centrally enforcing field/profile/asset permission and coherent migration routes.
- Prerequisites:01.1 records/enums;01.2 trusted active actor/owner context.
- Allowed paths: coordinator DTO composer/visibility/contracts/shared loaders/layout/route adapters and tests; domain leaf DTOs only delegated after export freeze.
- Contracts: trusted ViewerContext; public/brand/owner/admin projections; original-language storage; UTC/BigInt serialization; primary ownership and company representative proof publication gates.
- Failing acceptance: public/unrelated brand cannot read contacts/private screenshot/transcript/detailed restricted audience; hidden/unclaimed/test/suspended excluded from page/search/export/sitemap; `هذا حسابي` cannot publish unproved account; language toggle leaves original text unchanged.
- Implementation: projection allowlists before serialization; publication/readiness policy helper; invalidate public caches on trust/visibility changes; mount new creator/brand domain routes with temporary deliberate legacy redirects/adapters, avoiding dangling links.
- Failure states: insufficient proof/consent/permissions →draft/pending/404; missing optional metrics→null. No serialization fallback exposing full Prisma relation.
- Validation/review: actor matrix contract tests plus direct API/browser unauthorized access; reviewer tests export/index/cache parity and leaked field regressions. Retiring old routes needs complete new replacement evidence.

## 01.4 Shared taxonomy, market/licence and safe synthetic seed

- Objective: one bilingual taxonomy/geography/platform policy and source-accurate trust seed without demo fabrication.
- Prerequisites:01.1 vocab/data;01.2 admin provisioning; reviewed reset isolation guards.
- Allowed paths: coordinator central taxonomy/config/contracts/schema/seed and synthetic fixtures; no production data.
- Contracts:24 Saudi cities first curated region; global country-only/display city; fame/styles/dialects self-declared; distinct reviewed local licence/business/ownership/representation; optional preference versus mandatory reviewed rule.
- Failing acceptance: seed twice does not duplicate/delete existing unrelated synthetic rows; unclaimed seed cannot public-index/active-deal; typed licence/CR no badge; expired/revoked scope excludes mandatory eligible path; EG city cannot masqueradeSA and free city cannot match.
- Implementation: stable slug natural keys/idempotent seed; truthful documented observations/current fixture dates; trust fields/evidence privately scoped; policy registry can explicitly mark unreviewed mandatory market behavior unavailable. No fake traction/provider counts.
- Failure states: missing live current licence policy/legal review →required live feature held, not invented restriction; taxonomy duplicate/invalid parent→validation error.
- Validation/review: safe seed/idempotency/visibility/licence-date fixtures on isolated DB; reviewer checks global-versus-Saudi distinctions and legal-policy evidence limitations.

## 01.5 Durable orchestration, idempotency, AI caps and secure integration base

- Objective: shared drafts/source jobs/consent/versioning/outbox and atomic text+audio budgets used by all tracks.
- Prerequisites:01.1 tables/constraints;01.2 authorization; phase00 voice feasibility/provider registry.
- Allowed paths: coordinator shared onboarding/jobs/AI/voice/config/upload/cron authorization helpers, schema and shared tests; domain handlers supplied as bounded callbacks.
- Contracts: actor+purpose+operationKey/payload hash, stale source/mapping/fact revision rejection, spend reserve/reconcile, encrypted tokens, bounded uploads/private storage access, safe logs/outbox after commit.
- Failing acceptance: concurrent calls exceed cap without reservation must reject; same operation/key payload reuses result, different payload409; handle edit makes old job completionSTALE; uncertain billed retry not silently repeated; public proof URL unauthorized; fixture credentials/modes fail production boot.
- Implementation: reviewed central env accessor/capabilities; trusted reservation ledger and billing uncertainty states; per-source durable jobs/checkpoints/consent; validated scoped voice tools; storage adapter with expiring owner/admin access; authenticated background dispatch.
- Failure states: provider/job/cap/storage/session errors→visible partial/error/manual path, preserved successful facts; network notification failure does not undo state.
- Validation/review: actual PostgreSQL race/transaction/permission tests, denied capability states, safe logging review and required gates. Independent reviewer checks no browser-only cap or stale adoption race.

Phase exit: runtime types/schema/auth/visibility/orchestration reviewed and integrated, safe migration/seed evidence, coherent routes and four gates. Missing real providers/current legal policies remain explicitly unverified; they do not block independent creator/brand development on labeled fixtures/manual paths.
