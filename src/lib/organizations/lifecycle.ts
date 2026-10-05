import { z } from "zod";
import { canonicalHash } from "@/lib/onboarding/drafts";
import {
  checkOrganizationActor, lockOrganization, lockStoredOrganization, organizationDb,
  type OrganizationActor, type OrganizationOptions, type OrganizationTransaction,
} from "./context";
import {
  MembershipCommandSchema, MembershipSchema, OrganizationClientSchema, OrganizationError, OrganizationIdSchema,
  parseOrganizationInput, type MembershipDTO, type OrganizationClientDTO,
} from "./contracts";
import {
  advanceOrganization, clientRecord, currentBrandUser, lockOrganizationRows, membershipRecord, mutation,
  nextRevision, previousResult, requireRevision, saveResult,
} from "./service";

type MembershipResult = { membership: MembershipDTO; replayed: boolean };
type ClientResult = { client: OrganizationClientDTO; replayed: boolean };
const MembershipResultSchema = z.object({ membership: MembershipSchema, replayed: z.boolean() }).strict();
const ClientResultSchema = z.object({ client: OrganizationClientSchema, replayed: z.boolean() }).strict();
const missing = (): never => { throw new OrganizationError("NOT_FOUND", 404); };
const retry = (): never => { throw new OrganizationError("RETRY_REQUIRED", 503); };

// Rights removal does not require a target member or previous authorizer to
// remain active. Every active scoped grant is retained and retired atomically.
async function retireGrants(tx: OrganizationTransaction, organizationId: string,
  candidates: Array<{ id: string; clientId: string; membershipId: string }>) {
  const grants = candidates.length ? await tx.clientGrant.findMany({ where: { id: { in: candidates.map(row => row.id) } }, orderBy: { id: "asc" } }) : [];
  if (grants.length !== candidates.length) return retry();
  const expected = new Map(candidates.map(row => [row.id, row]));
  for (const grant of grants) {
    const initial = expected.get(grant.id)!;
    if (grant.organizationId !== organizationId || grant.membershipId !== initial.membershipId
      || grant.clientId !== initial.clientId || !grant.active) return retry();
    nextRevision(grant.revision);
  }
  for (const grant of grants) await tx.clientGrant.update({ where: { id: grant.id },
    data: { active: false, revision: nextRevision(grant.revision) } });
}

export async function withdrawMembership(actor: OrganizationActor, membershipIdInput: string, input: unknown,
  options: OrganizationOptions = {}): Promise<MembershipResult> {
  await checkOrganizationActor(actor, options);
  const membershipId = parseOrganizationInput(OrganizationIdSchema, membershipIdInput);
  const command = parseOrganizationInput(MembershipCommandSchema, input);
  const initial = await organizationDb(options).organizationMembership.findUnique({ where: { id: membershipId },
    include: { organization: { select: { ownerUserId: true } } } });
  if (!initial) return missing();
  const action = "organization.membership_withdrawn", hash = canonicalHash({ action, resourceId: membershipId, input: command });
  return mutation(actor, options, [initial.organization.ownerUserId, initial.userId], async (tx, locked) => {
    const organization = await lockStoredOrganization(tx, initial.organizationId, locked, true);
    await lockOrganizationRows(tx, "OrganizationMembership", [membershipId], true);
    const member = await tx.organizationMembership.findUnique({ where: { id: membershipId } });
    if (!member || member.organizationId !== organization.id || member.userId !== initial.userId || member.userId !== actor.userId) return missing();
    if (member.userId === organization.ownerUserId) throw new OrganizationError("PROTECTED_OWNER", 403);
    const previous = await previousResult(tx, actor, command.operationKey, hash, MembershipResultSchema);
    if (previous) return previous;
    requireRevision(member.revision, command.expectedRevision);
    if (member.state === "REVOKED") throw new OrganizationError("INVALID_STATE");
    nextRevision(member.revision); nextRevision(organization.revision);
    const grants = await tx.clientGrant.findMany({ where: { organizationId: organization.id, membershipId: member.id, active: true },
      select: { id: true, clientId: true, membershipId: true } });
    const clientIds = [...new Set(grants.map(row => row.clientId))];
    await lockOrganizationRows(tx, "OrganizationClient", clientIds);
    await lockOrganizationRows(tx, "ClientGrant", grants.map(row => row.id), true);
    const clients = clientIds.length ? await tx.organizationClient.findMany({ where: { id: { in: clientIds } }, select: { id: true, organizationId: true } }) : [];
    if (clients.length !== clientIds.length || clients.some(client => client.organizationId !== organization.id)) return retry();
    await retireGrants(tx, organization.id, grants);
    const saved = await tx.organizationMembership.update({ where: { id: member.id }, data: { state: "REVOKED", revision: nextRevision(member.revision) } });
    await advanceOrganization(tx, organization);
    return saveResult(tx, actor, command.operationKey, hash, organization.id, action, "OrganizationMembership", saved.id, saved.revision,
      { membership: membershipRecord(saved), replayed: false });
  });
}

