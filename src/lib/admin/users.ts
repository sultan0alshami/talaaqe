import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { canonicalHash, inputJson } from "@/lib/onboarding/drafts";
import { adminRead, adminUserWrite, type AdminActor, type AdminOptions } from "./context";
import { AdminReadError, AdminUsersSchema, AdminUsersQuerySchema, AdminUserStatusCommandSchema, AdminUserStatusResultSchema } from "./contracts";

export function parseAdminUsersQuery(input: unknown) {
  const parsed = AdminUsersQuerySchema.safeParse(input);
  if (!parsed.success) throw new AdminReadError("VALIDATION", 422);
  return parsed.data;
}
export async function getAdminUsers(actor: AdminActor, input: unknown = {}, options: AdminOptions = {}) {
  return adminRead(actor, options, async (tx, asOf) => {
    const query = parseAdminUsersQuery(input);
    const rows = await tx.user.findMany({ where: query.after ? { id: { gt: query.after } } : undefined, orderBy: { id: "asc" }, take: 31,
      select: { id: true, name: true, email: true, role: true, active: true, sessionVersion: true, createdAt: true } });
    const result = AdminUsersSchema.parse({ asOf: asOf.toISOString(), selfId: actor.userId,
      users: rows.slice(0, 30).map(row => ({ id: row.id, name: row.name, email: row.email, role: row.role, active: row.active, statusVersion: row.sessionVersion, joined: row.createdAt.toISOString() })),
      nextCursor: rows.length > 30 ? rows[29].id : null });
    await tx.adminAudit.create({ data: { actorUserId: actor.userId, action: "admin.users_accessed", resourceType: "UserList", resourceId: "platform",
      snapshot: { asOf: result.asOf, after: query.after ?? null, returned: result.users.length, nextCursor: result.nextCursor, scope: "ALL_STORED_RECORDS" } } });
    return result;
  });
}
export async function changeAdminUserStatus(actor: AdminActor, targetUserId: string, input: unknown, options: Pick<AdminOptions, "client"> = {}) {
  try {
    return await adminUserWrite(actor, targetUserId, options, async (tx, now) => {
      const parsed = AdminUserStatusCommandSchema.safeParse(input);
      if (!parsed.success) throw new AdminReadError("VALIDATION", 422);
      const command = parsed.data;
      const hash = canonicalHash({ purpose: "ADMIN_USER_STATUS_V1", targetUserId, command });
      const previous = await tx.adminCommand.findUnique({ where: { actorUserId_operationKey: { actorUserId: actor.userId, operationKey: command.operationKey } } });
      if (previous) {
        if (previous.payloadHash !== hash || previous.resourceId !== targetUserId) throw new AdminReadError("IDEMPOTENCY_CONFLICT", 409);
        return { ...AdminUserStatusResultSchema.parse(previous.resultJson), replayed: true };
      }
      const target = await tx.user.findUniqueOrThrow({ where: { id: targetUserId }, select: { active: true, sessionVersion: true } });
      if (target.active !== command.expectedActive || target.sessionVersion !== command.expectedVersion) throw new AdminReadError("STALE_VERSION", 409);
      if (target.sessionVersion === 2147483647) throw new AdminReadError("VERSION_EXHAUSTED", 409);
      const user = await tx.user.update({ where: { id: targetUserId }, data: { active: command.active, sessionVersion: { increment: 1 } } });
      await tx.authSession.updateMany({ where: { userId: targetUserId, revokedAt: null }, data: { revokedAt: now } });
      await tx.authToken.updateMany({ where: { userId: targetUserId, usedAt: null }, data: { usedAt: now } });
      const result = AdminUserStatusResultSchema.parse({ userId: targetUserId, active: user.active, statusVersion: user.sessionVersion, appliedAt: now.toISOString(), replayed: false });
      await tx.adminCommand.create({ data: { actorUserId: actor.userId, operationKey: command.operationKey, payloadHash: hash, resourceId: targetUserId, resultJson: inputJson(result), createdAt: now } });
      const type = user.active ? "account.reactivated" : "account.suspended";
      const envelope = { id: randomUUID(), type, actorUserId: actor.userId, aggregateType: "User", aggregateId: targetUserId,
        aggregateVersion: user.sessionVersion, idempotencyKey: command.operationKey, occurredAt: now.toISOString() };
      await tx.adminAudit.create({ data: { actorUserId: actor.userId, action: type, resourceType: "User", resourceId: targetUserId,
        snapshot: inputJson({ ...envelope, payload: { previousActive: target.active, active: user.active, reason: command.reason } }), createdAt: now } });
      await tx.outboxEvent.create({ data: { deduplicationKey: "admin-status:" + actor.userId + ":" + command.operationKey, type,
        payload: inputJson({ ...envelope, payload: { previousActive: target.active, active: user.active } }), createdAt: now, availableAt: now } });
      return result;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && error.meta?.modelName === "AdminCommand") throw new AdminReadError("IDEMPOTENCY_CONFLICT", 409);
    throw error;
  }
}
