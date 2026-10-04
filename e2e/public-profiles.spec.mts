import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { assertLocalTarget, taskState, workspace } from "../scripts/task-state.mjs";
import { cleanupReviewedEvidence, reviewedOwnershipFixture, reviewedRepresentativeFixture } from "../tests/helpers/reviewed-evidence";
import { publicCreator } from "../src/lib/onboarding/profiles";

// Actual public browser projections over explicitly synthetic reviewed local
// evidence. These fixtures do not establish live publication/provider/legal use.
const state = taskState();
if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("Public profile browser checks require the exact isolated E2E target");
const db = new PrismaClient(), users: string[] = [];
test.beforeAll(async () => {
  const rows = await db.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id, kind, current_database() AS db, host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0].id !== state.id || rows[0].kind !== "e2e" || rows[0].db !== state.targets.e2e || rows[0].host !== "127.0.0.1") throw new Error("Public profile browser target identity mismatch");
});
test.afterEach(async () => {
  await db.creator.deleteMany({ where: { userId: { in: users } } });
  await db.brand.deleteMany({ where: { userId: { in: users } } });
  await cleanupReviewedEvidence(db, users, "e2e");
  await db.user.deleteMany({ where: { id: { in: users.splice(0) } } });
});
test.afterAll(async () => { await db.$disconnect(); });
async function actor(role: "CREATOR" | "BRAND" | "ADMIN") {
  const id = randomUUID(); users.push(id);
  // isTest=false intentionally exercises production projection predicates in
  // this native-guarded disposable target only. No external user is created.
  await db.user.create({ data: { id, role, name: "Synthetic public browser actor", email: `${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: new Date(), isTest: false } });
  return id;
}
const originalBio = "نبذة أصلية محفوظة كما كتبها صاحب الملف — بيانات اختبار اصطناعية فقط.";
const originalHeading = "أعمالي بكلماتي", originalSection = "هذا النص الأصلي لا يتغير مع لغة الواجهة.";
const content = { title: "Synthetic public portfolio", bio: originalBio, sections: [{ heading: originalHeading, text: originalSection }], method: "APPROVED_FACT_TEMPLATE" };
const artifacts = path.join(workspace, ".infame", "artifacts");

test("public creator keeps original words, exact permitted rates and work; revoked proof withdraws identity", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop", owner = await actor("CREATOR"), reviewer = await actor("ADMIN"), now = new Date();
  if (english) await context.addCookies([{ name: "infame_lang", value: "en", domain: "localhost", path: "/" }]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const handle = `public_${owner.replaceAll("-", "").slice(0, 23)}`, privateMarker = `PRIVATE_CREATOR_${owner}`;
  const name = "صانعة محتوى اصطناعية باسم طويل لاختبار التفاف النص Synthetic creator";
  const creator = await db.creator.create({ data: { userId: owner, handle, displayName: name, countryCode: "KW", languages: ["ar", "en"], nicheIds: ["beauty"], state: "PUBLISHED", isTest: false, publicConsentAt: now,
    profileFacts: { ratesVisibility: "PUBLIC", contactName: privateMarker, privateMetrics: privateMarker } } });
  const account = await db.socialAccount.create({ data: { creatorId: creator.id, platform: "INSTAGRAM", handle, intendedConfirmedAt: now, consentAt: now } });
  const proof = await reviewedOwnershipFixture(db, owner, reviewer, account.id, "e2e", now);
  await db.socialAccount.update({ where: { id: account.id }, data: { publicVisible: true } });
  await db.creator.update({ where: { id: creator.id }, data: { primaryAccountId: account.id } });
  await db.socialAccount.create({ data: { creatorId: creator.id, platform: "TIKTOK", handle: "unproved_private_account", publicVisible: true } });
  await db.portfolioVersion.create({ data: { creatorId: creator.id, version: 1, inputRevision: 1, approvedAt: now, content } });
  await db.creatorRate.create({ data: { creatorId: creator.id, platform: "INSTAGRAM", format: "STORY", currency: "KWD", amountMinor: BigInt("9223372036854775807") } });
  await db.creatorWork.createMany({ data: [
    { creatorId: creator.id, title: "عمل أصلي اختاره صاحب الملف", description: "وصف أصلي منشور", approvedAt: now, publicVisible: true },
    { creatorId: creator.id, title: privateMarker, description: privateMarker, approvedAt: now, publicVisible: false },
  ] });
  expect(await publicCreator(handle, db), "The reviewed local creator fixture must satisfy canonical publication gates").not.toBeNull();
  expect((await page.goto(`/@${handle}`))?.status()).toBe(200);
  const main = page.getByRole("main");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: english ? "Skip to content" : "انتقل إلى المحتوى", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#infame-main")).toBeFocused();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(main.getByText(originalBio, { exact: true })).toBeVisible();
  await expect(main.getByText(originalSection, { exact: true })).toBeVisible();
  await expect(main.getByText("9223372036854775.807 KWD", { exact: true })).toBeVisible();
  await expect(main.getByText("عمل أصلي اختاره صاحب الملف", { exact: true })).toBeVisible();
  await expect(main).not.toContainText(privateMarker);
  await expect(main).not.toContainText("unproved_private_account");
  await expect(main.locator('a[href*="/api/evidence"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: english ? "التبديل إلى العربية" : "Switch to English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", english ? "rtl" : "ltr");
  await expect(main.getByText(originalBio, { exact: true })).toBeVisible();
  await expect(main.getByText(originalSection, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, `${info.project.name}-public-creator-original.png`), fullPage: true });
  await db.creator.update({ where: { id: creator.id }, data: { profileFacts: { ratesVisibility: "BRAND_ONLY", contactName: privateMarker } } });
  await page.reload();
  await expect(main).not.toContainText("9223372036854775.807");
  await db.privateAsset.update({ where: { id: proof.proofId }, data: { deletedAt: new Date() } });
  expect((await page.reload())?.status()).toBe(404);
  await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(0);
  expect(await page.title()).not.toContain(name);
});

test("public company omits private representation and withdraws on reviewer suspension", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop", owner = await actor("BRAND"), reviewer = await actor("ADMIN"), now = new Date();
  if (english) await context.addCookies([{ name: "infame_lang", value: "en", domain: "localhost", path: "/" }]);
  const name = "شركة اصطناعية باسم طويل لاختبار الصفحة الأصلية Synthetic brand", slug = `public-brand-${owner.slice(0, 8)}`, privateMarker = `PRIVATE_REPRESENTATIVE_${owner}`;
  const brand = await db.brand.create({ data: { userId: owner, slug, name, countryCode: "KW", isTest: false, state: "PUBLISHED", publicConsentAt: now, website: "https://brand.example.com/", profileFacts: { contactName: privateMarker, representativeRole: privateMarker } } });
  await reviewedRepresentativeFixture(db, owner, reviewer, brand.id, "e2e", now);
  await db.brand.update({ where: { id: brand.id }, data: { state: "PUBLISHED" } });
  await db.brandPortfolioVersion.create({ data: { brandId: brand.id, version: 1, inputRevision: 1, approvedAt: now, content } });
  expect((await page.goto(`/brands/${slug}`))?.status()).toBe(200);
  const main = page.getByRole("main");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: english ? "Skip to content" : "انتقل إلى المحتوى", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#infame-main")).toBeFocused();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(main.getByText(originalBio, { exact: true })).toBeVisible();
  await expect(main).not.toContainText(privateMarker);
  await expect(main.locator('a[href*="/api/evidence"]')).toHaveCount(0);
  await expect(main.locator('a[href="https://brand.example.com/"]').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: english ? "التبديل إلى العربية" : "Switch to English", exact: true }).click();
  await expect(main.getByText(originalSection, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, `${info.project.name}-public-brand-original.png`), fullPage: true });
  await db.user.update({ where: { id: reviewer }, data: { active: false } });
  expect((await page.reload())?.status()).toBe(404);
  await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(0);
  expect(await page.title()).not.toContain(name);
});
