import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { canonicalHash } from "@/lib/onboarding/drafts";
import type { OrganizationActor, OrganizationTransaction } from "@/lib/organizations/context";
import { ClientAuthoritySchema, OrganizationError, type ClientAuthorityDTO, type ClientCapabilities, type ClientCapability } from "@/lib/organizations/contracts";
import { withClientAuthority } from "@/lib/organizations/authority";
import { getClientAuthority } from "@/lib/organizations/loaders";
import { acceptMembership, authorizeClientAssociation, createOrganization, proposeClientAssociation,
  proposeMember, revokeClientGrant, setClientGrant } from "@/lib/organizations/service";

// All identities, approvals, domain descriptions and replay receipts are guarded
// disposable fixtures, not live customer/legal/provider acceptance.
// Brand.description is only a native transaction witness, not a new permission
// to edit customer profiles. There are no provider calls or external effects.
const ownedUsers: string[] = [];
const secret = "private-authority-callback-fixture";
const workAction = "synthetic.authority_callback_work";
const all: ClientCapabilities = { view: true, plan: true, approveShortlist: true, reviewContent: true,
  signCustomer: true, financial: true, manageGrants: true };
const none: ClientCapabilities = { view: false, plan: false, approveShortlist: false, reviewContent: false,
  signCustomer: false, financial: false, manageGrants: false };
const authorityKeys = ["brandId", "capability", "clientId", "clientRevision", "grantId", "grantRevision",
  "membershipId", "membershipRevision", "organizationId", "organizationRevision"];
