import { z } from "zod";
import {
  checkOrganizationActor, lockOrganization, organizationDb, validateClientDelegation, withOrganizationTransaction,
  type OrganizationActor, type OrganizationOptions, type OrganizationTransaction,
} from "./context";
import { ClientAuthoritySchema, ClientCapabilitySchema, OrganizationError, OrganizationIdSchema, parseOrganizationInput,
  type ClientAuthorityDTO, type ClientCapability } from "./contracts";
import { activeOrganizationMembership, lockOrganizationRows } from "./service";

type AuthorityCallback<T> = (tx: OrganizationTransaction, current: Readonly<ClientAuthorityDTO>) => Promise<T>;
export type ClientAuthorityOperation<T> = { userIds?: readonly string[] } & (
  | { write: false; execute: AuthorityCallback<T> }
  | { write: true; expectedAuthority: unknown;
    replay?: AuthorityCallback<{ found: false } | { found: true; result: T }>;
    execute: AuthorityCallback<T> }
);

const identityFields = ["organizationId", "clientId", "brandId", "membershipId", "grantId", "capability"] as const;
const revisionFields = ["organizationRevision", "membershipRevision", "clientRevision", "grantRevision"] as const;
const UserIdsSchema = z.array(OrganizationIdSchema);
const missing = (): never => { throw new OrganizationError("NOT_FOUND", 404); };

async function preflight(clientId: string, options: OrganizationOptions) {
  return await organizationDb(options).organizationClient.findUnique({ where: { id: clientId }, select: {
    organizationId: true, brandId: true, organization: { select: { ownerUserId: true } }, brand: { select: { userId: true } },
  } }) ?? missing();
}

// Private extraction: only the public wrapper supplies native User/session
// authorization and the transaction in which these authority locks are held.
async function lockedAuthority(tx: OrganizationTransaction, actor: OrganizationActor, clientId: string,
  capability: ClientCapability, initial: Awaited<ReturnType<typeof preflight>>, lockedUsers: ReadonlySet<string>, write: boolean) {
  const organization = await lockOrganization(tx, initial.organizationId, lockedUsers, write);
  const membership = await activeOrganizationMembership(tx, organization.id, actor.userId, write);
  await lockOrganizationRows(tx, "OrganizationClient", [clientId], write);
  const client = await tx.organizationClient.findUnique({ where: { id: clientId } });
  if (!client || client.organizationId !== organization.id || client.brandId !== initial.brandId) return missing();
  const first = await tx.clientGrant.findUnique({ where: { membershipId_clientId: { membershipId: membership.id, clientId } } });
  if (!first) return missing();
  await lockOrganizationRows(tx, "ClientGrant", [first.id], write);
  const grant = await tx.clientGrant.findUnique({ where: { id: first.id } });
  if (!grant || grant.organizationId !== organization.id || grant.membershipId !== membership.id
    || grant.clientId !== clientId || !grant.active || !grant[capability]) return missing();
  if (write) await lockOrganizationRows(tx, "Brand", [client.brandId], true);
  const delegation = await validateClientDelegation(tx, client, lockedUsers);
  if (!delegation.capabilities[capability]) return missing();
  return Object.freeze(ClientAuthoritySchema.parse({ organizationId: organization.id, clientId, brandId: delegation.brand.id,
    membershipId: membership.id, grantId: grant.id, capability, organizationRevision: organization.revision,
    membershipRevision: membership.revision, clientRevision: client.revision, grantRevision: grant.revision }));
}

// Callbacks are trusted DB-only domain work. They must bind their resource to
// current scope and own their exact actor/key/hash/resource receipt. Native
// conflicts can rerun them; external effects and nested transactions are unsafe.
export async function withClientAuthority<T>(actor: OrganizationActor, clientIdInput: string, capabilityInput: ClientCapability,
  operation: ClientAuthorityOperation<T>, options: OrganizationOptions = {}): Promise<T> {
  await checkOrganizationActor(actor, options);
  const clientId = parseOrganizationInput(OrganizationIdSchema, clientIdInput);
  const capability = parseOrganizationInput(ClientCapabilitySchema, capabilityInput);
  const write = operation.write, execute = operation.execute, replay = operation.write ? operation.replay : undefined;
  const expected = operation.write ? Object.freeze(parseOrganizationInput(ClientAuthoritySchema, operation.expectedAuthority)) : null;
  const extras = [...new Set(parseOrganizationInput(UserIdsSchema, operation.userIds ?? []))];
  if (extras.length > 63) throw new OrganizationError("VALIDATION", 422);
  const initial = await preflight(clientId, options);
  const userIds = [...new Set([initial.organization.ownerUserId, initial.brand.userId, ...extras])].sort();
  if (userIds.length > 63) throw new OrganizationError("VALIDATION", 422);
  return withOrganizationTransaction(actor, options, { write, userIds }, async (tx, lockedUsers) => {
    const current = await lockedAuthority(tx, actor, clientId, capability, initial, lockedUsers, write);
    if (expected) {
      // Historical replay can bypass old revisions, never a different scope or
      // permission. Neither callback sees a mismatched authority identity.
      if (identityFields.some(field => expected[field] !== current[field])) throw new OrganizationError("STALE_VERSION");
      if (replay) {
        const previous = await replay(tx, current);
        if (previous.found) return previous.result;
      }
      if (revisionFields.some(field => expected[field] !== current[field])) throw new OrganizationError("STALE_VERSION");
    }
    // Native final real-clock session validation follows all callback work in
    // the same transaction. No automatic authority revision/journal/audit here.
    return execute(tx, current);
  });
}
