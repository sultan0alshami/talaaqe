# M12 owner-private manual external collaboration organizer — implementation freeze

Root preparation, 2026-10-12; routine choices accepted under the founder's direction.
Prerequisite05d51d0 preserves current source/native/all-four gates. Implement in
bounded order: pure declarations, native storage, owner-session service, dedicated
attachments, transport and retained screens. These declarations activate no flow.
Authority: docs/plans/09-managed-platform.md M12. Root owns schema/API/pages/storage
boundaries/adoption/execution; domain workers own only explicitly assigned paths.
No Deal/Brand/User fabrication, managed obligation, signature, rating, payment,
verified earning, sharing/invitation, public profile or AI/provider/voice effects.

## Exact owner and native boundary

Scope is the actual current CREATOR User owning the record, never a client-provided
role/owner label, Creator profile publication/readiness or organization membership.
Capture the four-field server actor and trusted client/storage before the first wait.
Require native active User role=CREATOR, current sessionVersion, exact AuthSession
ownership/version/nonrevocation/real-clock expiry before body parsing and replay.
Reuse profile-session predicates, but the new service facade is fixed CREATOR-only.
Lock owner User -> exact AuthSession -> owned ExternalCollaboration -> attachment
bindings -> PrivateAsset in one transaction. No late User or second transaction.
Recheck native authority after DB waits and before/after byte I/O and final commit;
resource dates never control authentication. Another CREATOR gets scoped404; BRAND
and ADMIN get403, expired/forged/revoked actor401. No admin/private-file bypass.
Owner identity/id/createdAt are immutable; records cannot be transferred or shared.

## Minimal native records and strict original content

ExternalCollaboration: {id,ownerUserId,revision,status,archived,detailsJson,
 createdAt,updatedAt}. Owner FK is actual User; positive revision<=2147483646;
native guard preserves owner/id/createdAt and sequential revision/update time.
detailsJson exactly {schemaVersion:1,clientDisplay,campaignDisplay,declaredValue,
 period,notes,brief,checklist}. No counterparty FK, contact lookup or inferred party.
clientDisplay/campaignDisplay: OriginalText, nonempty original text<=200 each.
declaredValue: MoneySchema|null; exact minor-unit decimal string/BigInt with one
current ISO currency, no Number/automatic FX. Null is unknown, not zero or income.
period: DateRangeSchema|null (real canonical UTC instants, starts<ends, explicit
IANA timezone). Null is unknown; no assumed timezone or fabricated completion date.
notes: OriginalText|null, nonempty when present, text<=10000.
brief: OriginalText|null, nonempty when present, text<=20000; manual private text.
Text uses existing BCP47/null language and domain control-character rules; preserve
body whitespace/original language. UI translations remain independent.
checklist: ordered array0..30 of {id:UUID,label:OriginalText,done:boolean}; labels
nonempty<=500, distinct stable IDs; no automatic deliverable/progress verification.
Whole strict plain details JSON<=262144 bytes; outward dates are ISO strings.
Native money/time/JSON bounds and immutable identity constraints mirror the central
schemas; application role/ownership checks remain mandatory, not implied by FKs.

ExternalCollaborationCommand: {id,actorUserId,operationKey,collaborationId,
 action,payloadHash,resultJson,createdAt}; unique(actorUserId,operationKey),
same-owner composite binding to parent, lowercase SHA256 hash, bounded receipt.
Hash domain infame-external-collaboration-command-v1 covers actual actorUserId,
action/resource/expectedRevision/payload; never AuthSession/token/transport flags.
Receipt contains IDs/action/resulting revision/status/archive flag only, not raw
notes/brief/bytes. Historical replay does not restore older content or attachments.

ExternalCollaborationAttachment: {id,collaborationId,ownerUserId,assetId,label,
 attachedAt,removedAt}; immutable parent/owner/asset, same-owner parent binding and
unique asset binding. Original display label<=200; current active count<=20.
PrivateAsset retains its existing opaque storageKey/checksum/type/size/revision.
The domain-specific purpose is EXTERNAL_COLLABORATION_ATTACHMENT, never an evidence
purpose or MARKET/ownership/legal approval. Attachment owner equals parent owner.

## Fixed actions, statuses and revision receipts

