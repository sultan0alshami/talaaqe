import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { assertLocalTarget, taskState, workspace } from "../scripts/task-state.mjs";
import { prisma as db } from "../src/lib/prisma";
import { openSession, resolveSession } from "../src/lib/identity";
import { SESSION_COOKIE } from "../src/lib/jwt";
import { cleanupReviewedEvidence, reviewedOwnershipFixture } from "../tests/helpers/reviewed-evidence";

// Real signed native sessions, UI, HTTP and DB on synthetic guarded E2E data.
// Reviewed local proof bytes do not establish live creator/provider acceptance.
// Fault routes below alter a response only after actual native request execution.
const state = taskState(), origin = "http://localhost:3100";
if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("Collections require the guarded E2E database");
const users = new Set<string>(), creators = new Set<string>(), organizations = new Set<string>();
const errors = new WeakMap<Page, string[]>();
const originalNote = " \tملاحظة أصلية\nOriginal retained note\r ";
test.setTimeout(90000);
test.beforeEach(async ({ page }) => {
  const seen: string[] = []; errors.set(page, seen);
  page.on("pageerror", error => seen.push(error.name));
  page.on("console", message => { if (message.type() === "error" && /hydrat|server.rendered|server HTML|text content.*match/i.test(message.text())) seen.push("HYDRATION_MISMATCH"); });
});
test.afterEach(async ({ page }) => {
  const parents = await db.creatorCollection.findMany({ where: { brand: { userId: { in: [...users] } } }, select: { id: true } });
  const ids = parents.map(row => row.id);
  await db.creatorCollectionCommand.deleteMany({ where: { collectionId: { in: ids } } });
  await db.creatorCollectionEntry.deleteMany({ where: { collectionId: { in: ids } } });
  await db.creatorCollection.deleteMany({ where: { id: { in: ids } } });
  await db.creator.deleteMany({ where: { id: { in: [...creators] } } });
  await cleanupReviewedEvidence(db, [...users], "e2e");
  await db.outboxEvent.deleteMany({ where: { OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await db.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await db.clientGrant.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await db.organizationClient.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await db.organizationMembership.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await db.organization.deleteMany({ where: { id: { in: [...organizations] } } });
  await db.brand.deleteMany({ where: { userId: { in: [...users] } } });
  await db.user.deleteMany({ where: { id: { in: [...users] } } });
  users.clear(); creators.clear(); organizations.clear();
  expect(errors.get(page) ?? [], "Actual browser page errors and hydration").toEqual([]);
});
test.afterAll(async () => { await db.$disconnect(); });
const locale = (info: TestInfo) => { const english = info.project.name === "english-desktop"; return { english, copy: (ar: string, en: string) => english ? en : ar }; };
async function person(role: "BRAND" | "CREATOR" | "ADMIN", english: boolean) {
  const id = randomUUID(), at = new Date(Date.now() - 120000); users.add(id);
  return db.user.create({ data: { id, role, name: "Synthetic collections actor", email: `${id}@example.invalid`, passwordHash: "synthetic-session-only",
    active: true, isTest: role !== "CREATOR", language: english ? "en" : "ar", emailVerifiedAt: at } });
}
async function signed(context: BrowserContext, user: Awaited<ReturnType<typeof person>>, english: boolean) {
  const token = await openSession(user.id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Synthetic session did not resolve");
  await context.addCookies([{ name: SESSION_COOKIE, value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "infame_lang", value: english ? "en" : "ar", domain: "localhost", path: "/" }]);
  return session;
}
async function fixture(context: BrowserContext, english: boolean) {
  const user = await person("BRAND", english), brand = await db.brand.create({ data: {
    userId: user.id, slug: "browser-" + randomUUID().replace(/-/g, "").slice(0, 16), name: "شركة أصلية Synthetic company", isTest: true,
  } });
  const session = await signed(context, user, english);
  const scope = { kind: "OWN_BRAND" as const, brandId: brand.id };
  return { user, brand, session, scope };
}
async function identity(english: boolean) {
  const owner = await person("CREATOR", english), reviewer = await person("ADMIN", english), at = new Date(Date.now() - 120000);
  const handle = "collection_" + randomUUID().replace(/-/g, "").slice(0, 18);
  const creator = await db.creator.create({ data: { userId: owner.id, handle, displayName: "اسم أصلي " + handle,
    countryCode: "KW", languages: ["ar", "en"], nicheIds: ["tech"], isTest: false, publicConsentAt: at } }); creators.add(creator.id);
  const account = await db.socialAccount.create({ data: { creatorId: creator.id, platform: "INSTAGRAM", handle,
    providerAccountId: "synthetic-private-" + randomUUID(), intendedConfirmedAt: at, consentAt: at } });
  await reviewedOwnershipFixture(db, owner.id, reviewer.id, account.id, "e2e", at);
  await db.socialAccount.update({ where: { id: account.id }, data: { publicVisible: true } });
  await db.portfolioVersion.create({ data: { creatorId: creator.id, version: 1, inputRevision: 1, approvedAt: at,
    content: { title: "Original title", bio: "سيرة أصلية\nOriginal public biography", sections: [], method: "APPROVED_FACT_TEMPLATE" } } });
  await db.creator.update({ where: { id: creator.id }, data: { primaryAccountId: account.id, state: "PUBLISHED", publicConsentAt: at } });
  return creator;
}
async function create(page: Page, scope: Awaited<ReturnType<typeof fixture>>["scope"], text: string) {
  const response = await page.request.post("/api/collections/commands", { headers: { Origin: origin }, data: {
    operationKey: randomUUID(), scope, action: "CREATE", expectedParentRevision: 0, payload: { nameOriginal: { text, language: "ar" } },
  } });
  expect(response.status()).toBe(200); return (await response.json()).data as { collectionId: string; revision: number };
}
async function browse(page: Page, handle: string, copy: (ar: string, en: string) => string) {
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.goto("/brand/creators");
  await page.getByLabel(copy("الاسم أو اسم المستخدم", "Name or handle"), { exact: true }).fill(handle);
  await page.getByRole("button", { name: copy("بحث", "Search"), exact: true }).click();
  await expect(page.locator('article[aria-labelledby^="discovery-"]')).toHaveCount(1);
  await page.getByRole("button", { name: copy("حفظ في قائمة", "Save to collection"), exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  mkdirSync(path.join(workspace, ".infame", "artifacts"), { recursive: true });
  await page.screenshot({ path: path.join(workspace, ".infame", "artifacts", `collections-${name}-${info.project.name}.png`), fullPage: true });
}

test("native discovery saves an original note to a private list and rechecks its current entry", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await fixture(context, english), creator = await identity(english);
  const made = await create(page, f.scope, "قائمة أصلية Original collection");
  await browse(page, creator.handle, copy);
  await page.getByLabel(copy("القائمة", "Collection"), { exact: true }).selectOption(made.collectionId);
  await page.getByLabel(copy("ملاحظة خاصة", "Private note"), { exact: true }).fill(originalNote);
  await page.getByLabel(copy("لغة الملاحظة (اختياري)", "Note language (optional)"), { exact: true }).fill("ar");
  const posted = page.waitForResponse(response => new URL(response.url()).pathname === "/api/collections/commands");
  await page.getByRole("button", { name: copy("حفظ", "Save"), exact: true }).click(); expect((await posted).status()).toBe(200);
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(copy("تم تسجيل الحفظ", "Save recorded"));
  const entry = await db.creatorCollectionEntry.findUniqueOrThrow({ where: { collectionId_creatorReferenceId: { collectionId: made.collectionId, creatorReferenceId: creator.id } } });
  // Browser textareas normalize CR to LF; native domain tests independently
  // prove exact original CR/TAB preservation when supplied as JSON.
  expect(entry.note).toBe(originalNote.replace(/\r/g, "\n")); expect(entry.noteLanguage).toBe("ar");
  expect((await db.creatorCollection.findUniqueOrThrow({ where: { id: made.collectionId } })).revision).toBe(2);
  await screenshot(page, info, "save");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth); expect(overflow).toBe(false);
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: copy("حفظ في قائمة", "Save to collection"), exact: true })).toBeFocused();
});

test("commit then lost reply and malformed success retain the exact discovery save key and body", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await fixture(context, english), creator = await identity(english), made = await create(page, f.scope, "Lost reply original list");
  await browse(page, creator.handle, copy);
  await page.getByLabel(copy("القائمة", "Collection"), { exact: true }).selectOption(made.collectionId);
  await page.getByLabel(copy("ملاحظة خاصة", "Private note"), { exact: true }).fill("  Pending original note  ");
  const bodies: string[] = []; let faults = 0;
  await page.route("**/api/collections/commands", async route => {
    bodies.push(route.request().postData()!); const actual = await route.fetch(); expect(actual.status()).toBe(200);
    if (faults++ === 0) await route.abort("failed");
    else if (faults === 2) await route.fulfill({ response: actual, json: { data: {} } });
    else await route.fulfill({ response: actual });
  });
  await page.getByRole("button", { name: copy("حفظ", "Save"), exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: copy("إعادة محاولة الحفظ نفسه", "Retry the same save"), exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: copy("إعادة محاولة الحفظ نفسه", "Retry the same save"), exact: true })).toBeEnabled();
  await page.getByRole("button", { name: copy("إعادة محاولة الحفظ نفسه", "Retry the same save"), exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(copy("تم تسجيل الحفظ", "Save recorded"));
  expect(bodies).toHaveLength(3); expect(new Set(bodies).size).toBe(1);
  expect(await db.creatorCollectionCommand.count({ where: { collectionId: made.collectionId, action: "ADD_ENTRY" } })).toBe(1);
  expect(await db.creatorCollectionEntry.count({ where: { collectionId: made.collectionId } })).toBe(1);
});

test("actual invalidated session clears picker and public results before a malformed denial body", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await fixture(context, english), creator = await identity(english), made = await create(page, f.scope, "PRIVATE_BROWSER_COLLECTION_CANARY");
  await browse(page, creator.handle, copy);
  await page.getByLabel(copy("القائمة", "Collection"), { exact: true }).selectOption(made.collectionId);
  await page.getByLabel(copy("ملاحظة خاصة", "Private note"), { exact: true }).fill("PRIVATE_BROWSER_NOTE_CANARY");
  await db.authSession.update({ where: { id: f.session.sessionId }, data: { revokedAt: new Date() } });
  await page.route("**/api/collections/commands", async route => { const actual = await route.fetch(); expect(actual.status()).toBe(401);
    await route.fulfill({ response: actual, contentType: "text/plain", body: "labelled malformed denial" }); });
  await page.getByRole("button", { name: copy("حفظ", "Save"), exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('article[aria-labelledby^="discovery-"]')).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("PRIVATE_BROWSER_COLLECTION_CANARY");
  await expect(page.locator("body")).not.toContainText("PRIVATE_BROWSER_NOTE_CANARY");
  expect(await db.creatorCollectionCommand.count({ where: { collectionId: made.collectionId, action: "ADD_ENTRY" } })).toBe(0);
});

test("Talaqee list composition completes native create note comparison archive restore rename and removal", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await fixture(context, english), creator = await identity(english);
  await page.setViewportSize({ width: 360, height: 800 }); await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/brand/collections");
  const screen = page.locator('section[aria-labelledby="creator-collections-heading"]');
  const name = "قائمة أصلية Native browser list " + "LongOriginalWords".repeat(5);
  await page.locator("#collection-create-text").fill(name); await page.locator("#collection-create-language").fill("ar");
  await screen.getByRole("button", { name: copy("إنشاء القائمة", "Create list"), exact: true }).click();
  await expect(page.locator("#opened-collection-heading")).toHaveText(name);
  const parent = await db.creatorCollection.findFirstOrThrow({ where: { brandId: f.brand.id, name } });
  const response = await page.request.post("/api/collections/commands", { headers: { Origin: origin }, data: {
    operationKey: randomUUID(), scope: f.scope, action: "ADD_ENTRY", collectionId: parent.id, expectedParentRevision: 1,
    payload: { creatorId: creator.id, noteOriginal: { text: "  Initial private note  ", language: "en" } },
  } }); expect(response.status()).toBe(200);
  await screen.getByRole("button", { name: copy("تحديث البيانات", "Refresh data"), exact: true }).click();
  await expect(screen.getByText("  Initial private note  ", { exact: true })).toBeVisible();
  await screen.getByRole("button", { name: copy("تعديل الملاحظة", "Edit note"), exact: true }).click();
  await page.locator("#collection-note-text").fill("  كلمات أصلية\nEdited original note  ");
  await page.locator("#collection-note-language").fill("ar");
  await screen.getByRole("button", { name: copy("حفظ الملاحظة", "Save note"), exact: true }).click();
  await expect(page.locator("#collection-note-text")).toHaveCount(0);
  await expect(screen.getByText("  كلمات أصلية\nEdited original note  ", { exact: true })).toBeVisible();
  await screen.getByRole("checkbox").check();
  await screen.getByRole("button", { name: new RegExp(copy("مقارنة المختارين", "Compare selected")) }).click();
  await expect(page.locator("#collection-comparison-heading")).toBeVisible();
  await expect(page.locator("#collection-comparison-heading")).toBeFocused();
  await expect(page.locator('section[aria-labelledby="collection-comparison-heading"]').getByRole("article")).toHaveCount(1);
  await screenshot(page, info, "compare-360");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await screen.getByRole("button", { name: copy("إغلاق المقارنة", "Close comparison"), exact: true }).click();
  await expect(screen.getByRole("button", { name: new RegExp(copy("مقارنة المختارين", "Compare selected")) })).toBeFocused();
  await screen.getByRole("button", { name: copy("أرشفة القائمة", "Archive list"), exact: true }).click();
  await expect(screen.getByRole("button", { name: copy("استعادة القائمة", "Restore list"), exact: true })).toBeEnabled();
  await screen.getByRole("button", { name: copy("استعادة القائمة", "Restore list"), exact: true }).click();
  await expect(screen.getByRole("button", { name: copy("تغيير الاسم", "Rename"), exact: true })).toBeEnabled();
  await screen.getByRole("button", { name: copy("تغيير الاسم", "Rename"), exact: true }).click();
  await page.locator("#collection-rename-text").fill("اسم أصلي جديد Renamed original");
  await screen.getByRole("button", { name: copy("حفظ الاسم", "Save name"), exact: true }).click();
  await expect(page.locator("#opened-collection-heading")).toHaveText("اسم أصلي جديد Renamed original");
  await screen.getByRole("button", { name: copy("إزالة من القائمة", "Remove from list"), exact: true }).click();
  await expect(screen.getByRole("article")).toHaveCount(0);
  const current = await db.creatorCollection.findUniqueOrThrow({ where: { id: parent.id } });
  expect(current.revision).toBe(7); expect(current.archived).toBe(false);
  const entry = await db.creatorCollectionEntry.findUniqueOrThrow({ where: { collectionId_creatorReferenceId: { collectionId: parent.id, creatorReferenceId: creator.id } } });
  expect(entry.removedAt).not.toBeNull(); expect(entry.note).toBe("  كلمات أصلية\nEdited original note  ");
});

