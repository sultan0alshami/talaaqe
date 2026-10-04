import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient, type Brand, type Campaign, type CampaignBrief } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canonicalHash, checkedJson, inputJson } from "@/lib/onboarding/drafts";
import { OriginalTextSchema } from "@/lib/contracts/vocabulary";
import {
  CampaignBriefContentSchema, CampaignDraftFieldsSchema, CampaignFieldObjectSchema, CampaignFieldsSchema,
  CampaignPolicyReviewSchema, CampaignProposalSchema, CampaignRequirementsSchema, parseBriefContent,
  type CampaignBriefContent, type CampaignDraftFields, type CampaignPolicyReview, type CampaignRequirementsDTO,
} from "./contracts";

export class CampaignError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); this.name = "CampaignError"; }
}
type Transaction = Prisma.TransactionClient;
export type CampaignCommandContext = { channel: "FORM" | "CHAT_TOOL" | "PARAGRAPH_TOOL" | "SERVER"; policyReview?: CampaignPolicyReview | null;
  policyReviewResolver?: (tx: Transaction, requirements: CampaignRequirementsDTO) => Promise<CampaignPolicyReview | null> };
type Proposal = { id: string; patch: CampaignDraftFields; originalText: z.infer<typeof OriginalTextSchema>; basedOnFieldsRevision: number; createdAt: string; appliedAt: string | null };
type DraftState = { schemaVersion: 1; fields: CampaignDraftFields; fieldsRevision: number; proposals: Proposal[]; clarificationCount: number };
type ChatTurn = { role: "user" | "assistant"; kind: "GREETING" | "CLARIFICATION" | "PROPOSAL"; text: string; language: string | null; field: string | null; ts: number };
export type CampaignBriefDTO = { id: string; campaignId: string; version: number; inputRevision: number; content: CampaignBriefContent; approvedAt: string | null; approvedByUserId: string | null; createdAt: string };
export type CampaignDTO = {
  id: string; revision: number; title: string; status: Campaign["status"]; fields: CampaignDraftFields; fieldsRevision: number;
  proposals: Proposal[]; clarificationCount: number; missingFields: string[]; conversation: ChatTurn[];
  currentBriefVersion: number | null; briefs: CampaignBriefDTO[]; updatedAt: string;
};
const operationKey = z.string().min(1).max(120).regex(/^[A-Za-z0-9_:-]+$/);
const BaseSchema = z.object({ operationKey, expectedRevision: z.number().int().positive().max(2_147_483_646) });
const CreateSchema = z.object({ operationKey, fields: CampaignDraftFieldsSchema }).strict();
const MutationSchema = BaseSchema.extend({ action: z.enum(["UPDATE_FIELDS", "PROPOSE_FIELDS", "APPLY_PROPOSAL", "ASK_CLARIFICATION", "GREETING"]), payload: z.record(z.string(), z.unknown()) }).strict();
const ApprovalSchema = BaseSchema.extend({ briefId: z.string().min(1).max(200), expectedBriefVersion: z.number().int().positive() }).strict();
const GenerateSchema = BaseSchema.strict();
function parse<T>(schema: z.ZodType<T>, input: unknown, code = "INVALID_COMMAND"): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new CampaignError(code, 400);
  return parsed.data;
}
function stateOf(campaign: Campaign): DraftState {
  const schema = z.object({ schemaVersion: z.literal(1), fields: CampaignDraftFieldsSchema, fieldsRevision: z.number().int().positive(),
    proposals: z.array(z.object({ id: z.string(), patch: CampaignDraftFieldsSchema, originalText: OriginalTextSchema, basedOnFieldsRevision: z.number().int().positive(), createdAt: z.string(), appliedAt: z.string().nullable() }).strict()).max(50), clarificationCount: z.number().int().min(0).max(5) }).strict();
  return parse(schema, campaign.input, "INVALID_STORED_DRAFT");
}
function briefDTO(brief: CampaignBrief): CampaignBriefDTO {
  const content = parse(CampaignBriefContentSchema, brief.content, "INVALID_STORED_BRIEF");
  if (content.requirements.campaignId !== brief.campaignId || content.requirements.version !== brief.version || content.inputRevision !== brief.inputRevision
    || content.approvedByUserId !== brief.approvedByUserId || Boolean(brief.approvedAt) !== Boolean(brief.approvedByUserId)) throw new CampaignError("INVALID_STORED_BRIEF");
  return { id: brief.id, campaignId: brief.campaignId, version: brief.version, inputRevision: brief.inputRevision, content,
    approvedAt: brief.approvedAt?.toISOString() ?? null, approvedByUserId: brief.approvedByUserId, createdAt: brief.createdAt.toISOString() };
}
export async function campaignDTO(tx: Transaction, campaign: Campaign): Promise<CampaignDTO> {
  const state = stateOf(campaign), complete = CampaignFieldsSchema.safeParse(state.fields);
  const missingFields = Object.keys(CampaignFieldObjectSchema.shape).filter((key) => !Object.hasOwn(state.fields, key));
  const briefs = await tx.campaignBrief.findMany({ where: { campaignId: campaign.id }, orderBy: { version: "asc" } });
  if (!complete.success && !missingFields.length) throw new CampaignError("INVALID_STORED_DRAFT");
  return { id: campaign.id, revision: campaign.revision, title: campaign.title, status: campaign.status, fields: state.fields, fieldsRevision: state.fieldsRevision,
    proposals: state.proposals, clarificationCount: state.clarificationCount, missingFields, conversation: campaign.conversation as unknown as ChatTurn[],
    currentBriefVersion: campaign.currentBriefVersion, briefs: briefs.map(briefDTO), updatedAt: campaign.updatedAt.toISOString() };
}

