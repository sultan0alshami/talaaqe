// Exactly two browser journeys on existing Arabic360/English desktop projects.
// Root alone adopts/runs. Genuine cookies, native HTTP generation/approval and
// owned synthetic content; only receipt delivery is lost after actual native200.
import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { assertLocalTarget, taskState } from "../scripts/task-state.mjs";
import { prisma as db } from "../src/lib/prisma";
import { openSession, resolveSession } from "../src/lib/identity";
import { SESSION_COOKIE } from "../src/lib/jwt";
import { captureOrganizationActor } from "../src/lib/organizations/context";
import { createOrResumeDraft, canonicalHash } from "../src/lib/onboarding/drafts";
import { profileCommand, profileForOwner } from "../src/lib/onboarding/profiles";
import { PortfolioContentSchema, type PortfolioContent } from "../src/lib/onboarding/portfolio-contract";

const state = taskState(), key = () => randomUUID(), digest = (body: string) => createHash("sha256").update(body).digest("hex");
if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("Portfolio browser requires guarded E2E target");
const users = new Set<string>(), errors = new WeakMap<Page, string[]>(), origin = "http://localhost:3100";
const commands = "**/api/onboarding/*/commands";
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 10000 }); test.setTimeout(120000);
test.beforeAll(async () => {
  const rows = await db.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]?.id !== state.id || rows[0]?.kind !== "e2e" || rows[0]?.db !== state.targets.e2e || rows[0]?.host !== "127.0.0.1") throw new Error("Portfolio E2E identity mismatch");
});
test.beforeEach(async ({ page }) => {
  const seen: string[] = []; errors.set(page, seen); page.on("pageerror", error => seen.push(error.name));
  page.on("console", event => { if (event.type() === "error" && /hydrat|server.rendered|server HTML|text content.*match/i.test(event.text())) seen.push("HYDRATION_MISMATCH"); });
  await page.addInitScript(() => {
    const observed = window as unknown as { portfolioDenialBodyReads: number }; observed.portfolioDenialBodyReads = 0;
    for (const method of ["json", "text", "arrayBuffer"] as const) {
      const original = Response.prototype[method];
      Object.defineProperty(Response.prototype, method, { configurable: true, writable: true, value: function(this: Response, ...args: unknown[]) {
        if (this.status === 401 || this.status === 403) observed.portfolioDenialBodyReads++;
        return Reflect.apply(original, this, args);
      } });
    }
  });
});
test.afterEach(async ({ page }) => {
  if (users.size) await db.outboxEvent.deleteMany({ where: { OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await db.creator.deleteMany({ where: { userId: { in: [...users] } } }); await db.brand.deleteMany({ where: { userId: { in: [...users] } } });
  await db.user.deleteMany({ where: { id: { in: [...users] } } }); users.clear(); expect(errors.get(page) ?? []).toEqual([]);
});
test.afterAll(async () => { await db.$disconnect(); });
type Copy = (ar: string, en: string) => string;
function locale(info: TestInfo) {
  const english = info.project.name === "english-desktop";
  return { english, role: english ? "CREATOR" as const : "BRAND" as const, copy: ((ar, en) => english ? en : ar) as Copy };
}
async function account(role: "CREATOR" | "BRAND", english: boolean) {
  const id = key(); users.add(id);
  const user = await db.user.create({ data: { id, role, language: english ? "en" : "ar", active: true, isTest: true, name: "Synthetic portfolio owner",
    email: id + "@example.invalid", passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  const token = await openSession(id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Owned native portfolio session did not resolve");
  return { user, token, actor: captureOrganizationActor(session) };
}
async function signed(context: BrowserContext, owner: Awaited<ReturnType<typeof account>>, english: boolean) {
  expect(await resolveSession(owner.token) !== null).toBe(true);
  await context.addCookies([{ name: SESSION_COOKIE, value: owner.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "infame_lang", value: english ? "en" : "ar", domain: "localhost", path: "/" }]);
}
async function fixture(page: Page, context: BrowserContext, role: "CREATOR" | "BRAND", english: boolean) {
  const owner = await account(role, english), suffix = key().replaceAll("-", "").slice(0, 16), canary = "PRIVATE_PORTFOLIO_" + suffix;
  if (role === "CREATOR") await db.creator.create({ data: { userId: owner.user.id, handle: "pc_" + suffix, displayName: canary, bio: canary, state: "PRIVATE", isTest: true } });
  else await db.brand.create({ data: { userId: owner.user.id, slug: "pc-" + suffix, name: canary, description: canary, state: "PRIVATE", isTest: true } });
  const options = { serverAuth: owner.actor }, draft = await createOrResumeDraft(owner.user.id, options);
  const payload = role === "CREATOR" ? { displayName: canary, infameHandle: "pc_" + suffix, bio: canary, location: null, languages: ["ar"], dialects: [], nicheSlugs: [],
    fameIndustries: [], contentStyles: [], preferredCurrency: "KWD", minimumMinor: null, availability: { status: "UNKNOWN", startsAt: null, endsAt: null }, travelWilling: false,
    ratesVisibility: "PRIVATE", rates: [], primarySourceKey: null } : { companyName: canary, brandSlug: "pc-" + suffix, description: canary, location: null, noWebsite: true,
    website: null, contactName: canary + "_CONTACT", representativeRole: "Synthetic representative", targetMarkets: ["KW"], languages: ["ar"], preferredCurrency: "KWD" };
  const saved = await profileCommand(owner.user.id, draft.id, { operationKey: key(), expectedRevision: draft.revision, action: "SAVE_PROFILE", payload }, options);
  await signed(context, owner, english);
  const response = await page.request.post("/api/onboarding/" + draft.id + "/commands", { headers: { Origin: origin }, data: { kind: "PROFILE",
    command: { operationKey: key(), expectedRevision: saved.draft.revision, action: "GENERATE_PORTFOLIO", payload: {} } } });
  expect(response.status()).toBe(200); const generated = (await response.json()).data;
  expect(generated.portfolio.version).toBe(1); expect(generated.portfolio.approvedAt === null).toBe(true);
  const native = await profileForOwner(owner.user.id, options);
  if (!native?.portfolio) throw new Error("Native generated portfolio missing");
  expect(canonicalHash(native.portfolio.content)).toBe(canonicalHash(generated.portfolio.content));
  return { ...owner, role, canary, draftId: draft.id, version: generated.portfolio.version as number, template: native.portfolio.content,
    options, path: "/" + (role === "CREATOR" ? "creator" : "brand") + "/onboarding" };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const title = (page: Page, copy: Copy) => page.getByLabel(copy("عنوان الملف", "Portfolio title"), { exact: true });
const bio = (page: Page, copy: Copy) => page.getByLabel(copy("نبذة الملف", "Portfolio overview"), { exact: true });
const heading = (page: Page, copy: Copy, number: number) => page.getByLabel(copy("عنوان القسم " + number, "Section " + number + " heading"), { exact: true });
const text = (page: Page, copy: Copy, number: number) => page.getByLabel(copy("نص القسم " + number, "Section " + number + " text"), { exact: true });
const sectionRows = (page: Page) => page.locator("[data-portfolio-section]");
const add = (page: Page, copy: Copy) => page.getByRole("button", { name: copy("أضف قسمًا", "Add section"), exact: true });
const approve = (page: Page, copy: Copy) => page.getByRole("button", { name: copy("راجعته وأعتمد هذه النسخة", "I've reviewed and approve this version"), exact: true });
const refresh = (page: Page, copy: Copy) => page.getByRole("button", { name: copy("حمّل المسودة الحالية", "Reload current draft"), exact: true });
const generate = (page: Page, copy: Copy) => page.getByRole("button", { name: copy("أنشئ نسخة جديدة", "Create new version"), exact: true });
function commandResponse(page: Page, f: Fixture) { return page.waitForResponse(response => new URL(response.url()).pathname === "/api/onboarding/" + f.draftId + "/commands" && response.request().method() === "POST"); }
async function opened(page: Page, f: Fixture, copy: Copy) {
  expect((await page.goto(f.path))?.status()).toBe(200);
  await page.getByRole("button", { name: copy("5. الملف والمشاركة", "5. Portfolio & sharing"), exact: true }).click();
  // First old-screen baseline: native generated version exists, title editor
  // is absent. This asserts the requested missing feature before new hooks.
  await expect(title(page, copy)).toBeVisible(); await expect(approve(page, copy)).toBeEnabled();
}
async function readOnly(page: Page, copy: Copy) {
  for (const field of [title(page, copy), bio(page, copy)]) expect(await field.evaluate(element => (element as HTMLInputElement).readOnly || element.matches(":disabled"))).toBe(true);
  for (let index = 1; index <= await sectionRows(page).count(); index++) for (const field of [heading(page, copy, index), text(page, copy, index)])
    expect(await field.evaluate(element => (element as HTMLInputElement).readOnly || element.matches(":disabled"))).toBe(true);
  await expect(add(page, copy)).toBeDisabled(); await expect(approve(page, copy)).toBeDisabled();
}
async function nativeContent(f: Fixture) {
  const native = await profileForOwner(f.user.id, f.options); if (!native?.portfolio) throw new Error("Owned native portfolio unavailable"); return native;
}
function sentCommands(page: Page, f: Fixture) {
  const sent: Array<{ action: string; keyHash: string; bodyHash: string }> = [];
  page.on("request", request => { if (request.method() !== "POST" || new URL(request.url()).pathname !== "/api/onboarding/" + f.draftId + "/commands") return;
    const body = request.postData(); if (!body) return; const input = JSON.parse(body) as { command: { action: string; operationKey: string } };
    sent.push({ action: input.command.action, keyHash: digest(input.command.operationKey), bodyHash: digest(body) }); });
  return sent;
}
async function exactContent(page: Page, copy: Copy, content: PortfolioContent) {
  expect(await title(page, copy).inputValue() === content.title).toBe(true); expect(await bio(page, copy).inputValue() === content.bio).toBe(true);
  await expect(sectionRows(page)).toHaveCount(content.sections.length);
  for (let at = 0; at < content.sections.length; at++) {
    expect(await heading(page, copy, at + 1).inputValue() === content.sections[at]!.heading).toBe(true);
    expect(await text(page, copy, at + 1).inputValue() === content.sections[at]!.text).toBe(true);
  }
}
async function geometry(page: Page) {
  expect(await page.evaluate(() => {
    if (document.documentElement.scrollWidth > innerWidth + 1) return false;
    const editor = document.querySelector("[data-portfolio-content-editor]");
    if (!editor) return true;
    const bounds = editor.getBoundingClientRect();
    return bounds.left >= -1 && bounds.right <= innerWidth + 1 &&
      [editor, ...editor.querySelectorAll("input,textarea,fieldset,label,section,button,p,legend")]
        .filter(element => element.getClientRects().length > 0)
        .every(element => { const rect = element.getBoundingClientRect(); return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && rect.width <= bounds.width + 1; });
  })).toBe(true);
}

test("full ordered portfolio content approves exactly, remains private and initializes a new version while same-version reads and locale changes preserve dirty edits", async ({ page, context }, info) => {
  const { english, role, copy } = locale(info), f = await fixture(page, context, role, english); await page.emulateMedia({ reducedMotion: "reduce" });
  await opened(page, f, copy); const sent = sentCommands(page, f);
  const edited: PortfolioContent = { title: "عنوان أصلي " + "Original portfolio ".repeat(8), bio: "  أصلية بدون ترجمة\nOriginal untrimmed portfolio bio  ", method: "APPROVED_FACT_TEMPLATE", sections: [
    { heading: "قسم أصلي " + "LongHeading".repeat(8), text: "  نص عربي أصلي طويل ".repeat(70) + "\nOriginal ending  " },
    { heading: "بديل أصلي Replacement", text: " \tOriginal replacement section\nيبقى كما كتبته  " },
  ] };
  await title(page, copy).fill(edited.title); await bio(page, copy).fill(edited.bio);
  await expect(title(page, copy)).toHaveAttribute("maxlength", "200"); await expect(bio(page, copy)).toHaveAttribute("maxlength", "1000");
  await add(page, copy).press("Enter"); await expect(heading(page, copy, 1)).toBeFocused();
  const removedHeading = "قسم أول سيُحذف First removed"; await heading(page, copy, 1).fill(removedHeading); await text(page, copy, 1).fill("Original section that must be removed");
  await add(page, copy).press("Enter"); await expect(heading(page, copy, 2)).toBeFocused();
  await heading(page, copy, 2).fill(edited.sections[0]!.heading); await text(page, copy, 2).fill(edited.sections[0]!.text);
  await page.getByRole("button", { name: copy("انقل القسم 2: " + edited.sections[0]!.heading + " للأعلى", "Move section 2: " + edited.sections[0]!.heading + " up"), exact: true }).press("Enter");
  expect(await heading(page, copy, 1).inputValue() === edited.sections[0]!.heading).toBe(true);
  await expect.poll(() => sectionRows(page).nth(0).evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.getByRole("button", { name: copy("احذف القسم 2: " + removedHeading, "Remove section 2: " + removedHeading), exact: true }).press("Enter");
  await expect(sectionRows(page)).toHaveCount(1); await expect.poll(() => sectionRows(page).nth(0).evaluate(element => element.contains(document.activeElement))).toBe(true);
  await add(page, copy).press("Enter"); await heading(page, copy, 2).fill(edited.sections[1]!.heading); await text(page, copy, 2).fill(edited.sections[1]!.text); await exactContent(page, copy, edited); await geometry(page);
  await mkdir("output/portfolio-editor", { recursive: true });
  await page.screenshot({ path: "output/portfolio-editor/" + info.project.name + "-full-content.png", fullPage: true });
  const approval = commandResponse(page, f); await approve(page, copy).click(); const approved = await approval; expect(approved.status()).toBe(200);
  const body = approved.request().postData(); if (!body) throw new Error("Native complete approval body missing");
  const input = JSON.parse(body) as { kind: string; command: { operationKey: string; action: string; payload: { portfolioVersion: number; content: PortfolioContent } } };
  expect(input.kind).toBe("PROFILE"); expect(input.command.action).toBe("APPROVE_PORTFOLIO"); expect(input.command.payload.portfolioVersion).toBe(f.version);
  expect(canonicalHash(input.command.payload.content)).toBe(canonicalHash(edited));
  await readOnly(page, copy); const native = await nativeContent(f);
  expect(canonicalHash(native.portfolio!.content)).toBe(canonicalHash(PortfolioContentSchema.parse(edited))); expect(native.portfolio!.approvedAt !== null).toBe(true);
  expect(native.profile.state).toBe("PRIVATE"); await expect(page.getByRole("button", { name: copy("انشر الملف", "Publish profile"), exact: true })).toBeDisabled();
  await expect(page.getByLabel(copy("أوافق على نشر الأقسام الظاهرة للعموم بعد استيفاء الإثباتات المطلوبة", "I consent to publishing the visible sections after required evidence is accepted"), { exact: true })).not.toBeChecked();
  expect(sent.some(row => row.action === "PUBLISH")).toBe(false);
  const newVersion = commandResponse(page, f); await generate(page, copy).click(); const generated = await newVersion; expect(generated.status()).toBe(200);
  const actualVersion = (await generated.json()).data.portfolio; expect(actualVersion.version).toBe(f.version + 1); await expect(approve(page, copy)).toBeEnabled();
  await exactContent(page, copy, actualVersion.content); expect(actualVersion.approvedAt === null).toBe(true);
  const dirty = { ...actualVersion.content, title: "Unsaved original title \u0623\u0635\u0644\u064a", bio: "  Original dirty bio\n  " } as PortfolioContent;
  await title(page, copy).fill(dirty.title); await bio(page, copy).fill(dirty.bio);
  const read = page.waitForResponse(response => new URL(response.url()).pathname === "/api/onboarding" && response.request().method() === "GET");
  await refresh(page, copy).click(); expect((await read).status()).toBe(200); await expect(refresh(page, copy)).toBeEnabled(); await exactContent(page, copy, dirty);
  await page.getByRole("button", { name: copy("التبديل إلى الإنجليزية", "Switch to Arabic"), exact: true }).click();
  const otherCopy: Copy = (ar, en) => english ? ar : en; await expect(title(page, otherCopy)).toBeVisible(); await exactContent(page, otherCopy, dirty);
  await page.getByRole("button", { name: otherCopy("التبديل إلى الإنجليزية", "Switch to Arabic"), exact: true }).click(); await exactContent(page, copy, dirty);
  const before = sent.length; await generate(page, copy).click(); const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: copy("تابع التحرير", "Keep editing"), exact: true }).click(); await expect(dialog).toHaveCount(0); expect(sent.length).toBe(before); await exactContent(page, copy, dirty);
  await generate(page, copy).click(); const discarded = commandResponse(page, f); await dialog.getByRole("button", { name: copy("تجاهل التعديلات وأنشئ نسخة جديدة", "Discard edits and create new version"), exact: true }).click();
  const afterDiscard = await discarded; expect(afterDiscard.status()).toBe(200); const third = (await afterDiscard.json()).data.portfolio;
  expect(third.version).toBe(f.version + 2); await expect(approve(page, copy)).toBeEnabled(); await exactContent(page, copy, third.content);
  expect((await nativeContent(f)).profile.state).toBe("PRIVATE"); expect(sent.some(row => row.action === "PUBLISH")).toBe(false); await geometry(page);
});

test("lost native full approval keeps immutable exact retry and locked editing; native401 clears all portfolio content before denial-body parsing", async ({ page, context }, info) => {
  const { english, role, copy } = locale(info), f = await fixture(page, context, role, english); await opened(page, f, copy); const sent = sentCommands(page, f);
  const edited: PortfolioContent = { title: "Original frozen title أصلي", bio: "  Original frozen bio\nيبقى كاملًا  ", method: "APPROVED_FACT_TEMPLATE", sections: [
    { heading: "Original first heading", text: "  First exact original text\n  " }, { heading: "عنوان ثان أصلي", text: " \tSecond original text  " },
  ] };
  await title(page, copy).fill(edited.title); await bio(page, copy).fill(edited.bio);
  for (let index = 0; index < edited.sections.length; index++) { await add(page, copy).click(); await heading(page, copy, index + 1).fill(edited.sections[index]!.heading); await text(page, copy, index + 1).fill(edited.sections[index]!.text); }
  const committed = (() => { let release!: () => void; return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() }; })();
  let capturedBody = "", nativeCommit = false;
  await page.route(commands, async route => {
    capturedBody = route.request().postData() ?? ""; const response = await route.fetch(); expect(response.status()).toBe(200); nativeCommit = true; committed.release(); await route.abort("failed");
  });
  await approve(page, copy).click(); await committed.promise; await expect(page.locator('[data-onboarding-recovery="UNKNOWN"]')).toBeVisible();
  await expect(page.locator("[data-onboarding-exact-retry]")).toBeEnabled(); expect(nativeCommit).toBe(true); expect(sent.length).toBe(1);
  const original = sent[0]!; const parsed = JSON.parse(capturedBody) as { command: { operationKey: string; payload: { portfolioVersion: number; content: PortfolioContent } } };
  expect(canonicalHash(parsed.command.payload.content)).toBe(canonicalHash(edited)); expect(parsed.command.payload.portfolioVersion).toBe(f.version);
  expect(canonicalHash((await nativeContent(f)).portfolio!.content)).toBe(canonicalHash(edited)); await page.unroute(commands);
  for (const input of [title(page, copy), bio(page, copy), heading(page, copy, 1), text(page, copy, 1)]) await expect(input).toBeDisabled();
  await expect(add(page, copy)).toBeDisabled(); await expect(generate(page, copy)).toBeDisabled();
  // Explicit adversarial DOM seam cannot change the retained command packet.
  await title(page, copy).evaluate(element => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, "LATER_DOM_MUTATION"); element.dispatchEvent(new Event("input", { bubbles: true })); });
  const read = page.waitForResponse(response => new URL(response.url()).pathname === "/api/onboarding" && response.request().method() === "GET");
  await page.locator("[data-onboarding-read-recovery]").click(); expect((await read).status()).toBe(200); await expect(page.locator("[data-onboarding-exact-retry]")).toBeEnabled();
  await expect(page.locator('[data-onboarding-recovery="UNKNOWN"]')).toBeVisible(); expect(sent.length).toBe(1);
  const replay = commandResponse(page, f); await page.locator("[data-onboarding-exact-retry]").click(); const response = await replay; expect(response.status()).toBe(200);
  expect((await response.json()).data.replayed).toBe(true); await readOnly(page, copy); expect(sent.length).toBe(2); expect(sent[1]).toEqual(original);
  expect(await db.draftCommand.count({ where: { draftId: f.draftId, operationKey: "profile:" + parsed.command.operationKey } })).toBe(1);
  expect(await db.outboxEvent.count({ where: { deduplicationKey: "profile:" + f.draftId + ":" + parsed.command.operationKey } })).toBe(1);
  expect((await nativeContent(f)).profile.state).toBe("PRIVATE"); await exactContent(page, copy, edited);
  await db.authSession.update({ where: { id: f.actor.sessionId }, data: { revokedAt: new Date() } });
  const denial = page.waitForResponse(response => new URL(response.url()).pathname === "/api/onboarding" && response.request().method() === "GET");
  await refresh(page, copy).click(); expect((await denial).status()).toBe(401);
  await expect(page.locator('[data-onboarding-session="denied"]')).toBeVisible(); await expect(title(page, copy)).toHaveCount(0); await expect(sectionRows(page)).toHaveCount(0);
  const ended = page.getByRole("heading", { name: copy("انتهت جلستك", "Your session ended"), exact: true }); await expect(ended).toBeVisible(); await expect(ended).toBeFocused();
  expect(await page.locator("input,textarea").evaluateAll((elements, canaries) => elements.some(element => canaries.some(canary => (element as HTMLInputElement).value.includes(canary))),
    [f.canary, edited.title, edited.bio, ...edited.sections.flatMap(section => [section.heading, section.text])])).toBe(false);
  expect(await page.evaluate(() => (window as unknown as { portfolioDenialBodyReads: number }).portfolioDenialBodyReads)).toBe(0); expect(sent.length).toBe(2); await geometry(page);
});
