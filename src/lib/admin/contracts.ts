import { z } from "zod";

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

export class AdminReadError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); this.name = "AdminReadError"; }
}
