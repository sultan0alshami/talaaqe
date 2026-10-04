import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { assertLocalTarget, taskState, workspace } from "../scripts/task-state.mjs";
import { applyCampaignMutation, createCampaign, generateCampaignBrief } from "../src/lib/campaigns/service";
import { campaignFields } from "../tests/campaigns/fixtures";
import { cleanupReviewedEvidence } from "../tests/helpers/reviewed-evidence";

const state = taskState(), origin = "http://localhost:3100";
if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("Campaign browser checks require the exact isolated E2E target");
const db = new PrismaClient(), users: string[] = [], artifacts = path.join(workspace, ".infame", "artifacts");
test.beforeAll(async () => {
  const rows = await db.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id, kind, current_database() AS db, host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0].id !== state.id || rows[0].kind !== "e2e" || rows[0].db !== state.targets.e2e || rows[0].host !== "127.0.0.1") throw new Error("Campaign browser target identity mismatch");
});
test.afterEach(async () => {
  await db.campaign.deleteMany({ where: { brand: { userId: { in: users } } } });
  await db.brand.deleteMany({ where: { userId: { in: users } } });
  await cleanupReviewedEvidence(db, users, "e2e");
  await db.user.deleteMany({ where: { id: { in: users.splice(0) } } });
});
test.afterAll(async () => { await db.$disconnect(); });
const originalTitle = "حملة أصلية طويلة لاختبار الصفحة المحفوظة Synthetic campaign — النص لا يُترجم مع الواجهة";
const originalSummary = "هذا وصف أصلي للحملة كتبه صاحبها؛ بيانات اختبار محلية فقط. ".repeat(12);
const savedTurn = "هذه رسالتي الأصلية المحفوظة في رحلة اختبار اصطناعية، وليست استجابة من مزود حي.";
async function actor(language: "ar" | "en") {
  const owner = randomUUID(), email = `${owner}@example.invalid`, password = `Synthetic campaign ${randomUUID()}`; users.push(owner);
  await db.user.create({ data: { id: owner, role: "BRAND", name: "Synthetic campaign browser", email, language, passwordHash: await bcrypt.hash(password, 12), emailVerifiedAt: new Date(), isTest: true } });
  await db.brand.create({ data: { userId: owner, slug: `synthetic-campaign-${owner.slice(0, 8)}`, name: "شركة اختبار أصلية", countryCode: "KW", timeZone: "Asia/Kuwait", isTest: true } });
  return { owner, email, password };
}
async function fixture(english: boolean, conversation = false) {
  const user = await actor(english ? "en" : "ar");
  let campaign = (await createCampaign(user.owner, { operationKey: randomUUID(), fields: { ...campaignFields, title: originalTitle, summary: originalSummary,
    budget: { amountMinor: "9223372036854775807", currencyCode: "KWD" } } }, db)).campaign;
  if (conversation) {
    campaign = (await applyCampaignMutation(user.owner, campaign.id, { action: "GREETING", operationKey: randomUUID(), expectedRevision: campaign.revision,
      payload: { text: { text: "رسالة افتتاح محفوظة للاختبار الاصطناعي فقط.", language: "ar" } } }, db, { channel: "SERVER" })).campaign;
    campaign = (await applyCampaignMutation(user.owner, campaign.id, { action: "PROPOSE_FIELDS", operationKey: randomUUID(), expectedRevision: campaign.revision,
      payload: { type: "PROPOSE_FIELDS", patch: { tone: "اقتراح اصطناعي لم يطبّق" }, originalText: { text: savedTurn, language: "ar" } } }, db, { channel: "CHAT_TOOL" })).campaign;
  }
  const generated = await generateCampaignBrief(user.owner, campaign.id, { operationKey: randomUUID(), expectedRevision: campaign.revision }, db);
  return { ...user, campaign: generated.campaign, brief: generated.brief };
}
async function login(page: Page, context: BrowserContext, user: Awaited<ReturnType<typeof actor>>, english: boolean) {
  if (english) await context.addCookies([{ name: "infame_lang", value: "en", domain: "localhost", path: "/" }]);
  expect((await page.request.post("/api/auth/login", { headers: { Origin: origin }, data: { email: user.email, password: user.password } })).status()).toBe(200);
  await page.emulateMedia({ reducedMotion: "reduce" });
}

