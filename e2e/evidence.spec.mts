import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";
import { assertLocalTarget, taskState, workspace } from "../scripts/task-state.mjs";
import { cleanupReviewedEvidence, reviewedEvidenceOptions } from "../tests/helpers/reviewed-evidence";
import { privateAssetAccepted } from "../src/lib/evidence/readiness";

// Actual local UI/HTTP/database journeys over explicit synthetic identities and
// bytes. No external social provider, legal approval or publication is implied.
const state = taskState(), origin = "http://localhost:3100";
if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("Evidence browser checks require the exact isolated E2E target");
const db = new PrismaClient(), users: string[] = [], policies: string[] = [], artifacts = path.join(workspace, ".infame", "artifacts");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1kAAAAASUVORK5CYII=", "base64");
test.beforeAll(async () => {
  const rows = await db.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id, kind, current_database() AS db, host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0].id !== state.id || rows[0].kind !== "e2e" || rows[0].db !== state.targets.e2e || rows[0].host !== "127.0.0.1") throw new Error("Evidence browser target identity mismatch");
});
test.beforeEach(async () => {
  // Serial cases share the development server's untrusted-ingress rate key.
  // Reset only that isolated test bucket; production budgets stay unchanged,
  // and each journey still uses actual authentication and <=3 login attempts.
  await db.rateBucket.deleteMany({ where: { key: createHash("sha256").update("login:ip:untrusted-ingress").digest("hex") } });
});
test.afterEach(async () => {
  await db.policyVersion.deleteMany({ where: { id: { in: policies.splice(0) } } });
  await db.creator.deleteMany({ where: { userId: { in: users } } });
  await db.brand.deleteMany({ where: { userId: { in: users } } });
  await cleanupReviewedEvidence(db, users, "e2e");
  await db.rateBucket.deleteMany({ where: { key: { in: users.map(id => createHash("sha256").update(`login:email:${id}@example.invalid`).digest("hex")) } } });
  await db.user.deleteMany({ where: { id: { in: users.splice(0) } } });
});
test.afterAll(async () => { await db.$disconnect(); });
async function actor(role: "CREATOR" | "BRAND" | "ADMIN", english: boolean) {
  const id = randomUUID(), email = `${id}@example.invalid`, password = `Synthetic evidence ${randomUUID()}`; users.push(id);
  await db.user.create({ data: { id, role, name: "Synthetic evidence browser", email, language: english ? "en" : "ar", passwordHash: await bcrypt.hash(password, 12), emailVerifiedAt: new Date(), isTest: true } });
  return { id, email, password };
}
async function creator(english: boolean) {
  const owner = await actor("CREATOR", english), handle = `evidence_${owner.id.replaceAll("-", "").slice(0, 20)}`;
  const profile = await db.creator.create({ data: { userId: owner.id, handle, displayName: "صانع اختبار أصلي Synthetic owner", countryCode: "KW", isTest: true } });
  const account = await db.socialAccount.create({ data: { creatorId: profile.id, platform: "INSTAGRAM", handle,
    intendedConfirmedAt: new Date(), consentAt: new Date() } });
  return { owner, profile, account };
}
async function brand(english: boolean) {
  const owner = await actor("BRAND", english), profile = await db.brand.create({ data: { userId: owner.id, slug: `evidence-${owner.id.slice(0, 8)}`,
    name: "شركة اختبار أصلية Synthetic company", countryCode: "KW", isTest: true } });
  return { owner, profile };
}
async function login(page: Page, context: BrowserContext, user: Awaited<ReturnType<typeof actor>>, english: boolean) {
  await context.addCookies([{ name: "infame_lang", value: english ? "en" : "ar", domain: "localhost", path: "/" }]);
  expect((await page.request.post("/api/auth/login", { headers: { Origin: origin }, data: { email: user.email, password: user.password } })).status()).toBe(200);
  await page.emulateMedia({ reducedMotion: "reduce" });
}
async function noOverflow(page: Page, english: boolean) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (english) { await page.setViewportSize({ width: 360, height: 800 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
}
type Copy = (ar: string, en: string) => string;
function language(info: TestInfo) {
  const english = info.project.name === "english-desktop", copy: Copy = (ar, en) => english ? en : ar;
  return { english, copy };
}
async function adminPage(browser: Browser, info: TestInfo) {
  const { english } = language(info), user = await actor("ADMIN", english);
  const context = await browser.newContext({ baseURL: origin, viewport: info.project.use.viewport, reducedMotion: "reduce" });
  const page = await context.newPage(); await login(page, context, user, english);
  return { user, context, page };
}
async function upload(page: Page, scope: Locator, copy: Copy, loseResponse = false) {
  const file = scope.getByLabel(copy("ملف إثبات جديد", "New evidence file"), { exact: true });
  await file.setInputFiles({ name: "synthetic-local-proof.png", mimeType: "image/png", buffer: png });
  const button = scope.getByRole("button", { name: copy("رفع الملف الخاص", "Upload private file"), exact: true });
  const selected = scope.getByLabel(copy("الإثبات المرفوع المحدد", "Selected uploaded evidence"), { exact: true });
  if (loseResponse) {
    const attempts: Array<{ key: string | undefined; purpose: string | undefined; bytes: Buffer | null }> = [];
    let release!: () => void, committed!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; }), actualCommit = new Promise<void>(resolve => { committed = resolve; });
    await page.route("**/api/evidence/assets", async route => {
      const headers = route.request().headers(); attempts.push({ key: headers["x-operation-key"], purpose: headers["x-evidence-purpose"], bytes: route.request().postDataBuffer() });
      if (attempts.length === 1) { expect((await route.fetch()).status()).toBe(200); committed(); await delayed; await route.abort("failed"); }
      else await route.continue();
    });
    try {
      await button.click(); await actualCommit; await expect(button).toBeDisabled(); await expect(file).toBeDisabled();
      release(); await page.getByRole("button", { name: copy("إعادة نفس الطلب", "Retry same request"), exact: true }).click();
      await expect(selected).not.toHaveValue("");
    } finally { release(); await page.unroute("**/api/evidence/assets"); }
    expect(attempts).toHaveLength(2); expect(attempts[1]).toEqual(attempts[0]); expect(attempts[0].bytes).toEqual(png);
  } else {
    const response = page.waitForResponse(r => r.url().endsWith("/api/evidence/assets") && r.request().method() === "POST");
    await button.click(); expect((await response).status()).toBe(200); await expect(selected).not.toHaveValue("");
  }
  await expect(selected).toBeEnabled();
  const id = await selected.inputValue();
  expect((await page.request.get(`/api/evidence/assets/${id}`)).status()).toBe(200);
  return id;
}
async function command<T>(page: Page, trigger: () => Promise<unknown>): Promise<T> {
  const response = page.waitForResponse(r => r.url().endsWith("/api/evidence/commands") && r.request().method() === "POST");
  await trigger(); const actual = await response; expect(actual.status()).toBe(200);
  return (await actual.json() as { data: T }).data;
}
async function saved(page: Page, copy: Copy, admin = false) {
  await expect(page.getByRole("status").filter({ hasText: admin ? copy("حُفظت المراجعة وحُمّلت البيانات الحالية.", "Review saved and current data loaded.") : copy("اكتمل الطلب وتم تحميل البيانات الحالية.", "The request completed and current data was loaded.") })).toBeVisible();
}
async function reviewEntry(page: Page, copy: Copy, id: string, kind: string, status = "PENDING") {
  const kindSelect = page.getByLabel(copy("نوع الإثبات", "Evidence kind"), { exact: true });
  const statusSelect = page.getByLabel(copy("حالة المراجعة المحفوظة", "Saved review status"), { exact: true });
  await expect(kindSelect).toBeEnabled();
  if (await kindSelect.inputValue() !== kind) await kindSelect.selectOption(kind);
  await expect(statusSelect).toBeEnabled();
  if (await statusSelect.inputValue() !== status) await statusSelect.selectOption(status);
  await expect(kindSelect).toBeEnabled();
  const row = page.locator(`[data-evidence-id="${id}"]`); await expect(row).toBeVisible();
  const open = row.getByRole("button", { name: `${copy("مراجعة", "Review")} ${id}`, exact: true });
  if (await open.count()) await open.click();
  return row;
}
const observed = () => new Date(Date.now() - 7_200_000).toISOString().slice(0, 19);
async function reason(row: Locator, copy: Copy, text: string) {
  await row.getByLabel(copy("سبب المراجعة (مطلوب)", "Review reason (required)"), { exact: true }).fill(text);
  await row.getByLabel(copy("لغة السبب الأصلية (اختياري، رمز BCP47)", "Original reason language (optional, BCP47 code)"), { exact: true }).fill("ar");
}

