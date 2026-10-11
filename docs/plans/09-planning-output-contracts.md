# Planning output and fingerprint contracts

Coordinator preparation, 2026-10-11. Root owns schemas/tests/migrations,
native composition and activation. No provider/model/cost readiness is declared.
Authority: docs/plans/09-planning-execution-storage.md, 09-planning-admission.md,
09-campaign-agent.md, managed plan09 and the existing central contracts.

## Shared strict rules and proposed structural ceilings

Use OrganizationIdSchema (id), OrganizationRevisionSchema (rev), native UTC
instants, 64-lowercase-hex hashes, AgentBindingSchema, AgentSnapshotSchema,
ClientAuthoritySchema, OriginalTextSchema and all 30 CampaignFieldObjectSchema
field/value members. Complete fields use CampaignFieldsSchema cross-field checks.
Every object is strict; reject unknown keys and unsafe/nonfinite/undefined JSON
with checkedJson before parsing/hashing. Preserve text, whitespace and declared
BCP47 language including explicit null; never infer it from UI language or currency.
Text(N) = OriginalTextSchema with nonblank, control-safe text of at most N chars;
do not transform/trim text. Short=200, note=2000, narrative=20000 chars.
Unique field lists: 0..30 central keys. Questions/hypotheses: 0..30 Text(500).
SourceRef={id,sourceHash}; arrays are unique by id and strictly id-ordered.
Proposed caps: fingerprint 64KiB; each ordinary provider body 64KiB; refinement
provider body 256KiB; enriched retained envelope 512KiB compact UTF8 JSON.
These are reviewable storage/transport ceilings, not proven useful output amounts.

## Exact scopeFingerprint v1

Strict object: {schemaVersion:1,binding:AgentBindingSchema,brandId:id,
organizationId:id|null,clientId:id|null,actor:{userId:id,role:'BRAND',
sessionVersion:AiActorSchema.sessionVersion},brandOwner:{userId:id,
sessionVersion:AiActorSchema.sessionVersion},authority:null|{
view:ClientAuthoritySchema(capability='view'),
plan:ClientAuthoritySchema(capability='plan')},
pool:{id,scope:'OWN_BRAND'|'CLIENT',brandId:id|null,organizationId:id|null},enrollment:{id,revision:rev,subscriberUserId:id},
seat:{id,userId:id,revision:rev,membershipId:id|null},
cycle:{id,startsAt:UTC,endsAt:UTC,planId,policyVersion,priceVersion:null|opaqueId},
sessionId:id,operation:{id,kind:PlanningAiOperationKindSchema,ordinal:1..10,
selectedArtifacts:ArtifactRef[0..3]},
agent:{id,revision:rev,stateHash:hash},snapshot:AgentSnapshotSchema,
context:null|{contextId:id,versionId:id,version:rev,versionInputRevision:rev,
contentHash:hash,submissionId:id},
sources:SourceRef[0..64],confirmation:null|{batchId:id,batchHash:hash,
reviewedSnapshot:AgentSnapshotSchema,fields:ConfirmationPin[exactly30]}}.
ConfirmationPin={field:central literal,id,valueHash:hash,confirmationHash:hash};
pins follow central field order, with distinct IDs; resolve actual existing
FieldConfirmationSchema/batch/source records, never provider confirmations.
OWN requires null client/organization/authority and exact actor/Brand-owner/seat;
CLIENT requires same organization/client/Brand/membership/grant identities and
revisions across view+plan; only capability differs. Seat user equals actor.
Binding, workspace, campaign, pool subject, session and operation must join exactly.
Context is null iff selection NONE; otherwise version/hash equals snapshot selection.
versionInputRevision comes from the immutable approved Version/Submission.
Current unapproved parent draft revisions are excluded: existing approved sources
survive parent edits. Archive eligibility remains action-specific native checking,
not a draft-revision equality rule. Selection revision still detects A→B→A.
BRIEF requires actual CURRENT complete confirmation covering this exact snapshot.
COMBINED_REFINEMENT with a BRIEF target requires the same complete confirmation.
Only refinement has selectedArtifacts (1..3); other operations carry an empty
array. ArtifactRef kinds follow canonical BRIEF,STRATEGY,IDEAS_PACK order.
Fingerprint contains no raw source words, tokens, AuthSession id or URLs.
The integration must review the existing narrower ledger Actor grammar against
native User IDs. Never truncate/alias an actor; a compatibility change needs its
own native session/historical-hash regression before broad actors may dispatch.
Do not pin mutable held/consumed/success counts or cycle/session counter revisions:
sibling successes must not create a false input conflict. Authority/source/agent
epoch changes still reject, even if values return to identical hashes (ABA).
Pool revision is excluded: Cycle INSERT advances that serialization epoch even
for an unrelated future period. Pin immutable subject and check actual current
ACTIVE eligibility natively; do not treat that counter as an authority epoch.
scopeFingerprintHash=canonicalHash({domain:'infame-planning-scope-v1',...fingerprint});
this is a new hash domain only, not a change to any historical hash.

