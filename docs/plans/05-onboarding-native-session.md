# Native sessions for interactive onboarding

Coordinator-approved implementation freeze, 2026-10-10. Prerequisite PWA
checkpoint5b5f2a9 passed all four gates, four browser cases and the production
static HTTP check. This narrow native/session correction activates no new
provider or publication authority. The larger Infame goal remains active.

## Prerequisites and inspected gap

Read AGENTS.md, docs/CONTRACTS.md, docs/BRAND_IDENTITY.md and the relevant installed
Next server/client and route-handler guides before activation. Retain Talaqee's
page composition, existing Arabic/English inputs and explicit publication checks.
OpenAI and unavailable voice/import capabilities remain disabled.

The six interactive exports currently accept only actorUserId for authority:

| Existing file | Interactive export | Inspected declaration |
| --- | --- | --- |
| src/lib/onboarding/drafts.ts | createOrResumeDraft | line126 |
| src/lib/onboarding/drafts.ts | getDraft | line133 |
| src/lib/onboarding/drafts.ts | applyDraftCommand | line286 |
| src/lib/onboarding/profiles.ts | profileCommand | line65 |
| src/lib/onboarding/profiles.ts | profileForOwner | line166 |
| src/lib/onboarding/jobs.ts | queueSourceJob | line81 |

drafts.ts authorize/withOwnedDraft lines102–124 lock the User, check active/current
BRAND or CREATOR and recheck Draft owner/kind after its row lock. They never bind
the native AuthSession, sessionVersion, revocation or actual expiry. profileForOwner
has a separate User/profile ownership transaction with the same native-session
gap. Receipt replay and full DraftDTO projection therefore lack that boundary.
This is source evidence, not an executed exploit or native test result.

Both API adapters resolve requireRole and all four SSR adapters resolve
requirePageSession, then discard everything except userId. The thin draft lookup
in API/SSR currently runs separately against prisma; move its private lookup into
an authenticated native loader/frame in the assigned service files. Empty/null
owner paths also require final authorization. Do not leave a missing-draft branch
that bypasses current-session checking.

## Exact ownership

Coordinator owns new src/lib/onboarding/session.ts, and changes to:

The existing error class is moved to coordinator-owned onboarding/errors.ts and
re-exported from drafts.ts to preserve all historical instanceof consumers.

- src/lib/onboarding/drafts.ts;
- src/lib/onboarding/profiles.ts;
- src/lib/onboarding/jobs.ts;
- src/app/api/onboarding/route.ts;
- src/app/api/onboarding/[id]/commands/route.ts;
- src/app/brand/onboarding/page.tsx;
- src/app/creator/onboarding/page.tsx;
- src/app/brand/profile/page.tsx;
- src/app/creator/profile/page.tsx.
- src/components/infame/readiness-panel.tsx — additive optional401/403 onDeny
  callback only, so onboarding can clear all private state synchronously; retain
  the existing native current-key assessment and404 behavior.

The future UI worker owns only src/components/infame/onboarding-screen.tsx.
Workers are not alone and preserve all other edits. Shared auth, organization
context, primitives, brand, schema, migrations, dependencies and provider setup
remain outside the worker's ownership. No changes to public portfolio screens or
publication prerequisites are authorized by this narrow mission. Coordinator owns
documentation, exact adapters/contracts, test execution and commit.

An independent native test author owns at most three new consequential groups and
bounded existing fixture plumbing. A separate reviewer checks actual session
entrypoints, complete lock order, job separation, private hydration, replay and
staged scope. Root observes RED before service activation and mounted browser RED
before UI activation, then runs current native/browser checks and all four gates.

## Interactive native session contract

Each of the six exports requires trusted serverAuth/current-session metadata in a
separate server argument: userId, role, sessionId and sessionVersion. Missing or
malformed metadata defaults to UNAUTHENTICATED/401, including calls with malformed
input, unknown IDs or old receipt keys. Capture it immutably before the first
await and require its userId to equal the historical actorUserId argument.

Reuse captureOrganizationActor, checkProfileActor and assertLockedProfileActor
from src/lib/organizations/context.ts. The fixed allowed roles are CREATOR and
BRAND; do not broaden organization authority to CREATOR or allow caller-selected
roles. Reuse the guarded-await/current/final-check pattern of deals/session.ts
without modifying that shared feature. Map safe native auth errors to the existing
domainHandler request-ID/private-no-store error envelope.

