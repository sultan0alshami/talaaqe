# Campaign interview browser recovery

This follows the native interview/API checkpoint. Key/outcome/barrier endpoints
have native tests; mounted UI acceptance is in progress. Preserve Talaqee's page
composition and one parent navigation guard.
Root owns shared browser codecs, recovery policy/key/outcome orchestration/routes
and integration. Independent authors write failure witnesses before activation.
OpenAI stays disabled; encryption is app transport recovery, not a provider key.

## Default packet and privacy

Keep plaintext command words and key material only in memory. Persist one
AES256-GCM encrypted packet in sessionStorage before dispatch: exact original body,
UNKNOWN/CONFIRMED/CONFLICT phase and optional validated scalar receipt. Reconstruct
the strict command from the body, rather than persisting duplicate full DTOs.
Use WebCrypto, a fresh96-bit nonce for every save and128-bit authentication tag.
Authenticated associated data pins version, actor reference, exact binding and
key ID. Never write raw words, tokens, private media bytes or the key to storage.

A current-native view+plan-authorized server endpoint derives a purpose-separated
HMAC-SHA256 key from existing strong AUTH_SECRET and exact user/workspace/campaign.
Return only this purpose-specific key, public key ID and bound metadata through
private/no-store transport; never return the auth secret or session token. Stable
user/binding derivation supports same-user reauthentication. It cannot revoke a key
already disclosed to an authorized browser, so every restore refetches current
authority; previous key access is never current permission. Secret rotation changes
the key ID. Server computations run under existing scoped DB-only native locks.

Key fetch/encryption/storage failure preserves editable text in memory and blocks
POST. Default memory-only dispatch does not satisfy durable recovery. The packet
is exact; retry never regenerates its UUID, snapshot, authority or body. Reload may
restore it only after authorized decryption and strict complete validation, with
no automatic POST. Confirmed receipt recovery uses GET only.

Logout/denial/account change clears plaintext, ciphertext and key. An unresolved
operation retains a separate minimal scoped barrier: version/actor/binding/UUID,
canonical command digest, action/expected revisions, safe technical payload pins
and minimal receipt/phase. No words, field values, transcript, token or media.
Corrupt/missing/undecryptable ciphertext never silently releases an UNKNOWN key.
Account-switch barriers are inaccessible to the new actor and remain separate.

## Outcomes and explicit abandonment

A GET-only command outcome lookup requires current view+plan, exact actor/key/
binding/digest and verifies the retained producer lineage before returning scalar
committed history. Source/batch/brief hydration stays within exact native scope.
It cannot expose another actor's journal or treat a structurally valid label as
proof. A missing receipt means UNKNOWN: a queued original POST might arrive later.

An explicit abandonment operation must serialize on the same native User/scope/
Agent locks as the original command. If the original receipt already exists,
return its verified outcome for GET-only reconciliation. Otherwise establish a
revision barrier before permitting any new command: initialize the same bound
agent if it never existed, or advance its revision with current unchanged
preferences/fields while keeping review semantics and immutable history truthful.
Every original command checks expectedAgentRevision; a late original then fails
STALE_VERSION instead of committing behind abandonment. No new record/table or
provider call is needed, but this operation needs its own strict command/receipt,
current-authority/replay and race witnesses before implementation. Never erase a
pending UUID merely because an outcome read found no receipt.

If the caller wants exact retry after losing APPEND words, re-entry must reproduce
the saved original-text/body digest and reuse the original packet's UUID/pins.
Never silently send changed words under the old key or allocate a replacement.

## Browser composition and acceptance

Use the already retrieved Studio bubble/logical composer concepts within current
CampaignPlanningScreen cards. Mode choices are independent; unavailable media/
voice/provider modes remain explicit with a usable text/form path. Capture real
original text, show source pages and complete30 current-field review, then an
unapproved exact profile with separate owner submission/approval.

Browser-safe value imports exclude Node/Prisma/native hashed modules. WebCrypto
canonical hashing must match actual server Object.fromEntries+JSON.stringify
ordering, including integer-like keys, Unicode, exact money and central deliverable
merging. Decode bounded DTOs/hashes/bindings/coverage/cursors before display.

One synchronous parent guard aggregates agent, form/context/narrative/request
pending/busy/dirty state. Native401/403/404 clears protected parent and child data
before any JSON, aborts siblings and prevents stale callbacks restoring it.
Known receipts survive local persistence/reload failures; fresh actions remain
blocked until current read reconciliation. No automatic writes during restoration.

