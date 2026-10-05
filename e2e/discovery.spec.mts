import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Platform } from "@prisma/client";
import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { assertLocalTarget, taskState, workspace } from "../scripts/task-state.mjs";
import { prisma as db } from "../src/lib/prisma";
import { openSession, resolveSession } from "../src/lib/identity";
import { SESSION_COOKIE } from "../src/lib/jwt";
import { DiscoveryPageSchema } from "../src/lib/discovery/contracts";
import { cleanupReviewedEvidence, reviewedEvidenceOptions, reviewedOwnershipFixture } from "../tests/helpers/reviewed-evidence";
import { uploadPrivateAsset, submitMetricsScreenshot, reviewMetricsScreenshot, approveMetricsSnapshot } from "../src/lib/evidence/service";

// Root alone runs these browser checks through the guarded disposable E2E target.
// Positive journeys use actual native signed sessions, UI, HTTP, database and
// evidence commands over synthetic local bytes. Synthetic PUBLISHED/non-test
// flags are explicit test data, never live creator/provider/audience acceptance.
// Routes below label only negative transport faults after a real native GET.
const state = taskState(), origin = "http://localhost:3100";
const artifacts = path.join(workspace, ".infame", "artifacts");
if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("Discovery browser checks require the exact isolated E2E target");
const users = new Set<string>(), creators = new Set<string>();
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1kAAAAASUVORK5CYII=", "base64");
const privateCanary = "SYNTHETIC_PRIVATE_DISCOVERY_CANARY";
const endpoint = (value: string) => new URL(value).pathname === "/api/discovery/creators";
const browserErrors = new WeakMap<Page, string[]>();
test.setTimeout(90000);
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; browserErrors.set(page, errors);
  page.on("pageerror", error => errors.push(error.name || "Error"));
  page.on("console", message => {
    if (message.type() === "error" && /hydrat|server.rendered|server HTML|text content.*match|minified React error #(?:418|423|425)/i.test(message.text())) errors.push("HYDRATION_MISMATCH");
  });
});
test.beforeAll(async () => {
  const rows = await db.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0].id !== state.id || rows[0].kind !== "e2e" || rows[0].db !== state.targets.e2e || rows[0].host !== "127.0.0.1") throw new Error("Discovery browser database identity mismatch");
});
test.afterEach(async ({ page }) => {
  await db.creator.deleteMany({ where: { id: { in: [...creators] } } });
  await db.brand.deleteMany({ where: { userId: { in: [...users] } } });
  await cleanupReviewedEvidence(db, [...users], "e2e");
  await db.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await db.user.deleteMany({ where: { id: { in: [...users] } } });
  creators.clear(); users.clear();
  expect(browserErrors.get(page) ?? [], "Actual browser page errors and hydration mismatches").toEqual([]);
});
test.afterAll(async () => { await db.$disconnect(); });
function locale(info: TestInfo) { const english = info.project.name === "english-desktop"; return { english, copy: (ar: string, en: string) => english ? en : ar }; }
const groupName = () => "discovery-group-" + randomUUID().slice(0, 8);

