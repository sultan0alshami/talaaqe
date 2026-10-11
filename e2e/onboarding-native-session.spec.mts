// Exactly two journeys, existing Arabic360/English projects. Root alone runs.
// Genuine guarded native owners/sessions/commands are separate from explicitly
// labelled delivery/body/DOM seams. No screenshots, traces or transcript dumps.
import { createHash, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { assertLocalTarget, taskState } from "../scripts/task-state.mjs";
import { prisma as db } from "../src/lib/prisma";
import { openSession, resolveSession } from "../src/lib/identity";
import { SESSION_COOKIE } from "../src/lib/jwt";
import { captureOrganizationActor } from "../src/lib/organizations/context";
import { createOrResumeDraft, getDraft, canonicalHash } from "../src/lib/onboarding/drafts";
import { profileCommand, profileForOwner } from "../src/lib/onboarding/profiles";

const state = taskState(), key = () => randomUUID(), digest = (body: string) => createHash("sha256").update(body).digest("hex");
if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("Onboarding browser requires exact guarded E2E target");
const users = new Set<string>(), errors = new WeakMap<Page, string[]>();
const onboarding = "**/api/onboarding", commands = "**/api/onboarding/*/commands";
test.use({ trace: "off", actionTimeout: 10000 }); test.setTimeout(120000);
test.beforeAll(async () => {
  const rows = await db.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]?.id !== state.id || rows[0]?.kind !== "e2e" || rows[0]?.db !== state.targets.e2e || rows[0]?.host !== "127.0.0.1") throw new Error("Onboarding E2E identity mismatch");
});
test.beforeEach(async ({ page }) => {
  const seen: string[] = []; errors.set(page, seen); page.on("pageerror", error => seen.push(error.name));
  page.on("console", event => { if (event.type() === "error" && /hydrat|server.rendered|server HTML|text content.*match/i.test(event.text())) seen.push("HYDRATION_MISMATCH"); });
  await page.addInitScript(() => {
    const observed = window as unknown as { onboardingDenialBodyReads: number }; observed.onboardingDenialBodyReads = 0;
    // Observation seam forwards the actual readers, recording counts only.
    for (const name of ["json", "text", "arrayBuffer"] as const) {
      const original = Response.prototype[name];
      Object.defineProperty(Response.prototype, name, { configurable: true, writable: true, value: function(this: Response, ...args: unknown[]) {
        if (this.status === 401 || this.status === 403) observed.onboardingDenialBodyReads++;
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
function locale(info: TestInfo) { const english = info.project.name === "english-desktop"; return { english, role: english ? "CREATOR" as const : "BRAND" as const, copy: (ar: string, en: string) => english ? en : ar }; }
type Copy = (ar: string, en: string) => string;
async function person(role: "BRAND" | "CREATOR" | "ADMIN", english: boolean) {
  const id = key(); users.add(id);
  const user = await db.user.create({ data: { id, role, language: english ? "en" : "ar", active: true, isTest: true,
    name: "Synthetic onboarding browser owner", email: id + "@example.invalid", passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  return { user, ...await renewed(id) };
}
async function renewed(id: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id } }), token = await openSession(id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Owned onboarding native session did not resolve"); return { token, actor: captureOrganizationActor(session) };
}
type Account = Awaited<ReturnType<typeof person>>;
async function signed(context: BrowserContext, account: Pick<Account, "token">, english: boolean) {
  expect(await resolveSession(account.token)).not.toBeNull(); await context.addCookies([
    { name: SESSION_COOKIE, value: account.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "infame_lang", value: english ? "en" : "ar", domain: "localhost", path: "/" },
  ]);
}
async function fixture(role: "BRAND" | "CREATOR", english: boolean, large = false) {
  const account = await person(role, english), suffix = key().replaceAll("-", "").slice(0, 16), canary = "PRIVATE_ONBOARDING_" + suffix;
  if (role === "CREATOR") await db.creator.create({ data: { userId: account.user.id, handle: "ob_" + suffix, displayName: canary, bio: canary, state: "PRIVATE", isTest: true } });
  else await db.brand.create({ data: { userId: account.user.id, slug: "ob-" + suffix, name: canary, description: canary, state: "PRIVATE", isTest: true } });
  const options = { serverAuth: account.actor }, draft = await createOrResumeDraft(account.user.id, options);
  const payload = role === "CREATOR" ? { displayName: canary, infameHandle: "ob_" + suffix, bio: canary, location: null, languages: ["ar"], dialects: [],
    nicheSlugs: [], fameIndustries: [], contentStyles: [], preferredCurrency: "KWD", minimumMinor: null, availability: { status: "UNKNOWN", startsAt: null, endsAt: null },
    travelWilling: false, ratesVisibility: "PRIVATE", rates: [], primarySourceKey: null } : { companyName: canary, brandSlug: "ob-" + suffix, description: canary,
    location: null, noWebsite: true, website: null, contactName: canary + "_CONTACT", representativeRole: "Synthetic representative", targetMarkets: ["KW"], languages: ["ar"], preferredCurrency: "KWD" };
  const saved = await profileCommand(account.user.id, draft.id, { operationKey: key(), expectedRevision: draft.revision, action: "SAVE_PROFILE", payload }, options);
  await profileCommand(account.user.id, draft.id, { operationKey: key(), expectedRevision: saved.draft.revision, action: "GENERATE_PORTFOLIO", payload: {} }, options);
  if (large) {
    // Structural owned 300KB original observation exercises accepted native DTO
    // size, never live imported facts, source entailment or provider readiness.
    const current = await db.onboardingDraft.findUniqueOrThrow({ where: { id: draft.id } });
    await db.onboardingDraft.update({ where: { id: draft.id }, data: { input: { ...(current.input as object), facts: { instagram: [{
      id: key(), jobId: "synthetic-owned-observation", fieldKey: "bio", value: "x".repeat(300000), unit: null, source: "SELF_REPORTED", evidenceAt: null,
      sourceReference: null, reviewStatus: "PROPOSED", visibility: "PRIVATE",
    }] } } } });
  }
  return { ...account, role, canary, draftId: draft.id, path: "/" + (role === "CREATOR" ? "creator" : "brand") + "/onboarding", options };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const save = (page: Page, copy: Copy) => page.getByRole("button", { name: copy("احفظ المسودة الخاصة", "Save private draft"), exact: true });
const nameInput = (page: Page, f: Fixture, copy: Copy) => page.getByLabel(f.role === "CREATOR" ? copy("اسمك الظاهر", "Display name") : copy("اسم الشركة", "Company name"), { exact: true });
const currentRead = (page: Page, copy: Copy) => {
  const fallback = { name: copy("حمّل المسودة الحالية", "Reload current draft"), exact: true };
  const withoutRecovery = 'body:not(:has([data-onboarding-read-recovery]))';
  // Recovery owns reconciliation while present; otherwise prefer the existing
  // error read, then the portfolio refresh. The branches are mutually exclusive.
  return page.getByRole("button", { name: copy("حمّل الحالة دون إعادة التغيير", "Read current state without resending"), exact: true })
    .and(page.locator("[data-onboarding-read-recovery]"))
    .or(page.locator(withoutRecovery).locator("[data-onboarding-error]").getByRole("button", fallback))
    .or(page.locator(withoutRecovery + ':not(:has([data-onboarding-error] button))').getByRole("button", fallback)
      .and(page.locator("[data-portfolio-read-current]")));
};
function latch() { let release!: () => void; return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() }; }
function failure(status = 503, code = "RETRY_REQUIRED") { const requestId = key(); return { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", "X-Request-Id": requestId },
  body: JSON.stringify({ error: { code, message: code, requestId, retryable: status === 503 || status === 429 }, requestId }) }; }
async function opened(page: Page, context: BrowserContext, f: Fixture, english: boolean, copy: Copy) {
  await signed(context, f, english); expect((await page.goto(f.path))?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: copy("خلّنا نتعرف عليك", "Let's get to know you"), exact: true })).toBeVisible();
  await expect(nameInput(page, f, copy)).toBeVisible();
}
async function nativeName(f: Fixture) { const owner = await profileForOwner(f.user.id, f.options); if (!owner) throw new Error("Owned profile missing"); return owner.profile.displayName; }
async function denied(page: Page, f: Fixture, copy: Copy, status: 401 | 403) {
  // Original labels/values make this a meaningful old-UI baseline, not merely a
  // missing new-hook failure. No transcript/HTML/body is printed by assertions.
  await expect(nameInput(page, f, copy)).toHaveCount(0); await expect(save(page, copy)).toHaveCount(0);
  await expect.poll(() => page.locator("input,textarea").evaluateAll((nodes, canary) => nodes.some(node => (node as HTMLInputElement).value.includes(canary)), f.canary)).toBe(false);
  const heading = page.getByRole("heading", { name: status === 401 ? copy("انتهت جلستك", "Your session ended") : copy("بياناتك غير متاحة", "Your information is unavailable"), exact: true });
  await expect(heading).toBeVisible(); await expect(heading).toBeFocused();
  await expect(page.locator('[data-onboarding-session="denied"]')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { onboardingDenialBodyReads: number }).onboardingDenialBodyReads)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
async function saveWithFailedRead(page: Page, f: Fixture, copy: Copy, value: string) {
  await page.route(onboarding, route => route.request().method() === "GET" ? route.fulfill(failure()) : route.continue());
  const followup = page.waitForResponse(row => new URL(row.url()).pathname === "/api/onboarding" && row.request().method() === "GET" && row.status() === 503);
  const response = page.waitForResponse(row => new URL(row.url()).pathname === "/api/onboarding/" + f.draftId + "/commands" && row.request().method() === "POST");
  await nameInput(page, f, copy).fill(value); await save(page, copy).click(); const accepted = await response; expect(accepted.status()).toBe(200);
  await (await followup).finished(); await expect(currentRead(page, copy)).toBeEnabled();
  const body = accepted.request().postData(); if (!body) throw new Error("Actual profile command body missing");
  const input = JSON.parse(body) as { kind: string; command: { action: string; operationKey: string; expectedRevision: number; payload: unknown } };
  expect(input.kind).toBe("PROFILE"); expect(input.command.action).toBe("SAVE_PROFILE");
  await expect(save(page, copy)).toBeDisabled(); await expect(page.locator('[data-onboarding-recovery="CONFIRMED"]')).toBeVisible();
  expect(await nativeName(f) === value.trim()).toBe(true); const receipt = await db.draftCommand.findUniqueOrThrow({ where: { draftId_operationKey: { draftId: f.draftId, operationKey: "profile:" + input.command.operationKey } } });
  expect(receipt.payloadHash).toBe(canonicalHash(input.command)); await page.unroute(onboarding); return { input, hash: digest(body) };
}

test("native401/403 clears private onboarding before malformed denial bodies and late reads cannot restore it until authenticated remount", async ({ page, context }, info) => {
  const { english, role, copy } = locale(info); await page.emulateMedia({ reducedMotion: "reduce" });
  // Actual schema-default DRAFT owner with no prior onboarding draft. Native
  // initialization must remain usable; registration/receipt success alone does
  // not establish that the new owner's returned DTO was accepted by the UI.
  const fresh = await person(role, english), suffix = key().replaceAll("-", "").slice(0, 16);
  if (role === "CREATOR") await db.creator.create({ data: { userId: fresh.user.id, handle: "fresh_" + suffix, displayName: "Synthetic new owner", isTest: true } });
  else await db.brand.create({ data: { userId: fresh.user.id, slug: "fresh-" + suffix, name: "Synthetic new owner", isTest: true } });
  expect(await db.onboardingDraft.count({ where: { userId: fresh.user.id } })).toBe(0);
  expect((await profileForOwner(fresh.user.id, { serverAuth: fresh.actor }))?.profile.state).toBe("DRAFT");
  await signed(context, fresh, english); await page.goto("/" + (role === "CREATOR" ? "creator" : "brand") + "/onboarding");
  const initialized = page.waitForResponse(response => new URL(response.url()).pathname === "/api/onboarding" && response.request().method() === "POST");
  await page.getByRole("button", { name: copy("أكتب", "Type"), exact: true }).click(); expect((await initialized).status()).toBe(200);
  await expect(save(page, copy)).toBeEnabled(); await expect(page.locator('[data-onboarding-recovery="UNKNOWN"]')).toHaveCount(0);
  expect(await db.onboardingDraft.count({ where: { userId: fresh.user.id, kind: role } })).toBe(1);
  const f = await fixture(role, english); await opened(page, context, f, english, copy);
  const api = await page.request.get("/api/onboarding"); expect(api.status()).toBe(200); expect(api.headers()["cache-control"]).toBe("private, no-store");
  const readiness = await page.request.get("/api/readiness/publication"); expect(readiness.status()).toBe(200); expect((await readiness.json()).data.status).toBe("BLOCKED");
  expect((await db.onboardingDraft.findUniqueOrThrow({ where: { id: f.draftId } })).revision).toBeGreaterThan(1);
  await db.authSession.update({ where: { id: f.actor.sessionId }, data: { revokedAt: new Date() } });
  let native401 = false; await page.route(commands, async route => { const response = await route.fetch(); expect(response.status()).toBe(401); native401 = true;
    await route.fulfill({ status: 401, headers: response.headers(), body: "MALFORMED_NATIVE_DENIAL" }); });
  await save(page, copy).click(); await denied(page, f, copy, 401); expect(native401).toBe(true); await page.unroute(commands);
  const renewedAccount = await renewed(f.user.id); Object.assign(f, renewedAccount, { options: { serverAuth: renewedAccount.actor } }); await opened(page, context, f, english, copy);
  await saveWithFailedRead(page, f, copy, f.canary + "_SAVED");
  // The readiness effect starts automatically; pending protected controls stay
  // disabled. Both held statuses arise from actual browser session cookies.
  const forbiddenReached = latch(), releaseForbidden = latch(), forbiddenDelivered = latch(), reached = latch(), release = latch(), delivered = latch();
  const admin = await person("ADMIN", english); await signed(context, admin, english); let native403 = false;
  await page.route("**/api/readiness/publication*", async route => { const response = await route.fetch(); expect(response.status()).toBe(403); native403 = true;
    forbiddenReached.release(); await releaseForbidden.promise;
    try { await route.fulfill({ status: 403, headers: response.headers(), body: "MALFORMED_NATIVE_FORBIDDEN" }).catch(() => {}); } finally { forbiddenDelivered.release(); } });
  await page.getByRole("button", { name: copy("5. الملف والمشاركة", "5. Portfolio & sharing"), exact: true }).click(); await forbiddenReached.promise;
  await signed(context, f, english);
  await page.route(onboarding, async route => { if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch(); expect(response.status()).toBe(200); reached.release(); await release.promise;
    try { await route.fulfill({ response }).catch(() => {}); } finally { delivered.release(); } });
  try {
    await currentRead(page, copy).click(); await reached.promise;
    releaseForbidden.release(); await forbiddenDelivered.promise;
    await denied(page, f, copy, 403); expect(native403).toBe(true); release.release(); await delivered.promise;
    await denied(page, f, copy, 403); await page.unroute("**/api/readiness/publication*");
  } finally { releaseForbidden.release(); release.release(); await page.unroute(onboarding); await page.unroute("**/api/readiness/publication*"); }
  await signed(context, f, english); await page.reload(); await expect(nameInput(page, f, copy)).toBeVisible();
  expect(await nameInput(page, f, copy).inputValue() === f.canary + "_SAVED").toBe(true);
  if (english) { await page.setViewportSize({ width: 360, height: 800 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }
});

test("confirmed save survives failed followup with read-only reconciliation; unknown exact request stays frozen through later edits and semantic-negative retry", async ({ page, context }, info) => {
  const { english, role, copy } = locale(info), f = await fixture(role, english, true); await opened(page, context, f, english, copy);
  const sent: Array<{ hash: string; key: string }> = [];
  page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/onboarding/" + f.draftId + "/commands") {
    const body = request.postData(); if (body) sent.push({ hash: digest(body), key: (JSON.parse(body) as { command: { operationKey: string } }).command.operationKey });
  } });
  const confirmedName = "  ORIGINAL_SAVED_" + key() + "  "; const confirmed = await saveWithFailedRead(page, f, copy, confirmedName);
  const current = { draft: await getDraft(f.user.id, f.draftId, f.options), owner: await profileForOwner(f.user.id, f.options) };
  // Valid same-owner/same-ID delivery seam regresses only the revision. It
  // cannot erase the independently observed native command confirmation.
  await page.route(onboarding, route => { const requestId = key(); return route.fulfill({ status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", "X-Request-Id": requestId },
    body: JSON.stringify({ data: { ...current, draft: { ...current.draft, revision: confirmed.input.command.expectedRevision } }, requestId }) }); });
  const staleRead = page.waitForResponse(response => new URL(response.url()).pathname === "/api/onboarding" && response.request().method() === "GET");
  await currentRead(page, copy).click(); await (await staleRead).finished();
  await expect.poll(async () => await currentRead(page, copy).count() > 0 && await currentRead(page, copy).isEnabled() || await save(page, copy).isEnabled()).toBe(true);
  await expect(page.locator('[data-onboarding-recovery="CONFIRMED"]')).toBeVisible(); await expect(save(page, copy)).toBeDisabled();
  expect(sent).toHaveLength(1); await page.unroute(onboarding);
  expect(sent).toHaveLength(1); await currentRead(page, copy).click(); await expect(save(page, copy)).toBeEnabled();
  expect(sent).toHaveLength(1); expect(await nameInput(page, f, copy).inputValue() === confirmedName.trim()).toBe(true);
  // Same-role substitution is an explicit adversarial delivery seam; both DTOs
  // originate from actual owned native readers, without conferring authority.
  await saveWithFailedRead(page, f, copy, confirmedName + "NEXT"); const other = await fixture(role, english);
  const foreign = { draft: await getDraft(other.user.id, other.draftId, other.options), owner: await profileForOwner(f.user.id, f.options) };
  await page.route(onboarding, route => { const requestId = key(); return route.fulfill({ status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", "X-Request-Id": requestId }, body: JSON.stringify({ data: foreign, requestId }) }); });
  await currentRead(page, copy).click(); await expect(page.locator('[data-onboarding-session="denied"]')).toBeVisible(); expect(sent).toHaveLength(2); await page.unroute(onboarding);
  await opened(page, context, f, english, copy); const originalName = "  EXACT_UNKNOWN_" + key() + "  "; let committed = false; const committedResponse = latch();
  await page.route(commands, async route => { const response = await route.fetch(); expect(response.status()).toBe(200); committed = true; committedResponse.release(); await route.abort("failed"); });
  await nameInput(page, f, copy).fill(originalName); await save(page, copy).click(); await expect(page.locator('[data-onboarding-recovery="UNKNOWN"]')).toBeVisible();
  await committedResponse.promise; await expect(page.locator("[data-onboarding-exact-retry]")).toBeEnabled();
  expect(committed).toBe(true); expect(sent).toHaveLength(3); const original = sent[2]!; expect(await nativeName(f) === originalName.trim()).toBe(true); await page.unroute(commands);
  // DOM mutation seam probes captured-body immutability while normal inputs are
  // disabled; it is not a claim that the user can edit a locked field.
  await expect(nameInput(page, f, copy)).toBeDisabled(); await nameInput(page, f, copy).evaluate((input, changed) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, changed); input.dispatchEvent(new Event("input", { bubbles: true }));
  }, "LATER_FORM_MUTATION");
  await currentRead(page, copy).click(); await expect(page.locator('[data-onboarding-recovery="UNKNOWN"]')).toBeVisible(); expect(sent).toHaveLength(3);
  await page.route(commands, route => route.fulfill(failure(409, "STALE_VERSION")));
  const negativeRetry = page.waitForResponse(response => new URL(response.url()).pathname === "/api/onboarding/" + f.draftId + "/commands" && response.request().method() === "POST");
  await page.locator("[data-onboarding-exact-retry]").click(); const negative = await negativeRetry; expect(negative.status()).toBe(409); await negative.finished();
  await expect(page.locator("[data-onboarding-exact-retry]")).toBeEnabled();
  await expect(page.locator('[data-onboarding-recovery="UNKNOWN"]')).toBeVisible(); expect(sent).toHaveLength(4); expect(sent[3]).toEqual(original); await page.unroute(commands);
  const replay = page.waitForResponse(response => new URL(response.url()).pathname === "/api/onboarding/" + f.draftId + "/commands" && response.request().method() === "POST");
  await page.locator("[data-onboarding-exact-retry]").click(); const response = await replay;
  if (response.status() !== 200) {
    const envelope = await response.json().catch(() => null) as { error?: { code?: unknown } } | null, code = envelope?.error?.code;
    console.log(JSON.stringify({ nativeRetryStatus: response.status(), code: typeof code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : "INVALID_ENVELOPE", bodyHash: original.hash, keyHash: digest(original.key) }));
  }
  expect(response.status()).toBe(200); expect((await response.json()).data.replayed).toBe(true);
  await expect(save(page, copy)).toBeEnabled(); expect(sent).toHaveLength(5); expect(sent[4]).toEqual(original);
  expect(await db.draftCommand.count({ where: { draftId: f.draftId, operationKey: "profile:" + original.key } })).toBe(1);
  expect(await db.outboxEvent.count({ where: { deduplicationKey: "profile:" + f.draftId + ":" + original.key } })).toBe(1);
  const native = await page.request.get("/api/onboarding"); expect(native.status()).toBe(200); expect(Buffer.byteLength(await native.text())).toBeGreaterThan(300000);
  await page.reload(); await expect(nameInput(page, f, copy)).toBeVisible(); expect(await nameInput(page, f, copy).inputValue() === originalName.trim()).toBe(true);
  expect(sent).toHaveLength(5); expect((await profileForOwner(f.user.id, f.options))?.profile.state).toBe("PRIVATE");
  expect((await page.request.get("/api/readiness/publication")).status()).toBe(200); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
