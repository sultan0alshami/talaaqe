import { CampaignDraftFieldsSchema } from "@/lib/campaigns/contracts";
import { adminRead, type AdminActor, type AdminOptions } from "./context";
import { AdminCampaignsQuerySchema, AdminCampaignsSchema, AdminReadError, type AdminCampaignsDTO } from "./contracts";

export function parseAdminCampaignsQuery(input: unknown) {
  const parsed = AdminCampaignsQuerySchema.safeParse(input);
  if (!parsed.success) throw new AdminReadError("VALIDATION", 422);
  return parsed.data;
}
function savedBudget(input: unknown, revision: number) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const state = input as Record<string, unknown>;
  if (state.schemaVersion !== 1 || typeof state.fieldsRevision !== "number" || !Number.isSafeInteger(state.fieldsRevision)
    || state.fieldsRevision < 1 || state.fieldsRevision > revision) return null;
  const fields = CampaignDraftFieldsSchema.safeParse(state.fields);
  return fields.success ? fields.data.budget ?? null : null;
}

export async function getAdminCampaigns(actor: AdminActor, input: unknown = {}, options: AdminOptions = {}): Promise<AdminCampaignsDTO> {
  return adminRead(actor, options, async (tx, asOf) => {
    const query = parseAdminCampaignsQuery(input);
    const rows = await tx.campaign.findMany({ where: query.after ? { id: { gt: query.after } } : undefined,
      orderBy: { id: "asc" }, take: 31,
      select: { id: true, title: true, status: true, revision: true, input: true, createdAt: true, brand: { select: { name: true } } } });
    const result = AdminCampaignsSchema.parse({ asOf: asOf.toISOString(), scope: "ALL_STORED_RECORDS",
      campaigns: rows.slice(0, 30).map(row => {
        const budget = savedBudget(row.input, row.revision);
        return { id: row.id, title: row.title, brandName: row.brand.name, status: row.status, revision: row.revision,
          createdAt: row.createdAt.toISOString(), budget, budgetSource: budget ? "SAVED_INPUT" : "UNAVAILABLE" };
      }), nextCursor: rows.length > 30 ? rows[29].id : null });
    await tx.adminAudit.create({ data: { actorUserId: actor.userId, action: "admin.campaigns_accessed", resourceType: "CampaignList", resourceId: "platform",
      snapshot: { asOf: result.asOf, after: query.after ?? null, returned: result.campaigns.length, nextCursor: result.nextCursor, scope: result.scope } } });
    return result;
  });
}
