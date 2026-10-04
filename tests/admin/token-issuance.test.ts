import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { AuthenticationInvalidated, consumeToken, issueToken, openSession, resolveSession, type TokenPurpose } from "@/lib/identity";
import { changeAdminUserStatus } from "@/lib/admin/users";
import type { AdminActor } from "@/lib/admin/context";
import { cleanup, users } from "../deals/fixtures";

afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.adminCommand.deleteMany({ where: { actorUserId: { in: users } } });
  await cleanup();
});

function latch() {
  let release!: () => void;
  return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
}

async function setup() {
  const adminId = randomUUID(), targetId = randomUUID(); users.push(adminId, targetId);
  const target = await prisma.user.create({ data: { id: targetId, name: "حساب اختبار إصدار الرابط", email: `${targetId}@example.invalid`, passwordHash: "not-a-login", role: "BRAND", isTest: true } });
  const admin = await prisma.user.create({ data: { id: adminId, name: "Synthetic token race administrator", email: `${adminId}@example.invalid`, passwordHash: "not-a-login", role: "ADMIN", isTest: true } });
  const signed = await openSession(admin.id, admin.sessionVersion, admin.passwordHash), current = await resolveSession(signed);
  if (!current) throw new Error("Synthetic native administrator session did not resolve");
  const actor: AdminActor = { userId: current.userId, role: current.role, sessionId: current.sessionId, sessionVersion: current.sessionVersion };
  return { actor, target };
}

// Either the unlocked status sequence completes, or correct issuance serialization
// holds its User lock and the native status command demonstrably waits behind it.
// Releasing in either case avoids turning the fixed implementation into a deadlock.
async function sequenceCompletedOrNativeWait(completed: () => boolean): Promise<"COMPLETED" | "LOCK_WAIT"> {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (completed()) return "COMPLETED";
    const waiting = await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%"User"%' AND query LIKE '%FOR UPDATE%'`;
    if (waiting[0]?.count) return "LOCK_WAIT";
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Neither the actual status sequence nor its native User lock wait was observed");
}

it.each(["VERIFY_EMAIL", "RESET_PASSWORD"] satisfies TokenPurpose[])("pre-change %s issuance cannot escape genuine suspension/reactivation revocation through active-state ABA", async purpose => {
  const f = await setup(), readEntered = latch(), releaseRead = latch();
  const nativeRead = prisma.user.findUniqueOrThrow.bind(prisma.user);
  let captured = false, readWasActive = false, statusCompleted = false;
  // Return the exact native User result. Only scheduling changes; no token,
  // command, actor authorization or database response is fabricated.
  const issuerRead = vi.spyOn(prisma.user, "findUniqueOrThrow").mockImplementation((async (args: Parameters<typeof prisma.user.findUniqueOrThrow>[0]) => {
    const saved = await nativeRead(args);
    if (!captured && args.where.id === f.target.id) {
      captured = true; readWasActive = "active" in saved && saved.active === true;
      readEntered.release(); await releaseRead.promise;
    }
    return saved;
  }) as unknown as typeof prisma.user.findUniqueOrThrow);
  const issuing = issueToken(f.target.id, purpose).then(
    token => ({ token, invalidated: false }),
    error => ({ token: null, invalidated: error instanceof AuthenticationInvalidated }),
  );
  let changing: Promise<{ versions: number[]; succeeded: boolean }> | undefined;
  try {
    expect(await Promise.race([readEntered.promise.then(() => true), issuing.then(() => false)])).toBe(true);
    expect(readWasActive).toBe(true);
    changing = (async () => {
      const suspended = await changeAdminUserStatus(f.actor, f.target.id, { operationKey: randomUUID(), expectedActive: true, expectedVersion: 1, active: false, reason: { text: "Synthetic issuance suspension", language: "en" } });
      const reactivated = await changeAdminUserStatus(f.actor, f.target.id, { operationKey: randomUUID(), expectedActive: false, expectedVersion: suspended.statusVersion, active: true, reason: { text: "Synthetic issuance reactivation", language: "en" } });
      return [suspended.statusVersion, reactivated.statusVersion];
    })().then(versions => ({ versions, succeeded: true }), () => ({ versions: [], succeeded: false })).finally(() => { statusCompleted = true; });
    const ordering = await sequenceCompletedOrNativeWait(() => statusCompleted);
    expect(["COMPLETED", "LOCK_WAIT"].includes(ordering)).toBe(true);
    releaseRead.release();
    const statuses = await changing, issued = await issuing;
    expect(statuses).toEqual({ versions: [2, 3], succeeded: true });
    if (!issued.token) expect(issued.invalidated).toBe(true);
    const unusedBeforeConsumption = await prisma.authToken.count({ where: { userId: f.target.id, usedAt: null } });
    // Exercise real token hashing, native claim and current-owner checks even on
    // the defective path; failure assertions expose booleans, never token bytes.
    const consumed = issued.token ? await consumeToken(purpose, issued.token.value, purpose === "RESET_PASSWORD" ? "Synthetic-new-password-2026" : undefined) : null;
    expect(consumed === null).toBe(true);
    expect(unusedBeforeConsumption).toBe(0);
    const target = await prisma.user.findUniqueOrThrow({ where: { id: f.target.id } });
    expect({ active: target.active, sessionVersion: target.sessionVersion, emailVerified: target.emailVerifiedAt !== null }).toEqual({ active: true, sessionVersion: 3, emailVerified: false });
    expect(target.passwordHash === f.target.passwordHash).toBe(true);
    expect(await prisma.adminCommand.count({ where: { actorUserId: f.actor.userId } })).toBe(2);
    expect(await prisma.adminAudit.count({ where: { actorUserId: f.actor.userId, resourceType: "User", resourceId: f.target.id } })).toBe(2);
    expect(await prisma.outboxEvent.count({ where: { payload: { path: ["actorUserId"], equals: f.actor.userId } } })).toBe(2);
  } finally {
    releaseRead.release();
    await changing; await issuing;
    issuerRead.mockRestore();
  }
});
