# Retained administrative briefs and taxonomy

Coordinator freeze,2026-10-10. Prerequisite1ad9d54 passed all four gates and20
mounted regression cases. This completes the two remaining
legacy admin leaves identified by09-original-mvp-carryover. It does not grant
managed campaign access, operational permissions or taxonomy mutation authority.

## Source and scope

The existing briefs SSR loads legacy Brief/Project and the screen attempts retired
qualityScore PATCH. Categories SSR loads procurement Category/Skill/demoCount and
the screen offers retired add/delete operations. Those API bodies remain retired
by the shared wrapper; their SSR data and displayed controls need adaptation.
Reuse adminRead, campaignBriefDTO, NICHE_TAXONOMY/NICHE_SOURCE, central fame keys
and FAME_RELATED_NICHES. Preserve Talaqee's1040px expandable table, category grid,
chip region, semantic Infame tokens and approved brand pattern.

Root owns new admin/briefs.ts,taxonomy.ts and their pure DTO contracts, admin
transport, both SSR pages, canonical GET leaves, documentation and execution.
Worker owns only screens/admin/briefs-screen.tsx,categories-screen.tsx and one
scoped CSS module after mounted RED. Independent author owns at most three native
groups and two mounted journeys. Reviewer checks auth/private projection/managed
exclusion/counts and exact scope. Agents are not alone and preserve other work.
No schema, dependencies, shared auth or existing taxonomy changes are authorized.

Native adapter freeze for independent draft authors: getAdminBriefs(actor,
query={},options={}) returns {asOf,scope:"EARLIER_WORKFLOW",briefs,nextCursor}.
Each row has id,campaignId,brandName,version,inputRevision,requirements,
approvedAt,createdAt; requirements is the unchanged CampaignRequirementsSchema.
Use explicit PostgreSQL C collation for both brief-id ordering and the exclusive
cursor predicate so native paging matches the strict ASCII/JS DTO order.
Approved user ids and policy-review internals are validated in the native source
but omitted from this administrative DTO. Query accepts only the existing exact
after cursor grammar; duplicate/unknown keys fail422 after current ADMIN auth.
getAdminTaxonomy(actor,options={}) returns {asOf,
scope:"ALL_STORED_CREATOR_ASSIGNMENTS",source,niches,fame,unknownAssignments}.
source is the unchanged NICHE_SOURCE projection; niches preserve NicheTaxon
fields plus assignmentCount, fame rows have industry,relatedNicheSlugs,
assignmentCount, and unknownAssignments has nicheCreators,fameCreators counting
distinct creators with any unknown exact tag. Unknown tags themselves/private
profile words are not projected. Catalog arrays preserve central order and exact
length. All counts require actual nonnegative safe integer native aggregation;
malformed/duplicate/overflow rows fail503 before filling absent canonical zeroes.
Both native reads take AdminOptions; no caller data controls auth or count scope.
Brief pages are additionally bounded to1,900,000 UTF-8 JSON bytes for the full
returned DTO, leaving room for the existing2MiB bounded private envelope. Return
fewer than30 when needed and place nextCursor at the last returned id, without
skipping an authorized row. One valid native brief fits; an oversized/corrupt row
fails explicitly. SQL still captures at most31 authorized rows before projection.
Native paging tests include a large-valid-content byte boundary and complete
cursor traversal. This prevents a committed native history from becoming
unreadable solely because the browser has a tighter transport budget.

## Native administrative reads

Briefs: current locked/final ADMIN native session, consistent snapshot and minimal
access audit. SQL joins CampaignBrief→Campaign→Brand and excludes every
CampaignPlanningBinding before content projection, paging and limit. Fetch31 in
immutable brief-id order, return30 and exclusive cursor. Only original historical
brief requirements, immutable id/version/inputRevision, actual approval/date,
current stored brand label and explicit earlier-workflow scope are projected.
Never substitute current campaign input, infer quality percentages or fetch
conversations/proposals/references/owner email/session/onboarding content.
Validate campaignBriefDTO lineage; corrupt content fails explicitly without a
partial list or raw private error. Version/approval replace score editing; all
remaining fields remain expandable, money exact and currency explicit.

Taxonomy:139 canonical entries/30 parents/109 children with exact source
version/order/slug/parent and bilingual UI labels, plus12 separate fame keys and
related-only hints. Native counts use distinct Creator ids per exact nicheIds or
fameTags value without hydrating private profile JSON. Scope explicitly includes
stored private/test/inactive assignments; no verified-creator or outcome claim.
Duplicate array entries count once per creator; unknown stored tags are not
silently normalized. Parent counts are exact assignments, never summed children.
Static catalog entry counts and stored assignment counts remain separate. Search,
parent filter and refresh are local/read-only. Unsupported legacy mutations and
skills stay retired; changing the curated taxonomy requires its own reviewed
versioned contract mission.

Both GET adapters authenticate before query parsing and use the existing private
no-store/request-id envelope. SSR metadata stays server-side. Browser reads use
bounded DTO validation, synchronous mutex/epoch/abort and pre-body401/403 private
clearance, sticky denial, honest stale/empty/loading/error and explicit same-read
retry. No fabricated live activity, new forms or hidden mutation fallback.

## Acceptance and failure evidence

Three native groups: current auth/session/real wait+expiry/audit rollback;
unmanaged historical brief fields/lineage/30+tail pagination and pre-projection
managed exclusion; exact catalog/relationship/fame integrity/distinct assignment
counts/unknown/zero/retired no-effect mutations. Actual owned synthetic native
fixtures establish mechanics only, not legal/provider/operational acceptance.

Two mounted journeys parameterized Arabic360 RTL/English LTR: complete historical
brief expansion/paging/exact money and truthful taxonomy search/filter/counts;
current native denial, held late responses, stale/error and keyboard/reduced
motion/long-content geometry. Root observes consequential RED before activation,
then native/browser GREEN and npm run check's four gates before exact-path commit.
Update carryover/current evidence without discarding earlier source history.
