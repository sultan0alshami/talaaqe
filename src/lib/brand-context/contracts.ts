import { z } from "zod";
import { ContentLanguageSchema, UtcDateTimeSchema } from "@/lib/contracts/vocabulary";
import { ClientAuthoritySchema, OrganizationIdSchema, OrganizationRevisionSchema } from "@/lib/organizations/contracts";

export const BRAND_CONTEXT_LIMITS = Object.freeze({ contentBytes: 65536, headers: 20, versions: 20, reviews: 20 });
const text = z.string().regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/, "Unsupported control character");
const original = (maximum: number) => z.object({ text: text.max(maximum).refine(value => value.trim().length > 0), language: ContentLanguageSchema }).strict();
const nullableOriginal = (maximum: number) => z.object({ text: text.max(maximum).nullable(), language: ContentLanguageSchema }).strict();
export const BrandContextNameSchema = z.object({ text: text.trim().min(1).max(200), language: ContentLanguageSchema }).strict();
// This is a stored private reference, never a fetch authorization or proof.
export const BrandContextReferenceUrlSchema = text.min(1).max(2048).refine(value => {
  if (value !== value.trim()) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
});
export const BrandContextContentSchema = z.object({
  schemaVersion: z.literal(1), positioning: nullableOriginal(5000), values: z.array(original(200)).max(20),
  tone: nullableOriginal(500), references: z.array(z.object({ label: original(200), url: BrandContextReferenceUrlSchema.nullable(), notes: nullableOriginal(2000) }).strict()).max(20),
  competitors: z.array(z.object({ name: original(200), url: BrandContextReferenceUrlSchema.nullable(), notes: nullableOriginal(2000) }).strict()).max(20),
}).strict().refine(value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= BRAND_CONTEXT_LIMITS.contentBytes);
export type BrandContextContent = z.infer<typeof BrandContextContentSchema>;
export const OwnPlanningScopeSchema = z.object({ kind: z.literal("OWN_BRAND"), brandId: OrganizationIdSchema }).strict();
export const ClientPlanningScopeSchema = z.object({ kind: z.literal("CLIENT"), clientId: OrganizationIdSchema }).strict();
export const PlanningScopeSchema = z.discriminatedUnion("kind", [OwnPlanningScopeSchema, ClientPlanningScopeSchema]);
export type PlanningScope = z.infer<typeof PlanningScopeSchema>;
const contextPayload = z.object({ nameOriginal: BrandContextNameSchema, content: BrandContextContentSchema }).strict();
const existing = { contextId: OrganizationIdSchema, expectedRevision: OrganizationRevisionSchema };
const actions = [
  { action: z.literal("CREATE"), expectedRevision: z.literal(0), payload: contextPayload },
  { ...existing, action: z.literal("UPDATE"), payload: contextPayload },
  { ...existing, action: z.literal("SET_ARCHIVED"), payload: z.object({ archived: z.boolean() }).strict() },
  { ...existing, action: z.literal("SUBMIT"), payload: z.object({}).strict() },
] as const;
const ownBase = { operationKey: z.uuid(), scope: OwnPlanningScopeSchema };
const planAuthority = ClientAuthoritySchema.extend({ capability: z.literal("plan") }).strict();
const clientBase = { operationKey: z.uuid(), scope: ClientPlanningScopeSchema, expectedAuthority: planAuthority };
export const BrandContextCommandSchema = z.union([
  z.discriminatedUnion("action", [z.object({ ...ownBase, ...actions[0] }).strict(), z.object({ ...ownBase, ...actions[1] }).strict(),
    z.object({ ...ownBase, ...actions[2] }).strict(), z.object({ ...ownBase, ...actions[3] }).strict()]),
  z.discriminatedUnion("action", [z.object({ ...clientBase, ...actions[0] }).strict(), z.object({ ...clientBase, ...actions[1] }).strict(),
    z.object({ ...clientBase, ...actions[2] }).strict(), z.object({ ...clientBase, ...actions[3] }).strict()])
    .refine(command => command.scope.clientId === command.expectedAuthority.clientId),
]);
export type BrandContextCommand = z.infer<typeof BrandContextCommandSchema>;
export const BrandContextActionSchema = z.enum(["CREATE", "UPDATE", "SET_ARCHIVED", "SUBMIT"]);
export const BrandContextReceiptSchema = z.object({
  contextId: OrganizationIdSchema, revision: OrganizationRevisionSchema, inputRevision: OrganizationRevisionSchema,
  action: BrandContextActionSchema, archived: z.boolean(), submissionId: OrganizationIdSchema.nullable(),
}).strict().refine(value => value.inputRevision <= value.revision)
  .refine(value => (value.action === "SUBMIT") === (value.submissionId !== null));