type WorkResult = { brandId: string; value: string };

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
async function actor(role: "BRAND" | "CREATOR" | "ADMIN" = "BRAND") {
  const id = randomUUID(); ownedUsers.push(id);
  const user = await prisma.user.create({ data: { id, role, name: `صاحب حساب أصلي ${id}`, nameEn: secret,
    email: `${id}@example.invalid`, passwordHash: "synthetic-authority-callback-not-login", isTest: true,
    emailVerifiedAt: new Date(Date.now() - 1000) } });
  const token = await openSession(user.id, user.sessionVersion, user.passwordHash), current = await resolveSession(token);
  if (!current) throw new Error("Native callback fixture session did not resolve");
  const currentActor: OrganizationActor = { userId: current.userId, role: current.role, sessionId: current.sessionId, sessionVersion: current.sessionVersion };
  return { user, token, actor: currentActor };
}
async function business() {
  const own = await actor();
  const brand = await prisma.brand.create({ data: { userId: own.user.id, slug: `cb-${randomUUID()}`,
    name: `اسم العميل الأصلي ${own.user.id}`, description: secret, profileFacts: { callbackPrivate: secret }, isTest: true } });
  return { ...own, brand };
}
async function orgRevision(id: string) { return (await prisma.organization.findUniqueOrThrow({ where: { id } })).revision; }
async function prepared(allowed = all, granted = all) {
  const owner = await actor(), customer = await business(), otherCustomer = await business(), seat = await actor();
  const organization = (await createOrganization(owner.actor, { operationKey: randomUUID(), nameOriginal: " وكالة أصلية دون ترجمة ", kind: "AGENCY" })).organization;
  const pending = (await proposeMember(owner.actor, organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: await orgRevision(organization.id), targetUserId: seat.user.id })).membership;
  const membership = (await acceptMembership(seat.actor, pending.id, { operationKey: randomUUID(), expectedRevision: pending.revision })).membership;
  const clients = [];
  for (const customerOwner of [customer, otherCustomer]) {
    const proposed = (await proposeClientAssociation(owner.actor, organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: await orgRevision(organization.id), brandId: customerOwner.brand.id })).client;
    clients.push((await authorizeClientAssociation(customerOwner.actor, proposed.id, { operationKey: randomUUID(), expectedRevision: proposed.revision,
      capabilities: customerOwner === customer ? allowed : all } )).client);
  }
  const grant = (await setClientGrant(customer.actor, clients[0].id, { operationKey: randomUUID(), expectedClientRevision: clients[0].revision,
    membershipId: membership.id, expectedGrantRevision: null, capabilities: granted })).grant;
  return { owner, customer, otherCustomer, seat, organization, membership, client: clients[0], otherClient: clients[1], grant };
}
type Fixture = Awaited<ReturnType<typeof prepared>>;
async function authority(f: Fixture, capability: "view" | "plan" = "plan") { return getClientAuthority(f.seat.actor, f.client.id, capability); }
function latch() {
  let release!: () => void;
  return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
}
function observed<T>(promise: Promise<T>) {
  return promise.then(value => ({ ok: true as const, value }), (error: { code?: string; status?: number }) => ({ ok: false as const, code: error.code, status: error.status }));
}
async function waitForLocks(table: "User" | "ClientGrant" | "Brand") {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ${`%"${table}"%`}
      AND (query LIKE '%FOR SHARE%' OR query LIKE '%FOR UPDATE%')`;
    if (rows[0]?.count) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Callback operation did not reach the actual native row-lock wait");
}
async function snapshot(f: Fixture) {
  const [brand, organization, clients, grants, audits, commands, events] = await Promise.all([
    prisma.brand.findUniqueOrThrow({ where: { id: f.customer.brand.id } }),
    prisma.organization.findUniqueOrThrow({ where: { id: f.organization.id } }),
    prisma.organizationClient.findMany({ where: { organizationId: f.organization.id }, orderBy: { id: "asc" } }),
    prisma.clientGrant.findMany({ where: { organizationId: f.organization.id }, orderBy: { id: "asc" } }),
    prisma.adminAudit.findMany({ where: { actorUserId: f.seat.user.id }, orderBy: { id: "asc" } }),
    prisma.organizationCommand.findMany({ where: { actorUserId: f.seat.user.id }, orderBy: { id: "asc" } }),
    prisma.outboxEvent.findMany({ where: { payload: { path: ["actorUserId"], equals: f.seat.user.id } }, orderBy: { id: "asc" } }),
  ]);
  return JSON.stringify({ brand, organization, clients, grants, audits, commands, events });
}
function work(f: Fixture, expected: unknown, operationKey = randomUUID(), value = "synthetic committed description") {
  const counts = { replay: 0, execute: 0 }, hash = canonicalHash({ action: workAction, actorUserId: f.seat.user.id,
    clientId: f.client.id, capability: "plan", input: { operationKey, expectedAuthority: expected, value } });
  const operation = {
    write: true as const, expectedAuthority: expected,
    replay: async (tx: OrganizationTransaction, current: ClientAuthorityDTO): Promise<{ found: false } | { found: true; result: WorkResult }> => {
      counts.replay++;
      expect(current.clientId).toBe(f.client.id);
      const receipt = await tx.organizationCommand.findUnique({ where: { actorUserId_operationKey: { actorUserId: f.seat.user.id, operationKey } } });
      if (!receipt) return { found: false };
      if (receipt.payloadHash !== hash || receipt.resourceType !== "SyntheticAuthorityWork" || receipt.resourceId !== current.brandId
        || receipt.organizationId !== current.organizationId) throw new OrganizationError("IDEMPOTENCY_CONFLICT");
      return { found: true, result: receipt.result as WorkResult };
    },
    execute: async (tx: OrganizationTransaction, current: ClientAuthorityDTO): Promise<WorkResult> => {
      counts.execute++;
      const saved = await tx.brand.update({ where: { id: current.brandId }, data: { description: value } });
      const result = { brandId: saved.id, value };
      const receipt = await tx.organizationCommand.create({ data: { actorUserId: f.seat.user.id, operationKey, payloadHash: hash,
        organizationId: current.organizationId, resourceType: "SyntheticAuthorityWork", resourceId: current.brandId, result } });
      await tx.adminAudit.create({ data: { actorUserId: f.seat.user.id, action: workAction, resourceType: "SyntheticAuthorityWork", resourceId: current.brandId,
        snapshot: { organizationId: current.organizationId, clientId: current.clientId, grantId: current.grantId, resourceRevision: current.clientRevision } } });
      await tx.outboxEvent.create({ data: { deduplicationKey: `synthetic-callback:${receipt.id}`, type: workAction,
        payload: { actorUserId: f.seat.user.id, organizationId: current.organizationId, resourceId: current.brandId } } });
      return result;
    },
  };
  return { operationKey, value, counts, operation };
}
async function assertCommittedOnce(f: Fixture, w: ReturnType<typeof work>) {
  expect((await prisma.brand.findUniqueOrThrow({ where: { id: f.customer.brand.id } })).description).toBe(w.value);
  expect((await prisma.brand.findUniqueOrThrow({ where: { id: f.otherCustomer.brand.id } })).description).toBe(secret);
  expect(await prisma.organizationCommand.count({ where: { actorUserId: f.seat.user.id, operationKey: w.operationKey } })).toBe(1);
  expect(await prisma.adminAudit.count({ where: { actorUserId: f.seat.user.id, action: workAction } })).toBe(1);
  expect(await prisma.outboxEvent.count({ where: { type: workAction, payload: { path: ["actorUserId"], equals: f.seat.user.id } } })).toBe(1);
}
function privateSafe(value: unknown, privateValues: string[]) {
  const encoded = JSON.stringify(value);
  for (const privateValue of privateValues) expect(encoded.includes(privateValue)).toBe(false);
}

it("passes only exact current capability/IDs/four revisions to the read callback inside a native RepeatableRead transaction", async () => {
  const f = await prepared(), expected = await authority(f, "view"), before = await snapshot(f);
  let calls = 0;
  const result = await withClientAuthority(f.seat.actor, f.client.id, "view", { write: false, execute: async (tx, current) => {
    calls++; const setting = await tx.$queryRaw<Array<{ isolation: string }>>`SELECT current_setting('transaction_isolation') AS isolation`;
    expect(setting[0].isolation).toBe("repeatable read"); expect(ClientAuthoritySchema.parse(current)).toEqual(expected);
    expect(Object.keys(current).sort()).toEqual(authorityKeys);
    return { authority: current, ownBrandExists: !!await tx.brand.findUnique({ where: { id: current.brandId }, select: { id: true } }) };
  } });
  expect(calls).toBe(1); expect(result).toEqual({ authority: expected, ownBrandExists: true }); expect(await snapshot(f)).toBe(before);
  privateSafe(result, [f.seat.token, f.seat.actor.sessionId, f.customer.user.email, f.customer.brand.name, secret]);
});

it("writes once under the exact plan capability without inferring view, changing Org revisions or affecting another client", async () => {
  const f = await prepared({ ...none, plan: true }, { ...none, plan: true }), expected = await authority(f), w = work(f, expected);
  let seen: ClientAuthorityDTO | undefined;
  const result = await withClientAuthority(f.seat.actor, f.client.id, "plan", { ...w.operation, execute: async (tx, current) => {
    const setting = await tx.$queryRaw<Array<{ isolation: string }>>`SELECT current_setting('transaction_isolation') AS isolation`;
    expect(setting[0].isolation).toBe("serializable"); seen = current; return w.operation.execute(tx, current);
  } });
  expect(seen).toEqual(expected); expect(result).toEqual({ brandId: f.customer.brand.id, value: w.value });
  expect(w.counts).toEqual({ replay: 1, execute: 1 }); await assertCommittedOnce(f, w);
  expect(await orgRevision(f.organization.id)).toBe(expected.organizationRevision);
  await expect(withClientAuthority(f.seat.actor, f.client.id, "view", { write: false, execute: async () => { throw new Error("Must not infer view"); } })).rejects.toMatchObject({ status: 404 });
  const audits = await prisma.adminAudit.findMany({ where: { actorUserId: f.seat.user.id, action: workAction } });
  privateSafe(audits.map(row => row.snapshot), [w.value, f.seat.actor.sessionId, f.customer.user.email, secret]);
});

it("denies unavailable capabilities, other clients, implicit owner/customer powers and nonmembers before invoking either callback", async () => {
  const f = await prepared(all, { ...none, view: true }), expected = await authority(f, "view"), stranger = await actor(), w = work(f, expected), before = await snapshot(f);
  for (const [currentActor, clientId, capability] of [
    [f.seat.actor, f.client.id, "plan"], [f.seat.actor, f.otherClient.id, "view"],
    [f.owner.actor, f.client.id, "view"], [f.customer.actor, f.client.id, "view"], [stranger.actor, f.client.id, "view"],
  ] as const) await expect(withClientAuthority(currentActor, clientId, capability, w.operation)).rejects.toMatchObject({ status: 404 });
  expect(w.counts).toEqual({ replay: 0, execute: 0 }); expect(await snapshot(f)).toBe(before);
});

it("validates all five captured IDs and capability before any replay, even if a callback would claim a saved result", async () => {
  const f = await prepared(), expected = await authority(f), before = await snapshot(f); let replayCalls = 0, executeCalls = 0;
  for (const key of ["organizationId", "clientId", "brandId", "membershipId", "grantId", "capability"] as const) {
    const malformedScope = { ...expected, [key]: key === "capability" ? "view" : `other-${randomUUID()}` };
    await expect(withClientAuthority(f.seat.actor, f.client.id, "plan", { write: true, expectedAuthority: malformedScope,
      replay: async () => { replayCalls++; return { found: true, result: "must not escape" }; },
      execute: async () => { executeCalls++; return "must not run"; },
    })).rejects.toMatchObject({ status: 409, code: "STALE_VERSION" });
  }
  expect(replayCalls).toBe(0); expect(executeCalls).toBe(0); expect(await snapshot(f)).toBe(before);
});

it("rejects malformed expected authority and each stale revision before fresh execution", async () => {
  const f = await prepared(), expected = await authority(f), before = await snapshot(f); let replayCalls = 0, executeCalls = 0;
  for (const input of [null, {}, { ...expected, organizationRevision: "1" }, { ...expected, injected: true }]) {
    await expect(withClientAuthority(f.seat.actor, f.client.id, "plan", { write: true, expectedAuthority: input,
      replay: async () => { replayCalls++; return { found: false }; }, execute: async () => { executeCalls++; return "no"; },
    })).rejects.toMatchObject({ status: 422, code: "VALIDATION" });
  }
  expect(replayCalls).toBe(0);
  for (const key of ["organizationRevision", "membershipRevision", "clientRevision", "grantRevision"] as const) {
    await expect(withClientAuthority(f.seat.actor, f.client.id, "plan", { write: true, expectedAuthority: { ...expected, [key]: expected[key] + 1 },
      replay: async () => { replayCalls++; return { found: false }; }, execute: async () => { executeCalls++; return "no"; },
    })).rejects.toMatchObject({ status: 409, code: "STALE_VERSION" });
  }
  expect(replayCalls).toBe(4); expect(executeCalls).toBe(0); expect(await snapshot(f)).toBe(before);
});

it("replays an exact legitimate old receipt after harmless revision changes but rejects changed payload and a fresh stale write", async () => {
  const f = await prepared(), expected = await authority(f), w = work(f, expected);
  const first = await withClientAuthority(f.seat.actor, f.client.id, "plan", w.operation);
  await setClientGrant(f.customer.actor, f.client.id, { operationKey: randomUUID(), expectedClientRevision: f.client.revision,
    membershipId: f.membership.id, expectedGrantRevision: f.grant.revision, capabilities: all });
  const beforeReplay = await snapshot(f);
  expect(await withClientAuthority(f.seat.actor, f.client.id, "plan", w.operation)).toEqual(first);
  expect(w.counts).toEqual({ replay: 2, execute: 1 }); expect(await snapshot(f)).toBe(beforeReplay);
  const changed = work(f, expected, w.operationKey, "different payload");
  await expect(withClientAuthority(f.seat.actor, f.client.id, "plan", changed.operation)).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_CONFLICT" });
  expect(changed.counts).toEqual({ replay: 1, execute: 0 });
  const fresh = work(f, expected);
  await expect(withClientAuthority(f.seat.actor, f.client.id, "plan", fresh.operation)).rejects.toMatchObject({ status: 409, code: "STALE_VERSION" });
  expect(fresh.counts).toEqual({ replay: 1, execute: 0 }); await assertCommittedOnce(f, w);
});

it("does not invoke replay or execute for a formerly valid receipt after actual grant revocation", async () => {
  const f = await prepared(), expected = await authority(f), w = work(f, expected);
  await withClientAuthority(f.seat.actor, f.client.id, "plan", w.operation);
  await revokeClientGrant(f.customer.actor, f.grant.id, { operationKey: randomUUID(), expectedRevision: f.grant.revision });
  const before = await snapshot(f);
  await expect(withClientAuthority(f.seat.actor, f.client.id, "plan", w.operation)).rejects.toMatchObject({ status: 404 });
  expect(w.counts).toEqual({ replay: 1, execute: 1 }); expect(await snapshot(f)).toBe(before);
});

it("checks the actual native session before malformed resource, capability or expected authority input and runs no callback", async () => {
  const f = await prepared(), creator = await actor("CREATOR"), invalid = { ...f.seat.actor, sessionId: "a".repeat(43) }, before = await snapshot(f);
  let calls = 0;
  const operation = { write: true as const, expectedAuthority: null, replay: async () => { calls++; return { found: false as const }; }, execute: async () => { calls++; return "no"; } };
  for (const [currentActor, status] of [[invalid, 401], [creator.actor, 403]] as const) {
    await expect(withClientAuthority(currentActor, "", "unknown" as "plan", operation)).rejects.toMatchObject({ status });
  }
  await prisma.authSession.update({ where: { id: f.seat.actor.sessionId }, data: { revokedAt: new Date() } });
  await expect(withClientAuthority(f.seat.actor, "", "unknown" as "plan", operation)).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  expect(calls).toBe(0); expect(await snapshot(f)).toBe(before);
});

it("observes native grant revocation after a real grant-lock wait before either callback can run", async () => {
  const f = await prepared(), expected = await authority(f), w = work(f, expected), peer = new PrismaClient(), held = latch(), release = latch();
  const holding = peer.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "ClientGrant" WHERE id=${f.grant.id} FOR UPDATE`;
    held.release(); await release.promise;
    await tx.clientGrant.update({ where: { id: f.grant.id }, data: { active: false, revision: { increment: 1 } } });
  }, { timeout: 10000 });
  let writing: ReturnType<typeof observed<WorkResult>> | undefined;
  try {
    await held.promise; writing = observed(withClientAuthority(f.seat.actor, f.client.id, "plan", w.operation));
    expect(await Promise.race([waitForLocks("ClientGrant").then(() => true), writing.then(() => false)])).toBe(true);
    expect(w.counts).toEqual({ replay: 0, execute: 0 }); release.release(); await holding;
    const outcome = await writing; expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("Revoked native grant entered the domain callback");
    expect([404, 503]).toContain(outcome.status); expect(w.counts).toEqual({ replay: 0, execute: 0 });
    expect((await prisma.brand.findUniqueOrThrow({ where: { id: f.customer.brand.id } })).description).toBe(secret);
    await expect(withClientAuthority(f.seat.actor, f.client.id, "plan", w.operation)).rejects.toMatchObject({ status: 404 });
    expect(w.counts).toEqual({ replay: 0, execute: 0 });
  } finally { release.release(); await holding; await writing; await peer.$disconnect(); }
});

