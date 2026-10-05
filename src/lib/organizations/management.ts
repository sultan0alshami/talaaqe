import type { ClientGrant, Organization, OrganizationClient, OrganizationMembership } from "@prisma/client";
import {
  checkOrganizationActor, lockOrganization, lockStoredOrganization, organizationDb, withOrganizationTransaction,
  type OrganizationActor, type OrganizationOptions, type OrganizationTransaction,
} from "./context";
import {
  ClientCapabilitiesSchema, ClientGrantsSchema, OrganizationAssociationsSchema, OrganizationClientsQuerySchema,
  OrganizationError, OrganizationIdSchema, OrganizationMembersSchema, OwnBrandAssociationsSchema,
  OwnOrganizationReferencesSchema, parseOrganizationInput,
  type ClientCapabilities, type ClientGrantsDTO, type OrganizationAssociationsDTO, type OrganizationMembersDTO,
  type OwnBrandAssociationsDTO, type OwnOrganizationReferencesDTO,
} from "./contracts";
import { clientRecord, grantRecord, lockOrganizationRows, membershipRecord, organizationRecord } from "./service";

const missing = (): never => { throw new OrganizationError("NOT_FOUND", 404); };
const retry = (): never => { throw new OrganizationError("RETRY_REQUIRED", 503); };
const none: ClientCapabilities = Object.freeze({ view: false, plan: false, approveShortlist: false,
  reviewContent: false, signCustomer: false, financial: false, manageGrants: false });
const userFields = { id: true, active: true, role: true, sessionVersion: true, name: true } as const;
type CurrentUser = { id: string; active: boolean; role: string; sessionVersion: number; name: string };
type CurrentBrand = { id: string; userId: string; name: string };
type ReadDb = Pick<OrganizationTransaction, "organizationMembership" | "organizationClient" | "clientGrant">;

async function organizationPreflight(id: string, options: OrganizationOptions) {
  return await organizationDb(options).organization.findUnique({ where: { id }, select: { ownerUserId: true } }) ?? missing();
}
async function membersPage(db: ReadDb, organizationId: string, after?: string) {
  return db.organizationMembership.findMany({ where: { organizationId, ...(after ? { id: { gt: after } } : {}) },
    orderBy: { id: "asc" }, take: 31 });
}
async function associationsPage(db: ReadDb, scope: { organizationId: string } | { brandId: string }, after?: string) {
  return db.organizationClient.findMany({ where: { ...scope, ...(after ? { id: { gt: after } } : {}) },
    orderBy: { id: "asc" }, take: 31,
    include: { organization: { select: { ownerUserId: true } }, brand: { select: { userId: true } } } });
}
async function grantsPage(db: ReadDb, clientId: string, after?: string) {
  return db.clientGrant.findMany({ where: { clientId, ...(after ? { id: { gt: after } } : {}) },
    orderBy: { id: "asc" }, take: 31, include: { membership: { select: { userId: true } } } });
}
async function users(tx: OrganizationTransaction, ids: string[], locked: ReadonlySet<string>) {
  const unique = [...new Set(ids)];
  if (unique.some(id => !locked.has(id))) return retry();
  const rows = await tx.user.findMany({ where: { id: { in: unique } }, select: userFields });
  return new Map<string, CurrentUser>(rows.map(row => [row.id, row]));
}
function activeBrandUser(user: CurrentUser | undefined) { return !!user?.active && user.role === "BRAND"; }
function organizationReady(organization: Organization, current: ReadonlyMap<string, CurrentUser>) {
  return organization.active && activeBrandUser(current.get(organization.ownerUserId));
}
function delegation(organization: Organization, client: OrganizationClient, brand: CurrentBrand,
  current: ReadonlyMap<string, CurrentUser>) {
  const parsed = ClientCapabilitiesSchema.safeParse(client.allowedCapabilities);
  const savedCapabilities = parsed.success ? parsed.data : null;
  const owner = current.get(brand.userId);
  const state = client.state === "PENDING" ? "PENDING" : client.state === "REVOKED" ? "REVOKED"
    : organizationReady(organization, current) && activeBrandUser(owner) && brand.userId === client.authorizingUserId
      && owner!.sessionVersion === client.authorizingSessionVersion && savedCapabilities ? "CURRENT" : "RENEWAL_REQUIRED";
  return { delegation: state as OrganizationAssociationsDTO["associations"][number]["delegation"], savedCapabilities };
}
function memberCurrent(member: OrganizationMembership, current: ReadonlyMap<string, CurrentUser>) {
  return member.state === "ACTIVE" && activeBrandUser(current.get(member.userId));
}
function effective(grant: ClientGrant, capabilities: ClientCapabilities): ClientCapabilities {
  return { view: grant.view && capabilities.view, plan: grant.plan && capabilities.plan,
    approveShortlist: grant.approveShortlist && capabilities.approveShortlist,
    reviewContent: grant.reviewContent && capabilities.reviewContent, signCustomer: grant.signCustomer && capabilities.signCustomer,
    financial: grant.financial && capabilities.financial, manageGrants: grant.manageGrants && capabilities.manageGrants };
}
async function audit(tx: OrganizationTransaction, actor: OrganizationActor, action: string, resourceType: string,
  resourceId: string, asOf: string, page?: { after?: string; returned: number; nextCursor: string | null; organizationId?: string }) {
  await tx.adminAudit.create({ data: { actorUserId: actor.userId, action, resourceType, resourceId,
    snapshot: page ? { asOf, after: page.after ?? null, returned: page.returned, nextCursor: page.nextCursor,
      ...(page.organizationId ? { organizationId: page.organizationId } : {}) } : { asOf } } });
}