async function authorize(tx: Transaction, actorUserId: string): Promise<Brand> {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actorUserId} FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: actorUserId }, select: { role: true, active: true } });
  if (!user?.active || user.role !== "BRAND") throw new CampaignError("FORBIDDEN", 403);
  const brand = await tx.brand.findUnique({ where: { userId: actorUserId } });
  if (!brand) throw new CampaignError("BRAND_PROFILE_REQUIRED");
  await tx.$queryRaw`SELECT id FROM "Brand" WHERE id = ${brand.id} FOR SHARE`;
  return tx.brand.findUniqueOrThrow({ where: { id: brand.id } });
}
export async function withOwnedCampaign<T>(client: PrismaClient, actorUserId: string, campaignId: string,
  action: (tx: Transaction, campaign: Campaign, brand: Brand) => Promise<T>): Promise<T> {
  return client.$transaction(async (tx) => {
    const brand = await authorize(tx, actorUserId);
    if (!await tx.campaign.findFirst({ where: { id: campaignId, brandId: brand.id }, select: { id: true } })) throw new CampaignError("NOT_FOUND", 404);
    await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${campaignId} FOR UPDATE`;
    return action(tx, await tx.campaign.findUniqueOrThrow({ where: { id: campaignId } }), brand);
  }, { maxWait: 10_000, timeout: 20_000 });
}
function editable(campaign: Campaign, expectedRevision: number): void {
  if (campaign.status === "CANCELLED" || campaign.status === "COMPLETED") throw new CampaignError("CAMPAIGN_TERMINAL");
  if (campaign.revision !== expectedRevision) throw new CampaignError("STALE_VERSION");
}
async function replay<T>(tx: Transaction, actorUserId: string, key: string, hash: string, campaignId?: string): Promise<T | null> {
  const prior = await tx.campaignCommand.findUnique({ where: { actorUserId_operationKey: { actorUserId, operationKey: key } } });
  if (!prior) return null;
  if (prior.payloadHash !== hash || (campaignId && prior.campaignId !== campaignId)) throw new CampaignError("IDEMPOTENCY_CONFLICT");
  return prior.result as unknown as T;
}
async function journal<T>(tx: Transaction, campaignId: string, actorUserId: string, key: string, hash: string, result: T): Promise<void> {
  await tx.campaignCommand.create({ data: { campaignId, actorUserId, operationKey: key, payloadHash: hash, result: inputJson(result) } });
}
async function update(tx: Transaction, campaign: Campaign, expectedRevision: number, data: Prisma.CampaignUpdateManyMutationInput): Promise<Campaign> {
  const changed = await tx.campaign.updateMany({ where: { id: campaign.id, revision: expectedRevision }, data: { ...data, revision: { increment: 1 } } });
  if (changed.count !== 1) throw new CampaignError("STALE_VERSION");
  return tx.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
}

export async function createCampaign(actorUserId: string, input: unknown, client: PrismaClient = prisma): Promise<{ campaign: CampaignDTO; replayed: boolean }> {
  checkedJson(input);
  const command = parse(CreateSchema, input), key = `create:${command.operationKey}`, hash = canonicalHash(command);
  return client.$transaction(async (tx) => {
    const brand = await authorize(tx, actorUserId);
    const previous = await replay<{ campaign: CampaignDTO }>(tx, actorUserId, key, hash);
    if (previous) return { ...previous, replayed: true };
    const state: DraftState = { schemaVersion: 1, fields: { desiredCreatorCount: 1, ...command.fields }, fieldsRevision: 1, proposals: [], clarificationCount: 0 };
    const campaign = await tx.campaign.create({ data: { brandId: brand.id, title: command.fields.title ?? "", input: inputJson(state) } });
    const result = { campaign: await campaignDTO(tx, campaign) };
    await journal(tx, campaign.id, actorUserId, key, hash, result);
    return { ...result, replayed: false };
  });
}
export async function getCampaign(actorUserId: string, campaignId: string, client: PrismaClient = prisma): Promise<CampaignDTO> {
  return withOwnedCampaign(client, actorUserId, campaignId, (tx, campaign) => campaignDTO(tx, campaign));
}
export async function listCampaigns(actorUserId: string, input: { limit?: number; cursor?: string } = {}, client: PrismaClient = prisma) {
  const query = parse(z.object({ limit: z.number().int().min(1).max(50).default(20), cursor: z.string().min(1).max(200).optional() }).strict(), input);
  return client.$transaction(async (tx) => {
    const brand = await authorize(tx, actorUserId);
    if (query.cursor && !await tx.campaign.findFirst({ where: { id: query.cursor, brandId: brand.id }, select: { id: true } })) throw new CampaignError("NOT_FOUND", 404);
    const rows = await tx.campaign.findMany({ where: { brandId: brand.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}), select: { id: true, title: true, revision: true, status: true, currentBriefVersion: true, createdAt: true, updatedAt: true } });
    const campaigns = rows.slice(0, query.limit).map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }));
    return { campaigns, nextCursor: rows.length > query.limit ? campaigns.at(-1)!.id : null };
  });
}

async function newBrief(tx: Transaction, campaign: Campaign, brand: Brand, state: DraftState): Promise<CampaignBrief> {
  const fields = parse(CampaignFieldsSchema, state.fields, "MISSING_REQUIREMENTS");
  const latest = await tx.campaignBrief.findFirst({ where: { campaignId: campaign.id }, orderBy: { version: "desc" } });
  const version = (latest?.version ?? 0) + 1;
  const requirements = parse(CampaignRequirementsSchema, { ...fields, campaignId: campaign.id, version, brandCountryCode: brand.countryCode, mandatoryPolicyVersionIds: [] }, brand.countryCode ? "INVALID_REQUIREMENTS" : "BRAND_COUNTRY_REQUIRED");
  const content: CampaignBriefContent = { schemaVersion: 1, requirements, inputRevision: state.fieldsRevision, approvedByUserId: null, policyReview: null };
  return tx.campaignBrief.create({ data: { campaignId: campaign.id, version, inputRevision: state.fieldsRevision, content: inputJson(content) } });
}

export async function applyCampaignMutation(actorUserId: string, campaignId: string, input: unknown, client: PrismaClient = prisma,
  context: CampaignCommandContext = { channel: "FORM" }): Promise<{ campaign: CampaignDTO; proposalId: string | null; replayed: boolean }> {
  checkedJson(input);
  const command = parse(MutationSchema, input), key = `campaign:${campaignId}:${command.operationKey}`, hash = canonicalHash({ ...command, channel: context.channel });
  if ((command.action === "UPDATE_FIELDS" || command.action === "APPLY_PROPOSAL") && context.channel !== "FORM") throw new CampaignError("EXPLICIT_CONFIRMATION_REQUIRED", 400);
  if (command.action === "GREETING" && context.channel !== "SERVER") throw new CampaignError("FORBIDDEN", 403);
  if (command.action === "ASK_CLARIFICATION" && context.channel !== "CHAT_TOOL" && context.channel !== "SERVER") throw new CampaignError("FORBIDDEN", 403);
  return withOwnedCampaign(client, actorUserId, campaignId, async (tx, campaign, brand) => {
    const previous = await replay<{ campaign: CampaignDTO; proposalId: string | null }>(tx, actorUserId, key, hash, campaignId);
    if (previous) return { ...previous, replayed: true };
    editable(campaign, command.expectedRevision);
    const state = stateOf(campaign), oldFieldsHash = canonicalHash(state.fields), conversation = campaign.conversation as unknown as ChatTurn[];
    let proposalId: string | null = null;
    if (command.action === "UPDATE_FIELDS") {
      const payload = parse(z.object({ patch: CampaignDraftFieldsSchema }).strict(), command.payload);
      state.fields = parse(CampaignDraftFieldsSchema, { ...state.fields, ...payload.patch });
    } else if (command.action === "PROPOSE_FIELDS") {
      const proposal = parse(CampaignProposalSchema, command.payload);
      if (!Object.keys(proposal.patch).length) throw new CampaignError("EMPTY_PROPOSAL", 400);
      if (state.proposals.length >= 50) throw new CampaignError("PROPOSAL_LIMIT", 400);
      proposalId = randomUUID();
      state.proposals.push({ id: proposalId, patch: proposal.patch, originalText: proposal.originalText, basedOnFieldsRevision: state.fieldsRevision, createdAt: new Date().toISOString(), appliedAt: null });
      conversation.push({ role: "user", kind: "PROPOSAL", text: proposal.originalText.text, language: proposal.originalText.language, field: null, ts: Date.now() });
    } else if (command.action === "APPLY_PROPOSAL") {
      const payload = parse(z.object({ proposalId: z.string().min(1).max(200) }).strict(), command.payload), proposal = state.proposals.find((item) => item.id === payload.proposalId);
      if (!proposal) throw new CampaignError("PROPOSAL_NOT_FOUND", 404);
      if (proposal.appliedAt || proposal.basedOnFieldsRevision !== state.fieldsRevision) throw new CampaignError("STALE_PROPOSAL");
      state.fields = parse(CampaignDraftFieldsSchema, { ...state.fields, ...proposal.patch });
      proposal.appliedAt = new Date().toISOString();
      proposalId = proposal.id;
    } else if (command.action === "ASK_CLARIFICATION") {
      const payload = parse(z.object({ field: z.string().refine((field) => Object.hasOwn(CampaignFieldObjectSchema.shape, field)), text: OriginalTextSchema }).strict(), command.payload);
      if (state.clarificationCount >= 5) throw new CampaignError("QUESTION_LIMIT");
      if (Object.hasOwn(state.fields, payload.field)) throw new CampaignError("FIELD_ALREADY_SUPPLIED");
      if (!payload.text.text.trim()) throw new CampaignError("INVALID_COMMAND", 400);
      state.clarificationCount += 1;
      conversation.push({ role: "assistant", kind: "CLARIFICATION", text: payload.text.text, language: payload.text.language, field: payload.field, ts: Date.now() });
    } else {
      const payload = parse(z.object({ text: OriginalTextSchema }).strict(), command.payload);
      if (!payload.text.text.trim() || /[?؟]/.test(payload.text.text)) throw new CampaignError("INVALID_GREETING", 400);
      conversation.push({ role: "assistant", kind: "GREETING", text: payload.text.text, language: payload.text.language, field: null, ts: Date.now() });
    }
    if (conversation.length > 200) throw new CampaignError("CONVERSATION_LIMIT", 400);
    let status = campaign.status, currentBriefVersion = campaign.currentBriefVersion;
    if (oldFieldsHash !== canonicalHash(state.fields)) {
      state.fieldsRevision = campaign.revision + 1;
      currentBriefVersion = null;
      status = "DRAFT";
      if (await tx.campaignBrief.count({ where: { campaignId } })) { await newBrief(tx, campaign, brand, state); status = "BRIEF_GENERATED"; }
    }
    const updated = await update(tx, campaign, command.expectedRevision, { title: state.fields.title ?? "", input: inputJson(state), conversation: inputJson(conversation), status, currentBriefVersion });
    const result = { campaign: await campaignDTO(tx, updated), proposalId };
    await journal(tx, campaignId, actorUserId, key, hash, result);
    return { ...result, replayed: false };
  });
}

export async function generateCampaignBrief(actorUserId: string, campaignId: string, input: unknown, client: PrismaClient = prisma): Promise<{ campaign: CampaignDTO; brief: CampaignBriefDTO; replayed: boolean }> {
  checkedJson(input);
  const command = parse(GenerateSchema, input), key = `campaign:${campaignId}:${command.operationKey}`, hash = canonicalHash({ action: "GENERATE_BRIEF", ...command });
  return withOwnedCampaign(client, actorUserId, campaignId, async (tx, campaign, brand) => {
    const previous = await replay<{ campaign: CampaignDTO; brief: CampaignBriefDTO }>(tx, actorUserId, key, hash, campaignId);
    if (previous) return { ...previous, replayed: true };
    editable(campaign, command.expectedRevision);
    const state = stateOf(campaign);
    const latest = await tx.campaignBrief.findFirst({ where: { campaignId }, orderBy: { version: "desc" } });
    const fields = parse(CampaignFieldsSchema, state.fields, "MISSING_REQUIREMENTS");
    const priorRequirements = latest ? briefDTO(latest).content.requirements : null;
    const priorFields = priorRequirements ? Object.fromEntries(Object.keys(CampaignFieldObjectSchema.shape).map((field) => [field, priorRequirements[field as keyof CampaignRequirementsDTO]])) : null;
    const reusable = latest && latest.inputRevision === state.fieldsRevision && priorRequirements?.brandCountryCode === brand.countryCode && canonicalHash(priorFields) === canonicalHash(fields);
    const brief = reusable ? latest : await newBrief(tx, campaign, brand, state);
    const updated = await update(tx, campaign, command.expectedRevision, { status: brief.approvedAt ? campaign.status : "BRIEF_GENERATED", currentBriefVersion: brief.approvedAt ? campaign.currentBriefVersion : null });
    const result = { campaign: await campaignDTO(tx, updated), brief: briefDTO(brief) };
    await journal(tx, campaignId, actorUserId, key, hash, result);
    return { ...result, replayed: false };
  });
}

export async function approveCampaignBrief(actorUserId: string, campaignId: string, input: unknown, client: PrismaClient = prisma,
  context: CampaignCommandContext = { channel: "FORM" }): Promise<{ campaign: CampaignDTO; brief: CampaignBriefDTO; replayed: boolean }> {
  checkedJson(input);
  const command = parse(ApprovalSchema, input), key = `campaign:${campaignId}:${command.operationKey}`;
  if (context.channel !== "FORM") throw new CampaignError("EXPLICIT_CONFIRMATION_REQUIRED", 400);
  let policyReview = context.policyReview ? parse(CampaignPolicyReviewSchema, context.policyReview, "INVALID_POLICY_REVIEW") : null;
  const hash = canonicalHash({ action: "APPROVE_BRIEF", ...command, policyReview, serverPolicyResolver: context.policyReviewResolver ? "reviewed-registry-v1" : null });
  return withOwnedCampaign(client, actorUserId, campaignId, async (tx, campaign, brand) => {
    const previous = await replay<{ campaign: CampaignDTO; brief: CampaignBriefDTO }>(tx, actorUserId, key, hash, campaignId);
    if (previous) return { ...previous, replayed: true };
    editable(campaign, command.expectedRevision);
    const state = stateOf(campaign), brief = await tx.campaignBrief.findFirst({ where: { id: command.briefId, campaignId } });
    if (!brief || brief.version !== command.expectedBriefVersion || brief.inputRevision !== state.fieldsRevision) throw new CampaignError("STALE_BRIEF");
    const latest = await tx.campaignBrief.findFirst({ where: { campaignId }, orderBy: { version: "desc" }, select: { id: true } });
    if (latest?.id !== brief.id) throw new CampaignError("STALE_BRIEF");
    const content = parseBriefContent(brief.content);
    const fields = parse(CampaignFieldsSchema, state.fields, "MISSING_REQUIREMENTS");
    if (context.policyReviewResolver && !brief.approvedAt) policyReview = await context.policyReviewResolver(tx, content.requirements);
    if (canonicalHash({ ...fields, campaignId, version: brief.version, brandCountryCode: brand.countryCode, mandatoryPolicyVersionIds: content.requirements.mandatoryPolicyVersionIds }) !== canonicalHash(content.requirements)) throw new CampaignError("STALE_BRIEF");
    if (policyReview && (Date.parse(policyReview.reviewedAt) > Date.now() || canonicalHash([...policyReview.marketCountryCodes].sort()) !== canonicalHash([...fields.marketCountryCodes].sort()))) throw new CampaignError("INVALID_POLICY_REVIEW", 400);
    let approved = brief;
    if (!brief.approvedAt) {
      content.approvedByUserId = actorUserId;
      content.policyReview = policyReview;
      content.requirements.mandatoryPolicyVersionIds = policyReview?.mandatoryPolicyVersionIds ?? [];
      approved = await tx.campaignBrief.update({ where: { id: brief.id }, data: { approvedAt: new Date(), approvedByUserId: actorUserId, content: inputJson(content) } });
      const eventId = randomUUID();
      await tx.adminAudit.create({ data: { actorUserId, action: "brief.approved", resourceType: "Campaign", resourceId: campaignId, snapshot: inputJson({ briefId: brief.id, version: brief.version, inputRevision: brief.inputRevision }) } });
      await tx.outboxEvent.create({ data: { id: eventId, deduplicationKey: `campaign:${campaignId}:brief:${brief.version}:approved`, type: "brief.approved",
        payload: inputJson({ id: eventId, type: "brief.approved", actorUserId, aggregateType: "Campaign", aggregateId: campaignId, aggregateVersion: campaign.revision + 1,
          idempotencyKey: key, occurredAt: approved.approvedAt!.toISOString(), payload: { briefId: brief.id, version: brief.version, policyReviewAvailable: policyReview !== null } }) } });
    } else if (canonicalHash(content.policyReview) !== canonicalHash(policyReview)) throw new CampaignError("IMMUTABLE_BRIEF_CONFLICT");
    const updated = await update(tx, campaign, command.expectedRevision, { status: brief.approvedAt ? campaign.status : "BRIEF_APPROVED", currentBriefVersion: brief.version });
    const result = { campaign: await campaignDTO(tx, updated), brief: briefDTO(approved) };
    await journal(tx, campaignId, actorUserId, key, hash, result);
    return { ...result, replayed: false };
  });
}

export async function getApprovedRequirements(actorUserId: string, campaignId: string, client: PrismaClient = prisma): Promise<CampaignRequirementsDTO> {
  return withOwnedCampaign(client, actorUserId, campaignId, async (tx, campaign) => {
    if (!campaign.currentBriefVersion || !["BRIEF_APPROVED", "SHORTLISTED", "IN_DEALS"].includes(campaign.status)) throw new CampaignError("BRIEF_NOT_APPROVED");
    const brief = await tx.campaignBrief.findUnique({ where: { campaignId_version: { campaignId, version: campaign.currentBriefVersion } } });
    if (!brief?.approvedAt || !brief.approvedByUserId || brief.inputRevision !== stateOf(campaign).fieldsRevision) throw new CampaignError("BRIEF_NOT_APPROVED");
    return briefDTO(brief).content.requirements;
  });
}
