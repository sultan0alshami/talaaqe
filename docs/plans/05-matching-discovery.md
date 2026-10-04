# Phase05 — deterministic matching and creator discovery

Status: planned. Owner: matching specialist; coordinator schema/runtime shared offer definitions; independent quantitative/authorization verifier. Prerequisites: creator03 eligible account/evidence DTO and brand04 immutable approved brief; phase01 exact contracts and phase02 UI. No model ranking, nominal-money comparison, padding or fake profile metrics.

## 05.1 Pure eligibility, aggregation, score and exact quote fixtures

- Objective: implement reproducible `infame-fit-v1-confidence-floor` and explanations from observed facts.
- Prerequisites: central vocabulary/offers/money, approved relevant account subset and reviewed policy loader; benchmark/default decision IDs.
- Allowed paths: matching strategy/filters/subscores/aggregation/benchmarks/types/unit tests only; requests to root for schema/contracts; inherited matcher adapter root-owned.
- Contracts: weight/.5unknown/confidence-floor/weakest evidence,90-day freshness, threshold60/max12/ID tie/no padding; matching-currency supported basket, explicit subset, estimated impressions; null partial data/no joint demographic inference.
- Failing acceptance: empty eligible/below60 input returns[]; residenceRiyadh does not supply Riyadh audience; currency mismatch/one missing row producespartial/null budget; stale/private unrelated account never boosts score; separate marginal demographics cannot generate joint claim; exact expected scoring fixtures including confidence1/.7/.4 pass only documentedformula.
- Implementation: normalize/deduplicate inputs; filters availability/language/dialect/platform/physical/travel/safety/market policy/optional trust/tier; shared follower-weighted per-dimension aggregation; deterministic price/impression allocations and hypotheses with version; pure grounded reasons. Unclaimed candidates explicitlyprospects/unknownavailability/invitation only.
- Failure states: missing demographics/rate/currency/target→null/unknown; unusable metrics/policy→ineligible; no division byzero/NaN/unsupported extrapolation. Empty is valid.
- Validation/review: test-first numeric fixtures, evidence boundary exactly90days/future data, related-niche disjointness/no double confidence, tie/allocation/precision. Independent quantitative reviewer recomputes representative fixtures and conditions; four gates before integration commit.

## 05.2 Owned explicit runs, persistence and rerun decisions

- Objective: versioned match results with stable save/dismiss/offer decisions and zero side effects on reads.
- Prerequisites:05.1review; coordinator schema unique run/creator+campaign/creator decisions and approved brief/evidence/policy versions.
- Allowed paths: matching loaders/persistence/API/DTO/tests; root schema/auth/DTO composer adapter only by handoff.
- Contracts: GETread-only, mutationrequires owned brand/approved exact brief; persist strategy/brief/evidence/policy; cache reasons by versions; decisions independent from replaceable score run.
- Failing acceptance: unrelated brand cannotrun/read campaign matches; GET never calls model/rank/write; concurrent rerun duplicates cannotlose saved/dismissed decisions; new brief/evidence invalidates explanation cache and old results visiblystale; hidden/suspended creator disappears immediately.
- Implementation: transactional run identity/idempotency and result persistence, stale/version indicators, preserved decisions/offers, bounded data loader using relevant authorized facts; deterministic explanation fallback with minimized identity-free model context.
- Failure states: no eligible/approval changed/source unavailable/modelcap→honest empty/stale/readiness/deterministictext, no result padding or silent replay.
- Validation/review: actual DB ownership/idempotency/rerun races; reviewer checks model input excludes creator identity/private evidence and null labels survive DTO.

## 05.3 Shortlist groups and trusted search/filter surface

- Objective: useful cards/groups/filters with understandable fit and transparent quote/trust/freshness.
- Prerequisites:05.2DTOs; documented component APIs/Figma group/discovery frames; actor/projection matrix.
- Allowed paths: matching screens, assigned brand matches/search pages, matching dictionary/DTO/tests; public creator cards use shared projection through root/creator handoff.
- Contracts: primary niche×largesteligible follower tier; residence separateaudience; rawconfidence/completeness/percriteria; full/partial/missing quotes/currency/estimatedimpressions; saved/dismissed survives; directoffer outside shortlist labeledDIRECT.
- Failing acceptance: empty state offers edit/invite without strong-match claim; unknownmetrics not0, partialsubtotal notfulltotal, low-confidence data notAPIbadge; unclaimedCTA cannotactiveoffer; mobile filters/focus/RTL/LTR accessible; hidden/private/test search excluded.
- Implementation: media-forward grouped cards, detail breakdown/reasons/source/date/scoped licence, filterSheet/combobox/pagination, save/dismiss/rerun commands, search same trustrules and explicit supportedbasket→offerhand-off.
- Failure states: loading/empty/filter-no-results/unavailable/session/stale→specific accessible action and preserved decisions; no fake count/prepadded creator.
- Validation/review: Arabic360/Englishdesktop, longhandles/touch/keyboard, non-Saudi residence reachingSaudi audience and expired/non-Saudi licencefixtures. Independent reviewer checks cards against pure outputs, no UI invented ranking.

Phase exit: exact numeric and real persistence/ownership/race evidence, complete honest empty/unknown/partial/search/rerun UX, independent review and four gates. Beta strategy/hypotheses remain explicitly reviewable, not market success claims.
