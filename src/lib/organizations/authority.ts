import { z } from "zod";
import { Prisma } from "@prisma/client";
import { readAiPlanningNativeFrame, type AiPlanningNativeFrame } from "@/lib/ai-budget/ledger";
import type { PlanningCall, PlanningCheckpoint } from "@/lib/campaign-planning/scope";
import {
  captureOrganizationActor, checkOrganizationActor, lockOrganization, organizationAwait, organizationDb, validateClientDelegation, withOrganizationTransaction,
  type OrganizationActor, type OrganizationOptions, type OrganizationTransaction,
} from "./context";
import { ClientAuthoritySchema, ClientCapabilitiesSchema, ClientCapabilitySchema, OrganizationError, OrganizationIdSchema, parseOrganizationInput,
  type ClientAuthorityDTO, type ClientCapability } from "./contracts";
import { activeOrganizationMembership, lockOrganizationRows } from "./service";

type AuthorityCallback<T> = (tx: OrganizationTransaction, current: Readonly<ClientAuthorityDTO>,
  ownerIds: ReadonlySet<string>, reviewerIds: ReadonlySet<string>) => Promise<T>;
export type ClientAuthorityOperation<T> = {
  userIds?: readonly string[]; reviewerIds?: readonly string[]; checkpoint?: () => void;
} & (
  | { write: false; execute: AuthorityCallback<T> }
  | { write: true; expectedAuthority: unknown;
    replay?: AuthorityCallback<{ found: false } | { found: true; result: T }>;
    execute: AuthorityCallback<T> }
);

const identityFields = ["organizationId", "clientId", "brandId", "membershipId", "grantId", "capability"] as const;
const revisionFields = ["organizationRevision", "membershipRevision", "clientRevision", "grantRevision"] as const;
const UserIdsSchema = z.array(OrganizationIdSchema).max(63);
const ReviewerIdsSchema = z.array(OrganizationIdSchema).max(2412);
const missing = (): never => { throw new OrganizationError("NOT_FOUND", 404); };

async function preflight(clientId: string, options: OrganizationOptions, checkpoint?: () => void) {
  return await organizationAwait(checkpoint, () => organizationDb(options).organizationClient.findUnique({ where: { id: clientId }, select: {
    organizationId: true, brandId: true, organization: { select: { ownerUserId: true } }, brand: { select: { userId: true } },
  } })) ?? missing();
}

