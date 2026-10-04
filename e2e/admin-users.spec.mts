import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { expect, test, type BrowserContext, type Locator, type Page, type Response } from "@playwright/test";
import { assertLocalTarget, taskState, workspace } from "../scripts/task-state.mjs";
import { prisma as db } from "../src/lib/prisma";
import { authenticate, openSession, resolveSession } from "../src/lib/identity";
import { SESSION_COOKIE } from "../src/lib/jwt";
import { AdminUsersSchema, AdminUserStatusCommandSchema, AdminUserStatusResultSchema } from "../src/lib/admin/contracts";
import { cleanup, fixture, users as fixtureUsers } from "../tests/deals/fixtures";

const state = taskState(), origin = "http://localhost:3100";
const usersEndpoint = (url: URL) => url.pathname === "/api/admin/users";
if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("Admin user browser acceptance requires the exact isolated E2E target");
test.setTimeout(60000);
test.beforeAll(async () => {
  const rows = await db.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id, kind, current_database() AS db, host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0].id !== state.id || rows[0].kind !== "e2e" || rows[0].db !== state.targets.e2e || rows[0].host !== "127.0.0.1") throw new Error("Incorrect admin user browser database identity");
});
test.afterEach(async () => {
  // Receipts have no FK cascade. Delete only this fixture module's tracked actors.
  await db.adminCommand.deleteMany({ where: { actorUserId: { in: fixtureUsers } } });
  await cleanup();
});
test.afterAll(async () => { await db.$disconnect(); });

