import { Prisma, PrismaClient, type Brand, type Campaign, type CampaignBrief } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canonicalHash, checkedJson, inputJson } from "@/lib/onboarding/drafts";
import { lockEvidenceActors, type EvidenceActorLocks } from "@/lib/evidence/readiness";
import { OriginalTextSchema } from "@/lib/contracts/vocabulary";
import { AuthenticationInvalidated } from "@/lib/identity";
import { assertLockedOrganizationActor, captureOrganizationActor, type OrganizationActor } from "@/lib/organizations/context";
import { createCampaignCore, mutateCampaignCore, generateCampaignBriefCore, approveCampaignBriefCore,
  projectCampaignCore } from "./core";
import { assertLegacyCampaignReadable, assertLegacyCampaignFreshWrite, legacyCampaignWhere } from "@/lib/campaign-planning/legacy";
import {
  CampaignBriefContentSchema, CampaignDraftFieldsSchema, CampaignPolicyReviewSchema,
  type CampaignBriefContent, type CampaignDraftFields, type CampaignPolicyReview, type CampaignRequirementsDTO,
} from "./contracts";

import { CampaignError } from "./errors";
export { CampaignError } from "./errors";
type Transaction = Prisma.TransactionClient;
export type CampaignServerAuth = OrganizationActor;
export type CampaignCommandContext = { channel: "FORM" | "CHAT_TOOL" | "PARAGRAPH_TOOL" | "SERVER"; serverAuth?: CampaignServerAuth; policyReview?: CampaignPolicyReview | null;
  policyReviewResolver?: (tx: Transaction, requirements: CampaignRequirementsDTO, now?: Date, actors?: EvidenceActorLocks) => Promise<CampaignPolicyReview | null> };
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
  return projectCampaignCore(tx, campaign);
}