export async function getOwnReferences(actor: OrganizationActor, options: OrganizationOptions = {}): Promise<OwnOrganizationReferencesDTO> {
  await checkOrganizationActor(actor, options);
  return withOrganizationTransaction(actor, options, { write: false }, async tx => {
    const first = await tx.brand.findUnique({ where: { userId: actor.userId }, select: { id: true } });
    if (first) await lockOrganizationRows(tx, "Brand", [first.id]);
    const brand = first ? await tx.brand.findUnique({ where: { id: first.id }, select: { id: true, userId: true } }) : null;
    if (brand && brand.userId !== actor.userId) return retry();
    const result = OwnOrganizationReferencesSchema.parse({ asOf: new Date().toISOString(), userId: actor.userId, brandId: brand?.id ?? null });
    await audit(tx, actor, "organization.references_read", "OrganizationReferences", actor.userId, result.asOf);
    return result;
  });
}

export async function getOrganizationMembers(actor: OrganizationActor, organizationIdInput: string, input: unknown = {},
  options: OrganizationOptions = {}): Promise<OrganizationMembersDTO> {
  await checkOrganizationActor(actor, options);
  const organizationId = parseOrganizationInput(OrganizationIdSchema, organizationIdInput);
  const query = parseOrganizationInput(OrganizationClientsQuerySchema, input);
  const initial = await organizationPreflight(organizationId, options);
  const candidates = await membersPage(organizationDb(options), organizationId, query.after);
  return withOrganizationTransaction(actor, options, { write: false, userIds: [initial.ownerUserId, ...candidates.map(row => row.userId)] },
    async (tx, locked) => {
      const organization = await lockOrganization(tx, organizationId, locked);
      if (organization.ownerUserId !== actor.userId) return missing();
      const rows = await membersPage(tx, organizationId, query.after);
      const current = await users(tx, [organization.ownerUserId, ...rows.map(row => row.userId)], locked);
      await lockOrganizationRows(tx, "OrganizationMembership", rows.map(row => row.id));
      const members: OrganizationMembersDTO["members"] = [];
      for (const row of rows) {
        const member = await tx.organizationMembership.findUnique({ where: { id: row.id } });
        if (!member || member.organizationId !== organization.id || member.userId !== row.userId) return retry();
        const canReceiveGrant = memberCurrent(member, current);
        if (members.length < 30) members.push({ membership: membershipRecord(member),
          displayName: canReceiveGrant ? current.get(member.userId)!.name : null,
          protectedOwner: member.userId === organization.ownerUserId, canReceiveGrant });
      }
      const result = OrganizationMembersSchema.parse({ asOf: new Date().toISOString(), organization: organizationRecord(organization),
        members, nextCursor: rows.length > 30 ? members.at(-1)!.membership.id : null });
      await audit(tx, actor, "organization.members_read", "Organization", organizationId, result.asOf,
        { after: query.after, returned: members.length, nextCursor: result.nextCursor, organizationId });
      return result;
    });
}