PlanningAiRequestSchema is exactly {schemaVersion:1,operationKey:UUID,sessionId:id,
kind:PlanningAiOperationKindSchema,ordinal:1..10,expectedFingerprintHash:hash,
sourceMessage:SourceRef|null,requestedLanguage:OriginalTextSchema.language,
selectedArtifacts:ArtifactRef[0..3]}. REPLY and COMBINED_REFINEMENT require an
exact sourceMessage; artifact buttons may use null. Refinement targets are1..3,
other target arrays empty; artifact ordinals are1. No transcript is copied into
this command. requestHash=canonicalHash({domain:'infame-planning-request-v1',
actorUserId,request:strictParsedRequest}); native actor is separate from the body.
This does not replace the ledgerRequestHash of ReserveAiSchema.
planningRequestForFingerprintSchema(fingerprint) checks declared session/kind/
ordinal/expected fingerprint hash, exact targets and sourceMessage ID/hash
membership. It captures a copied strict fingerprint. Passing this pure check
does not authorize a request or prove that its referenced native sources exist.

## Source proposals and assistance are different strict types

ExtractedFieldProposal is a 30-member field-discriminated union:
{kind:'SOURCE_PROPOSAL',field:literal,value:CampaignFieldObjectSchema.shape[field],
source:{kind:'CUSTOMER_TEXT',references:SourceRef[1..4]}}. Value uses the central
parsed output (including deliverable merging); references resolve exact authorized
native sources in the fingerprint. Hash equality does not prove entailment.
Server enriches with binding/snapshot, PROVIDER authorship and existing
infame-campaign-field-value-v1 valueHash; never creates FieldConfirmation.
Recommendation={kind:'UNVERIFIED_RECOMMENDATION',title:Text(200),body:Text(2000),
relatedFields:unique central keys[0..30]}. Hypotheses are labelled suggestions,
not known facts, measurements, legal proof or promises. No verification flags.
Proposals[0..30] have distinct fields; recommendations[0..20]. Explicit customer
application/review and the existing 30-field confirmation remain separate commands.

## Five operation bodies; all provider text retains its own authorship

REPLY wire={kind:'REPLY',reply:Text(20000),proposals:ExtractedFieldProposal[0..30],
recommendations:Recommendation[0..20],openQuestions:Text(500)[0..30]}. Server
derives missing fields from actual canonical fields; no model completeness flag.
A successful reply is one user submission plus validated attached assistant reply.

BRIEF wire={kind:'BRIEF',narrative:{overview:Text(20000),
requirementsExplanation:Text(20000),hypotheses:Text(500)[0..30],
openQuestions:Text(500)[0..30]}}. The model cannot emit customerFields,
confirmation/approval, money mutations or legal assertions. Server enriches the
ATTACHED BRIEF with the locked complete current CampaignFieldsSchema snapshot,
fieldsHash, actual confirmationBatchId/hash and source/selection provenance.
Canonical fields equal the confirmed customer values exactly; never model rewrites.
This assisted artifact does not mutate or approve native CampaignBrief/profile.
STRATEGY wire={kind:'STRATEGY',summary:Text(20000),audienceApproach:Text(5000),
channelApproach:Text(5000),measurementApproach:Text(5000),
recommendations:Recommendation[1..20],hypotheses:Text(500)[0..30],
openQuestions:Text(500)[0..30]}. Audience/channel/measurement text is assistance;
actual campaign fields, observed KPIs and unknowns remain separately authoritative.
IDEAS_PACK wire={kind:'IDEAS_PACK',ideas:Idea[1..20],hypotheses:Text(500)[0..30],
openQuestions:Text(500)[0..30]}; Idea={ordinal:1..20,title:Text(200),
concept:Text(5000),executionNotes:Text(2000),relatedFields:unique keys[0..30]}.
Ordinals are consecutive and unique. Ideas imply no booked creator, verified
forecast, imported observation, delivery or permission to publish.
COMBINED_REFINEMENT request binds selected ArtifactRef[1..3] in canonical kind
order BRIEF,STRATEGY,IDEAS_PACK; each kind/id appears once, with exact contentHash.
Targets are actual ATTACHED artifacts in this same session/scope; feedback is
source-bound original customer text, not an unexplained provider instruction.
ArtifactRef is exactly {id,kind:'BRIEF'|'STRATEGY'|'IDEAS_PACK',contentHash}.
Wire={kind:'COMBINED_REFINEMENT',changes:RefinedArtifact[1..3]}; each item
is exactly {base:ArtifactRef,revised:matching BRIEF/STRATEGY/IDEAS_PACK wire}.
Returned target set equals the requested set, with no additions/omissions.
Each revised ordinary body retains its64KiB ceiling inside the256KiB combined
provider body. Enrichment cannot bypass those individual body bounds.
BRIEF changes revise narrative only; any enriched customer fields are server-owned
current complete confirmed fields. Retain original artifacts immutably and store
one combined overlay/result; one refinement slot, never one slot per target.

