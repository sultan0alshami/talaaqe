import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterEach, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import {
  acceptMembership, associateOwnedBrand, authorizeClientAssociation, createOrganization,
  proposeClientAssociation, proposeMember, revokeClientGrant, revokeMembership, setClientGrant,
} from "@/lib/organizations/service";
import { getClientAuthority, getOrganizationClients } from "@/lib/organizations/loaders";
import type { OrganizationActor } from "@/lib/organizations/context";
import { applyDealCommand, createDealOffer, getDeal } from "@/lib/deals/service";
import { cleanup, fixture, users } from "../deals/fixtures";

// Native guarded test-local actors and owner-approved fixture associations are
// authority acceptance only; they are not live agency/legal/provider consent.
const originalName = "  اسم مؤسسة أصلي <script> دون ترجمة  ";
const privateSentinel = "private-organization-brand-content-sentinel";
const ownedUserIds: string[] = [];
const capabilityNames = ["view", "plan", "approveShortlist", "reviewContent", "signCustomer", "financial", "manageGrants"] as const;
type Capability = typeof capabilityNames[number];
type Capabilities = Record<Capability, boolean>;
function caps(enabled: readonly Capability[] = []): Capabilities {
  return { view: enabled.includes("view"), plan: enabled.includes("plan"), approveShortlist: enabled.includes("approveShortlist"),
    reviewContent: enabled.includes("reviewContent"), signCustomer: enabled.includes("signCustomer"), financial: enabled.includes("financial"), manageGrants: enabled.includes("manageGrants") };
}
const allCaps = caps(capabilityNames);

afterEach(async () => {
  // Discover only organizations belonging to actors explicitly created here;
  // this also cleans a committed creation whose returned promise was lost.
  const organizations = await prisma.organization.findMany({ where: { ownerUserId: { in: ownedUserIds } }, select: { id: true } });
  const organizationIds = organizations.map(row => row.id);
  await prisma.organizationCommand.deleteMany({ where: { OR: [{ actorUserId: { in: ownedUserIds } }, { organizationId: { in: organizationIds } }] } });
  await prisma.clientGrant.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.organizationClient.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  await cleanup(); ownedUserIds.length = 0;
});

