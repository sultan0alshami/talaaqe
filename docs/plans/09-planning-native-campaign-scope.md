# S1b existing campaign scope in the ledger transaction — implementation freeze

Preparation only, 2026-10-11. Root owns adoption and execution; no runtime activation.
Smallest product scope: src/lib/campaign-planning/scope.ts only.
Use current S0 readAiPlanningNativeFrame and S1a brandContextScopeInternals bags.
No schema, identity, provider, UI, pool, Attempt/Result, artifact or source-body work.

## Exact additive exports

planningScopeInternals.capturePlanningIdentity(call:PlanningCall,scope:PlanningScope,
 campaignIds:readonly string[]) -> Promise<PlanningNativeScopeCapture>.
planningScopeInternals.preparePlanningInFrame(frame:AiPlanningNativeFrame,
 brandProof:BrandContextPlanningProof,call:PlanningCall,
 capture:PlanningNativeScopeCapture) -> Promise<PlanningBoundScopeProof>.
planningScopeInternals.readPlanningProof(frame,proof) -> Promise<PlanningScopeView>.
planningScopeInternals.recheckPlanningProof(frame,proof) -> Promise<void>.
Export one frozen internal bag and opaque proof type; no mint/register/private-view
accessor, callbacks with legacy contexts, mutable Sets/Maps or capability/write flags.
This first lane accepts 1..2 unique existing bound campaign IDs in one workspace;
current selection only. No choice/proposal dependency/BIND_OWN/unbound allowance.
Existing capturePlanningScope/withPlanningScope signatures and behavior stay intact.

## Exact thin capture and view fields

Use strict bounded schemas, actual OrganizationIdSchema/native revisions/status,
lowercase 64-hex stored hashes, and valid ISO UTC strings for every exposed date.
Deep-freezing a Date does not prevent setTime; expose strings, retain raw rows private.
PlanningNativeScopeCapture contains exactly:
{actor:{userId,role,sessionId,sessionVersion},scope,campaignIds,workspace,
 campaigns,bindings,states,contextIds,contexts,selections,versions,submissions,
 reviewerIds}. All arrays are sorted, unique and bounded by existing scope limits.
workspace = {id,scope,brandId,organizationId,clientId}; exactly one existing tuple.
campaigns[] = {id,brandId,revision,status,currentBriefVersion,updatedAt}.
bindings[] = {campaignId,workspaceId,brandId}; timestamps confer no authority.
states[] = {campaignId,workspaceId,revision,selectionId,selectionRevision}.
contexts[] = {id,workspaceId,archived}; no parent revision/inputRevision/name/content.
selections[] = {id,campaignId,workspaceId,revision,contextVersionId,contentHash}.
versions[] = {id,contextId,workspaceId,submissionId,version,inputRevision,contentHash,
 approvedByUserId,approvedAt} (planningVersionBindingSelect, date encoded).
submissions[] = {id,contextId,workspaceId,inputRevision,contentHash,state,
 decidedByUserId,decidedAt}; no raw submitted name/content.
reviewerIds = fixed current MARKET/VERIFIED PolicyVersion.reviewedBy inventory.
No includePolicies/allowArchived flags, options/client/reader/checkpoint in capture.
All requested campaigns require exact binding/state/current selection; contexts,
versions and submissions are exactly those reached by selected approved versions.
NONE selection requires contextVersionId=null AND contentHash=null and no source rows.

PlanningScopeView contains exactly the current S1a BrandScopeView fields:
{scope,brandId,organizationId,clientId,currentAuthority,viewAuthority,
 targetOwnerUserId,targetOwnerSessionVersion,currentClientRevision}, plus
{workspace,campaigns,bindings,states,contexts,selections,versions,submissions,
 policyReviewerIds}. Arrays contain the same exact field projections above.
Return a deeply frozen projection; no actor/dependencies, capturedContextIds,
evidenceActors, rawRows, tx, caches, Maps/Sets or issuer state. A view is metadata,
not an authority argument for another binder. Subsequent source hydration is separate.

## Fixed capture, authority, and owner/reviewer coverage

Capture copies actor/options client/checkpoint/scope/IDs before its first await and
authenticates actual native BRAND before thin reads. Reuse capturePlanningScope
with fixed {campaignIds,includePolicies:true}, plus missing thin binding/workspace/
campaign/state/Context/Submission selects; do not export the includePolicies choice.
Do not call beginPlanningCall inside S0 or read call.options.client during prepare.
Prepare synchronously captures/clones input and copies call.actor/checkpoint;
retain any validation failure without throwing before native checks. Await S0
frame/auth and required S1a proof checks first, then throw VALIDATION422 before
domain reads. Forged/closed frame503 and expired/revoked401 retain priority even
with malformed input. Require full call/capture/base actor tuple equality before domain
reads. Await brandContextScopeInternals.readPlanningProof(frame,brandProof), require
exact captured scope and workspace tuple to match the genuine current S1a view.
No withPlanningScope/withBrandContextScope/withClientAuthority/organization wrapper.
Check each captured reviewer is in base.ownerIds OR base.reviewerIds before reads.
Build private evidenceActors from copied base owners and the original logical captured
reviewer list; owner/reviewer overlap must remain logical reviewer membership.
Always assertPlanningPolicyCoverage initially and finally. A newly required reviewer
absent the captured logical inventory retries, even if physically owner-covered.
No late User locks or arbitrary caller Sets may establish actual reviewer coverage.

