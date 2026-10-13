import { z } from "zod";
import { OriginalTextSchema, DateRangeSchema, UtcDateTimeSchema } from "@/lib/contracts/vocabulary";
import { MoneySchema } from "@/lib/contracts/money";
import { OrganizationIdSchema as id, OrganizationRevisionSchema as revision } from "@/lib/organizations/contracts";
import { planningPlainJsonSchema } from "@/lib/contracts/plain-json";

// Pure declarations only. A DTO, status or file descriptor grants no native
// authority, proves no file custody and verifies no work, earning or payment.
export class ExternalCollaborationError extends Error {
  constructor(public readonly code: string, public readonly status = 409) {
    super(code); this.name = "ExternalCollaborationError";
  }
}
export const EXTERNAL_COLLABORATION_ATTACHMENT_PURPOSE = "EXTERNAL_COLLABORATION_ATTACHMENT" as const;
export const EXTERNAL_COLLABORATION_LIMITS = Object.freeze({ detailsBytes: 262144, commandBytes: 524288,
  dtoBytes: 524288, checklist: 30, attachments: 20, list: 30, attachmentBytes: 10485760 });
export const ExternalCollaborationStatusSchema = z.enum(["DRAFT", "PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);
export type ExternalCollaborationStatus = z.infer<typeof ExternalCollaborationStatusSchema>;
const transitions: Readonly<Record<ExternalCollaborationStatus, readonly ExternalCollaborationStatus[]>> = Object.freeze({
  DRAFT: Object.freeze(["PLANNED", "IN_PROGRESS", "CANCELLED"] as const),
  PLANNED: Object.freeze(["DRAFT", "IN_PROGRESS", "CANCELLED"] as const),
  IN_PROGRESS: Object.freeze(["PLANNED", "COMPLETED", "CANCELLED"] as const),
  COMPLETED: Object.freeze(["IN_PROGRESS"] as const), CANCELLED: Object.freeze(["DRAFT"] as const),
});
export function canTransitionExternalCollaboration(from: unknown, to: unknown): boolean {
  const source = ExternalCollaborationStatusSchema.safeParse(from), target = ExternalCollaborationStatusSchema.safeParse(to);
  return source.success && target.success && transitions[source.data].includes(target.data);
}
const original = (maximum: number) => OriginalTextSchema.extend({ text: OriginalTextSchema.shape.text
  .min(1).max(maximum).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+$/)
  .refine(text => text.trim().length > 0, "Nonblank original text required") }).strict();
const display = original(200), checklistItem = z.object({ id: z.uuid(), label: original(500), done: z.boolean() }).strict();
// PostgreSQL's AD timestamp storage has no civil year0000. Keep shared
// vocabulary/history intact while matching this domain's native support.
const supportedUtc = UtcDateTimeSchema.refine(value => new Date(value).getUTCFullYear() >= 1,
  "Expected a supported AD UTC instant");
const supportedPeriod = DateRangeSchema.refine(value => supportedUtc.safeParse(value.startsAt).success
  && supportedUtc.safeParse(value.endsAt).success, "Unsupported period instant");
const checklist = z.array(checklistItem).max(EXTERNAL_COLLABORATION_LIMITS.checklist)
  .refine(items => new Set(items.map(item => item.id.toLowerCase())).size === items.length, "Distinct stable UUIDs required");
export const ExternalCollaborationDetailsSchema = planningPlainJsonSchema(z.object({ schemaVersion: z.literal(1),
  clientDisplay: display, campaignDisplay: display, declaredValue: MoneySchema.nullable(), period: supportedPeriod.nullable(),
  notes: original(10000).nullable(), brief: original(20000).nullable(), checklist,
}).strict(), EXTERNAL_COLLABORATION_LIMITS.detailsBytes);
export type ExternalCollaborationDetails = z.infer<typeof ExternalCollaborationDetailsSchema>;
const mime = z.enum(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
const fileSize = z.number().int().min(1).max(EXTERNAL_COLLABORATION_LIMITS.attachmentBytes);
const fileDescriptor = z.object({ checksum: z.string().regex(/^[a-f0-9]{64}$/), contentType: mime, size: fileSize }).strict();
const operationKey = z.uuid(), existing = { operationKey, collaborationId: id, expectedRevision: revision };
const actions = z.enum(["CREATE", "SAVE_DETAILS", "SET_STATUS", "SET_CHECKLIST", "SET_CHECKLIST_DONE", "ATTACH_FILE", "REMOVE_ATTACHMENT", "ARCHIVE", "RESTORE"]);
export const ExternalCollaborationCommandSchema = planningPlainJsonSchema(z.discriminatedUnion("action", [
  z.object({ operationKey, expectedRevision: z.literal(0), action: z.literal("CREATE"),
    payload: z.object({ details: ExternalCollaborationDetailsSchema }).strict() }).strict(),
  z.object({ ...existing, action: z.literal("SAVE_DETAILS"), payload: z.object({ details: ExternalCollaborationDetailsSchema }).strict() }).strict(),
  z.object({ ...existing, action: z.literal("SET_STATUS"), payload: z.object({ status: ExternalCollaborationStatusSchema }).strict() }).strict(),
  z.object({ ...existing, action: z.literal("SET_CHECKLIST"), payload: z.object({ checklist }).strict() }).strict(),
  z.object({ ...existing, action: z.literal("SET_CHECKLIST_DONE"), payload: z.object({ itemId: z.uuid(), done: z.boolean() }).strict() }).strict(),
  z.object({ ...existing, action: z.literal("ATTACH_FILE"), payload: z.object({ label: display, file: fileDescriptor }).strict() }).strict(),
  z.object({ ...existing, action: z.literal("REMOVE_ATTACHMENT"), payload: z.object({ attachmentId: id }).strict() }).strict(),
  z.object({ ...existing, action: z.literal("ARCHIVE"), payload: z.object({}).strict() }).strict(),
  z.object({ ...existing, action: z.literal("RESTORE"), payload: z.object({}).strict() }).strict(),
]), EXTERNAL_COLLABORATION_LIMITS.commandBytes);
export type ExternalCollaborationCommand = z.infer<typeof ExternalCollaborationCommandSchema>;

const receipt = z.object({ operationKey, collaborationId: id, action: actions, revision,
  status: ExternalCollaborationStatusSchema, archived: z.boolean(), attachmentId: id.nullable(),
}).strict().refine(value => (["ATTACH_FILE", "REMOVE_ATTACHMENT"].includes(value.action)) === (value.attachmentId !== null),
  "Attachment action requires its binding ID")
  .refine(value => value.action !== "CREATE" || value.revision === 1 && value.status === "DRAFT" && !value.archived, "Initial receipt mismatch")
  .refine(value => value.action === "CREATE" || value.revision >= 2, "Mutated receipt must follow a positive expected revision")
  .refine(value => value.action !== "ARCHIVE" || value.archived, "Archive receipt mismatch")
  .refine(value => value.action === "ARCHIVE" || !value.archived, "Only archive receipts can be archived");
export const ExternalCollaborationReceiptSchema = planningPlainJsonSchema(receipt, EXTERNAL_COLLABORATION_LIMITS.dtoBytes);
export const ExternalCollaborationResultSchema = planningPlainJsonSchema(receipt.safeExtend({ replayed: z.boolean() }).strict(), EXTERNAL_COLLABORATION_LIMITS.dtoBytes);
export type ExternalCollaborationReceipt = z.infer<typeof ExternalCollaborationReceiptSchema>;
export type ExternalCollaborationResult = z.infer<typeof ExternalCollaborationResultSchema>;
const timeline = { createdAt: supportedUtc, updatedAt: supportedUtc };
const chronology = (value: { createdAt: string; updatedAt: string }) => Date.parse(value.updatedAt) >= Date.parse(value.createdAt);
const header = z.object({ id, revision, status: ExternalCollaborationStatusSchema, archived: z.boolean(),
  clientDisplay: display, campaignDisplay: display, declaredValue: MoneySchema.nullable(), period: supportedPeriod.nullable(),
  checklist: z.object({ total: z.number().int().min(0).max(EXTERNAL_COLLABORATION_LIMITS.checklist),
    done: z.number().int().min(0).max(EXTERNAL_COLLABORATION_LIMITS.checklist) }).strict().refine(value => value.done <= value.total),
  attachmentCount: z.number().int().min(0).max(EXTERNAL_COLLABORATION_LIMITS.attachments), ...timeline,
}).strict().refine(chronology, "Updated time precedes creation");
export const ExternalCollaborationHeaderSchema = planningPlainJsonSchema(header, EXTERNAL_COLLABORATION_LIMITS.dtoBytes);
export type ExternalCollaborationHeader = z.infer<typeof ExternalCollaborationHeaderSchema>;
const attachment = z.object({ id, assetId: id, assetRevision: revision, label: display,
  contentType: mime, size: fileSize, attachedAt: supportedUtc }).strict();
export const ExternalCollaborationAttachmentSchema = planningPlainJsonSchema(attachment, EXTERNAL_COLLABORATION_LIMITS.dtoBytes);
export type ExternalCollaborationAttachment = z.infer<typeof ExternalCollaborationAttachmentSchema>;
const collaboration = z.object({ id, revision, status: ExternalCollaborationStatusSchema, archived: z.boolean(),
  details: ExternalCollaborationDetailsSchema, ...timeline }).strict().refine(chronology, "Updated time precedes creation");
export const ExternalCollaborationDetailSchema = planningPlainJsonSchema(z.object({ scope: z.literal("OWN_CREATOR"), asOf: supportedUtc,
  collaboration, attachments: z.array(attachment).max(EXTERNAL_COLLABORATION_LIMITS.attachments)
    .refine(rows => rows.every((row, index) => index === 0 || rows[index - 1]!.id < row.id)
      && new Set(rows.map(row => row.assetId)).size === rows.length, "Unique ordered binding and asset IDs required"),
}).strict().refine(value => Date.parse(value.asOf) >= Date.parse(value.collaboration.updatedAt)
  && value.attachments.every(row => Date.parse(value.asOf) >= Date.parse(row.attachedAt)), "Snapshot time precedes retained data"),
EXTERNAL_COLLABORATION_LIMITS.dtoBytes);
export type ExternalCollaborationDetail = z.infer<typeof ExternalCollaborationDetailSchema>;
export const ExternalCollaborationListSchema = planningPlainJsonSchema(z.object({ scope: z.literal("OWN_CREATOR"), asOf: supportedUtc,
  collaborations: z.array(header).max(EXTERNAL_COLLABORATION_LIMITS.list)
    .refine(rows => rows.every((row, index) => index === 0 || rows[index - 1]!.id < row.id), "Unique ascending collaboration IDs required"),
  nextCursor: id.nullable(),
}).strict().refine(value => value.collaborations.every(row => Date.parse(value.asOf) >= Date.parse(row.updatedAt))
  && (value.nextCursor === null || value.nextCursor === value.collaborations.at(-1)?.id), "Invalid snapshot or cursor"),
EXTERNAL_COLLABORATION_LIMITS.dtoBytes);
export type ExternalCollaborationList = z.infer<typeof ExternalCollaborationListSchema>;
