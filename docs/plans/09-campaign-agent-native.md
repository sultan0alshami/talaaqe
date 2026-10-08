# Native campaign interview — implementation freeze

Prerequisites: reviewed M03 scoped planning, the strict D067 pure interview
contracts and independently authored failures. This is the durable manual
interview/confirmation foundation. Genuine AI/media/voice remains required next.
Root owns schema/contracts/native orchestration and routes; assigned authors
write bounded native witnesses before implementation. No provider is invoked.

## Native records and ownership

Four additive records, all exact campaign/workspace-bound:

- CampaignAgent: immutable ID/campaign/workspace/creation, one per campaign;
  positive sequential revision and current strict CampaignAgentState JSON/hash.
  Composite FK to the exact CampaignPlanningBinding. A read cannot upsert it.
- CampaignAgentTextSource: immutable ID/agent/campaign/workspace/author/time,
  complete CustomerTextSource JSON/hash. At most64 sources per agent; original
  words/language persist unchanged. Exact actor/binding/capture comes from server.
- CampaignAgentConfirmationBatch: immutable ID/agent/campaign/workspace/actor/time,
  complete30 FieldConfirmation records, shared exact batch/binding/snapshot and
  complete values. Whole batch max262144 compactUTF8 bytes, independently of the
  per-record64KiB bound. Keep all historical batches; never overwrite/rebase them.
- CampaignAgentCommand: immutable actor/UUID/payloadHash/agent/campaign/workspace/
  action and minimal scalar result. Restrictive Agent/User references retain the
  aggregate identity. Source/batch/brief IDs inside result JSON are runtime-checked
  references, not relational retention guarantees.
  GENERATE_PROFILE receipt pins the exact batch and created brief/version.

Storage constraints enforce exact native binding, bounds, identities, sequential
state revision and immutable records. Pure/runtime checks recompute canonical
hashes and validate JSON semantics; SQL labels do not prove customer action.
No production delete endpoint or global fixture bypass. Tests clean only their
exact owned records before existing M03/native fixture cleanup.

## Commands and private reads

Reuse PlanningScope. CLIENT commands carry the existing same-client plan authority;
OWN commands reject it. Every command additionally proves current view permission
within the same already-locked native grant/delegation boundary before reading
private fields/source content. Owner view/plan remains exact actual Brand owner.
No agency privilege approves a brief or signs customer/creator commercial terms.

Strict commands carry UUID, scope/campaign, expectedAgentRevision and the complete
displayed AgentSnapshot, plus action-specific choices. The browser may echo exact
expected field/selection/source pins; it cannot mint authoritative workspace,
author, confirmer, timestamp, source/confirmation/state hashes or provider readiness:

- INITIALIZE: expected agent revision0 and independent input/output preferences.
- SET_PREFERENCES: same independent choices; no microphone/provider activation.
- APPEND_TEXT: original customer text; server-mint source identity/capture/hash.
- CONFIRM_FIELDS: exactly30 ordered field/value hashes and field-choice/text-source
  selections. Match every displayed value to current canonical saved fields,
  resolve exact retained source ID/hash/binding, mint all confirmations atomically.
- GENERATE_PROFILE: exact retained batch ID; resolve all30 full confirmations and
  source records again, requiring complete current fields/selection/snapshot.

Text references need current same-scope access and original retained capture
lineage; they need not have the same author as the confirmer. They never prove
entailment. No silent extraction/field overwrite occurs in this manual phase.
Field editing reuses current M03 commands and invalidates previous agent coverage.

GET state uses current view authority and returns retained state plus explicit
current snapshot and coverage UNCONFIRMED/CURRENT/STALE. It does not rewrite
historical REVIEWED_SET, advance revisions or fetch private unrelated contexts.
Text pages return at most20 exact source rows and262144 wholeDTO bytes, with an
exclusive source-ID cursor when count/bytes would overflow. Never truncate words.

## Same-transaction execution and generation

Use beginPlanningCall → capturePlanningScope → withPlanningScope callbacks. Native
User/session/organization/client/grant/Brand/workspace/context/campaign/planning/
selection locks remain first; agent/state/source/batch/journal locks follow. No
nested public-service transaction, provider call, late User lock or mocked session.
Current/final real-clock native authorization and bounded Serializable retries
remain inside this shared transaction, including exact receipt replay.

Current authority/resource binding precedes historical replay. Exact UUID/hash
replay returns immutable scalar history without another source/batch/brief/audit/
event or old-revision checks; conflicting content fails409. Fresh work compares
all displayed revisions/selection/field hash and the agent revision after waits.
Source/record/context substitution fails closed, never a current-text fallback.

