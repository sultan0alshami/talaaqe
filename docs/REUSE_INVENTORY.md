# Talaqee to Infame reuse inventory

Updated 2026-10-01. This is an implementation inventory and baseline audit, not a release acceptance report. Both `docs/handoff/AGENT_PROMPT.md` and `docs/handoff/REBUILD_PLAN.md` were read completely from the founder's Mashhoor handoff before this audit. Current decisions and shared contracts override historical Talaqee specifications.

## Provenance and protected work

- Source checkout: `C:/Users/Asus/Claude_Code/Talaaqe/talaqi`.
- Source remote: `https://github.com/sultan0alshami/talaaqe.git`.
- Source `main` HEAD and `v1.0-demo`: `b001002526c7952da97268c75dbeb9ae21414d9b`.
- Source Git audit: `main...origin/main`, no tracked changes, existing untracked `scripts/check-fork.sh`. That file remains source work and was neither modified nor adopted as acceptance.
- Destination: isolated full-history clone `C:/Users/Asus/Claude_Code/Infame`, branch `infame/mvp`, inherited revision above. Its common Git directory is `.git` in Infame; Najdi workspace instructions do not apply.
- The conversion checkout was clean at the initial audit. Foundation changes now underway are not inherited baseline evidence. Preserve other agents' changes and record the eventual validated commit in `PROGRESS.md`.
- No actual source `.env` credentials or customer database rows were read or copied. Original Talaqee checkout/main/tag remain protected.

## Inherited instructions and stack

Repository `AGENTS.md` requires reading the relevant installed guide in `node_modules/next/dist/docs/` before framework code. `CLAUDE.md` references it. `specs/agent-contract.md` supplies useful thin server page/client screen, typed DTO, logical RTL layout, bilingual dictionary and exclusive file-ownership patterns.

The screen contract's inline-style/pixel-fidelity mandate, assumption that the foundation is complete, instruction to ignore other files' errors, fixed artificial generation timings, demo account/password references and dated configured-key claims are superseded. Historical screen specs remain references, not Infame acceptance.

Inherited `package.json` and `package-lock.json` use npm. At the inherited revision there was no `engines`, `packageManager`, `.nvmrc` or `.node-version` declaration. Lockfile baseline is Next16.2.10, React19.2.4, Prisma/client6.19.3, TypeScript5.9.3 and Tailwind4.3.2. Anthropic SDK, bcryptjs, jose, Zod4 and embedded-postgres are present. Root `proxy.ts`, async cookies and promised route parameters already reflect Next16 conventions.

Inherited scripts are `dev`, `build`, `start`, `lint`, `db` and `seed`. No Vitest/Testing Library/Playwright dependencies, test scripts or `.github` CI directory existed. No shadcn/Radix/Base UI dependency set or `components.json` existed. No tracked `.env.example` existed despite README's copy instructions, and `.gitignore` ignored every `.env*`. Runtime `.next-dev.err` and `.next-dev.log` were tracked.

## Recorded baseline evidence

These results were run and reported by the coordinator on 2026-10-01 against the inherited checkout at `b001002526c7952da97268c75dbeb9ae21414d9b`; the read-only inventory specialist did not independently rerun them. Keep their actual command output and eventual adapted rerun in `PROGRESS.md` / `DEVELOPMENT.md`.

| Check | Inherited result | Consequence |
|---|---|---|
| Runtime | Node24.19; npm12.1 | Foundation records/pins tested runtime rather than guessing from source. |
| `npm ci` | Passed | Reuse inherited npm lockfile; dependency changes require a recorded compatibility/security reason. |
| `npx prisma generate` | Passed | Existing Prisma/client generation is a working foundation. This is not migration/database connectivity evidence. |
| `npx tsc --noEmit` | Passed | Preserve thin page/screen contracts while adding missing tests and canonical types. |
| `npx next build` | Passed | Inherited application builds locally. This does not establish authenticated startup, Cloud or live provider acceptance. |
| `npx eslint . --max-warnings 0` | Failed: six errors and six warnings | Fix inherited lint debt before any adaptation commit; historical green claims do not supersede the live result. |
| Vitest / Playwright | Missing | Absence is not a passing test run. Add meaningful domain and browser harnesses. |
| Dependency audit | Eleven findings: one moderate, nine high and one critical; critical finding affects Next | Coordinator selected Next 16.3.8 as a compatible security correction. Record advisory details and post-change audit/installed-guide/build evidence; other findings need explicit disposition. |
| Disposable database / seed / app browser | Not established by this inventory | Environment owner must prove isolation, native connectivity, migrations, repeatable seeding, startup and supported browser checks. |

