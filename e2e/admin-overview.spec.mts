import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { expect, test, type BrowserContext } from "@playwright/test";
import { assertLocalTarget, taskState, workspace } from "../scripts/task-state.mjs";
import { prisma as db } from "../src/lib/prisma";
import { authenticate, openSession, resolveSession } from "../src/lib/identity";
import { SESSION_COOKIE } from "../src/lib/jwt";
import { AdminOverviewSchema } from "../src/lib/admin/contracts";
import { createOwnershipChallenge, uploadPrivateAsset, submitOwnershipProof } from "../src/lib/evidence/service";
import { createLocalEvidenceStorage } from "../src/lib/evidence/storage";
import { cleanup, fixture } from "../tests/deals/fixtures";

const state = taskState();
if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("Admin browser acceptance requires the exact isolated E2E target");
test.beforeAll(async () => {
  const rows = await db.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id, kind, current_database() AS db, host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0].id !== state.id || rows[0].kind !== "e2e" || rows[0].db !== state.targets.e2e || rows[0].host !== "127.0.0.1") throw new Error("Incorrect admin browser database identity");
});
test.afterEach(cleanup);
test.afterAll(async () => { await db.$disconnect(); });
async function setup(english: boolean) {
  const f = await fixture(2, "10001", { now: new Date(), target: "e2e" });
  const password = `Synthetic admin ${randomUUID()}`;
  await db.user.updateMany({ where: { id: { in: [f.brandUserId, f.target.userId, f.target.reviewerId] } }, data: { passwordHash: await bcrypt.hash(password, 12), language: english ? "en" : "ar" } });
  const users = await db.user.findMany({ where: { id: { in: [f.brandUserId, f.target.userId, f.target.reviewerId] } } });
  const session = async (context: BrowserContext, id: string) => {
    const user = await authenticate(users.find(row => row.id === id)!.email, password);
    if (!user) throw new Error("Synthetic native authentication failed");
    const token = await openSession(user.id, user.sessionVersion, user.passwordHash);
    const actor = await resolveSession(token);
    if (!actor) throw new Error("Synthetic native session resolution failed");
    await context.addCookies([{ name: SESSION_COOKIE, value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }, { name: "infame_lang", value: english ? "en" : "ar", domain: "localhost", path: "/" }]);
    return actor;
  };
  return { ...f, session };
}
async function pendingOwnership(f: Awaited<ReturnType<typeof setup>>, context: BrowserContext) {
  const owner = await f.session(context, f.target.userId);
  const account = await db.socialAccount.findUniqueOrThrow({ where: { id: f.target.accountId } });
  const options = { serverAuth: { userId: owner.userId, role: owner.role, sessionId: owner.sessionId, sessionVersion: owner.sessionVersion }, storage: await createLocalEvidenceStorage({ taskId: state.id, target: "e2e" }) };
  const challenge = (await createOwnershipChallenge(owner.userId, { operationKey: randomUUID(), accountId: account.id, expectedMappingRevision: account.mappingRevision, expectedEvidenceRevision: account.evidenceRevision }, options)).challenge;
  // Genuine local upload/submission over explicitly synthetic bytes/actors.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1kAAAAASUVORK5CYII=", "base64");
  const proof = (await uploadPrivateAsset(owner.userId, { operationKey: randomUUID(), purpose: "OWNERSHIP_PROOF", contentType: "image/png", bytes: png }, options)).asset;
  await submitOwnershipProof(owner.userId, challenge.id, { operationKey: randomUUID(), expectedRevision: challenge.revision, assetId: proof.id }, options);
  return { challenge, proof, owner };
}