async function actor(role: "BRAND" | "CREATOR" | "ADMIN" = "BRAND") {
  const id = randomUUID(); users.push(id); ownedUserIds.push(id);
  const user = await prisma.user.create({ data: { id, role, name: "اسم مستخدم أصلي", nameEn: privateSentinel,
    email: `${randomUUID()}@example.invalid`, passwordHash: "synthetic-org-not-a-login", isTest: true, emailVerifiedAt: new Date(Date.now() - 1000) } });
  return { user, ...await signedActor(user.id) };
}
async function signedActor(userId: string) {
  const saved = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const token = await openSession(saved.id, saved.sessionVersion, saved.passwordHash), current = await resolveSession(token);
  if (!current) throw new Error("Synthetic native organization session did not resolve");
  const actor: OrganizationActor = { userId: current.userId, role: current.role, sessionId: current.sessionId, sessionVersion: current.sessionVersion };
  return { actor, token };
}
async function business() {
  const f = await actor();
  const brand = await prisma.brand.create({ data: { userId: f.user.id, slug: `org-${randomUUID()}`, name: `اسم العميل الأصلي ${f.user.id.slice(0, 8)}`,
    description: privateSentinel, profileFacts: { privateSentinel }, isTest: true } });
  return { ...f, brand };
}
async function agency() {
  const owner = await actor();
  const created = await createOrganization(owner.actor, { operationKey: randomUUID(), nameOriginal: originalName, kind: "AGENCY" });
  const organization = created.organization;
  const membership = await prisma.organizationMembership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: organization.id, userId: owner.user.id } } });
  return { owner, organization, membership };
}
async function organizationRevision(id: string) { return (await prisma.organization.findUniqueOrThrow({ where: { id } })).revision; }
async function addClient(a: Awaited<ReturnType<typeof agency>>, clientOwner: Awaited<ReturnType<typeof business>>, allowed = allCaps) {
  const proposed = await proposeClientAssociation(a.owner.actor, a.organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: await organizationRevision(a.organization.id), brandId: clientOwner.brand.id });
  return (await authorizeClientAssociation(clientOwner.actor, proposed.client.id, { operationKey: randomUUID(), expectedRevision: proposed.client.revision, capabilities: allowed })).client;
}
async function addMember(a: Awaited<ReturnType<typeof agency>>, existing?: Awaited<ReturnType<typeof actor>>) {
  const member = existing ?? await actor();
  const proposed = await proposeMember(a.owner.actor, a.organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: await organizationRevision(a.organization.id), targetUserId: member.user.id });
  const accepted = await acceptMembership(member.actor, proposed.membership.id, { operationKey: randomUUID(), expectedRevision: proposed.membership.revision });
  return { ...member, membership: accepted.membership };
}
async function grant(a: Awaited<ReturnType<typeof agency>>, clientId: string, membershipId: string, capabilities = allCaps, expectedGrantRevision: number | null = null) {
  const client = await prisma.organizationClient.findUniqueOrThrow({ where: { id: clientId } });
  return (await setClientGrant(a.owner.actor, clientId, { operationKey: randomUUID(), expectedClientRevision: client.revision, membershipId, expectedGrantRevision, capabilities })).grant;
}
function privateSafe(value: unknown, secrets: readonly string[]) {
  const encoded = JSON.stringify(value);
  for (const secret of secrets) expect(encoded.includes(secret)).toBe(false);
}
function observed<T>(promise: Promise<T>) {
  return promise.then(value => ({ ok: true as const, value }), (error: { code?: string; status?: number }) => ({ ok: false as const, code: error.code, status: error.status }));
}
function latch() {
  let release!: () => void;
  return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
}
async function waitForLocks(table: "User" | "AuthSession" | "Organization" | "ClientGrant" | "Brand", minimum = 1) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ${`%"${table}"%`} AND (query LIKE '%FOR SHARE%' OR query LIKE '%FOR UPDATE%')`;
    if (rows[0]?.count >= minimum) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Organization operation did not reach the required actual native row-lock waits");
}

it("creates original organization identity once and journals an immutable payload-bound receipt without granting client powers", async () => {
  const f = await actor(), command = { operationKey: randomUUID(), nameOriginal: originalName, kind: "BUSINESS" as const };
  const first = await createOrganization(f.actor, command), replay = await createOrganization(f.actor, command);
  expect(first.replayed).toBe(false); expect(replay).toEqual({ ...first, replayed: true });
  expect(first.organization).toMatchObject({ name: originalName, kind: "BUSINESS", active: true, revision: 1 });
  expect(Object.keys(first.organization).sort()).toEqual(["active", "id", "kind", "name", "revision"]);
  const saved = await prisma.organization.findUniqueOrThrow({ where: { id: first.organization.id } });
  expect(saved.name).toBe(originalName); expect(saved.ownerUserId).toBe(f.user.id);
  expect(await prisma.organization.count({ where: { ownerUserId: f.user.id } })).toBe(1);
  expect(await prisma.organizationCommand.count({ where: { actorUserId: f.user.id, operationKey: command.operationKey } })).toBe(1);
  expect(await prisma.clientGrant.count({ where: { organizationId: saved.id } })).toBe(0);
  const receipt = await prisma.organizationCommand.findUniqueOrThrow({ where: { actorUserId_operationKey: { actorUserId: f.user.id, operationKey: command.operationKey } } });
  const audits = await prisma.adminAudit.findMany({ where: { actorUserId: f.user.id, action: "organization.created" } });
  expect(audits).toHaveLength(1); expect(audits[0].snapshot).toEqual({ organizationId: saved.id, resourceRevision: 1 });
  const events = await prisma.outboxEvent.findMany({ where: { deduplicationKey: `organization:${receipt.id}` } });
  expect(events).toHaveLength(1); expect({ type: events[0].type, status: events[0].status, attempts: events[0].attempts }).toEqual({ type: "organization.created", status: "PENDING", attempts: 0 });
  privateSafe([audits[0].snapshot, events[0].payload], [originalName, f.token, f.actor.sessionId, f.user.passwordHash, f.user.email, privateSentinel]);
  privateSafe([first, replay], [f.token, f.actor.sessionId, f.user.passwordHash, f.user.email, privateSentinel]);
  await expect(createOrganization(f.actor, { ...command, nameOriginal: "اسم آخر" })).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_CONFLICT" });
});

it("associates only an actual organization owner's owned Brand and leaves that owner without implicit client visibility", async () => {
  const owner = await business(), foreign = await business();
  const a = await createOrganization(owner.actor, { operationKey: randomUUID(), nameOriginal: originalName, kind: "BUSINESS" });
  await expect(associateOwnedBrand(owner.actor, a.organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: a.organization.revision, brandId: foreign.brand.id })).rejects.toMatchObject({ status: 404 });
  const linked = await associateOwnedBrand(owner.actor, a.organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: a.organization.revision, brandId: owner.brand.id });
  expect(linked.client).toMatchObject({ organizationId: a.organization.id, brandId: owner.brand.id, state: "ACTIVE" });
  expect((await getOrganizationClients(owner.actor, a.organization.id)).clients).toEqual([]);
  await expect(getClientAuthority(owner.actor, linked.client.id, "view")).rejects.toMatchObject({ status: 404 });
  expect(await prisma.clientGrant.count({ where: { clientId: linked.client.id } })).toBe(0);
});

it("requires actual Brand-owner approval of pending agency association and bounds grants by that explicit delegation", async () => {
  const a = await agency(), clientOwner = await business(), outsider = await business();
  const proposed = await proposeClientAssociation(a.owner.actor, a.organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: await organizationRevision(a.organization.id), brandId: clientOwner.brand.id });
  expect(proposed.client.state).toBe("PENDING");
  expect(Object.keys(proposed.client).sort()).toEqual(["brandId", "id", "organizationId", "revision", "state"]);
  privateSafe(proposed, [clientOwner.user.email, clientOwner.user.name, clientOwner.brand.name, privateSentinel, clientOwner.actor.sessionId]);
  expect((await getOrganizationClients(a.owner.actor, a.organization.id)).clients).toEqual([]);
  const authorization = { operationKey: randomUUID(), expectedRevision: proposed.client.revision, capabilities: caps(["view", "reviewContent", "manageGrants"]) };
  await expect(authorizeClientAssociation(a.owner.actor, proposed.client.id, authorization)).rejects.toMatchObject({ status: 404 });
  await expect(authorizeClientAssociation(outsider.actor, proposed.client.id, authorization)).rejects.toMatchObject({ status: 404 });
  await expect(authorizeClientAssociation(clientOwner.actor, proposed.client.id, { ...authorization, operationKey: randomUUID(), capabilities: { view: true } })).rejects.toMatchObject({ status: 422, code: "VALIDATION" });
  const approved = await authorizeClientAssociation(clientOwner.actor, proposed.client.id, authorization);
  const saved = await prisma.organizationClient.findUniqueOrThrow({ where: { id: approved.client.id } });
  expect(saved.authorizingUserId).toBe(clientOwner.user.id); expect(saved.authorizingSessionVersion).toBe(clientOwner.actor.sessionVersion);
  expect(approved.client.state).toBe("ACTIVE"); expect(await prisma.clientGrant.count({ where: { clientId: approved.client.id } })).toBe(0);
  await expect(grant(a, approved.client.id, a.membership.id, allCaps)).rejects.toMatchObject({ status: 403, code: "DELEGATION_EXCEEDED" });
  await grant(a, approved.client.id, a.membership.id, caps(["view", "reviewContent"]));
  await expect(getClientAuthority(a.owner.actor, approved.client.id, "signCustomer")).rejects.toMatchObject({ status: 404 });
  await expect(getClientAuthority(a.owner.actor, approved.client.id, "reviewContent")).resolves.toMatchObject({ clientId: approved.client.id });
});

it("isolates genuine agency clients, separates each capability and bounds exclusive native view-authorized pages", async () => {
  const a = await agency(), one = await business(), two = await business(), seat = await addMember(a);
  const c1 = await addClient(a, one), c2 = await addClient(a, two);
  await grant(a, c1.id, seat.membership.id, caps(["view", "reviewContent"]));
  expect((await getOrganizationClients(a.owner.actor, a.organization.id)).clients).toEqual([]);
  const list = await getOrganizationClients(seat.actor, a.organization.id);
  expect(list.clients.map(client => client.id)).toEqual([c1.id]);
  privateSafe(list, [two.brand.id, two.brand.name, privateSentinel, one.user.email, seat.token, seat.actor.sessionId]);
  const authority = await getClientAuthority(seat.actor, c1.id, "view");
  expect(authority).toMatchObject({ clientId: c1.id, organizationId: a.organization.id, brandId: one.brand.id, membershipId: seat.membership.id, capability: "view" });
  expect(Object.keys(authority).sort()).toEqual(["brandId", "capability", "clientId", "clientRevision", "grantId", "grantRevision", "membershipId", "membershipRevision", "organizationId", "organizationRevision"]);
  expect(authority.organizationRevision).toBe(await organizationRevision(a.organization.id));
  expect(authority.membershipRevision).toBe((await prisma.organizationMembership.findUniqueOrThrow({ where: { id: seat.membership.id } })).revision);
  expect(authority.clientRevision).toBe((await prisma.organizationClient.findUniqueOrThrow({ where: { id: c1.id } })).revision);
  expect(authority.grantRevision).toBe((await prisma.clientGrant.findUniqueOrThrow({ where: { id: authority.grantId } })).revision);
  await expect(getClientAuthority(seat.actor, c1.id, "reviewContent")).resolves.toMatchObject({ clientId: c1.id });
  for (const capability of ["plan", "approveShortlist", "signCustomer", "financial", "manageGrants"] as const) await expect(getClientAuthority(seat.actor, c1.id, capability)).rejects.toMatchObject({ status: 404 });
  for (const capability of capabilityNames) await expect(getClientAuthority(seat.actor, c2.id, capability)).rejects.toMatchObject({ status: 404 });
  const viewIds = [c1.id];
  for (let i = 0; i < 30; i++) {
    const additional = await addClient(a, await business());
    await grant(a, additional.id, seat.membership.id, caps(["view"])); viewIds.push(additional.id);
  }
  viewIds.sort();
  const first = await getOrganizationClients(seat.actor, a.organization.id);
  expect(first.clients.map(client => client.id)).toEqual(viewIds.slice(0, 30));
  expect(first.nextCursor).toBe(viewIds[29]);
  const second = await getOrganizationClients(seat.actor, a.organization.id, { after: first.nextCursor! });
  expect(second.clients.map(client => client.id)).toEqual(viewIds.slice(30)); expect(second.nextCursor).toBeNull();
  expect(second.clients.every(client => !first.clients.some(previous => previous.id === client.id))).toBe(true);
  for (const client of [...first.clients, ...second.clients]) expect(Object.keys(client).sort()).toEqual(["brandId", "brandName", "id", "organizationId", "revision", "state"]);
  expect(Object.keys(first).sort()).toEqual(["asOf", "clients", "nextCursor", "organizationId"]);
  const last = await prisma.organizationClient.findFirstOrThrow({ where: { organizationId: a.organization.id }, orderBy: { id: "desc" }, select: { id: true } });
  const empty = await getOrganizationClients(seat.actor, a.organization.id, { after: last.id });
  expect(empty.clients).toEqual([]); expect(empty.nextCursor).toBeNull();
  await expect(getOrganizationClients(seat.actor, a.organization.id, { after: "invalid\ncontrol" })).rejects.toMatchObject({ status: 422 });
});

it("keeps a proposed member pending until that exact native actor accepts and protects the immutable owner membership", async () => {
  const a = await agency(), seat = await actor(), wrong = await actor();
  const proposed = await proposeMember(a.owner.actor, a.organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: await organizationRevision(a.organization.id), targetUserId: seat.user.id });
  expect(proposed.membership.state).toBe("PENDING");
  await expect(getOrganizationClients(seat.actor, a.organization.id)).rejects.toMatchObject({ status: 404 });
  const command = { operationKey: randomUUID(), expectedRevision: proposed.membership.revision };
  await expect(acceptMembership(wrong.actor, proposed.membership.id, command)).rejects.toMatchObject({ status: 404 });
  await expect(acceptMembership(a.owner.actor, proposed.membership.id, command)).rejects.toMatchObject({ status: 404 });
  const accepted = await acceptMembership(seat.actor, proposed.membership.id, command);
  expect(accepted.membership).toMatchObject({ userId: seat.user.id, state: "ACTIVE", revision: proposed.membership.revision + 1 });
  expect(await acceptMembership(seat.actor, proposed.membership.id, command)).toEqual({ ...accepted, replayed: true });
  await expect(acceptMembership(seat.actor, proposed.membership.id, { ...command, operationKey: randomUUID() })).rejects.toMatchObject({ status: 409, code: "STALE_VERSION" });
  await expect(revokeMembership(a.owner.actor, a.membership.id, { operationKey: randomUUID(), expectedRevision: a.membership.revision })).rejects.toMatchObject({ status: 403, code: "PROTECTED_OWNER" });
  expect((await prisma.organizationMembership.findUniqueOrThrow({ where: { id: a.membership.id } })).state).toBe("ACTIVE");
});

it("does not let an ordinary member self-escalate even when its recorded client grant includes manageGrants", async () => {
  const a = await agency(), clientOwner = await business(), seat = await addMember(a), c = await addClient(a, clientOwner);
  const current = await grant(a, c.id, seat.membership.id, caps(["view", "manageGrants"]));
  const command = { operationKey: randomUUID(), expectedClientRevision: c.revision, membershipId: seat.membership.id, expectedGrantRevision: current.revision, capabilities: allCaps };
  await expect(setClientGrant(seat.actor, c.id, command)).rejects.toMatchObject({ status: 404 });
  expect((await prisma.clientGrant.findUniqueOrThrow({ where: { id: current.id } })).revision).toBe(current.revision);
  expect(await prisma.organizationCommand.count({ where: { actorUserId: seat.user.id, operationKey: command.operationKey } })).toBe(0);
  await expect(getClientAuthority(seat.actor, c.id, "financial")).rejects.toMatchObject({ status: 404 });
});

it("rejects cross-organization member/client pairs in both the command boundary and actual composite foreign keys", async () => {
  const a = await agency(), b = await agency(), one = await business(), two = await business();
  const c1 = await addClient(a, one), c2 = await addClient(b, two), seat = await addMember(a);
  await expect(setClientGrant(b.owner.actor, c2.id, { operationKey: randomUUID(), expectedClientRevision: c2.revision, membershipId: seat.membership.id, expectedGrantRevision: null, capabilities: allCaps })).rejects.toMatchObject({ status: 404 });
  await expect(prisma.clientGrant.create({ data: { organizationId: a.organization.id, membershipId: seat.membership.id, clientId: c2.id, active: true, ...allCaps } })).rejects.toMatchObject({ code: "P2003" });
  expect(await prisma.clientGrant.count({ where: { membershipId: seat.membership.id } })).toBe(0);
  await expect(getClientAuthority(b.owner.actor, c1.id, "view")).rejects.toMatchObject({ status: 404 });
});

it("preserves exact historical grant receipts after later revocation while fresh commands reject stale revisions and changed keys", async () => {
  const a = await agency(), clientOwner = await business(), seat = await addMember(a), c = await addClient(a, clientOwner);
  const another = await addClient(a, await business());
  const command = { operationKey: randomUUID(), expectedClientRevision: c.revision, membershipId: seat.membership.id, expectedGrantRevision: null, capabilities: caps(["view"]) };
  const first = await setClientGrant(a.owner.actor, c.id, command);
  await revokeClientGrant(a.owner.actor, first.grant.id, { operationKey: randomUUID(), expectedRevision: first.grant.revision });
  const auditBefore = await prisma.adminAudit.count({ where: { actorUserId: a.owner.user.id } });
  const eventBefore = await prisma.outboxEvent.count({ where: { payload: { path: ["actorUserId"], equals: a.owner.user.id } } });
  expect(await setClientGrant(a.owner.actor, c.id, command)).toEqual({ ...first, replayed: true });
  expect((await prisma.clientGrant.findUniqueOrThrow({ where: { id: first.grant.id } })).active).toBe(false);
  await expect(getClientAuthority(seat.actor, c.id, "view")).rejects.toMatchObject({ status: 404 });
  expect(await prisma.adminAudit.count({ where: { actorUserId: a.owner.user.id } })).toBe(auditBefore);
  expect(await prisma.outboxEvent.count({ where: { payload: { path: ["actorUserId"], equals: a.owner.user.id } } })).toBe(eventBefore);
  await expect(setClientGrant(a.owner.actor, c.id, { ...command, capabilities: allCaps })).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_CONFLICT" });
  await expect(setClientGrant(a.owner.actor, another.id, { ...command, expectedClientRevision: another.revision })).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_CONFLICT" });
  expect(await prisma.clientGrant.count({ where: { clientId: another.id } })).toBe(0);
  await expect(revokeClientGrant(a.owner.actor, first.grant.id, { operationKey: randomUUID(), expectedRevision: first.grant.revision })).rejects.toMatchObject({ status: 409, code: "STALE_VERSION" });
  expect(await prisma.organizationCommand.count({ where: { actorUserId: a.owner.user.id, operationKey: command.operationKey } })).toBe(1);
});

it("immediately removes revoked membership authority and rejects a grant's old revision across revoke-reactivate ABA", async () => {
  const a = await agency(), clientOwner = await business(), seat = await addMember(a), c = await addClient(a, clientOwner);
  const first = await grant(a, c.id, seat.membership.id, caps(["view"]));
  const revoked = await revokeClientGrant(a.owner.actor, first.id, { operationKey: randomUUID(), expectedRevision: first.revision });
  const active = await grant(a, c.id, seat.membership.id, caps(["view"]), revoked.grant.revision);
  expect(active.id).toBe(first.id); expect(active.revision).toBe(first.revision + 2);
  await expect(revokeClientGrant(a.owner.actor, active.id, { operationKey: randomUUID(), expectedRevision: first.revision })).rejects.toMatchObject({ status: 409, code: "STALE_VERSION" });
  await revokeMembership(a.owner.actor, seat.membership.id, { operationKey: randomUUID(), expectedRevision: seat.membership.revision });
  await expect(getOrganizationClients(seat.actor, a.organization.id)).rejects.toMatchObject({ status: 404 });
  await expect(getClientAuthority(seat.actor, c.id, "view")).rejects.toMatchObject({ status: 404 });
});

it("retires every active seat grant once on membership revocation and requires explicit new grants after acceptance", async () => {
  const a = await agency(), seat = await addMember(a), one = await addClient(a, await business()), two = await addClient(a, await business());
  const grantCommand = { operationKey: randomUUID(), expectedClientRevision: one.revision, membershipId: seat.membership.id,
    expectedGrantRevision: null, capabilities: caps(["view", "financial"]) };
  const original = await setClientGrant(a.owner.actor, one.id, grantCommand);
  const another = await grant(a, two.id, seat.membership.id, caps(["view", "plan"]));
  await getClientAuthority(seat.actor, one.id, "financial");
  await getClientAuthority(seat.actor, two.id, "plan");
  const historicReceipt = await prisma.organizationCommand.findUniqueOrThrow({ where: {
    actorUserId_operationKey: { actorUserId: a.owner.user.id, operationKey: grantCommand.operationKey },
  } });
  const historicalJson = JSON.stringify(historicReceipt.result), beforeRevision = await organizationRevision(a.organization.id);
  const revokeCommand = { operationKey: randomUUID(), expectedRevision: seat.membership.revision };
  const revoked = await revokeMembership(a.owner.actor, seat.membership.id, revokeCommand);
  expect(revoked.membership).toMatchObject({ id: seat.membership.id, state: "REVOKED", revision: seat.membership.revision + 1 });
  expect(await organizationRevision(a.organization.id)).toBe(beforeRevision + 1);
  const revokeReceipt = await prisma.organizationCommand.findUniqueOrThrow({ where: {
    actorUserId_operationKey: { actorUserId: a.owner.user.id, operationKey: revokeCommand.operationKey },
  } });
  expect(await revokeMembership(a.owner.actor, seat.membership.id, revokeCommand)).toEqual({ ...revoked, replayed: true });
  expect(await organizationRevision(a.organization.id)).toBe(beforeRevision + 1);
  expect(await prisma.adminAudit.count({ where: { actorUserId: a.owner.user.id, action: "organization.membership_revoked", resourceId: seat.membership.id } })).toBe(1);
  expect(await prisma.outboxEvent.count({ where: { deduplicationKey: `organization:${revokeReceipt.id}` } })).toBe(1);
  const proposed = await proposeMember(a.owner.actor, a.organization.id, { operationKey: randomUUID(),
    expectedOrganizationRevision: await organizationRevision(a.organization.id), targetUserId: seat.user.id });
  const accepted = await acceptMembership(seat.actor, proposed.membership.id, { operationKey: randomUUID(), expectedRevision: proposed.membership.revision });
  expect(accepted.membership).toMatchObject({ id: seat.membership.id, state: "ACTIVE", revision: seat.membership.revision + 3 });
  for (const old of [original.grant, another]) {
    const current = await prisma.clientGrant.findUniqueOrThrow({ where: { id: old.id } });
    expect(current.active).toBe(false); expect(current.revision).toBe(old.revision + 1);
  }
  expect((await getOrganizationClients(seat.actor, a.organization.id)).clients).toHaveLength(0);
  for (const [clientId, capability] of [[one.id, "view"], [one.id, "financial"], [two.id, "view"], [two.id, "plan"]] as const) {
    await expect(getClientAuthority(seat.actor, clientId, capability)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  }
  // A historical receipt is still an exact receipt, not permission to revive it.
  expect(await setClientGrant(a.owner.actor, one.id, grantCommand)).toEqual({ ...original, replayed: true });
  expect((await prisma.clientGrant.findUniqueOrThrow({ where: { id: original.grant.id } })).active).toBe(false);
  const restored = await grant(a, one.id, seat.membership.id, caps(["view"]), original.grant.revision + 1);
  expect(restored).toMatchObject({ id: original.grant.id, active: true, revision: original.grant.revision + 2,
    capabilities: caps(["view"]) });
  await getClientAuthority(seat.actor, one.id, "view");
  await expect(getClientAuthority(seat.actor, one.id, "financial")).rejects.toMatchObject({ status: 404 });
  await expect(getClientAuthority(seat.actor, two.id, "view")).rejects.toMatchObject({ status: 404 });
  const savedReceipt = await prisma.organizationCommand.findUniqueOrThrow({ where: { id: historicReceipt.id } });
  expect(JSON.stringify(savedReceipt.result) === historicalJson).toBe(true);
  expect(await prisma.organizationCommand.count({ where: { actorUserId: a.owner.user.id, operationKey: revokeCommand.operationKey } })).toBe(1);
  expect(await prisma.outboxEvent.count({ where: { deduplicationKey: `organization:${revokeReceipt.id}` } })).toBe(1);
});

it("denies absent, wrong-role and currently invalid native sessions before creation or replay despite formerly valid claims", async () => {
  await expect(createOrganization(null as never, { operationKey: randomUUID(), nameOriginal: originalName, kind: "AGENCY" })).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  for (const role of ["CREATOR", "ADMIN"] as const) {
    const f = await actor(role);
    await expect(createOrganization(f.actor, { operationKey: randomUUID(), nameOriginal: originalName, kind: "AGENCY" })).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(await prisma.organizationCommand.count({ where: { actorUserId: f.user.id } })).toBe(0);
  }
  for (const invalidation of ["revoked", "expired", "suspended", "version", "role"] as const) {
    const f = await actor(), command = { operationKey: randomUUID(), nameOriginal: originalName, kind: "AGENCY" as const };
    const created = await createOrganization(f.actor, command);
    if (invalidation === "revoked") await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { revokedAt: new Date() } });
    if (invalidation === "expired") await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { expiresAt: new Date(Date.now() - 1) } });
    if (invalidation === "suspended") await prisma.user.update({ where: { id: f.user.id }, data: { active: false } });
    if (invalidation === "version") await prisma.user.update({ where: { id: f.user.id }, data: { sessionVersion: { increment: 1 } } });
    if (invalidation === "role") await prisma.user.update({ where: { id: f.user.id }, data: { role: "CREATOR" } });
    expect(await resolveSession(f.token) === null).toBe(true);
    await expect(createOrganization(f.actor, command)).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    await expect(getOrganizationClients(f.actor, created.organization.id)).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    expect(await prisma.organizationCommand.count({ where: { actorUserId: f.user.id, operationKey: command.operationKey } })).toBe(1);
  }
  for (const table of ["User", "AuthSession"] as const) {
    const f = await actor(), peer = new PrismaClient(), held = latch(), release = latch();
    const command = { operationKey: randomUUID(), nameOriginal: originalName, kind: "AGENCY" as const };
    const holding = peer.$transaction(async tx => {
      if (table === "User") await tx.$queryRaw`SELECT id FROM "User" WHERE id=${f.user.id} FOR UPDATE`;
      else await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${f.actor.sessionId} FOR UPDATE`;
      held.release(); await release.promise;
      if (table === "User") await tx.user.update({ where: { id: f.user.id }, data: { active: false } });
      else await tx.authSession.update({ where: { id: f.actor.sessionId }, data: { revokedAt: new Date() } });
    }, { timeout: 10000 });
    let writing: ReturnType<typeof observed<Awaited<ReturnType<typeof createOrganization>>>> | undefined;
    try {
      await held.promise; writing = observed(createOrganization(f.actor, command));
      expect(await Promise.race([waitForLocks(table).then(() => true), writing.then(() => false)])).toBe(true);
      release.release(); await holding;
      const result = await writing; expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Lock-invalidated actor created organization authority");
      expect([401, 503]).toContain(result.status);
      await expect(createOrganization(f.actor, command)).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
      expect(await prisma.organization.count({ where: { ownerUserId: f.user.id } })).toBe(0);
      expect(await prisma.organizationCommand.count({ where: { actorUserId: f.user.id } })).toBe(0);
      expect(await prisma.adminAudit.count({ where: { actorUserId: f.user.id } })).toBe(0);
    } finally { release.release(); await holding; await writing; await peer.$disconnect(); }
  }
});

