# Phase07 — admin, growth and notifications

Status: active. Canonical evidence queues, original overview and reasoned Users/session-revocation slice are implemented and reviewed. Evidence is in `07-original-admin-overview.md` and `07-original-admin-users.md`; next bounded canonical Campaign table prerequisites are in `07-original-admin-campaigns.md`. Remaining providers/briefs/categories/analytics SSR still uses legacy data even though those APIs are retired; further operations/growth/notifications remain incomplete. Admin/growth specialist owns leaves; coordinator owns auth/schema/public SEO/cron/config. Independent reviewer. Identity/evidence contracts allow isolated admin work earlier; domain event integration depends on creator/brand/deals. Coding invite/referral flows does not authorize outreach.

## 07.1 Genuine dashboard and audited trust queues

- Objective: real counts and distinct screenshot/ownership/licence/CR/representation review.
- Prerequisites: admin provisioning, audit/identity/evidence contracts and current licence review policy.
- Allowed paths: admin service/API/screens/DTO/dictionary/tests; coordinator integrates session revocation/schema helpers.
- Contracts: every mutation admin-gated/audited; suspension immediately revokes; extraction/typed numbers no badge; scoped expiry/revocation/recheck; stable bilingual niche keys.
- Failing acceptance: nonadmin denied; counts equal actual queries without fallback MRR/traction; existing suspended JWT unusable; screenshot approval does not verify unrelated typed metrics; expired scoped licence not current; rejection reason required.
- Implementation: overview/users/creators/campaigns/niches/settings/audit and review filters; private proof/source/date/account scope; dated trust transitions and expiry/recheck reminders.
- Failure states: empty queue, inaccessible proof, unreviewed policy or concurrent review shows pending/retry/conflict; no optimistic badge.
- Validation/reviewer: actual role/proof/review/race tests, Arabic360 cards/controlled tables and English keyboard; independent reviewer checks false trust promotion and genuine counts.

## 07.2 CSV preview and ownership-proven claims

- Objective: safe idempotent unclaimed ingestion and atomic ownership transfer.
- Prerequisites: natural keys/handles/visibility/claim tokens, permission basis for real founder CSV, isolated database.
- Allowed paths: admin CSV/claims/invites services/API/UI/tests; coordinator schema/tokens/auth changes.
- Contracts: bounded preview with line errors; normalized duplicates/natural-key upsert; unclaimed/unverified brand/admin-only, not indexed; hashed one-use expiring token plus accepted ownership proof; revalidation after claim.
- Failing acceptance: repeated import neither duplicates nor deletes unrelated data; malformed/conflicting owner row has error; token alone/user assertion cannot steal profile; simultaneous claims one owner; old invitation cannot activate without fresh availability/eligibility.
- Implementation: parser/dry-run/confirmed upsert/audit/permission record; authorized contact routing and proposed terms; challenge/connection proof, transactional transfer and cache/readiness update.
- Failure states: invalid file, expired/mismatched proof, already claimed or conflict gives explicit error/manual review; no automatic public consenting user.
- Validation/reviewer: actual import/claim/token races and takeover/privacy review. Sending external invitations requires explicit scope.

## 07.3 Observable notifications and truthful referrals

- Objective: in-app/email/opt-in push after committed actions; accurate referral attribution.
- Prerequisites: outbox/cron/capabilities and domain event contracts; real delivery credentials separate from fixtures.
- Allowed paths: notifications/referrals/invites leaves/routes/screens/tests/dictionary; coordinator env/VAPID/service-worker changes.
- Contracts: state+outbox transaction, delivery after commit, unique event/channel/recipient, bounded observed retry, original-text privacy, opt-in/revoke; no WhatsApp automation or invented reward.
- Failing acceptance: email failure does not roll back accepted deal; duplicate delivery does not duplicate notice; unauthenticated cron denied; retry cap enforced; opted-out push not sent; referral replay cannot invent signup/reward.
- Implementation: read states/bell/preferences, localized bounded email, push subscription consent/revoke, retry status/safe logs/authenticated reconciliation and actual market-segmented counts.
- Failure states: unconfigured/temporary/quota/invalid subscription remains observable pending/failed/unavailable, never fake sent or production fixture.
- Validation/reviewer: transaction/idempotency/cron-negative tests and real email/push evidence when enabled; independent reviewer checks commit boundary/minimization.

## 07.4 Safe indexing, deletion and expiry operations

- Objective: only allowed published data indexed; reviewed privacy/provider lifecycle operations.
- Prerequisites: projections/cache invalidation, approved retention/deletion policy and disconnect/storage interfaces.
- Allowed paths: admin index-feed/lifecycle services/tests; coordinator public metadata/sitemap/cache/cron/deletion entrypoints.
- Contracts: hidden/unclaimed/test/private/suspended excluded; company email+representation; no private proof/transcripts; licence expiry invalidates badge; approved export/delete/purge policy.
- Failing acceptance: hide/suspend/proof revoke removes relevant cache/index; deletion callback authenticated/idempotent; purge cannot delete another owner or use unapproved historic retention; expiry removes current filter badge.
- Implementation: sanitized published feed/share metadata; authenticated deletion/export request/provider callbacks; scoped reviewed purge/expiry/recheck jobs and audits.
- Failure states: policy pending, uncertain deletion or failed revocation remains observable/manual; no falsely completed operation.
- Validation/reviewer: cache/sitemap/visibility/deletion/expiry tests and independent privacy review; actual cron evidence in08.

Phase exit: genuine operations/audit/trust, safe imports/claims, idempotent notifications and SEO with database/browser/failure evidence, independent review and four gates. Live delivery/legal/outreach dependencies remain separate.