async function actor(role: "BRAND" | "CREATOR" | "ADMIN", english: boolean) {
  const id = randomUUID(); users.add(id);
  const at = new Date(Date.now() - 120_000);
  const user = await db.user.create({ data: { id, role, name: role === "BRAND" ? "Synthetic discovery company" : `${privateCanary}_${id}`,
    email: `${id}@example.invalid`, passwordHash: "synthetic-session-only-not-a-login", language: english ? "en" : "ar",
    active: true, isTest: role !== "CREATOR", emailVerifiedAt: at, createdAt: at } });
  if (role === "BRAND") await db.brand.create({ data: { userId: id, slug: "disc-" + id.replace(/-/g, "").slice(0, 16), name: "Synthetic private discovery company", isTest: true } });
  return user;
}
async function signed(context: BrowserContext, user: Awaited<ReturnType<typeof actor>>, english: boolean) {
  const token = await openSession(user.id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Synthetic native discovery session failed to resolve");
  await context.addCookies([{ name: SESSION_COOKIE, value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "infame_lang", value: english ? "en" : "ar", domain: "localhost", path: "/" }]);
  return session;
}
async function seed(english: boolean, group: string, label: string, options: { followers?: string | null; country?: string; platform?: Platform; proved?: boolean; id?: string; long?: boolean } = {}) {
  const at = new Date(Date.now() - 120_000), owner = await actor("CREATOR", english), admin = await actor("ADMIN", english);
  const suffix = randomUUID().replace(/-/g, "");
  const handle = options.long ? "d_" + suffix.slice(0, 28) : "disc_" + suffix.slice(0, 16);
  const displayName = `${group} ${label}${options.long ? " — اسم أصلي طويل " + "OriginalLongAlias".repeat(12) : ""}`;
  const bio = options.long ? "سيرة أصلية محفوظة\n" + "OriginalBiography ".repeat(35) : "سيرة أصلية\nOriginal biography";
  const creator = await db.creator.create({ data: { ...(options.id ? { id: options.id } : {}), userId: owner.id, handle, displayName,
    countryCode: options.country ?? "KW", languages: ["ar", "en"], nicheIds: ["tech"], state: "PRIVATE", isTest: false,
    publicConsentAt: at, profileFacts: { ratesVisibility: "PRIVATE", private: privateCanary.repeat(500) }, createdAt: at } });
  creators.add(creator.id);
  const account = await db.socialAccount.create({ data: { creatorId: creator.id, platform: options.platform ?? "INSTAGRAM",
    handle: options.long ? "s_" + suffix.slice(0, 28) : "proof_" + suffix.slice(0, 16),
    providerAccountId: "SYNTHETIC_PRIVATE_PROVIDER_" + randomUUID(), intendedConfirmedAt: at, consentAt: at, createdAt: at } });
  const proof = options.proved === false ? null : await reviewedOwnershipFixture(db, owner.id, admin.id, account.id, "e2e", at);
  await db.socialAccount.update({ where: { id: account.id }, data: { publicVisible: true } });
  await db.portfolioVersion.create({ data: { creatorId: creator.id, version: 1, inputRevision: 7, approvedAt: at,
    content: { title: "عنوان أصلي", bio, sections: [], method: "APPROVED_FACT_TEMPLATE" }, createdAt: at } });
  let observedAt: Date | null = null;
  if (options.followers !== undefined && options.followers !== null) {
    const t = (step: number) => new Date(at.getTime() + step * 1000);
    const uploaded = await uploadPrivateAsset(owner.id, { operationKey: randomUUID(), purpose: "SCREENSHOT", contentType: "image/png", bytes: png }, await reviewedEvidenceOptions(db, "e2e", t(1)));
    const current = await db.socialAccount.findUniqueOrThrow({ where: { id: account.id } });
    observedAt = new Date(at.getTime() - 1000);
    const parent = (await submitMetricsScreenshot(owner.id, { operationKey: randomUUID(), accountId: account.id,
      expectedMappingRevision: current.mappingRevision, expectedEvidenceRevision: current.evidenceRevision,
      evidenceAssetId: uploaded.asset.id, observedAt: observedAt.toISOString(), followers: options.followers }, await reviewedEvidenceOptions(db, "e2e", t(2)))).snapshot;
    const submitted = await db.socialAccount.findUniqueOrThrow({ where: { id: account.id } });
    const child = (await reviewMetricsScreenshot(admin.id, parent.id, { operationKey: randomUUID(), expectedEvidenceRevision: submitted.evidenceRevision,
      decision: "VERIFIED", note: { text: "مراجعة مصطنعة لمسار المتصفح فقط", language: "ar" } }, await reviewedEvidenceOptions(db, "e2e", t(3)))).snapshot;
    const reviewed = await db.socialAccount.findUniqueOrThrow({ where: { id: account.id } });
    await approveMetricsSnapshot(owner.id, child.id, { operationKey: randomUUID(), expectedMappingRevision: reviewed.mappingRevision,
      expectedEvidenceRevision: reviewed.evidenceRevision, visibility: { followers: "PUBLIC" } }, await reviewedEvidenceOptions(db, "e2e", t(4)));
  }
  await db.creator.update({ where: { id: creator.id }, data: { primaryAccountId: account.id, state: "PUBLISHED", publicConsentAt: at } });
  return { owner, admin, creator, account, proof, displayName, bio, observedAt };
}
async function visit(page: Page, context: BrowserContext, english: boolean) {
  const user = await actor("BRAND", english), session = await signed(context, user, english);
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.goto("/brand/creators");
  await expect(page.getByRole("heading", { name: english ? "Explore creators" : "استكشف صنّاع المحتوى", exact: true })).toBeVisible();
  return { user, session };
}
const discovery = (page: Page) => page.locator('section[aria-labelledby="creator-discovery-heading"]');
const alert = (page: Page) => discovery(page).getByRole("alert");
const cards = (page: Page) => discovery(page).locator('article[aria-labelledby^="discovery-"]');
const card = (page: Page, name: string) => page.getByRole("article", { name, exact: true });
async function search(page: Page, copy: (ar: string, en: string) => string, q: string, expectedLimit = "12") {
  await page.getByLabel(copy("الاسم أو اسم المستخدم", "Name or handle"), { exact: true }).fill(q);
  const response = page.waitForResponse(value => endpoint(value.url()) && value.request().method() === "GET");
  await page.getByRole("button", { name: copy("بحث", "Search"), exact: true }).click();
  const actual = await response; expect(actual.status()).toBe(200);
  expect(new URL(actual.url()).searchParams.get("limit")).toBe(expectedLimit);
  return DiscoveryPageSchema.parse((await actual.json()).data);
}
function privateHeaders(headers: Record<string, string>) {
  expect(headers["cache-control"]).toContain("private"); expect(headers["cache-control"]).toContain("no-store"); expect(headers["x-request-id"]).toBeTruthy();
}
async function api(page: Page, query: string) {
  const response = await page.request.get("/api/discovery/creators?" + query); expect(response.status()).toBe(200); privateHeaders(response.headers());
  return DiscoveryPageSchema.parse((await response.json()).data);
}

test("native filters expose UNKNOWN, zero and boundary counts with real public-profile links", async ({ page, context }, info) => {
  const { english, copy } = locale(info), group = groupName();
  const unknown = await seed(english, group, "Unknown"), zero = await seed(english, group, "Zero", { followers: "0" });
  const nano = await seed(english, group, "Nano", { followers: "1000", platform: "TIKTOK" });
  await seed(english, group, "Other country", { country: "EG", followers: "10000" });
  await visit(page, context, english);
  const native = await search(page, copy, group); expect(native.creators).toHaveLength(4); await expect(cards(page)).toHaveCount(4);
  for (const item of [unknown, zero, nano]) await card(page, item.displayName).locator("summary").click();
  await expect(card(page, unknown.displayName).getByText(copy("غير معروف", "Unknown"), { exact: true })).toBeVisible();
  const followerFact = card(page, zero.displayName).locator("dl > div").filter({ has: page.getByText(copy("المتابعون", "Followers"), { exact: true }) });
  await expect(followerFact.locator("dd")).toHaveText(new Intl.NumberFormat(english ? "en" : "ar").format(0));
  await expect(card(page, nano.displayName).getByText(copy("نانو", "Nano"), { exact: true })).toBeVisible();
  await expect(card(page, nano.displayName).locator(`time[datetime="${nano.observedAt!.toISOString()}"]`)).toBeVisible();
  mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, `discovery-native-four-cards-${info.project.name}.png`), fullPage: true });
  const publicLink = card(page, zero.displayName).locator(`a[href="/@${zero.creator.handle}"]`); await expect(publicLink).toBeVisible();
  const linked = await page.request.get(`/@${zero.creator.handle}`); expect(linked.status()).toBe(200); expect(await linked.text()).toContain(zero.creator.handle);
  await page.getByLabel(copy("بلد الإقامة", "Country of residence"), { exact: true }).selectOption("KW");
  await page.getByLabel(copy("المنصة", "Platform"), { exact: true }).selectOption("INSTAGRAM");
  expect((await search(page, copy, group)).creators.map(value => value.id).sort()).toEqual([unknown.creator.id, zero.creator.id].sort());
  await page.getByLabel(copy("المنصة", "Platform"), { exact: true }).selectOption("TIKTOK");
  await page.getByLabel(copy("فئة المتابعين لكل حساب", "Per-account follower band"), { exact: true }).selectOption("NANO");
  expect((await search(page, copy, group)).creators.map(value => value.id)).toEqual([nano.creator.id]);
  const text = await page.locator("body").innerText(); expect(text).not.toContain(privateCanary); expect(text).not.toContain(unknown.owner.email);
  expect(JSON.stringify(native)).not.toContain(privateCanary); expect(JSON.stringify(native)).not.toContain(zero.proof!.proofId);
});

