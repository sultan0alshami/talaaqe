import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma, PrismaClient } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { CampaignAgentStateSchema } from "@/lib/campaign-agent/contracts";
import { COMMERCIAL_POLICY_VERSION, PLANNING_PLANS } from "@/lib/commercial/contracts";

// Ignored independent author draft; root alone adopts/executes. This first slice
// contains Session/Operation only: no Attempt/Result, ledger or provider output.
// Raw native parent records are explicitly synthetic structural fixtures, never
// actual authentication/admission/provisioning. No invented AuthSession or token.
// Group1 rolls back everything. Group2 may retain bounded histories but releases
// every hold: no fake consumption, trial duration, grace or source-reset bypass.
type Table = "PlanningAiPool" | "PlanningAiEnrollment" | "PlanningAiSeat" | "PlanningAiCycle" | "PlanningAiSession" | "PlanningAiOperation";
type Db = PrismaClient | Prisma.TransactionClient;
type Fields = Record<string, unknown>;
const key = (prefix = "execution~*") => prefix + ":" + randomUUID();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const sessionTables = ["PlanningAiSession", "PlanningAiOperation"] as const;
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
const kinds = ["BRIEF", "STRATEGY", "IDEAS_PACK", "COMBINED_REFINEMENT"] as const;
beforeAll(async () => {
  const taskId = process.env.INFAME_TASK_ID;
  if (!taskId || !/^infame_[a-f0-9]{12}$/.test(taskId) || process.env.INFAME_ENV !== "test" || process.env.NODE_ENV === "production") throw new Error("Execution storage requires guarded test target");
  const rows = await prisma.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]?.id !== taskId || rows[0]?.kind !== "test" || rows[0]?.db !== taskId + "_test" || rows[0]?.host !== "127.0.0.1") throw new Error("Execution storage fixture target mismatch");
});
async function requireStorage() {
  for (const name of sessionTables) {
    const rows = await prisma.$queryRaw<Array<{ present: boolean }>>`SELECT to_regclass(${`"${name}"`}) IS NOT NULL AS present`;
    expect(rows[0]?.present === true, "Frozen native execution table must exist: " + name).toBe(true);
  }
}
function sqlValue(table: Table, column: string, input: unknown) {
  if (input === null) return Prisma.sql`NULL`;
  if (input instanceof Date) return Prisma.sql`${input.toISOString()}::timestamp(3)`;
  if (table === "PlanningAiSession" && column === "scope") return Prisma.sql`${input}::"PlanningWorkspaceScope"`;
  if (table === "PlanningAiSession" && column === "creationKey") return Prisma.sql`${input}::uuid`;
  return Prisma.sql`${input}`;
}
async function insert(db: Db, table: Table, fields: Fields) {
  const entries = Object.entries(fields);
  await db.$executeRaw(Prisma.sql`INSERT INTO ${Prisma.raw('"' + table + '"')}
    (${Prisma.join(entries.map(([name]) => Prisma.raw('"' + name + '"')))}) VALUES (${Prisma.join(entries.map(([name, input]) => sqlValue(table, name, input)))})`);
}
async function patch(db: Db, table: Table, id: string, fields: Fields) {
  await db.$executeRaw(Prisma.sql`UPDATE ${Prisma.raw('"' + table + '"')} SET
    ${Prisma.join(Object.entries(fields).map(([name, input]) => Prisma.sql`${Prisma.raw('"' + name + '"')}=${sqlValue(table, name, input)}`))} WHERE id=${id}`);
}
async function row(db: Db, table: Table, id: string) {
  return (await db.$queryRaw<Fields[]>(Prisma.sql`SELECT * FROM ${Prisma.raw('"' + table + '"')} WHERE id=${id}`))[0];
}
function rejected(error: unknown, codes: readonly string[]) {
  expect(error instanceof Prisma.PrismaClientKnownRequestError).toBe(true);
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw new Error("Expected actual native execution constraint error");
  expect(error.code).toBe("P2010"); expect(codes).toContain(String(error.meta?.code));
}
async function constrained(tx: Prisma.TransactionClient, action: () => Promise<unknown>, codes: readonly string[] = ["23514"]) {
  await tx.$executeRaw`SAVEPOINT execution_storage_witness`;
  let error: unknown = null; try { await action(); } catch (failure) { error = failure; }
  await tx.$executeRaw`ROLLBACK TO SAVEPOINT execution_storage_witness`;
  await tx.$executeRaw`RELEASE SAVEPOINT execution_storage_witness`; rejected(error, codes);
}
async function rollback(action: (tx: Prisma.TransactionClient) => Promise<void>) {
  const sentinel = new Error("Deliberate entire execution fixture rollback");
  try {
    await prisma.$transaction(async tx => { await action(tx); throw sentinel; }, { maxWait: 10000, timeout: 60000 });
    throw new Error("Execution fixture must not commit");
  } catch (error) { if (error !== sentinel) throw error; }
}
function next(saved: Fields, fields: Fields = {}) { return { revision: Number(saved.revision) + 1, updatedAt: saved.updatedAt, ...fields }; }
async function owner(db: Db, retained = false) {
  const id = randomUUID();
  return db.user.create({ data: { id, name: retained ? "Synthetic retained execution storage actor" : "Synthetic rolled-back execution actor",
    email: "exec-" + id + "@example.invalid", passwordHash: "test-only-no-login", role: "BRAND", active: true, isTest: true,
    emailVerifiedAt: new Date(Date.now() - 60000) } });
}
async function brand(db: Db, userId: string) {
  const id = randomUUID();
  return db.brand.create({ data: { id: "execution-brand~*:" + id, userId, slug: "exec-" + id,
    name: "Synthetic execution storage brand", state: "PRIVATE", isTest: true } });
}
type Subject = { kind: "OWN_BRAND"; brandId: string } | { kind: "CLIENT"; brandId: string; organizationId: string; clientId: string };
async function domain(tx: Prisma.TransactionClient, subject: Subject) {
  const at = new Date(), workspaceId = key("workspace~*"), campaignId = key("campaign~*"), agentId = key("agent~*"), selectionId = key("selection~*");
  await tx.planningWorkspace.create({ data: { id: workspaceId, scope: subject.kind, brandId: subject.brandId,
    organizationId: subject.kind === "CLIENT" ? subject.organizationId : null, clientId: subject.kind === "CLIENT" ? subject.clientId : null } });
  await tx.campaign.create({ data: { id: campaignId, brandId: subject.brandId, title: "Synthetic execution storage campaign",
    input: { schemaVersion: 1, fields: {}, fieldsRevision: 1, proposals: [], clarificationCount: 0 }, conversation: [] } });
  await tx.campaignPlanningBinding.create({ data: { campaignId, workspaceId, brandId: subject.brandId } });
  await tx.campaignContextSelection.create({ data: { id: selectionId, campaignId, workspaceId, revision: 1, contextVersionId: null, contentHash: null } });
  await tx.campaignPlanningState.create({ data: { campaignId, workspaceId, revision: 1, selectionId, selectionRevision: 1, updatedAt: at } });
  const scope = subject.kind === "OWN_BRAND" ? { kind: "OWN_BRAND" as const, brandId: subject.brandId } : { kind: "CLIENT" as const, clientId: subject.clientId };
  const content = { schemaVersion: 1, id: agentId, revision: 1, binding: { scope, workspaceId, campaignId },
    snapshot: { campaignRevision: 1, fieldsRevision: 1, planningRevision: 1,
      selection: { id: selectionId, revision: 1, kind: "NONE", versionId: null, contentHash: null },
      fieldsHash: canonicalHash({ domain: "infame-campaign-fields-v1", fields: {} }) }, fields: {},
    preferences: { input: "TEXT", output: "TEXT" }, assistance: { kind: "MANUAL_GUIDANCE", agent: "UNAVAILABLE" },
    textSourceReferences: [], confirmation: { kind: "UNCONFIRMED" }, updatedAt: at.toISOString() };
  const state = CampaignAgentStateSchema.parse({ ...content, stateHash: canonicalHash({ domain: "infame-campaign-agent-state-v1", ...content }) });
  await tx.campaignAgent.create({ data: { id: agentId, campaignId, workspaceId, revision: 1, state: state as unknown as Prisma.InputJsonValue,
    stateHash: state.stateHash, createdAt: at, updatedAt: at } });
  return { subject, workspaceId, campaignId, agentId };
}
type Domain = Awaited<ReturnType<typeof domain>>;
async function principal(tx: Prisma.TransactionClient, ownerUserId: string, subject: Subject, period: { startsAt: Date; endsAt: Date }) {
  const at = new Date(Date.now() - 1000), plan = PLANNING_PLANS[0], poolId = key("pool~*"), enrollmentId = key("enrollment~*"), cycleId = key("cycle~*");
  await insert(tx, "PlanningAiPool", { id: poolId, scope: subject.kind, brandId: subject.kind === "OWN_BRAND" ? subject.brandId : null,
    organizationId: subject.kind === "CLIENT" ? subject.organizationId : null, state: "ACTIVE", revision: 1, createdAt: at, updatedAt: at });
  const terms = { planId: plan.id, policyVersion: COMMERCIAL_POLICY_VERSION, priceVersion: "synthetic-execution-price~*:not-provisioned",
    netAmountMinor: BigInt(plan.netMonthly.amountMinor), currency: "SAR" };
  await insert(tx, "PlanningAiEnrollment", { id: enrollmentId, poolId, acceptingOwnerUserId: ownerUserId, subscriberUserId: ownerUserId, kind: "PAID",
    ...terms, state: "ACTIVE", revision: 1, acceptanceReference: key("synthetic-acceptance~*"), acceptanceHash: hash(randomUUID()), acceptedAt: at, createdAt: at, updatedAt: at });
  await insert(tx, "PlanningAiCycle", { id: cycleId, poolId, enrollmentId, trialClaimId: null, source: "MERCHANT",
    sourceEventId: key("synthetic-event~*"), subscriptionId: key("synthetic-subscription~*"), ...terms,
    allowance: plan.sessions, held: 0, consumed: 0, state: "ACTIVE", revision: 1, ...period, createdAt: at, updatedAt: at });
  return { poolId, enrollmentId, cycleId };
}
type Principal = Awaited<ReturnType<typeof principal>>;
async function seat(tx: Prisma.TransactionClient, principal: Principal, userId: string, membership: { id: string; organizationId: string } | null) {
  const at = new Date(), id = key("seat~*");
  await insert(tx, "PlanningAiSeat", { id, poolId: principal.poolId, userId, organizationId: membership?.organizationId ?? null,
    membershipId: membership?.id ?? null, state: "ACTIVE", revision: 1, createdAt: at, updatedAt: at });
  return { id, userId };
}
type Seat = Awaited<ReturnType<typeof seat>>;
function session(principal: Principal, context: Domain, creator: Seat, override: Fields = {}): Fields & { id: string } {
  const at = new Date(), subject = context.subject;
  return { id: key("session~*"), poolId: principal.poolId, cycleId: principal.cycleId, scope: subject.kind, brandId: subject.brandId,
    organizationId: subject.kind === "CLIENT" ? subject.organizationId : null, clientId: subject.kind === "CLIENT" ? subject.clientId : null,
    workspaceId: context.workspaceId, campaignId: context.campaignId, agentId: context.agentId,
    createdByUserId: creator.userId, creationSeatId: creator.id, creationKey: randomUUID(), allowanceState: "HELD",
    firstAttachedResultId: null, revision: 1, createdAt: at, updatedAt: at, ...override };
}
function operation(sessionId: string, kind = "REPLY", ordinal = 1, override: Fields = {}): Fields & { id: string } {
  const at = new Date();
  return { id: key("operation~*"), sessionId, kind, ordinal, state: "OPEN", successfulResultId: null, revision: 1, createdAt: at, updatedAt: at, ...override };
}
function latch<T>() { let resolve!: (input: T | PromiseLike<T>) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (input: T) => resolve(input) }; }

