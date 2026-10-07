import { z } from "zod";
import { ContentLanguageSchema } from "@/lib/contracts/vocabulary";
import { ClientAuthoritySchema, OrganizationIdSchema, OrganizationRevisionSchema } from "@/lib/organizations/contracts";
import { OwnPlanningScopeSchema, ClientPlanningScopeSchema, PlanningScopeSchema } from "./contracts";

export const CONTEXT_REFERENCE_LIMITS = Object.freeze({ items: 20, metadataBytes: 65536 });
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/);
const label = z.object({ text: text.max(200).refine(value => value.trim().length > 0), language: ContentLanguageSchema }).strict();
const notes = z.object({ text: text.max(2000).nullable(), language: ContentLanguageSchema }).strict();
export const ContextReferenceItemSchema = z.object({ bindingId: OrganizationIdSchema, labelOriginal: label, notesOriginal: notes }).strict();
export const ContextReferenceItemsSchema = z.array(ContextReferenceItemSchema).max(CONTEXT_REFERENCE_LIMITS.items)
  .refine(items => new Set(items.map(item => item.bindingId)).size === items.length)
  .refine(items => new TextEncoder().encode(JSON.stringify(items)).byteLength <= CONTEXT_REFERENCE_LIMITS.metadataBytes);
const referenceRevision = z.number().int().min(0).max(2147483646);
const shared = { operationKey: z.uuid(), contextId: OrganizationIdSchema, expectedRevision: OrganizationRevisionSchema,
  expectedReferenceRevision: referenceRevision };
const upload = { action: z.literal("UPLOAD"), payload: z.object({ labelOriginal: label, notesOriginal: notes,
  contentType: z.enum(["image/png", "image/jpeg", "image/webp", "application/pdf"]), bytes: z.instanceof(Uint8Array) }).strict() };
const replace = { action: z.literal("REPLACE"), payload: z.object({ items: ContextReferenceItemsSchema }).strict() };
const plan = ClientAuthoritySchema.extend({ capability: z.literal("plan") }).strict();
const own = { ...shared, scope: OwnPlanningScopeSchema }, client = { ...shared, scope: ClientPlanningScopeSchema, expectedAuthority: plan };
export const ContextReferenceCommandSchema = z.union([
  z.discriminatedUnion("action", [z.object({ ...own, ...upload }).strict(), z.object({ ...own, ...replace }).strict()]),
  z.discriminatedUnion("action", [z.object({ ...client, ...upload }).strict(), z.object({ ...client, ...replace }).strict()])
    .refine(command => command.scope.clientId === command.expectedAuthority.clientId),
]);
export type ContextReferenceCommand = z.infer<typeof ContextReferenceCommandSchema>;
export const ContextReferenceReceiptSchema = z.object({ contextId: OrganizationIdSchema, revision: OrganizationRevisionSchema,
  referenceRevision: OrganizationRevisionSchema, manifestId: OrganizationIdSchema, manifestHash: hash,
  bindingId: OrganizationIdSchema.nullable() }).strict();
export const ContextReferenceCommandResultSchema = ContextReferenceReceiptSchema.extend({ replayed: z.boolean() }).strict();
export type ContextReferenceCommandResult = z.infer<typeof ContextReferenceCommandResultSchema>;
const projectedItem = ContextReferenceItemSchema.extend({ assetId: OrganizationIdSchema, contentType: upload.payload.shape.contentType,
  size: z.number().int().positive().max(10 * 1024 * 1024) }).strict();
export const ContextReferenceManifestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("LEGACY_ABSENT") }).strict(),
  z.object({ kind: z.literal("MANIFEST"), id: OrganizationIdSchema, revision: OrganizationRevisionSchema,
    hash, items: z.array(projectedItem).max(CONTEXT_REFERENCE_LIMITS.items) }).strict(),
]);
export type ContextReferenceManifest = z.infer<typeof ContextReferenceManifestSchema>;
const read = { contextId: OrganizationIdSchema, revision: OrganizationRevisionSchema, inputRevision: OrganizationRevisionSchema,
  archived: z.boolean(), versionId: OrganizationIdSchema.nullable(), references: ContextReferenceManifestSchema };
const view = ClientAuthoritySchema.extend({ capability: z.literal("view") }).strict();
export const ContextReferenceResponseSchema = z.union([
  z.object({ ...read, scope: OwnPlanningScopeSchema, currentAuthority: z.null() }).strict(),
  z.object({ ...read, scope: ClientPlanningScopeSchema, currentAuthority: view }).strict()
    .refine(result => result.scope.clientId === result.currentAuthority.clientId),
]).refine(result => result.inputRevision <= result.revision);
export type ContextReferenceResponse = z.infer<typeof ContextReferenceResponseSchema>;
export const ContextReferenceQuerySchema = z.object({ scope: PlanningScopeSchema, contextId: OrganizationIdSchema,
  versionId: OrganizationIdSchema.optional() }).strict();
export const ContextReferenceAssetQuerySchema = ContextReferenceQuerySchema.extend({ bindingId: OrganizationIdSchema }).strict();
export const ContextReviewReferenceAssetQuerySchema = z.object({ submissionId: OrganizationIdSchema, bindingId: OrganizationIdSchema }).strict();
export const ContextReviewReferenceQuerySchema = z.object({ submissionId: OrganizationIdSchema }).strict();
export const ContextReviewReferenceResponseSchema = z.object({ submissionId: OrganizationIdSchema, contextId: OrganizationIdSchema,
  references: ContextReferenceManifestSchema }).strict();
export const CampaignReviewReferenceResponseSchema = z.object({ submissionId: OrganizationIdSchema, campaignId: OrganizationIdSchema,
  contextVersionId: OrganizationIdSchema.nullable(), references: z.union([ContextReferenceManifestSchema,
    z.object({ kind: z.literal("NO_CONTEXT") }).strict()]) }).strict()
  .refine(result => (result.contextVersionId === null) === (result.references.kind === "NO_CONTEXT"));
export type ContextReviewReferenceResponse = z.infer<typeof ContextReviewReferenceResponseSchema>;
export type CampaignReviewReferenceResponse = z.infer<typeof CampaignReviewReferenceResponseSchema>;
