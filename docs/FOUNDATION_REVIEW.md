# Independent foundation review

Reviewed on 2026-10-01 in `C:/Users/Asus/Claude_Code/Infame`, branch `infame/mvp`, inherited HEAD `b001002526c7952da97268c75dbeb9ae21414d9b` with the coordinator's uncommitted foundation changes. This review owns only this document. The original Talaqee checkout was inspected read-only and was not changed. No actual database reset was run.

**Result:** 48 independent environment assertions passed, both supported and direct Vitest runs passed their three isolation tests, and five additional HTTP authorization assertions passed. The result supports the reviewed local isolation, resume and safe-seed boundaries. It does not establish Infame MVP, Cloud, live-provider or launch acceptance. A coordinator dependency reinstall later failed with Windows EPERM while its development server remained running; the final repaired installation and gates must be recorded separately.

## Scope and evidence boundaries

- Read both supplied handoffs completely and audited the inherited repository; the source-backed domain inventory is in `REUSE_INVENTORY.md`.
- Read the Infame start skill and startup/environment instructions, then reused the existing generated task only after native identity verification. Actual task credentials were used in memory for their intended synthetic local targets and were never printed or copied into this document.
- Reviewed `scripts/db.mjs`, `scripts/task-state.mjs`, `scripts/task.mjs`, `scripts/gates.mjs`, `prisma/seed.ts`, `tests/setup.mjs` and `vitest.config.mts` independently of their implementation.
- Exercised guards with synthetic invalid arguments and poisoned ambient URLs. A poisoned URL contained invented credentials and named the source port/database; guarded commands derived their own task target, and no connection to the original source database was made.
- Read database identities, markers, completed migration records and existing synthetic users through native PostgreSQL connectivity. Only the explicitly authorized safe seed mutated the current development target. Concurrent initialization and interrupted-resume tests used newly generated scratch task configurations without starting another database.
- Rechecked the source checkout: inherited HEAD and `main` remained unchanged, with its pre-existing untracked `scripts/check-fork.sh` preserved.

The standalone review harnesses asserted outcomes and exited successfully. They were not added to product code. One first attempt at the scratch resume harness stopped because of a reviewer variable-name typo after seven assertions; the corrected complete eleven-assertion run passed. This was a harness error, not a product failure.

## The 48 completed assertions

### Target, production and reset boundaries

| # | Assertion | Observed result |
|---|---|---|
| 1 | Initialize with `NODE_ENV=production`. | Refused before state/configuration mutation. |
| 2 | Run a local operation with `INFAME_ENV=production`. | Refused. |
| 3 | Request test reset with the wrong disposable task flag. | Refused before SQL; no reset executed. |
| 4 | Request development reset, including the matching task flag. | Refused before SQL; no reset executed. |
| 5 | Invoke an unknown task action. | Refused before SQL. |
| 6 | Run the test action against the development kind. | Refused before SQL. |
| 7 | Run the E2E action against the development kind. | Refused before SQL. |
| 8 | Supply a foreign `INFAME_TASK_ID`. | Refused. |
| 9 | Hash state and all three environment configurations around the refused commands. | All bytes preserved. |
| 10 | Validate an in-memory state using source port `5544`. | Refused. |
| 11 | Validate an in-memory development target named `talaqi`. | Refused. |
| 12 | Validate an in-memory cluster directory pointing at the source `.pgdata`. | Refused. |
| 13 | Validate an in-memory test target named `talaqi`. | Refused. |

### Native identity, retained migrations and safe seed

