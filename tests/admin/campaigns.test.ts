import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient, type CampaignStatus } from "@prisma/client";
import { afterEach, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { getAdminCampaigns } from "@/lib/admin/campaigns";
import { AdminCampaignsSchema, type AdminCampaignsDTO } from "@/lib/admin/contracts";
import type { AdminActor } from "@/lib/admin/context";
import { applyCampaignMutation, approveCampaignBrief, createCampaign, generateCampaignBrief } from "@/lib/campaigns/service";
import type { CampaignDraftFields } from "@/lib/campaigns/contracts";
import { campaignFields } from "../campaigns/fixtures";
import { cleanup, users } from "../deals/fixtures";

// Guarded native disposable records only; stored status/corruption fixtures do
// not assert a real campaign workflow, publication, budget approval or delivery.
const projectIds: string[] = [], categoryIds: string[] = [];
const privateSentinel = "private-admin-campaign-content-sentinel";
const originalTitle = "  حملة أصلية طويلة <script> نص واحد دون ترجمة  ";
const originalBrand = "  الشركة الأصلية فقط — إنفيم  ";
const maxKwd = { amountMinor: "9223372036854775807", currencyCode: "KWD" };
const readAction = "admin.campaigns_accessed";

afterEach(async () => {
  await prisma.project.deleteMany({ where: { id: { in: projectIds.splice(0) } } });
  await prisma.category.deleteMany({ where: { id: { in: categoryIds.splice(0) } } });
  await cleanup();
});

async function user(role: "ADMIN" | "BRAND" = "BRAND") {
  const id = randomUUID(); users.push(id);
  return prisma.user.create({ data: { id, role, name: "اسم المالك الأصلي", nameEn: privateSentinel,
    email: `${randomUUID()}@example.invalid`, passwordHash: "synthetic-admin-campaign-not-a-password",
    isTest: true, emailVerifiedAt: new Date(Date.now() - 1000) } });
}

async function signedActor(userId: string) {
  const saved = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const token = await openSession(saved.id, saved.sessionVersion, saved.passwordHash), current = await resolveSession(token);
  if (!current) throw new Error("Synthetic native signed session did not resolve");
  const actor: AdminActor = { userId: current.userId, role: current.role, sessionId: current.sessionId, sessionVersion: current.sessionVersion };
  return { actor, token };
}

async function brand(name = originalBrand) {
  const owner = await user();
  const saved = await prisma.brand.create({ data: { userId: owner.id, slug: `admin-c-${randomUUID()}`,
    name, countryCode: "KW", state: "PRIVATE", isTest: true, description: privateSentinel } });
  return { owner, saved };
}

async function setup() {
  const admin = await user("ADMIN"), company = await brand();
  return { admin, company, ...await signedActor(admin.id) };
}

function json(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function savedInput(fields: unknown = { budget: maxKwd }, fieldsRevision = 1) {
  return { schemaVersion: 1, fieldsRevision, fields, proposals: [], clarificationCount: 0 };
}

async function genuineCampaign(ownerId: string, fields: CampaignDraftFields = { title: originalTitle, budget: maxKwd }) {
  return (await createCampaign(ownerId, { operationKey: randomUUID(), fields })).campaign;
}

async function storedCampaign(brandId: string, input: unknown, options: { id?: string; revision?: number; title?: string } = {}) {
  return prisma.campaign.create({ data: { brandId, title: options.title ?? originalTitle,
    input: json(input), revision: options.revision ?? 2, ...(options.id ? { id: options.id } : {}) } });
}

async function queryStartingAt(id: string) {
  const previous = await prisma.campaign.findFirst({ where: { id: { lt: id } }, orderBy: { id: "desc" }, select: { id: true } });
  return previous ? { after: previous.id } : {};
}

async function readRow(actor: AdminActor, id: string) {
  const result = await getAdminCampaigns(actor, await queryStartingAt(id));
  expect(result.campaigns[0]?.id).toBe(id);
  return { row: result.campaigns[0], result };
}

function assertPrivateProjection(result: AdminCampaignsDTO, secrets: string[] = []) {
  expect(AdminCampaignsSchema.safeParse(result).success).toBe(true);
  expect(Object.keys(result).sort()).toEqual(["asOf", "campaigns", "nextCursor", "scope"]);
  expect(result.scope).toBe("ALL_STORED_RECORDS");
  expect(result.campaigns.length).toBeLessThanOrEqual(30);
  for (const row of result.campaigns) expect(Object.keys(row).sort()).toEqual(["brandName", "budget", "budgetSource", "createdAt", "id", "revision", "status", "title"]);
  const encoded = JSON.stringify(result);
  for (const secret of [privateSentinel, '"email":', '"passwordHash":', '"nameEn":', '"input":', '"conversation":', '"proposals":', '"briefs":', '"proof":', '"token":', ...secrets]) expect(encoded.includes(secret)).toBe(false);
}

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

it("projects exact original canonical metadata, all seven stored statuses and exact max KWD/JPY/zero money through a private allowlist", async () => {
  const f = await setup();
  const statuses: CampaignStatus[] = ["DRAFT", "BRIEF_GENERATED", "BRIEF_APPROVED", "SHORTLISTED", "IN_DEALS", "COMPLETED", "CANCELLED"];
  const budgets = [maxKwd, { amountMinor: "100001", currencyCode: "JPY" }, { amountMinor: "0", currencyCode: "KWD" }, null, null, null, null];
  const ids: string[] = [];
  for (let index = 0; index < statuses.length; index++) {
    const created = await genuineCampaign(f.company.owner.id, { title: originalTitle, ...(budgets[index] ? { budget: budgets[index]! } : {}) });
    // These later states are saved-record count/projection fixtures, not workflow claims.
    await prisma.campaign.update({ where: { id: created.id }, data: { status: statuses[index], revision: index + 2,
      input: json({ ...savedInput({ title: privateSentinel, ...(budgets[index] ? { budget: budgets[index] } : {}) }), privateMetadata: privateSentinel }),
      conversation: [{ text: privateSentinel, language: "ar" }] } });
    ids.push(created.id);
  }
  const blank = await brand(""), blankCampaign = await genuineCampaign(blank.owner.id, {});
  await prisma.user.update({ where: { id: f.company.owner.id }, data: { active: false } });
  for (let index = 0; index < ids.length; index++) {
    const { row, result } = await readRow(f.actor, ids[index]);
    const saved = await prisma.campaign.findUniqueOrThrow({ where: { id: ids[index] } });
    expect(row).toEqual({ id: ids[index], title: originalTitle, brandName: originalBrand, status: statuses[index],
      revision: index + 2, createdAt: saved.createdAt.toISOString(), budget: budgets[index], budgetSource: budgets[index] ? "SAVED_INPUT" : "UNAVAILABLE" });
    assertPrivateProjection(result, [f.actor.sessionId, f.token, f.admin.email, f.company.owner.email, f.admin.passwordHash]);
  }
  const blankRow = (await readRow(f.actor, blankCampaign.id)).row;
  expect(blankRow).toMatchObject({ title: "", brandName: "", budget: null, budgetSource: "UNAVAILABLE" });
});

it("keeps absent, unsupported, unsafe-revision, malformed and centrally invalid saved draft budgets unknown without coercion or repair", async () => {
  const f = await setup(), valid = savedInput();
  const inputs: unknown[] = [null, [], "unreadable saved input", {}, { ...valid, schemaVersion: 2 }, { ...valid, schemaVersion: "1" },
    { schemaVersion: 1, fields: valid.fields }, ...[0, -1, 1.5, 3, Number.MAX_SAFE_INTEGER + 1].map(fieldsRevision => ({ ...valid, fieldsRevision })),
    { ...valid, fields: {} }, { ...valid, fields: [] }, { ...valid, fields: { budget: null } },
    { ...valid, fields: { budget: { amountMinor: 10001, currencyCode: "KWD" } } },
    { ...valid, fields: { budget: { amountMinor: "01", currencyCode: "KWD" } } },
    { ...valid, fields: { budget: { amountMinor: "9223372036854775808", currencyCode: "KWD" } } },
    { ...valid, fields: { budget: { amountMinor: "10001", currencyCode: "XXX" } } },
    { ...valid, fields: { budget: { ...maxKwd, assumedTax: "0" } } },
    { ...valid, fields: { budget: maxKwd, unknownField: "ignored-field-must-invalidate" } },
    { ...valid, fields: { budget: maxKwd, physicalPresenceRequired: true, presenceCountryCodes: [] } }];
  for (const input of inputs) {
    const saved = await storedCampaign(f.company.saved.id, input), before = JSON.stringify(saved.input);
    const { row } = await readRow(f.actor, saved.id);
    expect(row).toMatchObject({ budget: null, budgetSource: "UNAVAILABLE" });
    expect(JSON.stringify((await prisma.campaign.findUniqueOrThrow({ where: { id: saved.id } })).input) === before).toBe(true);
  }
  // A valid incomplete draft is allowed; a complete requirements object is not required.
  const partial = await genuineCampaign(f.company.owner.id, { budget: { amountMinor: "7", currencyCode: "JPY" } });
  expect((await readRow(f.actor, partial.id)).row).toMatchObject({ title: "", budget: { amountMinor: "7", currencyCode: "JPY" }, budgetSource: "SAVED_INPUT" });
});

it("uses current saved input rather than an actual unapplied proposal or an approved historical brief, preserving original private history", async () => {
  const f = await setup(), created = await genuineCampaign(f.company.owner.id, campaignFields as CampaignDraftFields);
  const generated = await generateCampaignBrief(f.company.owner.id, created.id, { operationKey: randomUUID(), expectedRevision: created.revision });
  const approved = await approveCampaignBrief(f.company.owner.id, created.id, { operationKey: randomUUID(), expectedRevision: generated.campaign.revision,
    briefId: generated.brief.id, expectedBriefVersion: generated.brief.version });
  const proposed = await applyCampaignMutation(f.company.owner.id, created.id, { operationKey: randomUUID(), expectedRevision: approved.campaign.revision,
    action: "PROPOSE_FIELDS", payload: { type: "PROPOSE_FIELDS", patch: { budget: { amountMinor: "999999", currencyCode: "KWD" } }, originalText: { text: privateSentinel, language: "ar" } } });
  expect(proposed.proposalId !== null).toBe(true);
  const briefBefore = await prisma.campaignBrief.findMany({ where: { campaignId: created.id }, orderBy: { version: "asc" } });
  expect(briefBefore.length).toBe(1); expect(briefBefore[0].approvedAt !== null).toBe(true);
  expect((await readRow(f.actor, created.id)).row).toMatchObject({ budget: campaignFields.budget, budgetSource: "SAVED_INPUT" });
  const saved = await prisma.campaign.findUniqueOrThrow({ where: { id: created.id } });
  const state = saved.input as { schemaVersion: number; fieldsRevision: number; fields: Record<string, unknown>; proposals: unknown[]; clarificationCount: number };
  const { budget: omittedBudget, ...withoutBudget } = state.fields;
  expect(JSON.stringify(omittedBudget) === JSON.stringify(campaignFields.budget)).toBe(true);
  for (const fields of [withoutBudget, { ...withoutBudget, budget: { amountMinor: 123456, currencyCode: "KWD" } }]) {
    await prisma.campaign.update({ where: { id: created.id }, data: { input: json({ ...state, fields }) } });
    const { row, result } = await readRow(f.actor, created.id);
    expect(row).toMatchObject({ budget: null, budgetSource: "UNAVAILABLE" });
    assertPrivateProjection(result, [f.actor.sessionId, generated.brief.id, proposed.proposalId!]);
    const after = await prisma.campaign.findUniqueOrThrow({ where: { id: created.id } });
    expect(JSON.stringify(after.conversation) === JSON.stringify(saved.conversation)).toBe(true);
    expect(JSON.stringify((after.input as { proposals: unknown[] }).proposals) === JSON.stringify(state.proposals)).toBe(true);
    expect(JSON.stringify(await prisma.campaignBrief.findMany({ where: { campaignId: created.id }, orderBy: { version: "asc" } })) === JSON.stringify(briefBefore)).toBe(true);
  }
});

it("uses native ascending IDs, thirty-row exclusive cursor pages, an actual maximum-ID empty cursor and metadata-only bounded audits", async () => {
  const f = await setup(), prefix = `admin-campaigns-page-${randomUUID()}-`, asOf = new Date();
  await prisma.campaign.createMany({ data: Array.from({ length: 35 }, (_, index) => ({ id: `${prefix}${String(index).padStart(2, "0")}`,
    brandId: f.company.saved.id, title: `${index} عنوان محفوظ أصلي`, input: json(savedInput({ budget: { amountMinor: "1", currencyCode: "JPY" } })) })) });
  const query = await queryStartingAt(`${prefix}00`), expected = await prisma.campaign.findMany({
    where: query.after ? { id: { gt: query.after } } : undefined, orderBy: { id: "asc" }, take: 31, select: { id: true } });
  const first = await getAdminCampaigns(f.actor, query, { now: asOf });
  expect(first.campaigns.map(row => row.id)).toEqual(expected.slice(0, 30).map(row => row.id));
  expect(first.campaigns[0].id).toBe(`${prefix}00`); expect(first.campaigns.length).toBe(30);
  expect(first.nextCursor).toBe(expected[29].id);
  const audit = await prisma.adminAudit.findFirstOrThrow({ where: { actorUserId: f.admin.id, action: readAction } });
  expect({ action: audit.action, resourceType: audit.resourceType, resourceId: audit.resourceId }).toEqual({ action: readAction, resourceType: "CampaignList", resourceId: "platform" });
  expect(audit.snapshot).toEqual({ asOf: asOf.toISOString(), after: query.after ?? null, returned: 30, nextCursor: first.nextCursor, scope: "ALL_STORED_RECORDS" });
  expect(Object.keys(audit.snapshot as object).sort()).toEqual(["after", "asOf", "nextCursor", "returned", "scope"]);
  for (const secret of [originalBrand, first.campaigns[0].title, f.actor.sessionId, f.token, '"budget":']) expect(JSON.stringify(audit.snapshot).includes(secret)).toBe(false);
  const nextExpected = await prisma.campaign.findMany({ where: { id: { gt: first.nextCursor! } }, orderBy: { id: "asc" }, take: 31, select: { id: true } });
  const second = await getAdminCampaigns(f.actor, { after: first.nextCursor! });
  expect(second.campaigns.map(row => row.id)).toEqual(nextExpected.slice(0, 30).map(row => row.id));
  expect(second.nextCursor).toBe(nextExpected.length > 30 ? nextExpected[29].id : null);
  expect(second.campaigns.some(row => first.campaigns.some(previous => previous.id === row.id))).toBe(false);
  const maximum = await prisma.campaign.findFirstOrThrow({ orderBy: { id: "desc" }, select: { id: true } });
  const empty = await getAdminCampaigns(f.actor, { after: maximum.id });
  expect(empty.campaigns.length).toBe(0); expect(empty.nextCursor).toBeNull();
  assertPrivateProjection(first, [f.actor.sessionId, f.token]); assertPrivateProjection(second); assertPrivateProjection(empty);
});

it("ignores actual legacy procurement Project/Brief/Category demo rows without inventing canonical campaigns or their numeric budgets", async () => {
  const f = await setup(), campaign = await genuineCampaign(f.company.owner.id), query = await queryStartingAt(campaign.id), asOf = new Date();
  const before = await getAdminCampaigns(f.actor, query, { now: asOf }), canonicalCount = await prisma.campaign.count();
  const category = await prisma.category.create({ data: { nameAr: privateSentinel, nameEn: privateSentinel, demoCount: 2000000000 } }); categoryIds.push(category.id);
  const client = await prisma.client.create({ data: { userId: f.company.owner.id } });
  const project = await prisma.project.create({ data: { clientId: client.id, categoryId: category.id, titleAr: privateSentinel,
    titleEn: privateSentinel, description: privateSentinel, requiredSkills: [], budgetMin: 1, budgetMax: 2000000000 } }); projectIds.push(project.id);
  const brief = await prisma.brief.create({ data: { projectId: project.id, titleAr: privateSentinel, titleEn: privateSentinel,
    summaryAr: privateSentinel, summaryEn: privateSentinel, objectiveAr: privateSentinel, objectiveEn: privateSentinel,
    scopeAr: [], scopeEn: [], deliverablesAr: [], deliverablesEn: [], requiredSkills: [], budgetMin: 1, budgetMax: 2000000000, currency: "SAR",
    timelineAr: privateSentinel, timelineEn: privateSentinel, complexity: "HIGH", missingAr: [], missingEn: [], providerTypeAr: privateSentinel,
    providerTypeEn: privateSentinel, criteriaAr: [], criteriaEn: [], milestones: [], qualityScore: 100, approvedByClient: true } });
  const after = await getAdminCampaigns(f.actor, query, { now: asOf });
  expect(after).toEqual(before); expect(await prisma.campaign.count()).toBe(canonicalCount);
  assertPrivateProjection(after, [project.id, brief.id, category.id]);
});

it("rejects absent or genuine non-admin context before query interpretation and validates strict current-admin cursor input", async () => {
  const f = await setup(), ordinary = await signedActor(f.company.owner.id);
  await expect(getAdminCampaigns(null as never, { unknown: true })).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  await expect(getAdminCampaigns(ordinary.actor, { unknown: true })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  for (const input of [{ unknown: true }, { after: "" }, { after: "bad\ncontrol" }, { after: "with space" }, { after: "a".repeat(201) }, { after: 7 }, null, []]) {
    await expect(getAdminCampaigns(f.actor, input)).rejects.toMatchObject({ code: "VALIDATION", status: 422 });
  }
  expect(await prisma.adminAudit.count({ where: { actorUserId: { in: [f.admin.id, f.company.owner.id] }, action: readAction } })).toBe(0);
});

it("denies revoked, expired, stale-version, changed-role and suspended actors despite previously valid signed claims and historical projection time", async () => {
  const f = await setup(); await genuineCampaign(f.company.owner.id);
  for (const invalidation of ["revoked", "expired", "version", "role", "suspended"] as const) {
    await prisma.user.update({ where: { id: f.admin.id }, data: { role: "ADMIN", active: true, sessionVersion: 1 } });
    await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { revokedAt: null, expiresAt: new Date(Date.now() + 60000) } });
    if (invalidation === "revoked") await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { revokedAt: new Date() } });
    if (invalidation === "expired") await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { expiresAt: new Date(Date.now() - 1) } });
    if (invalidation === "version") await prisma.user.update({ where: { id: f.admin.id }, data: { sessionVersion: 2 } });
    if (invalidation === "role") await prisma.user.update({ where: { id: f.admin.id }, data: { role: "BRAND" } });
    if (invalidation === "suspended") await prisma.user.update({ where: { id: f.admin.id }, data: { active: false } });
    expect(await resolveSession(f.token) === null).toBe(true);
    await expect(getAdminCampaigns(f.actor, {}, { now: new Date("2000-01-01T00:00:00.000Z") })).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    expect(await prisma.adminAudit.count({ where: { actorUserId: f.admin.id, action: readAction } })).toBe(0);
  }
});

