# Phase00 — reuse, development and research foundation

Status: planned/in progress; no phase exit is asserted. Owner: coordinator, with bounded planning/design specialists and independent reviewer. Source revision `b001002526c7952da97268c75dbeb9ae21414d9b`, isolated full clone branch `infame/mvp`. Read both handoffs completely; their instructions supersede dated source extraction/demo claims.

Dependency order:00.1→00.2/00.3/00.4/00.5;00.2+00.3+00.4→00.6. Research can run alongside environment work. Do not begin dependent product slices before shared runtime contracts/isolation are reviewed. Preparatory failures stay explicit.

## 00.1 Source provenance and per-module reuse inventory

- Objective: preserve actual source/history/user work and map each inherited responsibility to reuse/adapt/replace/add/retire with a reason.
- Prerequisites: both handoffs; local repository instructions and common Git directory inspected; authorized Infame conversion scope.
- Allowed paths: coordinator `docs/REUSE_INVENTORY.md`, `docs/PROGRESS.md`, project instructions/README; planning owner only its assigned records. Git actions confined to isolated Infame; source Talaqee read-only.
- Contracts: D001–D007; preserve migrations/source work; CLIENT→BRAND/PROVIDER→CREATOR/Project→Campaign/Match-proposal→real Deal semantics reviewed individually.
- Failing acceptance: proposed provenance/isolation check must reject source workspace/common-dir and source `talaqi` database identity; inventory fails if DTO visibility, padded matcher, paired-language data, demo AI/generation, destructive seed or auth recovery gaps are unclassified. Record observed preimplementation behavior rather than fabricate a failed test.
- Implementation: inspect tracked/untracked Git state/remotes/tags; create isolated branch/clone without overwriting; inventory manifest/lock/runtime/source routes/DTOs/auth/schema/migrations/runner/seeds/specs; record exact revision and superseded instructions.
- Failure states: missing source/remote, preexisting branch work, conflicting instructions or undocumented schema history → retain evidence, do independent planning, do not scaffold replacement or erase work.
- Validation/review: independent reviewer compares inventory to inherited paths and Git provenance; coordinator records checks/revision. No completion percentage inferred from source demo tag.

## 00.2 Disposable development/test targets and reusable Cloud preparation

- Objective: reproduce inherited app with separate fresh Infame development/test/E2E targets and reusable startup.
- Prerequisites:00.1 runtime/runner/seed inspection; no copied `.env` or source production/customer data.
- Allowed paths: coordinator `scripts/**`, `.gitignore`, `.env.example`, environment config and `docs/DEVELOPMENT.md`/`CLOUD_SETUP.md`; dependencies only through coordinator.
- Contracts: fresh secrets; not port5544/source persistent data; unique task/parallel-suite identifiers; ignored local config; safe explicit reset refuses production/ambiguous/non-disposable targets.
- Failing acceptance: isolated-target guard rejects `talaqi`, port5544, production env and development=test URL; fresh DB health query/migration/seed rerun must fail honestly before setup exists; reset protection tested without destructive source connection.
- Implementation: adapt inherited embedded Postgres or prove supported task-local service; readiness/connectivity/schema checks; retain migration history; replace destructive seed with idempotent synthetic data. Capture exact tested install/start commands. Verify current official Cloud docs/UI; prepare Install script/Start skill and exact Save>Publish steps. Restart/reconcile services per task without silent reset.
- Failure states: native runner unsupported/download/network/auth/connection error; allowlist does not prove native DB; document actual limitation and separately provisioned disposable alternative, continue code/contracts. No paid service purchase. Local success is not Cloud publication evidence.
- Validation/review: actual SQL target identity/connectivity, separate targets, repeat migration/seed counts, resume preserves data, app starts. Independent operations/security reviewer checks guards. Publication/fresh-task verification remains external until observed.

## 00.3 Missing harness, baseline and compatible security corrections

- Objective: establish runnable meaningful Vitest/Testing Library/Playwright/CI and resolve inherited check/security failures without gratuitous upgrades.
- Prerequisites:00.1 manifest/lock installed/runtime evidence; coordinator inspects installed Next guides before code.
- Allowed paths: coordinator package/lock/config/.github and shared `tests/**`/`e2e/**` harness; existing product edits only explicitly assigned reviewed fixes.
- Contracts: preserve compatible stack; tests never use reference/production targets; no false passing empty/skipped suite; four gates before adaptation commit.
- Failing acceptance: add a genuine contract/import/env invariant currently absent or broken and run it; harness must detect failed assertions. Record inherited lint/build/audit failures separately. Planned browser smoke must detect broken auth/nav or unavailable app, not pass skipped.
- Implementation: locked install/Prisma generate; baseline TypeScript/lint/build and dependency audit; pin/add compatible harness; reviewed security update with rationale/API guide/audit evidence; CI distinct type/lint/unit/build/E2E jobs and isolated DB setup.
- Failure states: tool unsupported, browser dependency unavailable, inherited errors, audit findings, incompatible upgrade. Report exact command/revision/failure; repair required checks before claiming gates green.
- Validation/review: TypeScript, warning-free ESLint, Vitest with nonempty required suite, Next build; meaningful browser smoke in supported environment; independent reviewer verifies change relevance and findings. Coordinator-reported starting baseline belongs in evidence reports.

