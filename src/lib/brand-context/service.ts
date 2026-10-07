import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { captureOrganizationActor, checkOrganizationActor, organizationAwait, organizationDb,
  type OrganizationActor, type OrganizationOptions } from "@/lib/organizations/context";
import { createEvidenceReceiptReader } from "@/lib/evidence/receipt-reader";
import { canonicalHash, inputJson } from "@/lib/onboarding/drafts";
import {
  BRAND_CONTEXT_LIMITS, ApprovedBrandContextVersionSchema, BrandContextCommandSchema,
  BrandContextCommandResultSchema, BrandContextContentSchema, BrandContextDetailQuerySchema,
  BrandContextDetailResponseSchema, BrandContextError, BrandContextHeaderSchema, BrandContextListQuerySchema,
  BrandContextListSchema, BrandContextNameSchema, BrandContextReadContextSchema, BrandContextReceiptSchema,
  BrandContextVersionQuerySchema, BrandContextVersionResponseSchema, ContextOwnerReviewCommandSchema,
  ContextOwnerReviewDetailSchema, ContextOwnerReviewQuerySchema, ContextOwnerReviewReceiptSchema,
  ContextOwnerReviewResponseSchema, ContextOwnerReviewResultSchema, ContextOwnerReviewsQuerySchema,
  ContextOwnerReviewsSchema, ContextOwnerReviewSchema, parseBrandContextInput,
  type BrandContextCommand, type BrandContextCommandResult, type BrandContextDetailResponse,
  type BrandContextList, type BrandContextVersionResponse, type ContextOwnerReviewResponse,
  type ContextOwnerReviewResult, type ContextOwnerReviews,
} from "./contracts";
import { contextParentBindingSelect, lockPlanningRows, resolvePlanningWorkspace, withBrandContextScope,
  withContextOwnerReviews, type BrandContextScopeContext, type ContextOwnerReviewBinding } from "./scope";
import { contextReferenceSourceStale } from "./reference-lineage";

export type BrandContextOptions = OrganizationOptions & { now?: Date };
type Checkpoint = () => void;
type Call = { actor: Readonly<OrganizationActor>; options: OrganizationOptions; now: Date; checkpoint: Checkpoint };
type ContextReceipt = z.infer<typeof BrandContextReceiptSchema>;
type ReviewCommand = z.infer<typeof ContextOwnerReviewCommandSchema>;
type ReviewReceipt = z.infer<typeof ContextOwnerReviewReceiptSchema>;
type Parent = Prisma.BrandContextGetPayload<{ select: typeof contextParentBindingSelect }>;
const headerSelect = { ...contextParentBindingSelect, name: true, nameLanguage: true, createdAt: true, updatedAt: true } as const;
type HeaderRecord = Prisma.BrandContextGetPayload<{ select: typeof headerSelect }>;
const versionBindingSelect = { id: true, contextId: true, workspaceId: true, submissionId: true, version: true,
  inputRevision: true, contentHash: true, approvedByUserId: true, approvedAt: true } as const;
type VersionBinding = Prisma.BrandContextVersionGetPayload<{ select: typeof versionBindingSelect }>;
const versionProjectionSelect = { ...versionBindingSelect, submission: { select: {
  id: true, contextId: true, workspaceId: true, inputRevision: true, name: true, nameLanguage: true, content: true,
  contentHash: true, state: true, decidedByUserId: true, decidedAt: true,
} } } as const;
type VersionRecord = Prisma.BrandContextVersionGetPayload<{ select: typeof versionProjectionSelect }>;