test("native opaque pagination advances raw scans without padding and keeps displayed filters separate from draft edits", async ({ page, context }, info) => {
  const { english, copy } = locale(info), group = groupName(), prefix = "browser_discovery_" + randomUUID().replace(/-/g, "").slice(0, 10);
  const expected: string[] = [];
  for (let index = 0; index < 10; index++) { const value = await seed(english, group, "Pagination " + index, { id: `${prefix}_${String(index).padStart(3, "0")}`, proved: index >= 3 }); if (index >= 3) expected.push(value.creator.id); }
  await visit(page, context, english); await page.getByLabel(copy("عدد الملفات في خطوة البحث", "Profiles per search step"), { exact: true }).selectOption("6");
  await expect(page.getByLabel(copy("عدد الملفات في خطوة البحث", "Profiles per search step"), { exact: true })).toHaveValue("6");
  const nativeFirst = await api(page, new URLSearchParams({ q: group, limit: "6" }).toString());
  expect(nativeFirst.creators).toHaveLength(3); expect(nativeFirst.nextCursor).not.toBeNull();
  const first = await search(page, copy, group, "6"); expect(first.creators).toHaveLength(3); expect(first.nextCursor).not.toBeNull();
  expect(first.creators.map(value => value.id)).toEqual(nativeFirst.creators.map(value => value.id));
  expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/); const decoded = Buffer.from(first.nextCursor!, "base64url").toString("utf8");
  for (const id of expected) expect(decoded).not.toContain(id);
  await page.getByLabel(copy("الاسم أو اسم المستخدم", "Name or handle"), { exact: true }).fill("unapplied-draft-only");
  await expect(page.getByText(copy("الخيارات المعدلة لم تُطبّق بعد. اضغط بحث لعرض نتائجها؛ التحديث والتنقل يستخدمان خيارات النتائج المعروضة.", "Changed filters are not applied yet. Search to apply them; refresh and pagination use the displayed filters."), { exact: true })).toBeVisible();
  const next = page.waitForResponse(value => endpoint(value.url())); await page.getByRole("button", { name: copy("التالي", "Next"), exact: true }).click();
  const actual = await next, url = new URL(actual.url()), second = DiscoveryPageSchema.parse((await actual.json()).data);
  expect(url.searchParams.get("q")).toBe(group); expect(url.searchParams.get("cursor")).toBe(first.nextCursor); expect(second.creators).toHaveLength(4);
  expect([...first.creators, ...second.creators].map(value => value.id).sort()).toEqual(expected.sort());
  await expect(page.getByRole("button", { name: copy("التالي", "Next"), exact: true })).toBeDisabled();
  const previous = page.waitForResponse(value => endpoint(value.url())); await page.getByRole("button", { name: copy("السابق", "Previous"), exact: true }).click();
  expect(DiscoveryPageSchema.parse((await (await previous).json()).data).creators.map(value => value.id)).toEqual(first.creators.map(value => value.id));
  const empty = await api(page, new URLSearchParams({ q: group, reachBand: "MEGA", limit: "6" }).toString()); expect(empty.creators).toEqual([]); expect(empty.nextCursor).not.toBeNull();
  const bad = await page.request.get("/api/discovery/creators?" + new URLSearchParams({ q: "changed-query", reachBand: "MEGA", limit: "6", cursor: empty.nextCursor! })); expect(bad.status()).toBe(422); privateHeaders(bad.headers());
});

