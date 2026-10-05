import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma, type ProfileState, type Role } from "@prisma/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { runtimeConfig } from "@/lib/env";
import { openSession, resolveSession } from "@/lib/identity";
import type { OrganizationActor } from "@/lib/organizations/context";
import { EvidenceReceiptReadError } from "@/lib/evidence/receipt-reader";
import { DiscoveryPageSchema, DiscoveryQuerySchema, type PublicDiscoveryAccount, type PublicDiscoveryCreator } from "@/lib/discovery/contracts";
import { decodeDiscoveryCursor } from "@/lib/discovery/cursor";
import { projectPublicCreatorIdentities } from "@/lib/discovery/public-identity";
import { getDiscoveryPage } from "@/lib/discovery/service";

// Projection is intentionally mocked ONLY at this batch adapter. Native current
// User/AuthSession authorization, transactions, creator candidate queries,
// continuation crypto and audit writes are real guarded disposable DB witnesses.
// These tests do not establish live publication, metric or provider acceptance;
// the independently authored public-identity suite owns that protocol evidence.
vi.mock("@/lib/discovery/public-identity", () => ({ projectPublicCreatorIdentities: vi.fn() }));
const projection = vi.mocked(projectPublicCreatorIdentities);
const projectedIds = () => projection.mock.calls.map(([, capture]) => capture.records.map(record => record.creator.id));
const ownedUsers: string[] = [], ownedCreators: string[] = [];
const publicCards = new Map<string, PublicDiscoveryCreator>();
const privateSentinel = "PRIVATE-DISCOVERY-PAGE-NOT-A-PUBLIC-FIELD";
const auditAction = "discovery.public_accessed";
const trustedAsOf = new Date("2026-10-05T09:00:00.000Z");
const cardKeys = ["accounts", "bio", "displayName", "handle", "id", "languages", "nicheSlugs", "residenceCountryCode"];

beforeEach(() => {
  projection.mockReset(); publicCards.clear();
  projection.mockImplementation(async (_tx, capture, _actors, reader) => {
    const ids = capture.records.map(record => record.creator.id);
    reader.checkpoint();
    return ids.flatMap(id => publicCards.has(id) ? [publicCards.get(id)!] : []);
  });
});
afterEach(async () => {
  // Delete only this suite's owned fixtures, dependants before User. No evidence
  // or organization command journal is fabricated, updated or erased here.
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: ownedUsers } } });
  await prisma.creator.deleteMany({ where: { id: { in: ownedCreators } } });
  await prisma.brand.deleteMany({ where: { userId: { in: ownedUsers } } });
  await prisma.user.deleteMany({ where: { id: { in: ownedUsers } } });
  ownedUsers.length = 0; ownedCreators.length = 0; publicCards.clear();
});

