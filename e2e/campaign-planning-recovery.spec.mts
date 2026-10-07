import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { expect, test, type BrowserContext, type Page, type TestInfo, type Response, type Locator } from "@playwright/test";
import { assertLocalTarget, taskState } from "../scripts/task-state.mjs";
import { prisma as db } from "../src/lib/prisma";
import { openSession, resolveSession } from "../src/lib/identity";
import { SESSION_COOKIE } from "../src/lib/jwt";
import type { OrganizationActor } from "../src/lib/organizations/context";
import { executeBrandContextCommand, decideContextOwnerReview, getBrandContext, getApprovedBrandContextVersion } from "../src/lib/brand-context/service";
import { BrandContextContentSchema, BrandContextDetailResponseSchema, type PlanningScope } from "../src/lib/brand-context/contracts";
import { executeCampaignPlanningCommand, getPlanningCampaign } from "../src/lib/campaign-planning/service";
import { CampaignPlanningCommandSchema, CampaignPlanningResultSchema, PlanningCampaignSchema, PlanningCampaignListSchema, type CampaignPlanningResult } from "../src/lib/campaign-planning/contracts";
import { campaignFields } from "../tests/campaigns/fixtures";

// IGNORED DRAFT for separate e2e/campaign-planning-recovery.spec.mts; imports
// target that leaf. Three bounded native groups are authorized. Only delivery
// seams may substitute another genuine native response. All producer/auth/
// sessions/rows are real owned synthetic fixtures; no live provider/legal
// acceptance, fake model/Date/authority or test-module imports. Root runs checks.
const state = taskState(), origin = "http://localhost:3100";
if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("Planning recovery requires exact guarded E2E target");
const users = new Set<string>(), brands = new Set<string>(), pageErrors = new WeakMap<Page, string[]>();
test.setTimeout(120000);
test.beforeAll(async () => {
  const rows = await db.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]!.id !== state.id || rows[0]!.kind !== "e2e" || rows[0]!.db !== state.targets.e2e || rows[0]!.host !== "127.0.0.1") throw new Error("Planning recovery target identity mismatch");
});
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; pageErrors.set(page, errors);
  page.on("pageerror", error => errors.push(error.name));
  page.on("console", message => { if (message.type() === "error" && /hydrat|server.rendered|server HTML|text content.*match/i.test(message.text())) errors.push("HYDRATION_MISMATCH"); });
});
test.afterEach(async ({ page }) => {
  const workspaces = await db.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } });
  if (workspaces.length) {
    const ids = workspaces.map(row => row.id);
    for (const table of ["PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission", "CampaignBriefProvenance", "CampaignProposalDependency",
      "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding", "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const) {
      await db.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join(ids)})`);
    }
    await db.planningWorkspace.deleteMany({ where: { id: { in: ids } } });
  }
  await db.campaign.deleteMany({ where: { brandId: { in: [...brands] } } }); await db.brand.deleteMany({ where: { id: { in: [...brands] } } });
  await db.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
  if (users.size) await db.outboxEvent.deleteMany({ where: { OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await db.user.deleteMany({ where: { id: { in: [...users] } } }); users.clear(); brands.clear();
  expect(pageErrors.get(page) ?? [], "Actual page/hydration error metadata").toEqual([]);
});
test.afterAll(async () => { await db.$disconnect(); });
type Copy = (ar: string, en: string) => string;
function locale(info: TestInfo) { const english = info.project.name === "english-desktop"; return { english, copy: (ar: string, en: string) => english ? en : ar }; }
async function company(english: boolean) {
  const id = randomUUID(); users.add(id);
  const user = await db.user.create({ data: { id, role: "BRAND", active: true, isTest: true, language: english ? "en" : "ar", name: "Synthetic planning recovery actor",
    email: `${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  const token = await openSession(id, user.sessionVersion, user.passwordHash), current = await resolveSession(token);
  if (!current) throw new Error("Synthetic planning recovery native session did not resolve");
  const actor: OrganizationActor = { userId: current.userId, role: current.role, sessionId: current.sessionId, sessionVersion: current.sessionVersion };
  const brand = await db.brand.create({ data: { userId: id, slug: "planning-recovery-" + randomUUID().replace(/-/g, "").slice(0, 16), countryCode: "KW", name: "Synthetic recovery company", isTest: true } }); brands.add(brand.id);
  return { user, actor, token, brand, scope: { kind: "OWN_BRAND", brandId: brand.id } as const };
}
async function signed(context: BrowserContext, subject: Awaited<ReturnType<typeof company>>, english: boolean) {
  expect(await resolveSession(subject.token)).not.toBeNull();
  await context.addCookies([{ name: SESSION_COOKIE, value: subject.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "infame_lang", value: english ? "en" : "ar", domain: "localhost", path: "/" }]);
}
function scopeQuery(scope: PlanningScope) { return scope.kind === "OWN_BRAND" ? `scope=OWN_BRAND&brandId=${scope.brandId}` : `scope=CLIENT&clientId=${scope.clientId}`; }
async function read<T>(context: BrowserContext, url: string, schema: z.ZodType<T>) {
  const response = await context.request.get(url); expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toBe("private, no-store");
  return schema.parse((await response.json()).data);
}
const main = (page: Page) => page.locator("main");
const button = (page: Page, copy: Copy, ar: string, en: string) => main(page).getByRole("button", { name: copy(ar, en), exact: true });
async function settled(page: Page, copy: Copy) { await expect(button(page, copy, "إلغاء الانتظار", "Cancel request")).toHaveCount(0); }
function deferred<T>() { let resolve!: (value: T | PromiseLike<T>) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
const content = BrandContextContentSchema.parse({ schemaVersion: 1, positioning: { text: "Real approved native context positioning", language: "en" }, values: [],
  tone: { text: "Exact human-approved context tone", language: "en" }, references: [], competitors: [] });
async function nativeContextVersion(f: Awaited<ReturnType<typeof company>>, name = "Synthetic native recovery context") {
  const created = await executeBrandContextCommand(f.actor, { operationKey: randomUUID(), scope: f.scope, action: "CREATE", expectedRevision: 0,
    payload: { nameOriginal: { text: name, language: "en" }, content } });
  const submitted = await executeBrandContextCommand(f.actor, { operationKey: randomUUID(), scope: f.scope, contextId: created.contextId, action: "SUBMIT", expectedRevision: created.revision, payload: {} });
  const approved = await decideContextOwnerReview(f.actor, { operationKey: randomUUID(), submissionId: submitted.submissionId!, expectedRevision: 1, decision: "APPROVE" });
  const version = await getApprovedBrandContextVersion(f.actor, { scope: f.scope, versionId: approved.versionId! }); expect(version.version.content).toEqual(content);
  return { contextId: created.contextId, version: version.version };
}

test("wrong CREATE acknowledgement from a second actual committed campaign keeps original words/choice and exact uncertain request until genuine replay", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await company(english); await signed(context, f, english); const approved = await nativeContextVersion(f);
  expect((await read(context, `/api/planning-campaigns?${scopeQuery(f.scope)}`, PlanningCampaignListSchema)).campaigns).toEqual([]);
  await page.emulateMedia({ reducedMotion: "reduce" }); expect((await page.goto("/brand/campaigns/new"))?.status()).toBe(200);
  const title = "  Original uncertain A words / كلمات A الأصلية  ", tone = "Original independent A tone";
  await main(page).getByLabel(copy("اسم الحملة", "Campaign title"), { exact: true }).fill(title);
  await main(page).getByLabel(copy("أسلوب المحتوى", "Content tone"), { exact: true }).fill(tone);
  await main(page).getByLabel(copy("نسخة السياق", "Context version"), { exact: true }).selectOption("NONE");
  const committed = deferred<void>(), attempts: string[] = []; let a: CampaignPlanningResult | undefined, b: CampaignPlanningResult | undefined;
  const endpoint = "**/api/planning-campaigns/commands";
  await page.route(endpoint, async route => {
    const body = route.request().postData(); if (body === null) throw new Error("Native CREATE fixture body missing"); attempts.push(body);
    if (attempts.length !== 1) { await route.continue(); return; }
    const input = CampaignPlanningCommandSchema.parse(JSON.parse(body)); if (input.action !== "CREATE") throw new Error("Native recovery expected actual CREATE");
    const actualA = await route.fetch(); expect(actualA.status()).toBe(200); a = CampaignPlanningResultSchema.parse((await actualA.json()).data);
    // Actual same-origin native B producer, separate UUID and materially
    // different fields/choice. No receipt/DTO identity or content is invented.
    const other = CampaignPlanningCommandSchema.parse({ ...input, operationKey: randomUUID(), payload: { ...input.payload,
      fields: { ...input.payload.fields, title: "Wrong actual committed B campaign", tone: "Wrong actual B tone" },
      selection: { kind: "APPROVED_CONTEXT", versionId: approved.version.id, contentHash: approved.version.contentHash } } });
    const actualB = await route.fetch({ postData: JSON.stringify(other) }); expect(actualB.status()).toBe(200); b = CampaignPlanningResultSchema.parse((await actualB.json()).data);
    expect(b.campaignId).not.toBe(a.campaignId); expect(b.campaignRevision).toBe(a.campaignRevision); expect(b.planningRevision).toBe(a.planningRevision);
    const trueB = await read(context, `/api/planning-campaigns/detail?${scopeQuery(f.scope)}&campaignId=${b.campaignId}`, PlanningCampaignSchema);
    expect(trueB.campaign.title).toBe("Wrong actual committed B campaign"); expect(trueB.planning.selection.versionId).toBe(approved.version.id);
    committed.resolve(); await route.fulfill({ response: actualB });
  });
  try {
    await button(page, copy, "راجع واحفظ التفاصيل", "Review and save details").click(); await committed.promise; await settled(page, copy);
    // Defective client accepts B/currentGET and overwrites A. Correct client
    // keeps the capture UNKNOWN and the original visible material unchanged.
    await expect(button(page, copy, "أعد الطلب نفسه", "Retry same request")).toBeVisible();
    await expect(main(page).getByLabel(copy("اسم الحملة", "Campaign title"), { exact: true })).toHaveValue(title);
    await expect(main(page).getByLabel(copy("أسلوب المحتوى", "Content tone"), { exact: true })).toHaveValue(tone);
    await expect(main(page).getByLabel(copy("نسخة السياق", "Context version"), { exact: true })).toHaveValue("NONE");
    if (!a || !b || !attempts[0]) throw new Error("Native CREATE deliveries did not complete");
    expect(await db.campaignPlanningCommand.count({ where: { campaignId: a.campaignId } })).toBe(1); expect(await db.campaignPlanningCommand.count({ where: { campaignId: b.campaignId } })).toBe(1);
    const reply = page.waitForResponse(response => new URL(response.url()).pathname === "/api/planning-campaigns/commands" && response.request().method() === "POST");
    await button(page, copy, "أعد الطلب نفسه", "Retry same request").click(); const recovered = await reply; expect(recovered.status()).toBe(200);
    expect(CampaignPlanningResultSchema.parse((await recovered.json()).data)).toEqual({ ...a, replayed: true }); await settled(page, copy);
    expect(attempts).toHaveLength(2); expect(attempts[1]).toBe(attempts[0]); await expect(button(page, copy, "أعد الطلب نفسه", "Retry same request")).toHaveCount(0);
    const currentA = await read(context, `/api/planning-campaigns/detail?${scopeQuery(f.scope)}&campaignId=${a.campaignId}`, PlanningCampaignSchema);
    expect(currentA.campaign.title).toBe(title); expect(currentA.campaign.fields.tone).toBe(tone); expect(currentA.planning.selection.kind).toBe("NONE"); expect(currentA.campaign.revision).toBe(1);
    await expect(main(page).getByLabel(copy("اسم الحملة", "Campaign title"), { exact: true })).toHaveValue(title); expect(await db.campaignPlanningCommand.count({ where: { campaignId: a.campaignId } })).toBe(1);
  } finally { await page.unroute(endpoint); }
});

async function seedBriefVersions(f: Awaited<ReturnType<typeof company>>, count: number) {
  let receipt = CampaignPlanningResultSchema.parse(await executeCampaignPlanningCommand(f.actor, { operationKey: randomUUID(), scope: f.scope, action: "CREATE",
    expectedCampaignRevision: 0, expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0, payload: { fields: { ...campaignFields, title: "Native brief cursor version1" }, selection: { kind: "NONE" }, narrative: null } }));
  const first = await getPlanningCampaign(f.actor, { scope: f.scope, campaignId: receipt.campaignId });
  const selection = first.planning.selection, ids = new Map<number, string>();
  const run = async (action: string, payload: unknown) => {
    const command = CampaignPlanningCommandSchema.parse({ operationKey: randomUUID(), scope: f.scope, campaignId: receipt.campaignId,
      expectedCampaignRevision: receipt.campaignRevision, expectedPlanningRevision: receipt.planningRevision, expectedSelectionId: selection.id,
      expectedSelectionRevision: selection.revision, action, payload });
    receipt = CampaignPlanningResultSchema.parse(await executeCampaignPlanningCommand(f.actor, command)); return receipt;
  };
  for (let version = 1; version <= count; version++) {
    if (version !== 1) await run("UPDATE_FIELDS", { patch: { title: `Native brief cursor version${version}` } });
    const generated = await run("GENERATE_BRIEF", {}); expect(generated.version).toBe(version);
    if (!generated.briefId) throw new Error("Actual native brief generation omitted identity"); ids.set(version, generated.briefId);
  }
  expect(await db.campaignBrief.count({ where: { campaignId: receipt.campaignId } })).toBe(count); return { campaignId: receipt.campaignId, ids };
}
async function seedContextVersions(f: Awaited<ReturnType<typeof company>>, count: number) {
  const initial = await nativeContextVersion(f, "Native retained context cursor family"), ids = new Map<number, string>([[1, initial.version.id]]);
  for (let version = 2; version <= count; version++) {
    const parent = await getBrandContext(f.actor, { scope: f.scope, contextId: initial.contextId });
    const edited = await executeBrandContextCommand(f.actor, { operationKey: randomUUID(), scope: f.scope, contextId: initial.contextId, action: "UPDATE", expectedRevision: parent.context.revision,
      payload: { nameOriginal: parent.context.nameOriginal, content: { ...content, positioning: { text: `Actual retained original context version${version}`, language: "en" } } } });
    const submitted = await executeBrandContextCommand(f.actor, { operationKey: randomUUID(), scope: f.scope, contextId: initial.contextId, action: "SUBMIT", expectedRevision: edited.revision, payload: {} });
    const approved = await decideContextOwnerReview(f.actor, { operationKey: randomUUID(), submissionId: submitted.submissionId!, expectedRevision: 1, decision: "APPROVE" });
    expect(approved.version).toBe(version); if (!approved.versionId) throw new Error("Actual native context approval omitted identity"); ids.set(version, approved.versionId);
  }
  expect(await db.brandContextVersion.count({ where: { contextId: initial.contextId } })).toBe(count); return { contextId: initial.contextId, ids };
}
function detailURL(campaignId: string) { return (url: URL) => url.pathname === "/api/planning-campaigns/detail" && url.searchParams.get("campaignId") === campaignId; }
function contextURL(contextId: string) { return (url: URL) => url.pathname === "/api/brand-contexts/detail" && url.searchParams.get("contextId") === contextId; }
async function readClick(page: Page, copy: Copy, ar: string, en: string, predicate: (url: URL) => boolean, container = main(page)): Promise<Response> {
  const received = page.waitForResponse(response => response.request().method() === "GET" && predicate(new URL(response.url())));
  await container.getByRole("button", { name: copy(ar, en), exact: true }).click(); const response = await received; expect(response.status()).toBe(200); await settled(page, copy); return response;
}

test("actual51-version backwards brief/context cursors reject a genuine earlier native page and retry exact opaque boundary without replacing the last page", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await company(english); await signed(context, f, english);
  // Real signed producer chains create every immutable history row. No raw
  // insert, row rewrite, producer response or version number is fabricated.
  const briefs = await seedBriefVersions(f, 51), contexts = await seedContextVersions(f, 51);
  const firstBrief = await context.request.get(`/api/planning-campaigns/detail?${scopeQuery(f.scope)}&campaignId=${briefs.campaignId}`); expect(firstBrief.status()).toBe(200);
  const page1 = PlanningCampaignSchema.parse((await firstBrief.json()).data); expect(page1.briefs.map(row => row.version)).toEqual(Array.from({ length: 20 }, (_, i) => 51 - i)); expect(page1.briefsAfter).toBe(briefs.ids.get(32));
  const firstContext = await context.request.get(`/api/brand-contexts/detail?${scopeQuery(f.scope)}&contextId=${contexts.contextId}`); expect(firstContext.status()).toBe(200);
  const context1 = BrandContextDetailResponseSchema.parse((await firstContext.json()).data); expect(context1.context.versions.map(row => row.version)).toEqual(Array.from({ length: 20 }, (_, i) => 51 - i)); expect(context1.context.versionsAfter).toBe(contexts.ids.get(32));
  const commandsBefore = await db.campaignPlanningCommand.count({ where: { campaignId: briefs.campaignId } });
  await page.emulateMedia({ reducedMotion: "reduce" }); expect((await page.goto(`/brand/campaigns/${briefs.campaignId}`))?.status()).toBe(200);
  const briefHeading = (version: number) => main(page).getByRole("heading", { name: copy(`نسخة الموجز ${version}`, `Brief version ${version}`), exact: true });
  await expect(briefHeading(51)).toBeVisible();
  const second = PlanningCampaignSchema.parse((await (await readClick(page, copy, "نسخ أقدم", "Older briefs", detailURL(briefs.campaignId))).json()).data); expect(second.briefs[0]!.version).toBe(31); expect(second.briefsAfter).toBe(briefs.ids.get(12));
  const third = PlanningCampaignSchema.parse((await (await readClick(page, copy, "نسخ أقدم", "Older briefs", detailURL(briefs.campaignId))).json()).data); expect(third.briefs[0]!.version).toBe(11); await expect(briefHeading(11)).toBeVisible();
  const briefAttempts: string[] = []; const briefPredicate = (url: URL) => detailURL(briefs.campaignId)(url) && url.searchParams.get("briefsAfter") === briefs.ids.get(32);
  await page.route(briefPredicate, async route => {
    briefAttempts.push(route.request().url()); const actual = await route.fetch(); expect(actual.status()).toBe(200);
    const native = PlanningCampaignSchema.parse((await actual.json()).data); expect(native.briefs[0]!.version).toBe(31);
    // Only native delivery is substituted: same authorized campaign/counters,
    // actual earlier page1. Captured boundary is the real immutable version32.
    await route.fulfill({ response: briefAttempts.length === 1 ? firstBrief : actual });
  });
  try {
    await readClick(page, copy, "نسخ أحدث", "Newer briefs", briefPredicate);
    await expect(button(page, copy, "أعد القراءة", "Retry read")).toBeVisible(); await expect(briefHeading(11)).toBeVisible(); await expect(briefHeading(51)).toHaveCount(0);
    await readClick(page, copy, "أعد القراءة", "Retry read", briefPredicate); expect(briefAttempts).toHaveLength(2); expect(briefAttempts[1]).toBe(briefAttempts[0]);
    expect(new URL(briefAttempts[0]!).searchParams.get("briefsAfter")).toBe(briefs.ids.get(32)); await expect(briefHeading(31)).toBeVisible(); await expect(button(page, copy, "أعد القراءة", "Retry read")).toHaveCount(0);
  } finally { await page.unroute(briefPredicate); }
  await readClick(page, copy, "تحميل السياقات المتاحة", "Load available contexts", url => url.pathname === "/api/brand-contexts");
  const loaded = page.waitForResponse(response => contextURL(contexts.contextId)(new URL(response.url())));
  await main(page).getByLabel(copy("سياق محفوظ لعرض نسخه", "Saved context to inspect"), { exact: true }).selectOption(contexts.contextId); expect((await loaded).status()).toBe(200); await settled(page, copy);
  const contextPanel: Locator = main(page).locator('[data-slot="card"]').filter({ has: page.getByText(copy("السياق الاختياري", "Optional context"), { exact: true }) });
  const choice = main(page).getByLabel(copy("نسخة السياق", "Context version"), { exact: true }), option = (version: number) => choice.locator(`option[value="${contexts.ids.get(version)}"]`);
  await expect(option(51)).toHaveCount(1);
  const context2 = BrandContextDetailResponseSchema.parse((await (await readClick(page, copy, "نسخ أقدم", "Older versions", contextURL(contexts.contextId), contextPanel)).json()).data); expect(context2.context.versions[0]!.version).toBe(31); expect(context2.context.versionsAfter).toBe(contexts.ids.get(12));
  const context3 = BrandContextDetailResponseSchema.parse((await (await readClick(page, copy, "نسخ أقدم", "Older versions", contextURL(contexts.contextId), contextPanel)).json()).data); expect(context3.context.versions[0]!.version).toBe(11); await expect(option(11)).toHaveCount(1);
  const contextAttempts: string[] = [], contextPredicate = (url: URL) => contextURL(contexts.contextId)(url) && url.searchParams.get("versionsAfter") === contexts.ids.get(32);
  await page.route(contextPredicate, async route => {
    contextAttempts.push(route.request().url()); const actual = await route.fetch(); expect(actual.status()).toBe(200);
    const native = BrandContextDetailResponseSchema.parse((await actual.json()).data); expect(native.context.versions[0]!.version).toBe(31);
    await route.fulfill({ response: contextAttempts.length === 1 ? firstContext : actual });
  });
  try {
    await readClick(page, copy, "نسخ أحدث", "Newer versions", contextPredicate, contextPanel);
    await expect(button(page, copy, "أعد القراءة", "Retry read")).toBeVisible(); await expect(option(11)).toHaveCount(1); await expect(option(51)).toHaveCount(0);
    await readClick(page, copy, "أعد القراءة", "Retry read", contextPredicate); expect(contextAttempts).toHaveLength(2); expect(contextAttempts[1]).toBe(contextAttempts[0]);
    expect(new URL(contextAttempts[0]!).searchParams.get("versionsAfter")).toBe(contexts.ids.get(32)); await expect(option(31)).toHaveCount(1); await expect(button(page, copy, "أعد القراءة", "Retry read")).toHaveCount(0);
  } finally { await page.unroute(contextPredicate); }
  expect(await db.campaignPlanningCommand.count({ where: { campaignId: briefs.campaignId } })).toBe(commandsBefore);
  expect(await db.campaignBrief.count({ where: { campaignId: briefs.campaignId } })).toBe(51); expect(await db.brandContextVersion.count({ where: { contextId: contexts.contextId } })).toBe(51);
});

