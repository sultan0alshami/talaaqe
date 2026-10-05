import { Prisma } from "@prisma/client";
import { checkOrganizationActor, lockStoredOrganization, organizationDb, withOrganizationTransaction, type OrganizationActor, type OrganizationOptions } from "./context";
import { OrganizationClientsQuerySchema, OrganizationDirectorySchema, OrganizationError, parseOrganizationInput, type OrganizationDirectoryDTO } from "./contracts";

type Candidate = { id: string; ownerUserId: string; membershipId: string };
async function candidates(db: Pick<Prisma.TransactionClient, "$queryRaw">, userId: string, after?: string) {
  return db.$queryRaw<Candidate[]>(Prisma.sql`
    SELECT o.id, o."ownerUserId", m.id AS "membershipId"
    FROM "Organization" o JOIN "OrganizationMembership" m ON m."organizationId"=o.id
    WHERE m."userId"=${userId} AND m.state IN ('PENDING','ACTIVE')
      ${after ? Prisma.sql`AND o.id > ${after}` : Prisma.empty}
    ORDER BY o.id LIMIT 31`);
}
export async function getOrganizationDirectory(actor: OrganizationActor, input: unknown = {}, options: OrganizationOptions = {}): Promise<OrganizationDirectoryDTO> {
  await checkOrganizationActor(actor, options);
  const query = parseOrganizationInput(OrganizationClientsQuerySchema, input);
  const initial = await candidates(organizationDb(options), actor.userId, query.after);
  return withOrganizationTransaction(actor, options, { write: false, userIds: initial.map(row => row.ownerUserId) }, async (tx, locked) => {
    const rows = await candidates(tx, actor.userId, query.after);
    const organizations = [];
    // All Organization locks precede all Membership locks, in identity order.
    const orgs = new Map<string, Awaited<ReturnType<typeof lockStoredOrganization>>>();
    for (const row of rows) orgs.set(row.id, await lockStoredOrganization(tx, row.id, locked));
    const membershipIds = rows.map(row => row.membershipId).sort();
    if (membershipIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM "OrganizationMembership" WHERE id IN (${Prisma.join(membershipIds)}) ORDER BY id FOR SHARE`);
    for (const row of rows) {
      const organization = orgs.get(row.id)!;
      const membership = await tx.organizationMembership.findUnique({ where: { id: row.membershipId } });
      if (!membership || membership.organizationId !== row.id || membership.userId !== actor.userId
        || (membership.state !== "ACTIVE" && membership.state !== "PENDING")) throw new OrganizationError("RETRY_REQUIRED", 503);
      const owner = await tx.user.findUnique({ where: { id: organization.ownerUserId }, select: { active: true, role: true } });
      if (organizations.length < 30) organizations.push({
        organization: { id: organization.id, name: organization.name, kind: organization.kind, active: organization.active, revision: organization.revision },
        membership: { id: membership.id, organizationId: membership.organizationId, userId: membership.userId, state: membership.state, revision: membership.revision },
        isOwner: organization.ownerUserId === actor.userId,
        available: organization.active && owner?.active === true && owner.role === "BRAND",
      });
    }
    const result = OrganizationDirectorySchema.parse({ asOf: new Date().toISOString(), organizations,
      nextCursor: rows.length > 30 ? organizations.at(-1)!.organization.id : null });
    await tx.adminAudit.create({ data: { actorUserId: actor.userId, action: "organization.directory_read",
      resourceType: "OrganizationDirectory", resourceId: actor.userId,
      snapshot: { asOf: result.asOf, after: query.after ?? null, returned: organizations.length, nextCursor: result.nextCursor } } });
    return result;
  });
}