PlanningBriefContentSchema is exactly {kind:'BRIEF',narrative,customerFields,
fieldsHash,confirmationBatchId,confirmationBatchHash,binding,snapshot,sources}.
The central fields hash must equal both snapshot.fieldsHash and canonicalHash
of {domain:'infame-campaign-fields-v1',fields:customerFields}. All thirty values
are complete central validated customer fields, never a provider wire member.
Pure factories planningRefinementForTargetsSchema(targets,fingerprint) and
planningBriefContentForFingerprintSchema(fingerprint) compare declared requested
sets and confirmation/value/source pins. Captured inputs are copied and strictly
validated; no caller mutation changes a previously constructed validator. These
factories prove structural equality only, never native authority, truth,
entailment, provider authorship or an actual customer confirmation. The native
service must resolve those immutable records under current locks independently.
planningProviderWireForFingerprintSchema(fingerprint) additionally requires the
exact requested kind, authorized declared source ID/hash membership, and the
fingerprint's selected refinement targets/confirmation requirement.

PlanningRetainedContentSchema is exactly {schemaVersion:1,attemptId,operationId,
sessionId,binding,snapshot,scopeFingerprintHash,provider:{id:'ANTHROPIC',modelId,
registryVersion,requestId:id|null},output}. output is the matching ordinary wire,
server-enriched PlanningBriefContent, or {kind:'COMBINED_REFINEMENT',changes:
[{base:ArtifactRef,revised:matching wire or enriched BRIEF}]}. All IDs are native
bounded identifiers. A contextual retained-content validator binds these declared
pins to the exact fingerprint; provider labels never prove genuine invocation.
planningRetainedContentForFingerprintSchema(fingerprint) binds operation,
planning-session, binding, snapshot and fingerprint-hash pins. Actual attempt
and provider/request/model/registry identity require separate trusted expected
metadata or native resolution; those identities are not in the fingerprint.
## Enrichment, accounting and immutable execution identity

Provider wire may only echo server-supplied source/artifact ID/hash references.
It cannot mint envelope/attempt/result/actor IDs, timestamps, registry/pricing,
success/verification/approval or scope authority. Server adds actual attempt/
operation/session/binding/fingerprint, model/request identity and contentHash.
Keep logical requestHash distinct from ledgerRequestHash of full parsed ReserveAiSchema.
pricingHash=existing canonicalHash(pricing), without a new domain prefix.
Context is {resourceType:'JOB',resourceId:generated attempt UUID,
sourceRevision:captured agentRevision}; REPLY -> CAMPAIGN_CHAT; BRIEF -> BRIEF;
STRATEGY/IDEAS_PACK/COMBINED_REFINEMENT -> CONTENT_THEME, per execution freeze.
Native comparisons bind reservation actor/key/purpose/payload/request/pricing/context;
preserve ledger metadata 8KiB, historical hashes, claim token and terminal costs.

## Disposition and failure evidence

ATTACHED alone stores validated content and succeeds. DENIED/STALE/INVALID retain
only outputHash, safe closed reason and attempt/accounting pointers; content and
contentHash are null. No raw rejected body, prompt, exception text or transcript.
DENIED reasons: AUTH_UNAVAILABLE, SCOPE_UNAVAILABLE, SEAT_INELIGIBLE,
ENTITLEMENT_INACTIVE, CYCLE_EXPIRED. STALE: AUTHORITY_CHANGED, SNAPSHOT_CHANGED,
AGENT_CHANGED, SOURCE_CHANGED, CONFIRMATION_CHANGED, ARTIFACT_BASE_CHANGED.
INVALID: MALFORMED_OUTPUT, OUTPUT_TOO_LARGE, WRONG_KIND, INVALID_FIELD_VALUE,
SOURCE_REFERENCE_MISMATCH, INVALID_ARTIFACT_SET, INVALID_LANGUAGE, REFUSAL,
TRUNCATED_OUTPUT, PAUSED_OUTPUT. Incomplete transport remains UNKNOWN, not invalid success.
FAILED_KNOWN evidence is server-only {executionBasis,reference,evidenceHash,
resolvedAt,reservationId,billingBasis}; reference is opaque, not raw provider data.
executionBasis: TRUSTED_PRE_CALL_STOP | PROVIDER_CONFIRMED_NO_CALL |
PROVIDER_TERMINAL_RESPONSE | REVIEWED_EXECUTION_RESOLUTION. Independently bind
billingBasis to actual RELEASED/noCallReason or SETTLED/settlementHash/actualMicros.
Receipt/request ID or SETTLED alone proves no terminal execution. If a final
rejection Result exists, use RESULT_RECORDED with its disposition, not FAILED_KNOWN.
Attempt starts RUNNING/revision1; RUNNING -> UNKNOWN/FAILED_KNOWN/RESULT_RECORDED;
UNKNOWN -> either terminal only after actual execution+billing evidence. No reissue.
Every update advances revision exactly1 and nonregressing time; identity stays fixed.
Session HELD -> CONSUMED and Operation OPEN -> SUCCEEDED only with same-aggregate
ATTACHED result at coherent COMMIT; failures preserve inclusions, sibling UNKNOWN holds.

## Genuinely unresolved before activation

Trial duration/start and completion grace; finishing consumed-session inclusions
after expiry; privacy-approved transient valid-response retention; precise artifact
content/ceilings adequate for genuine Arabic quality/cost. No defaults or claims here.