function captureServerAuth(actorUserId: string, input?: CampaignServerAuth) {
  if (input === undefined) return undefined;
  const actor = captureOrganizationActor(input);
  if (actor.userId !== actorUserId || actor.role !== "BRAND") throw new AuthenticationInvalidated();
  return actor;
}
function withCampaignTransaction<T>(client: PrismaClient, auth: CampaignServerAuth | undefined,
  action: (tx: Transaction) => Promise<T>, options?: { maxWait: number; timeout: number }): Promise<T> {
  return client.$transaction(async tx => {
    const result = await action(tx);
    // Keep this outside the callback: replay returns require the same current
    // actual-clock session check, and expiry rolls back tentative effects.
    if (auth) await assertLockedOrganizationActor(tx, auth);
    return result;
  }, options);
}
async function authorize(tx: Transaction, actorUserId: string, beforeDomainLock?: (tx: Transaction, brand: Brand) => Promise<void>,
  auth?: CampaignServerAuth): Promise<Brand> {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actorUserId} FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: actorUserId }, select: { role: true, active: true } });
  if (!user?.active || user.role !== "BRAND") throw new CampaignError("FORBIDDEN", 403);
  const brand = await tx.brand.findUnique({ where: { userId: actorUserId } });
  if (!brand) throw new CampaignError("BRAND_PROFILE_REQUIRED");
  await beforeDomainLock?.(tx, brand);
  if (auth) {
    await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${auth.sessionId} FOR SHARE`;
    await assertLockedOrganizationActor(tx, auth);
  }
  await tx.$queryRaw`SELECT id FROM "Brand" WHERE id = ${brand.id} FOR SHARE`;
  const current = await tx.brand.findUniqueOrThrow({ where: { id: brand.id } });
  if (current.userId !== actorUserId) throw new CampaignError("NOT_FOUND", 404);
  return current;
}
export async function withOwnedCampaign<T>(client: PrismaClient, actorUserId: string, campaignId: string,
  action: (tx: Transaction, campaign: Campaign, brand: Brand) => Promise<T>, beforeDomainLock?: (tx: Transaction, brand: Brand) => Promise<void>,
  serverAuth?: CampaignServerAuth): Promise<T> {
  const auth = captureServerAuth(actorUserId, serverAuth);
  return withCampaignTransaction(client, auth, async (tx) => {
    const brand = await authorize(tx, actorUserId, beforeDomainLock, auth);
    if (!await tx.campaign.findFirst({ where: { id: campaignId, brandId: brand.id }, select: { id: true } })) throw new CampaignError("NOT_FOUND", 404);
    await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${campaignId} FOR UPDATE`;
    await assertLegacyCampaignReadable(tx, campaignId);
    const current = await tx.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    if (current.brandId !== brand.id) throw new CampaignError("NOT_FOUND", 404);
    return action(tx, current, brand);
  }, { maxWait: 10_000, timeout: 20_000 });
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
export async function createCampaign(actorUserId: string, input: unknown, client: PrismaClient = prisma,
  serverAuth?: CampaignServerAuth): Promise<{ campaign: CampaignDTO; replayed: boolean }> {
  const auth = captureServerAuth(actorUserId, serverAuth);
  checkedJson(input);
  const command = parse(CreateSchema, input), key = `create:${command.operationKey}`, hash = canonicalHash(command);
  return withCampaignTransaction(client, auth, async (tx) => {
    const brand = await authorize(tx, actorUserId, undefined, auth);
    const previous = await replay<{ campaign: CampaignDTO }>(tx, actorUserId, key, hash);
    if (previous) return { ...previous, replayed: true };
    const campaign = await createCampaignCore(tx, brand, command.fields);
    const result = { campaign: await campaignDTO(tx, campaign) };
    await journal(tx, campaign.id, actorUserId, key, hash, result);
    return { ...result, replayed: false };
  });
}
export async function getCampaign(actorUserId: string, campaignId: string, client: PrismaClient = prisma, serverAuth?: CampaignServerAuth): Promise<CampaignDTO> {
  return withOwnedCampaign(client, actorUserId, campaignId, (tx, campaign) => campaignDTO(tx, campaign), undefined, serverAuth);
}
export async function listCampaigns(actorUserId: string, input: { limit?: number; cursor?: string } = {}, client: PrismaClient = prisma,
  serverAuth?: CampaignServerAuth) {
  const auth = captureServerAuth(actorUserId, serverAuth);
  const query = parse(z.object({ limit: z.number().int().min(1).max(50).default(20), cursor: z.string().min(1).max(200).optional() }).strict(), input);
  return withCampaignTransaction(client, auth, async (tx) => {
    const brand = await authorize(tx, actorUserId, undefined, auth);
    if (query.cursor && !await tx.campaign.findFirst({ where: { id: query.cursor, brandId: brand.id, ...legacyCampaignWhere }, select: { id: true } })) throw new CampaignError("NOT_FOUND", 404);
    const rows = await tx.campaign.findMany({ where: { brandId: brand.id, ...legacyCampaignWhere }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}), select: { id: true, title: true, revision: true, status: true, currentBriefVersion: true, createdAt: true, updatedAt: true } });
    const campaigns = rows.slice(0, query.limit).map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }));
    return { campaigns, nextCursor: rows.length > query.limit ? campaigns.at(-1)!.id : null };
  });
}

export async function applyCampaignMutation(actorUserId: string, campaignId: string, input: unknown, client: PrismaClient = prisma,
  context: CampaignCommandContext = { channel: "FORM" }): Promise<{ campaign: CampaignDTO; proposalId: string | null; replayed: boolean }> {
  const auth = captureServerAuth(actorUserId, context.serverAuth);
  checkedJson(input);
  const command = parse(MutationSchema, input), key = `campaign:${campaignId}:${command.operationKey}`, hash = canonicalHash({ ...command, channel: context.channel });
  if ((command.action === "UPDATE_FIELDS" || command.action === "APPLY_PROPOSAL") && context.channel !== "FORM") throw new CampaignError("EXPLICIT_CONFIRMATION_REQUIRED", 400);
  if (command.action === "GREETING" && context.channel !== "SERVER") throw new CampaignError("FORBIDDEN", 403);
  if (command.action === "ASK_CLARIFICATION" && context.channel !== "CHAT_TOOL" && context.channel !== "SERVER") throw new CampaignError("FORBIDDEN", 403);
  return withOwnedCampaign(client, actorUserId, campaignId, async (tx, campaign, brand) => {
    const previous = await replay<{ campaign: CampaignDTO; proposalId: string | null }>(tx, actorUserId, key, hash, campaignId);
    if (previous) return { ...previous, replayed: true };
    await assertLegacyCampaignFreshWrite(tx, campaignId);
    const mutated = await mutateCampaignCore(tx, campaign, brand, command);
    const updated = mutated.campaign, proposalId = mutated.proposalId;
    const result = { campaign: await campaignDTO(tx, updated), proposalId };
    await journal(tx, campaignId, actorUserId, key, hash, result);
    return { ...result, replayed: false };
  }, undefined, auth);
}

