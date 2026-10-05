import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { PrismaClient, type Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { SESSION_COOKIE } from "@/lib/jwt";
import { createCampaign } from "@/lib/campaigns/service";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { POST } from "@/app/api/campaigns/[id]/commands/route";
import { POST as CREATE } from "@/app/api/campaigns/route";
import { CreateInputSchema, FormMutationSchema } from "@/app/api/campaigns/_schemas";

// Root alone runs guarded targets. Only Next's request-cookie context is mocked.
// Signed sessions, campaign mutations, journal inserts and PostgreSQL waits are
// real native calls. Owned synthetic subjects are not live commercial evidence.
let token: string | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => name === SESSION_COOKIE && token ? { name, value: token } : undefined }) }));
const userIds = new Set<string>(), campaignIds = new Set<string>();
afterEach(async () => {
  token = null;
  await prisma.campaignCommand.deleteMany({ where: { campaignId: { in: [...campaignIds] } } });
  await prisma.campaign.deleteMany({ where: { id: { in: [...campaignIds] } } });
  await prisma.brand.deleteMany({ where: { userId: { in: [...userIds] } } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: [...userIds] } } });
  await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
  userIds.clear(); campaignIds.clear();
});

async function fixture() {
  const id = randomUUID(), suffix = id.replace(/-/g, "").slice(0, 16); userIds.add(id);
  const user = await prisma.user.create({ data: { id, role: "BRAND", active: true, isTest: true,
    name: "Synthetic campaign session wait", email: `${id}@example.invalid`, passwordHash: "not-a-login",
    emailVerifiedAt: new Date(Date.now() - 60000) } });
  await prisma.brand.create({ data: { userId: id, slug: "wait-" + suffix, name: "Synthetic campaign wait company", countryCode: "KW", isTest: true } });
  // Native draft has no brief: the route must update its revision and input
  // before attempting the blocked CampaignCommand INSERT in the second case.
  const createCommand = { operationKey: randomUUID(), fields: { title: "Synthetic original title" } };
  const { campaign } = await createCampaign(id, createCommand);
  campaignIds.add(campaign.id);
  token = await openSession(id, user.sessionVersion, user.passwordHash);
  const session = await resolveSession(token);
  if (!session) throw new Error("Synthetic native campaign session did not resolve");
  expect(session.userId).toBe(id); expect(session.role).toBe("BRAND");
  const command = { operationKey: randomUUID(), expectedRevision: campaign.revision, action: "UPDATE_FIELDS",
    payload: { patch: { title: "Synthetic changed title must roll back" } } };
  return { user, campaign, session, command, createCommand };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function post(f: Fixture) {
  const origin = process.env.APP_ORIGIN;
  if (!origin) throw new Error("Guarded native campaign test requires APP_ORIGIN");
  return POST(new Request(`${origin}/api/campaigns/${f.campaign.id}/commands`, { method: "POST",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify(f.command) }), { params: Promise.resolve({ id: f.campaign.id }) });
}
async function snapshot(f: Fixture) {
  return { campaign: await prisma.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } }),
    commands: await prisma.campaignCommand.findMany({ where: { campaignId: f.campaign.id }, orderBy: { id: "asc" } }),
    briefCount: await prisma.campaignBrief.count({ where: { campaignId: f.campaign.id } }) };
}
async function unauthenticated(response: Response) {
  expect(response.status).toBe(401);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const body = await response.json();
  expect(Object.keys(body).sort()).toEqual(["error", "requestId"]);
  expect(body.requestId).toBe(response.headers.get("x-request-id"));
  expect(body.error).toEqual({ code: "UNAUTHENTICATED", message: "UNAUTHENTICATED", requestId: body.requestId, retryable: false });
}
async function successful(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const body = await response.json();
  expect(Object.keys(body).sort()).toEqual(["data", "requestId"]);
  expect(body.requestId).toBe(response.headers.get("x-request-id"));
  return body.data;
}
function latch<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) };
}
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
type WaitTable = "User" | "CampaignCommand";
type WaitOperation = "SELECT" | "INSERT";
async function waitBlockedBy(monitor: PrismaClient, blockerPid: number, table: WaitTable, operation: WaitOperation, signal: AbortSignal) {
  const deadline = performance.now() + 4000;
  while (performance.now() < deadline) {
    if (signal.aborted) throw new Error("Synthetic campaign wait witness cancelled");
    const rows = await monitor.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND ${blockerPid}=ANY(pg_blocking_pids(pid))
        AND query LIKE ${`%"${table}"%`} AND query ILIKE ${`%${operation}%`} ORDER BY pid`;
    if (rows.length) return rows[0]!.pid;
    await delay(20);
  }
  throw new Error("Campaign route did not reach the required actual native lock wait");
}
async function hold(f: Fixture, table: WaitTable, afterRelease?: (tx: Prisma.TransactionClient) => Promise<unknown>,
  operation: WaitOperation = table === "CampaignCommand" ? "INSERT" : "SELECT") {
  const peer = new PrismaClient(), monitor = new PrismaClient(), ready = latch<number>(), release = latch<void>(), stop = new AbortController();
  const holding = peer.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout='4s'`;
    const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
    if (table === "User") await tx.$queryRaw`SELECT id FROM "User" WHERE id=${f.user.id} FOR UPDATE`;
    else if (operation === "SELECT") await tx.$executeRaw`LOCK TABLE "CampaignCommand" IN ACCESS EXCLUSIVE MODE`;
    else await tx.$executeRaw`LOCK TABLE "CampaignCommand" IN SHARE MODE`;
    ready.resolve(rows[0]!.pid); await release.promise;
    if (afterRelease) await afterRelease(tx);
  }, { maxWait: 5000, timeout: 12000 });
  void holding.catch(() => {});
  let pid: number;
  try { pid = await Promise.race([ready.promise, holding.then(() => { throw new Error("Synthetic blocker completed before acquiring its native lock"); })]); }
  catch (error) { release.resolve(); await holding.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); throw error; }
  let waiting: Promise<number> | undefined;
  return { holding, release: () => release.resolve(), wait() { waiting = waitBlockedBy(monitor, pid, table, operation, stop.signal); return waiting; },
    async close() { release.resolve(); stop.abort(); await holding.catch(() => {}); await waiting?.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); } };
}