test("evidence pages and APIs enforce current role and revoked sessions before showing private records", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop", f = await creator(english);
  await page.goto("/creator/evidence"); await expect(page).toHaveURL(/\/login/);
  expect((await page.request.get("/api/evidence")).status()).toBe(401);
  await login(page, context, f.owner, english);
  expect((await page.goto("/creator/evidence"))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(english ? "My evidence and metrics" : "إثباتاتي وبياناتي");
  expect((await page.request.get("/api/evidence/reviews?kind=OWNERSHIP")).status()).toBe(403);
  await page.goto("/admin/evidence"); await expect(page).toHaveURL(/\/creator$/);
  await page.goto("/creator/evidence");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: english ? "Skip to content" : "انتقل للمحتوى", exact: true })).toBeFocused();
  await page.keyboard.press("Enter"); await expect(page.locator("#infame-main")).toBeFocused();
  await noOverflow(page, english);
  mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, `${info.project.name}-owner-evidence-original.png`), fullPage: true });
  const accountOption = page.getByRole("option", { name: `INSTAGRAM · @${f.account.handle}`, exact: true });
  await expect(accountOption).toHaveCount(1);
  await db.authSession.updateMany({ where: { userId: f.owner.id }, data: { revokedAt: new Date() } });
  expect((await page.request.get("/api/evidence")).status()).toBe(401);
  await page.reload(); await expect(page).toHaveURL(/\/login/);
  await expect(accountOption).toHaveCount(0);
});

