import { Prisma } from "@prisma/client";
import { checkOrganizationActor, organizationDb, type OrganizationActor } from "@/lib/organizations/context";
import { createEvidenceReceiptReader, type EvidenceReceiptReader } from "@/lib/evidence/receipt-reader";
import { capturePublicCreatorIdentities, publicIdentityActors, publicIdentityRead } from "@/lib/discovery/public-identity-capture";
import { projectPublicCreatorIdentities } from "@/lib/discovery/public-identity";
import { inputJson } from "@/lib/onboarding/drafts";
import {
  CollectionHeadersQuerySchema, CollectionEntriesQuerySchema, CollectionComparisonQuerySchema,
  CollectionHeadersPageSchema, CollectionEntriesPageSchema, CollectionComparisonSchema, CollectionEntrySchema,
  CollectionError, parseCollectionInput, type CollectionHeadersPage, type CollectionEntriesPage,
  type CollectionComparison, type CollectionEntriesQuery, type CollectionComparisonQuery, type CollectionEntry,
} from "./contracts";
import {
  bindCollection, collectionBindingSelect, collectionClock, collectionHeader, collectionHeaderSelect, collectionReadContext,
  collectionRequestedScope, collectionRetry, collectionScopeWhere, lockCollection, type CollectionOptions,
} from "./service";
import { withCollectionScope, type CollectionScopeContext } from "./scope";

const missing = (): never => { throw new CollectionError("NOT_FOUND", 404); };
const entryReferenceSelect = { id: true, collectionId: true, creatorReferenceId: true, creatorId: true } as const;
const entryContentSelect = {
  ...entryReferenceSelect, note: true, noteLanguage: true, removedAt: true, createdAt: true, updatedAt: true,
} as const;
type EntryReference = Prisma.CreatorCollectionEntryGetPayload<{ select: typeof entryReferenceSelect }>;
type SelectedQuery = CollectionEntriesQuery | CollectionComparisonQuery;

async function auditRead(
  tx: Prisma.TransactionClient, actor: OrganizationActor, context: CollectionScopeContext,
  action: string, resourceId: string, asOf: string, returned: number, reader: EvidenceReceiptReader,
  page: { after?: string; nextCursor?: string | null; revision?: number; selected?: number } = {},
) {
  await publicIdentityRead(reader, () => tx.adminAudit.create({ data: {
    actorUserId: actor.userId, action, resourceType: action === "collection.headers_accessed" ? "CreatorCollectionList" : "CreatorCollection",
    resourceId, snapshot: inputJson({ scope: context.scope.kind, brandId: context.brandId,
      organizationId: context.organizationId, clientId: context.clientId, asOf, returned,
      ...(page.after === undefined ? {} : { after: page.after }),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      ...(page.revision === undefined ? {} : { revision: page.revision }),
      ...(page.selected === undefined ? {} : { selected: page.selected }),
    }),
  } }));
}

export async function getCollectionHeaders(
  actor: OrganizationActor, input: unknown, options: CollectionOptions = {},
): Promise<CollectionHeadersPage> {
  await checkOrganizationActor(actor, options);
  const query = parseCollectionInput(CollectionHeadersQuerySchema, input), now = collectionClock(options);
  const reader = createEvidenceReceiptReader();
  return withCollectionScope(actor, query.scope, "view", { write: false, reader, execute: async (tx, context) => {
    const rows = await publicIdentityRead(reader, () => tx.creatorCollection.findMany({
      where: { ...collectionScopeWhere(context), archived: query.archived, ...(query.after ? { id: { gt: query.after } } : {}) },
      select: { id: true }, orderBy: { id: "asc" }, take: query.limit + 1,
    }));
    const selected = rows.slice(0, query.limit), ids = selected.map(row => row.id);
    if (ids.length) await publicIdentityRead(reader, () => tx.$queryRaw(Prisma.sql`SELECT id FROM "CreatorCollection"
      WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`));
    const current = ids.length ? await publicIdentityRead(reader, () => tx.creatorCollection.findMany({
      where: { ...collectionScopeWhere(context), archived: query.archived, id: { in: ids } },
      select: collectionHeaderSelect, orderBy: { id: "asc" }, take: ids.length,
    })) : [];
    if (current.length !== ids.length || current.some((row, index) => row.id !== ids[index])) return collectionRetry();
    const collections = current.map(row => { reader.checkpoint(); bindCollection(row, context); return collectionHeader(row); });
    const parsed = CollectionHeadersPageSchema.safeParse({ context: collectionReadContext(context), asOf: now.toISOString(), collections,
      nextCursor: rows.length > query.limit ? selected[selected.length - 1]!.id : null });
    reader.checkpoint();
    if (!parsed.success) return collectionRetry();
    await auditRead(tx, actor, context, "collection.headers_accessed", context.clientId ?? context.brandId,
      parsed.data.asOf, collections.length, reader, { after: query.after, nextCursor: parsed.data.nextCursor });
    return parsed.data;
  } }, options);
}

