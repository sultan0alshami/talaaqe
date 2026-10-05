import { Prisma } from "@prisma/client";
import { checkOrganizationActor, organizationDb, type OrganizationActor, type OrganizationOptions } from "@/lib/organizations/context";
import { createEvidenceReceiptReader, type EvidenceReceiptReader } from "@/lib/evidence/receipt-reader";
import { canonicalHash, inputJson } from "@/lib/onboarding/drafts";
import { capturePublicCreatorIdentities, publicIdentityActors, publicIdentityRead } from "@/lib/discovery/public-identity-capture";
import { projectPublicCreatorIdentities } from "@/lib/discovery/public-identity";
import {
  COLLECTION_LIMITS, CollectionCommandSchema, CollectionCommandResultSchema, CollectionError, CollectionHeaderSchema,
  CollectionReadContextSchema, parseCollectionInput, type CollectionCommand, type CollectionCommandResult,
  type CollectionHeader, type CollectionReadContext, type CollectionScope,
} from "./contracts";
import { withCollectionScope, type CollectionScopeContext } from "./scope";

export type CollectionOptions = OrganizationOptions & { now?: Date };
export const collectionBindingSelect = {
  id: true, scope: true, brandId: true, organizationId: true, clientId: true, revision: true, archived: true,
} as const;
export const collectionHeaderSelect = {
  ...collectionBindingSelect, name: true, nameLanguage: true, createdAt: true, updatedAt: true,
} as const;
export type CollectionBinding = Prisma.CreatorCollectionGetPayload<{ select: typeof collectionBindingSelect }>;
export type CollectionHeaderRecord = Prisma.CreatorCollectionGetPayload<{ select: typeof collectionHeaderSelect }>;

export const collectionRetry = (): never => { throw new CollectionError("RETRY_REQUIRED", 503); };
const missing = (): never => { throw new CollectionError("NOT_FOUND", 404); };

