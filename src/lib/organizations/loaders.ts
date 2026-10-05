import { Prisma } from "@prisma/client";
import {
  checkOrganizationActor, lockOrganization, organizationDb, validateClientDelegation, withOrganizationTransaction,
  type OrganizationActor, type OrganizationOptions, type OrganizationTransaction,
} from "./context";
import {
  ClientAuthoritySchema, ClientCapabilitySchema, OrganizationClientsQuerySchema, OrganizationClientsSchema,
  OrganizationError, OrganizationIdSchema, parseOrganizationInput,
  type ClientAuthorityDTO, type ClientCapability, type MembershipDTO, type OrganizationClientsDTO, type OrganizationDTO,
} from "./contracts";
import { activeOrganizationMembership, auditOrganizationRead, lockOrganizationRows, membershipRecord, organizationRecord } from "./service";

const missing = (): never => { throw new OrganizationError("NOT_FOUND", 404); };
const retry = (): never => { throw new OrganizationError("RETRY_REQUIRED", 503); };
async function organizationPreflight(organizationId: string, options: OrganizationOptions) {
  const organization = await organizationDb(options).organization.findUnique({ where: { id: organizationId }, select: { ownerUserId: true } });
  return organization ?? missing();
}
type EligibleClient = { id: string; brandId: string; brandOwnerUserId: string; membershipId: string; grantId: string };
// Eligibility precedes the bounded cursor. Hidden/revoked records cannot crowd
// out eligible records or become cursors revealing another client's existence.
async function eligibleClients(db: Pick<OrganizationTransaction, "$queryRaw">, actorUserId: string, organizationId: string, after?: string) {
  return db.$queryRaw<EligibleClient[]>(Prisma.sql`
    SELECT c.id, c."brandId", b."userId" AS "brandOwnerUserId", m.id AS "membershipId", g.id AS "grantId"
    FROM "OrganizationClient" c
    JOIN "Organization" o ON o.id=c."organizationId"
    JOIN "User" ou ON ou.id=o."ownerUserId"
    JOIN "OrganizationMembership" m ON m."organizationId"=o.id AND m."userId"=${actorUserId}
    JOIN "ClientGrant" g ON g."organizationId"=o.id AND g."membershipId"=m.id AND g."clientId"=c.id
    JOIN "Brand" b ON b.id=c."brandId" AND b."userId"=c."authorizingUserId"
    JOIN "User" bu ON bu.id=b."userId"
    WHERE o.id=${organizationId} AND o.active=true AND ou.active=true AND ou.role='BRAND'
      AND m.state='ACTIVE' AND c.state='ACTIVE' AND g.active=true AND g.view=true
      AND bu.active=true AND bu.role='BRAND' AND bu."sessionVersion"=c."authorizingSessionVersion"
      AND c."allowedCapabilities"->'view'='true'::jsonb
      ${after ? Prisma.sql`AND c.id > ${after}` : Prisma.empty}
    ORDER BY c.id LIMIT 31`);
}

export async function getOrganization(actor: OrganizationActor, organizationIdInput: string, options: OrganizationOptions = {}): Promise<{ organization: OrganizationDTO; membership: MembershipDTO }> {
  await checkOrganizationActor(actor, options);
  const organizationId = parseOrganizationInput(OrganizationIdSchema, organizationIdInput);
  const initial = await organizationPreflight(organizationId, options);
  return withOrganizationTransaction(actor, options, { write: false, userIds: [initial.ownerUserId] }, async (tx, lockedUsers) => {
    const organization = await lockOrganization(tx, organizationId, lockedUsers);
    const membership = await activeOrganizationMembership(tx, organizationId, actor.userId);
    const result = { organization: organizationRecord(organization), membership: membershipRecord(membership) };
    await auditOrganizationRead(tx, actor, "organization.read", organizationId, "Organization", organizationId, organization.revision);
    return result;
  });
}