function fail(code: string, checkpoint: Checkpoint, status = 409): never {
  checkpoint(); throw new BrandContextError(code, status);
}
const retry = (checkpoint: Checkpoint): never => fail("RETRY_REQUIRED", checkpoint, 503);
const missing = (checkpoint: Checkpoint): never => fail("NOT_FOUND", checkpoint, 404);
function output<T>(schema: z.ZodType<T>, value: unknown, checkpoint: Checkpoint): T {
  checkpoint(); const parsed = schema.safeParse(value); checkpoint();
  return parsed.success ? parsed.data : retry(checkpoint);
}
function hash(value: unknown, checkpoint: Checkpoint): string {
  checkpoint(); const result = canonicalHash(value); checkpoint(); return result;
}
function iso(date: Date, checkpoint: Checkpoint): string {
  checkpoint();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return retry(checkpoint);
  const result = date.toISOString(); checkpoint(); return result;
}
async function begin(actorInput: OrganizationActor, options: BrandContextOptions): Promise<Call> {
  const actor = captureOrganizationActor(actorInput), capturedOptions = { client: organizationDb(options) };
  const requestedNow = options.now;
  const now = requestedNow === undefined ? new Date() : requestedNow instanceof Date ? new Date(requestedNow.getTime()) : null;
  const reader = createEvidenceReceiptReader(), checkpoint = () => reader.checkpoint();
  await checkOrganizationActor(actor, capturedOptions, checkpoint);
  if (!now || !Number.isFinite(now.getTime())) return fail("INVALID_CLOCK", checkpoint, 400);
  checkpoint(); return { actor, options: capturedOptions, now, checkpoint };
}
function nextRevision(current: number, expected: number, checkpoint: Checkpoint): number {
  if (current !== expected) return fail("STALE_VERSION", checkpoint);
  if (current >= 2147483646) return fail("REVISION_EXHAUSTED", checkpoint);
  checkpoint(); return current + 1;
}
function snapshot(row: { name: string; nameLanguage: string | null; content: unknown }, checkpoint: Checkpoint) {
  return { nameOriginal: output(BrandContextNameSchema, { text: row.name, language: row.nameLanguage }, checkpoint),
    content: output(BrandContextContentSchema, row.content, checkpoint) };
}
function header(row: HeaderRecord, checkpoint: Checkpoint) {
  return output(BrandContextHeaderSchema, { id: row.id, nameOriginal: { text: row.name, language: row.nameLanguage },
    revision: row.revision, inputRevision: row.inputRevision, archived: row.archived,
    createdAt: iso(row.createdAt, checkpoint), updatedAt: iso(row.updatedAt, checkpoint) }, checkpoint);
}
function readContext(context: BrandContextScopeContext, checkpoint: Checkpoint) {
  return output(BrandContextReadContextSchema, { scope: context.scope, currentAuthority: context.currentAuthority }, checkpoint);
}
function bindParent(row: Parent | null, workspaceId: string, checkpoint: Checkpoint): Parent {
  if (!row || row.workspaceId !== workspaceId) return missing(checkpoint);
  if (!Number.isInteger(row.revision) || row.revision < 1 || row.revision > 2147483646
    || !Number.isInteger(row.inputRevision) || row.inputRevision < 1 || row.inputRevision > row.revision) return retry(checkpoint);
  checkpoint(); return row;
}
async function lockParent(tx: Prisma.TransactionClient, id: string, workspaceId: string, write: boolean, checkpoint: Checkpoint) {
  bindParent(await organizationAwait(checkpoint, () => tx.brandContext.findUnique({ where: { id }, select: contextParentBindingSelect })), workspaceId, checkpoint);
  await lockPlanningRows(tx, "BrandContext", [id], write, checkpoint);
  return bindParent(await organizationAwait(checkpoint, () => tx.brandContext.findUnique({ where: { id }, select: contextParentBindingSelect })), workspaceId, checkpoint);
}
async function parentSnapshot(tx: Prisma.TransactionClient, parent: Parent, checkpoint: Checkpoint) {
  const row = await organizationAwait(checkpoint, () => tx.brandContext.findUnique({ where: { id: parent.id, workspaceId: parent.workspaceId },
    select: { name: true, nameLanguage: true, content: true } }));
  if (!row) return retry(checkpoint);
  return snapshot(row, checkpoint);
}
function contextEvent(command: BrandContextCommand): string {
  if (command.action === "SET_ARCHIVED") return command.payload.archived ? "brand_context.archived" : "brand_context.restored";
  return command.action === "CREATE" ? "brand_context.created" : command.action === "UPDATE" ? "brand_context.updated" : "brand_context.submitted";
}
async function effects(tx: Prisma.TransactionClient, call: Call, receiptId: string, type: string,
  resourceType: "BrandContext" | "BrandContextSubmission", resourceId: string, revision: number, metadata: ContextReceipt | ReviewReceipt) {
  await organizationAwait(call.checkpoint, () => tx.adminAudit.create({ data: { actorUserId: call.actor.userId, action: type,
    resourceType, resourceId, snapshot: inputJson(metadata), createdAt: call.now } }));
  await organizationAwait(call.checkpoint, () => tx.outboxEvent.create({ data: { deduplicationKey: "brand-context:" + receiptId, type,
    payload: inputJson({ id: receiptId, type, actorUserId: call.actor.userId, recipientUserIds: [call.actor.userId],
      aggregateType: resourceType, aggregateId: resourceId, aggregateVersion: revision,
      occurredAt: iso(call.now, call.checkpoint), payload: metadata }), createdAt: call.now, availableAt: call.now } }));
}
async function recordContext(tx: Prisma.TransactionClient, call: Call, command: BrandContextCommand, payloadHash: string,
  workspaceId: string, value: ContextReceipt): Promise<BrandContextCommandResult> {
  const receipt = output(BrandContextReceiptSchema, value, call.checkpoint), id = randomUUID();
  await organizationAwait(call.checkpoint, () => tx.brandContextCommand.create({ data: { id, actorUserId: call.actor.userId,
    operationKey: command.operationKey, payloadHash, contextId: receipt.contextId, workspaceId, action: command.action,
    result: inputJson(receipt), createdAt: call.now }, select: { id: true } }));
  await effects(tx, call, id, contextEvent(command), "BrandContext", receipt.contextId, receipt.revision, receipt);
  return output(BrandContextCommandResultSchema, { ...receipt, replayed: false }, call.checkpoint);
}
async function replayContext(tx: Prisma.TransactionClient, context: BrandContextScopeContext, call: Call,
  command: BrandContextCommand, payloadHash: string): Promise<{ found: false } | { found: true; result: BrandContextCommandResult }> {
  const previous = await organizationAwait(call.checkpoint, () => tx.brandContextCommand.findUnique({
    where: { actorUserId_operationKey: { actorUserId: call.actor.userId, operationKey: command.operationKey } },
    select: { contextId: true, workspaceId: true, action: true, payloadHash: true, result: true },
  }));
  if (!previous) return { found: false };
  const workspace = await resolvePlanningWorkspace(tx, context, false, call.checkpoint);
  if (!workspace || previous.workspaceId !== workspace.id) return missing(call.checkpoint);
  await lockParent(tx, previous.contextId, workspace.id, true, call.checkpoint);
  if (previous.payloadHash !== payloadHash || previous.action !== command.action
    || command.action !== "CREATE" && previous.contextId !== command.contextId) return fail("OPERATION_KEY_REUSED", call.checkpoint);
  const receipt = output(BrandContextReceiptSchema, previous.result, call.checkpoint);
  if (receipt.contextId !== previous.contextId || receipt.action !== command.action || receipt.revision !== command.expectedRevision + 1
    || command.action === "CREATE" && (receipt.inputRevision !== 1 || receipt.archived)
    || command.action === "SET_ARCHIVED" && receipt.archived !== command.payload.archived
    || command.action !== "SET_ARCHIVED" && receipt.archived) return retry(call.checkpoint);
  if (receipt.submissionId) {
    const submitted = await organizationAwait(call.checkpoint, () => tx.brandContextSubmission.findUnique({ where: { id: receipt.submissionId! },
      select: { contextId: true, workspaceId: true, inputRevision: true } }));
    if (!submitted || submitted.contextId !== receipt.contextId || submitted.workspaceId !== workspace.id
      || submitted.inputRevision !== receipt.inputRevision) return retry(call.checkpoint);
  }
  return { found: true, result: output(BrandContextCommandResultSchema, { ...receipt, replayed: true }, call.checkpoint) };
}

