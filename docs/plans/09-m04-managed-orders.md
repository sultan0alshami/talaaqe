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