async function prepareSelection(query: SelectedQuery, now: Date, reader: EvidenceReceiptReader, options: CollectionOptions) {
  return publicIdentityRead(reader, () => organizationDb(options).$transaction(async tx => {
    const parent = await publicIdentityRead(reader, () => tx.creatorCollection.findUnique({
      where: { id: query.collectionId }, select: collectionBindingSelect,
    }));
    // Only exact-scope scalar bindings/references are read here. Private names,
    // notes and public proof/content wait for the authorized grouped transaction.
    const requested = "entryIds" in query ? query.entryIds : null;
    const pageLimit = "limit" in query ? query.limit : 0;
    const rows = parent && collectionRequestedScope(parent, query.scope)
      ? await publicIdentityRead(reader, () => tx.creatorCollectionEntry.findMany({
        where: { collectionId: parent.id, removedAt: null,
          ...(requested ? { id: { in: requested } } : "after" in query && query.after ? { id: { gt: query.after } } : {}) },
        select: entryReferenceSelect, orderBy: { id: "asc" }, take: requested ? requested.length : pageLimit + 1,
      })) : [];
    const byId = new Map(rows.map(row => [row.id, row]));
    const selected: EntryReference[] = requested
      ? requested.flatMap(id => { reader.checkpoint(); const row = byId.get(id); return row ? [row] : []; })
      : rows.slice(0, pageLimit);
    const creatorIds = [...new Set(selected.flatMap(row => row.creatorId ? [row.creatorId] : []))];
    reader.checkpoint();
    const capture = await capturePublicCreatorIdentities(tx, creatorIds, now, reader);
    return { parent, rows, selected, capture, complete: requested === null || selected.length === requested.length };
  }, { isolationLevel: "RepeatableRead", maxWait: 10000, timeout: 20000 }));
}

