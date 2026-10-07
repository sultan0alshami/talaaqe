import { z } from "zod";
import { CampaignBriefContentSchema, CampaignDraftFieldsSchema, CampaignFieldObjectSchema, CampaignProposalSchema } from "@/lib/campaigns/contracts";
import { CampaignStatusSchema, ContentLanguageSchema, OriginalTextSchema, UtcDateTimeSchema } from "@/lib/contracts/vocabulary";
import { ClientAuthoritySchema, OrganizationIdSchema as id, OrganizationRevisionSchema as revision } from "@/lib/organizations/contracts";
import { ApprovedBrandContextVersionSchema, ClientPlanningScopeSchema, OwnPlanningScopeSchema, PlanningScopeSchema } from "@/lib/brand-context/contracts";

export const PLANNING_LIMITS = Object.freeze({ campaigns: 20, briefs: 20, reviews: 20, proposals: 50 });
export const CampaignPlanningSnapshotSchema = CampaignBriefContentSchema.refine(value =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength <= 65536, "Submitted brief exceeds64KiB compact JSON");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const PlanningContextChoiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("NONE") }).strict(),
  z.object({ kind: z.literal("APPROVED_CONTEXT"), versionId: id, contentHash: hash }).strict(),
]);
export const ManualNarrativeSchema = z.object({ schemaVersion: z.literal(1), mode: z.enum(["CHAT", "PARAGRAPH"]),
  processing: z.literal("UNPROCESSED"), originalText: OriginalTextSchema.extend({
    text: z.string().max(20000).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/),
  }).strict() }).strict();
export const PlanningSelectionSchema = z.object({ id, revision, kind: z.enum(["NONE", "APPROVED_CONTEXT"]),
  versionId: id.nullable(), contentHash: hash.nullable() }).strict().refine(value => value.kind === "NONE"
    ? value.versionId === null && value.contentHash === null : value.versionId !== null && value.contentHash !== null);
const expected = { campaignId: id, expectedCampaignRevision: revision, expectedPlanningRevision: revision,
  expectedSelectionId: id, expectedSelectionRevision: revision };
const actions = [
  { action: z.literal("CREATE"), expectedCampaignRevision: z.literal(0), expectedPlanningRevision: z.literal(0),
    expectedSelectionId: z.null(), expectedSelectionRevision: z.literal(0), payload: z.object({ fields: CampaignDraftFieldsSchema,
      selection: PlanningContextChoiceSchema, narrative: z.null() }).strict() },
  { ...expected, action: z.literal("UPDATE_FIELDS"), payload: z.object({ patch: CampaignDraftFieldsSchema }).strict() },
  { ...expected, action: z.literal("SET_SELECTION"), payload: z.object({ selection: PlanningContextChoiceSchema }).strict() },
  { ...expected, action: z.literal("SAVE_NARRATIVE"), payload: z.object({ narrative: ManualNarrativeSchema.nullable() }).strict() },
  { ...expected, action: z.literal("PROPOSE_FIELDS"), payload: CampaignProposalSchema },
  { ...expected, action: z.literal("PROPOSE_CONTEXT_TONE"), payload: z.object({}).strict() },
  { ...expected, action: z.literal("APPLY_PROPOSAL"), payload: z.object({ proposalId: id, toneDecision: z.enum(["KEEP", "REPLACE"]).nullable() }).strict() },
  { ...expected, action: z.literal("GENERATE_BRIEF"), payload: z.object({}).strict() },
  { ...expected, action: z.literal("SUBMIT_BRIEF"), payload: z.object({ briefId: id, expectedBriefVersion: revision }).strict() },
] as const;
const bind = { action: z.literal("BIND_OWN"), campaignId: id, expectedCampaignRevision: revision,
  expectedPlanningRevision: z.literal(0), expectedSelectionId: z.null(), expectedSelectionRevision: z.literal(0),
  payload: z.object({ selection: PlanningContextChoiceSchema }).strict() };
