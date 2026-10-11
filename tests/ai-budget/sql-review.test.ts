import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { createAiBudgetLedger } from "@/lib/ai-budget/ledger";
import type { AiActor } from "@/lib/ai-budget/contracts";
const users: string[] = [];
const pricing = { version: "sql-fixture-v1", modelId: "synthetic-no-provider", asOf: "2026-10-04", currency: "USD", prices: [{ unit: "REQUESTS", quantity: "1", priceMicros: "10" }] };
async function fixture() {
  const userId = randomUUID(); users.push(userId);
  const user = await prisma.user.create({ data: { id: userId, role: "CREATOR", active: true, isTest: true, name: "SQL budget fixture", email: `${userId}@example.invalid`, passwordHash: "no-login" } });
  const token = await openSession(user.id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Owned native SQL budget session failed to resolve");
  const actor: AiActor = Object.freeze({ userId: session.userId, role: session.role, sessionVersion: session.sessionVersion, sessionId: session.sessionId });
  const ledger = createAiBudgetLedger({ caps: { userDailyMicros: "10000", platformDailyMicros: "100000" } });
  const reserved = await ledger.reserve(actor, { operationKey: randomUUID(), payloadHash: "b".repeat(64), purpose: "BRIEF", reservedMicros: "100", pricing,
    context: { resourceType: "SYSTEM", resourceId: "sql-fixture", sourceRevision: 1 }, executionTimeoutMs: 60000 });
  return { actor, ledger, id: reserved.reservation.id };
}
afterEach(async () => {
  await prisma.aiReservation.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } }); users.length = 0;
});
describe("independent AI ledger SQL defenses", () => {
  it("rejects altered reservation identity, malformed terminal costs and an overwritten execution claim", async () => {
    const f = await fixture();
    for (const data of [{ purpose: "SPEECH" }, { payloadHash: "a".repeat(64) }, { reservedMicros: BigInt(1) }, { status: "SETTLED" }]) {
      await expect(prisma.aiReservation.update({ where: { id: f.id }, data })).rejects.toBeDefined();
    }
    const claim = await f.ledger.claim(f.actor, f.id);
    const row = await prisma.aiReservation.findUniqueOrThrow({ where: { id: f.id } });
    await expect(prisma.aiReservation.update({ where: { id: f.id }, data: { result: { ...(row.result as object), executionTokenHash: "0".repeat(64) } } })).rejects.toBeDefined();
    await f.ledger.settle(claim.executionToken, { reservationId: f.id, actualMicros: "10", usage: [{ unit: "REQUESTS", quantity: "1" }], pricing });
    await expect(prisma.aiReservation.update({ where: { id: f.id }, data: { actualMicros: BigInt(9) } })).rejects.toBeDefined();
    await expect(prisma.aiReservation.update({ where: { id: f.id }, data: { status: "RUNNING", actualMicros: null, settledAt: null } })).rejects.toBeDefined();
  });
  it("rejects a second live reservation for one user's same purpose and payload even under a different operation key", async () => {
    const f = await fixture(), row = await prisma.aiReservation.findUniqueOrThrow({ where: { id: f.id } });
    await expect(prisma.aiReservation.create({ data: { ...row, id: randomUUID(), operationKey: randomUUID(), result: row.result as object } })).rejects.toBeDefined();
    await f.ledger.releaseUnclaimed(f.actor, f.id);
    // Releasing a known unclaimed request permits a new legitimate attempt.
    await expect(prisma.aiReservation.create({ data: { ...row, id: randomUUID(), operationKey: randomUUID(), result: row.result as object } })).resolves.toMatchObject({ status: "RESERVED" });
  });
});
