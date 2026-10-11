# Planning execution storage freeze

Coordinator preparation, 2026-10-11, after independent native/source scouting.
This is the next additive storage contract, after the five-record checkpoint.
It grants no native authority,
provider capability, billing activation, trial duration or consumed-session grace.
Root owns adoption, product contracts/schema/migration and all execution.

## First bounded sub-slice: session and operation storage

Prerequisite11a8077 passed all four gates. Root implements Session and Operation
first, before the separately frozen Attempt/Result contracts. No route, provider,
paid/trial provisioning or native-authority bypass is enabled. Consequential
baseline tests remain independently authored before product implementation.

Session adds immutable `creationSeatId` and composite seat `(id,poolId,userId)`
binding to its actual creator. INSERT is HELD/revision1 with null first result;
the exact ACTIVE pool/enrollment/cycle must contain the actual database UTC instant
in its half-open period. Cycle counters update automatically in the same native
transaction on Session creation/transition; deferred constraints independently
require held/consumed equal the actual Session state counts at COMMIT. Direct
counter tampering must fail even if its numeric bound is valid. The cycle row is
locked before automatic increment, so two seats cannot win the last allowance.

Initial Operation is OPEN/revision1 with no successful result. Until Attempt/Result
storage is implemented, CONSUMED/SUCCEEDED and nonnull result pointers fail closed.
HELD can release without a result; RELEASED can rehold only explicitly under the
original pool/cycle/scope/creation identity and current period eligibility. This
sub-slice has no provider attempt, so release cannot conceal unresolved execution;
the next migration must install sibling-attempt checks before any dispatcher.
All native scope/creation identity is immutable, every update increments revision
exactly1 and dates cannot regress; DELETE retains both records. Session/operation
SQL labels are structural records, not authentication or source verification.

Install deferred equality checks on BOTH Session mutations and Cycle counter
mutations. Migration startup rejects any preexisting nonzero held/consumed
counter; never rewrite or reset history to make it conform. Eligibility uses
`clock_timestamp() AT TIME ZONE 'UTC'` after every parent/cycle wait, not the
transaction's starting timestamp. Explicit rehold uses the same complete ACTIVE
pool/enrollment/seat/cycle and current-period checks as INSERT.

Parent order is pool → enrollment → creation seat → cycle → session → operation.
Domain workspace/binding/agent key locks precede that entitlement order so all
implicit FK waits occur before checking the actual admission instant.
INSERT may wait for these parents before owning a child row. Native UPDATE
already owns its child row when a BEFORE trigger runs: use NOWAIT for required
ancestor locks, returning native55P03 when not already available. The application
transaction must prelock parents in the reviewed order; no child trigger waits
on an ancestor or claims general raw-SQL deadlock freedom. A retry requires fresh
native authorization/capture and must never reissue execution tokens implicitly.
Exact composite workspace/scope/Brand/Organization/client, campaign binding,
agent and creator-seat identities keep clients isolated within the same pool.

The migration holds a Cycle SHARE ROW EXCLUSIVE lock in an explicit transaction
from the initial nonzero-counter check through constraint installation. This
blocks prior-schema writes from racing the check. AFTER Session reconciles the
actual indexed HELD count while owning Cycle; all rows of the statement are
visible, so valid multi-row changes work with immediate constraints. Remaining
row events are noops. Constraints enforce the final aggregate, not a ban on every
transient value in a transaction that ends coherently. No saved history is reset.

Independent native author owns only its ignored preparation file before adoption;
three groups may be prepared, but this first sub-slice adopts only bounded scope/
ordinal/aggregate and two-seat-last-slot/rollback witnesses. Root alone executes
guarded databases and all four gates; independent reviewer owns no product edits.

## Prerequisites and existing source

- `src/lib/planning/contracts.ts` and migration
  `20261011090000_planning_ai_principals`: existing pool, enrollment, seat,
  trial claim and cycle; retain accepted terms and irreversible cycle consumption.
