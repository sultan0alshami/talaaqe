// Ignored candidate: native User identity prerequisite only, exactly two groups.
// Root alone adopts/runs. Real native sessions and ledger APIs on the guarded
// disposable target; synthetic accounting, no provider or scope activation.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { captureOrganizationActor } from "@/lib/organizations/context";
import { OrganizationIdSchema } from "@/lib/organizations/contracts";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { createAiBudgetLedger } from "@/lib/ai-budget/ledger";
import { AiActorSchema, AiLedgerMetadataSchema, NoCallSchema, QuarantineSchema,
  ReconcileSchema, ReserveAiSchema, ResolveOverrunSchema, SettlementSchema, type AiActor } from "@/lib/ai-budget/contracts";

const ownedUsers = new Set<string>(), executionTokens = new Map<string, string>();
const pricing = { version: "native-user-identity-synthetic-v1", modelId: "synthetic-no-provider", asOf: "2001-04-01", currency: "USD" as const,
  prices: [{ unit: "REQUESTS" as const, quantity: "1", priceMicros: "5" }] };
const caps = { userDailyMicros: "1000000", platformDailyMicros: "1000000000" };
// Accounting clock only. Native session validity always uses the actual clock.
const ledger = () => createAiBudgetLedger({ now: () => new Date("2001-04-07T23:59:00.000Z"), caps });
function broadId(length = 200) {
  const prefix = "native*user-" + randomUUID();
  return prefix + "x".repeat(length - prefix.length);
}
function command() {
  return { operationKey: randomUUID(), purpose: "CAMPAIGN_CHAT" as const,
    payloadHash: createHash("sha256").update(randomUUID()).digest("hex"), reservedMicros: "100", pricing,
    context: { resourceType: "SYSTEM" as const, resourceId: "native-user-identity-only", sourceRevision: 1 }, executionTimeoutMs: 60000 };
}
async function nativeSession(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const token = await openSession(user.id, user.sessionVersion, user.passwordHash);
  const resolved = await resolveSession(token);
  if (!resolved) throw new Error("Owned native identity session failed to resolve");
  // Preserve the real native tuple even when this deliberate boundary fixture
  // exceeds OrganizationIdSchema; its rejection must happen in the ledger.
  const actor = OrganizationIdSchema.safeParse(resolved.userId).success
    ? captureOrganizationActor(resolved) as AiActor
    : { userId: resolved.userId, role: resolved.role, sessionVersion: resolved.sessionVersion, sessionId: resolved.sessionId } as AiActor;
  return { token, actor };
}
async function fixture(role: AiActor["role"] = "BRAND", userId = broadId()) {
  ownedUsers.add(userId);
  await prisma.user.create({ data: { id: userId, role, active: true, isTest: true, name: "Synthetic native identity actor",
    email: randomUUID() + "@example.invalid", passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  return { userId, ...await nativeSession(userId) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function observe(operation: () => Promise<unknown>) {
  try { await operation(); return { accepted: true, code: "ACCEPTED", status: 200 }; }
  catch (error) { const value = error as { code?: string; status?: number }; return { accepted: false, code: value.code ?? "OTHER_ERROR", status: value.status ?? 0 }; }
}
const unauthorized = { accepted: false, code: "UNAUTHENTICATED", status: 401 };
const forbidden = { accepted: false, code: "FORBIDDEN", status: 403 };
async function image() {
  const rows = await prisma.aiReservation.findMany({ where: { userId: { in: [...ownedUsers] } }, orderBy: { id: "asc" } });
  const audits = await prisma.adminAudit.findMany({ where: { resourceType: "AI_RESERVATION", resourceId: { in: rows.map(row => row.id) } }, orderBy: { id: "asc" } });
  return createHash("sha256").update(JSON.stringify({ rows, audits }, (_name, value: unknown) => typeof value === "bigint" ? value.toString() : value)).digest("hex");
}
function noSecrets(value: unknown, actors: Fixture[], tokens: string[] = []) {
  const encoded = JSON.stringify(value);
  for (const secret of [...actors.flatMap(actor => [actor.actor.sessionId, actor.token]), ...tokens])
    expect(encoded.includes(secret), "Native credentials remain absent from projection").toBe(false);
}

beforeAll(async () => {
  const taskId = process.env.INFAME_TASK_ID;
  if (!taskId || !/^infame_[a-f0-9]{12}$/.test(taskId) || process.env.INFAME_ENV !== "test" || process.env.NODE_ENV === "production")
    throw new Error("Native identity fixture requires guarded test task");
  const rows = await prisma.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]?.id !== taskId || rows[0]?.kind !== "test" || rows[0]?.db !== taskId + "_test" || rows[0]?.host !== "127.0.0.1")
    throw new Error("Native identity disposable target mismatch");
});
afterEach(async () => {
  const service = ledger();
  const rows = await prisma.aiReservation.findMany({ where: { userId: { in: [...ownedUsers] } } });
  let cleanupAdmin: Fixture | undefined;
  // Resolve owned synthetic accounting through its actual APIs before deletion.
  // A failed assertion never licenses deleting an unresolved reservation.
  for (const row of rows) {
    if (row.status === "RESERVED") await service.releaseUnclaimed((await nativeSession(row.userId)).actor, row.id);
    if (row.status === "RUNNING") {
      const token = executionTokens.get(row.id);
      if (!token) throw new Error("Owned unresolved claim has no retained cleanup credential");
      await service.releaseKnownNoCall(token, { reservationId: row.id, reason: "FAILED_BEFORE_INVOCATION" });
    }
    if (row.status === "UNKNOWN") {
      cleanupAdmin ??= await fixture("ADMIN", randomUUID());
      await service.reconcile(cleanupAdmin.actor, { reservationId: row.id, reviewReference: "synthetic-fixture-cleanup", resolution: { kind: "NO_CHARGE" } });
    }
  }
  const terminal = await prisma.aiReservation.findMany({ where: { userId: { in: [...ownedUsers] } }, select: { id: true, status: true } });
  if (terminal.some(row => row.status !== "SETTLED" && row.status !== "RELEASED")) throw new Error("Owned accounting cleanup requires terminal rows");
  await prisma.adminAudit.deleteMany({ where: { resourceType: "AI_RESERVATION", resourceId: { in: terminal.map(row => row.id) }, actorUserId: { in: [...ownedUsers] } } });
  await prisma.aiReservation.deleteMany({ where: { id: { in: terminal.map(row => row.id) }, userId: { in: [...ownedUsers] } } });
  await prisma.authSession.deleteMany({ where: { userId: { in: [...ownedUsers] } } });
  await prisma.user.deleteMany({ where: { id: { in: [...ownedUsers] } } });
  ownedUsers.clear(); executionTokens.clear();
});

describe("AI ledger exact native User identity prerequisite", () => {
  it("accepts genuine 200-character Users without aliasing owner or ADMIN reconciliation identity and preserves original command hashes", async () => {
    const service = ledger(), owner = await fixture(), admin = await fixture("ADMIN"), creator = await fixture("CREATOR");
    for (const actor of [owner, admin, creator]) {
      expect(actor.userId.length === 200 && actor.userId.includes("*")).toBe(true);
      expect(OrganizationIdSchema.safeParse(actor.userId).success).toBe(true);
      expect(/^[A-Za-z0-9_-]{43}$/.test(actor.actor.sessionId)).toBe(true);
      expect((await resolveSession(actor.token))?.userId).toBe(actor.userId);
    }
    const input = command(), expectedHash = canonicalHash(ReserveAiSchema.parse(input));
    // First meaningful baseline: native open/resolve succeeded, but the old
    // accounting actor grammar refuses this exact real User before reservation.
    const reserved = await service.reserve(owner.actor, input);
    expect(reserved.replayed).toBe(false);
    const original = await prisma.aiReservation.findUniqueOrThrow({ where: { id: reserved.reservation.id } });
    const before = AiLedgerMetadataSchema.parse(original.result);
    expect(original.userId).toBe(owner.userId); expect(original.operationKey).toBe(input.operationKey);
    expect(before.requestHash).toBe(expectedHash); expect(before.reconciliation).toBeNull();
    expect(AiActorSchema.safeParse(owner.actor).success).toBe(true);
    for (const f of [admin, creator]) noSecrets(await service.read(f.actor), [f]);
    const execution = await service.claim(owner.actor, original.id); executionTokens.set(original.id, execution.executionToken);
    expect(/^[A-Za-z0-9_-]{43}$/.test(execution.executionToken)).toBe(true);
    const running = await prisma.aiReservation.findUniqueOrThrow({ where: { id: original.id } }), runningMetadata = AiLedgerMetadataSchema.parse(running.result);
    expect(running.userId).toBe(owner.userId); expect(running.status).toBe("RUNNING");
    expect(runningMetadata.requestHash).toBe(expectedHash);
    await service.quarantine(execution.executionToken, { reservationId: original.id, reason: "BILLING_UNCERTAIN" });
    const review = { reservationId: original.id, reviewReference: "native-identity-review", resolution: { kind: "NO_CHARGE" as const } };
    const reconciled = await service.reconcile(admin.actor, review);
    expect(reconciled.replayed).toBe(false); expect(reconciled.reservation.status).toBe("RELEASED");
    const terminal = await prisma.aiReservation.findUniqueOrThrow({ where: { id: original.id } });
    const terminalMetadata = AiLedgerMetadataSchema.parse(terminal.result);
    expect(terminal.userId).toBe(owner.userId); expect(terminal.actualMicros).toBe(BigInt(0));
    expect(terminalMetadata.requestHash).toBe(expectedHash);
    expect(terminalMetadata.reconciliation?.adminUserId).toBe(admin.userId);
    expect(terminalMetadata.executionTokenHash).toBe(runningMetadata.executionTokenHash);
    expect(canonicalHash(terminalMetadata.pricing)).toBe(canonicalHash(pricing));
    expect(canonicalHash(terminalMetadata.context)).toBe(canonicalHash(input.context));
    const audit = await prisma.adminAudit.findUniqueOrThrow({ where: { id: terminalMetadata.reconciliation!.auditId } });
    expect(audit.actorUserId).toBe(admin.userId); expect(audit.action).toBe("AI_BILLING_RECONCILED");
    expect(audit.resourceId).toBe(original.id); expect(audit.resourceType).toBe("AI_RESERVATION");
    const accepted = await image();
    expect((await service.reconcile(admin.actor, review)).replayed).toBe(true); expect(await image()).toBe(accepted);
    await prisma.authSession.update({ where: { id: owner.actor.sessionId }, data: { revokedAt: new Date() } });
    expect(await resolveSession(owner.token)).toBeNull();
    const renewal = { userId: owner.userId, ...await nativeSession(owner.userId) };
    const replay = await service.reserve(renewal.actor, input);
    expect(replay.replayed).toBe(true); expect(replay.reservation.id).toBe(original.id); expect(await image()).toBe(accepted);
    noSecrets({ result: terminal.result, audit, summary: await service.read(renewal.actor) }, [owner, renewal, admin, creator], [execution.executionToken]);
  }, 30000);

  it("keeps native denial before malformed input and leaves ledger operation, pricing, context, reservation and review identifiers narrow", async () => {
    const service = ledger(), owner = await fixture(), admin = await fixture("ADMIN"), creator = await fixture("CREATOR");
    const badInput = { unexpected: "malformed-native-identity-command" }, original = await image();
    const forged = [undefined, null, { ...owner.actor, userId: broadId(201) },
      ...["unsafe id", "\nunsafe", "هوية", ""].map(userId => ({ ...owner.actor, userId })),
      { ...owner.actor, sessionId: randomUUID() }, { ...owner.actor, sessionId: randomBytes(32).toString("base64url") },
      { ...owner.actor, userId: creator.userId }, { ...owner.actor, role: "ADMIN" }, { ...owner.actor, sessionVersion: owner.actor.sessionVersion + 1 }];
    for (const actor of forged) expect(await observe(() => service.reserve(actor, badInput))).toEqual(unauthorized);
    expect(await image()).toBe(original);
    // Actual native 201-character User+session exists, but the integration
    // boundary intentionally accepts only central 1..200 printable ASCII IDs.
    const overlong = await fixture("BRAND", broadId(201));
    expect((await resolveSession(overlong.token))?.userId).toBe(overlong.userId);
    expect(OrganizationIdSchema.safeParse(overlong.userId).success).toBe(false);
    expect(await observe(() => service.reserve(overlong.actor, badInput))).toEqual(unauthorized);
    for (const state of ["INACTIVE", "EXPIRED", "VERSION", "ROLE"] as const) {
      const current = await fixture();
      if (state === "INACTIVE") await prisma.user.update({ where: { id: current.userId }, data: { active: false } });
      if (state === "EXPIRED") await prisma.authSession.update({ where: { id: current.actor.sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      if (state === "VERSION") await prisma.user.update({ where: { id: current.userId }, data: { sessionVersion: { increment: 1 } } });
      if (state === "ROLE") await prisma.user.update({ where: { id: current.userId }, data: { role: "CREATOR" } });
      expect(await resolveSession(current.token)).toBeNull();
      expect(await observe(() => service.reserve(current.actor, badInput))).toEqual(unauthorized);
      expect(await observe(() => service.claim(current.actor, "["))).toEqual(unauthorized);
    }
    for (const current of [owner, creator]) expect(await observe(() => service.reconcile(current.actor, {}))).toEqual(forbidden);
    const input = command(), accepted = await image();
    for (const narrowValue of ["native*ledger-id", "n".repeat(129)]) {
      const commands = [{ ...input, operationKey: narrowValue }, { ...input, pricing: { ...pricing, version: narrowValue } },
        { ...input, pricing: { ...pricing, modelId: narrowValue } }, { ...input, context: { ...input.context, resourceId: narrowValue } }];
      for (const invalid of commands) {
        expect(ReserveAiSchema.safeParse(invalid).success).toBe(false);
        await expect(service.reserve(owner.actor, invalid)).rejects.toMatchObject({ name: "ZodError" });
      }
      for (const schemaInput of [
        [SettlementSchema, { reservationId: narrowValue, actualMicros: "0", usage: [{ unit: "REQUESTS", quantity: "0" }], pricing }],
        [NoCallSchema, { reservationId: narrowValue, reason: "FAILED_BEFORE_INVOCATION" }],
        [QuarantineSchema, { reservationId: narrowValue, reason: "BILLING_UNCERTAIN" }],
        [ReconcileSchema, { reservationId: narrowValue, reviewReference: "opaque-review", resolution: { kind: "NO_CHARGE" } }],
        [ResolveOverrunSchema, { reservationId: narrowValue, expectedActualMicros: "0", reviewReference: "opaque-review" }],
      ] as const) expect(schemaInput[0].safeParse(schemaInput[1]).success).toBe(false);
      const invalidReview = { reservationId: "opaque-missing-reservation", reviewReference: narrowValue, resolution: { kind: "NO_CHARGE" } };
      expect(ReconcileSchema.safeParse(invalidReview).success).toBe(false);
      await expect(service.reconcile(admin.actor, invalidReview)).rejects.toMatchObject({ name: "ZodError" });
      expect(await observe(() => service.claim(owner.actor, narrowValue))).toEqual({ accepted: false, code: "NOT_FOUND", status: 400 });
      const metadata = { schemaVersion: 1, actorRole: "BRAND", actorSessionVersion: 1,
        requestHash: canonicalHash(ReserveAiSchema.parse(input)), pricing, context: input.context, executionTimeoutMs: input.executionTimeoutMs,
        executionTokenHash: null, claimedAt: null, deadlineAt: null, quarantineReason: null, settlementHash: null, usage: null,
        settlementPricing: null, estimatedActualMicros: null, noCallReason: null, overrun: false, overrunResolved: false,
        reconciliation: { adminUserId: admin.userId, reviewReference: "opaque-review", auditId: "opaque-audit", resolvedAt: new Date().toISOString(), kind: "NO_CHARGE" } };
      expect(AiLedgerMetadataSchema.safeParse(metadata).success).toBe(true);
      expect(AiLedgerMetadataSchema.safeParse({ ...metadata, reconciliation: { ...metadata.reconciliation, reviewReference: narrowValue } }).success).toBe(false);
      expect(AiLedgerMetadataSchema.safeParse({ ...metadata, reconciliation: { ...metadata.reconciliation, auditId: narrowValue } }).success).toBe(false);
    }
    expect(await image()).toBe(accepted);
  }, 45000);
});