Independent meaningful tests cover crypto parity/tampering/nonce/AAD/bounds,
cross-actor/scope key denial and native revocation waits; encrypted exact reload
and no plaintext storage; unknown retry with identical body/key; confirmed GET-only
recovery; rotation/lost packet and abandonment-versus-delayed original race;
denial/account switch/logout; Arabic360 RTL/English desktop, keyboard/focus,
reduced motion/long words, all12 input/output choices and separate profile approval.
Encryption/fixtures do not establish live AI/media/voice or privacy/legal launch.

## Exact next interface freeze

Use three current-scoped services: getCampaignAgentRecoveryKey(actor,query,options),
getCampaignAgentCommandOutcome(actor,input,options) and
executeCampaignAgentRecoveryBarrier(actor,input,{channel:FORM,...options}).
All require current native view+plan, including key/outcome reads, before private
record/key work. No client actor/session/clock/key material is accepted.

Key query is existing `{scope,campaignId}`. Output:
`{schemaVersion:1,asOf,binding,actorReference,algorithm:AES-GCM,keyId,keyBase64Url}`.
Key is32 derived bytes (base64url43), keyId is its lowerSHA256. Bind derivation to
purpose `infame-campaign-agent-recovery-key-v1`, native userId and exact binding.
The fetched key is imported nonextractably and never cached persistently.

Outcome input is `{scope,campaignId,target}`. Target is strict technical metadata:
`{operationKey:UUID,commandHash:Hash,action,expectedAgentRevision,expectedSnapshot,
expectedAuthority?:originalCLIENTplanAuthority,payload}`. OWN rejects authority.
Non-APPEND payload is the exact original command's technical payload; APPEND uses
only `{originalTextHash}` with domain infame-agent-recovery-text-v1 hashing the
complete original `{text,language}`. No words/field values/raw media in target.
Target max32768 compactUTF8; overall transport remains64KiB.

If a target receipt exists, reconstruct its exact original command from target
metadata plus the actual retained text (APPEND only), then validate its canonical
commandHash and existing original producer joins/horizons under native scope.
Outcome is `{status:COMMITTED,binding,receipt:CampaignAgentResult}` or
`{status:UNKNOWN,binding,receipt:null}`. UNKNOWN is not permission to write a new key.

Barrier input is `{operationKey:UUID,scope,campaignId,expectedAgentRevision,
expectedSnapshot,expectedAuthority?:currentCLIENTplanAuthority,target,
initialPreferences:null|{input,output}}`. Barrier key must differ from target key.
It is a FORM-only dedicated RECOVERY_BARRIER action in the existing immutable
CampaignAgentCommand table, with a separately strict result union. SQL action/
result checks evolve additively; migration30 is not edited, no new table is added.

Under native locks, match displayed current Agent/snapshot, inspect verified target
outcome and always advance the current Agent revision once without applying target
work. Preserve facts/preferences/source/batch/brief history; clear stale coverage
using existing rules. Missing Agent permits only original INITIALIZE/revision0 and
explicit reviewed initialPreferences; positive target revision absence fails503.
For existing Agent initialPreferences must be null. Reject target expected revision
above current native horizon or target scope/hash substitution.

Barrier result is `{action:RECOVERY_BARRIER,agentId,campaignId,workspaceId,
agentRevision,campaignRevision,planningRevision,targetOperationKey,targetCommandHash,
targetOutcome:COMMITTED|FENCED,originalReceipt:CampaignAgentResult|null,replayed}`.
Scalar counters describe the barrier; any original receipt describes target history.
Store result without replayed, exact actor/key/hash and metadata-only audit/outbox
atomically. Unknown barrier retries its own frozen key; exact replay requires
current authority, returns its immutable result, and never advances revision again.
After confirmed barrier plus authorized GET reconciliation, release the target stub.
Every late original command still checks its old expectedAgentRevision and fails.

HTTP: GET /api/campaign-agent/recovery-key; POST /outcome and /recovery-barrier.
Origin protection applies to both POSTs; all outputs private/no-store/request-ID.
Key/config failures return RECOVERY_UNAVAILABLE503 without secret values. Current
native errors precede malformed metadata; stale display409, bad metadata422,
corrupt/missing committed producer503, exact-key conflict409 remain truthful.

Implementation uses Node24 [createHmac](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptocreatehmacalgorithm-key-options)
and browser [AES-GCM parameters](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams),
including a fresh96-bit nonce and matching authenticated associated data. Browser
[importKey](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/importKey)
uses extractable:false. These sources specify APIs; they do not prove application
authorization, browser recovery or revocation, which require the actual witnesses.

