import { Prisma, type ClientGrant, type Organization, type OrganizationClient, type OrganizationMembership } from "@prisma/client";
import { z } from "zod";
import { canonicalHash, inputJson } from "@/lib/onboarding/drafts";
import {
  checkOrganizationActor, lockOrganization, organizationAwait, organizationDb, validateClientDelegation, withOrganizationTransaction,
  type OrganizationActor, type OrganizationOptions, type OrganizationTransaction,
} from "./context";
import {
  AuthorizeClientAssociationSchema, ClientAssociationProposalSchema, ClientGrantSchema, CreateOrganizationSchema,
  MembershipCommandSchema, MembershipSchema, OrganizationClientSchema, OrganizationError, OrganizationIdSchema,
  OrganizationSchema, ProposeMemberSchema, RevokeClientGrantSchema, SetClientGrantSchema, parseOrganizationInput,
  type ClientCapabilities, type ClientGrantDTO, type MembershipDTO, type OrganizationClientDTO, type OrganizationDTO,
} from "./contracts";

type OrgResult = { organization: OrganizationDTO; replayed: boolean };
type MembershipResult = { membership: MembershipDTO; replayed: boolean };
type ClientResult = { client: OrganizationClientDTO; replayed: boolean };
type GrantResult = { grant: ClientGrantDTO; replayed: boolean };
const OrgResultSchema = z.object({ organization: OrganizationSchema, replayed: z.boolean() }).strict();
const MembershipResultSchema = z.object({ membership: MembershipSchema, replayed: z.boolean() }).strict();
const ClientResultSchema = z.object({ client: OrganizationClientSchema, replayed: z.boolean() }).strict();
const GrantResultSchema = z.object({ grant: ClientGrantSchema, replayed: z.boolean() }).strict();
const allCapabilities: ClientCapabilities = Object.freeze({ view: true, plan: true, approveShortlist: true,
  reviewContent: true, signCustomer: true, financial: true, manageGrants: true });
const missing = (): never => { throw new OrganizationError("NOT_FOUND", 404); };
const retry = (): never => { throw new OrganizationError("RETRY_REQUIRED", 503); };

export function organizationRecord(row: Organization): OrganizationDTO {
  return OrganizationSchema.parse({ id: row.id, name: row.name, kind: row.kind, active: row.active, revision: row.revision });
}
export function membershipRecord(row: OrganizationMembership): MembershipDTO {
  return MembershipSchema.parse({ id: row.id, organizationId: row.organizationId, userId: row.userId, state: row.state, revision: row.revision });
}
export function clientRecord(row: OrganizationClient): OrganizationClientDTO {
  return OrganizationClientSchema.parse({ id: row.id, organizationId: row.organizationId, brandId: row.brandId, state: row.state, revision: row.revision });
}
export function grantRecord(row: ClientGrant): ClientGrantDTO {
  return ClientGrantSchema.parse({ id: row.id, organizationId: row.organizationId, membershipId: row.membershipId,
    clientId: row.clientId, active: row.active, revision: row.revision,
    capabilities: { view: row.view, plan: row.plan, approveShortlist: row.approveShortlist, reviewContent: row.reviewContent,
      signCustomer: row.signCustomer, financial: row.financial, manageGrants: row.manageGrants } });
}

