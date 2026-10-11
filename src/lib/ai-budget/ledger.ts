import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma, type AiReservation, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma";
import {
  AiActorSchema, AiBudgetCapsSchema, AiLedgerMetadataSchema, AiStatusSchema, NoCallSchema, QuarantineSchema,
  ReconcileSchema, ReserveAiSchema, ResolveOverrunSchema, SettlementSchema, calculateUsageCostMicros, readAiBudgetCaps,
  type AiActor, type AiBudgetCaps, type AiLedgerMetadata,
} from "./contracts";

// One namespace shared by every billed purpose and every server/background worker.
// It MUST precede User locks. Never invoke provider code inside this transaction.
export const AI_BUDGET_LOCK = Object.freeze([1768842861, 1634296437] as const);
export class AiBudgetError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); this.name = "AiBudgetError"; }
}

function captureActor(input: unknown): Readonly<AiActor> {
  const parsed = AiActorSchema.safeParse(input);
  if (!parsed.success) throw new AiBudgetError("UNAUTHENTICATED", 401);
  return Object.freeze(parsed.data);
}
async function authenticateActor(client: Pick<Transaction, "user" | "authSession">, actor: Readonly<AiActor>, admin = false): Promise<void> {
  const user = await client.user.findUnique({ where: { id: actor.userId }, select: { active: true, role: true, sessionVersion: true } });
  const session = await client.authSession.findUnique({ where: { id: actor.sessionId }, select: { userId: true, version: true, revokedAt: true, expiresAt: true } });
  // Accounting days and provider deadlines never control native authentication.
  if (!user?.active || user.role !== actor.role || user.sessionVersion !== actor.sessionVersion || !session
    || session.userId !== actor.userId || session.version !== actor.sessionVersion || session.revokedAt || session.expiresAt <= new Date())
    throw new AiBudgetError("UNAUTHENTICATED", 401);
  if (admin && user.role !== "ADMIN") throw new AiBudgetError("FORBIDDEN", 403);
}
type Options = { client?: PrismaClient; now?: () => Date; caps?: AiBudgetCaps };
type Transaction = Prisma.TransactionClient;
declare const planningFrameBrand: unique symbol;
export type AiPlanningNativeFrame = Readonly<{ [planningFrameBrand]: true }>;
type ExecutionClaim = { reservationId: string; executionToken: string; expiresAt: string };
type PlanningInventory = { ownerIds: readonly string[]; reviewerIds: readonly string[] };
type PlanningFrameState = {
  issuer: object; active: boolean; tx: Transaction; actor: Readonly<AiActor>;
  ownerIds: readonly string[]; reviewerIds: readonly string[];
  assertCurrent: () => Promise<void>; pending: ExecutionClaim | null; busy: boolean;
  inFlight: Set<Promise<unknown>>;
  queryFailure: unknown;
};
const planningFrames = new WeakMap<object, PlanningFrameState>();
function trackPlanningWork<T>(state: PlanningFrameState, work: Promise<T>): Promise<T> {
  state.inFlight.add(work);
  // The original promise remains observable to its caller; this handler only
  // tracks ownership and prevents forgotten work becoming an unhandled leak.
  void work.then(() => state.inFlight.delete(work), () => state.inFlight.delete(work));
  return work;
}
async function drainPlanningWork(state: PlanningFrameState) {
  while (state.inFlight.size) await Promise.allSettled([...state.inFlight]);
}
function planningFrameState(input: unknown, issuer?: object): PlanningFrameState {
  const state = input !== null && typeof input === "object" ? planningFrames.get(input) : undefined;
  if (!state?.active || issuer && state.issuer !== issuer) throw new AiBudgetError("PLANNING_FRAME_UNAVAILABLE", 503);
  return state;
}
export async function readAiPlanningNativeFrame(input: unknown) {
  const state = planningFrameState(input);
  await state.assertCurrent();
  planningFrameState(input);
  return Object.freeze({ tx: state.tx, actor: state.actor, ownerIds: state.ownerIds,
    reviewerIds: state.reviewerIds, assertCurrent: state.assertCurrent });
}
function nativeConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034"
    || error.code === "P2010" && ["40001", "40P01"].includes(String(error.meta?.code)));
}
function trustedTime(clock: () => Date) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new AiBudgetError("INVALID_TRUSTED_CLOCK");
  return new Date(value.getTime());
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function digest(value: unknown) { return createHash("sha256").update(canonical(value)).digest("hex"); }
function tokenHash(reservationId: string, token: string) { return createHash("sha256").update(`infame-ai-execution:v1:${reservationId}:${token}`).digest("hex"); }
function metadata(row: AiReservation): AiLedgerMetadata {
  if (Buffer.byteLength(JSON.stringify(row.result), "utf8") > 8192) throw new AiBudgetError("LEDGER_REVIEW_REQUIRED");
  const value = AiLedgerMetadataSchema.safeParse(row.result), status = AiStatusSchema.safeParse(row.status);
  if (!value.success || !status.success) throw new AiBudgetError("LEDGER_REVIEW_REQUIRED");
  const data = value.data;
  if (row.reservedMicros <= BigInt(0) || (row.actualMicros !== null && row.actualMicros < BigInt(0)) ||
    (row.status === "RESERVED" && (data.executionTokenHash !== null || data.claimedAt !== null || data.deadlineAt !== null)) ||
    (["RUNNING", "UNKNOWN"].includes(row.status) && (!data.executionTokenHash || !data.claimedAt || !data.deadlineAt)) ||
    (["RESERVED", "RUNNING", "UNKNOWN"].includes(row.status) && (row.actualMicros !== null || row.settledAt !== null)) ||
    (row.status === "SETTLED" && (row.actualMicros === null || !row.settledAt || !data.settlementHash || !data.usage || !data.settlementPricing)) ||
    (row.status === "RELEASED" && (row.actualMicros !== BigInt(0) || !row.settledAt || !data.noCallReason)) ||
    (data.overrunResolved && !data.overrun)) throw new AiBudgetError("LEDGER_REVIEW_REQUIRED");
  return data;
}
function json(data: AiLedgerMetadata): Prisma.InputJsonValue {
  const value = AiLedgerMetadataSchema.parse(data);
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 8192) throw new AiBudgetError("LEDGER_METADATA_TOO_LARGE");
  return value as Prisma.InputJsonValue;
}
function reservationDto(row: AiReservation) {
  return { id: row.id, purpose: row.purpose, status: AiStatusSchema.parse(row.status), reservedMicros: row.reservedMicros.toString(), actualMicros: row.actualMicros?.toString() ?? null, createdAt: row.createdAt.toISOString(), settledAt: row.settledAt?.toISOString() ?? null };
}
async function getReservation(tx: Transaction, id: string, ownerId?: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(id)) throw new AiBudgetError("NOT_FOUND");
  await tx.$queryRaw`SELECT id FROM "AiReservation" WHERE id=${id} FOR UPDATE`;
  const row = await tx.aiReservation.findUnique({ where: { id } });
  if (!row || (ownerId && row.userId !== ownerId)) throw new AiBudgetError("NOT_FOUND");
  return { row, data: metadata(row) };
}
function verifyExecution(row: AiReservation, data: AiLedgerMetadata, token: string) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token) || !data.executionTokenHash ||
    !timingSafeEqual(Buffer.from(data.executionTokenHash, "hex"), Buffer.from(tokenHash(row.id, token), "hex"))) throw new AiBudgetError("INVALID_EXECUTION_TOKEN");
}
async function quarantineExpired(tx: Transaction, now: Date) {
  const running = await tx.aiReservation.findMany({ where: { status: "RUNNING" } });
  for (const row of running) {
    const data = metadata(row);
    if (new Date(data.deadlineAt!) <= now) await tx.aiReservation.update({ where: { id: row.id }, data: { status: "UNKNOWN", result: json({ ...data, quarantineReason: "TIMEOUT" }) } });
  }
}
async function accounting(tx: Transaction, now: Date, ownerId: string, caps: AiBudgetCaps) {
  const start = new Date(now); start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 86400000);
  const rows = await tx.aiReservation.findMany({ where: { OR: [{ status: { in: ["RESERVED", "RUNNING", "UNKNOWN"] } }, { status: "SETTLED" }] } });
  let userUsed = BigInt(0), userReserved = BigInt(0), platformUsed = BigInt(0), platformReserved = BigInt(0), blocked = false;
  for (const row of rows) {
    const data = metadata(row);
    if (data.overrun && !data.overrunResolved) blocked = true;
    if (row.status === "SETTLED") {
      if (row.settledAt! >= start && row.settledAt! < end) {
        platformUsed += row.actualMicros!;
        if (row.userId === ownerId) userUsed += row.actualMicros!;
      }
    } else {
      platformReserved += row.reservedMicros;
      if (row.userId === ownerId) userReserved += row.reservedMicros;
    }
  }
  const summary = (cap: string, used: bigint, reserved: bigint) => ({ capMicros: cap, usedMicros: used.toString(), reservedMicros: reserved.toString(), remainingMicros: (BigInt(cap) > used + reserved ? BigInt(cap) - used - reserved : BigInt(0)).toString() });
  return { currency: "USD" as const, utcDay: start.toISOString().slice(0, 10), blocked, user: summary(caps.userDailyMicros, userUsed, userReserved), platform: summary(caps.platformDailyMicros, platformUsed, platformReserved) };
}
function enforce(summary: Awaited<ReturnType<typeof accounting>>, amount: bigint = BigInt(0)) {
  if (summary.blocked) throw new AiBudgetError("OVERRUN_REVIEW_REQUIRED");
  if (BigInt(summary.user.usedMicros) + BigInt(summary.user.reservedMicros) + amount > BigInt(summary.user.capMicros)) throw new AiBudgetError("USER_BUDGET_EXHAUSTED");
  if (BigInt(summary.platform.usedMicros) + BigInt(summary.platform.reservedMicros) + amount > BigInt(summary.platform.capMicros)) throw new AiBudgetError("PLATFORM_BUDGET_EXHAUSTED");
}