it("invalidates old delegation across a native Brand-transfer wait without rewriting captured authorization or entering callbacks", async () => {
  const f = await prepared(), expected = await authority(f), w = work(f, expected), replacement = await actor();
  const previousClient = await prisma.organizationClient.findUniqueOrThrow({ where: { id: f.client.id } });
  const peer = new PrismaClient(), held = latch(), release = latch();
  const holding = peer.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Brand" WHERE id=${f.customer.brand.id} FOR UPDATE`;
    held.release(); await release.promise;
    await tx.brand.update({ where: { id: f.customer.brand.id }, data: { userId: replacement.user.id } });
  }, { timeout: 10000 });
  let writing: ReturnType<typeof observed<WorkResult>> | undefined;
  try {
    await held.promise; writing = observed(withClientAuthority(f.seat.actor, f.client.id, "plan", w.operation));
    expect(await Promise.race([waitForLocks("Brand").then(() => true), writing.then(() => false)])).toBe(true);
    release.release(); await holding; const outcome = await writing; expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("Transferred Brand entered a former-owner authority callback");
    expect([404, 503]).toContain(outcome.status); expect(w.counts).toEqual({ replay: 0, execute: 0 });
    await expect(withClientAuthority(f.seat.actor, f.client.id, "plan", w.operation)).rejects.toMatchObject({ status: 404 });
    expect(await prisma.organizationClient.findUniqueOrThrow({ where: { id: f.client.id } })).toEqual(previousClient);
    expect((await prisma.brand.findUniqueOrThrow({ where: { id: f.customer.brand.id } })).description).toBe(secret);
  } finally { release.release(); await holding; await writing; await peer.$disconnect(); }
});