function loadSelection(actor: OrganizationActor, query: CollectionEntriesQuery, options: CollectionOptions): Promise<CollectionEntriesPage>;
function loadSelection(actor: OrganizationActor, query: CollectionComparisonQuery, options: CollectionOptions): Promise<CollectionComparison>;
async function loadSelection(
  actor: OrganizationActor, query: SelectedQuery, options: CollectionOptions,
): Promise<CollectionEntriesPage | CollectionComparison> {
  const now = collectionClock(options), reader = createEvidenceReceiptReader();
  const prepared = await prepareSelection(query, now, reader, options);
  const capturedActors = publicIdentityActors(prepared.capture);
  reader.checkpoint();
  return withCollectionScope(actor, query.scope, "view", {
    write: false, reader, userIds: [...capturedActors.ownerIds], reviewerIds: [...capturedActors.reviewerIds],
    execute: async (tx, context) => {
      const parent = await lockCollection(tx, query.collectionId, context, reader);
      if (!prepared.parent || !collectionRequestedScope(prepared.parent, query.scope)) return missing();
      if (parent.revision !== prepared.parent.revision) return collectionRetry();
      if (!prepared.complete) return missing();
      const cards = await projectPublicCreatorIdentities(tx, prepared.capture, {
        ...capturedActors, ownerIds: context.ownerIds, reviewerIds: context.reviewerIds,
      }, reader);
      reader.checkpoint();
      const cardsById = new Map(cards.map(card => [card.id, card]));
      if (cardsById.size !== cards.length) return collectionRetry();
      const ids = prepared.selected.map(row => row.id), ordered = [...ids].sort();
      // Creator projection owns the preceding domain locks. Taking Entry locks
      // only now is compatible with actual Creator DELETE's FK detach.
      if (ordered.length) await publicIdentityRead(reader, () => tx.$queryRaw(Prisma.sql`SELECT id FROM "CreatorCollectionEntry"
        WHERE "collectionId"=${parent.id} AND id IN (${Prisma.join(ordered)}) ORDER BY id FOR SHARE`));
      const rows = ids.length ? await publicIdentityRead(reader, () => tx.creatorCollectionEntry.findMany({
        where: { collectionId: parent.id, removedAt: null, id: { in: ids } }, select: entryContentSelect,
        orderBy: { id: "asc" }, take: ids.length,
      })) : [];
      const currentById = new Map(rows.map(row => [row.id, row]));
      if (currentById.size !== prepared.selected.length) return collectionRetry();
      const entries: CollectionEntry[] = prepared.selected.map(reference => {
        reader.checkpoint();
        const row = currentById.get(reference.id);
        if (!row || row.collectionId !== reference.collectionId || row.creatorReferenceId !== reference.creatorReferenceId
          || row.creatorId !== reference.creatorId || row.removedAt !== null) return collectionRetry();
        const parsed = CollectionEntrySchema.safeParse({ entryId: row.id, noteOriginal: { text: row.note, language: row.noteLanguage },
          createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
          creator: row.creatorId ? cardsById.get(row.creatorId) ?? null : null });
        reader.checkpoint();
        if (!parsed.success) return collectionRetry();
        return parsed.data;
      });
      const header = await publicIdentityRead(reader, () => tx.creatorCollection.findUnique({
        where: { id: parent.id }, select: collectionHeaderSelect,
      }));
      if (!header || header.revision !== parent.revision) return collectionRetry();
      bindCollection(header, context);
      const result = { context: collectionReadContext(context), asOf: now.toISOString(), collection: collectionHeader(header), entries,
        nextCursor: "limit" in query && prepared.rows.length > query.limit ? prepared.selected[prepared.selected.length - 1]!.id : null };
      const parsed = "entryIds" in query
        ? CollectionComparisonSchema.safeParse({ context: result.context, asOf: result.asOf, collection: result.collection, entries })
        : CollectionEntriesPageSchema.safeParse(result);
      reader.checkpoint();
      if (!parsed.success) return collectionRetry();
      await auditRead(tx, actor, context, "entryIds" in query ? "collection.comparison_accessed" : "collection.entries_accessed",
        parent.id, result.asOf, entries.length, reader, { revision: parent.revision,
          ...("entryIds" in query ? { selected: query.entryIds.length } : { after: query.after, nextCursor: result.nextCursor }) });
      reader.checkpoint();
      return parsed.data;
    },
  }, options);
}

export async function getCollectionEntries(
  actor: OrganizationActor, input: unknown, options: CollectionOptions = {},
): Promise<CollectionEntriesPage> {
  await checkOrganizationActor(actor, options);
  const query = parseCollectionInput(CollectionEntriesQuerySchema, input);
  return loadSelection(actor, query, options);
}
export async function compareCollectionEntries(
  actor: OrganizationActor, input: unknown, options: CollectionOptions = {},
): Promise<CollectionComparison> {
  await checkOrganizationActor(actor, options);
  const query = parseCollectionInput(CollectionComparisonQuerySchema, input);
  return loadSelection(actor, query, options);
}
