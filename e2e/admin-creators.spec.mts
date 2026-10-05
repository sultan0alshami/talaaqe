import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { assertLocalTarget, taskState, workspace } from "../scripts/task-state.mjs";
import { prisma as db } from "../src/lib/prisma";
import { authenticate, openSession, resolveSession } from "../src/lib/identity";
import { SESSION_COOKIE } from "../src/lib/jwt";
import { AdminCreatorsSchema, type AdminCreatorDTO } from "../src/lib/admin/contracts";
import { OwnershipStatusSchema, ProfileStateSchema } from "../src/lib/contracts/vocabulary";
import { cleanup, fixture, user } from "../tests/deals/fixtures";

const state = taskState();
const listEndpoint = (url: URL) => url.pathname === "/api/admin/creators";
const creatorIds: string[] = [];
if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("Creator browser acceptance requires the exact isolated E2E target");
test.beforeAll(async () => {
  const rows = await db.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id, kind, current_database() AS db, host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0].id !== state.id || rows[0].kind !== "e2e" || rows[0].db !== state.targets.e2e || rows[0].host !== "127.0.0.1") throw new Error("Incorrect creator browser database identity");
});
test.afterEach(async () => {
  // Unclaimed fixture rows are not reachable through the shared tracked Users.
  await db.creator.deleteMany({ where: { id: { in: creatorIds } } });
  creatorIds.length = 0;
  await cleanup();
});
test.afterAll(async () => { await db.$disconnect(); });

async function setup(english: boolean, extra = 0) {
  const f = await fixture(2, "10001", { now: new Date(), target: "e2e" });
  const ownerId = await user("CREATOR"), suspendedOwnerId = await user("CREATOR");
  await db.user.update({ where: { id: suspendedOwnerId }, data: { active: false } });
  const password = `Synthetic creator admin ${randomUUID()}`, language = english ? "en" : "ar";
  await db.user.updateMany({ where: { id: { in: [f.brandUserId, f.target.userId, f.target.reviewerId] } }, data: { passwordHash: await bcrypt.hash(password, 12), language } });
  const prefix = `000-admin-creators-${randomUUID()}`, handlePrefix = randomUUID().replaceAll("-", "").slice(0, 25);
  const ids = Array.from({ length: 4 + extra }, (_, i) => `${prefix}-${String(i).padStart(3, "0")}`);
  const names = ["اسم صانع المحتوى الأصلي Browser " + "طويل ".repeat(20), "ملف أصلي بلا حساب مستخدم", "ملف منشور محفوظ لمالك موقوف", "ملف مخفي محفوظ"];
  const cities = ["المدينة الأصلية Original " + "طويل ".repeat(10), "مدينة أصلية مع بلد غير معروف"];
  const handles = ids.map((_, i) => `c${handlePrefix}${String(i).padStart(4, "0")}`);
  creatorIds.push(...ids);
  for (const [i, id] of ids.entries()) await db.creator.create({ data: {
    id, userId: i === 0 ? ownerId : i === 2 ? suspendedOwnerId : null,
    displayName: names[i] ?? `صانع محتوى اختبار ${i}`, handle: handles[i],
    state: ProfileStateSchema.options[i % 4], isTest: i % 2 === 0, brandVisible: false,
    countryCode: i === 0 || i === 2 ? "SA" : i === 1 ? "ZZ" : null,
    city: i < 2 ? { key: `private-city-key-${i}`, label: cities[i], private: "private-city-sentinel" } : { label: 17 },
    bio: "private-biography-sentinel", profileFacts: { private: "private-facts-sentinel" },
    currency: "SAR", minimumMinor: BigInt(777777),
  } });
  // These are saved status fixtures, deliberately without accepted proof receipts.
  // They exercise descriptive metadata, never current ownership or offer eligibility.
  for (const [i, status] of OwnershipStatusSchema.options.entries()) await db.socialAccount.create({ data: {
    creatorId: ids[0], platform: "INSTAGRAM", handle: `${handlePrefix}_${i}`, ownershipStatus: status,
    providerAccountId: `private-provider-sentinel-${i}`, ownershipProofAssetId: `private-proof-sentinel-${i}`,
    fieldVisibility: { private: "private-account-facts-sentinel" },
  } });
  for (let i = 0; i < 2; i++) await db.socialAccount.create({ data: {
    creatorId: ids[2], platform: "TIKTOK", handle: `${handlePrefix}_stored_${i}`, ownershipStatus: "VERIFIED",
  } });
  await db.socialAccount.create({ data: { creatorId: ids[3], platform: "YOUTUBE", handle: `${handlePrefix}_revoked`, ownershipStatus: "REVOKED" } });
  const session = async (context: BrowserContext, id: string) => {
    const saved = await db.user.findUniqueOrThrow({ where: { id } });
    const authenticated = await authenticate(saved.email, password);
    if (!authenticated) throw new Error("Synthetic native authentication failed");
    const token = await openSession(authenticated.id, authenticated.sessionVersion, authenticated.passwordHash), actor = await resolveSession(token);
    if (!actor) throw new Error("Synthetic native session resolution failed");
    await context.addCookies([{ name: SESSION_COOKIE, value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }, { name: "infame_lang", value: language, domain: "localhost", path: "/" }]);
    return actor;
  };
  const query = new URLSearchParams({ after: prefix }).toString();
  return { ...f, ids, names, handles, cities, ownerId, suspendedOwnerId, session, api: `/api/admin/creators?${query}`, url: `/admin/providers?${query}` };
}
const rowFor = (page: Page, id: string) => page.locator(`[data-admin-creator="${id}"]`);
const currentTime = (page: Page) => page.locator("main header time");
const renderedIds = (page: Page) => page.locator("[data-admin-creator]").evaluateAll(elements => elements.map(element => element.getAttribute("data-admin-creator")));
async function actualList(page: Page, api: string) {
  const response = await page.request.get(api);
  expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toBe("private, no-store");
  const parsed = AdminCreatorsSchema.safeParse((await response.json()).data);
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error("Invalid actual canonical creator DTO");
  return parsed.data;
}
async function expectCounts(page: Page, creator: AdminCreatorDTO) {
  const row = rowFor(page, creator.id);
  await expect(row.locator('[data-account-count="total"]')).toHaveText(String(creator.accountCounts.total));
  await expect(row.locator('[data-account-count="total"]')).toBeVisible();
  for (const status of OwnershipStatusSchema.options) {
    const count = row.locator(`[data-ownership-status="${status}"] bdi`);
    await expect(count).toHaveText(String(creator.accountCounts[status])); await expect(count).toBeVisible();
  }
}