CREATE: expectedRevision0, complete details; status DRAFT, archived=false,
revision1. Parent ID minted by server; exact-key replay returns original receipt.
SAVE_DETAILS: complete replacement of details under expected current revision.
SET_STATUS: explicit requested self-reported status; no automatic status change
from checklist, money, attachment, date or any other platform event.
SET_CHECKLIST: replace ordered checklist, preserving supplied existing stable IDs;
new UUID IDs are declarations only, never cross-record authority.
SET_CHECKLIST_DONE: exact current item ID + boolean, parent revision required.
ATTACH_FILE: parent revision + original label + bounded inspected immutable bytes.
Its strict JSON payload is only label plus {checksum,contentType,size}; bytes stay
outside JSON/hash input as separately trusted Uint8Array transport. The server
must independently inspect and exactly match those bytes before any storage effect.
The attachment label uses OriginalText with its explicit nullable language.
REMOVE_ATTACHMENT: exact owned current binding ID; hides/unlinks, not byte deletion.
ARCHIVE / RESTORE: explicit reversible archive flag, same revision protocol.
Each successful new command increments parent revision once and journals one
immutable receipt atomically. Replay verifies current native owner first, then
exact actor/key/hash/resource; differing reuse ->IDEMPOTENCY_CONFLICT409.
Stale nonreplay expected revision ->STALE_VERSION409; concurrent CAS loss retries
or rejects without partial edits. Never replace the existing exact recovery key.
No-op fresh command ->INVALID_STATE409; exact original replay still succeeds.

Statuses: DRAFT, PLANNED, IN_PROGRESS, COMPLETED, CANCELLED; all self-reported.
Allowed transitions: DRAFT->{PLANNED,IN_PROGRESS,CANCELLED};
PLANNED->{DRAFT,IN_PROGRESS,CANCELLED}; IN_PROGRESS->{PLANNED,COMPLETED,CANCELLED};
COMPLETED->{IN_PROGRESS}; CANCELLED->{DRAFT}. Reopening is an explicit owner command.
Archive preserves status/content; archived records remain owner-readable and only
RESTORE may make new edits. Replay of prior commands creates no fresh mutation.
Status change time is server-recorded history, not proof of work/payment completion.

## Private attachment transport and honest retention

Reuse EvidenceStorage, inspectEvidence, byteChecksum and10MiB PNG/JPEG/WebP/PDF
signature limits; this is not malware scanning. No URL fetch, audio, archive or
office-file support in this first contract. Metadata does not prove usable bytes.
Add the distinct purpose to generic evidence GET exclusions alongside
MARKETING_REFERENCE: src/lib/evidence/assets.ts getPrivateAsset otherwise permits
ADMIN access. Do not broaden its evidence upload role/purpose allow-list.
Dedicated upload/download uses current native CREATOR + owned parent + exact active
binding + same asset owner/purpose/not-deleted + checksum/size/storage namespace.
Downloads are private,no-store attachments with nosniff/sandbox and a fixed safe
filename; no public/signed URL, storage key, checksum-as-capability or raw logs.
Opaque immutable object key derives from domain/actor/operationKey. Same-key retries
cannot overwrite bytes; differing metadata/bytes conflict. Success only after both
native binding and bytes are confirmed. On uncertain storage/commit preserve bytes
for reconciliation; remove only proven newly-created unreferenced bytes under live
owner protection. Never remove a preexisting referenced object on rollback.
REMOVE_ATTACHMENT retains a tombstoned binding and inaccessible stored bytes;
archive retains private records. No hard-delete action, purge timer or retention
duration is invented here. Approval of actual deletion/recovery policy remains a
separate prerequisite before destructive removal. UI must say removal is unlinking.

## Owned paths and retained Talaqee composition

New src/lib/external-collaborations/{contracts,service,attachments}.ts;
new src/components/infame/external-collaboration.tsx/.module.css and a private list
leaf as needed. Root: additive schema/migration, purpose exclusion, creator list/
detail pages and APIs under /creator/external-collaborations and
/api/external-collaborations (scoped commands/files); no existing Deal API changes.
Reuse deal-list.tsx1000px/r18 card composition and deal-layout.module.css main/rail,
18px gaps/mobile stacking with native OriginalText/money/time controls and semantic
Infame tokens. Use dedicated DTO/status copy; do not construct a fake DealDTO or
reuse offer/signature/payment/rating/verified-earnings widgets as manual facts.
Whole-current-detail reads and commands preserve dirty inputs, exact captured UUID/
body recovery, known save versus UNKNOWN, early authoritative-denial clearing,
keyboard/focus, Arabic360 RTL/English desktop, and truthful empty/loading states.

## At most three consequential native groups

1. Actual current CREATOR create/save/checklist/order/status/archive/restore with
exact money/time/original text, journal replay + adjacent conflict/stale controls;
no Deal/Brand/payment/rating/publication rows or inferred earned totals.
2. Foreign CREATOR/BRAND/ADMIN, forged/revoked/expired session, actual lock waits and
concurrent revisions: no private body/file read, no late owner locks, full rollback,
and renewed valid session may replay only its exact same owner/key/hash command.
3. Actual owned private bytes + bound attachment upload/download/remove, wrong owner/
parent/purpose/checksum/format/size, stale replay and known/uncertain storage failures:
retain prior bytes and original native records; generic ADMIN evidence route cannot
fetch organizer purpose. No trigger bypass, secrets or fixture-as-live claims.
Independent source/privacy/browser review and all four gates before root commit.

