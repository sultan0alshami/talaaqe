# M12 P2 native owner service — root preparation

Prerequisite544e00d saved P1 storage/migration35 and all four gates.
Root owns shared session composition/routes; leaf new
src/lib/external-collaborations/service.ts only. No UI/HTTP/storage-byte/provider
effects in this DB-only slice. Existing assets/deals/profile APIs remain unchanged.

Exports executeExternalCollaborationCommand(actor:OrganizationActor,input:unknown,
 options?:{client?:PrismaClient}) -> ExternalCollaborationResult;
getExternalCollaboration(actor,input:{collaborationId:nativeId},options?)
 ->ExternalCollaborationDetail;
listExternalCollaborations(actor,input:{archived:boolean,after?:nativeId},options?)
 ->ExternalCollaborationList. Fixed30 headers, explicit ASCII ordering/exclusive
same-owner cursor; no caller owner/role/client/scope/limit/storage/clock flags.
Actual four-field actor and trusted client captured before awaits; use existing
beginOnboardingSession(actor.userId,{serverAuth:actor,client})/withOnboardingSession
without another nested wrapper. Genuine CREATOR-only lane; wrong valid BRAND/ADMIN
403, forged/revoked/expired401 before input parsing/private preflight or replay.
Synchronously descriptor-safe parse/copy command/query before first auth await,
retain invalid result until genuine native auth and fixed CREATOR gate pass;
do not execute getters or let mutable caller values/dependencies change after wait.

Inside one checked transaction lock actual owner User UPDATE, exact AuthSession
SHARE via lockOnboardingSession, then original owned parent (UPDATE writes/SHARE
reads), bounded attachment bindings SHARE and their exact owned-purpose assets
SHARE. No profile/publication/email eligibility requirement for private manual
records; no additional/late User locks. All guarded awaits and final native
actual-clock checks remain. Options cannot inject business/auth time.
REMOVE_ATTACHMENT takes its exact binding UPDATE after parent; metadata reads
remain SHARE. Removal needs no storage IO or available-byte assertion.

CREATE expectedRevision0 generates native parent id once before possible DB
retry, initial DRAFT/unarchived/rev1, preserves full strict details. SAVE_DETAILS,
SET_STATUS,SET_CHECKLIST,SET_CHECKLIST_DONE,ARCHIVE,RESTORE execute exact reviewed
version/state rules and increment once. Checklist UUID matching is semantic case
insensitive; preserve stored original IDs/spelling and original words. Unknown
item ->NOT_FOUND404; no-op ->INVALID_STATE409; exhausted ->VERSION_EXHAUSTED409.
Archived fresh edits reject; RESTORE only. REMOVE_ATTACHMENT is an owned DB-only
tombstone, preserving bytes and using the native exactly-once parent touch; never
double-increment. It needs exact current binding, not available bytes. ATTACH_FILE
remains CAPABILITY_UNAVAILABLE503 here after native ownership, never fake a file.

Current actual owner/session/parent precede immutable receipt replay. CREATE may
read own indexed key metadata to locate its already-retained parent. Strict native
receipt joins/hash/action/key/resource checked; same captured command replays
without revision/data/audit/event change, conflict ->IDEMPOTENCY_CONFLICT409.
Replay precedes fresh revision/archive/no-op/capability checks. Receipt epochs and
status/archive/time are historical, never required to equal the current parent.
CREATE locator selects only own indexed actor/key→parent metadata after native
User/Session locks; missing/corrupt retained parent fails closed, not fresh CREATE.
Fresh expected revision mismatch ->STALE_VERSION409. Each new command stores one
exact actor/key/hash/scalar receipt plus one minimized audit and pending domain
event atomically (no raw details/contact/bytes in these). Reads metadata-audit only.
Captured UUID/body/hash unchanged across supported bounded native conflicts;
no network, automatic resend, fake external parties or Role/byte authority flags.
Write event type is fixed external_collaboration.changed with standard envelope
and payload exactly {action,status,archived,attachmentId}; fresh command only.
Deduplication key uses external-collaboration:<actor>:<UUID> namespace; one audit
with action external_collaboration.command/resourceType ExternalCollaboration and
scalar receipt snapshot shares the transaction. Reads use
external_collaboration.read/list metadata audits (IDs/asOf/count/cursor/archive
only). Replays create no extra audit/outbox. No notes/names/brief/value enters them.

Private reads parse exact stored details and plain DTOs; corrupt/missing/pin/hash
inconsistency ->INVALID_STORED_COLLABORATION503, no repair/older fallback.
List preflight/body projections select only header-needed JSON fields and checklist
counts, not private notes/brief/whole details. A31st thin row proves next page;
hydrate only returned30 headers. Bound referenced active bindings/assets across
the whole batch in grouped table order, not parent→asset→next parent loops.
List needs only grouped active binding counts, so it need not hydrate asset or
binding labels at all. Exact body/asset joins belong to the detail/removal lane.
Detail attachment metadata has no readiness assertion; deleted/unavailable bytes do not
erase owned labels/history. Exact asset owner/purpose/type/size joins remain
required. Counts0..20 and list<=30 proven with a scalar/extra-row overflow check;
never truncate original text. No owner sessions/contacts/storageKey/checksum in
DTO. Query parent bodies only with actor owner predicate; foreign resources404
before body hydration. Current session expiry after waits/audit/journal rolls
back all tentative effects and denies protected reads/replay.

Independent at-most3 native groups before product: genuine actual CREATOR/session
without published profile create/full edits/checklist/status/archive/current
read/exact/conflicting replay; foreign CREATOR/BRAND/ADMIN/fake/currentrevoked/
expired actors before body parsing/foreign bodies, original captured dependencies;
actual parent/journal waits and final real-clock expiry, concurrent revisions/
two keys or identical-key one-effect, rollback/privacy/history. Root alone runs
guarded DB/tests/builds; independent source/test/index review and all four gates.