export async function executeBrandContextCommand(actor: OrganizationActor, input: unknown,
  options: BrandContextOptions = {}): Promise<BrandContextCommandResult> {
  const call = await begin(actor, options), command = parseBrandContextInput(BrandContextCommandSchema, input);
  const payloadHash = hash({ purpose: "BRAND_CONTEXT_COMMAND_V1", actorUserId: call.actor.userId, command }, call.checkpoint);
  return withBrandContextScope(call.actor, command.scope, "plan", { write: true, checkpoint: call.checkpoint,
    expectedAuthority: "expectedAuthority" in command ? command.expectedAuthority : undefined,
    replay: (tx, context) => replayContext(tx, context, call, command, payloadHash),
    execute: async (tx, context) => {
      const workspace = await resolvePlanningWorkspace(tx, context, true, call.checkpoint);
      if (!workspace) return retry(call.checkpoint);
      if (command.action === "CREATE") {
        const id = randomUUID();
        await organizationAwait(call.checkpoint, () => tx.brandContext.create({ data: { id, workspaceId: workspace.id,
          name: command.payload.nameOriginal.text, nameLanguage: command.payload.nameOriginal.language, content: inputJson(command.payload.content),
          revision: 1, inputRevision: 1, archived: false, createdAt: call.now, updatedAt: call.now }, select: { id: true } }));
        return recordContext(tx, call, command, payloadHash, workspace.id, { contextId: id, revision: 1, inputRevision: 1,
          action: command.action, archived: false, submissionId: null });
      }
      const parent = await lockParent(tx, command.contextId, workspace.id, true, call.checkpoint);
      const revision = nextRevision(parent.revision, command.expectedRevision, call.checkpoint);
      if (parent.archived && command.action !== "SET_ARCHIVED") return fail("ARCHIVED", call.checkpoint);
      let inputRevision = parent.inputRevision, archived = parent.archived, submissionId: string | null = null;
      let changes: Prisma.BrandContextUpdateInput = {};
      if (command.action === "UPDATE") {
        const current = await parentSnapshot(tx, parent, call.checkpoint);
        if (hash(current, call.checkpoint) !== hash(command.payload, call.checkpoint)) inputRevision = revision;
        changes = { name: command.payload.nameOriginal.text, nameLanguage: command.payload.nameOriginal.language, content: inputJson(command.payload.content) };
      } else if (command.action === "SET_ARCHIVED") {
        if (command.payload.archived === parent.archived) return fail("INVALID_STATE", call.checkpoint);
        archived = command.payload.archived; changes = { archived };
      } else {
        const current = await parentSnapshot(tx, parent, call.checkpoint);
        submissionId = randomUUID();
        await organizationAwait(call.checkpoint, () => tx.brandContextSubmission.create({ data: { id: submissionId!, contextId: parent.id,
          workspaceId: workspace.id, inputRevision, name: current.nameOriginal.text, nameLanguage: current.nameOriginal.language,
          content: inputJson(current.content), contentHash: hash(current, call.checkpoint), submittedByUserId: call.actor.userId,
          targetOwnerUserId: context.targetOwnerUserId, targetOwnerSessionVersion: context.targetOwnerSessionVersion,
          clientRevision: context.currentClientRevision, state: "PENDING", revision: 1, createdAt: call.now }, select: { id: true } }));
      }
      await organizationAwait(call.checkpoint, () => tx.brandContext.update({ where: { id: parent.id, workspaceId: workspace.id },
        data: { ...changes, revision, inputRevision, updatedAt: call.now }, select: { id: true } }));
      return recordContext(tx, call, command, payloadHash, workspace.id, { contextId: parent.id, revision, inputRevision,
        action: command.action, archived, submissionId });
    },
  }, call.options);
}

