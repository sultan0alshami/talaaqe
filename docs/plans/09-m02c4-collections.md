# M02C4 — reusable creator lists, notes and comparison

Prerequisite: reviewedd674810 grouped actors/current public projection. Preserve
Talaqee composition and both websites. Implement OWN_BRAND and CLIENT separately;
no fallback from failed delegation, matching-score/offer/contract authority,
provider activation or outreach follows from a saved public creator reference.

## Ownership and ordered delivery

Root owns schema/migration, pure contract freeze, native scope/auth composition,
thin routes/pages/shell links and progress. Independent author owns ignored
collection-schema draft then tests/collections/schema.test.ts on activation;
root executes actual RED before additive migration. Reviewer reads schema/SQL
independently before guarded deployment. A separately assigned leaf owns new
collections/service.ts after independent native service RED. Presentation owns
creator-collections.tsx/CSS only after DTO and original-composition mapping.
Peers are not alone; preserve every unassigned path. Root alone runs mutable
targets, Prisma generation/preparation, browser and four gates. Do not reset.

## Additive database freeze

CreatorCollection has id, scope OWN_BRAND|CLIENT, brandId, nullable organizationId/
clientId, original name/nameLanguage, revision1, archivedfalse, createdAt/updatedAt.
CHECK name1..200 nonblank, declared language null or2..100, revision1..2147483646.
OWN_BRAND requires null org/client; CLIENT requires both. Brand FK RESTRICT and
CLIENT composite FK(clientId,organizationId,brandId) binds OrganizationClient
(id,organizationId,brandId), with its additive redundant unique index. Cursor
indexes(scope,brandId,archived,id) and(scope,clientId,archived,id). UPDATE trigger
holds id/scope/brand/org/client/createdAt immutable and exact revision+1.

CreatorCollectionEntry has id, collectionId FK RESTRICT, immutable retained
creatorReferenceId, nullable live creatorId FK SET NULL, original note/noteLanguage,
removedAt nullable, timestamps. CHECK live null OR equal retained reference;
UNIQUE(collectionId,creatorReferenceId), creatorId and(collectionId,removedAt,id)
indexes. Note null or at most2,000 chars; language null or2..100. Identity fields
cannot change; no reassignment or null-to-live revival. Genuine nonnull-to-null
FK deletion is allowed only when the old Creator no longer exists and all other
fields are unchanged. It preserves notes/history without parent revision bump.
Ordinary user edits advance the locked parent once through the domain service.
No creator names/handles/metrics/prices are cached in these records.

CreatorCollectionCommand has id, scalar actorUserId, operationKey, payloadHash,
collectionId FK RESTRICT, action, minimal result JSON, createdAt; actor/key unique,
collection history index,64 lowercase-hex hash CHECK and immutable UPDATE trigger.
Receipts/audit/events store action/resource/revision/state only, no name/note/card/
contact/evidence. APIs expose archive and soft removal, not physical purge.
New Brand RESTRICT retention is intentional; existing historical Deal deletion
restrictions stay intact. Qualified privacy retention/purge needs separate review.

## Domain and permission freeze

Explicit request scope is OWN_BRAND with exact brandId, or CLIENT with exact
clientId. Current native BRAND authentication precedes parsing/private preflight.
OWN_BRAND proves actual current Brand.userId under grouped locks without forcing
organization setup. CLIENT uses current view for private reads and plan for
mutations, exact scope/Brand binding and captured ClientAuthority revisions.
Plan-only responses contain minimal receipt metadata, never existing notes/cards.
Owner transfer, suspension, session/version/delegation/grant changes deny current
access before historical replay; new actual owner may access OWN_BRAND company
records but never another agency's CLIENT notes for the same Brand.

Commands create/rename/archive/restore/add/remove/edit-note use actor/key/hash,
complete original payload and expected parent revision. Exact replay returns
historical metadata once without duplicate change/event; conflicting scope/key/
payload or stale/ABA revision rejects. Archived edits require explicit restore.
No hardcoded creator quantity or fake activity. Capture/projection/locks reuse
the reviewed required reader and current public predicates; saving grants no
procurement eligibility. Maximum1,000 active entries/list is transactional;
header pages20 and entry/comparison pages12 are bounded and never padded.

Read entry references without locking them, lock/recheck required Creator/domain
scope, then lock/recheck entries. Entry-before-Creator can invert against Creator
DELETE's FK update. Note-only commands require no creator projection. Reads return
entry ID, original note/language/time and current permitted public card or
unavailable; retained reference is not exposed as a historical public identity.
Comparison is an ephemeral max12 selected saved entries, not a new model or
replacement campaign ranking. Preserve source/date/unknowns and original content.

## Acceptance and UI

Native migration witnesses cover exclusive/composite scope, immutable identity,
exact revisions, live/reference binding and uniqueness, actual Creator DELETE
preserving note/tombstone, prohibited revival, command immutability and retention.
Service witnesses cover own-company and two agency clients, view/plan separation,
current owner/session/grant changes and waits, exact/conflicting replay, stale/
concurrent edits, withdrawn identities, bounded cursors/comparison and delete/edit
ordering. Real browser checks cover original content, limits, empty/unavailable,
save/retry/resume, authoritative denial closure, comparison,360px AR/EN, keyboard,
focus/reduced motion and genuine async progress. Preserve Talaqee projects-list
header/card/row geometry and reuse its retained discovery card for list entries.
Independent review and npm run check precede each integration commit. Fixtures
prove local mechanics only; the full managed-plan goal and external gates persist.