test("native authentication precedes malformed queries and real session/user revocation clears old cards", async ({ page, context, browser }, info) => {
  const { english, copy } = locale(info), group = groupName(), value = await seed(english, group, "Revocation");
  const anonymous = await browser.newContext({ baseURL: origin });
  try { const response = await anonymous.request.get("/api/discovery/creators?limit=x&limit=13"); expect(response.status()).toBe(401); privateHeaders(response.headers()); } finally { await anonymous.close(); }
  const creator = await actor("CREATOR", english), wrong = await browser.newContext({ baseURL: origin });
  try { await signed(wrong, creator, english); const response = await wrong.request.get("/api/discovery/creators?limit=x&limit=13"); expect(response.status()).toBe(403); privateHeaders(response.headers()); } finally { await wrong.close(); }
  for (const reason of ["session", "user"] as const) {
    await context.clearCookies(); const current = await visit(page, context, english); await search(page, copy, group); await expect(card(page, value.displayName)).toBeVisible();
    const duplicate = await page.request.get("/api/discovery/creators?limit=6&limit=12"); expect(duplicate.status()).toBe(422); privateHeaders(duplicate.headers());
    if (reason === "session") await db.authSession.update({ where: { id: current.session.sessionId }, data: { revokedAt: new Date() } });
    else await db.user.update({ where: { id: current.user.id }, data: { active: false } });
    const denial = page.waitForResponse(response => endpoint(response.url())); await page.getByRole("button", { name: copy("تحديث النتائج", "Refresh results"), exact: true }).click(); expect((await denial).status()).toBe(401);
    await expect(cards(page)).toHaveCount(0); await expect(alert(page)).toContainText(copy("سجّل الدخول مجددًا لمتابعة الاستكشاف.", "Sign in again to continue browsing."));
    await expect(page.getByLabel(copy("الاسم أو اسم المستخدم", "Name or handle"), { exact: true })).toBeDisabled();
  }
});

