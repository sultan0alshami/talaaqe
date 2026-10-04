import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterEach, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getAdminOverview, getAdminPendingCount } from "@/lib/admin/overview";
import { AdminOverviewSchema } from "@/lib/admin/contracts";
import { fixture, cleanup } from "../deals/fixtures";

const assetIds: string[] = [], categoryIds: string[] = [], projectIds: string[] = [];
afterEach(async () => {
  await prisma.project.deleteMany({ where: { id: { in: projectIds.splice(0) } } });
  await prisma.category.deleteMany({ where: { id: { in: categoryIds.splice(0) } } });
  await cleanup();
  await prisma.privateAsset.deleteMany({ where: { id: { in: assetIds.splice(0) } } });
});
async function setup() {
  const f = await fixture(2, "10001", { now: new Date(), target: "test" });
  const sessionId = randomBytes(32).toString("base64url");
  await prisma.authSession.create({ data: { id: sessionId, userId: f.target.reviewerId, version: 1, expiresAt: new Date(Date.now() + 120000) } });
  return { ...f, actor: { userId: f.target.reviewerId, role: "ADMIN" as const, sessionId, sessionVersion: 1 } };
}
function latch() {
  let release!: () => void;
  return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
}

it("counts actual canonical stored records, five pending kinds and bounded metadata without legacy/demo influence", async () => {
  const f = await setup(), now = new Date();
  // These are explicitly synthetic saved-record fixtures, not accepted proof.
  const asset = await prisma.privateAsset.create({ data: { ownerUserId: f.target.userId, purpose: "SCREENSHOT_METRICS", storageKey: "private-sentinel-storage", contentType: "image/png", size: 1, checksum: "a".repeat(64) } });
  assetIds.push(asset.id);
  for (let i = 0; i < 11; i++) {
    const account = await prisma.socialAccount.create({ data: { creatorId: f.target.id, platform: "INSTAGRAM", handle: `synthetic_admin_${randomUUID().replaceAll("-", "")}` } });
    await prisma.ownershipChallenge.create({ data: { accountId: account.id, ownerUserId: f.target.userId, identity: { privateSentinel: "never-project-identity" }, identityHash: "f".repeat(64), mappingRevision: 1, challengeCode: "private-sentinel-nonce", createdAt: new Date(now.getTime() - 86400000), expiresAt: new Date(now.getTime() - 1), proofAssetId: i === 0 ? asset.id : null, reviewNote: "private-sentinel-note" } });
  }
  await prisma.metricsSnapshot.createMany({ data: [
    { accountId: f.target.accountId, mappingRevision: 1, source: "SELF_REPORTED", observedAt: now, evidenceAssetId: asset.id },
    { accountId: f.target.accountId, mappingRevision: 1, source: "SCREENSHOT_VERIFIED", observedAt: now, evidenceAssetId: asset.id },
    { accountId: f.target.accountId, mappingRevision: 1, source: "PUBLIC_IMPORT", observedAt: now, evidenceAssetId: asset.id },
    { accountId: f.target.accountId, mappingRevision: 1, source: "SELF_REPORTED", observedAt: now },
    { accountId: f.target.accountId, mappingRevision: 1, source: "SELF_REPORTED", observedAt: now, evidenceAssetId: asset.id, reviewStatus: "REJECTED" },
  ] });
  await prisma.advertisingLicence.create({ data: { creatorId: f.target.id, jurisdiction: "KW", issuer: "Synthetic count fixture", holderName: "private-sentinel-holder", licenceNumber: "private-sentinel-licence", evidenceAssetId: asset.id } });
  await prisma.businessVerification.createMany({ data: ["REPRESENTATIVE", "BUSINESS_REGISTRATION"].map(kind => ({ brandId: f.brandId, kind, identifier: "private-sentinel-registration", evidenceAssetId: asset.id })) });
  const boundary = new Date(now.getTime() - 7 * 86400000);
  for (const createdAt of [boundary, new Date(boundary.getTime() - 1), new Date(now.getTime() + 1)]) await prisma.campaign.create({ data: { brandId: f.brandId, title: "Synthetic temporal record", input: {}, createdAt } });
  await prisma.user.update({ where: { id: f.brandUserId }, data: { active: false, isTest: true } });
  const expected = {
    users: await prisma.user.count(), brandAccounts: await prisma.user.count({ where: { role: "BRAND" } }), creatorAccounts: await prisma.user.count({ where: { role: "CREATOR" } }),
    campaigns: await prisma.campaign.count(), weeklyCampaigns: await prisma.campaign.count({ where: { createdAt: { gte: boundary, lte: now } } }), briefVersions: await prisma.campaignBrief.count(), deals: await prisma.deal.count(),
  };
  const result = await getAdminOverview(f.actor, { now });
  expect(AdminOverviewSchema.safeParse(result).success).toBe(true);
  expect(result.counts).toMatchObject(expected);
  expect(result.scope).toBe("ALL_STORED_RECORDS");
  const pendingExpected = [await prisma.ownershipChallenge.count({ where: { status: "PENDING" } }), await prisma.metricsSnapshot.count({ where: { reviewStatus: "PENDING", source: { in: ["SELF_REPORTED", "SCREENSHOT_VERIFIED"] }, evidenceAssetId: { not: null } } }), await prisma.advertisingLicence.count({ where: { status: "PENDING" } }), await prisma.businessVerification.count({ where: { status: "PENDING", kind: "REPRESENTATIVE" } }), await prisma.businessVerification.count({ where: { status: "PENDING", kind: "BUSINESS_REGISTRATION" } })];
  expect(result.pending.map(row => row.count)).toEqual(pendingExpected);
  expect(result.counts.pendingEvidence).toBe(pendingExpected.reduce((sum, n) => sum + n, 0));
  expect(await getAdminPendingCount(f.actor)).toBe(result.counts.pendingEvidence);
  const rows = await prisma.ownershipChallenge.findMany({ where: { status: "PENDING" }, orderBy: { id: "asc" }, take: 8 });
  expect(result.ownershipPreview.map(row => row.id)).toEqual(rows.map(row => row.id));
  expect(result.ownershipPreview).toHaveLength(8);
  for (const row of result.ownershipPreview) expect(row.hasEvidenceReference).toBe(rows.find(saved => saved.id === row.id)!.proofAssetId !== null);
  const encoded = JSON.stringify(result);
  for (const privateValue of ["private-sentinel", asset.id, f.actor.sessionId]) expect(encoded).not.toContain(privateValue);
  expect(Object.keys(result.ownershipPreview[0]).sort()).toEqual(["handle", "hasEvidenceReference", "id", "platform", "startedAt"]);
  const category = await prisma.category.create({ data: { nameAr: "فئة قديمة اصطناعية", nameEn: "Synthetic legacy category", demoCount: 2000000000 } }); categoryIds.push(category.id);
  await prisma.provider.create({ data: { userId: f.target.userId, providerType: "FREELANCER", languages: ["ar"] } });
  const client = await prisma.client.create({ data: { userId: f.brandUserId } });
  const project = await prisma.project.create({ data: { clientId: client.id, titleAr: "مشروع قديم", titleEn: "Legacy synthetic project", description: "Legacy only", requiredSkills: [] } }); projectIds.push(project.id);
  const next = await getAdminOverview(f.actor, { now });
  expect(next.counts).toEqual(result.counts);
  expect(next.pending).toEqual(result.pending);
  const audit = await prisma.adminAudit.findFirstOrThrow({ where: { actorUserId: f.actor.userId, action: "admin.overview_accessed" } });
  expect(JSON.stringify(audit.snapshot)).not.toContain("private-sentinel");
});