function projectVersion(row: VersionRecord, checkpoint: Checkpoint) {
  const source = row.submission, original = snapshot(source, checkpoint);
  if (source.id !== row.submissionId || source.contextId !== row.contextId || source.workspaceId !== row.workspaceId
    || source.inputRevision !== row.inputRevision || source.contentHash !== row.contentHash || source.state !== "APPROVED"
    || source.decidedByUserId !== row.approvedByUserId || !source.decidedAt
    || source.decidedAt.getTime() !== row.approvedAt.getTime() || hash(original, checkpoint) !== row.contentHash) return retry(checkpoint);
  return output(ApprovedBrandContextVersionSchema, { id: row.id, contextId: row.contextId, version: row.version,
    inputRevision: row.inputRevision, ...original, contentHash: row.contentHash, approvedAt: iso(row.approvedAt, checkpoint) }, checkpoint);
}
async function hydrateVersions(tx: Prisma.TransactionClient, versions: readonly VersionBinding[], checkpoint: Checkpoint) {
  await lockPlanningRows(tx, "BrandContextSubmission", versions.map(row => row.submissionId), false, checkpoint);
  await lockPlanningRows(tx, "BrandContextVersion", versions.map(row => row.id), false, checkpoint);
  if (!versions.length) return [];
  const rows = await organizationAwait(checkpoint, () => tx.brandContextVersion.findMany({ where: { id: { in: versions.map(row => row.id) } },
    select: versionProjectionSelect, take: BRAND_CONTEXT_LIMITS.versions }));
  return versions.map(first => {
    const row = rows.find(value => value.id === first.id);
    if (!row || row.contextId !== first.contextId || row.workspaceId !== first.workspaceId || row.submissionId !== first.submissionId
      || row.version !== first.version || row.contentHash !== first.contentHash || row.inputRevision !== first.inputRevision) return retry(checkpoint);
    return projectVersion(row, checkpoint);
  });
}
async function versionPage(tx: Prisma.TransactionClient, parent: Parent, after: string | undefined, checkpoint: Checkpoint) {
  let before: number | undefined;
  if (after !== undefined) {
    const cursor = await organizationAwait(checkpoint, () => tx.brandContextVersion.findUnique({ where: { id: after },
      select: { contextId: true, workspaceId: true, version: true } }));
    if (!cursor || cursor.contextId !== parent.id || cursor.workspaceId !== parent.workspaceId) return missing(checkpoint);
    before = cursor.version;
  }
  const where = { contextId: parent.id, workspaceId: parent.workspaceId, ...(before === undefined ? {} : { version: { lt: before } }) };
  const versions = await organizationAwait(checkpoint, () => tx.brandContextVersion.findMany({ where, orderBy: { version: "desc" },
    select: versionBindingSelect, take: BRAND_CONTEXT_LIMITS.versions }));
  const last = versions.at(-1);
  const more = last ? await organizationAwait(checkpoint, () => tx.brandContextVersion.findFirst({
    where: { ...where, version: { lt: last.version } }, select: { id: true } })) : null;
  return { versions: await hydrateVersions(tx, versions, checkpoint), versionsAfter: more && last ? last.id : null };
}

