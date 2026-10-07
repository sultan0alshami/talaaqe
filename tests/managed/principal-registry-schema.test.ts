import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { PrincipalPartySchema } from "@/lib/managed/principal-contracts";

// Exactly three native PG groups. Root alone adopts/runs against the guarded
// task test target. These synthetic declaration/storage records prove no legal
// qualification, governing authority, service readiness or LIVE provisioning.
// No future-contract module/test registration import, auth/producer/Date mock,
// reset, TRUNCATE, trigger disabling, provider call or source data is used.
type Table = "InfamePrincipal" | "InfamePrincipalVersion" | "InfamePrincipalState";
type Fields = Record<string, unknown>;
type Db = PrismaClient | Prisma.TransactionClient;
const tables: Table[] = ["InfamePrincipal", "InfamePrincipalVersion", "InfamePrincipalState"];
const principals = new Set<string>(), key = () => randomUUID(), cap = 131072;
const provenance = "DEVELOPMENT_FIXTURE";
const retention = ["23001", "23503"];

beforeAll(async () => {
  const taskId = process.env.INFAME_TASK_ID;
  if (!taskId || !/^infame_[a-f0-9]{12}$/.test(taskId) || process.env.INFAME_ENV !== "test" || process.env.NODE_ENV === "production") throw new Error("Principal storage witnesses require the guarded test task");
  const rows = await prisma.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]?.id !== taskId || rows[0]?.kind !== "test" || rows[0]?.db !== taskId + "_test" || rows[0]?.host !== "127.0.0.1") throw new Error("Principal storage fixture target identity mismatch");
});
async function exists(table: Table) {
  return (await prisma.$queryRaw<Array<{ present: boolean }>>`SELECT to_regclass(${`"${table}"`}) IS NOT NULL AS present`)[0]?.present === true;
}
async function requireStorage() {
  for (const table of tables) expect(await exists(table), `Frozen M04B2 table ${table} must exist`).toBe(true);
}
function value(column: string, input: unknown) {
  if (input === null) return Prisma.sql`NULL`;
  if (column === "content") return Prisma.sql`${JSON.stringify(input)}::jsonb`;
  // Bind actual UTC instants as explicit civil ISO timestamp(3), independent
  // of the database session timezone; do not pass implicit Date parameters.
  if (input instanceof Date) return Prisma.sql`${input.toISOString()}::timestamp(3)`;
  return Prisma.sql`${input}`;
}
async function insert(table: Table, data: Fields, db: Db = prisma) {
  const entries = Object.entries(data);
  await db.$executeRaw(Prisma.sql`INSERT INTO ${Prisma.raw('"' + table + '"')}
    (${Prisma.join(entries.map(([column]) => Prisma.raw('"' + column + '"')))})
    VALUES (${Prisma.join(entries.map(([column, input]) => value(column, input)))})`);
}
async function patch(table: Table, id: string, data: Fields) {
  const column = table === "InfamePrincipalState" ? "principalId" : "id";
  await prisma.$executeRaw(Prisma.sql`UPDATE ${Prisma.raw('"' + table + '"')}
    SET ${Prisma.join(Object.entries(data).map(([name, input]) => Prisma.sql`${Prisma.raw('"' + name + '"')}=${value(name, input)}`))}
    WHERE ${Prisma.raw('"' + column + '"')}=${id}`);
}
async function row(table: Table, id: string) {
  const column = table === "InfamePrincipalState" ? "principalId" : "id";
  return (await prisma.$queryRaw<Fields[]>(Prisma.sql`SELECT * FROM ${Prisma.raw('"' + table + '"')}
    WHERE ${Prisma.raw('"' + column + '"')}=${id}`))[0];
}
function rejectedSql(error: unknown, codes: readonly string[]) {
  expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw new Error("Expected actual native principal storage rejection");
  expect(error.code).toBe("P2010"); expect(codes).toContain(String(error.meta?.code));
}
async function constrained(operation: Promise<unknown>, codes: readonly string[] = ["23514"]) {
  const failure = await operation.then(() => null, (error: unknown) => error); rejectedSql(failure, codes);
}
afterEach(async () => {
  if (principals.size) {
    const present = new Set<Table>(); for (const table of tables) if (await exists(table)) present.add(table);
    await prisma.$transaction(async tx => {
      // State removal deliberately precedes all current/noncurrent history.
      // Only registered synthetic principal IDs are eligible for this cleanup.
      for (const table of ["InfamePrincipalState", "InfamePrincipalVersion", "InfamePrincipal"] as const) {
        if (present.has(table)) await tx.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')}
          WHERE ${Prisma.raw(table === "InfamePrincipal" ? "id" : '"principalId"')} IN (${Prisma.join([...principals])})`);
      }
    });
  }
  principals.clear();
});
function principalData(id = "principal~synthetic:" + key()) {
  principals.add(id); return { id, provenance, createdAt: new Date(Date.now() - 60000) };
}
type Principal = ReturnType<typeof principalData>;
function stateData(parent: Principal, override: Fields = {}) {
  const createdAt = new Date(parent.createdAt.getTime() + 1);
  return { principalId: parent.id, revision: 1, state: "DRAFT", currentVersionId: null, currentVersionNumber: null,
    currentSourceHash: null, createdAt, updatedAt: createdAt, ...override };
}
async function registry() { const parent = principalData(); await insert("InfamePrincipal", parent); await insert("InfamePrincipalState", stateData(parent)); return parent; }
function versionData(parent: Principal, version = 1, label = "Original synthetic declaration") {
  const original = (text: string) => ({ text, language: "ar" });
  const party = PrincipalPartySchema.parse({ legalNameOriginal: original("  مبدأ اصطناعي " + label + "\t  "), tradingNameOriginal: null,
    legalFormOriginal: original("  تصريح اصطناعي / Synthetic declaration  "), jurisdiction: "KW",
    registration: { authorityOriginal: original("  جهة اصطناعية\nSynthetic authority  "), identifier: "  SYNTHETIC-ONLY\t  " },
    registeredAddressOriginal: original("  عنوان اصطناعي\r\nNo provisioned legal entity  ") });
  const content = { schemaVersion: 1, principalId: parent.id, provenance: parent.provenance, version, party,
    declaredActivityKeys: ["synthetic-campaign-service"], marketCountryCodes: ["KW", "SA"] };
  return { id: "version~synthetic:" + key(), principalId: parent.id, provenance: parent.provenance, version,
    content, sourceHash: canonicalHash(content), createdAt: new Date(parent.createdAt.getTime() + 2 + version) };
}
type Version = ReturnType<typeof versionData>;
async function version(parent: Principal, number = 1) { const data = versionData(parent, number); await insert("InfamePrincipalVersion", data); return data; }
function pointer(saved: Version) { return { currentVersionId: saved.id, currentVersionNumber: saved.version, currentSourceHash: saved.sourceHash }; }
function updateData(parent: Principal, revision: number, state: string, saved?: Version) {
  return { revision, state, ...(saved ? pointer(saved) : {}), updatedAt: new Date(parent.createdAt.getTime() + 100 + revision) };
}
async function versions(parent: Principal) {
  return prisma.$queryRaw<Fields[]>`SELECT * FROM "InfamePrincipalVersion" WHERE "principalId"=${parent.id} ORDER BY version`;
}
function changedContent(data: Version, content: unknown) { return { ...data, content, sourceHash: canonicalHash(content) }; }
function latch<T>() { let resolve!: (input: T | PromiseLike<T>) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (input: T) => resolve(input) }; }
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

describe("M04B2 principal registry: three native synthetic PG groups", () => {
  it("retains valid original versions/current lifecycle with exact principal/provenance/hash/ordinal and bounded structural content", async () => {
    await requireStorage(); const a = await registry(), b = await registry(), first = await version(a), latest = await version(a, 2), other = await version(b);
    expect(a.id).toContain("~"); expect(first.id).toContain("~");
    expect((await row("InfamePrincipalVersion", first.id))?.content).toEqual(first.content);
    expect((await row("InfamePrincipalVersion", first.id))?.sourceHash).toBe(canonicalHash(first.content));
    const before = await row("InfamePrincipalState", a.id);
    for (const changed of [pointer(other), { ...pointer(latest), currentVersionId: key() }, { ...pointer(latest), currentVersionNumber: 1 },
      { ...pointer(latest), currentSourceHash: "a".repeat(64) }]) {
      await constrained(patch("InfamePrincipalState", a.id, { ...updateData(a, 2, "ACTIVE"), ...changed }), ["23503", "23514"]);
    }
    for (const changed of [{ currentVersionId: null }, { currentVersionNumber: null }, { currentSourceHash: null }]) {
      await constrained(patch("InfamePrincipalState", a.id, { ...updateData(a, 2, "ACTIVE", latest), ...changed }));
    }
    await constrained(patch("InfamePrincipalState", a.id, updateData(a, 2, "ACTIVE", first))); // New ACTIVE must select latest.
    await constrained(patch("InfamePrincipalState", a.id, { ...updateData(a, 2, "ACTIVE"), currentVersionId: null, currentVersionNumber: null, currentSourceHash: null }));
    expect(await row("InfamePrincipalState", a.id)).toEqual(before);
    await patch("InfamePrincipalState", a.id, updateData(a, 2, "ACTIVE", latest));
    await patch("InfamePrincipalState", a.id, updateData(a, 3, "PAUSED", latest));
    const paused = await row("InfamePrincipalState", a.id); expect(paused).toMatchObject({ revision: 3, state: "PAUSED", ...pointer(latest) });
    await constrained(patch("InfamePrincipalState", a.id, updateData(a, 4, "PAUSED", first)));
    await constrained(patch("InfamePrincipalState", a.id, { ...updateData(a, 4, "PAUSED"), currentVersionId: null, currentVersionNumber: null, currentSourceHash: null }));
    await patch("InfamePrincipalState", a.id, updateData(a, 4, "ACTIVE", latest));
    await patch("InfamePrincipalState", a.id, updateData(a, 5, "REVOKED", latest));
    expect(await row("InfamePrincipalState", a.id)).toMatchObject({ state: "REVOKED", revision: 5, ...pointer(latest) });
    expect((await versions(a)).map(saved => saved.version)).toEqual([1, 2]);

    const structural = await registry(), data = versionData(structural);
    const content = data.content;
    for (const malformed of [[], null, { ...content, schemaVersion: 2 }, { ...content, principalId: b.id },
      { ...content, provenance: "LIVE" }, { ...content, version: 2 }, { ...content, version: "1" },
      { ...content, party: null }, { ...content, party: [] }, { ...content, party: "not-an-object" },
      { ...content, declaredActivityKeys: [] }, { ...content, declaredActivityKeys: ["repeat", "repeat"] },
      { ...content, declaredActivityKeys: ["UPPER"] }, { ...content, declaredActivityKeys: ["bad_key"] },
      { ...content, declaredActivityKeys: ["1starts-with-number"] }, { ...content, declaredActivityKeys: ["a".repeat(101)] },
      { ...content, declaredActivityKeys: Array.from({ length: 51 }, (_, index) => "activity-" + index) },
      { ...content, marketCountryCodes: [] }, { ...content, marketCountryCodes: ["KW", "KW"] },
      { ...content, marketCountryCodes: ["kw"] }, { ...content, marketCountryCodes: [1] },
      { ...content, marketCountryCodes: Array.from({ length: 51 }, (_, index) => String.fromCharCode(65 + Math.floor(index / 26)) + String.fromCharCode(65 + index % 26)) },
      { ...content, ignoredPrivateField: "unknown-top-key" }, { ...content, party: { sqlByteProbe: "a".repeat(cap) } }]) {
      await constrained(insert("InfamePrincipalVersion", changedContent(data, malformed)));
    }
    const { marketCountryCodes: _markets, ...missing } = content; void _markets;
    await constrained(insert("InfamePrincipalVersion", changedContent(data, missing)));
    for (const changed of [{ provenance: "LIVE", content: { ...content, provenance: "LIVE" } }, { sourceHash: "A".repeat(64) },
      { sourceHash: "not-a-hash" }, { createdAt: new Date(structural.createdAt.getTime() - 1) }]) {
      await constrained(insert("InfamePrincipalVersion", { ...data, ...changed }), ["23503", "23514"]);
    }
    expect(await versions(structural)).toEqual([]); await insert("InfamePrincipalVersion", data);
    for (const id of ["", "bad space", " bad", "مبدأ", "x".repeat(201)]) await constrained(insert("InfamePrincipal", principalData(id)));
    await constrained(insert("InfamePrincipal", { ...principalData(), provenance: "UNKNOWN" }));
  });

  it("enforces exact sequential append/state revisions, immutable history, restrictive current/noncurrent retention and terminal revocation/reset denial", async () => {
    await requireStorage(); const a = await registry(), first = await version(a), initial = await row("InfamePrincipalState", a.id);
    const noState = principalData(); await insert("InfamePrincipal", noState);
    await constrained(insert("InfamePrincipalVersion", versionData(noState)));
    for (const override of [{ revision: 2 }, { state: "ACTIVE", ...pointer(first) }, { state: "PAUSED", ...pointer(first) },
      { state: "REVOKED" }, { state: "DRAFT", ...pointer(first) }, { updatedAt: new Date(noState.createdAt.getTime() - 1) }]) {
      await constrained(insert("InfamePrincipalState", stateData(noState, override)));
    }
    await insert("InfamePrincipalState", stateData(noState));
    for (const number of [0, 1, 3, 2147483647]) await constrained(insert("InfamePrincipalVersion", versionData(a, number)), ["23514", "23505"]);
    expect(await versions(a)).toHaveLength(1);
    for (const changed of [{ id: key() }, { provenance: "LIVE" }, { createdAt: new Date() }]) await constrained(patch("InfamePrincipal", a.id, changed));
    for (const changed of [{ id: key() }, { principalId: noState.id }, { provenance: "LIVE" }, { version: 2 },
      { content: { ...first.content, declaredActivityKeys: ["replacement"] } }, { sourceHash: "b".repeat(64) }, { createdAt: new Date() }]) {
      await constrained(patch("InfamePrincipalVersion", first.id, changed));
    }
    for (const changed of [{ revision: 1 }, { revision: 3 }, { principalId: noState.id }, { createdAt: new Date() },
      { updatedAt: new Date(a.createdAt.getTime()) }]) {
      await constrained(patch("InfamePrincipalState", a.id, { ...updateData(a, 2, "ACTIVE", first), ...changed }));
    }
    expect(await row("InfamePrincipalState", a.id)).toEqual(initial);
    await patch("InfamePrincipalState", a.id, updateData(a, 2, "ACTIVE", first));
    const second = await version(a, 2);
    await patch("InfamePrincipalState", a.id, updateData(a, 3, "ACTIVE", second));
    await constrained(patch("InfamePrincipalState", a.id, updateData(a, 4, "ACTIVE", first)));
    await constrained(patch("InfamePrincipalState", a.id, { ...updateData(a, 4, "DRAFT"), currentVersionId: null, currentVersionNumber: null, currentSourceHash: null }));
    await constrained(prisma.$executeRaw`DELETE FROM "InfamePrincipalVersion" WHERE id=${first.id}`); // Retained noncurrent version.
    await constrained(prisma.$executeRaw`DELETE FROM "InfamePrincipalVersion" WHERE id=${second.id}`);
    await constrained(prisma.$executeRaw`DELETE FROM "InfamePrincipal" WHERE id=${a.id}`, retention);
    await patch("InfamePrincipalState", a.id, updateData(a, 4, "PAUSED", second));
    await constrained(patch("InfamePrincipalState", a.id, updateData(a, 5, "REVOKED", first)));
    await patch("InfamePrincipalState", a.id, updateData(a, 5, "REVOKED", second));
    const revoked = await row("InfamePrincipalState", a.id);
    for (const state of ["DRAFT", "ACTIVE", "PAUSED", "REVOKED"]) await constrained(patch("InfamePrincipalState", a.id, updateData(a, 6, state, second)));
    await constrained(insert("InfamePrincipalVersion", versionData(a, 3)));
    expect(await row("InfamePrincipalState", a.id)).toEqual(revoked); expect(await versions(a)).toHaveLength(2);
    await patch("InfamePrincipalState", noState.id, updateData(noState, 2, "REVOKED"));
    expect(await row("InfamePrincipalState", noState.id)).toMatchObject({ state: "REVOKED", revision: 2, currentVersionId: null, currentVersionNumber: null, currentSourceHash: null });
    await constrained(insert("InfamePrincipalVersion", versionData(noState)));
    const reset = await registry(); await version(reset); await prisma.$executeRaw`DELETE FROM "InfamePrincipalState" WHERE "principalId"=${reset.id}`;
    await constrained(insert("InfamePrincipalState", stateData(reset))); // History prevents deletion/recreation reset.
    await constrained(insert("InfamePrincipalVersion", versionData(reset, 2))); // Existing state is required.
  });

  it("waits on the actual stable parent before append and leaves one ordinal winner with no losing transaction orphan effects", async () => {
    await requireStorage(); const parent = await registry(), first = versionData(parent, 1, "Contender A"), second = versionData(parent, 1, "Contender B");
    const sideA = principalData("principal~race-a:" + key()), sideB = principalData("principal~race-b:" + key());
    const blocker = new PrismaClient(), writerA = new PrismaClient(), writerB = new PrismaClient(), monitor = new PrismaClient();
    const ready = latch<number>(), release = latch<void>(), aStarted = latch<number>(), bStarted = latch<number>();
    let attemptA: Promise<void> | undefined, attemptB: Promise<void> | undefined;
    const holding = blocker.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout='6s'`;
      // NO KEY UPDATE does not block the FK's KEY SHARE. Therefore the observed
      // wait establishes the append guard's stronger parent FOR UPDATE, rather
      // than accepting an incidental foreign-key or ordinal-index wait.
      await tx.$queryRaw`SELECT id FROM "InfamePrincipal" WHERE id=${parent.id} FOR NO KEY UPDATE`;
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
      ready.resolve(pid!); await release.promise;
    }, { maxWait: 5000, timeout: 15000 }); void holding.catch(() => {});
    async function write(client: PrismaClient, side: Principal, candidate: Version, started: ReturnType<typeof latch<number>>) {
      await client.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout='6s'`;
        const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`; started.resolve(pid!);
        await insert("InfamePrincipal", side, tx); await insert("InfamePrincipalState", stateData(side), tx);
        await insert("InfamePrincipalVersion", candidate, tx);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 15000 });
    }
    async function waitForParent(pid: number, blockers: number[], operation: Promise<void>) {
      const observation = (async () => {
        const deadline = performance.now() + 4000;
        while (performance.now() < deadline) {
          const rows = await monitor.$queryRaw<Array<{ pid: number }>>(Prisma.sql`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
            AND pid=${pid} AND wait_event_type='Lock' AND pg_blocking_pids(pid) && ARRAY[${Prisma.join(blockers)}]::int[]
            AND query LIKE ${'%"InfamePrincipalVersion"%'}`);
          if (rows.length) return true; await delay(20);
        }
        throw new Error("Principal append did not reach its actual parent lock wait");
      })();
      return Promise.race([observation, operation.then(() => { throw new Error("Principal append returned before the required real parent wait"); })]);
    }
    try {
      const ownerPid = await Promise.race([ready.promise, holding.then(() => { throw new Error("Principal blocker ended before native lock capture"); })]);
      attemptA = write(writerA, sideA, first, aStarted); void attemptA.catch(() => {});
      const pidA = await Promise.race([aStarted.promise, attemptA.then(() => { throw new Error("Principal writer A ended before native PID capture"); })]);
      expect(await waitForParent(pidA, [ownerPid], attemptA)).toBe(true);
      attemptB = write(writerB, sideB, second, bStarted); void attemptB.catch(() => {});
      const pidB = await Promise.race([bStarted.promise, attemptB.then(() => { throw new Error("Principal writer B ended before native PID capture"); })]);
      expect(await waitForParent(pidB, [ownerPid, pidA], attemptB)).toBe(true);
      expect(await versions(parent)).toEqual([]); expect(await row("InfamePrincipal", sideA.id)).toBeUndefined(); expect(await row("InfamePrincipal", sideB.id)).toBeUndefined();
      release.resolve(); await holding;
      const results = await Promise.allSettled([attemptA, attemptB]); expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      const failed = results.find(result => result.status === "rejected"); if (failed?.status !== "rejected") throw new Error("Native ordinal race must reject exactly one writer");
      rejectedSql(failed.reason, ["23514", "23505"]);
      const saved = await versions(parent); expect(saved).toHaveLength(1); expect(saved[0]).toMatchObject({ principalId: parent.id, provenance, version: 1 });
      expect([first.id, second.id]).toContain(saved[0]?.id);
      const winner = saved[0]?.id === first.id ? first : second, committedSide = winner === first ? sideA : sideB, rolledBackSide = winner === first ? sideB : sideA;
      expect(saved[0]?.content).toEqual(winner.content); expect(saved[0]?.sourceHash).toBe(canonicalHash(winner.content));
      expect(await row("InfamePrincipal", committedSide.id)).toMatchObject({ id: committedSide.id, provenance });
      expect(await row("InfamePrincipalState", committedSide.id)).toMatchObject({ principalId: committedSide.id, revision: 1, state: "DRAFT" });
      expect(await row("InfamePrincipal", rolledBackSide.id)).toBeUndefined(); expect(await row("InfamePrincipalState", rolledBackSide.id)).toBeUndefined();
      expect(await row("InfamePrincipalState", parent.id)).toMatchObject({ revision: 1, state: "DRAFT", currentVersionId: null });
      await version(parent, 2); expect((await versions(parent)).map(saved => saved.version)).toEqual([1, 2]);
    } finally {
      release.resolve(); await holding.catch(() => {}); await Promise.allSettled([attemptA, attemptB].filter((operation): operation is Promise<void> => operation !== undefined));
      await Promise.all([blocker.$disconnect(), writerA.$disconnect(), writerB.$disconnect(), monitor.$disconnect()]);
    }
  }, 30000);
});
