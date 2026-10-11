// Candidate tests/ai-budget/native-session.test.ts. Exactly three native groups;
// root alone adopts/runs. Actual openSession/resolveSession, guarded PostgreSQL
// scheduling and owned synthetic accounting. No auth/time/SQL/provider mocks,
// JWT/session fixtures invented by the author, reset, private output or claims
// of provider/price/entitlement readiness. Existing tests are not imported.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { captureOrganizationActor } from "@/lib/organizations/context";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { AI_BUDGET_LOCK, createAiBudgetLedger } from "@/lib/ai-budget/ledger";
import { AiActorSchema, AiLedgerMetadataSchema, ReserveAiSchema, SettlementSchema, type AiActor } from "@/lib/ai-budget/contracts";

const users = new Set<string>(), clients = new Set<PrismaClient>(), key = () => randomUUID();
const day = new Date("2001-04-07T23:59:00.000Z"); // Accounting only, NEVER auth time.
const pricing = { version: "native-session-synthetic-v1", modelId: "synthetic-no-provider", asOf: "2001-04-01", currency: "USD" as const,
  prices: [{ unit: "REQUESTS" as const, quantity: "1", priceMicros: "5" }] };
const usage = [{ unit: "REQUESTS" as const, quantity: "2" }];
const caps = { userDailyMicros: "1000000", platformDailyMicros: "1000000000" };
function service(clock: () => Date = () => day, client: PrismaClient = prisma) { return createAiBudgetLedger({ client, now: clock, caps }); }
type Ledger = ReturnType<typeof service>;
function command(overrides: Record<string, unknown> = {}) {
  return { operationKey: key(), purpose: "CAMPAIGN_CHAT", payloadHash: createHash("sha256").update(key()).digest("hex"), reservedMicros: "100", pricing,
    context: { resourceType: "SYSTEM", resourceId: "native-session-accounting-only", sourceRevision: 1 }, executionTimeoutMs: 60000, ...overrides };
}
beforeAll(async () => {
  const taskId = process.env.INFAME_TASK_ID;
  if (!taskId || !/^infame_[a-f0-9]{12}$/.test(taskId) || process.env.INFAME_ENV !== "test" || process.env.NODE_ENV === "production") throw new Error("Native ledger fixtures require guarded test task");
  const rows = await prisma.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]?.id !== taskId || rows[0]?.kind !== "test" || rows[0]?.db !== taskId + "_test" || rows[0]?.host !== "127.0.0.1") throw new Error("Native ledger disposable identity mismatch");
});
afterEach(async () => {
  const rows = await prisma.aiReservation.findMany({ where: { userId: { in: [...users] } }, select: { id: true } });
  await prisma.adminAudit.deleteMany({ where: { OR: [{ actorUserId: { in: [...users] } }, { resourceType: "AI_RESERVATION", resourceId: { in: rows.map(row => row.id) } }] } });
  await prisma.aiReservation.deleteMany({ where: { userId: { in: [...users] } } });
  await prisma.user.deleteMany({ where: { id: { in: [...users] } } }); users.clear();
  for (const client of clients) await client.$disconnect(); clients.clear();
});
async function session(userId: string, prefix: "ALNUM" | "-" | "_" = "ALNUM") {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  // Genuine native producer only. All generated rows belong to this tracked
  // user and cascade during cleanup; tokens/session lists never enter output.
  for (let attempt = 0; attempt < (prefix === "ALNUM" ? 16 : 1024); attempt++) {
    const token = await openSession(user.id, user.sessionVersion, user.passwordHash), resolved = await resolveSession(token);
    if (!resolved) throw new Error("Native ledger session did not resolve");
    if (prefix === "ALNUM" ? /^[A-Za-z0-9]/.test(resolved.sessionId) : resolved.sessionId.startsWith(prefix)) return { token, actor: captureOrganizationActor(resolved) as AiActor };
  }
  throw new Error("Bounded genuine native session-prefix fixture unavailable");
}
async function fixture(role: AiActor["role"] = "BRAND") {
  const userId = key(); users.add(userId);
  await prisma.user.create({ data: { id: userId, role, active: true, isTest: true, name: "Synthetic native ledger actor", email: userId + "@example.invalid", passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  return { userId, ...await session(userId) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function observe(operation: () => Promise<unknown>) {
  try { await operation(); return { accepted: true, code: "ACCEPTED", status: 200 }; }
  catch (error) { const value = error as { code?: string; status?: number }; return { accepted: false, code: value.code ?? "OTHER_ERROR", status: value.status ?? 0 }; }
}
const unauthenticated = { accepted: false, code: "UNAUTHENTICATED", status: 401 };
const forbidden = { accepted: false, code: "FORBIDDEN", status: 403 };
function six(ledger: Ledger, actor: unknown, input = command(), id = "native-missing-reservation", malformed = true) {
  return [() => ledger.reserve(actor, malformed ? { unexpected: "bounded-malformed-command" } : input),
    () => ledger.read(actor), () => ledger.claim(actor, malformed ? "[" : id), () => ledger.releaseUnclaimed(actor, malformed ? "[" : id),
    () => ledger.reconcile(actor, malformed ? {} : { reservationId: id, reviewReference: "native-reviewed-reference", resolution: { kind: "NO_CHARGE" } }),
    () => ledger.resolveOverrun(actor, malformed ? {} : { reservationId: id, expectedActualMicros: "101", reviewReference: "native-overrun-reference" })];
}
async function image() {
  const rows = await prisma.aiReservation.findMany({ where: { userId: { in: [...users] } }, orderBy: { id: "asc" } });
  const audits = await prisma.adminAudit.findMany({ where: { OR: [{ actorUserId: { in: [...users] } }, { resourceType: "AI_RESERVATION", resourceId: { in: rows.map(row => row.id) } }] }, orderBy: { id: "asc" } });
  return createHash("sha256").update(JSON.stringify({ rows, audits }, (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value)).digest("hex");
}
async function running(owner: Fixture, ledger = service(), input = command()) {
  const reserved = await ledger.reserve(owner.actor, input), execution = await ledger.claim(owner.actor, reserved.reservation.id);
  return { ledger, input, reserved, execution, id: reserved.reservation.id };
}
async function unknown(owner: Fixture, ledger = service()) {
  const run = await running(owner, ledger);
  await ledger.quarantine(run.execution.executionToken, { reservationId: run.id, reason: "BILLING_UNCERTAIN" }); return run;
}
function latch() { let release!: () => void; return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() }; }
async function holder(kind: "ADVISORY" | "User" | "AuthSession" | "AiReservation" | "AiReservation_TABLE" | "AdminAudit_TABLE", id: string, commit: (tx: Prisma.TransactionClient) => Promise<void> = async () => {}) {
  const client = new PrismaClient(); clients.add(client); const ready = latch(), release = latch(); let pid = 0;
  const done = client.$transaction(async tx => {
    pid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`)[0]!.pid;
    if (kind === "ADVISORY") await tx.$queryRaw`SELECT pg_advisory_xact_lock(${AI_BUDGET_LOCK[0]}::int,${AI_BUDGET_LOCK[1]}::int)::text`;
    else if (kind === "AiReservation_TABLE") await tx.$executeRaw`LOCK TABLE "AiReservation" IN ACCESS EXCLUSIVE MODE`;
    else if (kind === "AdminAudit_TABLE") await tx.$executeRaw`LOCK TABLE "AdminAudit" IN ACCESS EXCLUSIVE MODE`;
    else await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw('"' + kind + '"')} WHERE id=${id} FOR UPDATE`);
    ready.release(); await release.promise; await commit(tx);
  }, { maxWait: 10000, timeout: 15000 });
  void done.catch(() => {}); await ready.promise;
  return { pid, release: release.release, done };
}
async function blockedBy(pid: number, queryFragment: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ pid: number }>>`SELECT a.pid::int AS pid FROM pg_stat_activity a WHERE a.datname=current_database() AND a.wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(a.pid)) AND a.query LIKE ${"%" + queryFragment + "%"}`;
    if (rows.length) return rows[0]!.pid;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Native ledger did not reach the required actual PostgreSQL wait");
}
async function holdsGlobal() {
  const probe = new PrismaClient(); clients.add(probe);
  const rows = await probe.$transaction(tx => tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(${AI_BUDGET_LOCK[0]}::int,${AI_BUDGET_LOCK[1]}::int) AS acquired`);
  expect(rows[0]?.acquired, "Waiting native User work retains global-first admission").toBe(false);
}
function assertNoSecrets(value: unknown, actors: Array<Pick<Fixture, "actor" | "token">>, executionTokens: string[] = []) {
  const encoded = JSON.stringify(value);
  for (const word of [...actors.flatMap(actor => [actor.actor.sessionId, actor.token]), ...executionTokens, "sessionId"]) expect(encoded.includes(word), "Native secret is absent from stored/public projection").toBe(false);
}

describe("AI ledger native interactive sessions", () => {
  it("denies all six methods before malformed input/old keys, accepts genuine native grammar and preserves exact accounting hashes after renewal", async () => {
    const ledger = service(), owner = await fixture(), initial = await image();
    const firstResults = [];
    for (const operation of six(ledger, undefined)) firstResults.push(await observe(operation));
    // FIRST meaningful baseline: pre-change Zod/generic403 errors cannot stand
    // in for the safe default401 required at every interactive boundary.
    expect(firstResults).toEqual(Array.from({ length: 6 }, () => unauthenticated)); expect(await image()).toBe(initial);
    const other = await fixture("CREATOR");
    const forged: unknown[] = [null, {}, { ...owner.actor, sessionId: key() }, { ...owner.actor, sessionId: randomBytes(32).toString("base64url") },
      { ...owner.actor, sessionId: other.actor.sessionId }, { ...owner.actor, sessionVersion: owner.actor.sessionVersion + 1 }, { ...owner.actor, role: "ADMIN" }, { ...owner.actor, userId: other.userId }];
    expect(AiActorSchema.safeParse({ ...owner.actor, sessionId: key() }).success, "UUID is not native session grammar").toBe(false);
    expect(AiActorSchema.safeParse({ ...owner.actor, sessionId: "a".repeat(42) }).success).toBe(false);
    expect(AiActorSchema.safeParse({ ...owner.actor, sessionId: "a".repeat(44) }).success).toBe(false);
    for (const actor of forged) for (const operation of six(ledger, actor)) expect(await observe(operation)).toEqual(unauthenticated);
    expect(await image()).toBe(initial);
    for (const role of ["BRAND", "CREATOR", "ADMIN"] as const) {
      const f = await fixture(role), input = command(), reserved = await ledger.reserve(f.actor, input), row = await prisma.aiReservation.findUniqueOrThrow({ where: { id: reserved.reservation.id } });
      expect(AiLedgerMetadataSchema.safeParse(row.result).success).toBe(true);
      const metadata = AiLedgerMetadataSchema.parse(row.result);
      expect(metadata.requestHash).toBe(canonicalHash(ReserveAiSchema.parse(input))); expect(metadata.actorRole).toBe(role); expect(metadata.actorSessionVersion).toBe(f.actor.sessionVersion);
      expect(canonicalHash(metadata.pricing)).toBe(canonicalHash(pricing)); expect(canonicalHash(metadata.context)).toBe(canonicalHash(input.context));
      expect(metadata.executionTimeoutMs).toBe(input.executionTimeoutMs); expect(metadata.executionTokenHash).toBeNull();
      assertNoSecrets(row.result, [f]); assertNoSecrets(await ledger.read(f.actor), [f]);
      await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { revokedAt: new Date() } }); expect(await resolveSession(f.token) === null).toBe(true);
      const before = await image(); for (const operation of six(ledger, f.actor, input, row.id, false)) expect(await observe(operation)).toEqual(unauthenticated); expect(await image()).toBe(before);
      const renewed = { userId: f.userId, ...await session(f.userId) };
      const replay = await ledger.reserve(renewed.actor, { context: input.context, pricing: input.pricing, purpose: input.purpose, operationKey: input.operationKey, payloadHash: input.payloadHash, reservedMicros: input.reservedMicros, executionTimeoutMs: input.executionTimeoutMs });
      expect(replay.replayed).toBe(true); expect(replay.reservation.id).toBe(row.id); expect(await image()).toBe(before);
      const execution = await ledger.claim(renewed.actor, row.id), settlement = { reservationId: row.id, actualMicros: "10", usage, pricing };
      expect(typeof execution.executionToken === "string" && /^[A-Za-z0-9_-]{43}$/.test(execution.executionToken)).toBe(true);
      await expect(ledger.claim(renewed.actor, row.id)).rejects.toMatchObject({ code: "EXECUTION_ALREADY_CLAIMED" });
      await ledger.settle(execution.executionToken, settlement); const terminal = await prisma.aiReservation.findUniqueOrThrow({ where: { id: row.id } }), terminalMeta = AiLedgerMetadataSchema.parse(terminal.result);
      expect(terminal.actualMicros).toBe(BigInt(10)); expect(terminalMeta.settlementHash).toBe(canonicalHash(SettlementSchema.parse(settlement))); expect(terminalMeta.requestHash).toBe(metadata.requestHash);
      assertNoSecrets(terminal.result, [f, renewed], [execution.executionToken]); assertNoSecrets(await ledger.read(renewed.actor), [f, renewed], [execution.executionToken]);
      await expect(ledger.settle(execution.executionToken, { ...settlement, actualMicros: "11" })).rejects.toMatchObject({ code: "SETTLEMENT_CONFLICT" });
    }
    for (const prefix of ["-", "_"] as const) {
      const native = { userId: owner.userId, ...await session(owner.userId, prefix) };
      expect(native.actor.sessionId.startsWith(prefix) && AiActorSchema.safeParse(native.actor).success).toBe(true);
      const dto = await ledger.read(native.actor); expect(dto.utcDay).toBe("2001-04-07"); assertNoSecrets(dto, [native]);
    }
    for (const operation of [() => ledger.reconcile(owner.actor, {}), () => ledger.resolveOverrun(other.actor, {})]) expect(await observe(operation)).toEqual(forbidden);
    const admin = await fixture("ADMIN"), uncertain = await unknown(owner, ledger), review = { reservationId: uncertain.id, reviewReference: "native-review-no-charge", resolution: { kind: "NO_CHARGE" } };
    const reviewed = await ledger.reconcile(admin.actor, review); expect(reviewed.replayed).toBe(false); expect(reviewed.reservation.status).toBe("RELEASED");
    const accepted = await image(); await prisma.authSession.update({ where: { id: admin.actor.sessionId }, data: { revokedAt: new Date() } });
    expect(await observe(() => ledger.reconcile(admin.actor, review))).toEqual(unauthenticated); expect(await image()).toBe(accepted);
    const adminRenewal = { userId: admin.userId, ...await session(admin.userId) }; expect((await ledger.reconcile(adminRenewal.actor, review)).replayed).toBe(true); expect(await image()).toBe(accepted);
    const overrun = await running(owner, ledger); await ledger.settle(overrun.execution.executionToken, { reservationId: overrun.id, actualMicros: "101", usage, pricing });
    const overrunReview = { reservationId: overrun.id, expectedActualMicros: "101", reviewReference: "native-overrun-reviewed" };
    expect((await ledger.read(other.actor)).blocked).toBe(true); expect(await observe(() => ledger.resolveOverrun(owner.actor, overrunReview))).toEqual(forbidden);
    await ledger.resolveOverrun(adminRenewal.actor, overrunReview); expect((await ledger.read(other.actor)).blocked).toBe(false);
    const audits = await prisma.adminAudit.findMany({ where: { resourceId: { in: [uncertain.id, overrun.id] } } }); expect(audits).toHaveLength(2); assertNoSecrets(audits, [owner, other, admin, adminRenewal]);
  }, 90000);

  it("retains original authority across real advisory/User/Session waits, locks complete ADMIN owners first and serializes logout through a blocked claim", async () => {
    const ledger = service();
    for (const kind of ["ADVISORY_CAPTURE", "USER_ABA", "SESSION_REVOKE", "ADMIN_OWNER_INVENTORY"] as const) {
      const owner = await fixture(), alternate = await fixture(), admin = kind === "ADMIN_OWNER_INVENTORY" ? await fixture("ADMIN") : undefined;
      const run = admin ? await unknown(owner, ledger) : undefined, input = command(), before = await image(), mutable: AiActor = { ...(admin?.actor ?? owner.actor) };
      const lock = kind === "ADVISORY_CAPTURE" ? "ADVISORY" : kind === "SESSION_REVOKE" ? "AuthSession" : "User";
      const held = await holder(lock, lock === "AuthSession" ? owner.actor.sessionId : owner.userId, async tx => {
        if (kind === "ADVISORY_CAPTURE" || kind === "SESSION_REVOKE") await tx.authSession.update({ where: { id: owner.actor.sessionId }, data: { revokedAt: new Date() } });
        if (kind === "USER_ABA") {
          await tx.user.update({ where: { id: owner.userId }, data: { active: false, role: "CREATOR", sessionVersion: { increment: 1 } } });
          await tx.user.update({ where: { id: owner.userId }, data: { active: true, role: "BRAND" } });
        }
      });
      let pending: Promise<Awaited<ReturnType<typeof observe>>> | undefined;
      try {
        pending = observe(() => kind === "SESSION_REVOKE" ? ledger.read(mutable) : admin && run ? ledger.reconcile(mutable, { reservationId: run.id, reviewReference: "native-wait-review", resolution: { kind: "NO_CHARGE" } }) : ledger.reserve(mutable, input));
        await blockedBy(held.pid, lock === "ADVISORY" ? "pg_advisory_xact_lock" : '"' + lock + '"');
        if (kind === "USER_ABA" || kind === "ADMIN_OWNER_INVENTORY") await holdsGlobal();
        if (kind === "ADVISORY_CAPTURE") Object.assign(mutable, alternate.actor); // No newly substituted native identity may be accepted after the first await.
        if (admin) await prisma.authSession.update({ where: { id: admin.actor.sessionId }, data: { revokedAt: new Date() } }); // Complete owner inventory must precede the exact actor Session lock.
        held.release(); await held.done; expect(await pending).toEqual(unauthenticated); expect(await image()).toBe(before);
      } finally { held.release(); await held.done; await pending; }
    }
    // UPDATE guards freeze reservation identity, but native DELETE/reinsert is
    // still legal. A captured owner must be rechecked after complete User locks;
    // discovering a replacement cannot add its new owner after Session admission.
    const originalOwner = await fixture(), replacementOwner = await fixture(), reviewer = await fixture("ADMIN");
    const replaced = await unknown(originalOwner, ledger), original = await prisma.aiReservation.findUniqueOrThrow({ where: { id: replaced.id } });
    const replacementImage = createHash("sha256").update(JSON.stringify({ ...original, userId: replacementOwner.userId },
      (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value)).digest("hex");
    const heldOriginal = await holder("User", originalOwner.userId, async tx => {
      await tx.aiReservation.delete({ where: { id: original.id } });
      await tx.aiReservation.create({ data: { ...original, userId: replacementOwner.userId, result: original.result as Prisma.InputJsonValue } });
    });
    const heldReplacement = await holder("User", replacementOwner.userId);
    let replacementReview: Promise<Awaited<ReturnType<typeof observe>>> | undefined;
    try {
      replacementReview = observe(() => ledger.reconcile(reviewer.actor, { reservationId: replaced.id, reviewReference: "native-replaced-owner-review", resolution: { kind: "NO_CHARGE" } }));
      await blockedBy(heldOriginal.pid, '"User"'); await holdsGlobal();
      heldOriginal.release(); await heldOriginal.done;
      // The replacement User remains locked until the result. Safe denial must
      // not acquire a new owner late or return the replacement's private DTO.
      expect(await replacementReview).toEqual({ accepted: false, code: "RETRY_REQUIRED", status: 503 });
      const retained = await prisma.aiReservation.findUniqueOrThrow({ where: { id: replaced.id } });
      const retainedImage = createHash("sha256").update(JSON.stringify(retained,
        (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value)).digest("hex");
      expect(retainedImage).toBe(replacementImage);
      expect(await prisma.adminAudit.count({ where: { resourceType: "AI_RESERVATION", resourceId: replaced.id } })).toBe(0);
    } finally {
      heldOriginal.release(); heldReplacement.release(); await heldOriginal.done; await heldReplacement.done; await replacementReview;
    }
    // A logout that starts AFTER the command's locked Session must wait through
    // its actual reservation wait. This is the valid serialized ordering, not
    // a claim that committed revocation can authorize new interactive work.
    const owner = await fixture(), reserved = await ledger.reserve(owner.actor, command()), held = await holder("AiReservation", reserved.reservation.id);
    let claim: ReturnType<Ledger["claim"]> | undefined, logout: Promise<unknown> | undefined;
    try {
      claim = ledger.claim(owner.actor, reserved.reservation.id); void claim.catch(() => {});
      const actorPid = await blockedBy(held.pid, '"AiReservation"');
      logout = prisma.authSession.update({ where: { id: owner.actor.sessionId }, data: { revokedAt: new Date() } }); void logout.catch(() => {});
      await blockedBy(actorPid, '"AuthSession"'); held.release(); await held.done;
      const execution = await claim; expect(/^[A-Za-z0-9_-]{43}$/.test(execution.executionToken)).toBe(true); await logout;
      expect(await resolveSession(owner.token) === null).toBe(true); expect(await observe(() => ledger.read(owner.actor))).toEqual(unauthenticated);
      await ledger.releaseKnownNoCall(execution.executionToken, { reservationId: execution.reservationId, reason: "FAILED_BEFORE_INVOCATION" });
    } finally { held.release(); await held.done; await claim?.catch(() => {}); await logout; }
  }, 90000);

  it("uses real expiry through private/reservation/audit waits, rolls back complete work and preserves durable quarantine plus exact trusted tokens after logout", async () => {
    const ledger = service();
    for (const kind of ["PRIVATE_READ", "CLAIM", "ADMIN_AUDIT"] as const) {
      const owner = await fixture(), admin = kind === "ADMIN_AUDIT" ? await fixture("ADMIN") : undefined;
      const run = admin ? await unknown(owner, ledger) : undefined;
      const reserved = kind === "CLAIM" ? await ledger.reserve(owner.actor, command()) : undefined;
      const actor = admin ?? owner, before = await image();
      const held = await holder(kind === "PRIVATE_READ" ? "AiReservation_TABLE" : kind === "ADMIN_AUDIT" ? "AdminAudit_TABLE" : "AiReservation", reserved?.reservation.id ?? "unused-table-lock-id");
      let pending: Promise<Awaited<ReturnType<typeof observe>>> | undefined;
      try {
        const expiresAt = new Date(Date.now() + 3000); await prisma.authSession.update({ where: { id: actor.actor.sessionId }, data: { expiresAt } });
        pending = observe(() => kind === "PRIVATE_READ" ? ledger.read(actor.actor) : kind === "CLAIM" && reserved ? ledger.claim(actor.actor, reserved.reservation.id)
          : ledger.reconcile(actor.actor, { reservationId: run!.id, reviewReference: "native-expiring-audit", resolution: { kind: "NO_CHARGE" } }));
        await blockedBy(held.pid, kind === "ADMIN_AUDIT" ? '"AdminAudit"' : '"AiReservation"'); expect(Date.now() < expiresAt.getTime()).toBe(true);
        await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 40)));
        held.release(); await held.done; expect(await pending).toEqual(unauthenticated); expect(await image()).toBe(before);
        expect(await resolveSession(actor.token) === null).toBe(true);
        if (reserved) expect((await prisma.aiReservation.findUniqueOrThrow({ where: { id: reserved.reservation.id } })).status).toBe("RESERVED");
        if (run) {
          expect((await prisma.aiReservation.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("UNKNOWN");
          expect(await prisma.adminAudit.count({ where: { resourceType: "AI_RESERVATION", resourceId: run.id } })).toBe(0);
        }
      } finally { held.release(); await held.done; await pending; }
    }
    // Durable timeout maintenance remains outside denied interactive command
    // writes/savepoint rollback. Only the billing status may change here.
    let accounting = new Date(day); const durable = service(() => accounting), owner = await fixture(), expiryInput = command({ executionTimeoutMs: 1000 });
    const expired = await running(owner, durable, expiryInput), noCall = await running(owner, durable), uncertain = await running(owner, durable);
    const original = await prisma.aiReservation.findUniqueOrThrow({ where: { id: expired.id } });
    accounting = new Date(day.getTime() + 2000); await prisma.authSession.update({ where: { id: owner.actor.sessionId }, data: { revokedAt: new Date() } });
    await prisma.user.update({ where: { id: owner.userId }, data: { active: false, sessionVersion: { increment: 1 } } });
    const attempt = command(); expect(await observe(() => durable.reserve(owner.actor, attempt))).toEqual(unauthenticated);
    const retained = await prisma.aiReservation.findUniqueOrThrow({ where: { id: expired.id } }), data = AiLedgerMetadataSchema.parse(retained.result), originalData = AiLedgerMetadataSchema.parse(original.result);
    expect(retained.status).toBe("UNKNOWN"); expect(data.quarantineReason).toBe("TIMEOUT"); expect(data.requestHash).toBe(originalData.requestHash); expect(data.executionTokenHash).toBe(originalData.executionTokenHash);
    expect(await prisma.aiReservation.count({ where: { userId: owner.userId, operationKey: attempt.operationKey } })).toBe(0);
    expect(await prisma.aiReservation.count({ where: { userId: owner.userId } })).toBe(3); expect(await prisma.adminAudit.count({ where: { actorUserId: owner.userId } })).toBe(0);
    const bill = { reservationId: expired.id, actualMicros: "10", usage, pricing };
    expect((await durable.settle(expired.execution.executionToken, bill)).replayed).toBe(false); expect((await durable.settle(expired.execution.executionToken, bill)).replayed).toBe(true);
    await expect(durable.settle(expired.execution.executionToken, { ...bill, actualMicros: "11" })).rejects.toMatchObject({ code: "SETTLEMENT_CONFLICT" });
    expect((await durable.releaseKnownNoCall(noCall.execution.executionToken, { reservationId: noCall.id, reason: "FAILED_BEFORE_INVOCATION" })).reservation.status).toBe("RELEASED");
    expect((await durable.quarantine(uncertain.execution.executionToken, { reservationId: uncertain.id, reason: "BILLING_UNCERTAIN" })).reservation.status).toBe("UNKNOWN");
    await expect(durable.releaseKnownNoCall(uncertain.execution.executionToken, { reservationId: uncertain.id, reason: "PROVIDER_CONFIRMED_NO_CALL" })).rejects.toMatchObject({ code: "RECONCILIATION_REQUIRED" });
    expect(await observe(() => durable.read(owner.actor))).toEqual(unauthenticated);
    const terminal = await prisma.aiReservation.findUniqueOrThrow({ where: { id: expired.id } }), terminalData = AiLedgerMetadataSchema.parse(terminal.result);
    expect(terminal.actualMicros).toBe(BigInt(10)); expect(terminalData.settlementHash).toBe(canonicalHash(SettlementSchema.parse(bill))); expect(terminalData.actorSessionVersion).toBe(owner.actor.sessionVersion);
    assertNoSecrets(terminal.result, [owner], [expired.execution.executionToken, noCall.execution.executionToken, uncertain.execution.executionToken]);
  }, 90000);
});
