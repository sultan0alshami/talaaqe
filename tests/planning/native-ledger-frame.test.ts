// Ignored S0 candidate, exactly three native groups. Root alone adopts/runs.
// Genuine native sessions and guarded PostgreSQL waits; no provider, permission
// fixture, auth/SQL mock, reset or publication. Inventories grant coverage only.
import { createHash, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { captureOrganizationActor } from "@/lib/organizations/context";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { AI_BUDGET_LOCK, createAiBudgetLedger, readAiPlanningNativeFrame, type AiPlanningNativeFrame } from "@/lib/ai-budget/ledger";
import { AiLedgerMetadataSchema, ReserveAiSchema, type AiActor } from "@/lib/ai-budget/contracts";

const users = new Set<string>(), clients = new Set<PrismaClient>(), tokens = new Map<string, string>();
const day = new Date("2001-04-07T23:59:00.000Z"); // Accounting only, never native auth.
const pricing = { version: "native-frame-synthetic-v1", modelId: "synthetic-no-provider", asOf: "2001-04-01", currency: "USD" as const,
  prices: [{ unit: "REQUESTS" as const, quantity: "1", priceMicros: "5" }] };
function ledger(clock: () => Date = () => day) {
  return createAiBudgetLedger({ now: clock, caps: { userDailyMicros: "1000000", platformDailyMicros: "1000000000" } });
}
function command(timeout = 60000) {
  return { operationKey: randomUUID(), purpose: "CAMPAIGN_CHAT" as const, payloadHash: createHash("sha256").update(randomUUID()).digest("hex"),
    reservedMicros: "100", pricing, context: { resourceType: "SYSTEM" as const, resourceId: "native-frame-accounting-only", sourceRevision: 1 }, executionTimeoutMs: timeout };
}
async function nativeSession(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const token = await openSession(user.id, user.sessionVersion, user.passwordHash), resolved = await resolveSession(token);
  if (!resolved) throw new Error("Owned native frame session failed to resolve");
  return { token, actor: captureOrganizationActor(resolved) as AiActor };
}
async function fixture(role: AiActor["role"] = "BRAND") {
  const userId = randomUUID(); users.add(userId);
  await prisma.user.create({ data: { id: userId, role, active: true, isTest: true, name: "Synthetic native frame actor",
    email: userId + "@example.invalid", passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  return { userId, ...await nativeSession(userId) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type FrameView = Awaited<ReturnType<typeof readAiPlanningNativeFrame>>;
const emptyInventory = async () => ({ ownerIds: [] as string[], reviewerIds: [] as string[] });
const unauthorized = { accepted: false, code: "UNAUTHENTICATED", status: 401 };
const forbidden = { accepted: false, code: "FORBIDDEN", status: 403 };
const unavailable = { accepted: false, code: "PLANNING_FRAME_UNAVAILABLE", status: 503 };
async function observe(operation: () => Promise<unknown>) {
  try { await operation(); return { accepted: true, code: "ACCEPTED", status: 200 }; }
  catch (error) { const value = error as { code?: string; status?: number }; return { accepted: false, code: value.code ?? "OTHER_ERROR", status: value.status ?? 0 }; }
}
function latch() { let release!: () => void; return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() }; }
async function image() {
  const rows = await prisma.aiReservation.findMany({ where: { userId: { in: [...users] } }, orderBy: { id: "asc" } });
  const audits = await prisma.adminAudit.findMany({ where: { resourceType: "AI_RESERVATION", resourceId: { in: rows.map(row => row.id) } }, orderBy: { id: "asc" } });
  return createHash("sha256").update(JSON.stringify({ rows, audits }, (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value)).digest("hex");
}
function noCredentials(value: unknown, actors: Fixture[], execution: string[] = []) {
  const encoded = JSON.stringify(value);
  for (const secret of [...actors.flatMap(actor => [actor.token, actor.actor.sessionId]), ...execution])
    expect(encoded.includes(secret), "Native credentials stay out of projections").toBe(false);
  for (const field of ["executionToken", "sessionId"]) expect(encoded.includes('"' + field + '"')).toBe(false);
}
async function holder(kind: "ADVISORY" | "User" | "AuthSession" | "AiReservation", id: string,
  commit: (tx: Prisma.TransactionClient) => Promise<void> = async () => {}) {
  const client = new PrismaClient(); clients.add(client); const ready = latch(), unblock = latch(); let pid = 0;
  const done = client.$transaction(async tx => {
    pid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`)[0]!.pid;
    if (kind === "ADVISORY") await tx.$queryRaw`SELECT pg_advisory_xact_lock(${AI_BUDGET_LOCK[0]}::int,${AI_BUDGET_LOCK[1]}::int)::text`;
    else await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw('"' + kind + '"')} WHERE id=${id} FOR UPDATE`);
    ready.release(); await unblock.promise; await commit(tx);
  }, { maxWait: 10000, timeout: 15000 });
  void done.catch(() => {}); await ready.promise;
  return { pid, release: unblock.release, done };
}
async function blockedBy(pid: number, fragment: string) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const rows = await prisma.$queryRaw<Array<{ pid: number }>>`SELECT a.pid::int AS pid FROM pg_stat_activity a WHERE a.datname=current_database() AND a.wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(a.pid)) AND a.query LIKE ${"%" + fragment + "%"}`;
    if (rows.length) return rows[0]!.pid;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Native frame did not reach its required actual PostgreSQL wait");
}
async function globalHeld() {
  const probe = new PrismaClient(); clients.add(probe);
  const rows = await probe.$transaction(tx => tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(${AI_BUDGET_LOCK[0]}::int,${AI_BUDGET_LOCK[1]}::int) AS acquired`);
  expect(rows[0]?.acquired).toBe(false);
}
async function rowFree(table: "User" | "AuthSession", id: string) {
  const probe = new PrismaClient(); clients.add(probe);
  try {
    const rows = await probe.$transaction(tx => tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM ${Prisma.raw('"' + table + '"')} WHERE id=${id} FOR UPDATE NOWAIT`));
    if (rows.length !== 1) throw new Error("Owned native lock probe lost its fixture");
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010" && String(error.meta?.code) === "55P03") return false;
    throw error;
  }
}
async function closed(frame: AiPlanningNativeFrame, view: FrameView, service = ledger()) {
  expect(await observe(() => readAiPlanningNativeFrame(frame))).toEqual(unavailable);
  expect(await observe(() => view.assertCurrent())).toEqual(unavailable);
  expect(await observe(() => service.reserveAndClaimInFrame(frame, { unexpected: "closed-frame-input" }))).toEqual(unavailable);
  expect(await observe(() => view.tx.user.findUnique({ where: { id: view.actor.userId }, select: { id: true } }))).toEqual(unavailable);
}

beforeAll(async () => {
  const taskId = process.env.INFAME_TASK_ID;
  if (!taskId || !/^infame_[a-f0-9]{12}$/.test(taskId) || process.env.INFAME_ENV !== "test" || process.env.NODE_ENV === "production") throw new Error("Native frame fixtures require guarded test task");
  const rows = await prisma.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]?.id !== taskId || rows[0]?.kind !== "test" || rows[0]?.db !== taskId + "_test" || rows[0]?.host !== "127.0.0.1") throw new Error("Native frame disposable target mismatch");
});
afterEach(async () => {
  const service = ledger(), rows = await prisma.aiReservation.findMany({ where: { userId: { in: [...users] } } }); let admin: Fixture | undefined;
  for (const row of rows) {
    if (row.status === "RESERVED") await service.releaseUnclaimed((await nativeSession(row.userId)).actor, row.id);
    if (row.status === "RUNNING") {
      const token = tokens.get(row.id);
      if (!token) throw new Error("Owned unresolved frame claim lacks cleanup credential");
      await service.releaseKnownNoCall(token, { reservationId: row.id, reason: "FAILED_BEFORE_INVOCATION" });
    }
    if (row.status === "UNKNOWN") {
      admin ??= await fixture("ADMIN");
      await service.reconcile(admin.actor, { reservationId: row.id, reviewReference: "synthetic-frame-fixture-cleanup", resolution: { kind: "NO_CHARGE" } });
    }
  }
  const terminal = await prisma.aiReservation.findMany({ where: { userId: { in: [...users] } }, select: { id: true, status: true } });
  if (terminal.some(row => row.status !== "SETTLED" && row.status !== "RELEASED")) throw new Error("Native frame cleanup refuses unresolved rows");
  await prisma.adminAudit.deleteMany({ where: { resourceType: "AI_RESERVATION", resourceId: { in: terminal.map(row => row.id) }, actorUserId: { in: [...users] } } });
  await prisma.aiReservation.deleteMany({ where: { id: { in: terminal.map(row => row.id) }, userId: { in: [...users] } } });
  await prisma.authSession.deleteMany({ where: { userId: { in: [...users] } } });
  await prisma.user.deleteMany({ where: { id: { in: [...users] } } }); users.clear(); tokens.clear();
  for (const client of clients) await client.$disconnect(); clients.clear();
});