async function setup(english: boolean, extra = 0) {
  const f = await fixture(2, "10001", { now: new Date(), target: "e2e" });
  const prefix = `000-admin-users-${randomUUID()}`, password = `Synthetic admin users ${randomUUID()}`;
  const adminId = `${prefix}-00-self`, targetId = `${prefix}-10-target`, otherAdminId = `${prefix}-20-admin`;
  const passwordHash = await bcrypt.hash(password, 12), language = english ? "en" : "ar";
  const ids = [adminId, targetId, otherAdminId, ...Array.from({ length: extra }, (_, index) => `${prefix}-30-page-${String(index).padStart(3, "0")}`)];
  fixtureUsers.push(...ids);
  // These are conspicuously synthetic stored user records in the guarded local
  // database. No role, access status or name here establishes live proof/traction.
  await db.user.createMany({ data: ids.map((id, index) => ({ id,
    name: index === 0 ? "Synthetic admin user reviewer" : index === 1 ? "اسم مستخدم أصلي Synthetic" : `Synthetic admin user ${index}`,
    nameEn: "Synthetic legacy alternate name MUST NOT replace original", email: `${id}@example.invalid`, passwordHash,
    role: index === 0 || index === 2 ? "ADMIN" : index % 2 ? "CREATOR" : "BRAND", language, isTest: true, emailVerifiedAt: new Date(),
  })) });
  await db.user.updateMany({ where: { id: { in: [f.brandUserId, f.target.userId, f.target.reviewerId] } }, data: { passwordHash, language } });
  const session = async (context: BrowserContext, id: string) => {
    const saved = await db.user.findUniqueOrThrow({ where: { id }, select: { email: true } });
    const user = await authenticate(saved.email, password);
    if (!user) throw new Error("Synthetic native authentication failed");
    const token = await openSession(user.id, user.sessionVersion, user.passwordHash);
    const actor = await resolveSession(token);
    if (!actor) throw new Error("Synthetic native session resolution failed");
    await context.addCookies([{ name: SESSION_COOKIE, value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
      { name: "infame_lang", value: language, domain: "localhost", path: "/" }]);
    return actor;
  };
  const query = new URLSearchParams({ after: prefix }).toString();
  return { ...f, prefix, adminId, targetId, otherAdminId, password, session, url: `/admin/users?${query}`, api: `/api/admin/users?${query}` };
}
const rowFor = (page: Page, id: string) => page.locator(`[data-admin-user="${id}"]`);
const statusCell = (row: Locator) => row.locator('[role="row"]').first().locator('[role="cell"]').nth(3);
const snapshotTime = (page: Page) => page.locator("main header time");
const listResponse = (response: Response) => new URL(response.url()).pathname === "/api/admin/users" && response.request().method() === "GET";
function statusResponse(id: string, status = 200) {
  return (response: Response) => new URL(response.url()).pathname === `/api/admin/users/${id}` && response.request().method() === "PATCH" && response.status() === status;
}
function statusCommand(active: boolean, version: number, text: string, language: string | null = "ar") {
  return AdminUserStatusCommandSchema.parse({ operationKey: randomUUID(), expectedActive: active, expectedVersion: version, active: !active, reason: { text, language } });
}
async function list(page: Page, api: string) {
  const response = await page.request.get(api);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  const body = await response.json();
  const parsed = AdminUsersSchema.safeParse(body.data);
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error("Invalid actual admin user DTO");
  return parsed.data;
}
async function fillReason(row: Locator, label: (ar: string, en: string) => string, reason: string, language = "ar") {
  await row.getByLabel(label("سبب تغيير الحالة", "Reason for status change"), { exact: true }).fill(reason);
  await row.getByLabel(label("لغة السبب (اختياري، BCP47)", "Reason language (optional, BCP47)"), { exact: true }).fill(language);
}
async function confirm(page: Page, row: Locator, id: string, label: (ar: string, en: string) => string, active: boolean) {
  const changed = page.waitForResponse(statusResponse(id));
  const refreshed = page.waitForResponse(response => listResponse(response) && response.status() === 200);
  await row.getByRole("button", { name: active ? label("تأكيد الإيقاف", "Confirm suspension") : label("تأكيد التفعيل", "Confirm activation"), exact: true }).click();
  const response = await changed;
  const parsed = AdminUserStatusResultSchema.safeParse((await response.json()).data);
  expect(parsed.success).toBe(true);
  await refreshed;
  await expect(row.locator("form")).toHaveCount(0);
  return parsed.success ? parsed.data : null;
}
async function effects(actorId: string, targetId: string) {
  return {
    receipts: await db.adminCommand.findMany({ where: { actorUserId: actorId, resourceId: targetId } }),
    audits: await db.adminAudit.findMany({ where: { actorUserId: actorId, resourceType: "User", resourceId: targetId, action: { in: ["account.suspended", "account.reactivated"] } } }),
    events: await db.outboxEvent.findMany({ where: { deduplicationKey: { startsWith: `admin-status:${actorId}:` } } }),
  };
}

test("original users composition uses bounded private original-name records and protects self/admin targets", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop", label = (ar: string, en: string) => english ? en : ar;
  const f = await setup(english), name = `اسم المستخدم الأصلي Browser ${"الطويل ".repeat(30)}`;
  const email = `synthetic_long_${"name".repeat(8)}${randomUUID().slice(0, 8)}@long-domain-${randomUUID().replaceAll("-", "")}.example.invalid`;
  await db.user.update({ where: { id: f.targetId }, data: { name, email } });
  const anonymous = await page.request.get(f.api);
  expect(anonymous.status()).toBe(401); expect(anonymous.headers()["cache-control"]).toBe("private, no-store");
  for (const id of [f.brandUserId, f.target.userId]) {
    await f.session(context, id);
    expect((await page.request.get(f.api)).status()).toBe(403);
  }
  const admin = await f.session(context, f.adminId), actual = await list(page, f.api);
  expect(actual.users.length).toBeLessThanOrEqual(30);
  expect(actual.users.map(user => user.id)).toEqual((await db.user.findMany({ where: { id: { gt: f.prefix } }, orderBy: { id: "asc" }, take: 30, select: { id: true } })).map(user => user.id));
  const target = actual.users.find(user => user.id === f.targetId)!;
  expect(Object.keys(target).sort()).toEqual(["active", "email", "id", "joined", "name", "role", "statusVersion"]);
  expect(target.name).toBe(name); expect(target.email).toBe(email);
  const encoded = JSON.stringify(actual);
  for (const value of [admin.sessionId, "passwordHash", "notificationPreferences", "Synthetic legacy alternate name MUST NOT replace original"]) expect(encoded.includes(value)).toBe(false);
  for (const id of [f.adminId, f.otherAdminId]) {
    const denied = await page.request.patch(`/api/admin/users/${id}`, { headers: { Origin: origin }, data: statusCommand(true, 1, "حماية الحساب الإداري") });
    expect(denied.status()).toBe(403); expect(denied.headers()["cache-control"]).toBe("private, no-store");
    expect((await denied.json()).error.code).toBe("PROTECTED_ACCOUNT");
  }
  expect(await db.adminCommand.count({ where: { actorUserId: f.adminId } })).toBe(0);
  await page.goto(f.url);
  await expect(page.getByRole("heading", { name: label("إدارة المستخدمين", "Users management"), exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", english ? "ltr" : "rtl");
  const row = rowFor(page, f.targetId);
  await expect(row.getByText(name, { exact: true })).toHaveCount(1);
  await expect(row.getByText(email, { exact: true })).toBeVisible();
  await expect(row.getByText(label("صانع محتوى", "Creator"), { exact: true })).toBeVisible();
  await expect(row.locator("time")).toHaveAttribute("datetime", target.joined);
  await expect(row.locator("time")).toHaveText(target.joined.slice(0, 10).replaceAll("-", "/"));
  await expect(rowFor(page, f.adminId).getByRole("button")).toHaveCount(0);
  await expect(rowFor(page, f.otherAdminId).getByRole("button")).toHaveCount(0);
  await expect(rowFor(page, f.adminId).getByText(label("حسابك", "Your account"), { exact: true })).toBeVisible();
  const opener = row.getByRole("button", { name: label("إيقاف", "Suspend"), exact: true });
  await opener.focus(); await expect(opener).toBeFocused(); await page.keyboard.press("Enter");
  await expect(opener).toHaveAttribute("aria-expanded", "true");
  await expect(row.getByRole("button", { name: label("تأكيد الإيقاف", "Confirm suspension"), exact: true })).toBeDisabled();
  const reason = row.getByLabel(label("سبب تغيير الحالة", "Reason for status change"), { exact: true });
  await reason.focus(); await expect(reason).toBeFocused(); await page.keyboard.type("سبب أصلي عبر لوحة المفاتيح");
  await expect(reason).toHaveValue("سبب أصلي عبر لوحة المفاتيح");
  await row.getByLabel(label("لغة السبب (اختياري، BCP47)", "Reason language (optional, BCP47)"), { exact: true }).fill("ar");
  await page.getByRole("button", { name: english ? "Switch to Arabic" : "التبديل إلى الإنجليزية", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", english ? "ar" : "en");
  await expect(row.getByText(name, { exact: true })).toHaveCount(1);
  await expect(row.getByLabel(english ? "سبب تغيير الحالة" : "Reason for status change", { exact: true })).toHaveValue("سبب أصلي عبر لوحة المفاتيح");
  await page.getByRole("button", { name: english ? "التبديل إلى الإنجليزية" : "Switch to Arabic", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", english ? "en" : "ar");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  mkdirSync(path.join(workspace, ".infame", "artifacts"), { recursive: true });
  await page.screenshot({ path: path.join(workspace, ".infame", "artifacts", `${info.project.name}-admin-original-users.png`), fullPage: true });
  if (english) {
    await page.setViewportSize({ width: 360, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(workspace, ".infame", "artifacts", `${info.project.name}-admin-original-users-360.png`), fullPage: true });
  }
});

test("actual delayed and lost committed status replies preserve exact replay and recover only after current reload", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop", label = (ar: string, en: string) => english ? en : ar;
  const f = await setup(english, 31); await f.session(context, f.adminId); await page.goto(f.url);
  const row = rowFor(page, f.targetId), reason = "  سبب أصلي للإيقاف، محفوظ مرة واحدة  ";
  await row.getByRole("button", { name: label("إيقاف", "Suspend"), exact: true }).click();
  await fillReason(row, label, reason);
  let release!: () => void, requests = 0, actualReady = false, firstBody = "";
  const waiting = new Promise<void>(resolve => { release = resolve; }), endpoint = `**/api/admin/users/${f.targetId}`;
  await page.route(endpoint, async route => {
    requests++; firstBody = route.request().postData()!;
    expect(route.request().headers()["origin"]).toBe(origin);
    const actual = await route.fetch(); expect(actual.status()).toBe(200);
    actualReady = true; await waiting; await route.fulfill({ response: actual });
  });
  try {
    await row.getByRole("button", { name: label("تأكيد الإيقاف", "Confirm suspension"), exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect.poll(() => actualReady).toBe(true); expect(requests).toBe(1);
    await expect(statusCell(row)).toHaveText(label("نشط", "Active"));
    await expect(row.getByLabel(label("سبب تغيير الحالة", "Reason for status change"), { exact: true })).toHaveValue(reason);
    await expect(row.getByLabel(label("سبب تغيير الحالة", "Reason for status change"), { exact: true })).toBeDisabled();
    await expect(page.getByRole("link", { name: label("الصفحة التالية", "Next page"), exact: true })).toHaveAttribute("aria-disabled", "true");
    const saved = await db.user.findUniqueOrThrow({ where: { id: f.targetId } });
    expect({ active: saved.active, version: saved.sessionVersion }).toEqual({ active: false, version: 2 });
    const refreshed = page.waitForResponse(response => listResponse(response) && response.status() === 200);
    release(); await refreshed;
    await expect(statusCell(row)).toHaveText(label("موقوف", "Suspended")); await expect(row.locator("form")).toHaveCount(0);
    expect(requests).toBe(1);
  } finally { release(); await page.unroute(endpoint); }
  let stateAfter = await effects(f.adminId, f.targetId);
  expect(stateAfter.receipts).toHaveLength(1); expect(stateAfter.events).toHaveLength(1); expect(stateAfter.audits).toHaveLength(1);
  expect(stateAfter.audits[0].snapshot).toMatchObject({ payload: { reason: { text: reason, language: "ar" } } });
  expect(JSON.stringify(stateAfter.events[0].payload).includes(reason)).toBe(false);
  expect(stateAfter.receipts[0].operationKey).toBe(JSON.parse(firstBody).operationKey);

  const activationReason = "  سبب تفعيل أصلي؛ لا ترجمة ولا استبدال  ";
  await row.getByRole("button", { name: label("تفعيل", "Activate"), exact: true }).click(); await fillReason(row, label, activationReason, "ar-KW");
  const oldTime = await snapshotTime(page).getAttribute("datetime"), bodies: string[] = [];
  let drop = true, replayed = false;
  await page.route(endpoint, async route => {
    bodies.push(route.request().postData()!);
    const actual = await route.fetch(); expect(actual.status()).toBe(200);
    const receipt = AdminUserStatusResultSchema.parse((await actual.json()).data);
    if (drop) { drop = false; await route.abort("failed"); }
    else { replayed = receipt.replayed; await route.fulfill({ response: actual }); }
  });
  try {
    await row.getByRole("button", { name: label("تأكيد التفعيل", "Confirm activation"), exact: true }).click();
    await expect(page.getByRole("button", { name: label("أعد نفس الطلب", "Retry the same request"), exact: true })).toBeEnabled();
    const actual = await db.user.findUniqueOrThrow({ where: { id: f.targetId } });
    expect({ active: actual.active, version: actual.sessionVersion }).toEqual({ active: true, version: 3 });
    await expect(statusCell(row)).toHaveText(label("موقوف", "Suspended"));
    await expect(row.getByLabel(label("سبب تغيير الحالة", "Reason for status change"), { exact: true })).toHaveValue(activationReason);
    await expect(row.getByLabel(label("لغة السبب (اختياري، BCP47)", "Reason language (optional, BCP47)"), { exact: true })).toHaveValue("ar-KW");
    // Injected negative read transport only; both PATCH calls execute the actual
    // server transaction. This does not claim real external availability.
    await page.route(usersEndpoint, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "RETRY_REQUIRED" } }) }));
    const retryReply = page.waitForResponse(statusResponse(f.targetId)), failedReload = page.waitForResponse(response => listResponse(response) && response.status() === 503);
    await page.getByRole("button", { name: label("أعد نفس الطلب", "Retry the same request"), exact: true }).click();
    await retryReply; await failedReload;
    await expect(page.getByRole("button", { name: label("تحديث البيانات", "Refresh data"), exact: true })).toBeEnabled();
    expect(bodies).toHaveLength(2); expect(bodies[0] === bodies[1]).toBe(true); expect(replayed).toBe(true);
    await expect(page.locator("main").getByRole("alert")).toContainText(label("تُعرض آخر قائمة محمّلة", "The last loaded list"));
    await expect(snapshotTime(page)).toHaveAttribute("datetime", oldTime!);
    await expect(statusCell(row)).toHaveText(label("موقوف", "Suspended"));
    await expect(row.getByLabel(label("سبب تغيير الحالة", "Reason for status change"), { exact: true })).toHaveValue(activationReason);
    await expect(row.getByLabel(label("سبب تغيير الحالة", "Reason for status change"), { exact: true })).toBeDisabled();
    await expect(row.getByRole("button", { name: label("تأكيد التفعيل", "Confirm activation"), exact: true })).toBeDisabled();
    await expect(page.getByRole("link", { name: label("الصفحة التالية", "Next page"), exact: true })).toHaveAttribute("aria-disabled", "true");
    const key = JSON.parse(bodies[0]).operationKey;
    expect(await db.adminCommand.count({ where: { actorUserId: f.adminId, operationKey: key } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { deduplicationKey: `admin-status:${f.adminId}:${key}` } })).toBe(1);
    await page.unroute(usersEndpoint);
    const recovered = page.waitForResponse(response => listResponse(response) && response.status() === 200);
    await page.getByRole("button", { name: label("تحديث البيانات", "Refresh data"), exact: true }).click(); await recovered;
    await expect(statusCell(row)).toHaveText(label("نشط", "Active")); await expect(row.locator("form")).toHaveCount(0);
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    expect(await snapshotTime(page).getAttribute("datetime")).not.toBe(oldTime);
    stateAfter = await effects(f.adminId, f.targetId);
    expect(stateAfter.receipts).toHaveLength(2); expect(stateAfter.events).toHaveLength(2); expect(stateAfter.audits).toHaveLength(2);
    expect(stateAfter.audits.find(audit => audit.action === "account.reactivated")!.snapshot).toMatchObject({ payload: { reason: { text: activationReason, language: "ar-KW" } } });
  } finally { await page.unroute(endpoint); await page.unroute(usersEndpoint); }
});

test("two actual tabs reject ABA status staleness, retain original input and require explicit current-version comparison", async ({ page, context, browser }, info) => {
  const english = info.project.name === "english-desktop", label = (ar: string, en: string) => english ? en : ar;
  const f = await setup(english), targetContext = await browser.newContext({ baseURL: origin }), stale = await context.newPage();
  try {
    await f.session(targetContext, f.targetId); expect((await targetContext.request.get("/api/me")).status()).toBe(200);
    await f.session(context, f.adminId); await page.goto(f.url); await stale.goto(f.url);
    const currentRow = rowFor(page, f.targetId), staleRow = rowFor(stale, f.targetId), oldReason = "  سبب النسخة القديمة الأصلي بعد تغييرين  ";
    await staleRow.getByRole("button", { name: label("إيقاف", "Suspend"), exact: true }).click(); await fillReason(staleRow, label, oldReason, "ar-KW");
    await currentRow.getByRole("button", { name: label("إيقاف", "Suspend"), exact: true }).click(); await fillReason(currentRow, label, "إيقاف فعلي من التبويب الحالي");
    expect((await confirm(page, currentRow, f.targetId, label, true))?.statusVersion).toBe(2);
    expect((await targetContext.request.get("/api/me")).status()).toBe(401);
    const target = await db.user.findUniqueOrThrow({ where: { id: f.targetId } });
    expect(await authenticate(target.email, f.password) === null).toBe(true);
    await currentRow.getByRole("button", { name: label("تفعيل", "Activate"), exact: true }).click(); await fillReason(currentRow, label, "تفعيل فعلي بعد الإيقاف");
    expect((await confirm(page, currentRow, f.targetId, label, false))?.statusVersion).toBe(3);
    expect((await targetContext.request.get("/api/me")).status()).toBe(401); // Reactivation cannot revive the old signed cookie.
    const fresh = await f.session(targetContext, f.targetId);
    expect(fresh.sessionVersion).toBe(3); expect((await targetContext.request.get("/api/me")).status()).toBe(200);
    const rejected = stale.waitForResponse(statusResponse(f.targetId, 409));
    await staleRow.getByRole("button", { name: label("تأكيد الإيقاف", "Confirm suspension"), exact: true }).click();
    expect((await (await rejected).json()).error.code).toBe("STALE_VERSION");
    await expect(stale.locator("main").getByRole("alert")).toContainText(label("تغيرت حالة المستخدم أو نسخته", "The user's status or version changed"));
    await expect(staleRow.getByLabel(label("سبب تغيير الحالة", "Reason for status change"), { exact: true })).toHaveValue(oldReason);
    await expect(staleRow.getByLabel(label("لغة السبب (اختياري، BCP47)", "Reason language (optional, BCP47)"), { exact: true })).toHaveValue("ar-KW");
    await expect(staleRow.getByRole("button", { name: label("استخدم النسخة الحالية", "Use current version"), exact: true })).toBeDisabled();
    const before = await effects(f.adminId, f.targetId); expect(before.receipts).toHaveLength(2); expect(before.events).toHaveLength(2);
    const reloaded = stale.waitForResponse(response => listResponse(response) && response.status() === 200);
    await stale.getByRole("button", { name: label("تحديث البيانات", "Refresh data"), exact: true }).click(); await reloaded;
    await expect(staleRow.locator("form p").first().locator("bdi")).toHaveText("1");
    await expect(staleRow.getByRole("button", { name: label("تأكيد الإيقاف", "Confirm suspension"), exact: true })).toBeDisabled();
    await staleRow.getByRole("button", { name: label("استخدم النسخة الحالية", "Use current version"), exact: true }).click();
    await expect(staleRow.locator("form p").first().locator("bdi")).toHaveText("3");
    await expect(staleRow.getByLabel(label("سبب تغيير الحالة", "Reason for status change"), { exact: true })).toHaveValue(oldReason);
    await expect(staleRow.getByLabel(label("لغة السبب (اختياري، BCP47)", "Reason language (optional, BCP47)"), { exact: true })).toHaveValue("ar-KW");
    expect(await db.adminCommand.count({ where: { actorUserId: f.adminId } })).toBe(2); // Comparison is not a mutation.
    expect((await confirm(stale, staleRow, f.targetId, label, true))?.statusVersion).toBe(4);
    const saved = await db.user.findUniqueOrThrow({ where: { id: f.targetId } });
    expect({ active: saved.active, version: saved.sessionVersion }).toEqual({ active: false, version: 4 });
    const after = await effects(f.adminId, f.targetId); expect(after.receipts).toHaveLength(3); expect(after.events).toHaveLength(3); expect(after.audits).toHaveLength(3);
    expect(after.audits.some(audit => JSON.stringify(audit.snapshot).includes(oldReason))).toBe(true);
    expect(after.events.some(event => JSON.stringify(event.payload).includes(oldReason))).toBe(false);
    expect((await targetContext.request.get("/api/me")).status()).toBe(401);
  } finally { await stale.close(); await targetContext.close(); }
});

test("actual bounded cursor navigation remounts SSR data and authoritative denial clears private rows before parsing", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop", label = (ar: string, en: string) => english ? en : ar;
  const f = await setup(english, 35), admin = await f.session(context, f.adminId);
  const first = await list(page, f.api); expect(first.users).toHaveLength(30); expect(first.nextCursor !== null).toBe(true);
  const second = await list(page, `/api/admin/users?${new URLSearchParams({ after: first.nextCursor! })}`);
  expect(second.users.map(user => user.id)).toEqual((await db.user.findMany({ where: { id: { gt: first.nextCursor! } }, orderBy: { id: "asc" }, take: 30, select: { id: true } })).map(user => user.id));
  expect(second.users.every(user => !first.users.some(previous => previous.id === user.id))).toBe(true);
  await page.goto(f.url);
  await expect(page.locator("[data-admin-user]")).toHaveCount(30);
  await page.getByRole("link", { name: label("الصفحة التالية", "Next page"), exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("after")).toBe(first.nextCursor);
  await expect.poll(() => page.locator("[data-admin-user]").evaluateAll(elements => elements.map(element => element.getAttribute("data-admin-user")))).toEqual(second.users.map(user => user.id));
  await page.getByRole("link", { name: label("الصفحة الأولى", "First page"), exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  const beginning = await list(page, "/api/admin/users");
  await expect.poll(() => page.locator("[data-admin-user]").evaluateAll(elements => elements.map(element => element.getAttribute("data-admin-user")))).toEqual(beginning.users.map(user => user.id));
  const empty = await list(page, "/api/admin/users?after=~~~~"); expect(empty.users).toHaveLength(0); expect(empty.nextCursor).toBeNull();
  await page.goto("/admin/users?after=~~~~");
  await expect(page.getByText(label("لا يوجد مستخدمون في هذه الصفحة.", "No users on this page."), { exact: true })).toBeVisible();
  await expect(page.locator("[data-admin-user]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: label("الصفحة التالية", "Next page"), exact: true })).toBeDisabled();
  await page.goto(f.url);
  for (const status of [401, 403]) {
    // Explicit malformed negative transport fixture, not a real authorization result.
    await page.route(usersEndpoint, route => route.fulfill({ status, contentType: "application/json", body: "invalid-json" }));
    await page.getByRole("button", { name: label("تحديث البيانات", "Refresh data"), exact: true }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText(status === 401 ? label("انتهت الجلسة", "Your session ended") : label("هذا الإجراء غير متاح لصلاحيتك الحالية", "This action is unavailable for your current permissions"));
    await expect(page.locator("[data-admin-user]")).toHaveCount(0); await expect(snapshotTime(page)).toHaveCount(0);
    await page.unroute(usersEndpoint);
    const recovered = page.waitForResponse(response => listResponse(response) && response.status() === 200);
    await page.getByRole("button", { name: label("تحديث البيانات", "Refresh data"), exact: true }).click(); await recovered;
    await expect(page.locator("[data-admin-user]")).toHaveCount(30); await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  }
  for (const status of [401, 403]) {
    // Negative mutation denial fixture: no native transaction is executed here.
    const row = rowFor(page, f.targetId), endpoint = `**/api/admin/users/${f.targetId}`;
    if (await row.locator("form").count() === 0) await row.getByRole("button", { name: label("إيقاف", "Suspend"), exact: true }).click();
    await fillReason(row, label, "سبب أصلي باقٍ عند رفض الوصول");
    await page.route(endpoint, route => route.fulfill({ status, contentType: "application/json", body: "invalid-json" }));
    await row.getByRole("button", { name: label("تأكيد الإيقاف", "Confirm suspension"), exact: true }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText(status === 401 ? label("انتهت الجلسة", "Your session ended") : label("هذا الإجراء غير متاح لصلاحيتك الحالية", "This action is unavailable for your current permissions"));
    await expect(page.locator("[data-admin-user]")).toHaveCount(0); await expect(snapshotTime(page)).toHaveCount(0);
    await page.unroute(endpoint);
    const recovered = page.waitForResponse(response => listResponse(response) && response.status() === 200);
    await page.getByRole("button", { name: label("تحديث البيانات", "Refresh data"), exact: true }).click(); await recovered;
    await expect(row.getByLabel(label("سبب تغيير الحالة", "Reason for status change"), { exact: true })).toHaveValue("سبب أصلي باقٍ عند رفض الوصول");
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  }
  expect(await db.adminCommand.count({ where: { actorUserId: f.adminId } })).toBe(0);
  await db.authSession.update({ where: { id: admin.sessionId }, data: { revokedAt: new Date() } });
  const denied = page.waitForResponse(response => listResponse(response) && response.status() === 401);
  await page.getByRole("button", { name: label("تحديث البيانات", "Refresh data"), exact: true }).click();
  expect((await denied).headers()["cache-control"]).toBe("private, no-store");
  await expect(page.locator("main").getByRole("alert")).toContainText(label("انتهت الجلسة", "Your session ended"));
  await expect(page.locator("[data-admin-user]")).toHaveCount(0); await expect(snapshotTime(page)).toHaveCount(0);
  expect((await context.cookies()).some(cookie => cookie.name === SESSION_COOKIE)).toBe(true); // Actual DB revocation beats the still-present signed cookie.
});