test("original admin creator rows show descriptive stored counts, original residence and private-safe evidence navigation", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop", label = (ar: string, en: string) => english ? en : ar, f = await setup(english);
  const anonymous = await page.request.get(f.api);
  expect(anonymous.status()).toBe(401); expect(anonymous.headers()["cache-control"]).toBe("private, no-store");
  for (const id of [f.brandUserId, f.target.userId]) {
    await f.session(context, id);
    const denied = await page.request.get(f.api);
    expect(denied.status()).toBe(403); expect(denied.headers()["cache-control"]).toBe("private, no-store");
  }
  const actor = await f.session(context, f.target.reviewerId), actual = await actualList(page, f.api);
  expect(actual.scope).toBe("ALL_STORED_RECORDS");
  for (const value of [actor.sessionId, actor.email, f.ownerId, f.suspendedOwnerId, "private-biography-sentinel", "private-facts-sentinel", "private-city-sentinel", "private-provider-sentinel", "private-proof-sentinel", "private-account-facts-sentinel", "passwordHash", "777777"]) expect(JSON.stringify(actual).includes(value)).toBe(false);
  const ownRows = f.ids.map(id => actual.creators.find(row => row.id === id));
  expect(ownRows.every(Boolean)).toBe(true);
  expect(ownRows.map(row => row!.state)).toEqual(ProfileStateSchema.options);
  expect(ownRows.map(row => row!.claimStatus)).toEqual(["CLAIMED", "UNCLAIMED", "CLAIMED", "UNCLAIMED"]);
  expect(ownRows[0]!.accountCounts).toEqual({ total: 5, UNPROVED: 1, PENDING: 1, VERIFIED: 1, REJECTED: 1, REVOKED: 1 });
  expect(ownRows[1]!.accountCounts).toEqual({ total: 0, UNPROVED: 0, PENDING: 0, VERIFIED: 0, REJECTED: 0, REVOKED: 0 });
  expect(ownRows[2]!.accountCounts.VERIFIED).toBe(2);
  expect(ownRows[0]!.countryCode).toBe("SA"); expect(ownRows[0]!.cityLabel).toBe(f.cities[0]);
  expect(ownRows[1]!.countryCode).toBeNull(); expect(ownRows[1]!.cityLabel).toBe(f.cities[1]);
  expect(ownRows[2]!.countryCode).toBe("SA"); expect(ownRows[2]!.cityLabel).toBeNull();
  expect((await page.request.get("/api/admin/providers")).status()).toBe(410);
  await page.goto(f.url);
  await expect(page.getByRole("heading", { name: label("إدارة المؤثرين", "Creators management"), exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", english ? "ltr" : "rtl");
  for (const [i, creator] of ownRows.entries()) {
    await expect(rowFor(page, creator!.id).getByText(f.names[i], { exact: true })).toHaveCount(1);
    await expect(rowFor(page, creator!.id)).toContainText(f.handles[i]);
    await expectCounts(page, creator!);
    await expect(rowFor(page, creator!.id).getByRole("button")).toHaveCount(0);
    await expect(rowFor(page, creator!.id).getByRole("link", { name: label("مراجعة الإثباتات", "Review evidence"), exact: true })).toHaveCount(1);
    await expect(rowFor(page, creator!.id).getByRole("link")).toHaveAttribute("href", "/admin/evidence");
  }
  await expect(rowFor(page, f.ids[0]).getByText(f.cities[0], { exact: true })).toHaveCount(1);
  await expect(rowFor(page, f.ids[1]).getByText(f.cities[1], { exact: true })).toHaveCount(1);
  await expect(rowFor(page, f.ids[2])).toContainText(label("غير معروفة", "Unknown"));
  const visibleText = await page.locator("main").innerText();
  for (const value of ["private-biography-sentinel", "private-facts-sentinel", "private-proof-sentinel", "777777"]) expect(visibleText.includes(value)).toBe(false);
  const avatar = rowFor(page, f.ids[0]).locator("[data-admin-avatar]");
  await expect(avatar).toHaveAttribute("aria-hidden", "true");
  expect(await avatar.evaluate(element => {
    const style = getComputedStyle(element);
    return { width: style.width, height: style.height, radius: style.borderRadius };
  })).toEqual({ width: "34px", height: "34px", radius: "10px" });
  await expect(page.locator("main").getByRole("button", { name: /^(Approve|Reject|اعتماد|رفض)$/ })).toHaveCount(0);
  const refresh = page.getByRole("button", { name: label("تحديث البيانات", "Refresh data"), exact: true });
  await refresh.focus(); await expect(refresh).toBeFocused();
  await page.getByRole("button", { name: english ? "Switch to Arabic" : "التبديل إلى الإنجليزية", exact: true }).click();
  await expect(rowFor(page, f.ids[0]).getByText(f.names[0], { exact: true })).toHaveCount(1);
  await expect(rowFor(page, f.ids[0]).getByText(f.cities[0], { exact: true })).toHaveCount(1);
  await expectCounts(page, ownRows[0]!);
  await page.getByRole("button", { name: english ? "التبديل إلى الإنجليزية" : "Switch to Arabic", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  mkdirSync(path.join(workspace, ".infame", "artifacts"), { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(workspace, ".infame", "artifacts", `${info.project.name}-admin-original-creators.png`), fullPage: true });
  if (english) {
    await page.setViewportSize({ width: 360, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expectCounts(page, ownRows[0]!);
    await page.screenshot({ path: path.join(workspace, ".infame", "artifacts", `${info.project.name}-admin-original-creators-360.png`), fullPage: true });
  }
  const review = rowFor(page, f.ids[0]).getByRole("link", { name: label("مراجعة الإثباتات", "Review evidence"), exact: true });
  await review.focus(); await expect(review).toBeFocused(); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/evidence$/);
  await expect(page.getByRole("heading", { name: label("مراجعة الإثباتات", "Evidence review"), exact: true })).toBeVisible();
});

test("actual creator refresh is single-flight, retains transient snapshots and clears private rows before malformed denials", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop", label = (ar: string, en: string) => english ? en : ar, f = await setup(english, 31);
  const actor = await f.session(context, f.target.reviewerId); await page.goto(f.url);
  const row = rowFor(page, f.ids[0]), initialTime = await currentTime(page).getAttribute("datetime"), changedName = "اسم أصلي محدث من قاعدة البيانات";
  await expect(row.getByText(f.names[0], { exact: true })).toHaveCount(1);
  await db.creator.update({ where: { id: f.ids[0] }, data: { displayName: changedName } });
  await db.socialAccount.create({ data: { creatorId: f.ids[0], platform: "X", handle: `extra_${randomUUID()}`, ownershipStatus: "REVOKED" } });
  let release!: () => void, requests = 0, actualReady = false, asOf = "";
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route(listEndpoint, async route => {
    requests++;
    const actual = await route.fetch(); expect(actual.status()).toBe(200);
    const parsed = AdminCreatorsSchema.safeParse((await actual.json()).data);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("Invalid delayed actual creator DTO");
    asOf = parsed.data.asOf; actualReady = true;
    await waiting; await route.fulfill({ response: actual });
  });
  try {
    await page.getByRole("button", { name: label("تحديث البيانات", "Refresh data"), exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect.poll(() => actualReady).toBe(true); expect(requests).toBe(1);
    await expect(row.getByText(f.names[0], { exact: true })).toHaveCount(1);
    await expect(row.locator('[data-account-count="total"]')).toHaveText("5");
    await expect(currentTime(page)).toHaveAttribute("datetime", initialTime!);
    await expect(page.getByRole("button", { name: label("جارٍ تحميل البيانات…", "Loading data…"), exact: true })).toBeDisabled();
    await expect(page.getByRole("link", { name: label("الصفحة التالية", "Next page"), exact: true })).toHaveAttribute("aria-disabled", "true");
    release();
    await expect(row.getByText(changedName, { exact: true })).toHaveCount(1);
    await expect(row.locator('[data-account-count="total"]')).toHaveText("6");
    await expect(row.locator('[data-ownership-status="REVOKED"] bdi')).toHaveText("2");
    await expect(currentTime(page)).toHaveAttribute("datetime", asOf);
  } finally { release(); await page.unroute(listEndpoint); }
  let snapshot = await currentTime(page).getAttribute("datetime");
  for (const [status, body] of [[503, JSON.stringify({ error: { code: "RETRY_REQUIRED" } })], [200, JSON.stringify({ data: { invented: true } })]] as const) {
    // Only failures are injected; every accepted snapshot is a real native GET.
    await page.route(listEndpoint, route => route.fulfill({ status, contentType: "application/json", body }));
    const negative = page.waitForResponse(response => listEndpoint(new URL(response.url())) && response.status() === status);
    await page.getByRole("button", { name: label("تحديث البيانات", "Refresh data"), exact: true }).click(); await negative;
    await expect(page.locator("main").getByRole("alert")).toBeVisible();
    await expect(row.getByText(changedName, { exact: true })).toHaveCount(1);
    await expect(row.locator('[data-account-count="total"]')).toHaveText("6");
    await expect(currentTime(page)).toHaveAttribute("datetime", snapshot!);
    await page.unroute(listEndpoint);
    const recovery = page.waitForResponse(response => listEndpoint(new URL(response.url())) && response.status() === 200);
    await page.getByRole("button", { name: label("إعادة المحاولة", "Retry"), exact: true }).click(); await recovery;
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    snapshot = await currentTime(page).getAttribute("datetime");
  }
  for (const status of [401, 403]) {
    await page.route(listEndpoint, route => route.fulfill({ status, contentType: "application/json", body: "invalid-json" }));
    const negative = page.waitForResponse(response => listEndpoint(new URL(response.url())) && response.status() === status);
    await page.getByRole("button", { name: label("تحديث البيانات", "Refresh data"), exact: true }).click(); await negative;
    await expect(page.locator("main").getByRole("alert")).toBeVisible();
    await expect(page.locator("[data-admin-creator]")).toHaveCount(0); await expect(currentTime(page)).toHaveCount(0);
    await expect(page.locator("main").getByText(changedName, { exact: true })).toHaveCount(0);
    await page.unroute(listEndpoint);
    const recovery = page.waitForResponse(response => listEndpoint(new URL(response.url())) && response.status() === 200);
    await page.getByRole("button", { name: label("إعادة المحاولة", "Retry"), exact: true }).click(); await recovery;
    await expect(page.locator("[data-admin-creator]")).toHaveCount(30);
    await expect(row.getByText(changedName, { exact: true })).toHaveCount(1);
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  }
  await db.authSession.update({ where: { id: actor.sessionId }, data: { revokedAt: new Date() } });
  const denied = page.waitForResponse(response => listEndpoint(new URL(response.url())) && response.status() === 401);
  await page.getByRole("button", { name: label("تحديث البيانات", "Refresh data"), exact: true }).click();
  expect((await denied).headers()["cache-control"]).toBe("private, no-store");
  await expect(page.locator("[data-admin-creator]")).toHaveCount(0); await expect(currentTime(page)).toHaveCount(0);
  await expect(page.locator("main").getByText(changedName, { exact: true })).toHaveCount(0);
  expect((await context.cookies()).some(cookie => cookie.name === SESSION_COOKIE)).toBe(true);
});

test("actual canonical creator pagination is exclusive and remounts literal-first and genuine empty pages", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop", label = (ar: string, en: string) => english ? en : ar, f = await setup(english, 35);
  await f.session(context, f.target.reviewerId);
  const first = await actualList(page, f.api); expect(first.creators).toHaveLength(30); expect(first.nextCursor !== null).toBe(true);
  const second = await actualList(page, `/api/admin/creators?${new URLSearchParams({ after: first.nextCursor! })}`);
  expect(second.creators.map(row => row.id)).toEqual((await db.creator.findMany({ where: { id: { gt: first.nextCursor! } }, orderBy: { id: "asc" }, take: 30, select: { id: true } })).map(row => row.id));
  expect(second.creators.every(row => !first.creators.some(previous => previous.id === row.id))).toBe(true);
  await page.goto(f.url); await expect.poll(() => renderedIds(page)).toEqual(first.creators.map(row => row.id));
  await page.getByRole("link", { name: label("الصفحة التالية", "Next page"), exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("after")).toBe(first.nextCursor);
  await expect.poll(() => renderedIds(page)).toEqual(second.creators.map(row => row.id));
  await page.getByRole("link", { name: label("الصفحة الأولى", "First page"), exact: true }).click(); await expect(page).toHaveURL(/\/admin\/providers$/);
  const beginning = await actualList(page, "/api/admin/creators");
  await expect.poll(() => renderedIds(page)).toEqual(beginning.creators.map(row => row.id));
  await page.goto("/admin/providers?after=first");
  const literalCursor = await actualList(page, "/api/admin/creators?after=first");
  expect(beginning.creators.some(row => row.id === f.ids[0])).toBe(true);
  expect(literalCursor.creators.some(row => row.id === f.ids[0])).toBe(false);
  await expect.poll(() => renderedIds(page)).toEqual(literalCursor.creators.map(row => row.id));
  await page.getByRole("link", { name: label("الصفحة الأولى", "First page"), exact: true }).click(); await expect(page).toHaveURL(/\/admin\/providers$/);
  await expect.poll(() => renderedIds(page)).toEqual(beginning.creators.map(row => row.id));
  const last = await db.creator.findFirstOrThrow({ orderBy: { id: "desc" }, select: { id: true } });
  const query = new URLSearchParams({ after: last.id }).toString(), empty = await actualList(page, `/api/admin/creators?${query}`);
  expect(empty.creators).toHaveLength(0); expect(empty.nextCursor).toBeNull();
  await page.goto(`/admin/providers?${query}`); await expect(page.locator("[data-admin-creator]")).toHaveCount(0);
  await expect(page.getByText(label("لا يوجد مؤثرون في هذه الصفحة.", "No creators on this page."), { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: label("الصفحة التالية", "Next page"), exact: true })).toBeDisabled();
});