test("private screenshot upload and immutable review replay retain unknowns, separate sharing and revocation history", async ({ page, context, browser }, info) => {
  test.setTimeout(120_000);
  const { english, copy } = language(info), f = await creator(english), admin = await adminPage(browser, info);
  const originalReason = "سبب مراجعة أصلي <script>لا ينفّذ</script> — إثبات اصطناعي محلي فقط";
  try {
    await login(page, context, f.owner, english); await page.goto("/creator/evidence");
    const screenshot = page.getByRole("region", { name: copy("إحصاءات من لقطة شاشة", "Screenshot metrics"), exact: true });
    const file = screenshot.getByLabel(copy("ملف إثبات جديد", "New evidence file"), { exact: true });
    // Genuine signature rejection through the actual upload endpoint.
    await file.setInputFiles({ name: "synthetic-invalid.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
    const rejected = page.waitForResponse(r => r.url().endsWith("/api/evidence/assets") && r.request().method() === "POST");
    await screenshot.getByRole("button", { name: copy("رفع الملف الخاص", "Upload private file"), exact: true }).click();
    expect((await rejected).status()).toBe(400);
    await expect(page.getByRole("alert").filter({ hasText: "INVALID_ASSET_FORMAT" })).toBeVisible();
    expect(await db.privateAsset.count({ where: { ownerUserId: f.owner.id } })).toBe(0);
    const assetId = await upload(page, screenshot, copy, true);
    expect(await db.privateAsset.count({ where: { ownerUserId: f.owner.id, purpose: "SCREENSHOT" } })).toBe(1);
    const bytes = await page.request.get(`/api/evidence/assets/${assetId}`);
    expect(await bytes.body()).toEqual(png); expect(bytes.headers()["cache-control"]).toBe("private, no-store");
    expect(bytes.headers()["content-disposition"]).toContain("attachment;");
    await screenshot.getByLabel(copy("تاريخ رصد اللقطة (UTC)", "Screenshot observed at (UTC)"), { exact: true }).fill(observed());
    await screenshot.getByLabel(copy("المتابعون المعروفون", "Known followers"), { exact: true }).fill("0");
    await screenshot.getByText(copy("بيانات الجمهور المعروفة (اختياري)", "Known audience data (optional)"), { exact: true }).click();
    const countries = screenshot.getByRole("group", { name: copy("بلدان الجمهور", "Audience countries"), exact: true });
    await countries.getByRole("checkbox", { name: copy("لدي بيانات معروفة لهذا البعد", "I have known data for this dimension"), exact: true }).check();
    await countries.getByLabel(copy("بلدان الجمهور · الفئة 1", "Audience countries · Category 1"), { exact: true }).selectOption("GB");
    await countries.getByLabel(copy("بلدان الجمهور · النسبة % 1", "Audience countries · Percent % 1"), { exact: true }).fill("13.5");
    await screenshot.getByRole("button", { name: copy("إضافة قياس تنسيق", "Add format metric"), exact: true }).click();
    await screenshot.getByLabel(copy("تنسيق القياس 1", "Metric format 1"), { exact: true }).selectOption("REEL");
    await screenshot.getByLabel(copy("قيمة التنسيق 1", "Format value 1"), { exact: true }).fill("0");
    await screenshot.getByLabel(copy("وحدة التنسيق 1", "Format unit 1"), { exact: true }).selectOption("IMPRESSIONS");
    const starts = new Date(Date.now() - 14_400_000).toISOString().slice(0, 19), ends = new Date(Date.now() - 10_800_000).toISOString().slice(0, 19);
    await screenshot.getByLabel(copy("التنسيق 1 · بداية الفترة (UTC)", "Format 1 · Window start (UTC)"), { exact: true }).fill(starts);
    await screenshot.getByLabel(copy("التنسيق 1 · نهاية الفترة (UTC)", "Format 1 · Window end (UTC)"), { exact: true }).fill(ends);
    await screenshot.getByLabel(copy("التنسيق 1 · المنطقة الزمنية الأصلية", "Format 1 · Original timezone"), { exact: true }).fill("Asia/Kuwait");
    const definition = "عدد مرات ظهور الريل، تعريف أصلي مصطنع";
    await screenshot.getByLabel(copy("التنسيق 1 · تعريف القياس", "Format 1 · Metric definition"), { exact: true }).fill(definition);
    const submitted = await command<{ snapshot: { id: string } }>(page, () => screenshot.getByRole("button", { name: copy("حفظ الإحصاءات للمراجعة", "Save metrics for review"), exact: true }).click());
    await saved(page, copy);
    const parentId = submitted.snapshot.id, parent = page.locator(`[data-evidence-id="${parentId}"]`);
    await expect(parent.getByText("SELF_REPORTED", { exact: true })).toBeVisible();
    const snapshot = await db.metricsSnapshot.findUniqueOrThrow({ where: { id: parentId } });
    expect(snapshot.followers).toBe(BigInt(0)); expect(snapshot.averageViews).toBeNull(); expect(snapshot.engagementRate).toBeNull(); expect(snapshot.reviewStatus).toBe("PENDING");
    expect(snapshot.demographics).toEqual({ countries: { value: [{ key: "GB", percent: 13.5 }], visibility: "PUBLIC" } });
    expect(snapshot.formatMetrics).toEqual([{ format: "REEL", value: 0, unit: "IMPRESSIONS", window: { startsAt: `${starts}.000Z`, endsAt: `${ends}.000Z`, timeZone: "Asia/Kuwait" }, definition, visibility: "PUBLIC" }]);
    expect((await db.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } })).fieldVisibility).toEqual({ followers: "PRIVATE", "demographics.countries": "PRIVATE", "formatMetrics.REEL": "PRIVATE" });
    await expect(parent.locator("dl > div").filter({ has: page.getByText(copy("متوسط المشاهدات", "Average views"), { exact: true }) })).toContainText(copy("غير معروف", "Unknown"));
    await admin.page.goto("/admin/evidence");
    let row = await reviewEntry(admin.page, copy, parentId, "SCREENSHOT"); await reason(row, copy, originalReason);
    const staleReview = admin.page.waitForResponse(r => r.url().endsWith("/api/evidence/commands") && r.request().method() === "POST");
    await parent.getByText(copy("مراجعة البيانات واختيار المشاركة", "Review data and choose sharing"), { exact: true }).click();
    await expect(parent.getByLabel(copy("مشاركة · المتابعون", "Share · Followers"), { exact: true })).toHaveValue("PRIVATE");
    await parent.getByLabel(copy("مشاركة · المتابعون", "Share · Followers"), { exact: true }).selectOption("BRAND_ONLY");
    await parent.getByLabel(copy("مشاركة · بلدان الجمهور", "Share · Audience countries"), { exact: true }).selectOption("PUBLIC");
    await command(page, () => parent.getByRole("button", { name: copy("موافقة على الإحصاءات والمشاركة", "Approve metrics and sharing"), exact: true }).click());
    await saved(page, copy);
    expect((await db.metricsSnapshot.findUniqueOrThrow({ where: { id: parentId } })).source).toBe("SELF_REPORTED");
    expect((await db.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } })).fieldVisibility).toEqual({ followers: "BRAND_ONLY", "demographics.countries": "PUBLIC", "formatMetrics.REEL": "PRIVATE" });
    await row.getByRole("button", { name: copy("اعتمد الإثبات بعد المراجعة", "Verify evidence after review"), exact: true }).click();
    expect((await staleReview).status()).toBe(409);
    await expect(admin.page.getByRole("alert").filter({ hasText: copy("تغيرت النسخة", "The version changed") })).toBeVisible();
    await expect(row.getByLabel(copy("سبب المراجعة (مطلوب)", "Review reason (required)"), { exact: true })).toHaveValue(originalReason);
    await admin.page.getByRole("button", { name: copy("حدّث البيانات", "Refresh data"), exact: true }).click();
    row = await reviewEntry(admin.page, copy, parentId, "SCREENSHOT", "VERIFIED");
    await expect(row.getByText(copy("لا توجد مراجعة إدارية محفوظة لهذه الملاحظة.", "No saved admin review for this observation."), { exact: true })).toBeVisible();
    await expect(row.getByLabel(copy("سبب المراجعة (مطلوب)", "Review reason (required)"), { exact: true })).toHaveValue(originalReason);
    const attempts: string[] = []; let release!: () => void, committed!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; }), actualCommit = new Promise<void>(resolve => { committed = resolve; });
    await admin.page.route("**/api/evidence/commands", async route => {
      attempts.push(route.request().postData()!);
      if (attempts.length === 1) { expect((await route.fetch()).status()).toBe(200); committed(); await delayed; await route.abort("failed"); }
      else await route.continue();
    });
    try {
      const verify = row.getByRole("button", { name: copy("اعتمد الإثبات بعد المراجعة", "Verify evidence after review"), exact: true });
      await verify.click(); await actualCommit; await expect(verify).toBeDisabled(); release();
      await admin.page.getByRole("button", { name: copy("أعد نفس الطلب", "Retry the same request"), exact: true }).click();
      await saved(admin.page, copy, true);
    } finally { release(); await admin.page.unroute("**/api/evidence/commands"); }
    expect(attempts).toHaveLength(2); expect(attempts[1]).toBe(attempts[0]);
    const attempt = JSON.parse(attempts[0]) as { command: { operationKey: string } };
    expect(await db.evidenceCommand.count({ where: { actorUserId: admin.user.id, operationKey: attempt.command.operationKey } })).toBe(1);
    const children = await db.metricsSnapshot.findMany({ where: { supersedesId: parentId } }); expect(children).toHaveLength(1);
    const child = children[0]; expect(child.source).toBe("SCREENSHOT_VERIFIED"); expect(child.averageViews).toBeNull();
    await page.getByRole("button", { name: copy("تحديث السجل", "Refresh history"), exact: true }).click();
    await expect(page.locator(`[data-evidence-id="${child.id}"]`).getByText(originalReason, { exact: true })).toBeVisible();
    row = await reviewEntry(admin.page, copy, child.id, "SCREENSHOT", "VERIFIED");
    expect((await admin.page.request.get(`/api/evidence/assets/${assetId}`)).status()).toBe(200);
    await noOverflow(admin.page, english); mkdirSync(artifacts, { recursive: true });
    await admin.page.screenshot({ path: path.join(artifacts, `${info.project.name}-admin-evidence-original.png`), fullPage: true });
    await reason(row, copy, "سحب مراجعة اصطناعية مع حفظ تاريخها");
    await command(admin.page, () => row.getByRole("button", { name: copy("اسحب اعتماد الإثبات", "Revoke evidence review"), exact: true }).click());
    await saved(admin.page, copy, true);
    await page.getByRole("button", { name: copy("تحديث السجل", "Refresh history"), exact: true }).click();
    await expect(page.locator(`[data-evidence-id="${child.id}"]`).getByText("REVOKED", { exact: true }).first()).toBeVisible();
    expect((await db.creator.findUniqueOrThrow({ where: { id: f.profile.id } })).state).toBe("PRIVATE");
    // A correction remains a separate self-reported observation after approval.
    const correction = page.getByRole("region", { name: copy("تصحيح مُدخل ذاتيًا", "Self-reported correction"), exact: true });
    await correction.getByLabel(copy("قيمة التصحيح المعروفة", "Known correction value"), { exact: true }).fill("7");
    await correction.getByLabel(copy("تاريخ التصحيح المرصود (UTC)", "Correction observed at (UTC)"), { exact: true }).fill(observed());
    const corrected = await command<{ correction: { id: string } }>(page, () => correction.getByRole("button", { name: copy("حفظ التصحيح الخاص", "Save private correction"), exact: true }).click());
    await saved(page, copy); const correctionRow = page.locator(`[data-evidence-id="${corrected.correction.id}"]`);
    await expect(correctionRow.getByLabel(copy("مشاركة التصحيح", "Correction sharing"), { exact: true })).toHaveValue("PRIVATE");
    await correctionRow.getByLabel(copy("مشاركة التصحيح", "Correction sharing"), { exact: true }).selectOption("PUBLIC");
    await command(page, () => correctionRow.getByRole("button", { name: copy("موافقة على التصحيح والمشاركة", "Approve correction and sharing"), exact: true }).click());
    await saved(page, copy);
    const approvedCorrection = await db.factCorrection.findUniqueOrThrow({ where: { id: corrected.correction.id } });
    expect(approvedCorrection).toMatchObject({ brandVisible: true, publicVisible: true, revision: 2, value: { source: "SELF_REPORTED", value: 7 } });
    expect(approvedCorrection.approvedAt).not.toBeNull();
    const ownerData = (await (await page.request.get("/api/evidence")).json() as { data: { corrections: Array<{ id: string; source: string; visibility: string; value: unknown }> } }).data;
    expect(ownerData.corrections.find(row => row.id === corrected.correction.id)).toMatchObject({ source: "SELF_REPORTED", visibility: "PUBLIC", value: 7 });
    expect((await db.creator.findUniqueOrThrow({ where: { id: f.profile.id } })).state).toBe("PRIVATE");
    const outsider = await actor("BRAND", english), stranger = await browser.newContext({ baseURL: origin });
    try { const other = await stranger.newPage(); await login(other, stranger, outsider, english); expect((await other.request.get(`/api/evidence/assets/${assetId}`)).status()).toBe(404); }
    finally { await stranger.close(); }
    await db.authSession.updateMany({ where: { userId: admin.user.id }, data: { revokedAt: new Date() } });
    expect((await admin.page.request.get(`/api/evidence/assets/${assetId}`)).status()).toBe(401);
  } finally { await admin.context.close(); }
});

