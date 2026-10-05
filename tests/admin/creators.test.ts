import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient, type ProfileState, type OwnershipStatus } from "@prisma/client";
import { afterEach, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { getAdminCreators } from "@/lib/admin/creators";
import { AdminCreatorsSchema, type AdminCreatorsDTO } from "@/lib/admin/contracts";
import type { AdminActor } from "@/lib/admin/context";
import { cleanup, users } from "../deals/fixtures";

const creatorIds: string[] = [];
const privateSentinel = "private-admin-creator-content-sentinel";
const originalName = "  اسم مبدع أصلي <script> نص واحد دون ترجمة  ";
const readAction = "admin.creators_accessed";
afterEach(async () => {
  await prisma.creator.deleteMany({ where: { id: { in: creatorIds.splice(0) } } });
  await cleanup();
});
async function user(role: "ADMIN" | "CREATOR" = "CREATOR") {
  const id = randomUUID(); users.push(id);
  return prisma.user.create({ data: { id, role, name: originalName, nameEn: privateSentinel,
    email: `${randomUUID()}@example.invalid`, passwordHash: "synthetic-admin-creator-not-a-password", isTest: true } });
}
async function signedActor(userId: string) {
  const saved = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const token = await openSession(saved.id, saved.sessionVersion, saved.passwordHash), current = await resolveSession(token);
  if (!current) throw new Error("Synthetic native signed session did not resolve");
  const actor: AdminActor = { userId: current.userId, role: current.role, sessionId: current.sessionId, sessionVersion: current.sessionVersion };
  return { actor, token };
}
async function setup() { const admin = await user("ADMIN"); return { admin, ...await signedActor(admin.id) }; }
function json(value: unknown) { return value === null ? Prisma.JsonNull : JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
async function creator(options: { id?: string; claimed?: boolean; state?: ProfileState; countryCode?: string | null; city?: unknown } = {}) {
  const owner = options.claimed === false ? null : await user();
  const saved = await prisma.creator.create({ data: { ...(options.id ? { id: options.id } : {}), userId: owner?.id ?? null,
    displayName: originalName, handle: `ac_${randomUUID().replaceAll("-", "").slice(0, 24)}`, state: options.state ?? "PRIVATE", isTest: true,
    countryCode: options.countryCode === undefined ? "SA" : options.countryCode, city: json(options.city === undefined ? { key: null, label: "  مدينة أصلية  " } : options.city),
    bio: privateSentinel, profileFacts: { privateSentinel }, minimumMinor: BigInt("9223372036854775807"), currency: "KWD" } });
  creatorIds.push(saved.id); return { owner, saved };
}
async function account(creatorId: string, ownershipStatus: OwnershipStatus) {
  return prisma.socialAccount.create({ data: { creatorId, platform: "TIKTOK", handle: `private-${randomUUID()}`, ownershipStatus,
    ownershipProofAssetId: privateSentinel, providerAccountId: `private-${randomUUID()}`, publicVisible: true, brandVisible: true } });
}
async function queryStartingAt(id: string) {
  const previous = await prisma.creator.findFirst({ where: { id: { lt: id } }, orderBy: { id: "desc" }, select: { id: true } });
  return previous ? { after: previous.id } : {};
}

it("projects original stored identities, all saved profile states, claimed association and actual five-status account counts without leaking private fields", async () => {
  const f = await setup();
  for (const state of ["DRAFT", "PRIVATE", "PUBLISHED", "HIDDEN"] as const) {
    const c = await creator({ state, claimed: state !== "HIDDEN" });
    if (c.owner) await prisma.user.update({ where: { id: c.owner.id }, data: { active: false } });
    for (const status of ["UNPROVED", "PENDING", "VERIFIED", "REJECTED", "REVOKED"] as const) await account(c.saved.id, status);
    await account(c.saved.id, "VERIFIED");
    const result = await getAdminCreators(f.actor, await queryStartingAt(c.saved.id)) as AdminCreatorsDTO;
    expect(result.scope).toBe("ALL_STORED_RECORDS");
    expect(result.creators[0]).toEqual({ id: c.saved.id, displayName: originalName, handle: c.saved.handle, state, countryCode: "SA", cityLabel: "  مدينة أصلية  ",
      claimStatus: c.owner ? "CLAIMED" : "UNCLAIMED", accountCounts: { total: 6, UNPROVED: 1, PENDING: 1, VERIFIED: 2, REJECTED: 1, REVOKED: 1 } });
    for (const secret of [privateSentinel, f.token, f.actor.sessionId, '"userId":', '"bio":', '"profileFacts":', '"minimumMinor":', '"email":']) expect(JSON.stringify(result).includes(secret)).toBe(false);
  }
});

it("keeps malformed residence unknown independently and returns real zero counts without repairing saved content", async () => {
  const f = await setup();
  for (const item of [
    { countryCode: null, city: null, country: null, label: null },
    { countryCode: "sa", city: { label: "original city" }, country: null, label: "original city" },
    { countryCode: "XX", city: "stored city", country: null, label: null },
    { countryCode: "KW", city: { label: "x".repeat(101) }, country: "KW", label: null },
    { countryCode: "SA", city: { label: 7 }, country: "SA", label: null },
    { countryCode: "SA", city: { label: "" }, country: "SA", label: null },
    { countryCode: "SA", city: [{ label: "not a city" }], country: "SA", label: null },
  ]) {
    const c = await creator(item), before = JSON.stringify(c.saved.city);
    const result = await getAdminCreators(f.actor, await queryStartingAt(c.saved.id)) as AdminCreatorsDTO;
    expect(result.creators[0]).toMatchObject({ countryCode: item.country, cityLabel: item.label,
      accountCounts: { total: 0, UNPROVED: 0, PENDING: 0, VERIFIED: 0, REJECTED: 0, REVOKED: 0 } });
    const saved = await prisma.creator.findUniqueOrThrow({ where: { id: c.saved.id } });
    expect(JSON.stringify(saved.city) === before).toBe(true); expect(saved.countryCode === item.countryCode).toBe(true);
  }
});

it("uses native thirty-row exclusive ID pages, bounded account queries and metadata-only audits, including a real maximum-ID empty page", async () => {
  const f = await setup(), prefix = `admin-creator-page-${randomUUID()}-`, asOf = new Date();
  for (let index = 0; index < 35; index++) {
    const c = await creator({ id: `${prefix}${String(index).padStart(2, "0")}`, claimed: false });
    await account(c.saved.id, "PENDING");
  }
  const query = await queryStartingAt(`${prefix}00`);
  let groupedIds: string[] = [];
  const client = prisma.$extends({ query: { socialAccount: { async groupBy({ args, query: native }) {
    groupedIds = (args.where?.creatorId as { in: string[] }).in; return native(args);
  } } } }) as unknown as PrismaClient;
  const expected = await prisma.creator.findMany({ where: query.after ? { id: { gt: query.after } } : undefined,
    orderBy: { id: "asc" }, take: 31, select: { id: true } });
  const first = await getAdminCreators(f.actor, query, { client, now: asOf });
  expect(first.creators.map(row => row.id)).toEqual(expected.slice(0, 30).map(row => row.id));
  expect(groupedIds).toEqual(first.creators.map(row => row.id));
  expect(first.creators.length).toBe(30); expect(first.nextCursor).toBe(expected[29].id);
  for (const row of first.creators) expect(row.accountCounts).toEqual({ total: 1, UNPROVED: 0, PENDING: 1, VERIFIED: 0, REJECTED: 0, REVOKED: 0 });
  const audit = await prisma.adminAudit.findFirstOrThrow({ where: { actorUserId: f.admin.id, action: readAction } });
  expect({ action: audit.action, resourceType: audit.resourceType, resourceId: audit.resourceId }).toEqual({ action: readAction, resourceType: "CreatorList", resourceId: "platform" });
  expect(audit.snapshot).toEqual({ asOf: asOf.toISOString(), after: query.after ?? null, returned: 30, nextCursor: first.nextCursor, scope: "ALL_STORED_RECORDS" });
  expect(JSON.stringify(audit.snapshot).includes(originalName)).toBe(false);
  const nextExpected = await prisma.creator.findMany({ where: { id: { gt: first.nextCursor! } }, orderBy: { id: "asc" }, take: 31, select: { id: true } });
  const second = await getAdminCreators(f.actor, { after: first.nextCursor! });
  expect(second.creators.map(row => row.id)).toEqual(nextExpected.slice(0, 30).map(row => row.id));
  expect(second.creators.some(row => first.creators.some(previous => previous.id === row.id))).toBe(false);
  expect(second.nextCursor).toBe(nextExpected.length > 30 ? nextExpected[29].id : null);
  const maximum = await prisma.creator.findFirstOrThrow({ orderBy: { id: "desc" }, select: { id: true } });
  let emptyGrouped = false;
  const emptyClient = prisma.$extends({ query: { socialAccount: { async groupBy({ args, query: native }) { emptyGrouped = true; return native(args); } } } }) as unknown as PrismaClient;
  const empty = await getAdminCreators(f.actor, { after: maximum.id }, { client: emptyClient });
  expect(empty.creators).toEqual([]); expect(empty.nextCursor).toBeNull(); expect(emptyGrouped).toBe(false);
  for (const result of [first, second, empty]) expect(AdminCreatorsSchema.safeParse(result).success).toBe(true);
  expect(AdminCreatorsSchema.safeParse({ ...first, creators: [{ ...first.creators[0], accountCounts: { ...first.creators[0].accountCounts, total: 99 } }] }).success).toBe(false);
});

it("reads Creator metadata and actual account counts in one native snapshot across a concurrent creator/account update", async () => {
  const f = await setup(), c = await creator(), a = await account(c.saved.id, "PENDING"), query = await queryStartingAt(c.saved.id);
  const entered = latch(), release = latch(); let intercepted = false;
  const client = prisma.$extends({ query: { creator: { async findMany({ args, query: native }) {
    const value = await native(args); if (!intercepted) { intercepted = true; entered.release(); await release.promise; } return value;
  } } } }) as unknown as PrismaClient;
  const reading = observed(getAdminCreators(f.actor, query, { client }));
  try {
    expect(await Promise.race([entered.promise.then(() => true), reading.then(() => false)])).toBe(true);
    await prisma.$transaction(async tx => {
      await tx.creator.update({ where: { id: c.saved.id }, data: { displayName: "اسم جديد بعد بدء القراءة", state: "HIDDEN" } });
      await tx.socialAccount.update({ where: { id: a.id }, data: { ownershipStatus: "REJECTED" } });
    });
    release.release(); const outcome = await reading;
    expect(outcome.ok).toBe(true); if (!outcome.ok) throw new Error("Snapshot creator read failed");
    expect(outcome.value.creators[0]).toMatchObject({ displayName: originalName, state: "PRIVATE", accountCounts: { total: 1, PENDING: 1, REJECTED: 0 } });
    expect((await getAdminCreators(f.actor, query)).creators[0]).toMatchObject({ displayName: "اسم جديد بعد بدء القراءة", state: "HIDDEN", accountCounts: { total: 1, PENDING: 0, REJECTED: 1 } });
  } finally { release.release(); await reading; }
});

it("keeps saved VERIFIED counts descriptive after proof withdrawal without implying current eligibility or changing the saved status", async () => {
  const f = await setup(), c = await creator({ state: "PUBLISHED" }), a = await account(c.saved.id, "VERIFIED"), query = await queryStartingAt(c.saved.id);
  const before = await getAdminCreators(f.actor, query);
  await prisma.socialAccount.update({ where: { id: a.id }, data: { ownershipProofAssetId: null, consentAt: null, publicVisible: false, brandVisible: false } });
  const after = await getAdminCreators(f.actor, query);
  expect(after.creators[0]).toEqual(before.creators[0]);
  expect(Object.keys(after.creators[0]).sort()).toEqual(["accountCounts", "cityLabel", "claimStatus", "countryCode", "displayName", "handle", "id", "state"]);
  for (const denied of ["eligible", "verified", "badge", "licence", "tier", "rate", "publicVisible"]) expect(Object.hasOwn(after.creators[0], denied)).toBe(false);
});

it("ignores legacy procurement Providers and their invented rating/price fields without changing canonical records", async () => {
  const f = await setup(), c = await creator(), query = await queryStartingAt(c.saved.id), asOf = new Date();
  const before = await getAdminCreators(f.actor, query, { now: asOf }), owner = await user();
  const legacy = await prisma.provider.create({ data: { userId: owner.id, providerType: "FREELANCER", languages: [],
    roleTitleAr: privateSentinel, rating: 5, priceRangeMin: 1, priceRangeMax: 2000000000 } });
  try {
    const after = await getAdminCreators(f.actor, query, { now: asOf });
    expect(after).toEqual(before); expect(JSON.stringify(after).includes(legacy.id)).toBe(false);
  } finally { await prisma.provider.delete({ where: { id: legacy.id } }); }
});

function latch() {
  let release!: () => void;
  return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
}

function observed<T>(promise: Promise<T>) {
  return promise.then(value => ({ ok: true as const, value }), (error: { status?: number; code?: string }) => ({ ok: false as const, status: error.status, code: error.code }));
}

async function waitForAdminLock(table: "User" | "AuthSession") {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ${`%"${table}"%`} AND query LIKE '%FOR SHARE%'`;
    if (rows[0]?.count) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Campaign read did not reach its actual admin row-lock wait");
}

it("rejects absent or genuine non-admin context before query interpretation and validates strict current-admin cursor input", async () => {
  const f = await setup(), nonAdmin = await user(), ordinary = await signedActor(nonAdmin.id);
  await expect(getAdminCreators(null as never, { unknown: true })).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  await expect(getAdminCreators(ordinary.actor, { unknown: true })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  for (const input of [{ unknown: true }, { after: "" }, { after: "bad\ncontrol" }, { after: "with space" }, { after: "a".repeat(201) }, { after: 7 }, null, []]) {
    await expect(getAdminCreators(f.actor, input)).rejects.toMatchObject({ code: "VALIDATION", status: 422 });
  }
  expect(await prisma.adminAudit.count({ where: { actorUserId: { in: [f.admin.id, nonAdmin.id] }, action: readAction } })).toBe(0);
});

it("denies revoked, expired, stale-version, changed-role and suspended actors despite previously valid signed claims and historical projection time", async () => {
  const f = await setup(); await creator();
  for (const invalidation of ["revoked", "expired", "version", "role", "suspended"] as const) {
    await prisma.user.update({ where: { id: f.admin.id }, data: { role: "ADMIN", active: true, sessionVersion: 1 } });
    await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { revokedAt: null, expiresAt: new Date(Date.now() + 60000) } });
    if (invalidation === "revoked") await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { revokedAt: new Date() } });
    if (invalidation === "expired") await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { expiresAt: new Date(Date.now() - 1) } });
    if (invalidation === "version") await prisma.user.update({ where: { id: f.admin.id }, data: { sessionVersion: 2 } });
    if (invalidation === "role") await prisma.user.update({ where: { id: f.admin.id }, data: { role: "BRAND" } });
    if (invalidation === "suspended") await prisma.user.update({ where: { id: f.admin.id }, data: { active: false } });
    expect(await resolveSession(f.token) === null).toBe(true);
    await expect(getAdminCreators(f.actor, {}, { now: new Date("2000-01-01T00:00:00.000Z") })).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    expect(await prisma.adminAudit.count({ where: { actorUserId: f.admin.id, action: readAction } })).toBe(0);
  }
});

it("denies actual User and AuthSession invalidation across native admin lock waits without releasing private rows or access audits", async () => {
  for (const table of ["User", "AuthSession"] as const) {
    const f = await setup(), peer = new PrismaClient(), held = latch(), release = latch();
    await creator();
    const holding = peer.$transaction(async tx => {
      if (table === "User") await tx.$queryRaw`SELECT id FROM "User" WHERE id=${f.admin.id} FOR UPDATE`;
      else await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${f.actor.sessionId} FOR UPDATE`;
      held.release(); await release.promise;
      if (table === "User") await tx.user.update({ where: { id: f.admin.id }, data: { role: "BRAND" } });
      else await tx.authSession.update({ where: { id: f.actor.sessionId }, data: { revokedAt: new Date() } });
    }, { timeout: 10000 });
    let reading: ReturnType<typeof observed<AdminCreatorsDTO>> | undefined;
    try {
      await held.promise; reading = observed(getAdminCreators(f.actor));
      expect(await Promise.race([waitForAdminLock(table).then(() => true), reading.then(() => false)])).toBe(true);
      release.release(); await holding;
      const outcome = await reading;
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("Invalidated creator reader returned private metadata");
      expect([401, 503]).toContain(outcome.status);
      await expect(getAdminCreators(f.actor)).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
      expect(await resolveSession(f.token) === null).toBe(true);
      expect(await prisma.adminAudit.count({ where: { actorUserId: f.admin.id, action: readAction } })).toBe(0);
    } finally { release.release(); await holding; await reading; await peer.$disconnect(); }
  }
});

