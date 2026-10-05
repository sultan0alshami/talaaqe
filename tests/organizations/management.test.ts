import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterEach, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import type { OrganizationActor } from "@/lib/organizations/context";
import {
  acceptMembership, authorizeClientAssociation, createOrganization, proposeClientAssociation,
  proposeMember, revokeClientGrant, setClientGrant,
} from "@/lib/organizations/service";
import {
  getClientGrants, getOrganizationAssociations, getOrganizationMembers,
  getOwnBrandAssociations, getOwnReferences,
} from "@/lib/organizations/management";
import { ClientGrantsSchema, OrganizationAssociationsSchema, OrganizationMembersSchema,
  OwnBrandAssociationsSchema, OwnOrganizationReferencesSchema, type ClientCapabilities } from "@/lib/organizations/contracts";

// Real rows, revocable native sessions and approved domain commands on the
// guarded test target. These fixtures are not live agency/customer consent.
const ownedUsers: string[] = [];
const secret = "private-management-content-not-a-directory";
const all: ClientCapabilities = { view: true, plan: true, approveShortlist: true, reviewContent: true,
  signCustomer: true, financial: true, manageGrants: true };
const none: ClientCapabilities = { view: false, plan: false, approveShortlist: false, reviewContent: false,
  signCustomer: false, financial: false, manageGrants: false };

afterEach(async () => {
  const ids = (await prisma.organization.findMany({ where: { ownerUserId: { in: ownedUsers } }, select: { id: true } })).map(row => row.id);
  await prisma.outboxEvent.deleteMany({ where: { OR: ownedUsers.map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: ownedUsers } } });
  await prisma.organizationCommand.deleteMany({ where: { OR: [{ actorUserId: { in: ownedUsers } }, { organizationId: { in: ids } }] } });
  await prisma.clientGrant.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.organizationClient.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
  await prisma.brand.deleteMany({ where: { userId: { in: ownedUsers } } });
  await prisma.user.deleteMany({ where: { id: { in: ownedUsers } } });
  ownedUsers.length = 0;
});

