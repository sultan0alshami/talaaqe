# Independent canonical domain and identity review

Reviewer: matching specialist, who did not implement the reviewed shared files. Review date: 2026-10-04; command timestamps below are the runner's recorded times. Scope: coordinator's canonical schema/new foundation migration, identity/JWT/auth/API/rate limiter/proxy, auth routes, existing identity/foundation/rate tests and public auth callers. Product fixes remain coordinator-owned. Matching core is outside this independent review.

Status: auth race and schema/participant corrections independently rechecked, including the nullable unclaimed-owner edge. Role-home/browser integration remains coordinator-owned. This is bounded code/catalog/test evidence, not production, legal or live-provider certification. The coordinator continued edits during review; resolved findings below retain their original trigger and current evidence.

## Findings

### R1 — resolved: stale pre-reset login could mint a valid post-reset session

`src/lib/identity.ts:33` authenticates a user record/password hash read before bcrypt completes. `src/app/api/auth/login/route.ts:17` passes only identity/name/role/email to `setSessionCookie`; `src/lib/auth.ts:29` calls `openSession(userId)`. `src/lib/identity.ts:40` then reads the *current* sessionVersion and signs it. A reset between authentication and session creation upgrades stale old-password authorization to the new session version. `resolveSession` correctly rejects older versions but accepts this freshly minted new version.

Reproduce deterministically in a new fixture: authenticate using the old password; consume a valid reset token to increment sessionVersion/change password; attempt session creation from that saved authentication result; require rejection. Bind session issuance to authenticated expected sessionVersion/hash or perform appropriately locked password/session authorization. Re-reading only user ID/active does not solve it. Existing reset test opens the session *before* reset and does not cover this race.

Coordinator correction reviewed: `openSession` now requires expected sessionVersion and passwordHash, locks the User row FOR UPDATE, checks active/version/hash and creates its AuthSession inside that transaction. Both auth routes pass the successful authentication/signup context through `setSessionCookie`. The new stale authentication regression test passes in the independent 9-test rerun at 10:53:29. The root cause is resolved without promoting stale authorization.

### R2 — code resolved: token destination/active checks raced an unconditional user mutation

`src/lib/identity.ts:87` reads the user and checks active/email destination, then `:89` updates by ID only. Under PostgreSQL READ COMMITTED, a separate email change/suspension can commit between these steps. A token issued for the old destination can then mark the changed address verified; an inactive user can be mutated after the active check. Token one-use claim is atomic, but user authorization is a separate unprotected check.

Use a conditional user update with trusted destination/active/version and require exactly one row, or lock the user before checking its current state and preserve a declared suspension/email-change version policy. Add a two-connection barrier test for destination change and suspension. Existing token test covers two consumers of the same token only.

Coordinator correction reviewed: token consumption locks the User row before reading active/destination, claiming the still-unused/unexpired token and mutating the user. User changes that acquire the same PostgreSQL row lock serialize with this transaction. Same-token concurrency and reset replay remain green. A direct destination-change/suspension barrier fixture has not been independently exercised; the code race is fixed. Future email-change commands must independently clear email verification and revoke relevant authorization under their declared policy.

### R3 — resolved: exclusive accepted external-account ownership was not enforced

`prisma/schema.prisma:473` / foundation migration `:654` give SocialAccount uniqueness by creator/platform/handle. Neither the source schema nor actual disposable test catalog has a global accepted `(platform, providerAccountId)` uniqueness constraint or a reviewed handle fallback conflict constraint. Two creators can concurrently have VERIFIED ownership for the same stable provider account. The contract requires global accepted ownership proof conflict handling; application prechecks alone are insufficient.

Add a reviewed accepted-ownership constraint that permits unclaimed/pending candidate records but prevents two accepted owners of one stable provider identity; define handle fallback behavior when a stable ID is unavailable. Test competing separate connections, an ownership-revoked/release case and handle changes for the same provider ID.

Coordinator migration04 adds partial global VERIFIED `(platform,providerAccountId)` and `(platform,lower(handle))` indexes. Independent rollback-only SQL fixtures against the guarded test target rejected a duplicate stable provider ID and a case-folded duplicate verified handle with23505. Source/catalog plus these direct negative cases resolve the missing storage enforcement. Ownership release and provider-handle changes remain owning import/claim service behavior; those concurrency flows are not claimed complete by these fixtures.

### R4 — form resolved, route/browser check pending: auth callers and canonical destinations