| # | Assertion | Observed result |
|---|---|---|
| 14 | Run guarded development verify with a poisoned ambient source URL. | Passed using its own generated target. |
| 15 | Read native development database/server/marker identity. | Exact task development database, `127.0.0.1`, exactly one matching marker. |
| 16 | Read development migration history. | Both inherited migrations completed, with no rollback record. |
| 17 | Inspect the development public schema marker. | No public disposable marker; metadata lives in `infame_task_meta`. |
| 18 | Run guarded test verify with a poisoned ambient source URL. | Passed using its own generated target. |
| 19 | Read native test database/server/marker identity. | Exact task test database, `127.0.0.1`, exactly one matching marker. |
| 20 | Read test migration history. | Both inherited migrations completed, with no rollback record. |
| 21 | Inspect the test public schema marker. | No public disposable marker. |
| 22 | Run guarded E2E verify with a poisoned ambient source URL. | Passed using its own generated target. |
| 23 | Read native E2E database/server/marker identity. | Exact task E2E database, `127.0.0.1`, exactly one matching marker. |
| 24 | Read E2E migration history. | Both inherited migrations completed, with no rollback record. |
| 25 | Inspect the E2E public schema marker. | No public disposable marker. |
| 26 | Run the first authorized guarded development seed. | Succeeded. |
| 27 | Repeat the authorized guarded development seed. | Succeeded. |
| 28 | Hash every existing synthetic User row before and after both seeds. | Identical rows; two users before and after. |
| 29 | Check the seed's user roles. | No administrator fixture. |
| 30 | Inspect initializer and target locks after the commands finish. | No leftover operation locks. |

The inherited migrations are `20260703133905_init` and `20260703181239_match_decline_reason`. Metadata isolation resolved the earlier Prisma P3005 bootstrap problem while retaining the inherited migration history. These assertions inspected completed state, rather than assuming a successful command proved the database identity.

### Concurrency and interrupted initialization

| # | Assertion | Observed result |
|---|---|---|
| 31 | Start two concurrent initializers for the current task. | At least one succeeded; the other either preserved the task or refused exclusive-lock contention. |
| 32 | Compare current state/configuration bytes after concurrent resume. | All bytes preserved. |
| 33 | Hold the test operation lock and invoke a second verify. | Refused with exclusive-file contention. |
| 34 | Release the test lock and verify again. | Succeeded. |
| 35 | Concurrently initialize a fresh scratch workspace. | One coherent fresh task; competing invocation succeeded coherently or refused contention. |
| 36 | Compare scratch and current task identities. | Fresh scratch identity, different from the current task. |
| 37 | Validate all three scratch environment configurations. | Consistent generated credentials and matching per-kind targets. |
| 38 | Remove only scratch `.env.e2e.local` and resume initialization. | Recreated byte-identical configuration from existing state. |
| 39 | Hash scratch state and the other configurations around reconciliation. | Existing state and configuration bytes preserved. |
| 40 | Set a foreign task ID only in one scratch configuration and resume. | Refused without overwriting the mismatched file or state. |
| 41 | Inspect scratch initializer lock after success and refusal. | No leftover initializer lock. |

### Direct test-runner safety and migration provenance

| # | Assertion | Observed result |
|---|---|---|
| 42 | Run direct Vitest with a poisoned ambient source URL. | Refused before tests. |
| 43 | Run direct Vitest in production mode. | Refused before tests. |
| 44 | Hold the test lock and run direct Vitest without its inherited token. | Refused with exclusive-file contention. |
| 45 | Release the lock and run direct Vitest against the native task target. | Identity validated and all three tests passed. |
| 46 | Inspect the direct runner's owned lock after completion. | Released. |
| 47 | Compare the initial migration SQL with the original Talaqee checkout. | Byte-identical. |
| 48 | Compare the decline-reason migration SQL with the original Talaqee checkout. | Byte-identical. |

Also ran `node scripts/task.mjs test test` with a poisoned ambient source URL: three Vitest tests passed. Direct Vitest likewise passed three tests after its refusal checks. The supported command derives the test URL from task state and passes a private operation-lock token to global setup; direct invocation acquires its own lock instead.

## Page and API authorization review

Reviewed `src/lib/auth.ts`, `src/lib/api.ts`, `src/lib/jwt.ts`, `src/proxy.ts`, and all inherited role-dashboard server loaders and layouts. The installed Next guide at `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md` requires proxy placement beside `src/app` and describes proxy as an optimistic check. The coordinator moved it to `src/proxy.ts` and added independent server checks.

