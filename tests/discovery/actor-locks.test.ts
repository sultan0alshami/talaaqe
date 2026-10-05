import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma, PrismaClient, type Role } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { withOrganizationTransaction, type OrganizationActor } from "@/lib/organizations/context";
import { lockEvidenceActors } from "@/lib/evidence/readiness";
import { createEvidenceReceiptReader } from "@/lib/evidence/receipt-reader";
import { getDiscoveryPage } from "@/lib/discovery/service";
import { cleanupReviewedEvidence, reviewedOwnershipFixture } from "../helpers/reviewed-evidence";

// Independent native C3b witness. Root alone runs
// guarded targets. Sessions, PG waits and production locking are real; identity
// flags/ownership bytes are explicit synthetic fixtures, not live acceptance.
// No fabricated Prisma conflict, Date replacement or public API producer mock.
const userIds = new Set<string>(), creatorIds = new Set<string>();
afterEach(async () => {
  await prisma.creator.deleteMany({ where: { id: { in: [...creatorIds] } } });
  await prisma.brand.deleteMany({ where: { userId: { in: [...userIds] } } });
  await cleanupReviewedEvidence(prisma, [...userIds], "test");
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: [...userIds] } } });
  await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
  userIds.clear(); creatorIds.clear();
});
async function user(role: Role, id: string, at: Date) {
  userIds.add(id);
  return prisma.user.create({ data: { id, role, name: "Synthetic bridge actor", email: `${id}@example.invalid`,
    passwordHash: "not-a-login", active: true, isTest: role !== "CREATOR", emailVerifiedAt: at, createdAt: at } });
}
async function fixture() {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 16), at = new Date(Date.now() - 120000), marker = "bridge-" + suffix;
  const creatorUser = await user("CREATOR", "c-creator-" + suffix, at), brandUser = await user("BRAND", "z-brand-" + suffix, at), reviewer = await user("ADMIN", "0-reviewer-" + suffix, at);
  expect(creatorUser.id < brandUser.id).toBe(true); expect(reviewer.id < creatorUser.id).toBe(true);
  const brand = await prisma.brand.create({ data: { userId: brandUser.id, slug: "bridge-" + suffix, name: "Synthetic actual Brand", isTest: true } });
  const creator = await prisma.creator.create({ data: { userId: creatorUser.id, handle: "bridge_" + suffix, displayName: marker,
    countryCode: "KW", languages: ["ar"], nicheIds: ["tech"], isTest: false, publicConsentAt: at } });
  creatorIds.add(creator.id);
  const account = await prisma.socialAccount.create({ data: { creatorId: creator.id, platform: "INSTAGRAM", handle: "proof_" + suffix,
    providerAccountId: "synthetic-bridge-provider-" + suffix, intendedConfirmedAt: at, consentAt: at } });
  const proof = await reviewedOwnershipFixture(prisma, creatorUser.id, reviewer.id, account.id, "test", at);
  await prisma.socialAccount.update({ where: { id: account.id }, data: { publicVisible: true } });
  await prisma.portfolioVersion.create({ data: { creatorId: creator.id, version: 1, inputRevision: 1, approvedAt: at,
    content: { title: "Synthetic original title", bio: "سيرة أصلية Native bridge", sections: [], method: "APPROVED_FACT_TEMPLATE" } } });
  await prisma.creator.update({ where: { id: creator.id }, data: { state: "PUBLISHED", primaryAccountId: account.id, publicConsentAt: at } });
  const token = await openSession(brandUser.id, brandUser.sessionVersion, brandUser.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Synthetic native bridge session did not resolve");
  const actor: OrganizationActor = { userId: session.userId, role: session.role, sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  return { at, marker, creatorUser, brandUser, reviewer, brand, creator, account, proof, actor };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Lock = { kind: "User" | "AuthSession" | "Domain"; values: unknown[]; sql: string };
function observedClient() {
  const locks: Lock[] = [], nativeConflicts: string[] = [];
  const client = prisma.$extends({ query: { async $queryRaw({ args, query }) {
    if (/\bFOR\s+(?:SHARE|UPDATE)\b/i.test(args.sql)) locks.push({ kind: args.sql.includes('"User"') ? "User" : args.sql.includes('"AuthSession"') ? "AuthSession" : "Domain", values: args.values.flat(Infinity), sql: args.sql });
    try { return await query(args); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["40P01", "55P03", "40001"].includes(String(error.meta?.code))) nativeConflicts.push(String(error.meta?.code));
      throw error;
    }
  } } }) as unknown as PrismaClient;
  return { client, locks, nativeConflicts };
}
function latch<T>() { let resolve!: (value: T | PromiseLike<T>) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
async function waitBlockedBy(monitor: PrismaClient, blockerPid: number, table: "User" | "AdminAudit", signal: AbortSignal) {
  const deadline = performance.now() + 4000;
  while (performance.now() < deadline) {
    if (signal.aborted) throw new Error("Synthetic native bridge wait witness cancelled");
    const rows = await monitor.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND ${blockerPid}=ANY(pg_blocking_pids(pid))
        AND query LIKE ${`%"${table}"%`} ORDER BY pid`;
    if (rows.length) return rows[0]!.pid;
    await delay(20);
  }
  throw new Error("Synthetic bridge did not reach its actual native lock wait");
}
async function holdCreatorUser(f: Fixture, follow?: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  const peer = new PrismaClient(), monitor = new PrismaClient(), ready = latch<number>(), release = latch<void>(), stop = new AbortController();
  const holding = peer.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout='4s'`;
    const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${f.creatorUser.id} FOR UPDATE`;
    ready.resolve(rows[0]!.pid); await release.promise; if (follow) return follow(tx);
  }, { maxWait: 5000, timeout: 10000 });
  void holding.catch(() => {});
  const pid = await Promise.race([ready.promise, holding.then(() => { throw new Error("Synthetic writer finished before publishing its Creator User lock"); })]);
  let waiting: Promise<number> | undefined;
  return { holding, pid, release: () => release.resolve(), wait(table: "User" | "AdminAudit" = "User") { waiting = waitBlockedBy(monitor, pid, table, stop.signal); return waiting; },
    async close() { release.resolve(); stop.abort(); await holding.catch(() => {}); await waiting?.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); } };
}

describe("grouped actor bridge: real native synthetic C3b", () => {
  it("lets actual discovery and the production sorted C+B writer both finish without the old native cycle", async () => {
    const f = await fixture(), observed = observedClient();
    const held = await holdCreatorUser(f, tx => lockEvidenceActors(tx, { creatorIds: [f.creator.id], brandIds: [f.brand.id], updateOwners: true }));
    const reading = getDiscoveryPage(f.actor, { q: f.marker }, { client: observed.client }); void reading.catch(() => {});
    try {
      // Writer owns lower C. Observe discovery really waiting for C, then ask
      // the actual production owner-first routine for C+B on that same writer.
      // Old discovery owns B here and PostgreSQL resolves a real40P01/timeout.
      await Promise.race([held.wait(), reading.then(() => { throw new Error("Synthetic discovery finished before genuine Creator User waiting"); })]);
      held.release();
      const outcomes = await Promise.allSettled([held.holding, reading] as const);
      expect(outcomes.map(outcome => outcome.status), `Native PG conflict codes: ${observed.nativeConflicts.join(",") || "none"}`).toEqual(["fulfilled", "fulfilled"]);
      if (outcomes[1]!.status === "fulfilled") expect(outcomes[1]!.value.creators.map(value => value.id)).toEqual([f.creator.id]);
    } finally { await held.close(); await reading.catch(() => {}); }
  });

  it("keeps sorted owners before an earlier reviewer in read/write mode and dedups physical locks while preserving logical coverage", async () => {
    const f = await fixture();
    for (const write of [false, true]) {
      const observed = observedClient(), held = await holdCreatorUser(f);
      const config = { write, userIds: [f.creatorUser.id, f.creatorUser.id], reviewerIds: [f.reviewer.id, f.reviewer.id, f.creatorUser.id] };
      const reading = withOrganizationTransaction(f.actor, { client: observed.client }, config, async (_tx, owners, reviewers?: ReadonlySet<string>) => {
        expect([...owners]).toEqual([f.creatorUser.id, f.brandUser.id]);
        expect(reviewers).toBeDefined(); expect([...reviewers!].sort()).toEqual([f.reviewer.id, f.creatorUser.id].sort());
        return true;
      }); void reading.catch(() => {});
      try {
        await Promise.race([held.wait(), reading.then(() => { throw new Error("Synthetic grouped context finished before genuine owner wait"); })]);
        expect(observed.locks.flatMap(lock => lock.values)).not.toContain(f.reviewer.id);
        held.release(); expect(await reading).toBe(true);
        const userLocks = observed.locks.filter(lock => lock.kind === "User");
        expect(userLocks).toHaveLength(2); expect(userLocks[0]!.values).toEqual([f.creatorUser.id, f.brandUser.id]);
        expect(userLocks[1]!.values).toEqual([f.reviewer.id]);
        expect(observed.locks.findIndex(lock => lock.kind === "AuthSession")).toBeGreaterThan(observed.locks.findIndex(lock => lock === userLocks[1]));
      } finally { await held.close(); await reading.catch(() => {}); }
    }
  });

  it("enforces reviewer input2412 and existing owner input63 limits before dedup or callback", async () => {
    const f = await fixture(), observed = observedClient();
    const allowed = { write: false, userIds: Array.from({ length: 63 }, () => f.creatorUser.id), reviewerIds: Array.from({ length: 2412 }, () => f.reviewer.id) };
    expect(await withOrganizationTransaction(f.actor, { client: observed.client }, allowed, async (_tx, owners, reviewers?: ReadonlySet<string>) => {
      expect(owners.size).toBe(2); expect(reviewers?.size).toBe(1); return true;
    })).toBe(true);
    expect(observed.locks.filter(lock => lock.kind === "User").map(lock => lock.values.length)).toEqual([2, 1]);
    for (const config of [{ write: false, userIds: Array.from({ length: 64 }, () => f.creatorUser.id) },
      { write: false, reviewerIds: Array.from({ length: 2413 }, () => f.reviewer.id) }]) {
      let entered = 0;
      await expect(withOrganizationTransaction(f.actor, {}, config, async () => { entered++; return true; })).rejects.toThrow();
      expect(entered).toBe(0);
    }
  });

  it("never authorizes an actor revoked or role/version changed while actual discovery waits on captured owners", async () => {
    for (const change of ["revoked", "role", "version"] as const) {
      const f = await fixture();
      const held = await holdCreatorUser(f, async tx => {
        if (change === "revoked") await tx.authSession.update({ where: { id: f.actor.sessionId }, data: { revokedAt: new Date() } });
        else await tx.user.update({ where: { id: f.brandUser.id }, data: change === "role" ? { role: "CREATOR" } : { sessionVersion: { increment: 1 } } });
      });
      const reading = getDiscoveryPage(f.actor, { q: f.marker }); void reading.catch(() => {});
      try {
        await Promise.race([held.wait(), reading.then(() => { throw new Error("Synthetic invalidated actor did not reach its actual owner wait"); })]);
        held.release(); await held.holding;
        const error = await reading.then(() => null, (value: unknown) => value);
        expect(error).toBeInstanceOf(Error);
        // RepeatableRead may surface a genuine serialization conflict before
        // current authorization; both fail closed without exposing a page.
        const status = error && typeof error === "object" ? Reflect.get(error, "status") : undefined;
        expect([401, 503]).toContain(status);
        expect(await prisma.adminAudit.count({ where: { actorUserId: f.brandUser.id, action: "discovery.public_accessed" } })).toBe(0);
      } finally { await held.close(); await reading.catch(() => {}); }
    }
  });

  it("rolls back a real callback audit when the current session expires during an actual native audit wait", async () => {
    const f = await fixture(), peer = new PrismaClient(), monitor = new PrismaClient(), ready = latch<number>(), release = latch<void>(), stop = new AbortController();
    const expiry = new Date(Date.now() + 2000);
    await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { expiresAt: expiry } });
    const holding = peer.$transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
      await tx.$executeRaw`LOCK TABLE "AdminAudit" IN ACCESS EXCLUSIVE MODE`;
      ready.resolve(rows[0]!.pid); await release.promise;
    }, { maxWait: 5000, timeout: 10000 }); void holding.catch(() => {});
    let reading: Promise<unknown> | undefined, waiting: Promise<number> | undefined;
    try {
      const blocker = await Promise.race([ready.promise, holding.then(() => { throw new Error("Synthetic audit holder completed before publication"); })]);
      const config = { write: false, userIds: [f.creatorUser.id], reviewerIds: [f.reviewer.id] };
      reading = withOrganizationTransaction(f.actor, {}, config, tx => tx.adminAudit.create({ data: {
        actorUserId: f.brandUser.id, action: "synthetic.bridge.expiry", resourceType: "SyntheticBridge", resourceId: f.creator.id, snapshot: { synthetic: true },
      } })); void reading.catch(() => {});
      waiting = waitBlockedBy(monitor, blocker, "AdminAudit", stop.signal);
      await Promise.race([waiting, reading.then(() => { throw new Error("Synthetic callback completed before actual audit waiting"); })]);
      await delay(Math.max(0, expiry.getTime() - Date.now() + 50)); release.resolve(); await holding;
      await expect(reading).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
      expect(await prisma.adminAudit.count({ where: { actorUserId: f.brandUser.id, action: "synthetic.bridge.expiry" } })).toBe(0);
    } finally { release.resolve(); stop.abort(); await holding.catch(() => {}); await reading?.catch(() => {}); await waiting?.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); }
  });

  it("does not widen actor coverage after captured Creator owner/reviewer or source role drift", async () => {
    for (const change of ["owner", "reviewer", "source role"] as const) {
      const f = await fixture(), replacement = await user(change === "owner" ? "CREATOR" : "ADMIN", "new-" + randomUUID(), f.at), observed = observedClient();
      const held = await holdCreatorUser(f, async tx => {
        if (change === "owner") await tx.creator.update({ where: { id: f.creator.id }, data: { userId: replacement.id } });
        else if (change === "reviewer") await tx.socialAccount.update({ where: { id: f.account.id }, data: { ownershipReviewedBy: replacement.id } });
        else await tx.user.update({ where: { id: f.creatorUser.id }, data: { role: "BRAND" } });
      });
      const reading = getDiscoveryPage(f.actor, { q: f.marker }, { client: observed.client }); void reading.catch(() => {});
      try {
        await Promise.race([held.wait(), reading.then(() => { throw new Error("Synthetic capture drift did not reach actual User wait"); })]);
        held.release(); await held.holding;
        const outcome = await reading.then(page => ({ page }), (error: unknown) => ({ error }));
        if (change === "source role" && "page" in outcome) expect(outcome.page.creators).toEqual([]);
        else expect("error" in outcome ? outcome.error : null).toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
        expect(observed.locks.flatMap(lock => lock.values)).not.toContain(replacement.id);
      } finally { await held.close(); await reading.catch(() => {}); }
    }
  });

  it("rechecks literal query/residence/platform/publication only within original scanned IDs after a genuine capture wait", async () => {
    for (const change of ["q", "residence", "platform", "publication"] as const) {
      const f = await fixture();
      const held = await holdCreatorUser(f, async tx => {
        if (change === "q") await tx.creator.update({ where: { id: f.creator.id }, data: { displayName: "Synthetic changed name outside captured literal query" } });
        if (change === "residence") await tx.creator.update({ where: { id: f.creator.id }, data: { countryCode: "EG" } });
        if (change === "platform") await tx.socialAccount.update({ where: { id: f.account.id }, data: { publicVisible: false } });
        if (change === "publication") await tx.creator.update({ where: { id: f.creator.id }, data: { state: "HIDDEN" } });
      });
      const reading = getDiscoveryPage(f.actor, { q: f.marker, residenceCountryCode: "KW", platform: "INSTAGRAM" }); void reading.catch(() => {});
      try {
        await Promise.race([held.wait(), reading.then(() => { throw new Error("Synthetic filter drift did not reach actual owner waiting"); })]);
        held.release(); await held.holding;
        const outcome = await reading.then(page => ({ page }), (error: unknown) => ({ error }));
        if ("page" in outcome) expect(outcome.page.creators).toEqual([]);
        else expect(outcome.error).toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
      } finally { await held.close(); await reading.catch(() => {}); }
    }
  });

  it("uses the supplied real reader deadline across owner waits and stops before AuthSession or callback", async () => {
    const f = await fixture(), observed = observedClient(), held = await holdCreatorUser(f);
    const started = performance.now(), reader = createEvidenceReceiptReader({ maxElapsedMs: 300 });
    let entered = 0;
    const config = { write: false, userIds: [f.creatorUser.id], reviewerIds: [f.reviewer.id], checkpoint: () => reader.checkpoint() };
    const reading = withOrganizationTransaction(f.actor, { client: observed.client }, config, async () => { entered++; return true; }); void reading.catch(() => {});
    try {
      await Promise.race([held.wait(), reading.then(() => { throw new Error("Synthetic deadline did not reach actual grouped owner waiting"); })]);
      await delay(Math.max(0, started + 350 - performance.now())); held.release(); await held.holding;
      await expect(reading).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
      expect(entered).toBe(0); expect(observed.locks.some(lock => lock.kind === "AuthSession")).toBe(false);
    } finally { await held.close(); await reading.catch(() => {}); }
  });
});
