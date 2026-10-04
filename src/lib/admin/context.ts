import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { Session } from "@/lib/jwt";
import { AdminReadError } from "./contracts";

export type AdminActor = Pick<Session, "userId" | "role" | "sessionId" | "sessionVersion">;
export type AdminOptions = { client?: PrismaClient; now?: Date };
type Tx = Prisma.TransactionClient;
const ActorSchema = z.object({ userId: z.string().min(1).max(200), role: z.enum(["ADMIN", "BRAND", "CREATOR"]), sessionId: z.string().regex(/^[A-Za-z0-9_-]{43}$/), sessionVersion: z.number().int().positive().max(2147483647) }).strict();
function claimsFor(actor: AdminActor) {
  const parsed = ActorSchema.safeParse(actor && { userId: actor.userId, role: actor.role, sessionId: actor.sessionId, sessionVersion: actor.sessionVersion });
  if (!parsed.success) throw new AdminReadError("UNAUTHENTICATED", 401);
  return parsed.data;
}
async function authorized(tx: Tx, claims: AdminActor) {
  const user = await tx.user.findUnique({ where: { id: claims.userId }, select: { active: true, role: true, sessionVersion: true } });
  const session = await tx.authSession.findUnique({ where: { id: claims.sessionId } });
  if (!user?.active || !session || session.userId !== claims.userId || session.revokedAt || session.expiresAt <= new Date() || session.version !== claims.sessionVersion || user.sessionVersion !== claims.sessionVersion || user.role !== claims.role) throw new AdminReadError("UNAUTHENTICATED", 401);
  if (user.role !== "ADMIN") throw new AdminReadError("FORBIDDEN", 403);
}
function conflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2010" && ["40001", "40P01"].includes(String(error.meta?.code)))) throw new AdminReadError("RETRY_REQUIRED", 503);
  throw error;
}
export async function adminRead<T>(actor: AdminActor, options: AdminOptions, load: (tx: Tx, asOf: Date) => Promise<T>): Promise<T> {
  const claims = claimsFor(actor);
  if (options.now && !Number.isFinite(options.now.getTime())) throw new AdminReadError("INVALID_CLOCK", 400);
  try {
    return await (options.client ?? prisma).$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${claims.userId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${claims.sessionId} FOR SHARE`;
      await authorized(tx, claims);
      const result = await load(tx, options.now ?? new Date());
      await authorized(tx, claims);
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 20000 });
  } catch (error) { return conflict(error); }
}
export async function adminUserWrite<T>(actor: AdminActor, targetId: string, options: Pick<AdminOptions, "client">, mutate: (tx: Tx, now: Date) => Promise<T>): Promise<T> {
  const claims = claimsFor(actor);
  try {
    return await (options.client ?? prisma).$transaction(async tx => {
      // Match evidence review: non-admin target owner first, then ADMIN actor.
      // Preliminary authorization denies invalid callers before target lookup.
      await authorized(tx, claims);
      if (targetId === claims.userId) throw new AdminReadError("PROTECTED_ACCOUNT", 403);
      const initial = await tx.user.findUnique({ where: { id: targetId }, select: { role: true } });
      if (!initial) throw new AdminReadError("NOT_FOUND", 404);
      if (initial.role === "ADMIN") throw new AdminReadError("PROTECTED_ACCOUNT", 403);
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${targetId} FOR UPDATE`;
      const target = await tx.user.findUnique({ where: { id: targetId }, select: { role: true } });
      if (!target) { await authorized(tx, claims); throw new AdminReadError("NOT_FOUND", 404); }
      if (target.role === "ADMIN") { await authorized(tx, claims); throw new AdminReadError("PROTECTED_ACCOUNT", 403); }
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${claims.userId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${claims.sessionId} FOR SHARE`;
      await authorized(tx, claims);
      const result = await mutate(tx, new Date());
      await authorized(tx, claims);
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 20000 });
  } catch (error) { return conflict(error); }
}
