# Trusted AI spend ledger

`createAiBudgetLedger()` is a server-only capability boundary, not a browser API.
The trusted orchestrator must compose `reserve`, then `claim` before one
external invocation. No application provider dispatcher currently composes this
factory; ledger tests do not establish working AI features or subscriptions.
The invocation happens **outside** the transaction. Never put
provider calls, callbacks or browser-chosen configuration inside this ledger.

The caller passes a strict native Session subset with its actual43-character
base64url session identifier. Reserve, claim, owner read/cancel and ADMIN review
authenticate before business parsing, then recheck active User/role/version and
the exact locked Session owner/version/revocation/real expiry after waits and
before returning DTOs, tokens or replay. Accounting clocks cannot extend auth.
The global advisory lock precedes complete sorted affected Users, exact Session
and reservation locks; ADMIN subjects are recaptured under the reservation lock.
Do not compose this factory inside a prelocked campaign/owner transaction.
Independent connections share user/platform caps across all billed purposes.

Fixed timeout maintenance owns a separate global transaction and commits/releases
its reservation locks before interactive Users. A syntactically native tuple may
trigger that trusted system step even when its actor is already inactive; it
grants no permission. Native auth denial wins over poisoned maintenance errors,
while an authorized actor receives the safe maintenance failure. Command writes
roll back separately; uncertain billing quarantine remains durable. Native
conflicts are not hidden by queries against aborted transactions, and uncertain
COMMIT outcomes are never automatically retried.

Configure `AI_USER_DAILY_CAP_MICROS` and `AI_PLATFORM_DAILY_CAP_MICROS` as canonical
nonnegative integer strings in USD millionths. Preview/production require both.
Development/test default to $1/user/day and $10/platform/day: conservative
hypotheses, not validated business budgets. The factory's client/clock/caps options
are trusted composition/test injection only; never pass request data into them.
Amounts and ratios use BigInt, including values above JavaScript's safe integer.

Today's usage is settled actual micro-USD with `settledAt` within the current UTC
day, plus **every** RESERVED/RUNNING/UNKNOWN reservation regardless of age. A
same-key replay requires the same actor, purpose, payload hash and complete
reservation command. A pending identical actor/purpose/payload under another key
is denied. Running deadlines quarantine billing as UNKNOWN rather than refunding
or claiming another execution. Midnight cannot release uncertain reservations.

The random execution token is returned once to the trusted orchestrator, with
only its reservation-bound hash stored. Never include it in owner responses,
logs, URLs or provider inputs. The token permits settlement after user suspension
or session expiry so completed billing is retained. Settlement is idempotent only
for the exact same actual usage/pricing/charge; conflicting bills are rejected.
The deadline signals the adapter's required termination boundary, not proof that
a provider stopped. An adapter must enforce bounded provider usage independently.

Strict schemas allow only known purpose/unit enums, SHA-256 input hashes, bounded
safe context/model/pricing identifiers, counts, dates and exact prices. The caller
hashes canonical payloads; raw transcripts, audio, provider keys, URLs and arbitrary
JSON are rejected and never stored here. Pricing is a trusted dated catalog
snapshot; no provider prices are invented. Actual billed cost is retained even if
it differs from the recorded exact upward-rounded usage estimate. Persisted
metadata is limited to 8KiB. Exact estimates may use up to 40 decimal digits in
JSON without overflowing the separate PostgreSQL charge column.

Only an unclaimed reservation may be owner-cancelled. A trusted token can release
a running attempt known not to have invoked the provider; UNKNOWN requires an
active ADMIN reconciliation and an atomic sanitized AdminAudit. Reconciliation
references are opaque reviewed billing-evidence IDs, never evidence contents. An
actual charge over the reservation is stored in full and blocks all new platform
spending across days until an active ADMIN explicitly accepts the overrun with an
audit. Acceptance retains the charge and normal caps still apply.

`read()` returns only sanitized owner reservations and aggregate caps/usage. Never
serialize `AiReservation.result`, execution tokens or the trusted ledger object.
All billing writes must use this module; malformed historical ledger metadata
fails closed with `LEDGER_REVIEW_REQUIRED`. Schema defenses are coordinator-owned.