test("synthetic503 and malformed200 after real GETs retain the snapshot and retry the exact captured request", async ({ page, context }, info) => {
  const { english, copy } = locale(info), group = groupName(), older = await seed(english, group, "Old"), newer = await seed(english, group, "New");
  await visit(page, context, english); await search(page, copy, older.displayName); await expect(card(page, older.displayName)).toBeVisible();
  const attempts: string[] = [];
  await page.route("**/api/discovery/creators?*", async route => {
    const actual = await route.fetch(); expect(actual.status()).toBe(200); attempts.push(route.request().url());
    if (attempts.length === 1) await route.fulfill({ status: 503, contentType: "application/json", headers: { "Cache-Control": "private, no-store" }, body: JSON.stringify({ error: { code: "RETRY_REQUIRED" } }) });
    else if (attempts.length === 2) await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { scope: "PUBLIC_PROFILES", creators: [] } }) });
    else await route.fulfill({ response: actual });
  });
  try {
    await page.getByLabel(copy("الاسم أو اسم المستخدم", "Name or handle"), { exact: true }).fill(newer.displayName);
    const failed = page.waitForResponse(response => endpoint(response.url()));
    await page.getByRole("button", { name: copy("بحث", "Search"), exact: true }).click(); expect((await failed).status()).toBe(503); await expect(alert(page)).toBeVisible(); await expect(card(page, older.displayName)).toBeVisible();
    await page.getByLabel(copy("الاسم أو اسم المستخدم", "Name or handle"), { exact: true }).fill("unapplied-after-failure");
    const malformed = page.waitForResponse(response => endpoint(response.url()));
    await page.getByRole("button", { name: copy("إعادة المحاولة", "Retry"), exact: true }).click(); expect((await malformed).status()).toBe(200); await expect(alert(page)).toBeVisible(); await expect(card(page, older.displayName)).toBeVisible();
    expect(attempts).toHaveLength(2); expect(attempts[1]).toBe(attempts[0]);
    await page.getByRole("button", { name: copy("إعادة المحاولة", "Retry"), exact: true }).click(); await expect(card(page, newer.displayName)).toBeVisible(); await expect(card(page, older.displayName)).toHaveCount(0);
    expect(attempts[2]).toBe(attempts[0]);
    expect(new URL(attempts[0]!).searchParams.get("q")).toBe(newer.displayName);
  } finally { await page.unroute("**/api/discovery/creators?*"); }
});