export async function listBrandContexts(actor: OrganizationActor, input: unknown,
  options: BrandContextOptions = {}): Promise<BrandContextList> {
  const call = await begin(actor, options), query = parseBrandContextInput(BrandContextListQuerySchema, input);
  return withBrandContextScope(call.actor, query.scope, "view", { write: false, checkpoint: call.checkpoint, execute: async (tx, context) => {
    const workspace = await resolvePlanningWorkspace(tx, context, false, call.checkpoint);
    if (query.after !== undefined) {
      if (!workspace) return missing(call.checkpoint);
      await lockParent(tx, query.after, workspace.id, false, call.checkpoint);
    }
    const where = { workspaceId: workspace?.id, archived: query.archived, ...(query.after === undefined ? {} : { id: { gt: query.after } }) };
    const rows = workspace ? await organizationAwait(call.checkpoint, () => tx.brandContext.findMany({
      where, select: headerSelect, orderBy: { id: "asc" }, take: query.limit,
    })) : [];
    const last = rows.at(-1);
    const more = workspace && last ? await organizationAwait(call.checkpoint, () => tx.brandContext.findFirst({
      where: { ...where, id: { gt: last.id } }, select: { id: true } })) : null;
    return output(BrandContextListSchema, { ...readContext(context, call.checkpoint), asOf: iso(call.now, call.checkpoint),
      contexts: rows.map(row => header(row, call.checkpoint)), nextCursor: more && last ? last.id : null }, call.checkpoint);
  } }, call.options);
}
export async function getBrandContext(actor: OrganizationActor, input: unknown,
  options: BrandContextOptions = {}): Promise<BrandContextDetailResponse> {
  const call = await begin(actor, options), query = parseBrandContextInput(BrandContextDetailQuerySchema, input);
  return withBrandContextScope(call.actor, query.scope, "view", { write: false, checkpoint: call.checkpoint, execute: async (tx, context) => {
    const workspace = await resolvePlanningWorkspace(tx, context, false, call.checkpoint);
    if (!workspace) return missing(call.checkpoint);
    const parent = await lockParent(tx, query.contextId, workspace.id, false, call.checkpoint);
    const row = await organizationAwait(call.checkpoint, () => tx.brandContext.findUnique({ where: { id: parent.id, workspaceId: workspace.id },
      select: { ...headerSelect, content: true } }));
    if (!row) return retry(call.checkpoint);
    const content = output(BrandContextContentSchema, row.content, call.checkpoint);
    const versions = await versionPage(tx, parent, query.versionsAfter, call.checkpoint);
    return output(BrandContextDetailResponseSchema, { ...readContext(context, call.checkpoint), asOf: iso(call.now, call.checkpoint),
      context: { ...header(row, call.checkpoint), content, ...versions } }, call.checkpoint);
  } }, call.options);
}
export async function getApprovedBrandContextVersion(actor: OrganizationActor, input: unknown,
  options: BrandContextOptions = {}): Promise<BrandContextVersionResponse> {
  const call = await begin(actor, options), query = parseBrandContextInput(BrandContextVersionQuerySchema, input);
  return withBrandContextScope(call.actor, query.scope, "view", { write: false, checkpoint: call.checkpoint, execute: async (tx, context) => {
    const workspace = await resolvePlanningWorkspace(tx, context, false, call.checkpoint);
    if (!workspace) return missing(call.checkpoint);
    const version = await organizationAwait(call.checkpoint, () => tx.brandContextVersion.findUnique({ where: { id: query.versionId }, select: versionBindingSelect }));
    if (!version || version.workspaceId !== workspace.id) return missing(call.checkpoint);
    await lockParent(tx, version.contextId, workspace.id, false, call.checkpoint);
    const projected = await hydrateVersions(tx, [version], call.checkpoint);
    if (projected.length !== 1) return retry(call.checkpoint);
    return output(BrandContextVersionResponseSchema, { ...readContext(context, call.checkpoint), asOf: iso(call.now, call.checkpoint), version: projected[0] }, call.checkpoint);
  } }, call.options);
}