test("same-Brand two-client browser scopes remain separate and actual denial clears private list", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await fixture(context, english), owner = await person("BRAND", english), seat = await person("BRAND", english);
  const organization = await db.organization.create({ data: { ownerUserId: owner.id, name: "Synthetic browser agency", kind: "AGENCY" } }); organizations.add(organization.id);
  const membership = await db.organizationMembership.create({ data: { organizationId: organization.id, userId: seat.id, state: "ACTIVE" } });
  const all = { view: true, plan: true, approveShortlist: false, reviewContent: false, signCustomer: false, financial: false, manageGrants: false };
  const clients = [];
  // Two agencies are needed for the same Brand because each organization owns
  // one association per Brand. Both seats are genuine synthetic native rows.
  for (let i = 0; i < 2; i++) {
    const org = i === 0 ? organization : await db.organization.create({ data: { ownerUserId: owner.id, name: "Second synthetic browser agency", kind: "AGENCY" } }); organizations.add(org.id);
    const member = i === 0 ? membership : await db.organizationMembership.create({ data: { organizationId: org.id, userId: seat.id, state: "ACTIVE" } });
    const client = await db.organizationClient.create({ data: { organizationId: org.id, brandId: f.brand.id, state: "ACTIVE",
      authorizingUserId: f.user.id, authorizingSessionVersion: f.user.sessionVersion, allowedCapabilities: all } });
    const grant = await db.clientGrant.create({ data: { organizationId: org.id, membershipId: member.id, clientId: client.id, active: true, ...all } });
    const parent = await db.creatorCollection.create({ data: { scope: "CLIENT", brandId: f.brand.id, organizationId: org.id, clientId: client.id,
      name: `PRIVATE_CLIENT_${i}_ORIGINAL`, nameLanguage: "en" } }); clients.push({ client, grant, parent });
  }
  await signed(context, seat, english); await page.goto("/brand/collections?clientId=" + clients[0]!.client.id);
  await expect(page.locator("body")).toContainText("PRIVATE_CLIENT_0_ORIGINAL"); await expect(page.locator("body")).not.toContainText("PRIVATE_CLIENT_1_ORIGINAL");
  await page.goto("/brand/collections?clientId=" + clients[1]!.client.id);
  await expect(page.locator("body")).toContainText("PRIVATE_CLIENT_1_ORIGINAL"); await expect(page.locator("body")).not.toContainText("PRIVATE_CLIENT_0_ORIGINAL");
  await db.clientGrant.update({ where: { id: clients[1]!.grant.id }, data: { active: false, revision: { increment: 1 } } });
  await page.route("**/api/collections?*", async route => { const actual = await route.fetch(); expect(actual.status()).toBe(404);
    await route.fulfill({ response: actual, contentType: "text/plain", body: "labelled malformed scope denial" }); });
  await page.getByRole("button", { name: copy("تحديث البيانات", "Refresh data"), exact: true }).click();
  await expect(page.locator("body")).not.toContainText("PRIVATE_CLIENT_1_ORIGINAL");
  await expect(page.locator("#collection-create-text")).toHaveCount(0);
});