test("ownership requires the observed code and keeps original reason through rejected nonce and review history", async ({ page, context, browser }, info) => {
  test.setTimeout(90_000);
  const { english, copy } = language(info), f = await creator(english), admin = await adminPage(browser, info);
  try {
    await login(page, context, f.owner, english); await page.goto("/creator/evidence");
    const started = await command<{ challenge: { id: string; challengeCode: string } }>(page, () => page.getByRole("button", { name: copy("إنشاء رمز إثبات الملكية", "Create ownership code"), exact: true }).click());
    await saved(page, copy); const proof = page.locator(`[data-evidence-id="${started.challenge.id}"]`);
    await expect(proof.getByText(started.challenge.challengeCode, { exact: true })).toBeVisible();
    await upload(page, proof, copy);
    await command(page, () => proof.getByRole("button", { name: copy("إرسال إثبات الملكية", "Submit ownership proof"), exact: true }).click());
    await saved(page, copy); await admin.page.goto("/admin/evidence");
    const row = await reviewEntry(admin.page, copy, started.challenge.id, "OWNERSHIP");
    const verify = row.getByRole("button", { name: copy("اعتمد الإثبات بعد المراجعة", "Verify evidence after review"), exact: true });
    await expect(verify).toBeDisabled(); const note = "مراجعة رمز الحساب — نص أصلي لا يترجم";
    await reason(row, copy, note); await expect(verify).toBeDisabled();
    const nonce = row.getByLabel(copy("رمز التحدي الذي شاهدته في الإثبات", "Challenge code observed in the proof"), { exact: true });
    await expect(nonce).toHaveValue(""); await nonce.fill("synthetic-wrong-code");
    const failed = admin.page.waitForResponse(r => r.url().endsWith("/api/evidence/commands") && r.request().method() === "POST");
    await verify.click(); expect((await failed).status()).toBe(409);
    await expect(admin.page.getByRole("alert").filter({ hasText: "INVALID_EVIDENCE" })).toBeVisible();
    await expect(row.getByLabel(copy("سبب المراجعة (مطلوب)", "Review reason (required)"), { exact: true })).toHaveValue(note);
    expect((await db.ownershipChallenge.findUniqueOrThrow({ where: { id: started.challenge.id } })).status).toBe("PENDING");
    await nonce.fill(started.challenge.challengeCode); await command(admin.page, () => verify.click()); await saved(admin.page, copy, true);
    await page.getByRole("button", { name: copy("تحديث السجل", "Refresh history"), exact: true }).click();
    await expect(proof.getByText("VERIFIED", { exact: true })).toBeVisible(); await expect(proof.getByText(note, { exact: true })).toBeVisible();
    const reviewed = await db.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } }); expect(reviewed.ownershipStatus).toBe("VERIFIED");
    expect(reviewed.publicVisible).toBe(false); expect(reviewed.brandVisible).toBe(false);
    const revoke = await reviewEntry(admin.page, copy, started.challenge.id, "OWNERSHIP", "VERIFIED");
    await reason(revoke, copy, "سحب الملكية المصطنعة في الاختبار فقط");
    await command(admin.page, () => revoke.getByRole("button", { name: copy("اسحب اعتماد الإثبات", "Revoke evidence review"), exact: true }).click());
    await saved(admin.page, copy, true); await page.getByRole("button", { name: copy("تحديث السجل", "Refresh history"), exact: true }).click();
    await expect(proof.getByText("REVOKED", { exact: true })).toBeVisible();
    await noOverflow(page, english);
  } finally { await admin.context.close(); }
});