it("denies actual User and AuthSession invalidation across native admin lock waits without releasing private rows or access audits", async () => {
  for (const table of ["User", "AuthSession"] as const) {
    const f = await setup(), peer = new PrismaClient(), held = latch(), release = latch();
    await genuineCampaign(f.company.owner.id);
    const holding = peer.$transaction(async tx => {
      if (table === "User") await tx.$queryRaw`SELECT id FROM "User" WHERE id=${f.admin.id} FOR UPDATE`;
      else await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${f.actor.sessionId} FOR UPDATE`;
      held.release(); await release.promise;
      if (table === "User") await tx.user.update({ where: { id: f.admin.id }, data: { role: "BRAND" } });
      else await tx.authSession.update({ where: { id: f.actor.sessionId }, data: { revokedAt: new Date() } });
    }, { timeout: 10000 });
    let reading: ReturnType<typeof observed<AdminCampaignsDTO>> | undefined;
    try {
      await held.promise; reading = observed(getAdminCampaigns(f.actor));
      expect(await Promise.race([waitForAdminLock(table).then(() => true), reading.then(() => false)])).toBe(true);
      release.release(); await holding;
      const outcome = await reading;
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("Invalidated campaign reader returned private metadata");
      expect([401, 503]).toContain(outcome.status);
      await expect(getAdminCampaigns(f.actor)).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
      expect(await resolveSession(f.token) === null).toBe(true);
      expect(await prisma.adminAudit.count({ where: { actorUserId: f.admin.id, action: readAction } })).toBe(0);
    } finally { release.release(); await holding; await reading; await peer.$disconnect(); }
  }
});

it("checks real session expiry after an unchanged native session lock wait despite a historical asOf", async () => {
  const f = await setup(), peer = new PrismaClient(), held = latch(), release = latch(), expiresAt = new Date(Date.now() + 1500);
  await genuineCampaign(f.company.owner.id);
  await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { expiresAt } });
  const holding = peer.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${f.actor.sessionId} FOR UPDATE`; held.release(); await release.promise; }, { timeout: 10000 });
  let reading: ReturnType<typeof observed<AdminCampaignsDTO>> | undefined;
  try {
    await held.promise; reading = observed(getAdminCampaigns(f.actor, {}, { now: new Date("2000-01-01T00:00:00.000Z") }));
    expect(await Promise.race([waitForAdminLock("AuthSession").then(() => true), reading.then(() => false)])).toBe(true);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 10)));
    release.release(); await holding;
    const outcome = await reading;
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("Expired campaign reader returned private metadata");
    expect({ status: outcome.status, code: outcome.code }).toEqual({ status: 401, code: "UNAUTHENTICATED" });
    expect(await prisma.adminAudit.count({ where: { actorUserId: f.admin.id, action: readAction } })).toBe(0);
  } finally { release.release(); await holding; await reading; await peer.$disconnect(); }
});

