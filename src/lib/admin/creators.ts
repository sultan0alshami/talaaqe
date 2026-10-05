import { CountryCodeSchema } from "@/lib/contracts/vocabulary";
import { adminRead, type AdminActor, type AdminOptions } from "./context";
import { AdminCreatorsQuerySchema, AdminCreatorsSchema, AdminReadError, type AdminCreatorsDTO } from "./contracts";

export function parseAdminCreatorsQuery(input: unknown) {
  const parsed = AdminCreatorsQuerySchema.safeParse(input);
  if (!parsed.success) throw new AdminReadError("VALIDATION", 422);
  return parsed.data;
}
function cityLabel(city: unknown) {
  if (!city || typeof city !== "object" || Array.isArray(city)) return null;
  const label = (city as Record<string, unknown>).label;
  return typeof label === "string" && label.length <= 100 && label.trim().length > 0 ? label : null;
}

export async function getAdminCreators(actor: AdminActor, input: unknown = {}, options: AdminOptions = {}): Promise<AdminCreatorsDTO> {
  return adminRead(actor, options, async (tx, asOf) => {
    const query = parseAdminCreatorsQuery(input);
    const rows = await tx.creator.findMany({ where: query.after ? { id: { gt: query.after } } : undefined,
      orderBy: { id: "asc" }, take: 31,
      select: { id: true, displayName: true, handle: true, state: true, countryCode: true, city: true, userId: true } });
    const page = rows.slice(0, 30);
    const groups = page.length ? await tx.socialAccount.groupBy({ by: ["creatorId", "ownershipStatus"],
      where: { creatorId: { in: page.map(row => row.id) } }, _count: { _all: true } }) : [];
    const counts = new Map(page.map(row => [row.id, { total: 0, UNPROVED: 0, PENDING: 0, VERIFIED: 0, REJECTED: 0, REVOKED: 0 }]));
    for (const group of groups) {
      const value = counts.get(group.creatorId)!;
      value[group.ownershipStatus] = group._count._all;
      value.total += group._count._all;
    }
    const result = AdminCreatorsSchema.parse({ asOf: asOf.toISOString(), scope: "ALL_STORED_RECORDS",
      creators: page.map(row => {
        const country = CountryCodeSchema.safeParse(row.countryCode);
        return { id: row.id, displayName: row.displayName, handle: row.handle, state: row.state,
          countryCode: country.success ? country.data : null, cityLabel: cityLabel(row.city),
          claimStatus: row.userId === null ? "UNCLAIMED" : "CLAIMED", accountCounts: counts.get(row.id)! };
      }), nextCursor: rows.length > 30 ? rows[29].id : null });
    await tx.adminAudit.create({ data: { actorUserId: actor.userId, action: "admin.creators_accessed", resourceType: "CreatorList", resourceId: "platform",
      snapshot: { asOf: result.asOf, after: query.after ?? null, returned: result.creators.length, nextCursor: result.nextCursor, scope: result.scope } } });
    return result;
  });
}
