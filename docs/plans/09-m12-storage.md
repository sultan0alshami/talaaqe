# M12 P1 native storage — root preparation 2026-10-12

Prerequisite9d8733b saved all four gates and exact P0 declarations. Root owns
schema, migration adoption/docs and all runs. Three new models only; no service,
routes, UI, generic asset access, provider or native authority is activated here.
Existing applied migrations/history/data stay unchanged. Tests use guarded owned
native fixtures; all production-facing eligibility remains in the later service.

ExternalCollaboration: id TEXT PK, ownerUserId TEXT FK User RESTRICT,
revision INT, status TEXT, archived BOOLEAN, detailsJson JSONB, createdAt/updatedAt
TIMESTAMP(3); UNIQUE(id,ownerUserId), owner/id index for bounded private lists.
Initial revision1/statusDRAFT/unarchived; exact P0 Details bounded262144 compact
UTF8 with exact closed keys/types, original BCP47/null/text/checklist limits,
distinct case-insensitive UUID item IDs, central exact Money bounds and UTC range.
Owner/id/createdAt immutable. Update advances revision exactly1 with nonregressing
supported finite timestamp, max2147483646. Status changes obey P0 transition map.
One new shared native arithmetic function
infame_external_collaboration_next_revision(current_revision integer)->integer
is IMMUTABLE, called on null input, and throws23514 for null/outside1..2147483645;
otherwise returns exactly+1. Parent update and child touch both use this function.
Independent native max-1/max/null controls plus source usage prove exhaustion;
never fabricate an unreachable max-revision parent or bypass sequential guards.
Archive/restore changes only archive metadata, never details/status. While archived
only restore is allowed. Unchanged details/status/archive may still advance for
the native child touch below; service rejects ordinary no-op user commands.

ExternalCollaborationCommand: id PK, actorUserId FK User RESTRICT,
operationKey UUID, collaborationId, action, payloadHash TEXT, resultJson JSONB,
createdAt TIMESTAMP(3). UNIQUE(actorUserId,operationKey); exact composite FK
(collaborationId,actorUserId)->parent(id,ownerUserId) RESTRICT.
Receipt immutable UPDATE, bounded4096 compactUTF8, exact P0 receipt keys and
action correlations; operationKey JSON parses to the same native UUID while its
original spelling remains retained/hash-bound. On INSERT lock original parent
FOR SHARE and require receipt resource/revision/status/archive equals current
parent, same actor owner and valid supported nonfuture-to-receipt chronology.
ATTACH/REMOVE receipts additionally resolve exact same-parent owned binding with
expected active/removed state. Hash labels grant no request/authorship authority.
No automatic audit/event or permission from SQL receipts.

ExternalCollaborationAttachment: id PK, collaborationId, ownerUserId, assetId
UNIQUE, assetPurpose TEXT fixed EXTERNAL_COLLABORATION_ATTACHMENT, label JSONB
exact P0 OriginalText<=200, attachedAt TIMESTAMP(3), removedAt nullable timestamp.
Composite FK(parent id,owner)->parent and FK(asset id,owner,purpose)->PrivateAsset
RESTRICT. Use existing PrivateAsset_id_purpose_ownerUserId_key and FK field order
(assetId,assetPurpose,ownerUserId)->(id,purpose,ownerUserId); no duplicate index.
Retain existing asset identity guards. Fixed owned asset must not be deleted and
must have allowed P0 type/1..10485760 size. Source byte checksum/namespace/readiness
remain runtime checks, never claims of actual bytes from native metadata.
Identity/label/attachedAt immutable; only null->valid removedAt>=attachedAt.
No revival, reassignment or removal timestamp edits. Archived parent rejects
fresh attachment insertion/removal. Serialize active<=20 under parent FOR UPDATE.
Attachment INSERT requires removedAt=NULL. UPDATE already holds the child row,
so acquire/check its original parent FOR UPDATE NOWAIT (safe if already held);
never wait on an uncaptured parent after the child. Native55P03 conflict rolls
back the statement. Removal does not require available/nondeleted bytes: losing
byte availability must not prevent the owner from unlinking its owned binding.

Each successful Attachment INSERT or first tombstone automatically updates parent
revision exactly once and updatedAt=max(existing,actual child timestamp). Service
must not double-increment for ATTACH_FILE/REMOVE_ATTACHMENT; capture resulting
parent version for its command receipt. Child mutation with exhausted parent
revision fails atomically. Other details/status/archive commands advance parent
explicitly once. Parent lock precedes child/asset accesses; no late User lock in
storage triggers. Positive list reads will use explicit ASCII ordering later.

No hard-delete route, default purge or permanent User-retention claim. No DELETE
immutability fence is added here: a future qualified retention operation may
teardown explicitly Command/Attachment->Parent; FKs prevent accidental cascading
loss and ordinary update cannot erase retained receipt/binding identity. Guarded
tests cleanup only their owned terminal records in that order, before User/Asset.

At most three independent native RED groups: parent exact details/chronology/
sequential identity/status/archive and rollback; actor/key/immutable complete
receipt ties and attachment identities/child revision touches/count cap; actual
separate-connection last-attachment contention, reverse/stale/exhausted operations,
foreign tuple/purpose/deleted asset and failure rollback. Existing real User/
PrivateAsset records are controlled fixtures, not native session/byte acceptance.
No trigger bypass/global fixture privilege. Reviewer verifies SQL/helpers/native
witnesses; root observes missing-table RED before product migration adoption and
all four gates/matching all3 target checksums before commit.

Existing helper dependencies: infame_planning_json_bytes(jsonb) compact UTF8;
infame_reference_canonical(jsonb) plus infame_planning_ai_hash(jsonb) use core
sha256(bytea), no new extension. Reuse reviewed infame_planning_ai_* closed JSON,
depth/ID/int/minor/text/original-language/UTC helpers where semantically identical;
preserve nullable/zero Money and original timezone semantics rather than blindly
reuse stricter Campaign requirements. Runtime central schema/hash validation
remains mandatory. No existing applied function or migration is rewritten.

Native-support parity extension: local M12 UTC validation retains the central
canonical instant grammar but excludes year0000, which PostgreSQL cannot store
as AD timestamp. Apply it to period endpoints and all M12 DTO dates only; no
shared vocab, old hashes/data or other domain changes. New local SQL period
validation keeps actual UTC ordering and exact UTC/IANA syntax, but compares
PostgreSQL zone names case-insensitively in ASCII so valid asia/riyadh retains
its original spelling. Central Node Intl validation remains mandatory; catalog
and ICU equivalence is not universally asserted. Paired controls require year1
and both Riyadh spellings valid, year0000/lower utc/Mars/Olympus invalid.
