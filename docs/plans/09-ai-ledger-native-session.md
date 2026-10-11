# Native sessions for AI spending

Coordinator freeze,2026-10-11. Prerequisite2eb14b7 passed all four gates and12
mounted administrative regressions. This enables no provider, subscription,
dispatch route or new operational authority. OpenAI remains disabled. Preserve
the actual manual30-field campaign agent and free saved access.

## Inspected source gap

ai-budget/ledger.ts currentActor locks User but not exact AuthSession, uses the
injected accounting clock for auth expiry and checks only before later reservation,
accounting/audit waits. reserve/reconcile/resolveOverrun parse business input
before native auth. AiActorSchema.sessionId uses generic identifiers instead of
native43-character base64url ids; UUID fixtures and simulated2091 expiry do not
prove current identity. No src/scripts dispatcher composes this factory yet.

Root owns ai-budget/contracts.ts,ledger.ts and a narrow new session/error helper
if needed, shared records and all execution. Independent author owns only an
ignored draft until adoption as at most three native groups and explicitly
assigned stable-session fixture plumbing in existing ledger/sql-review tests.
Reviewer checks native authority, accounting/hash preservation, complete locks,
savepoint/quarantine/token separation and staged scope. No worker changes shared
identity/organization auth, schema, providers, dependencies or UI. Agents are not
alone and preserve all other work/source/data.

## Authority and exact behavior

Six actor methods reserve,read,claim,releaseUnclaimed,reconcile,resolveOverrun
capture strict actor tuple/dependencies before waits, authenticate before command
or private parsing, and bind actual User role/version/active plus exact Session
owner/version/nonrevocation/real expiry. Keep existing three roles; ADMIN-only
review methods require genuine current ADMIN. A malformed/forged/inactive/expired
tuple returns safe UNAUTHENTICATED401; a genuine wrong role returns FORBIDDEN403.
Add safe status mapping to existing AiBudgetError without changing business
failure/replay/conflict codes. Session-id grammar is exact native43 base64url;
other identifiers and hashes remain unchanged. Do not persist sessionId or tokens.

Lock order: global AI advisory lock before complete sorted affected Users,
then exact actor AuthSession FOR SHARE, then reservation/domain rows. ADMIN work
captures the thin target reservation owner before taking complete User locks,
rechecks inventory after locks, and never acquires a new User after Session/row.
The opaque context identifier is accounting metadata, never campaign/client
authority. Do not nest this factory inside a prelocked campaign transaction.
Later pooled entitlement/scope admission needs its own reviewed atomic seam.

Capture/validate strict tuple shape synchronously first. For a syntactically
native tuple, fixed standalone timeout maintenance may commit even when current
auth is already invalid, preserving the existing durable quarantine semantics.
Revalidate actual auth before business parsing; its401/403 wins over poisoned
maintenance metadata. An authorized actor receives the safe maintenance error
without executing a command. This trusted system step grants no permission or
token fallback. Missing/malformed tuples fail401 before maintenance.

Separate actual new Date authentication from trusted accounting UTC day/deadline
clock. Recheck current native authority after locked waits and before returned
DTO/execution token/replay/final success. Capture immutable native dependencies;
caller mutation cannot replace original authority. Only native SQL scheduling
conflicts/capture changes may retry, after fresh auth outside aborted callbacks.
Never query an aborted transaction and hide its original conflict.

Preserve existing global/user caps, micro-USD BigInt math, pricing/request/
settlement hashes, actorRole/actorSessionVersion metadata, one-acquisition token,
exact replay, UNKNOWN/billing uncertainty/overrun audits and8KiB metadata bounds.
Existing durable expired-RUNNING quarantine survives denied command rollback.
Keep maintenance separate from interactive lock inventory so it creates no
reservation→User backward edge. Any maintenance reservation locks must be
committed/released before the interactive transaction takes complete User locks;
separate helper names within the same outer transaction are insufficient. The
interactive transaction then freshly takes the global advisory lock and full
native inventory. Its final actual-clock auth follows every post-command
maintenance/quarantine wait before releasing DTO/token/replay success.
SAVEPOINT rollback releases acquired locks;
invalidate any locked-frame assumption and reauthenticate on the appropriate
fresh boundary. Do not retry a command after an uncertain COMMIT.
Native scheduling conflicts and uncertain COMMIT failures must not be swallowed
as ordinary savepoint business denials. Trusted token-lane maintenance never
creates an interactive missing-auth fallback.

settle,quarantine,releaseKnownNoCall remain the exact trusted-token server lane,
permitted after browser logout/suspension to retain actual billing. Never infer
that lane from missing interactive auth or expose it as a browser fallback.
No external invocation occurs inside transactions or this mission.

## Meaningful acceptance

At most three independently authored native groups, before implementation:

1. Six methods default-deny missing/forged tuples before malformed commands or
   old keys; genuine native leading '-'/'_' ids accepted; renewal preserves exact
   hashes/replay. Strict role/metadata/no-session-in-output preservation.
2. Actual advisory/User/Session/reservation waits with committed revocation,
   version/role ABA/caller mutation; no private DTO/token/new command writes.
3. Real expiry during private/reservation/audit waits despite historical business
   clock; whole command/audit rollback and durable quarantine, plus exact trusted
   settlement/no-call afterlogout positives. Preserve existing spend/concurrency/
   uncertain-billing mechanics using stable genuine owned sessions.

Only owned task-local fixtures/cleanup; no reset, auth/time/SQL mocks, registered
test imports, copied source env/data, provider calls or live acceptance claim.
Root observes RED, runs native regression and npm run check's four gates before
exact commit. Provider orchestration/pooled entitlements/media/voice remain later
authorized slices with genuine readiness evidence; successful ledger tests do
not finish the full platform goal.
