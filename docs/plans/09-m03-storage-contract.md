# M03 storage and native-test freeze

Prerequisite88affac; full customer flow is09-m03-brand-context. Root owns schema,
additive migration, contract exports and deployment. receipt_tests owns ignored
schema draft then tests/brand-context/schema.test.ts; scout reviews migration
read-only before root deployment. Three native cases precede consequential DDL.
Keep all15 inherited migrations/data; no reset or source checkout mutation.

## Exact records

All IDs are TEXT, UTC dates TIMESTAMP(3), counters INTEGER1..2147483646 and hashes
lowercase SHA25664hex. New identities/scope/createdAt are immutable. Parent updates
advance revision exactly one. Foreign keys below use RESTRICT for update/deletion.
No speculative old-record backfill or change to strict campaign JSON/owner journals.

| Table | Fields beyond id/createdAt | Constraint/binding |
| --- | --- | --- |
| PlanningWorkspace | scope OWN_BRAND/CLIENT, brandId, organizationId?, clientId? | OWN null org/client; CLIENT all present and composite exact OrganizationClient. Unique own Brand/CLIENT client, unique(id,brandId). Entire row immutable. |
| BrandContext | workspaceId, name, nameLanguage?, content JSONB, revision, inputRevision, archived, updatedAt | Unique(id,workspaceId); immutable workspace;1<=inputRevision<=revision. Name/content edit sets inputRevision=next revision; other updates preserve inputRevision. |
| BrandContextSubmission | contextId, workspaceId, inputRevision, name, nameLanguage?, content JSONB, contentHash, submittedByUserId, targetOwnerUserId, targetOwnerSessionVersion, clientRevision?, state PENDING/APPROVED/DECLINED, revision, decidedByUserId?, decidedAt? | Composite context/workspace FK; original submitted snapshot/targets immutable. OWN clientRevision null, CLIENT positive. Initial PENDING/null decision; one decision only, exact target actor, revision+1. No draft mutation can rewrite this snapshot. |
| BrandContextVersion | contextId, workspaceId, submissionId, version, inputRevision, contentHash, approvedByUserId, approvedAt | Composite exact submission/context/workspace FK; unique(submissionId), unique(contextId,version), unique(id,workspaceId,contentHash). Insert requires APPROVED submission, matching input/hash/decision actor/time. Entire row immutable; content/name read from immutable submission. |
| CampaignPlanningBinding | campaignId (primary key, no separate id), workspaceId, brandId | Composite Campaign(id,brandId) and Workspace(id,brandId) FKs; unique(campaignId,workspaceId). CLIENT insertion rejects pre-existing owner/matching journals, briefs/runs/decisions/deals; service additionally creates new CLIENT campaign+binding atomically. Entire row immutable. |
| CampaignContextSelection | campaignId, workspaceId, revision, contextVersionId?, contentHash? | Composite campaign/workspace FK; composite version/workspace/hash FK. Both optional fields null means explicit NONE; otherwise both present. Unique(campaignId,revision), unique(id,campaignId,workspaceId,revision). Insert revision exactly previous maximum+1, starting1. Entire row immutable. |
| CampaignPlanningState | campaignId (primary key), workspaceId, revision, selectionId, selectionRevision, narrative JSONB nullable, updatedAt | Composite campaign/workspace and exact selection/id/campaign/workspace/revision FKs. Selection can advance only one revision when changed; cannot move backward or reuse old selection. Narrative stores unprocessed original text/mode only. Exact next parent revision. |
| CampaignProposalDependency | campaignId, proposalId (composite primary key), workspaceId, fieldsRevision, selectionId, selectionRevision | Composite binding and selection FKs; insert requires actual matching proposal in schema1 Campaign.input and matching fieldsRevision. Entire row immutable. This is context-reuse provenance, never stored in legacy input. |
| CampaignBriefProvenance | briefId (primary key), campaignId, workspaceId, selectionId, selectionRevision | Composite brief/campaign and exact selection/campaign/workspace/revision FKs. Entire row immutable; absent old rows remain absent. |
| CampaignPlanningSubmission | campaignId, workspaceId, briefId, selectionId, selectionRevision, inputRevision, campaignRevision, content JSONB, contentHash, submittedByUserId, targetOwnerUserId, targetOwnerSessionVersion, clientRevision?, state, revision, decidedByUserId?, decidedAt? | Composite FK to exact CampaignBriefProvenance(briefId,campaignId,workspaceId,selectionId,selectionRevision), not independent same-campaign references. Exact immutable submitted review snapshot. Same pending/one-decision lifecycle and target rule as context submissions. |
| BrandContextCommand | actorUserId, operationKey, payloadHash, contextId, workspaceId, action, result JSONB | Unique(actorUserId,operationKey); exact context/workspace FK; immutable metadata-only receipt. |
| CampaignPlanningCommand | actorUserId, operationKey, payloadHash, campaignId, workspaceId, action, result JSONB | Unique(actorUserId,operationKey); exact campaign/workspace FK; immutable metadata-only receipt. |
| PlanningReviewCommand | actorUserId, operationKey, payloadHash, workspaceId, contextSubmissionId?, campaignSubmissionId?, action, result JSONB | Exactly one submission FK with same workspace; unique(actorUserId,operationKey); immutable metadata-only receipt. |

