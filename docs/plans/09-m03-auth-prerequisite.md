# M03 prerequisite: current campaign sessions across native waits

Prerequisite930b69c. M03 investigation found legacy campaign routes resolving a
signed session before calling User-ID-only services; those transactions did not
hold/recheck the session after waits. Two independent native route witnesses
returned200 after actual revocation or expiry, before any product change.

Root owns organizations/context.ts fixed predicate exports, campaigns/service.ts,
the eight campaign API methods, five campaign SSR/page callers and records.
receipt_tests owns only tests/campaigns/session-waits.test.ts; scout reviews exact
policy lock order/hash compatibility read-only. Preserve other work and source.
No schema/dependencies/providers/new planning scope or UI composition change.

Trusted serverAuth contains only userId/role/sessionId/sessionVersion, captured
synchronously and matched to actorUserId/fixed BRAND. It comes from actual server
requireRole/requirePageSession, never request input, command hash/key or journal.
Old positional/raw internal callers retain their documented behavior; this does
not give omitted-auth callers a session boundary.

Hold owner/reviewer Users before exact AuthSession SHARE/current validation, then
Brand/Campaign. The existing approval policy actor hook precedes Session, and its
resolver receives captured actors without late User locks. Common transaction exit
awaits all callback work, then validates actual-clock current session before commit,
including early replay and standalone create/list. Invalid session rolls back all
effects. Exact history remains authorized before fresh revision checks and renewal
does not change its hash/result.

Finite native acceptance: actual User wait with committed session revocation;
actual journal INSERT wait with natural session expiry and tentative-update
rollback; genuine renewed-session create/mutation replay with original parsed
hashes/results and no session metadata persisted; committed replay SELECT blocked
by actual ACCESS EXCLUSIVE with natural expiry/private401/no state change. Only
Next cookie context is a seam; sessions, services and PostgreSQL remain native.

Independent review, guarded native checks, relevant original campaign/matching/deal
browser journeys and all four gates precede commit. Matching's separate legacy
getCampaignMatches/current-session gap is outside this correction and needs its own
native witness; do not claim platform-wide session acceptance. Full M03 context/
owner-review/provenance/asset/customer flow and M04–M15 remain required.