const own = { operationKey: z.uuid(), scope: OwnPlanningScopeSchema };
const planAuthority = ClientAuthoritySchema.extend({ capability: z.literal("plan") }).strict();
const client = { operationKey: z.uuid(), scope: ClientPlanningScopeSchema, expectedAuthority: planAuthority };
export const CampaignPlanningCommandSchema = z.union([
  z.discriminatedUnion("action", [
    z.object({ ...own, ...actions[0] }).strict(), z.object({ ...own, ...bind }).strict(),
    z.object({ ...own, ...actions[1] }).strict(), z.object({ ...own, ...actions[2] }).strict(),
    z.object({ ...own, ...actions[3] }).strict(), z.object({ ...own, ...actions[4] }).strict(),
    z.object({ ...own, ...actions[5] }).strict(), z.object({ ...own, ...actions[6] }).strict(),
    z.object({ ...own, ...actions[7] }).strict(), z.object({ ...own, ...actions[8] }).strict(),
  ]),
  z.discriminatedUnion("action", [
    z.object({ ...client, ...actions[0] }).strict(), z.object({ ...client, ...actions[1] }).strict(),
    z.object({ ...client, ...actions[2] }).strict(), z.object({ ...client, ...actions[3] }).strict(),
    z.object({ ...client, ...actions[4] }).strict(), z.object({ ...client, ...actions[5] }).strict(),
    z.object({ ...client, ...actions[6] }).strict(), z.object({ ...client, ...actions[7] }).strict(),
    z.object({ ...client, ...actions[8] }).strict(),
  ]).refine(value => value.scope.clientId === value.expectedAuthority.clientId),
]);
export type CampaignPlanningCommand = z.infer<typeof CampaignPlanningCommandSchema>;
export const CampaignPlanningActionSchema = z.enum(["CREATE", "BIND_OWN", "UPDATE_FIELDS", "SET_SELECTION", "SAVE_NARRATIVE",
  "PROPOSE_FIELDS", "PROPOSE_CONTEXT_TONE", "APPLY_PROPOSAL", "GENERATE_BRIEF", "SUBMIT_BRIEF"]);
export const CampaignPlanningReceiptSchema = z.object({ campaignId: id, action: CampaignPlanningActionSchema,
  campaignRevision: revision, planningRevision: revision, inputRevision: revision, selectionRevision: revision,
  proposalId: id.nullable(), briefId: id.nullable(), submissionId: id.nullable(), version: revision.nullable() }).strict()
  .refine(value => value.inputRevision <= value.campaignRevision)
  .refine(value => (value.briefId === null) === (value.version === null))
  .refine(value => (value.action === "SUBMIT_BRIEF") === (value.submissionId !== null))
  .refine(value => {
    if (["PROPOSE_FIELDS", "PROPOSE_CONTEXT_TONE", "APPLY_PROPOSAL"].includes(value.action) !== (value.proposalId !== null)) return false;
    if (value.action === "GENERATE_BRIEF" || value.action === "SUBMIT_BRIEF") return value.briefId !== null;
    // Material field changes can inherit genuine automatic regeneration.
    if (value.action === "UPDATE_FIELDS" || value.action === "APPLY_PROPOSAL") return true;
    return value.briefId === null;
  });
export const CampaignPlanningResultSchema = CampaignPlanningReceiptSchema.safeExtend({ replayed: z.boolean() }).strict();
export type CampaignPlanningResult = z.infer<typeof CampaignPlanningResultSchema>;
const viewAuthority = ClientAuthoritySchema.extend({ capability: z.literal("view") }).strict();
const ownRead = { scope: OwnPlanningScopeSchema, currentAuthority: z.null() };
const clientRead = { scope: ClientPlanningScopeSchema, currentAuthority: viewAuthority };
const clientBinding = z.object(clientRead);
function scoped<T extends z.ZodRawShape>(fields: T) { return z.union([
  z.object(fields).extend(ownRead).strict(), z.object(fields).extend(clientRead).strict().refine(value => {
    const binding = clientBinding.safeParse(value); return binding.success && binding.data.scope.clientId === binding.data.currentAuthority.clientId;
  }),
]); }
export const PlanningCampaignHeaderSchema = z.object({ id, title: z.string().max(200), status: CampaignStatusSchema,
  revision, planningRevision: revision, selectionRevision: revision, currentBriefVersion: revision.nullable(), updatedAt: UtcDateTimeSchema }).strict();