it("rolls back an actually inserted metadata access audit when the real actor session expires before final authorization", async () => {
  const f = await setup(), entered = latch(), release = latch(); await genuineCampaign(f.company.owner.id);
  const expiresAt = new Date(Date.now() + 1500);
  await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { expiresAt } });
  const client = prisma.$extends({ query: { adminAudit: { async create({ args, query }) {
    const value = await query(args); entered.release(); await release.promise; return value;
  } } } }) as unknown as PrismaClient;
  const reading = observed(getAdminCampaigns(f.actor, {}, { client }));
  try {
    expect(await Promise.race([entered.promise.then(() => true), reading.then(() => false)])).toBe(true);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 10)));
    release.release();
    const outcome = await reading;
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("Final-expired campaign reader returned private metadata");
    expect({ status: outcome.status, code: outcome.code }).toEqual({ status: 401, code: "UNAUTHENTICATED" });
    expect(await prisma.adminAudit.count({ where: { actorUserId: f.admin.id, action: readAction } })).toBe(0);
  } finally { release.release(); await reading; }
});

it("uses a consistent native RepeatableRead snapshot for current Campaign and Brand metadata across a concurrent write", async () => {
  const f = await setup(), campaign = await genuineCampaign(f.company.owner.id), query = await queryStartingAt(campaign.id);
  const before = await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } }), entered = latch(), release = latch();
  let intercepted = false;
  // Native authorization establishes the snapshot; this is a scheduling hook,
  // not a stubbed projection. The later campaign query must see that same snapshot.
  const client = prisma.$extends({ query: { user: { async findUnique({ args, query: nativeQuery }) {
    const value = await nativeQuery(args);
    if (!intercepted && args.where.id === f.admin.id) { intercepted = true; entered.release(); await release.promise; }
    return value;
  } } } }) as unknown as PrismaClient;
  const reading = observed(getAdminCampaigns(f.actor, query, { client }));
  try {
    expect(await Promise.race([entered.promise.then(() => true), reading.then(() => false)])).toBe(true);
    await prisma.$transaction(async tx => {
      await tx.campaign.update({ where: { id: campaign.id }, data: { title: "عنوان جديد محفوظ بعد بدء القراءة", revision: { increment: 1 }, input: json(savedInput({ budget: { amountMinor: "8", currencyCode: "JPY" } }, 2)) } });
      await tx.brand.update({ where: { id: f.company.saved.id }, data: { name: "اسم شركة جديد بعد بدء القراءة" } });
    });
    release.release();
    const outcome = await reading;
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("Snapshot campaign reader failed before returning its native projection");
    expect(outcome.value.campaigns[0]).toEqual({ id: campaign.id, title: before.title, brandName: originalBrand, status: before.status,
      revision: before.revision, createdAt: before.createdAt.toISOString(), budget: maxKwd, budgetSource: "SAVED_INPUT" });
    const fresh = (await readRow(f.actor, campaign.id)).row;
    expect(fresh).toMatchObject({ title: "عنوان جديد محفوظ بعد بدء القراءة", brandName: "اسم شركة جديد بعد بدء القراءة",
      revision: before.revision + 1, budget: { amountMinor: "8", currencyCode: "JPY" }, budgetSource: "SAVED_INPUT" });
  } finally { release.release(); await reading; }
});
