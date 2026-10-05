import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterEach, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import type { OrganizationActor } from "@/lib/organizations/context";
import type { ClientCapabilities } from "@/lib/organizations/contracts";
import { acceptMembership, authorizeClientAssociation, createOrganization, proposeClientAssociation,
  proposeMember, setClientGrant } from "@/lib/organizations/service";
import { getClientAuthority } from "@/lib/organizations/loaders";
import { revokeClientAssociation, withdrawClientProposal, withdrawMembership } from "@/lib/organizations/lifecycle";

// Native test-target authority histories and revocable sessions. These isolated
// customer approvals are synthetic and never legal/provider/live acceptance.
const ownedUsers: string[] = [];
const originalName = " مؤسسة الأصل <script>  ";
const secret = "private-lifecycle-customer-content";
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
  await prisma.user.deleteMany({ where: { id: { in: ownedUsers } } }); ownedUsers.length = 0;
});
async function sign(userId: string) {
  const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const token = await openSession(row.id, row.sessionVersion, row.passwordHash), current = await resolveSession(token);
  if (!current) throw new Error("Native lifecycle fixture session did not resolve");
  const actor: OrganizationActor = { userId: current.userId, role: current.role, sessionId: current.sessionId, sessionVersion: current.sessionVersion };
  return { actor, token };
}
async function actor(role: "BRAND" | "CREATOR" | "ADMIN" = "BRAND") {
  const id = randomUUID(); ownedUsers.push(id);
  const user = await prisma.user.create({ data: { id, role, name: `صاحب حساب أصلي ${id}`, nameEn: secret, email: `${id}@example.invalid`,
    passwordHash: "synthetic-lifecycle-not-login", emailVerifiedAt: new Date(Date.now() - 1000), isTest: true } });
  return { user, ...await sign(id) };
}
async function business() {
  const f = await actor();
  const brand = await prisma.brand.create({ data: { userId: f.user.id, slug: `life-${randomUUID()}`, name: `اسم العميل الأصلي ${f.user.id}`,
    description: secret, profileFacts: { privateLifecycle: secret }, isTest: true } });
  return { ...f, brand };
}
async function agency() {
  const owner = await actor();
  const organization = (await createOrganization(owner.actor, { operationKey: randomUUID(), nameOriginal: originalName, kind: "AGENCY" })).organization;
  const membership = await prisma.organizationMembership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: organization.id, userId: owner.user.id } } });
  return { owner, organization, membership };
}
async function orgRevision(id: string) { return (await prisma.organization.findUniqueOrThrow({ where: { id } })).revision; }
async function proposedClient(a: Awaited<ReturnType<typeof agency>>, owner: Awaited<ReturnType<typeof business>>) {
  return (await proposeClientAssociation(a.owner.actor, a.organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: await orgRevision(a.organization.id), brandId: owner.brand.id })).client;
}
async function client(a: Awaited<ReturnType<typeof agency>>, owner: Awaited<ReturnType<typeof business>>) {
  const p = await proposedClient(a, owner);
  return (await authorizeClientAssociation(owner.actor, p.id, { operationKey: randomUUID(), expectedRevision: p.revision, capabilities: all })).client;
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
async function snapshot(organizationId: string) {
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const [memberships, clients, grants, commands, audits, events] = await Promise.all([
    prisma.organizationMembership.findMany({ where: { organizationId }, orderBy: { id: "asc" } }),
    prisma.organizationClient.findMany({ where: { organizationId }, orderBy: { id: "asc" } }),
    prisma.clientGrant.findMany({ where: { organizationId }, orderBy: { id: "asc" } }),
    prisma.organizationCommand.findMany({ where: { organizationId }, orderBy: { id: "asc" } }),
    prisma.adminAudit.findMany({ where: { snapshot: { path: ["organizationId"], equals: organizationId } }, orderBy: { id: "asc" } }),
    prisma.outboxEvent.findMany({ where: { payload: { path: ["organizationId"], equals: organizationId } }, orderBy: { id: "asc" } }),
  ]);
  return JSON.stringify({ organization, memberships, clients, grants, commands, audits, events });
}
function observed<T>(promise: Promise<T>) {
  return promise.then(value => ({ ok: true as const, value }), (error: { status?: number; code?: string }) => ({ ok: false as const, status: error.status, code: error.code }));
}
function latch() {
  let release!: () => void;
  return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
}
async function waitForLocks(table: "Organization" | "Brand" | "User") {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ${`%"${table}"%`} AND (query LIKE '%FOR SHARE%' OR query LIKE '%FOR UPDATE%')`;
    if (rows[0]?.count) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Lifecycle command did not reach the actual native row-lock wait");
}
function privateSafe(value: unknown, values: readonly string[]) {
  const encoded = JSON.stringify(value);
  for (const value of values) expect(encoded.includes(value)).toBe(false);
}

it("allows only the exact recipient to decline a pending seat and returns an immutable minimal receipt", async () => {
  const a = await agency(), target = await member(a, false), outsider = await actor(), revision = await orgRevision(a.organization.id);
  const command = { operationKey: randomUUID(), expectedRevision: target.membership.revision };
  await expect(withdrawMembership(a.owner.actor, target.membership.id, command)).rejects.toMatchObject({ status: 404 });
  await expect(withdrawMembership(outsider.actor, target.membership.id, command)).rejects.toMatchObject({ status: 404 });
  const result = await withdrawMembership(target.actor, target.membership.id, command);
  expect(result).toMatchObject({ membership: { id: target.membership.id, state: "REVOKED", revision: target.membership.revision + 1 }, replayed: false });
  expect(Object.keys(result.membership).sort()).toEqual(["id", "organizationId", "revision", "state", "userId"]);
  expect(await orgRevision(a.organization.id)).toBe(revision + 1);
  const receipt = await prisma.organizationCommand.findUniqueOrThrow({ where: { actorUserId_operationKey: { actorUserId: target.user.id, operationKey: command.operationKey } } });
  const audits = await prisma.adminAudit.findMany({ where: { actorUserId: target.user.id, action: "organization.membership_withdrawn" } });
  const events = await prisma.outboxEvent.findMany({ where: { deduplicationKey: `organization:${receipt.id}` } });
  expect(audits).toHaveLength(1); expect(events).toHaveLength(1); expect(events[0].type).toBe("organization.membership_withdrawn");
  expect(audits[0].snapshot).toEqual({ organizationId: a.organization.id, resourceRevision: result.membership.revision });
  privateSafe([result, audits[0].snapshot, events[0].payload], [target.user.email, target.user.name, target.user.passwordHash, target.token, target.actor.sessionId, originalName, secret]);
  const beforeReplay = await snapshot(a.organization.id);
  expect(await withdrawMembership(target.actor, target.membership.id, command)).toEqual({ ...result, replayed: true });
  expect(await snapshot(a.organization.id)).toBe(beforeReplay);
});

it("retires all active grants when an accepted member leaves and never revives them on a later accepted invitation", async () => {
  const a = await agency(), one = await business(), two = await business(), target = await member(a);
  const c1 = await client(a, one), c2 = await client(a, two), g1 = await grant(a, c1, target.membership.id), g2 = await grant(a, c2, target.membership.id);
  const revision = await orgRevision(a.organization.id);
  await withdrawMembership(target.actor, target.membership.id, { operationKey: randomUUID(), expectedRevision: target.membership.revision });
  for (const g of [g1, g2]) expect(await prisma.clientGrant.findUniqueOrThrow({ where: { id: g.id } })).toMatchObject({ active: false, revision: g.revision + 1 });
  expect(await orgRevision(a.organization.id)).toBe(revision + 1);
  const proposed = await proposeMember(a.owner.actor, a.organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: await orgRevision(a.organization.id), targetUserId: target.user.id });
  await acceptMembership(target.actor, proposed.membership.id, { operationKey: randomUUID(), expectedRevision: proposed.membership.revision });
  await expect(getClientAuthority(target.actor, c1.id, "view")).rejects.toMatchObject({ status: 404 });
  await expect(getClientAuthority(target.actor, c2.id, "financial")).rejects.toMatchObject({ status: 404 });
  expect(await prisma.clientGrant.count({ where: { membershipId: target.membership.id, active: true } })).toBe(0);
});

it("permits pending decline and active leaving when an agency is inactive and its owner is suspended, but protects the immutable owner", async () => {
  const a = await agency(), pending = await member(a, false), accepted = await member(a);
  await prisma.organization.update({ where: { id: a.organization.id }, data: { active: false, revision: { increment: 1 } } });
  await prisma.user.update({ where: { id: a.owner.user.id }, data: { active: false } });
  await expect(withdrawMembership(pending.actor, pending.membership.id, { operationKey: randomUUID(), expectedRevision: pending.membership.revision })).resolves.toMatchObject({ membership: { state: "REVOKED" } });
  await expect(withdrawMembership(accepted.actor, accepted.membership.id, { operationKey: randomUUID(), expectedRevision: accepted.membership.revision })).resolves.toMatchObject({ membership: { state: "REVOKED" } });
  await prisma.user.update({ where: { id: a.owner.user.id }, data: { active: true } });
  const before = await snapshot(a.organization.id);
  await expect(withdrawMembership(a.owner.actor, a.membership.id, { operationKey: randomUUID(), expectedRevision: a.membership.revision })).rejects.toMatchObject({ status: 403, code: "PROTECTED_OWNER" });
  expect(await snapshot(a.organization.id)).toBe(before);
});

it("lets the actual current Brand owner reject a pending association without any agency approval or creator action", async () => {
  const a = await agency(), owner = await business(), p = await proposedClient(a, owner), revision = await orgRevision(a.organization.id);
  const result = await revokeClientAssociation(owner.actor, p.id, { operationKey: randomUUID(), expectedRevision: p.revision });
  expect(result).toMatchObject({ client: { id: p.id, state: "REVOKED", revision: p.revision + 1 }, replayed: false });
  expect(await orgRevision(a.organization.id)).toBe(revision + 1);
  expect(await prisma.clientGrant.count({ where: { clientId: p.id } })).toBe(0);
});

it("atomically revokes one client and retires its active grants once, preserving another client and inactive grant history", async () => {
  const a = await agency(), one = await business(), two = await business(), target = await member(a), other = await member(a);
  const c1 = await client(a, one), c2 = await client(a, two), g1 = await grant(a, c1, target.membership.id), g2 = await grant(a, c1, other.membership.id), foreign = await grant(a, c2, target.membership.id);
  await prisma.clientGrant.update({ where: { id: g2.id }, data: { active: false, revision: { increment: 1 } } });
  const inactive = await prisma.clientGrant.findUniqueOrThrow({ where: { id: g2.id } }), beforeOther = await prisma.organizationClient.findUniqueOrThrow({ where: { id: c2.id } });
  const revision = await orgRevision(a.organization.id), command = { operationKey: randomUUID(), expectedRevision: c1.revision };
  const result = await revokeClientAssociation(one.actor, c1.id, command);
  expect(result).toMatchObject({ client: { id: c1.id, state: "REVOKED", revision: c1.revision + 1 }, replayed: false });
  expect(Object.keys(result.client).sort()).toEqual(["brandId", "id", "organizationId", "revision", "state"]);
  expect(await prisma.clientGrant.findUniqueOrThrow({ where: { id: g1.id } })).toMatchObject({ active: false, revision: g1.revision + 1 });
  expect(await prisma.clientGrant.findUniqueOrThrow({ where: { id: g2.id } })).toEqual(inactive);
  expect(await prisma.clientGrant.findUniqueOrThrow({ where: { id: foreign.id } })).toMatchObject({ active: true, revision: foreign.revision });
  expect(await prisma.organizationClient.findUniqueOrThrow({ where: { id: c2.id } })).toEqual(beforeOther);
  expect(await orgRevision(a.organization.id)).toBe(revision + 1);
  const snapshotBefore = await snapshot(a.organization.id);
  expect(await revokeClientAssociation(one.actor, c1.id, command)).toEqual({ ...result, replayed: true });
  expect(await snapshot(a.organization.id)).toBe(snapshotBefore);
  const renewed = await proposeClientAssociation(a.owner.actor, a.organization.id, { operationKey: randomUUID(),
    expectedOrganizationRevision: await orgRevision(a.organization.id), brandId: one.brand.id });
  expect(renewed.client).toMatchObject({ id: c1.id, state: "PENDING" });
  await authorizeClientAssociation(one.actor, c1.id, { operationKey: randomUUID(), expectedRevision: renewed.client.revision, capabilities: all });
  expect(await prisma.clientGrant.findUniqueOrThrow({ where: { id: g1.id } })).toMatchObject({ active: false, revision: g1.revision + 1 });
  await expect(getClientAuthority(target.actor, c1.id, "view")).rejects.toMatchObject({ status: 404 });
  await expect(getClientAuthority(target.actor, c2.id, "view")).resolves.toMatchObject({ clientId: c2.id });
});

it("removes rights despite a changed Brand-owner session version, inactive agency and suspended agency owner", async () => {
  const a = await agency(), owner = await business(), target = await member(a), c = await client(a, owner), g = await grant(a, c, target.membership.id);
  await prisma.user.update({ where: { id: owner.user.id }, data: { sessionVersion: { increment: 1 } } });
  const current = await sign(owner.user.id);
  await prisma.organization.update({ where: { id: a.organization.id }, data: { active: false, revision: { increment: 1 } } });
  await prisma.user.update({ where: { id: a.owner.user.id }, data: { active: false } });
  const command = { operationKey: randomUUID(), expectedRevision: c.revision }, before = await snapshot(a.organization.id);
  await expect(revokeClientAssociation(owner.actor, c.id, command)).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  expect(await snapshot(a.organization.id)).toBe(before);
  await expect(revokeClientAssociation(current.actor, c.id, command)).resolves.toMatchObject({ client: { state: "REVOKED" } });
  expect(await prisma.clientGrant.findUniqueOrThrow({ where: { id: g.id } })).toMatchObject({ active: false, revision: g.revision + 1 });
});

it("allows only the replacement current Brand owner to withdraw after native ownership transfer, preserving captured authorizer history", async () => {
  const a = await agency(), original = await business(), replacement = await actor(), target = await member(a), c = await client(a, original);
  const g = await grant(a, c, target.membership.id), before = await prisma.organizationClient.findUniqueOrThrow({ where: { id: c.id } });
  await prisma.brand.update({ where: { id: original.brand.id }, data: { userId: replacement.user.id } });
  const command = { operationKey: randomUUID(), expectedRevision: c.revision };
  await expect(revokeClientAssociation(original.actor, c.id, command)).rejects.toMatchObject({ status: 404 });
  await expect(revokeClientAssociation(a.owner.actor, c.id, command)).rejects.toMatchObject({ status: 404 });
  await revokeClientAssociation(replacement.actor, c.id, command);
  const after = await prisma.organizationClient.findUniqueOrThrow({ where: { id: c.id } });
  expect(after).toMatchObject({ state: "REVOKED", revision: before.revision + 1, authorizingUserId: before.authorizingUserId,
    authorizingSessionVersion: before.authorizingSessionVersion });
  expect(await prisma.clientGrant.findUniqueOrThrow({ where: { id: g.id } })).toMatchObject({ active: false, revision: g.revision + 1 });
});

it("permits only the active agency owner's pending-proposal withdrawal, with exact replay and no power over accepted clients", async () => {
  const a = await agency(), owner = await business(), p = await proposedClient(a, owner), target = await member(a), revision = await orgRevision(a.organization.id);
  const command = { operationKey: randomUUID(), expectedRevision: p.revision };
  await expect(withdrawClientProposal(target.actor, p.id, command)).rejects.toMatchObject({ status: 404 });
  await expect(withdrawClientProposal(owner.actor, p.id, command)).rejects.toMatchObject({ status: 404 });
  const result = await withdrawClientProposal(a.owner.actor, p.id, command);
  expect(result).toMatchObject({ client: { state: "REVOKED", revision: p.revision + 1 }, replayed: false });
  expect(await orgRevision(a.organization.id)).toBe(revision + 1);
  const before = await snapshot(a.organization.id);
  expect(await withdrawClientProposal(a.owner.actor, p.id, command)).toEqual({ ...result, replayed: true });
  expect(await snapshot(a.organization.id)).toBe(before);
  const accepted = await client(a, owner), beforeAccepted = await snapshot(a.organization.id);
  await expect(withdrawClientProposal(a.owner.actor, accepted.id, { operationKey: randomUUID(), expectedRevision: accepted.revision })).rejects.toMatchObject({ status: 409, code: "INVALID_STATE" });
  expect(await snapshot(a.organization.id)).toBe(beforeAccepted);
});

it("rejects stale versions, changed payloads and cross-resource key reuse without any further retirement or parent mutation", async () => {
  const first = await agency(), second = await agency(), owner = await business(), c1 = await client(first, owner), c2 = await client(second, owner);
  const command = { operationKey: randomUUID(), expectedRevision: c1.revision };
  const initial = await snapshot(first.organization.id);
  await expect(revokeClientAssociation(owner.actor, c1.id, { ...command, expectedRevision: c1.revision - 1 })).rejects.toMatchObject({ status: 409, code: "STALE_VERSION" });
  expect(await snapshot(first.organization.id)).toBe(initial);
  await revokeClientAssociation(owner.actor, c1.id, command);
  const one = await snapshot(first.organization.id), two = await snapshot(second.organization.id);
  await expect(revokeClientAssociation(owner.actor, c1.id, { ...command, expectedRevision: c1.revision + 1 })).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_CONFLICT" });
  await expect(revokeClientAssociation(owner.actor, c2.id, { ...command, expectedRevision: c2.revision })).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_CONFLICT" });
  expect(await snapshot(first.organization.id)).toBe(one); expect(await snapshot(second.organization.id)).toBe(two);
});

it("checks actual authentication and role before invalid lifecycle IDs/input and performs no unauthenticated rights removal", async () => {
  const invalid = await actor(), creator = await actor("CREATOR"), admin = await actor("ADMIN");
  await prisma.authSession.update({ where: { id: invalid.actor.sessionId }, data: { revokedAt: new Date() } });
  for (const f of [invalid, creator, admin]) {
    const expected = f === invalid ? { status: 401, code: "UNAUTHENTICATED" } : { status: 403, code: "FORBIDDEN" };
    const calls = [withdrawMembership(f.actor, " ", {}), revokeClientAssociation(f.actor, " ", {}), withdrawClientProposal(f.actor, " ", {})];
    await Promise.all(calls.map(call => expect(call).rejects.toMatchObject(expected)));
    expect(await prisma.organizationCommand.count({ where: { actorUserId: f.user.id } })).toBe(0);
    expect(await prisma.adminAudit.count({ where: { actorUserId: f.user.id } })).toBe(0);
  }
});

it("rolls back every active grant, association, receipt, event and Org advance when a native grant counter is exhausted", async () => {
  const a = await agency(), owner = await business(), first = await member(a), exhausted = await member(a), c = await client(a, owner);
  const normal = await grant(a, c, first.membership.id);
  // A deliberately exhausted test-local persisted counter; not millions of
  // fabricated API calls or a claim of live authority acceptance.
  await prisma.clientGrant.create({ data: { id: `zz-exhausted-${randomUUID()}`, organizationId: a.organization.id, clientId: c.id,
    membershipId: exhausted.membership.id, active: true, revision: 2147483646, ...none, view: true } });
  const before = await snapshot(a.organization.id);
  await expect(revokeClientAssociation(owner.actor, c.id, { operationKey: randomUUID(), expectedRevision: c.revision })).rejects.toMatchObject({ status: 409, code: "VERSION_EXHAUSTED" });
  expect(await snapshot(a.organization.id)).toBe(before);
  expect(await prisma.clientGrant.findUniqueOrThrow({ where: { id: normal.id } })).toMatchObject({ active: true, revision: normal.revision });
});

it("commits only one withdrawal receipt and one grant retirement for concurrent identical commands on actual separate connections", async () => {
  const a = await agency(), owner = await business(), target = await member(a), c = await client(a, owner), g = await grant(a, c, target.membership.id);
  const peer = new PrismaClient(), revision = await orgRevision(a.organization.id), command = { operationKey: randomUUID(), expectedRevision: c.revision };
  try {
    const outcomes = await Promise.all([observed(revokeClientAssociation(owner.actor, c.id, command)), observed(revokeClientAssociation(owner.actor, c.id, command, { client: peer }))]);
    const results = [];
    for (const outcome of outcomes) {
      if (outcome.ok) results.push(outcome.value);
      else { expect({ status: outcome.status, code: outcome.code }).toEqual({ status: 503, code: "RETRY_REQUIRED" }); results.push(await revokeClientAssociation(owner.actor, c.id, command)); }
    }
    expect(results[0].client).toEqual(results[1].client);
    expect(results.some(row => row.replayed)).toBe(true);
    expect(await orgRevision(a.organization.id)).toBe(revision + 1);
    expect(await prisma.clientGrant.findUniqueOrThrow({ where: { id: g.id } })).toMatchObject({ active: false, revision: g.revision + 1 });
    expect(await prisma.organizationCommand.count({ where: { actorUserId: owner.user.id, operationKey: command.operationKey } })).toBe(1);
    expect(await prisma.adminAudit.count({ where: { actorUserId: owner.user.id, action: "organization.client_revoked" } })).toBe(1);
  } finally { await peer.$disconnect(); }
});

it("rechecks current Brand ownership after a genuine transfer lock wait before removing any old-owner rights", async () => {
  const a = await agency(), owner = await business(), replacement = await actor(), target = await member(a), c = await client(a, owner), g = await grant(a, c, target.membership.id);
  const peer = new PrismaClient(), held = latch(), release = latch();
  const holding = peer.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Brand" WHERE id=${owner.brand.id} FOR UPDATE`;
    held.release(); await release.promise; await tx.brand.update({ where: { id: owner.brand.id }, data: { userId: replacement.user.id } });
  }, { timeout: 10000 });
  const command = { operationKey: randomUUID(), expectedRevision: c.revision };
  let writing: ReturnType<typeof observed<Awaited<ReturnType<typeof revokeClientAssociation>>>> | undefined;
  try {
    await held.promise; writing = observed(revokeClientAssociation(owner.actor, c.id, command));
    expect(await Promise.race([waitForLocks("Brand").then(() => true), writing.then(() => false)])).toBe(true);
    release.release(); await holding; const outcome = await writing; expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("Former Brand owner withdrew transferred customer authority");
    expect([404, 503]).toContain(outcome.status);
    expect(await prisma.organizationClient.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ state: "ACTIVE", revision: c.revision });
    expect(await prisma.clientGrant.findUniqueOrThrow({ where: { id: g.id } })).toMatchObject({ active: true, revision: g.revision });
    expect(await prisma.organizationCommand.count({ where: { actorUserId: owner.user.id, operationKey: command.operationKey } })).toBe(0);
    await expect(revokeClientAssociation(owner.actor, c.id, command)).rejects.toMatchObject({ status: 404 });
    await expect(revokeClientAssociation(replacement.actor, c.id, command)).resolves.toMatchObject({ client: { state: "REVOKED" } });
  } finally { release.release(); await holding; await writing; await peer.$disconnect(); }
});

