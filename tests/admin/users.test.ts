import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { afterEach, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { authenticate, consumeToken, issueToken, openSession, resolveSession } from "@/lib/identity";
import { acceptedOwnershipProof } from "@/lib/evidence/readiness";
import { publicCreator } from "@/lib/onboarding/profiles";
import { getAdminUsers, changeAdminUserStatus } from "@/lib/admin/users";
import { AdminUsersSchema, AdminUserStatusResultSchema, type AdminUserStatusCommand } from "@/lib/admin/contracts";
import type { AdminActor } from "@/lib/admin/context";
import { cleanup, fixture, users } from "../deals/fixtures";

// Native disposable fixtures only: neither these actors nor their proof are live acceptance.
const password = "Synthetic-admin-status-password-2026";
const passwordHash = bcrypt.hashSync(password, 12);
const originalReason = { text: "  سبب أصلي واحد: مراجعة الحساب، بلا ترجمة  ", language: "ar" };

afterEach(async () => {
  await prisma.adminCommand.deleteMany({ where: { actorUserId: { in: users } } });
  await cleanup();
});

async function user(role: "ADMIN" | "BRAND" | "CREATOR" = "BRAND", extra: { id?: string; name?: string } = {}) {
  const id = extra.id ?? randomUUID(); users.push(id);
  return prisma.user.create({ data: { id, name: extra.name ?? "اسم الحساب الأصلي فقط", nameEn: "private-legacy-paired-name",
    email: `${randomUUID()}@example.invalid`, role, passwordHash, isTest: true, emailVerifiedAt: new Date(Date.now() - 1000) } });
}

async function signedActor(userId: string) {
  const saved = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const token = await openSession(saved.id, saved.sessionVersion, saved.passwordHash);
  const current = await resolveSession(token);
  if (!current) throw new Error("Synthetic signed native session did not resolve");
  const actor: AdminActor = { userId: current.userId, role: current.role, sessionId: current.sessionId, sessionVersion: current.sessionVersion };
  return { actor, token };
}

async function setup() {
  const admin = await user("ADMIN"), target = await user();
  return { admin, target, ...await signedActor(admin.id) };
}

function command(overrides: Partial<AdminUserStatusCommand> = {}): AdminUserStatusCommand {
  return { operationKey: randomUUID(), expectedActive: true, expectedVersion: 1, active: false, reason: originalReason, ...overrides };
}

async function effects(actorId: string, targetId: string) {
  return {
    target: await prisma.user.findUniqueOrThrow({ where: { id: targetId } }),
    sessions: await prisma.authSession.findMany({ where: { userId: targetId }, orderBy: { id: "asc" } }),
    tokens: await prisma.authToken.findMany({ where: { userId: targetId }, orderBy: { id: "asc" } }),
    receipts: await prisma.adminCommand.findMany({ where: { actorUserId: actorId }, orderBy: { id: "asc" } }),
    audits: await prisma.adminAudit.findMany({ where: { actorUserId: actorId, resourceType: "User", resourceId: targetId }, orderBy: { id: "asc" } }),
    events: await prisma.outboxEvent.findMany({ where: { payload: { path: ["actorUserId"], equals: actorId } }, orderBy: { id: "asc" } }),
  };
}

function latch() {
  let release!: () => void;
  return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
}

async function waitForTargetLock() {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%"User"%' AND query LIKE '%FOR UPDATE%'`;
    if (rows[0]?.count) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Admin status command did not reach its actual target row-lock wait");
}

it("projects actual original names through an exact private allowlist and bounded deterministic cursor pages", async () => {
  const f = await setup(), prefix = `admin-users-${randomUUID()}-`;
  for (let i = 0; i < 35; i++) await user(i % 2 ? "CREATOR" : "BRAND", { id: `${prefix}${String(i).padStart(2, "0")}`, name: `${i} اسم طويل أصلي <script> دون ترجمة` });
  const saved = await prisma.user.findMany({ orderBy: { id: "asc" }, take: 31 });
  const result = await getAdminUsers(f.actor);
  expect(AdminUsersSchema.safeParse(result).success).toBe(true);
  expect(result.selfId).toBe(f.admin.id);
  expect(result.users.map(row => row.id)).toEqual(saved.slice(0, 30).map(row => row.id));
  expect(result.nextCursor).toBe(saved.length > 30 ? saved[29].id : null);
  expect(result.users).toHaveLength(30);
  for (const row of result.users) {
    const source = saved.find(value => value.id === row.id)!;
    expect(Object.keys(row).sort()).toEqual(["active", "email", "id", "joined", "name", "role", "statusVersion"]);
    expect(row).toEqual({ id: source.id, name: source.name, email: source.email, role: source.role, active: source.active, statusVersion: source.sessionVersion, joined: source.createdAt.toISOString() });
  }
  const second = await getAdminUsers(f.actor, { after: result.nextCursor! });
  const nextSaved = await prisma.user.findMany({ where: { id: { gt: result.nextCursor! } }, orderBy: { id: "asc" }, take: 31 });
  expect(second.users.map(row => row.id)).toEqual(nextSaved.slice(0, 30).map(row => row.id));
  expect(second.nextCursor).toBe(nextSaved.length > 30 ? nextSaved[29].id : null);
  expect(second.users.some(row => result.users.some(previous => previous.id === row.id))).toBe(false);
  const firstOwnId = `${prefix}00`, previous = await prisma.user.findFirst({ where: { id: { lt: firstOwnId } }, orderBy: { id: "desc" } });
  const ownWindow = await getAdminUsers(f.actor, previous ? { after: previous.id } : {});
  expect(ownWindow.users[0]).toMatchObject({ id: firstOwnId, name: "0 اسم طويل أصلي <script> دون ترجمة" });
  const encoded = JSON.stringify(result);
  for (const value of ["private-legacy-paired-name", '"passwordHash":', '"nameEn":', '"token":', '"proof":', f.actor.sessionId, passwordHash]) expect(encoded.includes(value)).toBe(false);
  await expect(getAdminUsers(f.actor, { after: "bad\ncontrol" })).rejects.toMatchObject({ code: "VALIDATION", status: 422 });
  await expect(getAdminUsers(f.actor, { extra: "unknown" } as never)).rejects.toMatchObject({ code: "VALIDATION", status: 422 });
});

it("denies absent or genuine non-admin context before missing-target lookup", async () => {
  const f = await setup(), current = await signedActor(f.target.id), missing = randomUUID();
  await expect(getAdminUsers(null as never)).rejects.toMatchObject({ status: 401 });
  await expect(changeAdminUserStatus(null as never, missing, command())).rejects.toMatchObject({ status: 401 });
  await expect(getAdminUsers(current.actor)).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  await expect(changeAdminUserStatus(current.actor, missing, command())).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  expect((await effects(f.admin.id, f.target.id)).receipts).toHaveLength(0);
});

it("rejects revoked, expired, wrong-version, changed-role and suspended current actors despite previously signed claims", async () => {
  const f = await setup(), before = await effects(f.admin.id, f.target.id);
  for (const invalidation of ["revoked", "expired", "version", "role", "suspended"] as const) {
    await prisma.user.update({ where: { id: f.admin.id }, data: { role: "ADMIN", active: true, sessionVersion: 1 } });
    await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { revokedAt: null, expiresAt: new Date(Date.now() + 60000) } });
    if (invalidation === "revoked") await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { revokedAt: new Date() } });
    if (invalidation === "expired") await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { expiresAt: new Date(Date.now() - 1) } });
    if (invalidation === "version") await prisma.user.update({ where: { id: f.admin.id }, data: { sessionVersion: 2 } });
    if (invalidation === "role") await prisma.user.update({ where: { id: f.admin.id }, data: { role: "BRAND" } });
    if (invalidation === "suspended") await prisma.user.update({ where: { id: f.admin.id }, data: { active: false } });
    expect(await resolveSession(f.token) === null).toBe(true);
    await expect(getAdminUsers(f.actor)).rejects.toMatchObject({ status: 401 });
    await expect(changeAdminUserStatus(f.actor, f.target.id, command())).rejects.toMatchObject({ status: 401 });
    expect(JSON.stringify(await effects(f.admin.id, f.target.id)) === JSON.stringify(before)).toBe(true);
  }
});

