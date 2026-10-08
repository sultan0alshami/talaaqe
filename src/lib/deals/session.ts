import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertLockedProfileActor, captureOrganizationActor, checkProfileActor, type OrganizationActor } from "@/lib/organizations/context";
import { DealError, type DealOptions } from "./contracts";

type Tx = Prisma.TransactionClient;
export type DealSession = { actor: Readonly<OrganizationActor>; options: Readonly<DealOptions> };
type Frame = { raw: Tx; actor: Readonly<OrganizationActor>; locked: boolean };
const frames = new WeakMap<object, Frame>();
// Internal scheduling signal only. A semantic actual-party denial retains its
// historical STALE_PARTICIPANTS code and must never be converted to a retry.
class DealCaptureChanged extends Error {}
export function retryDealCapture(): never { throw new DealCaptureChanged(); }

// Capture all trusted dependencies before the first wait. Authentication is a
// separate server argument and never becomes command data or a legacy hash.
export async function beginDealSession(actorUserId: string, options: DealOptions): Promise<DealSession> {
  if (!options.serverAuth) throw new DealError("UNAUTHENTICATED", 401);
  const actor = captureOrganizationActor(options.serverAuth);
  if (actor.userId !== actorUserId) throw new DealError("UNAUTHENTICATED", 401);
  const captured = Object.freeze({ ...options, serverAuth: actor,
    ...(options.now ? { now: new Date(options.now.getTime()) } : {}) });
  await checkProfileActor(actor, { client: captured.client });
  return { actor, options: captured };
}

export async function assertDealSession(tx: Tx): Promise<void> {
  const frame = frames.get(tx);
  if (!frame?.locked) throw new DealError("UNAUTHENTICATED", 401);
  await assertLockedProfileActor(frame.raw, frame.actor);
}
// Call exactly after the complete owner/reviewer inventory, before any domain
// locks. The real-clock predicate reads the original tx to avoid recursive checks.
export async function lockDealSession(tx: Tx): Promise<void> {
  const frame = frames.get(tx);
  if (!frame || frame.locked) throw new DealError("INVALID_SESSION_BOUNDARY", 503);
  await frame.raw.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${frame.actor.sessionId} FOR SHARE`;
  await assertLockedProfileActor(frame.raw, frame.actor);
  frame.locked = true;
}

// Once native locks exist, every database wait is followed by current native
// authorization, including errors, replay journals and private DTO projections.
// Delegates and raw SQL retain their actual tx/receiver; no nested transaction or
// external invocation is introduced. Native checks themselves use the raw tx.
function guardedTransaction(raw: Tx, actor: Readonly<OrganizationActor>): Tx {
  const frame: Frame = { raw, actor, locked: false }, delegates = new Map<PropertyKey, object>();
  const after = async <T>(operation: () => PromiseLike<T>): Promise<T> => {
    if (frame.locked) await assertLockedProfileActor(raw, actor);
    let result: T;
    try { result = await operation(); }
    catch (error) {
      // PostgreSQL conflict errors abort this transaction. Authorization is
      // checked on the fresh retry, rather than masking the native conflict
      // with another query against the aborted transaction.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) && frame.locked) await assertLockedProfileActor(raw, actor);
      throw error;
    }
    if (frame.locked) await assertLockedProfileActor(raw, actor);
    return result;
  };
  const tx = new Proxy(raw, { get(target, key) {
    const value = Reflect.get(target, key, target);
    if (typeof value === "function") return (...args: unknown[]) => after(() => Reflect.apply(value, target, args) as PromiseLike<unknown>);
    if (value && typeof value === "object" && typeof key === "string" && !key.startsWith("_")) {
      let delegate = delegates.get(key);
      if (!delegate) {
        const capturedDelegate = new Proxy(value, { get(model, method) {
          const query = Reflect.get(model, method, model);
          return typeof query === "function" ? (...args: unknown[]) => after(() => Reflect.apply(query, model, args) as PromiseLike<unknown>) : query;
        } });
        delegates.set(key, capturedDelegate);
        delegate = capturedDelegate;
      }
      return delegate;
    }
    return value;
  } });
  frames.set(tx, frame);
  return tx;
}
function conflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034"
    || error.code === "P2010" && ["40001", "40P01"].includes(String(error.meta?.code)));
}
export async function withDealSession<T>(session: DealSession, write: boolean, operation: (tx: Tx) => Promise<T>): Promise<T> {
  const client = session.options.client ?? prisma;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await client.$transaction(async raw => {
        const tx = guardedTransaction(raw, session.actor);
        try {
          const result = await operation(tx);
          await assertDealSession(tx);
          return result;
        } catch (error) {
          if (!(error instanceof Prisma.PrismaClientKnownRequestError) && frames.get(tx)?.locked) await assertDealSession(tx);
          throw error;
        }
      }, { isolationLevel: write ? "Serializable" : "RepeatableRead", maxWait: 10000, timeout: 20000 });
    } catch (error) {
      // This is after transaction rollback. Even an aborted SQL callback error
      // must not substitute for a now-invalid native session.
      await checkProfileActor(session.actor, { client });
      if (!conflict(error) && !(error instanceof DealCaptureChanged)) throw error;
      // A changed snapshot is retried only after current native authentication.
      if (attempt === 2) throw new DealError("RETRY_REQUIRED", 503);
    }
  }
  throw new DealError("RETRY_REQUIRED", 503);
}