All four commit gates must pass after integration: TypeScript, warning-free ESLint, Vitest and Next build. Skipped tests and synthetic provider calls never count as live acceptance.

Foundation follow-up reported by the coordinator: Next 16.3.8 and a compatible npm audit fix remove the critical finding; three high findings remain through `deepmerge-ts` / Prisma configuration. A version 8 override is being evaluated after changelog review, so final dependency acceptance remains pending. Local embedded PostgreSQL startup was demonstrated on port 5644. The first migration attempt failed with Prisma P3005 because a task marker occupied the public schema. The marker is being moved into `infame_task_meta` by ALTER, preserving task state; migration connectivity and seeding remain unresolved until the corrected command is rerun. These follow-ups are distinct from the inherited baseline.

## Per-path disposition

| Disposition | Existing paths | Owner / required change | Acceptance dependency |
|---|---|---|---|
| Reuse | `src/app/(public)/**`, `src/app/client/**`, `src/app/provider/**`, `src/app/admin/**`, `src/components/screens/**` | Coordinator integrates domain owners. Keep async server pages loading JSON props into interactive client screens; adapt routes and roles as coherent slices. | Independent server/session/role/ownership checks; all navigation targets resolve; working imports/build. |
| Reuse/adapt | `src/lib/prisma.ts`, `prisma/schema.prisma`, `prisma/migrations/**` | Coordinator. Keep PostgreSQL/Prisma and development singleton; preserve migrations and add canonical domain constraints. | Guarded isolated targets, client generation, full chain deploy and migration fixture checks. |
| Adapt | `src/lib/auth.ts`, `src/lib/jwt.ts`, `proxy.ts` | Coordinator. Keep jose/httpOnly cookies/navigation guard; remap roles/cookie identity and add authoritative revocation/validated claims. | Suspension/reset immediately reject APIs and server pages across instances, without stale active caches. |
| Adapt | `src/lib/api.ts` | Coordinator. Keep error/JSON/Zod parsing patterns; add request IDs, safe logging, bounded bodies, origin/CSRF and capability failures. | Malformed/oversized/cross-origin requests rejected; errors do not expose secrets/private proof/transcripts. |
| Adapt | `src/lib/ownership.ts` | Coordinator provides shared checks; domains own approved leaves. Extend owned-project/provider patterns to campaigns, drafts/jobs/accounts, evidence/assets and deals. | Cross-actor reads/mutations fail; resource existence disclosure policy is consistent. |
| Replace | `src/lib/rate-limit.ts` | Coordinator. Replace in-memory maps with atomic PostgreSQL buckets, using declared trusted proxy/IP handling. | Concurrent workers cannot bypass auth/OTP/AI/upload/import limits. |
| Adapt | `src/app/api/auth/{signup,login,logout}/route.ts`, public auth screens | Coordinator owns shared signup. Retain hashing/email normalization/role allowlist; add stronger password policy, recovery, verification and global phone/fallback contracts. | No admin signup; one-use expiring tokens; verified offer gate; non-Saudi accounts need no Saudi number. |
| Adapt | `src/lib/{i18n.tsx,lang.ts,talaqi-data.ts}`, `src/app/layout.tsx` | Coordinator composes domain-owned dictionaries. Keep server cookie first paint and instant `lang/dir`; separate business text from UI translations. | Arabic/English key parity; toggle preserves original answers/bios/messages; isolated Infame language cookie. |
| Adapt/replace | `src/lib/dto.ts`, `src/lib/domain.ts` | Coordinator owns shared projection/contracts. Retain JSON/date conversion and typed include pattern; replace developer-domain DTOs and unchecked JSON casts. | Public/owner/brand/admin/deal projections enforce visibility before serialization; unknown metrics remain null. |
| Adapt | `src/components/shells/{public-nav,public-footer,dashboard-shell}.tsx`, role layouts | Coordinator. Keep typed role/nav composition; introduce Infame identity/tokens/dark mode and mobile bottom navigation. | 360px RTL/LTR, keyboard/focus, reduced motion, real badges; remove demo shell mode. |
| Adapt | `src/components/ui/{toast,status-chip,reason-modal}.tsx` | Coordinator. Preserve useful signatures with selected shadcn adapters; replace handwritten dialog mechanics. | Focus trap/restore, Escape, labels, accessible announcements, touch and RTL portals. |
| Replace | `src/components/ui/generation-modal.tsx` | Coordinator. Replace 850ms simulated steps/countdown with truthful job status/indeterminate progress. | UI status corresponds to actual work; failure/retry/cancellation do not invent completion. |
| Adapt | `src/lib/ai.ts`, campaign chat/brief APIs/screens | Coordinator owns central AI/env/budget; brand owns domain prompts through handoff. Keep server-only Anthropic, forced tool output, Zod brief validation and bounded validation retry. | Validated original-language campaign extraction; honest unavailable/manual path; atomic caps/timeouts/retry evidence. |
| Retire/adapt | `src/app/api/assistant/route.ts`, `src/components/chatbot/chat-widget.tsx` | Coordinator. Retire initial visitor assistant or adapt only to verified free-V1 Infame facts and platform budget limits. | No Talaqee subscription claims; every enabled call metered; honest unavailable state. |
| Adapt | `src/app/api/projects/**`, client chat/brief/project/home screens | Brand track with coordinator schema/API contract integration. Reuse orchestration; add equal form/chat entry, full editing, countries/currency/timezone and immutable approved versions. | Form works without AI; material edits create version/staleness; signed terms remain fixed. |
| Replace | `src/lib/matching.ts` | Matching track via coordinator-owned adapter/retirement. Developer skills/experience scoring becomes pure audience/evidence seven-factor scoring. | Exact fixtures, neutral unknowns, confidence floor, hard eligibility, threshold60/max12/stable ties/no padding. |
| Adapt | `src/app/api/projects/[id]/brief/approve/route.ts`, `src/app/api/projects/[id]/matches/route.ts`, client matches screen | Matching track after canonical campaign/creator handoffs. Preserve explicit mutation versus GET and acted-on decision history; add atomic versioned reruns. | Brief/strategy/evidence version is explicit; saved/dismissed/offer decisions survive reruns. |
| Replace | `src/app/api/matches/[id]/request-proposal/route.ts`, provider opportunity/request APIs/screens | Deal track. Existing status/inbox patterns inform real offers/counters/agreements; source proposal has no terms. | Shared supported-basket validator; recipient-only actions; atomic counters/confirmations/delivery/ratings. |
| Adapt | `src/app/api/provider/profile/route.ts`, provider profile screen/page, `PortfolioItem` | Creator track with coordinator schema/auth/DTO integration. Keep owner edit/portfolio composition; add social/evidence/audience/rates/handle/publication. | All input validation precedes one transaction; provenance/ownership/readiness/visibility survive edits. |
| Adapt | `src/app/api/admin/**`, admin pages/screens | Admin/growth track after shared revocation/evidence/events. Keep API admin guards and genuine queries; add queues/import/claim/taxonomy/audit. | Actor audit trail; atomic claims/idempotent import; suspension authoritative across instances. |
| Replace/retire | Admin overview/analytics pages/routes, `/api/categories`, public landing counts | Admin/public owners. Remove invented generation-time/revenue and `demoCount` activity; use observed metrics or omit. | No fake business statistics/subscription revenue; beta measures observed funnel/completed deals. |
| Adapt | `src/lib/format.ts` | Coordinator. Retain number/bidi utilities; replace bare budget/local-time rendering with exact currency and explicit timezone. | Currency precision/mismatch, date boundaries/DST and RTL amount formatting. |
| Adapt | `src/app/globals.css`, `src/app/layout.tsx`, `public/assets/**` | Coordinator after design handoff. Central `BRAND`, semantic Infame tokens, IBM Plex Arabic/Latin and selected assets replace source metadata/palette/logo. | Light/dark/360px/contrast/reduced-motion/browser evidence; Figma mapping and licence notes. |
| Replace invocation/config | `scripts/db.mjs` | Coordinator. Reuse embedded-postgres only where proven supported; fresh task credentials, names/directories/ports and readiness/resume safeguards. | No source5544/talaqi access; dev/test/E2E and parallel mutable targets separate; no credential URL logs. |
| Replace | `prisma/seed.ts` | Coordinator. Retire destructive demo materialization; small idempotent synthetic natural-key fixtures and separate production taxonomy/admin provisioning. | Second run preserves unrelated task work; refused ambiguous/production target; fixture rankings derive from real matcher. |
| Retire as release evidence | `scripts/check-hardening.sh`, source untracked `scripts/check-fork.sh` | Coordinator. Preserve provenance but supersede grep-only/fresh-history/no-migration criteria. `check-clean.sh` may remain an optional tree check. | Four actual gates plus relevant migration/browser/failure/concurrency evidence. |

