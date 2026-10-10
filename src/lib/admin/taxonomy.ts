import { adminRead, type AdminActor, type AdminOptions } from "./context";
import { AdminReadError } from "./contracts";
import { Prisma } from "@prisma/client";
import { FameIndustrySchema } from "@/lib/contracts/vocabulary";
import { FAME_RELATED_NICHES, NICHE_SOURCE, NICHE_TAXONOMY } from "@/lib/contracts/taxonomy";
import { AdminTaxonomySchema, type AdminTaxonomyDTO } from "./taxonomy-contracts";

const invalid = (): never => { throw new AdminReadError("INVALID_STORED_TAXONOMY", 503); };
function count(value: unknown): number {
  if (typeof value !== "bigint" || value < BigInt(0) || value > BigInt(Number.MAX_SAFE_INTEGER)) return invalid();
  return Number(value);
}
function grouped(rows: Array<{ tag: unknown; count: unknown }>, allowed: readonly string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const row of rows) {
    if (Object.keys(row).sort().join(",") !== "count,tag" || typeof row.tag !== "string" || !allowed.includes(row.tag) || result.has(row.tag)) return invalid();
    result.set(row.tag, count(row.count));
  }
  return result;
}
export async function getAdminTaxonomy(actor: AdminActor, options: AdminOptions = {}): Promise<AdminTaxonomyDTO> {
  const capturedActor = { userId: actor?.userId, role: actor?.role, sessionId: actor?.sessionId, sessionVersion: actor?.sessionVersion };
  const captured: AdminOptions = { client: options.client, ...(options.now ? { now: new Date(options.now.getTime()) } : {}) };
  return adminRead(capturedActor, captured, async (tx, asOf) => {
    const nicheKeys = NICHE_TAXONOMY.map(row => row.slug), fameKeys = FameIndustrySchema.options;
    // Exact stored assignments only. DISTINCT prevents duplicate array entries
    // from inflating counts. Unknown raw tags/private profile JSON never leave SQL.
    const [nicheRows, fameRows, unknownRows] = await Promise.all([
      tx.$queryRaw<Array<{ tag: unknown; count: unknown }>>(Prisma.sql`
        SELECT item.tag,COUNT(DISTINCT c.id) AS count FROM "Creator" c
        CROSS JOIN LATERAL unnest(c."nicheIds") AS item(tag)
        WHERE item.tag IN (${Prisma.join(nicheKeys)}) GROUP BY item.tag`),
      tx.$queryRaw<Array<{ tag: unknown; count: unknown }>>(Prisma.sql`
        SELECT item.tag,COUNT(DISTINCT c.id) AS count FROM "Creator" c
        CROSS JOIN LATERAL unnest(c."fameTags") AS item(tag)
        WHERE item.tag IN (${Prisma.join([...fameKeys])}) GROUP BY item.tag`),
      tx.$queryRaw<Array<{ nicheCreators: unknown; fameCreators: unknown }>>(Prisma.sql`
        SELECT COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM unnest(c."nicheIds") AS item(tag)
          WHERE item.tag IS NULL OR item.tag NOT IN (${Prisma.join(nicheKeys)}))) AS "nicheCreators",
          COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM unnest(c."fameTags") AS item(tag)
          WHERE item.tag IS NULL OR item.tag NOT IN (${Prisma.join([...fameKeys])}))) AS "fameCreators"
        FROM "Creator" c`),
    ]);
    const niches = grouped(nicheRows, nicheKeys), fame = grouped(fameRows, fameKeys);
    if (unknownRows.length !== 1 || Object.keys(unknownRows[0]!).sort().join(",") !== "fameCreators,nicheCreators") return invalid();
    const unknownAssignments = { nicheCreators: count(unknownRows[0]!.nicheCreators), fameCreators: count(unknownRows[0]!.fameCreators) };
    const parsed = AdminTaxonomySchema.safeParse({ asOf: asOf.toISOString(), scope: "ALL_STORED_CREATOR_ASSIGNMENTS", source: { ...NICHE_SOURCE },
      niches: NICHE_TAXONOMY.map(row => ({ ...row, assignmentCount: niches.get(row.slug) ?? 0 })),
      fame: fameKeys.map(industry => ({ industry, relatedNicheSlugs: [...FAME_RELATED_NICHES[industry]], assignmentCount: fame.get(industry) ?? 0 })), unknownAssignments });
    if (!parsed.success) return invalid();
    const result = parsed.data;
    await tx.adminAudit.create({ data: { actorUserId: capturedActor.userId, action: "admin.taxonomy_accessed", resourceType: "AdminTaxonomy", resourceId: "platform",
      snapshot: { asOf: result.asOf, scope: result.scope, nicheEntries: result.niches.length, fameEntries: result.fame.length,
        unknownNicheCreators: unknownAssignments.nicheCreators, unknownFameCreators: unknownAssignments.fameCreators } } });
    return result;
  });
}
