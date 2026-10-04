# Restored evidence session witness

The adjacent evidence-session.test.ts.txt preserves the authored witness byte-for-byte. The visual checkpoint deferred it temporarily; it is now active at tests/evidence/session.test.ts. Both copies have SHA-256 `D6FF82644B30732DEB83DB5D3E32EDB5ECA3649258F000EE5359CD0EAA67D450`.

The actual guarded original suite first failed all three tests on 2026-10-04, then passed all three after trusted session integration. Its unchanged revoked-session, actor-mismatch, in-flight revocation, expiry and current role/version assertions also pass in the current 69-test focused proof/session/matching/deal run. Authentication uses the actual clock, with checkpoints around locks and byte I/O and a final session SHARE lock before commit. Supplemental storage/clock/HTTP failures remain active separately.

The full union gates and browser evidence are recorded in docs/PROGRESS.md. These disposable local tests do not establish enabled live-provider or production acceptance. No original assertion was weakened or skipped.