CONFIRM_FIELDS and GENERATE_PROFILE require selected context access/content hash
and nonarchived status via loadSelectedPlanningContext with allowArchived=false.
Generation calls the existing tx-only generateCampaignBriefCore with
allowLatestReuse:false, records exact CampaignBriefProvenance, advances current
M03 planning revision once and creates a new unapproved full profile. Owner
SUBMIT/APPROVE remains existing separate work; accepted agreements stay unchanged.

Generation advances Campaign/Planning epochs. Its confirmed batch is thereafter
historical, retained through the generation receipt. Current coverage becomes
STALE/UNCONFIRMED; never silently move old confirmations to the new snapshot.
Returned history and actual created profile are distinct from current readiness.
Audit/outbox contain scalar action/binding/version only, no words or source bytes.

## Required independently authored native witnesses

1. OWN initialization/preferences/original text/reload/complete explicit batch,
   newly generated unapproved full30field profile and exact selected provenance;
   partial/default/forged source/oversized batch failures and no automatic approval.
2. OWN and two CLIENT workspaces for one Brand remain isolated; plan-only cannot
   read or confirm interview fields, current view+plan required, revoked grants/
   changed actual owner deny before private hydration. Owner approval is separate.
3. Exact/conflicting replay, one batch winner among two commands sharing an expected
   agent revision (same UUID instead replays without a second batch), field/selection ABA,
   stale/corrupt/missing source/batch, real native waits and session expiry during
   journal insertion roll back every effect. Source paging preserves exact words
   and truthful count/byte cursors. Fixtures prove mechanics, not live AI/voice.

Root runs guarded tests, migrations/client and all four gates; independent review
precedes activation. Then transport/retained Talaqee UI get their own actual browser
failure witnesses at Arabic360 RTL/English desktop, recovery/denial/keyboard states.

## Exact interfaces for independent native witnesses

`executeCampaignAgentCommand(actor, input, options)` uses OrganizationActor and
OrganizationOptions plus required trusted `channel:FORM|AGENT_TOOL`, with optional
test-only business `now`. Every present command requires channel FORM; native
session authorization precedes command/channel validation. API adapters supply
this outside the body. Model tools cannot confirm by asserting a body channel.
Authentication always uses the real clock. Capture record dates/asOf after locks
and waits using actual time, or an explicitly injected fixed test business time.

Command common: `{operationKey:UUID,scope:PlanningScope,campaignId:Id,
expectedAgentRevision:number,expectedSnapshot:AgentSnapshot}`. OWN has no
expectedAuthority; CLIENT requires existing strict ClientAuthority with capability
plan and the exact client ID. INITIALIZE requires revision0, all others positive.
Action payloads:

```text
INITIALIZE / SET_PREFERENCES: {preferences:{input,output}}
APPEND_TEXT: {originalText:{text,language}}
CONFIRM_FIELDS: {fields:[{field,valueHash,source}, ... exactly30 central order]}
  source is CUSTOMER_FIELD_CHOICE{capturedValueHash} or
  CUSTOMER_TEXT{references:[{id,sourceHash}, ...1..4 unique ascending IDs]}
GENERATE_PROFILE: {confirmationBatchId:Id}
```

The command is strict plain JSON, max65536 bytes. Server reads actual current
canonical values and mints full confirmations; command fields contain no value.
SET_PREFERENCES preserves coverage only if current snapshot/source/context pins
remain valid; otherwise copies current fields/snapshot as UNCONFIRMED. APPEND_TEXT
always copies current fields/snapshot as UNCONFIRMED. Old batch rows remain intact.
CONFIRM_FIELDS copies current full fields/snapshot with the new reviewed batch.
GENERATE_PROFILE creates the brief, advances M03 Campaign/Planning once, then
saves current new fields/snapshot as UNCONFIRMED while retaining its used batch.
Agent revision advances exactly once per successful command; replay never advances.

Scalar receipt/result: `{agentId,campaignId,workspaceId,action,agentRevision,
campaignRevision,planningRevision,sourceId:null|Id,confirmationBatchId:null|Id,
briefId:null|Id,briefVersion:null|Revision}` plus `replayed` only in result.
APPEND_TEXT alone returns sourceId; CONFIRM_FIELDS and GENERATE_PROFILE return
batchId; GENERATE_PROFILE alone returns the exact created brief/version pair.
Other commands leave Campaign/Planning revisions unchanged. Store only this scalar
receipt; current authorized reads establish displayed state separately.