it.each(["revoked", "expired", "version", "role", "suspended"] as const)("rejects %s trusted sessions using the actual auth clock before count projection", async change => {
  const f = await setup();
  if (change === "revoked") await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { revokedAt: new Date() } });
  if (change === "expired") await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { expiresAt: new Date(Date.now() - 1) } });
  if (change === "version") await prisma.user.update({ where: { id: f.actor.userId }, data: { sessionVersion: 2 } });
  if (change === "role") await prisma.user.update({ where: { id: f.actor.userId }, data: { role: "BRAND" } });
  if (change === "suspended") await prisma.user.update({ where: { id: f.actor.userId }, data: { active: false } });
  await expect(getAdminOverview(f.actor, { now: new Date("2000-01-01T00:00:00.000Z") })).rejects.toMatchObject({ status: 401 });
  expect(await prisma.adminAudit.count({ where: { actorUserId: f.actor.userId, action: "admin.overview_accessed" } })).toBe(0);
});

it("rejects absent context and a genuine current non-admin session before native count reads", async () => {
  const f = await setup();
  await expect(getAdminOverview(null as never)).rejects.toMatchObject({ status: 401 });
  const sessionId = randomBytes(32).toString("base64url");
  await prisma.authSession.create({ data: { id: sessionId, userId: f.target.userId, version: 1, expiresAt: new Date(Date.now() + 60000) } });
  await expect(getAdminOverview({ userId: f.target.userId, role: "CREATOR", sessionId, sessionVersion: 1 } as never)).rejects.toMatchObject({ status: 403 });
});

