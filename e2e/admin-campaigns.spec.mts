import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { assertLocalTarget, taskState, workspace } from "../scripts/task-state.mjs";
import { prisma as db } from "../src/lib/prisma";
import { authenticate, openSession, resolveSession } from "../src/lib/identity";
import { SESSION_COOKIE } from "../src/lib/jwt";
import { AdminCampaignsSchema } from "../src/lib/admin/contracts";
import { CampaignStatusSchema } from "../src/lib/contracts/vocabulary";
import { cleanup, fixture } from "../tests/deals/fixtures";

const state = taskState(), listEndpoint = (url: URL) => url.pathname === "/api/admin/campaigns";
if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("Campaign browser acceptance requires the exact isolated E2E target");
test.beforeAll(async () => {
  const rows = await db.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id, kind, current_database() AS db, host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0].id !== state.id || rows[0].kind !== "e2e" || rows[0].db !== state.targets.e2e || rows[0].host !== "127.0.0.1") throw new Error("Incorrect campaign browser database identity");
});
test.afterEach(cleanup);
test.afterAll(async () => { await db.$disconnect(); });

async function setup(english: boolean, extra = 0) {
  const f = await fixture(2, "10001", { now: new Date(), target: "e2e" });
  const password = `Synthetic campaign admin ${randomUUID()}`, language = english ? "en" : "ar", prefix = `000-admin-campaigns-${randomUUID()}`;
  const brandName = `اسم العلامة الأصلي Browser ${"طويل ".repeat(20)}`;
  await db.brand.update({ where: { id: f.brandId }, data: { name: brandName } });
  await db.user.updateMany({ where: { id: { in: [f.brandUserId, f.target.userId, f.target.reviewerId] } }, data: { passwordHash: await bcrypt.hash(password, 12), language } });
  const titles = ["عنوان الحملة الأصلي Browser " + "طويل ".repeat(20), "حملة الين الأصلية", "ميزانية غير معروفة", "اقتراح خاص ليس ميزانية محفوظة"];
  const budgets = [{ amountMinor: "9223372036854775807", currencyCode: "KWD" }, { amountMinor: "12345", currencyCode: "JPY" }, null, null];
  const ids = Array.from({ length: 4 + extra }, (_, i) => `${prefix}-${String(i).padStart(3, "0")}`);
  for (const [i, id] of ids.entries()) await db.campaign.create({ data: {
    id, brandId: f.brandId, title: titles[i] ?? `حملة اختبار ${i}`, status: CampaignStatusSchema.options[i % 7],
    input: { schemaVersion: 1, fieldsRevision: 1, fields: budgets[i] ? { budget: budgets[i] } : {},
      proposals: [{ private: "private-proposal-sentinel", budget: { amountMinor: "999999", currencyCode: "SAR" } }], clarificationCount: 0 },
    conversation: [{ private: "private-conversation-sentinel" }],
  } });
  const session = async (context: BrowserContext, id: string) => {
    const saved = await db.user.findUniqueOrThrow({ where: { id } });
    const user = await authenticate(saved.email, password);
    if (!user) throw new Error("Synthetic native authentication failed");
    const token = await openSession(user.id, user.sessionVersion, user.passwordHash), actor = await resolveSession(token);
    if (!actor) throw new Error("Synthetic native session resolution failed");
    await context.addCookies([{ name: SESSION_COOKIE, value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }, { name: "infame_lang", value: language, domain: "localhost", path: "/" }]);
    return actor;
  };
  const query = new URLSearchParams({ after: prefix }).toString();
  return { ...f, prefix, ids, titles, brandName, session, api: `/api/admin/campaigns?${query}`, url: `/admin/projects?${query}` };
}
const rowFor = (page: Page, id: string) => page.locator(`[data-admin-campaign="${id}"]`);
const currentTime = (page: Page) => page.locator("main header time");
async function actualList(page: Page, api: string) {
  const response = await page.request.get(api);
  expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toBe("private, no-store");
  const parsed = AdminCampaignsSchema.safeParse((await response.json()).data);
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error("Invalid actual canonical campaign DTO");
  return parsed.data;
}