// This factory and its execution/reconciliation methods are trusted SERVER APIs.
// Only read()'s DTO and reservationDto may cross the owner transport boundary.
export function createAiBudgetLedger(options: Options = {}) {
  const client = options.client ?? prisma, clock = options.now ?? (() => new Date());
  const planningIssuer = Object.freeze({});
  const caps = AiBudgetCapsSchema.parse(options.caps ?? readAiBudgetCaps());
  const maintenance = async () => client.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${AI_BUDGET_LOCK[0]}::int,${AI_BUDGET_LOCK[1]}::int)::text`;
    await quarantineExpired(tx, trustedTime(clock));
  }, { maxWait: 10000, timeout: 15000 });
  async function beginActor(input: unknown, admin = false, requiredRole?: "BRAND") {
    const actor = captureActor(input);
    let maintenanceFailed = false, maintenanceError: unknown;
    // Timeout quarantine is trusted system maintenance. Its locks are released
    // before interactive Users; a denial never refunds an uncertain execution.
    try { await maintenance(); } catch (error) { maintenanceFailed = true; maintenanceError = error; }
    await authenticateActor(client, actor, admin);
    if (requiredRole && actor.role !== requiredRole) throw new AiBudgetError("FORBIDDEN", 403);
    if (maintenanceFailed) throw maintenanceError;
    return actor;
  }
  const actorTransaction = async <T>(actor: Readonly<AiActor>, admin: boolean, targetId: string | null,
    work: (tx: Transaction, now: Date) => Promise<T>): Promise<T> => {
    let outcome;
    try {
      outcome = await client.$transaction(async raw => {
        await raw.$queryRaw`SELECT pg_advisory_xact_lock(${AI_BUDGET_LOCK[0]}::int,${AI_BUDGET_LOCK[1]}::int)::text`;
        const target = targetId ? await raw.aiReservation.findUnique({ where: { id: targetId }, select: { userId: true } }) : null;
        const owners = [...new Set([actor.userId, ...(target ? [target.userId] : [])])].sort();
        await raw.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(owners)}) ORDER BY id COLLATE "C" FOR UPDATE`);
        await raw.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${actor.sessionId} FOR SHARE`;
        await authenticateActor(raw, actor, admin);
        if (targetId) {
          await raw.$queryRaw`SELECT id FROM "AiReservation" WHERE id=${targetId} FOR UPDATE`;
          await authenticateActor(raw, actor, admin);
          const currentTarget = await raw.aiReservation.findUnique({ where: { id: targetId }, select: { userId: true } });
          await authenticateActor(raw, actor, admin);
          // UPDATE identity is immutable, but a DELETE/reinsert can change the
          // captured subject. Reject before private hydration; never lock a new
          // owner after Session/domain locks.
          if (currentTarget?.userId !== target?.userId) throw new AiBudgetError("RETRY_REQUIRED", 503);
          if (!currentTarget) throw new AiBudgetError("NOT_FOUND", 404);
        }
        const now = trustedTime(clock);
        let locked = true;
        const delegates = new Map<PropertyKey, object>();
        const checked = async <R>(operation: () => PromiseLike<R>): Promise<R> => {
          if (locked) await authenticateActor(raw, actor, admin);
          let value: R;
          try { value = await operation(); }
          catch (error) {
            if (!(error instanceof Prisma.PrismaClientKnownRequestError) && locked) await authenticateActor(raw, actor, admin);
            throw error;
          }
          if (locked) await authenticateActor(raw, actor, admin);
          return value;
        };
        const tx = new Proxy(raw, { get(receiver, key) {
          const value = Reflect.get(receiver, key, receiver);
          if (typeof value === "function") return (...args: unknown[]) => checked(() => Reflect.apply(value, receiver, args) as PromiseLike<unknown>);
          if (value && typeof value === "object" && typeof key === "string" && !key.startsWith("_")) {
            let delegate = delegates.get(key);
            if (!delegate) {
              const capturedDelegate = new Proxy(value, { get(model, method) {
                const query = Reflect.get(model, method, model);
                return typeof query === "function" ? (...args: unknown[]) => checked(() => Reflect.apply(query, model, args) as PromiseLike<unknown>) : query;
              } });
              delegates.set(key, capturedDelegate);
              delegate = capturedDelegate;
            }
            return delegate;
          }
          return value;
        } });
        // Native authority locks precede the command savepoint. Domain locks and
        // writes can roll back without undoing already committed maintenance.
        await raw.$executeRaw`SAVEPOINT ai_budget_command`;
        try {
          const value = await work(tx, now);
          await quarantineExpired(tx, trustedTime(clock));
          await authenticateActor(raw, actor, admin);
          return { ok: true as const, value };
        } catch (error) {
          if (nativeConflict(error)) throw error;
          await raw.$executeRaw`ROLLBACK TO SAVEPOINT ai_budget_command`;
          locked = false;
          let failure = error;
          try { await quarantineExpired(raw, trustedTime(clock)); }
          catch (maintenanceError) { if (nativeConflict(maintenanceError)) throw maintenanceError; failure = maintenanceError; }
          // Revalidate after rollback/maintenance; never trust a discarded frame.
          try { await authenticateActor(raw, actor, admin); }
          catch (authError) { if (nativeConflict(authError)) throw authError; failure = authError; }
          return { ok: false as const, error: failure };
        }
      }, { maxWait: 10000, timeout: 15000 });
    } catch (error) {
      // Fresh real-clock auth after an aborted callback. No uncertain COMMIT or
      // externally claimed execution is retried by this boundary.
      await authenticateActor(client, actor, admin);
      if (nativeConflict(error)) throw new AiBudgetError("RETRY_REQUIRED", 503);
      throw error;
    }
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  };
  const transaction = async <T>(work: (tx: Transaction, now: Date) => Promise<T>): Promise<T> => {
    const outcome = await client.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${AI_BUDGET_LOCK[0]}::int,${AI_BUDGET_LOCK[1]}::int)::text`;
      const now = trustedTime(clock);
      await quarantineExpired(tx, now);
      // A denied command rolls back its own writes/audit, but timeout quarantine
      // remains durable. Throwing directly from the transaction would undo it.
      await tx.$executeRaw`SAVEPOINT ai_budget_command`;
      try {
        const value = await work(tx, now);
        await quarantineExpired(tx, trustedTime(clock));
        return { ok: true as const, value };
      } catch (error) {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT ai_budget_command`;
        await quarantineExpired(tx, trustedTime(clock));
        return { ok: false as const, error };
      }
    }, { maxWait: 10000, timeout: 15000 });
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  };

  async function settleRow(tx: Transaction, now: Date, row: AiReservation, data: AiLedgerMetadata, input: ReturnType<typeof SettlementSchema.parse>) {
    if (canonical(input.pricing) !== canonical(data.pricing)) throw new AiBudgetError("PRICING_CONFLICT");
    const hash = digest(input);
    if (row.status === "SETTLED") {
      if (data.settlementHash !== hash) throw new AiBudgetError("SETTLEMENT_CONFLICT");
      return { reservation: reservationDto(row), replayed: true };
    }
    if (row.status !== "RUNNING" && row.status !== "UNKNOWN") throw new AiBudgetError("INVALID_TRANSITION");
    const actual = BigInt(input.actualMicros), estimated = calculateUsageCostMicros(input.usage, input.pricing);
    const updated = await tx.aiReservation.update({ where: { id: row.id }, data: { status: "SETTLED", actualMicros: actual, settledAt: now, result: json({ ...data, settlementHash: hash, usage: input.usage, settlementPricing: input.pricing, estimatedActualMicros: estimated, overrun: actual > row.reservedMicros, overrunResolved: false }) } });
    return { reservation: reservationDto(updated), replayed: false };
  }

  async function reserveCore(tx: Transaction, now: Date, actor: Readonly<AiActor>, command: ReturnType<typeof ReserveAiSchema.parse>) {
    const requestHash = digest(command);
    const existing = await tx.aiReservation.findUnique({ where: { userId_operationKey: { userId: actor.userId, operationKey: command.operationKey } } });
    if (existing) {
      const data = metadata(existing);
      if (existing.purpose !== command.purpose || existing.payloadHash !== command.payloadHash || data.requestHash !== requestHash) throw new AiBudgetError("REPLAY_CONFLICT");
      return { reservation: reservationDto(existing), replayed: true };
    }
    const duplicate = await tx.aiReservation.findFirst({ where: { userId: actor.userId, purpose: command.purpose, payloadHash: command.payloadHash, status: { in: ["RESERVED", "RUNNING", "UNKNOWN"] } } });
    if (duplicate) throw new AiBudgetError(duplicate.status === "UNKNOWN" ? "RECONCILIATION_REQUIRED" : "PAYLOAD_ALREADY_PENDING");
    enforce(await accounting(tx, now, actor.userId, caps), BigInt(command.reservedMicros));
    const result: AiLedgerMetadata = {
      schemaVersion: 1, actorRole: actor.role, actorSessionVersion: actor.sessionVersion, requestHash, pricing: command.pricing, context: command.context, executionTimeoutMs: command.executionTimeoutMs,
      executionTokenHash: null, claimedAt: null, deadlineAt: null, quarantineReason: null, settlementHash: null, usage: null, settlementPricing: null, estimatedActualMicros: null, noCallReason: null, overrun: false, overrunResolved: false, reconciliation: null,
    };
    const row = await tx.aiReservation.create({ data: { userId: actor.userId, operationKey: command.operationKey, payloadHash: command.payloadHash, purpose: command.purpose, status: "RESERVED", reservedMicros: BigInt(command.reservedMicros), createdAt: now, result: json(result) } });
    return { reservation: reservationDto(row), replayed: false };
  }
  async function claimCore(tx: Transaction, now: Date, actor: Readonly<AiActor>, reservationId: string): Promise<ExecutionClaim> {
    const { row, data } = await getReservation(tx, reservationId, actor.userId);
    if (data.executionTokenHash) throw new AiBudgetError("EXECUTION_ALREADY_CLAIMED");
    if (row.status !== "RESERVED") throw new AiBudgetError("INVALID_TRANSITION");
    if (actor.role !== data.actorRole || actor.sessionVersion !== data.actorSessionVersion) throw new AiBudgetError("FORBIDDEN");
    enforce(await accounting(tx, now, actor.userId, caps));
    const executionToken = randomBytes(32).toString("base64url"), expiresAt = new Date(now.getTime() + data.executionTimeoutMs).toISOString();
    await tx.aiReservation.update({ where: { id: row.id }, data: { status: "RUNNING", result: json({ ...data, executionTokenHash: tokenHash(row.id, executionToken), claimedAt: now.toISOString(), deadlineAt: expiresAt }) } });
    return { reservationId: row.id, executionToken, expiresAt };
  }

  async function planningActorTransaction<T>(actorInput: unknown, captureInventory: () => Promise<PlanningInventory>,
    work: (frame: AiPlanningNativeFrame) => Promise<T>) {
    // Callback identities are copied now; they are trusted server configuration.
    const inventoryCallback = captureInventory, callback = work;
    const actor = await beginActor(actorInput, false, "BRAND");
    if (typeof inventoryCallback !== "function" || typeof callback !== "function") throw new AiBudgetError("INVALID_PLANNING_CONFIGURATION");
    const inventory = z.object({ ownerIds: AiActorSchema.shape.userId.array().max(63),
      reviewerIds: AiActorSchema.shape.userId.array().max(2412) }).strict().parse(await inventoryCallback());
    const ownerIds = Object.freeze([...new Set([actor.userId, ...inventory.ownerIds])].sort());
    const ownerSet = new Set(ownerIds);
    const reviewerIds = Object.freeze([...new Set(inventory.reviewerIds)].filter(id => !ownerSet.has(id)).sort());
    let issued: PlanningFrameState | undefined;
    try {
      const outcome = await client.$transaction(async raw => {
        await raw.$queryRaw`SELECT pg_advisory_xact_lock(${AI_BUDGET_LOCK[0]}::int,${AI_BUDGET_LOCK[1]}::int)::text`;
        const owners = await raw.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(ownerIds)}) ORDER BY id COLLATE "C" FOR UPDATE`);
        const reviewers = reviewerIds.length ? await raw.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(reviewerIds)}) ORDER BY id COLLATE "C" FOR SHARE`) : [];
        await raw.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${actor.sessionId} FOR SHARE`;
        await authenticateActor(raw, actor);
        if (owners.length !== ownerIds.length || reviewers.length !== reviewerIds.length) throw new AiBudgetError("RETRY_REQUIRED", 503);
        const state: PlanningFrameState = { issuer: planningIssuer, active: true, tx: raw, actor, ownerIds, reviewerIds,
          pending: null, busy: false, inFlight: new Set(), queryFailure: null, assertCurrent: async () => {
            if (!state.active) throw new AiBudgetError("PLANNING_FRAME_UNAVAILABLE", 503);
            await authenticateActor(raw, actor);
            if (!state.active) throw new AiBudgetError("PLANNING_FRAME_UNAVAILABLE", 503);
          } };
        const invoke = (operation: (...args: unknown[]) => unknown, receiver: object, args: unknown[]) => trackPlanningWork(state, (async () => {
          try {
            await state.assertCurrent();
            const value = await operation.apply(receiver, args);
            await state.assertCurrent();
            return value;
          } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && state.queryFailure === null) state.queryFailure = error;
            throw error;
          }
        })());
        const delegates = new Map<PropertyKey, object>();
        state.tx = new Proxy(raw, { get(target, key, receiver) {
          const value: unknown = Reflect.get(target, key, receiver);
          if (typeof value === "function") return (...args: unknown[]) => invoke(value as (...args: unknown[]) => unknown, target, args);
          if (value && typeof value === "object") {
            let delegate = delegates.get(key);
            if (!delegate) {
              delegate = new Proxy(value, { get(model, method, modelReceiver) {
                const member: unknown = Reflect.get(model, method, modelReceiver);
                return typeof member === "function" ? (...args: unknown[]) => invoke(member as (...args: unknown[]) => unknown, model, args) : member;
              } });
              delegates.set(key, delegate);
            }
            return delegate;
          }
          return value;
        } });
        const frame = Object.freeze({}) as AiPlanningNativeFrame;
        planningFrames.set(frame, state); issued = state;
        await raw.$executeRaw`SAVEPOINT ai_budget_command`;
        try {
          const value = await callback(frame);
          if (state.queryFailure !== null) throw state.queryFailure;
          if (state.busy || state.inFlight.size) throw new AiBudgetError("PLANNING_FRAME_UNSETTLED", 503);
          state.active = false;
          await quarantineExpired(raw, trustedTime(clock));
          await authenticateActor(raw, actor);
          if (state.pending) {
            const { row, data } = await getReservation(raw, state.pending.reservationId, actor.userId);
            verifyExecution(row, data, state.pending.executionToken);
            if (row.status !== "RUNNING" || new Date(data.deadlineAt!) <= trustedTime(clock)) throw new AiBudgetError("RECONCILIATION_REQUIRED");
          }
          await authenticateActor(raw, actor);
          return { ok: true as const, value, executionClaim: state.pending ? Object.freeze({ ...state.pending }) : null };
        } catch (error) {
          state.active = false; state.pending = null;
          await drainPlanningWork(state);
          const originalFailure = state.queryFailure ?? error;
          if (nativeConflict(originalFailure)) throw originalFailure;
          await raw.$executeRaw`ROLLBACK TO SAVEPOINT ai_budget_command`;
          let failure = originalFailure;
          try { await quarantineExpired(raw, trustedTime(clock)); }
          catch (maintenanceError) { if (nativeConflict(maintenanceError)) throw maintenanceError; failure = maintenanceError; }
          try { await authenticateActor(raw, actor); }
          catch (authError) { if (nativeConflict(authError)) throw authError; failure = authError; }
          return { ok: false as const, error: failure };
        }
      }, { maxWait: 10000, timeout: 15000 });
      if (!outcome.ok) throw outcome.error;
      return { value: outcome.value, executionClaim: outcome.executionClaim };
    } catch (error) {
      await authenticateActor(client, actor);
      if (nativeConflict(error)) throw new AiBudgetError("RETRY_REQUIRED", 503);
      throw error;
    } finally { if (issued) { issued.active = false; issued.pending = null; } }
  }

  return {
    withPlanningActorTransaction: planningActorTransaction,
    reserveAndClaimInFrame(frame: AiPlanningNativeFrame, input: unknown) {
      let state: PlanningFrameState;
      try { state = planningFrameState(frame, planningIssuer); }
      catch (error) { return Promise.reject(error); }
      const capturedCommand = ReserveAiSchema.safeParse(input);
      const alreadyBusy = state.busy;
      if (!alreadyBusy) state.busy = true;
      return trackPlanningWork(state, (async () => { try {
        await state.assertCurrent();
        if (!capturedCommand.success) throw capturedCommand.error;
        if (alreadyBusy || state.pending) throw new AiBudgetError("PLANNING_CLAIM_ALREADY_PENDING", 409);
        const now = trustedTime(clock);
        const reserved = await reserveCore(state.tx, now, state.actor, capturedCommand.data);
        if (reserved.reservation.status !== "RESERVED") return { ...reserved, claimPending: false };
        state.pending = await claimCore(state.tx, trustedTime(clock), state.actor, reserved.reservation.id);
        await state.assertCurrent();
        return { ...reserved, reservation: { ...reserved.reservation, status: "RUNNING" as const }, claimPending: true };
      } finally { if (!alreadyBusy) state.busy = false; } })());
    },
    async reserve(actorInput: unknown, input: unknown) {
      const actor = await beginActor(actorInput);
      const command = ReserveAiSchema.parse(input);
      return actorTransaction(actor, false, null, (tx, now) => reserveCore(tx, now, actor, command));
    },
    async read(actorInput: unknown) {
      const actor = await beginActor(actorInput);
      return actorTransaction(actor, false, null, async (tx, now) => {
        const summary = await accounting(tx, now, actor.userId, caps);
        const rows = await tx.aiReservation.findMany({ where: { userId: actor.userId }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 20 });
        return { ...summary, reservations: rows.map(row => { metadata(row); return reservationDto(row); }) };
      });
    },
    async claim(actorInput: unknown, reservationId: string) {
      const actor = await beginActor(actorInput);
      return actorTransaction(actor, false, null, (tx, now) => claimCore(tx, now, actor, reservationId));
    },
    async releaseUnclaimed(actorInput: unknown, reservationId: string) {
      const actor = await beginActor(actorInput);
      return actorTransaction(actor, false, null, async (tx, now) => {
        const { row, data } = await getReservation(tx, reservationId, actor.userId);
        if (row.status === "RELEASED" && data.noCallReason === "OWNER_CANCELLED_UNCLAIMED") return { reservation: reservationDto(row), replayed: true };
        if (row.status !== "RESERVED" || data.executionTokenHash) throw new AiBudgetError("INVALID_TRANSITION");
        const updated = await tx.aiReservation.update({ where: { id: row.id }, data: { status: "RELEASED", actualMicros: BigInt(0), settledAt: now, result: json({ ...data, noCallReason: "OWNER_CANCELLED_UNCLAIMED" }) } });
        return { reservation: reservationDto(updated), replayed: false };
      });
    },
    async settle(executionToken: string, input: unknown) {
      const command = SettlementSchema.parse(input);
      return transaction(async (tx, now) => { const { row, data } = await getReservation(tx, command.reservationId); verifyExecution(row, data, executionToken); return settleRow(tx, now, row, data, command); });
    },
    async quarantine(executionToken: string, input: unknown) {
      const command = QuarantineSchema.parse(input);
      return transaction(async tx => {
        const { row, data } = await getReservation(tx, command.reservationId); verifyExecution(row, data, executionToken);
        if (row.status === "UNKNOWN") return { reservation: reservationDto(row), replayed: true };
        if (row.status !== "RUNNING") throw new AiBudgetError("INVALID_TRANSITION");
        const updated = await tx.aiReservation.update({ where: { id: row.id }, data: { status: "UNKNOWN", result: json({ ...data, quarantineReason: command.reason }) } });
        return { reservation: reservationDto(updated), replayed: false };
      });
    },
    async releaseKnownNoCall(executionToken: string, input: unknown) {
      const command = NoCallSchema.parse(input);
      return transaction(async (tx, now) => {
        const { row, data } = await getReservation(tx, command.reservationId); verifyExecution(row, data, executionToken);
        if (row.status === "RELEASED" && data.noCallReason === command.reason) return { reservation: reservationDto(row), replayed: true };
        if (row.status === "UNKNOWN") throw new AiBudgetError("RECONCILIATION_REQUIRED");
        if (row.status !== "RUNNING") throw new AiBudgetError("INVALID_TRANSITION");
        const updated = await tx.aiReservation.update({ where: { id: row.id }, data: { status: "RELEASED", actualMicros: BigInt(0), settledAt: now, result: json({ ...data, noCallReason: command.reason }) } });
        return { reservation: reservationDto(updated), replayed: false };
      });
    },
    async reconcile(adminInput: unknown, input: unknown) {
      const admin = await beginActor(adminInput, true);
      const command = ReconcileSchema.parse(input);
      return actorTransaction(admin, true, command.reservationId, async (tx, now) => {
        const { row, data } = await getReservation(tx, command.reservationId);
        const settlement = command.resolution.kind === "CHARGE" ? SettlementSchema.parse({ reservationId: row.id, actualMicros: command.resolution.actualMicros, usage: command.resolution.usage, pricing: command.resolution.pricing }) : null;
        if (row.status !== "UNKNOWN") {
          if (data.reconciliation?.adminUserId === admin.userId && data.reconciliation.reviewReference === command.reviewReference && data.reconciliation.kind === command.resolution.kind &&
            (settlement ? data.settlementHash === digest(settlement) : row.status === "RELEASED")) return { reservation: reservationDto(row), replayed: true };
          throw new AiBudgetError("STALE_RECONCILIATION");
        }
        const audit = await tx.adminAudit.create({ data: { actorUserId: admin.userId, action: "AI_BILLING_RECONCILED", resourceType: "AI_RESERVATION", resourceId: row.id, snapshot: { schemaVersion: 1, reviewReference: command.reviewReference, resolution: command.resolution.kind, beforeStatus: row.status, actualMicros: settlement?.actualMicros ?? "0" } } });
        const reconciled = { ...data, reconciliation: { adminUserId: admin.userId, reviewReference: command.reviewReference, auditId: audit.id, resolvedAt: now.toISOString(), kind: command.resolution.kind } };
        if (settlement) return settleRow(tx, now, row, reconciled, settlement);
        const updated = await tx.aiReservation.update({ where: { id: row.id }, data: { status: "RELEASED", actualMicros: BigInt(0), settledAt: now, result: json({ ...reconciled, noCallReason: "RECONCILED_NO_CHARGE" }) } });
        return { reservation: reservationDto(updated), replayed: false };
      });
    },
    async resolveOverrun(adminInput: unknown, input: unknown) {
      const admin = await beginActor(adminInput, true);
      const command = ResolveOverrunSchema.parse(input);
      return actorTransaction(admin, true, command.reservationId, async (tx, now) => {
        const { row, data } = await getReservation(tx, command.reservationId);
        if (row.status !== "SETTLED" || !data.overrun || row.actualMicros?.toString() !== command.expectedActualMicros) throw new AiBudgetError("STALE_RECONCILIATION");
        if (data.overrunResolved) {
          if (data.reconciliation?.adminUserId === admin.userId && data.reconciliation.reviewReference === command.reviewReference && data.reconciliation.kind === "OVERRUN_ACCEPTED") return { reservation: reservationDto(row), replayed: true };
          throw new AiBudgetError("STALE_RECONCILIATION");
        }
        const audit = await tx.adminAudit.create({ data: { actorUserId: admin.userId, action: "AI_OVERRUN_ACCEPTED", resourceType: "AI_RESERVATION", resourceId: row.id, snapshot: { schemaVersion: 1, reviewReference: command.reviewReference, actualMicros: command.expectedActualMicros, reservedMicros: row.reservedMicros.toString() } } });
        const updated = await tx.aiReservation.update({ where: { id: row.id }, data: { result: json({ ...data, overrunResolved: true, reconciliation: { adminUserId: admin.userId, reviewReference: command.reviewReference, auditId: audit.id, resolvedAt: now.toISOString(), kind: "OVERRUN_ACCEPTED" } }) } });
        return { reservation: reservationDto(updated), replayed: false };
      });
    },
  };
}