// Private extraction: only the public wrapper supplies native User/session
// authorization and the transaction in which these authority locks are held.
async function lockedAuthority(tx: OrganizationTransaction, actor: OrganizationActor, clientId: string,
  capability: ClientCapability, initial: Awaited<ReturnType<typeof preflight>>, lockedUsers: ReadonlySet<string>, write: boolean,
  checkpoint?: () => void) {
  const organization = await lockOrganization(tx, initial.organizationId, lockedUsers, write, checkpoint);
  const membership = await activeOrganizationMembership(tx, organization.id, actor.userId, write, checkpoint);
  await lockOrganizationRows(tx, "OrganizationClient", [clientId], write, checkpoint);
  const client = await organizationAwait(checkpoint, () => tx.organizationClient.findUnique({ where: { id: clientId } }));
  if (!client || client.organizationId !== organization.id || client.brandId !== initial.brandId) return missing();
  const first = await organizationAwait(checkpoint, () => tx.clientGrant.findUnique({ where: { membershipId_clientId: { membershipId: membership.id, clientId } } }));
  if (!first) return missing();
  await lockOrganizationRows(tx, "ClientGrant", [first.id], write, checkpoint);
  const grant = await organizationAwait(checkpoint, () => tx.clientGrant.findUnique({ where: { id: first.id } }));
  if (!grant || grant.organizationId !== organization.id || grant.membershipId !== membership.id
    || grant.clientId !== clientId || !grant.active || !grant[capability]) return missing();
  if (write) await lockOrganizationRows(tx, "Brand", [client.brandId], true, checkpoint);
  const delegation = await validateClientDelegation(tx, client, lockedUsers, checkpoint);
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
  const checkpoint = operation.checkpoint;
  await checkOrganizationActor(actor, options, checkpoint);
  const clientId = parseOrganizationInput(OrganizationIdSchema, clientIdInput);
  const capability = parseOrganizationInput(ClientCapabilitySchema, capabilityInput);
  const write = operation.write, execute = operation.execute, replay = operation.write ? operation.replay : undefined;
  const expected = operation.write ? Object.freeze(parseOrganizationInput(ClientAuthoritySchema, operation.expectedAuthority)) : null;
  const extras = [...new Set(parseOrganizationInput(UserIdsSchema, operation.userIds ?? []))];
  const reviewerIds = [...new Set(parseOrganizationInput(ReviewerIdsSchema, operation.reviewerIds ?? []))].sort();
  if (extras.length > 63) throw new OrganizationError("VALIDATION", 422);
  checkpoint?.();
  const initial = await preflight(clientId, options, checkpoint);
  const userIds = [...new Set([initial.organization.ownerUserId, initial.brand.userId, ...extras])].sort();
  if (userIds.length > 63) throw new OrganizationError("VALIDATION", 422);
  return withOrganizationTransaction(actor, options, { write, userIds, reviewerIds, checkpoint }, async (tx, lockedUsers, lockedReviewers) => {
    const current = await lockedAuthority(tx, actor, clientId, capability, initial, lockedUsers, write, checkpoint);
    checkpoint?.();
    if (expected) {
      // Historical replay can bypass old revisions, never a different scope or
      // permission. Neither callback sees a mismatched authority identity.
      if (identityFields.some(field => expected[field] !== current[field])) throw new OrganizationError("STALE_VERSION");
      if (replay) {
        const previous = await replay(tx, current, lockedUsers, lockedReviewers);
        if (previous.found) return previous.result;
      }
      if (revisionFields.some(field => expected[field] !== current[field])) throw new OrganizationError("STALE_VERSION");
    }
    // Native final real-clock session validation follows all callback work in
    // the same transaction. No automatic authority revision/journal/audit here.
    checkpoint?.();
    return execute(tx, current, lockedUsers, lockedReviewers);
  });
}

// This fixed internal lane shares the actual accounting-owner transaction. Thin
// captures declare identities only; every issued proof binds current native rows.
export type ClientPlanningIdentityCapture = Readonly<{ actor: Readonly<OrganizationActor>; clientId: string;
  organizationId: string; brandId: string; organizationOwnerUserId: string; brandOwnerUserId: string; ownerIds: readonly string[] }>;
export type ClientScopeView = Readonly<{ clientId: string; organizationId: string; brandId: string;
  planAuthority: Readonly<ClientAuthorityDTO>; viewAuthority: Readonly<ClientAuthorityDTO>;
  targetOwnerUserId: string; targetOwnerSessionVersion: number; currentClientRevision: number }>;
declare const clientPlanningProofBrand: unique symbol;
export type ClientPlanningAuthorityProof = Readonly<{ [clientPlanningProofBrand]: true }>;
const planningActor = z.object({ userId: OrganizationIdSchema, role: z.enum(["BRAND", "CREATOR", "ADMIN"]),
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{43}$/), sessionVersion: z.number().int().min(1).max(2147483647) }).strict();
const clientPlanningCapture = z.object({ actor: planningActor, clientId: OrganizationIdSchema, organizationId: OrganizationIdSchema,
  brandId: OrganizationIdSchema, organizationOwnerUserId: OrganizationIdSchema, brandOwnerUserId: OrganizationIdSchema,
  ownerIds: UserIdsSchema }).strict().refine(value => JSON.stringify(value.ownerIds) === JSON.stringify(
    [...new Set([value.actor.userId, value.organizationOwnerUserId, value.brandOwnerUserId])].sort()));
