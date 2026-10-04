# Infame pure matcher integration handoff

Implementation authority: `docs/CONTRACTS.md` §7, handoff `REBUILD_PLAN.md` §10, `DECISIONS.md` D030–D035 and `docs/plans/05-matching-discovery.md` §05.1. This module has no database, network, model, auth, UI or legacy-matcher side effects. Import `src/lib/matching/index` explicitly: `src/lib/matching.ts` is preserved historical procurement code.

`evaluateCreator(approvedCampaign, approvedCreator, now, options)` returns eligibility/exclusions plus the full computed result, including below-threshold scores. `shortlist(...)` retains only score ≥60, sorts score descending then immutable ASCII creator ID ascending and returns at most12. Empty results remain empty. Stored decisions, explicit mutations, ownership, offer eligibility revalidation and persistence are the integration owner's responsibilities.

## Quantitative fixtures and tests

Guarded command: `npx vitest run tests/matching/core.test.ts tests/taxonomy.test.ts`. It requires the coordinator's isolated test database identity/lock; it performs no matcher database mutations. On2026-10-04 runner11:19:13,41 matcher and5 taxonomy tests passed alongside the coordinator's1 PostgreSQL deal-participant fixture (3 files/47 total). Three default taxonomy/validation regressions and the explicit zero-fit niche reason regression were confirmed red before implementation. Full `npx tsc --noEmit` and matching/taxonomy-path ESLint pass. Initial25-test red stage had24 failures against unimplemented functions; subsequent red fixtures caught unsupported snapshot-source promotion, wrongly expired moderation evidence and a real59.5→59 floating-point threshold error. The coordinator independently checked604 score/budget boundary cases with no math defect. No full build, browser, persistence or live-provider acceptance is claimed here.

| Fixture | Result | Calculation |
|---|---|---|
| Seven known perfect scores, API1 |100|fit1 × factor1|
| Seven known perfect scores, screenshot.7 |85|fit1 × factor.85|
| Seven known perfect scores, self/public.4 |70|fit1 × factor.7|
| All unknown, confidence1 |50|each null preserved; .5 used only in weighted fit|
| Geography0, all other scores1, confidence.4 |60|weighted fit.85; exact59.5 rounds upward|
| Age50% at100 followers,100% at300 followers |87.5%, unknown12.5%|(100×50+300×100)/400|
| Targets18–24 and25–34; all audience18–24 |.5|uniform target bins50/50; histogram intersection50/100|
| Country100%, city targeting without city data |.8|country fallback discount20%; residence contributes nothing|
| Target beauty/fashion; heldbeauty, relatedfashion |.75|(1+.5)/union2; exact/related disjoint|
| Fame beauty only, targetbeauty |.5|related-only; fame does not enlarge union|
| JPY price11258999068426240, allocation9007199254740992 |budget.5|exact price/allocation1.25; exact BigInt comparisons/subtraction|
| Budget10001 minor units, three slots, ordinal1 |3334|q3333/r2; ordinals0/1 receive remainder units|
| One missing matching-currency row or mismatched minimum |PARTIAL/null budget|known subtotal preserved; never extrapolated|
| CAMPAIGN or LIVE without own observed format average |unknown estimate|no manufactured package/duration fallback|
| Original evidence exactly90×24h old |eligible|older by1ms or future by1ms excluded|

Rounding computes the documented formula over the canonical decimal representations of validated numeric subscores/confidence using exact rational arithmetic. It uses no epsilon or score promotion. Money always uses shared `MoneySchema`, `addMoney`, `multiplyMoney` and ordinal allocation; only the dimensionless final budget ratio becomes a number after exact integer subtraction.

## Loader contract

Build inputs from trusted ownership/visibility-aware loaders. Never accept policy outcomes, claim flags, evidence source, approval or visibility assertions from a brand request. `Fact<T>` has independent source, original evidence date, review, visibility and immutable version. Approval and corrections never promote provenance. Freshness is the evidence date, not import/upload date. At least one actually usable metric retains the account snapshot's source; an API label over only self-reported fields is rejected.

Claimed accounts require verified ownership. Approved brand-visible unclaimed accounts may produce prospects with availability UNKNOWN and `executableOffer=false`; active deals still require claim/ownership/availability revalidation. Claimed availability must have an actual confirmation timestamp and a period covering the campaign. A campaign language/dialect set is interpreted as permitted alternatives: at least one exact declared value must overlap. Physical presence uses explicit residence or permitted declared travel; it never supplies audience geography.

Only requested-platform eligible accounts participate. Creator-supported format subsets are priced explicitly, unsupported rows are separate. Formats/duplicate counts use the shared deliverable validator. Multiple same-platform accounts do not multiply one placement's count: an observed matching-format average is preferred; then largest known followers and immutable account ID break ties. The output records selected account, original unit, definition and measurement window. Engagement needs explicit percent unit/definition/window. LIVE/CAMPAIGN require observed format averages; other explicit placement formats can use the versioned, labeled platform hypotheses.