`src/components/screens/public/signup.tsx:35`/`:73` still submits lowercase `client|provider` and legacy fields, while `SignupSchema.strict` requires `CREATOR|BRAND`. UI signup therefore fails regardless of valid password. Login still maps legacy role destinations. Proxy/auth helpers redirect to `/brand` and `/creator`; the reviewed file inventory has neither route yet. Unit auth tests do not exercise these callers.

Complete the coherent canonical signup/login/logout forms and actual protected role destinations before claiming usable auth. Verify Arabic/English browser entry, successful canonical signup/login, correct role redirect, suspended page rejection, and cross-origin mutation rejection. Domain retirement may remain explicit, but it must not strand newly authenticated users at nonexistent destinations.

Recheck: the public signup/login server pages now import `src/components/infame/auth-screen.tsx`, not the historical screens named above. The new caller sends strict CREATOR/BRAND fields, maps canonical roles and guards external `next` navigation. The historical files are unused at this reviewed entry point, so their field mismatch no longer affects signup. `/brand` and `/creator` pages are still pending in the reviewed inventory; the coordinator is completing and browser-verifying them before any slice completion claim.

### R5 — resolved: agreement snapshots were not constrained to one real offer

Foundation migration `:702` only uniquely identifies `(dealId, version)`. Actual test catalog confirms AgreementSnapshot has no `(dealId, offerVersion)` FK to DealOffer and no uniqueness on that pair. Two snapshot versions can reference the same accepted offer, or reference a nonexistent offer; immutable UPDATE protection does not enforce creation identity. This contradicts the immutable agreement-created-once contract.

Add reviewed relation and uniqueness to the deal's real accepted offer, plus transactional actor/state/current-version checks in phase06. AgreementConfirmation does bind to `(dealId, version)` snapshot, which is good; author user references and actual participant membership still need enforcement. Test duplicate and nonexistent references directly in PostgreSQL.

Coordinator migration04 adds `(dealId,offerVersion)` FK and one-per-offer uniqueness. Independent rollback-only SQL fixtures rejected a duplicate snapshot for an existing offer with23505 and a nonexistent referenced offer with23503. Offer ACCEPTED status and transactional current actor/state/version checks are still phase06 service requirements; the new FK does not itself validate accepted status.

### R6 — resolved: storage handle/slug validation differed from shared runtime contracts

Migration `:837` allows a leading underscore, whereas the Infame normalizer requires leading ASCII letter/digit. Migration `:838` permits brand slugs up to80 characters, while shared runtime/CONTRACTS specify50. DB/import paths can persist values the canonical UI/parser cannot accept. Align checks deliberately in a new migration; preserve inherited migration history and add direct SQL boundary tests. Reserved names additionally remain a publication/reservation policy, not an implied DB guarantee.

Coordinator migration04 changes these checks without rewriting migration history. Independent rollback-only SQL fixtures rejected a leading-underscore creator handle and a51-character brand slug with23514. Runtime/storage grammar boundaries now agree.

### R7 — resolved: multi-table trigger rejected valid actors

Migration04's `CASE` accesses both `NEW.senderUserId` and `NEW.userId` across distinct table record shapes. PostgreSQL binds nonexistent fields even in the inactive CASE arm. Independent rollback-only fixtures showed valid AgreementConfirmation and DealRating failing with42703 (no senderUserId), and valid DealMessage failing with42703 (no userId). Outsider fixtures also returned42703 instead of the intended23514. The six unrelated negative constraints above behaved correctly.

Coordinator migration05 now selects the actor field through separate IF statements. Independent guarded `tests/deal-constraints.test.ts` rerun passed at11:16:17: valid confirmation, rating and message actors succeed; outsiders/reversed actor roles reject with23514. A guarded read-only deployed function query additionally confirmed the inactive CASE is absent and message's sender field is selected separately. R7 is resolved.

### R8 — resolved: nullable unclaimed creator ownership could admit outsider ratings

`Creator.userId` is intentionally nullable for unclaimed profiles. Migration05 checks confirmation/rating membership using `IF NOT ((actor_role='BRAND' AND actor=brand_user) OR (actor_role='CREATOR' AND actor=creator_user))`. With a real brand, unclaimed creator and CREATOR-role outsider, the predicate becomes NULL and PostgreSQL skips the IF rejection. Message membership uses IS DISTINCT FROM and does reject this case; offer membership explicitly rejects a null creator owner.

