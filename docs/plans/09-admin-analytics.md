# Original Talaqee analytics — bounded canonical replacement

Coordinator-approved implementation freeze, 2026-10-10. Prerequisite campaign
interview checkpoint a3ba144 is saved with all four gates and six browser cases.
The full managed/MVP goal continues; this slice does not establish live business,
provider, governance, financial or launch readiness.

## Prerequisites and problem

Reuse the reviewed native admin boundary, original admin shells, D047 metadata
and D048/M03 managed exclusion. Read AGENTS.md, docs/CONTRACTS.md,
docs/plans/07-original-admin-overview.md and09-admin-managed-exclusion.md before
activation. Independent failures precede consequential implementation. Root must
read relevant installed Next guides before changing the server page/route.

The current SSR analytics page still scans legacy Match/Project after page auth,
computes misleading recommendation acceptance, uses server-local weekday math,
and supplies invented3.2min/48,500/214/+18%. Its screen labels distribution counts
with percent signs and draws nonzero bars for zero days. The legacy API body has
the same data, but api.handler currently retires its actual /api/admin path410.
Remove this residual SSR behavior without reviving legacy procurement data.

## Ownership and exact paths

Coordinator owns native/shared contracts, auth composition, loader, route, SSR,
dictionary composition, evidence and all execution:

- src/lib/admin/analytics-contracts.ts — new pure strict AdminAnalytics DTO and
  fixed taxonomy; preserve existing shared contracts and their current consumers.
- src/lib/admin/context.ts — reuse adminRead; change only for demonstrated need.
- src/lib/admin/analytics.ts — new metadata-only canonical aggregate loader.
- src/lib/admin/transport.ts — narrow loadAdminAnalytics domainHandler adapter.
- src/app/api/admin/analytics/route.ts — only this retired leaf is replaced.
- src/app/admin/analytics/page.tsx — current ADMIN actor forwarded to native loader.
- src/lib/talaqi-data.ts — coordinator-only analytics/nav copy if required.
- docs/CONTRACTS.md, docs/OWNERSHIP.md, docs/PROGRESS.md and adopted phase plan.

A future UI worker owns only
src/components/screens/admin/analytics-screen.tsx and new
src/components/screens/admin/analytics-layout.module.css. They are not alone;
preserve others' changes and request shared-path edits from root. No dependency,
schema, migration, primitive, shell or brand-token change is required.

Independent verifier authors at most three native groups across
tests/admin/analytics.test.ts andtests/admin/analytics-transport.test.ts, plus at
most two mounted journeys in e2e/admin-analytics.spec.mts. A separate reviewer
checks native SQL/privacy/auth, DTO/UI semantics and exact staged scope. Root runs
guarded targets, browser checks, all four gates and the commit. Draft authors do
not execute or edit another owner's product paths.

## Exact eligible records and six counters

Use scope literal EARLIER_WORKFLOW_RECORDS. This new DTO has no compatibility
consumer requiring the misleading ALL_STORED_RECORDS literal. Existing overview
counts include all stored campaigns and cannot supply these narrower counters.

Eligible Campaign means no CampaignPlanningBinding for its exact ID. Apply that
predicate in native SQL before EVERY COUNT/GROUP BY, including joined children:

| Counter | Actual stored definition |
| --- | --- |
| campaigns | Count eligible Campaign rows |
| briefVersions | Count CampaignBrief rows joined to eligible Campaign |
| matchRuns | Count MatchRun rows joined to eligible Campaign |
| recommendationRows | Count CreatorMatch rows joined through MatchRun to eligible Campaign |
| deals | Count Deal rows joined to eligible Campaign |
| completedDeals | The same eligible Deal set with central status COMPLETED |

The counts are all persisted records in the authorized transaction snapshot, not
published/active/currently qualified/live traction. Include eligible private,
draft, test and suspended-account records explicitly. A completed-deal count is
a stored lifecycle label, not independent payment, delivery or results proof.
Recommendation rows count stored historical rows across runs, not distinct
creators or current actionable recommendations. Empty runs are still matchRuns.

Exclude every M03 binding, including OWN and same-Brand CLIENT drafts, unsubmitted
generated briefs and submitted ManagedOrders. Do not filter only campaigns with
an order, nor filter protected children after aggregation. Do not count protected
records in a denominator or infer their totals by subtraction. Managed operational
access remains a separate purpose-bound authority; ADMIN is no fallback grant.