## Native row core and ordered locks

Factor the old prepare closure into a module-private DB-only core without changing
its old write/unbound/workspace creation/cache behavior. Its legacy adapter keeps the
existing wrapper-local tx WeakMap. New adapter has fixed existing-only semantics and
separate proof state; never consult/reuse that legacy cache or export a mode switch.
If sharing would change legacy semantics, leave the legacy closure intact and share
only thin selectors/relationship checks in this first prerequisite.
New core locks exact captured Workspace FOR UPDATE, then Context FOR UPDATE,
Campaign -> Binding -> State FOR UPDATE, Selection FOR UPDATE, Version -> Submission
FOR SHARE. Reuse lockPlanningRows/lockCampaignPlanningRows/lockScopedCampaignMetadata
with no unbound allow-list. Verify the captured workspace before later row locks;
resolvePlanningWorkspace(write=true) is forbidden because it can create a workspace.
Never union in replacement current selection/version/context IDs discovered after
capture: changed identity retries without late locks or private-body hydration.
Reload selections/versions/submissions after their own locks; the old prepare reads
these before locks and its cached rows cannot prove current native state here.
Check exact captured and current campaign/binding/state/selection relationships and
epochs, counts and workspace/brand tuple. Selected hash must equal Version hash;
Version.inputRevision/hash/context/workspace/submission must equal approved Submission,
whose state=APPROVED and decidedByUserId/decidedAt equal Version approval identity/time.
No submitted names/content nor Campaign.input/conversation/narrative are selected.
Parent Context identity/workspace/archive may be pinned, but mutable unapproved draft
revision/inputRevision must not invalidate the same immutable approved Version.
Initial archived metadata can be represented; proof grants no action-specific archive
eligibility. Later source/agent consumers retain their existing archive rules.

## Issuer association, final recheck, and closed failures

Private WeakMap keyed by frozen empty proof stores exact original active S0 frame,
checked tx, S1a Brand proof, copied actor/scope/capture/checkpoint, private raw rows
and frozen view. Insert only after all actual checks and final base.assertCurrent.
No global tx cache or failed prepared-promise reuse. Every read/recheck awaits S0,
checks exact frame/tx identity, and revalidates the same genuine S1a Brand proof.
Final recheck selects only original locked Workspace/Context/Campaign/Binding/State/
Selection/Version/Submission IDs and those exact fields; no lock statements or
replacement-row discovery. Recheck actual current policy inventory separately.
Compare all pinned fields; Context comparison intentionally excludes parent draft
epochs. Run final scope recheck after all caller DB/core work as the last scope step.
S0 closes the frame before maintenance/auth/COMMIT; every later proof access fails.
Fake/copied/cross-frame proof or actor/scope mismatch: CampaignPlanningError
SCOPE_PROOF_UNAVAILABLE503; S0 frame/auth and S1a native failures retain priority.
Absent/wrong-scope campaign/workspace/binding: NOT_FOUND404, no creation/hydration.
Missing state/selection/source, stale identity/epoch/hash/decision/archive, uncaptured
reviewer or owner coverage: RETRY_REQUIRED503. Invalid input: VALIDATION422.
Actual actor expiry/revocation: native401. No raw private body in errors or logs.

## At most three independent native RED groups

1. Genuine OWN and CLIENT bound metadata (NONE and approved selection); exact frozen
views; fake/copied/cross/closed proofs deny; missing/unbound/workspace mismatch cannot
create rows. Physical owner+logical reviewer overlap succeeds; no source/body selects.
2. Real Workspace/Context/Campaign/Selection waits, with supported committed mutable
scope drift before that row is locked: original-ID retry, no late User/source locks,
rollback of owned writes. Version/Submission wait witnesses prove reload and retained
identity; negative metadata pins have adjacent valid controls. Do not bypass native
immutability guards to manufacture a source edit. New required policy reviewer denies.
3. Same-tx scope mutation after prepare and actual lease expiry: final recheck rolls
back; proofs close after commit/rollback; no cached proof reuse. An unapproved parent
draft edit alone preserves the same approved selection, while archive/selection
epoch changes retry. Native SQL witnesses distinguish no-lock final rechecks from
initial locking and verify no protected source/body hydration in this slice.
