import { adminRead, type AdminActor, type AdminOptions } from "./context";
import { AdminReadError } from "./contracts";
import { Prisma, type CampaignBrief } from "@prisma/client";
import { campaignBriefDTO } from "@/lib/campaigns/core";
import { ADMIN_BRIEFS_MAX_JSON_BYTES, AdminBriefSchema, AdminBriefsQuerySchema, AdminBriefsSchema, type AdminBriefsDTO } from "./briefs-contracts";

const invalid = (): never => { throw new AdminReadError("INVALID_STORED_BRIEF", 503); };
type Row = CampaignBrief & { brandName: string };
export async function getAdminBriefs(actor: AdminActor, input: unknown = {}, options: AdminOptions = {}): Promise<AdminBriefsDTO> {
  const capturedActor = { userId: actor?.userId, role: actor?.role, sessionId: actor?.sessionId, sessionVersion: actor?.sessionVersion };
  const captured: AdminOptions = { client: options.client, ...(options.now ? { now: new Date(options.now.getTime()) } : {}) };
  return adminRead(capturedActor, captured, async (tx, asOf) => {
    const query = AdminBriefsQuerySchema.safeParse(input);
    if (!query.success) throw new AdminReadError("VALIDATION", 422);
    const after = query.data.after;
    const cursor = after ? Prisma.sql`AND b.id COLLATE "C" > ${after} COLLATE "C"` : Prisma.empty;
    // Protected bindings are excluded in SQL, before the page window or content
    // hydration. Current campaign input/conversation never substitutes for a brief.
    const rows = await tx.$queryRaw<Row[]>(Prisma.sql`
      SELECT b.id,b."campaignId",b.version,b."inputRevision",b.content,
        b."approvedAt",b."approvedByUserId",b."createdAt",brand.name AS "brandName"
      FROM "CampaignBrief" b JOIN "Campaign" c ON c.id=b."campaignId"
        JOIN "Brand" brand ON brand.id=c."brandId"
      WHERE NOT EXISTS (SELECT 1 FROM "CampaignPlanningBinding" p WHERE p."campaignId"=c.id)
        ${cursor} ORDER BY b.id COLLATE "C" ASC LIMIT 31`);
    const briefs: AdminBriefsDTO["briefs"] = [];
    const result: AdminBriefsDTO = { asOf: asOf.toISOString(), scope: "EARLIER_WORKFLOW", briefs, nextCursor: null };
    for (const row of rows.slice(0, 30)) {
      let candidate: AdminBriefsDTO["briefs"][number];
      try {
        const brief = campaignBriefDTO(row);
        candidate = AdminBriefSchema.parse({ id: brief.id, campaignId: brief.campaignId, brandName: row.brandName,
          version: brief.version, inputRevision: brief.inputRevision, requirements: brief.content.requirements,
          approvedAt: brief.approvedAt, createdAt: brief.createdAt });
      } catch { return invalid(); }
      // Account for the actual exclusive cursor and complete returned DTO, not
      // merely summed row sizes. A short byte page never skips its next row.
      const count = briefs.length + 1;
      const next = { ...result, briefs: [...briefs, candidate], nextCursor: rows.length > count ? candidate.id : null };
      if (Buffer.byteLength(JSON.stringify(next), "utf8") > ADMIN_BRIEFS_MAX_JSON_BYTES) {
        if (!briefs.length) return invalid();
        break;
      }
      briefs.push(candidate); result.nextCursor = next.nextCursor;
    }
    const parsed = AdminBriefsSchema.safeParse(result);
    if (!parsed.success) return invalid();
    await tx.adminAudit.create({ data: { actorUserId: capturedActor.userId, action: "admin.briefs_accessed", resourceType: "AdminBriefs", resourceId: "platform",
      snapshot: { asOf: result.asOf, after: after ?? null, returned: briefs.length, nextCursor: result.nextCursor, scope: result.scope } } });
    return parsed.data;
  });
}
