// DB-only private manual organizer. Native sessions remain server dependencies.
import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type ExternalCollaboration } from "@prisma/client";
import { z } from "zod";
import { captureOrganizationActor, type OrganizationActor } from "@/lib/organizations/context";
import { OrganizationIdSchema as id } from "@/lib/organizations/contracts";
import { beginOnboardingSession, withOnboardingSession, lockOnboardingSession, assertOnboardingSession } from "@/lib/onboarding/session";
import { inspectEvidence, type EvidenceStorage } from "@/lib/evidence/storage";
import { canonicalHash, inputJson } from "@/lib/onboarding/drafts";
import { planningPlainJsonSchema } from "@/lib/planning/output-contracts";
import { ExternalCollaborationError, ExternalCollaborationCommandSchema, ExternalCollaborationDetailsSchema,
  ExternalCollaborationReceiptSchema, ExternalCollaborationResultSchema, ExternalCollaborationHeaderSchema,
  ExternalCollaborationAttachmentSchema, ExternalCollaborationDetailSchema, ExternalCollaborationListSchema,
  EXTERNAL_COLLABORATION_ATTACHMENT_PURPOSE as purpose, EXTERNAL_COLLABORATION_LIMITS as limits,
  canTransitionExternalCollaboration, externalCollaborationCommandHash,
  type ExternalCollaborationCommand, type ExternalCollaborationDetails, type ExternalCollaborationReceipt,
  type ExternalCollaborationResult, type ExternalCollaborationAttachment, type ExternalCollaborationDetail,
  type ExternalCollaborationList } from "./contracts";

type Options = { client?: PrismaClient };
type FileOptions = Options & { storage: EvidenceStorage };
function captureStorage(storage: EvidenceStorage): EvidenceStorage {
  return Object.freeze({ kind: storage.kind, put: storage.put.bind(storage), get: storage.get.bind(storage), remove: storage.remove.bind(storage) });
}
type Tx = Prisma.TransactionClient;
type Parent = ExternalCollaboration & { details: ExternalCollaborationDetails };
const fail = (code: string, status = 409): never => { throw new ExternalCollaborationError(code, status); };
const corrupt = (): never => fail("INVALID_STORED_COLLABORATION", 503);
function stored<T>(schema: z.ZodType<T>, value: unknown): T { const parsed = schema.safeParse(value); return parsed.success ? parsed.data : corrupt(); }
function iso(date: Date) { return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : corrupt(); }
const equal = (left: unknown, right: unknown) => canonicalHash(left) === canonicalHash(right);
const getQuery = planningPlainJsonSchema(z.object({ collaborationId: id }).strict(), 4096);
const listQuery = planningPlainJsonSchema(z.object({ archived: z.boolean(), after: id.optional() }).strict(), 4096);
const thin = { id: true, ownerUserId: true } as const;
async function session(actor: OrganizationActor, options: Options) {
  const captured = captureOrganizationActor(actor), client = options.client;
  const value = await beginOnboardingSession(captured.userId, { serverAuth: captured, client });
  if (value.actor.role !== "CREATOR") return fail("FORBIDDEN", 403);
  return value;
}
async function ownerLocks(tx: Tx, ownerUserId: string) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${ownerUserId} FOR UPDATE`;
  await lockOnboardingSession(tx);
}
async function parent(tx: Tx, ownerUserId: string, collaborationId: string, write: boolean, locator = false): Promise<Parent> {
  const reference = await tx.externalCollaboration.findFirst({ where: { id: collaborationId, ownerUserId }, select: thin });
  if (!reference) return locator ? corrupt() : fail("NOT_FOUND", 404);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "ExternalCollaboration" WHERE id=${reference.id} AND "ownerUserId"=${ownerUserId}
    ${Prisma.raw(write ? "FOR UPDATE" : "FOR SHARE")}`);
  const row = await tx.externalCollaboration.findFirst({ where: { id: reference.id, ownerUserId } });
  if (!row || row.id !== collaborationId || row.ownerUserId !== ownerUserId) return corrupt();
  const details = stored(ExternalCollaborationDetailsSchema, row.detailsJson);
  stored(ExternalCollaborationDetailSchema, { scope: "OWN_CREATOR", asOf: new Date().toISOString(),
    collaboration: { id: row.id, revision: row.revision, status: row.status, archived: row.archived, details,
      createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) }, attachments: [] });
  return { ...row, details };
}
const bindingSelect = { id: true, collaborationId: true, ownerUserId: true, assetId: true, assetPurpose: true,
  attachedAt: true, removedAt: true } as const;