export const PlanningCampaignListQuerySchema = z.object({ scope: PlanningScopeSchema, after: id.optional(),
  limit: z.number().int().min(1).max(PLANNING_LIMITS.campaigns).default(PLANNING_LIMITS.campaigns) }).strict();
export const PlanningCampaignQuerySchema = z.object({ scope: PlanningScopeSchema, campaignId: id, briefsAfter: id.optional() }).strict();
export const PlanningCampaignListSchema = scoped({ asOf: UtcDateTimeSchema,
  campaigns: z.array(PlanningCampaignHeaderSchema).max(PLANNING_LIMITS.campaigns), nextCursor: id.nullable() });
const fieldNames = Object.keys(CampaignFieldObjectSchema.shape);
const fieldName = z.string().refine(value => fieldNames.includes(value));
const proposal = z.object({ id, patch: CampaignDraftFieldsSchema, originalText: OriginalTextSchema, basedOnFieldsRevision: revision,
  createdAt: UtcDateTimeSchema, appliedAt: UtcDateTimeSchema.nullable(), origin: z.enum(["HUMAN", "CONTEXT_TONE"]),
  dependency: z.object({ fieldsRevision: revision, selectionId: id, selectionRevision: revision }).strict().nullable() }).strict()
  .refine(value => (value.origin === "HUMAN") === (value.dependency === null))
  .refine(value => value.origin !== "CONTEXT_TONE" || Object.keys(value.patch).length === 1
    && typeof value.patch.tone === "string" && value.patch.tone.trim().length > 0);
export const BriefPlanningProvenanceSchema = z.object({ selectionId: id, selectionRevision: revision,
  versionId: id.nullable(), contentHash: hash.nullable() }).strict().refine(value => (value.versionId === null) === (value.contentHash === null));
const brief = z.object({ id, campaignId: id, version: revision, inputRevision: revision, content: CampaignBriefContentSchema,
  approvedAt: UtcDateTimeSchema.nullable(), approvedByUserId: id.nullable(), createdAt: UtcDateTimeSchema,
  provenance: BriefPlanningProvenanceSchema.nullable() }).strict().refine(value => value.campaignId === value.content.requirements.campaignId
    && value.version === value.content.requirements.version && value.inputRevision === value.content.inputRevision
    && value.approvedByUserId === value.content.approvedByUserId && (value.approvedAt !== null) === (value.approvedByUserId !== null));