it("checks real session expiry after an unchanged native session lock wait despite a historical asOf", async () => {
  const f = await setup(), peer = new PrismaClient(), held = latch(), release = latch(), expiresAt = new Date(Date.now() + 1500);
  await creator();
  await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { expiresAt } });
  const holding = peer.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${f.actor.sessionId} FOR UPDATE`; held.release(); await release.promise; }, { timeout: 10000 });
  let reading: ReturnType<typeof observed<AdminCreatorsDTO>> | undefined;
  try {
    await held.promise; reading = observed(getAdminCreators(f.actor, {}, { now: new Date("2000-01-01T00:00:00.000Z") }));
    expect(await Promise.race([waitForAdminLock("AuthSession").then(() => true), reading.then(() => false)])).toBe(true);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 10)));
    release.release(); await holding;
    const outcome = await reading;
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("Expired creator reader returned private metadata");
    expect({ status: outcome.status, code: outcome.code }).toEqual({ status: 401, code: "UNAUTHENTICATED" });
    expect(await prisma.adminAudit.count({ where: { actorUserId: f.admin.id, action: readAction } })).toBe(0);
  } finally { release.release(); await holding; await reading; await peer.$disconnect(); }
});

it("rolls back an actually inserted metadata access audit when the real actor session expires before final authorization", async () => {
  const f = await setup(), entered = latch(), release = latch(); await creator();
  const expiresAt = new Date(Date.now() + 1500);
  await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { expiresAt } });
  const client = prisma.$extends({ query: { adminAudit: { async create({ args, query }) {
    const value = await query(args); entered.release(); await release.promise; return value;
  } } } }) as unknown as PrismaClient;
  const reading = observed(getAdminCreators(f.actor, {}, { client }));
  try {
    expect(await Promise.race([entered.promise.then(() => true), reading.then(() => false)])).toBe(true);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 10)));
    release.release();
    const outcome = await reading;
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("Final-expired creator reader returned private metadata");
    expect({ status: outcome.status, code: outcome.code }).toEqual({ status: 401, code: "UNAUTHENTICATED" });
    expect(await prisma.adminAudit.count({ where: { actorUserId: f.admin.id, action: readAction } })).toBe(0);
  } finally { release.release(); await reading; }
});