describe("campaign command routes: genuine signed session invalidation during native waits", () => {
  it("rechecks the exact session revoked after route authentication while waiting for the owner User lock", async () => {
    const f = await fixture(), before = await snapshot(f);
    expect(before.commands).toHaveLength(1); expect(before.briefCount).toBe(0);
    const held = await hold(f, "User", tx => tx.authSession.update({ where: { id: f.session.sessionId }, data: { revokedAt: new Date() } }));
    const response = post(f); void response.catch(() => {});
    try {
      // The route's native resolveSession read passed; only its later User
      // locking query can be waiting on the peer's exclusive owner-row lock.
      expect(await Promise.race([held.wait(), response.then(() => { throw new Error("Campaign request completed before its actual owner User wait"); })])).toBeGreaterThan(0);
      expect(await resolveSession(token!)).not.toBeNull();
      held.release(); await held.holding;
      await unauthenticated(await response);
      expect(await resolveSession(token!)).toBeNull();
      expect((await prisma.authSession.findUniqueOrThrow({ where: { id: f.session.sessionId } })).revokedAt).toBeInstanceOf(Date);
      expect(await snapshot(f)).toEqual(before);
      expect(await prisma.campaignCommand.count({ where: { actorUserId: f.user.id, operationKey: `campaign:${f.campaign.id}:${f.command.operationKey}` } })).toBe(0);
    } finally { await held.close(); await response.catch(() => {}); }
  }, 15000);

  it("rolls back a tentative campaign update and journal when the native session expires during the actual journal INSERT wait", async () => {
    const f = await fixture(), before = await snapshot(f);
    expect(before.commands).toHaveLength(1); expect(before.briefCount).toBe(0);
    // AuthSession has a positive-version constraint and no immutable-expiry
    // trigger. Set only this owned fixture record, before route authentication;
    // do not replace Date or mutate the session while the service holds it.
    const expiresAt = new Date(Date.now() + 2500);
    await prisma.authSession.update({ where: { id: f.session.sessionId }, data: { expiresAt } });
    expect(await resolveSession(token!)).not.toBeNull();
    const held = await hold(f, "CampaignCommand"), response = post(f); void response.catch(() => {});
    let settled = false; void response.then(() => { settled = true; }, () => { settled = true; });
    try {
      // SHARE permits the replay SELECT but blocks the INSERT's RowExclusive
      // table lock. Native UPDATE_FIELDS updates Campaign before journal(), so
      // the witnessed journal INSERT wait occurs after its tentative revision.
      expect(await Promise.race([held.wait(), response.then(() => { throw new Error("Campaign request completed before its actual journal INSERT wait"); })])).toBeGreaterThan(0);
      expect(Date.now()).toBeLessThan(expiresAt.getTime());
      while (Date.now() <= expiresAt.getTime()) await delay(Math.min(50, expiresAt.getTime() - Date.now() + 1));
      expect(await resolveSession(token!)).toBeNull(); expect(settled).toBe(false);
      held.release(); await held.holding;
      await unauthenticated(await response);
      expect(await snapshot(f)).toEqual(before);
      expect(await prisma.campaignCommand.count({ where: { actorUserId: f.user.id, operationKey: `campaign:${f.campaign.id}:${f.command.operationKey}` } })).toBe(0);
      const storedSession = await prisma.authSession.findUniqueOrThrow({ where: { id: f.session.sessionId } });
      expect(storedSession.expiresAt).toEqual(expiresAt); expect(storedSession.revokedAt).toBeNull();
    } finally { await held.close(); await response.catch(() => {}); }
  }, 15000);

  it("replays historical create and mutation receipts across genuine session renewal without changing keys, hashes, results or effects", async () => {
    const f = await fixture(), initial = await snapshot(f), oldToken = token!;
    const created = initial.commands[0]!;
    expect(initial.commands).toHaveLength(1);
    expect(created.operationKey).toBe(`create:${f.createCommand.operationKey}`);
    expect(created.payloadHash).toBe(canonicalHash(CreateInputSchema.parse(f.createCommand)));
    const committed = await successful(await post(f));
    expect(committed.replayed).toBe(false); expect(committed.campaign.revision).toBe(f.campaign.revision + 1);
    const before = await snapshot(f), mutation = before.commands.find(row => row.operationKey === `campaign:${f.campaign.id}:${f.command.operationKey}`)!;
    expect(before.commands).toHaveLength(2); expect(mutation).toBeDefined();
    expect(mutation.payloadHash).toBe(canonicalHash({ ...FormMutationSchema.parse(f.command), channel: "FORM" }));
    expect(mutation.result).toEqual({ campaign: committed.campaign, proposalId: committed.proposalId });

    // Open a real replacement session after revoking the old exact record.
    // Neither its nonce nor version belongs to any historical command hash.
    await prisma.authSession.update({ where: { id: f.session.sessionId }, data: { revokedAt: new Date() } });
    expect(await resolveSession(oldToken)).toBeNull();
    const currentUser = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
    token = await openSession(currentUser.id, currentUser.sessionVersion, currentUser.passwordHash);
    const renewed = await resolveSession(token);
    expect(renewed).not.toBeNull(); expect(renewed!.sessionId).not.toBe(f.session.sessionId);
    expect(renewed!.userId).toBe(f.user.id);
    const origin = process.env.APP_ORIGIN!;
    const replayCreate = await successful(await CREATE(new Request(`${origin}/api/campaigns`, { method: "POST",
      headers: { origin, "content-type": "application/json" }, body: JSON.stringify(f.createCommand) })));
    expect(replayCreate).toEqual({ ...(created.result as object), replayed: true });
    expect(replayCreate.campaign.revision).toBe(f.campaign.revision); // Historical receipt, rather than today's revision.
    const replayMutation = await successful(await post(f));
    expect(replayMutation).toEqual({ ...(mutation.result as object), replayed: true });
    expect(await snapshot(f)).toEqual(before);
    expect(await prisma.campaign.count({ where: { brand: { userId: f.user.id } } })).toBe(1);
    expect(await prisma.campaignCommand.count({ where: { actorUserId: f.user.id } })).toBe(2);
    const stored = JSON.stringify((await snapshot(f)).commands);
    for (const privateMetadata of [oldToken, token, f.session.sessionId, renewed!.sessionId, '"serverAuth"', '"sessionId"', '"sessionVersion"']) {
      expect(stored).not.toContain(privateMetadata);
    }
  });

  it("denies a committed private mutation receipt when the exact session expires during the actual replay SELECT wait", async () => {
    const f = await fixture(), committed = await successful(await post(f));
    expect(committed.replayed).toBe(false); expect(committed.campaign.revision).toBe(f.campaign.revision + 1);
    const before = await snapshot(f); expect(before.commands).toHaveLength(2);
    const expiresAt = new Date(Date.now() + 2500);
    await prisma.authSession.update({ where: { id: f.session.sessionId }, data: { expiresAt } });
    expect(await resolveSession(token!)).not.toBeNull();
    // ACCESS EXCLUSIVE blocks the existing-receipt SELECT, unlike the INSERT
    // witness's SHARE lock. Reusing the committed key must not repeat an effect.
    const held = await hold(f, "CampaignCommand", undefined, "SELECT"), response = post(f); void response.catch(() => {});
    let settled = false; void response.then(() => { settled = true; }, () => { settled = true; });
    try {
      expect(await Promise.race([held.wait(), response.then(() => { throw new Error("Campaign replay completed before its actual journal SELECT wait"); })])).toBeGreaterThan(0);
      expect(Date.now()).toBeLessThan(expiresAt.getTime());
      while (Date.now() <= expiresAt.getTime()) await delay(Math.min(50, expiresAt.getTime() - Date.now() + 1));
      expect(await resolveSession(token!)).toBeNull(); expect(settled).toBe(false);
      held.release(); await held.holding;
      await unauthenticated(await response);
      expect(await snapshot(f)).toEqual(before);
      expect(await prisma.campaignCommand.count({ where: { actorUserId: f.user.id, operationKey: `campaign:${f.campaign.id}:${f.command.operationKey}` } })).toBe(1);
      const storedSession = await prisma.authSession.findUniqueOrThrow({ where: { id: f.session.sessionId } });
      expect(storedSession.expiresAt).toEqual(expiresAt); expect(storedSession.revokedAt).toBeNull();
    } finally { await held.close(); await response.catch(() => {}); }
  }, 15000);
});
