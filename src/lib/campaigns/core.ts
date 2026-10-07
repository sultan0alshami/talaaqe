import { randomUUID } from "node:crypto";
import { Prisma, type Brand, type Campaign, type CampaignBrief } from "@prisma/client";
import { z } from "zod";
import { canonicalHash, inputJson } from "@/lib/onboarding/drafts";
import { OriginalTextSchema } from "@/lib/contracts/vocabulary";
import type { EvidenceActorLocks } from "@/lib/evidence/readiness";
import { organizationAwait } from "@/lib/organizations/context";
import { CampaignBriefContentSchema, CampaignDraftFieldsSchema, CampaignFieldObjectSchema, CampaignFieldsSchema,
  CampaignPolicyReviewSchema, CampaignProposalSchema, CampaignRequirementsSchema, parseBriefContent,
  type CampaignBriefContent, type CampaignDraftFields, type CampaignPolicyReview, type CampaignRequirementsDTO } from "./contracts";
import { CampaignError } from "./errors";

type Tx = Prisma.TransactionClient;
export type CampaignCoreBrand = Pick<Brand, "id" | "userId" | "countryCode">;
export type CampaignCoreProposal = { id: string; patch: CampaignDraftFields; originalText: z.infer<typeof OriginalTextSchema>;
  basedOnFieldsRevision: number; createdAt: string; appliedAt: string | null };
export type CampaignCoreState = { schemaVersion: 1; fields: CampaignDraftFields; fieldsRevision: number;
  proposals: CampaignCoreProposal[]; clarificationCount: number };
export type CampaignCoreChatTurn = { role: "user" | "assistant"; kind: "GREETING" | "CLARIFICATION" | "PROPOSAL";
  text: string; language: string | null; field: string | null; ts: number };
export type CampaignBriefDTO = { id: string; campaignId: string; version: number; inputRevision: number; content: CampaignBriefContent;
  approvedAt: string | null; approvedByUserId: string | null; createdAt: string };
export type CampaignDTO = { id: string; revision: number; title: string; status: Campaign["status"];
  fields: CampaignDraftFields; fieldsRevision: number; proposals: CampaignCoreProposal[]; clarificationCount: number;
  missingFields: string[]; conversation: CampaignCoreChatTurn[]; currentBriefVersion: number | null;
  briefs: CampaignBriefDTO[]; updatedAt: string };
export type CampaignCoreMutation = { expectedRevision: number; action: "UPDATE_FIELDS" | "PROPOSE_FIELDS" | "APPLY_PROPOSAL" | "ASK_CLARIFICATION" | "GREETING";
  payload: Record<string, unknown> };
export type CampaignCoreMutationOptions = { keepProposalFields?: boolean; appendProposalConversation?: boolean;
  checkpoint?: () => void; now?: Date };
export type CampaignCoreApprovalOptions = { key: string; policyReview: CampaignPolicyReview | null;
  policyReviewResolver?: (tx: Tx, requirements: CampaignRequirementsDTO, now?: Date, actors?: EvidenceActorLocks) => Promise<CampaignPolicyReview | null>;
  evidenceActors?: EvidenceActorLocks; checkpoint?: () => void; now?: Date };

