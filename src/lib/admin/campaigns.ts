import { Prisma } from '@prisma/client';
import { CampaignDraftFieldsSchema } from '@/lib/campaigns/contracts';
import { adminRead, type AdminActor, type AdminOptions } from './context';
import { AdminCampaignsQuerySchema, AdminCampaignsSchema, AdminReadError, type AdminCampaignsDTO } from './contracts';

export function parseAdminCampaignsQuery(input: unknown) {
  const parsed = AdminCampaignsQuerySchema.safeParse(input);
  if (!parsed.success) throw new AdminReadError('VALIDATION', 422);
  return parsed.data;
}
function savedBudget(input: unknown, revision: number) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const state = input as Record<string, unknown>;
  if (state.schemaVersion !== 1 || typeof state.fieldsRevision !== 'number' || !Number.isSafeInteger(state.fieldsRevision)
    || state.fieldsRevision < 1 || state.fieldsRevision > revision) return null;
  const fields = CampaignDraftFieldsSchema.safeParse(state.fields);
  return fields.success ? fields.data.budget ?? null : null;
}

type Header = { id: string; title: string; status: string; revision: number; createdAt: Date; brandName: string; budgetInput: unknown };
export async function getAdminCampaigns(actor: AdminActor, input: unknown = {}, options: AdminOptions = {}): Promise<AdminCampaignsDTO> {
  return adminRead(actor, options, async (tx, asOf) => {
    const query = parseAdminCampaignsQuery(input);
    // Account administration is not permission to read scoped managed planning.
    // Exclude protected bindings before paging/projection; never fetch their
    // draft fields or use live campaign input for the later operational viewer.
    const cursor = query.after ? Prisma.sql`AND c.id > ${query.after}` : Prisma.empty;
    const rows = await tx.$queryRaw<Header[]>(Prisma.sql`
      SELECT c.id,c.title,c.status,c.revision,c."createdAt",b.name AS "brandName",
        jsonb_build_object('schemaVersion',c.input->'schemaVersion','fieldsRevision',c.input->'fieldsRevision',
          'fields',c.input->'fields') AS "budgetInput"
      FROM "Campaign" c JOIN "Brand" b ON b.id=c."brandId"
      WHERE NOT EXISTS (SELECT 1 FROM "CampaignPlanningBinding" p WHERE p."campaignId"=c.id)
        ${cursor} ORDER BY c.id ASC LIMIT 31`);
    const result = AdminCampaignsSchema.parse({ asOf: asOf.toISOString(), scope: 'ALL_STORED_RECORDS',
      campaigns: rows.slice(0, 30).map(row => {
        const budget = savedBudget(row.budgetInput, row.revision);
        return { id: row.id, title: row.title, brandName: row.brandName, status: row.status, revision: row.revision,
          createdAt: row.createdAt.toISOString(), budget, budgetSource: budget ? 'SAVED_INPUT' : 'UNAVAILABLE' };
      }), nextCursor: rows.length > 30 ? rows[29].id : null });
    await tx.adminAudit.create({ data: { actorUserId: actor.userId, action: 'admin.campaigns_accessed', resourceType: 'CampaignList', resourceId: 'platform',
      snapshot: { asOf: result.asOf, after: query.after ?? null, returned: result.campaigns.length, nextCursor: result.nextCursor, scope: result.scope } } });
    return result;
  });
}
