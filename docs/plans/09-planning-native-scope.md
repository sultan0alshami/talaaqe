# S1 existing-transaction planning scope — bounded prerequisite freeze

Coordinator implementation freeze, 2026-10-11, after reviewed15e2933.
Root owns product adoption/runs; independent reviewer is read-only. Use actual S0
readAiPlanningNativeFrame(frame) -> async checked tx/actor/frozen coverage/assertCurrent.
No new admission interpreter, pool/job/result writes, route, SDK, provider or UI.

## First S1a chunk: exactly two root-owned product paths

src/lib/organizations/authority.ts: factor private preflight/lockedAuthority rows.
src/lib/brand-context/scope.ts: factor targetOwner and OWN/CLIENT context binding.
Defer campaign-planning/scope.ts preparation/proofs below to separate S1b.
Reuse organizations/context.ts predicates and later campaign-planning/projection.ts;
no identity/schema/provider edits. Existing public wrappers retain behavior.
Tests: tests/planning/native-scope.test.ts after root assigns its independent author.

## Exact S1a fields and failures

ClientPlanningIdentityCapture is a frozen plain declaration:
{actor:actual4FieldTuple,clientId,organizationId,brandId,
 organizationOwnerUserId,brandOwnerUserId,ownerIds:readonly sortedNativeIds[]}.
BrandContextPlanningCapture is a strict union:
OWN {actor,scope:{kind:'OWN_BRAND',brandId},brandOwnerUserId,ownerIds};
CLIENT {actor,scope:{kind:'CLIENT',clientId},client:ClientPlanningIdentityCapture,
 ownerIds:readonly sortedNativeIds[]}.
actor tuple is exactly userId/role/sessionId/sessionVersion, copied from call.actor;
capture copies client/options/checkpoint and scope before awaits, authenticates
actual native BRAND before thin queries, never stores those dependencies in DTOs.
Owners are actual native identities only, not permissions. Captures do not issue
proof and bind rechecks all actual rows in the checked frame transaction.

ClientScopeView contains exactly {clientId,organizationId,brandId,
 planAuthority:ClientAuthorityDTO with capability:'plan',
 viewAuthority:ClientAuthorityDTO with capability:'view',
 targetOwnerUserId,targetOwnerSessionVersion,currentClientRevision}.
BrandScopeView contains exactly {scope,brandId,organizationId,clientId,
 currentAuthority:planDTO|null,viewAuthority:viewDTO|null,
 targetOwnerUserId,targetOwnerSessionVersion,currentClientRevision:null|number}.
Return deep-frozen scalar/DTO projections; expose no issuer maps/sets/captures.
S1b derives private copied coverage from the exact base frame, never view mutation.

Invalid/copied/cross-frame proof -> SCOPE_PROOF_UNAVAILABLE503 (OrganizationError
for Client proof, BrandContextError for Brand proof; same code/status).
Base-frame closed/forged/expired errors retain S0's native error priority.
Capture/frame actor tuple mismatch -> SCOPE_PROOF_UNAVAILABLE503 before domain reads.
Native absent scope, actual missing/ineffective plan OR view, inactive association/
owner/membership/grant -> NOT_FOUND404 before protected body hydration.
Actual newly discovered owner outside held coverage -> RETRY_REQUIRED503, no late
User lock. Held-row recheck identity/revision/state/owner-session drift ->
RETRY_REQUIRED503; final native actor expiry/revocation remains401.
No plain DTO/Set/flag can satisfy proof lookup or current access.

## Proposed exact exports; all new methods are DB-only internal bags

clientAuthorityInternals.capturePlanningIdentity(call:PlanningCall,clientId:string)
 -> Promise<ClientPlanningIdentityCapture> (frozen thin metadata).
clientAuthorityInternals.bindPlanningInFrame(frame:AiPlanningNativeFrame,
 capture:ClientPlanningIdentityCapture,checkpoint:PlanningCheckpoint)
 -> Promise<ClientPlanningAuthorityProof>.
clientAuthorityInternals.readPlanningProof(frame,proof) -> Promise<Readonly<ClientScopeView>>.
clientAuthorityInternals.recheckPlanningProof(frame,proof) -> Promise<void>.

brandContextScopeInternals.capturePlanningIdentity(call:PlanningCall,scope:PlanningScope)
 -> Promise<BrandContextPlanningCapture> (OWN identity or CLIENT thin capture).
brandContextScopeInternals.bindPlanningInFrame(frame:AiPlanningNativeFrame,
 capture:BrandContextPlanningCapture,checkpoint:PlanningCheckpoint)
 -> Promise<BrandContextPlanningProof>.
brandContextScopeInternals.readPlanningProof(frame,proof) -> Promise<Readonly<BrandScopeView>>.
brandContextScopeInternals.recheckPlanningProof(frame,proof) -> Promise<void>.

Separate S1b: planningScopeInternals.preparePlanningInFrame(frame:AiPlanningNativeFrame,
 brandProof:BrandContextPlanningProof,call:PlanningCall,capture:PlanningScopeCapture)
 -> Promise<PlanningBoundScopeProof>.
planningScopeInternals.readPlanningProof(frame,proof) -> Promise<Readonly<PlanningScopeView>>.
planningScopeInternals.recheckPlanningProof(frame,proof) -> Promise<void>.
Proof types are opaque; export no constructor, mint/register function or mutable maps.
Internal views expose frozen scalar/array/DTO projections and coverage predicates;
legacy Set/Map-bearing frames remain private, not caller-editable authority objects.

## Capture, runtime association and no nested wrapper