`getSession()` now verifies the JWT and reads the database user's current `active` and `role` values. It returns a session only for an active existing user whose stored role matches the token. `requirePageSession(role)` redirects missing sessions to login and a valid wrong-role session to its role home. Each inherited Prisma loader under the following paths now calls this role guard before protected reads:

- `src/app/admin`: layout, overview, users, providers, categories, projects, briefs and analytics.
- `src/app/client`: layout, overview, profile, chat, brief, matches, projects and project detail.
- `src/app/provider`: layout, overview, profile and requests.

Settings pages inherit their protected role layouts and do not contain their own protected Prisma queries. Client project detail additionally checks project ownership; brief/match loaders constrain project selection to the current client, and provider queries derive the provider from the session user. `requireSession()` calls the authoritative `getSession()` before its older active cache, so a cached active flag alone cannot authorize an inactive or role-changed user. Database read failures prevent a session from being returned.

Five supplemental independent HTTP assertions passed against the coordinator's local inherited application on `localhost:3210`:

| Assertion | Observed result |
|---|---|
| Anonymous `/client`. | 307 to `/login?next=%2Fclient`. |
| Anonymous `/provider`. | 307 to `/login?next=%2Fprovider`. |
| Anonymous `/admin`. | 307 to `/login?next=%2Fadmin`. |
| Anonymous `/api/me`. | 401. |
| Validly signed ADMIN JWT for a nonexistent synthetic user, requesting `/admin`. | 307 to `/login`, demonstrating the server's database existence check after proxy verification. |

Earlier independent `GET /` returned 200. No authorization probe changed user rows. The next supplemental signed-token role-mismatch request was interrupted when the coordinator's reinstall partially removed dependencies while the old server remained running. The reviewer stopped further requests at the coordinator's instruction. That incomplete probe is **pending**, not a pass or an authentication finding. Valid fixture API access and cross-role navigation probes that followed it were not reached and are also pending.

The coordinator separately reported four passing Playwright baseline checks at Arabic 360px and English 1440px after initially observing two failures caused by proxy placement, and four passing gates before the subsequent reinstall. Those are coordinator evidence, not additional independent assertions. Repeat the gates and browser/auth probes after the repaired installation, with build and development-server lifecycle kept separate.

This remains the inherited `CLIENT`/`PROVIDER`/`ADMIN` domain and `talaqi_session` cookie. Legacy routes have been guarded, not yet retired. Canonical `BRAND`/`CREATOR` conversion and session-version/password-reset revocation are not implemented by this foundation review.

## Resolved issues and remaining limits

The reviewed revisions resolve the originally reported task bootstrap, target and test-runner issues: exclusive initializer creation; missing-environment reconciliation without credential replacement; validation of all three startup targets; pre-SQL action/kind/reset guards; existing exact-one markers for seed/reset/test/verify; metadata outside Prisma's public schema; per-target exclusive operation locks; and explicit guarded test execution. Repeated native verification and safe seeding exercised the normal paths.

The first review found a non-blocking robustness issue in `scripts/task.mjs`: the PostgreSQL connection/identity/marker sequence had no client-level `try/finally`, so a guard rejection could retain a socket after releasing the operation lock. The subsequent reviewed correction puts `client.end()` in `finally` and adds a five-second connection timeout. The follow-up below verifies the marker-rejection cleanup through an instrumented control-flow test. A query timeout remains a possible robustness improvement; the shared marker was not mutated for review.

Lock creation fails closed after a crashed process; the initializer lock does not contain an owner identity. Recovery must inspect the owning process before removing a stale lock. No crash recovery, malicious local-file tampering, production reset, actual destructive reset, remote database target or live provider was exercised. Mode `0600` is requested by Node but this review did not independently certify Windows ACL enforcement.

The current review has not accepted a Cloud environment: actual Cloud setup, task-local disposable provisioning, verification-before-prepare, fresh-task setup and resumed-task reconciliation still need a real Cloud run. Live delivery, billing, Arabic mobile voice behavior, licensing/privacy/agreements, full role journeys and phase-specific concurrency remain pending.

