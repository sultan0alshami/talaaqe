# M04 managed customer orders — prerequisite inventory

2026-10-07. Source-backed preparation only. M03 file/customer-flow gates remain
the activation prerequisite. This does not enable quoting, billing, booking or
Infame signatory authority. Keep D048/D066/D067 and accepted legacy parties.

Root owns principal identity/authority, schema/contracts/money/calendar, routes,
DTO composition and final checks. Domain leaves receive exact paths after native
RED. Independent reviewers remain read-only. Current inventory changed no product.

Use additive ManagedOrder, immutable ManagedQuoteVersion/ManagedRetailItem,
immutable represented-party acceptance, scalar command journal and append-only
events/outbox. Bind order to exact CampaignPlanningBinding/workspace/Brand and
quote to approved brief/selection/context provenance. Separate buyer, beneficiary,
payer, billing organization, signatory and reviewer; organization ownership alone
does not establish buyer authority. Freeze an actual versioned Infame principal
and trusted quote/signatory boundary before commitments. No registry currently
implements that identity; ADMIN account tools do not supply it automatically.

CLIENT view governs customer reads; signCustomer governs estimate/amendment
acceptance; approveShortlist governs roster/replacement; financial governs
financial requests. Reuse withClientAuthority and native actor/session transactions
with these exact capabilities. Do not authorize commercial acceptance through the
planning helper's hardcoded plan capability. OWN requires the actual current Brand
owner. Bind current/final session and exact authority revisions, including replay.

Quote versions freeze original-language scope/uncertainties/rights/dates, reviewed
party and tax snapshots, exact currency/net/VAT/gross, provisional versus roster
purpose and explicit remedy terms. Retail items carry disclosed allocations and
all five monotonic, noncumulative cancellation-stage totals. Acceptance is distinct
from provider-confirmed payment, procurement, booking and publication. Requotes,
replacement and amendments require new versions/explicit approval. Supplier cost
stays in M05, excluded from customer DTOs/events/exports and all legacy-ID paths.

Reuse MoneySchema/addMoney and commercial TaxTreatment/CancellationSchedule/
totalWithTax. Verify exact item net/VAT/gross sums and persisted allocated tax.
The current equal creator-slot allocator is not an arbitrary retail/tax allocator.
UTC/IANA range contracts exist; a versioned Sunday–Thursday/holiday business
calendar does not. Declare it centrally; actual item review cutoffs belong to M07.
Live holiday/legal/tax/entity/merchant readiness requires genuine evidence.

Three bounded native acceptance groups before activation:

1. Exact OWN/CLIENT/same-Brand isolation, correct capability, represented party,
   owner/grant/member/client/session changes across real waits; no denied fallback.
2. Exact lost-reply replay and changed key/payload, accept-versus-requote races,
   stale field/selection/approved brief and actual-clock expiry; one accepted
   quote and preserved history, no booking/publication from acceptance/payment.
3. Currency/overflow/tax allocation and cancellation/refund bounds, missing terms,
   shared-charge caps and retail-based inability remedy; no supplier/labor/AI
   cost in customer APIs/SSR/exports/events and no legacy-party rewriting.

Source anchors: docs/plans/09-managed-platform.md M00/M04–M07;
docs/CONTRACTS.md commercial/agency; prisma/schema.prisma planning lineage;
src/lib/organizations/{authority,context}.ts; src/lib/campaign-planning/scope.ts;
src/lib/contracts/{money,vocabulary}.ts; src/lib/commercial/{contracts,policies}.ts;
src/lib/deals/{contracts,service}.ts. Full authoritative requirements remain in09.

## Reviewed prerequisites — 2026-10-07

Exact retail calculation, bounded explicit Riyadh calendar and a commercial
customer authority frame are implemented independently of checkout/quote issuance.
Their tests prove code mechanics, not live tax, holidays, legal-party evidence or
commercial acceptance. No managed order, principal registry, operator grant,
customer quote API or purchasing UI is activated by these helpers.

Retail policy infame-retail-vat-v1 calculates reviewed tax once on the exact quote
subtotal, prorates that rounded tax by item net weight and distributes remaining
minor units by largest remainder, tying by ASCII immutable item ID. Display order
cannot change the allocation. Support100 retail items separately from12 creator
matching slots. Checked BigInt totals/gross/cancellation stages expose canonical
strings. Supplier fields/unknown attributes are rejected; cancellation stages
remain explicit monotonic noncumulative net retained totals. M06 refund/tax
allocation and actual qualified treatment remain separate prerequisites.

BusinessCalendarSnapshot pins an explicit source, version, effective local date
coverage (at most3660 dates), Sunday–Thursday week and strictly ordered explicit
holidays. The second working date strictly after the item's Riyadh availability
date ends at local23:59:59.999, resolved through shared IANA handling. Missing
snapshot/runtime timezone or exhausted covered dates fails unavailable; no real
holiday defaults or implicit content approval are invented. Native reviewed
calendar storage, readiness, cutoff persistence/reminders remain M07 work.

withManagedCustomerScope uses existing exact M03 workspaces and native current/
final BRAND sessions. CLIENT reads use view; signCustomer/approveShortlist/
financial are independent selected write capabilities. OWN proves actual current
Brand ownership. Caller identities/options/authority/callbacks are captured before
waits. Replay sees current permission/scope before stale revisions. Callback order
and payload-bound journal remain each domain's responsibility; no ADMIN or
principal authority follows from this frame.

