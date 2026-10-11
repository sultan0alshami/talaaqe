# Native User identity prerequisite

Root preparation,2026-10-11, after the reviewed Attempt/Result checkpoint.
No provider, scope permission, pricing, route or entitlement activation.

Root owns src/lib/ai-budget/contracts.ts and shared docs/execution. Change only
AiActorSchema.userId and AiLedgerMetadata.reconciliation.adminUserId to the
existing OrganizationIdSchema (printable ASCII1..200). Exact native identity is
retained without alias/truncation. Every opaque reservation/operation/pricing/
context/review/audit identifier keeps its existing grammar. Historical command
payloads, pricing, request hashes and ledger metadata schema version stay intact.

schema_review independently authored tmp/planning-native-actor-identity.test.ts,
two native groups, before product changes. campaign_agent_ui reviews it read-only.
Root adopts as tests/planning/native-actor-identity.test.ts after the reviewed
Attempt/Result checkpoint, observes genuine broad User reserve RED, then changes
the two declarations. Native open/resolve/session/role/active/expiry/reconciliation
and unchanged hashes/opaque identifiers must pass. Own synthetic terminal fixture
cleanup never licenses deleting unresolved reservations. No provider calls.

All four gates through npm run check and an independent staged/source review
precede commit. The coordinator consolidated this prerequisite with S0's native
ledger-owned frame into one integrated checkpoint, after both independent RED
and GREEN steps, rather than claiming a partial gate as completion. Preserve
original Talaqee, task databases, unrelated docs and
existing work; do not reset, publish, seed permissions or enable OpenAI.
