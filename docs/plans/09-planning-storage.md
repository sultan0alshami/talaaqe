# Planning AI principal and cycle storage

Coordinator slice, 2026-10-11. Prerequisite: native ledger checkpoint679e59b and
reviewed organization/planning bindings. This is the first storage slice of
09-planning-admission, not paid/trial provisioning or provider enablement.

## Owned paths and review

Root owns `prisma/schema.prisma`, additive migration
`20261011090000_planning_ai_principals`, and `src/lib/planning/contracts.ts`.
Independent author owns only `tests/planning/principal-storage.test.ts`; root
alone runs the disposable databases and checks. Independent schema reviewer
reviews contracts, migration and staged changes. Preserve other work/history.

## Five native records

- `PlanningAiPool`: exact immutable subject `OWN_BRAND` plus Brand FK, or `CLIENT`
  plus Organization FK. Exactly one subject, lifetime unique per native subject.
  ACTIVE/CLOSED state and incrementing revision; closing cannot reopen a pool.
  No inferred organization, truncated IDs, directory authority or billing grant.
- `PlanningAiEnrollment`: immutable pool, actual accepting owner and historical
  subscriber User IDs, TRIAL/PAID kind, accepted commercial policy, exact plan,
  price version and SAR net amount (paid only), acceptance instant and bounded
  provenance reference/hash. At most one ACTIVE enrollment per pool; CLOSED is
  irreversible. Records and labels never constitute provisioning authority.
- `PlanningAiSeat`: unique pool/User, immutable subject and membership binding.
  OWN_BRAND has no membership; CLIENT must bind the exact native membership for
  that organization/User. ACTIVE/REVOKED changes advance revision. Being a seat
  grants neither billing administration nor client access; consumption must
  independently recheck current view+plan, native identity and subject authority.
- `PlanningAiTrialClaim`: immutable lifetime unique verified-owner User and pool
  fences, bound to the same TRIAL enrollment/historical subscriber. Capture exact
  readiness reference, consent hash and claim instant. Reject updates/deletion;
  restrictive FKs retain fences across owner changes, closure and expiry.
- `PlanningAiCycle`: immutable enrollment/pool, TRIAL/MERCHANT source and source
  event/subscription identity, accepted plan/price/policy snapshot, allowance and
  exact half-open `[startsAt,endsAt)` period. Positive finite duration; one trial
  cycle per trial claim, one merchant event and subscription period per source.
  Effective cycles for a pool cannot overlap, including concurrent inserts.
  ACTIVE/VOIDED state and incrementing revision; voiding is irreversible and is
  allowed only when both old and resulting counters are zero. Held/consumed are nonnegative bounded
  integers with sum at most immutable allowance; consumed cannot decrease.

The accepted pricing snapshot uses the central commercial version and actual
STARTER/GROWTH/PRO policies (SAR9900/29900/99900 minor units excluding VAT,
3/15/75 sessions); TRIAL carries allowance1 and no price/net amount. Paid cycles
must match their same-pool PAID enrollment. Trial cycles require their exact
claim/enrollment. No rollover/default entitlement, renewal or seed is added.
Trusted provisioning must supply actual source references and exact periods;
this slice has no provisioning method and no default trial duration/start/grace.

Use native1–200 printable ASCII IDs for all subjects and references. Keep the
spending ledger's narrower generated identifiers separate. Provenance stores
only opaque readiness/acceptance/event references and hashes, never credentials,
provider tokens, raw private messages or URLs. Application declarations are strict
and SQL rejects unknown state, absent coherence, invalid bounds and altered
identity independently. Existing records are not rewritten by this migration.

## Evidence and next slice

Independent native groups must first fail against the missing tables/contracts:
subject/membership isolation and immutable history; two lifetime trial fences and
restrictive retention; exact commercial snapshots, native concurrent overlap,
adjacent periods and bounded irreversible counters. Use transaction rollback for
trial fixtures so acceptance does not bypass deletion guards. No synthetic data
is provider/merchant acceptance. Reconcile all three task DB migrations and run
all four `npm run check` gates before commit.

All five records reject DELETE, including child-free closed rows. Cycle INSERT
advances the locked pool revision before its overlap query: concurrent writers
serialize under READ COMMITTED; an older RepeatableRead/Serializable snapshot
fails with a native serialization conflict rather than admitting a hidden period.
Provisioning must handle this conflict with fresh authorization/snapshot capture.
No old reservation, execution token or provider call may be retried implicitly.
All native parent/subject/history foreign keys remain restrictive.

Session/operation/attempt/result records and atomic allowance counters follow in
their own reviewed slice. First success means a validated provider output is
persisted and attached under current authority, not merely received or billed.
Valid but unattachable output retains paid accounting and private provenance but
does not become confirmed campaign content. Known failures retain actual cost;
UNKNOWN execution keeps the hold and prevents duplicate invocation. Trial expiry
and consumed-session continuation policy must be explicit before activation;
this storage slice deliberately supplies neither a guessed date nor a purchase
flow. Saved manual work and outputs are never deleted by cycle expiry.