export const BrandContextCommandResultSchema = BrandContextReceiptSchema.safeExtend({ replayed: z.boolean() }).strict();
export type BrandContextCommandResult = z.infer<typeof BrandContextCommandResultSchema>;
const viewAuthority = ClientAuthoritySchema.extend({ capability: z.literal("view") }).strict();
const ownReadContext = { scope: OwnPlanningScopeSchema, currentAuthority: z.null() };
const clientReadContext = { scope: ClientPlanningScopeSchema, currentAuthority: viewAuthority };
const clientReadBinding = z.object(clientReadContext);
function scopedResponse<T extends z.ZodRawShape>(fields: T) {
  // Strictness applies to the complete response. Intersecting two strict
  // objects would reject each other's fields before checking their binding.
  return z.union([
    z.object(fields).extend(ownReadContext).strict(),
    z.object(fields).extend(clientReadContext).strict()
      .refine(value => {
        const binding = clientReadBinding.safeParse(value);
        return binding.success && binding.data.scope.clientId === binding.data.currentAuthority.clientId;
      }),
  ]);
}
export const BrandContextReadContextSchema = scopedResponse({});
export const BrandContextHeaderSchema = z.object({
  id: OrganizationIdSchema, nameOriginal: BrandContextNameSchema, revision: OrganizationRevisionSchema,
  inputRevision: OrganizationRevisionSchema, archived: z.boolean(), createdAt: UtcDateTimeSchema, updatedAt: UtcDateTimeSchema,
}).strict().refine(value => value.inputRevision <= value.revision);
export const ApprovedBrandContextVersionSchema = z.object({
  id: OrganizationIdSchema, contextId: OrganizationIdSchema, version: OrganizationRevisionSchema, inputRevision: OrganizationRevisionSchema,
  nameOriginal: BrandContextNameSchema, content: BrandContextContentSchema, contentHash: z.string().regex(/^[a-f0-9]{64}$/), approvedAt: UtcDateTimeSchema,
}).strict();
export const BrandContextDetailSchema = BrandContextHeaderSchema.safeExtend({
  content: BrandContextContentSchema, versions: z.array(ApprovedBrandContextVersionSchema).max(BRAND_CONTEXT_LIMITS.versions),
  versionsAfter: OrganizationIdSchema.nullable(),
}).strict();
export const BrandContextListQuerySchema = z.object({ scope: PlanningScopeSchema, archived: z.boolean().default(false),
  after: OrganizationIdSchema.optional(), limit: z.number().int().min(1).max(BRAND_CONTEXT_LIMITS.headers).default(BRAND_CONTEXT_LIMITS.headers) }).strict();
export const BrandContextDetailQuerySchema = z.object({ scope: PlanningScopeSchema, contextId: OrganizationIdSchema,
  versionsAfter: OrganizationIdSchema.optional() }).strict();
export const BrandContextVersionQuerySchema = z.object({ scope: PlanningScopeSchema, versionId: OrganizationIdSchema }).strict();
export const BrandContextListSchema = scopedResponse({ asOf: UtcDateTimeSchema,
  contexts: z.array(BrandContextHeaderSchema).max(BRAND_CONTEXT_LIMITS.headers), nextCursor: OrganizationIdSchema.nullable() });