it("protects self and ADMIN targets and rejects missing resources or invalid original reasons without effects", async () => {
  const f = await setup(), otherAdmin = await user("ADMIN"), before = await effects(f.admin.id, f.target.id);
  for (const id of [f.admin.id, otherAdmin.id]) await expect(changeAdminUserStatus(f.actor, id, command())).rejects.toMatchObject({ code: "PROTECTED_ACCOUNT", status: 403 });
  await expect(changeAdminUserStatus(f.actor, randomUUID(), command())).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  for (const input of [command({ reason: { text: " ", language: "ar" } }), command({ active: true }), { ...command(), role: "ADMIN" }, { ...command(), reason: { text: "Valid original", language: "not_a_language" } }]) {
    await expect(changeAdminUserStatus(f.actor, f.target.id, input as never)).rejects.toMatchObject({ code: "VALIDATION", status: 422 });
  }
  expect(JSON.stringify(await effects(f.admin.id, f.target.id)) === JSON.stringify(before)).toBe(true);
});

it("atomically suspends, revokes every native signed session and unused token, preserving one original reason only in its audit", async () => {
  const f = await setup(), first = await signedActor(f.target.id), second = await signedActor(f.target.id);
  const reset = await issueToken(f.target.id, "RESET_PASSWORD"), verification = await issueToken(f.target.id, "VERIFY_EMAIL");
  const input = command(), result = await changeAdminUserStatus(f.actor, f.target.id, input);
  expect(AdminUserStatusResultSchema.safeParse(result).success).toBe(true);
  expect(result).toMatchObject({ userId: f.target.id, active: false, statusVersion: 2, replayed: false });
  const state = await effects(f.admin.id, f.target.id);
  expect({ active: state.target.active, sessionVersion: state.target.sessionVersion, role: state.target.role, name: state.target.name }).toEqual({ active: false, sessionVersion: 2, role: "BRAND", name: f.target.name });
  expect(state.target.passwordHash === passwordHash).toBe(true);
  expect(state.sessions.length).toBe(2);
  expect(state.sessions.every(row => row.revokedAt !== null)).toBe(true);
  expect(state.tokens.length).toBe(2);
  expect(state.tokens.every(row => row.usedAt !== null)).toBe(true);
  expect(await resolveSession(first.token) === null).toBe(true); expect(await resolveSession(second.token) === null).toBe(true);
  expect(await authenticate(f.target.email, password) === null).toBe(true);
  expect(await consumeToken("RESET_PASSWORD", reset.value, password)).toBeNull();
  expect(await consumeToken("VERIFY_EMAIL", verification.value)).toBeNull();
  expect(state.receipts).toHaveLength(1);
  expect(state.receipts[0]).toMatchObject({ actorUserId: f.admin.id, resourceId: f.target.id, operationKey: input.operationKey, resultJson: result });
  expect(state.receipts[0].payloadHash).toMatch(/^[a-f0-9]{64}$/);
  expect(state.audits).toHaveLength(1); expect(state.events).toHaveLength(1);
  const envelope = { type: "account.suspended", actorUserId: f.admin.id, aggregateType: "User", aggregateId: f.target.id, aggregateVersion: 2, idempotencyKey: input.operationKey, occurredAt: result.appliedAt };
  expect(state.audits[0]).toMatchObject({ action: "account.suspended", resourceType: "User", resourceId: f.target.id, snapshot: { ...envelope, payload: { previousActive: true, active: false, reason: originalReason } } });
  expect(state.events[0]).toMatchObject({ deduplicationKey: `admin-status:${f.admin.id}:${input.operationKey}`, type: "account.suspended", status: "PENDING", attempts: 0, deliveredAt: null, payload: { ...envelope, payload: { previousActive: true, active: false } } });
  expect(Object.keys(state.events[0].payload as object).sort()).toEqual(["actorUserId", "aggregateId", "aggregateType", "aggregateVersion", "id", "idempotencyKey", "occurredAt", "payload", "type"]);
  expect(Object.keys((state.events[0].payload as { payload: object }).payload).sort()).toEqual(["active", "previousActive"]);
  expect(JSON.stringify(state.events[0].payload).includes(originalReason.text)).toBe(false);
  for (const secret of [passwordHash, first.actor.sessionId, reset.value, verification.value]) expect(JSON.stringify([state.audits[0].snapshot, state.events[0].payload, result]).includes(secret)).toBe(false);
});

