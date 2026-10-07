# M03 full scoped campaign bridge

Prerequisites: reviewed context storage16 on all three native targets, context
services13 checks, retained context screens22 browser cases, final1009/104 four
gates and full161 browser checks/one unchanged intentional skip. All uncommitted
M03 work and unrelated research/original checkout work stay preserved. OpenAI
and paid provider/financial activation stay disabled.

Root froze typed planning contracts/inert interfaces at
src/lib/campaign-planning/{contracts,service,legacy}. This packet implements the
remaining full customer flow in09-m03-brand-context; it is not acceptance.

## Concrete customer behavior

New OWN/CLIENT campaign creation explicitly selects NONE or one exact approved
context version/hash. Selecting never overwrites fields. Human form edits and
literal UNPROCESSED CHAT/PARAGRAPH narrative are durable. Tone reuse produces
only an exact context-tone proposal with explicit KEEP/REPLACE and immutable
field/selection dependency. Human proposals remain separately classified.

Every new brief pins exact selection ID/revision, including NONE. Generation
reuse requires original fields/country/input checks plus that provenance.
Selection-only changes invalidate current approval; A→B→A cannot resurrect old
proposals/briefs. Archive blocks new selection/reuse but lets already pinned
approved snapshots finish generation/submission/actual-owner approval.

The actual current Brand owner reviews only submitted immutable brief/context
snapshots, even without an agency seat. It grants no general CLIENT draft access.
Agency plan/all-capability ownership cannot impersonate approval. Accepted legacy
deals keep original first-offer parties, approved brief and confirmations.

## Exact state and journals

CREATE starts Campaign/Planning/selection1 atomically. BIND_OWN is explicit,
OWN-only and advances existing Campaign once; no CLIENT rebinding exists.
Every successful fresh planning command advances Campaign and Planning once.
Only material fields advance fieldsRevision to the new Campaign revision.
Selection changes always append a new identity/revision and clear current
approval without rewriting any retained brief.

SUBMIT_BRIEF requires latest unapproved exact field/selection provenance. It
captures the post-submit campaign revision, actual target/session and CLIENT
revision. Owner decisions advance review1→2 and current Campaign/Planning once;
APPROVE checks current source and updates approval/current version. Authorized
stale DECLINE remains usable. Exact currently authorized receipt replay bypasses
fresh revision/archive predicates only.

CampaignPlanningCommand and PlanningReviewCommand store scalar/null minimal
receipts only: no content/conversation/contact/authority/session/replayed or
selectionId. Current GET supplies selection identity. Scope/resource/current
permission precede receipt decoding. New changed UUID payload returns
OPERATION_KEY_REUSED; original legacy key/hash/error/result behavior is retained.

Owner snapshot hash is canonicalHash({content:unapprovedBriefContent,provenance:
{selectionId,selectionRevision,versionId,contentHash}}). The immutable selected
version is hydrated through exact provenance under target authorization.

## Root ownership and implementation boundaries

Root owns contracts/scope/projection, campaign DB-only core/errors extraction,
shared auth/policy reviewer capture, legacy consumer guards, API/SSR/UI mounts,
schema/migrations/records. The planning service leaf may be assigned only after
independent native RED. Workers preserve every unassigned file. Root alone runs
guarded databases/browser/build and final commits.

Core extraction preserves old strict Campaign.input/Brief.content, mutation
channels, hashes, key prefixes, owner journals, results and actual party history.
Core functions perform DB work in the existing transaction; no authorization,
nested transaction, replay or old journal insertion. Return new brief identities
so all scoped automatic regeneration/generation writes provenance atomically.

Ordered locks: captured owner Users→captured policy reviewer Users→actual actor
AuthSession/current native authorization→Org/member/client/grant→Brand/workspace/
captured Context→Campaign/binding/state→selection/version/context submission→
brief/provenance/campaign submission/journal. Bounded identity preflight is not
authority. Drift outside captured owner/context/reviewer coverage retries; no late
User/Context lock. Trusted policy resolver receives complete prelocked actors.

## Legacy privacy and commercial direction

Exact CLIENT bindings are excluded before legacy count/limit/default selection,
full DTO hydration, independent matching and fresh direct compose/draft/create.
Explicit excluded IDs return NOT_FOUND404 with no fallback. Root's genuine
native getLegacyCampaignOverview/selectLegacyOwnerCampaign helpers replace the
direct SSR queries and are exercised by the independent native groups.

Fresh legacy mutation/generation/approval on bound OWN returns
SCOPED_PLANNING_REQUIRED409 after currently authorized genuine old receipt replay.
D048 makes explicitly scoped campaigns managed Infame services: fresh DIRECT
procurement on bound OWN returns MANAGED_CAMPAIGN_REQUIRED409 after retained
genuine replay; CLIENT is unavailable404. Existing accepted actual-party deal
reads/confirmations remain intact. Unbound historical compatibility and separate
authorized admin ALL_STORED_RECORDS scope are retained. Matching gets trusted
server session/final native authorization outside original input/hash semantics.

## Independent acceptance

receipt_tests owns an ignored draft then tests/campaign-planning/service.test.ts,
exactly three full native groups before implementation:

1. Full OWN manual/NONE/context/tone/narrative/brief/target-owner flow, archive
   pinned semantics and genuine accepted legacy journal/party/brief retention.
2. Actual same-Brand CLIENT A/B and view/plan scope, atomic new creation, minimal
   history, actual owner-without-seat submitted-only review, substitutions and
   every real legacy consumer/selector/matching/fresh-offer denial.
3. Selection ABA/dependencies/stale versions/keys/concurrency and actual native
   session/grant/client/owner waits, expiry/withdrawal/transfer rollback, bounded
   private reads and metadata-only effects.

Native signed sessions, organization commands and real producers are required;
fixtures do not establish live legal/provider acceptance. Full retained campaign
UI/unknown recovery/dirty words/manual reload and current native/browser/four
gates follow. MARKETING_REFERENCE purpose/binding/immutable manifest through a
separate reviewed additive migration is still required; no file controls before
that integration. Neither this packet nor green helpers complete M03/full MVP.