Auth metadata is never command data, a transport body/query, operation hash,
DraftCommand result, source job identity/result, DTO, browser prop or journal.
Keep existing operation-key prefixes, exact command hashing, original words,
money validation, revision checks, role-specific field restrictions and trusted
FORM/VOICE channel behavior. Renewal of a genuine native session must preserve
exact committed command replay; no receipt author/session field is fabricated.

Typed options are OnboardingReadOptions={client?,serverAuth?}; command options
add trusted channel FORM|VOICE. Missing serverAuth is denied, never inferred.
getDraft keeps its exact-ID overload and adds a null-ID internal current-user/kind
lookup returning DraftDTO|null under the same native frame. This replaces the
three separate API/SSR Prisma lookups without an extra unguarded export or GET
that creates a draft. One real fixture session is captured at User creation and
reused; call helpers never silently renew it. Public/background signatures stay
separate. Current authorization remains outside hashes and output.

Authentication uses the actual clock after waits. A caller's business observation
date, input timestamp or fixture clock cannot extend AuthSession expiry. Validate
active User, exact role/version, exact session/user/version, nonrevocation and
expiry before private hydration, after every database wait once locked, on replay,
before returned DTO/null and at final commit. Semantic failures remain semantic;
only reviewed native serialization/deadlock or changed-inventory conditions retry
under a fresh current-auth check. PostgreSQL-aborted transactions must not receive
extra auth queries that mask the original conflict.

## Complete lock order and publication preservation

Maintain complete sorted owner User locks, then disjoint sorted reviewer User
locks, then the exact AuthSession FOR SHARE, then domain rows:

1. Capture thin owner/reviewer identities as an inventory, never as authority.
2. Acquire all owner Users and all required reviewer Users before AuthSession.
3. Lock/check the captured exact AuthSession using the original transaction.
4. Lock/recheck OnboardingDraft owner/kind, then SourceJob or profile domain rows.
5. Revalidate native auth after waits and before full content/receipts/results.

profileCommand's existing beforeDomainLock callback at profiles.ts:160 invokes
lockEvidenceActors for Creator/Brand proof users. Place the AuthSession lock after
that complete reviewer inventory, never before the callback and never acquire a
new reviewer after session/domain locks. Ownership/reviewer inventory changes must
cause a bounded fresh capture or the existing semantic denial, without granting
rights from a preflight label. Retain currentCreatorOwner/currentBrandOwner and all
assertPublicationPrerequisites/assertPublicationAccountSelection checks.

SAVE_PROFILE, portfolio generation/approval, PUBLISH and HIDE retain their current
private/public behavior, exact outbox/receipt semantics and rollback. A valid
native session never substitutes for email, ownership, representation, explicit
consent, approved current portfolio or selected-account publication evidence.
publicCreator/publicBrand and their actual sessionless visibility/proof consumers
remain unchanged; do not require a viewer session for already permitted public
profiles.

## Accepted background jobs remain a separate server lane

jobs.ts withJob line69 uses withOwnedDraft for startSourceJob, checkpointSourceJob,
completeSourceJob, failSourceJob and runWebsiteSourceJob (lines113/188/200/219/239).
No mounted API or script caller was found for those worker exports; current
runWebsiteSourceJob is server-only orchestration and invokes start/fail/complete
internally. queueSourceJob alone is an interactive customer request and gains the
strict native browser-session boundary.

Keep accepted worker execution independent of a user's later browser logout or
expiry. Use a narrowly named internal owned-job/draft helper for that existing
server lane, never a generic skipAuth, caller-supplied mode or default fallback
from missing interactive metadata. Current active User/role, current Draft owner
and kind, exact Job/Draft binding, execution-token hashing, source identity and
consent revision, stale adoption, one acquisition and uncertain-billing fences
remain mandatory. Completed/failed exact-token replay remains private and bounded.
Source corrections or owner/kind changes still refuse or stale adoption according
to the existing accepted semantics. No new worker, external call, token issuance
route, permission, imported fact approval or provider readiness is added.

## UI denial and known outcome behavior

onboarding-screen.tsx request at line65 currently reads response.json before
status. Its generic error leaves Draft/owner/portfolio/form fields and pendingKeys
visible and active; it lacks abort/mount epochs. Correct only that leaf within its
current cards/steps and the shared brand identity.

