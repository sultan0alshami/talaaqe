# Planning Attempt/Result native storage

Coordinator preparation, 2026-10-11. Prerequisite74d12d1 passed all four gates,
1152 tests and privacy checks. Root owns schema/migrations and all execution.
Prerequisites: migrations32/33 (principals/session holds), current
docs/plans/09-planning-output-contracts.md and exact AiReservation guards.
This adds two retained record contracts, not callable SDK, native auth composition,
provisioning, provider readiness or permission from SQL/provider labels.

## Types and hashes

id = existing native printable ASCII1..200; Attempt.id = generated canonical UUID
stored as text for the frozen JOB context. Client operationKey is UUID; preserve
its original parsed spelling in request JSON for hashing. Ledger identifiers keep
their narrower grammar; never truncate native subject/actor IDs.
rev=1..2147483646; UTC=finite supported timestamp(3); hash=64 lowercase hex.
JSON validators reject missing/unknown keys and unsafe shapes.
H(json)=encode(sha256(convert_to(infame_reference_canonical(json),'UTF8')),'hex').
Use existing fixed-ASCII-key canonical conventions; no pgcrypto/new dependency.
Recompute new declared hashes only; never rewrite historical ledger hashes.
## PlanningAiAttempt columns and immutable identity

id PK; operationId,sessionId,poolId,seatId,actorUserId TEXT NOT NULL;
actorRole TEXT='BRAND'; actorSessionVersion INT1..2147483647;
operationKey UUID NOT NULL; sequence INT1..2147483646; request JSONB<=16KiB;
requestHash,scopeFingerprintHash,payloadHash,ledgerRequestHash,pricingHash TEXT hashes;
scopeFingerprint JSONB<=64KiB; reservationId,ledgerOperationKey,ledgerPurpose TEXT;
pricing JSONB<=4KiB; reservedMicros BIGINT>0; executionTimeoutMs INT1000..300000;
executionTokenHash TEXT hash; claimedAt,deadlineAt UTC with deadline>claim;
registryVersion opaque TEXT; state TEXT; knownFailureEvidenceJson JSONB|null;
executionEvidenceJson JSONB|null; providerRequestId bounded id|null;
revision INT; createdAt,updatedAt UTC with nonregressing chronology.
pricing mirrors strict AiPricingSchema: exact USD/model/version/asOf and1..6 unique
supported units, positive denominator quantities and minor-unit strings.
Freeze every identity/request/fingerprint/pricing/reservation/claim field on INSERT.
Only state/revision/updatedAt and one-way evidence/request-ID observation may change;
terminal evidence is immutable. No raw prompt/source text, AuthSession ID or token.
UNIQUE(actorUserId,operationKey); UNIQUE(operationId,sequence); UNIQUE(reservationId).
Partial UNIQUE(operationId) WHERE state IN ('RUNNING','UNKNOWN') fences all seats.
Add UNIQUE(id,operationId,sessionId,poolId) for exact Result parent references.
FK(operationId,sessionId) -> Operation(id,sessionId), requiring additive UNIQUE.
FK(sessionId,poolId) -> Session(id,poolId); FK(seatId,poolId,actorUserId) ->
Seat(id,poolId,userId); actorUserId -> actual User; reservationId -> AiReservation.
All retained FKs use RESTRICT for delete/update; Attempt DELETE fails.
## Exact request/fingerprint and ledger insertion checks

request is exactly PlanningAiRequestSchema and its contextual fingerprint validator.
Bind request session/kind/ordinal/key, sourceMessage and selectedArtifacts; compute
requestHash=H({domain:'infame-planning-request-v1',actorUserId,request}).
Fingerprint is current strict PlanningScopeFingerprintSchema, not loose JSON.
Mirror its closed keys/branches in SQL; same session/pool/operation/seat/actor
and exact session workspace/campaign/agent/Brand/Organization/client must match.
scopeFingerprintHash=H({domain:'infame-planning-scope-v1',...fingerprint}).
Version input epoch is approved Version/Submission's immutable inputRevision;
exclude mutable parent draft/counter epochs exactly as output freeze specifies.
Initial Attempt is RUNNING/revision1; both evidence JSONs and requestId are null. Exact
reservation must already be RUNNING, with its structurally coherent original claim.
Compare actor/key/purpose/payload/reservedMicros and role/version metadata;
pricing must equal result.pricing JSONB, pricingHash=H(pricing), and original
result.requestHash=ledgerRequestHash. No subset or nullable comparison may pass.
Compare timeout, executionTokenHash, claimedAt and deadlineAt to the exact claim;
deadline equals claim plus executionTimeoutMs. No new token minting or fallback.
Expected context = {resourceType:'JOB',resourceId:Attempt.id,
sourceRevision:fingerprint.agent.revision}; compare the whole context JSONB.
Purpose mapping: REPLY=CAMPAIGN_CHAT; BRIEF=BRIEF; remaining3=CONTENT_THEME.
Reconstruct ReserveAiSchema from ledgerOperationKey,purpose,payloadHash,
reservedMicros::text,pricing,expected context,executionTimeoutMs; recompute H and
require ledgerRequestHash equality. Do not confuse logical requestHash with it.
New pricing/request/context checks leave AiReservation8KiB metadata unchanged.
## Attempt transitions and separately evidenced execution/billing

