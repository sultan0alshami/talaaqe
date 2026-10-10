import { AdminReadError } from "./contracts";
import { Prisma } from "@prisma/client";
import { adminRead, type AdminActor, type AdminOptions } from "./context";
import { CampaignStatusSchema } from "@/lib/contracts/vocabulary";
import { AdminAnalyticsSchema, AdminAnalyticsUnavailableMetrics, type AdminAnalyticsDTO } from "./analytics-contracts";

const invalid = (): never => { throw new AdminReadError("INVALID_STORED_ANALYTICS", 503); };
function number(value: unknown): number {
  if (typeof value !== "bigint" || value < BigInt(0) || value > BigInt(Number.MAX_SAFE_INTEGER)) return invalid();
  return Number(value);
}
async function count(tx: Prisma.TransactionClient, from: Prisma.Sql, predicate = Prisma.empty): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ count: unknown }>>(Prisma.sql`SELECT COUNT(*) AS count FROM ${from}
    WHERE NOT EXISTS (SELECT 1 FROM "CampaignPlanningBinding" p WHERE p."campaignId"=c.id) ${predicate}`);
  if (rows.length !== 1 || Object.keys(rows[0]!).join(",") !== "count") return invalid();
  return number(rows[0]!.count);
}
export function getAdminAnalytics(actor: AdminActor, options: AdminOptions = {}): Promise<AdminAnalyticsDTO> {
  // Capture trusted composition inputs before the first native wait. They never
  // replace the actual authentication clock in adminRead.
  const captured: AdminOptions = { client: options.client, ...(options.now ? { now: new Date(options.now.getTime()) } : {}) };
  return adminRead(actor, captured, async (tx, asOf) => {
    const midnight = new Date(asOf.getTime()); midnight.setUTCHours(0, 0, 0, 0);
    const startsAt = new Date(midnight.getTime() - 6 * 86400000).toISOString(), endsAt = asOf.toISOString();
    const dates = Array.from({ length: 7 }, (_, index) => new Date(Date.parse(startsAt) + index * 86400000).toISOString().slice(0, 10));
    const [campaigns, briefVersions, matchRuns, recommendationRows, deals, completedDeals] = await Promise.all([
      count(tx, Prisma.sql`"Campaign" c`),
      count(tx, Prisma.sql`"CampaignBrief" b JOIN "Campaign" c ON c.id=b."campaignId"`),
      count(tx, Prisma.sql`"MatchRun" r JOIN "Campaign" c ON c.id=r."campaignId"`),
      count(tx, Prisma.sql`"CreatorMatch" m JOIN "MatchRun" r ON r.id=m."runId" JOIN "Campaign" c ON c.id=r."campaignId"`),
      count(tx, Prisma.sql`"Deal" d JOIN "Campaign" c ON c.id=d."campaignId"`),
      count(tx, Prisma.sql`"Deal" d JOIN "Campaign" c ON c.id=d."campaignId"`, Prisma.sql`AND d.status='COMPLETED'`),
    ]);
    const statusRows = await tx.$queryRaw<Array<{ status: unknown; count: unknown }>>(Prisma.sql`
      SELECT c.status AS status,COUNT(*) AS count FROM "Campaign" c
      WHERE NOT EXISTS (SELECT 1 FROM "CampaignPlanningBinding" p WHERE p."campaignId"=c.id) GROUP BY c.status`);
    // Prisma timestamps store civil UTC without a time zone. Explicit timestamp
    // boundaries/date projection avoid the connection's local-zone conversion.
    const dateRows = await tx.$queryRaw<Array<{ date: unknown; count: unknown }>>(Prisma.sql`
      SELECT c."createdAt"::date AS date,COUNT(*) AS count FROM "Campaign" c
      WHERE NOT EXISTS (SELECT 1 FROM "CampaignPlanningBinding" p WHERE p."campaignId"=c.id)
        AND c."createdAt">=${startsAt}::timestamp(3) AND c."createdAt"<=${endsAt}::timestamp(3)
      GROUP BY c."createdAt"::date`);
    const statuses = new Map<string, number>(), days = new Map<string, number>();
    for (const row of statusRows) {
      if (Object.keys(row).sort().join(",") !== "count,status" || !CampaignStatusSchema.safeParse(row.status).success || statuses.has(String(row.status))) return invalid();
      statuses.set(String(row.status), number(row.count));
    }
    for (const row of dateRows) {
      if (Object.keys(row).sort().join(",") !== "count,date" || !(row.date instanceof Date) || !Number.isFinite(row.date.getTime())) return invalid();
      const date = row.date.toISOString().slice(0, 10);
      if (!dates.includes(date) || row.date.toISOString() !== date + "T00:00:00.000Z" || days.has(date)) return invalid();
      days.set(date, number(row.count));
    }
    const parsed = AdminAnalyticsSchema.safeParse({ asOf: endsAt, scope: "EARLIER_WORKFLOW_RECORDS", timeZone: "UTC",
      counts: { campaigns, briefVersions, matchRuns, recommendationRows, deals, completedDeals },
      campaignStatuses: CampaignStatusSchema.options.map(status => ({ status, count: statuses.get(status) ?? 0 })),
      campaignDays: dates.map(date => ({ date, count: days.get(date) ?? 0 })), window: { startsAt, endsAt },
      unavailableMetrics: [...AdminAnalyticsUnavailableMetrics] });
    if (!parsed.success) return invalid();
    const result = parsed.data;
    await tx.adminAudit.create({ data: { actorUserId: actor.userId, action: "admin.analytics_accessed", resourceType: "AdminAnalytics", resourceId: "platform",
      snapshot: { asOf: result.asOf, scope: result.scope, window: result.window, counts: result.counts } } });
    return result;
  });
}
