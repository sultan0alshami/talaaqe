import { z } from "zod";
import { OriginalTextSchema } from "@/lib/contracts/vocabulary";

export const AdminEvidenceKindSchema = z.enum(["OWNERSHIP", "SCREENSHOT", "ADVERTISING_LICENCE", "REPRESENTATIVE", "BUSINESS_REGISTRATION"]);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const AdminOverviewSchema = z.object({
  asOf: z.iso.datetime(),
  scope: z.literal("ALL_STORED_RECORDS"),
  counts: z.object({ users: count, brandAccounts: count, creatorAccounts: count, campaigns: count, weeklyCampaigns: count, briefVersions: count, pendingEvidence: count, deals: count }).strict(),
  pending: z.array(z.object({ kind: AdminEvidenceKindSchema, count }).strict()).length(5).refine(rows => new Set(rows.map(row => row.kind)).size === 5),
  ownershipPreview: z.array(z.object({ id: z.string().min(1).max(200), platform: z.string().min(1).max(100), handle: z.string().min(1).max(1000), startedAt: z.iso.datetime(), hasEvidenceReference: z.boolean() }).strict()).max(8),
}).strict();
export type AdminOverviewDTO = z.infer<typeof AdminOverviewSchema>;

export const AdminUserSchema = z.object({
  id: z.string().min(1).max(200), name: z.string().max(10000), email: z.string().max(254),
  role: z.enum(["BRAND", "CREATOR", "ADMIN"]), active: z.boolean(),
  statusVersion: z.number().int().positive().max(2147483647), joined: z.iso.datetime(),
}).strict();
export const AdminUsersSchema = z.object({
  asOf: z.iso.datetime(), selfId: z.string().min(1).max(200),
  users: z.array(AdminUserSchema).max(30), nextCursor: z.string().min(1).max(200).nullable(),
}).strict();
export type AdminUserDTO = z.infer<typeof AdminUserSchema>;
export type AdminUsersDTO = z.infer<typeof AdminUsersSchema>;
export const AdminUsersQuerySchema = z.object({ after: z.string().min(1).max(200).regex(/^[\x21-\x7e]+$/).optional() }).strict();
export const AdminUserStatusCommandSchema = z.object({
  operationKey: z.uuid(), expectedActive: z.boolean(), expectedVersion: z.number().int().positive().max(2147483647),
  active: z.boolean(), reason: OriginalTextSchema.refine(value => value.text.trim().length >= 2 && value.text.length <= 2000),
}).strict().refine(value => value.active !== value.expectedActive);
export const AdminUserStatusResultSchema = z.object({
  userId: z.string().min(1).max(200), active: z.boolean(), statusVersion: z.number().int().positive().max(2147483647), appliedAt: z.iso.datetime(), replayed: z.boolean(),
}).strict();
export type AdminUserStatusCommand = z.infer<typeof AdminUserStatusCommandSchema>;

export class AdminReadError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); this.name = "AdminReadError"; }
}