test("original brief retains explicit approval, exact money, history, real save replay and two-tab stale recovery", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop", copy = (ar: string, en: string) => english ? en : ar;
  const f = await fixture(english); await login(page, context, f, english);
  expect((await page.goto(`/brand/campaigns/${f.campaign.id}`))?.status()).toBe(200);
  const currentBrief = page.getByRole("article").filter({ has: page.getByRole("heading", { name: copy("نسخة الموجز 1", "Brief version 1"), exact: true }) });
  await expect(currentBrief.getByText(originalSummary, { exact: true })).toBeVisible();
  await expect(currentBrief.getByText("9223372036854775.807 KWD", { exact: true })).toBeVisible();
  await expect(currentBrief.getByText("Asia/Kuwait", { exact: true })).toBeVisible();
  const approve = currentBrief.getByRole("button", { name: copy("اعتمد هذه النسخة", "Approve this version"), exact: true });
  await expect(approve).toBeDisabled();
  await currentBrief.getByRole("checkbox", { name: copy("راجعت التفاصيل وأوافق على اعتماد النسخة 1.", "I reviewed the requirements and approve version 1."), exact: true }).check();
  await approve.click();
  await expect(currentBrief.getByRole("link", { name: copy("انتقل لاختيار صناع المحتوى", "Continue to creator selection"), exact: true })).toBeVisible();
  const beforeEdit = await db.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } });
  expect(beforeEdit.currentBriefVersion).toBe(1);
  const stale = await context.newPage(); await stale.goto(`/brand/campaigns/${f.campaign.id}`);
  const titleField = page.getByLabel(copy("اسم الحملة", "Campaign title"), { exact: true });
  await titleField.fill("تعديل أصلي محفوظ مع ضياع الاستجابة");
  await expect(page.getByRole("button", { name: copy("جهّز الموجز للمراجعة", "Prepare brief for review"), exact: true })).toBeDisabled();
  const endpoint = `**/api/campaigns/${f.campaign.id}/commands`, attempts: Array<{ operationKey: string; expectedRevision: number }> = [];
  let release!: () => void, committed!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; }), actualCommit = new Promise<void>(resolve => { committed = resolve; });
  // Transport fault only: the first command genuinely commits, its response is
  // lost, and the UI must resend the identical operation against the database.
  await page.route(endpoint, async route => {
    attempts.push(route.request().postDataJSON());
    if (attempts.length === 1) { expect((await route.fetch()).status()).toBe(200); committed(); await delayed; await route.abort("failed"); }
    else await route.continue();
  });
  const save = page.getByRole("button", { name: copy("راجع واحفظ التفاصيل", "Review and save details"), exact: true });
  try {
    await save.click(); await actualCommit;
    await expect(page.getByText(copy("جارٍ تنفيذ طلبك…", "Processing your request…"), { exact: true })).toBeVisible();
    await expect(save).toBeDisabled(); release();
    await page.getByRole("button", { name: copy("أعد نفس الطلب", "Retry the same request"), exact: true }).click();
    await expect(page.getByRole("status")).toContainText(copy("انحفظت المسودة", "Draft saved"));
  } finally { release(); await page.unroute(endpoint); }
  expect(attempts).toHaveLength(2); expect(attempts[0]).toEqual(attempts[1]);
  expect(await db.campaignCommand.count({ where: { campaignId: f.campaign.id, operationKey: `campaign:${f.campaign.id}:${attempts[0].operationKey}` } })).toBe(1);
  const saved = await db.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } });
  expect(saved.revision).toBe(beforeEdit.revision + 1); expect(saved.currentBriefVersion).toBeNull();
  await page.getByRole("button", { name: copy("جهّز الموجز للمراجعة", "Prepare brief for review"), exact: true }).click();
  await expect(page.getByRole("heading", { name: copy("نسخة الموجز 2", "Brief version 2"), exact: true })).toBeVisible();
  await page.getByText(copy("سجل النسخ السابقة", "Previous version history"), { exact: true }).click();
  await page.getByText(copy("اعرض تفاصيل هذه النسخة", "View this version's requirements"), { exact: true }).click();
  await expect(page.getByText(originalTitle, { exact: true })).toBeVisible();
  await stale.getByLabel(copy("اسم الحملة", "Campaign title"), { exact: true }).fill("مدخلات التبويب الثاني تبقى للمراجعة");
  await stale.getByRole("button", { name: copy("راجع واحفظ التفاصيل", "Review and save details"), exact: true }).click();
  await expect(stale.getByRole("alert").filter({ hasText: copy("تغيرت الحملة", "This campaign changed") })).toBeVisible();
  await expect(stale.getByLabel(copy("اسم الحملة", "Campaign title"), { exact: true })).toHaveValue("مدخلات التبويب الثاني تبقى للمراجعة");
  await stale.getByRole("button", { name: copy("حمّل النسخة الحالية للمقارنة", "Load current version to compare"), exact: true }).click();
  await expect(stale.getByLabel(copy("اسم الحملة", "Campaign title"), { exact: true })).toHaveValue("مدخلات التبويب الثاني تبقى للمراجعة");
  await stale.getByRole("button", { name: copy("احتفظ بمدخلاتي وأراجعها قبل الحفظ", "Keep my input and review before saving"), exact: true }).click();
  await stale.getByRole("button", { name: copy("راجع واحفظ التفاصيل", "Review and save details"), exact: true }).click();
  await expect(stale.getByRole("status")).toContainText(copy("انحفظت المسودة", "Draft saved")); await stale.close();
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (english) { await page.setViewportSize({ width: 360, height: 800 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  mkdirSync(artifacts, { recursive: true });
  await page.getByRole("article").screenshot({ path: path.join(artifacts, `${info.project.name}-brief-original-mobile.png`) });
  await db.authSession.updateMany({ where: { userId: f.owner }, data: { revokedAt: new Date() } });
  await page.reload(); await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText(originalSummary, { exact: true })).toHaveCount(0);
});