// Table names are a closed internal whitelist; all identity values remain parameters.
export async function lockOrganizationRows(tx: OrganizationTransaction,
  table: "OrganizationMembership" | "OrganizationClient" | "ClientGrant" | "Brand", ids: readonly string[], write = false,
  checkpoint?: () => void) {
  const ordered = [...new Set(ids)].sort();
  if (!ordered.length) return;
  await organizationAwait(checkpoint, () => tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw('"' + table + '"')}
    WHERE id IN (${Prisma.join(ordered)}) ORDER BY id ${write ? Prisma.raw("FOR UPDATE") : Prisma.raw("FOR SHARE")}`));
}
export async function activeOrganizationMembership(tx: OrganizationTransaction, organizationId: string, userId: string, write = false,
  checkpoint?: () => void) {
  const initial = await organizationAwait(checkpoint, () => tx.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId, userId } } }));
  if (!initial) return missing();
  await lockOrganizationRows(tx, "OrganizationMembership", [initial.id], write, checkpoint);
  const member = await organizationAwait(checkpoint, () => tx.organizationMembership.findUnique({ where: { id: initial.id } }));
  if (!member || member.organizationId !== organizationId || member.userId !== userId || member.state !== "ACTIVE") return missing();
  return member;
}
export function requireRevision(actual: number, expected: number) {
  if (actual !== expected) throw new OrganizationError("STALE_VERSION");
}
export function nextRevision(actual: number) {
  if (actual >= 2147483646) throw new OrganizationError("VERSION_EXHAUSTED");
  return actual + 1;
}
export async function advanceOrganization(tx: OrganizationTransaction, organization: Organization) {
  await tx.organization.update({ where: { id: organization.id }, data: { revision: nextRevision(organization.revision) } });
}
export async function currentBrandUser(tx: OrganizationTransaction, userId: string, lockedUsers: ReadonlySet<string>) {
  if (!lockedUsers.has(userId)) return retry();
  const user = await tx.user.findUnique({ where: { id: userId }, select: { active: true, role: true } });
  if (!user?.active || user.role !== "BRAND") return missing();
}
async function preflightOrganization(organizationId: string, options: OrganizationOptions) {
  const organization = await organizationDb(options).organization.findUnique({ where: { id: organizationId }, select: { ownerUserId: true } });
  return organization ?? missing();
}
async function preflightClient(clientId: string, options: OrganizationOptions) {
  const client = await organizationDb(options).organizationClient.findUnique({ where: { id: clientId },
    include: { organization: { select: { ownerUserId: true } }, brand: { select: { userId: true } } } });
  return client ?? missing();
}
async function preflightMembership(membershipId: string, options: OrganizationOptions) {
  const member = await organizationDb(options).organizationMembership.findUnique({ where: { id: membershipId },
    include: { organization: { select: { ownerUserId: true } } } });
  return member ?? missing();
}
function requireOwner(organization: Organization, actor: OrganizationActor) {
  if (organization.ownerUserId !== actor.userId) return missing();
}
export async function previousResult<T extends { replayed: boolean }>(tx: OrganizationTransaction, actor: OrganizationActor,
  operationKey: string, hash: string, schema: z.ZodType<T>): Promise<T | null> {
  const previous = await tx.organizationCommand.findUnique({ where: { actorUserId_operationKey: { actorUserId: actor.userId, operationKey } } });
  if (!previous) return null;
  if (previous.payloadHash !== hash) throw new OrganizationError("IDEMPOTENCY_CONFLICT");
  return { ...schema.parse(previous.result), replayed: true };
}
export async function saveResult<T extends { replayed: boolean }>(tx: OrganizationTransaction, actor: OrganizationActor, operationKey: string,
  hash: string, organizationId: string, action: string, resourceType: string, resourceId: string, resourceRevision: number, result: T): Promise<T> {
  const now = new Date();
  const receipt = await tx.organizationCommand.create({ data: { actorUserId: actor.userId, operationKey, payloadHash: hash,
    organizationId, resourceType, resourceId, result: inputJson(result), createdAt: now }, select: { id: true } });
  await tx.adminAudit.create({ data: { actorUserId: actor.userId, action, resourceType, resourceId,
    snapshot: { organizationId, resourceRevision }, createdAt: now } });
  await tx.outboxEvent.create({ data: { deduplicationKey: "organization:" + receipt.id, type: action,
    payload: { id: receipt.id, type: action, actorUserId: actor.userId, organizationId, resourceType,
      resourceId, resourceRevision, occurredAt: now.toISOString() }, createdAt: now, availableAt: now } });
  return result;
}
export async function auditOrganizationRead(tx: OrganizationTransaction, actor: OrganizationActor, action: string,
  organizationId: string, resourceType: string, resourceId: string, resourceRevision: number) {
  await tx.adminAudit.create({ data: { actorUserId: actor.userId, action, resourceType, resourceId,
    snapshot: { organizationId, resourceRevision } } });
}
export async function mutation<T>(actor: OrganizationActor, options: OrganizationOptions, userIds: string[],
  action: (tx: OrganizationTransaction, lockedUsers: ReadonlySet<string>) => Promise<T>) {
  try { return await withOrganizationTransaction(actor, options, { write: true, userIds }, action); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = String(error.meta?.target ?? "");
      throw new OrganizationError(target.includes("actorUserId") && target.includes("operationKey") ? "IDEMPOTENCY_CONFLICT" : "RETRY_REQUIRED",
        target.includes("actorUserId") && target.includes("operationKey") ? 409 : 503);
    }
    throw error;
  }
}

export async function createOrganization(actor: OrganizationActor, input: unknown, options: OrganizationOptions = {}): Promise<OrgResult> {
  await checkOrganizationActor(actor, options);
  const command = parseOrganizationInput(CreateOrganizationSchema, input);
  const action = "organization.created", hash = canonicalHash({ action, resourceId: "new", input: command });
  return mutation(actor, options, [], async (tx, lockedUsers) => {
    const previous = await tx.organizationCommand.findUnique({ where: { actorUserId_operationKey: { actorUserId: actor.userId, operationKey: command.operationKey } } });
    if (previous) {
      if (previous.payloadHash !== hash) throw new OrganizationError("IDEMPOTENCY_CONFLICT");
      const organization = await lockOrganization(tx, previous.organizationId, lockedUsers, true);
      requireOwner(organization, actor);
      return (await previousResult(tx, actor, command.operationKey, hash, OrgResultSchema))!;
    }
    const organization = await tx.organization.create({ data: { name: command.nameOriginal, kind: command.kind, ownerUserId: actor.userId } });
    await tx.organizationMembership.create({ data: { organizationId: organization.id, userId: actor.userId, state: "ACTIVE" } });
    return saveResult(tx, actor, command.operationKey, hash, organization.id, action, "Organization", organization.id, organization.revision,
      { organization: organizationRecord(organization), replayed: false });
  });
}

async function associateBrand(actor: OrganizationActor, organizationIdInput: string, input: unknown,
  options: OrganizationOptions, owned: boolean): Promise<ClientResult> {
  await checkOrganizationActor(actor, options);
  const organizationId = parseOrganizationInput(OrganizationIdSchema, organizationIdInput);
  const command = parseOrganizationInput(ClientAssociationProposalSchema, input);
  const initial = await preflightOrganization(organizationId, options);
  const brandInitial = await organizationDb(options).brand.findUnique({ where: { id: command.brandId }, select: { userId: true } });
  if (!brandInitial) return missing();
  const action = owned ? "organization.owned_brand_associated" : "organization.client_proposed";
  const hash = canonicalHash({ action, resourceId: organizationId, input: command });
  return mutation(actor, options, [initial.ownerUserId, brandInitial.userId], async (tx, lockedUsers) => {
    const organization = await lockOrganization(tx, organizationId, lockedUsers, true);
    requireOwner(organization, actor);
    const initialClient = await tx.organizationClient.findUnique({ where: { organizationId_brandId: { organizationId, brandId: command.brandId } } });
    if (initialClient) await lockOrganizationRows(tx, "OrganizationClient", [initialClient.id], true);
    await lockOrganizationRows(tx, "Brand", [command.brandId]);
    const brand = await tx.brand.findUnique({ where: { id: command.brandId }, select: { userId: true } });
    if (!brand || owned && brand.userId !== actor.userId) return missing();
    await currentBrandUser(tx, brand.userId, lockedUsers);
    const previous = await previousResult(tx, actor, command.operationKey, hash, ClientResultSchema);
    if (previous) return previous;
    requireRevision(organization.revision, command.expectedOrganizationRevision);
    const client = initialClient ? await tx.organizationClient.findUnique({ where: { id: initialClient.id } }) : null;
    if (client && (client.organizationId !== organizationId || client.brandId !== command.brandId)) return retry();
    if (client && (client.state === "ACTIVE" || !owned && client.state === "PENDING")) throw new OrganizationError("INVALID_STATE");
    const authorization = owned ? { authorizingUserId: actor.userId, authorizingSessionVersion: actor.sessionVersion,
      allowedCapabilities: inputJson(allCapabilities) } : { authorizingUserId: null, authorizingSessionVersion: null, allowedCapabilities: Prisma.DbNull };
    const saved = client
      ? await tx.organizationClient.update({ where: { id: client.id }, data: { state: owned ? "ACTIVE" : "PENDING",
        revision: nextRevision(client.revision), ...authorization } })
      : await tx.organizationClient.create({ data: { organizationId, brandId: command.brandId, state: owned ? "ACTIVE" : "PENDING", ...authorization } });
    await advanceOrganization(tx, organization);
    return saveResult(tx, actor, command.operationKey, hash, organizationId, action, "OrganizationClient", saved.id, saved.revision,
      { client: clientRecord(saved), replayed: false });
  });
}
export async function associateOwnedBrand(actor: OrganizationActor, organizationId: string, input: unknown, options: OrganizationOptions = {}): Promise<ClientResult> {
  return associateBrand(actor, organizationId, input, options, true);
}
export async function proposeClientAssociation(actor: OrganizationActor, organizationId: string, input: unknown, options: OrganizationOptions = {}): Promise<ClientResult> {
  return associateBrand(actor, organizationId, input, options, false);
}

export async function authorizeClientAssociation(actor: OrganizationActor, clientIdInput: string, input: unknown, options: OrganizationOptions = {}): Promise<ClientResult> {
  await checkOrganizationActor(actor, options);
  const clientId = parseOrganizationInput(OrganizationIdSchema, clientIdInput), command = parseOrganizationInput(AuthorizeClientAssociationSchema, input);
  const initial = await preflightClient(clientId, options);
  const action = "organization.client_authorized", hash = canonicalHash({ action, resourceId: clientId, input: command });
  return mutation(actor, options, [initial.organization.ownerUserId, initial.brand.userId], async (tx, lockedUsers) => {
    const organization = await lockOrganization(tx, initial.organizationId, lockedUsers, true);
    await lockOrganizationRows(tx, "OrganizationClient", [clientId], true);
    const client = await tx.organizationClient.findUnique({ where: { id: clientId } });
    if (!client || client.organizationId !== organization.id || client.brandId !== initial.brandId) return missing();
    await lockOrganizationRows(tx, "Brand", [client.brandId]);
    const brand = await tx.brand.findUnique({ where: { id: client.brandId }, select: { userId: true } });
    if (!brand || brand.userId !== actor.userId) return missing();
    await currentBrandUser(tx, brand.userId, lockedUsers);
    const previous = await previousResult(tx, actor, command.operationKey, hash, ClientResultSchema);
    if (previous) return previous;
    requireRevision(client.revision, command.expectedRevision);
    // Withdrawal removes the association's current two-party consent. A fresh
    // agency proposal is required before new customer authorization; replay
    // above returns only the historical receipt and never renews the record.
    if (client.state === "REVOKED") throw new OrganizationError("INVALID_STATE");
    const saved = await tx.organizationClient.update({ where: { id: client.id }, data: { state: "ACTIVE",
      revision: nextRevision(client.revision), authorizingUserId: actor.userId, authorizingSessionVersion: actor.sessionVersion,
      allowedCapabilities: inputJson(command.capabilities) } });
    await advanceOrganization(tx, organization);
    return saveResult(tx, actor, command.operationKey, hash, organization.id, action, "OrganizationClient", saved.id, saved.revision,
      { client: clientRecord(saved), replayed: false });
  });
}

export async function proposeMember(actor: OrganizationActor, organizationIdInput: string, input: unknown, options: OrganizationOptions = {}): Promise<MembershipResult> {
  await checkOrganizationActor(actor, options);
  const organizationId = parseOrganizationInput(OrganizationIdSchema, organizationIdInput), command = parseOrganizationInput(ProposeMemberSchema, input);
  const initial = await preflightOrganization(organizationId, options);
  const action = "organization.member_proposed", hash = canonicalHash({ action, resourceId: organizationId, input: command });
  return mutation(actor, options, [initial.ownerUserId, command.targetUserId], async (tx, lockedUsers) => {
    const organization = await lockOrganization(tx, organizationId, lockedUsers, true);
    requireOwner(organization, actor);
    const first = await tx.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId, userId: command.targetUserId } } });
    if (first) await lockOrganizationRows(tx, "OrganizationMembership", [first.id], true);
    await currentBrandUser(tx, command.targetUserId, lockedUsers);
    const previous = await previousResult(tx, actor, command.operationKey, hash, MembershipResultSchema);
    if (previous) return previous;
    requireRevision(organization.revision, command.expectedOrganizationRevision);
    if (command.targetUserId === organization.ownerUserId) throw new OrganizationError("PROTECTED_OWNER", 403);
    const member = first ? await tx.organizationMembership.findUnique({ where: { id: first.id } }) : null;
    if (member && (member.organizationId !== organizationId || member.userId !== command.targetUserId)) return retry();
    if (member && member.state !== "REVOKED") throw new OrganizationError("INVALID_STATE");
    const saved = member
      ? await tx.organizationMembership.update({ where: { id: member.id }, data: { state: "PENDING", revision: nextRevision(member.revision) } })
      : await tx.organizationMembership.create({ data: { organizationId, userId: command.targetUserId, state: "PENDING" } });
    await advanceOrganization(tx, organization);
    return saveResult(tx, actor, command.operationKey, hash, organizationId, action, "OrganizationMembership", saved.id, saved.revision,
      { membership: membershipRecord(saved), replayed: false });
  });
}

async function changeMembership(actor: OrganizationActor, membershipIdInput: string, input: unknown,
  options: OrganizationOptions, accept: boolean): Promise<MembershipResult> {
  await checkOrganizationActor(actor, options);
  const membershipId = parseOrganizationInput(OrganizationIdSchema, membershipIdInput), command = parseOrganizationInput(MembershipCommandSchema, input);
  const initial = await preflightMembership(membershipId, options);
  const action = accept ? "organization.membership_accepted" : "organization.membership_revoked";
  const hash = canonicalHash({ action, resourceId: membershipId, input: command });
  return mutation(actor, options, [initial.organization.ownerUserId, initial.userId], async (tx, lockedUsers) => {
    const organization = await lockOrganization(tx, initial.organizationId, lockedUsers, true);
    await lockOrganizationRows(tx, "OrganizationMembership", [membershipId], true);
    const member = await tx.organizationMembership.findUnique({ where: { id: membershipId } });
    if (!member || member.organizationId !== organization.id || member.userId !== initial.userId) return missing();
    if (accept ? member.userId !== actor.userId : organization.ownerUserId !== actor.userId) return missing();
    if (accept && member.state === "REVOKED") return missing();
    if (!accept && member.userId === organization.ownerUserId) throw new OrganizationError("PROTECTED_OWNER", 403);
    const previous = await previousResult(tx, actor, command.operationKey, hash, MembershipResultSchema);
    if (previous) return previous;
    requireRevision(member.revision, command.expectedRevision);
    if (accept ? member.state !== "PENDING" : member.state === "REVOKED") throw new OrganizationError("INVALID_STATE");
    if (!accept) {
      // Membership renewal is new consent, never renewal of its former client
      // powers. Retain every grant and receipt, but revoke the active grants
      // atomically so re-proposal/acceptance requires a fresh explicit grant.
      const activeGrants = await tx.clientGrant.findMany({ where: { organizationId: organization.id, membershipId: member.id, active: true },
        select: { id: true, clientId: true } });
      const clientIds = [...new Set(activeGrants.map(grant => grant.clientId))];
      await lockOrganizationRows(tx, "OrganizationClient", clientIds);
      await lockOrganizationRows(tx, "ClientGrant", activeGrants.map(grant => grant.id), true);
      if (activeGrants.length) {
        const clients = await tx.organizationClient.findMany({ where: { id: { in: clientIds } }, select: { id: true, organizationId: true } });
        if (clients.length !== clientIds.length || clients.some(client => client.organizationId !== organization.id)) return retry();
        const grants = await tx.clientGrant.findMany({ where: { id: { in: activeGrants.map(grant => grant.id) } }, orderBy: { id: "asc" } });
        if (grants.length !== activeGrants.length || grants.some(grant => grant.organizationId !== organization.id || grant.membershipId !== member.id
          || !clientIds.includes(grant.clientId) || !grant.active)) return retry();
        for (const grant of grants) nextRevision(grant.revision);
        for (const grant of grants) await tx.clientGrant.update({ where: { id: grant.id }, data: { active: false, revision: nextRevision(grant.revision) } });
      }
    }
    const saved = await tx.organizationMembership.update({ where: { id: member.id },
      data: { state: accept ? "ACTIVE" : "REVOKED", revision: nextRevision(member.revision) } });
    await advanceOrganization(tx, organization);
    return saveResult(tx, actor, command.operationKey, hash, organization.id, action, "OrganizationMembership", saved.id, saved.revision,
      { membership: membershipRecord(saved), replayed: false });
  });
}
export async function acceptMembership(actor: OrganizationActor, membershipId: string, input: unknown, options: OrganizationOptions = {}): Promise<MembershipResult> {
  return changeMembership(actor, membershipId, input, options, true);
}
export async function revokeMembership(actor: OrganizationActor, membershipId: string, input: unknown, options: OrganizationOptions = {}): Promise<MembershipResult> {
  return changeMembership(actor, membershipId, input, options, false);
}

function requireGrantAdministrator(actor: OrganizationActor, organization: Organization, brandOwnerId: string, capabilities: ClientCapabilities) {
  if (actor.userId !== brandOwnerId && (actor.userId !== organization.ownerUserId || !capabilities.manageGrants)) return missing();
}
export async function setClientGrant(actor: OrganizationActor, clientIdInput: string, input: unknown, options: OrganizationOptions = {}): Promise<GrantResult> {
  await checkOrganizationActor(actor, options);
  const clientId = parseOrganizationInput(OrganizationIdSchema, clientIdInput), command = parseOrganizationInput(SetClientGrantSchema, input);
  const initial = await preflightClient(clientId, options), target = await preflightMembership(command.membershipId, options);
  const action = "organization.grant_set", hash = canonicalHash({ action, resourceId: clientId, input: command });
  return mutation(actor, options, [initial.organization.ownerUserId, initial.brand.userId, target.userId], async (tx, lockedUsers) => {
    const organization = await lockOrganization(tx, initial.organizationId, lockedUsers, true);
    await lockOrganizationRows(tx, "OrganizationMembership", [command.membershipId], true);
    const member = await tx.organizationMembership.findUnique({ where: { id: command.membershipId } });
    if (!member || member.organizationId !== organization.id || member.userId !== target.userId || member.state !== "ACTIVE") return missing();
    await currentBrandUser(tx, member.userId, lockedUsers);
    await lockOrganizationRows(tx, "OrganizationClient", [clientId], true);
    const client = await tx.organizationClient.findUnique({ where: { id: clientId } });
    if (!client || client.organizationId !== organization.id || client.brandId !== initial.brandId) return missing();
    const first = await tx.clientGrant.findUnique({ where: { membershipId_clientId: { membershipId: member.id, clientId } } });
    if (first) await lockOrganizationRows(tx, "ClientGrant", [first.id], true);
    const delegation = await validateClientDelegation(tx, client, lockedUsers);
    requireGrantAdministrator(actor, organization, delegation.brand.userId, delegation.capabilities);
    const previous = await previousResult(tx, actor, command.operationKey, hash, GrantResultSchema);
    if (previous) return previous;
    requireRevision(client.revision, command.expectedClientRevision);
    const grant = first ? await tx.clientGrant.findUnique({ where: { id: first.id } }) : null;
    if (grant && (grant.organizationId !== organization.id || grant.membershipId !== member.id || grant.clientId !== client.id)) return missing();
    if (grant ? command.expectedGrantRevision !== grant.revision : command.expectedGrantRevision !== null) throw new OrganizationError("STALE_VERSION");
    for (const capability of Object.keys(command.capabilities) as Array<keyof ClientCapabilities>) {
      if (command.capabilities[capability] && !delegation.capabilities[capability]) throw new OrganizationError("DELEGATION_EXCEEDED", 403);
    }
    const saved = grant
      ? await tx.clientGrant.update({ where: { id: grant.id }, data: { active: true, revision: nextRevision(grant.revision), ...command.capabilities } })
      : await tx.clientGrant.create({ data: { organizationId: organization.id, membershipId: member.id, clientId, active: true, ...command.capabilities } });
    await advanceOrganization(tx, organization);
    return saveResult(tx, actor, command.operationKey, hash, organization.id, action, "ClientGrant", saved.id, saved.revision,
      { grant: grantRecord(saved), replayed: false });
  });
}

export async function revokeClientGrant(actor: OrganizationActor, grantIdInput: string, input: unknown, options: OrganizationOptions = {}): Promise<GrantResult> {
  await checkOrganizationActor(actor, options);
  const grantId = parseOrganizationInput(OrganizationIdSchema, grantIdInput), command = parseOrganizationInput(RevokeClientGrantSchema, input);
  const initial = await organizationDb(options).clientGrant.findUnique({ where: { id: grantId },
    include: { membership: { select: { userId: true } }, client: { include: { organization: { select: { ownerUserId: true } }, brand: { select: { userId: true } } } } } });
  if (!initial) return missing();
  const action = "organization.grant_revoked", hash = canonicalHash({ action, resourceId: grantId, input: command });
  return mutation(actor, options, [initial.client.organization.ownerUserId, initial.client.brand.userId, initial.membership.userId], async (tx, lockedUsers) => {
    const organization = await lockOrganization(tx, initial.organizationId, lockedUsers, true);
    await lockOrganizationRows(tx, "OrganizationMembership", [initial.membershipId], true);
    const member = await tx.organizationMembership.findUnique({ where: { id: initial.membershipId } });
    if (!member || member.organizationId !== organization.id || member.userId !== initial.membership.userId) return missing();
    await lockOrganizationRows(tx, "OrganizationClient", [initial.clientId], true);
    const client = await tx.organizationClient.findUnique({ where: { id: initial.clientId } });
    if (!client || client.organizationId !== organization.id || client.brandId !== initial.client.brandId) return missing();
    await lockOrganizationRows(tx, "ClientGrant", [grantId], true);
    const grant = await tx.clientGrant.findUnique({ where: { id: grantId } });
    if (!grant || grant.organizationId !== organization.id || grant.membershipId !== member.id || grant.clientId !== client.id) return missing();
    const delegation = await validateClientDelegation(tx, client, lockedUsers);
    requireGrantAdministrator(actor, organization, delegation.brand.userId, delegation.capabilities);
    const previous = await previousResult(tx, actor, command.operationKey, hash, GrantResultSchema);
    if (previous) return previous;
    requireRevision(grant.revision, command.expectedRevision);
    if (!grant.active) throw new OrganizationError("INVALID_STATE");
    const saved = await tx.clientGrant.update({ where: { id: grantId }, data: { active: false, revision: nextRevision(grant.revision) } });
    await advanceOrganization(tx, organization);
    return saveResult(tx, actor, command.operationKey, hash, organization.id, action, "ClientGrant", saved.id, saved.revision,
      { grant: grantRecord(saved), replayed: false });
  });
}