it("has one committed organization creation for the same key on separate connections and resumes any serialization retry", async () => {
  const f = await actor(), peer = new PrismaClient(), command = { operationKey: randomUUID(), nameOriginal: originalName, kind: "AGENCY" as const };
  try {
    const outcomes = await Promise.all([observed(createOrganization(f.actor, command)), observed(createOrganization(f.actor, command, { client: peer }))]);
    const results = [];
    for (const outcome of outcomes) {
      if (outcome.ok) results.push(outcome.value);
      else {
        expect({ status: outcome.status, code: outcome.code }).toEqual({ status: 503, code: "RETRY_REQUIRED" });
        results.push(await createOrganization(f.actor, command));
      }
    }
    expect(results[0].organization.id).toBe(results[1].organization.id);
    expect(await prisma.organization.count({ where: { ownerUserId: f.user.id } })).toBe(1);
    expect(await prisma.organizationCommand.count({ where: { actorUserId: f.user.id, operationKey: command.operationKey } })).toBe(1);
  } finally { await peer.$disconnect(); }
});

it("denies a previously permitted reader after a real grant row-lock wait observes native revocation", async () => {
  const a = await agency(), clientOwner = await business(), seat = await addMember(a), c = await addClient(a, clientOwner), g = await grant(a, c.id, seat.membership.id, caps(["view"]));
  const peer = new PrismaClient(), held = latch(), release = latch();
  const holding = peer.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "ClientGrant" WHERE id=${g.id} FOR UPDATE`;
    held.release(); await release.promise;
    // Native persisted revocation fixtures, not a claim that this bypass is an API.
    await tx.clientGrant.update({ where: { id: g.id }, data: { active: false, revision: { increment: 1 } } });
  }, { timeout: 10000 });
  let reading: ReturnType<typeof observed<Awaited<ReturnType<typeof getClientAuthority>>>> | undefined;
  try {
    await held.promise; reading = observed(getClientAuthority(seat.actor, c.id, "view"));
    expect(await Promise.race([waitForLocks("ClientGrant").then(() => true), reading.then(() => false)])).toBe(true);
    release.release(); await holding;
    const result = await reading; expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Revoked grant reader returned authorized client context");
    expect([404, 503]).toContain(result.status);
    await expect(getClientAuthority(seat.actor, c.id, "view")).rejects.toMatchObject({ status: 404 });
  } finally { release.release(); await holding; await reading; await peer.$disconnect(); }
});

it("serializes two real member acceptances at ordered owner and organization locks and grants neither implicit access", async () => {
  const a = await agency(), one = await actor(), two = await actor();
  const p1 = await proposeMember(a.owner.actor, a.organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: await organizationRevision(a.organization.id), targetUserId: one.user.id });
  const p2 = await proposeMember(a.owner.actor, a.organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: await organizationRevision(a.organization.id), targetUserId: two.user.id });
  const c1 = { operationKey: randomUUID(), expectedRevision: p1.membership.revision }, c2 = { operationKey: randomUUID(), expectedRevision: p2.membership.revision };
  const peer = new PrismaClient(), held = latch(), release = latch();
  const holding = peer.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${a.organization.id} FOR UPDATE`; held.release(); await release.promise; }, { timeout: 10000 });
  let first: ReturnType<typeof observed<Awaited<ReturnType<typeof acceptMembership>>>> | undefined;
  let second: ReturnType<typeof observed<Awaited<ReturnType<typeof acceptMembership>>>> | undefined;
  try {
    await held.promise;
    first = observed(acceptMembership(one.actor, p1.membership.id, c1)); second = observed(acceptMembership(two.actor, p2.membership.id, c2));
    // Writes first lock the shared organization owner User FOR UPDATE. Thus one
    // acceptance waits at Organization and the other queues at the common User;
    // requiring both at Organization would reject this safe serialization.
    expect(await Promise.race([Promise.all([waitForLocks("Organization"), waitForLocks("User")]).then(() => true), first.then(() => false), second.then(() => false)])).toBe(true);
    release.release(); await holding;
    const outcomes = await Promise.all([first, second]);
    for (const [index, outcome] of outcomes.entries()) if (!outcome.ok) {
      expect({ status: outcome.status, code: outcome.code }).toEqual({ status: 503, code: "RETRY_REQUIRED" });
      await acceptMembership(index === 0 ? one.actor : two.actor, index === 0 ? p1.membership.id : p2.membership.id, index === 0 ? c1 : c2);
    }
    expect((await prisma.organizationMembership.findMany({ where: { id: { in: [p1.membership.id, p2.membership.id] } } })).every(member => member.state === "ACTIVE")).toBe(true);
    expect(await prisma.organizationCommand.count({ where: { operationKey: { in: [c1.operationKey, c2.operationKey] }, actorUserId: { in: [one.user.id, two.user.id] } } })).toBe(2);
    expect(await prisma.clientGrant.count({ where: { membershipId: { in: [p1.membership.id, p2.membership.id] } } })).toBe(0);
  } finally { release.release(); await holding; await first; await second; await peer.$disconnect(); }
});