test("company representation and registration stay separate through failed reload, two-tab conflict and original-language reviews", async ({ page, context, browser }, info) => {
  test.setTimeout(120_000);
  const { english, copy } = language(info), f = await brand(english), admin = await adminPage(browser, info);
  const representationReference = "صلاحية تمثيل أصلية <script>نص فقط</script> — ".repeat(5).trim(), registrationReference = "تسجيل الشركة الأصلي — Synthetic private registration";
  try {
    await login(page, context, f.owner, english); await page.goto("/brand/evidence");
    const representative = page.locator('section[data-evidence-kind="REPRESENTATIVE"]'), registration = page.locator('section[data-evidence-kind="BUSINESS_REGISTRATION"]');
    await representative.getByLabel(copy("مرجع صلاحية التمثيل", "Representation authority reference"), { exact: true }).fill(representationReference);
    const representativeProof = await upload(page, representative, copy);
    const rep = await command<{ verification: { id: string } }>(page, () => representative.getByRole("button", { name: copy("إرسال التمثيل للمراجعة", "Submit representation for review"), exact: true }).click());
    await saved(page, copy);
    await expect(registration.locator(`option[value="${representativeProof}"]`)).toHaveCount(0);
    await registration.getByLabel(copy("رقم تسجيل الشركة", "Business registration number"), { exact: true }).fill(registrationReference);
    const registrationProof = await upload(page, registration, copy); expect(registrationProof).not.toBe(representativeProof);
    const reg = await command<{ verification: { id: string } }>(page, () => registration.getByRole("button", { name: copy("إرسال التسجيل للمراجعة", "Submit registration for review"), exact: true }).click());
    await saved(page, copy);
    expect(await db.businessVerification.count({ where: { brandId: f.profile.id } })).toBe(2);
    await expect(page.locator(`[data-evidence-id="${rep.verification.id}"]`).getByText(representationReference, { exact: true })).toBeVisible();
    await admin.page.goto("/admin/evidence");
    let row = await reviewEntry(admin.page, copy, reg.verification.id, "BUSINESS_REGISTRATION");
    await expect(row.getByRole("button", { name: copy("اعتمد الإثبات بعد المراجعة", "Verify evidence after review"), exact: true })).toBeDisabled();
    const reviewReason = "اعتماد تسجيل اصطناعي فقط — تبقى صلاحية التمثيل منفصلة";
    await reason(row, copy, reviewReason);
    const stale = await admin.context.newPage();
    try {
      await stale.goto("/admin/evidence"); const staleRow = await reviewEntry(stale, copy, reg.verification.id, "BUSINESS_REGISTRATION");
      const staleReason = "مدخلات التبويب الثاني محفوظة للمقارنة"; await reason(staleRow, copy, staleReason);
      let blockedRead = false;
      // Transport-only read fault AFTER a genuine committed review; no mocked
      // review result. The UI must withhold success until authoritative reload.
      await admin.page.route("**/api/evidence/reviews?**", async route => { if (!blockedRead) { blockedRead = true; await route.abort("failed"); } else await route.continue(); });
      try {
        await command(admin.page, () => row.getByRole("button", { name: copy("اعتمد الإثبات بعد المراجعة", "Verify evidence after review"), exact: true }).click());
        await expect(admin.page.getByRole("alert").filter({ hasText: copy("وصلت نتيجة الإجراء", "The action returned a result") })).toBeVisible();
        await expect(row.getByLabel(copy("سبب المراجعة (مطلوب)", "Review reason (required)"), { exact: true })).toHaveValue(reviewReason);
        await expect(row.getByLabel(copy("سبب المراجعة (مطلوب)", "Review reason (required)"), { exact: true })).toBeDisabled();
        await expect(admin.page.getByText(copy("حُفظت المراجعة وحُمّلت البيانات الحالية.", "Review saved and current data loaded."), { exact: true })).toHaveCount(0);
        expect((await db.businessVerification.findUniqueOrThrow({ where: { id: reg.verification.id } })).status).toBe("VERIFIED");
        await admin.page.getByRole("button", { name: copy("حدّث البيانات", "Refresh data"), exact: true }).click(); await saved(admin.page, copy, true);
      } finally { await admin.page.unroute("**/api/evidence/reviews?**"); }
      const conflict = stale.waitForResponse(r => r.url().endsWith("/api/evidence/commands") && r.request().method() === "POST");
      await staleRow.getByRole("button", { name: copy("اعتمد الإثبات بعد المراجعة", "Verify evidence after review"), exact: true }).click();
      expect((await conflict).status()).toBe(409);
      await expect(stale.getByRole("alert").filter({ hasText: copy("تغيرت النسخة", "The version changed") })).toBeVisible();
      await expect(staleRow.getByLabel(copy("سبب المراجعة (مطلوب)", "Review reason (required)"), { exact: true })).toHaveValue(staleReason);
      await stale.getByRole("button", { name: copy("حدّث البيانات", "Refresh data"), exact: true }).click();
      const refreshed = await reviewEntry(stale, copy, reg.verification.id, "BUSINESS_REGISTRATION", "VERIFIED");
      await expect(refreshed.getByLabel(copy("سبب المراجعة (مطلوب)", "Review reason (required)"), { exact: true })).toHaveValue(staleReason);
    } finally { await stale.close(); }
    expect((await db.businessVerification.findUniqueOrThrow({ where: { id: rep.verification.id } })).status).toBe("PENDING");
    row = await reviewEntry(admin.page, copy, rep.verification.id, "REPRESENTATIVE");
    await expect(row.locator("dd").getByText(representationReference, { exact: true })).toBeVisible();
    await reason(row, copy, "رفض إثبات التمثيل الاصطناعي؛ التسجيل لا يتغير");
    // Remove only this test's own synthetic object through the task-guarded
    // storage adapter. Review/download must fail honestly on unavailable bytes.
    const privateAsset = await db.privateAsset.findUniqueOrThrow({ where: { id: representativeProof } });
    expect(privateAsset.ownerUserId).toBe(f.owner.id); expect(privateAsset.storageKey.startsWith("local:")).toBe(true);
    await (await reviewedEvidenceOptions(db, "e2e", new Date())).storage.remove(privateAsset.storageKey.slice(6));
    const missingBytes = admin.page.waitForResponse(r => r.url().endsWith("/api/evidence/commands") && r.request().method() === "POST");
    await row.getByRole("button", { name: copy("اعتمد الإثبات بعد المراجعة", "Verify evidence after review"), exact: true }).click();
    expect((await missingBytes).status()).toBe(503);
    await expect(admin.page.getByRole("alert").filter({ hasText: "ASSET_BYTES_UNAVAILABLE" })).toBeVisible();
    expect((await page.request.get(`/api/evidence/assets/${representativeProof}`)).status()).toBe(503);
    await expect(row.getByLabel(copy("سبب المراجعة (مطلوب)", "Review reason (required)"), { exact: true })).toHaveValue("رفض إثبات التمثيل الاصطناعي؛ التسجيل لا يتغير");
    expect((await db.businessVerification.findUniqueOrThrow({ where: { id: rep.verification.id } })).status).toBe("PENDING");
    await command(admin.page, () => row.getByRole("button", { name: copy("ارفض الإثبات", "Reject evidence"), exact: true }).click()); await saved(admin.page, copy, true);
    expect((await db.businessVerification.findUniqueOrThrow({ where: { id: rep.verification.id } })).status).toBe("REJECTED");
    expect((await db.businessVerification.findUniqueOrThrow({ where: { id: reg.verification.id } })).status).toBe("VERIFIED");
    expect((await db.brand.findUniqueOrThrow({ where: { id: f.profile.id } })).state).toBe("PRIVATE");
    await page.getByRole("button", { name: copy("تحديث السجل", "Refresh history"), exact: true }).click();
    const history = page.locator(`[data-evidence-id="${reg.verification.id}"]`);
    await expect(history.getByText(reviewReason, { exact: true })).toHaveAttribute("lang", "ar");
    await noOverflow(page, english); mkdirSync(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, `${info.project.name}-brand-evidence-original.png`), fullPage: true });
    await context.addCookies([{ name: "infame_lang", value: english ? "ar" : "en", domain: "localhost", path: "/" }]);
    await page.reload(); await expect(history.getByText(reviewReason, { exact: true })).toBeVisible();
    await expect(page.locator(`[data-evidence-id="${rep.verification.id}"]`).getByText(representationReference, { exact: true })).toBeVisible();
  } finally { await admin.context.close(); }
});