test("original admin campaign rows retain original content, exact money and honest unknown metadata", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop", label = (ar: string, en: string) => english ? en : ar, f = await setup(english);
  const denied = await page.request.get(f.api); expect(denied.status()).toBe(401); expect(denied.headers()["cache-control"]).toBe("private, no-store");
  for (const id of [f.brandUserId, f.target.userId]) { await f.session(context, id); expect((await page.request.get(f.api)).status()).toBe(403); }
  const actor = await f.session(context, f.target.reviewerId), actual = await actualList(page, f.api);
  expect(actual.scope).toBe("ALL_STORED_RECORDS");
  for (const value of [actor.sessionId, actor.email, "private-proposal-sentinel", "private-conversation-sentinel", "passwordHash", "999999"]) expect(JSON.stringify(actual).includes(value)).toBe(false);
  expect(actual.campaigns.find(row => row.id === f.ids[0])?.budget).toEqual({ amountMinor: "9223372036854775807", currencyCode: "KWD" });
  expect(actual.campaigns.find(row => row.id === f.ids[2])?.budget).toBeNull();
  expect((await page.request.get("/api/admin/projects")).status()).toBe(410);
  await page.goto(f.url);
  await expect(page.getByRole("heading", { name: label("إدارة الحملات", "Campaigns management"), exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", english ? "ltr" : "rtl");
  const row = rowFor(page, f.ids[0]);
  const readableAmount = async () => expect(await row.locator('[data-budget-source="SAVED_INPUT"] bdi').evaluate((element, amount) => {
    const texts = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = texts.nextNode())) {
      const start = node.textContent?.indexOf(amount) ?? -1;
      if (start < 0) continue;
      const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + amount.length);
      return { found: range.toString() === amount, lines: new Set([...range.getClientRects()].filter(rect => rect.width > 0).map(rect => Math.round(rect.top))).size };
    }
    return { found: false, lines: 0 };
  }, "9223372036854775.807")).toEqual({ found: true, lines: 1 });
  await expect(row.getByText(f.titles[0], { exact: true })).toHaveCount(1);
  await expect(row.getByText(f.brandName, { exact: true })).toHaveCount(1);
  await expect(row).toContainText("9223372036854775.807 KWD");
  await expect(rowFor(page, f.ids[1])).toContainText("12345 JPY");
  await expect(rowFor(page, f.ids[2])).toContainText(label("غير متاحة", "Unavailable"));
  await expect(rowFor(page, f.ids[3])).not.toContainText("999999");
  await expect(row.locator("time")).toHaveAttribute("datetime", actual.campaigns.find(item => item.id === f.ids[0])!.createdAt);
  await expect(row.getByRole("button")).toHaveCount(0); await expect(row.getByRole("link")).toHaveCount(0);
  const refresh = page.getByRole("button", { name: label("تحديث البيانات", "Refresh data"), exact: true });
  await refresh.focus(); await expect(refresh).toBeFocused();
  await page.getByRole("button", { name: english ? "Switch to Arabic" : "التبديل إلى الإنجليزية", exact: true }).click();
  await expect(row.getByText(f.titles[0], { exact: true })).toHaveCount(1); await expect(row).toContainText("9223372036854775.807 KWD");
  await page.getByRole("button", { name: english ? "التبديل إلى الإنجليزية" : "Switch to Arabic", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await readableAmount();
  mkdirSync(path.join(workspace, ".infame", "artifacts"), { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(workspace, ".infame", "artifacts", `${info.project.name}-admin-original-campaigns.png`), fullPage: true });
  if (english) { await page.setViewportSize({ width: 360, height: 800 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await readableAmount(); await page.screenshot({ path: path.join(workspace, ".infame", "artifacts", `${info.project.name}-admin-original-campaigns-360.png`), fullPage: true }); }
});

test("actual campaign refresh progress retains failures and clears private snapshots before malformed denial parsing", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop", label = (ar: string, en: string) => english ? en : ar, f = await setup(english, 31);
  const actor = await f.session(context, f.target.reviewerId); await page.goto(f.url);
  const row = rowFor(page, f.ids[0]), initialTime = await currentTime(page).getAttribute("datetime");
  await db.campaign.update({ where: { id: f.ids[0] }, data: { revision: 2, input: { schemaVersion: 1, fieldsRevision: 2, fields: { budget: { amountMinor: "5001", currencyCode: "KWD" } } } } });
  let release!: () => void, requests = 0, actualReady = false, asOf = "";
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route(listEndpoint, async route => { requests++; const actual = await route.fetch(); expect(actual.status()).toBe(200); asOf = (await actual.json()).data.asOf; actualReady = true; await waiting; await route.fulfill({ response: actual }); });
  try {
    await page.getByRole("button", { name: label("تحديث البيانات", "Refresh data"), exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect.poll(() => actualReady).toBe(true); expect(requests).toBe(1);
    await expect(row).toContainText("9223372036854775.807 KWD"); await expect(currentTime(page)).toHaveAttribute("datetime", initialTime!);
    await expect(page.getByRole("button", { name: label("جارٍ تحميل البيانات…", "Loading data…"), exact: true })).toBeDisabled();
    await expect(page.getByRole("link", { name: label("الصفحة التالية", "Next page"), exact: true })).toHaveAttribute("aria-disabled", "true");
    release(); await expect(row).toContainText("5.001 KWD"); await expect(currentTime(page)).toHaveAttribute("datetime", asOf);
  } finally { release(); await page.unroute(listEndpoint); }
  let snapshot = await currentTime(page).getAttribute("datetime");
  for (const [status, body] of [[503, JSON.stringify({ error: { code: "RETRY_REQUIRED" } })], [200, JSON.stringify({ data: { invented: true } })]] as const) {
    // Explicit injected negative transport; positive reads use the actual server.
    await page.route(listEndpoint, route => route.fulfill({ status, contentType: "application/json", body }));
    const negative = page.waitForResponse(response => listEndpoint(new URL(response.url())) && response.status() === status);
    await page.getByRole("button", { name: label("تحديث البيانات", "Refresh data"), exact: true }).click();
    await negative;
    await expect(page.locator("main").getByRole("alert")).toBeVisible(); await expect(row).toContainText("5.001 KWD"); await expect(currentTime(page)).toHaveAttribute("datetime", snapshot!);
    await page.unroute(listEndpoint);
    const recovery = page.waitForResponse(response => listEndpoint(new URL(response.url())) && response.status() === 200);
    await page.getByRole("button", { name: label("إعادة المحاولة", "Retry"), exact: true }).click();
    await recovery;
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    snapshot = await currentTime(page).getAttribute("datetime");
  }
  for (const status of [401, 403]) {
    await page.route(listEndpoint, route => route.fulfill({ status, contentType: "application/json", body: "invalid-json" }));
    const negative = page.waitForResponse(response => listEndpoint(new URL(response.url())) && response.status() === status);
    await page.getByRole("button", { name: label("تحديث البيانات", "Refresh data"), exact: true }).click();
    await negative;
    await expect(page.locator("main").getByRole("alert")).toBeVisible(); await expect(page.locator("[data-admin-campaign]")).toHaveCount(0); await expect(currentTime(page)).toHaveCount(0);
    await page.unroute(listEndpoint);
    const recovery = page.waitForResponse(response => listEndpoint(new URL(response.url())) && response.status() === 200);
    await page.getByRole("button", { name: label("إعادة المحاولة", "Retry"), exact: true }).click();
    await recovery;
    await expect(page.locator("[data-admin-campaign]")).toHaveCount(30); await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  }
  await db.authSession.update({ where: { id: actor.sessionId }, data: { revokedAt: new Date() } });
  const denied = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/campaigns" && response.status() === 401);
  await page.getByRole("button", { name: label("تحديث البيانات", "Refresh data"), exact: true }).click();
  expect((await denied).headers()["cache-control"]).toBe("private, no-store");
  await expect(page.locator("[data-admin-campaign]")).toHaveCount(0); await expect(currentTime(page)).toHaveCount(0);
  expect((await context.cookies()).some(cookie => cookie.name === SESSION_COOKIE)).toBe(true);
});

test("actual canonical campaign cursor navigation remounts bounded rows and renders a genuine empty page", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop", label = (ar: string, en: string) => english ? en : ar, f = await setup(english, 35);
  await f.session(context, f.target.reviewerId);
  const first = await actualList(page, f.api); expect(first.campaigns).toHaveLength(30); expect(first.nextCursor !== null).toBe(true);
  const second = await actualList(page, `/api/admin/campaigns?${new URLSearchParams({ after: first.nextCursor! })}`);
  expect(second.campaigns.map(row => row.id)).toEqual((await db.campaign.findMany({ where: { id: { gt: first.nextCursor! } }, orderBy: { id: "asc" }, take: 30, select: { id: true } })).map(row => row.id));
  expect(second.campaigns.every(row => !first.campaigns.some(previous => previous.id === row.id))).toBe(true);
  await page.goto(f.url); await expect(page.locator("[data-admin-campaign]")).toHaveCount(30);
  await page.getByRole("link", { name: label("الصفحة التالية", "Next page"), exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("after")).toBe(first.nextCursor);
  await expect.poll(() => page.locator("[data-admin-campaign]").evaluateAll(elements => elements.map(element => element.getAttribute("data-admin-campaign")))).toEqual(second.campaigns.map(row => row.id));
  await page.getByRole("link", { name: label("الصفحة الأولى", "First page"), exact: true }).click(); await expect(page).toHaveURL(/\/admin\/projects$/);
  const beginning = await actualList(page, "/api/admin/campaigns");
  await expect.poll(() => page.locator("[data-admin-campaign]").evaluateAll(elements => elements.map(element => element.getAttribute("data-admin-campaign")))).toEqual(beginning.campaigns.map(row => row.id));
  // A valid cursor named "first" must not share the no-cursor screen identity.
  await page.goto("/admin/projects?after=first");
  const literalCursor = await actualList(page, "/api/admin/campaigns?after=first");
  expect(beginning.campaigns.some(row => row.id === f.ids[0])).toBe(true);
  expect(literalCursor.campaigns.some(row => row.id === f.ids[0])).toBe(false);
  await expect.poll(() => page.locator("[data-admin-campaign]").evaluateAll(elements => elements.map(element => element.getAttribute("data-admin-campaign")))).toEqual(literalCursor.campaigns.map(row => row.id));
  await page.getByRole("link", { name: label("الصفحة الأولى", "First page"), exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/projects$/);
  await expect.poll(() => page.locator("[data-admin-campaign]").evaluateAll(elements => elements.map(element => element.getAttribute("data-admin-campaign")))).toEqual(beginning.campaigns.map(row => row.id));
  const last = await db.campaign.findFirstOrThrow({ orderBy: { id: "desc" }, select: { id: true } });
  const query = new URLSearchParams({ after: last.id }).toString(), empty = await actualList(page, `/api/admin/campaigns?${query}`);
  expect(empty.campaigns).toHaveLength(0); expect(empty.nextCursor).toBeNull();
  await page.goto(`/admin/projects?${query}`); await expect(page.locator("[data-admin-campaign]")).toHaveCount(0);
  await expect(page.getByText(label("لا توجد حملات في هذه الصفحة.", "No campaigns on this page."), { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: label("الصفحة التالية", "Next page"), exact: true })).toBeDisabled();
});