function freezePlanning<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freezePlanning(child); Object.freeze(value); }
  return value;
}
function samePlanningActor(left: OrganizationActor, right: OrganizationActor) {
  return left.userId === right.userId && left.role === right.role && left.sessionId === right.sessionId && left.sessionVersion === right.sessionVersion;
}
const planningProofMissing = (): never => { throw new OrganizationError("SCOPE_PROOF_UNAVAILABLE", 503); };
const planningIdentityRetry = (): never => { throw new OrganizationError("RETRY_REQUIRED", 503); };
const planningOrgSelect = { id: true, ownerUserId: true, active: true, revision: true } as const;
const planningMemberSelect = { id: true, organizationId: true, userId: true, state: true, revision: true } as const;
const planningClientSelect = { id: true, organizationId: true, brandId: true, state: true, revision: true,
  authorizingUserId: true, authorizingSessionVersion: true, allowedCapabilities: true } as const;
const planningGrantSelect = { id: true, organizationId: true, membershipId: true, clientId: true, active: true, revision: true, plan: true, view: true } as const;
const planningOwnerSelect = { id: true, active: true, role: true, sessionVersion: true } as const;
type PlanningBaseView = Awaited<ReturnType<typeof readAiPlanningNativeFrame>>;
type PlanningClientRows = {
  organization: Prisma.OrganizationGetPayload<{ select: typeof planningOrgSelect }>;
  membership: Prisma.OrganizationMembershipGetPayload<{ select: typeof planningMemberSelect }>;
  client: Prisma.OrganizationClientGetPayload<{ select: typeof planningClientSelect }>;
  grant: Prisma.ClientGrantGetPayload<{ select: typeof planningGrantSelect }>;
  brand: { id: string; userId: string };
  organizationOwner: Prisma.UserGetPayload<{ select: typeof planningOwnerSelect }>;
  brandOwner: Prisma.UserGetPayload<{ select: typeof planningOwnerSelect }>;
};
type PlanningClientProofState = { frame: AiPlanningNativeFrame; tx: OrganizationTransaction; capture: ClientPlanningIdentityCapture;
  checkpoint: PlanningCheckpoint; rows: PlanningClientRows; view: ClientScopeView };