## Strict DTO and time window

Return one strict bounded plain-JSON DTO:

```text
{asOf:UTC, scope:EARLIER_WORKFLOW_RECORDS, timeZone:UTC,
 counts:{campaigns,briefVersions,matchRuns,recommendationRows,deals,completedDeals},
 campaignStatuses:[{status,count}, ...exactly7],
 campaignDays:[{date:YYYY-MM-DD,count}, ...exactly7],
 window:{startsAt:UTC,endsAt:UTC},
 unavailableMetrics:[REVENUE,SUBSCRIPTIONS,GROWTH,MATCH_LATENCY,ACCEPTANCE_RATE]}
```

All counts are nonnegative safe integers. SQL BigInt counts must be checked before
conversion; reject overflow/invalid stored aggregates instead of rounding or
returning zero. Fill missing enum/date groups with genuine zero only after a
successful native query. Exactly six counters/known keys; completedDeals<=deals.
Campaign-status counts sum exactly to counts.campaigns. Original business words,
IDs, actor/session/token/private source fields and arbitrary JSON are absent.

The seven status rows use the central order:
DRAFT, BRIEF_GENERATED, BRIEF_APPROVED, SHORTLISTED, IN_DEALS, COMPLETED, CANCELLED.
These describe saved Campaign statuses, not campaign qualification or outcomes.

The seven dates are consecutive ascending UTC calendar dates, ending on the UTC
date containing asOf. startsAt is00:00Z six days before that date; endsAt=asOf.
Count eligible Campaign.createdAt with startsAt<=createdAt<=asOf. The current day
is partial and future timestamps are excluded from this window. All-time stored
counters/status groups remain snapshot counts; future-dated persisted rows are
not misrepresented as recent creation. UI weekday/date labels are translations
of these exact UTC dates, not stored business content or browser/server getDay.
No caller timezone, period, filter, actor or business clock is accepted in HTTP.

## Native authorization, projections and audit

getAdminAnalytics(actor,options) reuses adminRead's User→exact AuthSession locks,
current active ADMIN/role/version/revocation and final real-clock expiry check.
Every aggregate and one minimized access audit share its RepeatableRead snapshot.
Copy any trusted test projection time; it cannot extend authentication.
Campaign.createdAt is a PostgreSQL timestamp without time zone storing civil UTC.
Group its date directly and compare explicit ISO UTC timestamp boundaries; no
session-zone conversion or local weekday math. Validate native aggregate keys,
reject duplicate/unknown/out-of-window groups and overflow before zero-fill.

Queries return only aggregate numbers/statuses/date buckets. Never hydrate
Campaign.input/conversation/title, Brand names, briefs' content, MatchRun
requirementSnapshot/policySnapshot, CreatorMatch.snapshot, deal terms/messages,
evidence bytes, onboarding/interview records or provider information. No unbounded
findMany/reduction of individual rows and no existing full-content matching loader.

The only intended write is admin.analytics_accessed metadata audit:
AdminAnalytics/platform, containing asOf/scope/window/counters only. No business
mutation, notification, matching run, provider call or financial action. Invalid
authorization/final expiry rolls back the audit and returns no analytics DTO.

GET /api/admin/analytics uses domainHandler, actual ADMIN before query parsing,
rejects all query parameters, and returns standard request-ID/private,no-store
envelopes. SSR invokes the same loader after requirePageSession('ADMIN'); current
native401/403 follows the existing login/denial pattern. Other retired admin APIs
and the existing overview contract remain unchanged by this slice.

## Reused Talaqee composition and truthful states

Keep1040px max width,24px/700 title,22px heading gap, three KPI cards, two chart
panels and three lower cards. Retain16px/18px corner radii,22px/24px padding and
16px/18px gaps. Apply shared Infame semantic tokens and IBM Plex typography; no
teal literal colors, new dashboard geometry or Arabic letter spacing.

Top cards: campaigns/deals/completedDeals. Lower cards:
briefVersions/matchRuns/recommendationRows. The former score panel shows seven
Campaign-status counts; the weekly panel shows the seven exact UTC date counts.
Use count labels without percent signs. Zero bars have zero extent, with visible
textual zero and an honest empty state. Chart denominators are display scaling
only, never acceptance percentages. Text/table alternatives expose every number.