it("holds current native authority until the domain write commits, so a real grant-revocation command waits and subsequent work is denied", async () => {
  const f = await prepared(), expected = await authority(f), w = work(f, expected), entered = latch(), release = latch(), peer = new PrismaClient();
  const writing = observed(withClientAuthority(f.seat.actor, f.client.id, "plan", { ...w.operation, execute: async (tx, current) => {
    const result = await w.operation.execute(tx, current); entered.release(); await release.promise; return result;
  } }));
  let revoking: ReturnType<typeof observed<Awaited<ReturnType<typeof revokeClientGrant>>>> | undefined;
  try {
    expect(await Promise.race([entered.promise.then(() => true), writing.then(() => false)])).toBe(true);
    revoking = observed(revokeClientGrant(f.customer.actor, f.grant.id, { operationKey: randomUUID(), expectedRevision: f.grant.revision }, { client: peer }));
    expect(await Promise.race([waitForLocks("User").then(() => true), revoking.then(() => false)])).toBe(true);
    expect((await prisma.brand.findUniqueOrThrow({ where: { id: f.customer.brand.id } })).description).toBe(secret);
    release.release(); const outcome = await writing; expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("Authorized native callback did not commit before waiting removal");
    const removal = await revoking;
    if (!removal.ok) {
      expect({ code: removal.code, status: removal.status }).toEqual({ code: "RETRY_REQUIRED", status: 503 });
      await revokeClientGrant(f.customer.actor, f.grant.id, { operationKey: randomUUID(), expectedRevision: f.grant.revision });
    }
    await assertCommittedOnce(f, w);
    expect(await prisma.clientGrant.findUniqueOrThrow({ where: { id: f.grant.id } })).toMatchObject({ active: false, revision: f.grant.revision + 1 });
    await expect(withClientAuthority(f.seat.actor, f.client.id, "plan", w.operation)).rejects.toMatchObject({ status: 404 });
    expect(w.counts).toEqual({ replay: 1, execute: 1 });
  } finally { release.release(); await writing; await revoking; await peer.$disconnect(); }
});