describe("planning execution first slice: independent native session/operation groups", () => {
  it("binds exact OWN/CLIENT creation seats and native agents, bounds14 inclusion slots and verifies deferred automatic counters", async () => {
    await requireStorage();
    await rollback(async tx => {
      const a = await owner(tx), b = await owner(tx), ownBrand = await brand(tx, a.id), targetBrand = await brand(tx, b.id);
      const organization = await tx.organization.create({ data: { id: key("organization~*"), ownerUserId: a.id, name: "Synthetic execution organization", kind: "BUSINESS" } });
      const membership = await tx.organizationMembership.create({ data: { id: key("membership~*"), organizationId: organization.id, userId: a.id, state: "ACTIVE" } });
      const client = await tx.organizationClient.create({ data: { id: key("client~*"), organizationId: organization.id, brandId: targetBrand.id,
        state: "ACTIVE", authorizingUserId: b.id, authorizingSessionVersion: b.sessionVersion,
        allowedCapabilities: { view: true, plan: true, approveShortlist: true, reviewContent: true, signCustomer: true, financial: true, manageGrants: true } } });
      const ownContext = await domain(tx, { kind: "OWN_BRAND", brandId: ownBrand.id });
      const clientContext = await domain(tx, { kind: "CLIENT", brandId: targetBrand.id, organizationId: organization.id, clientId: client.id });
      // This explicit synthetic paid period is not a trial TTL or launch policy.
      const period = { startsAt: new Date(Date.now() - 60000), endsAt: new Date(Date.now() + 3600000) };
      const ownPrincipal = await principal(tx, a.id, ownContext.subject, period), clientPrincipal = await principal(tx, a.id, clientContext.subject, period);
      const ownSeat = await seat(tx, ownPrincipal, a.id, null), clientSeat = await seat(tx, clientPrincipal, a.id, membership);
      const own = session(ownPrincipal, ownContext, ownSeat), delegated = session(clientPrincipal, clientContext, clientSeat);
      for (const change of [{ allowanceState: "RELEASED" }, { allowanceState: "CONSUMED" }, { firstAttachedResultId: key() }, { revision: 2 },
        { createdByUserId: b.id }, { creationSeatId: clientSeat.id }, { cycleId: clientPrincipal.cycleId },
        { poolId: clientPrincipal.poolId, cycleId: clientPrincipal.cycleId }, { agentId: clientContext.agentId },
        { workspaceId: clientContext.workspaceId }, { scope: "CLIENT", organizationId: organization.id, clientId: client.id }]) {
        await constrained(tx, () => insert(tx, "PlanningAiSession", { ...own, ...change }), ["23514", "23503"]);
      }
      await insert(tx, "PlanningAiSession", own); await insert(tx, "PlanningAiSession", delegated);
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      expect(await row(tx, "PlanningAiCycle", ownPrincipal.cycleId)).toMatchObject({ held: 1, consumed: 0 });
      expect(await row(tx, "PlanningAiCycle", clientPrincipal.cycleId)).toMatchObject({ held: 1, consumed: 0 });
      const bulkA = session(ownPrincipal, ownContext, ownSeat), bulkB = session(ownPrincipal, ownContext, ownSeat);
      const columns = Object.keys(bulkA);
      await tx.$executeRaw(Prisma.sql`INSERT INTO "PlanningAiSession"
        (${Prisma.join(columns.map(name => Prisma.raw('"' + name + '"')))})
        VALUES (${Prisma.join(columns.map(name => sqlValue("PlanningAiSession", name, bulkA[name])))}),
          (${Prisma.join(columns.map(name => sqlValue("PlanningAiSession", name, bulkB[name])))})`);
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      expect(await row(tx, "PlanningAiCycle", ownPrincipal.cycleId)).toMatchObject({ held: 3, consumed: 0 });
      await tx.$executeRaw`UPDATE "PlanningAiSession" SET "allowanceState"='RELEASED',revision=revision+1
        WHERE id IN (${bulkA.id},${bulkB.id})`;
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      expect(await row(tx, "PlanningAiCycle", ownPrincipal.cycleId)).toMatchObject({ held: 1, consumed: 0 });
      expect((await row(tx, "PlanningAiSession", bulkA.id))?.allowanceState).toBe("RELEASED");
      expect((await row(tx, "PlanningAiSession", bulkB.id))?.allowanceState).toBe("RELEASED");
      await constrained(tx, () => insert(tx, "PlanningAiSession", { ...own, id: key() }), ["23505"]);
      for (const change of [{ id: key() }, { poolId: clientPrincipal.poolId, cycleId: clientPrincipal.cycleId },
        { agentId: clientContext.agentId, workspaceId: clientContext.workspaceId, campaignId: clientContext.campaignId },
        { createdByUserId: b.id }, { creationSeatId: clientSeat.id }, { creationKey: randomUUID() }, { createdAt: new Date() }, { revision: 3 }]) {
        await constrained(tx, () => patch(tx, "PlanningAiSession", own.id, { ...next(own), ...change }));
      }
      await constrained(tx, () => patch(tx, "PlanningAiSession", own.id, next(own, { allowanceState: "CONSUMED", firstAttachedResultId: key() })));
      await constrained(tx, () => tx.$executeRaw`DELETE FROM "PlanningAiSession" WHERE id=${own.id}`);
      for (let ordinal = 1; ordinal <= 10; ordinal++) await insert(tx, "PlanningAiOperation", operation(own.id, "REPLY", ordinal));
      for (const kind of kinds) await insert(tx, "PlanningAiOperation", operation(own.id, kind));
      const slots = await tx.$queryRaw<Array<{ kind: string; ordinal: number }>>`SELECT kind,ordinal FROM "PlanningAiOperation" WHERE "sessionId"=${own.id} ORDER BY kind,ordinal`;
      expect(slots).toHaveLength(14); expect(slots.filter(saved => saved.kind === "REPLY").map(saved => saved.ordinal)).toEqual([1,2,3,4,5,6,7,8,9,10]);
      for (const kind of ["REPLY", ...kinds]) await constrained(tx, () => insert(tx, "PlanningAiOperation", operation(own.id, kind)), ["23505"]);
      for (const malformed of [operation(own.id, "REPLY", 0), operation(own.id, "REPLY", 11), operation(own.id, "BRIEF", 2),
        operation(own.id, "UNKNOWN", 1), operation(own.id, "REPLY", 1, { state: "SUCCEEDED" }), operation(own.id, "REPLY", 1, { successfulResultId: key() })]) {
        await constrained(tx, () => insert(tx, "PlanningAiOperation", malformed));
      }
      const saved = (await tx.$queryRaw<Fields[]>`SELECT * FROM "PlanningAiOperation" WHERE "sessionId"=${own.id} AND kind='REPLY' AND ordinal=1`)[0]!;
      for (const change of [{ sessionId: delegated.id }, { kind: "STRATEGY" }, { ordinal: 2 }, { id: key() }, { state: "SUCCEEDED" }, { successfulResultId: key() }]) {
        await constrained(tx, () => patch(tx, "PlanningAiOperation", String(saved.id), { ...next(saved), ...change }));
      }
      await constrained(tx, () => tx.$executeRaw`DELETE FROM "PlanningAiOperation" WHERE id=${String(saved.id)}`);
      await constrained(tx, async () => {
        await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`;
        const counter = (await row(tx, "PlanningAiCycle", ownPrincipal.cycleId))!;
        await patch(tx, "PlanningAiCycle", ownPrincipal.cycleId, next(counter, { held: 2 })); // Within allowance, wrong actual Session count.
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      });
      await patch(tx, "PlanningAiSession", own.id, next(own, { allowanceState: "RELEASED" }));
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      expect(await row(tx, "PlanningAiCycle", ownPrincipal.cycleId)).toMatchObject({ held: 0, consumed: 0 });
      const released = (await row(tx, "PlanningAiSession", own.id))!;
      await patch(tx, "PlanningAiSession", own.id, next(released, { allowanceState: "HELD" }));
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      expect(await row(tx, "PlanningAiCycle", ownPrincipal.cycleId)).toMatchObject({ held: 1, consumed: 0 });
    });
  }, 90000);

  it("resolves two-seat last-slot RC/RR contention and actual expiry waits, denies reverse ancestor waits and ends with zero retained holds", async () => {
    await requireStorage();
    const base = await prisma.$transaction(async tx => {
      const a = await owner(tx, true), b = await owner(tx, true), targetBrand = await brand(tx, b.id);
      const organization = await tx.organization.create({ data: { id: key("organization~*"), ownerUserId: a.id, name: "Synthetic retained execution organization", kind: "BUSINESS" } });
      const memberA = await tx.organizationMembership.create({ data: { id: key("membership~*"), organizationId: organization.id, userId: a.id, state: "ACTIVE" } });
      const memberB = await tx.organizationMembership.create({ data: { id: key("membership~*"), organizationId: organization.id, userId: b.id, state: "ACTIVE" } });
      const client = await tx.organizationClient.create({ data: { id: key("client~*"), organizationId: organization.id, brandId: targetBrand.id,
        state: "ACTIVE", authorizingUserId: b.id, authorizingSessionVersion: b.sessionVersion,
        allowedCapabilities: { view: true, plan: true, approveShortlist: true, reviewContent: true, signCustomer: true, financial: true, manageGrants: true } } });
      const context = await domain(tx, { kind: "CLIENT", brandId: targetBrand.id, organizationId: organization.id, clientId: client.id });
      const endsAt = new Date(Date.now() + 12000), accepted = await principal(tx, a.id, context.subject,
        { startsAt: new Date(Date.now() - 60000), endsAt }); // Explicit synthetic PAID period, never trial policy.
      const seatA = await seat(tx, accepted, a.id, memberA), seatB = await seat(tx, accepted, b.id, memberB);
      const preheldA = session(accepted, context, seatA), preheldB = session(accepted, context, seatB);
      await insert(tx, "PlanningAiSession", preheldA); await insert(tx, "PlanningAiSession", preheldB);
      return { a, b, context, accepted, seatA, seatB, preheldA, preheldB, endsAt };
    }, { maxWait: 10000, timeout: 20000 });
    const peers = [new PrismaClient(), new PrismaClient(), new PrismaClient(), new PrismaClient()];
    const [blocker, writerA, writerB, monitor] = peers as [PrismaClient, PrismaClient, PrismaClient, PrismaClient];
    async function heldRow(table: "PlanningAiCycle" | "PlanningAiPool", id: string) {
      const ready = latch<number>(), release = latch<void>();
      const done = blocker.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout='20s'`;
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw('"' + table + '"')} WHERE id=${id} FOR NO KEY UPDATE`);
        const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
        ready.resolve(rows[0]!.pid); await release.promise;
      }, { maxWait: 5000, timeout: 30000 }); void done.catch(() => {});
      const pid = await Promise.race([ready.promise, done.then(() => { throw new Error("Execution blocker ended before its native PID"); })]);
      return { pid, done, release: () => release.resolve() };
    }
    async function waitBlocked(pid: number, blockerIds: number[], operation: Promise<unknown>) {
      const observation = (async () => {
        const deadline = performance.now() + 4000;
        while (performance.now() < deadline) {
          const rows = await monitor.$queryRaw<Array<{ pid: number }>>(Prisma.sql`SELECT pid FROM pg_stat_activity
            WHERE datname=current_database() AND pid=${pid} AND wait_event_type='Lock'
              AND pg_blocking_pids(pid) && ARRAY[${Prisma.join(blockerIds)}]::int[] AND query LIKE ${'%"PlanningAiSession"%'}`);
          if (rows.length) return true; await delay(20);
        }
        throw new Error("Execution insert did not reach its exact native parent wait");
      })();
      return Promise.race([observation, operation.then(() => { throw new Error("Execution insert finished before its required native wait"); })]);
    }
    async function write(client: PrismaClient, data: Fields, started: ReturnType<typeof latch<number>>, isolation: Prisma.TransactionIsolationLevel) {
      await client.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout='20s'`;
        const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
        started.resolve(rows[0]!.pid); await insert(tx, "PlanningAiSession", data);
      }, { isolationLevel: isolation, maxWait: 5000, timeout: 30000 });
    }
    async function releaseSession(id: string) {
      const saved = await row(prisma, "PlanningAiSession", id);
      if (!saved || saved.allowanceState !== "HELD") return;
      // Actual update path obtains all ancestors in reviewed order before child.
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "PlanningAiPool" WHERE id=${base.accepted.poolId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "PlanningAiEnrollment" WHERE id=${base.accepted.enrollmentId} FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM "PlanningAiSeat" WHERE id=${String(saved.creationSeatId)} FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM "PlanningAiCycle" WHERE id=${base.accepted.cycleId} FOR UPDATE`;
        const current = (await row(tx, "PlanningAiSession", id))!;
        await patch(tx, "PlanningAiSession", id, next(current, { allowanceState: "RELEASED" }));
      }, { maxWait: 5000, timeout: 15000 });
    }
    let raceA: Promise<void> | undefined, raceB: Promise<void> | undefined;
    try {
      const candidateA = session(base.accepted, base.context, base.seatA), candidateB = session(base.accepted, base.context, base.seatB);
      const held = await heldRow("PlanningAiPool", base.accepted.poolId), startedA = latch<number>(), startedB = latch<number>();
      try {
        raceA = write(writerA, candidateA, startedA, Prisma.TransactionIsolationLevel.ReadCommitted); void raceA.catch(() => {});
        const pidA = await Promise.race([startedA.promise, raceA.then(() => { throw new Error("RC writer A ended before PID"); })]);
        expect(await waitBlocked(pidA, [held.pid], raceA)).toBe(true);
        raceB = write(writerB, candidateB, startedB, Prisma.TransactionIsolationLevel.ReadCommitted); void raceB.catch(() => {});
        const pidB = await Promise.race([startedB.promise, raceB.then(() => { throw new Error("RC writer B ended before PID"); })]);
        expect(await waitBlocked(pidB, [held.pid, pidA], raceB)).toBe(true);
        held.release(); await held.done;
        const outcomes = await Promise.allSettled([raceA, raceB]);
        expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
        const failure = outcomes.find(outcome => outcome.status === "rejected");
        if (failure?.status !== "rejected") throw new Error("Last slot must have one loser"); rejected(failure.reason, ["23514"]);
        expect(await row(prisma, "PlanningAiCycle", base.accepted.cycleId)).toMatchObject({ held: 3, consumed: 0 });
      } finally { held.release(); await held.done.catch(() => {}); await Promise.allSettled([raceA, raceB].filter((job): job is Promise<void> => job !== undefined)); }
      const winner = (await row(prisma, "PlanningAiSession", candidateA.id)) ?? (await row(prisma, "PlanningAiSession", candidateB.id));
      if (!winner) throw new Error("Actual last-slot winner missing");
      const ancestor = await heldRow("PlanningAiPool", base.accepted.poolId), began = performance.now();
      const reverse = patch(prisma, "PlanningAiSession", String(winner.id), next(winner, { allowanceState: "RELEASED" })); void reverse.catch(() => {});
      try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Reverse ancestor update waited instead of NOWAIT")), 1500); });
        let failure: unknown;
        try { failure = await Promise.race([reverse.then(() => null, (error: unknown) => error), timeout]); }
        finally { if (timer) clearTimeout(timer); }
        rejected(failure, ["55P03"]); expect(performance.now() - began).toBeLessThan(1500);
        expect(await row(prisma, "PlanningAiSession", String(winner.id))).toMatchObject({ allowanceState: "HELD", revision: 1 });
      } finally { ancestor.release(); await ancestor.done.catch(() => {}); await reverse.catch(() => {}); }
      await releaseSession(String(winner.id)); // Return to two holds for stale RR last-slot proof.
      const snapshotReady = latch<number>(), releaseSnapshot = latch<void>(), staleCandidate = session(base.accepted, base.context, base.seatA);
      const stale = writerA.$transaction(async tx => {
        const observed = (await row(tx, "PlanningAiCycle", base.accepted.cycleId))!;
        snapshotReady.resolve(Number(observed.held)); await releaseSnapshot.promise;
        await insert(tx, "PlanningAiSession", staleCandidate);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 20000 }); void stale.catch(() => {});
      try {
        expect(await Promise.race([snapshotReady.promise, stale.then(() => { throw new Error("RR writer ended before snapshot"); })])).toBe(2);
        const fresh = session(base.accepted, base.context, base.seatB); await insert(prisma, "PlanningAiSession", fresh);
        releaseSnapshot.resolve(); const failure = await stale.then(() => null, (error: unknown) => error);
        expect(failure instanceof Prisma.PrismaClientKnownRequestError).toBe(true);
        if (!(failure instanceof Prisma.PrismaClientKnownRequestError)) throw new Error("Expected actual RR rejection");
        expect(failure.code === "P2034" || failure.code === "P2010" && String(failure.meta?.code) === "40001").toBe(true);
        expect(await row(prisma, "PlanningAiSession", staleCandidate.id)).toBeUndefined();
        expect(await row(prisma, "PlanningAiCycle", base.accepted.cycleId)).toMatchObject({ held: 3, consumed: 0 });
        await releaseSession(fresh.id);
      } finally { releaseSnapshot.resolve(); await stale.catch(() => {}); }
      await releaseSession(base.preheldA.id); await releaseSession(base.preheldB.id);
      const expiryHold = await heldRow("PlanningAiCycle", base.accepted.cycleId), started = latch<number>();
      const expiredCandidate = session(base.accepted, base.context, base.seatA), expiring = write(writerA, expiredCandidate, started, Prisma.TransactionIsolationLevel.ReadCommitted); void expiring.catch(() => {});
      try {
        const pid = await Promise.race([started.promise, expiring.then(() => { throw new Error("Expiry writer ended before PID"); })]);
        expect(await waitBlocked(pid, [expiryHold.pid], expiring)).toBe(true);
        const before = await monitor.$queryRaw<Array<{ eligible: boolean }>>`SELECT timezone('UTC',clock_timestamp()) < ${base.endsAt.toISOString()}::timestamp(3) AS eligible`;
        expect(before[0]!.eligible).toBe(true);
        for (;;) {
          const clock = await monitor.$queryRaw<Array<{ expired: boolean }>>`SELECT timezone('UTC',clock_timestamp()) >= ${base.endsAt.toISOString()}::timestamp(3) AS expired`;
          if (clock[0]!.expired) break; await delay(25);
        }
        expiryHold.release(); await expiryHold.done;
        const failure = await expiring.then(() => null, (error: unknown) => error); rejected(failure, ["23514"]);
        expect(await row(prisma, "PlanningAiSession", expiredCandidate.id)).toBeUndefined();
        expect(await row(prisma, "PlanningAiCycle", base.accepted.cycleId)).toMatchObject({ held: 0, consumed: 0 });
        const released = (await row(prisma, "PlanningAiSession", base.preheldA.id))!;
        const rehold = await patch(prisma, "PlanningAiSession", released.id as string, next(released, { allowanceState: "HELD" })).then(() => null, (error: unknown) => error);
        rejected(rehold, ["23514"]); // Same immutable identity cannot reuse expired allowance.
      } finally { expiryHold.release(); await expiryHold.done.catch(() => {}); await expiring.catch(() => {}); }
    } finally {
      await Promise.allSettled([raceA, raceB].filter((job): job is Promise<void> => job !== undefined));
      const held = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM "PlanningAiSession" WHERE "poolId"=${base.accepted.poolId} AND "allowanceState"='HELD' ORDER BY id`;
      for (const saved of held) await releaseSession(saved.id);
      await Promise.all(peers.map(client => client.$disconnect()));
    }
    const final = await prisma.$queryRaw<Array<{ allowanceState: string }>>`SELECT "allowanceState" FROM "PlanningAiSession" WHERE "poolId"=${base.accepted.poolId}`;
    expect(final).toHaveLength(4); expect(final.every(saved => saved.allowanceState === "RELEASED")).toBe(true);
    expect(await row(prisma, "PlanningAiCycle", base.accepted.cycleId)).toMatchObject({ held: 0, consumed: 0 });
  }, 90000);
});
