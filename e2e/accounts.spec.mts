import { randomBytes } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { test, expect } from "@playwright/test";
import { taskState, assertLocalTarget, workspace } from "../scripts/task-state.mjs";

const state = taskState();
if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("Account journeys require exact E2E task target");
const db = new PrismaClient();
const users: string[] = [];
test.beforeAll(async () => {
  const marker = await db.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id, kind, current_database() AS db, host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (marker.length !== 1 || marker[0].id !== state.id || marker[0].kind !== "e2e" || marker[0].db !== state.targets.e2e || marker[0].host !== "127.0.0.1") throw new Error("Incorrect E2E database identity");
});
test.afterAll(async () => {
  await db.creator.deleteMany({ where: { userId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});

for (const role of ["CREATOR", "BRAND"] as const) {
  test(`${role} signup, current authorization and original-language private onboarding`, async ({ page, context }, info) => {
    const english = info.project.name === "english-desktop", label = (ar: string, en: string) => english ? en : ar;
    if (english) await context.addCookies([{ name: "infame_lang", value: "en", domain: "localhost", path: "/" }]);
    const email = `browser-${randomBytes(8).toString("hex")}@example.invalid`;
    await page.goto(`/signup?role=${role === "BRAND" ? "brand" : "creator"}`);
    await page.getByLabel(label("الاسم", "Name"), { exact: true }).fill("اختبار إنفيم Browser");
    await page.getByLabel(label("البريد الإلكتروني", "Email"), { exact: true }).fill(email);
    await page.getByLabel(label("كلمة المرور", "Password"), { exact: true }).fill("Browser fixture password 29");
    await page.getByRole("button", { name: label("إنشاء حساب", "Create account"), exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${role.toLowerCase()}$`));
    const user = await db.user.findUniqueOrThrow({ where: { email } }); users.push(user.id);
    expect(user.role).toBe(role);
    const sessionCookie = (await context.cookies()).find((cookie) => cookie.name === "infame_session");
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.sameSite).toBe("Lax");
    expect((await page.request.get("/api/me")).status()).toBe(200);
    expect((await page.request.get("/api/projects")).status()).toBe(410);
    expect((await page.request.post("/api/onboarding", { headers: { Origin: "https://attacker.example" } })).status()).toBe(403);
    await page.goto(role === "CREATOR" ? "/brand" : "/creator");
    await expect(page).toHaveURL(new RegExp(`/${role.toLowerCase()}$`));
    await page.goto(`/${role.toLowerCase()}/onboarding`);
    await page.getByRole("button", { name: label("أكتب", "Type"), exact: true }).click();
    await expect(page.getByRole("button", { name: label("أكتب", "Type"), exact: true })).toHaveCount(0);
    await page.getByLabel(role === "CREATOR" ? label("اسمك الظاهر", "Display name") : label("اسم الشركة", "Company name"), { exact: true }).fill("ملف عربي أصلي");
    await page.getByLabel(role === "CREATOR" ? label("معرّف إنفيم", "Infame handle") : label("معرّف الشركة", "Company slug"), { exact: true }).fill(`browser${randomBytes(5).toString("hex")}`);
    await page.getByLabel(label("نبذة بكلماتك", "Overview in your own words"), { exact: true }).fill("هذا النص يبقى بلغته الأصلية عند تبديل الواجهة.");
    if (role === "BRAND") {
      await page.getByLabel(label("اسم ممثل الشركة (خاص)", "Representative name (private)"), { exact: true }).fill("ممثل الاختبار");
      await page.getByLabel(label("دورك في الشركة (خاص)", "Your company role (private)"), { exact: true }).fill("مالك");
      await page.getByLabel(label("ما عندنا موقع حاليًا", "We don't have a website yet"), { exact: true }).check();
    }
    await page.getByRole("button", { name: label("احفظ المسودة الخاصة", "Save private draft"), exact: true }).click();
    await expect(page.getByText(label("انحفظت مسودتك الخاصة. تقدر ترجع لها بأي وقت.", "Your private draft is saved. You can resume anytime."), { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(role === "CREATOR" ? label("اسمك الظاهر", "Display name") : label("اسم الشركة", "Company name"), { exact: true })).toHaveValue("ملف عربي أصلي");
    await page.goto(`/${role.toLowerCase()}/profile`);
    await expect(page.getByRole("heading", { name: role === "CREATOR" ? label("ملفي", "My profile") : label("ملف الشركة", "Company profile"), exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "ملف عربي أصلي", exact: true })).toBeVisible();
    await expect(page.getByText("هذا النص يبقى بلغته الأصلية عند تبديل الواجهة.", { exact: true })).toBeVisible();
    await expect(page.getByText(label("محفوظ بشكل خاص", "Saved privately"), { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("link", { name: label("تعديل الملف", "Edit profile"), exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${role.toLowerCase()}/onboarding$`));
    const languageToggle = page.getByRole("button", { name: english ? "Switch to Arabic" : "التبديل إلى الإنجليزية", exact: true });
    await expect(languageToggle).toBeVisible();
    await languageToggle.click();
    await expect(page.locator("html")).toHaveAttribute("lang", english ? "ar" : "en");
    await expect(page.locator("html")).toHaveAttribute("dir", english ? "rtl" : "ltr");
    await expect(page.getByLabel(english ? "نبذة بكلماتك" : "Overview in your own words", { exact: true })).toHaveValue("هذا النص يبقى بلغته الأصلية عند تبديل الواجهة.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const directory = path.join(workspace, ".infame", "artifacts"); mkdirSync(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, `${info.project.name}-${role.toLowerCase()}-private-onboarding.png`), fullPage: true });
    await page.goto(`/${role.toLowerCase()}/profile`);
    await expect(page.getByRole("heading", { name: "ملف عربي أصلي", exact: true })).toBeVisible();
    await expect(page.getByText("هذا النص يبقى بلغته الأصلية عند تبديل الواجهة.", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(directory, `${info.project.name}-${role.toLowerCase()}-original-profile.png`), fullPage: true });
    await db.user.update({ where: { id: user.id }, data: { active: false } });
    expect((await page.request.get("/api/me")).status()).toBe(401);
    await page.goto(`/${role.toLowerCase()}/onboarding`);
    await expect(page).toHaveURL(/\/login/);
    await page.goto(`/${role.toLowerCase()}/profile`);
    await expect(page).toHaveURL(/\/login/);
  });
}

test("hashed one-use verification and password reset revoke the browser session", async ({ page, context }, info) => {
  if (info.project.name !== "arabic-mobile") { test.skip(); return; }
  // Login uses a separately owned fixture account so signup's real distributed
  // throttle is neither weakened nor reset for automation.
  const email = `browser-token-${randomBytes(8).toString("hex")}@example.invalid`;
  const bcrypt = await import("bcryptjs");
  const user = await db.user.create({ data: { name: "Synthetic token browser", email, role: "CREATOR", passwordHash: await bcrypt.hash("Browser token password 41", 12), isTest: true, creator: { create: { handle: `browser${randomBytes(6).toString("hex")}`, displayName: "Synthetic browser", isTest: true } } } }); users.push(user.id);
  const origin = { Origin: "http://localhost:3100" };
  const login = await page.request.post("/api/auth/login", { headers: origin, data: { email, password: "Browser token password 41" } }); expect(login.status()).toBe(200);
  expect((await page.request.post("/api/auth/send-verification", { headers: origin })).status()).toBe(200);
  const deliveries = () => readFileSync(path.join(workspace, ".infame", state.id, "deliveries-e2e.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as { email: string; purpose: string; link: string });
  const verifyLink = deliveries().filter((delivery) => delivery.email === email && delivery.purpose === "VERIFY_EMAIL").at(-1)!.link;
  const token = new URL(verifyLink).searchParams.get("token")!;
  expect(await db.authToken.count({ where: { userId: user.id, tokenHash: token } })).toBe(0);
  await page.goto(verifyLink);
  await page.getByRole("button", { name: "تأكيد البريد", exact: true }).click();
  await expect(page.getByText("تم تأكيد بريدك.", { exact: true })).toBeVisible();
  expect((await page.request.post("/api/auth/verify-email", { headers: origin, data: { token } })).status()).toBe(400);
  expect((await page.request.post("/api/auth/recover", { headers: origin, data: { email } })).status()).toBe(200);
  const resetLink = deliveries().filter((delivery) => delivery.email === email && delivery.purpose === "RESET_PASSWORD").at(-1)!.link;
  await page.goto(resetLink);
  await page.getByLabel("كلمة المرور", { exact: true }).fill("New browser token password 43");
  await page.getByRole("button", { name: "حفظ كلمة المرور", exact: true }).click();
  await expect(page.getByText("تغيّرت كلمة المرور. ادخل من جديد.", { exact: true })).toBeVisible();
  expect((await page.request.get("/api/me")).status()).toBe(401);
  const resetToken = new URL(resetLink).searchParams.get("token")!;
  expect((await page.request.post("/api/auth/reset", { headers: origin, data: { token: resetToken, password: "Replay token password 43" } })).status()).toBe(400);
  expect((await context.cookies()).some((cookie) => cookie.name === "infame_session")).toBe(true); // DB revocation beats stale browser cookie.
});