it("rolls back the actual domain mutation, receipt, audit and outbox when native session expiry follows callback work before final authorization", async () => {
  const f = await prepared(), expected = await authority(f), w = work(f, expected), before = await snapshot(f), entered = latch(), release = latch();
  const expiresAt = new Date(Date.now() + 1500);
  await prisma.authSession.update({ where: { id: f.seat.actor.sessionId }, data: { expiresAt } });
  const writing = observed(withClientAuthority(f.seat.actor, f.client.id, "plan", { ...w.operation, execute: async (tx, current) => {
    const result = await w.operation.execute(tx, current); entered.release(); await release.promise; return result;
  } }));
  try {
    expect(await Promise.race([entered.promise.then(() => true), writing.then(() => false)])).toBe(true);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 20))); release.release();
    const outcome = await writing; expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("Final-expired native authority committed domain callback effects");
    expect({ status: outcome.status, code: outcome.code }).toEqual({ status: 401, code: "UNAUTHENTICATED" });
    expect(w.counts).toEqual({ replay: 1, execute: 1 }); expect(await snapshot(f)).toBe(before);
  } finally { release.release(); await writing; }
});

it("propagates an ordinary callback failure once and rolls back all native domain effects without retrying it", async () => {
  const f = await prepared(), expected = await authority(f), w = work(f, expected), before = await snapshot(f), failure = new Error("synthetic domain rejection");
  await expect(withClientAuthority(f.seat.actor, f.client.id, "plan", { ...w.operation, execute: async (tx, current) => {
    await w.operation.execute(tx, current); throw failure;
  } })).rejects.toBe(failure);
  expect(w.counts).toEqual({ replay: 1, execute: 1 }); expect(await snapshot(f)).toBe(before);
});

