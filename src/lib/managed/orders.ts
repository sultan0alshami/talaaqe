import { randomUUID } from "node:crypto";
import { Prisma, type ManagedOrder, type ManagedOrderSubmission } from "@prisma/client";
import { z } from "zod";
import { captureOrganizationActor, checkOrganizationActor, organizationAwait, organizationDb,
  type OrganizationActor, type OrganizationOptions } from "@/lib/organizations/context";
import { createEvidenceReceiptReader } from "@/lib/evidence/receipt-reader";
import { canonicalHash, inputJson } from "@/lib/onboarding/drafts";
import { ManagedOrderCommandSchema, ManagedOrderQuerySchema, ManagedOrderListQuerySchema, ManagedOrderSnapshotSchema,
  ManagedOrderReceiptSchema, ManagedOrderResultSchema, ManagedOrderDetailSchema, ManagedOrderHeaderSchema, ManagedOrderListSchema,
  type ManagedOrderCommand, type ManagedOrderResult, type ManagedOrderDetail, type ManagedOrderList, type ManagedOrderSnapshot,
} from "./contracts";
import { ManagedCustomerError, withManagedCustomerScope, type ManagedCustomerScopeContext } from "./customer-scope";
import { captureManagedOrderSource } from "./order-source";

type Tx = Prisma.TransactionClient;
type Checkpoint = () => void;
type Call = { actor: Readonly<OrganizationActor>; options: OrganizationOptions; checkpoint: Checkpoint };
function fail(code: string, status = 409): never { throw new ManagedCustomerError(code, status); }
const missing = (): never => fail("NOT_FOUND", 404);
const retry = (): never => fail("RETRY_REQUIRED", 503);
function capture(actor: OrganizationActor, options: OrganizationOptions): Call {
  const fixedActor = captureOrganizationActor(actor), fixedOptions = { client: organizationDb(options) };
  const reader = createEvidenceReceiptReader();
  return { actor: fixedActor, options: fixedOptions, checkpoint: () => reader.checkpoint() };
}
function inputOf<T>(packet: { success: true; data: T } | { success: false }, checkpoint: Checkpoint): T {
  checkpoint(); return packet.success ? packet.data : fail("VALIDATION", 422);
}
function hash(value: unknown, checkpoint: Checkpoint): string {
  checkpoint(); const result = canonicalHash(value); checkpoint(); return result;
}
function output<T>(schema: z.ZodType<T>, value: unknown, checkpoint: Checkpoint): T {
  checkpoint(); const packet = schema.safeParse(value); checkpoint();
  if (!packet.success || hash(packet.data, checkpoint) !== hash(value, checkpoint)) return retry();
  return packet.data;
}
function snapshotOf(submission: ManagedOrderSubmission, checkpoint: Checkpoint): ManagedOrderSnapshot {
  const snapshot = output(ManagedOrderSnapshotSchema, submission.snapshot, checkpoint);
  if (hash(snapshot, checkpoint) !== submission.snapshotHash || snapshot.brief.campaignId !== submission.campaignId
    || snapshot.brief.id !== submission.briefId || snapshot.brief.version !== submission.briefVersion
    || snapshot.brief.inputRevision !== submission.inputRevision || snapshot.brief.approvedByUserId !== submission.approvedByUserId
    || Date.parse(snapshot.brief.approvedAt) !== submission.approvedAt.getTime()
    || snapshot.provenance.selectionId !== submission.selectionId || snapshot.provenance.selectionRevision !== submission.selectionRevision
    || (snapshot.references.kind === "MANIFEST") !== (submission.contextReferenceSubmissionId !== null)) return retry();
  return snapshot;
}
async function boundCampaign(tx: Tx, frame: ManagedCustomerScopeContext, campaignId: string, checkpoint: Checkpoint) {
  const binding = await organizationAwait(checkpoint, () => tx.campaignPlanningBinding.findFirst({
    where: { campaignId, workspaceId: frame.workspaceId, brandId: frame.brandId }, select: { campaignId: true } }));
  if (!binding) return missing();
}
async function authorizedOrder(tx: Tx, frame: ManagedCustomerScopeContext, orderId: string, checkpoint: Checkpoint): Promise<ManagedOrder> {
  const first = await organizationAwait(checkpoint, () => tx.managedOrder.findFirst({
    where: { id: orderId, workspaceId: frame.workspaceId } }));
  if (!first) return missing();
  await boundCampaign(tx, frame, first.campaignId, checkpoint);
  await organizationAwait(checkpoint, () => tx.$queryRaw`SELECT id FROM "Campaign"
    WHERE id=${first.campaignId} AND "brandId"=${frame.brandId} FOR SHARE`);
  await organizationAwait(checkpoint, () => tx.$queryRaw`SELECT id FROM "ManagedOrder"
    WHERE id=${first.id} AND "workspaceId"=${frame.workspaceId} FOR SHARE`);
  const order = await organizationAwait(checkpoint, () => tx.managedOrder.findFirst({
    where: { id: first.id, workspaceId: frame.workspaceId, campaignId: first.campaignId } }));
  if (!order || order.createdAt.getTime() !== first.createdAt.getTime()) return retry();
  return order;
}
async function retainedSubmission(tx: Tx, frame: ManagedCustomerScopeContext, order: ManagedOrder,
  submissionId: string, submissionVersion: number, checkpoint: Checkpoint): Promise<ManagedOrderSubmission> {
  await organizationAwait(checkpoint, () => tx.$queryRaw`SELECT id FROM "ManagedOrderSubmission"
    WHERE id=${submissionId} AND "orderId"=${order.id} AND "workspaceId"=${frame.workspaceId} FOR SHARE`);
  const submission = await organizationAwait(checkpoint, () => tx.managedOrderSubmission.findFirst({
    where: { id: submissionId, orderId: order.id, workspaceId: frame.workspaceId, campaignId: order.campaignId, version: submissionVersion } }));
  return submission ?? retry();
}
async function replay(tx: Tx, call: Call, frame: ManagedCustomerScopeContext, command: ManagedOrderCommand, payloadHash: string): Promise<
  { found: false } | { found: true; result: ManagedOrderResult }> {
  const prior = await organizationAwait(call.checkpoint, () => tx.managedOrderCommand.findUnique({
    where: { actorUserId_operationKey: { actorUserId: call.actor.userId, operationKey: command.operationKey } } }));
  if (!prior) return { found: false };
  if (prior.workspaceId !== frame.workspaceId) return missing();
  const order = await authorizedOrder(tx, frame, prior.orderId, call.checkpoint);
  if (prior.payloadHash !== payloadHash || prior.action !== command.action || prior.campaignId !== command.campaignId) {
    return fail("IDEMPOTENCY_CONFLICT");
  }
  if (prior.campaignId !== order.campaignId || prior.submissionVersion !== 1) return retry();
  const receipt = output(ManagedOrderReceiptSchema, prior.result, call.checkpoint);
  const submission = await retainedSubmission(tx, frame, order, prior.submissionId, prior.submissionVersion, call.checkpoint);
  const snapshot = snapshotOf(submission, call.checkpoint);
  if (receipt.action !== prior.action || receipt.orderId !== order.id || receipt.submissionId !== submission.id
    || receipt.campaignId !== order.campaignId || receipt.submissionVersion !== submission.version
    || receipt.briefId !== submission.briefId || receipt.briefId !== command.briefId
    || receipt.briefVersion !== submission.briefVersion || receipt.briefVersion !== command.expectedBriefVersion
    || receipt.selectionId !== submission.selectionId || receipt.selectionId !== command.expectedSelectionId
    || receipt.selectionRevision !== submission.selectionRevision || receipt.selectionRevision !== command.expectedSelectionRevision
    || submission.campaignRevision !== command.expectedCampaignRevision || submission.planningRevision !== command.expectedPlanningRevision
    || submission.submittedByUserId !== call.actor.userId || submission.disclosureVersion !== command.disclosureVersion
    || snapshot.brief.id !== receipt.briefId || prior.createdAt.getTime() !== submission.createdAt.getTime()) return retry();
  return { found: true, result: output(ManagedOrderResultSchema, { ...receipt, replayed: true }, call.checkpoint) };
}
async function executeFresh(tx: Tx, call: Call, frame: ManagedCustomerScopeContext, command: ManagedOrderCommand,
  payloadHash: string): Promise<ManagedOrderResult> {
  // Check only the immutable scope before the duplicate-request decision. An
  // already requested campaign remains requested after its planning draft changes.
  await boundCampaign(tx, frame, command.campaignId, call.checkpoint);
  const existing = await organizationAwait(call.checkpoint, () => tx.managedOrder.findUnique({
    where: { campaignId: command.campaignId }, select: { workspaceId: true } }));
  if (existing) { if (existing.workspaceId !== frame.workspaceId) return missing(); return fail("ORDER_ALREADY_REQUESTED"); }
  const source = await captureManagedOrderSource(tx, frame, command, call.checkpoint);
  const now = new Date(), orderId = randomUUID(), submissionId = randomUUID(), commandId = randomUUID();
  const snapshotHash = hash(source.snapshot, call.checkpoint);
  const receipt = output(ManagedOrderReceiptSchema, { action: "SUBMIT", orderId, submissionId, campaignId: command.campaignId,
    revision: 1, submissionVersion: 1, briefId: command.briefId, briefVersion: command.expectedBriefVersion,
    selectionId: command.expectedSelectionId, selectionRevision: command.expectedSelectionRevision }, call.checkpoint);
  await organizationAwait(call.checkpoint, () => tx.managedOrder.create({ data: {
    id: orderId, workspaceId: frame.workspaceId, campaignId: command.campaignId, createdAt: now }, select: { id: true } }));
  await organizationAwait(call.checkpoint, () => tx.managedOrderSubmission.create({ data: {
    id: submissionId, orderId, workspaceId: frame.workspaceId, campaignId: command.campaignId, version: 1,
    briefId: command.briefId, briefVersion: command.expectedBriefVersion, inputRevision: source.inputRevision,
    campaignRevision: command.expectedCampaignRevision, planningRevision: command.expectedPlanningRevision,
    selectionId: command.expectedSelectionId, selectionRevision: command.expectedSelectionRevision,
    approvedByUserId: source.approvedByUserId, approvedAt: source.approvedAt,
    contextReferenceSubmissionId: source.contextReferenceSubmissionId, snapshot: inputJson(source.snapshot), snapshotHash,
    submittedByUserId: call.actor.userId, disclosureVersion: command.disclosureVersion, createdAt: now }, select: { id: true } }));
  await organizationAwait(call.checkpoint, () => tx.managedOrderState.create({ data: {
    orderId, workspaceId: frame.workspaceId, revision: 1, submissionId, submissionVersion: 1,
    status: "REQUESTED", createdAt: now, updatedAt: now }, select: { orderId: true } }));
  await organizationAwait(call.checkpoint, () => tx.managedOrderCommand.create({ data: {
    id: commandId, actorUserId: call.actor.userId, operationKey: command.operationKey, payloadHash,
    orderId, workspaceId: frame.workspaceId, campaignId: command.campaignId, submissionId, submissionVersion: 1,
    action: "SUBMIT", result: inputJson(receipt), createdAt: now }, select: { id: true } }));
  const type = "managed_order.requested";
  await organizationAwait(call.checkpoint, () => tx.adminAudit.create({ data: {
    actorUserId: call.actor.userId, action: type, resourceType: "ManagedOrder", resourceId: orderId,
    snapshot: inputJson(receipt), createdAt: now }, select: { id: true } }));
  await organizationAwait(call.checkpoint, () => tx.outboxEvent.create({ data: {
    deduplicationKey: "managed-order:" + commandId, type, createdAt: now, availableAt: now,
    payload: inputJson({ id: commandId, type, actorUserId: call.actor.userId, recipientUserIds: [call.actor.userId],
      aggregateType: "ManagedOrder", aggregateId: orderId, aggregateVersion: 1, occurredAt: now.toISOString(), payload: receipt }),
  }, select: { id: true } }));
  return output(ManagedOrderResultSchema, { ...receipt, replayed: false }, call.checkpoint);
}
function managedUniqueConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const model = error.meta?.modelName, target = error.meta?.target;
  return (model === "ManagedOrder" || model === "ManagedOrderCommand") && Array.isArray(target)
    && (target.includes("campaignId") || target.includes("actorUserId") && target.includes("operationKey"));
}
export async function submitManagedOrder(actor: OrganizationActor, input: unknown, options: OrganizationOptions = {}): Promise<ManagedOrderResult> {
  const packet = ManagedOrderCommandSchema.safeParse(input), call = capture(actor, options);
  await checkOrganizationActor(call.actor, call.options, call.checkpoint);
  const command = inputOf(packet, call.checkpoint);
  const payloadHash = hash({ purpose: "MANAGED_ORDER_COMMAND_V1", actorUserId: call.actor.userId, command }, call.checkpoint);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await withManagedCustomerScope(call.actor, command.scope, "signCustomer", { write: true,
        expectedAuthority: "expectedAuthority" in command ? command.expectedAuthority : undefined, checkpoint: call.checkpoint,
        replay: (tx, frame) => replay(tx, call, frame, command, payloadHash),
        execute: (tx, frame) => executeFresh(tx, call, frame, command, payloadHash),
      }, call.options);
    } catch (error) {
      // A Serializable snapshot opened before an unchanged workspace lock wait
      // can still hit the unique order/key constraint. Retry the whole native
      // transaction after rollback so current scope and the durable row decide.
      if (!managedUniqueConflict(error)) throw error;
      if (attempt === 2) return retry();
      call.checkpoint();
    }
  }
  return retry();
}
export async function getManagedOrder(actor: OrganizationActor, input: unknown, options: OrganizationOptions = {}): Promise<ManagedOrderDetail> {
  const packet = ManagedOrderQuerySchema.safeParse(input), call = capture(actor, options);
  await checkOrganizationActor(call.actor, call.options, call.checkpoint);
  const query = inputOf(packet, call.checkpoint);
  return withManagedCustomerScope(call.actor, query.scope, "view", { write: false, checkpoint: call.checkpoint,
    execute: async (tx, frame) => {
      const order = await authorizedOrder(tx, frame, query.orderId, call.checkpoint);
      await organizationAwait(call.checkpoint, () => tx.$queryRaw`SELECT "orderId" FROM "ManagedOrderState"
        WHERE "orderId"=${order.id} AND "workspaceId"=${frame.workspaceId} FOR SHARE`);
      const state = await organizationAwait(call.checkpoint, () => tx.managedOrderState.findFirst({
        where: { orderId: order.id, workspaceId: frame.workspaceId } }));
      if (!state) return retry();
      const submission = await retainedSubmission(tx, frame, order, state.submissionId, state.submissionVersion, call.checkpoint);
      const snapshot = snapshotOf(submission, call.checkpoint), asOf = new Date().toISOString();
      const result = output(ManagedOrderDetailSchema, { scope: frame.scope, currentAuthority: frame.currentAuthority, asOf, quote: null,
        order: { id: order.id, campaignId: order.campaignId, revision: state.revision, status: state.status,
          submission: { id: submission.id, version: submission.version, createdAt: submission.createdAt.toISOString(),
            disclosureVersion: submission.disclosureVersion, snapshotHash: submission.snapshotHash, snapshot } } }, call.checkpoint);
      await organizationAwait(call.checkpoint, () => tx.adminAudit.create({ data: {
        actorUserId: call.actor.userId, action: "managed_order.accessed", resourceType: "ManagedOrder", resourceId: order.id,
        snapshot: inputJson({ asOf, revision: state.revision, submissionId: submission.id, submissionVersion: submission.version }),
      }, select: { id: true } }));
      return result;
    },
  }, call.options);
}
type HeaderRow = { id: string; campaignId: string; revision: number | null; status: string | null;
  title: string | null; language: string | null; titleValid: boolean | null; languageValid: boolean | null; submittedAt: Date | null };