async function shellLink(page: Page, copy: Copy, ar: string, en: string) {
  const menu = page.getByRole("button", { name: copy("فتح قائمة مساحة العمل", "Open workspace menu"), exact: true });
  if (await menu.isVisible()) await menu.click();
  const link = page.getByRole("link", { name: copy(ar, en), exact: true }); await expect(link).toBeVisible(); return link;
}
async function keptFocus(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const active = document.activeElement;
    return active instanceof HTMLElement && active.isConnected && (active.getAttribute("href") === "/brand/context"
      || ["Open workspace menu", "فتح قائمة مساحة العمل"].includes(active.getAttribute("aria-label") ?? "")
      || active.tagName === "H1" && active.closest("main") !== null
      || active instanceof HTMLInputElement && active.closest("#planning-title") !== null);
  }), { message: "Keep editing restores a connected opener, menu trigger, title field or stable heading" }).toBe(true);
}

test("real shared-shell links and browser Back preserve dirty words/exact route with Keep, and explicit Discard follows genuine previous navigation without a write", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await company(english); await signed(context, f, english);
  const made = CampaignPlanningResultSchema.parse(await executeCampaignPlanningCommand(f.actor, { operationKey: randomUUID(), scope: f.scope, action: "CREATE",
    expectedCampaignRevision: 0, expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0,
    payload: { fields: { ...campaignFields, title: "Actual unchanged shell/back campaign" }, selection: { kind: "NONE" }, narrative: null } }));
  const current = await read(context, `/api/planning-campaigns/detail?${scopeQuery(f.scope)}&campaignId=${made.campaignId}`, PlanningCampaignSchema);
  const before = await db.campaign.findUniqueOrThrow({ where: { id: made.campaignId } }), stateBefore = await db.campaignPlanningState.findUniqueOrThrow({ where: { campaignId: made.campaignId } });
  const commandCount = await db.campaignPlanningCommand.count({ where: { campaignId: made.campaignId } }), postBodies: string[] = [];
  page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname.startsWith("/api/planning-campaigns")) postBodies.push(request.postData() ?? ""); });
  await page.emulateMedia({ reducedMotion: "reduce" }); expect((await page.goto("/brand/context"))?.status()).toBe(200);
  // Actual Next Link transitions build native same-document Back history.
  // No history.pushState/replaceState/evaluate route setup exists in this test.
  await (await shellLink(page, copy, "حملاتي", "Campaigns")).click(); await expect(page).toHaveURL(origin + "/brand/campaigns");
  await main(page).locator(`[data-campaign-id="${made.campaignId}"]`).getByRole("link", { name: current.campaign.title, exact: true }).click();
  const exactURL = origin + `/brand/campaigns/${made.campaignId}`; await expect(page).toHaveURL(exactURL);
  const title = main(page).getByLabel(copy("اسم الحملة", "Campaign title"), { exact: true }), original = "  Unsaved original words / كلمات غير محفوظة  ";
  await title.fill(original); const shell = await shellLink(page, copy, "سياق العلامة", "Brand context"); await shell.click();
  const dialog = page.getByRole("dialog", { name: copy("مدخلات غير محفوظة", "Unsaved input"), exact: true }); await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(exactURL); await expect(title).toHaveValue(original);
  await dialog.getByRole("button", { name: copy("تابع التحرير", "Keep editing"), exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(exactURL); await expect(title).toHaveValue(original); await keptFocus(page);
  // Native Back now targets the actual campaigns Link entry. The shared guard
  // must keep the current editor until its user chooses, then restore its focus.
  await page.goBack({ waitUntil: "commit" }); await expect(dialog).toBeVisible(); await expect(page).toHaveURL(exactURL); await expect(title).toHaveValue(original);
  await dialog.getByRole("button", { name: copy("تابع التحرير", "Keep editing"), exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(exactURL); await expect(title).toHaveValue(original); await keptFocus(page);
  await page.goBack({ waitUntil: "commit" }); await expect(dialog).toBeVisible(); await expect(page).toHaveURL(exactURL);
  await dialog.getByRole("button", { name: copy("تجاهل التغييرات وغادر", "Discard changes and leave"), exact: true }).click(); await expect(page).toHaveURL(origin + "/brand/campaigns");
  await expect(main(page).locator(`[data-campaign-id="${made.campaignId}"]`)).toContainText(current.campaign.title); await expect(main(page)).not.toContainText(original);
  expect(postBodies).toEqual([]); expect(await db.campaign.findUniqueOrThrow({ where: { id: made.campaignId } })).toEqual(before);
  expect(await db.campaignPlanningState.findUniqueOrThrow({ where: { campaignId: made.campaignId } })).toEqual(stateBefore);
  expect(await db.campaignPlanningCommand.count({ where: { campaignId: made.campaignId } })).toBe(commandCount);
  expect((await read(context, `/api/planning-campaigns/detail?${scopeQuery(f.scope)}&campaignId=${made.campaignId}`, PlanningCampaignSchema)).campaign.fields).toEqual(current.campaign.fields);
});
