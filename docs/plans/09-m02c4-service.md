# M02C4 service and customer flow

Prerequisite: reviewed38e8e2b,15 reviewed migrations and frozen collections
contracts. Implement the complete scoped list/note/comparison flow within the
existing Talaqee page composition. Keep OpenAI/provider/billing/outreach disabled.

## Ownership and interfaces

Root owns collections/scope.ts, shared organization authority checkpoint/actor
composition, routes/server pages/navigation and progress. Domain worker owns
only new collections/service.ts and collections/loaders.ts after independently
authored native RED. Test author owns tests/collections/service.test.ts, initially
an ignored draft. Root creates inert typed interfaces first and alone executes
guarded targets. Independent reviewer checks domain and root authorization;
presentation/browser leaves are assigned after native DTO acceptance. Preserve
every other path and current records; no reset or implicit scope fallback.

Public domain APIs are applyCollectionCommand(actor,input,options),
getCollectionHeaders(actor,input,options), getCollectionEntries(actor,input,
options) and compareCollectionEntries(actor,input,options), returning their
frozen schemas. Options are trusted native client and optional captured clock.
Authenticate current BRAND before parsing or private preflight. One reader
covers metadata capture, grouped owner/reviewer locks, current authority/domain
queries, projection, audit and final authorization. Root supplies current native
scope callback with actual brand/org/client/authority and actor coverage.

OWN_BRAND requires actual current Brand.userId under grouped locks, no organization
setup. CLIENT requires current view for reads and plan for writes, exact immutable
org/client/Brand binding and expected authority on mutations. Existing caller
compatibility remains; propagate reader checks through every native authority
await and never lock a User inside a domain callback. Plan-only receipts are
metadata-only and confer no private read. Current scope/session/role/delegation
checks precede exact historical replay; revisions can be old only for that replay.

## Commands and history

Canonical actor/key/hash covers the complete parsed original command/scope/
expected authority. Same actor key with another payload/resource/scope rejects.
Exact replay returns the stored minimal receipt with replayed:true and no second
mutation/audit/event. Creation makes parent revision1; other successful commands
lock/check exact current parent revision and advance once. Exhausted revision
rejects. Bind parent to actual scope before reading name/note or receipt. No
cross-agency or OWN-versus-CLIENT read for the same Brand.

CREATE/RENAME preserve declared original content; SET_ARCHIVED explicitly archives
or restores. Archived content can be reviewed, but edits require explicit restore.
ADD_ENTRY requires current canonical public identity at commit, not a stored card
or procurement eligibility. Keep one retained reference per list: active duplicate
rejects; restore soft-removed live entry explicitly through ADD only while public
identity remains available; never revive a deleted live FK. Max1,000 active entries
is checked under parent lock. REMOVE_ENTRY soft removes; EDIT_NOTE preserves exact
untrimmed text/language even for an unavailable/tombstoned creator. Neither needs
a creator projection. Command/audit/event contains minimal IDs/action/revision/
state only, not note/name/creator facts, and commits atomically.

## Reads, paging and comparison

Header scan limit+1 in ID order returns max20 and matching archived filter. Entry
scan max13 returns max12 active entries with exclusive cursor; comparison accepts
max12 unique selected entry IDs in caller order, all from the same exact list/scope.
No padding, historical card fallback or score/price. Bind scope before content
hydration. Capture entry reference IDs without entry locks; prepare bounded public
identity capture before all User locks. Under current scope/domain protection,
project Creator/domain rows first, then lock/recheck selected entries. Any changed
entry/creator identity scope rejects without adding another User lock; changed
visibility/proof returns creator:null while retaining own note. Genuine FK
tombstones stay unavailable and retain private notes/history.

Current scoped access audits hold metadata only. Authoritative401/403/404 clears
protected UI before body parsing; transient/invalid200 retains last success and
exact command key/body. Validate receipts against captured action/resource/next
revision/archive state; then current GET establishes displayed state. Old replay
receipt is history, not current list data. Manual inputs survive uncertain writes;
recovery never remints a key or silently overwrites a stale editor.

## Independent acceptance

Native cases cover own-company and two agency clients, view/plan separation,
current actor/owner/session/grant/delegation during actual waits, original content,
exact/conflicting replay, stale/ABA/concurrent mutations, archive/restore, duplicate/
capacity bounds, withdrawn/deleted creators, bounded cursors/comparison, minimal
audit/receipt/event and actual delete/edit ordering. Test-first RED precedes domain
implementation. No mocked producer proves live identity or private authority.

Mount pages inside original projects-list header/card/row geometry and reuse
retained creator-discovery-card for entries. Add genuine collection picker/save
action to discovery after scoped command acceptance; comparison/notes are free
manual work and cannot send offers/outreach. Actual signed-cookie browser checks
cover full create/save/edit/remove/archive/restore/compare, two-client isolation,
retry/lost reply/denial/malformed success,360px AR/EN, original words/long handles,
focus/reduced motion and loading/empty/unavailable. Independent review and all four
gates precede commit. Remaining readiness/managed missions stay in full scope.