RUNNING -> UNKNOWN | FAILED_KNOWN | RESULT_RECORDED; UNKNOWN -> either terminal
only with verified execution and billing resolution. No terminal resurrection.
Every UPDATE advances revision exactly1, time never regresses; replay is read-only.
executionEvidenceJson is strict hash-only observation: {executionBasis,reference,
evidenceHash,resolvedAt,reservationId}; opaque reference, no raw provider payload.
Basis = TRUSTED_PRE_CALL_STOP | PROVIDER_CONFIRMED_NO_CALL |
PROVIDER_TERMINAL_RESPONSE | REVIEWED_EXECUTION_RESOLUTION; server lane only.
This observation may exist while billing is UNKNOWN; it grants no success/retry.
knownFailureEvidenceJson is exactly that execution evidence plus billingBasis.
billingBasis is a closed union: RELEASED with exact noCallReason, or SETTLED with
exact settlementHash/actualMicros. Native values must match the actual ledger row.
billingBasis is exactly {kind:'RELEASED',noCallReason} or
{kind:'SETTLED',settlementHash,actualMicros:canonicalMinorString}.
knownFailureEvidenceJson and Result.terminalEvidenceJson share exactly the flat
execution-evidence fields above plus this billingBasis member. Unknown keys,
noncanonical amounts and URLs are rejected; no raw provider body is retained.
Terminal evidence's execution members must equal the Attempt's one-way execution
observation. ATTACHED permits PROVIDER_TERMINAL_RESPONSE or an explicit reviewed
response resolution only; pre-call/no-call evidence cannot manufacture content.
REVIEWED_EXECUTION_RESOLUTION.reference is the exact immutable AdminAudit ID
with action AI_PLANNING_EXECUTION_REVIEWED, resourceType PLANNING_ATTEMPT,
resourceId this Attempt and matching evidenceHash/reservationId/providerRequestId
plus closed outcome RESPONSE_KNOWN or NO_CALL. Billing reconciliation audit alone
is not execution review. The new action's audit history must be immutable; its
future producer independently enforces genuine native ADMIN authority. SQL labels
and hashes alone still cannot prove real review/provider execution.
The closed execution-review AdminAudit snapshot is exactly
{evidenceHash,reservationId,providerRequestId,outcome}; no billing snapshot can
substitute for it. Audit identity/content are immutable for this new action.
TRUSTED_PRE_CALL_STOP binds FAILED_BEFORE_INVOCATION; PROVIDER_CONFIRMED_NO_CALL
binds matching no-call evidence. Reviewed resolution retains its audited reference.
FAILED_KNOWN requires both terminal execution proof and resolved billing, no Result.
RESULT_RECORDED requires exactly one same-attempt final Result and its evidence.
A request ID, terminal invoice or SETTLED row alone proves no terminal execution.
RUNNING/UNKNOWN planning states remain occupied if ledger maintenance quarantines;
do not add ledger triggers that lock planning parents behind reservation locks.
## PlanningAiResult columns and native shape