## Missing capability families

1. Identity/configuration: typed brand, validated env/capabilities, recovery/email tokens, E.164 OTP/fallback, revocable sessions, PostgreSQL limits and controlled admin provisioning.
2. Shared vocabulary: ISO country/currency/precision, country-qualified cities, UTC/timezone, languages/dialects, curated niches/fame, normalized/reserved handles and platform-valid deliverables.
3. Onboarding/jobs: durable role drafts/commands, consent/revisions, per-source jobs, immutable observations versus overrides/review, generated section versions and readiness-gated publication.
4. Voice: provider-neutral real speech/transcript/interrupt states, trusted bounded usage/termination, no raw-audio default and equally capable text/manual fallback.
5. Social/evidence: capability-specific adapters, stable provider IDs, encrypted tokens, OAuth state/PKCE, account proof, metric/demographic provenance/freshness, private evidence/review and sync/disconnect.
6. Website import: confirmed-domain HTTPS443 retrieval with bounded pages/depth/bytes/time, destination/DNS/redirect/image controls and untrusted-data extraction/review.
7. Creator/company assets: exact currency rate cards, portfolios, public handles/slugs, distinct ownership/representation proof, visibility-aware profile/export and Arabic-shaped PDF media kit.
8. Campaign/matching: equal form/chat, canonical original-language requirements, immutable approved brief versions, pure aggregation/eligibility/subscores/benchmarks/exact allocation and versioned matches/decisions.
9. Collaboration: deal/offer/counter/message, immutable market-reviewed agreement, unique party confirmations, delivery/completion, direct-payment declarations and sealed ratings.
10. Trust/operations/growth: scoped advertising licence/company evidence and expiry/audit, safe preview/import, ownership-proven claims, invite/referral attribution and observable idempotent notification outbox/retry/push.
11. Public/release: complete routes, consented publication, safe PWA offline policy, visibility-safe metadata/canonical/sitemap, terms/privacy/deletion, meaningful tests/CI and setup/restore/rollback runbooks.

