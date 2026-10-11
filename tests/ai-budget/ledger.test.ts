import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { AI_BUDGET_LOCK, createAiBudgetLedger } from "@/lib/ai-budget/ledger";
import { AiPurposeSchema, type AiActor } from "@/lib/ai-budget/contracts";

// Synthetic billing records only, on the guarded disposable PostgreSQL target.
// No model calls, real prices, transcripts, keys or audio enter these fixtures.
const users: string[] = [];
const clients: PrismaClient[] = [];
const sessionTokens = new Map<string, string>();
const day = new Date("2091-04-07T23:59:00.000Z");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const pricing = { version: "synthetic-v1", modelId: "synthetic-model", asOf: "2091-04-01", currency: "USD", prices: [{ unit: "INPUT_TOKENS", quantity: "1000000", priceMicros: "2000000" }] };
const usage = [{ unit: "INPUT_TOKENS", quantity: "100" }];
const caps = { userDailyMicros: "1000", platformDailyMicros: "2000" };
async function actor(role: "BRAND" | "CREATOR" | "ADMIN" = "BRAND") {
  const userId = randomUUID(); users.push(userId);
  const user = await prisma.user.create({ data: { id: userId, name: "Synthetic AI ledger actor", email: `${userId}@example.invalid`, passwordHash: "not-a-login-hash", role, isTest: true, emailVerifiedAt: day } });
  const token = await openSession(user.id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Owned native AI ledger session failed to resolve");
  sessionTokens.set(userId, token);
  const captured: AiActor = { userId: session.userId, role: session.role, sessionVersion: session.sessionVersion, sessionId: session.sessionId };
  return Object.freeze(captured);
}
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
async function blockedByUser(blockerPid: number) {
  const deadline = performance.now() + 4000;
  while (performance.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock'
        AND ${blockerPid}=ANY(pg_blocking_pids(pid)) AND query LIKE '%"User"%FOR UPDATE%' ORDER BY pid`;
    if (rows.length) return rows[0]!.pid;
    await delay(10);
  }
  throw new Error("AI ledger operation did not reach its required owned User-row wait");
}
function command(overrides: Record<string, unknown> = {}) {
  return { operationKey: randomUUID(), purpose: "BRIEF", payloadHash: hash(randomUUID()), reservedMicros: "600", pricing, context: { resourceType: "CAMPAIGN", resourceId: "synthetic-campaign", sourceRevision: 1 }, executionTimeoutMs: 60000, ...overrides };
}
function ledger(client = prisma, now = () => day, limits = caps) { return createAiBudgetLedger({ client, now, caps: limits }); }
async function separateLedger(now = () => day, limits = caps) {
  const client = new PrismaClient(); clients.push(client); await client.$connect();
  return ledger(client, now, limits);
}
async function claimed(owner: Awaited<ReturnType<typeof actor>>, input = command(), service = ledger()) {
  const reservation = await service.reserve(owner, input);
  const execution = await service.claim(owner, reservation.reservation.id);
  return { reservation, execution, service };
}
afterEach(async () => {
  const ids = users.splice(0);
  const reservations = await prisma.aiReservation.findMany({ where: { userId: { in: ids } }, select: { id: true } });
  await prisma.adminAudit.deleteMany({ where: { resourceType: "AI_RESERVATION", resourceId: { in: reservations.map(row => row.id) } } });
  await prisma.aiReservation.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  for (const id of ids) sessionTokens.delete(id);
  await Promise.all(clients.splice(0).map(client => client.$disconnect()));
});

describe("durable, provider-neutral AI ledger on guarded PostgreSQL", () => {
  it("uses the same user/platform ledger for every documented billed purpose", async () => {
    const owner = await actor(), count = AiPurposeSchema.options.length;
    const service = ledger(prisma, () => day, { userDailyMicros: String(count), platformDailyMicros: String(count) });
    for (const purpose of AiPurposeSchema.options) await service.reserve(owner, command({ purpose, reservedMicros: "1" }));
    expect((await service.read(owner)).user.reservedMicros).toBe(String(count));
    await expect(service.reserve(owner, command({ purpose: "SPEECH", reservedMicros: "1" }))).rejects.toMatchObject({ code: "USER_BUDGET_EXHAUSTED" });
  });
  it("serializes independent connections at both user and shared platform caps", async () => {
    const owner = await actor(), other = await actor("CREATOR"), second = await separateLedger();
    const userResults = await Promise.allSettled([ledger().reserve(owner, command()), second.reserve(owner, command())]);
    expect(userResults.filter(row => row.status === "fulfilled")).toHaveLength(1);
    expect(userResults.find(row => row.status === "rejected")).toMatchObject({ reason: { code: "USER_BUDGET_EXHAUSTED" } });
    const platformLimits = { userDailyMicros: "5000", platformDailyMicros: "1500" };
    const platformResults = await Promise.allSettled([ledger(prisma, () => day, platformLimits).reserve(owner, command()), (await separateLedger(() => day, platformLimits)).reserve(other, command())]);
    expect(platformResults.filter(row => row.status === "fulfilled")).toHaveLength(1);
    expect(platformResults.find(row => row.status === "rejected")).toMatchObject({ reason: { code: "PLATFORM_BUDGET_EXHAUSTED" } });
    expect(await prisma.aiReservation.count({ where: { userId: { in: [owner.userId, other.userId] } } })).toBe(2);
  });
  it("acquires the global transaction lock before waiting for the current User row", async () => {
    const owner = await actor(), waiter = await separateLedger(), probe = new PrismaClient(); clients.push(probe);
    let release!: () => void, locked!: (pid: number) => void;
    const held = new Promise<number>(resolve => { locked = resolve; });
    const unblock = new Promise<void>(resolve => { release = resolve; });
    const blocker = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${owner.userId} FOR UPDATE`;
      const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
      locked(rows[0]!.pid); await unblock;
    }, { timeout: 10000 });
    const blockerPid = await held;
    const reservation = waiter.reserve(owner, command());
    void reservation.catch(() => {}); // Observe a regression rejection while probing the separate connection.
    try {
      // Ignore a preceding maintenance transaction. Observe this command's
      // exact User-row blocker before proving its global lock is already held.
      expect(await blockedByUser(blockerPid)).toBeGreaterThan(0);
      const result = await probe.$transaction(tx => tx.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(${AI_BUDGET_LOCK[0]}::int,${AI_BUDGET_LOCK[1]}::int) AS acquired`);
      expect(result[0]!.acquired).toBe(false);
    } finally { release(); await blocker; }
    await reservation;
  });
  it("replays only actor + operation + purpose + canonical payload and cannot issue execution twice", async () => {
    const owner = await actor(), input = command(), second = await separateLedger();
    const results = await Promise.all([ledger().reserve(owner, input), second.reserve(owner, input)]);
    expect(results[0].reservation.id).toBe(results[1].reservation.id);
    expect(results.filter(row => row.replayed)).toHaveLength(1);
    await expect(ledger().reserve(owner, { ...input, payloadHash: hash("changed") })).rejects.toMatchObject({ code: "REPLAY_CONFLICT" });
    await expect(ledger().reserve(owner, { ...input, purpose: "PORTFOLIO" })).rejects.toMatchObject({ code: "REPLAY_CONFLICT" });
    await expect(ledger().reserve(owner, { ...input, reservedMicros: "601" })).rejects.toMatchObject({ code: "REPLAY_CONFLICT" });
    const executions = await Promise.allSettled([ledger().claim(owner, results[0].reservation.id), second.claim(owner, results[0].reservation.id)]);
    expect(executions.filter(row => row.status === "fulfilled")).toHaveLength(1);
    expect(executions.find(row => row.status === "rejected")).toMatchObject({ reason: { code: "EXECUTION_ALREADY_CLAIMED" } });
    const execution = executions.find(row => row.status === "fulfilled");
    if (execution?.status !== "fulfilled") throw new Error("Missing synthetic execution");
    const stored = await prisma.aiReservation.findUniqueOrThrow({ where: { id: execution.value.reservationId } });
    expect(JSON.stringify(stored.result)).not.toContain(execution.value.executionToken);
    expect(JSON.stringify(await ledger().read(owner))).not.toContain("executionTokenHash");
  });
  it("rechecks suspended, changed-role, stale-version, revoked-session and expired-session actors", async () => {
    const owner = await actor(), input = command();
    const reserved = await ledger().reserve(owner, input);
    await prisma.user.update({ where: { id: owner.userId }, data: { sessionVersion: 2 } });
    await expect(ledger().claim(owner, reserved.reservation.id)).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    await expect(ledger().reserve(owner, input)).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    await prisma.user.update({ where: { id: owner.userId }, data: { sessionVersion: 1, role: "CREATOR" } });
    await expect(ledger().read(owner)).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    await prisma.user.update({ where: { id: owner.userId }, data: { role: "BRAND", active: false } });
    await expect(ledger().releaseUnclaimed(owner, reserved.reservation.id)).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    await prisma.user.update({ where: { id: owner.userId }, data: { active: true } });
    await prisma.authSession.update({ where: { id: owner.sessionId }, data: { revokedAt: new Date() } });
    await expect(ledger().read(owner)).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    await prisma.authSession.update({ where: { id: owner.sessionId }, data: { revokedAt: null, expiresAt: new Date(Date.now() - 1) } });
    await expect(ledger().reserve(owner, command())).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  });
  it("checks session expiry after waiting for the User lock instead of using an earlier timestamp", async () => {
    const owner = await actor(), service = await separateLedger(() => day);
    const expiresAt = new Date(Date.now() + 5000);
    await prisma.authSession.update({ where: { id: owner.sessionId }, data: { expiresAt } });
    const token = sessionTokens.get(owner.userId);
    if (!token) throw new Error("Owned native expiry session is unavailable");
    expect(await resolveSession(token) !== null).toBe(true);
    let release!: () => void, locked!: (pid: number) => void;
    const held = new Promise<number>(resolve => { locked = resolve; }), unblock = new Promise<void>(resolve => { release = resolve; });
    const blocker = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${owner.userId} FOR UPDATE`;
      const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
      locked(rows[0]!.pid); await unblock;
    }, { timeout: 10000 });
    const blockerPid = await held;
    const pending = service.reserve(owner, command()); void pending.catch(() => {});
    try {
      // The exact owned blocker proves this command has reached its User wait,
      // even when separate timeout maintenance first waits on the global lock.
      expect(await blockedByUser(blockerPid)).toBeGreaterThan(0);
      expect(Date.now() < expiresAt.getTime()).toBe(true);
      await delay(Math.max(0, expiresAt.getTime() - Date.now() + 40));
      expect(await resolveSession(token) === null).toBe(true);
    } finally { release(); await blocker; }
    await expect(pending).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    expect(await prisma.aiReservation.count({ where: { userId: owner.userId } })).toBe(0);
  });
  it("keeps pending and uncertain reservations across midnight and rejects a new-key rebill", async () => {
    const owner = await actor(); let clock = day;
    const service = ledger(prisma, () => clock), input = command();
    const run = await claimed(owner, input, service);
    await service.quarantine(run.execution.executionToken, { reservationId: run.execution.reservationId, reason: "BILLING_UNCERTAIN" });
    clock = new Date("2091-04-09T00:05:00.000Z");
    expect((await service.read(owner)).user.reservedMicros).toBe("600");
    await expect(service.reserve(owner, { ...input, operationKey: randomUUID() })).rejects.toMatchObject({ code: "RECONCILIATION_REQUIRED" });
    await expect(service.reserve(owner, command({ reservedMicros: "401" }))).rejects.toMatchObject({ code: "USER_BUDGET_EXHAUSTED" });
    await expect(service.releaseKnownNoCall(run.execution.executionToken, { reservationId: run.execution.reservationId, reason: "FAILED_BEFORE_INVOCATION" })).rejects.toMatchObject({ code: "RECONCILIATION_REQUIRED" });
    await expect(service.claim(owner, run.execution.reservationId)).rejects.toMatchObject({ code: "EXECUTION_ALREADY_CLAIMED" });
    const admin = await actor("ADMIN");
    await service.reconcile(admin, { reservationId: run.execution.reservationId, reviewReference: "synthetic-no-charge-review", resolution: { kind: "NO_CHARGE" } });
    expect((await service.read(owner)).user.reservedMicros).toBe("0");
    expect((await service.reserve(owner, { ...input, operationKey: randomUUID() })).reservation.status).toBe("RESERVED");
    expect(await prisma.adminAudit.count({ where: { resourceType: "AI_RESERVATION", resourceId: run.execution.reservationId } })).toBe(1);
  });
  it("quarantines an expired running attempt rather than permitting another execution", async () => {
    const owner = await actor(); let clock = day;
    const service = ledger(prisma, () => clock), input = command({ executionTimeoutMs: 1000 });
    const run = await claimed(owner, input, service);
    clock = new Date(day.getTime() + 1000);
    expect((await service.read(owner)).reservations[0].status).toBe("UNKNOWN");
    await expect(service.reserve(owner, { ...input, operationKey: randomUUID() })).rejects.toMatchObject({ code: "RECONCILIATION_REQUIRED" });
    await service.settle(run.execution.executionToken, { reservationId: run.execution.reservationId, actualMicros: "200", usage, pricing });
    expect((await service.read(owner)).user.usedMicros).toBe("200");
  });
  it("persists expired UNKNOWN billing even when the attempted new-key rebill is rejected", async () => {
    const owner = await actor(); let clock = day;
    const service = ledger(prisma, () => clock), input = command({ executionTimeoutMs: 1000 });
    const run = await claimed(owner, input, service); clock = new Date(day.getTime() + 1000);
    await expect(service.reserve(owner, { ...input, operationKey: randomUUID() })).rejects.toMatchObject({ code: "RECONCILIATION_REQUIRED" });
    expect((await prisma.aiReservation.findUniqueOrThrow({ where: { id: run.execution.reservationId } })).status).toBe("UNKNOWN");
    expect(await prisma.aiReservation.count({ where: { userId: owner.userId } })).toBe(1);
  });
  it("retains legitimate billing after suspension, settles once, and rejects forged or changed settlement", async () => {
    const owner = await actor(), run = await claimed(owner), second = await separateLedger();
    const settlement = { reservationId: run.execution.reservationId, actualMicros: "200", usage, pricing };
    await expect(run.service.settle("x".repeat(43), settlement)).rejects.toMatchObject({ code: "INVALID_EXECUTION_TOKEN" });
    await expect(run.service.settle(run.execution.executionToken, { ...settlement, transcript: "forbidden" })).rejects.toThrow();
    await expect(run.service.settle(run.execution.executionToken, { ...settlement, pricing: { ...pricing, apiKey: "forbidden" } })).rejects.toThrow();
    await prisma.user.update({ where: { id: owner.userId }, data: { active: false, sessionVersion: 2 } });
    const results = await Promise.all([run.service.settle(run.execution.executionToken, settlement), second.settle(run.execution.executionToken, settlement)]);
    expect(results.filter(row => row.replayed)).toHaveLength(1);
    await expect(run.service.read(owner)).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    await expect(run.service.settle(run.execution.executionToken, { ...settlement, actualMicros: "201" })).rejects.toMatchObject({ code: "SETTLEMENT_CONFLICT" });
    expect((await prisma.aiReservation.findUniqueOrThrow({ where: { id: run.execution.reservationId } })).actualMicros).toBe(BigInt(200));
  });
  it("releases only a known uninvoked attempt and never refunds settled usage", async () => {
    const owner = await actor(), unclaimed = await ledger().reserve(owner, command());
    await ledger().releaseUnclaimed(owner, unclaimed.reservation.id);
    await expect(ledger().claim(owner, unclaimed.reservation.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    const run = await claimed(owner);
    await expect(run.service.releaseUnclaimed(owner, run.execution.reservationId)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await run.service.releaseKnownNoCall(run.execution.executionToken, { reservationId: run.execution.reservationId, reason: "FAILED_BEFORE_INVOCATION" });
    expect((await run.service.read(owner)).user.reservedMicros).toBe("0");
    await expect(run.service.settle(run.execution.executionToken, { reservationId: run.execution.reservationId, actualMicros: "200", usage, pricing })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
  it("records an overrun exactly and blocks the entire platform until an audited current ADMIN resolution", async () => {
    const owner = await actor(), other = await actor(), admin = await actor("ADMIN"), run = await claimed(owner);
    await run.service.settle(run.execution.executionToken, { reservationId: run.execution.reservationId, actualMicros: "1200", usage, pricing });
    expect((await run.service.read(owner)).user.usedMicros).toBe("1200");
    expect((await run.service.read(other)).blocked).toBe(true);
    await expect(run.service.reserve(other, command({ reservedMicros: "1" }))).rejects.toMatchObject({ code: "OVERRUN_REVIEW_REQUIRED" });
    await expect(run.service.resolveOverrun(owner, { reservationId: run.execution.reservationId, expectedActualMicros: "1200", reviewReference: "synthetic-review" })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(run.service.resolveOverrun(admin, { reservationId: run.execution.reservationId, expectedActualMicros: "1199", reviewReference: "synthetic-review" })).rejects.toMatchObject({ code: "STALE_RECONCILIATION" });
    await prisma.user.update({ where: { id: admin.userId }, data: { active: false } });
    await expect(run.service.resolveOverrun(admin, { reservationId: run.execution.reservationId, expectedActualMicros: "1200", reviewReference: "synthetic-review" })).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    await prisma.user.update({ where: { id: admin.userId }, data: { active: true } });
    await run.service.resolveOverrun(admin, { reservationId: run.execution.reservationId, expectedActualMicros: "1200", reviewReference: "synthetic-review" });
    expect((await run.service.read(owner)).user.usedMicros).toBe("1200");
    expect((await run.service.reserve(other, command({ reservedMicros: "1" }))).reservation.status).toBe("RESERVED");
    await expect(run.service.reserve(owner, command({ reservedMicros: "1" }))).rejects.toMatchObject({ code: "USER_BUDGET_EXHAUSTED" });
    expect(await prisma.adminAudit.count({ where: { resourceType: "AI_RESERVATION", resourceId: run.execution.reservationId } })).toBe(1);
  });
  it("charges reconciled uncertain usage atomically and never resets an unresolved overrun at midnight", async () => {
    const owner = await actor(), admin = await actor("ADMIN"); let clock = day;
    const service = ledger(prisma, () => clock), run = await claimed(owner, command(), service);
    await service.quarantine(run.execution.executionToken, { reservationId: run.execution.reservationId, reason: "TIMEOUT" });
    await service.reconcile(admin, { reservationId: run.execution.reservationId, reviewReference: "synthetic-invoice-review", resolution: { kind: "CHARGE", actualMicros: "700", usage, pricing } });
    clock = new Date("2091-04-09T00:05:00.000Z");
    expect((await service.read(owner)).user.usedMicros).toBe("0");
    expect((await service.read(owner)).blocked).toBe(true);
    await expect(service.reserve(owner, command())).rejects.toMatchObject({ code: "OVERRUN_REVIEW_REQUIRED" });
    expect((await prisma.aiReservation.findUniqueOrThrow({ where: { id: run.execution.reservationId } })).actualMicros).toBe(BigInt(700));
  });
  it("counts settlement on its actual UTC settlement day, not its reservation day", async () => {
    const owner = await actor(); let clock = day;
    const service = ledger(prisma, () => clock), run = await claimed(owner, command(), service);
    clock = new Date("2091-04-08T00:00:00.000Z");
    await service.settle(run.execution.executionToken, { reservationId: run.execution.reservationId, actualMicros: "200", usage, pricing });
    const budget = await service.read(owner);
    expect(budget.utcDay).toBe("2091-04-08"); expect(budget.user.usedMicros).toBe("200"); expect(budget.user.reservedMicros).toBe("0");
  });
  it("uses exact large-integer amounts and rejects owner impersonation and unbounded payload metadata", async () => {
    const owner = await actor(), other = await actor(), max = "9223372036854775807";
    const service = ledger(prisma, () => day, { userDailyMicros: max, platformDailyMicros: max });
    const reservation = await service.reserve(owner, command({ reservedMicros: "9007199254740993" }));
    expect((await service.read(owner)).user.remainingMicros).toBe((BigInt(max) - BigInt("9007199254740993")).toString());
    await expect(service.claim(other, reservation.reservation.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const override of [{ reservedMicros: "9223372036854775808" }, { purpose: "UNKNOWN" }, { transcript: "forbidden" }, { audio: "forbidden" }, { context: { resourceType: "CAMPAIGN", resourceId: "safe", providerKey: "forbidden" } }, { payloadHash: "raw conversation" }, { executionTimeoutMs: 3600000 }]) {
      await expect(service.reserve(owner, command(override))).rejects.toThrow();
    }
    const execution = await service.claim(owner, reservation.reservation.id);
    await service.settle(execution.executionToken, { reservationId: execution.reservationId, actualMicros: "9007199254740993", usage, pricing });
    expect((await service.read(owner)).user.usedMicros).toBe("9007199254740993");
  });
  it("retains a valid actual charge even if its exact usage estimate exceeds the database amount range", async () => {
    const owner = await actor(), max = "9223372036854775807";
    const hugePricing = { ...pricing, prices: [{ unit: "INPUT_TOKENS", quantity: "1", priceMicros: max }] };
    const run = await claimed(owner, command({ pricing: hugePricing }));
    await run.service.settle(run.execution.executionToken, { reservationId: run.execution.reservationId, actualMicros: "200", usage: [{ unit: "INPUT_TOKENS", quantity: max }], pricing: hugePricing });
    const row = await prisma.aiReservation.findUniqueOrThrow({ where: { id: run.execution.reservationId } });
    expect(row.actualMicros).toBe(BigInt(200));
    expect(row.result).toMatchObject({ estimatedActualMicros: (BigInt(max) * BigInt(max)).toString() });
  });
  it("rejects oversized immutable claim corruption in PostgreSQL and retains a readable clean record", async () => {
    const owner = await actor(), run = await claimed(owner);
    const row = await prisma.aiReservation.findUniqueOrThrow({ where: { id: run.execution.reservationId } });
    await expect(prisma.aiReservation.update({ where: { id: row.id }, data: { result: { ...(row.result as object), claimedAt: `2091-04-07T23:59:00.${"0".repeat(10000)}Z` } } })).rejects.toThrow();
    expect((await prisma.aiReservation.findUniqueOrThrow({ where: { id: row.id } })).result).toEqual(row.result);
    expect((await run.service.read(owner)).reservations[0].status).toBe("RUNNING");
  });
});