async function sign(userId: string) {
  const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const token = await openSession(row.id, row.sessionVersion, row.passwordHash);
  const current = await resolveSession(token);
  if (!current) throw new Error("Native management fixture session did not resolve");
  const actor: OrganizationActor = { userId: current.userId, role: current.role, sessionId: current.sessionId, sessionVersion: current.sessionVersion };
  return { actor, token };
}
async function actor(role: "BRAND" | "CREATOR" | "ADMIN" = "BRAND") {
  const id = randomUUID(); ownedUsers.push(id);
  const user = await prisma.user.create({ data: { id, role, name: `اسم أصلي ${id}`, nameEn: secret,
    email: `${id}@example.invalid`, passwordHash: "synthetic-management-not-login", emailVerifiedAt: new Date(Date.now() - 1000), isTest: true } });
  return { user, ...await sign(id) };
}
async function business() {
  const f = await actor();
  const brand = await prisma.brand.create({ data: { userId: f.user.id, slug: `mgmt-${randomUUID()}`, name: `عميل أصلي ${f.user.id}`,
    description: secret, profileFacts: { privateManagement: secret }, isTest: true } });
  return { ...f, brand };
}
async function agency() {
  const owner = await actor();
  const organization = (await createOrganization(owner.actor, { operationKey: randomUUID(), nameOriginal: "وكالة أصلية", kind: "AGENCY" })).organization;
  const membership = await prisma.organizationMembership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: organization.id, userId: owner.user.id } } });
  return { owner, organization, membership };
}
async function orgRevision(id: string) { return (await prisma.organization.findUniqueOrThrow({ where: { id } })).revision; }
async function proposedClient(a: Awaited<ReturnType<typeof agency>>, owner: Awaited<ReturnType<typeof business>>) {
  return (await proposeClientAssociation(a.owner.actor, a.organization.id, { operationKey: randomUUID(),
    expectedOrganizationRevision: await orgRevision(a.organization.id), brandId: owner.brand.id })).client;
}
async function client(a: Awaited<ReturnType<typeof agency>>, owner: Awaited<ReturnType<typeof business>>, capabilities = all) {
  const p = await proposedClient(a, owner);
  return (await authorizeClientAssociation(owner.actor, p.id, { operationKey: randomUUID(), expectedRevision: p.revision, capabilities })).client;
}
async function member(a: Awaited<ReturnType<typeof agency>>, active = true) {
  const f = await actor();
  const p = await proposeMember(a.owner.actor, a.organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: await orgRevision(a.organization.id), targetUserId: f.user.id });
  const membership = active ? (await acceptMembership(f.actor, p.membership.id, { operationKey: randomUUID(), expectedRevision: p.membership.revision })).membership : p.membership;
  return { ...f, membership };
}
async function grant(a: Awaited<ReturnType<typeof agency>>, c: Awaited<ReturnType<typeof client>>, membershipId: string, capabilities = all) {
  return (await setClientGrant(a.owner.actor, c.id, { operationKey: randomUUID(), expectedClientRevision: c.revision,
    membershipId, expectedGrantRevision: null, capabilities })).grant;
}
function privateSafe(value: unknown, values: readonly string[]) {
  const encoded = JSON.stringify(value);
  for (const value of values) expect(encoded.includes(value)).toBe(false);
}
function observed<T>(promise: Promise<T>) {
  return promise.then(value => ({ ok: true as const, value }), (error: { status?: number; code?: string }) => ({ ok: false as const, status: error.status, code: error.code }));
}
function latch() {
  let release!: () => void;
  return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
}
async function waitForLocks(table: "User" | "Brand") {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ${`%"${table}"%`} AND (query LIKE '%FOR SHARE%' OR query LIKE '%FOR UPDATE%')`;
    if (rows[0]?.count) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Management read did not reach the actual native row-lock wait");
}

it("returns only the current actor's minimal own references and audits no contact or original private content", async () => {
  const own = await business(), foreign = await business();
  const references = await getOwnReferences(own.actor);
  expect(OwnOrganizationReferencesSchema.safeParse(references).success).toBe(true);
  expect(references).toMatchObject({ userId: own.user.id, brandId: own.brand.id });
  expect(Object.keys(references).sort()).toEqual(["asOf", "brandId", "userId"]);
  privateSafe(references, [own.user.name, own.brand.name, own.user.email, own.user.passwordHash, own.token, own.actor.sessionId, foreign.brand.id, secret]);
  const empty = await actor();
  expect(await getOwnReferences(empty.actor)).toMatchObject({ userId: empty.user.id, brandId: null });
  const audits = await prisma.adminAudit.findMany({ where: { actorUserId: own.user.id, action: "organization.references_read" } });
  expect(audits).toHaveLength(1);
  privateSafe(audits[0].snapshot, [own.brand.id, own.user.email, own.brand.name, own.user.name, own.token, secret]);
});

it("allows only the actual owner to manage members, and names only current active BRAND members", async () => {
  const a = await agency(), pending = await member(a, false), active = await member(a), outsider = await actor();
  const data = await getOrganizationMembers(a.owner.actor, a.organization.id);
  expect(OrganizationMembersSchema.safeParse(data).success).toBe(true);
  expect(data.members.find(row => row.membership.id === a.membership.id)).toMatchObject({ protectedOwner: true, canReceiveGrant: true });
  expect(data.members.find(row => row.membership.id === pending.membership.id)).toMatchObject({ displayName: null, protectedOwner: false, canReceiveGrant: false });
  expect(data.members.find(row => row.membership.id === active.membership.id)).toMatchObject({ displayName: active.user.name, protectedOwner: false, canReceiveGrant: true });
  privateSafe(data, [pending.user.name, pending.user.email, active.user.email, pending.token, active.token, secret]);
  await expect(getOrganizationMembers(active.actor, a.organization.id)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  await expect(getOrganizationMembers(outsider.actor, a.organization.id)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  await prisma.user.update({ where: { id: active.user.id }, data: { active: false } });
  const withdrawn = await getOrganizationMembers(a.owner.actor, a.organization.id);
  expect(withdrawn.members.find(row => row.membership.id === active.membership.id)).toMatchObject({ displayName: null, canReceiveGrant: false });
});

it("lists association metadata without pending customer names or implicit view, and removes names on view-grant revocation", async () => {
  const a = await agency(), pendingOwner = await business(), currentOwner = await business(), outsider = await actor();
  const p = await proposedClient(a, pendingOwner), c = await client(a, currentOwner);
  const before = await getOrganizationAssociations(a.owner.actor, a.organization.id);
  expect(OrganizationAssociationsSchema.safeParse(before).success).toBe(true);
  expect(before.associations.find(row => row.client.id === p.id)).toMatchObject({ brandName: null, savedCapabilities: null, delegation: "PENDING", canManageGrants: false });
  expect(before.associations.find(row => row.client.id === c.id)).toMatchObject({ brandName: null, delegation: "CURRENT", canManageGrants: true });
  privateSafe(before, [pendingOwner.brand.name, currentOwner.brand.name, pendingOwner.user.name, pendingOwner.user.email, secret]);
  await expect(getOrganizationAssociations(outsider.actor, a.organization.id)).rejects.toMatchObject({ status: 404 });
  const g = await grant(a, c, a.membership.id, { ...none, view: true });
  expect((await getOrganizationAssociations(a.owner.actor, a.organization.id)).associations.find(row => row.client.id === c.id)?.brandName).toBe(currentOwner.brand.name);
  await revokeClientGrant(a.owner.actor, g.id, { operationKey: randomUUID(), expectedRevision: g.revision });
  expect((await getOrganizationAssociations(a.owner.actor, a.organization.id)).associations.find(row => row.client.id === c.id)?.brandName).toBeNull();
});

it("isolates two clients' grants and gives neither billing ownership nor a member manageGrants flag implicit administration", async () => {
  const a = await agency(), one = await business(), two = await business(), seat = await member(a), outsider = await business();
  const c1 = await client(a, one), c2 = await client(a, two), g = await grant(a, c1, seat.membership.id, { ...none, view: true, manageGrants: true });
  const read = await getClientGrants(one.actor, c1.id);
  expect(ClientGrantsSchema.safeParse(read).success).toBe(true);
  expect(read).toMatchObject({ client: { id: c1.id }, delegation: "CURRENT", canManageGrants: true });
  expect(read.grants.map(row => row.grant.id)).toEqual([g.id]);
  expect(read.grants[0]).toMatchObject({ membership: { id: seat.membership.id }, canReceiveGrant: true, effectiveCapabilities: { ...none, view: true, manageGrants: true } });
  expect((await getClientGrants(two.actor, c2.id)).grants).toEqual([]);
  privateSafe(read, [two.brand.id, two.brand.name, one.user.email, seat.user.email, seat.token, secret]);
  await expect(getClientGrants(seat.actor, c1.id)).rejects.toMatchObject({ status: 404 });
  await expect(getClientGrants(two.actor, c1.id)).rejects.toMatchObject({ status: 404 });
  await expect(getClientGrants(outsider.actor, c1.id)).rejects.toMatchObject({ status: 404 });
  const noManager = await agency(), third = await business(), limited = await client(noManager, third, { ...none, view: true });
  await expect(getClientGrants(noManager.owner.actor, limited.id)).rejects.toMatchObject({ status: 404 });
});

it("lets the current Brand owner inspect withdrawal history when captured delegation and agency readiness are invalid", async () => {
  const a = await agency(), owner = await business(), seat = await member(a), c = await client(a, owner);
  await grant(a, c, seat.membership.id);
  await prisma.user.update({ where: { id: owner.user.id }, data: { sessionVersion: { increment: 1 } } });
  const current = await sign(owner.user.id);
  await prisma.organization.update({ where: { id: a.organization.id }, data: { active: false, revision: { increment: 1 } } });
  await prisma.user.update({ where: { id: a.owner.user.id }, data: { active: false } });
  const grants = await getClientGrants(current.actor, c.id);
  expect(grants.canManageGrants).toBe(false);
  expect(grants.delegation).toBe("RENEWAL_REQUIRED");
  expect(grants.grants).toHaveLength(1);
  expect(grants.grants[0].effectiveCapabilities).toEqual(none);
  expect(grants.grants[0].canReceiveGrant).toBe(false);
  const associations = await getOwnBrandAssociations(current.actor);
  expect(OwnBrandAssociationsSchema.safeParse(associations).success).toBe(true);
  expect(associations.associations.find(row => row.client.id === c.id)).toMatchObject({ brandName: owner.brand.name, canAuthorize: false, canRevoke: true, canManageGrants: false });
});

it("follows current Brand ownership rather than the historical authorizer when returning minimal own associations", async () => {
  const a = await agency(), original = await business(), replacement = await actor(), foreign = await business();
  const c = await client(a, original), other = await client(a, foreign);
  await prisma.brand.update({ where: { id: original.brand.id }, data: { userId: replacement.user.id } });
  const before = await getOwnBrandAssociations(original.actor), after = await getOwnBrandAssociations(replacement.actor);
  expect(before).toMatchObject({ brandId: null, associations: [], nextCursor: null });
  expect(after.brandId).toBe(original.brand.id);
  expect(after.associations.map(row => row.client.id)).toEqual([c.id]);
  expect(after.associations[0]).toMatchObject({ delegation: "RENEWAL_REQUIRED", canRevoke: true, brandName: original.brand.name });
  privateSafe(after, [other.id, foreign.brand.id, foreign.brand.name, original.user.email, replacement.user.email, secret]);
});

it("bounds member pages to 30, uses exclusive ID continuation and never exposes pending member names", async () => {
  const a = await agency();
  const pending = [];
  for (let index = 0; index < 30; index++) pending.push(await member(a, false));
  const ids = [a.membership.id, ...pending.map(row => row.membership.id)].sort();
  const first = await getOrganizationMembers(a.owner.actor, a.organization.id);
  expect(first.members.map(row => row.membership.id)).toEqual(ids.slice(0, 30));
  expect(first.nextCursor).toBe(ids[29]);
  const second = await getOrganizationMembers(a.owner.actor, a.organization.id, { after: first.nextCursor! });
  expect(second.members.map(row => row.membership.id)).toEqual(ids.slice(30));
  expect(second.nextCursor).toBeNull();
  privateSafe([first, second], pending.flatMap(row => [row.user.name, row.user.email]));
});

it("bounds organization association pages without disclosing any proposed private customer identity", async () => {
  const a = await agency(), customers = [], ids: string[] = [];
  for (let index = 0; index < 31; index++) { const owner = await business(); customers.push(owner); ids.push((await proposedClient(a, owner)).id); }
  ids.sort();
  const first = await getOrganizationAssociations(a.owner.actor, a.organization.id);
  expect(first.associations.map(row => row.client.id)).toEqual(ids.slice(0, 30));
  expect(first.nextCursor).toBe(ids[29]);
  const second = await getOrganizationAssociations(a.owner.actor, a.organization.id, { after: first.nextCursor! });
  expect(second.associations.map(row => row.client.id)).toEqual(ids.slice(30)); expect(second.nextCursor).toBeNull();
  privateSafe([first, second], customers.flatMap(row => [row.brand.name, row.user.name, row.user.email]));
});

it("bounds current Brand-owner association pages across 31 genuine pending agency proposals", async () => {
  const own = await business(), ids: string[] = [];
  for (let index = 0; index < 31; index++) ids.push((await proposedClient(await agency(), own)).id);
  ids.sort();
  const first = await getOwnBrandAssociations(own.actor);
  expect(first.associations.map(row => row.client.id)).toEqual(ids.slice(0, 30)); expect(first.nextCursor).toBe(ids[29]);
  const second = await getOwnBrandAssociations(own.actor, { after: first.nextCursor! });
  expect(second.associations.map(row => row.client.id)).toEqual(ids.slice(30)); expect(second.nextCursor).toBeNull();
});

it("bounds grant pages and returns no grant from another client or organization", async () => {
  const a = await agency(), own = await business(), c = await client(a, own), ids: string[] = [];
  for (let index = 0; index < 31; index++) ids.push((await grant(a, c, (await member(a)).membership.id, { ...none, view: true })).id);
  ids.sort();
  const first = await getClientGrants(own.actor, c.id);
  expect(first.grants.map(row => row.grant.id)).toEqual(ids.slice(0, 30)); expect(first.nextCursor).toBe(ids[29]);
  const second = await getClientGrants(own.actor, c.id, { after: first.nextCursor! });
  expect(second.grants.map(row => row.grant.id)).toEqual(ids.slice(30)); expect(second.nextCursor).toBeNull();
});

it("checks actual revocable sessions and current role before parsing invalid management IDs or query input", async () => {
  const invalid = await actor(), creator = await actor("CREATOR"), admin = await actor("ADMIN");
  await prisma.authSession.update({ where: { id: invalid.actor.sessionId }, data: { revokedAt: new Date() } });
  for (const f of [invalid, creator, admin]) {
    const expected = f === invalid ? { status: 401, code: "UNAUTHENTICATED" } : { status: 403, code: "FORBIDDEN" };
    const calls = [getOwnReferences(f.actor), getOrganizationMembers(f.actor, " ", { after: " " }),
      getOrganizationAssociations(f.actor, " ", { after: " " }), getOwnBrandAssociations(f.actor, { after: " " }), getClientGrants(f.actor, " ", { after: " " })];
    await Promise.all(calls.map(call => expect(call).rejects.toMatchObject(expected)));
    expect(await prisma.adminAudit.count({ where: { actorUserId: f.user.id } })).toBe(0);
  }
});

it("rechecks a member's real suspension after waiting for native User locks without showing its saved name as current", async () => {
  const a = await agency(), target = await member(a), peer = new PrismaClient(), held = latch(), release = latch();
  const holding = peer.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${target.user.id} FOR UPDATE`;
    await tx.user.update({ where: { id: target.user.id }, data: { active: false } }); held.release(); await release.promise;
  }, { timeout: 10000 });
  let reading: ReturnType<typeof observed<Awaited<ReturnType<typeof getOrganizationMembers>>>> | undefined;
  try {
    await held.promise; reading = observed(getOrganizationMembers(a.owner.actor, a.organization.id));
    expect(await Promise.race([waitForLocks("User").then(() => true), reading.then(() => false)])).toBe(true);
    release.release(); await holding;
    const outcome = await reading;
    if (outcome.ok) expect(outcome.value.members.find(row => row.membership.id === target.membership.id)).toMatchObject({ displayName: null, canReceiveGrant: false });
    else expect({ status: outcome.status, code: outcome.code }).toEqual({ status: 503, code: "RETRY_REQUIRED" });
    const fresh = await getOrganizationMembers(a.owner.actor, a.organization.id);
    expect(fresh.members.find(row => row.membership.id === target.membership.id)).toMatchObject({ displayName: null, canReceiveGrant: false });
  } finally { release.release(); await holding; await reading; await peer.$disconnect(); }
});

it("rolls back a private management read's audit when the actual session expires before the final authorization boundary", async () => {
  const own = await business(), entered = latch(), release = latch(), expiresAt = new Date(Date.now() + 1500);
  await prisma.authSession.update({ where: { id: own.actor.sessionId }, data: { expiresAt } });
  const client = prisma.$extends({ query: { adminAudit: { async create({ args, query }) {
    const result = await query(args); entered.release(); await release.promise; return result;
  } } } }) as unknown as PrismaClient;
  const reading = observed(getOwnReferences(own.actor, { client }));
  try {
    expect(await Promise.race([entered.promise.then(() => true), reading.then(() => false)])).toBe(true);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 20))); release.release();
    const outcome = await reading; expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("Expired management session returned private actor references");
    expect({ status: outcome.status, code: outcome.code }).toEqual({ status: 401, code: "UNAUTHENTICATED" });
    expect(await prisma.adminAudit.count({ where: { actorUserId: own.user.id, action: "organization.references_read" } })).toBe(0);
  } finally { release.release(); await reading; }
});