async function sourceStale(tx: Prisma.TransactionClient, binding: ContextOwnerReviewBinding, checkpoint: Checkpoint): Promise<boolean> {
  const stale = binding.context.archived || binding.context.inputRevision !== binding.submission.inputRevision
    || binding.submission.targetOwnerSessionVersion !== binding.targetOwnerSessionVersion
    || binding.submission.clientRevision !== binding.currentClientRevision;
  checkpoint(); return stale || await contextReferenceSourceStale(tx, binding.context.id, binding.workspace.id, binding.submission.id, checkpoint);
}
async function reviewHeader(tx: Prisma.TransactionClient, binding: ContextOwnerReviewBinding, checkpoint: Checkpoint) {
  const source = await organizationAwait(checkpoint, () => tx.brandContextSubmission.findUnique({ where: { id: binding.submission.id },
    select: { id: true, contextId: true, workspaceId: true, name: true, nameLanguage: true } }));
  if (!source || source.contextId !== binding.context.id || source.workspaceId !== binding.workspace.id) return retry(checkpoint);
  const version = await organizationAwait(checkpoint, () => tx.brandContextVersion.findUnique({ where: { submissionId: source.id },
    select: { id: true, contextId: true, workspaceId: true } }));
  if (version && (version.contextId !== binding.context.id || version.workspaceId !== binding.workspace.id)) return retry(checkpoint);
  const stale = await sourceStale(tx, binding, checkpoint), submission = binding.submission;
  return output(ContextOwnerReviewSchema, { id: submission.id, contextId: submission.contextId, scope: binding.scope,
    nameOriginal: { text: source.name, language: source.nameLanguage }, inputRevision: submission.inputRevision,
    revision: submission.revision, state: submission.state, sourceStale: stale,
    approvalAvailable: submission.state === "PENDING" && !stale, createdAt: iso(submission.createdAt, checkpoint),
    decidedAt: submission.decidedAt ? iso(submission.decidedAt, checkpoint) : null, versionId: version?.id ?? null }, checkpoint);
}
async function reviewSnapshot(tx: Prisma.TransactionClient, binding: ContextOwnerReviewBinding, checkpoint: Checkpoint) {
  const row = await organizationAwait(checkpoint, () => tx.brandContextSubmission.findUnique({ where: { id: binding.submission.id },
    select: { id: true, contextId: true, workspaceId: true, inputRevision: true, name: true, nameLanguage: true, content: true, contentHash: true } }));
  if (!row || row.contextId !== binding.context.id || row.workspaceId !== binding.workspace.id
    || row.inputRevision !== binding.submission.inputRevision || row.contentHash !== binding.submission.contentHash) return retry(checkpoint);
  const original = snapshot(row, checkpoint);
  if (hash(original, checkpoint) !== row.contentHash) return retry(checkpoint);
  return { ...original, contentHash: row.contentHash };
}
function inboxWhere(actor: OrganizationActor): Prisma.BrandContextSubmissionWhereInput {
  return { targetOwnerUserId: actor.userId, context: { workspace: { brand: { userId: actor.userId }, OR: [
    { scope: "OWN_BRAND" }, { scope: "CLIENT", client: { is: {
      state: "ACTIVE", authorizingUserId: actor.userId, authorizingSessionVersion: actor.sessionVersion,
      allowedCapabilities: { path: ["plan"], equals: true },
      organization: { active: true, owner: { active: true, role: "BRAND" } },
    } } },
  ] } } };
}
export async function listContextOwnerReviews(actor: OrganizationActor, input: unknown = {},
  options: BrandContextOptions = {}): Promise<ContextOwnerReviews> {
  const call = await begin(actor, options), query = parseBrandContextInput(ContextOwnerReviewsQuerySchema, input);
  const where = inboxWhere(call.actor);
  let cursor: string | undefined;
  if (query.after !== undefined) {
    const current = await organizationAwait(call.checkpoint, () => organizationDb(call.options).brandContextSubmission.findFirst({
      where: { ...where, id: query.after }, select: { id: true },
    }));
    if (!current) return missing(call.checkpoint);
    cursor = current.id;
  }
  const candidates = await organizationAwait(call.checkpoint, () => organizationDb(call.options).brandContextSubmission.findMany({
    where: { ...where, ...(cursor === undefined ? {} : { id: { gt: cursor } }) }, select: { id: true },
    orderBy: { id: "asc" }, take: query.limit + 1,
  }));
  const ids = [...candidates.map(row => row.id), ...(cursor === undefined ? [] : [cursor])];
  return withContextOwnerReviews(call.actor, ids, false, async (tx, bindings) => {
    if (ids.some(id => !bindings.has(id))) return retry(call.checkpoint);
    const selected = candidates.slice(0, query.limit), reviews = [];
    for (const row of selected) reviews.push(await reviewHeader(tx, bindings.get(row.id)!, call.checkpoint));
    return output(ContextOwnerReviewsSchema, { asOf: iso(call.now, call.checkpoint), reviews,
      nextCursor: candidates.length > query.limit ? selected.at(-1)!.id : null }, call.checkpoint);
  }, call.options, call.checkpoint);
}
export async function getContextOwnerReview(actor: OrganizationActor, input: unknown,
  options: BrandContextOptions = {}): Promise<ContextOwnerReviewResponse> {
  const call = await begin(actor, options), query = parseBrandContextInput(ContextOwnerReviewQuerySchema, input);
  return withContextOwnerReviews(call.actor, [query.submissionId], false, async (tx, bindings) => {
    const binding = bindings.get(query.submissionId);
    if (!binding) return missing(call.checkpoint);
    const metadata = await reviewHeader(tx, binding, call.checkpoint), original = await reviewSnapshot(tx, binding, call.checkpoint);
    const review = output(ContextOwnerReviewDetailSchema, { ...metadata, content: original.content, contentHash: original.contentHash }, call.checkpoint);
    return output(ContextOwnerReviewResponseSchema, { asOf: iso(call.now, call.checkpoint), review }, call.checkpoint);
  }, call.options, call.checkpoint);
}