Run beginPlanningCall and capturePlanningScope outside the S0 transaction using
the captured server client and immutable actor. Do not call beginPlanningCall
inside: its options.client reads would escape the checked owned transaction.
Copy/freeze strict captures before the first frame await. Require full actor tuple
and scope equality with the actual frame actor; captured IDs confer no permission.
Thin capture may contain IDs/revisions only, never Campaign.input/context/source
bodies or customer text. S0 inventory callback supplies captured owner/reviewer IDs.
Each issuing module owns a private WeakMap keyed by a frozen empty proof object.
Only genuine bind/prepare inserts proof state after actual native checks. State
associates exact original active ledger frame, checked transaction and captured scope.
Every read/recheck first awaits readAiPlanningNativeFrame and validates that identity.
Copied proof/Symbol/DTO, another frame/transaction or expired/closed frame rejects.
No globalHeld/skipAuth/write flags, arbitrary role/capability choices or plain-context
parameter may mint a proof. Public wrappers do not issue these new proofs.
Never invoke withClientAuthority/withBrandContextScope/withPlanningScope or
withOrganizationTransaction from S0; reuse private DB cores only.

## Fixed OWN ownership and CLIENT plan AND view in one lock pass

OWN locks its exact Brand and checks actual current owner equals actor, native
active BRAND state/version and covered owner ID before private hydration.
CLIENT preserves Org -> actor Membership -> Client -> Grant -> Brand/delegation
order. Extract one private locked-row pass from lockedAuthority; check BOTH actual
grant.plan/grant.view and delegated plan/view on those same locked records.
Use thin Brand id/userId and actual owner fields for this authority-only pass;
do not hydrate Brand.name or any context/campaign/customer body. A private thin
delegation core may factor the same current predicates from the existing validator
within authority.ts; no extra shared-context path or broad role change is required.
Do not call the old one-capability lockedAuthority twice or reenter earlier tables
after Brand locks. Produce matching current plan/view DTOs; only capability differs.
Require current organization/owner/membership/client/grant/delegation predicates.
Changing an actual owner outside covered IDs causes RETRY_REQUIRED, never a late User.
New bind mode is fixed, with no caller-selected permission or generic write switch.
Private legacy core may retain its existing write/capability parameters solely for
unchanged public wrappers; new exports hardcode planning permission and lock policy.

## Planning metadata and complete physical/logical coverage

Preserve current ordered Workspace -> captured Context -> Campaign/Binding/State
-> Selection -> approved Version/Submission locks and bounded identity checks.
Admit only existing bound campaign/workspace metadata; no new workspace creation
or BIND_OWN/unbound allowance. Preserve the original resolver for public wrappers;
the new private preparation branch resolves existing scope and locks it explicitly.
Reuse capturePlanningScope, lockScopedCampaignMetadata and reviewer coverage checks.
Capture required policies from trusted server purpose; for this fixed S1 proof
capture/check policy inventory rather than accepting a caller skip-policy flag.
S0 arrays describe held Users. Physical reviewer SHARE locks remain disjoint from
owners, but logical reviewer coverage may include a User already owner-locked.
Build private evidenceActors from copied captured IDs only after each reviewer is
covered by frame.ownerIds OR frame.reviewerIds; preserve original logical reviewer
membership for assertPlanningPolicyCoverage. Never expose mutable Sets.
Uncaptured context/version/selection/reviewer drift safely recaptures or denies.
Resolve selected content from immutable approved Version/Submission, not mutable
unapproved parent input epochs. Current archive eligibility remains action-specific.

## Cache lifetime and final current scope

Cache only inside proof state for that exact active ledger frame; do not introduce
a global tx-keyed prepared promise or reuse one across callbacks/rollback.
Base frame invalidation makes every proof/view/closure unusable before owner exit.
Recheck cannot use a stale cached authority/snapshot as its own evidence.
Final recheck reads the already locked original Org/member/client/grant/Brand IDs,
owner/version/state, workspace/campaign/binding/state/selection/source identities
and required current reviewer inventory; it takes no new locks or discovers rows.
Changed identity rejects instead of relocking a replacement member/grant/context.
Do not simply call the initial lock binder again at the final reservation stage.
The eventual trusted caller runs recheck AFTER all its DB/core work and awaits it
as its last scope step before returning to S0. S0 then closes the frame and does
post-work maintenance/final actual-clock auth/COMMIT. Held domain locks retain scope
during those later waits; no provider/token action occurs inside scope callbacks.

## At most three independently authored native RED groups

1. Real OWN owner and CLIENT accepted membership/delegation; plan-only/view-only
deny before private hydration; both permissions pass. Fake/copied/cross-frame/
closed proofs cannot mint/read scope permission; pure DTO equality is insufficient.
2. Actual preflight/global/User/domain contention with committed owner replacement,
grant/delegation revocation: no uncaptured User locks, no private data and safe
recapture/denial. Covered owner+reviewer overlap passes.
3. S1a actual lease expiry and final current owner/member/client/grant recheck;
whole owned work rollback on changed scope, no stale proof after rollback/commit.
S1b extends this group with binding/selection/approved-source waits and cache checks.
Unapproved parent draft edit preserves the same approved selection; changed actual
selection epoch rejects. No mocks, providers, resets or fixture live-acceptance claims.

All policy-reviewer drift, Workspace/campaign/binding/selection/source/version and
mutable-prepare-cache acceptance is explicitly S1b. S1a tests only authority/Brand
proofs, current native auth and physical owner/reviewer coverage in its two paths.