function parse<T>(schema: z.ZodType<T>, input: unknown, code = "INVALID_COMMAND"): T {
  const value = schema.safeParse(input); if (!value.success) throw new CampaignError(code, 400); return value.data;
}
export function campaignStateOf(campaign: Campaign): CampaignCoreState {
  return parse(z.object({ schemaVersion: z.literal(1), fields: CampaignDraftFieldsSchema, fieldsRevision: z.number().int().positive(),
    proposals: z.array(z.object({ id: z.string(), patch: CampaignDraftFieldsSchema, originalText: OriginalTextSchema,
      basedOnFieldsRevision: z.number().int().positive(), createdAt: z.string(), appliedAt: z.string().nullable() }).strict()).max(50),
    clarificationCount: z.number().int().min(0).max(5) }).strict(), campaign.input, "INVALID_STORED_DRAFT");
}
export function campaignBriefDTO(brief: CampaignBrief): CampaignBriefDTO {
  const content = parse(CampaignBriefContentSchema, brief.content, "INVALID_STORED_BRIEF");
  if (content.requirements.campaignId !== brief.campaignId || content.requirements.version !== brief.version
    || content.inputRevision !== brief.inputRevision || content.approvedByUserId !== brief.approvedByUserId
    || Boolean(brief.approvedAt) !== Boolean(brief.approvedByUserId)) throw new CampaignError("INVALID_STORED_BRIEF");
  return { id: brief.id, campaignId: brief.campaignId, version: brief.version, inputRevision: brief.inputRevision, content,
    approvedAt: brief.approvedAt?.toISOString() ?? null, approvedByUserId: brief.approvedByUserId, createdAt: brief.createdAt.toISOString() };
}
export async function projectCampaignCore(tx: Tx, campaign: Campaign): Promise<CampaignDTO> {
  const state = campaignStateOf(campaign), complete = CampaignFieldsSchema.safeParse(state.fields);
  const missingFields = Object.keys(CampaignFieldObjectSchema.shape).filter(key => !Object.hasOwn(state.fields, key));
  const briefs = await tx.campaignBrief.findMany({ where: { campaignId: campaign.id }, orderBy: { version: "asc" } });
  if (!complete.success && !missingFields.length) throw new CampaignError("INVALID_STORED_DRAFT");
  return { id: campaign.id, revision: campaign.revision, title: campaign.title, status: campaign.status, fields: state.fields,
    fieldsRevision: state.fieldsRevision, proposals: state.proposals, clarificationCount: state.clarificationCount, missingFields,
    conversation: campaign.conversation as unknown as CampaignCoreChatTurn[], currentBriefVersion: campaign.currentBriefVersion,
    briefs: briefs.map(campaignBriefDTO), updatedAt: campaign.updatedAt.toISOString() };
}
export function campaignEditable(campaign: Campaign, expectedRevision: number) {
  if (campaign.status === "CANCELLED" || campaign.status === "COMPLETED") throw new CampaignError("CAMPAIGN_TERMINAL");
  if (campaign.revision !== expectedRevision) throw new CampaignError("STALE_VERSION");
}
export async function updateCampaignCore(tx: Tx, campaign: Campaign, expectedRevision: number,
  data: Prisma.CampaignUpdateManyMutationInput, checkpoint?: () => void): Promise<Campaign> {
  const changed = await organizationAwait(checkpoint, () => tx.campaign.updateMany({ where: { id: campaign.id, revision: expectedRevision }, data: { ...data, revision: { increment: 1 } } }));
  if (changed.count !== 1) throw new CampaignError("STALE_VERSION");
  return organizationAwait(checkpoint, () => tx.campaign.findUniqueOrThrow({ where: { id: campaign.id } }));
}
export async function createCampaignCore(tx: Tx, brand: CampaignCoreBrand, fields: CampaignDraftFields, checkpoint?: () => void) {
  const state: CampaignCoreState = { schemaVersion: 1, fields: { desiredCreatorCount: 1, ...fields }, fieldsRevision: 1, proposals: [], clarificationCount: 0 };
  return organizationAwait(checkpoint, () => tx.campaign.create({ data: { brandId: brand.id, title: fields.title ?? "", input: inputJson(state) } }));
}
export async function newCampaignBriefCore(tx: Tx, campaign: Campaign, brand: CampaignCoreBrand, state: CampaignCoreState, checkpoint?: () => void): Promise<CampaignBrief> {
  const fields = parse(CampaignFieldsSchema, state.fields, "MISSING_REQUIREMENTS");
  const latest = await organizationAwait(checkpoint, () => tx.campaignBrief.findFirst({ where: { campaignId: campaign.id }, orderBy: { version: "desc" } }));
  const version = (latest?.version ?? 0) + 1;
  const requirements = parse(CampaignRequirementsSchema, { ...fields, campaignId: campaign.id, version,
    brandCountryCode: brand.countryCode, mandatoryPolicyVersionIds: [] }, brand.countryCode ? "INVALID_REQUIREMENTS" : "BRAND_COUNTRY_REQUIRED");
  const content: CampaignBriefContent = { schemaVersion: 1, requirements, inputRevision: state.fieldsRevision, approvedByUserId: null, policyReview: null };
  return organizationAwait(checkpoint, () => tx.campaignBrief.create({ data: { campaignId: campaign.id, version, inputRevision: state.fieldsRevision, content: inputJson(content) } }));
}
export async function mutateCampaignCore(tx: Tx, campaign: Campaign, brand: CampaignCoreBrand, command: CampaignCoreMutation,
  options: CampaignCoreMutationOptions = {}): Promise<{ campaign: Campaign; proposalId: string | null; createdBriefs: CampaignBrief[] }> {
  options.checkpoint?.(); campaignEditable(campaign, command.expectedRevision);
  const state = campaignStateOf(campaign), oldHash = canonicalHash(state.fields), conversation = campaign.conversation as unknown as CampaignCoreChatTurn[];
  const createdBriefs: CampaignBrief[] = []; let proposalId: string | null = null;
  const now = () => options.now ? new Date(options.now.getTime()) : new Date();
  if (command.action === "UPDATE_FIELDS") {
    const payload = parse(z.object({ patch: CampaignDraftFieldsSchema }).strict(), command.payload);
    state.fields = parse(CampaignDraftFieldsSchema, { ...state.fields, ...payload.patch });
  } else if (command.action === "PROPOSE_FIELDS") {
    const proposal = parse(CampaignProposalSchema, command.payload);
    if (!Object.keys(proposal.patch).length) throw new CampaignError("EMPTY_PROPOSAL", 400);
    if (state.proposals.length >= 50) throw new CampaignError("PROPOSAL_LIMIT", 400);
    proposalId = randomUUID();
    state.proposals.push({ id: proposalId, patch: proposal.patch, originalText: proposal.originalText,
      basedOnFieldsRevision: state.fieldsRevision, createdAt: now().toISOString(), appliedAt: null });
    if (options.appendProposalConversation !== false) conversation.push({ role: "user", kind: "PROPOSAL", text: proposal.originalText.text,
      language: proposal.originalText.language, field: null, ts: options.now?.getTime() ?? Date.now() });
  } else if (command.action === "APPLY_PROPOSAL") {
    const payload = parse(z.object({ proposalId: z.string().min(1).max(200) }).strict(), command.payload);
    const proposal = state.proposals.find(value => value.id === payload.proposalId);
    if (!proposal) throw new CampaignError("PROPOSAL_NOT_FOUND", 404);
    if (proposal.appliedAt || proposal.basedOnFieldsRevision !== state.fieldsRevision) throw new CampaignError("STALE_PROPOSAL");
    if (!options.keepProposalFields) state.fields = parse(CampaignDraftFieldsSchema, { ...state.fields, ...proposal.patch });
    proposal.appliedAt = now().toISOString(); proposalId = proposal.id;
  } else if (command.action === "ASK_CLARIFICATION") {
    const payload = parse(z.object({ field: z.string().refine(value => Object.hasOwn(CampaignFieldObjectSchema.shape, value)), text: OriginalTextSchema }).strict(), command.payload);
    if (state.clarificationCount >= 5) throw new CampaignError("QUESTION_LIMIT");
    if (Object.hasOwn(state.fields, payload.field)) throw new CampaignError("FIELD_ALREADY_SUPPLIED");
    if (!payload.text.text.trim()) throw new CampaignError("INVALID_COMMAND", 400);
    state.clarificationCount++;
    conversation.push({ role: "assistant", kind: "CLARIFICATION", text: payload.text.text, language: payload.text.language,
      field: payload.field, ts: options.now?.getTime() ?? Date.now() });
  } else {
    const payload = parse(z.object({ text: OriginalTextSchema }).strict(), command.payload);
    if (!payload.text.text.trim() || /[?؟]/.test(payload.text.text)) throw new CampaignError("INVALID_GREETING", 400);
    conversation.push({ role: "assistant", kind: "GREETING", text: payload.text.text, language: payload.text.language,
      field: null, ts: options.now?.getTime() ?? Date.now() });
  }
  if (conversation.length > 200) throw new CampaignError("CONVERSATION_LIMIT", 400);
  let status = campaign.status, currentBriefVersion = campaign.currentBriefVersion;
  if (oldHash !== canonicalHash(state.fields)) {
    state.fieldsRevision = campaign.revision + 1; currentBriefVersion = null; status = "DRAFT";
    if (await organizationAwait(options.checkpoint, () => tx.campaignBrief.count({ where: { campaignId: campaign.id } }))) {
      createdBriefs.push(await newCampaignBriefCore(tx, campaign, brand, state, options.checkpoint)); status = "BRIEF_GENERATED";
    }
  }
  const updated = await updateCampaignCore(tx, campaign, command.expectedRevision, { title: state.fields.title ?? "", input: inputJson(state),
    conversation: inputJson(conversation), status, currentBriefVersion }, options.checkpoint);
  options.checkpoint?.(); return { campaign: updated, proposalId, createdBriefs };
}
export async function generateCampaignBriefCore(tx: Tx, campaign: Campaign, brand: CampaignCoreBrand,
  options: { expectedRevision: number; allowLatestReuse?: boolean; checkpoint?: () => void }): Promise<{ campaign: Campaign; brief: CampaignBrief; created: boolean }> {
  options.checkpoint?.(); campaignEditable(campaign, options.expectedRevision);
  const state = campaignStateOf(campaign), latest = await organizationAwait(options.checkpoint, () => tx.campaignBrief.findFirst({ where: { campaignId: campaign.id }, orderBy: { version: "desc" } }));
  const fields = parse(CampaignFieldsSchema, state.fields, "MISSING_REQUIREMENTS");
  const priorRequirements = latest ? campaignBriefDTO(latest).content.requirements : null;
  const priorFields = priorRequirements ? Object.fromEntries(Object.keys(CampaignFieldObjectSchema.shape).map(field => [field, priorRequirements[field as keyof CampaignRequirementsDTO]])) : null;
  const reusable = options.allowLatestReuse !== false && latest && latest.inputRevision === state.fieldsRevision
    && priorRequirements?.brandCountryCode === brand.countryCode && canonicalHash(priorFields) === canonicalHash(fields);
  const brief = reusable ? latest : await newCampaignBriefCore(tx, campaign, brand, state, options.checkpoint);
  const updated = await updateCampaignCore(tx, campaign, options.expectedRevision, { status: brief.approvedAt ? campaign.status : "BRIEF_GENERATED",
    currentBriefVersion: brief.approvedAt ? campaign.currentBriefVersion : null }, options.checkpoint);
  options.checkpoint?.(); return { campaign: updated, brief, created: !reusable };
}
export async function approveCampaignBriefCore(tx: Tx, campaign: Campaign, brand: CampaignCoreBrand, actorUserId: string,
  command: { expectedRevision: number; briefId: string; expectedBriefVersion: number }, options: CampaignCoreApprovalOptions) {
  options.checkpoint?.(); campaignEditable(campaign, command.expectedRevision);
  const state = campaignStateOf(campaign), brief = await organizationAwait(options.checkpoint, () => tx.campaignBrief.findFirst({ where: { id: command.briefId, campaignId: campaign.id } }));
  if (!brief || brief.version !== command.expectedBriefVersion || brief.inputRevision !== state.fieldsRevision) throw new CampaignError("STALE_BRIEF");
  const latest = await organizationAwait(options.checkpoint, () => tx.campaignBrief.findFirst({ where: { campaignId: campaign.id }, orderBy: { version: "desc" }, select: { id: true } }));
  if (latest?.id !== brief.id) throw new CampaignError("STALE_BRIEF");
  const content = parseBriefContent(brief.content), fields = parse(CampaignFieldsSchema, state.fields, "MISSING_REQUIREMENTS");
  let policyReview = options.policyReview ? parse(CampaignPolicyReviewSchema, options.policyReview, "INVALID_POLICY_REVIEW") : null;
  const policyReviewResolver = options.policyReviewResolver;
  if (policyReviewResolver && !brief.approvedAt) policyReview = await organizationAwait(options.checkpoint, () => policyReviewResolver(tx, content.requirements, options.now, options.evidenceActors));
  if (canonicalHash({ ...fields, campaignId: campaign.id, version: brief.version, brandCountryCode: brand.countryCode,
    mandatoryPolicyVersionIds: content.requirements.mandatoryPolicyVersionIds }) !== canonicalHash(content.requirements)) throw new CampaignError("STALE_BRIEF");
  const actualNow = options.now?.getTime() ?? Date.now();
  if (policyReview && (Date.parse(policyReview.reviewedAt) > actualNow || canonicalHash([...policyReview.marketCountryCodes].sort()) !== canonicalHash([...fields.marketCountryCodes].sort()))) throw new CampaignError("INVALID_POLICY_REVIEW", 400);
  let approved = brief;
  if (!brief.approvedAt) {
    content.approvedByUserId = actorUserId; content.policyReview = policyReview;
    content.requirements.mandatoryPolicyVersionIds = policyReview?.mandatoryPolicyVersionIds ?? [];
    approved = await organizationAwait(options.checkpoint, () => tx.campaignBrief.update({ where: { id: brief.id }, data: { approvedAt: options.now ? new Date(options.now.getTime()) : new Date(),
      approvedByUserId: actorUserId, content: inputJson(content) } }));
    const eventId = randomUUID();
    await organizationAwait(options.checkpoint, () => tx.adminAudit.create({ data: { actorUserId, action: "brief.approved", resourceType: "Campaign", resourceId: campaign.id,
      snapshot: inputJson({ briefId: brief.id, version: brief.version, inputRevision: brief.inputRevision }) } }));
    await organizationAwait(options.checkpoint, () => tx.outboxEvent.create({ data: { id: eventId, deduplicationKey: `campaign:${campaign.id}:brief:${brief.version}:approved`, type: "brief.approved",
      payload: inputJson({ id: eventId, type: "brief.approved", actorUserId, aggregateType: "Campaign", aggregateId: campaign.id,
        aggregateVersion: campaign.revision + 1, idempotencyKey: options.key, occurredAt: approved.approvedAt!.toISOString(),
        payload: { briefId: brief.id, version: brief.version, policyReviewAvailable: policyReview !== null } }) } }));
  } else if (canonicalHash(content.policyReview) !== canonicalHash(policyReview)) throw new CampaignError("IMMUTABLE_BRIEF_CONFLICT");
  const updated = await updateCampaignCore(tx, campaign, command.expectedRevision, { status: brief.approvedAt ? campaign.status : "BRIEF_APPROVED", currentBriefVersion: brief.version }, options.checkpoint);
  options.checkpoint?.(); return { campaign: updated, brief: approved };
}