function marker() { return `dpage${randomUUID().replaceAll("-", "").slice(0, 12)}`; }
async function user(role: Role = "BRAND", data: { active?: boolean; isTest?: boolean; verified?: boolean; verifiedAt?: Date } = {}) {
  const id = randomUUID(); ownedUsers.push(id);
  return prisma.user.create({ data: { id, role, name: "اسم صاحب اختبار أصلي", nameEn: privateSentinel,
    email: `${id}@example.invalid`, phone: "+000-private-fixture", passwordHash: "synthetic-discovery-page-not-a-login",
    active: data.active ?? true, isTest: data.isTest ?? true,
    emailVerifiedAt: data.verified === false ? null : data.verifiedAt ?? new Date(Date.now() - 1000) } });
}
async function actor(role: Role = "BRAND") {
  const owner = await user(role);
  const token = await openSession(owner.id, owner.sessionVersion, owner.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Native discovery fixture session did not resolve");
  const current: OrganizationActor = { userId: session.userId, role: session.role,
    sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  return { user: owner, actor: current, token };
}
type CandidateOptions = {
  state?: ProfileState; isTest?: boolean; consent?: boolean; owned?: boolean;
  ownerRole?: Role; ownerActive?: boolean; ownerTest?: boolean; ownerVerified?: boolean;
  countryCode?: string | null; displayName?: string; handle?: string; bio?: string;
  publicPlatform?: PublicDiscoveryAccount["platform"]; privatePlatform?: PublicDiscoveryAccount["platform"];
};
async function candidate(search: string, index = 0, options: CandidateOptions = {}) {
  // Owned synthetic rows are deliberately non-test to exercise public candidate
  // predicates. The exact disposable DB guard still owns all fixture execution.
  const owner = options.owned === false ? null : await user(options.ownerRole ?? "CREATOR", {
    active: options.ownerActive, isTest: options.ownerTest ?? false, verified: options.ownerVerified,
    verifiedAt: new Date(trustedAsOf.getTime() - 1000),
  });
  const id = `discovery-${search}-${index.toString().padStart(3, "0")}`; ownedCreators.push(id);
  const creator = await prisma.creator.create({ data: { id, userId: owner?.id ?? null,
    handle: options.handle ?? `${search}_${index}`, displayName: options.displayName ?? `${search} اسم أصلي ${index}`,
    bio: options.bio ?? privateSentinel, countryCode: options.countryCode === undefined ? "SA" : options.countryCode,
    languages: ["ar"], nicheIds: ["private-native-niche"], profileFacts: { privateSentinel },
    state: options.state ?? "PUBLISHED", isTest: options.isTest ?? false,
    publicConsentAt: options.consent === false ? null : trustedAsOf, publishedAt: trustedAsOf } });
  for (const [platform, publicVisible] of [[options.publicPlatform, true], [options.privatePlatform, false]] as const) {
    if (platform) await prisma.socialAccount.create({ data: { creatorId: id, platform,
      handle: `${search}-${platform}`, publicVisible, providerAccountId: privateSentinel } });
  }
  const card: PublicDiscoveryCreator = { id, handle: creator.handle, displayName: creator.displayName,
    bio: "نبذة عامة معتمدة", residenceCountryCode: "SA", languages: ["ar"], nicheSlugs: ["travel"],
    accounts: [account(options.publicPlatform ?? "INSTAGRAM")] };
  publicCards.set(id, card);
  return { owner, creator, card };
}
function account(platform: PublicDiscoveryAccount["platform"] = "INSTAGRAM", followers: "unknown" | "0" | "15000" = "unknown"): PublicDiscoveryAccount {
  return { platform, handle: "public_account", ownership: "VERIFIED", followersObservation: followers === "unknown" ? null : {
    followers, source: "SCREENSHOT_VERIFIED", observedAt: trustedAsOf.toISOString(),
    taxonomyVersion: "infame-reach-v2", band: followers === "0" ? null : "MICRO",
  } };
}
async function audits(current: OrganizationActor) {
  return prisma.adminAudit.findMany({ where: { actorUserId: current.userId, action: auditAction }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
}
function privateSafe(value: unknown, secrets: readonly string[]) {
  const json = JSON.stringify(value);
  for (const secret of secrets) expect(json.includes(secret)).toBe(false);
}
function opaque(token: string, secrets: readonly string[]) {
  expect(token).toMatch(/^[A-Za-z0-9_-]+$/); expect(token.length).toBeLessThanOrEqual(2048);
  const text = Buffer.from(token, "base64url").toString("utf8");
  for (const secret of [...secrets, "queryHash", "issuedAt", "expiresAt", '"after"', '"actor"']) expect(text.includes(secret)).toBe(false);
}
function latch() {
  let release!: () => void;
  return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
}
function observed<T>(promise: Promise<T>) {
  return promise.then(value => ({ ok: true as const, value }), (error: { status?: number; code?: string }) => ({ ok: false as const, status: error.status, code: error.code }));
}
async function waitForLock(table: "User" | "AuthSession" | "AdminAudit") {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ${`%"${table}"%`}
        AND (query LIKE '%FOR SHARE%' OR query LIKE '%INSERT INTO%')`;
    if (rows[0]?.count >= 1) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Discovery did not reach the required actual native lock wait");
}

it("returns only the public scope for a native BRAND with no membership and commits exact metadata-only audit", async () => {
  const current = await actor(), search = marker(), row = await candidate(search);
  const privateBrand = await prisma.brand.create({ data: { userId: current.user.id, slug: marker(), name: privateSentinel,
    description: privateSentinel, profileFacts: { privateSentinel }, isTest: true } });
  expect(await prisma.organizationMembership.count({ where: { userId: current.user.id } })).toBe(0);
  const result = await getDiscoveryPage(current.actor, { q: search }, { now: trustedAsOf });
  expect(DiscoveryPageSchema.safeParse(result).success).toBe(true);
  expect(Object.keys(result).sort()).toEqual(["asOf", "creators", "nextCursor", "scope"]);
  expect(result).toEqual({ scope: "PUBLIC_PROFILES", asOf: trustedAsOf.toISOString(), creators: [row.card], nextCursor: null });
  expect(Object.keys(result.creators[0]).sort()).toEqual(cardKeys);
  privateSafe(result, [privateSentinel, current.user.id, row.owner!.id, row.owner!.email, privateBrand.id]);
  const committed = await audits(current.actor); expect(committed).toHaveLength(1);
  expect(committed[0]).toMatchObject({ action: auditAction, resourceType: "CreatorDiscovery", resourceId: "public_profiles" });
  expect(Object.keys(committed[0].snapshot as object).sort()).toEqual(["asOf", "queryHash", "returned", "scanned", "scope"]);
  expect(committed[0].snapshot).toMatchObject({ scope: "PUBLIC_PROFILES", asOf: result.asOf, scanned: 1, returned: 1 });
  expect((committed[0].snapshot as { queryHash: string }).queryHash).toMatch(/^[a-f0-9]{64}$/);
  privateSafe(committed[0].snapshot, [search, privateSentinel, row.creator.id, row.owner!.id, current.user.id]);
});

it("checks real role, session ownership, revocation, expiry, suspension and version before malformed input", async () => {
  const malformed = { scope: "PRIVATE_CLIENTS", injected: privateSentinel, cursor: "!" };
  await expect(getDiscoveryPage(null as never, malformed)).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  for (const role of ["CREATOR", "ADMIN"] as const) {
    const current = await actor(role);
    await expect(getDiscoveryPage(current.actor, malformed)).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(await audits(current.actor)).toEqual([]);
  }
  const first = await actor(), second = await actor();
  await expect(getDiscoveryPage({ ...first.actor, sessionId: second.actor.sessionId }, malformed)).rejects.toMatchObject({ status: 401 });
  await expect(getDiscoveryPage({ ...first.actor, role: "CREATOR" }, malformed)).rejects.toMatchObject({ status: 401 });
  for (const invalidation of ["revoked", "expired", "suspended", "version", "role"] as const) {
    const current = await actor();
    if (invalidation === "revoked") await prisma.authSession.update({ where: { id: current.actor.sessionId }, data: { revokedAt: new Date() } });
    if (invalidation === "expired") await prisma.authSession.update({ where: { id: current.actor.sessionId }, data: { expiresAt: new Date(Date.now() - 1) } });
    if (invalidation === "suspended") await prisma.user.update({ where: { id: current.user.id }, data: { active: false } });
    if (invalidation === "version") await prisma.user.update({ where: { id: current.user.id }, data: { sessionVersion: { increment: 1 } } });
    if (invalidation === "role") await prisma.user.update({ where: { id: current.user.id }, data: { role: "CREATOR" } });
    expect(await resolveSession(current.token)).toBeNull();
    await expect(getDiscoveryPage(current.actor, malformed, { now: new Date("2000-01-01T00:00:00.000Z") }))
      .rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    expect(await audits(current.actor)).toEqual([]);
  }
  expect(projection).not.toHaveBeenCalled(); expect(await audits(first.actor)).toEqual([]);
});

it("fails closed across real User and AuthSession lock waits before public projection or audit", async () => {
  for (const table of ["User", "AuthSession"] as const) {
    const current = await actor(), peer = new PrismaClient(), held = latch(), release = latch(), search = marker();
    const holding = peer.$transaction(async tx => {
      if (table === "User") await tx.$queryRaw`SELECT id FROM "User" WHERE id=${current.user.id} FOR UPDATE`;
      else await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${current.actor.sessionId} FOR UPDATE`;
      held.release(); await release.promise;
      if (table === "User") await tx.user.update({ where: { id: current.user.id }, data: { active: false } });
      else await tx.authSession.update({ where: { id: current.actor.sessionId }, data: { revokedAt: new Date() } });
    }, { timeout: 10000 });
    let reading: ReturnType<typeof observed<Awaited<ReturnType<typeof getDiscoveryPage>>>> | undefined;
    try {
      await held.promise; reading = observed(getDiscoveryPage(current.actor, { q: search }));
      expect(await Promise.race([waitForLock(table).then(() => true), reading.then(() => false)])).toBe(true);
      expect(projection).not.toHaveBeenCalled(); release.release(); await holding;
      const outcome = await reading; expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("Lock-invalidated actor obtained public discovery");
      expect([401, 503]).toContain(outcome.status);
      await expect(getDiscoveryPage(current.actor, { q: search })).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
      expect(await audits(current.actor)).toEqual([]); expect(projection).not.toHaveBeenCalled();
    } finally { release.release(); await holding; await reading; await peer.$disconnect(); }
  }
});

