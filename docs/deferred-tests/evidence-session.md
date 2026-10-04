# Pending evidence session prerequisite

The adjacent evidence-session.test.ts.txt preserves the authored session.test.ts witness byte-for-byte. It is deferred outside test discovery while the user-directed Talaqee interface reuse checkpoint is completed.

Before accepting the evidence phase, restore this file to tests/evidence/session.test.ts, implement trusted server session checks in evidence services and transport routes, observe the expected failing witness before the implementation, and pass the unchanged revoked-session, actor-mismatch, in-flight revocation, expiry and current role/version assertions using the actual session clock. Do not weaken these security assertions or label them verified before they are executed successfully.

Deferred on 2026-10-04 by the coordinator's explicit scope instruction. No evidence implementation was completed for these assertions.