test("rejected picker save remains captured through failed reload and requires valid current review before a fresh key", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await fixture(context, english), creator = await identity(english), made = await create(page, f.scope, "Old picker revision");
  await browse(page, creator.handle, copy);
  await page.getByLabel(copy("القائمة", "Collection"), { exact: true }).selectOption(made.collectionId);
  await page.getByLabel(copy("ملاحظة خاصة", "Private note"), { exact: true }).fill("  Original rejected note  ");
  const rename = await page.request.post("/api/collections/commands", { headers: { Origin: origin }, data: {
    operationKey: randomUUID(), scope: f.scope, action: "RENAME", collectionId: made.collectionId, expectedParentRevision: 1,
    payload: { nameOriginal: { text: "Current picker revision", language: "en" } },
  } }); expect(rename.status()).toBe(200);
  const bodies: string[] = [];
  await page.route("**/api/collections/commands", async route => { bodies.push(route.request().postData()!); await route.continue(); });
  await page.getByRole("button", { name: copy("حفظ", "Save"), exact: true }).click();
  const review = page.getByRole("button", { name: copy("راجع القوائم وحرّر الطلب المرفوض", "Review collections and release the rejected request"), exact: true });
  await expect(review).toBeEnabled();
  let fault = true;
  await page.route("**/api/collections?*", async route => {
    const actual = await route.fetch(); expect(actual.status()).toBe(200);
    if (fault) { fault = false; await route.fulfill({ response: actual, status: 503, json: { error: { code: "RETRY_REQUIRED" } } }); }
    else await route.fulfill({ response: actual });
  });
  await review.click(); await expect(review).toBeEnabled();
  await expect(page.getByLabel(copy("القائمة", "Collection"), { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: copy("إعادة محاولة الحفظ نفسه", "Retry the same save"), exact: true })).toBeEnabled();
  expect(bodies).toHaveLength(1);
  await review.click(); await expect(page.getByLabel(copy("القائمة", "Collection"), { exact: true })).toBeEnabled();
  await expect(page.getByLabel(copy("ملاحظة خاصة", "Private note"), { exact: true })).toHaveValue("  Original rejected note  ");
  await page.getByLabel(copy("القائمة", "Collection"), { exact: true }).selectOption(made.collectionId);
  await page.getByRole("button", { name: copy("حفظ", "Save"), exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(copy("تم تسجيل الحفظ", "Save recorded"));
  expect(bodies).toHaveLength(2); expect(JSON.parse(bodies[0]!).operationKey).not.toBe(JSON.parse(bodies[1]!).operationKey);
  expect(JSON.parse(bodies[1]!).expectedParentRevision).toBe(2);
});

test("native CREATE lost reply and malformed receipt recover once without erasing original manual inputs", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await fixture(context, english);
  await page.goto("/brand/collections"); await page.locator("#collection-create-text").fill("  Original uncertain create  ");
  await page.locator("#collection-create-language").fill("en");
  const bodies: string[] = []; let faults = 0;
  await page.route("**/api/collections/commands", async route => {
    bodies.push(route.request().postData()!); const actual = await route.fetch(); expect(actual.status()).toBe(200);
    if (faults++ === 0) await route.abort("failed");
    else if (faults === 2) await route.fulfill({ response: actual, json: { data: {} } });
    else await route.fulfill({ response: actual });
  });
  await page.getByRole("button", { name: copy("إنشاء القائمة", "Create list"), exact: true }).click();
  const retry = page.getByRole("button", { name: copy("استعادة طلب الحفظ نفسه", "Recover the same save request"), exact: true });
  await expect(retry).toBeEnabled(); await expect(page.locator("#collection-create-text")).toHaveValue("  Original uncertain create  ");
  await retry.click(); await expect(retry).toBeEnabled(); await expect(page.locator("#collection-create-text")).toHaveValue("  Original uncertain create  ");
  await retry.click(); await expect(page.locator("#opened-collection-heading")).toHaveText("Original uncertain create");
  expect(bodies).toHaveLength(3); expect(new Set(bodies).size).toBe(1);
  expect(await db.creatorCollection.count({ where: { brandId: f.brand.id } })).toBe(1);
  expect(await db.creatorCollectionCommand.count({ where: { actorUserId: f.user.id } })).toBe(1);
});

