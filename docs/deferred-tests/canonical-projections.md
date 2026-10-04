# Restored canonical public proof witnesses

The exact, unchanged source is preserved in `canonical-projections.test.ts.txt` and restored to active `tests/evidence/canonical-projections.test.ts`. Both copies have SHA-256 `F0885E027C6CA3C0DB30E03FFE1F4D977EFEDD2CC659A5A45EF2D4993CBA5BE6`. The earlier failed process start was not a behavioral result. After activation, all five original witnesses actually failed on the guarded target, then passed after the metadata-only proof integration. They also pass in the current 69-test focused proof/session/matching/deal run. No assertion was changed or skipped.

Canonical `publicCreator` and `publicBrand`, publication, matching, deals and scoped licence reads now use current owner-bound accepted challenge/private asset/journal metadata with current active reviewers. Later witnesses reproduced and closed ownership asset/identity substitution, screenshot observation substitution, resource expiry during lock waits and owner transfer during private reads. Owner/admin evidence interfaces and live provider/legal acceptance remain separate work.

Independent review and full integration/browser gate evidence are recorded in `docs/PROGRESS.md`. Proof consumers never fetch private bytes or providers; they validate the metadata produced by the private review mutation and fail closed when original receipt metadata is missing.

Preserved acceptance cases:

- Raw `VERIFIED` plus an identity hash cannot establish accepted ownership.
- Deleting proof metadata or suspending the reviewer withdraws public identity.
- Current ownership reassignment and mapping changes cannot transfer earlier proof.
- A public read waits for a concurrent reviewer suspension and sees committed state.
- Representative proof requires current submission owner/country/asset binding independently of registration.

`tests/helpers/reviewed-evidence.ts`, the deal fixture's injected clock/target and the browser fixture's honest proof timestamp are retained for subsequent verification. They use actual local upload/challenge/submission/review commands with clearly synthetic actors and a guarded task database; they do not establish live provider or legal acceptance.