Implementation names for authors: all three server exports live in
src/lib/campaign-agent/recovery.ts. HMAC message is the UTF8 lowerhex string from
canonicalHash({domain:infame-campaign-agent-recovery-key-v1,userId:nativeActorId,
binding:actualAgentBinding}); HMAC-SHA256 uses AUTH_SECRET as its key. keyId is
SHA256 over the derived32 bytes (not the base64 text). Tests may temporarily replace
process.env.AUTH_SECRET in a finally-restored scoped fixture; never print/assert
raw key/secret values. This tests derivation only, not JWT rotation readiness.
Barrier payloadHash is canonicalHash({domain:infame-campaign-agent-recovery-barrier-v1,
actorUserId:nativeActorId,command:strictParsedBarrier}).

Exact APPEND metadata digest is canonicalHash({domain:infame-agent-recovery-text-v1,
originalText:{text,language}}), not a spread of the text properties. Original CLIENT
authority identity pins must still match the currently authorized same-client
membership/grant/organization/Brand/capability; only old revision counters may be
bypassed for committed history, as in the existing native replay boundary.

Race/error clarifications: a barrier's displayed Agent/snapshot CAS is strict.
If the original commits first after that display, barrier fails STALE_VERSION409;
an explicit refreshed barrier sees COMMITTED and advances once. Target revision
above the actual horizon is VALIDATION422. Existing target key with a different
commandHash returns OPERATION_KEY_REUSED409. Original commandHash is exactly
canonicalHash({domain:infame-campaign-agent-command-v1,actorUserId:nativeActorId,
command:strictOriginalCampaignAgentCommand}).

POST /outcome is READ-ONLY metadata transport (zero database writes), equivalent
to the intended read-only reconciliation; it is not a business POST retry.
Restoration never automatically calls /commands or /recovery-barrier. Confirmed
recovery performs only authorized reads; wording "GET-only" describes that rule.

A barrier's own uncertain outcome must also be recoverable without recursion.
Outcome target accepts either the original five-action metadata shape above, or
`{kind:RECOVERY_BARRIER,command:completeStrictBarrierCommand,commandHash}`. The
complete barrier command contains only technical metadata and may live in its
minimal stub; its nested target is strictly one of the original five actions.
Outcome COMMITTED receipt is CampaignAgentResult or CampaignAgentBarrierResult.
An unknown barrier can re-encrypt and explicitly retry its own exact body/key;
never mint a replacement key or construct a recursive barrier-of-barrier tree.

Browser encryption exports live in src/lib/campaign-agent/browser-recovery.ts:
sealCampaignAgentPacket(material,actorReference,binding,packet) and
openCampaignAgentPacket(material,actorReference,binding,envelope). Packet is strict
`{kind:COMMAND|RECOVERY_BARRIER,body:exactOriginalJSON,phase:UNKNOWN|CONFIRMED|CONFLICT,
receipt:null|matchingResult,reviewed:boolean}`; no duplicate command object is stored.
Restoration reconstructs/validates original command from body. UNKNOWN cannot have
receipt or reviewed:true; CONFIRMED requires its exact validated receipt; CONFLICT
has no receipt and cannot be silently converted back to UNKNOWN.

Encrypted envelope is strict `{schemaVersion:1,actorReference,binding,keyId,
ivBase64Url,ciphertextBase64Url}`. AAD is UTF8 browserCanonicalJson over exactly
`{domain:infame-campaign-agent-packet-v1,schemaVersion,actorReference,binding,keyId}`.
Validate key metadata/binding/actor and SHA256(raw32key)==keyId, canonicalbase64url,
12-byte IV and bounded cipher/plaintext before decrypting. Import key with
extractable:false. Packet JSON bytes cap196608 (escaped64KiB original body plus
scalar receipts/metadata); envelope caps270336, no body text truncation.
Opening under foreign actor/binding/key, tampered metadata/nonce/cipher/tag or wrong
body/receipt fails generically without exposing words. Save always uses a fresh IV.
Pure encryption performs no storage or requests; integration saves encrypted bytes
successfully before business POST and refetches current authorization on restore.

Browser-safe adapter path is src/lib/campaign-agent/browser.ts, with existing
candidate export names browserCanonicalHash/browserCanonicalJson/checkedBrowserJson,
decodeCampaignAgentRead/Sources/Receipt, parseCampaignAgentBrowserCommand,
campaignAgentReviewRows and campaignAgentAcknowledges. Node canonical helpers are
test-only imports for parity; they never enter the client module's value graph.

