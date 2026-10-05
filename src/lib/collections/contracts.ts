import { z } from "zod";
import { ContentLanguageSchema, UtcDateTimeSchema } from "@/lib/contracts/vocabulary";
import { PublicDiscoveryCreatorSchema } from "@/lib/discovery/contracts";
import { ClientAuthoritySchema, OrganizationIdSchema, OrganizationRevisionSchema } from "@/lib/organizations/contracts";

export const COLLECTION_LIMITS = Object.freeze({ headers: 20, entries: 12, comparison: 12, activeEntries: 1000 });
export const CollectionIdSchema = OrganizationIdSchema;
export const CollectionRevisionSchema = OrganizationRevisionSchema;
export const CollectionOperationKeySchema = z.uuid();

export const OwnBrandCollectionScopeSchema = z.object({
  kind: z.literal("OWN_BRAND"), brandId: OrganizationIdSchema,
}).strict();
export const ClientCollectionScopeSchema = z.object({
  kind: z.literal("CLIENT"), clientId: OrganizationIdSchema,
}).strict();
export const CollectionScopeSchema = z.discriminatedUnion("kind", [OwnBrandCollectionScopeSchema, ClientCollectionScopeSchema]);
export type CollectionScope = z.infer<typeof CollectionScopeSchema>;

const collectionText = z.string().regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/, "Unsupported control character");
export const CollectionNameOriginalSchema = z.object({
  text: collectionText.trim().min(1).max(200), language: ContentLanguageSchema,
}).strict();
export const CollectionNoteOriginalSchema = z.object({
  text: collectionText.max(2000).nullable(), language: ContentLanguageSchema,
}).strict();
export type CollectionNameOriginal = z.infer<typeof CollectionNameOriginalSchema>;
export type CollectionNoteOriginal = z.infer<typeof CollectionNoteOriginalSchema>;

export const CollectionActionSchema = z.enum(["CREATE", "RENAME", "SET_ARCHIVED", "ADD_ENTRY", "REMOVE_ENTRY", "EDIT_NOTE"]);
export type CollectionAction = z.infer<typeof CollectionActionSchema>;

const createFields = {
  action: z.literal("CREATE"), expectedParentRevision: z.literal(0),
  payload: z.object({ nameOriginal: CollectionNameOriginalSchema }).strict(),
};
const existingFields = { collectionId: CollectionIdSchema, expectedParentRevision: CollectionRevisionSchema };
const renameFields = {
  ...existingFields, action: z.literal("RENAME"),
  payload: z.object({ nameOriginal: CollectionNameOriginalSchema }).strict(),
};
const archiveFields = {
  ...existingFields, action: z.literal("SET_ARCHIVED"),
  payload: z.object({ archived: z.boolean() }).strict(),
};
const addEntryFields = {
  ...existingFields, action: z.literal("ADD_ENTRY"),
  payload: z.object({ creatorId: OrganizationIdSchema, noteOriginal: CollectionNoteOriginalSchema }).strict(),
};
const removeEntryFields = {
  ...existingFields, action: z.literal("REMOVE_ENTRY"),
  payload: z.object({ entryId: OrganizationIdSchema }).strict(),
};
const editNoteFields = {
  ...existingFields, action: z.literal("EDIT_NOTE"),
  payload: z.object({ entryId: OrganizationIdSchema, noteOriginal: CollectionNoteOriginalSchema }).strict(),
};

const ownCommandFields = { operationKey: CollectionOperationKeySchema, scope: OwnBrandCollectionScopeSchema };
export const OwnBrandCollectionCommandSchema = z.discriminatedUnion("action", [
  z.object({ ...ownCommandFields, ...createFields }).strict(),
  z.object({ ...ownCommandFields, ...renameFields }).strict(),
  z.object({ ...ownCommandFields, ...archiveFields }).strict(),
  z.object({ ...ownCommandFields, ...addEntryFields }).strict(),
  z.object({ ...ownCommandFields, ...removeEntryFields }).strict(),
  z.object({ ...ownCommandFields, ...editNoteFields }).strict(),
]);

export const CollectionPlanAuthoritySchema = ClientAuthoritySchema.extend({ capability: z.literal("plan") }).strict();
const clientCommandFields = {
  operationKey: CollectionOperationKeySchema, scope: ClientCollectionScopeSchema,
  expectedAuthority: CollectionPlanAuthoritySchema,
};
export const ClientCollectionCommandSchema = z.discriminatedUnion("action", [
  z.object({ ...clientCommandFields, ...createFields }).strict(),
  z.object({ ...clientCommandFields, ...renameFields }).strict(),
  z.object({ ...clientCommandFields, ...archiveFields }).strict(),
  z.object({ ...clientCommandFields, ...addEntryFields }).strict(),
  z.object({ ...clientCommandFields, ...removeEntryFields }).strict(),
  z.object({ ...clientCommandFields, ...editNoteFields }).strict(),
]).refine(command => command.scope.clientId === command.expectedAuthority.clientId, {
  path: ["expectedAuthority", "clientId"], message: "Authority must match the requested client scope",
});
export const CollectionCommandSchema = z.union([OwnBrandCollectionCommandSchema, ClientCollectionCommandSchema]);
export type OwnBrandCollectionCommand = z.infer<typeof OwnBrandCollectionCommandSchema>;
export type ClientCollectionCommand = z.infer<typeof ClientCollectionCommandSchema>;
export type CollectionCommand = z.infer<typeof CollectionCommandSchema>;
export type CollectionCommandInput = z.input<typeof CollectionCommandSchema>;

