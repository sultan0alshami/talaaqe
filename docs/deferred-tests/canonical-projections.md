# Pending canonical public proof witnesses

The exact, unchanged test source is preserved in `canonical-projections.test.ts.txt`. It was moved out of automatic Vitest/TypeScript discovery for the founder's current visual reuse phase. No assertions were changed or skipped. No runtime red/green result has been observed: process creation failed before the attempted guarded test command started.

Current security gap: canonical `publicCreator` and `publicBrand` projections still use status/hash/reviewer checks instead of current owner-bound accepted challenge, private proof metadata and representative submission journal checks. Canonical publication, matching, deals and scoped licence adoption remain pending as recorded in `docs/PROGRESS.md`. Visual reuse acceptance must not be called proof/security or full MVP acceptance.

Before resuming the canonical proof phase, move this file back to `tests/evidence/canonical-projections.test.ts` unchanged and run it first against the exact guarded disposable test target. Implement the assigned metadata-only proof gates and transactional owner/reviewer/domain read locks; then verify the preserved witnesses and related publication/matching/deal checks.

Preserved acceptance cases:

- Raw `VERIFIED` plus an identity hash cannot establish accepted ownership.
- Deleting proof metadata or suspending the reviewer withdraws public identity.
- Current ownership reassignment and mapping changes cannot transfer earlier proof.
- A public read waits for a concurrent reviewer suspension and sees committed state.
- Representative proof requires current submission owner/country/asset binding independently of registration.

`tests/helpers/reviewed-evidence.ts`, the deal fixture's injected clock/target and the browser fixture's honest proof timestamp are retained for subsequent verification. They use actual local upload/challenge/submission/review commands with clearly synthetic actors and a guarded task database; they do not establish live provider or legal acceptance.