## 00.4 Contracts, plans and exclusive owners

- Objective: freeze canonical types/visibility/state/money/matching and actionable phase ownership before delegation.
- Prerequisites:00.1 source audit and complete handoffs.
- Allowed paths: planning specialist `DECISIONS.md`, `CONTRACTS.md`, `OWNERSHIP.md`, `FOUNDER_DEPENDENCIES.md`, plans00–08; coordinator runtime `src/lib/contracts/**`, domain adapters/schema when phase01 begins.
- Contracts: one enum/vocabulary/offer schema/currency/aggregation source; root shared files and nonoverlapping domain leaves; independent reviewer cannot fix their reviewed implementation.
- Failing acceptance: contract review fails if creator/brand signup overlaps, partial quote masquerades as full, DTO can expose proof/contact, stale handle completion attaches, money floats, old matching padding survives, or state/rating boundary is unspecified.
- Implementation: distinguish confirmed/default/pending/overrides; narrow task paths; specify dependency and handoff evidence; send schema changes to coordinator; validate canonical runtime exports with implementation tests in01.
- Failure states: contradictory enums/source policies or uncertain external rules; coordinator resolves reversible defaults with ledger; dependent live rules remain disabled/review-pending.
- Validation/review: independent reviewer checks requirements crosswalk and exact enums/DTO semantics; coordinator acknowledges contracts before workers implement. Planning documents alone do not pass runtime acceptance.

## 00.5 Studio/public catalogs and actual Figma composition

- Objective: investigate complete accessible catalogs/account resources and select compatible licensed primitives based on actual source, then concrete design handoff.
- Prerequisites: authorized existing Studio/Figma access; available connector/browser/CLI observed; public indices accessible.
- Allowed paths: design owner `docs/SHADCN_RESEARCH.md`, `UI_COMPOSITION.md`, assigned research/Figma handoff artifacts; coordinator alone mutates components/config/dependencies.
- Contracts: indexed/read/unavailable separate; all overviews read, selected API/examples/source read; actual premium resources/licence tracked; no secret values; no full starter replacement/all-component install.
- Failing acceptance: mapping review fails for absent required route/state, undocumented selected component/source compatibility, fabricated authenticated access/frame links, incomplete catalog claimed complete, or untested Studio RTL.
- Implementation: llms/sitemaps/registry indexes; paginated CLI search/help/version and bounded read cache; inventory variants/blocks/pages/templates/themes/illustrations/Figma. Frame Arabic360/mobile and English desktop onboarding/account/fact review/portfolio/discovery/brief/deals plus error/empty/permission/resume; map variables/slots/interactions to code.
- Failure states: unauthenticated premium/MCP unavailable/docs errors/licence uncertainty; record exact missing resources and use public compatible work while dependency resolves. Figma mutation follows applicable skills; no invented handoff.
- Validation/review: design/accessibility reviewer inspects coverage/source licences and prototype critical journeys; selected source/API and actual frames prerequisite for customized block implementation in02. Catalog access alone is not UX acceptance.

## 00.6 Early real voice/card/draft feasibility slice

- Objective: prove shared server draft and Arabic speech/transcript/interrupt/text fallback before estimating signature delivery.
- Prerequisites: isolated targets/harness/contracts; current official model/voice APIs verified and capability mode explicit.
- Allowed paths: coordinator shared `src/lib/voice/**`, `onboarding/shared/**`, AI budgets/contracts and shared prototype UI/tests; role-specific fields only contract prototype, not unreviewed domain mutations.
- Contracts: trusted atomic cap/termination, server-only keys, no raw audio default, actual state indicator, mic only for speech, same text/voice command/revision.
- Failing acceptance: denied-mic text command must persist; interrupted playback must stop; refresh must not replay completed paid call; concurrent reservation must reject cap bypass; stale revision command409. Live Arabic phone checks fail/unavailable honestly before configured provider.
- Implementation: provider-neutral bounded server speech or proven scoped realtime; persist command/draft/revision/operation keys; demonstrate name→card→fact draft→manual portfolio template; measure real prototype duration/latency/cost before cap/estimate decision.
- Failure states: permissions/provider/network/budget/background/session expiry →pause/resume/text/manual; no fake connected animation counted live.
- Validation/review: independent verifier exercises test+real Arabic female voice phones/weak network/headphones if available; records which checks mocked versus live. Prototype feasibility does not satisfy all onboarding launch criteria.

Phase exit: source inventory, honest baseline/gaps, guarded disposable connectivity/migrations/idempotent seed/app startup, shared contracts/owners, reviewed source selections/design progress and measured voice feasibility status. All four gates required for coherent adaptation commits; unavailable Cloud/Figma/live evidence remains tracked, never marked passed.