// Receipts describe a recorded mutation only. They never contain private content
// or imply current view authority, including when a plan-only actor replays one.
export const CollectionCommandResultSchema = z.object({
  collectionId: CollectionIdSchema, entryId: OrganizationIdSchema.nullable(),
  revision: CollectionRevisionSchema, archived: z.boolean(), action: CollectionActionSchema, replayed: z.boolean(),
}).strict();
export type CollectionCommandResult = z.infer<typeof CollectionCommandResultSchema>;

export const CollectionHeaderSchema = z.object({
  id: CollectionIdSchema, nameOriginal: CollectionNameOriginalSchema,
  revision: CollectionRevisionSchema, archived: z.boolean(), createdAt: UtcDateTimeSchema, updatedAt: UtcDateTimeSchema,
}).strict();
export const CollectionEntrySchema = z.object({
  entryId: OrganizationIdSchema, noteOriginal: CollectionNoteOriginalSchema,
  createdAt: UtcDateTimeSchema, updatedAt: UtcDateTimeSchema,
  creator: PublicDiscoveryCreatorSchema.nullable(),
}).strict();
export type CollectionHeader = z.infer<typeof CollectionHeaderSchema>;
export type CollectionEntry = z.infer<typeof CollectionEntrySchema>;

export const CollectionViewAuthoritySchema = ClientAuthoritySchema.extend({ capability: z.literal("view") }).strict();
// This context belongs to authorized read DTOs, separately from command receipts.
// Collection entries carry only the current public card or null, never a retained
// creator reference, private proof, contact, asking price or campaign score.
export const CollectionReadContextSchema = z.union([
  z.object({ scope: OwnBrandCollectionScopeSchema, currentAuthority: z.null() }).strict(),
  z.object({ scope: ClientCollectionScopeSchema, currentAuthority: CollectionViewAuthoritySchema }).strict()
    .refine(context => context.scope.clientId === context.currentAuthority.clientId, {
      path: ["currentAuthority", "clientId"], message: "Authority must match the requested client scope",
    }),
]);
export type CollectionReadContext = z.infer<typeof CollectionReadContextSchema>;

export const CollectionHeadersQuerySchema = z.object({
  scope: CollectionScopeSchema, archived: z.boolean().default(false), after: CollectionIdSchema.optional(),
  limit: z.number().int().min(1).max(COLLECTION_LIMITS.headers).default(COLLECTION_LIMITS.headers),
}).strict();
export const CollectionEntriesQuerySchema = z.object({
  scope: CollectionScopeSchema, collectionId: CollectionIdSchema, after: OrganizationIdSchema.optional(),
  limit: z.number().int().min(1).max(COLLECTION_LIMITS.entries).default(COLLECTION_LIMITS.entries),
}).strict();
export const CollectionComparisonQuerySchema = z.object({
  scope: CollectionScopeSchema, collectionId: CollectionIdSchema,
  entryIds: z.array(OrganizationIdSchema).max(COLLECTION_LIMITS.comparison)
    .refine(ids => new Set(ids).size === ids.length, "Duplicate entry selection"),
}).strict();
export type CollectionHeadersQuery = z.infer<typeof CollectionHeadersQuerySchema>;
export type CollectionEntriesQuery = z.infer<typeof CollectionEntriesQuerySchema>;
export type CollectionComparisonQuery = z.infer<typeof CollectionComparisonQuerySchema>;

export const CollectionHeadersPageSchema = z.object({
  context: CollectionReadContextSchema, asOf: UtcDateTimeSchema,
  collections: z.array(CollectionHeaderSchema).max(COLLECTION_LIMITS.headers), nextCursor: CollectionIdSchema.nullable(),
}).strict();
export const CollectionEntriesPageSchema = z.object({
  context: CollectionReadContextSchema, asOf: UtcDateTimeSchema, collection: CollectionHeaderSchema,
  entries: z.array(CollectionEntrySchema).max(COLLECTION_LIMITS.entries), nextCursor: OrganizationIdSchema.nullable(),
}).strict();
export const CollectionComparisonSchema = z.object({
  context: CollectionReadContextSchema, asOf: UtcDateTimeSchema, collection: CollectionHeaderSchema,
  entries: z.array(CollectionEntrySchema).max(COLLECTION_LIMITS.comparison),
}).strict();
export type CollectionHeadersPage = z.infer<typeof CollectionHeadersPageSchema>;
export type CollectionEntriesPage = z.infer<typeof CollectionEntriesPageSchema>;
export type CollectionComparison = z.infer<typeof CollectionComparisonSchema>;

export class CollectionError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); this.name = "CollectionError"; }
}
export function parseCollectionInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new CollectionError("VALIDATION", 422);
  return parsed.data;
}