async function replayReview(tx: Prisma.TransactionClient, bindings: ReadonlyMap<string, ContextOwnerReviewBinding>, call: Call,
  command: ReviewCommand, payloadHash: string, capturedIds: ReadonlySet<string>): Promise<ContextOwnerReviewResult | null> {
  const previous = await organizationAwait(call.checkpoint, () => tx.planningReviewCommand.findUnique({
    where: { actorUserId_operationKey: { actorUserId: call.actor.userId, operationKey: command.operationKey } },
    select: { workspaceId: true, contextSubmissionId: true, campaignSubmissionId: true, action: true, payloadHash: true, result: true },
  }));
  if (!previous) return null;
  // A concurrent different-resource receipt needs a new bounded preflight,
  // never a Context/User lock after the batch's Submission locks.
  if (previous.contextSubmissionId && !capturedIds.has(previous.contextSubmissionId)) return retry(call.checkpoint);
  const original = previous.contextSubmissionId ? bindings.get(previous.contextSubmissionId) : undefined;
  if (previous.contextSubmissionId && (!original || original.workspace.id !== previous.workspaceId)) return missing(call.checkpoint);
  if (!original || previous.campaignSubmissionId !== null || previous.contextSubmissionId !== command.submissionId
    || previous.action !== command.decision || previous.payloadHash !== payloadHash) return fail("OPERATION_KEY_REUSED", call.checkpoint);
  const receipt = output(ContextOwnerReviewReceiptSchema, previous.result, call.checkpoint);
  if (receipt.submissionId !== command.submissionId || receipt.contextId !== original.context.id
    || receipt.revision !== command.expectedRevision + 1 || original.submission.revision !== receipt.revision || original.submission.state !== receipt.state
    || receipt.state !== (command.decision === "APPROVE" ? "APPROVED" : "DECLINED")) return retry(call.checkpoint);
  if (receipt.versionId !== null) {
    const version = await organizationAwait(call.checkpoint, () => tx.brandContextVersion.findUnique({ where: { submissionId: command.submissionId },
      select: { id: true, version: true, contextId: true, workspaceId: true } }));
    if (!version || version.id !== receipt.versionId || version.version !== receipt.version
      || version.contextId !== receipt.contextId || version.workspaceId !== original.workspace.id) return retry(call.checkpoint);
  }
  return output(ContextOwnerReviewResultSchema, { ...receipt, replayed: true }, call.checkpoint);
}
async function recordReview(tx: Prisma.TransactionClient, call: Call, binding: ContextOwnerReviewBinding,
  command: ReviewCommand, payloadHash: string, value: ReviewReceipt): Promise<ContextOwnerReviewResult> {
  const receipt = output(ContextOwnerReviewReceiptSchema, value, call.checkpoint), id = randomUUID();
  await organizationAwait(call.checkpoint, () => tx.planningReviewCommand.create({ data: { id, actorUserId: call.actor.userId,
    operationKey: command.operationKey, payloadHash, workspaceId: binding.workspace.id, contextSubmissionId: command.submissionId,
    campaignSubmissionId: null, action: command.decision, result: inputJson(receipt), createdAt: call.now }, select: { id: true } }));
  await effects(tx, call, id, command.decision === "APPROVE" ? "brand_context.review_approved" : "brand_context.review_declined",
    "BrandContextSubmission", receipt.submissionId, receipt.revision, receipt);
  return output(ContextOwnerReviewResultSchema, { ...receipt, replayed: false }, call.checkpoint);
}
export async function decideContextOwnerReview(actor: OrganizationActor, input: unknown,
  options: BrandContextOptions = {}): Promise<ContextOwnerReviewResult> {
  const call = await begin(actor, options), command = parseBrandContextInput(ContextOwnerReviewCommandSchema, input);
  const payloadHash = hash({ purpose: "BRAND_CONTEXT_OWNER_REVIEW_V1", actorUserId: call.actor.userId, command }, call.checkpoint);
  // Capture receipt identity only; reread history under current target authority.
  const known = await organizationAwait(call.checkpoint, () => organizationDb(call.options).planningReviewCommand.findUnique({
    where: { actorUserId_operationKey: { actorUserId: call.actor.userId, operationKey: command.operationKey } },
    select: { contextSubmissionId: true },
  }));
  const ids = [command.submissionId, ...(known?.contextSubmissionId ? [known.contextSubmissionId] : [])];
  const capturedIds = new Set(ids);
  return withContextOwnerReviews(call.actor, ids, true, async (tx, bindings) => {
    const binding = bindings.get(command.submissionId);
    if (!binding) return missing(call.checkpoint);
    const replay = await replayReview(tx, bindings, call, command, payloadHash, capturedIds);
    if (replay) return replay;
    const revision = nextRevision(binding.submission.revision, command.expectedRevision, call.checkpoint);
    if (binding.submission.state !== "PENDING") return fail("REVIEW_DECIDED", call.checkpoint);
    if (command.decision === "APPROVE" && await sourceStale(tx, binding, call.checkpoint)) return fail("STALE_REVIEW", call.checkpoint);
    let version: number | null = null, versionId: string | null = null;
    if (command.decision === "APPROVE") {
      await reviewSnapshot(tx, binding, call.checkpoint);
      const latest = await organizationAwait(call.checkpoint, () => tx.brandContextVersion.findFirst({
        where: { contextId: binding.context.id, workspaceId: binding.workspace.id }, orderBy: { version: "desc" }, select: { version: true },
      }));
      if (latest && latest.version >= 2147483646) return fail("REVISION_EXHAUSTED", call.checkpoint);
      version = (latest?.version ?? 0) + 1; versionId = randomUUID();
    }
    const state = command.decision === "APPROVE" ? "APPROVED" : "DECLINED";
    await organizationAwait(call.checkpoint, () => tx.brandContextSubmission.update({ where: { id: command.submissionId },
      data: { state, revision, decidedByUserId: call.actor.userId, decidedAt: call.now }, select: { id: true } }));
    if (versionId !== null && version !== null) {
      const id = versionId, ordinal = version;
      await organizationAwait(call.checkpoint, () => tx.brandContextVersion.create({ data: { id, contextId: binding.context.id,
        workspaceId: binding.workspace.id, submissionId: binding.submission.id, version: ordinal,
        inputRevision: binding.submission.inputRevision, contentHash: binding.submission.contentHash,
        approvedByUserId: call.actor.userId, approvedAt: call.now, createdAt: call.now }, select: { id: true } }));
    }
    return recordReview(tx, call, binding, command, payloadHash, { submissionId: command.submissionId, contextId: binding.context.id,
      revision, state, versionId, version });
  }, call.options, call.checkpoint);
}