`getCampaignAgent(actor,{scope,campaignId},options)` returns
`{asOf,binding,current:{snapshot,fields},retained:CampaignAgentState|null,
coverage:NOT_INITIALIZED|UNCONFIRMED|CURRENT|STALE}`. Absence is null/NOT_INITIALIZED
without writes. CURRENT is exact current reviewed field coverage, not provider,
context/legal readiness or owner approval. Any missing/corrupt persisted source/
batch fails503 rather than claiming CURRENT. Ordinary M03 changes expose STALE,
never mutate/rebase the retained state on GET.

`getCampaignAgentTextSources(actor,{scope,campaignId,after?},options)` returns
`{asOf,binding,agentId,sources:CustomerTextSource[],nextCursor:Id|null}`. No caller
page size. Fixed20/262144-byte bounds; after must name an existing same-agent
source, never a different workspace's cursor. Missing initialized agent returns
AGENT_REQUIRED409. Every read requires current view; commands require view+plan
under actual locked grant and accepted delegation before private hydration.

Errors: native401/role403 or scopedNOT_FOUND404; VALIDATION422 for malformed values
or hashes; STALE_VERSION409 for agent/snapshot mismatch; AGENT_REQUIRED409;
MISSING_REQUIREMENTS422; CONFIRMATION_REQUIRED409; STALE_CONFIRMATION409;
TEXT_SOURCE_LIMIT429; INVALID_STORED_AGENT503 for corrupt/missing retained lineage;
SNAPSHOT_TOO_LARGE422 for wrapped brief overflow. Current native conflicts retain
existing bounded retry/RETRY_REQUIRED503 behavior. No body-supplied business clock.

Exact scalar tables (`content` and `state` are JSONB):

```text
CampaignAgent:
 id PK, campaignId UNIQUE, workspaceId, revision, state, stateHash, createdAt, updatedAt
 UNIQUE(id,campaignId,workspaceId), FK(campaignId,workspaceId)→PlanningBinding RESTRICT
CampaignAgentTextSource:
 id PK, agentId, campaignId, workspaceId, authorUserId, content, sourceHash, createdAt
 FK(agentId,campaignId,workspaceId)→Agent fulltuple RESTRICT; FK authorUserId→User
CampaignAgentConfirmationBatch:
 id PK, agentId, campaignId, workspaceId, confirmedByUserId, content, contentHash, confirmedAt
 FK(agentId,campaignId,workspaceId)→Agent fulltuple RESTRICT; FK confirmedByUserId→User
CampaignAgentCommand:
 id PK, actorUserId, operationKey UUID, agentId, campaignId, workspaceId, action,
 payloadHash, result, createdAt; UNIQUE(actorUserId,operationKey)
 FK(agentId,campaignId,workspaceId)→Agent fulltuple RESTRICT; FK actorUserId→User
```

All IDs/hash/revisions/UTC use central bounds. Agent state id/revision/binding/
stateHash/updatedAt bind scalar columns. Source content/scalars bind own id/binding/
author/hash/time. Batch content envelope is
`{schemaVersion:1,id,agentId,binding,reviewedSnapshot,confirmedByUserId,confirmedAt,
confirmations:[30 full FieldConfirmation],contentHash}`. All records match exact
batch/binding/snapshot/actor/time, central key order and distinct IDs. Hash input
is `{domain:infame-campaign-confirmation-batch-v1,...envelopeExceptContentHash}`.
Entire envelope is bounded262144 before hashing; no fabricated oversized fixture
is needed when narrower central/cardinality bounds make the limit unreachable.

Source/Batch/Command UPDATE reject; Agent identity/creation immutable, sequential
revision and nondecreasing date. Source/batch references inside JSON are resolved
natively every generation, not treated as FK/trust merely by string similarity.
Command source/batch/brief JSON pins are likewise resolved and checked on replay;
missing/corrupt history fails503 without rewriting the immutable receipt. There is
no app deletion route; task-owned deletion witnesses exercise these fail-closed
paths without claiming a relational FK that the declared four records do not have.
Task cleanup deletes only owned Command→Batch→Source→Agent before existing M03
cleanup; no production delete API or trigger bypass. Generated brief must validate
CampaignPlanningSnapshotSchema (65536 bytes) before receipt/provenance commit;
overflow rolls back brief/revisions/audit/events while retaining prior text/batch.