test("original guided composer preserves saved words and unprocessed text through unavailable chat/paragraph and language changes", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop", copy = (ar: string, en: string) => english ? en : ar;
  const f = await fixture(english, true); await login(page, context, f, english);
  await page.goto(`/brand/campaigns/${f.campaign.id}`);
  await page.getByRole("button", { name: copy("أشرح فكرتي", "Explain my idea"), exact: true }).click();
  const guided = page.getByRole("region", { name: copy("اشرح الفكرة بطريقتك", "Explain the idea in your own words"), exact: true });
  await expect(guided.getByText(savedTurn, { exact: true })).toBeVisible();
  const originalInput = "هذه مدخلاتي التي تبقى عند عدم توفر المساعد، ولم تُرسل إلى أي مزود خارجي. ".repeat(5);
  await guided.getByLabel(copy("رسالتك", "Your message"), { exact: true }).fill(originalInput);
  const chatFailure = page.waitForResponse(response => response.url().endsWith(`/api/campaigns/${f.campaign.id}/chat`) && response.request().method() === "POST");
  await guided.getByRole("button", { name: copy("اطلب اقتراحًا للمراجعة", "Request a proposal to review"), exact: true }).click();
  expect((await chatFailure).status()).toBe(503);
  await expect(page.getByRole("alert").filter({ hasText: copy("المساعد غير متاح حاليًا", "The assistant is currently unavailable") })).toBeVisible();
  await expect(guided.getByLabel(copy("رسالتك", "Your message"), { exact: true })).toHaveValue(originalInput);
  await guided.getByRole("button", { name: copy("فقرة كاملة", "Full paragraph"), exact: true }).click();
  const paragraphFailure = page.waitForResponse(response => response.url().endsWith(`/api/campaigns/${f.campaign.id}/paragraph`) && response.request().method() === "POST");
  await guided.getByRole("button", { name: copy("اطلب اقتراحًا للمراجعة", "Request a proposal to review"), exact: true }).click();
  expect((await paragraphFailure).status()).toBe(503);
  await expect(page.getByRole("alert").filter({ hasText: copy("المساعد غير متاح حاليًا", "The assistant is currently unavailable") })).toBeVisible();
  await expect(guided.getByLabel(copy("وصف الحملة", "Campaign description"), { exact: true })).toHaveValue(originalInput);
  const unchanged = await db.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } });
  expect(unchanged.revision).toBe(f.campaign.revision); expect(unchanged.conversation).toHaveLength(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(guided.getByRole("button", { name: copy("اطلب اقتراحًا للمراجعة", "Request a proposal to review"), exact: true })).toBeEnabled();
  mkdirSync(artifacts, { recursive: true }); await guided.screenshot({ path: path.join(artifacts, `${info.project.name}-guided-original.png`) });
  await page.getByRole("button", { name: english ? "Switch to Arabic" : "التبديل إلى الإنجليزية", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", english ? "rtl" : "ltr");
  await expect(page.getByRole("list", { name: english ? "المحادثة المحفوظة" : "Saved conversation", exact: true }).getByText(savedTurn, { exact: true })).toBeVisible();
  await expect(page.getByLabel(english ? "وصف الحملة" : "Campaign description", { exact: true })).toHaveValue(originalInput);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: english ? "افتح نفس الحقول بالنموذج" : "Open the same fields in the form", exact: true }).click();
  await expect(page.getByLabel(english ? "اسم الحملة" : "Campaign title", { exact: true })).toHaveValue(originalTitle);
  const foreign = await actor(english ? "en" : "ar"); await login(page, context, foreign, english);
  expect((await page.goto(`/brand/campaigns/${f.campaign.id}`))?.status()).toBe(404);
  await expect(page.getByText(originalSummary, { exact: true })).toHaveCount(0);
});