it("rolls back actual created authority, receipt and audit when the native actor expires before final authorization", async () => {
  const f = await actor(), entered = latch(), release = latch(), expiresAt = new Date(Date.now() + 2000);
  await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { expiresAt } });
  const client = prisma.$extends({ query: { adminAudit: { async create({ args, query }) {
    const result = await query(args); entered.release(); await release.promise; return result;
  } } } }) as unknown as PrismaClient;
  const command = { operationKey: randomUUID(), nameOriginal: originalName, kind: "AGENCY" as const };
  const writing = observed(createOrganization(f.actor, command, { client }));
  try {
    expect(await Promise.race([entered.promise.then(() => true), writing.then(() => false)])).toBe(true);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 10)));
    release.release();
    const result = await writing; expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Final-expired organization command returned committed authority");
    expect({ status: result.status, code: result.code }).toEqual({ status: 401, code: "UNAUTHENTICATED" });
    expect(await prisma.organization.count({ where: { ownerUserId: f.user.id } })).toBe(0);
    expect(await prisma.organizationCommand.count({ where: { actorUserId: f.user.id } })).toBe(0);
    expect(await prisma.adminAudit.count({ where: { actorUserId: f.user.id } })).toBe(0);
    expect(await prisma.outboxEvent.count({ where: { payload: { path: ["actorUserId"], equals: f.user.id } } })).toBe(0);
  } finally { release.release(); await writing; }
});