it("rejects strictly invalid queries and private client resources after current authentication without scanning", async () => {
  const current = await actor();
  for (const input of [null, { scope: "PRIVATE_CLIENTS" }, { clientId: privateSentinel }, { membershipId: privateSentinel },
    { grantId: privateSentinel }, { limit: 13 }, { limit: 0 }, { q: "x".repeat(121) }, { residenceCountryCode: "ZZ" }, { cursor: "!" }]) {
    await expect(getDiscoveryPage(current.actor, input)).rejects.toMatchObject({ status: 422, code: "VALIDATION" });
  }
  expect(projection).not.toHaveBeenCalled(); expect(await audits(current.actor)).toEqual([]);
});

it("prefilters native public publication, owner, verification and public-account scope before batching identities", async () => {
  const current = await actor(), search = marker();
  const accepted = await candidate(search, 0, { publicPlatform: "INSTAGRAM" });
  const excluded: CandidateOptions[] = [
    { state: "DRAFT" }, { state: "PRIVATE" }, { state: "HIDDEN" }, { isTest: true }, { consent: false },
    { owned: false }, { ownerRole: "BRAND" }, { ownerActive: false }, { ownerTest: true }, { ownerVerified: false },
    { countryCode: "AE" }, { publicPlatform: undefined, privatePlatform: "INSTAGRAM" }, { publicPlatform: "TIKTOK" },
  ];
  for (const [index, options] of excluded.entries()) await candidate(search, index + 1, { publicPlatform: "INSTAGRAM", ...options });
  const page = await getDiscoveryPage(current.actor, { q: search, residenceCountryCode: "SA", platform: "INSTAGRAM" }, { now: trustedAsOf });
  expect(page.creators).toEqual([accepted.card]); expect(page.nextCursor).toBeNull();
  expect(projection).toHaveBeenCalledTimes(1); expect(projectedIds()[0]).toEqual([accepted.creator.id]);
  expect((await audits(current.actor))[0].snapshot).toMatchObject({ scanned: 1, returned: 1 });
});