it("retries a genuine native Serializable conflict with DB-only callbacks and commits one domain mutation, receipt, audit and event", async () => {
  const f = await prepared(), expected = await authority(f), w = work(f, expected), peer = new PrismaClient(), entered = latch(), release = latch();
  const marker = await prisma.adminAudit.create({ data: { actorUserId: f.seat.user.id, action: "synthetic.serialization_marker", resourceType: "SyntheticMarker",
    resourceId: randomUUID(), snapshot: { counter: 0 } } });
  const conflicts: string[] = [], transactionIds: string[] = [];
  const writing = observed(withClientAuthority(f.seat.actor, f.client.id, "plan", { ...w.operation, execute: async (tx, current) => {
    const result = await w.operation.execute(tx, current);
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT txid_current()::text AS id`; transactionIds.push(rows[0].id);
    const savedMarker = await tx.adminAudit.findUniqueOrThrow({ where: { id: marker.id } });
    const counter = (savedMarker.snapshot as { counter: number }).counter;
    if (w.counts.execute === 1) { entered.release(); await release.promise; }
    try { await tx.adminAudit.update({ where: { id: marker.id }, data: { snapshot: { counter: counter + 1 } } }); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) conflicts.push(error.code + (error.code === "P2010" ? `:${error.meta?.code}` : ""));
      throw error;
    }
    return result;
  } }));
  try {
    expect(await Promise.race([entered.promise.then(() => true), writing.then(() => false)])).toBe(true);
    // A separate native connection commits this row after the callback read.
    // The callback's stale native update then produces a real 40001 conflict;
    // no Prisma exception, provider action or successful reply is fabricated.
    await peer.adminAudit.update({ where: { id: marker.id }, data: { snapshot: { counter: 100 } } }); release.release();
    const outcome = await writing; expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("DB-only native conflict retry failed to commit once");
    expect(conflicts).toHaveLength(1); expect(["P2034", "P2010:40001"]).toContain(conflicts[0]);
    expect(w.counts).toEqual({ replay: 2, execute: 2 }); expect(new Set(transactionIds).size).toBe(2);
    expect((await prisma.adminAudit.findUniqueOrThrow({ where: { id: marker.id } })).snapshot).toEqual({ counter: 101 });
    expect(await orgRevision(f.organization.id)).toBe(expected.organizationRevision); await assertCommittedOnce(f, w);
  } finally { release.release(); await writing; await peer.$disconnect(); }
});

it("returns503 after three genuine Serializable conflicts and leaves all callback work rolled back", async () => {
  const f = await prepared(), expected = await authority(f), w = work(f, expected), peer = new PrismaClient();
  const marker = await prisma.adminAudit.create({ data: { actorUserId: f.seat.user.id, action: "synthetic.serialization_exhaustion_marker", resourceType: "SyntheticMarker",
    resourceId: randomUUID(), snapshot: { counter: 0 } } });
  const entered = [latch(), latch(), latch()], release = [latch(), latch(), latch()];
  const writing = observed(withClientAuthority(f.seat.actor, f.client.id, "plan", { ...w.operation, execute: async (tx, current) => {
    const result = await w.operation.execute(tx, current), attempt = w.counts.execute - 1;
    if (attempt > 2) throw new Error("Native Serializable retry exceeded its bound");
    const savedMarker = await tx.adminAudit.findUniqueOrThrow({ where: { id: marker.id } });
    entered[attempt].release(); await release[attempt].promise;
    await tx.adminAudit.update({ where: { id: marker.id }, data: { snapshot: { counter: (savedMarker.snapshot as { counter: number }).counter + 1 } } });
    return result;
  } }));
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(await Promise.race([entered[attempt].promise.then(() => true), writing.then(() => false)])).toBe(true);
      await peer.adminAudit.update({ where: { id: marker.id }, data: { snapshot: { counter: (attempt + 1) * 100 } } }); release[attempt].release();
    }
    const outcome = await writing; expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("Exhausted native conflict retry committed domain work");
    expect({ status: outcome.status, code: outcome.code }).toEqual({ status: 503, code: "RETRY_REQUIRED" });
    expect(w.counts).toEqual({ replay: 3, execute: 3 });
    expect((await prisma.brand.findUniqueOrThrow({ where: { id: f.customer.brand.id } })).description).toBe(secret);
    expect(await orgRevision(f.organization.id)).toBe(expected.organizationRevision);
    expect(await prisma.organizationCommand.count({ where: { actorUserId: f.seat.user.id, operationKey: w.operationKey } })).toBe(0);
    expect(await prisma.adminAudit.count({ where: { actorUserId: f.seat.user.id, action: workAction } })).toBe(0);
    expect(await prisma.outboxEvent.count({ where: { type: workAction, payload: { path: ["actorUserId"], equals: f.seat.user.id } } })).toBe(0);
  } finally { for (const barrier of release) barrier.release(); await writing; await peer.$disconnect(); }
});

it("requires each of the seven independent native grant flags without inferring view or another action", async () => {
  const f = await prepared(), capabilities: ClientCapability[] = ["view", "plan", "approveShortlist", "reviewContent", "signCustomer", "financial", "manageGrants"];
  let grantRevision = f.grant.revision;
  for (const capability of capabilities) {
    const granted = { ...none, [capability]: true };
    const changed = (await setClientGrant(f.customer.actor, f.client.id, { operationKey: randomUUID(), expectedClientRevision: f.client.revision,
      membershipId: f.membership.id, expectedGrantRevision: grantRevision, capabilities: granted })).grant;
    grantRevision = changed.revision; expect(changed.capabilities).toEqual(granted);
    const expected = await getClientAuthority(f.seat.actor, f.client.id, capability);
    let readCalls = 0;
    expect(await withClientAuthority(f.seat.actor, f.client.id, capability, { write: false, execute: async (_tx, current) => { readCalls++; return current; } })).toEqual(expected);
    expect(readCalls).toBe(1);
    const deniedCapability = capability === "view" ? "financial" : "view", before = await snapshot(f);
    let deniedCalls = 0;
    await expect(withClientAuthority(f.seat.actor, f.client.id, deniedCapability, { write: true, expectedAuthority: { ...expected, capability: deniedCapability },
      replay: async () => { deniedCalls++; return { found: true, result: "must not infer another capability" }; },
      execute: async () => { deniedCalls++; return "must not execute"; },
    })).rejects.toMatchObject({ status: 404 });
    expect(deniedCalls).toBe(0); expect(await snapshot(f)).toBe(before);
  }
});

it("denies an old native grant and saved domain receipt after the actual customer reduces its accepted ceiling", async () => {
  const f = await prepared(), expected = await authority(f), w = work(f, expected);
  await withClientAuthority(f.seat.actor, f.client.id, "plan", w.operation);
  const beforeGrant = await prisma.clientGrant.findUniqueOrThrow({ where: { id: f.grant.id } });
  const changed = (await authorizeClientAssociation(f.customer.actor, f.client.id, { operationKey: randomUUID(), expectedRevision: f.client.revision,
    capabilities: { ...all, plan: false } })).client;
  expect(changed.revision).toBe(f.client.revision + 1);
  expect(await prisma.clientGrant.findUniqueOrThrow({ where: { id: f.grant.id } })).toEqual(beforeGrant);
  const before = await snapshot(f); let readCalls = 0;
  await expect(withClientAuthority(f.seat.actor, f.client.id, "plan", { write: false, execute: async () => { readCalls++; return "must not use the saved true flag"; } })).rejects.toMatchObject({ status: 404 });
  await expect(withClientAuthority(f.seat.actor, f.client.id, "plan", w.operation)).rejects.toMatchObject({ status: 404 });
  expect(readCalls).toBe(0); expect(w.counts).toEqual({ replay: 1, execute: 1 }); expect(await snapshot(f)).toBe(before);
  const view = await withClientAuthority(f.seat.actor, f.client.id, "view", { write: false, execute: async (_tx, current) => current });
  expect(view).toMatchObject({ capability: "view", clientRevision: changed.revision, grantRevision: f.grant.revision }); await assertCommittedOnce(f, w);
});

it("accepts bounded duplicate domain User identities but rejects malformed and excessive merged scopes before callbacks", async () => {
  const f = await prepared(), expected = await authority(f), before = await snapshot(f); let calls = 0;
  const execute = async (_tx: OrganizationTransaction, current: Readonly<ClientAuthorityDTO>) => { calls++; return current; };
  expect(await withClientAuthority(f.seat.actor, f.client.id, "plan", { write: false,
    userIds: [f.owner.user.id, f.owner.user.id, f.seat.user.id, f.seat.user.id], execute })).toEqual(expected);
  expect(calls).toBe(1);
  for (const userIds of [[""], Array.from({ length: 64 }, () => randomUUID()), Array.from({ length: 63 }, () => randomUUID())]) {
    await expect(withClientAuthority(f.seat.actor, f.client.id, "plan", { write: false, userIds, execute })).rejects.toMatchObject({ status: 422, code: "VALIDATION" });
  }
  expect(calls).toBe(1); expect(await snapshot(f)).toBe(before);
});