type Binding = Prisma.ExternalCollaborationAttachmentGetPayload<{ select: typeof bindingSelect }>;
async function binding(tx: Tx, ownerUserId: string, collaborationId: string, attachmentId: string, write: boolean): Promise<Binding> {
  const reference = await tx.externalCollaborationAttachment.findFirst({ where: { id: attachmentId, ownerUserId, collaborationId }, select: bindingSelect });
  if (!reference) return fail("NOT_FOUND", 404);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "ExternalCollaborationAttachment" WHERE id=${reference.id}
    AND "ownerUserId"=${ownerUserId} AND "collaborationId"=${collaborationId} ${Prisma.raw(write ? "FOR UPDATE" : "FOR SHARE")}`);
  const value = await tx.externalCollaborationAttachment.findFirst({ where: { id: reference.id, ownerUserId, collaborationId }, select: bindingSelect });
  if (!value || value.assetId !== reference.assetId || value.assetPurpose !== purpose || !equal({ ...value, attachedAt: iso(value.attachedAt),
    removedAt: value.removedAt ? iso(value.removedAt) : null }, { ...reference, attachedAt: iso(reference.attachedAt), removedAt: reference.removedAt ? iso(reference.removedAt) : null })) return corrupt();
  return value;
}
async function attachmentValues(tx: Tx, ownerUserId: string, collaborationId: string, pins: readonly Binding[]) {
  if (!pins.length) return { values: [] as ExternalCollaborationAttachment[], assets: [] as Prisma.PrivateAssetGetPayload<{ select: typeof assetSelect }>[] };
  const ids = pins.map(row => row.id), assetIds = [...new Set(pins.map(row => row.assetId))].sort();
  if (assetIds.length !== pins.length || pins.some(row => row.ownerUserId !== ownerUserId || row.collaborationId !== collaborationId || row.assetPurpose !== purpose)) return corrupt();
  const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "PrivateAsset" WHERE id IN (${Prisma.join(assetIds)})
    AND "ownerUserId"=${ownerUserId} AND purpose=${purpose} ORDER BY id COLLATE "C" FOR SHARE`);
  if (!equal(locked.map(row => row.id), assetIds)) return corrupt();
  const rows = await tx.externalCollaborationAttachment.findMany({ where: { id: { in: ids }, ownerUserId, collaborationId },
    select: { ...bindingSelect, label: true }, take: pins.length });
  const assets = await tx.privateAsset.findMany({ where: { id: { in: assetIds }, ownerUserId, purpose }, select: assetSelect, take: assetIds.length });
  if (rows.length !== pins.length || assets.length !== assetIds.length) return corrupt();
  const values = pins.map(pin => {
    const row = rows.find(value => value.id === pin.id), asset = assets.find(value => value.id === pin.assetId);
    if (!row || !asset || row.assetId !== pin.assetId || row.assetPurpose !== purpose || row.ownerUserId !== ownerUserId || row.collaborationId !== collaborationId
      || iso(row.attachedAt) !== iso(pin.attachedAt) || (row.removedAt ? iso(row.removedAt) : null) !== (pin.removedAt ? iso(pin.removedAt) : null)
      || asset.ownerUserId !== ownerUserId || asset.purpose !== purpose || !/^[a-f0-9]{64}$/.test(asset.checksum)) return corrupt();
    return stored(ExternalCollaborationAttachmentSchema, { id: row.id, assetId: asset.id, assetRevision: asset.revision,
      label: row.label, contentType: asset.contentType, size: asset.size, attachedAt: iso(row.attachedAt) });
  });
  return { values, assets };
}
const assetSelect = { id: true, ownerUserId: true, purpose: true, revision: true, contentType: true, size: true, checksum: true } as const;
async function replay(tx: Tx, actorUserId: string, command: ExternalCollaborationCommand, digest: string, current: Parent): Promise<ExternalCollaborationResult | null> {
  const first = await tx.externalCollaborationCommand.findUnique({ where: { actorUserId_operationKey: { actorUserId, operationKey: command.operationKey } },
    select: { id: true, actorUserId: true, operationKey: true, collaborationId: true, action: true, payloadHash: true, createdAt: true } });
  if (!first) return null;
  // Parent authorization/lock already exists. Lock only this original journal
  // identity, then reload; a new owner or replacement journal is never followed.
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "ExternalCollaborationCommand"
    WHERE id=${first.id} AND "actorUserId"=${actorUserId} AND "operationKey"=${command.operationKey}::uuid FOR SHARE`;
  if (locked.length !== 1 || locked[0]!.id !== first.id) return corrupt();
  if (first.collaborationId !== current.id) return fail("IDEMPOTENCY_CONFLICT");
  const row = await tx.externalCollaborationCommand.findFirst({ where: { id: first.id, actorUserId,
    operationKey: command.operationKey, collaborationId: current.id } });
  if (!row) return corrupt();
  const { resultJson: body, ...metadata } = row;
  if (!equal({ ...metadata, createdAt: iso(metadata.createdAt) }, { ...first, createdAt: iso(first.createdAt) })) return corrupt();
  if (row.actorUserId !== actorUserId || row.operationKey.toLowerCase() !== command.operationKey.toLowerCase() || !/^[a-f0-9]{64}$/.test(row.payloadHash)) return corrupt();
  if (row.payloadHash !== digest || row.action !== command.action || row.collaborationId !== current.id) return fail("IDEMPOTENCY_CONFLICT");
  const receipt = stored(ExternalCollaborationReceiptSchema, body);
  if (receipt.operationKey !== command.operationKey || receipt.collaborationId !== row.collaborationId || receipt.action !== row.action
    || receipt.revision !== (command.action === "CREATE" ? 1 : command.expectedRevision + 1) || receipt.revision > current.revision
    || row.createdAt < current.createdAt || row.createdAt > new Date()) return corrupt();
  // Status/archive are historical; they never have to match the current parent.
  if (receipt.attachmentId !== null) {
    let pin: Binding;
    try { pin = await binding(tx, actorUserId, current.id, receipt.attachmentId, false); }
    catch (error) { if (error instanceof ExternalCollaborationError && error.code === "NOT_FOUND") return corrupt(); throw error; }
    if (command.action === "REMOVE_ATTACHMENT") {
      if (receipt.attachmentId !== command.payload.attachmentId || !pin.removedAt || pin.removedAt > row.createdAt) return corrupt();
    } else if (command.action === "ATTACH_FILE") {
      const { values, assets } = await attachmentValues(tx, actorUserId, current.id, [pin]), asset = assets[0];
      if (!asset || !equal(values[0]!.label, command.payload.label) || asset.checksum !== command.payload.file.checksum
        || asset.contentType !== command.payload.file.contentType || asset.size !== command.payload.file.size || pin.attachedAt > row.createdAt) return corrupt();
    } else return corrupt();
  }
  return stored(ExternalCollaborationResultSchema, { ...receipt, replayed: true });
}
function preserveChecklistIds(previous: ExternalCollaborationDetails, next: ExternalCollaborationDetails): ExternalCollaborationDetails {
  return { ...next, checklist: next.checklist.map(item => ({ ...item,
    id: previous.checklist.find(old => old.id.toLowerCase() === item.id.toLowerCase())?.id ?? item.id })) };
}
async function writeRecords(tx: Tx, actorUserId: string, command: ExternalCollaborationCommand, digest: string,
  receipt: ExternalCollaborationReceipt, ids: { command: string; audit: string; event: string }, at: Date) {
  await tx.externalCollaborationCommand.create({ data: { id: ids.command, actorUserId, operationKey: command.operationKey,
    collaborationId: receipt.collaborationId, action: command.action, payloadHash: digest, resultJson: inputJson(receipt), createdAt: at } });
  await tx.adminAudit.create({ data: { id: ids.audit, actorUserId, action: "external_collaboration.command", resourceType: "ExternalCollaboration",
    resourceId: receipt.collaborationId, snapshot: inputJson(receipt), createdAt: at } });
  const type = "external_collaboration.changed";
  await tx.outboxEvent.create({ data: { id: ids.event, deduplicationKey: "external-collaboration:" + actorUserId + ":" + command.operationKey,
    type, payload: inputJson({ id: ids.event, type, idempotencyKey: command.operationKey, actorUserId, recipientUserIds: [actorUserId], aggregateType: "ExternalCollaboration",
      aggregateId: receipt.collaborationId, aggregateVersion: receipt.revision, occurredAt: at.toISOString(),
      payload: { action: receipt.action, status: receipt.status, archived: receipt.archived, attachmentId: receipt.attachmentId } }),
    createdAt: at, availableAt: at } });
}
export async function executeExternalCollaborationCommand(actor: OrganizationActor, input: unknown, options: Options = {}): Promise<ExternalCollaborationResult> {
  const captured = ExternalCollaborationCommandSchema.safeParse(input), auth = await session(actor, options);
  if (!captured.success) return fail("VALIDATION", 422);
  const command = captured.data, actorUserId = auth.actor.userId, digest = externalCollaborationCommandHash(actorUserId, command),
    ids = { parent: randomUUID(), command: randomUUID(), audit: randomUUID(), event: randomUUID() };
  return withOnboardingSession(auth, true, async tx => {
    await ownerLocks(tx, actorUserId);
    let current: Parent;
    if (command.action === "CREATE") {
      const locator = await tx.externalCollaborationCommand.findUnique({ where: { actorUserId_operationKey: { actorUserId, operationKey: command.operationKey } },
        select: { id: true, collaborationId: true } });
      if (locator) {
        current = await parent(tx, actorUserId, locator.collaborationId, true, true);
        const prior = await replay(tx, actorUserId, command, digest, current); return prior ?? corrupt();
      }
      const at = new Date();
      await tx.externalCollaboration.create({ data: { id: ids.parent, ownerUserId: actorUserId, revision: 1, status: "DRAFT", archived: false,
        detailsJson: inputJson(command.payload.details), createdAt: at, updatedAt: at } });
      current = await parent(tx, actorUserId, ids.parent, true);
    } else {
      current = await parent(tx, actorUserId, command.collaborationId, true);
      const prior = await replay(tx, actorUserId, command, digest, current); if (prior) return prior;
      if (command.expectedRevision !== current.revision) return fail("STALE_VERSION");
      if (current.archived && command.action !== "RESTORE") return fail("INVALID_STATE");
      if (command.action === "ATTACH_FILE") return fail("CAPABILITY_UNAVAILABLE", 503);
      if (current.revision >= 2147483646) return fail("VERSION_EXHAUSTED");
      if (command.action === "REMOVE_ATTACHMENT") {
        const pin = await binding(tx, actorUserId, current.id, command.payload.attachmentId, true);
        if (pin.removedAt !== null) return fail("INVALID_STATE");
        const changed = await tx.externalCollaborationAttachment.updateMany({ where: { id: pin.id, collaborationId: current.id, ownerUserId: actorUserId,
          removedAt: null }, data: { removedAt: new Date() } });
        if (changed.count !== 1) return fail("STALE_VERSION");
        // Native child touch increments exactly once; no explicit parent UPDATE.
        const next = await parent(tx, actorUserId, current.id, true);
        if (next.revision !== current.revision + 1) return corrupt(); current = next;
      } else {
        let details = current.details, status = current.status, archived = current.archived;
        switch (command.action) {
          case "SAVE_DETAILS": details = preserveChecklistIds(current.details, command.payload.details); break;
          case "SET_CHECKLIST": details = preserveChecklistIds(current.details, { ...current.details, checklist: command.payload.checklist }); break;
          case "SET_CHECKLIST_DONE": {
            const item = details.checklist.find(value => value.id.toLowerCase() === command.payload.itemId.toLowerCase());
            if (!item) return fail("NOT_FOUND", 404);
            details = { ...details, checklist: details.checklist.map(value => value.id === item.id ? { ...value, done: command.payload.done } : value) }; break;
          }
          case "SET_STATUS": if (!canTransitionExternalCollaboration(status, command.payload.status)) return fail("INVALID_STATE"); status = command.payload.status; break;
          case "ARCHIVE": archived = true; break;
          case "RESTORE": archived = false; break;
        }
        if (equal(details, current.details) && status === current.status && archived === current.archived) return fail("INVALID_STATE");
        const changed = await tx.externalCollaboration.updateMany({ where: { id: current.id, ownerUserId: actorUserId, revision: current.revision },
          data: { detailsJson: inputJson(details), status, archived, revision: current.revision + 1, updatedAt: new Date() } });
        if (changed.count !== 1) return fail("STALE_VERSION"); current = await parent(tx, actorUserId, current.id, true);
      }
    }
    const receipt = stored(ExternalCollaborationReceiptSchema, { operationKey: command.operationKey, collaborationId: current.id,
      action: command.action, revision: current.revision, status: current.status, archived: current.archived,
      attachmentId: command.action === "REMOVE_ATTACHMENT" ? command.payload.attachmentId : null });
    await writeRecords(tx, actorUserId, command, digest, receipt, ids, new Date());
    return stored(ExternalCollaborationResultSchema, { ...receipt, replayed: false });
  });
}
async function readAudit(tx: Tx, actorUserId: string, action: "read" | "list", resourceId: string, snapshot: unknown, auditId: string) {
  await tx.adminAudit.create({ data: { id: auditId, actorUserId, action: "external_collaboration." + action,
    resourceType: action === "read" ? "ExternalCollaboration" : "ExternalCollaborationList", resourceId, snapshot: inputJson(snapshot) } });
}
export async function getExternalCollaboration(actor: OrganizationActor, input: { collaborationId: string }, options: Options = {}): Promise<ExternalCollaborationDetail> {
  const captured = getQuery.safeParse(input), auth = await session(actor, options), auditId = randomUUID();
  if (!captured.success) return fail("VALIDATION", 422);
  return withOnboardingSession(auth, false, async tx => {
    const ownerUserId = auth.actor.userId; await ownerLocks(tx, ownerUserId);
    const current = await parent(tx, ownerUserId, captured.data.collaborationId, false);
    const pins = await tx.externalCollaborationAttachment.findMany({ where: { collaborationId: current.id, ownerUserId, removedAt: null },
      select: bindingSelect, take: limits.attachments + 1 });
    if (pins.length > limits.attachments) return corrupt();
    pins.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (pins.length) {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "ExternalCollaborationAttachment" WHERE id IN (${Prisma.join(pins.map(row => row.id))})
        AND "ownerUserId"=${ownerUserId} AND "collaborationId"=${current.id} AND "removedAt" IS NULL ORDER BY id COLLATE "C" FOR SHARE`);
      if (!equal(locked.map(row => row.id), pins.map(row => row.id))) return corrupt();
    }
    const { values } = await attachmentValues(tx, ownerUserId, current.id, pins), asOf = new Date().toISOString();
    const result = stored(ExternalCollaborationDetailSchema, { scope: "OWN_CREATOR", asOf, collaboration: { id: current.id,
      revision: current.revision, status: current.status, archived: current.archived, details: current.details,
      createdAt: iso(current.createdAt), updatedAt: iso(current.updatedAt) }, attachments: values });
    await readAudit(tx, ownerUserId, "read", current.id, { ids: [current.id], asOf, count: 1, cursor: null, archived: current.archived }, auditId);
    return result;
  });
}
export async function listExternalCollaborations(actor: OrganizationActor, input: { archived: boolean; after?: string }, options: Options = {}): Promise<ExternalCollaborationList> {
  const captured = listQuery.safeParse(input), auth = await session(actor, options), auditId = randomUUID();
  if (!captured.success) return fail("VALIDATION", 422);
  return withOnboardingSession(auth, false, async tx => {
    const ownerUserId = auth.actor.userId, query = captured.data; await ownerLocks(tx, ownerUserId);
    if (query.after && !await tx.externalCollaboration.findFirst({ where: { id: query.after, ownerUserId }, select: { id: true } })) return fail("NOT_FOUND", 404);
    const found = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "ExternalCollaboration" WHERE "ownerUserId"=${ownerUserId}
      AND archived=${query.archived} ${query.after ? Prisma.sql`AND id COLLATE "C">${query.after} COLLATE "C"` : Prisma.empty}
      ORDER BY id COLLATE "C" LIMIT 31`);
    const ids = found.slice(0, limits.list).map(row => row.id);
    let headers: ReturnType<typeof ExternalCollaborationHeaderSchema.parse>[] = [];
    if (ids.length) {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "ExternalCollaboration" WHERE id IN (${Prisma.join(ids)})
        AND "ownerUserId"=${ownerUserId} AND archived=${query.archived} ORDER BY id COLLATE "C" FOR SHARE`);
      if (!equal(locked.map(row => row.id), ids)) return corrupt();
      // All parent locks precede one bounded metadata-only binding lock group.
      const bindings = await tx.$queryRaw<Array<{ id: string; collaborationId: string }>>(Prisma.sql`SELECT id,"collaborationId"
        FROM "ExternalCollaborationAttachment" WHERE "collaborationId" IN (${Prisma.join(ids)}) AND "ownerUserId"=${ownerUserId}
        AND "removedAt" IS NULL ORDER BY id COLLATE "C" LIMIT 601 FOR SHARE`);
      const counts = new Map<string, number>();
      for (const row of bindings) { if (!ids.includes(row.collaborationId)) return corrupt(); counts.set(row.collaborationId, (counts.get(row.collaborationId) ?? 0) + 1); }
      if (bindings.length > limits.list * limits.attachments || [...counts.values()].some(count => count > limits.attachments)) return corrupt();
      const rows = await tx.$queryRaw<Array<{ id: string; revision: number; status: string; archived: boolean; createdAt: Date; updatedAt: Date;
        schemaVersion: unknown; clientDisplay: unknown; campaignDisplay: unknown; declaredValue: unknown; period: unknown; total: number; done: number }>>(Prisma.sql`
        SELECT id,revision,status,archived,"createdAt","updatedAt","detailsJson"->'schemaVersion' AS "schemaVersion",
          "detailsJson"->'clientDisplay' AS "clientDisplay","detailsJson"->'campaignDisplay' AS "campaignDisplay",
          "detailsJson"->'declaredValue' AS "declaredValue","detailsJson"->'period' AS period,
          jsonb_array_length("detailsJson"->'checklist') AS total,
          (SELECT count(*)::integer FROM jsonb_array_elements("detailsJson"->'checklist') item WHERE item->'done'='true'::jsonb) AS done
        FROM "ExternalCollaboration" WHERE id IN (${Prisma.join(ids)}) AND "ownerUserId"=${ownerUserId}
          AND archived=${query.archived} ORDER BY id COLLATE "C"`);
      if (rows.length !== ids.length) return corrupt();
      headers = rows.map(row => {
        const { schemaVersion, total, done, ...value } = row;
        if (schemaVersion !== 1 || !ids.includes(row.id)) return corrupt();
        return stored(ExternalCollaborationHeaderSchema, { ...value, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
          checklist: { total, done }, attachmentCount: counts.get(row.id) ?? 0 });
      });
    }
    const asOf = new Date().toISOString(), nextCursor = found.length > limits.list ? ids.at(-1)! : null;
    const result = stored(ExternalCollaborationListSchema, { scope: "OWN_CREATOR", asOf, collaborations: headers, nextCursor });
    await readAudit(tx, ownerUserId, "list", ownerUserId, { ids, asOf, count: headers.length, cursor: nextCursor, archived: query.archived }, auditId);
    return result;
  });
}

