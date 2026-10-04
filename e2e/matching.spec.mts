import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { taskState, assertLocalTarget, workspace } from "../scripts/task-state.mjs";
import { cleanupReviewedEvidence, reviewedOwnershipFixture } from "../tests/helpers/reviewed-evidence";

const state = taskState();
if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("Matching browser journeys require exact E2E task target");
const db = new PrismaClient(), users: string[] = [], campaigns: string[] = [], creators: string[] = [], policies: string[] = [], assets: string[] = [];
const origin = "http://localhost:3100";
test.beforeAll(async () => {
  const marker = await db.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id, kind, current_database() AS db, host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (marker.length !== 1 || marker[0].id !== state.id || marker[0].kind !== "e2e" || marker[0].db !== state.targets.e2e || marker[0].host !== "127.0.0.1") throw new Error("Incorrect matching E2E database identity");
});
test.afterEach(async () => {
  await db.campaign.deleteMany({ where: { id: { in: campaigns.splice(0) } } });
  await db.creator.deleteMany({ where: { id: { in: creators.splice(0) } } });
  await db.policyVersion.deleteMany({ where: { id: { in: policies.splice(0) } } });
  await db.privateAsset.deleteMany({ where: { id: { in: assets.splice(0) } } });
  await cleanupReviewedEvidence(db, users, "e2e");
  await db.user.deleteMany({ where: { id: { in: users.splice(0) } } });
});
test.afterAll(async () => { await db.$disconnect(); });