export function collectionClock(options: CollectionOptions): Date {
  if (options.now !== undefined && (!(options.now instanceof Date) || !Number.isFinite(options.now.getTime()))) {
    throw new CollectionError("INVALID_CLOCK", 400);
  }
  return new Date(options.now?.getTime() ?? Date.now());
}
export function collectionRequestedScope(row: CollectionBinding, scope: CollectionScope): boolean {
  return scope.kind === "OWN_BRAND"
    ? row.scope === "OWN_BRAND" && row.brandId === scope.brandId && row.organizationId === null && row.clientId === null
    : row.scope === "CLIENT" && row.clientId === scope.clientId && row.organizationId !== null;
}
export function collectionScopeWhere(context: CollectionScopeContext): Prisma.CreatorCollectionWhereInput {
  return { scope: context.scope.kind, brandId: context.brandId,
    organizationId: context.organizationId, clientId: context.clientId };
}
export function bindCollection(row: CollectionBinding | null, context: CollectionScopeContext): CollectionBinding {
  if (!row || !collectionRequestedScope(row, context.scope) || row.brandId !== context.brandId
    || row.organizationId !== context.organizationId || row.clientId !== context.clientId) return missing();
  return row;
}
export async function lockCollection(
  tx: Prisma.TransactionClient, id: string, context: CollectionScopeContext, reader: EvidenceReceiptReader, write = false,
): Promise<CollectionBinding> {
  await publicIdentityRead(reader, () => write
    ? tx.$queryRaw`SELECT id FROM "CreatorCollection" WHERE id=${id} FOR UPDATE`
    : tx.$queryRaw`SELECT id FROM "CreatorCollection" WHERE id=${id} FOR SHARE`);
  return bindCollection(await publicIdentityRead(reader, () => tx.creatorCollection.findUnique({
    where: { id }, select: collectionBindingSelect,
  })), context);
}
export function collectionHeader(row: CollectionHeaderRecord): CollectionHeader {
  const result = CollectionHeaderSchema.safeParse({ id: row.id, nameOriginal: { text: row.name, language: row.nameLanguage },
    revision: row.revision, archived: row.archived, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
  if (!result.success) return collectionRetry();
  return result.data;
}
export function collectionReadContext(context: CollectionScopeContext): CollectionReadContext {
  const result = CollectionReadContextSchema.safeParse({ scope: context.scope, currentAuthority: context.currentAuthority });
  if (!result.success) return collectionRetry();
  return result.data;
}
function nextRevision(parent: CollectionBinding, expected: number): number {
  if (parent.revision !== expected) throw new CollectionError("STALE_VERSION", 409);
  if (parent.revision >= 2147483646) throw new CollectionError("REVISION_EXHAUSTED", 409);
  return parent.revision + 1;
}
async function lockEntry(tx: Prisma.TransactionClient, collectionId: string, entryId: string, reader: EvidenceReceiptReader) {
  await publicIdentityRead(reader, () => tx.$queryRaw`SELECT id FROM "CreatorCollectionEntry"
    WHERE id=${entryId} AND "collectionId"=${collectionId} FOR UPDATE`);
  const entry = await publicIdentityRead(reader, () => tx.creatorCollectionEntry.findUnique({
    where: { id: entryId, collectionId }, select: { id: true, creatorId: true, removedAt: true },
  }));
  return entry ?? missing();
}
async function replayCommand(
  tx: Prisma.TransactionClient, context: CollectionScopeContext, actor: OrganizationActor,
  command: CollectionCommand, hash: string, reader: EvidenceReceiptReader,
): Promise<{ found: false } | { found: true; result: CollectionCommandResult }> {
  const previous = await publicIdentityRead(reader, () => tx.creatorCollectionCommand.findUnique({
    where: { actorUserId_operationKey: { actorUserId: actor.userId, operationKey: command.operationKey } },
  }));
  if (!previous) return { found: false };
  // The retained parent binding is checked before the receipt is decoded. Its
  // historical revision/archive state does not describe the current collection.
  await lockCollection(tx, previous.collectionId, context, reader, true);
  if (previous.payloadHash !== hash || previous.action !== command.action
    || command.action !== "CREATE" && previous.collectionId !== command.collectionId) {
    throw new CollectionError("OPERATION_KEY_REUSED", 409);
  }
  const result = CollectionCommandResultSchema.safeParse(previous.result);
  reader.checkpoint();
  if (!result.success || result.data.collectionId !== previous.collectionId || result.data.action !== previous.action) return collectionRetry();
  return { found: true, result: { ...result.data, replayed: true } };
}
function eventType(command: CollectionCommand): string {
  switch (command.action) {
    case "CREATE": return "collection.created";
    case "RENAME": return "collection.renamed";
    case "SET_ARCHIVED": return command.payload.archived ? "collection.archived" : "collection.restored";
    case "ADD_ENTRY": return "collection.entry_added";
    case "REMOVE_ENTRY": return "collection.entry_removed";
    case "EDIT_NOTE": return "collection.note_edited";
  }
}
async function recordCommand(
  tx: Prisma.TransactionClient, actor: OrganizationActor, command: CollectionCommand, hash: string,
  result: CollectionCommandResult, now: Date, reader: EvidenceReceiptReader,
): Promise<CollectionCommandResult> {
  const receipt = await publicIdentityRead(reader, () => tx.creatorCollectionCommand.create({
    data: { actorUserId: actor.userId, operationKey: command.operationKey, payloadHash: hash,
      collectionId: result.collectionId, action: command.action, result: inputJson(result), createdAt: now }, select: { id: true },
  }));
  const type = eventType(command), metadata = { collectionId: result.collectionId, entryId: result.entryId,
    action: result.action, revision: result.revision, archived: result.archived };
  await publicIdentityRead(reader, () => tx.adminAudit.create({ data: {
    actorUserId: actor.userId, action: type, resourceType: "CreatorCollection", resourceId: result.collectionId,
    snapshot: inputJson(metadata), createdAt: now,
  } }));
  await publicIdentityRead(reader, () => tx.outboxEvent.create({ data: {
    deduplicationKey: "collection:" + receipt.id, type,
    payload: inputJson({ id: receipt.id, type, actorUserId: actor.userId, recipientUserIds: [actor.userId],
      aggregateType: "CreatorCollection", aggregateId: result.collectionId, aggregateVersion: result.revision,
      occurredAt: now.toISOString(), payload: metadata }), createdAt: now, availableAt: now,
  } }));
  return result;
}

export async function applyCollectionCommand(
  actor: OrganizationActor, input: unknown, options: CollectionOptions = {},
): Promise<CollectionCommandResult> {
  await checkOrganizationActor(actor, options);
  const command = parseCollectionInput(CollectionCommandSchema, input), now = collectionClock(options);
  const reader = createEvidenceReceiptReader();
  reader.checkpoint();
  const hash = canonicalHash({ purpose: "CREATOR_COLLECTION_COMMAND_V1", actorUserId: actor.userId, command });
  reader.checkpoint();
  const expectedAuthority = "expectedAuthority" in command ? command.expectedAuthority : undefined;
  const replay = (tx: Prisma.TransactionClient, context: CollectionScopeContext) =>
    replayCommand(tx, context, actor, command, hash, reader);
  try {
    // This lookup is minimal actor-owned metadata, never private collection
    // content or authority. A known replay skips a now-unavailable public card.
    const known = await publicIdentityRead(reader, () => organizationDb(options).creatorCollectionCommand.findUnique({
      where: { actorUserId_operationKey: { actorUserId: actor.userId, operationKey: command.operationKey } },
      select: { collectionId: true },
    }));
    if (known) return await withCollectionScope(actor, command.scope, "plan", {
      write: true, expectedAuthority, reader, replay, execute: async () => collectionRetry(),
    }, options);

    const capture = command.action === "ADD_ENTRY"
      ? await publicIdentityRead(reader, () => organizationDb(options).$transaction(async tx => {
        const parent = await publicIdentityRead(reader, () => tx.creatorCollection.findUnique({
          where: { id: command.collectionId }, select: collectionBindingSelect,
        }));
        // No private content or public capture follows a substituted scope.
        return capturePublicCreatorIdentities(tx,
          parent && collectionRequestedScope(parent, command.scope) ? [command.payload.creatorId] : [], now, reader);
      }, { isolationLevel: "RepeatableRead", maxWait: 10000, timeout: 20000 }))
      : null;
    const capturedActors = capture ? publicIdentityActors(capture) : null;
    return await withCollectionScope(actor, command.scope, "plan", {
      write: true, expectedAuthority, reader, replay,
      userIds: capturedActors ? [...capturedActors.ownerIds] : [],
      reviewerIds: capturedActors ? [...capturedActors.reviewerIds] : [],
      execute: async (tx, context) => {
        if (command.action === "CREATE") {
          const parent = await publicIdentityRead(reader, () => tx.creatorCollection.create({ data: {
            scope: context.scope.kind, brandId: context.brandId, organizationId: context.organizationId, clientId: context.clientId,
            name: command.payload.nameOriginal.text, nameLanguage: command.payload.nameOriginal.language,
            revision: 1, archived: false, createdAt: now, updatedAt: now,
          }, select: collectionBindingSelect }));
          bindCollection(parent, context);
          return recordCommand(tx, actor, command, hash, { collectionId: parent.id, entryId: null,
            revision: 1, archived: false, action: command.action, replayed: false }, now, reader);
        }
        const parent = await lockCollection(tx, command.collectionId, context, reader, true);
        const revision = nextRevision(parent, command.expectedParentRevision);
        if (parent.archived && command.action !== "SET_ARCHIVED") throw new CollectionError("ARCHIVED", 409);
        let entryId: string | null = null, archived = parent.archived;
        let parentChanges: Prisma.CreatorCollectionUpdateInput = {};
        switch (command.action) {
          case "RENAME":
            parentChanges = { name: command.payload.nameOriginal.text, nameLanguage: command.payload.nameOriginal.language };
            break;
          case "SET_ARCHIVED":
            if (command.payload.archived === parent.archived) throw new CollectionError("INVALID_STATE", 409);
            archived = command.payload.archived;
            parentChanges = { archived };
            break;
          case "ADD_ENTRY": {
            if (!capture || !capturedActors) return collectionRetry();
            // Public Creator/domain locks precede every selected Entry lock so
            // Creator DELETE's FK update cannot invert this ordering.
            const cards = await projectPublicCreatorIdentities(tx, capture, {
              ...capturedActors, ownerIds: context.ownerIds, reviewerIds: context.reviewerIds,
            }, reader);
            reader.checkpoint();
            const available = cards.some(card => card.id === command.payload.creatorId);
            reader.checkpoint();
            if (!available) throw new CollectionError("CREATOR_UNAVAILABLE", 409);
            const first = await publicIdentityRead(reader, () => tx.creatorCollectionEntry.findUnique({
              where: { collectionId_creatorReferenceId: { collectionId: parent.id, creatorReferenceId: command.payload.creatorId } },
              select: { id: true },
            }));
            const existing = first ? await lockEntry(tx, parent.id, first.id, reader) : null;
            if (existing?.creatorId === null) throw new CollectionError("CREATOR_UNAVAILABLE", 409);
            if (existing && !existing.removedAt) throw new CollectionError("ALREADY_SAVED", 409);
            const active = await publicIdentityRead(reader, () => tx.creatorCollectionEntry.count({ where: { collectionId: parent.id, removedAt: null } }));
            if (active >= COLLECTION_LIMITS.activeEntries) throw new CollectionError("CAPACITY_REACHED", 409);
            const note = command.payload.noteOriginal;
            const entry = existing
              ? await publicIdentityRead(reader, () => tx.creatorCollectionEntry.update({ where: { id: existing.id },
                data: { removedAt: null, note: note.text, noteLanguage: note.language, updatedAt: now }, select: { id: true } }))
              : await publicIdentityRead(reader, () => tx.creatorCollectionEntry.create({ data: {
                collectionId: parent.id, creatorReferenceId: command.payload.creatorId, creatorId: command.payload.creatorId,
                note: note.text, noteLanguage: note.language, createdAt: now, updatedAt: now,
              }, select: { id: true } }));
            entryId = entry.id;
            break;
          }
          case "REMOVE_ENTRY": {
            const entry = await lockEntry(tx, parent.id, command.payload.entryId, reader);
            if (entry.removedAt) throw new CollectionError("INVALID_STATE", 409);
            await publicIdentityRead(reader, () => tx.creatorCollectionEntry.update({ where: { id: entry.id },
              data: { removedAt: now, updatedAt: now }, select: { id: true } }));
            entryId = entry.id;
            break;
          }
          case "EDIT_NOTE": {
            const entry = await lockEntry(tx, parent.id, command.payload.entryId, reader);
            if (entry.removedAt) return missing();
            await publicIdentityRead(reader, () => tx.creatorCollectionEntry.update({ where: { id: entry.id },
              data: { note: command.payload.noteOriginal.text, noteLanguage: command.payload.noteOriginal.language, updatedAt: now },
              select: { id: true } }));
            entryId = entry.id;
            break;
          }
        }
        await publicIdentityRead(reader, () => tx.creatorCollection.update({ where: { id: parent.id },
          data: { ...parentChanges, revision, updatedAt: now }, select: collectionBindingSelect }));
        const result = CollectionCommandResultSchema.parse({ collectionId: parent.id, entryId, revision, archived,
          action: command.action, replayed: false });
        reader.checkpoint();
        return recordCommand(tx, actor, command, hash, result, now, reader);
      },
    }, options);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = String(error.meta?.target ?? "");
      if (error.meta?.modelName === "CreatorCollectionCommand" || target.includes("actorUserId") && target.includes("operationKey")) {
        throw new CollectionError("OPERATION_KEY_REUSED", 409);
      }
      return collectionRetry();
    }
    throw error;
  }
}