describe("S0 issuer-owned native accounting frame", () => {
  it("mints only a genuine current BRAND frame, authenticates before inventory and rejects forged, copied, missing-owner and wrong-factory frames", async () => {
    const service = ledger(), owner = await fixture(), initial = await image();
    expect((await resolveSession(owner.token))?.userId).toBe(owner.userId);
    let savedFrame!: AiPlanningNativeFrame, savedView!: FrameView;
    // First baseline: a real valid native fixture reaches the absent S0 method.
    const valid = await service.withPlanningActorTransaction(owner.actor, emptyInventory, async frame => {
      savedFrame = frame; savedView = await readAiPlanningNativeFrame(frame);
      expect(savedView.actor.userId).toBe(owner.userId); expect(savedView.actor.role).toBe(owner.actor.role);
      expect(savedView.actor.sessionVersion).toBe(owner.actor.sessionVersion); expect(savedView.actor.sessionId === owner.actor.sessionId).toBe(true);
      expect(savedView.ownerIds).toEqual([owner.userId]); expect(savedView.reviewerIds).toEqual([]);
      expect(Object.isFrozen(frame) && Reflect.ownKeys(frame).length === 0).toBe(true);
      expect(Object.isFrozen(savedView.ownerIds) && Object.isFrozen(savedView.reviewerIds)).toBe(true);
      await savedView.assertCurrent();
      for (const forged of [{}, { ...frame }, Object.freeze({ globalHeld: true, actor: owner.actor })]) {
        expect(await observe(() => readAiPlanningNativeFrame(forged))).toEqual(unavailable);
        expect(await observe(() => service.reserveAndClaimInFrame(forged as AiPlanningNativeFrame, {}))).toEqual(unavailable);
      }
      expect(await observe(() => ledger().reserveAndClaimInFrame(frame, {}))).toEqual(unavailable);
      return { nativeBound: true };
    });
    expect(valid.executionClaim === null).toBe(true); noCredentials(valid.value, [owner]);
    expect(valid.value).toEqual({ nativeBound: true }); expect(await image()).toBe(initial);
    await closed(savedFrame, savedView, service);
    for (const input of [undefined, null, { ...owner.actor, sessionId: randomUUID() }, { ...owner.actor, sessionVersion: owner.actor.sessionVersion + 1 }]) {
      let inventoryCalls = 0, workCalls = 0;
      expect(await observe(() => service.withPlanningActorTransaction(input, async () => { inventoryCalls++; return { ownerIds: [], reviewerIds: [] }; }, async frame => {
        workCalls++; return service.reserveAndClaimInFrame(frame, {});
      }))).toEqual(unauthorized);
      expect([inventoryCalls, workCalls]).toEqual([0, 0]);
    }
    const deniedRoles = new Map<"CREATOR" | "ADMIN", Fixture>();
    for (const role of ["CREATOR", "ADMIN"] as const) {
      const f = await fixture(role); deniedRoles.set(role, f); let inventoryCalls = 0;
      expect(await observe(() => service.withPlanningActorTransaction(f.actor, async () => { inventoryCalls++; return { ownerIds: [], reviewerIds: [] }; }, async () => true))).toEqual(forbidden);
      expect(inventoryCalls).toBe(0);
    }
    let expired!: Fixture;
    for (const state of ["INACTIVE", "EXPIRED"] as const) {
      const f = await fixture(); let inventoryCalls = 0;
      if (state === "INACTIVE") await prisma.user.update({ where: { id: f.userId }, data: { active: false } });
      else { await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } }); expired = f; }
      expect(await observe(() => service.withPlanningActorTransaction(f.actor, async () => { inventoryCalls++; return { ownerIds: [], reviewerIds: [] }; }, async () => true))).toEqual(unauthorized);
      expect(inventoryCalls).toBe(0);
    }
    for (const inventory of [{ ownerIds: [randomUUID()], reviewerIds: [] }, { ownerIds: [], reviewerIds: [randomUUID()] }]) {
      let called = false;
      expect(await observe(() => service.withPlanningActorTransaction(owner.actor, async () => inventory, async () => { called = true; return true; })))
        .toEqual({ accepted: false, code: "RETRY_REQUIRED", status: 503 });
      expect(called).toBe(false);
    }
    expect(await image()).toBe(initial);
    // The native guard deliberately leaves reconciliation mutable. A malformed
    // owned value makes real standalone maintenance fail; role/auth precedence
    // must still hold before the trusted inventory callback is invoked.
    const poisonInput = command(), poisonReserved = await service.reserve(owner.actor, poisonInput);
    const poisonClaim = await service.claim(owner.actor, poisonReserved.reservation.id); tokens.set(poisonClaim.reservationId, poisonClaim.executionToken);
    const poisonRow = await prisma.aiReservation.findUniqueOrThrow({ where: { id: poisonClaim.reservationId } });
    expect(AiLedgerMetadataSchema.parse(poisonRow.result).reconciliation === null).toBe(true);
    try {
      expect(await prisma.$executeRaw`UPDATE "AiReservation" SET result=jsonb_set(result,'{reconciliation}','{}'::jsonb,false) WHERE id=${poisonClaim.reservationId}`).toBe(1);
      const invalid = expired, creator = deniedRoles.get("CREATOR")!, administrator = deniedRoles.get("ADMIN")!;
      for (const test of [{ actor: creator.actor, expected: forbidden }, { actor: administrator.actor, expected: forbidden },
        { actor: owner.actor, expected: { accepted: false, code: "LEDGER_REVIEW_REQUIRED", status: 400 } }, { actor: invalid.actor, expected: unauthorized }]) {
        let inventoryCalls = 0, workCalls = 0;
        expect(await observe(() => service.withPlanningActorTransaction(test.actor,
          async () => { inventoryCalls++; return { ownerIds: [], reviewerIds: [] }; }, async () => { workCalls++; return true; }))).toEqual(test.expected);
        expect([inventoryCalls, workCalls]).toEqual([0, 0]);
      }
    } finally {
      await prisma.$executeRaw`UPDATE "AiReservation" SET result=jsonb_set(result,'{reconciliation}','null'::jsonb,false) WHERE id=${poisonClaim.reservationId}`;
      await service.releaseKnownNoCall(poisonClaim.executionToken, { reservationId: poisonClaim.reservationId, reason: "FAILED_BEFORE_INVOCATION" });
    }
  }, 45000);

  it("holds actual global then complete owner/reviewer locks before Session and preserves captured actor and inventory across real waits", async () => {
    const service = ledger(), original = await fixture(), replacement = await fixture(), mutable: AiActor = { ...original.actor };
    const advisory = await holder("ADVISORY", "unused", async tx => { await tx.authSession.update({ where: { id: original.actor.sessionId }, data: { revokedAt: new Date() } }); });
    let pending: Promise<Awaited<ReturnType<typeof observe>>> | undefined, inventoryCalls = 0;
    try {
      pending = observe(() => service.withPlanningActorTransaction(mutable, async () => { inventoryCalls++; return { ownerIds: [], reviewerIds: [] }; }, async () => true));
      await blockedBy(advisory.pid, "pg_advisory_xact_lock"); expect(inventoryCalls).toBe(0);
      Object.assign(mutable, replacement.actor); advisory.release(); await advisory.done;
      expect(await pending).toEqual(unauthorized); expect(inventoryCalls).toBe(0);
    } finally { advisory.release(); await advisory.done; await pending; }
    for (const stage of ["OWNER", "REVIEWER"] as const) {
      const owner = await fixture(), extraOwner = await fixture(), reviewer = await fixture(), alternate = await fixture();
      const ownerIds = [extraOwner.userId], reviewerIds = [owner.userId, reviewer.userId];
      const held = await holder("User", stage === "OWNER" ? extraOwner.userId : reviewer.userId);
      let run: Promise<{ value: { captured: boolean }; executionClaim: unknown }> | undefined, workCalls = 0;
      try {
        run = service.withPlanningActorTransaction(owner.actor, async () => ({ ownerIds, reviewerIds }), async frame => {
          workCalls++; const view = await readAiPlanningNativeFrame(frame);
          expect(view.ownerIds).toEqual([owner.userId, extraOwner.userId].sort()); expect(view.reviewerIds).toEqual([reviewer.userId]);
          expect(view.ownerIds.includes(alternate.userId) || view.reviewerIds.includes(alternate.userId)).toBe(false);
          return { captured: true };
        }); void run.catch(() => {});
        await blockedBy(held.pid, '"User"'); await globalHeld(); expect(workCalls).toBe(0);
        expect(await rowFree("AuthSession", owner.actor.sessionId)).toBe(true);
        if (stage === "REVIEWER") expect(await rowFree("User", owner.userId)).toBe(false);
        ownerIds.splice(0, ownerIds.length, alternate.userId); reviewerIds.splice(0, reviewerIds.length, alternate.userId);
        held.release(); await held.done;
        const completedRun = await run;
        expect(completedRun.executionClaim === null).toBe(true); noCredentials(completedRun.value, [owner]);
        expect(completedRun.value).toEqual({ captured: true }); expect(workCalls).toBe(1);
      } finally { held.release(); await held.done; await run?.catch(() => {}); }
    }
    const owner = await fixture(), heldSession = await holder("AuthSession", owner.actor.sessionId, async tx => {
      await tx.authSession.update({ where: { id: owner.actor.sessionId }, data: { revokedAt: new Date() } });
    }); let waiting: Promise<Awaited<ReturnType<typeof observe>>> | undefined, workCalls = 0;
    try {
      waiting = observe(() => service.withPlanningActorTransaction(owner.actor, emptyInventory, async () => { workCalls++; return true; }));
      await blockedBy(heldSession.pid, '"AuthSession"'); await globalHeld(); expect(await rowFree("User", owner.userId)).toBe(false);
      heldSession.release(); await heldSession.done; expect(await waiting).toEqual(unauthorized); expect(workCalls).toBe(0);
    } finally { heldSession.release(); await heldSession.done; await waiting; }
    expect(await prisma.aiReservation.count({ where: { userId: { in: [...users] } } })).toBe(0);
  }, 60000);

  it("escrows one exact claim until COMMIT, never reissues replay tokens and invalidates callback frames on success, rollback and real expiry while maintenance survives", async () => {
    const service = ledger(), owner = await fixture(), admin = await fixture("ADMIN"), input = command(), ready = latch(), unblock = latch();
    let savedFrame!: AiPlanningNativeFrame, savedView!: FrameView, inWork: unknown, completed = false;
    const pending = service.withPlanningActorTransaction(owner.actor, emptyInventory, async frame => {
      savedFrame = frame; savedView = await readAiPlanningNativeFrame(frame);
      inWork = await service.reserveAndClaimInFrame(frame, input);
      noCredentials(inWork, [owner]); expect(inWork).toMatchObject({ replayed: false, claimPending: true });
      const secondInput = command();
      expect(await observe(() => service.reserveAndClaimInFrame(frame, secondInput))).toEqual({ accepted: false, code: "PLANNING_CLAIM_ALREADY_PENDING", status: 409 });
      expect(await savedView.tx.aiReservation.count({ where: { userId: owner.userId, operationKey: secondInput.operationKey } })).toBe(0);
      ready.release(); await unblock.promise; return inWork;
    }).then(value => { completed = true; return value; }, error => { ready.release(); throw error; }); void pending.catch(() => {});
    let result!: Awaited<typeof pending>;
    try {
      await ready.promise; expect(completed).toBe(false);
      expect(await prisma.aiReservation.count({ where: { userId: owner.userId, operationKey: input.operationKey } })).toBe(0);
      unblock.release(); result = await pending;
    } finally { unblock.release(); await pending.catch(() => {}); }
    if (result.executionClaim) tokens.set(result.executionClaim.reservationId, result.executionClaim.executionToken);
    expect(result.executionClaim !== null).toBe(true);
    const claim = result.executionClaim!;
    expect(/^[A-Za-z0-9_-]{43}$/.test(claim.executionToken)).toBe(true);
    const row = await prisma.aiReservation.findUniqueOrThrow({ where: { id: claim.reservationId } }), metadata = AiLedgerMetadataSchema.parse(row.result);
    expect(row.userId).toBe(owner.userId); expect(row.status).toBe("RUNNING"); expect(metadata.requestHash).toBe(canonicalHash(ReserveAiSchema.parse(input)));
    expect(metadata.executionTokenHash).toBe(createHash("sha256").update(`infame-ai-execution:v1:${row.id}:${claim.executionToken}`).digest("hex"));
    expect(metadata.deadlineAt).toBe(claim.expiresAt); noCredentials({ value: result.value, metadata, dto: await service.read(owner.actor) }, [owner], [claim.executionToken]);
    await closed(savedFrame, savedView, service);
    async function replay(expectedStatus: string, replayInput = input) {
      const before = await image(); const replayed = await service.withPlanningActorTransaction(owner.actor, emptyInventory, frame => service.reserveAndClaimInFrame(frame, replayInput));
      expect(replayed.executionClaim === null).toBe(true); noCredentials(replayed.value, [owner], [claim.executionToken]);
      expect(replayed.value).toMatchObject({ replayed: true, claimPending: false, reservation: { status: expectedStatus } });
      expect(await image()).toBe(before);
    }
    await replay("RUNNING"); await service.quarantine(claim.executionToken, { reservationId: row.id, reason: "BILLING_UNCERTAIN" }); await replay("UNKNOWN");
    await service.reconcile(admin.actor, { reservationId: row.id, reviewReference: "synthetic-frame-replay-review", resolution: { kind: "NO_CHARGE" } }); await replay("RELEASED");
    const reservedInput = command(), unclaimed = await service.reserve(owner.actor, reservedInput), mutableInput = structuredClone(reservedInput);
    const claimWait = await holder("AiReservation", unclaimed.reservation.id);
    let acquired!: Awaited<ReturnType<typeof service.withPlanningActorTransaction<Awaited<ReturnType<typeof service.reserveAndClaimInFrame>>>>>;
    let acquiring: Promise<typeof acquired> | undefined;
    try {
      acquiring = service.withPlanningActorTransaction(owner.actor, emptyInventory, frame => service.reserveAndClaimInFrame(frame, mutableInput)); void acquiring.catch(() => {});
      await blockedBy(claimWait.pid, '"AiReservation"');
      mutableInput.operationKey = randomUUID(); mutableInput.payloadHash = createHash("sha256").update("synthetic-mutation").digest("hex");
      mutableInput.pricing.version = "synthetic-mutated-pricing"; mutableInput.context.resourceId = "synthetic-mutated-context";
      claimWait.release(); await claimWait.done; acquired = await acquiring;
    } finally { claimWait.release(); await claimWait.done; await acquiring?.catch(() => {}); }
    if (acquired.executionClaim) tokens.set(acquired.executionClaim.reservationId, acquired.executionClaim.executionToken);
    noCredentials(acquired.value, [owner]);
    expect(acquired.value).toMatchObject({ replayed: true, claimPending: true }); expect(acquired.executionClaim?.reservationId).toBe(unclaimed.reservation.id);
    const captured = await prisma.aiReservation.findUniqueOrThrow({ where: { id: unclaimed.reservation.id } }), capturedMetadata = AiLedgerMetadataSchema.parse(captured.result);
    expect(captured.operationKey).toBe(reservedInput.operationKey); expect(capturedMetadata.requestHash).toBe(canonicalHash(ReserveAiSchema.parse(reservedInput)));
    expect(canonicalHash(capturedMetadata.pricing)).toBe(canonicalHash(reservedInput.pricing)); expect(canonicalHash(capturedMetadata.context)).toBe(canonicalHash(reservedInput.context));
    expect(await prisma.aiReservation.count({ where: { userId: owner.userId, operationKey: mutableInput.operationKey } })).toBe(0);
    await service.settle(acquired.executionClaim!.executionToken, { reservationId: unclaimed.reservation.id, actualMicros: "0", usage: [{ unit: "REQUESTS", quantity: "0" }], pricing });
    await replay("SETTLED", reservedInput);

    // Start both distinct core calls synchronously in one genuine native frame.
    // A read-then-set pending flag can admit both before either first DB await.
    const simultaneousInputs = [command(), command()];
    const simultaneous = await service.withPlanningActorTransaction(owner.actor, emptyInventory, async frame => {
      const outcomes = await Promise.all(simultaneousInputs.map(async next => {
        try { return { accepted: true as const, operationKey: next.operationKey, value: await service.reserveAndClaimInFrame(frame, next) }; }
        catch (error) { const failure = error as { code?: string; status?: number };
          return { accepted: false as const, operationKey: next.operationKey, code: failure.code ?? "OTHER_ERROR", status: failure.status ?? 0 }; }
      }));
      const winners = outcomes.filter(outcome => outcome.accepted), rejected = outcomes.filter(outcome => !outcome.accepted);
      noCredentials(outcomes, [owner]);
      expect(winners.length).toBe(1); expect(rejected.length).toBe(1);
      expect(winners[0]!.value).toMatchObject({ replayed: false, claimPending: true });
      expect({ code: rejected[0]!.code, status: rejected[0]!.status }).toEqual({ code: "PLANNING_CLAIM_ALREADY_PENDING", status: 409 });
      const view = await readAiPlanningNativeFrame(frame);
      expect(await view.tx.aiReservation.count({ where: { userId: owner.userId, operationKey: { in: simultaneousInputs.map(next => next.operationKey) } } })).toBe(1);
      expect(await view.tx.aiReservation.count({ where: { userId: owner.userId, operationKey: rejected[0]!.operationKey } })).toBe(0);
      return { winnerOperationKey: winners[0]!.operationKey, winnerReservationId: winners[0]!.value.reservation.id };
    });
    if (simultaneous.executionClaim) tokens.set(simultaneous.executionClaim.reservationId, simultaneous.executionClaim.executionToken);
    expect(simultaneous.executionClaim?.reservationId).toBe(simultaneous.value.winnerReservationId);
    expect(typeof simultaneous.executionClaim?.executionToken === "string").toBe(true);
    const committedConcurrent = await prisma.aiReservation.findMany({ where: { userId: owner.userId, operationKey: { in: simultaneousInputs.map(next => next.operationKey) } }, select: { id: true, operationKey: true, status: true } });
    expect(committedConcurrent).toEqual([{ id: simultaneous.value.winnerReservationId, operationKey: simultaneous.value.winnerOperationKey, status: "RUNNING" }]);
    await service.releaseKnownNoCall(simultaneous.executionClaim!.executionToken, { reservationId: simultaneous.value.winnerReservationId, reason: "FAILED_BEFORE_INVOCATION" });

    // Returning from work without awaiting a valid core must not commit an
    // orphan reservation or let a later promise publish dispatch authority.
    const detachedInput = command(); let detachedCore: Promise<Awaited<ReturnType<typeof service.reserveAndClaimInFrame>>> | undefined;
    let detachedFrame!: AiPlanningNativeFrame, detachedView!: FrameView;
    expect(await observe(() => service.withPlanningActorTransaction(owner.actor, emptyInventory, async frame => {
      detachedFrame = frame; detachedView = await readAiPlanningNativeFrame(frame);
      detachedCore = service.reserveAndClaimInFrame(frame, detachedInput); void detachedCore.catch(() => {});
      return { returnedBeforeCore: true };
    }))).toEqual({ accepted: false, code: "PLANNING_FRAME_UNSETTLED", status: 503 });
    await detachedCore?.catch(() => {});
    expect(await prisma.aiReservation.count({ where: { userId: owner.userId, operationKey: detachedInput.operationKey } })).toBe(0);
    await closed(detachedFrame, detachedView, service);

    // An actual checked delegate UPDATE is already waiting on another owned
    // native Session when work returns. Drain it before rolling back; neither
    // its eventual success nor its result may survive the failed owner frame.
    const dmlOwner = await fixture(), heldDml = await holder("AuthSession", dmlOwner.actor.sessionId), letWorkReturn = latch(), callbackFinished = latch();
    let detachedDml: PromiseLike<unknown> | undefined, dmlFrame!: AiPlanningNativeFrame, dmlView!: FrameView;
    let dmlPending: Promise<Awaited<ReturnType<typeof observe>>> | undefined;
    try {
      dmlPending = observe(() => service.withPlanningActorTransaction(owner.actor,
        async () => ({ ownerIds: [dmlOwner.userId], reviewerIds: [] }), frame => {
          const completion = (async () => {
            dmlFrame = frame; dmlView = await readAiPlanningNativeFrame(frame);
            const update = dmlView.tx.authSession.update({ where: { id: dmlOwner.actor.sessionId }, data: { revokedAt: new Date() } });
            detachedDml = update; void update.catch(() => {});
            await letWorkReturn.promise; return { returnedBeforeDelegate: true };
          })();
          void completion.then(callbackFinished.release, callbackFinished.release); return completion;
        }));
      await blockedBy(heldDml.pid, '"AuthSession"');
      letWorkReturn.release(); await callbackFinished.promise;
      heldDml.release(); await heldDml.done;
      expect(await dmlPending).toEqual({ accepted: false, code: "PLANNING_FRAME_UNSETTLED", status: 503 });
      await Promise.resolve(detachedDml).catch(() => {});
      expect((await prisma.authSession.findUniqueOrThrow({ where: { id: dmlOwner.actor.sessionId }, select: { revokedAt: true } })).revokedAt === null).toBe(true);
      expect(await resolveSession(dmlOwner.token) !== null).toBe(true); await closed(dmlFrame, dmlView, service);
    } finally { letWorkReturn.release(); heldDml.release(); await heldDml.done; await dmlPending; await Promise.resolve(detachedDml).catch(() => {}); }

    let accounting = new Date(day); const durable = ledger(() => accounting), oldInput = command(1000);
    const oldReserved = await durable.reserve(owner.actor, oldInput), oldClaim = await durable.claim(owner.actor, oldReserved.reservation.id); tokens.set(oldClaim.reservationId, oldClaim.executionToken);
    const oldRow = await prisma.aiReservation.findUniqueOrThrow({ where: { id: oldClaim.reservationId } }), oldMetadata = AiLedgerMetadataSchema.parse(oldRow.result);
    accounting = new Date(day.getTime() + 2000); const rollbackInput = command(), sentinel = new Error("SYNTHETIC_FRAME_ROLLBACK");
    let rollbackFrame!: AiPlanningNativeFrame, rollbackView!: FrameView;
    await expect(durable.withPlanningActorTransaction(owner.actor, emptyInventory, async frame => {
      rollbackFrame = frame; rollbackView = await readAiPlanningNativeFrame(frame);
      const value = await durable.reserveAndClaimInFrame(frame, rollbackInput); expect(value.claimPending).toBe(true); noCredentials(value, [owner]); throw sentinel;
    })).rejects.toBe(sentinel);
    expect(await prisma.aiReservation.count({ where: { userId: owner.userId, operationKey: rollbackInput.operationKey } })).toBe(0);
    const retained = await prisma.aiReservation.findUniqueOrThrow({ where: { id: oldClaim.reservationId } }), retainedMetadata = AiLedgerMetadataSchema.parse(retained.result);
    expect(retained.status).toBe("UNKNOWN"); expect(retainedMetadata.quarantineReason).toBe("TIMEOUT");
    expect(retainedMetadata.requestHash).toBe(oldMetadata.requestHash); expect(retainedMetadata.executionTokenHash).toBe(oldMetadata.executionTokenHash);
    await closed(rollbackFrame, rollbackView, durable);

    // A caught real SQL40001 leaves the transaction aborted. Preserve the first
    // native conflict instead of masking it with a later maintenance25P02.
    const conflictInput = command(); let conflictFrame!: AiPlanningNativeFrame, conflictView!: FrameView, nativeCode = "";
    expect(await observe(() => service.withPlanningActorTransaction(owner.actor, emptyInventory, async frame => {
      conflictFrame = frame; conflictView = await readAiPlanningNativeFrame(frame);
      noCredentials(await service.reserveAndClaimInFrame(frame, conflictInput), [owner]);
      try { await conflictView.tx.$executeRaw`DO $$ BEGIN RAISE EXCEPTION 'Synthetic native frame scheduling conflict' USING ERRCODE='40001'; END $$`; }
      catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010") nativeCode = String(error.meta?.code); }
      return { caughtNativeConflict: true };
    }))).toEqual({ accepted: false, code: "RETRY_REQUIRED", status: 503 });
    expect(nativeCode).toBe("40001");
    expect(await prisma.aiReservation.count({ where: { userId: owner.userId, operationKey: conflictInput.operationKey } })).toBe(0);
    await closed(conflictFrame, conflictView, service);

    const expiring = await fixture(), markerOwner = await fixture(), marker = await service.reserve(markerOwner.actor, command());
    const held = await holder("AiReservation", marker.reservation.id), expiryInput = command();
    let expiryFrame!: AiPlanningNativeFrame, expiryView!: FrameView, expiryPending: Promise<Awaited<ReturnType<typeof observe>>> | undefined;
    try {
      const expiresAt = new Date(Date.now() + 3000);
      await prisma.authSession.update({ where: { id: expiring.actor.sessionId }, data: { expiresAt } });
      expiryPending = observe(() => service.withPlanningActorTransaction(expiring.actor, async () => ({ ownerIds: [markerOwner.userId], reviewerIds: [] }), async frame => {
        expiryFrame = frame; expiryView = await readAiPlanningNativeFrame(frame);
        const value = await service.reserveAndClaimInFrame(frame, expiryInput); expect(value.claimPending).toBe(true); noCredentials(value, [expiring]);
        await expiryView.tx.$queryRaw`SELECT id FROM "AiReservation" WHERE id=${marker.reservation.id} FOR UPDATE`;
        return value;
      }));
      await blockedBy(held.pid, '"AiReservation"'); expect(Date.now() < expiresAt.getTime()).toBe(true);
      await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 40)));
      held.release(); await held.done; expect(await expiryPending).toEqual(unauthorized);
      expect(await prisma.aiReservation.count({ where: { userId: expiring.userId, operationKey: expiryInput.operationKey } })).toBe(0);
      expect(await resolveSession(expiring.token) === null).toBe(true); await closed(expiryFrame, expiryView, service);
    } finally { held.release(); await held.done; await expiryPending; }
  }, 60000);
});