## First pure declaration slice

Root owns only new src/lib/external-collaborations/contracts.ts and shared records;
no Prisma/schema/migration/service/route/UI/file write in this first slice. Use
existing central native IDs/revisions, OriginalText/BCP47, Money/DateRange/UTC and
descriptor-safe bounded JSON before parsing/hashing. Export strict Details,
Status/transition predicate, Command, scalar Receipt/Result and owner-only header/
detail DTO schemas and constants. CREATE uses UUID operationKey/expectedRevision0
without collaborationId; all other actions require exact collaborationId and
positive expectedRevision. Hash domain is fixed as declared above and includes
the fully parsed command plus separate actual actorUserId; no aliases/truncation.
Plain DTOs exclude actor sessions, owner contacts, storage keys, credentials or
earned/verified totals; they prove structure only, never native access/file custody.
Independent author owns two bounded pure groups before product adoption: exact
original money/date/checklist/action/receipt/control fixtures; unsafe/oversize/
unknown-key/hash capture/transition failures. Source reviewer is independent;
root alone runs all tests and gates. Native/service/file acceptance comes later.

Exact P0 exports: ExternalCollaborationError, ExternalCollaborationStatusSchema,
ExternalCollaborationDetailsSchema, ExternalCollaborationCommandSchema,
ExternalCollaborationReceiptSchema, ExternalCollaborationResultSchema,
ExternalCollaborationHeaderSchema, ExternalCollaborationAttachmentSchema,
ExternalCollaborationDetailSchema, ExternalCollaborationListSchema,
EXTERNAL_COLLABORATION_LIMITS, EXTERNAL_COLLABORATION_ATTACHMENT_PURPOSE,
canTransitionExternalCollaboration(from,to), externalCollaborationCommandHash(actor,input),
and inferred public types. Hash helper validates/copies native actor ID and strict
command; invalid input is stable VALIDATION422 without raw values. No hash change
to other domains or caller mutation of an already parsed command.

JSON action payloads: CREATE/SAVE_DETAILS {details}; SET_STATUS {status};
SET_CHECKLIST {checklist}; SET_CHECKLIST_DONE {itemId:UUID,done:boolean};
ATTACH_FILE {label:OriginalText,file:{checksum:lowerhex64,contentType:allowedMime,
size:1..10485760}}; REMOVE_ATTACHMENT {attachmentId:nativeId};
ARCHIVE/RESTORE {}. Whole strict command limit524288 compactUTF8 bytes.
Receipt exactly {operationKey:UUID,collaborationId:nativeId,action,revision,
status,archived,attachmentId:nativeId|null}; ATTACH/REMOVE require the attachment
ID, other actions require null. CREATE requires revision1/DRAFT/unarchived;
ARCHIVE true, RESTORE false. Result adds replayed:boolean only.
Every non-CREATE receipt has revision>=2. All receipt actions except ARCHIVE
have archived=false, including historical replay of that immutable receipt;
current parent archive state remains a separate authorized read.

Header exactly {id,revision,status,archived,clientDisplay,campaignDisplay,
declaredValue,period,checklist:{total:0..30,done:0..total},attachmentCount:0..20,
createdAt,updatedAt}; updatedAt>=createdAt. Private list exactly
{scope:'OWN_CREATOR',asOf,collaborations:Header[0..30],nextCursor:nativeId|null};
unique ascending header IDs, asOf>=each updatedAt and nextCursor equals last ID
when nonnull. It cannot paginate or grant authority by itself.
Attachment exactly {id,assetId,assetRevision,label:OriginalText,contentType,
size,attachedAt}; current active rows only, no storageKey/checksum/provider URLs
or availability assertion. Detail exactly {scope:'OWN_CREATOR',asOf,
collaboration:{id,revision,status,archived,details,createdAt,updatedAt},
attachments:Attachment[0..20]}; unique attachment/asset IDs in attachment-ID order,
asOf>=updatedAt and each attachedAt. DTOs have maximum524288 compactUTF8 bytes.
Labels use existing control-safe original text<=200 with nonblank text; no trim.
Native IDs/revisions/UTC match central contracts. These are structural consistency
checks only, never proof of ownership, actual bytes, payment or earned results.
EXTERNAL_COLLABORATION_LIMITS is frozen exactly {detailsBytes:262144,
commandBytes:524288,dtoBytes:524288,checklist:30,attachments:20,list:30,
attachmentBytes:10485760}; purpose is literal EXTERNAL_COLLABORATION_ATTACHMENT.
Date consistency compares actual instants, including both accepted whole-second
and millisecond UTC spellings; it never relies on lexical ISO comparison.
