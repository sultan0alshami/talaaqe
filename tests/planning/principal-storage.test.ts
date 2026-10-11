import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma, PrismaClient } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { COMMERCIAL_POLICY_VERSION, PLANNING_PLANS } from "@/lib/commercial/contracts";
import { PlanningAiEnrollmentSchema, PlanningAiPoolSchema } from "@/lib/planning/contracts";

// Independent native storage witnesses only. No provisioning, merchant/provider
// acceptance, auth inference, future generated model, reset or guard bypass.
// Groups1/2 deliberately ROLLBACK all fixtures. Group3 retains one tagged isTest
// owner/Brand/pool/enrollment and bounded cycle history because DELETE is denied.
type Table = "PlanningAiPool" | "PlanningAiEnrollment" | "PlanningAiSeat" | "PlanningAiTrialClaim" | "PlanningAiCycle";
type Db = PrismaClient | Prisma.TransactionClient;
type Fields = Record<string, unknown>;
const tables: Table[] = ["PlanningAiPool", "PlanningAiEnrollment", "PlanningAiSeat", "PlanningAiTrialClaim", "PlanningAiCycle"];
const key = (prefix = "storage~*") => prefix + ":" + randomUUID();
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const priceVersion = "synthetic-price~*:not-provisioned";
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
beforeAll(async () => {
  const taskId = process.env.INFAME_TASK_ID;
  if (!taskId || !/^infame_[a-f0-9]{12}$/.test(taskId) || process.env.INFAME_ENV !== "test" || process.env.NODE_ENV === "production") throw new Error("Planning storage requires the guarded test task");
  const rows = await prisma.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]?.id !== taskId || rows[0]?.kind !== "test" || rows[0]?.db !== taskId + "_test" || rows[0]?.host !== "127.0.0.1") throw new Error("Planning storage fixture target mismatch");
});
async function requireStorage() {
  for (const table of tables) {
    const rows = await prisma.$queryRaw<Array<{ present: boolean }>>`SELECT to_regclass(${`"${table}"`}) IS NOT NULL AS present`;
    expect(rows[0]?.present === true, "Frozen native planning storage table must exist: " + table).toBe(true);
  }
}
function value(input: unknown) {
  if (input === null) return Prisma.sql`NULL`;
  if (input instanceof Date) return Prisma.sql`${input.toISOString()}::timestamp(3)`;
  return Prisma.sql`${input}`;
}
async function insert(db: Db, table: Table, fields: Fields) {
  const entries = Object.entries(fields);
  await db.$executeRaw(Prisma.sql`INSERT INTO ${Prisma.raw('"' + table + '"')}
    (${Prisma.join(entries.map(([column]) => Prisma.raw('"' + column + '"')))})
    VALUES (${Prisma.join(entries.map(([, input]) => value(input)))})`);
}
async function patch(db: Db, table: Table, id: string, fields: Fields) {
  await db.$executeRaw(Prisma.sql`UPDATE ${Prisma.raw('"' + table + '"')}
    SET ${Prisma.join(Object.entries(fields).map(([column, input]) => Prisma.sql`${Prisma.raw('"' + column + '"')}=${value(input)}`))}
    WHERE id=${id}`);
}
async function row(db: Db, table: Table, id: string) {
  return (await db.$queryRaw<Fields[]>(Prisma.sql`SELECT * FROM ${Prisma.raw('"' + table + '"')} WHERE id=${id}`))[0];
}
async function remove(db: Db, table: Table, id: string) {
  return db.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE id=${id}`);
}
function nativeRejection(error: unknown, codes: readonly string[]) {
  expect(error instanceof Prisma.PrismaClientKnownRequestError, "Expected an actual native storage rejection").toBe(true);
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw new Error("Native storage rejection missing");
  expect(error.code).toBe("P2010"); expect(codes).toContain(String(error.meta?.code));
}
async function constrained(tx: Prisma.TransactionClient, action: () => Promise<unknown>, codes: readonly string[] = ["23514"]) {
  await tx.$executeRaw`SAVEPOINT planning_storage_witness`;
  let failure: unknown = null;
  try { await action(); } catch (error) { failure = error; }
  await tx.$executeRaw`ROLLBACK TO SAVEPOINT planning_storage_witness`;
  await tx.$executeRaw`RELEASE SAVEPOINT planning_storage_witness`;
  nativeRejection(failure, codes);
}
async function rollbackFixture(action: (tx: Prisma.TransactionClient) => Promise<void>) {
  const sentinel = new Error("Deliberate owned planning fixture rollback");
  try {
    await prisma.$transaction(async tx => { await action(tx); throw sentinel; }, { maxWait: 10000, timeout: 60000 });
    throw new Error("Planning fixture must not commit");
  } catch (error) { if (error !== sentinel) throw error; }
}
async function user(db: Db, retained = false) {
  const suffix = randomUUID(), createdAt = new Date(Date.now() - 60000);
  return db.user.create({ data: { id: "planning-user~*:" + suffix, role: "BRAND", active: true, isTest: true,
    name: retained ? "Synthetic M10 retained overlap fixture only" : "Synthetic M10 rollback fixture only",
    email: "planning-storage-" + suffix + "@example.invalid", passwordHash: "test-only-no-login",
    emailVerifiedAt: new Date(createdAt.getTime() + 1000), createdAt } });
}
async function brand(db: Db, userId: string) {
  const suffix = randomUUID();
  return db.brand.create({ data: { id: "planning-brand~*:" + suffix, userId, slug: "planning-" + suffix,
    name: "Synthetic planning storage subject", state: "PRIVATE", isTest: true } });
}
async function organization(db: Db, ownerUserId: string) {
  return db.organization.create({ data: { id: key("planning-org~*"), ownerUserId, name: "Synthetic planning storage organization", kind: "BUSINESS" } });
}
function pool(subject: { brandId: string } | { organizationId: string }): Fields & { id: string } {
  const at = new Date(Date.now() - 30000);
  return { id: key("pool~*"), scope: "brandId" in subject ? "OWN_BRAND" : "CLIENT",
    brandId: "brandId" in subject ? subject.brandId : null, organizationId: "organizationId" in subject ? subject.organizationId : null,
    state: "ACTIVE", revision: 1, createdAt: at, updatedAt: at };
}
function enrollment(poolId: string, ownerUserId: string, plan: typeof PLANNING_PLANS[number] | null): Fields & { id: string } {
  const at = new Date(Date.now() - 20000), reference = key("acceptance~*");
  return { id: key("enrollment~*"), poolId, acceptingOwnerUserId: ownerUserId, subscriberUserId: ownerUserId,
    kind: plan ? "PAID" : "TRIAL", planId: plan?.id ?? "TRIAL", policyVersion: COMMERCIAL_POLICY_VERSION,
    priceVersion: plan ? priceVersion : null, netAmountMinor: plan ? BigInt(plan.netMonthly.amountMinor) : null,
    currency: plan ? plan.netMonthly.currencyCode : null, state: "ACTIVE", revision: 1,
    acceptanceReference: reference, acceptanceHash: digest(reference), acceptedAt: at, createdAt: at, updatedAt: at };
}
function seat(poolId: string, userId: string, membership: { id: string; organizationId: string } | null): Fields & { id: string } {
  const at = new Date();
  return { id: key("seat~*"), poolId, userId, organizationId: membership?.organizationId ?? null,
    membershipId: membership?.id ?? null, state: "ACTIVE", revision: 1, createdAt: at, updatedAt: at };
}
function bump(saved: Fields, fields: Fields = {}): Fields { return { revision: Number(saved.revision) + 1, updatedAt: saved.updatedAt, ...fields }; }
function wire(fields: Fields) { return Object.fromEntries(Object.entries(fields).map(([name, input]) => [name,
  input instanceof Date ? input.toISOString() : typeof input === "bigint" ? input.toString() : input])); }
function trialClaim(accepted: Fields & { id: string }): Fields & { id: string } {
  return { id: key("trial~*"), poolId: accepted.poolId, enrollmentId: accepted.id, ownerUserId: accepted.subscriberUserId,
    readinessReference: key("synthetic-readiness~*"), consentHash: digest(key()),
    claimedAt: new Date((accepted.acceptedAt as Date).getTime() + 1000) };
}
function cycle(accepted: Fields & { id: string }, startsAt: Date, endsAt: Date, claim: string | null = null): Fields & { id: string } {
  const plan = PLANNING_PLANS.find(item => item.id === accepted.planId), trial = accepted.kind === "TRIAL";
  if (!trial && !plan) throw new Error("Synthetic cycle requires an exact central paid plan");
  const at = new Date();
  return { id: key("cycle~*"), poolId: accepted.poolId, enrollmentId: accepted.id, trialClaimId: claim,
    source: trial ? "TRIAL" : "MERCHANT", sourceEventId: key("synthetic-event~*"), subscriptionId: trial ? null : key("synthetic-subscription~*"),
    planId: accepted.planId, policyVersion: accepted.policyVersion, priceVersion: accepted.priceVersion,
    netAmountMinor: accepted.netAmountMinor, currency: accepted.currency, allowance: trial ? 1 : plan!.sessions,
    held: 0, consumed: 0, state: "ACTIVE", revision: 1, startsAt, endsAt, createdAt: at, updatedAt: at };
}
function latch<T>() { let resolve!: (input: T | PromiseLike<T>) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (input: T) => resolve(input) }; }

describe("planning AI principals: three independent guarded native storage groups", () => {
  it("binds broad native subjects, accepted owner/terms and exact membership identities while retaining immutable history", async () => {
    await requireStorage();
    await rollbackFixture(async tx => {
      const owner = await user(tx), other = await user(tx), ownBrand = await brand(tx, owner.id);
      const org = await organization(tx, owner.id), otherOrg = await organization(tx, other.id);
      const membership = await tx.organizationMembership.create({ data: { id: key("membership~*"), organizationId: org.id, userId: owner.id, state: "ACTIVE" } });
      const foreignMembership = await tx.organizationMembership.create({ data: { id: key("membership~*"), organizationId: otherOrg.id, userId: owner.id, state: "ACTIVE" } });
      const own = pool({ brandId: ownBrand.id }), client = pool({ organizationId: org.id });
      for (const malformed of [{ scope: "UNKNOWN" }, { brandId: null }, { organizationId: org.id }, { state: "CLOSED" }, { revision: 2 }, { id: "bad space" }, { id: "x".repeat(201) }]) {
        await constrained(tx, () => insert(tx, "PlanningAiPool", { ...own, ...malformed }));
      }
      await insert(tx, "PlanningAiPool", own); await insert(tx, "PlanningAiPool", client);
      expect(await row(tx, "PlanningAiPool", own.id)).toMatchObject({ id: own.id, scope: "OWN_BRAND", brandId: ownBrand.id, organizationId: null });
      await constrained(tx, () => insert(tx, "PlanningAiPool", { ...own, id: key() }), ["23505"]);
      await constrained(tx, () => insert(tx, "PlanningAiPool", { ...client, id: key() }), ["23505"]);
      for (const change of [{ id: key() }, { scope: "CLIENT", brandId: null, organizationId: otherOrg.id }, { createdAt: new Date() }, { revision: 3 }]) {
        await constrained(tx, () => patch(tx, "PlanningAiPool", own.id, { ...bump(own), ...change }));
      }
      const accepted = enrollment(own.id, owner.id, PLANNING_PLANS[0]);
      for (const change of [{ acceptingOwnerUserId: other.id }, { subscriberUserId: other.id }, { state: "CLOSED" }, { revision: 2 },
        { netAmountMinor: BigInt(9901) }, { currency: "USD" }, { priceVersion: null }, { policyVersion: "unaccepted-policy" },
        { planId: "GROWTH" }, { acceptanceReference: "https://receipt.example.invalid/item" }, { acceptanceHash: "A".repeat(64) }]) {
        await constrained(tx, () => insert(tx, "PlanningAiEnrollment", { ...accepted, ...change }));
      }
      await insert(tx, "PlanningAiEnrollment", accepted);
      await constrained(tx, () => insert(tx, "PlanningAiEnrollment", { ...accepted, id: key() }), ["23505"]);
      for (const change of [{ id: key() }, { poolId: client.id }, { acceptingOwnerUserId: other.id }, { subscriberUserId: other.id },
        { planId: "GROWTH", netAmountMinor: BigInt(29900) }, { priceVersion: key() }, { acceptedAt: new Date() },
        { acceptanceReference: key() }, { acceptanceHash: "f".repeat(64) }, { createdAt: new Date() }]) {
        await constrained(tx, () => patch(tx, "PlanningAiEnrollment", accepted.id, { ...bump(accepted), ...change }));
      }
      await constrained(tx, () => remove(tx, "PlanningAiEnrollment", accepted.id)); // Child-free history also remains.
      const ownSeat = seat(own.id, owner.id, null), clientSeat = seat(client.id, owner.id, membership);
      await constrained(tx, () => insert(tx, "PlanningAiSeat", { ...ownSeat, organizationId: org.id, membershipId: membership.id }));
      await constrained(tx, () => insert(tx, "PlanningAiSeat", { ...clientSeat, organizationId: null, membershipId: null }));
      await constrained(tx, () => insert(tx, "PlanningAiSeat", { ...clientSeat, membershipId: foreignMembership.id }), ["23503"]);
      await constrained(tx, () => insert(tx, "PlanningAiSeat", { ...clientSeat, userId: other.id }), ["23503"]);
      await insert(tx, "PlanningAiSeat", ownSeat); await insert(tx, "PlanningAiSeat", clientSeat);
      await constrained(tx, () => insert(tx, "PlanningAiSeat", { ...clientSeat, id: key() }), ["23505"]);
      await constrained(tx, () => tx.$executeRaw`UPDATE "OrganizationMembership" SET "userId"=${other.id},revision=revision+1 WHERE id=${membership.id}`, ["23514"]);
      await constrained(tx, () => tx.$executeRaw`DELETE FROM "OrganizationMembership" WHERE id=${membership.id}`, ["23001"]);
      for (const change of [{ userId: other.id }, { poolId: own.id, organizationId: null, membershipId: null }, { membershipId: foreignMembership.id }, { id: key() }]) {
        await constrained(tx, () => patch(tx, "PlanningAiSeat", clientSeat.id, { ...bump(clientSeat), ...change }));
      }
      await patch(tx, "PlanningAiSeat", clientSeat.id, bump(clientSeat, { state: "REVOKED" }));
      await patch(tx, "PlanningAiSeat", clientSeat.id, { ...bump(clientSeat), revision: 3, state: "ACTIVE" });
      expect(await row(tx, "PlanningAiSeat", clientSeat.id)).toMatchObject({ state: "ACTIVE", revision: 3, membershipId: membership.id });
      await constrained(tx, () => remove(tx, "PlanningAiSeat", clientSeat.id));
      for (const plan of PLANNING_PLANS) {
        const subject = await organization(tx, owner.id), parent = pool({ organizationId: subject.id });
        await insert(tx, "PlanningAiPool", parent);
        const exact = enrollment(parent.id, owner.id, plan); await insert(tx, "PlanningAiEnrollment", exact);
        expect(await row(tx, "PlanningAiEnrollment", exact.id)).toMatchObject({ planId: plan.id, policyVersion: plan.policyVersion,
          netAmountMinor: BigInt(plan.netMonthly.amountMinor), currency: "SAR", priceVersion });
      }
      await patch(tx, "PlanningAiEnrollment", accepted.id, bump(accepted, { state: "CLOSED" }));
      await constrained(tx, () => patch(tx, "PlanningAiEnrollment", accepted.id, { ...bump(accepted), revision: 3, state: "ACTIVE" }));
      await patch(tx, "PlanningAiPool", own.id, bump(own, { state: "CLOSED" }));
      await constrained(tx, () => patch(tx, "PlanningAiPool", own.id, { ...bump(own), revision: 3, state: "ACTIVE" }));
      await constrained(tx, () => insert(tx, "PlanningAiPool", { ...own, id: key(), state: "ACTIVE", revision: 1 }), ["23505"]);
      await constrained(tx, () => tx.$executeRaw`DELETE FROM "Brand" WHERE id=${ownBrand.id}`, ["23001"]);
      const emptyOrg = await organization(tx, owner.id), empty = pool({ organizationId: emptyOrg.id });
      await insert(tx, "PlanningAiPool", empty); await constrained(tx, () => remove(tx, "PlanningAiPool", empty.id));
    });
  }, 90000);

  it("retains two lifetime trial fences across owner change and closure, exact trial cycles and strict native/pure boundaries", async () => {
    await requireStorage();
    await rollbackFixture(async tx => {
      const owner = await user(tx), replacement = await user(tx), ownBrand = await brand(tx, owner.id), own = pool({ brandId: ownBrand.id });
      await insert(tx, "PlanningAiPool", own);
      const accepted = enrollment(own.id, owner.id, null);
      for (const change of [{ planId: "STARTER" }, { priceVersion }, { netAmountMinor: BigInt(0) }, { currency: "SAR" }]) {
        await constrained(tx, () => insert(tx, "PlanningAiEnrollment", { ...accepted, ...change }));
      }
      await insert(tx, "PlanningAiEnrollment", accepted);
      const claim = trialClaim(accepted);
      for (const change of [{ poolId: key() }, { enrollmentId: key() }, { ownerUserId: replacement.id },
        { claimedAt: new Date((accepted.acceptedAt as Date).getTime() - 1) }, { readinessReference: "https://ready.example.invalid/record" }, { consentHash: "BAD" }]) {
        await constrained(tx, () => insert(tx, "PlanningAiTrialClaim", { ...claim, ...change }), ["23514", "23503"]);
      }
      for (const change of [{ active: false }, { role: "CREATOR" }, { emailVerifiedAt: null }, { emailVerifiedAt: new Date((claim.claimedAt as Date).getTime() + 1) }]) {
        await constrained(tx, async () => {
          if (Object.hasOwn(change, "active")) await tx.$executeRaw`UPDATE "User" SET active=FALSE WHERE id=${owner.id}`;
          if (Object.hasOwn(change, "role")) await tx.$executeRaw`UPDATE "User" SET role='CREATOR' WHERE id=${owner.id}`;
          if (Object.hasOwn(change, "emailVerifiedAt")) await tx.$executeRaw(Prisma.sql`UPDATE "User" SET "emailVerifiedAt"=${value(change.emailVerifiedAt)} WHERE id=${owner.id}`);
          await insert(tx, "PlanningAiTrialClaim", claim);
        });
      }
      await insert(tx, "PlanningAiTrialClaim", claim);
      expect(await row(tx, "PlanningAiTrialClaim", claim.id)).toMatchObject({ poolId: own.id, enrollmentId: accepted.id, ownerUserId: owner.id, consentHash: claim.consentHash });
      const start = new Date("2094-04-01T00:00:00.000Z"), end = new Date("2094-05-01T00:00:00.000Z");
      const firstCycle = cycle(accepted, start, end, claim.id);
      for (const change of [{ trialClaimId: null }, { allowance: 3 }, { subscriptionId: key() }, { source: "MERCHANT" },
        { held: 1 }, { consumed: 1 }, { startsAt: end }, { endsAt: start }, { state: "VOIDED" }, { revision: 2 }]) {
        await constrained(tx, () => insert(tx, "PlanningAiCycle", { ...firstCycle, ...change }));
      }
      await insert(tx, "PlanningAiCycle", firstCycle);
      expect(await row(tx, "PlanningAiCycle", firstCycle.id)).toMatchObject({ source: "TRIAL", trialClaimId: claim.id, allowance: 1, held: 0, consumed: 0, priceVersion: null, netAmountMinor: null, currency: null });
      await constrained(tx, () => insert(tx, "PlanningAiCycle", cycle(accepted, end, new Date("2094-06-01T00:00:00.000Z"), claim.id)), ["23505"]);
      for (const change of [{ id: key() }, { poolId: key() }, { enrollmentId: key() }, { ownerUserId: replacement.id },
        { readinessReference: key() }, { consentHash: digest("different") }, { claimedAt: new Date() }]) {
        await constrained(tx, () => patch(tx, "PlanningAiTrialClaim", claim.id, change));
      }
      await constrained(tx, () => remove(tx, "PlanningAiTrialClaim", claim.id));
      await constrained(tx, () => remove(tx, "PlanningAiCycle", firstCycle.id));
      const secondOrg = await organization(tx, owner.id), otherPool = pool({ organizationId: secondOrg.id });
      await insert(tx, "PlanningAiPool", otherPool);
      const sameOwnerEnrollment = enrollment(otherPool.id, owner.id, null); await insert(tx, "PlanningAiEnrollment", sameOwnerEnrollment);
      await constrained(tx, () => insert(tx, "PlanningAiTrialClaim", trialClaim(sameOwnerEnrollment)), ["23505"]); // Different pool, same lifetime owner.
      await patch(tx, "PlanningAiEnrollment", accepted.id, bump(accepted, { state: "CLOSED" }));
      await tx.brand.update({ where: { id: ownBrand.id }, data: { userId: replacement.id } });
      const transferred = enrollment(own.id, replacement.id, null); await insert(tx, "PlanningAiEnrollment", transferred);
      await constrained(tx, () => insert(tx, "PlanningAiTrialClaim", trialClaim(transferred)), ["23505"]); // Different owner/enrollment, same lifetime pool.
      expect(await row(tx, "PlanningAiEnrollment", accepted.id)).toMatchObject({ state: "CLOSED", subscriberUserId: owner.id, acceptingOwnerUserId: owner.id });
      expect(await row(tx, "PlanningAiTrialClaim", claim.id)).toMatchObject({ ownerUserId: owner.id, poolId: own.id });
      await constrained(tx, () => tx.$executeRaw`DELETE FROM "User" WHERE id=${owner.id}`, ["23001"]);
      const currentPool = (await row(tx, "PlanningAiPool", own.id))!;
      await patch(tx, "PlanningAiPool", own.id, bump(currentPool, { state: "CLOSED" }));
      await constrained(tx, () => remove(tx, "PlanningAiPool", own.id));

      const boundaryOrg = await organization(tx, owner.id), boundary: Fields & { id: string } = { ...pool({ organizationId: boundaryOrg.id }), id: "X".repeat(199) + "*" };
      expect(PlanningAiPoolSchema.safeParse(wire(boundary)).success).toBe(true);
      await insert(tx, "PlanningAiPool", boundary); expect((await row(tx, "PlanningAiPool", boundary.id))?.id).toHaveLength(200);
      for (const badId of ["", "bad space", "تجربة", "X".repeat(201)]) {
        expect(PlanningAiPoolSchema.safeParse({ ...wire(boundary), id: badId }).success).toBe(false);
        await constrained(tx, () => insert(tx, "PlanningAiPool", { ...boundary, id: badId }));
      }
      const paid = enrollment(boundary.id, owner.id, PLANNING_PLANS[0]), paidWire = wire(paid);
      expect(PlanningAiEnrollmentSchema.safeParse(paidWire).success).toBe(true);
      for (const amount of ["not-a-number", "1e3", "-1", "9223372036854775808"]) {
        let rejected = false;
        expect(() => { rejected = !PlanningAiEnrollmentSchema.safeParse({ ...paidWire, netAmountMinor: amount }).success; }).not.toThrow();
        expect(rejected).toBe(true);
      }
      const earlier = new Date((boundary.createdAt as Date).getTime() - 1);
      expect(PlanningAiPoolSchema.safeParse({ ...wire(boundary), updatedAt: earlier.toISOString() }).success).toBe(false);
      const invalidTimeOrg = await organization(tx, owner.id);
      await constrained(tx, () => insert(tx, "PlanningAiPool", { ...pool({ organizationId: invalidTimeOrg.id }), updatedAt: new Date(0) }));
      expect(PlanningAiEnrollmentSchema.safeParse({ ...paidWire, acceptanceReference: "https://receipt.example.invalid/id" }).success).toBe(false);
      await constrained(tx, () => insert(tx, "PlanningAiEnrollment", { ...paid, acceptanceReference: "https://receipt.example.invalid/id" }));
    });
  }, 90000);

  it("serializes native RC overlap and stale RR snapshots, accepts adjacent periods and bounds irreversible counters without retaining synthetic consumption", async () => {
    await requireStorage();
    // Exactly one retained pool/enrollment. Their current labels are inert:
    // test-only subjects and synthetic event/price references prove no invoice.
    const owner = await user(prisma, true), ownBrand = await brand(prisma, owner.id), parent = pool({ brandId: ownBrand.id });
    await insert(prisma, "PlanningAiPool", parent);
    const accepted = enrollment(parent.id, owner.id, PLANNING_PLANS[0]); await insert(prisma, "PlanningAiEnrollment", accepted);
    const start = new Date("2094-04-01T00:00:00.000Z"), may = new Date("2094-05-01T00:00:00.000Z"), june = new Date("2094-06-01T00:00:00.000Z"), july = new Date("2094-07-01T00:00:00.000Z");
    const first = cycle(accepted, start, may), second = cycle(accepted, start, may);
    const blocker = new PrismaClient(), writerA = new PrismaClient(), writerB = new PrismaClient(), monitor = new PrismaClient();
    const ready = latch<number>(), release = latch<void>(), aStarted = latch<number>(), bStarted = latch<number>();
    let attemptA: Promise<void> | undefined, attemptB: Promise<void> | undefined;
    const holding = blocker.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout='12s'`;
      // NO KEY UPDATE admits incidental FK KEY SHARE. The observed INSERT wait
      // therefore establishes the stronger parent-version mutation boundary.
      await tx.$queryRaw`SELECT id FROM "PlanningAiPool" WHERE id=${parent.id} FOR NO KEY UPDATE`;
      const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
      ready.resolve(rows[0]!.pid); await release.promise;
    }, { maxWait: 5000, timeout: 20000 }); void holding.catch(() => {});
    async function write(client: PrismaClient, data: Fields, started: ReturnType<typeof latch<number>>) {
      await client.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout='12s'`;
        const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
        started.resolve(rows[0]!.pid); await insert(tx, "PlanningAiCycle", data);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 20000 });
    }
    async function waitForParent(pid: number, blockers: number[], operation: Promise<void>) {
      const observation = (async () => {
        const deadline = performance.now() + 4000;
        while (performance.now() < deadline) {
          const rows = await monitor.$queryRaw<Array<{ pid: number }>>(Prisma.sql`SELECT pid FROM pg_stat_activity
            WHERE datname=current_database() AND pid=${pid} AND wait_event_type='Lock'
              AND pg_blocking_pids(pid) && ARRAY[${Prisma.join(blockers)}]::int[] AND query LIKE ${'%"PlanningAiCycle"%'}`);
          if (rows.length) return true; await delay(20);
        }
        throw new Error("Planning cycle did not reach its required actual parent wait");
      })();
      return Promise.race([observation, operation.then(() => { throw new Error("Cycle insert returned before its required parent wait"); })]);
    }
    try {
      const blockerPid = await Promise.race([ready.promise, holding.then(() => { throw new Error("Planning blocker ended before its PID"); })]);
      attemptA = write(writerA, first, aStarted); void attemptA.catch(() => {});
      const pidA = await Promise.race([aStarted.promise, attemptA.then(() => { throw new Error("Writer A ended before native PID capture"); })]);
      expect(await waitForParent(pidA, [blockerPid], attemptA)).toBe(true);
      attemptB = write(writerB, second, bStarted); void attemptB.catch(() => {});
      const pidB = await Promise.race([bStarted.promise, attemptB.then(() => { throw new Error("Writer B ended before native PID capture"); })]);
      expect(await waitForParent(pidB, [blockerPid, pidA], attemptB)).toBe(true);
      const before = await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM "PlanningAiCycle" WHERE "poolId"=${parent.id}`;
      expect(before[0]!.count).toBe(0);
      release.resolve(); await holding;
      const results = await Promise.allSettled([attemptA, attemptB]);
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      const failed = results.find(result => result.status === "rejected");
      if (failed?.status !== "rejected") throw new Error("Native overlap race must reject exactly one contender");
      nativeRejection(failed.reason, ["23514"]);
      const saved = await prisma.$queryRaw<Fields[]>`SELECT * FROM "PlanningAiCycle" WHERE "poolId"=${parent.id}`;
      expect(saved).toHaveLength(1); expect([first.id, second.id]).toContain(saved[0]!.id);
      expect(saved[0]).toMatchObject({ startsAt: start, endsAt: may, allowance: 3, held: 0, consumed: 0 });
      expect(await row(prisma, "PlanningAiPool", parent.id)).toMatchObject({ revision: 2 }); // Losing UPDATE rolled back.
    } finally {
      release.resolve(); await holding.catch(() => {});
      await Promise.allSettled([attemptA, attemptB].filter((operation): operation is Promise<void> => operation !== undefined));
      await Promise.all([blocker.$disconnect(), writerA.$disconnect(), writerB.$disconnect(), monitor.$disconnect()]);
    }
    const adjacent = cycle(accepted, may, june); await insert(prisma, "PlanningAiCycle", adjacent);
    expect(await row(prisma, "PlanningAiCycle", adjacent.id)).toMatchObject({ startsAt: may, endsAt: june, held: 0, consumed: 0 });
    const winner = (await row(prisma, "PlanningAiCycle", first.id)) ?? (await row(prisma, "PlanningAiCycle", second.id));
    if (!winner) throw new Error("Overlap winner missing from retained owned history");
    const staleCandidate = cycle(accepted, june, july), fresh = cycle(accepted, june, july);
    const staleWriter = new PrismaClient(), snapshotReady = latch<number>(), releaseSnapshot = latch<void>();
    const stale = staleWriter.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout='12s'`;
      const observed = await row(tx, "PlanningAiPool", parent.id);
      if (!observed) throw new Error("RR snapshot must include its owned pool");
      snapshotReady.resolve(Number(observed.revision)); await releaseSnapshot.promise;
      await insert(tx, "PlanningAiCycle", staleCandidate);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 20000 }); void stale.catch(() => {});
    try {
      const capturedRevision = await Promise.race([snapshotReady.promise, stale.then(() => { throw new Error("RR writer ended before its actual snapshot"); })]);
      await insert(prisma, "PlanningAiCycle", fresh);
      expect(Number((await row(prisma, "PlanningAiPool", parent.id))!.revision)).toBe(capturedRevision + 1);
      releaseSnapshot.resolve();
      const failure = await stale.then(() => null, (error: unknown) => error);
      expect(failure instanceof Prisma.PrismaClientKnownRequestError).toBe(true);
      if (!(failure instanceof Prisma.PrismaClientKnownRequestError)) throw new Error("Expected actual RR serialization rejection");
      expect(failure.code === "P2034" || failure.code === "P2010" && String(failure.meta?.code) === "40001").toBe(true);
      expect(await row(prisma, "PlanningAiCycle", staleCandidate.id)).toBeUndefined();
      expect(await row(prisma, "PlanningAiPool", parent.id)).toMatchObject({ revision: capturedRevision + 1 });
    } finally { releaseSnapshot.resolve(); await stale.catch(() => {}); await staleWriter.$disconnect(); }
    await rollbackFixture(async tx => {
      const initial = (await row(tx, "PlanningAiCycle", String(winner.id)))!, next = (await row(tx, "PlanningAiCycle", adjacent.id))!;
      const separate = cycle(accepted, new Date("2094-08-01T00:00:00.000Z"), new Date("2094-09-01T00:00:00.000Z"));
      for (const change of [{ planId: "GROWTH", netAmountMinor: BigInt(29900), allowance: 15 }, { priceVersion: key() },
        { currency: "USD" }, { allowance: 4 }, { held: 1 }, { consumed: 1 }, { startsAt: separate.endsAt }, { revision: 2 }]) {
        await constrained(tx, () => insert(tx, "PlanningAiCycle", { ...separate, ...change }));
      }
      await constrained(tx, () => insert(tx, "PlanningAiCycle", { ...separate, sourceEventId: initial.sourceEventId }), ["23505"]);
      for (const change of [{ id: key() }, { poolId: key() }, { enrollmentId: key() }, { allowance: 15 },
        { sourceEventId: key() }, { subscriptionId: key() }, { startsAt: new Date("2094-03-01T00:00:00.000Z") }, { revision: 3 }]) {
        await constrained(tx, () => patch(tx, "PlanningAiCycle", String(initial.id), { ...bump(initial), ...change }));
      }
      await patch(tx, "PlanningAiCycle", String(initial.id), bump(initial, { held: 1 }));
      const held = (await row(tx, "PlanningAiCycle", String(initial.id)))!;
      for (const change of [{ held: -1 }, { consumed: -1 }, { held: 4 }, { held: 2, consumed: 2 }, { consumed: 2147483647 }]) {
        await constrained(tx, () => patch(tx, "PlanningAiCycle", String(initial.id), { ...bump(held), ...change }));
      }
      await patch(tx, "PlanningAiCycle", String(initial.id), bump(held, { held: 1, consumed: 2 }));
      const used = (await row(tx, "PlanningAiCycle", String(initial.id)))!;
      await constrained(tx, () => patch(tx, "PlanningAiCycle", String(initial.id), bump(used, { consumed: 1 }))); // Independently within allowance, still irreversible.
      await patch(tx, "PlanningAiCycle", String(initial.id), bump(used, { held: 0 }));
      await constrained(tx, () => patch(tx, "PlanningAiCycle", String(initial.id), { ...bump(used), revision: 5, held: 0, state: "VOIDED" }));
      await patch(tx, "PlanningAiCycle", adjacent.id, bump(next, { held: 1 }));
      const occupied = (await row(tx, "PlanningAiCycle", adjacent.id))!;
      await constrained(tx, () => patch(tx, "PlanningAiCycle", adjacent.id, bump(occupied, { held: 0, state: "VOIDED" }))); // OLD hold cannot be cleared and voided together.
      await patch(tx, "PlanningAiCycle", adjacent.id, bump(occupied, { held: 0 }));
      const released = (await row(tx, "PlanningAiCycle", adjacent.id))!;
      await patch(tx, "PlanningAiCycle", adjacent.id, bump(released, { state: "VOIDED" }));
      const voided = (await row(tx, "PlanningAiCycle", adjacent.id))!;
      await constrained(tx, () => patch(tx, "PlanningAiCycle", adjacent.id, bump(voided, { state: "ACTIVE" })));
      await constrained(tx, () => patch(tx, "PlanningAiCycle", adjacent.id, bump(voided, { consumed: 1 })));
      await constrained(tx, () => insert(tx, "PlanningAiCycle", { ...cycle(accepted, may, june), subscriptionId: adjacent.subscriptionId }), ["23505"]);
      const replacement = cycle(accepted, may, june); await insert(tx, "PlanningAiCycle", replacement); // VOIDED interval no longer blocks a distinct native source.
      await constrained(tx, () => remove(tx, "PlanningAiCycle", adjacent.id));
      await constrained(tx, () => remove(tx, "PlanningAiEnrollment", accepted.id));
    });
    const retained = await prisma.$queryRaw<Fields[]>`SELECT * FROM "PlanningAiCycle" WHERE "poolId"=${parent.id} ORDER BY "startsAt"`;
    expect(retained).toHaveLength(3); expect(retained.every(saved => saved.held === 0 && saved.consumed === 0 && saved.state === "ACTIVE")).toBe(true);
    expect(retained.map(saved => saved.startsAt)).toEqual([start, may, june]);
  }, 90000);
});