it("keeps one consistent native snapshot across concurrent canonical writes", async () => {
  const f = await setup(), entered = latch(), release = latch();
  const beforeUsers = await prisma.user.count(), beforeCampaigns = await prisma.campaign.count();
  const client = prisma.$extends({ query: { user: { async count({ args, query }) { const value = await query(args); entered.release(); await release.promise; return value; } } } }) as unknown as PrismaClient;
  const read = getAdminOverview(f.actor, { client });
  try {
    await entered.promise;
    await prisma.campaign.create({ data: { brandId: f.brandId, title: "Synthetic concurrent campaign", input: {} } });
    release.release();
    const result = await read;
    expect(result.counts.users).toBe(beforeUsers);
    expect(result.counts.campaigns).toBe(beforeCampaigns);
    expect((await getAdminOverview(f.actor)).counts.campaigns).toBe(beforeCampaigns + 1);
  } finally { release.release(); await read.catch(() => undefined); }
});

async function waitForAdminLock(table: "User" | "AuthSession") {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ${`%"${table}"%`}`;
    if (rows[0]?.count) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Admin read did not reach its actual row-lock wait");
}

it.each(["suspended", "role", "version", "revoked"] as const)("denies %s identity changed during a native lock wait without releasing counts or an audit", async change => {
  const f = await setup(), peer = new PrismaClient(), held = latch(), release = latch();
  const table = change === "revoked" ? "AuthSession" : "User";
  const holding = peer.$transaction(async tx => {
    if (table === "User") await tx.$queryRaw`SELECT id FROM "User" WHERE id=${f.actor.userId} FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${f.actor.sessionId} FOR UPDATE`;
    held.release(); await release.promise;
    if (change === "suspended") await tx.user.update({ where: { id: f.actor.userId }, data: { active: false } });
    if (change === "role") await tx.user.update({ where: { id: f.actor.userId }, data: { role: "BRAND" } });
    if (change === "version") await tx.user.update({ where: { id: f.actor.userId }, data: { sessionVersion: 2 } });
    if (change === "revoked") await tx.authSession.update({ where: { id: f.actor.sessionId }, data: { revokedAt: new Date() } });
  }, { timeout: 10000 });
  let reading: Promise<unknown> | undefined;
  try {
    await held.promise;
    reading = getAdminOverview(f.actor).then(() => ({ succeeded: true, status: 200 }), (error: { status?: number }) => ({ succeeded: false, status: error.status }));
    await waitForAdminLock(table);
    release.release(); await holding;
    const result = await reading;
    expect(result).toMatchObject({ succeeded: false });
    expect([401, 503]).toContain((result as { status: number }).status);
    await expect(getAdminOverview(f.actor)).rejects.toMatchObject({ status: 401 });
    expect(await prisma.adminAudit.count({ where: { actorUserId: f.actor.userId, action: "admin.overview_accessed" } })).toBe(0);
  } finally { release.release(); await holding; await reading; await peer.$disconnect(); }
});

it("checks actual expiry after an unchanged native session lock wait", async () => {
  const f = await setup(), expiresAt = new Date(Date.now() + 900), peer = new PrismaClient(), held = latch(), release = latch();
  await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { expiresAt } });
  const holding = peer.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${f.actor.sessionId} FOR UPDATE`; held.release(); await release.promise; }, { timeout: 10000 });
  let reading: Promise<unknown> | undefined;
  try {
    await held.promise;
    reading = getAdminOverview(f.actor, { now: new Date("2000-01-01T00:00:00.000Z") }).then(() => ({ succeeded: true }), (error: { status: number }) => ({ succeeded: false, status: error.status }));
    await waitForAdminLock("AuthSession");
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 10)));
    release.release(); await holding;
    expect(await reading).toMatchObject({ succeeded: false, status: 401 });
    expect(await prisma.adminAudit.count({ where: { actorUserId: f.actor.userId, action: "admin.overview_accessed" } })).toBe(0);
  } finally { release.release(); await holding; await reading; await peer.$disconnect(); }
});

it("rolls back the access audit when the current session expires during actual count projection", async () => {
  const f = await setup(), entered = latch(), release = latch(), expiresAt = new Date(Date.now() + 900);
  await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { expiresAt } });
  const client = prisma.$extends({ query: { user: { async count({ args, query }) { const value = await query(args); entered.release(); await release.promise; return value; } } } }) as unknown as PrismaClient;
  const read = getAdminOverview(f.actor, { client }).then(() => ({ succeeded: true }), (error: { status: number }) => ({ succeeded: false, status: error.status }));
  try {
    await entered.promise;
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 10)));
    release.release();
    expect(await read).toMatchObject({ succeeded: false, status: 401 });
    expect(await prisma.adminAudit.count({ where: { actorUserId: f.actor.userId, action: "admin.overview_accessed" } })).toBe(0);
  } finally { release.release(); await read; }
});