- `docs/CONTRACTS.md:385`: first validated persisted planning output consumes one
  session; exact retries and unknown execution retain their original identity.
- `docs/plans/09-planning-admission.md`: current view+plan, pool seat and native
  session before dispatch and attachment; original sources and owner approval.
- Existing CampaignAgent/native scope, AiReservation metadata/hashes and guards
  remain authoritative. Storage labels and fixture rows prove no genuine output.

## Four additional records

1. **PlanningAiSession**
   Columns: `id,poolId,cycleId,scope,brandId,organizationId?,clientId?,workspaceId,
   campaignId,agentId,createdByUserId,creationSeatId,creationKey,allowanceState,
   firstAttachedResultId?,revision,createdAt,updatedAt`.
   States: `HELD | CONSUMED | RELEASED`; first admission creates HELD.
   Unique creator/key; immutable pool/cycle/native scope and creation identity.
   Composite cycle FK binds `(cycleId,poolId)`; agent FK binds
   `(agentId,campaignId,workspaceId)`. OWN_BRAND matches the exact pool Brand;
   CLIENT matches its exact Organization and actual client/workspace/Brand.
   CONSUMED requires a same-session ATTACHED first result and cannot revert.
   RELEASED requires no first result, no success and no unresolved sibling attempt.
   An explicit retry may reacquire a released hold only through fresh admission
   under the same exact identity and current cycle eligibility; never automatically.

2. **PlanningAiOperation**
   Columns: `id,sessionId,kind,ordinal,state,successfulResultId?,revision,
   createdAt,updatedAt`.
   States: `OPEN | SUCCEEDED`; SUCCEEDED is terminal.
   Unique `(sessionId,kind,ordinal)`; native checks allow REPLY ordinals 1..10,
   and ordinal 1 for BRIEF, STRATEGY, IDEAS_PACK and COMBINED_REFINEMENT.
   Same-operation ATTACHED result is the only successful counter.
   Each attempt retains its exact request key/hash; repeated delivery cannot
   invoke again. A permitted explicit retry retains this logical inclusion slot.
   Refinement request binds the exact selected artifact IDs and content hashes.

3. **PlanningAiAttempt**
   Columns: `id,operationId,sessionId,poolId,seatId,actorUserId,actorRole,
   actorSessionVersion,operationKey,sequence,requestHash,reservationId,
   ledgerPurpose,payloadHash,ledgerRequestHash,pricingHash,registryVersion,scopeFingerprint,
   scopeFingerprintHash,state,resolutionReference?,revision,createdAt,updatedAt`.
   States: `RUNNING | UNKNOWN | FAILED_KNOWN | RESULT_RECORDED`.
   Unique actor/key, reservation ID and operation/sequence; one RUNNING/UNKNOWN
   attempt per operation across all seats. Identity/fingerprint/ledger pins freeze.
   Seat composite identity matches pool and actor; no AuthSession ID or raw token.
   Fingerprint binds exact native IDs and authority revisions; campaign/fields/
   planning/agent revisions and hashes; selection/version/context hashes; ordered
   original source IDs/hashes. Equal content after revision ABA is still changed.
   FAILED_KNOWN requires evidenced terminal execution and resolved billing.
   RESULT_RECORDED requires the same attempt's immutable final result.

4. **PlanningAiResult**
   Columns: `id,attemptId,operationId,sessionId,poolId,disposition,outputHash,
   providerRequestId?,content?,contentHash?,reasonCode?,createdAt`.
   Dispositions: `ATTACHED | DENIED | STALE | INVALID`; final rows are immutable.
   Unique attempt ID; composite parent joins resolve one exact aggregate.
   ATTACHED requires genuine provider output validated against the operation's
   bounded strict schema, original source/snapshot and current native authority.
   Only ATTACHED stores content and advances an inclusion or session consumption.
   DENIED/STALE/INVALID require content and contentHash NULL: retain only the
   response hash, closed safe reason code and attempt/accounting pointers.
   Do not persist rejected raw output, exception text, prompt or transcript.
   Transient attachment failure retries the same proven response, never invocation;
   its durable response retention requires a separately reviewed privacy contract.