async function fixture(reviewed: boolean, language: "ar" | "en") {
  const owner = randomUUID(), campaignId = randomUUID(), email = `${owner}@example.invalid`, password = `Synthetic matching ${randomUUID()}`;
  users.push(owner); campaigns.push(campaignId);
  const now = new Date(), period = { startsAt: new Date(now.getTime() + 10 * 86400000).toISOString(), endsAt: new Date(now.getTime() + 20 * 86400000).toISOString(), timeZone: "Asia/Kuwait" };
  await db.user.create({ data: { id: owner, role: "BRAND", name: "Synthetic browser brand", email, language, passwordHash: await bcrypt.hash(password, 12), emailVerifiedAt: now, isTest: true } });
  const brand = await db.brand.create({ data: { userId: owner, slug: `synthetic-browser-${owner.slice(0,8)}`, name: "Synthetic browser brand", countryCode: "KW", isTest: true } });
  const fields = { originalLanguage: "ar", title: "حملة أصلية للاختبار فقط", productService: "Synthetic product", goal: "AWARENESS", summary: "Synthetic matching browser test", marketCountryCodes: ["KW"], targetAgeBuckets: ["18-24"], targetGenders: ["FEMALE"], targetCountryCodes: ["KW"], targetCityKeys: [], contentLanguages: ["ar"], dialects: ["ar-Gulf"], nicheSlugs: ["beauty"], deliverables: [{ platform: "INSTAGRAM", format: "STORY", count: 2 }, { platform: "INSTAGRAM", format: "REEL", count: 1 }], budget: { amountMinor: "123456", currencyCode: "KWD" }, desiredCreatorCount: 3, impressionsTarget: 10001, period, physicalPresenceRequired: false, presenceCountryCodes: [], travelAllowed: false, tone: "Synthetic", noGoTopics: [], preferredTiers: [], dataVerificationRequired: false, preferredLicencePolicyIds: [], usageRights: "Synthetic no publication", kpis: [], assumptions: [], openQuestions: [] };
  const policyIds: string[] = [];
  if (reviewed) {
    const reviewer = randomUUID(), policyId = randomUUID(); users.push(reviewer); policies.push(policyId); policyIds.push(policyId);
    await db.user.create({ data: { id: reviewer, role: "ADMIN", name: "Synthetic legal browser reviewer", email: `${reviewer}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: now, isTest: true } });
    const evidence = await db.privateAsset.create({ data: { ownerUserId: reviewer, purpose: "LEGAL_POLICY_REVIEW", contentType: "text/plain", size: 1, storageKey: `synthetic:${policyId}`, checksum: "synthetic-no-live-legal-evidence" } }); assets.push(evidence.id);
    await db.policyVersion.create({ data: { id: policyId, kind: "MARKET", countryCodes: ["KW"], status: "VERIFIED", evidenceAssetId: evidence.id, reviewedBy: reviewer, reviewedAt: now, createdAt: new Date(now.getTime() - 60000), expiresAt: new Date(period.endsAt), content: { schemaVersion: 1, kind: "MARKET", marketCountryCode: "KW", brandCountryCodes: ["KW"], creatorCountryCodes: ["GB"], licenceRequired: false, licencePolicyId: null, reviewReference: "Synthetic test-only browser policy reference", reviewedBasis: "FOUNDER_APPROVED_LEGAL_REVIEW" } } });
  }
  const requirements = { ...fields, campaignId, version: 1, brandCountryCode: "KW", mandatoryPolicyVersionIds: policyIds };
  await db.campaign.create({ data: { id: campaignId, brandId: brand.id, title: fields.title, status: "BRIEF_APPROVED", currentBriefVersion: 1, input: { schemaVersion: 1, fieldsRevision: 1, fields, proposals: [], clarificationCount: 0 } } });
  // Explicit test-only context exercises a reviewed branch. No provider or legal
  // acceptance is asserted, and production/test data remain separate and owned.
  await db.campaignBrief.create({ data: { campaignId, version: 1, inputRevision: 1, approvedAt: now, approvedByUserId: owner, content: { schemaVersion: 1, requirements, inputRevision: 1, approvedByUserId: owner, policyReview: reviewed ? { reviewed: true, resolverVersion: "synthetic-reviewed-db-fixture", reviewedAt: now.toISOString(), marketCountryCodes: ["KW"], mandatoryPolicyVersionIds: policyIds } : null } } });
  return { owner, campaignId, email, password, now, period };
}
async function candidate(f: Awaited<ReturnType<typeof fixture>>) {
  const userId = randomUUID(), reviewerId = randomUUID(), id = randomUUID(), handle = `synthetic_${id.replaceAll("-", "").slice(0,18)}`; users.push(userId, reviewerId); creators.push(id);
  await db.user.createMany({ data: [{ id: userId, role: "CREATOR", name: "Synthetic browser creator", email: `${userId}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: f.now, isTest: false }, { id: reviewerId, role: "ADMIN", name: "Synthetic browser reviewer", email: `${reviewerId}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: f.now, isTest: false }] });
  // Eligibility excludes isTest records. This isolated, named synthetic row uses
  // isTest=false intentionally to exercise the actual permission gate.
  await db.creator.create({ data: { id, userId, displayName: "صانعة اصطناعية Synthetic creator", handle, countryCode: "GB", timeZone: "Asia/Kuwait", languages: ["ar"], dialects: ["ar-Gulf"], state: "PUBLISHED", isTest: false, brandVisible: true, publicConsentAt: f.now, availability: { status: "AVAILABLE", ...f.period, confirmedAt: f.now.toISOString() }, profileFacts: { ratesVisibility: "BRAND_ONLY", nicheSlugs: { value: ["beauty"], source: "SELF_REPORTED", evidenceAt: f.now.toISOString(), approvedAt: f.now.toISOString(), brandVisible: true, publicVisible: false } } } });
  const account = await db.socialAccount.create({ data: { creatorId: id, platform: "INSTAGRAM", handle, intendedConfirmedAt: f.now, consentAt: f.now, factsApprovedAt: f.now, brandVisible: true, supportedFormats: ["STORY", "REEL"] } });
  await reviewedOwnershipFixture(db, userId, reviewerId, account.id, "e2e", f.now);
  await db.socialAccount.update({ where: { id: account.id }, data: { brandVisible: true } });
  await db.creator.update({ where: { id }, data: { primaryAccountId: account.id } });
  const dimension = (key: string) => ({ value: [{ key, percent: 100 }], visibility: "BRAND_ONLY" });
  const window = { startsAt: new Date(f.now.getTime() - 30 * 86400000).toISOString(), endsAt: f.now.toISOString(), timeZone: "Asia/Kuwait" };
  await db.metricsSnapshot.create({ data: { accountId: account.id, source: "SELF_REPORTED", observedAt: f.now, approvedAt: f.now, approvedBy: "synthetic-review", reviewStatus: "VERIFIED", mappingRevision: 1, followers: BigInt(10000), engagementRate: "3.2", engagementContext: { unit: "PERCENT", window, definition: "Synthetic engagements/followers", visibility: "BRAND_ONLY" }, demographics: { age: dimension("18-24"), gender: dimension("FEMALE"), countries: dimension("KW") }, formatMetrics: [{ format: "STORY", value: 5000, unit: "IMPRESSIONS", window, definition: "Synthetic story mean", visibility: "BRAND_ONLY" }] } });
  await db.creatorRate.createMany({ data: [{ creatorId: id, platform: "INSTAGRAM", format: "STORY", currency: "KWD", amountMinor: BigInt(10000) }, { creatorId: id, platform: "INSTAGRAM", format: "REEL", currency: "SAR", amountMinor: BigInt(5000) }] });
  return { id, accountId: account.id };
}

test("reviewed-policy readiness is honest, read-only and keyboard accessible in AR/EN", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop", label = (ar: string, en: string) => english ? en : ar;
  if (english) await context.addCookies([{ name: "infame_lang", value: "en", domain: "localhost", path: "/" }]);
  const f = await fixture(false, english ? "en" : "ar");
  expect((await page.request.post("/api/auth/login", { headers: { Origin: origin }, data: { email: f.email, password: f.password } })).status()).toBe(200);
  await page.goto(`/brand/campaigns/${f.campaignId}/matches`);
  await expect(page.getByRole("heading", { name: label("صنّاع المحتوى المناسبون", "Creator matches"), exact: true })).toBeVisible();
  await expect(page.getByText(label("جاهزية المطابقة", "Matching readiness"), { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: label("ابدأ المطابقة", "Run matching"), exact: true })).toBeDisabled();
  expect(await db.matchRun.count({ where: { campaignId: f.campaignId } })).toBe(0);
  await page.keyboard.press("Tab"); await expect(page.getByRole("link", { name: label("انتقل للمحتوى", "Skip to content"), exact: true })).toBeFocused();
  await page.keyboard.press("Enter"); await expect(page.locator("#infame-main")).toBeFocused();
  await page.keyboard.press("Tab"); await expect(page.getByRole("link", { name: label("ارجع للموجز", "Back to brief"), exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const languageToggle = page.getByRole("button", { name: english ? "Switch to Arabic" : "التبديل إلى الإنجليزية", exact: true });
  await expect(languageToggle).toBeVisible();
  await languageToggle.click();
  await expect(page.locator("html")).toHaveAttribute("lang", english ? "ar" : "en");
  await expect(page.locator("html")).toHaveAttribute("dir", english ? "rtl" : "ltr");
  await expect(page.getByText("حملة أصلية للاختبار فقط", { exact: true })).toBeVisible();
  expect(await db.matchRun.count({ where: { campaignId: f.campaignId } })).toBe(0);
  const directory = path.join(workspace, ".infame", "artifacts"); mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${info.project.name}-matching-policy-readiness.png`), fullPage: true });
});