it("reactivation advances the version, never revives old cookies or tokens, and permits a genuinely fresh login", async () => {
  const f = await setup(), old = await signedActor(f.target.id), reset = await issueToken(f.target.id, "RESET_PASSWORD");
  const suspended = await changeAdminUserStatus(f.actor, f.target.id, command());
  // Model a persisted stale session/token; activation must invalidate even these rows.
  await prisma.authSession.update({ where: { id: old.actor.sessionId }, data: { revokedAt: null } });
  await prisma.authToken.update({ where: { id: reset.id }, data: { usedAt: null } });
  const active = await changeAdminUserStatus(f.actor, f.target.id, command({ expectedActive: false, expectedVersion: suspended.statusVersion, active: true }));
  expect(active).toMatchObject({ active: true, statusVersion: 3, replayed: false });
  const state = await effects(f.admin.id, f.target.id);
  expect({ active: state.target.active, sessionVersion: state.target.sessionVersion }).toEqual({ active: true, sessionVersion: 3 });
  expect(state.sessions.every(row => row.revokedAt !== null)).toBe(true);
  expect(state.tokens.every(row => row.usedAt !== null)).toBe(true);
  expect(await resolveSession(old.token) === null).toBe(true);
  expect(await consumeToken("RESET_PASSWORD", reset.value, password)).toBeNull();
  expect(await openSession(f.target.id, 1, f.target.passwordHash).then(() => false, error => error instanceof Error && error.message === "Authentication invalidated")).toBe(true);
  const authenticated = await authenticate(f.target.email, password);
  expect(authenticated?.id).toBe(f.target.id);
  const fresh = await signedActor(f.target.id);
  const freshSession = await resolveSession(fresh.token);
  expect(freshSession ? { userId: freshSession.userId, sessionVersion: freshSession.sessionVersion } : null).toEqual({ userId: f.target.id, sessionVersion: 3 });
  expect(state.audits.map(row => row.action).sort()).toEqual(["account.reactivated", "account.suspended"]);
  expect(state.events.map(row => row.type).sort()).toEqual(["account.reactivated", "account.suspended"]);
  expect(state.events.every(row => row.status === "PENDING" && row.deliveredAt === null)).toBe(true);
});

