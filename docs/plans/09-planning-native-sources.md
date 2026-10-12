# S2 campaign-agent source hydration in the genuine planning frame

Root implementation freeze 2026-10-11. Prerequisites: bf894fa current saved gates,
d0bde86 S0/S1a/S1b native proofs and existing manual campaign-agent contracts.
Root owns adoption/docs/runs. Product scope new src/lib/campaign-agent/planning-source.ts
(or small private validation extraction after review; legacy wrappers unchanged).
No schema, entitlements, reservation, provider, route, UI, publication or voice.

Fixed internal frozen bag campaignAgentPlanningInternals:
bindSourcesInFrame(frame:AiPlanningNativeFrame,scopeProof:PlanningBoundScopeProof,
 input:{campaignId:string,sourceReferences:{id:string,sourceHash:string}[]})
 ->Promise<CampaignAgentPlanningProof>.
readSourcesProof(frame,proof)->Promise<CampaignAgentPlanningMaterial>.
recheckSourcesProof(frame,proof)->Promise<void>.
Opaque empty proof; private WeakMap exact active frame/checked transaction/scope
proof/actor; copies/cross-frame/closed deny. No mint/bypass/rawTx/reader/options.
Invalid/copied/cross S2 proof: CampaignAgentError SCOPE_PROOF_UNAVAILABLE503;
S0 frame/auth and S1b scope failures retain their original class/code/status.
Input copied/strict plain bounded before first await; invalid input deferred until
S0 native authorization and genuine S1b proof reads. Source refs 0..64, unique,
ascending id; no caller text/hash-only authority or inferred source fallback.

Material is deep-frozen plain JSON {binding,current:{snapshot,fields},
 agent:{id,revision,stateHash},preferences,coverage:'UNCONFIRMED'|'CURRENT'|'STALE',
 sources:CustomerTextSource[],confirmation:CampaignAgentBatch|null,
 context:ApprovedBrandContextVersion|null}. No AuthSession, tokens, models/clients,
conversation/narrative/proposals, unrequested User/profile name/contact/private evidence, capabilities or
 provenance assertions. Only requested original text sources in exposed sources;
complete actual CURRENT confirmation batch exposed, stale historical review null.
Approved nameOriginal/context content and original customer words stay unchanged;
the column exclusion never strips names from authorized original business text.
Complete fields and explicit confirmation remain independent owner approval.

S1b already holds Workspace/Context/Campaign/Binding/State/Selection/Version/
Submission and covered Users/AuthSession. Require selected campaign exact membership,
workspace/Brand identity and supported nonterminal DRAFT..IN_DEALS status.
Read only Campaign id/brandId/revision/input fieldsRevision/fields using native
JSON projection or strict narrow input select, never whole conversation/title/
proposals/narrative. Validate declared schema1 fieldsRevision <= Campaign revision,
central fields and construct exact AgentSnapshot from current selected state.
Agent thin exact campaign/workspace lookup pins id/revision/stateHash/createdAt/
updatedAt before FOR UPDATE original id, then reload private state. Changed thin
identity/epoch after waiting ->RETRY_REQUIRED503; never lock a replacement Agent.
Missing ->AGENT_REQUIRED409; malformed scalar/state/hash/binding
->INVALID_STORED_AGENT503. No initialization/rebase or revision write.

Resolve every retained state source pin plus all retained reviewed-batch source
references under exact same agent/campaign/workspace; their closure <=64 actual
records. Immutable source id/hash/author/date/full-schema check; every referenced
original binding matches exactly. Group SHARE locks by source-id JS order BEFORE
batch SHARE lock; reload after locks. Batch thin metadata/body split permits source
ref closure discovery under the already locked Agent, then all source locks, then
exact Batch SHARE and reloaded content checks; no new User locks. Batch must match
30 distinct central order/value/hash/snapshot/actor/date and every scalar record.
Historical batch lineage resolves even when coverage STALE, but CURRENT additionally
equals actual current snapshot/full canonical fields. Hash equality never establishes
source entailment. Requested refs must match retained exact source refs; nonmember
or wrong hash ->VALIDATION422 without foreign source body query.

Selected context NONE ->null. Approved context uses actual already locked immutable
Version/Submission identity/input/hash/approval pins and original approved submission
name/content only; recompute canonical {nameOriginal,content}. Never parent draft
words/revision. Archived context blocks this new AI-source lane ARCHIVED409; legacy
read/generation semantics untouched. No files/bytes/remote URL fetching.

Final recheck selects only original held campaign fields/agent/source/batch/context
rows and original pins; no new locks, replacement discovery or body fallback. Source
or batch missing/corrupt ->503, changed snapshot/agent ->RETRY_REQUIRED503. Always
recheck genuine S1b scope and native actual-clock authorization as last scope step.
Lifetime/auth failures precede malformed input/proof failure. Tentative caller work
rolls back on denial; copied material grants no subsequent domain authority.

Independent test author owns tmp/planning-source-native.test.ts.draft, at most
three bounded groups before product: actual OWN/CLIENT native sources/complete
confirmed fields and approved original context + frozen private projections;
foreign/missing/corrupt source/batch and fake/copied/cross/closed proofs + no foreign
body reads; real Agent/Source/Batch lock waits, scope/agent/source changes/actual
lease expiry and final same-tx mutation rollback. Preserve genuine producers,
native sessions and immutable records; no trigger bypass/mock auth/provider claims.
Root alone DB/tests/build/E2E. Independent source and staged review, compatibility
tests and all four gates before commit. Preserve source/history/others/OpenAI off.