test("actual matching request, partial quote, safe save replay, stale state and permission revocation", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop", label = (ar: string, en: string) => english ? en : ar;
  if (english) await context.addCookies([{ name: "infame_lang", value: "en", domain: "localhost", path: "/" }]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const f = await fixture(true, english ? "en" : "ar"), c = await candidate(f);
  expect((await page.request.post("/api/auth/login", { headers: { Origin: origin }, data: { email: f.email, password: f.password } })).status()).toBe(200);
  await page.goto(`/brand/campaigns/${f.campaignId}/matches`);
  expect(await db.matchRun.count({ where: { campaignId: f.campaignId } })).toBe(0);
  let release!: () => void, locked!: () => void;
  const ready = new Promise<void>((resolve) => { locked = resolve; }), wait = new Promise<void>((resolve) => { release = resolve; });
  const blocker = db.$transaction(async (tx) => { await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id=${f.campaignId} FOR UPDATE`; locked(); await wait; }, { timeout: 15000 });
  await ready;
  try {
    await page.getByRole("button", { name: label("ابدأ المطابقة", "Run matching"), exact: true }).click();
    await expect(page.getByText(label("جارٍ تنفيذ الطلب…", "Processing your request…"), { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: label("ابدأ المطابقة", "Run matching"), exact: true })).toBeDisabled();
  } finally { release(); await blocker; }
  await expect(page.getByRole("heading", { name: "صانعة اصطناعية Synthetic creator", exact: true })).toBeVisible();
  await expect(page.getByText(label("تغطية جزئية", "Partial coverage"), { exact: true })).toBeVisible();
  await expect(page.getByText("20.000 KWD", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(label("فرضية من المتابعين", "Follower hypothesis"), { exact: false })).toBeVisible();
  await page.getByText(label("التفسير ومصادر البيانات", "Explanation and data sources"), { exact: true }).focus();
  await page.keyboard.press("Space"); await expect(page.locator("details")).toHaveAttribute("open", "");
  await expect(page.getByText(label("بيانات ذكرها صاحب الحساب", "Self-reported data"), { exact: false }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.route("**/matches/decisions", async (route) => { await route.fetch(); await route.abort("failed"); });
  await page.getByRole("button", { name: label("احفظ الصانع", "Save creator"), exact: true }).click();
  await expect(page.getByRole("button", { name: label("أعد نفس الطلب", "Retry the same request"), exact: true })).toBeVisible();
  await page.unroute("**/matches/decisions");
  await page.getByRole("button", { name: label("أعد نفس الطلب", "Retry the same request"), exact: true }).click();
  await expect(page.getByRole("button", { name: label("إلغاء الحفظ", "Unsave"), exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await db.matchDecisionRecord.count({ where: { campaignId: f.campaignId, creatorId: c.id } })).toBe(1);
  expect((await db.matchDecisionRecord.findUniqueOrThrow({ where: { campaignId_creatorId: { campaignId: f.campaignId, creatorId: c.id } } })).revision).toBe(1);
  const directory = path.join(workspace, ".infame", "artifacts"); mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${info.project.name}-matching-partial-quote.png`), fullPage: true });
  await db.campaign.update({ where: { id: f.campaignId }, data: { currentBriefVersion: null, status: "DRAFT", revision: { increment: 1 } } });
  await page.getByRole("button", { name: label("حمّل الحالة الحالية", "Load current state"), exact: true }).click();
  await expect(page.getByText(label("هذه القائمة قديمة", "This shortlist is stale"), { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: label("إلغاء الحفظ", "Unsave"), exact: true })).toBeDisabled();
  await db.socialAccount.update({ where: { id: c.accountId }, data: { brandVisible: false } });
  await page.getByRole("button", { name: label("حمّل الحالة الحالية", "Load current state"), exact: true }).click();
  await expect(page.getByRole("heading", { name: "صانعة اصطناعية Synthetic creator", exact: true })).toHaveCount(0);
  expect(await db.matchRun.count({ where: { campaignId: f.campaignId } })).toBe(1);
});
