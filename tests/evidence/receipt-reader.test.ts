import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { PrismaClient, type EvidenceCommand, type Prisma } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { canonicalHash, record } from "@/lib/onboarding/drafts";
import {
  createEvidenceReceiptReader,
  type EvidenceReceiptReader,
  type ReceiptScope,
} from "@/lib/evidence/receipt-reader";

// The coordinator alone executes this through the guarded Vitest target.
// Independently authored; no execution by its author.
// These directly minted task-local receipts are synthetic iterator fixtures.
// They prove native pagination/budget behavior, never actual evidence acceptance.
// Confidence/consent command integration is an independently owned follow-on.

const actors = new Set<string>();
const at = new Date("2026-10-05T12:00:00.123Z");
const privateMarker = "SYNTHETIC_PRIVATE_RECEIPT_METADATA_DO_NOT_EXPOSE";
const invalidHash = "0".repeat(64);

afterEach(async () => {
  await prisma.evidenceCommand.deleteMany({ where: { actorUserId: { in: [...actors] } } });
  await prisma.user.deleteMany({ where: { id: { in: [...actors] } } });
  actors.clear();
});

function scope(overrides: Partial<ReceiptScope> = {}): ReceiptScope {
  const value = { resourceType: "MetricsSnapshot", resourceId: randomUUID(), actorUserId: randomUUID(), ...overrides };
  actors.add(value.actorUserId);
  return value;
}

async function seed(scope: ReceiptScope, count: number, options: { validIndex?: number; createdAt?: Date } = {}) {
  actors.add(scope.actorUserId);
  await prisma.user.upsert({ where: { id: scope.actorUserId }, update: {}, create: {
    id: scope.actorUserId, role: "CREATOR", name: "Synthetic receipt iterator actor", isTest: true,
    email: `${scope.actorUserId}@example.invalid`, passwordHash: "not-a-login",
  } });
  const batch = randomUUID();
  const rows: Prisma.EvidenceCommandCreateManyInput[] = Array.from({ length: count }, (_, index) => {
    const operationKey = `synthetic-reader:${batch}:${index}`;
    const resultJson = { resourceId: scope.resourceId, revision: 2, privateMarker, nested: { original: ["أصل مصطنع", "  original\n "] } };
    return {
      id: `reader_${batch}_${String(index).padStart(6, "0")}`,
      actorUserId: scope.actorUserId, operationKey, resourceType: scope.resourceType, resourceId: scope.resourceId,
      payloadHash: index === options.validIndex ? canonicalHash({ operationKey, resourceId: scope.resourceId, resultJson }) : invalidHash,
      resultJson, createdAt: options.createdAt ?? scope.createdAt ?? at,
    };
  });
  // Reverse physical insertion order; output must follow the exclusive ID key.
  // Batches keep even the hard-limit fixture below PostgreSQL's bind ceiling.
  const reversed = [...rows].reverse();
  for (let offset = 0; offset < reversed.length; offset += 512) {
    await prisma.evidenceCommand.createMany({ data: reversed.slice(offset, offset + 512) });
  }
  return rows.map(row => row.id!);
}

type NativePage = { args: Prisma.EvidenceCommandFindManyArgs; ids: string[]; hydrated: number };
type NativeProbe = { sql: string; result: unknown };
function observeNativeReads(afterRows?: (rows: EvidenceCommand[]) => void) {
  const pages: NativePage[] = [], probes: NativeProbe[] = [];
  const client = prisma.$extends({ query: {
    evidenceCommand: { async findMany({ args, query }) {
      expect(args.select).toBeUndefined();
      expect(args.omit).toBeUndefined();
      // The assertions establish full native hydration. Prisma's generic
      // extension result also includes hypothetical select/omit result shapes.
      const rows = await query(args) as EvidenceCommand[];
      pages.push({ args, ids: rows.map(row => row.id), hydrated: rows.length });
      afterRows?.(rows);
      return rows;
    } },
    async $queryRaw({ args, query }) {
      const result = await query(args);
      probes.push({ sql: args.sql, result });
      return result;
    },
  } }) as unknown as PrismaClient;
  return { client, pages, probes, hydrated: () => pages.reduce((sum, page) => sum + page.hydrated, 0) };
}

async function collect(rows: AsyncIterable<EvidenceCommand>, yielded?: string[]) {
  const result: EvidenceCommand[] = [];
  for await (const row of rows) { result.push(row); yielded?.push(row.id); }
  return result;
}