Revenue/subscribers/growth/latency/acceptance remain explicitly unavailable,
without monetary strings, artificial averages or substitute statistics. Budgets
are not revenue; paid/received timestamps are self-reports, not settlement.
Mixed algorithm versions and match decisions cannot define acceptance or quality.

At360px Arabic RTL and English LTR, use minmax(0,1fr), logical spacing, wrapped
scope/date text and stacked panels. Keep original desktop composition. One
keyboard-visible44px refresh action waits on real I/O; prevent duplicate reads,
abort on unmount and ignore stale callbacks. A503/network/malformed response
retains the last valid snapshot with an explicit stale notice. Initial failure
shows unavailable/dashes, never fake zero. Native401/403 clears all cached counts
and time before reading any body, including malformed/delayed denial bodies.
Use bounded UTF8 envelope decoding, native request-ID parity and no-store checks.

## Bounded independent acceptance

Native group1 — actual canonical taxonomy/window/exclusion: owned real sessions,
OWN/two CLIENT M03 producers and a submitted managed request; eligible metadata
fixtures in each status and UTC edge; exact six counts/seven groups/seven dates;
no effect from poisoned legacy Match/Project/demo figures. Include eligible
test/private/suspended records and future-date boundaries. Observe actual SQL
without parameters to prove exclusions precede aggregation and private columns
are not selected. Structural fixtures establish counting, not live campaigns.

Native group2 — snapshot/authority: simultaneous eligible writes cannot mix
aggregate snapshots; actual User/AuthSession wait invalidation, version/role/
suspension/revocation/expiry; historical resource clock cannot prolong access;
final expiry during audit rolls back it. Genuine empty eligible set yields zeros
only inside the same current-authorized consistent transaction. Do not delete
unrelated rows to manufacture emptiness; use a genuinely empty guarded target or
an already-empty eligible baseline and prove it independently. Unavailable query/
invalid count yields failure with no synthetic DTO.

Native group3 — HTTP/SSR adapters: anonymous401/nonadmin403, current cookie and
native role checks before malformed query, strict no-query route, minimized
request-ID/private envelopes, same SSR/service counts and protected canary
exclusion in HTML/RSC/DTO/audit. No read changes business rows or activates another
legacy API. Test fixtures remain isolated/guarded with owned cleanup.

Browser journey1 — native counts/geometry in Arabic360 and English desktop/360:
actual API→SSR→DOM values, unchanged native statuses, managed/source canaries
absent, all old fabricated numbers absent, no percentages or zero-height lies,
scope/UTC captions, keyboard focus and no horizontal overflow/hydration errors.

Browser journey2 — genuine held refresh, duplicate prevention, failed/malformed
response retaining old data with stale label; initial failure stays unavailable;
malformed401/403 clears counts/time before body parsing and late responses cannot
restore them. Collect console/page errors; fixtures/mock network failures do not
claim live operational outcomes. Root observes RED before activating the UI.

After current independent source review and these checks, root runs npm run check
(TypeScript, warning-free ESLint, guarded Vitest, supported Webpack/privacy trace)
before committing exact owned paths. Broader checks repeat only for demonstrated
new failures/concerns. Preserve current task databases/services, source Talaqee,
other agents' work and unrelated research. No full-goal completion is inferred.

## Source anchors

- src/app/admin/analytics/page.tsx andsrc/app/api/admin/analytics/route.ts — legacy
  scans/local weekdays/fabricated time and revenue.
- src/components/screens/admin/analytics-screen.tsx — original geometry, count
  percent labels and minimum-height zero bars.
- src/lib/admin/context.ts, contracts.ts, overview.ts, campaigns.ts, transport.ts —
  reusable native snapshot/count/DTO/private API and preprojection exclusion.
  Existing overview ALL_STORED_RECORDS counting stays outside this mission; it
  neither supplies the narrower analytics counts nor gets silently rewritten.
- src/components/screens/admin/{overview,projects}-layout.module.css — existing
 1040px logical layout and44px controls/responsive patterns.
- prisma/schema.prisma — Campaign/CampaignBrief/MatchRun/CreatorMatch/Deal and
  exact CampaignPlanningBinding; src/lib/contracts/vocabulary.ts — central enums.
- tests/admin/{overview,campaigns,managed-exclusion}.test.ts and
  e2e/admin-{overview,campaigns,managed-exclusion}.spec.mts — native wait/snapshot/
  privacy and original Arabic/English browser patterns. Copy appropriate helpers;
  never import a registered test or call a mocked session live.
