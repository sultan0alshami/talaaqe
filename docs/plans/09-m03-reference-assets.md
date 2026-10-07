# M03 private reference assets

Prerequisites: the current native context/campaign bridge and retained campaign
screens. Keep migration 16, text input revisions/hashes and approved brief JSON
unchanged. Root owns additive storage, contracts, services, routes and integration;
the independent native author owns only references.test.ts. Root executes checks.

Use five additive sidecars: immutable exact context/workspace asset bindings;
immutable bounded ordered reference manifests; current reference state; exact
submission captures; and scalar-only actor/UUID command receipts. Approved versions
derive their manifest through the existing immutable exact submission lineage.
This replaces the preliminary seven-table proposal after independent review.

A manifest contains at most 20 original-language labelled references and 64 KiB
compact metadata. Each binding points to immutable PrivateAsset bytes/checksum and
the fixed MARKETING_REFERENCE purpose. SQL validates same-context/workspace items,
unique binding IDs and ordered count. Preserve existing 10 MiB PNG/JPEG/WebP/PDF
signature gates and authenticated attachment headers. This is not malware scanning.
Campaign audio/video use separately reviewed purposes and limits later.

UPLOAD appends a new binding. REPLACE explicitly supplies the retained ordered
bindings and original labels/notes, supporting removal/reorder without rewriting
old manifests. Every successful edit advances reference and parent revisions once;
text inputRevision stays unchanged. Reference identity/revision/hash joins text,
archive and actual owner/client versions in submission approval staleness. ABA
must remain stale. Historical absent sidecars mean LEGACY_ABSENT, distinct from an
explicit empty manifest; never backfill historical submissions or text hashes.

Current draft/approved version reads require exact OWN ownership or CLIENT view.
Uploads/edits require current plan. The separate actual-owner review lane reads
only files in its exact submitted manifest without requiring an agency seat.
Campaign owner review derives only the manifest pinned by its submitted brief.
Uploader/admin status alone grants no access. Generic evidence download and lists
exclude this purpose before hydration/count/limits. Missing bytes return truthful
503; retained identities and approval provenance survive draft removal/archive.

Keep native User/session/organization/client/grant/Brand/workspace/context locks
before reference state, manifests, bindings and assets. Group sorted locks by table;
no late uploader User locks or nested transactions. Checkpoint all storage awaits
and enforce final native authorization. Stable immutable object keys reconcile
exact UUID retries. Never delete potentially referenced bytes after uncertain
commit; confirmed rollback compensation requires a positive cleanup witness.

Four independently authored native RED groups precede activation: exact CLIENT
view/plan/isolation and generic denial; reference-only edit/ABA staleness with
historical pins; owner submitted-only access and missing bytes; exact replay,
changed payload/storage failure and native revocation during awaits. Then add
scoped transport, retained Studio file controls, real Arabic360/English browser
journeys and all four gates. No provider/cloud storage or full MVP acceptance is
inferred from byte-map fixtures. The guided multimodal agent follows D067.