export async function listManagedOrders(actor: OrganizationActor, input: unknown, options: OrganizationOptions = {}): Promise<ManagedOrderList> {
  const packet = ManagedOrderListQuerySchema.safeParse(input), call = capture(actor, options);
  await checkOrganizationActor(call.actor, call.options, call.checkpoint);
  const query = inputOf(packet, call.checkpoint);
  return withManagedCustomerScope(call.actor, query.scope, "view", { write: false, checkpoint: call.checkpoint,
    execute: async (tx, frame) => {
      if (query.campaignId !== undefined) await boundCampaign(tx, frame, query.campaignId, call.checkpoint);
      if (query.after !== undefined && !await organizationAwait(call.checkpoint, () => tx.managedOrder.findFirst({
        where: { id: query.after, workspaceId: frame.workspaceId }, select: { id: true } }))) return missing();
      const after = query.after === undefined ? Prisma.empty : Prisma.sql`AND o.id COLLATE "C" > ${query.after}::text COLLATE "C"`;
      const campaign = query.campaignId === undefined ? Prisma.empty : Prisma.sql`AND o."campaignId"=${query.campaignId}`;
      // Project only scalar headers. No whole request snapshot, current context,
      // private file bytes or unsubmitted planning content is hydrated for lists.
      const rows = await organizationAwait(call.checkpoint, () => tx.$queryRaw<HeaderRow[]>(Prisma.sql`
        SELECT o.id, o."campaignId", st.revision, st.status, s."createdAt" AS "submittedAt",
          s.snapshot #>> '{brief,content,requirements,title}' AS title,
          s.snapshot #>> '{brief,content,requirements,originalLanguage}' AS language,
          jsonb_typeof(s.snapshot #> '{brief,content,requirements,title}')='string' AS "titleValid",
          jsonb_typeof(s.snapshot #> '{brief,content,requirements,originalLanguage}') IN ('string','null') AS "languageValid"
        FROM "ManagedOrder" o
        JOIN "CampaignPlanningBinding" b ON b."campaignId"=o."campaignId" AND b."workspaceId"=o."workspaceId"
        LEFT JOIN "ManagedOrderState" st ON st."orderId"=o.id AND st."workspaceId"=o."workspaceId"
        LEFT JOIN "ManagedOrderSubmission" s ON s.id=st."submissionId" AND s."orderId"=o.id
          AND s."workspaceId"=o."workspaceId" AND s."campaignId"=o."campaignId" AND s.version=st."submissionVersion"
        WHERE o."workspaceId"=${frame.workspaceId} AND b."brandId"=${frame.brandId} ${after} ${campaign}
        ORDER BY o.id COLLATE "C" ASC LIMIT ${query.limit + 1}`));
      const more = rows.length > query.limit;
      const orders = rows.slice(0, query.limit).map(row => {
        if (row.titleValid !== true || row.languageValid !== true || !(row.submittedAt instanceof Date)) return retry();
        return output(ManagedOrderHeaderSchema, { id: row.id, campaignId: row.campaignId, revision: row.revision, status: row.status,
          titleOriginal: { text: row.title, language: row.language }, submittedAt: row.submittedAt.toISOString() }, call.checkpoint);
      });
      const asOf = new Date().toISOString(), nextCursor = more ? orders.at(-1)?.id ?? retry() : null;
      const result = output(ManagedOrderListSchema, { scope: frame.scope, currentAuthority: frame.currentAuthority, asOf, orders, nextCursor }, call.checkpoint);
      await organizationAwait(call.checkpoint, () => tx.adminAudit.create({ data: {
        actorUserId: call.actor.userId, action: "managed_order.list_accessed", resourceType: "ManagedOrderList", resourceId: frame.workspaceId,
        snapshot: inputJson({ asOf, after: query.after ?? null, returned: orders.length, nextCursor }),
      }, select: { id: true } }));
      return result;
    },
  }, call.options);
}
