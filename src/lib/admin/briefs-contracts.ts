import { z } from "zod";
import { CampaignRequirementsSchema } from "@/lib/campaigns/contracts";
import { UtcDateTimeSchema } from "@/lib/contracts/vocabulary";
import { AdminUsersQuerySchema } from "./contracts";

export const ADMIN_BRIEFS_MAX_JSON_BYTES = 1_900_000;
const id = AdminUsersQuerySchema.shape.after.unwrap();
const revision = z.number().int().positive().max(2_147_483_647);
export const AdminBriefSchema = z.object({
  id, campaignId: id, brandName: z.string().max(10_000), version: revision,
  inputRevision: revision, requirements: CampaignRequirementsSchema,
  approvedAt: UtcDateTimeSchema.nullable(), createdAt: UtcDateTimeSchema,
}).strict().refine(row => row.campaignId === row.requirements.campaignId && row.version === row.requirements.version);
export const AdminBriefsSchema = z.object({
  asOf: UtcDateTimeSchema, scope: z.literal("EARLIER_WORKFLOW"),
  briefs: z.array(AdminBriefSchema).max(30), nextCursor: id.nullable(),
}).strict().refine(value => value.briefs.every((row, index) => index === 0 || row.id > value.briefs[index - 1]!.id)
  && (value.nextCursor === null || value.briefs.length > 0 && value.nextCursor === value.briefs[value.briefs.length - 1]!.id))
  .refine(value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= ADMIN_BRIEFS_MAX_JSON_BYTES);
export const AdminBriefsQuerySchema = AdminUsersQuerySchema;
export type AdminBriefsDTO = z.infer<typeof AdminBriefsSchema>;