## Native aggregate coherence at COMMIT

- Cycle held equals its HELD session count; consumed equals its CONSUMED count.
  Deferred native checks must reject independent counter tampering or missing rows.
- Session first-result and operation success pointers identify ATTACHED results
  in the same aggregate; ATTACHED result identifies a RESULT_RECORDED attempt.
- First attachment commits result, attempt/operation completion, and exactly one
  HELD-to-CONSUMED move with held minus one and consumed plus one.
- Known failed attempts consume no success. Before first success, release only
  after every sibling attempt has resolved execution and billing. UNKNOWN fences
  the operation and retains the session hold, even through revocation or expiry.
- SETTLED accounting alone proves neither execution certainty nor output success.
  Reconciliation cannot manufacture a result, fresh token or renewed allowance.
- Restrictive retention, immutable bindings, bounded JSON/hash shape, consecutive
  revisions and monotonic timestamps cover inserts, updates and commit rollback.

## Ledger and future transaction ownership

Native subject IDs retain printable ASCII 1..200. AiActor/ledger identifiers use
the narrower 1..128 opaque grammar; AuthSession IDs are exact 43 base64url chars.
Never truncate/alias broad IDs or transform actor claims. Generated compatible
attempt IDs are accounting context only. Ledger-incompatible actor IDs require
safe rejection until a coordinator-reviewed compatibility contract exists.

Reservation FK alone is insufficient: native checks bind immutable reservation
userId, purpose, payloadHash, requestHash, pricing and context to this attempt.
Use additive composite keys or a checked immutable row lookup under locks; preserve
AiReservation status/metadata/hash/math/token and terminal-cost semantics.

The logical planning requestHash is distinct from ledgerRequestHash (the latter
hashes the full parsed ReserveAiSchema command). pricingHash is the existing
canonicalHash of pricing, without a new domain prefix. Existing native
infame_reference_canonical plus sha256 can compare that pricing in SQL without
a new extension. Initial accounting context is JOB with generated attempt UUID
resourceId and captured agentRevision as sourceRevision; native campaign/client
IDs remain in their actual relational bindings. REPLY maps CAMPAIGN_CHAT; BRIEF
maps BRIEF; STRATEGY/IDEAS_PACK/COMBINED_REFINEMENT map CONTENT_THEME. No opaque
purpose/context label grants campaign authority or a second execution token.

The hardened ledger remains sole transaction owner: separately committed timeout
maintenance, global AI advisory, complete captured sorted owner/reviewer Users,
exact actor Session, current domain/agent rows, cycle/session/operation/attempt,
atomic reserve+claim, final scope/view+plan/native checks, COMMIT, one external call.
Attachment separately settles trusted actual cost and reauthorizes before success.
No nested transactions, caller auth flags, late Users or reverse parent locks.

## Ownership and three bounded evidence groups

Root owns the additive four records/migration, strict planning execution contract,
ledger composition/actor compatibility and all database/check execution. A leaf
author owns only its explicitly assigned test file; independent schema/state/
privacy reviewer makes no product edits. Preserve existing records and other work.
No source edit or migration before the independent native baseline and review.

1. Composite scope/seat/agent/ledger identity, broad grammar, fingerprint/source
   ABA, wrong-owner reservation, denied/stale/invalid content minimization.
2. Two-seat last allowance, simultaneous first results, ten-plus-four uniqueness,
   exact key/hash replay, native counter coherence and lost-token fences.
3. Known charged/no-call failures, unresolved sibling UNKNOWN, denied attachment,
   rollback and saved output retention at expiry. Trial TTL/grace remains unset.