test("retrying another list cannot silently discard a newer original-language editor", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await fixture(context, english);
  const a = await create(page, f.scope, "Original list A"), b = await create(page, f.scope, "Original list B");
  await page.goto("/brand/collections");
  const open = (name: string) => page.getByRole("heading", { level: 3, name, exact: true }).locator("..").getByRole("button", { name: copy("فتح القائمة", "Open list"), exact: true });
  await open("Original list A").click(); await expect(page.locator("#opened-collection-heading")).toHaveText("Original list A");
  let fault = true;
  await page.route("**/api/collections/entries?*", async route => {
    const actual = await route.fetch(); expect(actual.status()).toBe(200);
    if (new URL(route.request().url()).searchParams.get("collectionId") === b.collectionId && fault) {
      fault = false; await route.fulfill({ response: actual, status: 503, json: { error: { code: "RETRY_REQUIRED" } } });
    } else await route.fulfill({ response: actual });
  });
  await open("Original list B").click();
  const retry = page.getByRole("button", { name: copy("إعادة محاولة التحميل نفسه", "Retry the same load"), exact: true });
  await expect(retry).toBeEnabled();
  await page.getByRole("button", { name: copy("تغيير الاسم", "Rename"), exact: true }).click();
  await page.locator("#collection-rename-text").fill("كلماتي الجديدة New editor words");
  await retry.click(); await expect(page.locator("#collection-rename-text")).toHaveValue("كلماتي الجديدة New editor words");
  await expect(page.locator("#opened-collection-heading")).toHaveText("Original list A");
  expect((await db.creatorCollection.findUniqueOrThrow({ where: { id: a.collectionId } })).name).toBe("Original list A");
  await page.getByRole("button", { name: copy("إغلاق المحرر", "Close editor"), exact: true }).click();
  await expect(page.getByRole("button", { name: copy("تغيير الاسم", "Rename"), exact: true })).toBeFocused();
  await retry.click(); await expect(page.locator("#opened-collection-heading")).toHaveText("Original list B");
});