Before order/quote integration, introduce explicit InfamePrincipal/immutable party
versions, a controlled governance/provisioning boundary, actual managed policy/
identity evidence and per-order operational grants with separate view/issue/sign
purposes. Existing ADMIN account tools cannot confer them. Customer estimate
disclosure must freeze only its submitted approved brief/context/file pins and
allow an assigned operator to that order only, not unsubmitted agency data. Buyer,
payer, beneficiary, billing organization and represented signer remain distinct.

## M04A customer request freeze — 2026-10-07

Prerequisites: reviewed82a96a0, M03 approved native brief/selection/context/file
lineage and the exact customer authority frame. Root owns schema/migration,
contracts, orders/loaders/routes/shared navigation and execution. Independent
authors own only assigned ignored drafts before activation; reviewers read-only.
No operator/principal/quote/payment access follows from request submission.

First command is create-only and flat (no payload object):

```ts
{action:'SUBMIT',operationKey:UUID,scope:OWN_BRAND|CLIENT,campaignId,
 expectedCampaignRevision,expectedPlanningRevision,expectedSelectionId,
 expectedSelectionRevision,briefId,expectedBriefVersion,
 disclosureVersion:'infame-order-disclosure-v1',
 // CLIENT only: exact same-client expectedAuthority capability signCustomer
 expectedAuthority?}
```

Current native signCustomer is deliberately required for CLIENT disclosure;
planning/viewing alone does not authorize that request. OWN proves the actual
Brand owner. Request means disclosed estimate preparation only, not quote
acceptance/signature/payment/creator booking/publication. A fresh key for an
already requested campaign rejects ORDER_ALREADY_REQUESTED409. Any retained
legacy Deal on that campaign rejects LEGACY_CAMPAIGN409; create new managed work
instead of rewriting prior obligations. Exact authorized replay remains historical.

Add four scalar SQL-owned sidecars (existing migration pattern):

- ManagedOrder: immutable id/workspaceId/campaignId/createdAt, unique campaignId;
  exact retained CampaignPlanningBinding composite FK.
- ManagedOrderSubmission: immutable id/orderId/workspaceId/campaignId/version,
  briefId/briefVersion/inputRevision/campaignRevision/planningRevision,
  selectionId/selectionRevision/approvedByUserId/approvedAt,
  contextReferenceSubmissionId nullable, snapshot/snapshotHash,
  submittedByUserId/disclosureVersion/createdAt. Unique order/version and full
  id/order/workspace/campaign/version target. Exact existing brief/provenance FKs.
  MANIFEST requires RESTRICT retention to ContextSubmissionReferences(submissionId)
  of the selected approved context; NO_CONTEXT/LEGACY_ABSENT require null.
- ManagedOrderState: orderId/workspaceId/revision/submissionId/submissionVersion,
  status REQUESTED/createdAt/updatedAt. Insert revision/version1; source-only
  advance requires exact next revision/version/new submission and retains identity.
- ManagedOrderCommand: immutable id/actorUserId scalar/operationKey/payloadHash,
  orderId/workspaceId/campaignId/submissionId/submissionVersion/action SUBMIT,
  result/createdAt. Unique actor/key, composite RESTRICT submission FK; scalar
  bounded4096 receipt binds all columns. No content/session/authority/price in it.

Snapshot is strict original data, maximum262144 compactUTF8 bytes:

```ts
{schemaVersion:1,
 brief:{id,campaignId,version,inputRevision,content:CampaignBriefContent,
        approvedAt:UTC,approvedByUserId,createdAt:UTC},
 provenance:BriefPlanningProvenance,
 selectedContext:ApprovedBrandContextVersion|null,
 references:ContextReferenceManifest|{kind:'NO_CONTEXT'}}
```

No conversation, raw narrative, proposals, unsubmitted context, storage keys,
supplier costs, private legal proof or guessed retail price belongs in that packet.
Persist actual approved content (not its preapproval owner-review DTO). Freshness
uses current command revisions, latest/current approved brief and fieldsRevision,
exact requirements reconstruction and selection provenance. Historical approved
M03 submission's preapproval campaignRevision is not equal to the postapproval
current parent by design. Lock the exact approved context/manifest, never the
current reference state. Pin original labels/notes and complete approved content.

Receipt: `{action:'SUBMIT',orderId,submissionId,campaignId,revision:1,
submissionVersion:1,briefId,briefVersion,selectionId,selectionRevision}`; transport
adds replayed. Detail: `{scope,currentAuthority,asOf,order:{id,campaignId,revision,
status:'REQUESTED',submission:{id,version,createdAt,disclosureVersion,snapshotHash,
snapshot}},quote:null}`. List: same scoped read envelope and orders containing only
id/campaignId/revision/status/titleOriginal/submittedAt, exclusive cursor, max20.
Current view governs reads; ADMIN has no customer fallback. Request reads do not
enable operator access; principal/governance/operational grants remain next M04 work.

Acceptance: four independent native SQL groups before migration; four pure
contract groups; three full native service groups with genuine same-Brand client,
replay/stale/source changes/legacy denial/current session and real wait/rollback
failure evidence. Then strict private no-store adapters and bounded browser flows
within the retained campaign/request composition, followed by independent review
and all four gates. Synthetic fixtures are local mechanics, never live acceptance.