export async function getOrganizationAssociations(actor: OrganizationActor, organizationIdInput: string, input: unknown = {},
  options: OrganizationOptions = {}): Promise<OrganizationAssociationsDTO> {
  await checkOrganizationActor(actor, options);
  const organizationId = parseOrganizationInput(OrganizationIdSchema, organizationIdInput);
  const query = parseOrganizationInput(OrganizationClientsQuerySchema, input);
  const initial = await organizationPreflight(organizationId, options);
  const candidates = await associationsPage(organizationDb(options), { organizationId }, query.after);
  return withOrganizationTransaction(actor, options, { write: false, userIds: [initial.ownerUserId, ...candidates.map(row => row.brand.userId)] },
    async (tx, locked) => {
      const organization = await lockOrganization(tx, organizationId, locked);
      if (organization.ownerUserId !== actor.userId) return missing();
      const rows = await associationsPage(tx, { organizationId }, query.after);
      const current = await users(tx, [organization.ownerUserId, ...rows.map(row => row.brand.userId)], locked);
      const ownerMember = await tx.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId, userId: actor.userId } } });
      await lockOrganizationRows(tx, "OrganizationMembership", ownerMember ? [ownerMember.id] : []);
      await lockOrganizationRows(tx, "OrganizationClient", rows.map(row => row.id));
      const ownerGrants = ownerMember ? await tx.clientGrant.findMany({ where: { organizationId, membershipId: ownerMember.id,
        clientId: { in: rows.map(row => row.id) } } }) : [];
      await lockOrganizationRows(tx, "ClientGrant", ownerGrants.map(row => row.id));
      await lockOrganizationRows(tx, "Brand", rows.map(row => row.brandId));
      const membership = ownerMember ? await tx.organizationMembership.findUnique({ where: { id: ownerMember.id } }) : null;
      if (membership && (membership.organizationId !== organizationId || membership.userId !== actor.userId)) return retry();
      const associations: OrganizationAssociationsDTO["associations"] = [];
      for (const row of rows) {
        const client = await tx.organizationClient.findUnique({ where: { id: row.id } });
        const brand = await tx.brand.findUnique({ where: { id: row.brandId }, select: { id: true, userId: true, name: true } });
        if (!client || client.organizationId !== organizationId || client.brandId !== row.brandId || !brand) return retry();
        if (brand.userId !== row.brand.userId || !locked.has(brand.userId)) return retry();
        const state = delegation(organization, client, brand, current);
        const firstGrant = ownerGrants.find(grant => grant.clientId === client.id);
        const grant = firstGrant ? await tx.clientGrant.findUnique({ where: { id: firstGrant.id } }) : null;
        if (grant && (grant.organizationId !== organizationId || grant.clientId !== client.id || grant.membershipId !== membership?.id)) return retry();
        const ownBrand = brand.userId === actor.userId;
        const currentDelegation = state.delegation === "CURRENT";
        const canView = currentDelegation && state.savedCapabilities!.view && !!membership && memberCurrent(membership, current) && !!grant?.active && grant.view;
        if (associations.length < 30) associations.push({ client: clientRecord(client), ...state,
          brandName: ownBrand || canView ? brand.name : null,
          canManageGrants: currentDelegation && (ownBrand || state.savedCapabilities!.manageGrants) });
      }
      const result = OrganizationAssociationsSchema.parse({ asOf: new Date().toISOString(), organization: organizationRecord(organization),
        associations, nextCursor: rows.length > 30 ? associations.at(-1)!.client.id : null });
      await audit(tx, actor, "organization.associations_read", "Organization", organizationId, result.asOf,
        { after: query.after, returned: associations.length, nextCursor: result.nextCursor, organizationId });
      return result;
    });
}

export async function getOwnBrandAssociations(actor: OrganizationActor, input: unknown = {},
  options: OrganizationOptions = {}): Promise<OwnBrandAssociationsDTO> {
  await checkOrganizationActor(actor, options);
  const query = parseOrganizationInput(OrganizationClientsQuerySchema, input);
  const initialBrand = await organizationDb(options).brand.findUnique({ where: { userId: actor.userId }, select: { id: true } });
  const candidates = initialBrand ? await associationsPage(organizationDb(options), { brandId: initialBrand.id }, query.after) : [];
  return withOrganizationTransaction(actor, options, { write: false, userIds: candidates.map(row => row.organization.ownerUserId) }, async (tx, locked) => {
    const ownBrand = await tx.brand.findUnique({ where: { userId: actor.userId }, select: { id: true } });
    if (ownBrand?.id !== initialBrand?.id) return retry();
    const rows = ownBrand ? await associationsPage(tx, { brandId: ownBrand.id }, query.after) : [];
    const orgs = new Map<string, Organization>();
    for (const id of [...new Set(rows.map(row => row.organizationId))].sort()) orgs.set(id, await lockStoredOrganization(tx, id, locked));
    const current = await users(tx, [actor.userId, ...rows.map(row => row.organization.ownerUserId)], locked);
    await lockOrganizationRows(tx, "OrganizationClient", rows.map(row => row.id));
    if (ownBrand) await lockOrganizationRows(tx, "Brand", [ownBrand.id]);
    const brand = ownBrand ? await tx.brand.findUnique({ where: { id: ownBrand.id }, select: { id: true, userId: true, name: true } }) : null;
    if (ownBrand && (!brand || brand.userId !== actor.userId)) return missing();
    const associations: OwnBrandAssociationsDTO["associations"] = [];
    for (const row of rows) {
      const organization = orgs.get(row.organizationId)!;
      const client = await tx.organizationClient.findUnique({ where: { id: row.id } });
      if (!client || client.organizationId !== organization.id || client.brandId !== brand!.id) return retry();
      const state = delegation(organization, client, brand!, current);
      if (associations.length < 30) associations.push({ client: clientRecord(client), ...state,
        organization: organizationRecord(organization), brandName: brand!.name,
        canManageGrants: state.delegation === "CURRENT", canAuthorize: organizationReady(organization, current) && client.state !== "REVOKED", canRevoke: client.state !== "REVOKED" });
    }
    const result = OwnBrandAssociationsSchema.parse({ asOf: new Date().toISOString(), brandId: brand?.id ?? null, associations,
      nextCursor: rows.length > 30 ? associations.at(-1)!.client.id : null });
    await audit(tx, actor, "organization.brand_associations_read", "BrandAssociations", actor.userId, result.asOf,
      { after: query.after, returned: associations.length, nextCursor: result.nextCursor });
    return result;
  });
}