const clientPlanningProofs = new WeakMap<object, PlanningClientProofState>();
async function captureClientPlanningIdentity(call: PlanningCall, clientIdInput: string): Promise<ClientPlanningIdentityCapture> {
  const actor = captureOrganizationActor(call.actor), clientId = parseOrganizationInput(OrganizationIdSchema, clientIdInput);
  const options = { client: organizationDb(call.options) }, checkpoint = call.checkpoint;
  await checkOrganizationActor(actor, options, checkpoint);
  const initial = await preflight(clientId, options, checkpoint);
  return freezePlanning(clientPlanningCapture.parse({ actor, clientId, organizationId: initial.organizationId, brandId: initial.brandId,
    organizationOwnerUserId: initial.organization.ownerUserId, brandOwnerUserId: initial.brand.userId,
    ownerIds: [...new Set([actor.userId, initial.organization.ownerUserId, initial.brand.userId])].sort() }));
}
async function lockClientPlanningRows(base: PlanningBaseView, capture: ClientPlanningIdentityCapture, checkpoint: PlanningCheckpoint): Promise<PlanningClientRows> {
  const tx = base.tx;
  await organizationAwait(checkpoint, () => tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${capture.organizationId} FOR UPDATE`);
  const organization = await organizationAwait(checkpoint, () => tx.organization.findUnique({ where: { id: capture.organizationId }, select: planningOrgSelect }));
  if (!organization) return missing();
  if (!base.ownerIds.includes(organization.ownerUserId) || organization.ownerUserId !== capture.organizationOwnerUserId) return planningIdentityRetry();
  if (!organization.active) return missing();
  const firstMember = await organizationAwait(checkpoint, () => tx.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId: organization.id, userId: base.actor.userId } }, select: planningMemberSelect }));
  if (!firstMember) return missing();
  await lockOrganizationRows(tx, "OrganizationMembership", [firstMember.id], true, checkpoint);
  const membership = await organizationAwait(checkpoint, () => tx.organizationMembership.findUnique({ where: { id: firstMember.id }, select: planningMemberSelect }));
  if (!membership || membership.organizationId !== organization.id || membership.userId !== base.actor.userId || membership.state !== "ACTIVE") return missing();
  await lockOrganizationRows(tx, "OrganizationClient", [capture.clientId], true, checkpoint);
  const client = await organizationAwait(checkpoint, () => tx.organizationClient.findUnique({ where: { id: capture.clientId }, select: planningClientSelect }));
  if (!client) return missing();
  if (client.organizationId !== organization.id || client.brandId !== capture.brandId) return planningIdentityRetry();
  if (client.state !== "ACTIVE") return missing();
  const firstGrant = await organizationAwait(checkpoint, () => tx.clientGrant.findUnique({
    where: { membershipId_clientId: { membershipId: membership.id, clientId: client.id } }, select: planningGrantSelect }));
  if (!firstGrant) return missing();
  await lockOrganizationRows(tx, "ClientGrant", [firstGrant.id], true, checkpoint);
  const grant = await organizationAwait(checkpoint, () => tx.clientGrant.findUnique({ where: { id: firstGrant.id }, select: planningGrantSelect }));
  if (!grant || grant.organizationId !== organization.id || grant.membershipId !== membership.id || grant.clientId !== client.id
    || !grant.active || !grant.plan || !grant.view) return missing();
  await lockOrganizationRows(tx, "Brand", [capture.brandId], true, checkpoint);
  const brand = await organizationAwait(checkpoint, () => tx.brand.findUnique({ where: { id: capture.brandId }, select: { id: true, userId: true } }));
  if (!brand) return missing();
  if (!base.ownerIds.includes(brand.userId) || brand.userId !== capture.brandOwnerUserId) return planningIdentityRetry();
  const organizationOwner = await organizationAwait(checkpoint, () => tx.user.findUnique({ where: { id: organization.ownerUserId }, select: planningOwnerSelect }));
  const brandOwner = await organizationAwait(checkpoint, () => tx.user.findUnique({ where: { id: brand.userId }, select: planningOwnerSelect }));
  const capabilities = ClientCapabilitiesSchema.safeParse(client.allowedCapabilities);
  if (!organizationOwner?.active || organizationOwner.role !== "BRAND" || !brandOwner?.active || brandOwner.role !== "BRAND"
    || client.authorizingUserId !== brand.userId || client.authorizingSessionVersion !== brandOwner.sessionVersion
    || !capabilities.success || !capabilities.data.plan || !capabilities.data.view) return missing();
  return { organization, membership, client: { ...client, allowedCapabilities: capabilities.data }, grant, brand, organizationOwner, brandOwner };
}
async function bindClientPlanningInFrame(frame: AiPlanningNativeFrame, input: ClientPlanningIdentityCapture,
  checkpoint: PlanningCheckpoint): Promise<ClientPlanningAuthorityProof> {
  const parsed = clientPlanningCapture.safeParse(input), capturedCheckpoint = checkpoint;
  const base = await readAiPlanningNativeFrame(frame);
  if (!parsed.success || !samePlanningActor(parsed.data.actor, base.actor) || base.actor.role !== "BRAND") return planningProofMissing();
  const capture = freezePlanning(parsed.data);
  if (capture.ownerIds.some(id => !base.ownerIds.includes(id))) return planningIdentityRetry();
  const rows = await lockClientPlanningRows(base, capture, capturedCheckpoint);
  const common = { organizationId: rows.organization.id, clientId: rows.client.id, brandId: rows.brand.id, membershipId: rows.membership.id,
    grantId: rows.grant.id, organizationRevision: rows.organization.revision, membershipRevision: rows.membership.revision,
    clientRevision: rows.client.revision, grantRevision: rows.grant.revision };
  const view: ClientScopeView = freezePlanning({ clientId: rows.client.id, organizationId: rows.organization.id, brandId: rows.brand.id,
    planAuthority: ClientAuthoritySchema.parse({ ...common, capability: "plan" }), viewAuthority: ClientAuthoritySchema.parse({ ...common, capability: "view" }),
    targetOwnerUserId: rows.brandOwner.id, targetOwnerSessionVersion: rows.brandOwner.sessionVersion, currentClientRevision: rows.client.revision });
  await base.assertCurrent();
  const proof = Object.freeze({}) as ClientPlanningAuthorityProof;
  clientPlanningProofs.set(proof, { frame, tx: base.tx, capture, checkpoint: capturedCheckpoint, rows: freezePlanning(rows), view });
  return proof;
}
async function clientPlanningProofState(frame: AiPlanningNativeFrame, proof: ClientPlanningAuthorityProof) {
  const base = await readAiPlanningNativeFrame(frame);
  const state = proof !== null && typeof proof === "object" ? clientPlanningProofs.get(proof) : undefined;
  if (!state || state.frame !== frame || state.tx !== base.tx || !samePlanningActor(state.capture.actor, base.actor)) return planningProofMissing();
  return { base, state };
}
async function recheckClientPlanningProof(frame: AiPlanningNativeFrame, proof: ClientPlanningAuthorityProof): Promise<void> {
  const { base, state } = await clientPlanningProofState(frame, proof), { rows, checkpoint } = state, tx = base.tx;
  const organization = await organizationAwait(checkpoint, () => tx.organization.findUnique({ where: { id: rows.organization.id }, select: planningOrgSelect }));
  const membership = await organizationAwait(checkpoint, () => tx.organizationMembership.findUnique({ where: { id: rows.membership.id }, select: planningMemberSelect }));
  const client = await organizationAwait(checkpoint, () => tx.organizationClient.findUnique({ where: { id: rows.client.id }, select: planningClientSelect }));
  const grant = await organizationAwait(checkpoint, () => tx.clientGrant.findUnique({ where: { id: rows.grant.id }, select: planningGrantSelect }));
  const brand = await organizationAwait(checkpoint, () => tx.brand.findUnique({ where: { id: rows.brand.id }, select: { id: true, userId: true } }));
  const organizationOwner = await organizationAwait(checkpoint, () => tx.user.findUnique({ where: { id: rows.organizationOwner.id }, select: planningOwnerSelect }));
  const brandOwner = await organizationAwait(checkpoint, () => tx.user.findUnique({ where: { id: rows.brandOwner.id }, select: planningOwnerSelect }));
  const capabilities = client ? ClientCapabilitiesSchema.safeParse(client.allowedCapabilities) : null;
  const current = { organization, membership, client: client && capabilities?.success ? { ...client, allowedCapabilities: capabilities.data } : client,
    grant, brand, organizationOwner, brandOwner };
  if (JSON.stringify(current) !== JSON.stringify(rows)) return planningIdentityRetry();
  await base.assertCurrent();
}
async function readClientPlanningProof(frame: AiPlanningNativeFrame, proof: ClientPlanningAuthorityProof): Promise<ClientScopeView> {
  await recheckClientPlanningProof(frame, proof);
  return (await clientPlanningProofState(frame, proof)).state.view;
}
export const clientAuthorityInternals = Object.freeze({ capturePlanningIdentity: captureClientPlanningIdentity,
  bindPlanningInFrame: bindClientPlanningInFrame, readPlanningProof: readClientPlanningProof, recheckPlanningProof: recheckClientPlanningProof });