Two ignored scratch directories remain under `.infame`: `review_2623170c6595` and `review_826ae70d2155`. They contain generated review configurations and script copies, have no running database, and are not committed or published. Automatic approval review rejected the validated PowerShell recursive scratch cleanup before execution, reporting only “blocked by policy.” No alternate deletion route was attempted; the coordinator explicitly instructed that the ignored scratch directories may remain documented.

## Canonical schema, migration and visibility acceptance notes

These are prerequisites for the next phase, not claims that the corresponding behavior already exists.

| Area | Acceptance evidence required before canonical exposure |
|---|---|
| Migration history | Keep both inherited migration SQL files byte-identical; append canonical schema migrations. Demonstrate full fresh replay on a disposable target and incremental application on a seeded inherited target without resetting or bypassing history. |
| Legacy data and routes | Retain service tables only behind an explicit legacy boundary. Retire inherited service APIs, server loaders and client flows before exposing canonical roles; canonical queries must not fall back to service profiles/matches or infer consent from legacy approval flags. |
| Canonical ownership | Use explicit creator/brand ownership relations and database uniqueness/foreign-key constraints. Prove one account cannot read or mutate another's social connections, evidence, brief, offer, conversation or deal by guessing IDs. |
| Visibility | Default unclaimed, test, hidden and unproved records private. Exercise anonymous, unrelated authenticated, owner, permitted participant and administrator views through the same server visibility policy. Include profile/discovery/SEO/sitemap/export/media/AI-context surfaces. |
| Evidence | Store provenance, submitted values and review decisions; preserve reviewed evidence history and model corrections separately. Publishing a profile, linking an account and awarding a badge need explicit accepted evidence; expiry or revocation must affect cached output. |
| Authentication | Introduce canonical roles consistently in schema, runtime validation, sessions and routing. Prove suspension, role changes, password reset and session revocation invalidate existing sessions at page/API boundaries. Verify trusted-origin policy, delivery limits, verification challenges and administrator access decisions. |
| Briefs and language | Preserve original-language content; approval locks an explicit brief version. Draft editing, approved evidence, matching input and offers must reference the intended version, with authoritative typed/text onboarding validation independent of AI output. |
| Offers and deals | Use immutable accepted terms/agreement snapshots and explicit participant authorization. Exercise accept/withdraw/counter/expiry races over separate connections and enforce the permitted active-deal uniqueness in the database. V1 must not move money. |
| Matching | Canonical eligibility, evidence visibility, confidence floor and currency/geography/language must precede scoring. Prove deterministic ranking, strict 60/top-12 limits, no padding below confidence floor and no hidden/test/unclaimed leakage. |
| Deletion and privacy | Demonstrate profile deletion/anonymization behavior while retaining required participant agreement/audit history. A public profile toggle must not silently make private submitted evidence public. |
| Tests and environments | Each phase uses its own guarded disposable target and locks. Integration/concurrency tests need native identity evidence, relevant failure-path assertions and completed TypeScript/lint/test/build gates. Actual Cloud and provider evidence stays distinct from fixture/local evidence. |

## Reviewed script snapshot

These SHA-256 values identify the reviewed script snapshot, not a final committed release. Later coordinator changes require their relevant checks to be repeated.

| Path | SHA-256 |
|---|---|
| `scripts/db.mjs` | `1903FF0CA8932883E637537E206702C88B58B34211C188BE29FCF2A29EA27C22` |
| `scripts/task-state.mjs` | `488C8B79224C01701B9FDDE66787C98C231ABE96404E8DAD4ED4C3925426873A` |
| `scripts/task.mjs` | `126CD8B0DEEB783D2C75FCDAD032D93F5E260ACFA87F288CC3B7CA6920D41345` |
| `scripts/gates.mjs` | `48C13C440932496AC78FAA33E71DEE1AA69A194B65CA7DFB7789F343FCB62AFB` |
| `prisma/seed.ts` | `86C459EBEFE2441B8480C51F89E5D2DA04B1D3BBCF363F8AC6A41412A6A0C9B6` |
| `tests/setup.mjs` | `1DC203C95379BCE24574D7B0E2B9FDDA10A6775E508D42A361C70F70AAC60A7C` |
| `vitest.config.mts` | `F6353DA05B29E7036CD2BCBA5D21DC93F63FAE19B83E300D2A8CF84F3D4E7631` |