Coordinator migration06 uses `IS NOT TRUE` for participant predicates, preserving separate actual-table actor field statements. Independent guarded deal constraint fixture at11:16:17 successfully unlinks the creator owner within a rollback-only transaction, then requires outsider CREATOR-role confirmation and rating rejection with23514. The deployed function catalog query confirms `IS NOT TRUE`. Test database encoding is UTF8. R8 is resolved without treating an unclaimed profile as an authenticated deal participant.

## Evidence and correct foundations

Independent guarded command `npx vitest run tests/identity.test.ts tests/domain-foundation.test.ts tests/rate-limit.test.ts` completed with 3 files/8 tests passing; runner start 20:17:23. These cover strong signup validation, private synthetic profile creation, suspended/version-revoked session reads, token hashing/expiry/replay/same-token concurrent consumption, role migration/history, exact JPY amount beyond 2^53 and concurrent rate budget. They do not cover the findings above. No database reset/stop occurred.

After the coordinator's auth correction, the same command independently passed 3 files/9 tests at runner start 10:53:29, including the new stale credential/reset/session issue regression. Times belong to their actual runner outputs across the resumed session; the synthetic matcher fixture clock remains 2026-10-01 and is not a claim of live metric freshness.

After UTF8 repair and migration06, independent guarded `npx vitest run tests/matching/core.test.ts tests/taxonomy.test.ts tests/deal-constraints.test.ts` passed3 files/47 tests at11:16:17 (41 pure matching,5 shared taxonomy and1 multi-case PostgreSQL participant fixture). The matching/taxonomy tests are validation of this reviewer's own module, not an independent review of matching; the real PostgreSQL participant fixture exercises coordinator-owned changes independently.

A read-only PostgreSQL catalog query through `taskState`/`assertLocalTarget(state,'test')` confirmed deployed indexes/constraints without printing any connection URL or credentials. It confirmed:

- `Deal_one_active_pair` is a partial unique campaign/creator index excluding completed/declined/cancelled history.
- `DealOffer_one_pending` prevents concurrent pending offers per deal.
- Rate uniqueness is creator/platform/format/currency; positive BIGINT amounts and nonnegative metrics are constrained.
- `Deal_campaign_brand_scope` binds the deal to the campaign's actual brand.
- The primary social account has a deferred composite creator/account ownership FK.
- Agreement confirmations have unique author/deal/version and snapshot-version FK.

Reviewed identity behavior correctly separates optimistic signed proxy checks from database-backed active/session/version authorization on API/page loaders, signs minimal HS256 issuer/audience claims, stores token HMAC hashes and enforces origin on wrapped mutations. Reset changes hash/sessionVersion and revokes existing sessions in one transaction. Rate-limit SQL uses atomic ON CONFLICT with a bounded saturating counter;12 concurrent requests with budget3 admit exactly3. Credentials/private ORM input objects are omitted from API logs. Request bodies are bounded to64KB.

## Phase prerequisites and limitations

The canonical schema is additive and preserves inherited tables/migration history. Migration04 adds formatMetrics/engagementContext JSON, profileFacts, correction visibility and licence policyVersion/reviewMethod. These provide storage; validated per-format unit/definition/window, per-field provenance/approval/visibility and reviewed market/licence loader contracts remain necessary before matching integration. Matcher handoff is in `src/lib/matching/README.md`.

Migration04 adds separate MatchDecisionRecord storage with campaign/creator uniqueness, actor FK and bounded decision values. Trusted owner/state/version mutation and transaction behavior remain service prerequisites. Deal origin/match reference, accepted agreement hash/language/legal snapshots, delivery evidence, sealed rating projection and current market-policy records remain later integration requirements; existing scaffold tables must not be called completed domain behavior. Production fixture rejection, central env/capability accessor, recovery/verification routes/browser flows, OTP/phone/fallback gates and remaining tests need their own reviewed implementation/evidence.

No independent mutation repro for R1/R2 was performed by this reviewer beyond rerunning the coordinator's guarded regression tests. R3/R5/R6/R7 used synthetic rollback-only SQL fixtures after acquiring the normal test guard and asserting the exact isolated test identity. R7/R8 additionally passed coordinator-owned real PostgreSQL fixture reruns. All fixture rows were rolled back, all connections/guards closed and no reviewer reset/stop occurred. Source/control-flow/catalog evidence and acceptance recipes were returned to the owner. This report does not certify unimplemented service behavior.