export async function generateCampaignBrief(actorUserId: string, campaignId: string, input: unknown, client: PrismaClient = prisma,
  serverAuth?: CampaignServerAuth): Promise<{ campaign: CampaignDTO; brief: CampaignBriefDTO; replayed: boolean }> {
  const auth = captureServerAuth(actorUserId, serverAuth);
  checkedJson(input);
  const command = parse(GenerateSchema, input), key = `campaign:${campaignId}:${command.operationKey}`, hash = canonicalHash({ action: "GENERATE_BRIEF", ...command });
  return withOwnedCampaign(client, actorUserId, campaignId, async (tx, campaign, brand) => {
    const previous = await replay<{ campaign: CampaignDTO; brief: CampaignBriefDTO }>(tx, actorUserId, key, hash, campaignId);
    if (previous) return { ...previous, replayed: true };
    await assertLegacyCampaignFreshWrite(tx, campaignId);
    const { campaign: updated, brief } = await generateCampaignBriefCore(tx, campaign, brand, { expectedRevision: command.expectedRevision });
    const result = { campaign: await campaignDTO(tx, updated), brief: briefDTO(brief) };
    await journal(tx, campaignId, actorUserId, key, hash, result);
    return { ...result, replayed: false };
  }, undefined, auth);
}

export async function approveCampaignBrief(actorUserId: string, campaignId: string, input: unknown, client: PrismaClient = prisma,
  context: CampaignCommandContext = { channel: "FORM" }): Promise<{ campaign: CampaignDTO; brief: CampaignBriefDTO; replayed: boolean }> {
  const auth = captureServerAuth(actorUserId, context.serverAuth);
  checkedJson(input);
  const command = parse(ApprovalSchema, input), key = `campaign:${campaignId}:${command.operationKey}`;
  if (context.channel !== "FORM") throw new CampaignError("EXPLICIT_CONFIRMATION_REQUIRED", 400);
  const policyReview = context.policyReview ? parse(CampaignPolicyReviewSchema, context.policyReview, "INVALID_POLICY_REVIEW") : null;
  let evidenceActors: EvidenceActorLocks | undefined;
  const hash = canonicalHash({ action: "APPROVE_BRIEF", ...command, policyReview, serverPolicyResolver: context.policyReviewResolver ? "reviewed-registry-v1" : null });
  return withOwnedCampaign(client, actorUserId, campaignId, async (tx, campaign, brand) => {
    const previous = await replay<{ campaign: CampaignDTO; brief: CampaignBriefDTO }>(tx, actorUserId, key, hash, campaignId);
    if (previous) return { ...previous, replayed: true };
    await assertLegacyCampaignFreshWrite(tx, campaignId);
    const { campaign: updated, brief: approved } = await approveCampaignBriefCore(tx, campaign, brand, actorUserId, command,
      { key, policyReview, policyReviewResolver: context.policyReviewResolver, evidenceActors });
    const result = { campaign: await campaignDTO(tx, updated), brief: briefDTO(approved) };
    await journal(tx, campaignId, actorUserId, key, hash, result);
    return { ...result, replayed: false };
  }, context.policyReviewResolver ? async (tx, brand) => {
    evidenceActors = await lockEvidenceActors(tx, { brandIds: [brand.id], otherOwnerIds: [actorUserId], includePolicies: true, updateOwners: true });
  } : undefined, auth);
}

export async function getApprovedRequirements(actorUserId: string, campaignId: string, client: PrismaClient = prisma,
  serverAuth?: CampaignServerAuth): Promise<CampaignRequirementsDTO> {
  return withOwnedCampaign(client, actorUserId, campaignId, async (tx, campaign) => {
    if (!campaign.currentBriefVersion || !["BRIEF_APPROVED", "SHORTLISTED", "IN_DEALS"].includes(campaign.status)) throw new CampaignError("BRIEF_NOT_APPROVED");
    const brief = await tx.campaignBrief.findUnique({ where: { campaignId_version: { campaignId, version: campaign.currentBriefVersion } } });
    if (!brief?.approvedAt || !brief.approvedByUserId || brief.inputRevision !== stateOf(campaign).fieldsRevision) throw new CampaignError("BRIEF_NOT_APPROVED");
    return briefDTO(brief).content.requirements;
  }, undefined, serverAuth);
}
