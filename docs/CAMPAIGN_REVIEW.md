# Campaign API verification and independent onboarding review

Reviewer: `/root/phase_planner`, 2026-10-04, current uncommitted `infame/mvp` working tree. Campaign implementation and its tests are this agent's work and are **self-verification**, not independent campaign approval. The coordinator-owned onboarding modules below were reviewed independently without production edits. This report does not grant a phase exit or live-provider acceptance.

## Campaign transport evidence

- Owned routes: GET/POST `/api/campaigns`; GET `/api/campaigns/[id]`; POST `/commands`, `/brief/generate`, `/brief/approve`, `/chat`, `/paragraph` beneath that ID.
- Routes use `domainHandler`, `requireRole`, bounded `parseBody`, promised route parameters and private/no-store responses. The browser mutation whitelist is UPDATE_FIELDS/APPLY_PROPOSAL; requests cannot supply actor/channel/server/policy context. Chat/paragraph perform owner checks then return CAPABILITY_UNAVAILABLE503 without extraction or provider work.
- Current active BRAND/ownership is independently checked by domain services. List results and cursor lookups remain brand scoped. Approvals preserve immutable brief history, real accepted deal/agreement snapshots and exactly one audit/outbox event under replay.
- At runner11:49:55,10 PostgreSQL service tests and4 in-process route tests passed. Route tests mock the session issuer while using real PostgreSQL domain authorization; they are not live HTTP/session/browser acceptance. Full TypeScript and campaign-path ESLint passed after mounting the routes.
- A subsequent complete API save→generate→approve/replay fixture was added. Its first invocation was rejected by the existing exclusive test lock before executing tests. After normal lock release/schema08 readiness, runner11:58:08 passed all10 service,5 transport and3 independent onboarding tests (18 total). Full TypeScript and campaign/API/test-path ESLint also passed.

## Independent onboarding findings

### P1: accepted ownership remains attached after stable identity changes — corrected, independent regression green

`src/lib/onboarding/profiles.ts`, `syncMappedAccounts`: an existing `(creatorId,platform,handle)` row retains its old providerAccountId and VERIFIED ownership when the draft is corrected to a different stable provider ID under the same handle. The update changes mappingRevision/intended confirmation/consent, and SAVE_PROFILE updates the global mapping hash; publication then accepts the old proof's VERIFIED flag without an exact identity binding. This can treat user confirmation of a new candidate as inherited accepted ownership.

Reproduction: synthetic reviewed providerA → correct draft mapping to providerB with the same handle → confirm/consent → SAVE_PROFILE → account still VERIFIED. Guarded test `tests/campaigns/onboarding-review.test.ts` failed at runner11:52:14 on that final assertion. No live connection or ownership proof was asserted by this fixture.

The coordinator deployed schema08 and implemented exact accepted identity hash/reviewer/past-review checks. A changed provider ID clears VERIFIED ownership, hash, review and proof fields. Publication/public loaders compare proof hash to the exact current identity. The independent regression passed at runner11:58:08 after a clearly synthetic accepted-review fixture populated that hash/reviewer. Matching's separate loader verification remains its owner's gate.

### P1: replacement asset approval exposed new content without publication — corrected, regression green

The reviewed initial code kept PUBLISHED state during GENERATE_PORTFOLIO; public loaders selected the latest approved asset. Subsequent APPROVE_PORTFOLIO could therefore expose a replacement without a new PUBLISH command. The coordinator changed generation to set creator/brand PRIVATE (creator brandVisible=false). The independent replacement-content regression passed at runner11:52:14 after that edit. A prior executable red result is **not** claimed: the fix landed before this regression ran.

### P2: correcting one source erases unrelated account approvals — corrected, independent regression green

The initial `src/lib/onboarding/drafts.ts`, `invalidateSource`, updateMany cleared factsApprovedAt for every creator account. Returning the aggregate to PRIVATE is appropriate for publication safety; deleting unrelated providers' approval timestamps was broader than the corrected source and violated independent source retention. The coordinator scoped account invalidation to the old mapped platform plus handle/provider ID. The unrelated-TikTok regression passed at runner11:58:08. This was found statically and corrected before that executable regression; no prior red execution is claimed for this finding.

## Remaining gates

The scoped independent identity/invalidation and full API transport fixtures are green after schema08. The coordinator's four integration gates plus actual HTTP/browser/auth evidence and an independent campaign review still remain necessary. Policy metadata remains explicitly null when unavailable; manual brief approval is not legal eligibility. Live AI, extraction, reviewed jurisdiction rules and provider acceptance remain separate dependencies.