async function withdrawClient(actor: OrganizationActor, clientIdInput: string, input: unknown,
  options: OrganizationOptions, proposalOnly: boolean): Promise<ClientResult> {
  await checkOrganizationActor(actor, options);
  const clientId = parseOrganizationInput(OrganizationIdSchema, clientIdInput);
  const command = parseOrganizationInput(MembershipCommandSchema, input);
  const initial = await organizationDb(options).organizationClient.findUnique({ where: { id: clientId },
    include: { organization: { select: { ownerUserId: true } }, brand: { select: { userId: true } } } });
  if (!initial) return missing();
  const action = proposalOnly ? "organization.client_proposal_withdrawn" : "organization.client_revoked";
  const hash = canonicalHash({ action, resourceId: clientId, input: command });
  return mutation(actor, options, [initial.organization.ownerUserId, initial.brand.userId], async (tx, locked) => {
    const organization = proposalOnly ? await lockOrganization(tx, initial.organizationId, locked, true)
      : await lockStoredOrganization(tx, initial.organizationId, locked, true);
    if (proposalOnly && organization.ownerUserId !== actor.userId) return missing();
    const grants = await tx.clientGrant.findMany({ where: { organizationId: organization.id, clientId, active: true },
      select: { id: true, membershipId: true, clientId: true } });
    const memberIds = [...new Set(grants.map(row => row.membershipId))];
    await lockOrganizationRows(tx, "OrganizationMembership", memberIds);
    await lockOrganizationRows(tx, "OrganizationClient", [clientId], true);
    await lockOrganizationRows(tx, "ClientGrant", grants.map(row => row.id), true);
    await lockOrganizationRows(tx, "Brand", [initial.brandId]);
    const client = await tx.organizationClient.findUnique({ where: { id: clientId } });
    const brand = await tx.brand.findUnique({ where: { id: initial.brandId }, select: { userId: true } });
    if (!client || client.organizationId !== organization.id || client.brandId !== initial.brandId || !brand) return missing();
    if (!proposalOnly) {
      if (brand.userId !== actor.userId) return missing();
      await currentBrandUser(tx, brand.userId, locked);
    }
    const previous = await previousResult(tx, actor, command.operationKey, hash, ClientResultSchema);
    if (previous) return previous;
    requireRevision(client.revision, command.expectedRevision);
    if (proposalOnly ? client.state !== "PENDING" : client.state === "REVOKED") throw new OrganizationError("INVALID_STATE");
    nextRevision(client.revision); nextRevision(organization.revision);
    const members = memberIds.length ? await tx.organizationMembership.findMany({ where: { id: { in: memberIds } }, select: { id: true, organizationId: true } }) : [];
    if (members.length !== memberIds.length || members.some(member => member.organizationId !== organization.id)) return retry();
    await retireGrants(tx, organization.id, grants);
    // Preserve accepted authorizer/version/capabilities as historical metadata;
    // the revoked state and retired grants remove all current authority.
    const saved = await tx.organizationClient.update({ where: { id: client.id }, data: { state: "REVOKED", revision: nextRevision(client.revision) } });
    await advanceOrganization(tx, organization);
    return saveResult(tx, actor, command.operationKey, hash, organization.id, action, "OrganizationClient", saved.id, saved.revision,
      { client: clientRecord(saved), replayed: false });
  });
}

export async function revokeClientAssociation(actor: OrganizationActor, clientId: string, input: unknown,
  options: OrganizationOptions = {}): Promise<ClientResult> {
  return withdrawClient(actor, clientId, input, options, false);
}
export async function withdrawClientProposal(actor: OrganizationActor, clientId: string, input: unknown,
  options: OrganizationOptions = {}): Promise<ClientResult> {
  return withdrawClient(actor, clientId, input, options, true);
}
