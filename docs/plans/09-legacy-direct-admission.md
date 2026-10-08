# Legacy direct admission declaration freeze

2026-10-08. Pure declarations only; no app authority, legacy classification,
controlled import, native gate or schema activation. Prerequisite1a57180 passed all four gates and the complete browser suite.
This declaration work precedes separately tested native admission enforcement. Root owns future source/contracts/schema;
independent author writes only its ignored four-group test draft and reviewer is
read-only. No source/private data copy, date cutoff or global fixture bypass.

Proposed exports in src/lib/deals/legacy-admission-contracts.ts:
LegacyDirectAdmissionContentSchema, LegacyDirectAdmissionVersionSchema,
LegacyDirectAdmissionStateSchema, LegacyDirectAdmissionManifestContentSchema,
LegacyDirectAdmissionManifestSchema and corresponding types. Reuse central
OrganizationId/Revision, ManagedAuthorityValidity (including recheck), supported
UTC years1..9999, safe OriginalText and canonicalHash. Strict and bounded before
hashing; content/manifest max131072 compactUTF8 bytes. Labels never prove authority.

IDs retain the complete central printable-ASCII grammar. A literal asterisk is
an exact identifier declaration, never a glob, pattern, wildcard or permission;
native lookup/manifest verification must match its actual row exactly. Arrays,
wildcard flags and campaign-wide capability aliases remain unsupported.

Content common: schemaVersion1,admissionId,provenance LIVE|DEVELOPMENT_FIXTURE,
version,capability FRESH_PINNED_SCOPE|CONTINUE_PINNED_DEAL,subject{campaignId,brandId,brandUserId,creatorId,creatorUserId},
approvedBrief{id,version,inputRevision,approvedByUserId,contentHash},
validity{validFrom,expiresAt|null,recheckAt},manifest{id,entryId},source.
Brand and creator users differ; approvedBy equals original brandUserId.
No mutable profile names/current owners, actor/session claims or raw source text.

FRESH_PINNED_SCOPE source is strict
{kind:CAMPAIGN_COMMAND,id,actorUserId,operationKey,payloadHash,resultHash};
actor equals original brandUserId. No invented action column/date proof. Runtime
must verify actual native source and controlled review; a matching label cannot
classify a today-created campaign as historical. Source receipt operationKey uses
the existing legacy1..120 ASCII alnum underscore colon hyphen contract.

CONTINUE_PINNED_DEAL source is strict
{kind:DEAL_COMMAND,id,actorUserId,operationKey,payloadHash,resultHash};
actor equals original brandUserId. Content additionally contains
existingDeal{id,sourceHash,firstOffer{id,version:1,proposerUserId,recipientUserId,
contentHash}} with proposer/recipient equal the exact subject users. Existing Deal
hash is the immutable identity/brief/origin/match/slot/createdAt projection; first
Offer hash includes id/dealId/version1/parties/terms/createdAt, excluding mutable
status/acceptedAt. Future runtime/controlled importer verifies actual producer
semantics; pure source hash/IDs/labels do not prove a CREATE command.

Retained version adds id,sourceHash,createdAt, hashes ONLY validated content and
does not consult current time or forbid reviewed future validity. State is strict admissionId,revision,
state DRAFT|ACTIVE|PAUSED|REVOKED,currentVersion{id,version,sourceHash}|null,
createdAt,updatedAt. DRAFT null; ACTIVE/PAUSED full; REVOKED eitherretainedpointer;
updatedAt>=createdAt. Pure schema never consults Date.now or grants capability.

Manifest content: schemaVersion1,manifestId,provenance,createdAt,
reviewReferenceOriginal safeOriginal max2000,
entries1..50 of {entryId,admissionId,version,sourceHash}; unique entryId and
admissionId/version, preserve entry order. Manifest adds sourceHash (content-only).
Each admission content manifest.id/entryId links to that exact retained envelope
entry. No cyclic hash: content stores manifest ID and entry ID, manifest pins
admission content hash; trusted digest allowlist authorizes the entire manifest.
Cross-envelope native lineage and current state are future runtime obligations.

Production controlled allowlist defaults empty and rejects fixtures. No ordinary
ADMIN/app writer. Atomic controlled importer and future immutable exact fresh
DealAdmissionLink use current/final native session/participant/domain boundaries.
Accepted actual-party fulfilment/exact receipts remain historical without new
admission; fresh/permitted pending continuation require exact source/manifest/link.
No terms/counterparty conversion, silent cancellation, provider or financial action.

Four independent PURE groups: strict validFRESH/CONTINUEbindings/nativepinshapes;
wrong extra/null/wildcard/subject/role/hash/date/value/provenance variants; exact
content-only hashes/metadata independence/oversize safeParse failures; strict
manifest duplicate/entry ordering/changed source/hash/original reference behavior.
Root adopts after declaration freeze, observes genuine behavioral RED before
validation, reviews then tests/gates before any commit. Native/source/import/
concurrency/browser tests are separate subsequent required work.


Independent review clarifications before native integration:
- Stable Deal projection is exactly id,campaignId,brandId,creatorId,briefVersion,
  origin,matchRunId,slotOrdinal,createdAt. Stable first Offer projection is exactly
  id,dealId,version1,proposerUserId,recipientUserId,terms,createdAt. No lifecycle or
  payment field enters those hashes.
- Receipt pin labels/hashes never prove producer semantics. The controlled native
  importer must verify reconstructible original CREATE producer material against
  its original canonical envelope/hash and actual result/first offer. A same-actor
  MESSAGE receipt at Deal version1 is a required negative witness. No nonexistent
  action column or date-only cutover inference is permitted.
- Native manifest/entry/admission binding checks both directions and exact equal
  provenance; current state points to its own exact admission/version/hash. Pure
  structural schemas cannot resolve these records or authorize copied foreignpins.
- FRESH admits exactly one Deal across the stable admission identity. Create/link/
  first Offer/CREATE receipt commit atomically with a unique admission identity
  link; cancellation, a new key or admission version never replenishes it. Exact
  replay and accepted obligations remain independent of admission expiry/revocation.
  Pending COUNTER/ACCEPT needs the exact current admitted link or explicit proven
  CONTINUE record, never tuple similarity.
- Both immutable first-offer parties require a distinct retained-history lane
  after profile ownership transfers. Preserve deal/agreement/approved-brief data
  only, not today's Campaign.input/context/transcript or transferred company data.
  Original Brand history denial predates the current session change; fixing it is
  an independently tested next-mission integration, not a reason to widen current
  source or weaken party assertions. New fulfilment readiness stays separate.
