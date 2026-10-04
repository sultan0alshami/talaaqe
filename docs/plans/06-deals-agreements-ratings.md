# Phase06 — offers, deal room, agreements and ratings

Status: planned. Deal specialist owns assigned domain leaves; coordinator owns shared offers/auth/schema/constraints. Independent transaction and security reviewer. Prerequisites: phase01 contracts and reviewed indexes, creator/brand eligibility and approved brief. Matching05 supplies match origin; direct/invite paths retain distinct semantics. No money moves through Infame.

## 06.1 Initial offer and pending invitation

- Objective: real supported terms instead of proposal-status labels.
- Prerequisites: central offers/money/formats, current campaign/brand/creator policy loaders, claim interface.
- Allowed paths: deals validation/service/API/DTO/screens/dictionary and tests; shared/schema changes requested from coordinator.
- Contracts: campaign currency, supported creator basket, positive amount, dates/timezone, usage/note/governing terms; verified brand and authenticated claimed creator; one active campaign/creator deal; MATCH/DIRECT/INVITE origin. Unclaimed prospects receive proposed invitation terms.
- Failing acceptance: nonowner, unverified brand, private creator, unsupported format and currency mismatch reject; simultaneous creates yield one active deal; unclaimed prospect cannot execute terms before claim/availability/eligibility revalidation; direct offer gets no invented match score.
- Implementation: explicit basket prefill, editable confirmed terms, current eligibility validation, atomic deal/offer/event/outbox and idempotency; store proposed invitation separately.
- Failure states: stale brief/account, unavailable creator, invalid licence, pending verification or duplicate returns specific conflict/readiness; no silent creator substitution.
- Validation/reviewer: real PostgreSQL duplicate-create race, actor/eligibility matrix and Arabic/English offer browser; independent reviewer inspects actual terms and prospect state.

## 06.2 Counters, acceptance, decline and messages

- Objective: full chronological negotiation with server state enforcement.
- Prerequisites:06.1 current pending offer, constraints and audit/outbox.
- Allowed paths: deals state/services/messaging/API/screens/tests/dictionary.
- Contracts: either party counters OFFERED/COUNTERED; supersede previous pending atomically; current recipient alone accepts/declines; stale offer409; currency fixed and original text preserved; terminal history retained.
- Failing acceptance: accepting/declining own offer denied; concurrent accept/counter cannot accept superseded terms or leave two pending; stale IDs/nonparty read/post reject; replay idempotent; terminal negotiation prohibited.
- Implementation: reviewed row/version locks or serializable retry, immutable offers/events, bounded messaging with truthful refresh/realtime state, reasoned cancellation policy.
- Failure states: conflict/session/network/cancelled/declined preserves history and reloads current state; optimistic UI never authorizes transition.
- Validation/reviewer: separate database connections exercise counter/accept/decline/cancel races and actor/state table; independent transaction reviewer reproduces findings.

## 06.3 Immutable agreement and two confirmations

- Objective: accepted terms freeze once; exact agreement version needs both confirmations.
- Prerequisites:06.2 accepted snapshot, reviewed market template/governing-terms capability and scoped licence policy.
- Allowed paths: deals agreement/service/API/UI/tests; coordinator owns unique agreement/confirmation constraints.
- Contracts: Arabic default/English option, selected language/version/hash; snapshot parties/countries/markets/money/timezone/rights/licence/disclosure/governing terms. No universal Saudi-law template. Current mandatory policy recheck before confirmation.
- Failing acceptance: profile/brief edits cannot rewrite agreement; duplicate same-party confirmation remains one; concurrent two-party confirmations yield AGREED once; wrong version/nonparty denied; expired required licence blocks; one confirmation cannot unlock delivery.
- Implementation: single validated immutable agreement from accepted terms, source/version/hash; explicit accessible confirmation with unique records and transactional both-party check; accurately describe app audit confirmation pending professional review.
- Failure states: missing reviewed terms, changed policy/licence or version conflict remains pending/blocked with accepted history preserved; no guessed legal clauses.
- Validation/reviewer: actual confirmation race/version/hash fixtures and global/Saudi snapshots; independent review of immutability. Qualified agreement review remains required for live use.

## 06.4 Delivery, direct-payment reports and sealed ratings

- Objective: creator delivers, brand completes and both submit protected feedback.
- Prerequisites:06.3 AGREED, scoped delivery storage and shared reveal projection.
- Allowed paths: deals delivery/payment/rating modules/API/screens/DTO/tests; notification/reveal cron handoff to admin/coordinator.
- Contracts: creator-only delivery from AGREED; brand-only completion from DELIVERED; brand paid/creator received timestamps on AGREED/DELIVERED/COMPLETED are idempotent user reports; completed ratings once1–5; reveal both or seven elapsed days after first.
- Failing acceptance: wrong-role/terminal delivery and unconfirmed agreement reject; duplicate payment declaration does not overwrite; precompletion/out-of-range/duplicate rating reject; opposing sealed content/aggregates/export hidden before exact UTC boundary.
- Implementation: bounded delivery evidence/link and audited completion, truthful payment labels, per-party ratings and shared atomic reveal rule across API/projection/cron.
- Failure states: invalid link/storage/network/conflict has retry without duplicate; notification failure does not undo rating; no wallet/provider implying verified funds.
- Validation/reviewer: completed two-party Arabic mobile/English desktop E2E; database state/visibility/race and seven-day/DST boundaries; independent verifier checks full journey.

Phase exit: full terms/counter/accept/agreement/both-confirm/deliver/complete/payment-report/rating behavior, transaction and actor evidence, independent review and four gates. Live verification/professional terms stay separately tracked; no settlement claim.