// Dedicated binary boundary: JSON commands cannot claim possession of bytes.
export async function attachExternalCollaborationFile(actor: OrganizationActor, input: unknown, inputBytes: Uint8Array,
  options: FileOptions): Promise<ExternalCollaborationResult> {
  const captured = ExternalCollaborationCommandSchema.safeParse(input);
  const bytes = inputBytes instanceof Uint8Array && inputBytes.byteLength <= limits.attachmentBytes ? new Uint8Array(inputBytes) : null;
  const storage = captureStorage(options.storage), client = options.client, auth = await session(actor, { client });
  if (!captured.success || captured.data.action !== "ATTACH_FILE" || !bytes) return fail("VALIDATION", 422);
  const command = captured.data, actorUserId = auth.actor.userId;
  const inspected = inspectEvidence(bytes, command.payload.file.contentType);
  if (!equal(inspected, command.payload.file)) return fail("VALIDATION", 422);
  const digest = externalCollaborationCommandHash(actorUserId, command);
  const assetId = createHash("sha256").update("infame-external-file-v1:" + actorUserId + ":" + command.operationKey.toLowerCase()).digest("hex");
  const objectKey = createHash("sha256").update(actorUserId).digest("hex").slice(0, 32) + "/" + assetId;
  const ids = { command: randomUUID(), audit: randomUUID(), event: randomUUID(), binding: randomUUID() };
  return withOnboardingSession(auth, true, async tx => {
    await ownerLocks(tx, actorUserId);
    const current = await parent(tx, actorUserId, command.collaborationId, true);
    const prior = await replay(tx, actorUserId, command, digest, current); if (prior) return prior;
    if (current.revision !== command.expectedRevision) return fail("STALE_VERSION");
    if (current.archived) return fail("INVALID_STATE");
    if (current.revision >= 2147483646) return fail("VERSION_EXHAUSTED");
    if (await tx.externalCollaborationAttachment.count({ where: { collaborationId: current.id, ownerUserId: actorUserId, removedAt: null } }) >= limits.attachments)
      return fail("ATTACHMENT_LIMIT");
    if (await tx.privateAsset.findUnique({ where: { id: assetId }, select: { id: true } })) return fail("IDEMPOTENCY_CONFLICT");
    await assertOnboardingSession(tx);
    await storage.put(objectKey, bytes, inspected.contentType);
    // On SQL failure or uncertain acknowledgement retain the immutable object.
    // The same operation identity can reconcile it without overwriting bytes.
    await assertOnboardingSession(tx);
    const at = new Date();
    await tx.privateAsset.create({ data: { id: assetId, ownerUserId: actorUserId, purpose,
      storageKey: storage.kind.toLowerCase() + ":" + objectKey, ...inspected, createdAt: at } });
    await tx.externalCollaborationAttachment.create({ data: { id: ids.binding, collaborationId: current.id,
      ownerUserId: actorUserId, assetId, assetPurpose: purpose, label: inputJson(command.payload.label), attachedAt: at } });
    const next = await parent(tx, actorUserId, current.id, true);
    if (next.revision !== current.revision + 1) return corrupt();
    const receipt = stored(ExternalCollaborationReceiptSchema, { operationKey: command.operationKey, collaborationId: current.id,
      action: command.action, revision: next.revision, status: next.status, archived: next.archived, attachmentId: ids.binding });
    await writeRecords(tx, actorUserId, command, digest, receipt, ids, new Date());
    return stored(ExternalCollaborationResultSchema, { ...receipt, replayed: false });
  });
}
const fileQuery = planningPlainJsonSchema(z.object({ collaborationId: id, attachmentId: id }).strict(), 4096);
export async function getExternalCollaborationFile(actor: OrganizationActor, input: { collaborationId: string; attachmentId: string }, options: FileOptions) {
  const captured = fileQuery.safeParse(input), storage = captureStorage(options.storage), client = options.client, auth = await session(actor, { client });
  if (!captured.success) return fail("VALIDATION", 422);
  const auditId = randomUUID();
  return withOnboardingSession(auth, false, async tx => {
    const ownerUserId = auth.actor.userId; await ownerLocks(tx, ownerUserId);
    const current = await parent(tx, ownerUserId, captured.data.collaborationId, false);
    const pin = await binding(tx, ownerUserId, current.id, captured.data.attachmentId, false);
    if (pin.removedAt) return fail("NOT_FOUND", 404);
    await attachmentValues(tx, ownerUserId, current.id, [pin]);
    const asset = await tx.privateAsset.findFirst({ where: { id: pin.assetId, ownerUserId, purpose } });
    const prefix = storage.kind.toLowerCase() + ":";
    if (!asset || asset.deletedAt || !asset.storageKey.startsWith(prefix)) return fail("ASSET_BYTES_UNAVAILABLE", 503);
    await assertOnboardingSession(tx);
    const bytes = new Uint8Array(await storage.get(asset.storageKey.slice(prefix.length)));
    await assertOnboardingSession(tx);
    let inspected;
    try { inspected = inspectEvidence(bytes, asset.contentType); } catch { return fail("ASSET_BYTES_UNAVAILABLE", 503); }
    if (inspected.size !== asset.size || inspected.checksum !== asset.checksum) return fail("ASSET_BYTES_UNAVAILABLE", 503);
    await readAudit(tx, ownerUserId, "read", current.id, { attachmentId: pin.id, assetId: asset.id }, auditId);
    const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" }[inspected.contentType];
    return { bytes, headers: { "Content-Type": inspected.contentType, "Content-Disposition": 'attachment; filename="collaboration.' + extension + '"',
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'" } };
  });
}