test("original admin overview shows actual canonical counts and bounded private-safe review metadata", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop", label = (ar: string, en: string) => english ? en : ar;
  const f = await setup(english), submitted = await pendingOwnership(f, context);
  await context.clearCookies();
  const anonymous = await page.request.get("/api/admin/overview");
  expect(anonymous.status()).toBe(401);
  expect(anonymous.headers()["cache-control"]).toBe("private, no-store");
  await f.session(context, f.brandUserId);
  expect((await page.request.get("/api/admin/overview")).status()).toBe(403);
  const admin = await f.session(context, f.target.reviewerId);
  const account = await db.socialAccount.create({ data: { creatorId: f.target.id, platform: "INSTAGRAM", handle: `synthetic_${"long_handle_".repeat(12)}` } });
  const started = await db.ownershipChallenge.create({ data: { accountId: account.id, ownerUserId: f.target.userId, identity: { fixture: "private-identity-sentinel" }, identityHash: "c".repeat(64), mappingRevision: 1, challengeCode: "private-nonce-sentinel", expiresAt: new Date(Date.now() + 86400000) } });
  const response = await page.request.get("/api/admin/overview");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  const body = await response.json();
  expect(AdminOverviewSchema.safeParse(body.data).success).toBe(true);
  expect(body.data.counts.users).toBe(await db.user.count());
  expect(body.data.counts.brandAccounts).toBe(await db.user.count({ where: { role: "BRAND" } }));
  expect(body.data.counts.creatorAccounts).toBe(await db.user.count({ where: { role: "CREATOR" } }));
  expect(body.data.counts.campaigns).toBe(await db.campaign.count());
  expect(body.data.counts.briefVersions).toBe(await db.campaignBrief.count());
  expect(body.data.counts.deals).toBe(await db.deal.count());
  const encoded = JSON.stringify(body);
  for (const value of [submitted.challenge.challengeCode, submitted.proof.id, admin.sessionId, admin.email, "private-identity-sentinel", "private-nonce-sentinel"]) expect(encoded.includes(value)).toBe(false);
  const expectedPreview = await db.ownershipChallenge.findMany({ where: { status: "PENDING" }, orderBy: { id: "asc" }, take: 8 });
  expect(body.data.ownershipPreview.map((row: { id: string }) => row.id)).toEqual(expectedPreview.map(row => row.id));
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: label("نظرة عامة للإدارة", "Admin overview"), exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", english ? "ltr" : "rtl");
  await expect(page.locator("[data-admin-stat]")).toHaveCount(8);
  for (const [key, value] of Object.entries(body.data.counts)) await expect(page.locator(`[data-admin-stat="${key}"] dd bdi`)).toHaveText(new Intl.NumberFormat("en-US").format(value as number));
  await expect(page.locator(`[data-ownership-id="${submitted.challenge.id}"]`)).toContainText(label("مرجع إثبات مسجل", "Evidence reference recorded"));
  await expect(page.locator(`[data-ownership-id="${started.id}"]`)).toContainText(label("لا يوجد مرجع إثبات مسجل.", "No evidence reference recorded."));
  await expect(page.locator("meter")).toHaveCount(5);
  await expect(page.getByText("+12%", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(Approve|Reject|اعتماد|رفض)$/ })).toHaveCount(0);
  expect((await page.request.get("/api/admin/users")).status()).toBe(410);
  await page.getByRole("button", { name: label("تحديث البيانات", "Reload data"), exact: true }).focus();
  await expect(page.getByRole("button", { name: label("تحديث البيانات", "Reload data"), exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  mkdirSync(path.join(workspace, ".infame", "artifacts"), { recursive: true });
  await page.screenshot({ path: path.join(workspace, ".infame", "artifacts", `${info.project.name}-admin-original-overview.png`), fullPage: true });
  if (english) { await page.setViewportSize({ width: 360, height: 800 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.setViewportSize({ width: 1440, height: 1000 }); }
  const review = page.locator(`[data-ownership-id="${submitted.challenge.id}"]`).getByRole("link", { name: new RegExp(label("مراجعة إثبات", "Review evidence for")) });
  await review.click();
  await expect(page).toHaveURL(/\/admin\/evidence$/);
  await expect(page.getByRole("heading", { name: label("مراجعة الإثباتات", "Evidence review"), exact: true })).toBeVisible();
});

test("actual reload progress retains transient failures and clears private data after session denial", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop", label = (ar: string, en: string) => english ? en : ar;
  const f = await setup(english);
  await pendingOwnership(f, context);
  const admin = await f.session(context, f.target.reviewerId);
  await page.goto("/admin");
  const initialTime = await page.locator("header time").getAttribute("datetime");
  const originalCount = await db.campaign.count();
  await db.campaign.create({ data: { brandId: f.brandId, title: "Synthetic admin refresh campaign", input: {} } });
  let release!: () => void, requests = 0, returnedTime = "";
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/admin/overview", async route => { requests++; const actual = await route.fetch(); returnedTime = (await actual.json()).data.asOf; await waiting; await route.fulfill({ response: actual }); });
  try {
    await page.getByRole("button", { name: label("تحديث البيانات", "Reload data"), exact: true }).evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
    await expect(page.getByRole("button", { name: label("جارٍ تحميل البيانات…", "Loading data…"), exact: true })).toBeDisabled();
    await expect(page.locator("[data-admin-stat=campaigns] dd bdi")).toHaveText(String(originalCount));
    await expect.poll(() => requests).toBe(1);
    release();
    await expect(page.getByRole("button", { name: label("تحديث البيانات", "Reload data"), exact: true })).toBeEnabled();
    await expect(page.locator("[data-admin-stat=campaigns] dd bdi")).toHaveText(String(originalCount + 1));
    await expect(page.locator("header time")).toHaveAttribute("datetime", returnedTime);
    expect(returnedTime).not.toBe(initialTime);
  } finally { release(); await page.unroute("**/api/admin/overview"); }
  const currentTime = await page.locator("header time").getAttribute("datetime");
  // Explicit injected negative transport fixtures; never live availability.
  await page.route("**/api/admin/overview", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "RETRY_REQUIRED" } }) }));
  await page.getByRole("button", { name: label("تحديث البيانات", "Reload data"), exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(label("تُعرض آخر نسخة محمّلة", "The last loaded snapshot"));
  await expect(page.locator("header time")).toHaveAttribute("datetime", currentTime!);
  await expect(page.locator("[data-admin-stat=campaigns] dd bdi")).toHaveText(String(originalCount + 1));
  await page.unroute("**/api/admin/overview");
  await page.route("**/api/admin/overview", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { invented: true } }) }));
  await page.getByRole("button", { name: label("إعادة المحاولة", "Retry"), exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(label("تعذر قراءة بيانات النظرة العامة", "The overview response could not be read"));
  await expect(page.locator("header time")).toHaveAttribute("datetime", currentTime!);
  await page.unroute("**/api/admin/overview");
  await page.getByRole("button", { name: label("إعادة المحاولة", "Retry"), exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  for (const status of [401, 403]) {
    // A confirmed denial must clear protected data even if its body is malformed.
    await page.route("**/api/admin/overview", route => route.fulfill({ status, contentType: "application/json", body: "invalid-json" }));
    await page.getByRole("button", { name: label("تحديث البيانات", "Reload data"), exact: true }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText(status === 401 ? label("انتهت الجلسة", "Your session ended") : label("بيانات الإدارة غير متاحة لصلاحيتك الحالية", "Admin data is unavailable for your current permissions"));
    await expect(page.locator("[data-admin-stat]")).toHaveCount(0);
    await expect(page.locator("[data-ownership-id]")).toHaveCount(0);
    await expect(page.locator("header time")).toHaveCount(0);
    await page.unroute("**/api/admin/overview");
    await page.getByRole("button", { name: label("إعادة المحاولة", "Retry"), exact: true }).click();
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    await expect(page.locator("[data-admin-stat]")).toHaveCount(8);
  }
  await db.authSession.update({ where: { id: admin.sessionId }, data: { revokedAt: new Date() } });
  const denied = page.waitForResponse(r => r.url().endsWith("/api/admin/overview") && r.status() === 401);
  await page.getByRole("button", { name: label("تحديث البيانات", "Reload data"), exact: true }).click();
  expect((await denied).headers()["cache-control"]).toBe("private, no-store");
  await expect(page.locator("main").getByRole("alert")).toContainText(label("انتهت الجلسة", "Your session ended"));
  await expect(page.locator("[data-admin-stat]")).toHaveCount(0);
  await expect(page.locator("[data-ownership-id]")).toHaveCount(0);
  await expect(page.locator("header time")).toHaveCount(0);
});