it("invalidates captured agency delegation across an actual Brand-owner transfer wait without rewriting original authorization", async () => {
  const a = await agency(), originalOwner = await business(), replacement = await actor(), seat = await addMember(a);
  const c = await addClient(a, originalOwner); await grant(a, c.id, seat.membership.id, caps(["view"]));
  const before = await prisma.organizationClient.findUniqueOrThrow({ where: { id: c.id } });
  const peer = new PrismaClient(), held = latch(), release = latch();
  const holding = peer.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Brand" WHERE id=${originalOwner.brand.id} FOR UPDATE`;
    held.release(); await release.promise;
    await tx.brand.update({ where: { id: originalOwner.brand.id }, data: { userId: replacement.user.id } });
  }, { timeout: 10000 });
  let reading: ReturnType<typeof observed<Awaited<ReturnType<typeof getClientAuthority>>>> | undefined;
  try {
    await held.promise; reading = observed(getClientAuthority(seat.actor, c.id, "view"));
    expect(await Promise.race([waitForLocks("Brand").then(() => true), reading.then(() => false)])).toBe(true);
    release.release(); await holding;
    const result = await reading; expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Transferred Brand reader returned old delegated client authority");
    expect([404, 503]).toContain(result.status);
    await expect(getClientAuthority(seat.actor, c.id, "view")).rejects.toMatchObject({ status: 404 });
    expect((await getOrganizationClients(seat.actor, a.organization.id)).clients).toEqual([]);
    const after = await prisma.organizationClient.findUniqueOrThrow({ where: { id: c.id } });
    expect(JSON.stringify(after) === JSON.stringify(before)).toBe(true);
  } finally { release.release(); await holding; await reading; await peer.$disconnect(); }
});