test("licence review selects actual scoped policy IDs and rechecks a withdrawn option without changing saved evidence", async ({ page, context, browser }, info) => {
  test.setTimeout(120_000);
  const { english, copy } = language(info), f = await creator(english), admin = await adminPage(browser, info);
  const originalScope = "نطاق أصلي للإعلان على الحساب المختار فقط <script>نص محفوظ</script>";
  try {
    await login(page, context, f.owner, english); await page.goto("/creator/evidence");
    const licence = page.getByRole("region", { name: copy("ترخيص الإعلان", "Advertising licence"), exact: true });
    await licence.getByLabel(copy("بلد الترخيص", "Licence jurisdiction"), { exact: true }).selectOption("KW");
    await licence.getByLabel(copy("الجهة المصدرة", "Issuing authority"), { exact: true }).fill("جهة إصدار اصطناعية — Synthetic issuer");
    await licence.getByLabel(copy("اسم حامل الترخيص", "Licence holder name"), { exact: true }).fill("حامل ترخيص اصطناعي");
    await licence.getByLabel(copy("رقم الترخيص", "Licence number"), { exact: true }).fill("synthetic-only-local-licence");
    await licence.getByLabel(copy("نوع الترخيص", "Licence type"), { exact: true }).fill("نوع وثيقة اصطناعية");
    await licence.getByLabel(copy("نطاق الترخيص الأصلي", "Original licence scope"), { exact: true }).fill(originalScope);
    await licence.getByLabel(copy("بداية صلاحية الترخيص (UTC)", "Licence valid from (UTC)"), { exact: true }).fill(observed());
    await licence.getByLabel(copy("انتهاء صلاحية الترخيص (UTC)", "Licence expires at (UTC)"), { exact: true }).fill(new Date(Date.now() + 86_400_000).toISOString().slice(0, 19));
    await licence.getByRole("checkbox", { name: `INSTAGRAM · @${f.account.handle}`, exact: true }).check();
    const proofId = await upload(page, licence, copy);
    const submitted = await command<{ licence: { id: string } }>(page, () => licence.getByRole("button", { name: copy("إرسال الترخيص للمراجعة", "Submit licence for review"), exact: true }).click());
    await saved(page, copy);
    expect(await db.advertisingLicence.findUniqueOrThrow({ where: { id: submitted.licence.id } })).toMatchObject({ accountIds: [f.account.id], platformScope: ["INSTAGRAM"], jurisdiction: "KW", evidenceAssetId: proofId, status: "PENDING", scope: originalScope });
    await admin.page.goto("/admin/evidence");
    const row = await reviewEntry(admin.page, copy, submitted.licence.id, "ADVERTISING_LICENCE");
    const note = "سبب مراجعة ترخيص اصطناعي محلي، ليس اعتمادًا قانونيًا حيًا"; await reason(row, copy, note);
    const policySelect = row.getByLabel(copy("نسخة سياسة السوق", "Market policy version"), { exact: true });
    await expect(policySelect).toBeEnabled(); await expect(policySelect).toHaveValue("");
    const verify = row.getByRole("button", { name: copy("اعتمد الإثبات بعد المراجعة", "Verify evidence after review"), exact: true });
    await expect(verify).toBeDisabled();
    const policyProof = await admin.page.request.post("/api/evidence/assets", { headers: { Origin: origin, "Content-Type": "image/png", "X-Evidence-Purpose": "LEGAL_POLICY_REVIEW", "X-Operation-Key": randomUUID() }, data: png });
    expect(policyProof.status()).toBe(200); const legalAsset = (await policyProof.json() as { data: { asset: { id: string; createdAt: string } } }).data.asset, legalAssetId = legalAsset.id;
    // Use the actual upload timestamp for synthetic review chronology rather
    // than crossing Windows process wall-clock resolution at this boundary.
    const now = new Date(legalAsset.createdAt), rawReference = "مرجع سياسة اصطناعي <script>لا ينفذ</script> — لا توجد مراجعة قانونية حية";
    expect(await db.$transaction(async tx => !!await privateAssetAccepted(tx, legalAssetId, admin.user.id, "LEGAL_POLICY_REVIEW", now))).toBe(true);
    const content = { schemaVersion: 1, kind: "MARKET", marketCountryCode: "KW", brandCountryCodes: ["KW"], creatorCountryCodes: ["KW"], licenceRequired: true,
      licencePolicyId: `synthetic-only-${randomUUID()}`, reviewReference: rawReference, reviewedBasis: "FOUNDER_APPROVED_LEGAL_REVIEW" };
    const policyIds = [randomUUID(), randomUUID()]; policies.push(...policyIds);
    // Immutable policy insertions are isolated synthetic control fixtures, not
    // claimed live legal acceptance. Proof uploads use the actual HTTP service.
    for (const id of policyIds) await db.policyVersion.create({ data: { id, kind: "MARKET", status: "VERIFIED", countryCodes: ["KW"], content,
      evidenceAssetId: legalAssetId, reviewedBy: admin.user.id, reviewedAt: now, createdAt: new Date(now.getTime() - 60_000), expiresAt: new Date(now.getTime() + 86_400_000) } });
    await row.getByRole("button", { name: copy("حدّث خيارات السياسة", "Refresh policy options"), exact: true }).click();
    await expect(policySelect.locator(`option[value="${policyIds[0]}"]`)).toHaveCount(1);
    await policySelect.selectOption(policyIds[0]); await expect(row.getByText(rawReference, { exact: true })).toBeVisible();
    await db.policyVersion.update({ where: { id: policyIds[0] }, data: { status: "REVOKED" } });
    const withdrawn = admin.page.waitForResponse(r => r.url().endsWith("/api/evidence/commands") && r.request().method() === "POST");
    await verify.click(); expect((await withdrawn).status()).toBe(503);
    await expect(admin.page.getByRole("alert").filter({ hasText: copy("سياسة الترخيص المطلوبة غير متاحة", "The required licence policy is unavailable") })).toBeVisible();
    await expect(row.getByLabel(copy("سبب المراجعة (مطلوب)", "Review reason (required)"), { exact: true })).toHaveValue(note);
    expect(await db.advertisingLicence.findUniqueOrThrow({ where: { id: submitted.licence.id } })).toMatchObject({ revision: 1, status: "PENDING", policyVersion: null });
    await row.getByRole("button", { name: copy("حدّث خيارات السياسة", "Refresh policy options"), exact: true }).click();
    await expect(policySelect.locator(`option[value="${policyIds[0]}"]`)).toHaveCount(0);
    await expect(policySelect.locator(`option[value="${policyIds[1]}"]`)).toHaveCount(1); await policySelect.selectOption(policyIds[1]);
    await command(admin.page, () => verify.click()); await saved(admin.page, copy, true);
    const reviewed = await db.advertisingLicence.findUniqueOrThrow({ where: { id: submitted.licence.id } });
    expect(reviewed.status).toBe("VERIFIED"); expect(reviewed.policyVersion).toBe(content.licencePolicyId); expect(reviewed.scope).toBe(originalScope);
    await page.getByRole("button", { name: copy("تحديث السجل", "Refresh history"), exact: true }).click();
    const ownerHistory = page.locator(`[data-evidence-id="${submitted.licence.id}"]`);
    await expect(ownerHistory.getByText(note, { exact: true })).toBeVisible(); await expect(ownerHistory.getByText(originalScope, { exact: true })).toBeVisible();
    expect((await db.creator.findUniqueOrThrow({ where: { id: f.profile.id } })).state).toBe(f.profile.state);
    expect((await page.request.get(`/@${f.profile.handle}`)).status()).toBe(404);
    await noOverflow(page, english);
  } finally { await admin.context.close(); }
});