export const PlanningCampaignSchema = scoped({ asOf: UtcDateTimeSchema,
  campaign: z.object({ id, title: z.string().max(200), status: CampaignStatusSchema, revision, fieldsRevision: revision,
    fields: CampaignDraftFieldsSchema, missingFields: z.array(fieldName).max(fieldNames.length), clarificationCount: z.number().int().min(0).max(5),
    conversation: z.array(z.object({ role: z.enum(["user", "assistant"]), kind: z.enum(["GREETING", "CLARIFICATION", "PROPOSAL"]),
      text: z.string().max(20000), language: ContentLanguageSchema, field: fieldName.nullable(), ts: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict()).max(200),
    currentBriefVersion: revision.nullable(), updatedAt: UtcDateTimeSchema }).strict(),
  planning: z.object({ revision, selection: PlanningSelectionSchema, selectedContext: ApprovedBrandContextVersionSchema.nullable(),
    narrative: ManualNarrativeSchema.nullable() }).strict().refine(value => value.selection.kind === "NONE" ? value.selectedContext === null
      : value.selectedContext?.id === value.selection.versionId && value.selectedContext.contentHash === value.selection.contentHash),
  proposals: z.array(proposal).max(PLANNING_LIMITS.proposals), briefs: z.array(brief).max(PLANNING_LIMITS.briefs), briefsAfter: id.nullable(),
}).refine(value => value.campaign.fieldsRevision <= value.campaign.revision
  && new Set(value.proposals.map(proposal => proposal.id)).size === value.proposals.length
  && value.proposals.every(proposal => proposal.dependency === null || proposal.dependency.fieldsRevision === proposal.basedOnFieldsRevision)
  && value.briefs.every((brief, index, rows) => brief.campaignId === value.campaign.id && (index === 0 || brief.version < rows[index - 1]!.version))
  && (value.briefsAfter === null || value.briefsAfter === value.briefs.at(-1)?.id));
export const CampaignOwnerReviewQuerySchema = z.object({ submissionId: id }).strict();
export const CampaignOwnerReviewsQuerySchema = z.object({ after: id.optional(),
  limit: z.number().int().min(1).max(PLANNING_LIMITS.reviews).default(PLANNING_LIMITS.reviews) }).strict();
export const CampaignOwnerReviewCommandSchema = z.object({ operationKey: z.uuid(), submissionId: id, expectedRevision: revision,
  decision: z.enum(["APPROVE", "DECLINE"]) }).strict();
export const CampaignOwnerReviewReceiptSchema = z.object({ campaignId: id, submissionId: id, briefId: id, revision: z.literal(2),
  state: z.enum(["APPROVED", "DECLINED"]), campaignRevision: revision, planningRevision: revision, selectionRevision: revision, version: revision }).strict();
export const CampaignOwnerReviewResultSchema = CampaignOwnerReviewReceiptSchema.extend({ replayed: z.boolean() }).strict();
export const CampaignOwnerReviewHeaderSchema = z.object({ id, campaignId: id, briefId: id, scope: PlanningScopeSchema,
  titleOriginal: OriginalTextSchema.extend({ text: z.string().max(200) }).strict(), version: revision, inputRevision: revision,
  campaignRevision: revision, selectionRevision: revision, revision, state: z.enum(["PENDING", "APPROVED", "DECLINED"]),
  sourceStale: z.boolean(), approvalAvailable: z.boolean(), createdAt: UtcDateTimeSchema, decidedAt: UtcDateTimeSchema.nullable() }).strict()
  .refine(value => value.state === "PENDING" ? value.revision === 1 && value.decidedAt === null : value.revision === 2 && value.decidedAt !== null)
  .refine(value => !value.approvalAvailable || value.state === "PENDING" && !value.sourceStale);
export const CampaignOwnerReviewDetailSchema = CampaignOwnerReviewHeaderSchema.safeExtend({ content: CampaignPlanningSnapshotSchema,
  contentHash: hash, provenance: BriefPlanningProvenanceSchema, selectedContext: ApprovedBrandContextVersionSchema.nullable() }).strict()
  .refine(value => value.content.requirements.campaignId === value.campaignId && value.content.requirements.version === value.version
    && value.content.inputRevision === value.inputRevision && value.content.approvedByUserId === null
    && value.titleOriginal.text === value.content.requirements.title && value.titleOriginal.language === value.content.requirements.originalLanguage
    && value.provenance.selectionRevision === value.selectionRevision
    && (value.provenance.versionId === null ? value.selectedContext === null
      : value.selectedContext?.id === value.provenance.versionId && value.selectedContext.contentHash === value.provenance.contentHash));
export const CampaignOwnerReviewsSchema = z.object({ asOf: UtcDateTimeSchema,
  reviews: z.array(CampaignOwnerReviewHeaderSchema).max(PLANNING_LIMITS.reviews), nextCursor: id.nullable() }).strict();
export const CampaignOwnerReviewSchema = z.object({ asOf: UtcDateTimeSchema, review: CampaignOwnerReviewDetailSchema }).strict();
export type PlanningCampaignList = z.infer<typeof PlanningCampaignListSchema>;
export type PlanningCampaign = z.infer<typeof PlanningCampaignSchema>;
export type CampaignOwnerReviews = z.infer<typeof CampaignOwnerReviewsSchema>;
export type CampaignOwnerReview = z.infer<typeof CampaignOwnerReviewSchema>;
export type CampaignOwnerReviewResult = z.infer<typeof CampaignOwnerReviewResultSchema>;
export class CampaignPlanningError extends Error { constructor(public readonly code: string, public readonly status = 409) { super(code); this.name = "CampaignPlanningError"; } }
export function parsePlanning<T>(schema: z.ZodType<T>, input: unknown): T { const parsed = schema.safeParse(input);
  if (!parsed.success) throw new CampaignPlanningError("VALIDATION", 422); return parsed.data; }