it("preserves accepted direct-deal parties and agreement bytes while new organization association grants no historical access", async () => {
  const f = await fixture(); ownedUserIds.push(f.brandUserId);
  const owner = await signedActor(f.brandUserId), seat = await actor();
  const options = { ...f.options, now: new Date(Math.max(Date.now() + 1000, f.options.now.getTime())) };
  const offered = (await createDealOffer(f.brandUserId, f.input, options)).deal;
  const accepted = (await applyDealCommand(f.target.userId, offered.id, { operationKey: randomUUID(), expectedVersion: offered.version,
    action: "ACCEPT", offerId: offered.currentOffer.id, expectedOfferVersion: offered.currentOffer.version }, options)).deal;
  const before = {
    offers: await prisma.dealOffer.findMany({ where: { dealId: accepted.id }, orderBy: { version: "asc" } }),
    agreements: await prisma.agreementSnapshot.findMany({ where: { dealId: accepted.id }, orderBy: { version: "asc" } }),
    deal: await prisma.deal.findUniqueOrThrow({ where: { id: accepted.id } }),
  };
  const created = await createOrganization(owner.actor, { operationKey: randomUUID(), nameOriginal: originalName, kind: "BUSINESS" });
  const linked = await associateOwnedBrand(owner.actor, created.organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: created.organization.revision, brandId: f.brandId });
  const proposed = await proposeMember(owner.actor, created.organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: await organizationRevision(created.organization.id), targetUserId: seat.user.id });
  const membership = (await acceptMembership(seat.actor, proposed.membership.id, { operationKey: randomUUID(), expectedRevision: proposed.membership.revision })).membership;
  await setClientGrant(owner.actor, linked.client.id, { operationKey: randomUUID(), expectedClientRevision: linked.client.revision, membershipId: membership.id, expectedGrantRevision: null, capabilities: allCaps });
  const after = {
    offers: await prisma.dealOffer.findMany({ where: { dealId: accepted.id }, orderBy: { version: "asc" } }),
    agreements: await prisma.agreementSnapshot.findMany({ where: { dealId: accepted.id }, orderBy: { version: "asc" } }),
    deal: await prisma.deal.findUniqueOrThrow({ where: { id: accepted.id } }),
  };
  expect(JSON.stringify(after) === JSON.stringify(before)).toBe(true);
  expect(before.agreements.length).toBe(1);
  expect((await getDeal(f.brandUserId, accepted.id, options)).id).toBe(accepted.id);
  expect((await getDeal(f.target.userId, accepted.id, options)).id).toBe(accepted.id);
  await expect(getDeal(seat.user.id, accepted.id, options)).rejects.toMatchObject({ code: "NOT_FOUND" });
});