Encrypted journal interface is src/lib/campaign-agent/browser-storage.ts:
createCampaignAgentEncryptedJournal({actorReference,binding,storage,fetchKey,onDeny}).
storage is the Storage interface; fetchKey(signal) returns an authenticated Response,
onDeny(status) synchronously clears parent privacy before any response body. Methods:
`load(signal):Promise<{packet:RecoveryPacket|null,stub:RecoveryStub|null}>`,
`save(packet,signal):Promise<void>`, `clear(keepUnknownBarrier:boolean):void`.
Bindings/actor are captured at factory entry. Key refetches before every restore
and save; no persistent or cross-actor key cache. Network success is decoded with
strict bound key metadata. Storage failures prevent business dispatch.

Journal keys are exact actor/scope/workspace/campaign under infame:agent-recovery:v1.
Only two purpose entries: encrypted packet and minimal stub. Stub is
`{schemaVersion:1,actorReference,binding,kind:COMMAND|RECOVERY_BARRIER,
operationKey,commandHash,phase,receipt:null|matchingResult,metadata}`. For COMMAND,
metadata is five-action target safe metadata (APPEND has only originalTextHash).
For RECOVERY_BARRIER, metadata is its complete technical body. Stub never has raw
words/fields/media/key/token. Save validates phase/body/key immutability against
prior memory/storage, writes stub first, then ciphertext, and returns only once
both succeed. A crash between writes leaves a conservative recovery barrier.

Known receipt remains in memory if encrypted persistence fails, and fresh actions
stay blocked. load returns a valid stub without packet on rotation/corrupt/missing
ciphertext; it cannot release an UNKNOWN operation. Unrelated actor/binding entries
are never loaded/decrypted/removed. clear(true) drops cipher/plaintext/key while
retaining an unresolved stub; clear(false) is allowed only after explicit known
receipt reconciliation or confirmed recovery barrier. Parent logout/denial invokes
clear(true), preserving an unknown barrier without exposing protected words.

clear(false) is the explicit trusted UI reconciliation boundary, not an automatic
phase inference by storage. The caller must already have a confirmed receipt and
current authorized read, or a confirmed barrier plus current read. Storage load/save
never invokes it merely on UNKNOWN/CONFLICT/absence. Mounted browser witnesses must
prove these caller preconditions; deleting browser storage itself grants no server
authority and cannot replace native expected-revision/UUID checks.

The one allowed body/key handoff is explicit COMMAND→RECOVERY_BARRIER: new barrier
body must target exactly the prior original stub's metadata/UUID/digest in the same
actor/binding, with a different own UUID. Save this validated barrier packet/stub
before its POST without first clear(false). Its technical body retains the original
target. Other replacement UUID/body changes remain forbidden; an UNKNOWN barrier
must retain/retry its own exact body. Known original receipt cannot be downgraded.

One explicit reviewed barrier→barrier handoff is permitted after confirmed
STALE_VERSION and a successful current authorized read: same exact original target,
same actor/binding, fresh own UUID, and at least one native expected Agent/Campaign/
Planning/Selection epoch strictly greater than the prior barrier's expected epoch,
with none regressing. It invalidates a late old barrier through the existing CAS.
Persist the new frozen barrier before POST; never silently clear an UNKNOWN packet.
No handoff after a known successful barrier receipt. Root browser witnesses must
prove the stale response/current-read preconditions; metadata alone is not authority.

RECOVERY_BARRIER stubs additionally retain originalBody: the exact technical-only
JSON string, validated against metadata/digest. This preserves exact POST bytes
after cipher loss, including harmless JSON property order/whitespace. COMMAND
stubs never contain originalBody because APPEND may include private words. A
barrier packet restored from stub uses this saved body, not JSON.stringify metadata.

Every stub also carries bodyHash: lowerSHA256 over exact original UTF8 body bytes
(not canonical JSON). This pins harmless formatting as well as words across lost
ciphertext. Re-entered/reconstructed COMMAND packet may reuse the old key only if
both canonical commandHash and exact bodyHash match; otherwise keep recovery locked
or use the explicit barrier. Neither hash is a raw customer word/key/token.

Before UI activation, independent storage witnesses use real WebCrypto with a
bounded in-memory Storage test seam: no raw words/key/body persistence, exact
reload and phase progression, tampering/rotation/failure stubs, save-before-send,
denial-before-JSON and actor/binding isolation. This seam is not live browser proof.