it("scans only limit plus one in ascending native identity order and projects one at-most12 batch with one real reader", async () => {
  const current = await actor(), search = marker(), rows = [];
  for (let index = 12; index >= 0; index--) rows.push(await candidate(search, index));
  const sorted = rows.sort((a, b) => a.creator.id.localeCompare(b.creator.id));
  const queries: Array<{ query: string; params: string }> = [];
  const client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  client.$on("query", event => { queries.push({ query: event.query, params: event.params }); });
  try {
    const page = await getDiscoveryPage(current.actor, { q: search, limit: 12 }, { client, now: trustedAsOf });
    expect(page.creators.map(row => row.id)).toEqual(sorted.slice(0, 12).map(row => row.creator.id));
    expect(projection).toHaveBeenCalledTimes(1);
    const [tx, capture, actors, reader] = projection.mock.calls[0];
    const ids = capture.records.map(record => record.creator.id), at = new Date(capture.asOf);
    expect(ids).toEqual(sorted.slice(0, 12).map(row => row.creator.id)); expect(ids).toHaveLength(12);
    expect(at).toEqual(trustedAsOf); expect(tx).toHaveProperty("adminAudit"); expect(reader.bounded).toBe(true);
    expect(typeof reader.scan).toBe("function"); expect(() => reader.checkpoint()).not.toThrow();
    const scans = queries.filter(row => /\bFROM\s+(?:(?:"[^"]+"|\w+)\.)?"Creator"/i.test(row.query));
    expect(scans).toHaveLength(3); // Candidate IDs, thin references, scanned-ID-only recheck.
    const sql = scans[0].query.replaceAll('"', "");
    expect(sql).toMatch(/ORDER BY\s+(?:[\w]+\.)*id(?:\s+ASC)?\s+LIMIT/i);
    const bound = /\bLIMIT\s+(?:\$(\d+)|(\d+))/i.exec(sql); expect(bound).not.toBeNull();
    const limit = bound![1] ? (JSON.parse(scans[0].params) as unknown[])[Number(bound![1]) - 1] : Number(bound![2]);
    expect(Number(limit)).toBe(13);
    expect(queries.some(row => /SET TRANSACTION ISOLATION LEVEL REPEATABLE READ/i.test(row.query))).toBe(true);
    const actorLocks = queries.filter(row => /FROM\s+"User"[\s\S]*FOR SHARE/i.test(row.query));
    expect(actorLocks).toHaveLength(1);
    expect(JSON.parse(actorLocks[0].params)).toEqual([current.user.id, ...sorted.slice(0, 12).map(row => row.owner!.id)].sort());
    expect(actors.ownerIds).toEqual(new Set([current.user.id, ...sorted.slice(0, 12).map(row => row.owner!.id)]));
    expect(page.nextCursor).not.toBeNull(); opaque(page.nextCursor!, [current.user.id, search, ...sorted.map(row => row.creator.id)]);
    expect(decodeDiscoveryCursor(page.nextCursor!, current.user.id, DiscoveryQuerySchema.parse({ q: search, limit: 12 }),
      trustedAsOf, runtimeConfig().AUTH_SECRET)).toBe(sorted[11].creator.id);
    expect((await audits(current.actor))[0].snapshot).toMatchObject({ scanned: 12, returned: 12 });
  } finally { await client.$disconnect(); }
});

it("returns a genuine empty native DB page and makes opaque progress over masked scanned identities without padding", async () => {
  const current = await actor(), search = marker();
  const empty = await getDiscoveryPage(current.actor, { q: search, limit: 2 }, { now: trustedAsOf });
  expect(empty.creators).toEqual([]); expect(empty.nextCursor).toBeNull();
  expect((await audits(current.actor))[0].snapshot).toMatchObject({ scanned: 0, returned: 0 });
  projection.mockClear();
  const rows = []; for (let index = 0; index < 5; index++) rows.push(await candidate(search, index));
  for (const row of rows.slice(0, 4)) publicCards.delete(row.creator.id);
  const first = await getDiscoveryPage(current.actor, { q: search, limit: 2 }, { now: trustedAsOf });
  expect(first.creators).toEqual([]); expect(first.nextCursor).not.toBeNull();
  const second = await getDiscoveryPage(current.actor, { q: search, limit: 2, cursor: first.nextCursor! }, { now: trustedAsOf });
  expect(second.creators).toEqual([]); expect(second.nextCursor).not.toBeNull(); expect(second.nextCursor).not.toBe(first.nextCursor);
  const third = await getDiscoveryPage(current.actor, { q: search, limit: 2, cursor: second.nextCursor! }, { now: trustedAsOf });
  expect(third.creators).toEqual([rows[4].card]); expect(third.nextCursor).toBeNull();
  expect(projectedIds()).toEqual([rows.slice(0, 2).map(row => row.creator.id), rows.slice(2, 4).map(row => row.creator.id), [rows[4].creator.id]]);
  for (const cursor of [first.nextCursor!, second.nextCursor!]) opaque(cursor, [search, current.user.id, ...rows.map(row => row.creator.id)]);
  privateSafe([first, second, third], rows.slice(0, 4).map(row => row.creator.id));
  expect(decodeDiscoveryCursor(first.nextCursor!, current.user.id, DiscoveryQuerySchema.parse({ q: search, limit: 2 }), trustedAsOf,
    runtimeConfig().AUTH_SECRET)).toBe(rows[1].creator.id);
  expect(decodeDiscoveryCursor(second.nextCursor!, current.user.id, DiscoveryQuerySchema.parse({ q: search, limit: 2 }), trustedAsOf,
    runtimeConfig().AUTH_SECRET)).toBe(rows[3].creator.id);
  const metadata = (await audits(current.actor)).map(row => row.snapshot);
  expect(metadata).toMatchObject([{ scanned: 0, returned: 0 }, { scanned: 2, returned: 0 }, { scanned: 2, returned: 0 }, { scanned: 1, returned: 1 }]);
  privateSafe(metadata, [search, ...rows.map(row => row.creator.id), first.nextCursor!, second.nextCursor!]);
});

it("rejects native two-actor replay, changed filters or limit and tampered continuation without new projection or audit", async () => {
  const current = await actor(), other = await actor(), search = marker();
  await candidate(search, 0); await candidate(search, 1);
  const first = await getDiscoveryPage(current.actor, { q: search, limit: 1 }, { now: trustedAsOf });
  expect(first.nextCursor).not.toBeNull(); const cursor = first.nextCursor!;
  const tampered = Buffer.from(cursor, "base64url"); tampered[tampered.length - 1] ^= 1;
  const before = (await audits(current.actor)).length; projection.mockClear();
  await expect(getDiscoveryPage(other.actor, { q: search, limit: 1, cursor }, { now: trustedAsOf })).rejects.toMatchObject({ status: 422, code: "VALIDATION" });
  for (const changed of [{ q: `${search}x` }, { residenceCountryCode: "SA" }, { platform: "INSTAGRAM" }, { reachBand: "MICRO" }, { limit: 2 }, { cursor: tampered.toString("base64url") }]) {
    await expect(getDiscoveryPage(current.actor, { q: search, limit: 1, cursor, ...changed }, { now: trustedAsOf }))
      .rejects.toMatchObject({ status: 422, code: "VALIDATION" });
  }
  expect(projection).not.toHaveBeenCalled(); expect(await audits(other.actor)).toEqual([]); expect(await audits(current.actor)).toHaveLength(before);
});

it("searches only published public handle or displayName with case-insensitive escaped literal percent and underscore", async () => {
  const current = await actor(), search = marker(), literal = `${search}%_`;
  const name = await candidate(search, 0, { displayName: `public ${literal} name` });
  const handle = await candidate(search, 1, { handle: `${search}_literal`, displayName: "ordinary public name" });
  await candidate(search, 2, { displayName: `public ${search}XX name; ${search}Xliteral` });
  await candidate(search, 3, { displayName: "ordinary public name", bio: `private ${literal} ${handle.creator.handle}` });
  const byName = await getDiscoveryPage(current.actor, { q: `  ${literal.toUpperCase()}  ` }, { now: trustedAsOf });
  expect(byName.creators).toEqual([name.card]); expect(projectedIds()[0]).toEqual([name.creator.id]);
  const byHandle = await getDiscoveryPage(current.actor, { q: handle.creator.handle.toUpperCase() }, { now: trustedAsOf });
  expect(byHandle.creators).toEqual([handle.card]); expect(projectedIds()[1]).toEqual([handle.creator.id]);
  const snapshots = (await audits(current.actor)).map(row => row.snapshot);
  privateSafe(snapshots, [literal, literal.toUpperCase(), handle.creator.handle, privateSentinel]);
});

it("postfilters actual permitted DTO country and platform and only the selected platform's dated band without padding", async () => {
  const current = await actor(), search = marker(), rows = [];
  for (let index = 0; index < 6; index++) rows.push(await candidate(search, index, { publicPlatform: "INSTAGRAM" }));
  publicCards.set(rows[0].creator.id, { ...rows[0].card, accounts: [account("INSTAGRAM", "15000")] });
  publicCards.set(rows[1].creator.id, { ...rows[1].card, residenceCountryCode: "AE", accounts: [account("INSTAGRAM", "15000")] });
  publicCards.set(rows[2].creator.id, { ...rows[2].card, accounts: [account("TIKTOK", "15000")] });
  publicCards.set(rows[3].creator.id, { ...rows[3].card, accounts: [account("INSTAGRAM"), account("TIKTOK", "15000")] });
  publicCards.set(rows[4].creator.id, { ...rows[4].card, accounts: [account("INSTAGRAM", "0")] });
  publicCards.set(rows[5].creator.id, { ...rows[5].card, residenceCountryCode: null, accounts: [account("INSTAGRAM", "15000")] });
  const query = { q: search, residenceCountryCode: "SA", platform: "INSTAGRAM", reachBand: "MICRO", limit: 12 };
  const page = await getDiscoveryPage(current.actor, query, { now: trustedAsOf });
  expect(projectedIds()[0]).toEqual(rows.map(row => row.creator.id));
  expect(page.creators).toEqual([publicCards.get(rows[0].creator.id)]); expect(page.nextCursor).toBeNull();
  expect((await audits(current.actor))[0].snapshot).toMatchObject({ scanned: 6, returned: 1 });
  const unknownAllowed = await getDiscoveryPage(current.actor, { q: search, residenceCountryCode: "SA", platform: "INSTAGRAM" }, { now: trustedAsOf });
  expect(unknownAllowed.creators.map(row => row.id)).toEqual([rows[0].creator.id, rows[3].creator.id, rows[4].creator.id]);
});

it("rolls back the real audit when actual session expiry follows a native audit-insert wait despite trusted fixture time", async () => {
  const current = await actor(), search = marker(); await candidate(search);
  const peer = new PrismaClient(), held = latch(), release = latch();
  const holding = peer.$transaction(async tx => {
    await tx.$executeRaw`LOCK TABLE "AdminAudit" IN ACCESS EXCLUSIVE MODE`; held.release(); await release.promise;
  }, { timeout: 10000 });
  const expiresAt = new Date(Date.now() + 3000);
  await prisma.authSession.update({ where: { id: current.actor.sessionId }, data: { expiresAt } });
  let reading: ReturnType<typeof observed<Awaited<ReturnType<typeof getDiscoveryPage>>>> | undefined;
  try {
    await held.promise; reading = observed(getDiscoveryPage(current.actor, { q: search }, { now: trustedAsOf }));
    expect(await Promise.race([waitForLock("AdminAudit").then(() => true), reading.then(() => false)])).toBe(true);
    expect(projection).toHaveBeenCalledTimes(1);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 20)));
    release.release(); await holding;
    const outcome = await reading; expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("Final-expired native actor committed public discovery access");
    expect(outcome).toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    expect(await audits(current.actor)).toEqual([]);
  } finally { release.release(); await holding; await reading; await peer.$disconnect(); }
});

it("propagates bounded projection uncertainty as503 with no empty/partial page or committed access audit", async () => {
  const current = await actor(), search = marker(); await candidate(search, 0); await candidate(search, 1);
  // This adapter failure isolates orchestration rollback/propagation. Actual
  // shared-reader budget/exhaustion acceptance belongs to the native proof suite.
  projection.mockImplementationOnce(async (tx: Prisma.TransactionClient, capture, _actors, reader) => {
    expect(capture.records).toHaveLength(2); reader.checkpoint();
    await tx.adminAudit.create({ data: { actorUserId: current.user.id, action: "synthetic.discovery_projection_failure",
      resourceType: "SyntheticDiscoveryWitness", resourceId: "owned_projection_failure", snapshot: { partial: true } } });
    throw new EvidenceReceiptReadError();
  });
  await expect(getDiscoveryPage(current.actor, { q: search }, { now: trustedAsOf })).rejects.toMatchObject({ status: 503, code: "RETRY_REQUIRED" });
  expect(projection).toHaveBeenCalledTimes(1);
  expect(await prisma.adminAudit.count({ where: { actorUserId: current.user.id } })).toBe(0);
});
