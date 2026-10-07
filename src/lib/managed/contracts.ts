import { z } from "zod";
import { CampaignBriefContentSchema } from "@/lib/campaigns/contracts";
import { BriefPlanningProvenanceSchema } from "@/lib/campaign-planning/contracts";
import { ApprovedBrandContextVersionSchema, OwnPlanningScopeSchema, ClientPlanningScopeSchema } from "@/lib/brand-context/contracts";
import { ContextReferenceManifestSchema } from "@/lib/brand-context/reference-contracts";
import { ClientAuthoritySchema, OrganizationIdSchema as id, OrganizationRevisionSchema as revision } from "@/lib/organizations/contracts";
import { UtcDateTimeSchema } from "@/lib/contracts/vocabulary";
import { OriginalTextSchema } from "@/lib/contracts/vocabulary";
import { PlanningScopeSchema } from "@/lib/brand-context/contracts";

export const MANAGED_ORDER_DISCLOSURE_VERSION = "infame-order-disclosure-v1" as const;
const command = { action: z.literal("SUBMIT"), operationKey: z.uuid(), campaignId: id,
  expectedCampaignRevision: revision, expectedPlanningRevision: revision, expectedSelectionId: id,
  expectedSelectionRevision: revision, briefId: id, expectedBriefVersion: revision,
  disclosureVersion: z.literal(MANAGED_ORDER_DISCLOSURE_VERSION) };
export const ManagedOrderCommandSchema = z.union([
  z.object({ ...command, scope: OwnPlanningScopeSchema }).strict(),
  z.object({ ...command, scope: ClientPlanningScopeSchema,
    expectedAuthority: ClientAuthoritySchema.extend({ capability: z.literal("signCustomer") }).strict() }).strict(),
]).refine(value => value.scope.kind === "OWN_BRAND"
  || "expectedAuthority" in value && value.scope.clientId === value.expectedAuthority.clientId);
const approvedBrief = z.object({ id, campaignId: id, version: revision, inputRevision: revision,
  content: CampaignBriefContentSchema, approvedAt: UtcDateTimeSchema, approvedByUserId: id, createdAt: UtcDateTimeSchema }).strict();
export const ManagedOrderSnapshotSchema = z.object({ schemaVersion: z.literal(1), brief: approvedBrief,
  provenance: BriefPlanningProvenanceSchema, selectedContext: ApprovedBrandContextVersionSchema.nullable(),
  references: z.union([ContextReferenceManifestSchema, z.object({ kind: z.literal("NO_CONTEXT") }).strict()]),
}).strict().refine(value => {
  const brief = value.brief;
  if (brief.campaignId !== brief.content.requirements.campaignId || brief.version !== brief.content.requirements.version
    || brief.inputRevision !== brief.content.inputRevision || brief.approvedByUserId !== brief.content.approvedByUserId
    || Date.parse(brief.createdAt) > Date.parse(brief.approvedAt)) return false;
  if (value.provenance.versionId === null) return value.selectedContext === null && value.references.kind === "NO_CONTEXT";
  if (!value.selectedContext || value.selectedContext.id !== value.provenance.versionId
    || value.selectedContext.contentHash !== value.provenance.contentHash || value.references.kind === "NO_CONTEXT"
    || Date.parse(value.selectedContext.approvedAt) > Date.parse(brief.approvedAt)) return false;
  return value.references.kind !== "MANIFEST" || new Set(value.references.items.map(item => item.bindingId)).size === value.references.items.length;
}).refine(value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 262144);
export const ManagedOrderReceiptSchema = z.object({ action: z.literal("SUBMIT"), orderId: id, submissionId: id, campaignId: id,
  revision: z.literal(1), submissionVersion: z.literal(1), briefId: id, briefVersion: revision,
  selectionId: id, selectionRevision: revision }).strict();
export type ManagedOrderCommand = z.infer<typeof ManagedOrderCommandSchema>;
export type ManagedOrderSnapshot = z.infer<typeof ManagedOrderSnapshotSchema>;
export type ManagedOrderReceipt = z.infer<typeof ManagedOrderReceiptSchema>;
export const ManagedOrderResultSchema = ManagedOrderReceiptSchema.extend({ replayed: z.boolean() }).strict();
export type ManagedOrderResult = z.infer<typeof ManagedOrderResultSchema>;
const view = ClientAuthoritySchema.extend({ capability: z.literal("view") }).strict();
const clientReadBinding = z.object({ scope: ClientPlanningScopeSchema, currentAuthority: view });
function scoped<T extends z.ZodRawShape>(fields: T) {
  return z.union([z.object({ ...fields, scope: OwnPlanningScopeSchema, currentAuthority: z.null() }).strict(),
    z.object({ ...fields, scope: ClientPlanningScopeSchema, currentAuthority: view }).strict()
      .refine(value => { const binding = clientReadBinding.safeParse(value);
        return binding.success && binding.data.scope.clientId === binding.data.currentAuthority.clientId; })]);
}
const submission = z.object({ id, version: revision, createdAt: UtcDateTimeSchema,
  disclosureVersion: z.literal(MANAGED_ORDER_DISCLOSURE_VERSION), snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  snapshot: ManagedOrderSnapshotSchema }).strict();
const order = z.object({ id, campaignId: id, revision, status: z.literal("REQUESTED"), submission }).strict()
  .refine(value => value.campaignId === value.submission.snapshot.brief.campaignId
    && Date.parse(value.submission.createdAt) >= Date.parse(value.submission.snapshot.brief.approvedAt));
export const ManagedOrderDetailSchema = scoped({ asOf: UtcDateTimeSchema, order, quote: z.null() });
export type ManagedOrderDetail = z.infer<typeof ManagedOrderDetailSchema>;
export const ManagedOrderHeaderSchema = z.object({ id, campaignId: id, revision, status: z.literal("REQUESTED"),
  titleOriginal: OriginalTextSchema.extend({ text: z.string().max(200) }).strict(), submittedAt: UtcDateTimeSchema }).strict();
export const ManagedOrderListSchema = scoped({ asOf: UtcDateTimeSchema, orders: z.array(ManagedOrderHeaderSchema).max(20), nextCursor: id.nullable() });
export type ManagedOrderList = z.infer<typeof ManagedOrderListSchema>;
export const ManagedOrderQuerySchema = z.object({ scope: PlanningScopeSchema, orderId: id }).strict();
export const ManagedOrderListQuerySchema = z.object({ scope: PlanningScopeSchema, after: id.optional(), limit: z.number().int().min(1).max(20).default(20) }).strict();