async function read(reader: EvidenceReceiptReader, selected: ReceiptScope, client: PrismaClient = prisma) {
  return client.$transaction(tx => collect(reader.scan(tx, selected)), { maxWait: 5000, timeout: 12000 });
}

async function selectedIdentity(reader: EvidenceReceiptReader, selected: ReceiptScope, client: PrismaClient = prisma) {
  return client.$transaction(async tx => {
    let result: string | null = null;
    for await (const row of reader.scan(tx, selected)) {
      reader.checkpoint();
      const valid = row.payloadHash === canonicalHash({ operationKey: row.operationKey, resourceId: row.resourceId, resultJson: row.resultJson });
      reader.checkpoint();
      if (valid) result = row.id;
    }
    reader.checkpoint();
    return result;
  });
}

function assertScalarExists(probe: NativeProbe | undefined) {
  expect(probe).toBeDefined();
  expect(probe!.sql).toMatch(/\bEXISTS\s*\(/i);
  expect(Array.isArray(probe!.result)).toBe(true);
  const result = probe!.result as Array<Record<string, unknown>>;
  expect(result).toHaveLength(1);
  expect(Object.values(result[0]!)).toHaveLength(1);
  expect(typeof Object.values(result[0]!)[0]).toBe("boolean");
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe("bounded metadata receipt reader: native synthetic M02B", () => {
  it("reads more than two pages in exclusive ascending ID order without duplicates or foreign scope rows", async () => {
    const selected = scope({ createdAt: at }), expected = await seed(selected, 65);
    await seed({ ...selected, actorUserId: randomUUID() }, 5);
    await seed({ ...selected, resourceId: randomUUID() }, 5);
    await seed({ ...selected, resourceType: "PrivateAsset" }, 5);
    await seed(selected, 5, { createdAt: new Date(at.getTime() - 1) });
    await seed(selected, 5, { createdAt: new Date(at.getTime() + 1) });
    const observed = observeNativeReads();
    const rows = await read(createEvidenceReceiptReader({ maxRows: 65 }), selected, observed.client);
    expect(rows.map(row => row.id)).toEqual(expected);
    expect(new Set(rows.map(row => row.id)).size).toBe(65);
    expect(rows.every(row => row.actorUserId === selected.actorUserId && row.resourceId === selected.resourceId
      && row.resourceType === selected.resourceType && row.createdAt.getTime() === at.getTime())).toBe(true);
    expect(observed.pages.map(page => page.hydrated)).toEqual([32, 32, 1]);
    expect(observed.pages.every(page => typeof page.args.take === "number" && page.args.take > 0 && page.args.take <= 32)).toBe(true);
    expect(observed.hydrated()).toBe(65);
    expect(observed.probes).toHaveLength(1);
    assertScalarExists(observed.probes[0]);
  });

  it("omits the timestamp restriction only when the caller omitted createdAt", async () => {
    const selected = scope(), earlier = await seed(selected, 1, { createdAt: new Date(at.getTime() - 1) });
    const exact = await seed(selected, 1), later = await seed(selected, 1, { createdAt: new Date(at.getTime() + 1) });
    const rows = await read(createEvidenceReceiptReader({ maxRows: 3 }), selected);
    expect(rows.map(row => row.id)).toEqual([...earlier, ...exact, ...later].sort());
    const exactRows = await read(createEvidenceReceiptReader({ maxRows: 1 }), { ...selected, createdAt: at });
    expect(exactRows.map(row => row.id)).toEqual(exact);
  });

  it("completes an exact row bound using only a scalar EXISTS probe, including a subsequent empty family", async () => {
    const selected = scope(), expected = await seed(selected, 3), observed = observeNativeReads();
    const reader = createEvidenceReceiptReader({ maxRows: 3 });
    const result = await observed.client.$transaction(async tx => {
      const rows = await collect(reader.scan(tx, selected));
      const empty = await collect(reader.scan(tx, { ...selected, resourceType: "OwnershipChallenge" }));
      return { rows, empty };
    });
    expect(result.rows.map(row => row.id)).toEqual(expected);
    expect(result.empty).toEqual([]);
    expect(observed.pages).toHaveLength(1);
    expect(observed.hydrated()).toBe(3);
    expect(observed.probes).toHaveLength(2);
    for (const probe of observed.probes) assertScalarExists(probe);
  });

  it("rejects one additional receipt at the exact bound without hydrating it or reporting a negative result", async () => {
    const selected = scope(); await seed(selected, 4);
    const observed = observeNativeReads(), yielded: string[] = [];
    const reading = observed.client.$transaction(tx => collect(createEvidenceReceiptReader({ maxRows: 3 }).scan(tx, selected), yielded));
    await expect(reading).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
    expect(yielded).toHaveLength(3);
    expect(observed.hydrated()).toBe(3);
    expect(observed.pages).toHaveLength(1);
    expect(observed.probes).toHaveLength(1);
    assertScalarExists(observed.probes[0]);
  });

  it.each(["fixed", "native"] as const)("rejects overflow with an exact %s timestamp without hydrating the additional receipt", async timestampSource => {
    const selected = scope({ createdAt: at }), ids = await seed(selected, 2);
    const native = await prisma.evidenceCommand.findUniqueOrThrow({ where: { id: ids[0]! } });
    const scoped = { ...selected, createdAt: timestampSource === "native" ? native.createdAt : at };
    const observed = observeNativeReads(), yielded: string[] = [];
    await expect(observed.client.$transaction(tx => collect(
      createEvidenceReceiptReader({ maxRows: 1 }).scan(tx, scoped), yielded,
    ))).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
    expect(yielded).toEqual([ids[0]]);
    expect(observed.hydrated()).toBe(1);
    expect(observed.pages).toHaveLength(1);
    expect(observed.probes).toHaveLength(1);
    assertScalarExists(observed.probes[0]);
    expect(Object.values((observed.probes[0]!.result as Array<Record<string, unknown>>)[0]!)).toEqual([true]);
  });

  it.each(["UTC", "Asia/Riyadh"] as const)("keeps native Date ORM scope and scalar overflow probe equal in session timezone %s", async timeZone => {
    const selected = scope({ createdAt: at }), ids = await seed(selected, 2);
    await seed(selected, 1, { createdAt: new Date(at.getTime() + 1) });
    const native = await prisma.evidenceCommand.findUniqueOrThrow({ where: { id: ids[0]! } });
    const scoped = { ...selected, createdAt: native.createdAt }, observed = observeNativeReads();
    await expect(observed.client.$transaction(async tx => {
      if (timeZone === "UTC") await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
      else await tx.$executeRaw`SET LOCAL TIME ZONE 'Asia/Riyadh'`;
      // First witness the native ORM timestamp family under the same exact
      // transaction settings; the reader's final scalar probe must agree.
      expect((await tx.evidenceCommand.findMany({ where: scoped, orderBy: { id: "asc" } })).map(row => row.id)).toEqual(ids);
      observed.pages.length = 0;
      return collect(createEvidenceReceiptReader({ maxRows: 1 }).scan(tx, scoped));
    })).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
    expect(observed.hydrated()).toBe(1);
    expect(observed.pages).toHaveLength(1);
    expect(observed.probes).toHaveLength(1);
    assertScalarExists(observed.probes[0]);
    expect(Object.values((observed.probes[0]!.result as Array<Record<string, unknown>>)[0]!)).toEqual([true]);
  });

  it("uses the default 16384-row cap across real native pages and never hydrates the 16385th receipt", async () => {
    const selected = scope(); await seed(selected, 16385);
    const observed = observeNativeReads();
    // The controlled clock isolates the default row limit from scheduler time;
    // actual native wait/CPU deadline tests below use the default real clock.
    const reader = createEvidenceReceiptReader({ clock: () => 0 });
    await expect(read(reader, selected, observed.client)).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
    expect(observed.hydrated()).toBe(16384);
    expect(observed.pages).toHaveLength(512);
    expect(observed.probes).toHaveLength(1);
    assertScalarExists(observed.probes[0]);
  });

  it("charges one shared row budget across different resource families", async () => {
    const first = scope(), second = { ...first, resourceType: "PrivateAsset", resourceId: randomUUID() };
    await seed(first, 2); await seed(second, 2);
    const observed = observeNativeReads(), reader = createEvidenceReceiptReader({ maxRows: 3 });
    await expect(observed.client.$transaction(async tx => {
      expect(await collect(reader.scan(tx, first))).toHaveLength(2);
      return collect(reader.scan(tx, second));
    })).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
    expect(observed.pages.map(page => page.hydrated)).toEqual([2, 1]);
    expect(observed.hydrated()).toBe(3);
    assertScalarExists(observed.probes[0]);
  });

  it("charges every hydrated receipt even when a consumer breaks after only the first yield", async () => {
    const first = scope(), second = { ...first, resourceType: "OwnershipChallenge", resourceId: randomUUID() };
    await seed(first, 5); await seed(second, 1);
    const observed = observeNativeReads(), reader = createEvidenceReceiptReader({ maxRows: 5 });
    await expect(observed.client.$transaction(async tx => {
      for await (const row of reader.scan(tx, first)) { expect(row.resourceId).toBe(first.resourceId); break; }
      return collect(reader.scan(tx, second));
    })).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
    expect(observed.hydrated()).toBe(5);
    expect(observed.pages).toHaveLength(1);
    assertScalarExists(observed.probes[0]);
  });

  it("shares charges across interleaved generators instead of counting only yielded rows", async () => {
    const first = scope(), second = { ...first, resourceType: "BusinessVerification", resourceId: randomUUID() };
    await seed(first, 4); await seed(second, 2);
    const observed = observeNativeReads(), reader = createEvidenceReceiptReader({ maxRows: 5 });
    await expect(observed.client.$transaction(async tx => {
      const iterator = reader.scan(tx, first)[Symbol.asyncIterator]();
      try {
        expect((await iterator.next()).done).toBe(false);
        return await collect(reader.scan(tx, second));
      } finally { await iterator.return?.(); }
    })).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
    expect(observed.hydrated()).toBe(5);
    expect(observed.pages.map(page => page.hydrated)).toEqual([4, 1]);
  });

  it("serializes concurrent native families so their total hydration cannot oversubscribe one reader", async () => {
    const first = scope(), second = { ...first, resourceType: "AdvertisingLicence", resourceId: randomUUID() };
    await seed(first, 1); await seed(second, 1);
    const observed = observeNativeReads(), reader = createEvidenceReceiptReader({ maxRows: 1 });
    const results = await observed.client.$transaction(tx => Promise.allSettled([
      collect(reader.scan(tx, first)), collect(reader.scan(tx, second)),
    ]));
    const completed = results.filter((result): result is PromiseFulfilledResult<EvidenceCommand[]> => result.status === "fulfilled");
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(completed).toHaveLength(1);
    expect(completed[0]!.value).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
    expect(observed.hydrated()).toBeLessThanOrEqual(1);
    expect(observed.pages).toHaveLength(1);
    for (const probe of observed.probes) assertScalarExists(probe);
  });

  it("lets the caller reject malformed candidates before a valid identity beyond page one", async () => {
    const selected = scope(), ids = await seed(selected, 50, { validIndex: 40 }), observed = observeNativeReads();
    expect(await selectedIdentity(createEvidenceReceiptReader({ maxRows: 50 }), selected, observed.client)).toBe(ids[40]);
    expect(observed.pages.map(page => page.hydrated)).toEqual([32, 18]);
    expect(observed.hydrated()).toBe(50);
  });

  it.each([undefined, 0])("never returns a partial %s identity result when later history exceeds the budget", async validIndex => {
    const selected = scope(); await seed(selected, 33, { validIndex });
    await expect(selectedIdentity(createEvidenceReceiptReader({ maxRows: 32 }), selected)).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
  });

  it("gives separate reader identities independent budgets after one has failed", async () => {
    const selected = scope(), ids = await seed(selected, 2);
    const exhausted = createEvidenceReceiptReader({ maxRows: 1 }), independent = createEvidenceReceiptReader({ maxRows: 2 });
    expect(exhausted).not.toBe(independent);
    await expect(read(exhausted, selected)).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
    expect((await read(independent, selected)).map(row => row.id)).toEqual(ids);
    expect(independent.bounded).toBe(true);
  });

  it("reads harmless malformed and frozen metadata unchanged without mutating persisted receipts", async () => {
    const selected = scope(); await seed(selected, 34);
    const before = await prisma.evidenceCommand.findMany({ where: selected, orderBy: { id: "asc" } });
    const observed = observeNativeReads(rows => { for (const row of rows) deepFreeze(row); });
    const rows = await read(createEvidenceReceiptReader({ maxRows: 34 }), Object.freeze({ ...selected }), observed.client);
    expect(rows).toEqual(before);
    expect(rows.every(row => row.payloadHash === invalidHash && record(row.resultJson).privateMarker === privateMarker)).toBe(true);
    expect(await prisma.evidenceCommand.findMany({ where: selected, orderBy: { id: "asc" } })).toEqual(before);
  });

  it("reports exhaustion using only metadata and never attaches receipt contents or selected scope identifiers", async () => {
    const selected = scope(), ids = await seed(selected, 2, { validIndex: 0 });
    const result = await read(createEvidenceReceiptReader({ maxRows: 1 }), selected).then(() => null, (error: unknown) => error);
    expect(result).toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
    const error = result as Error;
    const serialized = JSON.stringify(Object.fromEntries(Object.getOwnPropertyNames(error).map(key => [key, Reflect.get(error, key)])));
    for (const privateValue of [privateMarker, selected.actorUserId, selected.resourceId, ...ids]) expect(serialized).not.toContain(privateValue);
    for (const privateKey of ["resultJson", "payloadHash", "operationKey", "receipt", "resourceId", "actorUserId"]) expect(serialized).not.toContain(`"${privateKey}"`);
  });
});

describe("receipt reader deadline and configuration boundaries", () => {
  it("starts the default 10000ms deadline at creation and rejects its exact endpoint", () => {
    let tick = 100;
    const reader = createEvidenceReceiptReader({ clock: () => tick });
    tick = 10099; expect(() => reader.checkpoint()).not.toThrow();
    tick = 10100; expect(() => reader.checkpoint()).toThrow(expect.objectContaining({ code: "RETRY_REQUIRED", status: 503 }));
  });

  it("expires before the first native receipt query even when no scan has previously begun", async () => {
    const selected = scope(); await seed(selected, 1);
    let tick = 0;
    const observed = observeNativeReads(), reader = createEvidenceReceiptReader({ maxElapsedMs: 20, clock: () => tick });
    tick = 20;
    await expect(read(reader, selected, observed.client)).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
    expect(observed.pages).toEqual([]);
    expect(observed.probes).toEqual([]);
  });

  it("does not reset elapsed time when a new family scan starts", async () => {
    const first = scope(), second = { ...first, resourceType: "PrivateAsset", resourceId: randomUUID() };
    await seed(first, 1); await seed(second, 1);
    let tick = 0;
    const observed = observeNativeReads(), reader = createEvidenceReceiptReader({ maxRows: 10, maxElapsedMs: 20, clock: () => tick });
    expect(await read(reader, first, observed.client)).toHaveLength(1);
    tick = 20;
    await expect(read(reader, second, observed.client)).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
    expect(observed.hydrated()).toBe(1);
  });

  it.each([NaN, Infinity, -Infinity])("fails closed for an invalid subsequent sampled clock %s", async value => {
    const selected = scope(); await seed(selected, 1);
    let tick = 100;
    const observed = observeNativeReads(), reader = createEvidenceReceiptReader({ clock: () => tick });
    tick = value;
    await expect(read(reader, selected, observed.client)).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
    expect(observed.hydrated()).toBe(0);
  });

  it("rejects a backward clock sample even when it remains later than the creation timestamp", () => {
    let tick = 100;
    const reader = createEvidenceReceiptReader({ clock: () => tick });
    tick = 105; reader.checkpoint();
    tick = 104;
    expect(() => reader.checkpoint()).toThrow(expect.objectContaining({ code: "RETRY_REQUIRED", status: 503 }));
  });

  it("checks the actual monotonic deadline after native PostgreSQL query waiting before yielding a receipt", async () => {
    const selected = scope(); await seed(selected, 1);
    const observed = observeNativeReads(), peer = new PrismaClient(), monitor = new PrismaClient();
    const held = latch<void>(), release = latch<void>(), backend = latch<number>(), monitoring = new AbortController();
    let started = 0;
    const holding = peer.$transaction(async tx => {
      await tx.$executeRaw`LOCK TABLE "EvidenceCommand" IN ACCESS EXCLUSIVE MODE`;
      held.resolve();
      await release.promise;
    }, { maxWait: 5000, timeout: 10000 });
    void holding.catch(() => {});
    const yielded: string[] = [];
    let reading: Promise<EvidenceCommand[]> | undefined;
    let waiting: Promise<void> | undefined;
    try {
      await Promise.race([held.promise, holding.then(() => { throw new Error("Synthetic metadata holder completed before lock publication"); })]);
      reading = observed.client.$transaction(async tx => {
        const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
        backend.resolve(rows[0]!.pid);
        started = performance.now();
        return collect(createEvidenceReceiptReader({ maxElapsedMs: 300 }).scan(tx, selected), yielded);
      }, { maxWait: 5000, timeout: 5000 });
      void reading.catch(() => {});
      const pid = await Promise.race([backend.promise, reading.then(() => { throw new Error("Synthetic metadata reader completed before PID publication"); })]);
      waiting = waitForReceiptTableLock(pid, monitor, monitoring.signal);
      await Promise.race([waiting, reading.then(() => { throw new Error("Synthetic metadata reader completed before native lock waiting"); })]);
      await delay(Math.max(0, started + 350 - performance.now()));
      release.resolve(); await holding;
      await expect(reading).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
      expect(observed.hydrated()).toBe(1);
      expect(yielded).toEqual([]);
    } finally {
      release.resolve();
      monitoring.abort();
      await holding.catch(() => {});
      await reading?.catch(() => {});
      await waiting?.catch(() => {});
      await peer.$disconnect();
      await monitor.$disconnect();
    }
  });

  it("checks the real deadline after consumer CPU predicate work and also on an early iterator break", async () => {
    const selected = scope(); await seed(selected, 2);
    const observed = observeNativeReads();
    let predicates = 0, workCompleted = false;
    await expect(observed.client.$transaction(async tx => {
      const started = performance.now(), reader = createEvidenceReceiptReader({ maxElapsedMs: 500 });
      let selectedId: string | null = null;
      for await (const row of reader.scan(tx, selected)) {
        reader.checkpoint();
        predicates++;
        // Real synchronous hashing prevents an event-loop delay from standing
        // in for CPU predicate work; no fake timers or query replacements.
        do { canonicalHash({ id: row.id, metadata: row.resultJson }); } while (performance.now() < started + 550);
        workCompleted = true;
        selectedId = row.id;
        break;
      }
      return selectedId;
    }, { maxWait: 5000, timeout: 5000 })).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
    expect(observed.hydrated()).toBe(2);
    expect(observed.pages).toHaveLength(1);
    expect(predicates).toBe(1);
    expect(workCompleted).toBe(true);
  });

  it("accepts the hard maxima and a finite fractional positive millisecond budget", () => {
    expect(() => createEvidenceReceiptReader({ maxRows: 16384, maxElapsedMs: 10000, clock: () => 0 })).not.toThrow();
    expect(() => createEvidenceReceiptReader({ maxRows: 1, maxElapsedMs: 0.5, clock: () => 0 })).not.toThrow();
  });

  const invalid = [
    ["zero rows", { maxRows: 0 }], ["negative rows", { maxRows: -1 }], ["fractional rows", { maxRows: 1.5 }],
    ["row maximum exceeded", { maxRows: 16385 }], ["unsafe rows", { maxRows: Number.MAX_SAFE_INTEGER + 1 }],
    ["NaN rows", { maxRows: NaN }], ["infinite rows", { maxRows: Infinity }], ["string rows", { maxRows: privateMarker }],
    ["zero milliseconds", { maxElapsedMs: 0 }], ["negative milliseconds", { maxElapsedMs: -1 }],
    ["millisecond maximum exceeded", { maxElapsedMs: 10000.1 }], ["NaN milliseconds", { maxElapsedMs: NaN }],
    ["infinite milliseconds", { maxElapsedMs: Infinity }], ["string milliseconds", { maxElapsedMs: privateMarker }],
    ["nonfunction clock", { clock: privateMarker }], ["initial NaN clock", { clock: () => NaN }],
    ["initial infinite clock", { clock: () => Infinity }], ["initial string clock", { clock: () => privateMarker }],
    ["throwing initial clock", { clock: () => { throw new Error(privateMarker); } }], ["null options", null],
  ] as const;
  it.each(invalid)("rejects %s with a generic metadata-only configuration error", (_label, options) => {
    let failure: unknown;
    try { createEvidenceReceiptReader(options as never); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(RangeError);
    expect(failure).not.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
    const error = failure as Error;
    expect(error.message).toBe("INVALID_RECEIPT_READ_CONFIG");
    const serialized = JSON.stringify(Object.fromEntries(Object.getOwnPropertyNames(error).map(key => [key, Reflect.get(error, key)])));
    expect(serialized).not.toContain(privateMarker);
  });
});

function latch<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

async function waitForReceiptTableLock(pid: number, monitor: PrismaClient, signal: AbortSignal) {
  const deadline = performance.now() + 4000;
  while (performance.now() < deadline) {
    if (signal.aborted) throw new Error("Synthetic metadata wait witness cancelled");
    const rows = await monitor.$queryRaw<Array<{ waiting: boolean }>>`SELECT (wait_event_type='Lock' AND query LIKE '%"EvidenceCommand"%') AS waiting
      FROM pg_stat_activity WHERE pid=${pid}`;
    if (rows[0]?.waiting) return;
    await delay(20);
  }
  throw new Error("Synthetic receipt reader never reached the witnessed native metadata table wait");
}
