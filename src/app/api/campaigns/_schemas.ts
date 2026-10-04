import { z } from "zod";
import { CampaignDraftFieldsSchema } from "@/lib/campaigns/contracts";
export const CommandInputSchema = z.object({ operationKey: z.string().min(1).max(120).regex(/^[A-Za-z0-9_:-]+$/), expectedRevision: z.number().int().positive().max(2_147_483_646) }).strict();
export const CreateInputSchema = z.object({ operationKey: CommandInputSchema.shape.operationKey, fields: CampaignDraftFieldsSchema }).strict();
export const FormMutationSchema = CommandInputSchema.extend({ action: z.enum(["UPDATE_FIELDS", "APPLY_PROPOSAL"]), payload: z.record(z.string(), z.unknown()) }).strict();
export const ApprovalInputSchema = CommandInputSchema.extend({ briefId: z.string().min(1).max(200), expectedBriefVersion: z.number().int().positive() }).strict();
export const ListInputSchema = z.object({ limit: z.coerce.number().int().min(1).max(50).optional(), cursor: z.string().min(1).max(200).optional() }).strict();
export const CampaignIdSchema = z.string().min(1).max(200);
export type CampaignRouteContext = { params: Promise<{ id: string }> };
