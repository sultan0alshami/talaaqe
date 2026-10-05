import { z } from "zod";
import { CampaignStatusSchema, ClaimStatusSchema, CountryCodeSchema, OriginalTextSchema, OwnershipStatusSchema, ProfileStateSchema } from "@/lib/contracts/vocabulary";
import { MoneySchema } from "@/lib/contracts/money";

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

export const AdminCampaignSchema = z.object({
  id: z.string().min(1).max(200), title: z.string().max(10000), brandName: z.string().max(10000),
  status: CampaignStatusSchema, revision: z.number().int().positive().max(2147483647), createdAt: z.iso.datetime(),
  budget: MoneySchema.nullable(), budgetSource: z.enum(["SAVED_INPUT", "UNAVAILABLE"]),
}).strict().refine(row => (row.budget !== null) === (row.budgetSource === "SAVED_INPUT"));
export const AdminCampaignsSchema = z.object({
  asOf: z.iso.datetime(), scope: z.literal("ALL_STORED_RECORDS"),
  campaigns: z.array(AdminCampaignSchema).max(30), nextCursor: z.string().min(1).max(200).nullable(),
}).strict();
export const AdminCampaignsQuerySchema = AdminUsersQuerySchema;
export type AdminCampaignDTO = z.infer<typeof AdminCampaignSchema>;
export type AdminCampaignsDTO = z.infer<typeof AdminCampaignsSchema>;

export const AdminCreatorAccountCountsSchema = z.object({
  total: count, UNPROVED: count, PENDING: count, VERIFIED: count, REJECTED: count, REVOKED: count,
}).strict().refine(value => value.total === OwnershipStatusSchema.options.reduce((sum, status) => sum + value[status], 0));
export const AdminCreatorSchema = z.object({
  id: z.string().min(1).max(200), displayName: z.string().max(10000), handle: z.string().max(10000),
  state: ProfileStateSchema, countryCode: CountryCodeSchema.nullable(),
  cityLabel: z.string().max(100).refine(value => value.trim().length > 0).nullable(),
  // Describes a saved User association; neither a completed claim nor proof of ownership.
  claimStatus: ClaimStatusSchema, accountCounts: AdminCreatorAccountCountsSchema,
}).strict();
export const AdminCreatorsSchema = z.object({
  asOf: z.iso.datetime(), scope: z.literal("ALL_STORED_RECORDS"),
  creators: z.array(AdminCreatorSchema).max(30), nextCursor: z.string().min(1).max(200).nullable(),
}).strict();
export const AdminCreatorsQuerySchema = AdminUsersQuerySchema;
export type AdminCreatorDTO = z.infer<typeof AdminCreatorSchema>;
export type AdminCreatorsDTO = z.infer<typeof AdminCreatorsSchema>;

export class AdminReadError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); this.name = "AdminReadError"; }
}
