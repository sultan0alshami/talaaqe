# S0 native accounting frame

Root freeze preparation,2026-10-11. Prerequisite native User identity compatibility;
this chunk alone grants no campaign permission, entitlement or provider readiness.
Root owns ledger.ts and all runs; independent authors/reviewers have scoped paths.

createAiBudgetLedger exposes trusted server-only methods:
withPlanningActorTransaction<T>(actorInput:unknown,
 captureInventory:()=>Promise<{ownerIds:readonly string[];reviewerIds:readonly string[]}>,
 work:(frame:AiPlanningNativeFrame)=>Promise<T>)
 ->Promise<{value:T;executionClaim:{reservationId:string;executionToken:string;expiresAt:string}|null}>.
reserveAndClaimInFrame(frame:AiPlanningNativeFrame,input:unknown)
 ->Promise<{reservation:existingDTO;replayed:boolean;claimPending:boolean}>.
Export opaque type AiPlanningNativeFrame and async readAiPlanningNativeFrame(frame:unknown)
 ->Promise<Readonly<{tx:checkedTransaction;actor:capturedActor;ownerIds:readonly string[];
 reviewerIds:readonly string[];assertCurrent:()=>Promise<void>}>>.

The trusted zero-argument inventory callback owns its reviewed thin identity reads;
ledger provides no private reader. Capture actor and callback identities before
awaits, authenticate actual fixed BRAND before invoking inventory callback, clone
bounded central IDs immediately on return. Include actor in owner IDs, disjoint
sorted reviewers, and reject missing returned locked User rows. Inventory is only
coverage, never scope permission. Native auth runs on actual clock, independent
from accounting clock. Later S1 independently binds/rechecks owners and plan/view.

Preserve standalone maintenance/global advisory, owner UPDATE then reviewer SHARE,
exact AuthSession SHARE and current/final actor predicates. Never nest public ledger
or scope wrappers. Private reserveCore/claimCore retain existing caps/hash/status
and replay semantics. Combined core parses/copies Reserve input at its own entry;
the later planning caller copies its logical request before entering the owner.

Frame is a frozen empty object in a private WeakMap, exact factory issuer/active
transaction/BRAND lane; no mint/register API or caller authority flags. Read/core
calls and every checked query await verify lifetime/current auth. Expose frozen
copied arrays, not mutable issuer Sets. Invalidate frame before savepoint rollback
and transaction end, including successful callback completion. Final checks use
the raw owner transaction; cached frame/tx cannot be used after callback termination.

One new claim maximum per frame. Core returns no token to work; owner-private escrow
releases executionClaim only after known successful COMMIT. Exact retained RUNNING/
UNKNOWN/SETTLED/RELEASED replay returns no new token; existing RESERVED may claim
once. Failure/expiry/commit uncertainty exposes no credential or implicit retry.
Post-work maintenance/current auth cannot release an expired/quarantined claim.
No interactive pre-work maintenance may take reservation locks before domain
work. Track core and checked-query promises; callback completion rejects busy/
in-flight work with PLANNING_FRAME_UNSETTLED503. Invalidate then drain pending
work before rollback, so delayed DML cannot escape the command savepoint.
Apply the fixed BRAND denial after genuine native authentication and before any
standalone maintenance failure. Retain original native query failures even when
callbacks catch them; an aborted-transaction error must not mask conflict503.

Independent at-most-three native RED groups before product changes: real active
BRAND and forged/expired/non-BRAND/frame/missing-User checks; actual advisory and
User/Session wait ordering plus immutable actor/inventory capture; atomic single
reserve+claim, exact replay/no second token, callback/final expiry rollback,
maintenance preservation, and unusable frames/transactions after terminal paths.
Only guarded target, owned terminal fixtures, no provider traffic or mock auth.
All four gates and independent source/staged review before saving the chunk.
The coordinator integrates the separately tested native User identity prerequisite
and the bounded admin pagination oracle correction into this same checkpoint.