## Concrete inherited findings

1. **Revocation is insufficient.** `src/lib/api.ts:39` holds per-process active state for60seconds; admin invalidation reaches only that process. `getSession` and `proxy.ts` validate JWT without authoritative active/session-version lookup. Role pages/admin layout rely on proxy. Reset revocation does not exist.
2. **Auth is incomplete.** Signup accepts six-character passwords (`src/app/api/auth/signup/route.ts:13`), phones are unvalidated strings, and recovery/email/phone verification are absent. Login/signup throttles are local memory.
3. **AI failure returns unrelated demo content.** `src/lib/ai.ts:141`, `:188`, `:275`, `:321`, `:325` return scripted perfume-store content on missing key/provider failure. Replace with honest unavailable and user-fact/manual completion.
4. **Chat/persisted JSON is unchecked.** `parseChatOutput` casts arbitrary JSON at `src/lib/ai.ts:92`; `messagesOf` casts stored JSON at `src/lib/dto.ts:189`. Question count increments per request rather than actual clarification questions, including greeting/final acknowledgement cases.
5. **No atomic AI budget.** Usage logs record tokens after calls, swallow log failures and omit monetary/audio reservation/reconciliation. Public assistant does not log usage. No combined per-user/platform cap or external job idempotency exists.
6. **Matching violates Infame.** `src/lib/matching.ts:197` pads to three below threshold; developer skills/experience/rating replace audience fit. No source confidence/freshness/currency/licence/travel filter exists; top-contribution reasons can claim fit from neutral/weak inputs.
7. **Approved terms mutate.** Brief PATCH updates the sole row without version increment or approval/match invalidation. Regeneration overwrites history and resets project status even after proposals. Real agreements need immutable snapshots.
8. **Partial mutation and races.** Profile PATCH writes base fields before unknown skills/categories rejection (`src/app/api/provider/profile/route.ts:73`, `:96`, `:106`). Brief approval separately writes status/events/deletion/new matches. Proposal transitions read state then update ID without atomic state predicate/transaction.
9. **Proposal has no terms.** `src/app/api/provider/requests/[matchId]/send-proposal/route.ts` accepts no body and only sets `PROPOSAL_SENT`; negotiation/agreement/delivery is absent.
10. **Fake activity/analytics.** Admin analytics returns3.2minutes and revenue48,500/subscribers214/growth+18%; `demoCount` supplies category activity. Seed uses prototype scores with engine-derived breakdowns, which can disagree.
11. **Unsafe source setup defaults.** Runner hardcodes `.pgdata`, postgres credentials,5544/talaqi and logs a complete credential URL. Seed deletes every one of14tables; `SEED_ALLOW_WIPE`/nonproduction alone does not validate target identity or protect accidental shared data.
12. **Missing privacy/publication boundary.** DTOs lack audience-specific visibility, scoped consent/private evidence and account proof. Generic provider approval must not become identity/API/licence/company verification.
13. **Incomplete accessibility/mobile acceptance.** Handwritten modals lack dialog/Escape/focus trap/restoration mechanics; generation is timed simulation; globals lack reduced motion. Settings/profile actions still return `demoOnly` toasts.
14. **Missing explicit security configuration.** Raw env access, whole provider-error logs, absent request IDs/Origin controls and no capability-aware production rejection require central foundations.

