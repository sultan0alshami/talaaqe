import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page, TestInfo } from "@playwright/test";
import { openSession, resolveSession } from "../src/lib/identity";
import { SESSION_COOKIE } from "../src/lib/jwt";
import { prisma as sessionDb } from "../src/lib/prisma";
import { taskState, assertLocalTarget, workspace } from "../scripts/task-state.mjs";
import { cleanupReviewedEvidence, reviewedOwnershipFixture } from "../tests/helpers/reviewed-evidence";

// Original two login journeys are preserved. Independently authored recovery
// cases use actual signed native sessions; root alone executes guarded E2E.
// Synthetic policy/campaign/evidence records are not live legal/provider proof.

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
// Native resolveSession below uses the source singleton in this test worker.
test.afterAll(async () => { await sessionDb.$disconnect(); });

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

// New failure-only transport witnesses. No domain/session/producer/clock mock.
// Mutated responses are explicitly labelled and follow actual route.fetch().
function recoveryLocale(info: TestInfo) {
  const english = info.project.name === "english-desktop";
  return { english, label: (ar: string, en: string) => english ? en : ar };
}
function recoveryLatch() { let resolve!: () => void; return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() }; }
function recoveryErrors(page: Page) {
  const seen: string[] = [];
  page.on("pageerror", error => seen.push(error.name));
  page.on("console", message => { if (message.type() === "error" && /hydrat|server.rendered|server HTML|text content.*match/i.test(message.text())) seen.push("HYDRATION_MISMATCH"); });
  return seen;
}
async function recoverySignedSession(f: Awaited<ReturnType<typeof fixture>>, context: BrowserContext) {
  const user = await db.user.findUniqueOrThrow({ where: { id: f.owner } });
  // Actual native session creation checks activity/version/password hash under
  // User locks and captures the current role; native resolution verifies it.
  // Only these new fixtures bypass the login
  // endpoint; the original two journeys retain its real rate-limited coverage.
  const token = await openSession(user.id, user.sessionVersion, user.passwordHash), current = await resolveSession(token);
  if (!current || current.userId !== f.owner) throw new Error("Synthetic matching native signed session did not resolve");
  await context.addCookies([{ name: SESSION_COOKIE, value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  return current;
}
async function recoveryFixture(page: Page, context: BrowserContext, info: TestInfo) {
  const { english, label } = recoveryLocale(info), seen = recoveryErrors(page);
  await context.addCookies([{ name: "infame_lang", value: english ? "en" : "ar", domain: "localhost", path: "/" }]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const f = await fixture(true, english ? "en" : "ar"), c = await candidate(f);
  // Explicit synthetic visibility is asserted after the actual ownership proof
  // chain; the producer and all matching criteria remain the native baseline.
  await db.creator.update({ where: { id: c.id }, data: { state: "PUBLISHED", brandVisible: true } });
  const current = await recoverySignedSession(f, context);
  await page.goto(`/brand/campaigns/${f.campaignId}/matches`);
  const screen = page.getByRole("heading", { name: label("صنّاع المحتوى المناسبون", "Creator matches"), exact: true }).locator("xpath=ancestor::section[1]");
  await expect(screen.getByText("حملة أصلية للاختبار فقط", { exact: true })).toBeVisible();
  await screen.getByRole("button", { name: label("ابدأ المطابقة", "Run matching"), exact: true }).click();
  await expect(screen.getByRole("heading", { name: "صانعة اصطناعية Synthetic creator", exact: true })).toBeVisible();
  const run = await db.matchRun.findFirstOrThrow({ where: { campaignId: f.campaignId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  expect(await db.matchRun.count({ where: { campaignId: f.campaignId } })).toBe(1);
  return { f, c, label, seen, screen, sessionId: current.sessionId, run };
}
async function assertRecoveryPrivacyCleared(page: Page, state: Awaited<ReturnType<typeof recoveryFixture>>) {
  const { f, label, screen } = state;
  await expect(page.getByText("حملة أصلية للاختبار فقط", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "صانعة اصطناعية Synthetic creator", exact: true })).toHaveCount(0);
  await expect(screen.getByRole("article")).toHaveCount(0);
  await expect(screen.getByRole("group", { name: label("عرض القرارات", "Filter decisions"), exact: true })).toHaveCount(0);
  await expect(screen.getByRole("button", { name: label("أعد نفس الطلب", "Retry the same request"), exact: true })).toHaveCount(0);
  await expect(screen.getByRole("button", { name: label("احفظ الصانع", "Save creator"), exact: true })).toHaveCount(0);
  await expect(screen.getByRole("button", { name: label("إلغاء الحفظ", "Unsave"), exact: true })).toHaveCount(0);
  await expect(screen.getByRole("button", { name: label("استبعد", "Dismiss"), exact: true })).toHaveCount(0);
  await expect(screen.getByRole("link", { name: label("جهّز عرضًا", "Prepare offer"), exact: true })).toHaveCount(0);
  await expect(page.locator(`a[href="/brand/campaigns/${f.campaignId}"]`)).toHaveCount(0);
  await expect(screen.getByText("20.000 KWD", { exact: true })).toHaveCount(0);
  await expect(screen.getByRole("button", { name: label("ابدأ المطابقة", "Run matching"), exact: true })).toHaveCount(0);
  await expect(screen.getByRole("button", { name: label("مطابقة جديدة", "Run again"), exact: true })).toHaveCount(0);
}

test("native revoked session malformed401 clears every private matching field and a previously uncertain decision before JSON", async ({ page, context }, info) => {
  const state = await recoveryFixture(page, context, info), { f, c, label, screen } = state;
  const decisionUrl = `${origin}/api/campaigns/${f.campaignId}/matches/decisions`, bodies: string[] = [];
  await page.route(decisionUrl, async route => {
    bodies.push(route.request().postData()!); const actual = await route.fetch(); expect(actual.status()).toBe(200);
    await route.abort("failed"); // Labelled lost native200 reply; actual decision is committed.
  });
  await screen.getByRole("button", { name: label("احفظ الصانع", "Save creator"), exact: true }).click();
  await expect(screen.getByRole("button", { name: label("أعد نفس الطلب", "Retry the same request"), exact: true })).toBeVisible();
  expect((await db.matchDecisionRecord.findUniqueOrThrow({ where: { campaignId_creatorId: { campaignId: f.campaignId, creatorId: c.id } } })).revision).toBe(1);
  await page.unroute(decisionUrl);
  await db.authSession.update({ where: { id: state.sessionId }, data: { revokedAt: new Date() } });
  const denialStatuses: number[] = [];
  const denied = async (route: import("@playwright/test").Route) => {
    const actual = await route.fetch(); expect(actual.status()).toBe(401); denialStatuses.push(actual.status());
    expect(actual.headers()["cache-control"]).toBe("private, no-store");
    await route.fulfill({ response: actual, status: 401, contentType: "application/json", body: "{malformed_native_denial" });
  };
  await page.route(`${origin}/api/campaigns/${f.campaignId}`, denied);
  await page.route(`${origin}/api/campaigns/${f.campaignId}/matches`, denied);
  await screen.getByRole("button", { name: label("حمّل الحالة الحالية", "Load current state"), exact: true }).click();
  await expect.poll(() => denialStatuses.length).toBe(2);
  await assertRecoveryPrivacyCleared(page, state);
  expect(bodies).toHaveLength(1); expect(await db.matchRun.count({ where: { campaignId: f.campaignId } })).toBe(1);
  expect(await db.matchDecisionRecord.count({ where: { campaignId: f.campaignId, creatorId: c.id } })).toBe(1);
  expect(state.seen).toEqual([]);
});

test("native email-unverified403 decision denial clears the campaign and private shortlist without keeping stale actionable cards", async ({ page, context }, info) => {
  const state = await recoveryFixture(page, context, info), { f, c, label, screen } = state;
  await db.user.update({ where: { id: f.owner }, data: { emailVerifiedAt: null } });
  // Session remains current: matching's actual current email gate yields403.
  const cookies = await context.cookies(), current = await resolveSession(cookies.find(cookie => cookie.name === SESSION_COOKIE)!.value);
  expect(current?.userId).toBe(f.owner);
  const decisionUrl = `${origin}/api/campaigns/${f.campaignId}/matches/decisions`, nativeReasons: string[] = [];
  await page.route(decisionUrl, async route => {
    const actual = await route.fetch(); expect(actual.status()).toBe(403);
    const body = await actual.json(); expect(body.error.code).toBe("FORBIDDEN"); nativeReasons.push(body.error.code);
    // The status-first client correctly need not consume this denial body.
    // Prove its genuine native reason before relaying the same response.
    await route.fulfill({ response: actual });
  });
  const received = page.waitForResponse(response => new URL(response.url()).pathname === `/api/campaigns/${f.campaignId}/matches/decisions`);
  await screen.getByRole("button", { name: label("احفظ الصانع", "Save creator"), exact: true }).click();
  const actual = await received; expect(actual.status()).toBe(403); expect(actual.headers()["cache-control"]).toBe("private, no-store");
  expect(nativeReasons).toEqual(["FORBIDDEN"]);
  await assertRecoveryPrivacyCleared(page, state);
  expect(await db.matchDecisionRecord.count({ where: { campaignId: f.campaignId, creatorId: c.id } })).toBe(0);
  expect(await db.matchRun.count({ where: { campaignId: f.campaignId } })).toBe(1); expect(state.seen).toEqual([]);
});

test("a later actual native401 wins over an earlier parallel generic failure and clears private matching state before denial JSON", async ({ page, context }, info) => {
  const state = await recoveryFixture(page, context, info), { f, label, screen } = state;
  const campaignSeen = recoveryLatch(), matchSeen = recoveryLatch(), sendFailure = recoveryLatch(), sendDenial = recoveryLatch();
  const campaignDone = recoveryLatch(), matchDone = recoveryLatch(), nativeDenials: number[] = [];
  let campaignStarted = false, matchStarted = false;
  const campaignUrl = `${origin}/api/campaigns/${f.campaignId}`, matchUrl = campaignUrl + "/matches";
  await page.route(campaignUrl, async route => {
    campaignStarted = true;
    try {
      const actual = await route.fetch(); expect(actual.status()).toBe(200);
      const full = (await actual.json()).data; expect(Array.isArray(full.briefs)).toBe(true); expect(full.id).toBe(f.campaignId);
      // This endpoint's positive payload is full CampaignDTO, never SSR's
      // six-field summary. The labelled fault replaces only transport outcome.
      campaignSeen.resolve(); await sendFailure.promise;
      await route.fulfill({ response: actual, status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "RETRY_REQUIRED" } }) });
    } finally { campaignSeen.resolve(); campaignDone.resolve(); }
  });
  await page.route(matchUrl, async route => {
    matchStarted = true;
    try {
      matchSeen.resolve(); await sendDenial.promise;
      const actual = await route.fetch(); expect(actual.status()).toBe(401); nativeDenials.push(actual.status());
      await route.fulfill({ response: actual, status: 401, contentType: "application/json", body: "{late_malformed_native_denial" });
    } finally { matchSeen.resolve(); matchDone.resolve(); }
  });
  try {
    const firstFailure = page.waitForResponse(response => response.url() === campaignUrl && response.status() === 503);
    await screen.getByRole("button", { name: label("حمّل الحالة الحالية", "Load current state"), exact: true }).click();
    await Promise.all([campaignSeen.promise, matchSeen.promise]);
    await db.authSession.update({ where: { id: state.sessionId }, data: { revokedAt: new Date() } });
    sendFailure.resolve(); await firstFailure; await campaignDone.promise;
    // The generic HTTP response has settled first. An all-settled batch may
    // legitimately keep its loading state until the delayed sibling completes;
    // that sibling's genuine native denial must still win for this same batch.
    await expect(screen.getByText("حملة أصلية للاختبار فقط", { exact: true })).toBeVisible();
    sendDenial.resolve(); await matchDone.promise; expect(nativeDenials).toEqual([401]);
    await assertRecoveryPrivacyCleared(page, state);
    expect(await db.matchRun.count({ where: { campaignId: f.campaignId } })).toBe(1); expect(state.seen).toEqual([]);
  } finally {
    sendFailure.resolve(); sendDenial.resolve();
    await Promise.all([campaignStarted ? campaignDone.promise : Promise.resolve(), matchStarted ? matchDone.promise : Promise.resolve()]);
    await page.unroute(campaignUrl); await page.unroute(matchUrl);
  }
});

test("shape-valid wrong decision200 creator/decision/run/revision retains the exact uncertain command until correct native replay and current read", async ({ page, context }, info) => {
  const state = await recoveryFixture(page, context, info), { f, c, label, screen, run } = state;
  const url = `${origin}/api/campaigns/${f.campaignId}/matches/decisions`, matchUrl = `${origin}/api/campaigns/${f.campaignId}/matches`;
  const currentMatches = (requestUrl: URL) => requestUrl.origin === origin && requestUrl.pathname === new URL(matchUrl).pathname;
  const bodies: string[] = [], incorrect = ["creatorId", "decision", "runId", "revision"] as const;
  let fault = 0, permitCurrentRead = false, verifiedCurrentReads = 0, correctReplays = 0;
  await page.route(currentMatches, async route => {
    expect(new URL(route.request().url()).searchParams.get("runId")).toBe(run.id);
    const actual = await route.fetch(); expect(actual.status()).toBe(200);
    if (permitCurrentRead) { verifiedCurrentReads++; await route.fulfill({ response: actual }); }
    else await route.fulfill({ response: actual, status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "RETRY_REQUIRED" } }) });
  });
  await page.route(url, async route => {
    bodies.push(route.request().postData()!); const actual = await route.fetch(); expect(actual.status()).toBe(200);
    const envelope = await actual.json(), receipt = envelope.data;
    expect(receipt).toMatchObject({ creatorId: c.id, runId: run.id, decision: "SAVED", revision: 1 });
    if (fault < incorrect.length) {
      const field = incorrect[fault++], malformed = { ...receipt };
      if (field === "creatorId" || field === "runId") malformed[field] = randomUUID();
      if (field === "decision") malformed.decision = "DISMISSED";
      if (field === "revision") malformed.revision = 2;
      // Every altered value is individually well formed. Command binding must
      // reject it; a shape-only200 must never acknowledge a different save.
      await route.fulfill({ response: actual, contentType: "application/json", body: JSON.stringify({ ...envelope, data: malformed }) });
    } else { expect(receipt.replayed).toBe(true); correctReplays++; await route.fulfill({ response: actual }); }
  });
  const retry = screen.getByRole("button", { name: label("أعد نفس الطلب", "Retry the same request"), exact: true });
  try {
    await screen.getByRole("button", { name: label("احفظ الصانع", "Save creator"), exact: true }).click();
    for (let index = 0; index < incorrect.length; index++) {
      if (index) await retry.click();
      await expect.poll(() => bodies.length).toBe(index + 1);
      await expect(retry).toBeVisible(); await expect(retry).toBeEnabled();
      await expect(screen.getByText(label("تم حفظ قرارك.", "Your decision was saved."), { exact: true })).toHaveCount(0);
      await expect(screen.getByRole("button", { name: label("إلغاء الحفظ", "Unsave"), exact: true })).toHaveCount(0);
      expect(new Set(bodies).size).toBe(1);
      const stored = await db.matchDecisionRecord.findUniqueOrThrow({ where: { campaignId_creatorId: { campaignId: f.campaignId, creatorId: c.id } } });
      expect(stored).toMatchObject({ revision: 1, decision: "SAVED", runId: run.id });
    }
    permitCurrentRead = true; await retry.click();
    await expect(screen.getByRole("button", { name: label("إلغاء الحفظ", "Unsave"), exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(retry).toHaveCount(0); expect(correctReplays).toBe(1);
    await expect.poll(() => verifiedCurrentReads).toBeGreaterThan(0);
    expect(bodies).toHaveLength(5); expect(new Set(bodies).size).toBe(1);
    const captured = JSON.parse(bodies[0]!); expect(captured).toMatchObject({ creatorId: c.id, runId: run.id, expectedDecisionRevision: 0, decision: "SAVED" });
    expect(await db.matchCommand.count({ where: { campaignId: f.campaignId, actorUserId: f.owner, operationKey: captured.operationKey } })).toBe(1);
    expect(await db.matchDecisionRecord.count({ where: { campaignId: f.campaignId, creatorId: c.id } })).toBe(1);
    expect(await db.matchRun.count({ where: { campaignId: f.campaignId } })).toBe(1); expect(state.seen).toEqual([]);
  } finally { await page.unroute(url); await page.unroute(currentMatches); }
});

// Independently authored native current-read and confirmed-recovery cases.
// Uses their owned fixture sets/cleanup, native signed sessions, real policy and
// producer. No .spec imports, fabricated server data, Date/API/domain mock.

test("latest matching null is a native read success; a six-field SSR summary in full campaign200 preserves the last pair and exact GET retry", async ({ page, context }, info) => {
  const { english, label } = recoveryLocale(info), seen = recoveryErrors(page);
  await context.addCookies([{ name: "infame_lang", value: english ? "en" : "ar", domain: "localhost", path: "/" }]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const f = await fixture(true, english ? "en" : "ar"), c = await candidate(f);
  await db.creator.update({ where: { id: c.id }, data: { state: "PUBLISHED", brandVisible: true } });
  await recoverySignedSession(f, context);
  const empty = await page.request.get(`/api/campaigns/${f.campaignId}/matches`);
  expect(empty.status()).toBe(200); expect((await empty.json()).data).toBeNull();
  expect(await db.matchRun.count({ where: { campaignId: f.campaignId } })).toBe(0);
  await page.goto(`/brand/campaigns/${f.campaignId}/matches`);
  const screen = page.getByRole("heading", { name: label("صنّاع المحتوى المناسبون", "Creator matches"), exact: true }).locator("xpath=ancestor::section[1]");
  await screen.getByRole("button", { name: label("حمّل الحالة الحالية", "Load current state"), exact: true }).click();
  await expect(screen.getByText(label("تم تحميل الحالة الحالية.", "The current state was loaded."), { exact: true })).toBeVisible();
  await expect(screen.getByRole("alert")).toHaveCount(0);
  await expect(screen.getByRole("button", { name: label("ابدأ المطابقة", "Run matching"), exact: true })).toBeEnabled();
  expect(await db.matchRun.count({ where: { campaignId: f.campaignId } })).toBe(0);
  await screen.getByRole("button", { name: label("ابدأ المطابقة", "Run matching"), exact: true }).click();
  await expect(screen.getByRole("heading", { name: "صانعة اصطناعية Synthetic creator", exact: true })).toBeVisible();

  const current = await db.campaign.findUniqueOrThrow({ where: { id: f.campaignId } }), updatedTitle = "عنوان جديد أصلي Native changed title";
  const update = await page.request.post(`/api/campaigns/${f.campaignId}/commands`, { headers: { Origin: origin }, data: {
    operationKey: randomUUID(), expectedRevision: current.revision, action: "UPDATE_FIELDS", payload: { patch: { title: updatedTitle } },
  } });
  expect(update.status()).toBe(200); expect((await update.json()).data.campaign.title).toBe(updatedTitle);
  const campaignUrl = `${origin}/api/campaigns/${f.campaignId}`, matchUrl = campaignUrl + "/matches", requested: string[] = [];
  let corrupt = true;
  await page.route(campaignUrl, async route => {
    requested.push(route.request().url()); const actual = await route.fetch(); expect(actual.status()).toBe(200);
    const body = await actual.json(), full = body.data; expect(Array.isArray(full.briefs)).toBe(true); expect(full.title).toBe(updatedTitle);
    if (!corrupt) { await route.fulfill({ response: actual }); return; }
    const summary = { id: full.id, title: full.title, revision: full.revision, currentBriefVersion: full.currentBriefVersion, status: full.status,
      policyReviewed: !!full.briefs.find((brief: { version: number }) => brief.version === full.currentBriefVersion)?.content.policyReview };
    await route.fulfill({ response: actual, contentType: "application/json", body: JSON.stringify({ ...body, data: summary }) });
  });
  await page.route(matchUrl, async route => {
    requested.push(route.request().url()); const actual = await route.fetch(); expect(actual.status()).toBe(200);
    const body = await actual.json(); expect(body.data.stale).toBe(true); await route.fulfill({ response: actual });
  });
  try {
    await screen.getByRole("button", { name: label("حمّل الحالة الحالية", "Load current state"), exact: true }).click();
    const retry = screen.getByRole("button", { name: label("إعادة محاولة التحميل", "Retry loading"), exact: true });
    await expect(retry).toBeVisible(); await expect(retry).toBeEnabled();
    await expect(screen.getByText("حملة أصلية للاختبار فقط", { exact: true })).toBeVisible();
    await expect(screen.getByText(updatedTitle, { exact: true })).toHaveCount(0);
    await expect(screen.getByText(label("هذه القائمة قديمة", "This shortlist is stale"), { exact: true })).toHaveCount(0);
    await expect(screen.getByText(label("تم تحميل الحالة الحالية.", "The current state was loaded."), { exact: true })).toHaveCount(0);
    expect(requested.sort()).toEqual([campaignUrl, matchUrl].sort());
    corrupt = false; await retry.click();
    await expect(screen.getByText(updatedTitle, { exact: true })).toBeVisible();
    await expect(screen.getByText(label("هذه القائمة قديمة", "This shortlist is stale"), { exact: true })).toBeVisible();
    await expect(retry).toHaveCount(0); expect(requested.filter(url => url === campaignUrl)).toHaveLength(2);
    expect(requested.filter(url => url === matchUrl)).toHaveLength(2);
    expect(await db.matchRun.count({ where: { campaignId: f.campaignId } })).toBe(1); expect(seen).toEqual([]);
  } finally { await page.unroute(campaignUrl); await page.unroute(matchUrl); }
});

test("a validated native decision receipt followed by currentGET503 retains confirmed history and recovers with GET only", async ({ page, context }, info) => {
  const state = await recoveryFixture(page, context, info), { f, c, label, screen, run } = state;
  const decisionUrl = `${origin}/api/campaigns/${f.campaignId}/matches/decisions`, bodies: string[] = [], gets: string[] = [];
  const matches = (url: URL) => url.origin === origin && url.pathname === `/api/campaigns/${f.campaignId}/matches`;
  let permitRead = false;
  await page.route(decisionUrl, async route => {
    bodies.push(route.request().postData()!); const actual = await route.fetch(); expect(actual.status()).toBe(200);
    expect((await actual.json()).data).toMatchObject({ creatorId: c.id, runId: run.id, decision: "SAVED", revision: 1, replayed: false });
    await route.fulfill({ response: actual });
  });
  await page.route(matches, async route => {
    const url = new URL(route.request().url()); expect(route.request().method()).toBe("GET"); expect(url.searchParams.get("runId")).toBe(run.id);
    gets.push(url.href); const actual = await route.fetch(); expect(actual.status()).toBe(200);
    if (permitRead) await route.fulfill({ response: actual });
    else await route.fulfill({ response: actual, status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "RETRY_REQUIRED" } }) });
  });
  try {
    await screen.getByRole("button", { name: label("احفظ الصانع", "Save creator"), exact: true }).click();
    const finish = screen.getByRole("button", { name: label("استكمل تحميل الحالة الحالية", "Finish loading current state"), exact: true });
    await expect(finish).toBeVisible(); await expect(finish).toBeEnabled();
    await expect(screen.getByRole("button", { name: label("أعد نفس الطلب", "Retry the same request"), exact: true })).toHaveCount(0);
    await expect(screen.getByText(label("تم حفظ قرارك.", "Your decision was saved."), { exact: true })).toHaveCount(0);
    expect(bodies).toHaveLength(1); expect(gets).toHaveLength(1);
    expect((await db.matchDecisionRecord.findUniqueOrThrow({ where: { campaignId_creatorId: { campaignId: f.campaignId, creatorId: c.id } } })).revision).toBe(1);
    await finish.click(); await expect.poll(() => gets.length).toBe(2); await expect(finish).toBeEnabled();
    expect(bodies).toHaveLength(1); expect(new Set(gets).size).toBe(1);
    permitRead = true; await finish.click();
    await expect(screen.getByRole("button", { name: label("إلغاء الحفظ", "Unsave"), exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(finish).toHaveCount(0); expect(bodies).toHaveLength(1); expect(gets).toHaveLength(3); expect(new Set(gets).size).toBe(1);
    const captured = JSON.parse(bodies[0]!);
    expect(await db.matchCommand.count({ where: { campaignId: f.campaignId, operationKey: captured.operationKey, actorUserId: f.owner } })).toBe(1);
    expect(await db.matchDecisionRecord.count({ where: { campaignId: f.campaignId, creatorId: c.id } })).toBe(1);
    expect(await db.matchRun.count({ where: { campaignId: f.campaignId } })).toBe(1); expect(state.seen).toEqual([]);
  } finally { await page.unroute(decisionUrl); await page.unroute(matches); }
});

test("actual policy reviewer suspension preserves the owned campaign title but removes cached actionable matching cards", async ({ page, context }, info) => {
  const state = await recoveryFixture(page, context, info), { f, c, label, screen } = state;
  const brief = await db.campaignBrief.findUniqueOrThrow({ where: { campaignId_version: { campaignId: f.campaignId, version: 1 } } });
  const content = JSON.parse(JSON.stringify(brief.content)), policyId = content.requirements.mandatoryPolicyVersionIds[0];
  expect(typeof policyId).toBe("string");
  const policy = await db.policyVersion.findUniqueOrThrow({ where: { id: policyId } });
  if (!policy.reviewedBy || !users.includes(policy.reviewedBy)) throw new Error("Synthetic policy suspension needs its owned actual reviewer");
  const ownership = await db.socialAccount.findUniqueOrThrow({ where: { id: c.accountId }, select: { ownershipReviewedBy: true } });
  expect(policy.reviewedBy).not.toBe(ownership.ownershipReviewedBy); expect(policy.reviewedBy).not.toBe(f.owner);
  // Reviewed policy metadata is immutable. Suspend only its distinct owned
  // reviewer; the unchanged native policy reader must refuse that current basis.
  await db.user.update({ where: { id: policy.reviewedBy }, data: { active: false } });
  expect(await db.policyVersion.findUniqueOrThrow({ where: { id: policyId } })).toEqual(policy);
  const matchUrl = `${origin}/api/campaigns/${f.campaignId}/matches`, reasons: string[] = [];
  await page.route(matchUrl, async route => {
    const actual = await route.fetch(); expect(actual.status()).toBe(503); expect(actual.headers()["cache-control"]).toBe("private, no-store");
    const body = await actual.json(); expect(body.error.code).toBe("POLICY_UNAVAILABLE"); reasons.push(body.error.code);
    await route.fulfill({ response: actual }); // Genuine policy denial, no invented producer result.
  });
  try {
    await screen.getByRole("button", { name: label("حمّل الحالة الحالية", "Load current state"), exact: true }).click();
    await expect(screen.getByRole("article")).toHaveCount(0);
    await expect(screen.getByRole("heading", { name: "صانعة اصطناعية Synthetic creator", exact: true })).toHaveCount(0);
    await expect(screen.getByText("حملة أصلية للاختبار فقط", { exact: true })).toBeVisible();
    await expect(screen.getByText(label("جاهزية المطابقة", "Matching readiness"), { exact: true })).toBeVisible();
    await expect(screen.getByRole("button", { name: label("احفظ الصانع", "Save creator"), exact: true })).toHaveCount(0);
    await expect(screen.getByRole("button", { name: label("استبعد", "Dismiss"), exact: true })).toHaveCount(0);
    await expect(screen.getByRole("link", { name: label("جهّز عرضًا", "Prepare offer"), exact: true })).toHaveCount(0);
    expect(reasons).toEqual(["POLICY_UNAVAILABLE"]); expect(await db.matchRun.count({ where: { campaignId: f.campaignId } })).toBe(1);
    expect(await db.policyVersion.findUniqueOrThrow({ where: { id: policyId } })).toEqual(policy);
    expect(await db.matchDecisionRecord.count({ where: { campaignId: f.campaignId, creatorId: c.id } })).toBe(0); expect(state.seen).toEqual([]);
  } finally { await page.unroute(matchUrl); }
});