it("returns the exact frozen receipt on replay after a later reactivation without applying it again", async () => {
  const f = await setup(), input = command(), first = await changeAdminUserStatus(f.actor, f.target.id, input);
  await changeAdminUserStatus(f.actor, f.target.id, command({ expectedActive: false, expectedVersion: 2, active: true }));
  const before = await effects(f.admin.id, f.target.id);
  const replay = await changeAdminUserStatus(f.actor, f.target.id, input);
  expect(replay).toEqual({ ...first, replayed: true });
  expect(JSON.stringify(await effects(f.admin.id, f.target.id)) === JSON.stringify(before)).toBe(true);
  expect({ active: before.target.active, sessionVersion: before.target.sessionVersion }).toEqual({ active: true, sessionVersion: 3 });
});

it("rejects changed reason or target under an existing actor operation key without modifying either account", async () => {
  const f = await setup(), second = await user(), input = command();
  await changeAdminUserStatus(f.actor, f.target.id, input);
  const before = await effects(f.admin.id, f.target.id), secondBefore = await effects(f.admin.id, second.id);
  await expect(changeAdminUserStatus(f.actor, f.target.id, { ...input, reason: { text: "A different original reason", language: "en" } })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
  await expect(changeAdminUserStatus(f.actor, second.id, input)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
  expect(JSON.stringify(await effects(f.admin.id, f.target.id)) === JSON.stringify(before)).toBe(true);
  expect(JSON.stringify(await effects(f.admin.id, second.id)) === JSON.stringify(secondBefore)).toBe(true);
});

it("rejects active-state ABA using the actual version even when the boolean again matches an old tab", async () => {
  const f = await setup();
  await changeAdminUserStatus(f.actor, f.target.id, command());
  await changeAdminUserStatus(f.actor, f.target.id, command({ expectedActive: false, expectedVersion: 2, active: true }));
  const before = await effects(f.admin.id, f.target.id);
  await expect(changeAdminUserStatus(f.actor, f.target.id, command())).rejects.toMatchObject({ code: "STALE_VERSION", status: 409 });
  await expect(changeAdminUserStatus(f.actor, f.target.id, command({ expectedActive: false, expectedVersion: 3, active: true }))).rejects.toMatchObject({ code: "STALE_VERSION", status: 409 });
  expect(JSON.stringify(await effects(f.admin.id, f.target.id)) === JSON.stringify(before)).toBe(true);
});

it("allows exactly one of two native tabs using the same observed target version", async () => {
  const f = await setup();
  const settled = await Promise.allSettled([changeAdminUserStatus(f.actor, f.target.id, command()), changeAdminUserStatus(f.actor, f.target.id, command({ reason: { text: "Second tab original", language: "en" } }))]);
  expect(settled.filter(row => row.status === "fulfilled")).toHaveLength(1);
  const rejected = settled.find(row => row.status === "rejected") as PromiseRejectedResult;
  expect(rejected.reason).toMatchObject({ code: "STALE_VERSION", status: 409 });
  const state = await effects(f.admin.id, f.target.id);
  expect({ active: state.target.active, sessionVersion: state.target.sessionVersion }).toEqual({ active: false, sessionVersion: 2 });
  expect(state.receipts).toHaveLength(1); expect(state.audits).toHaveLength(1); expect(state.events).toHaveLength(1);
});

it("concurrent identical retries produce one native receipt and one audit/event", async () => {
  const f = await setup(), input = command();
  const results = await Promise.all([changeAdminUserStatus(f.actor, f.target.id, input), changeAdminUserStatus(f.actor, f.target.id, input)]);
  expect(results.map(row => row.replayed).sort()).toEqual([false, true]);
  expect(results[0]).toEqual({ ...results[1], replayed: results[0].replayed });
  const state = await effects(f.admin.id, f.target.id);
  expect(state.target.sessionVersion).toBe(2);
  expect(state.receipts).toHaveLength(1); expect(state.audits).toHaveLength(1); expect(state.events).toHaveLength(1);
});

it("serializes a shared actor key across different native targets without leaving a second partial status change", async () => {
  const f = await setup(), second = await user(), input = command();
  const settled = await Promise.allSettled([changeAdminUserStatus(f.actor, f.target.id, input), changeAdminUserStatus(f.actor, second.id, input)]);
  expect(settled.filter(row => row.status === "fulfilled")).toHaveLength(1);
  expect((settled.find(row => row.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
  const firstState = await effects(f.admin.id, f.target.id), secondState = await effects(f.admin.id, second.id);
  expect([firstState.target.active, secondState.target.active].sort()).toEqual([false, true]);
  expect([firstState.target.sessionVersion, secondState.target.sessionVersion].sort()).toEqual([1, 2]);
  expect(firstState.receipts).toHaveLength(1); expect(firstState.events).toHaveLength(1);
  expect(firstState.audits.length + secondState.audits.length).toBe(1);
});

it("rolls back target status, sessions, tokens, receipt, audit and a natively inserted event if the final event operation fails", async () => {
  const f = await setup(); await signedActor(f.target.id); await issueToken(f.target.id, "RESET_PASSWORD");
  const before = await effects(f.admin.id, f.target.id);
  const client = prisma.$extends({ query: { outboxEvent: { async create({ args, query }) { await query(args); throw new Error("synthetic status outbox rollback"); } } } }) as unknown as PrismaClient;
  await expect(changeAdminUserStatus(f.actor, f.target.id, command(), { client })).rejects.toThrow("synthetic status outbox rollback");
  expect(JSON.stringify(await effects(f.admin.id, f.target.id)) === JSON.stringify(before)).toBe(true);
});

it("denies actual actor revocation during a native target lock wait before any status effects", async () => {
  const f = await setup(), peer = new PrismaClient(), held = latch(), release = latch(), before = await effects(f.admin.id, f.target.id);
  const holding = peer.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM "User" WHERE id=${f.target.id} FOR UPDATE`; held.release(); await release.promise; }, { timeout: 10000 });
  let writing: Promise<unknown> | undefined;
  try {
    await held.promise;
    writing = changeAdminUserStatus(f.actor, f.target.id, command()).then(() => ({ succeeded: true }), (error: { status: number }) => ({ succeeded: false, status: error.status }));
    await waitForTargetLock();
    await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { revokedAt: new Date() } });
    release.release(); await holding;
    expect(await writing).toMatchObject({ succeeded: false, status: 401 });
    expect(JSON.stringify(await effects(f.admin.id, f.target.id)) === JSON.stringify(before)).toBe(true);
    expect(await resolveSession(f.token) === null).toBe(true);
  } finally { release.release(); await holding; await writing; await peer.$disconnect(); }
});

it("rolls back even the natively created receipt if the real actor session expires before final authorization", async () => {
  const f = await setup(), entered = latch(), release = latch(), expiresAt = new Date(Date.now() + 1500);
  await signedActor(f.target.id); await issueToken(f.target.id, "VERIFY_EMAIL");
  await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { expiresAt } });
  const before = await effects(f.admin.id, f.target.id);
  const client = prisma.$extends({ query: { adminCommand: { async create({ args, query }) { const value = await query(args); entered.release(); await release.promise; return value; } } } }) as unknown as PrismaClient;
  const writing = changeAdminUserStatus(f.actor, f.target.id, command(), { client }).then(() => ({ succeeded: true }), (error: { status: number }) => ({ succeeded: false, status: error.status }));
  try {
    const reachedReceipt = await Promise.race([entered.promise.then(() => true), writing.then(() => false)]);
    expect(reachedReceipt).toBe(true);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 10)));
    release.release();
    expect(await writing).toMatchObject({ succeeded: false, status: 401 });
    expect(JSON.stringify(await effects(f.admin.id, f.target.id)) === JSON.stringify(before)).toBe(true);
  } finally { release.release(); await writing; }
});

it("withdraws genuinely accepted published owner proof after suspension without fabricating a review or changing saved history", async () => {
  const f = await fixture(2, "10001", { now: new Date(), target: "test" }), current = await signedActor(f.target.reviewerId);
  const saved = await prisma.creator.findUniqueOrThrow({ where: { id: f.target.id } });
  await prisma.portfolioVersion.create({ data: { creatorId: saved.id, version: 1, inputRevision: 1, approvedAt: new Date(), content: { title: "صفحة اختبار أصلية", bio: "سيرة اختبار أصلية", sections: [], method: "APPROVED_FACT_TEMPLATE" } } });
  const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.target.accountId } });
  const accepted = () => prisma.$transaction(tx => acceptedOwnershipProof(tx, account, f.target.userId, new Date()));
  expect(await accepted()).toBe(true);
  expect(await publicCreator(saved.handle)).not.toBeNull();
  const proofBefore = await prisma.ownershipChallenge.findMany({ where: { accountId: account.id }, orderBy: { id: "asc" } });
  await changeAdminUserStatus(current.actor, f.target.userId, command());
  expect(await accepted()).toBe(false);
  expect(await publicCreator(saved.handle)).toBeNull();
  expect(JSON.stringify(await prisma.ownershipChallenge.findMany({ where: { accountId: account.id }, orderBy: { id: "asc" } })) === JSON.stringify(proofBefore)).toBe(true);
  await expect(changeAdminUserStatus(current.actor, f.target.reviewerId, command())).rejects.toMatchObject({ code: "PROTECTED_ACCOUNT", status: 403 });
});