export async function getClientGrants(actor: OrganizationActor, clientIdInput: string, input: unknown = {},
  options: OrganizationOptions = {}): Promise<ClientGrantsDTO> {
  await checkOrganizationActor(actor, options);
  const clientId = parseOrganizationInput(OrganizationIdSchema, clientIdInput);
  const query = parseOrganizationInput(OrganizationClientsQuerySchema, input);
  const initial = await organizationDb(options).organizationClient.findUnique({ where: { id: clientId },
    include: { organization: { select: { ownerUserId: true } }, brand: { select: { userId: true } } } });
  if (!initial) return missing();
  const candidates = await grantsPage(organizationDb(options), clientId, query.after);
  return withOrganizationTransaction(actor, options, { write: false,
    userIds: [initial.organization.ownerUserId, initial.brand.userId, ...candidates.map(row => row.membership.userId)] }, async (tx, locked) => {
    const organization = initial.brand.userId === actor.userId
      ? await lockStoredOrganization(tx, initial.organizationId, locked)
      : await lockOrganization(tx, initial.organizationId, locked);
    const rows = await grantsPage(tx, clientId, query.after);
    const current = await users(tx, [organization.ownerUserId, initial.brand.userId, ...rows.map(row => row.membership.userId)], locked);
    await lockOrganizationRows(tx, "OrganizationMembership", rows.map(row => row.membershipId));
    await lockOrganizationRows(tx, "OrganizationClient", [clientId]);
    await lockOrganizationRows(tx, "ClientGrant", rows.map(row => row.id));
    await lockOrganizationRows(tx, "Brand", [initial.brandId]);
    const client = await tx.organizationClient.findUnique({ where: { id: clientId } });
    const brand = await tx.brand.findUnique({ where: { id: initial.brandId }, select: { id: true, userId: true, name: true } });
    if (!client || client.organizationId !== organization.id || client.brandId !== initial.brandId || !brand) return missing();
    if (brand.userId !== initial.brand.userId || !locked.has(brand.userId)) return retry();
    const state = delegation(organization, client, brand, current);
    const canManageGrants = state.delegation === "CURRENT" && (brand.userId === actor.userId
      || organization.ownerUserId === actor.userId && state.savedCapabilities!.manageGrants);
    // An actual customer may inspect the metadata needed to withdraw old rights.
    // Agency ownership and arbitrary member flags confer no historical access.
    if (brand.userId !== actor.userId && !canManageGrants) return missing();
    const grants: ClientGrantsDTO["grants"] = [];
    for (const row of rows) {
      const grant = await tx.clientGrant.findUnique({ where: { id: row.id } });
      const member = await tx.organizationMembership.findUnique({ where: { id: row.membershipId } });
      if (!grant || grant.organizationId !== organization.id || grant.clientId !== clientId || grant.membershipId !== row.membershipId
        || !member || member.organizationId !== organization.id || member.userId !== row.membership.userId) return retry();
      const canReceiveGrant = state.delegation === "CURRENT" && memberCurrent(member, current);
      if (grants.length < 30) grants.push({ grant: grantRecord(grant), membership: membershipRecord(member), canReceiveGrant,
        effectiveCapabilities: canReceiveGrant && grant.active ? effective(grant, state.savedCapabilities!) : { ...none } });
    }
    const result = ClientGrantsSchema.parse({ asOf: new Date().toISOString(), organization: organizationRecord(organization),
      client: clientRecord(client), ...state, canManageGrants, grants, nextCursor: rows.length > 30 ? grants.at(-1)!.grant.id : null });
    await audit(tx, actor, "organization.grants_read", "OrganizationClient", clientId, result.asOf,
      { after: query.after, returned: grants.length, nextCursor: result.nextCursor, organizationId: organization.id });
    return result;
  });
}