These are code-backed conversion findings. They are distinct from the coordinator's eleven dependency-audit findings and do not claim an exploit review or production certification.

## Migration strategy: preserve history, expand, adapt, retire

Keep these files unchanged:

- `prisma/migrations/20260703133905_init/migration.sql`
- `prisma/migrations/20260703181239_match_decline_reason/migration.sql`

The inherited schema contains14models: User, Client, Provider, PortfolioItem, Project, Brief, Conversation, Match, Category, Skill, ProviderCategory, ProviderSkill, ActivityLog and AiUsageLog. Unique constraints already protect user email, one client/provider per user, one brief/conversation per project, project/provider match, skill name and taxonomy join pairs. New actor/state/version/idempotency constraints are necessary.

Apply inherited migrations to empty isolated Infame targets, then append reviewed migrations. Do not copy source rows, edit inherited SQL/checksums, point migrations at source PostgreSQL or adopt the obsolete no-history extraction rule.

1. Expand identity/security and nullable canonical Infame fields before dependent modules. Add exact money/global geography/timezone/visibility contracts once.
2. Deliberately adapt Client→Brand, Provider→Creator and Project→Campaign. `@map`/`@@map` can preserve physical names during transition; where the confirmed decision renames persisted roles, use explicit reviewed enum SQL rather than accidental drop/create. Inspect Prisma-generated SQL before applying semantic renames.
3. Add social/evidence/onboarding/rates/licence and canonical campaign-version entities. Do not force real offers or influencer analytics into service skills/price ranges/match statuses.
4. Preserve bilingual legacy columns while canonical new writes store content once with language metadata. Synthetic migration fixtures with divergent old pairs require an explicit conversion rule; never assert either column is original without evidence.
5. Bind match runs and agreement snapshots to immutable approved brief/evidence/strategy versions. Keep user decisions separate from recalculated scores.
6. Protect one active campaign/creator deal through an explicit active key or PostgreSQL partial unique index, retaining terminal deal history. Add unique version-bound confirmations, ratings, account/rate/handle/claim/idempotency constraints and transactional transitions.
7. Retire obsolete routes/fields after canonical callers and tests integrate; intentional removals belong in appended migrations.

Generate reviewed SQL with `migrate dev --create-only` only on guarded disposable development data. Prove the entire chain with `migrate deploy` on an independent empty test target and run synthetic legacy-role/content/constraint migration fixtures. Record migration status/checksums and seed/startup second-run behaviour. Production receives taxonomy/admin provisioning, never the destructive source demo seed.

## Acceptance dependencies and integration sequence

First prove lockfile install, native isolated dev/test/E2E connectivity, guarded tooling, migration chain, idempotent fixtures, inherited startup and current gates. Foundation owns shared schema/auth/env/money/visibility/commands/events before domain writers start.

Creator and brand tracks can run in parallel after shared signup/orchestrator/DTO integration. Both need handle/source correction invalidation, stale-job rejection, partial import/resume, mic-denied/text/manual completion and explicit publication cases. Matching consumes approved campaign versions plus eligible sourced accounts/rates; exact formula/allocation/unknown/currency/freshness/licence fixtures precede persistence/UI. Deals consume the shared offer validator and actor eligibility; counter/accept/confirmation race tests precede completion. Operations consume permission/audit/event contracts; provider delivery failure cannot undo a domain transaction.

Code completion needs all four gates, integrated domain/DB/browser tests, Arabic360px/English desktop journeys and independent review. Real OAuth/SMS/email/storage/voice/phone/cron/restore/rollback and professionally reviewed market terms/licences are separate launch dependencies. Catalog access, mocked voice, historical Talaqee passes and local setup do not establish these outcomes.