id PK TEXT; attemptId,operationId,sessionId,poolId TEXT NOT NULL; disposition TEXT;
outputHash TEXT hash; wireHash TEXT hash|null; providerRequestId bounded id|null; content JSONB|null;
contentHash TEXT hash|null; reasonCode closed TEXT|null; terminalEvidenceJson JSONB;
createdAt UTC. UNIQUE(attemptId); partial UNIQUE(operationId) WHERE disposition='ATTACHED'.
FK(attemptId,operationId,sessionId,poolId) -> exact Attempt tuple, RESTRICT.
Add UNIQUE(id,operationId,sessionId) and UNIQUE(id,sessionId,poolId) for pointers.
Result is INSERT-only; UPDATE/DELETE reject. All final dispositions require
terminal execution evidence and known actual billing matching their reservation.
ATTACHED requires SETTLED (zero actual cost is allowed), reasonCode NULL, strict
planningRetainedContentForFingerprintSchema validation and contentHash=H(parsed content).
Mirror native envelope kind/binding/snapshot/fingerprint/attempt/provider pins;
modelId equals pinned pricing.modelId, registryVersion/request identity is exact.
Use current64KiB ordinary/256KiB refinement/512KiB enriched bounds, not new limits.
outputHash is SHA256 of the exact complete provider text UTF8 bytes, including
its whitespace/formatting, computed before parsing; it is never H(retained data).
ATTACHED wireHash is H(strict parsed normalized provider wire), reconstructed
from retained output by stripping only server enrichment. These are distinct
identities; central deliverable normalization may change wireHash input.
Rejected wireHash is NULL; malformed complete text can still have outputHash.
Incomplete transport has no final Result and remains UNKNOWN.
DENIED/STALE/INVALID require content/contentHash NULL and exactly the corresponding
closed reason list from output freeze; retain outputHash and accounting pins only.
No rejected raw body/prompt/transcript/exception text; incomplete transport stays
UNKNOWN. Pure/native shape, claim coherence and provider labels prove no execution.
## Extend migrations32/33 atomically, with aggregate checks at COMMIT

Replace Session HELD/RELEASED-only shape with HELD/CONSUMED/RELEASED; only CONSUMED
has firstAttachedResultId. Extend immutable whitelist for that one-way pointer.
Replace Operation OPEN-only shape with OPEN/SUCCEEDED; only SUCCEEDED has its
same-operation successfulResultId. SUCCEEDED/CONSUMED and pointers cannot revert.
Operation INSERT must allow a HELD or CONSUMED session, so remaining included
slots need not be precreated before first success. Actual expiry/continuation
admission remains the separately reviewed native policy, not a storage default.
Add deferred pointer FKs and semantic consistency triggers on BOTH parent and
Result/Attempt mutations: pointers resolve same-aggregate ATTACHED Result; an
ATTACHED Result requires RESULT_RECORDED Attempt and SUCCEEDED Operation.
Every session with ATTACHED results is CONSUMED and retains its first pointer;
a CONSUMED session requires that actual first result, never a SETTLED-only claim.
Result may insert before Attempt terminal update; validate their final join at COMMIT.
One result cannot serve two slots. AFTER a validated ATTACHED insertion, advance
Attempt/Operation and set the Session's first pointer exactly once; retain it thereafter.
Every Result disposition automatically transitions its exact Attempt to
RESULT_RECORDED with the immutable terminal observation. Rejected Result never
advances Operation or consumes Session. Entitlement release is explicit: the
trusted coordinator requests HELD→RELEASED after known failure, and the native
sibling guard rejects it while any attempt is unresolved. No timeout/cancellation
or rejected result alone auto-releases a shared hold.
AFTER Result completes Attempt then Operation then Session before that Result's
final semantic check. Parent mutation checks validate local pointer/evidence
coherence; they must not demand unrelated unfinished sibling auto-completion.
Immediate checks validate each completed Result and its parents, so multi-row
Result statements remain valid while their remaining AFTER events are queued.
Final deferred guards cover changed parents/results and native counters without
an authority bypass flag or temporary suppression. Include immediate and bulk
first-success tests, and preserve deterministic first-pointer assignment.
Before HELD -> RELEASED, reject any sibling RUNNING/UNKNOWN or any attached success;
every prior attempt must have terminal known execution+billing. Rehold is explicit.
Extend AFTER Session reconciliation to derive BOTH HELD and CONSUMED counts,
write both Cycle counters in one revision step only when changed, and preserve
statement-visible multi-row changes plus deferred equality checks on BOTH tables.
Cycle consumed remains monotonic; never manually decrement/reset lifetime history.
## Locks, migration boundary and narrow unresolved requirements

Prelock domain parents then pool/enrollment/creator+acting seats/cycle/session/
operation/attempt/reservation/result; UPDATE ancestors use existing NOWAIT policy.
Future ledger owner precedes these with global advisory, complete Users and exact
Session auth. No nested wrappers, late User locks or callable bypass is added here.
Install table/check/guard changes atomically under bounded write-blocking locks;
retain occupied history and abort on incompatible rows rather than fixing/resetting.
Final rejected/accounting history survives revocation; ATTACHED needs a later
reviewed native authority/time gate. Trial/consumed-session grace remains undecided.
Unresolved integration: execution-evidence provenance cannot be proven by hashes
alone; valid-response crash retention needs its privacy contract. Without it,
keep only hash/accounting evidence and never reconstruct success or invoke again.