export const BrandContextDetailResponseSchema = scopedResponse({ asOf: UtcDateTimeSchema, context: BrandContextDetailSchema });
export const BrandContextVersionResponseSchema = scopedResponse({ asOf: UtcDateTimeSchema, version: ApprovedBrandContextVersionSchema });
export const ContextOwnerReviewSchema = z.object({
  id: OrganizationIdSchema, contextId: OrganizationIdSchema, scope: PlanningScopeSchema, nameOriginal: BrandContextNameSchema,
  inputRevision: OrganizationRevisionSchema, revision: OrganizationRevisionSchema, state: z.enum(["PENDING", "APPROVED", "DECLINED"]),
  sourceStale: z.boolean(), approvalAvailable: z.boolean(), createdAt: UtcDateTimeSchema, decidedAt: UtcDateTimeSchema.nullable(),
  versionId: OrganizationIdSchema.nullable(),
}).strict().refine(value => value.state === "PENDING"
  ? value.revision === 1 && value.decidedAt === null && value.versionId === null
  : value.revision === 2 && value.decidedAt !== null && (value.state === "APPROVED") === (value.versionId !== null))
  .refine(value => !value.approvalAvailable || value.state === "PENDING" && !value.sourceStale);
export const ContextOwnerReviewDetailSchema = ContextOwnerReviewSchema.safeExtend({ content: BrandContextContentSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const ContextOwnerReviewsQuerySchema = z.object({ after: OrganizationIdSchema.optional(),
  limit: z.number().int().min(1).max(BRAND_CONTEXT_LIMITS.reviews).default(BRAND_CONTEXT_LIMITS.reviews) }).strict();
export const ContextOwnerReviewQuerySchema = z.object({ submissionId: OrganizationIdSchema }).strict();
export const ContextOwnerReviewsSchema = z.object({ asOf: UtcDateTimeSchema,
  reviews: z.array(ContextOwnerReviewSchema).max(BRAND_CONTEXT_LIMITS.reviews), nextCursor: OrganizationIdSchema.nullable() }).strict();
export const ContextOwnerReviewResponseSchema = z.object({ asOf: UtcDateTimeSchema, review: ContextOwnerReviewDetailSchema }).strict();
export const ContextOwnerReviewCommandSchema = z.object({ operationKey: z.uuid(), submissionId: OrganizationIdSchema,
  expectedRevision: OrganizationRevisionSchema, decision: z.enum(["APPROVE", "DECLINE"]) }).strict();
export const ContextOwnerReviewReceiptSchema = z.object({ submissionId: OrganizationIdSchema, contextId: OrganizationIdSchema,
  revision: OrganizationRevisionSchema, state: z.enum(["APPROVED", "DECLINED"]), versionId: OrganizationIdSchema.nullable(),
  version: OrganizationRevisionSchema.nullable() }).strict().refine(value => value.revision === 2 && (value.state === "APPROVED"
    ? value.versionId !== null && value.version !== null : value.versionId === null && value.version === null));
export const ContextOwnerReviewResultSchema = ContextOwnerReviewReceiptSchema.safeExtend({ replayed: z.boolean() }).strict();
export type ContextOwnerReviewResult = z.infer<typeof ContextOwnerReviewResultSchema>;
export type BrandContextList = z.infer<typeof BrandContextListSchema>;
export type BrandContextDetailResponse = z.infer<typeof BrandContextDetailResponseSchema>;
export type BrandContextVersionResponse = z.infer<typeof BrandContextVersionResponseSchema>;
export type ContextOwnerReviews = z.infer<typeof ContextOwnerReviewsSchema>;
export type ContextOwnerReviewResponse = z.infer<typeof ContextOwnerReviewResponseSchema>;
export function parseBrandContextInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input); if (!parsed.success) throw new BrandContextError("VALIDATION", 422); return parsed.data;
}
export class BrandContextError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); this.name = "BrandContextError"; }
}