`aggregateAudience` is shared canonical math for an already-authorized account subset. Each independently reported dimension uses only accounts with usable weighting followers. Missing followers are excluded and disclosed; unknown residual is retained. Profile loaders choose all permitted accounts; matching chooses the relevant subset. Neither output establishes unique people or joint demographic percentages.

Niche relationships use the frozen central139-entry catalog in `contracts/taxonomy` by default. Applicable campaign/creator slugs must exist in that catalog; a missing storage mapping or unknown slug is a loader error, never a synthetic niche. The explicit niche rule in REBUILD_PLAN line411 / CONTRACTS line274 applies: a specified campaign niche with no usable relevant creator niche/fame information scores zero; a campaign with no niche target has null niche fit. Related fame can earn the documented partial credit. A supplied historical taxonomy snapshot must be bounded, unique, parent-complete, acyclic and cover the scored campaign/creator slugs; the caller owns its reviewed immutable version and run snapshot.

Mandatory rules arrive as reviewed versioned PASS/FAIL/UNKNOWN outcomes scoped to the relevant account IDs and valid through the campaign period. Optional licence preferences separately require reviewed/current jurisdiction/account-scoped licence records. Reviewed evidence-bearing moderation findings are persistent policy input; the90-day analytics window does not expire a private moderation finding. No private evidence is copied into reasons.

Exposure uses explicit integer impressions allocation. `MatchingOptions.exposureBenchmark` is disabled unless explicitly enabled/reviewed with a dated ID/version and exact matching markets/currency/goal; its rational impressions-per-major-unit calculation uses central currency precision. Historical Saudi/SAR goal assumptions are absent from default runtime. Explicit budget/target allocation passed for one ordinal requires the owning campaign service to validate the complete allocation set and remaining budget transactionally.

Deterministic Arabic/English reason records disclose unknowns, separate marginal distributions, quote coverage, estimated impression limitations and prospect status. There is no AI call or identity-bearing AI input. A future explanation adapter must construct a separate identity-free projection and must never pass creator IDs, account IDs, names, handles, source URLs or private evidence.

## Current canonical schema mapping and gaps

The coordinator's canonical schema was re-read on2026-10-04 after migration04; this is a loader design handoff, not completed integration.

| Canonical data | Pure input mapping | Required safeguard / remaining gap |
|---|---|---|
| Creator.id/userId/state/isTest/brandVisible/profileFacts; User.active |identity/claim/hidden/test/suspended and independent profile facts|Claimed discovery readiness and approved brand-visible seed basis must be enforced; no default brandVisible=true; profileFacts requires typed per-field provenance/review validation|
| SocialAccount.ownershipStatus/factsApprovedAt/brandVisible/publicVisible/supportedFormats |account ownership/approval/visibility/formats|Current mapping revision and consent checked by loader; additional unproved accounts remain private|
| MetricsSnapshot.source/observedAt/id/reviewStatus/approvedAt/excludedAt |per-observation Evidence|Accept only approved, nonexcluded, current-mapping observations; retain original dates and source|
| MetricsSnapshot.followers |followersFact|BigInt must be within nonnegative Number.MAX_SAFE_INTEGER before conversion; missing remainsnull|
| MetricsSnapshot.formatMetrics / legacy averageViews |per-format average observations|Validate format/unit/definition/window JSON; generic scalar remainsunknown without that context, never copied to every format|
| MetricsSnapshot.engagementRate/engagementContext |normalized engagementPct plus context|Validate explicit unit/definition/window JSON; missing context cannot earn fit|
| MetricsSnapshot.demographics |independent age/gender/country/city facts|JSON must retain per-field provenance, approved visibility and explicit rounding evidence; private/unknown dimensions are not promoted|
| FactCorrection.brandVisible/publicVisible and source metadata |new SELF_REPORTED field fact|Do not overwrite snapshot; preserve original evidence date/review/visibility and validate stored correction contract|
| Creator.nicheIds/fameTags/profileFacts; Niche |sourced stable niche/fame facts and central taxonomy|The current central seed explicitly uses Niche.id=slug and parentId=parentSlug; loaders still validate catalog membership and preserve provenance; unknown/missing mappings fail closed|
| Creator.availability/travel/currency/minimumMinor |availability/travel/minimum|Typed JSON validated; currency not inferred; period confirmation required|
| CreatorRate |creator-owned exact Rate|amountMinor.toString; same currency, positive, unique bycreator/platform/format/currency|
| AdvertisingLicence.policyVersion/reviewMethod |MatchingLicence + reviewed policy outcome|Validate actual reviewed policy/type/scope/method and current market applicability; generic reviewed status alone is insufficient|
| CampaignBrief.content/approvedAt/version |immutable CampaignInput|Use exact approved version, never mutable Campaign.input; owner service freezes and validates JSON|
| MatchRun/CreatorMatch; MatchDecisionRecord |strategy/brief/policy/result snapshots and separate campaign/creator decisions|Run results do not own decisions; decision loader/mutations still require trusted brand actor, state/version and transaction checks|

Source/mapping gaps are reported to the coordinator; this owner did not edit schema, routes, shared contracts, auth or the legacy matcher.