## Follow-up: initial money, vocabulary and offer contracts

The coordinator assigned a bounded independent review of `src/lib/contracts/{money,vocabulary,offers}.ts`, their three test files, `scripts/stop-db.mjs` and the `task.mjs` cleanup correction. Product code remained read-only. Reviewed against the handoffs, `CONTRACTS.md` and the decision ledger; framework code was outside this assignment.

Native `node scripts/task.mjs verify test` passed immediately before targeted execution. Direct Vitest used the existing global setup to validate the task-local test identity/marker and acquire its exclusive lock. Command:

```text
node node_modules/vitest/vitest.mjs run tests/contracts-money.test.ts tests/contracts-vocabulary.test.ts tests/contracts-offers.test.ts
```

All three files and **19 tests passed**. This is a local contract-test result, not live provider or consequential deal-state acceptance.

### Source verification and additional cases

Fetched the current [SIX ISO 4217 XML](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml) directly: HTTP 200, publication `2026-09-17`. After the declared exclusion of fund and nonnumeric minor-unit rows, all **155** supported code/precision pairs matched `CURRENCY_PRECISION`, with no missing, extra or incorrect entries. The web reader could not consume XML, so the reviewer parsed the original fetched XML rather than substituting ICU as a settlement-precision source.

Country validation rejects reserved/user-assigned codes and includes 249 unique entries. Comparison with the [UN M49 overview's ISO-alpha2 column](https://unstats.un.org/unsd/methodology/m49/overview/) found all 248 codes represented there; the one additional local entry is `TW`, which that UN table does not include. This comparison is not a claim that the reviewer independently downloaded ISO's complete maintained 249-code dataset. The [ISO country-code overview](https://www.iso.org/iso-3166-country-codes.html) identifies its maintained Online Browsing Platform as the authoritative current set.

Fifteen additional independent pure-contract checks passed:

1. Parse/format round trip at PostgreSQL BIGINT maximum for every supported currency.
2. Reject a one-minor-unit addition above BIGINT maximum.
3. Reject negative, fractional, infinite and unsafe-integer multipliers.
4. Money allocation for counts 1–12 and zero/small/large/maximum budgets preserves exact sums, stable ordinal priority and at most one minor unit difference.
5. Integer impressions allocation matches a BigInt quotient/remainder oracle for counts 1–12 and 100 values immediately below the safe-integer boundary.
6. Combined duplicate deliverables accept count 1000 and reject 1001.
7. Every platform/format pair accepts exactly the central allowed matrix.
8. Country vocabulary has 249 unique codes and rejects `XK`, `UK`, `ZZ`, `AA`, `EU` and lowercase `sa`.
9. All 24 curated Saudi cities validate in Saudi locations and reject mismatched country locations.
10. Reject invalid UTC calendar dates, non-UTC offsets and extra date-range fields.
11. Lord Howe's 30-minute DST gap is rejected; its repeated time requires and correctly resolves either explicit offset.
12. Cairo's midnight DST gap and an incorrect Riyadh offset are rejected.
13. Offer supported-count validation uses the merged duplicate basket, preventing split-row count bypass.
14. Trimmed duplicate policy IDs and unknown offer fields are rejected.
15. Reject zero offer amounts, noncanonical minor-unit strings, excluded currency and equal start/end instants.

The money implementation uses BigInt, preserves one currency, rejects overflow and excess decimal precision, and allocates remainders by immutable ordinal. Existing tests are meaningful rather than only type mirrors. Offer terms are strict JSON-compatible schemas, preserve original text, require positive exact amount and a valid period, and reject campaign-currency or supported-basket mismatch when supplied that server context. No arithmetic, merged-count or DST defect was found in the exercised cases.

### Open integration finding: canonical enum/state drift

**P2 — fix before dependent domain integration:** `src/lib/contracts/vocabulary.ts` defines `ProfileStateSchema` as `DRAFT|PRIVATE|PUBLISHED|HIDDEN`, and its test freezes that extra vocabulary. The approved contract instead separates `PublicationStatus` (`DRAFT|PUBLISHED|HIDDEN`) from `Visibility` and `ClaimStatus`. Combining private visibility into publication state creates two competing concepts for schema/DTO/visibility owners.

The same module lacks canonical runtime schemas for `InterfaceLanguage`, `PublicationStatus`, `ClaimStatus`, `BusinessVerificationStatus`, `RepresentationStatus`, `CreatorTier`, `ImportJobStatus`, `VoiceStatus`, `GeneratedAssetStatus`, `NotificationStatus` and `AiPurpose`. Consumers cannot yet import all approved definitions from the promised single source and would otherwise duplicate enum spellings. Complete the exports and replace the ambiguous state assertion with publication/visibility/claim assertions; retain a compatibility alias only if an actual caller requires it and its mapping is explicit. This is initial runtime-contract incompleteness, not a claim that downstream domain implementations have failed their acceptance.

`validateOfferTerms` intentionally does not establish actor, ownership, availability, policy eligibility or existence/review of referenced IDs; its comments state that boundary. Supported deliverables are optional in its current context. Before active offers are enabled, the transactional service must load trusted creator/campaign context and enforce the supported basket and reviewed references on every initial offer and counter. A parser pass alone is insufficient proof of offer eligibility or agreement legal review.

### Shutdown serialization and connection-cleanup correction

The initial `stop-db.mjs` revision validated task state and the PID-file data-directory/port but ignored operation locks. An instrumented copy showed that it could reach the shutdown spawn while a target operation was represented as active. Reported to the coordinator before integration; no actual shutdown was executed.

The coordinator corrected shutdown to acquire **all three** exclusive operation locks before `pg_ctl stop`, refusing contention and releasing acquired locks in `finally`. Four instrumented checks passed: held development, test and E2E locks each prevented shutdown; acquired earlier locks were released after contention; the successful stubbed path held all three locks and released them in reverse order. Five separate production/identity/no-PID-file guards passed before binary import/spawn. The instrumentation replaced filesystem/process effects with stubs; these results verify control flow and do not claim a real PostgreSQL shutdown/restart was performed by the reviewer. An initial VM harness invocation needed correction because dynamic import requires additional VM support; the corrected stubbed run passed without changing product files.

The corrected `task.mjs` marker-mismatch path was likewise exercised with an instrumented PostgreSQL client: connected once, rejected the foreign marker, called `client.end()` once and closed/unlinked its target lock once. Its configured connection timeout was asserted as 5000ms. This resolves the earlier socket-cleanup finding after connection.

Follow-up snapshot SHA-256 values:

| Path | SHA-256 |
|---|---|
| `src/lib/contracts/money.ts` | `6B17ACCAD5D5CD903FBB278499A1AAEB84A106C22B6D6577FD19751ADC70F378` |
| `src/lib/contracts/vocabulary.ts` | `1C146261690EDB9D066017DEB439830EF86C70F2EDA664E4A974B0DAED955320` |
| `src/lib/contracts/offers.ts` | `EB76B78D207EF32EC08F84790F22794C028EA85B32412862D4DE95B1E57DCD15` |
| `scripts/stop-db.mjs` after lock correction | `7C45D600AAE28BE19136B11FB3945374F2C01342774E2B1C637442607E6472A3` |
| `scripts/task.mjs` after cleanup correction | `E3173ECBFA5223659D7A7B845EE96805B7350D915CE4B3405858EE53F191FA8C` |
