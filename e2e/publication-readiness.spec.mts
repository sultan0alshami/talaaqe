import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { expect, test, type Page, type BrowserContext, type TestInfo } from "@playwright/test";
import { assertLocalTarget, taskState, workspace } from "../scripts/task-state.mjs";
import { prisma as db } from "../src/lib/prisma";
import { openSession, resolveSession } from "../src/lib/identity";
import { SESSION_COOKIE } from "../src/lib/jwt";
import { canonicalHash } from "../src/lib/onboarding/drafts";
import { cleanupReviewedEvidence, reviewedOwnershipFixture, reviewedRepresentativeFixture } from "../tests/helpers/reviewed-evidence";

// Independent native browser acceptance. Root alone executes guarded targets.
// Real signed native sessions, GET/commands and local proof
// bytes use explicit synthetic/non-test fixture flags; no live provider/legal or
// identity acceptance is claimed. Fault delivery follows actual native fetch.
const state = taskState(), origin = "http://localhost:3100";
if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("Publication browser fixtures require the exact guarded E2E target");
const users = new Set<string>(), creators = new Set<string>(), brands = new Set<string>(), errors = new WeakMap<Page, string[]>();
const originalBio = "  نبذة أصلية محفوظة\nOriginal portfolio words stay in their original language.  ";
const privateCanary = "synthetic private readiness transcript/contact/facts";
test.setTimeout(60000);
test.beforeEach(async ({ page }) => {
  const seen: string[] = []; errors.set(page, seen);
  page.on("pageerror", error => seen.push(error.name));
  page.on("console", message => { if (message.type() === "error" && /hydrat|server.rendered|server HTML|text content.*match/i.test(message.text())) seen.push("HYDRATION_MISMATCH"); });
});
test.afterEach(async ({ page }) => {
  await db.creator.deleteMany({ where: { id: { in: [...creators] } } });
  await db.brand.deleteMany({ where: { id: { in: [...brands] } } });
  await cleanupReviewedEvidence(db, [...users], "e2e");
  await db.user.deleteMany({ where: { id: { in: [...users] } } });
  users.clear(); creators.clear(); brands.clear(); expect(errors.get(page) ?? [], "Actual browser page errors/hydration metadata").toEqual([]);
});
test.afterAll(async () => { await db.$disconnect(); });
function locale(info: TestInfo) {
  const english = info.project.name === "english-desktop";
  return { english, copy: (ar: string, en: string) => english ? en : ar };
}
async function person(role: "CREATOR" | "BRAND" | "ADMIN", english: boolean) {
  const id = randomUUID(), at = new Date(Date.now() - 120000); users.add(id);
  const user = await db.user.create({ data: { id, role, active: true, isTest: role === "ADMIN", language: english ? "en" : "ar",
    name: "Synthetic publication browser actor", email: `${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: at } });
  return { user, at };
}
async function signed(context: BrowserContext, subject: Awaited<ReturnType<typeof person>>, english: boolean) {
  const token = await openSession(subject.user.id, subject.user.sessionVersion, subject.user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Synthetic publication native signed session did not resolve");
  await context.addCookies([{ name: SESSION_COOKIE, value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "infame_lang", value: english ? "en" : "ar", domain: "localhost", path: "/" }]);
  return session;
}
async function fixture(role: "CREATOR" | "BRAND", context: BrowserContext, english: boolean, prove = true, essentials = true) {
  const owner = await person(role, english), admin = await person("ADMIN", english), suffix = randomUUID().replace(/-/g, "").slice(0, 16), at = owner.at;
  let profileId: string, handle: string, accountId: string | null = null, accountHandle: string | null = null;
  if (role === "CREATOR") {
    handle = "check_" + suffix;
    const creator = await db.creator.create({ data: { userId: owner.user.id, handle, displayName: "اسم أصلي Synthetic publication profile", bio: originalBio,
      state: "PRIVATE", isTest: false, countryCode: "KW", timeZone: "Asia/Kuwait", languages: ["ar", "en"], nicheIds: ["tech"], currency: essentials ? "KWD" : null,
      profileFacts: { mappingHash: canonicalHash({}) } } }); creators.add(creator.id); profileId = creator.id;
    accountHandle = "proof_" + suffix;
    const account = await db.socialAccount.create({ data: { creatorId: creator.id, platform: "INSTAGRAM", handle: accountHandle,
      intendedConfirmedAt: at, consentAt: at, providerAccountId: "synthetic-private-provider-" + suffix } }); accountId = account.id;
    if (prove) await reviewedOwnershipFixture(db, owner.user.id, admin.user.id, account.id, "e2e", at);
    await db.creator.update({ where: { id: profileId }, data: { primaryAccountId: account.id, state: "PRIVATE" } });
  } else {
    handle = "check-" + suffix;
    const brand = await db.brand.create({ data: { userId: owner.user.id, slug: handle, name: "شركة أصلية Synthetic publication company", description: originalBio,
      state: "PRIVATE", isTest: false, countryCode: "KW", timeZone: "Asia/Kuwait", profileFacts: { languages: ["ar"], targetMarkets: ["KW"],
        preferredCurrency: "KWD", noWebsite: true, contactName: privateCanary, representativeRole: "Synthetic owner" } } }); brands.add(brand.id); profileId = brand.id;
    if (prove) await reviewedRepresentativeFixture(db, owner.user.id, admin.user.id, profileId, "e2e", at);
  }
  const draft = await db.onboardingDraft.create({ data: { userId: owner.user.id, kind: role, step: "PREVIEW",
    input: { version: 1, answers: {}, sources: {}, facts: {}, generatedSectionsStale: false }, transcript: [{ role: "user", text: privateCanary, ts: at.getTime() }] } });
  const content = { title: "Original publication portfolio", bio: originalBio, sections: [], method: "APPROVED_FACT_TEMPLATE" };
  if (role === "CREATOR") await db.portfolioVersion.create({ data: { creatorId: profileId, version: 1, inputRevision: 1, approvedAt: at, createdAt: at, content } });
  else await db.brandPortfolioVersion.create({ data: { brandId: profileId, version: 1, inputRevision: 1, approvedAt: at, createdAt: at, content } });
  const session = await signed(context, owner, english);
  return { role, owner, admin, profileId, handle, accountId, accountHandle, draft, session };
}
function panel(page: Page, copy: ReturnType<typeof locale>["copy"]) {
  return page.getByRole("region", { name: copy("مراجعة متطلبات النشر", "Publication readiness"), exact: true });
}
const readinessUrl = (url: URL) => url.origin === origin && url.pathname === "/api/readiness/publication";
async function step4(page: Page, copy: ReturnType<typeof locale>["copy"]) {
  await page.getByRole("navigation", { name: copy("خطوات الملف", "Profile steps"), exact: true }).getByRole("button", { name: copy("5. الملف والمشاركة", "5. Portfolio & sharing"), exact: true }).click();
}
async function readNative(page: Page, query = "") {
  const response = await page.request.get("/api/readiness/publication" + query); expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("private, no-store"); const body = await response.json();
  expect(JSON.stringify(body)).not.toContain(privateCanary); return body.data;
}

test("native CREATOR overview and step4 checklist never publish until explicit original consent", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await fixture("CREATOR", context, english);
  expect(await readNative(page)).toMatchObject({ status: "READY_FOR_REVIEW", requiresExplicitPublicationConsent: true });
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.goto("/creator");
  await expect(panel(page, copy).getByRole("heading", { name: copy("المتطلبات جاهزة لمراجعتك", "Ready for your review"), exact: true })).toBeVisible();
  await expect(panel(page, copy).getByRole("link", { name: copy("مراجعة الملف والمشاركة", "Review portfolio and sharing"), exact: true })).toHaveAttribute("href", "/creator/onboarding");
  expect((await db.creator.findUniqueOrThrow({ where: { id: f.profileId } })).publicConsentAt).toBeNull();
  expect(await db.draftCommand.count({ where: { draftId: f.draft.id } })).toBe(0); expect(await db.sourceJob.count({ where: { draftId: f.draft.id } })).toBe(0);
  const artifacts = path.join(workspace, ".infame", "artifacts"); mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, `${info.project.name}-publication-readiness-overview.png`), fullPage: true });
  await panel(page, copy).getByRole("link", { name: copy("مراجعة الملف والمشاركة", "Review portfolio and sharing"), exact: true }).click(); await step4(page, copy);
  await expect(panel(page, copy).getByRole("heading", { name: copy("المتطلبات جاهزة لمراجعتك", "Ready for your review"), exact: true })).toBeVisible();
  const consent = page.getByRole("checkbox", { name: copy("أوافق على نشر الأقسام الظاهرة للعموم بعد استيفاء الإثباتات المطلوبة", "I consent to publishing the visible sections after required evidence is accepted"), exact: true });
  const publish = page.getByRole("button", { name: copy("انشر الملف", "Publish profile"), exact: true });
  await expect(consent).not.toBeChecked(); await expect(publish).toBeDisabled();
  await panel(page, copy).getByRole("button", { name: copy("تقييم المتطلبات الحالية", "Assess current requirements"), exact: true }).click();
  await expect(panel(page, copy).getByRole("status")).toHaveText(copy("اكتمل تقييم المتطلبات الحالية.", "The current requirements assessment is complete."));
  expect((await db.creator.findUniqueOrThrow({ where: { id: f.profileId } })).state).toBe("PRIVATE");
  await page.setViewportSize({ width: 360, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(artifacts, `${info.project.name}-publication-readiness-step4-360.png`), fullPage: true });
  await consent.check(); await publish.click(); await expect(page.getByText(copy("تم نشر ملفك.", "Your profile is published."), { exact: true })).toBeVisible();
  const saved = await db.creator.findUniqueOrThrow({ where: { id: f.profileId } }); expect(saved.state).toBe("PUBLISHED"); expect(saved.publicConsentAt).not.toBeNull();
  expect((await db.socialAccount.findUniqueOrThrow({ where: { id: f.accountId! } })).publicVisible).toBe(true);
  expect((await page.request.get(`/@${f.handle}`)).status()).toBe(200);
});

test("native representation remedy and internal essentials step work; version/account changes refetch the actual selection", async ({ page, context }, info) => {
  const { english, copy } = locale(info), b = await fixture("BRAND", context, english, false);
  await page.goto("/brand");
  await expect(panel(page, copy).getByRole("heading", { name: copy("إثبات تمثيل الشركة مطلوب", "Company representation proof is required"), exact: true })).toBeVisible();
  await expect(panel(page, copy).getByRole("link", { name: copy("مراجعة إثبات تمثيل الشركة", "Review company representation evidence"), exact: true })).toHaveAttribute("href", "/brand/evidence#brand-representative-title");
  await reviewedRepresentativeFixture(db, b.owner.user.id, b.admin.user.id, b.profileId, "e2e", b.owner.at);
  await panel(page, copy).getByRole("button", { name: copy("تقييم المتطلبات الحالية", "Assess current requirements"), exact: true }).click();
  await expect(panel(page, copy).getByRole("heading", { name: copy("المتطلبات جاهزة لمراجعتك", "Ready for your review"), exact: true })).toBeVisible();
  expect((await db.brand.findUniqueOrThrow({ where: { id: b.profileId } })).state).toBe("PRIVATE");
  const f = await fixture("CREATOR", context, english, true, false); await page.goto("/creator/onboarding"); await step4(page, copy);
  await panel(page, copy).getByRole("button", { name: copy("إكمال الأساسيات", "Complete essentials"), exact: true }).click();
  await expect(page.getByRole("navigation", { name: copy("خطوات الملف", "Profile steps"), exact: true }).getByRole("button", { name: copy("4. الأساسيات", "4. Essentials"), exact: true })).toHaveAttribute("aria-current", "step");
  expect(new URL(page.url()).pathname).toBe("/creator/onboarding"); expect(new URL(page.url()).search).toBe("");
  await db.creator.update({ where: { id: f.profileId }, data: { currency: "KWD" } }); await step4(page, copy);
  await expect(panel(page, copy).getByRole("heading", { name: copy("المتطلبات جاهزة لمراجعتك", "Ready for your review"), exact: true })).toBeVisible();
  const emptied = page.waitForResponse(response => { const url = new URL(response.url()); return readinessUrl(url) && url.searchParams.get("visibleAccountIds") === "[]"; });
  await page.getByRole("checkbox", { name: `INSTAGRAM @${f.accountHandle}`, exact: true }).uncheck();
  expect((await emptied).status()).toBe(200);
  const changed = page.waitForResponse(response => { const url = new URL(response.url()); return readinessUrl(url) && url.searchParams.get("portfolioVersion") === "2" && url.searchParams.get("visibleAccountIds") === "[]"; });
  await page.getByRole("button", { name: copy("أنشئ نسخة جديدة", "Create new version"), exact: true }).click(); expect((await changed).status()).toBe(200);
  await expect(panel(page, copy).getByRole("heading", { name: copy("راجع نسخة الملف الحالية واعتمدها", "Review and approve the current portfolio"), exact: true })).toBeVisible();
  expect((await db.creator.findUniqueOrThrow({ where: { id: f.profileId } })).publicConsentAt).toBeNull();
});

test("native200-backed503 and invalid200 retain only historical assessment and retry the exact captured GET", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await fixture("CREATOR", context, english); await page.goto("/creator");
  const region = panel(page, copy);
  await expect(region.getByRole("heading", { name: copy("المتطلبات جاهزة لمراجعتك", "Ready for your review"), exact: true })).toBeVisible();
  const previousTime = await region.locator("time").getAttribute("datetime"), urls: string[] = []; let fault = 0;
  await page.route(readinessUrl, async route => {
    urls.push(route.request().url()); const actual = await route.fetch(); expect(actual.status()).toBe(200);
    if (fault++ === 0) await route.fulfill({ response: actual, status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "RETRY_REQUIRED" } }) });
    else if (fault === 2) await route.fulfill({ response: actual, contentType: "application/json", body: JSON.stringify({ data: { status: "READY_FOR_REVIEW" } }) });
    else await route.fulfill({ response: actual });
  });
  try {
    await region.getByRole("button", { name: copy("تقييم المتطلبات الحالية", "Assess current requirements"), exact: true }).click();
    const retry = region.getByRole("button", { name: copy("إعادة التقييم نفسه", "Retry the same assessment"), exact: true });
    for (let index = 0; index < 2; index++) {
      if (index) await retry.click(); await expect(retry).toBeVisible(); await expect(retry).toBeEnabled();
      await expect(region.getByRole("heading", { name: copy("نتيجة سابقة — تحتاج تقييمًا جديدًا", "Previous result — a fresh assessment is needed"), exact: true })).toBeVisible();
      await expect(region.getByRole("heading", { name: copy("المتطلبات جاهزة لمراجعتك", "Ready for your review"), exact: true })).toHaveCount(0);
      await expect(region.getByRole("link", { name: copy("مراجعة الملف والمشاركة", "Review portfolio and sharing"), exact: true })).toHaveCount(0);
      expect(await region.locator("time").getAttribute("datetime")).toBe(previousTime); expect(urls).toHaveLength(index + 1);
    }
    await retry.click(); await expect(region.getByRole("heading", { name: copy("المتطلبات جاهزة لمراجعتك", "Ready for your review"), exact: true })).toBeVisible();
    expect(urls).toHaveLength(3); expect(new Set(urls).size).toBe(1);
    expect((await db.creator.findUniqueOrThrow({ where: { id: f.profileId } })).publicConsentAt).toBeNull(); expect(await db.draftCommand.count({ where: { draftId: f.draft.id } })).toBe(0);
  } finally { await page.unroute(readinessUrl); }
});

test("actual signed ADMIN403 and revoked own-session401 clear the panel snapshot before malformed denial JSON", async ({ page, context }, info) => {
  const { english, copy } = locale(info);
  for (const status of [403, 401]) {
    const f = await fixture(status === 403 ? "CREATOR" : "BRAND", context, english); await page.goto(status === 403 ? "/creator" : "/brand");
    const region = panel(page, copy); await expect(region.getByRole("heading", { name: copy("المتطلبات جاهزة لمراجعتك", "Ready for your review"), exact: true })).toBeVisible();
    if (status === 403) await signed(context, f.admin, english);
    else await db.authSession.update({ where: { id: f.session.sessionId }, data: { revokedAt: new Date() } });
    const nativeReasons: string[] = [];
    await page.route(readinessUrl, async route => {
      const actual = await route.fetch(); expect(actual.status()).toBe(status); expect(actual.headers()["cache-control"]).toBe("private, no-store");
      const body = await actual.json(); expect(body.error.code).toBe(status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN"); nativeReasons.push(body.error.code);
      await route.fulfill({ response: actual, status, contentType: "application/json", body: "{malformed_actual_native_denial" });
    });
    try {
      await region.getByRole("button", { name: copy("تقييم المتطلبات الحالية", "Assess current requirements"), exact: true }).click();
      await expect(region.getByRole("alert")).toBeVisible(); await expect(region.locator("time")).toHaveCount(0);
      await expect(region.getByRole("heading", { name: copy("المتطلبات جاهزة لمراجعتك", "Ready for your review"), exact: true })).toHaveCount(0);
      await expect(region.getByRole("button", { name: copy("إعادة التقييم نفسه", "Retry the same assessment"), exact: true })).toHaveCount(0);
      await expect(region.getByRole("link", { name: copy("مراجعة الملف والمشاركة", "Review portfolio and sharing"), exact: true })).toHaveCount(0);
      expect(nativeReasons).toEqual([status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN"]);
      expect(await db.draftCommand.count({ where: { draftId: f.draft.id } })).toBe(0);
    } finally { await page.unroute(readinessUrl); }
  }
});

test("keyboard cancellation and exact GET resume preserve historical state with a real long proved handle at360 reduced motion", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await fixture("CREATOR", context, english), longHandle = "long_" + randomUUID().replace(/-/g, "").slice(0, 25);
  expect(longHandle).toHaveLength(30);
  const account = await db.socialAccount.create({ data: { creatorId: f.profileId, platform: "INSTAGRAM", handle: longHandle,
    providerAccountId: "synthetic-long-provider-" + randomUUID(), intendedConfirmedAt: f.owner.at, consentAt: f.owner.at } });
  await reviewedOwnershipFixture(db, f.owner.user.id, f.admin.user.id, account.id, "e2e", f.owner.at);
  await db.creator.update({ where: { id: f.profileId }, data: { primaryAccountId: account.id, state: "PRIVATE" } });
  await page.setViewportSize({ width: 360, height: 900 }); await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/creator/onboarding"); await step4(page, copy);
  const region = panel(page, copy), refresh = region.getByRole("button", { name: copy("تقييم المتطلبات الحالية", "Assess current requirements"), exact: true });
  await expect(region.getByRole("heading", { name: copy("المتطلبات جاهزة لمراجعتك", "Ready for your review"), exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: `INSTAGRAM @${longHandle}`, exact: true })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await region.evaluate(node => getComputedStyle(node).direction)).toBe(english ? "ltr" : "rtl");
  const originalTime = await region.locator("time").getAttribute("datetime"), urls: string[] = [];
  let ready!: () => void, release!: () => void, finished!: () => void, cancelled = false, holdOnce = true;
  const nativeReady = new Promise<void>(resolve => { ready = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const done = new Promise<void>(resolve => { finished = resolve; });
  await page.route(readinessUrl, async route => {
    urls.push(route.request().url()); expect(route.request().method()).toBe("GET");
    const actual = await route.fetch(); expect(actual.status()).toBe(200);
    if (!holdOnce) { await route.fulfill({ response: actual }); return; }
    holdOnce = false;
    try {
      ready(); await gate;
      try { await route.fulfill({ response: actual }); }
      catch (error) {
        // Cancelling the real browser read may invalidate its intercepted ID.
        if (!cancelled || !(error instanceof Error) || !/handled|interception|closed|cancel|abort/i.test(error.message)) throw error;
      }
    } finally { finished(); }
  });
  try {
    await refresh.focus(); await expect(refresh).toBeFocused(); await page.keyboard.press("Enter"); await nativeReady;
    const cancel = region.getByRole("button", { name: copy("إلغاء الانتظار", "Cancel waiting"), exact: true });
    await expect(cancel).toBeVisible(); await cancel.focus(); await expect(cancel).toBeFocused(); cancelled = true; await page.keyboard.press("Enter");
    const retry = region.getByRole("button", { name: copy("إعادة التقييم نفسه", "Retry the same assessment"), exact: true });
    await expect(retry).toBeVisible(); await expect(retry).toBeEnabled();
    await expect(region.getByRole("heading", { name: copy("نتيجة سابقة — تحتاج تقييمًا جديدًا", "Previous result — a fresh assessment is needed"), exact: true })).toBeVisible();
    expect(await region.locator("time").getAttribute("datetime")).toBe(originalTime);
    await expect(region.getByRole("heading", { name: copy("المتطلبات جاهزة لمراجعتك", "Ready for your review"), exact: true })).toHaveCount(0);
    // Cancel's control disappears. Focus must stay on a live, meaningful panel
    // destination rather than falling to the document body.
    await expect.poll(() => region.evaluate(node => node.contains(document.activeElement) && document.activeElement !== node)).toBe(true);
    await retry.focus(); await expect(retry).toBeFocused(); await page.keyboard.press("Enter");
    await expect(region.getByRole("heading", { name: copy("المتطلبات جاهزة لمراجعتك", "Ready for your review"), exact: true })).toBeVisible();
    expect(urls).toHaveLength(2); expect(new Set(urls).size).toBe(1);
    const resumedTime = await region.locator("time").getAttribute("datetime"); release(); await done;
    expect(await region.locator("time").getAttribute("datetime")).toBe(resumedTime);
    const consent = page.getByRole("checkbox", { name: copy("أوافق على نشر الأقسام الظاهرة للعموم بعد استيفاء الإثباتات المطلوبة", "I consent to publishing the visible sections after required evidence is accepted"), exact: true });
    await expect(consent).not.toBeChecked(); expect((await db.creator.findUniqueOrThrow({ where: { id: f.profileId } })).publicConsentAt).toBeNull();
    expect(await db.draftCommand.count({ where: { draftId: f.draft.id } })).toBe(0);
    const artifacts = path.join(workspace, ".infame", "artifacts"); mkdirSync(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, `${info.project.name}-publication-readiness-long-cancel-resume.png`), fullPage: true });
  } finally { release(); await done; await page.unroute(readinessUrl); }
});

test("actual current signed own-profile deletion404 clears assessment time and remedies before malformed denial JSON", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await fixture("CREATOR", context, english); await page.goto("/creator");
  const region = panel(page, copy);
  await expect(region.getByRole("heading", { name: copy("المتطلبات جاهزة لمراجعتك", "Ready for your review"), exact: true })).toBeVisible();
  await db.creator.delete({ where: { id: f.profileId } });
  const cookies = await context.cookies(), session = await resolveSession(cookies.find(cookie => cookie.name === SESSION_COOKIE)!.value);
  expect(session?.userId).toBe(f.owner.user.id);
  const reasons: string[] = [];
  await page.route(readinessUrl, async route => {
    const actual = await route.fetch(); expect(actual.status()).toBe(404); expect(actual.headers()["cache-control"]).toBe("private, no-store");
    const body = await actual.json(); expect(body.error.code).toBe("NOT_FOUND"); reasons.push(body.error.code);
    await route.fulfill({ response: actual, status: 404, contentType: "application/json", body: "{malformed_actual_native_missing_own_profile" });
  });
  try {
    await region.getByRole("button", { name: copy("تقييم المتطلبات الحالية", "Assess current requirements"), exact: true }).click();
    await expect(region.getByRole("alert")).toBeVisible(); await expect(region.locator("time")).toHaveCount(0);
    await expect(region.getByRole("heading", { name: copy("المتطلبات جاهزة لمراجعتك", "Ready for your review"), exact: true })).toHaveCount(0);
    await expect(region.getByRole("heading", { name: copy("نتيجة سابقة — تحتاج تقييمًا جديدًا", "Previous result — a fresh assessment is needed"), exact: true })).toHaveCount(0);
    await expect(region.getByRole("link", { name: copy("مراجعة الملف والمشاركة", "Review portfolio and sharing"), exact: true })).toHaveCount(0);
    await expect(region.getByRole("button", { name: copy("إعادة التقييم نفسه", "Retry the same assessment"), exact: true })).toHaveCount(0);
    expect(reasons).toEqual(["NOT_FOUND"]); expect(await db.creator.count({ where: { userId: f.owner.user.id } })).toBe(0);
    expect(await db.draftCommand.count({ where: { draftId: f.draft.id } })).toBe(0);
  } finally { await page.unroute(readinessUrl); }
});