test("synthetic malformed denial clears already visible data before JSON parsing", async ({ page, context }, info) => {
  const { english, copy } = locale(info), group = groupName(), value = await seed(english, group, "Denial");
  await visit(page, context, english); await search(page, copy, group); await expect(card(page, value.displayName)).toBeVisible();
  await page.route("**/api/discovery/creators?*", async route => { const actual = await route.fetch(); expect(actual.status()).toBe(200); await route.fulfill({ status: 403, contentType: "application/json", body: "{synthetic-malformed-denial" }); });
  try {
    await page.getByRole("button", { name: copy("تحديث النتائج", "Refresh results"), exact: true }).click();
    await expect(cards(page)).toHaveCount(0); await expect(alert(page)).toContainText(copy("الاستكشاف غير متاح لهذا الحساب.", "Browsing is unavailable for this account."));
    await expect(page.getByRole("button", { name: copy("إعادة المحاولة", "Retry"), exact: true })).toHaveCount(0);
    await expect(page.getByLabel(copy("الاسم أو اسم المستخدم", "Name or handle"), { exact: true })).toBeDisabled();
    expect(await page.locator("body").innerText()).not.toContain(value.bio);
  } finally { await page.unroute("**/api/discovery/creators?*"); }
});

test("real30-second timeout and keyboard cancellation keep long AR/EN cards usable at360 with reduced motion", async ({ page, context }, info) => {
  const { english, copy } = locale(info), group = groupName(), value = await seed(english, group, "Long", { long: true, followers: "100000" });
  await page.setViewportSize({ width: 360, height: 800 }); await visit(page, context, english); await search(page, copy, group);
  await expect(card(page, value.displayName)).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  const font = await page.locator("body").evaluate(element => getComputedStyle(element).fontFamily);
  const summary = card(page, value.displayName).locator("summary"); await summary.focus(); await page.keyboard.press("Enter"); await expect(card(page, value.displayName).locator("details")).toHaveAttribute("open", "");
  mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, `discovery-long-expanded-${english ? "english" : "arabic"}-360.png`), fullPage: true });
  let release!: () => void; let pending = new Promise<void>(done => { release = done; });
  await page.route("**/api/discovery/creators?*", async route => { const capturedGate = pending; const actual = await route.fetch(); expect(actual.status()).toBe(200); await capturedGate; await route.fulfill({ response: actual }).catch(() => {}); });
  try {
    await page.getByRole("button", { name: copy("تحديث النتائج", "Refresh results"), exact: true }).click();
    await expect(discovery(page).getByRole("status")).toContainText(copy("جارٍ تحميل الملفات العامة…", "Loading public profiles…"));
    const cancel = page.getByRole("button", { name: copy("إلغاء التحميل", "Cancel loading"), exact: true }); await cancel.focus(); await page.keyboard.press("Enter");
    await expect(alert(page)).toContainText(copy("أُلغي التحميل. النتائج السابقة باقية.", "Loading cancelled. Previous results are retained.")); await expect(card(page, value.displayName)).toBeVisible();
    release(); pending = new Promise<void>(done => { release = done; });
    const started = Date.now(); await page.getByRole("button", { name: copy("إعادة المحاولة", "Retry"), exact: true }).click();
    await expect(alert(page)).toContainText(copy("استغرق التحميل وقتًا طويلًا. يمكنك إعادة المحاولة.", "Loading timed out. You can retry."), { timeout: 35000 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(29000); await expect(card(page, value.displayName)).toBeVisible();
    await expect(page.getByLabel(copy("الاسم أو اسم المستخدم", "Name or handle"), { exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator("body").evaluate(element => getComputedStyle(element).fontFamily)).toBe(font);
  } finally { release(); await page.unroute("**/api/discovery/creators?*"); }
});