Add only supporting composite unique indexes to existing Campaign(id,brandId) and
CampaignBrief(id,campaignId). Add inverse Prisma relations without rewriting their
existing fields, JSON or migrations. Scope/workspace rows have no global role power.
Supporting referenced uniques: BrandContextSubmission(id,contextId,workspaceId)
and(id,workspaceId), CampaignPlanningSubmission(id,workspaceId), plus
CampaignBriefProvenance(briefId,campaignId,workspaceId,selectionId,selectionRevision).
One approved context submission produces at most one approved version.

## Native constraints and bounds

Context name1..200 nonblank; nullable language2..100; content object at most65536
UTF8 bytes. Snapshot names/content obey the same bounds. Counters remain positive
and bounded; decision state fields are mutually consistent. Actual immutable
snapshot hashes are computed/verified by canonical JS in services, not a different
Postgres JSON canonicalization. SQL checks hash shape and exact existing binding.

Selection sequence checks run under a native lock on its binding to serialize
insertions. State and provenance cannot attach another campaign's selection or
another workspace's approved version, including two CLIENTs sharing the same Brand.
Source/selection revisions protect ABA even when content/hash repeats. No insert
trigger grants application authority or impersonates the target owner.

Submission approval requires a nonarchived current context input revision for a
new context version. Campaign submission approval uses exact current campaign
fields/planning selection and actual owner review under application locks; archive
of an already pinned context does not invalidate this campaign review.

Receipt result JSON is an object with only:
contextId/campaignId/submissionId/versionId/proposalId/briefId/revision/inputRevision/
campaignRevision/planningRevision/selectionRevision/version/action/state/archived.
Keys may be omitted/null where irrelevant, but content/name/narrative/contact/
actor/session/authority/version snapshots are never receipts. Pure result schemas
will additionally type/bind action-specific values. SQL values must be scalar/null,
not nested objects/arrays, and the complete receipt is at most4096 UTF8 bytes.
Audit/events stay metadata only.

Schema constraints prove identity/history/data bounds, not current role/grant/session
authority; native services must prove that in the same transaction. Physical purge
is a separately reviewed privacy operation; normal API archive/decline retains
history and FKs prevent referenced versions from disappearing.

## Three independent native witnesses

1. Valid OWN and two CLIENT workspaces for one Brand; partial scope, substituted
client/org/Brand, foreign context-version selection and other-campaign provenance
reject. Explicit NONE is a real positive selection, not legacy absence.
2. Draft/input revision guards, exact immutable submission/approval lineage,
approved versions, selection/state ABA guards, proposal dependency, provenance,
receipt content exclusion/immutability and referenced-version retention.
3. Old strict schema1 Campaign.input/Brief.content and original owner-journal
triggers/hashes remain byte-identical; no old binding/provenance backfill. Additive
new snapshots cannot rewire retained direct-deal party/brief identity.

Author uses actual native users/Brand and guarded organization fixtures; no fake
Prisma producer establishes constraints. Root confirms native RED before DDL,
peer reviews it before migrate deploy/generate, then native/regression verification.
Storage acceptance is a prerequisite, never full M03 feature completion. Reference
asset purpose/transport has its own later freeze and acceptance before file controls.