export async function getClientAuthority(actor: OrganizationActor, clientIdInput: string, capabilityInput: ClientCapability, options: OrganizationOptions = {}): Promise<ClientAuthorityDTO> {
  await checkOrganizationActor(actor, options);
  const clientId = parseOrganizationInput(OrganizationIdSchema, clientIdInput), capability = parseOrganizationInput(ClientCapabilitySchema, capabilityInput);
  const initial = await organizationDb(options).organizationClient.findUnique({ where: { id: clientId },
    include: { organization: { select: { ownerUserId: true } }, brand: { select: { userId: true } } } });
  if (!initial) return missing();
  return withOrganizationTransaction(actor, options, { write: false, userIds: [initial.organization.ownerUserId, initial.brand.userId] }, async (tx, lockedUsers) => {
    const organization = await lockOrganization(tx, initial.organizationId, lockedUsers);
    const membership = await activeOrganizationMembership(tx, organization.id, actor.userId);
    await lockOrganizationRows(tx, "OrganizationClient", [clientId]);
    const client = await tx.organizationClient.findUnique({ where: { id: clientId } });
    if (!client || client.organizationId !== organization.id || client.brandId !== initial.brandId) return missing();
    const first = await tx.clientGrant.findUnique({ where: { membershipId_clientId: { membershipId: membership.id, clientId } } });
    if (!first) return missing();
    await lockOrganizationRows(tx, "ClientGrant", [first.id]);
    const grant = await tx.clientGrant.findUnique({ where: { id: first.id } });
    if (!grant || grant.organizationId !== organization.id || grant.membershipId !== membership.id || grant.clientId !== clientId || !grant.active || !grant[capability]) return missing();
    const delegation = await validateClientDelegation(tx, client, lockedUsers);
    if (!delegation.capabilities[capability]) return missing();
    const result = ClientAuthoritySchema.parse({ organizationId: organization.id, clientId, brandId: delegation.brand.id,
      membershipId: membership.id, grantId: grant.id, capability, organizationRevision: organization.revision,
      membershipRevision: membership.revision, clientRevision: client.revision, grantRevision: grant.revision });
    await auditOrganizationRead(tx, actor, "organization.authority_read", organization.id, "OrganizationClient", clientId, client.revision);
    return result;
  });
}

export async function getOrganizationClients(actor: OrganizationActor, organizationIdInput: string, input: unknown = {}, options: OrganizationOptions = {}): Promise<OrganizationClientsDTO> {
  await checkOrganizationActor(actor, options);
  const organizationId = parseOrganizationInput(OrganizationIdSchema, organizationIdInput), query = parseOrganizationInput(OrganizationClientsQuerySchema, input);
  const initialOrganization = await organizationPreflight(organizationId, options);
  const initialClients = await eligibleClients(organizationDb(options), actor.userId, organizationId, query.after);
  return withOrganizationTransaction(actor, options,
    { write: false, userIds: [initialOrganization.ownerUserId, ...initialClients.map(row => row.brandOwnerUserId)] }, async (tx, lockedUsers) => {
      const organization = await lockOrganization(tx, organizationId, lockedUsers);
      const membership = await activeOrganizationMembership(tx, organizationId, actor.userId);
      const rows = await eligibleClients(tx, actor.userId, organizationId, query.after);
      if (rows.some(row => !lockedUsers.has(row.brandOwnerUserId) || row.membershipId !== membership.id)) return retry();
      // Acquire every row group before the next group, independent of join order.
      await lockOrganizationRows(tx, "OrganizationClient", rows.map(row => row.id));
      await lockOrganizationRows(tx, "ClientGrant", rows.map(row => row.grantId));
      await lockOrganizationRows(tx, "Brand", rows.map(row => row.brandId));
      const clients: OrganizationClientsDTO["clients"] = [];
      for (const row of rows) {
        const client = await tx.organizationClient.findUnique({ where: { id: row.id } });
        const grant = await tx.clientGrant.findUnique({ where: { id: row.grantId } });
        if (!client || client.organizationId !== organizationId || client.brandId !== row.brandId || client.state !== "ACTIVE"
          || !grant || grant.organizationId !== organizationId || grant.membershipId !== membership.id || grant.clientId !== row.id || !grant.active || !grant.view) return retry();
        const delegation = await validateClientDelegation(tx, client, lockedUsers);
        if (!delegation.capabilities.view || delegation.brand.userId !== row.brandOwnerUserId) return retry();
        if (clients.length < 30) clients.push({ id: client.id, organizationId, brandId: client.brandId,
          state: "ACTIVE", revision: client.revision, brandName: delegation.brand.name });
      }
      const result = OrganizationClientsSchema.parse({ organizationId, asOf: new Date().toISOString(), clients,
        nextCursor: rows.length > 30 ? clients.at(-1)!.id : null });
      await auditOrganizationRead(tx, actor, "organization.clients_read", organizationId, "Organization", organizationId, organization.revision);
      return result;
    });
}