For authoritative401/403, synchronously invalidate the private epoch, abort active
reads, clear original private draft/profile/portfolio/form/source/consent/notice
values and pending keys before reading any response body. Render a labelled
denied state and keep protected controls disabled until new authenticated
navigation/actor-keyed remount. Late responses cannot restore any cleared data.
Use bounded response decoding, safe generic failures and actual private-no-store
request-ID envelope checks; do not print raw error payloads/private values.

Use a synchronous mutex plus abort/generation guards rather than state-only busy
checks. Maintain known successful receipt/outcome in memory before a follow-up
read. A failed follow-up GET never converts known success into an uncommitted
command or automatically replays it. Reconcile known confirmation through an
explicit authorized read. For an uncertain in-flight command, retain its captured
exact key/body in memory for an explicit retry; don't generate a fresh key/body
merely because form values changed or a read failed. Do not add plaintext browser
persistence, general offline writes, background retries or a new recovery schema.
The existing server draft remains durable; distinguish that fact from an
uncertain client command lost on navigation. No fake restored-command claim.

Retain actual text input/form confirmation, genuine unavailable voice/import
copy, all publication controls and the existing publication-readiness panel's
strict native boundary. Geometry and labels remain usable at360px Arabic RTL and
English LTR, with44px controls, focus/keyboard and reduced-motion behavior.

## Bounded meaningful verification

Exactly at most three new independent native groups:

1. All six interactive calls reject missing, malformed, mismatched and forged
   native tuples before malformed-input validation, private hydration or replay;
   genuine owned BRAND and CREATOR sessions preserve exact original results,
   command hashes and renewed-session receipt replay. ADMIN stays forbidden.
2. Observe genuine PostgreSQL blocking via pg_stat_activity/pg_blocking_pids on
   User/AuthSession. Commit logout/revocation or sessionVersion active-state ABA
   while an interactive read/write/replay is queued. After release it denies and
   exposes no DTO; owned Draft/profile/receipt/outbox/job rows stay unchanged.
3. Set a short real expiry before an actual Draft/profile/private projection or
   DraftCommand/outbox INSERT wait. Observe the wait before expiry, let the real
   clock expire, release, require401 and whole write rollback/no replay output.
   Renew a real session and prove recovery. Include accepted background exact
   token completion without browser session as a regression positive; retain
   owner/kind/consent/source correction refusal and uncertain-billing fences.

Existing seven files that directly call interactive functions need actual owned
openSession/resolveSession fixture metadata, not a global fixture bypass:

- tests/onboarding/durable.test.ts;
- tests/onboarding/profiles.test.ts;
- tests/onboarding/publication-prerequisites.test.ts;
- tests/imports/website-jobs.test.ts;
- tests/imports/draft-ownership-wait.test.ts;
- tests/readiness/publication.test.ts;
- tests/campaigns/onboarding-review.test.ts.

Keep their current original-word/revision/concurrency/publication tests. Existing
import owner/kind wait tests remain consequential worker tests. Owned synthetic
proof observations remain explicitly synthetic, never live legal/provider proof.
Use real session fixture plumbing and owned cleanup only; no registered .test
imports, reset, source DB access, auth/time mocks or provider calls.

At most two browser journeys, parameterized across Arabic/English as needed:

Two additional independent native transport groups cover both adapters using
only the Next cookie-context seam with genuine signed JWT/AuthSession/domain
calls. Query-free GET/base POST/command POST reject authenticated query fields422
after current role resolution and before body or private lookup. Shared origin
and current session/role denials take precedence. Preserve existing ignored-body
base initialization and bounded strict64KiB command transport, exact hashes and
renewed replay. Missing current draft/owner reads create nothing.

1. Genuine native owner onboarding: save exact original text, observe server
   persisted draft and actual portfolio prerequisites; then revoke/expire the
   session during an actual request. Assert denial clears DOM/form values before
   body parsing, no late response restores canaries, controls remain sticky and
   focus remains meaningful at360px RTL/LTR.
2. Genuine confirmed command with a failed subsequent read: retain confirmation,
   reconcile by read only, no second business POST/new key; uncertain explicit
   retry retains its frozen key/body. New authenticated navigation resumes the
   real saved draft. Publication still requires its actual evidence and consent.

An emulated malformed/failed transport may establish UI handling but must be
labelled separately from native revocation, SQL writes and actual owner recovery.
Root records reproducible RED/GREEN/runtime limitations in docs/PROGRESS.md, runs
npm run check before committing exact owned paths and preserves current task DBs,
services and other work. This preparation grants no broader onboarding redesign,
voice/media integration, provider activation, external setup or publication.