it("allows a recipient to decline after an actual Org-deactivation wait rather than requiring agency readiness to remove rights", async () => {
  const a = await agency(), target = await member(a, false), peer = new PrismaClient(), held = latch(), release = latch();
  const holding = peer.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${a.organization.id} FOR UPDATE`;
    held.release(); await release.promise; await tx.organization.update({ where: { id: a.organization.id }, data: { active: false, revision: { increment: 1 } } });
  }, { timeout: 10000 });
  const command = { operationKey: randomUUID(), expectedRevision: target.membership.revision };
  let writing: ReturnType<typeof observed<Awaited<ReturnType<typeof withdrawMembership>>>> | undefined;
  try {
    await held.promise; writing = observed(withdrawMembership(target.actor, target.membership.id, command));
    expect(await Promise.race([waitForLocks("Organization").then(() => true), writing.then(() => false)])).toBe(true);
    release.release(); await holding; const outcome = await writing;
    if (!outcome.ok) { expect({ status: outcome.status, code: outcome.code }).toEqual({ status: 503, code: "RETRY_REQUIRED" }); await withdrawMembership(target.actor, target.membership.id, command); }
    expect(await prisma.organizationMembership.findUniqueOrThrow({ where: { id: target.membership.id } })).toMatchObject({ state: "REVOKED", revision: target.membership.revision + 1 });
    expect(await prisma.organizationCommand.count({ where: { actorUserId: target.user.id, operationKey: command.operationKey } })).toBe(1);
  } finally { release.release(); await holding; await writing; await peer.$disconnect(); }
});

it("rolls back all native rights-removal effects when the actual actor expires after retirement but before final authorization", async () => {
  const a = await agency(), owner = await business(), target = await member(a), c = await client(a, owner), g = await grant(a, c, target.membership.id);
  const before = await snapshot(a.organization.id), entered = latch(), release = latch(), expiresAt = new Date(Date.now() + 1500);
  await prisma.authSession.update({ where: { id: owner.actor.sessionId }, data: { expiresAt } });
  const extendedClient = prisma.$extends({ query: { adminAudit: { async create({ args, query }) {
    const result = await query(args); entered.release(); await release.promise; return result;
  } } } }) as unknown as PrismaClient;
  const writing = observed(revokeClientAssociation(owner.actor, c.id, { operationKey: randomUUID(), expectedRevision: c.revision }, { client: extendedClient }));
  try {
    expect(await Promise.race([entered.promise.then(() => true), writing.then(() => false)])).toBe(true);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 20))); release.release();
    const outcome = await writing; expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("Final-expired customer authority removal committed rights changes");
    expect({ status: outcome.status, code: outcome.code }).toEqual({ status: 401, code: "UNAUTHENTICATED" });
    expect(await snapshot(a.organization.id)).toBe(before);
    expect(await prisma.clientGrant.findUniqueOrThrow({ where: { id: g.id } })).toMatchObject({ active: true, revision: g.revision });
  } finally { release.release(); await writing; }
});
