// Two journeys only: real local Chromium registration/offline/lifecycle mechanics.
// Native disposable campaign/source fixtures and a labelled HTTP version-delivery
// seam are not production HTTPS, device installation or live business evidence.
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import type { Duplex } from "node:stream";
import { Prisma } from "@prisma/client";
import { expect, test, type Page, type BrowserContext, type TestInfo } from "@playwright/test";
import { assertLocalTarget, taskState } from "../scripts/task-state.mjs";
import { prisma as db } from "../src/lib/prisma";
import { openSession, resolveSession } from "../src/lib/identity";
import { SESSION_COOKIE } from "../src/lib/jwt";
import type { OrganizationActor } from "../src/lib/organizations/context";
import type { PlanningScope } from "../src/lib/brand-context/contracts";
import { executeCampaignPlanningCommand } from "../src/lib/campaign-planning/service";
import { executeCampaignAgentCommand, getCampaignAgent } from "../src/lib/campaign-agent/service";
import { CampaignAgentCommandSchema } from "../src/lib/campaign-agent/native-contracts";
import { campaignFields } from "../tests/campaigns/fixtures";

const state = taskState(), key = () => randomUUID(), appOrigin = "http://localhost:3100";
if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("PWA browser fixtures require exact guarded E2E target");
const users = new Set<string>(), brands = new Set<string>(), campaigns = new Set<string>();
const errors = new WeakMap<Page, string[]>();
const publicPaths = ["/", "/about", "/contact", "/pricing", "/for-brands", "/for-creators"];
const prefix = "infame-public-offline-";
test.use({ trace: "off", actionTimeout: 10000 }); // No native session or recovery-key bodies retained in traces.
test.setTimeout(120000);
test.beforeAll(async () => {
  const rows = await db.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]?.id !== state.id || rows[0]?.kind !== "e2e" || rows[0]?.db !== state.targets.e2e || rows[0]?.host !== "127.0.0.1") throw new Error("PWA fixture identity mismatch");
});
function watch(page: Page) {
  const seen: string[] = []; errors.set(page, seen);
  page.on("pageerror", error => seen.push(error.name));
  page.on("console", message => { if (message.type() === "error" && /hydrat|server.rendered|server HTML|text content.*match/i.test(message.text())) seen.push("HYDRATION_MISMATCH"); });
}
test.beforeEach(async ({ page }) => { watch(page); });
test.afterEach(async ({ page }) => {
  if (campaigns.size) for (const table of ["CampaignAgentCommand", "CampaignAgentConfirmationBatch", "CampaignAgentTextSource", "CampaignAgent"] as const)
    await db.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "campaignId" IN (${Prisma.join([...campaigns])})`);
  const workspaces = await db.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } });
  if (workspaces.length) {
    const ids = workspaces.map(row => row.id);
    for (const table of ["PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission", "CampaignBriefProvenance", "CampaignProposalDependency", "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding", "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const)
      await db.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join(ids)})`);
    await db.planningWorkspace.deleteMany({ where: { id: { in: ids } } });
  }
  await db.campaign.deleteMany({ where: { id: { in: [...campaigns] } } });
  await db.brand.deleteMany({ where: { id: { in: [...brands] } } });
  if (users.size) await db.outboxEvent.deleteMany({ where: { OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await db.user.deleteMany({ where: { id: { in: [...users] } } });
  for (const owned of [users, brands, campaigns]) owned.clear();
  expect(errors.get(page) ?? [], "Browser/hydration error metadata").toEqual([]);
});
test.afterAll(async () => { await db.$disconnect(); });
function locale(info: TestInfo) { const english = info.project.name === "english-desktop"; return { english, copy: (ar: string, en: string) => english ? en : ar }; }
async function language(context: BrowserContext, english: boolean) {
  await context.addCookies([{ name: "infame_lang", value: english ? "en" : "ar", domain: "localhost", path: "/" }]);
}
const installControl = (page: Page) => page.locator("[data-pwa-install-trigger]");
const installDialog = (page: Page) => page.locator("[data-pwa-install-dialog]");
async function controlled(page: Page, origin: string) {
  expect(await page.evaluate(() => isSecureContext && "serviceWorker" in navigator)).toBe(true);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // Ordinary reload obtains a controller; the product does not use clients.claim.
  if (!await page.evaluate(() => !!navigator.serviceWorker.controller)) await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null)).toBe(origin + "/sw.js");
  const registration = await page.evaluate(async () => { const row = await navigator.serviceWorker.getRegistration("/"); return row && { scope: row.scope, cache: row.updateViaCache, state: row.active?.state }; });
  expect(registration).toEqual({ scope: origin + "/", cache: "none", state: "activated" });
}
async function cleanCaches(page: Page, origin: string, canaries: string[] = []) {
  const result = await page.evaluate(async ({ namespace, forbidden }) => {
    const owned = (await caches.keys()).filter(name => name.startsWith(namespace)), inspected = [];
    let leaked = false;
    for (const name of owned) {
      const cache = await caches.open(name), requests = await cache.keys();
      for (const request of requests) {
        const response = await cache.match(request), body = response ? await response.text() : "";
        leaked ||= forbidden.some(value => request.url.includes(value) || body.includes(value));
        inspected.push({ name, url: request.url, status: response?.status, type: response?.headers.get("content-type"), bytes: new TextEncoder().encode(body).byteLength });
      }
    }
    return { owned, inspected, leaked };
  }, { namespace: prefix, forbidden: canaries });
  expect(result.leaked).toBe(false);
  for (const name of result.owned) {
    const entries = result.inspected.filter(row => row.name === name); expect(entries).toHaveLength(1);
    expect(entries[0]?.url).toBe(origin + "/offline.html"); expect(entries[0]?.status).toBe(200);
    expect(entries[0]?.type).toMatch(/^text\/html(?:;|$)/i); expect(entries[0]?.bytes).toBeGreaterThan(0); expect(entries[0]?.bytes).toBeLessThanOrEqual(65536);
  }
  return result;
}
async function publicOffline(page: Page, pathname: string) {
  const response = await page.goto(pathname, { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200); expect(response?.fromServiceWorker()).toBe(true);
  await expect(page.locator("#offline-ar")).toBeVisible();
  await expect(page.locator("#offline-en")).toBeVisible();
  await expect(page.locator('a[href="/"]')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
async function nativeCompany(english: boolean) {
  const id = key(); users.add(id);
  const user = await db.user.create({ data: { id, role: "BRAND", active: true, isTest: true, language: english ? "en" : "ar", name: "Synthetic PWA privacy actor",
    email: id + "@example.invalid", passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  const token = await openSession(id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Native PWA fixture session did not resolve");
  const actor: OrganizationActor = { userId: session.userId, role: session.role, sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  const brand = await db.brand.create({ data: { userId: id, slug: "pwa-" + key(), countryCode: "KW", name: "Synthetic private PWA brand", state: "PRIVATE", isTest: true } }); brands.add(brand.id);
  return { actor, token, brand, scope: { kind: "OWN_BRAND", brandId: brand.id } as PlanningScope };
}
type Company = Awaited<ReturnType<typeof nativeCompany>>;
async function signed(context: BrowserContext, account: Company, english: boolean) {
  expect(await resolveSession(account.token)).not.toBeNull(); await language(context, english);
  await context.addCookies([{ name: SESSION_COOKIE, value: account.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
}
async function nativeInterview(account: Company, words: string) {
  const campaign = await executeCampaignPlanningCommand(account.actor, { operationKey: key(), scope: account.scope, action: "CREATE", expectedCampaignRevision: 0,
    expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0,
    payload: { fields: { ...campaignFields, title: words + "_TITLE", summary: words + "_SUMMARY" }, selection: { kind: "NONE" }, narrative: null } }); campaigns.add(campaign.campaignId);
  let view = await getCampaignAgent(account.actor, { scope: account.scope, campaignId: campaign.campaignId });
  for (const action of ["INITIALIZE", "APPEND_TEXT"] as const) {
    const command = CampaignAgentCommandSchema.parse({ operationKey: key(), scope: account.scope, campaignId: campaign.campaignId,
      expectedSnapshot: view.current.snapshot, expectedAgentRevision: view.retained?.revision ?? 0, action,
      payload: action === "INITIALIZE" ? { preferences: { input: "TEXT", output: "TEXT" } } : { originalText: { text: words, language: "en" } } });
    await executeCampaignAgentCommand(account.actor, command, { channel: "FORM" }); view = await getCampaignAgent(account.actor, { scope: account.scope, campaignId: campaign.campaignId });
  }
  return { id: campaign.campaignId, view, query: new URLSearchParams({ scope: "OWN_BRAND", brandId: account.brand.id, campaignId: campaign.campaignId }).toString() };
}
// Root-authorized, test-owned loopback HTTP seam. Chromium SW main-script updates
// cannot be routed by Playwright (playwright.dev/docs/service-workers). Forward
// real app bytes/status/auth/private headers; only SW cache-version bytes change.
async function versionProxy() {
  const sourceResponse = await fetch(appOrigin + "/sw.js", { cache: "no-store", redirect: "error" });
  if (sourceResponse.status !== 200) throw new Error("Actual worker source unavailable");
  const source = await sourceResponse.text(), direct = source.match(/const CACHE_NAME = ["'](infame-public-offline-[A-Za-z0-9_-]+)["'];/),
    composed = source.match(/const CACHE_NAME = `\$\{CACHE_PREFIX\}([A-Za-z0-9_-]+)`;/);
  if (!direct && (!composed || !/const CACHE_PREFIX = ["']infame-public-offline-["'];/.test(source))) throw new Error("Actual worker must declare one immutable owned cache version");
  const declaration = direct?.[0] ?? composed![0];
  // These real versions use the product's exact version-owned namespace.
  const versions = { a: prefix + "v70001", b: prefix + "v70002" };
  let phase: "a" | "b" = "a", origin = ""; const scriptVersions: string[] = [], posts: string[] = [], failures: string[] = [];
  const scriptResponses: Array<{ path: string; status: number; type: string | null; bytes: number }> = [];
  const upgradeSockets = new Set<Duplex>();
  const server = createServer(async (request, response) => {
    try {
      const target = new URL(request.url ?? "/", appOrigin), outgoing = new Headers();
      if (target.origin !== appOrigin) throw new Error("Proxy refuses nonfixture origin");
      for (const [name, value] of Object.entries(request.headers)) if (value !== undefined && !["host", "connection", "content-length", "transfer-encoding"].includes(name)) outgoing.set(name, Array.isArray(value) ? value.join(", ") : value);
      outgoing.set("accept-encoding", "identity");
      if (target.pathname === "/sw.js" && !target.search && request.method === "GET") {
        for (const name of ["if-none-match", "if-modified-since", "range"]) outgoing.delete(name);
      }
      // The seam's same-origin user gesture stays a genuine native origin check
      // at the backend. No cross-origin request gains permission through this.
      if (outgoing.get("origin") === origin) outgoing.set("origin", appOrigin);
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      if (request.method === "POST") posts.push(target.pathname);
      const upstream = await fetch(target, { method: request.method, headers: outgoing, redirect: "manual", ...(body ? { body } : {}) });
      response.statusCode = upstream.status;
      for (const [name, value] of upstream.headers) if (!["content-length", "content-encoding", "transfer-encoding", "connection"].includes(name)) response.setHeader(name, name === "location" && value.startsWith(appOrigin + "/") ? origin + value.slice(appOrigin.length) : value);
      if (target.pathname === "/sw.js" && !target.search && request.method === "GET") {
        response.statusCode = 200; response.removeHeader("etag"); response.removeHeader("last-modified");
        response.setHeader("content-type", "application/javascript; charset=utf-8"); response.setHeader("cache-control", "no-store");
        scriptVersions.push(phase); response.end(source.replace(declaration, 'const CACHE_NAME = "' + versions[phase] + '";'));
      } else {
        const bytes = Buffer.from(await upstream.arrayBuffer());
        if (target.pathname.startsWith("/_next/") && target.pathname.endsWith(".js")) scriptResponses.push({ path: target.pathname, status: upstream.status, type: upstream.headers.get("content-type"), bytes: bytes.length });
        response.end(bytes);
      }
    } catch (error) { failures.push((error instanceof Error ? error.name : "UnknownError") + ":" + new URL(request.url ?? "/", appOrigin).pathname); if (!response.headersSent) response.statusCode = 502; response.end(); }
  });
  // Turbopack starts hydration through its genuine dev HMR WebSocket. A Fetch
  // proxy cannot forward Upgrade; tunnel this one fixture-only path unchanged.
  server.on("upgrade", (request, socket, head) => {
    const target = new URL(request.url ?? "/", appOrigin);
    if (target.origin !== appOrigin || target.pathname !== "/_next/hmr") { socket.destroy(); return; }
    const upstream = createConnection({ host: "127.0.0.1", port: 3100 }, () => {
      const headers = Object.entries(request.headers).map(([name, value]) => name + ": " + (name === "host" ? "localhost:3100"
        : name === "origin" && value === origin ? appOrigin : Array.isArray(value) ? value.join(", ") : value ?? ""));
      upstream.write(`GET ${request.url} HTTP/1.1\r\n${headers.join("\r\n")}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream); upstream.pipe(socket);
    });
    upgradeSockets.add(socket); upgradeSockets.add(upstream);
    upstream.on("error", () => socket.destroy()); socket.on("error", () => upstream.destroy());
    socket.on("close", () => { upgradeSockets.delete(socket); upstream.destroy(); }); upstream.on("close", () => { upgradeSockets.delete(upstream); socket.destroy(); });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Loopback fixture port unavailable"); origin = "http://localhost:" + address.port;
  return { origin, versions, scriptVersions, posts, failures, scriptResponses, next: () => { phase = "b"; }, close: async () => { for (const socket of upgradeSockets) socket.destroy(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}

test("public install control registers a real controller and only the static bilingual notice covers six exact offline marketing paths", async ({ page, context }, info) => {
  const { english, copy } = locale(info); await language(context, english); await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const state = window as unknown as { pwaGenuinePromptObserved: number }; state.pwaGenuinePromptObserved = 0;
    // Keep genuine availability separate. Capture/suppress only native prompts
    // so the later explicit synthetic dismissal witness cannot open a real one.
    window.addEventListener("beforeinstallprompt", event => { if (event.isTrusted) { state.pwaGenuinePromptObserved++; event.preventDefault(); event.stopImmediatePropagation(); } });
  });
  await page.goto("/"); await expect(installControl(page)).toBeVisible();
  const button = installControl(page); await expect(button).toBeVisible();
  expect(await button.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await button.focus(); await expect(button).toBeFocused();
  await controlled(page, appOrigin);
  await button.click(); await expect(installDialog(page)).toBeVisible();
  await expect(installDialog(page).locator("[data-pwa-install-instructions]")).toContainText(copy("الشاشة الرئيسية", "Home Screen"));
  await expect(installDialog(page).locator("[data-pwa-registration-status]")).toHaveAttribute("data-pwa-registration-status", "registered");
  const link = page.locator('link[rel="manifest"]'); await expect(link).toHaveCount(1);
  const href = await link.getAttribute("href"); expect(new URL(href!, appOrigin).pathname).toBe("/manifest.webmanifest");
  const manifest = await page.request.get(href!); expect(manifest.status()).toBe(200); const body = await manifest.json();
  expect(body).toMatchObject({ name: "Infame / إنفيم", start_url: "/", scope: "/", display: "standalone", lang: "ar", dir: "rtl" });
  expect(await cleanCaches(page, appOrigin)).toMatchObject({ owned: [expect.stringMatching(/^infame-public-offline-/)], leaked: false });
  // Explicit event seam validates interaction only. It cannot report real native
  // prompt availability, acceptance, installation or a device result.
  info.annotations.push({ type: "evidence", description: "Synthetic beforeinstallprompt dismissal exercises handlers; actual device install remains unverified." });
  await page.evaluate(() => {
    const target = window as unknown as { pwaPromptCalls: number; pwaResolveChoice: (value: { outcome: string; platform: string }) => void };
    target.pwaPromptCalls = 0; const choice = new Promise<{ outcome: string; platform: string }>(resolve => { target.pwaResolveChoice = resolve; });
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.defineProperties(event, { platforms: { value: ["web"] }, prompt: { value: async () => { target.pwaPromptCalls++; } }, userChoice: { value: choice } });
    window.dispatchEvent(event);
  });
  const request = installDialog(page).locator("[data-pwa-install-request]"); await expect(request).toBeVisible(); await request.click();
  await expect(request).toHaveCount(0); await expect(installDialog(page).locator('[data-pwa-prompt-status="prompting"]')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { pwaPromptCalls: number }).pwaPromptCalls)).toBe(1);
  await page.evaluate(() => (window as unknown as { pwaResolveChoice: (value: { outcome: string; platform: string }) => void }).pwaResolveChoice({ outcome: "dismissed", platform: "web" }));
  await expect(installDialog(page).locator('[data-pwa-prompt-status="dismissed"]')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(installDialog(page).locator('[data-pwa-prompt-status="reported"]')).toHaveCount(0);
  info.annotations.push({ type: "native-prompt-availability", description: String(await page.evaluate(() => (window as unknown as { pwaGenuinePromptObserved: number }).pwaGenuinePromptObserved > 0)) });
  await installDialog(page).getByRole("button", { name: copy("إغلاق", "Close"), exact: true }).last().click(); await expect(button).toBeFocused();
  const approvedHero = await page.locator("#infame-main h1").textContent();
  if (approvedHero === null) throw new Error("Approved homepage title missing");
  await context.setOffline(true);
  try { for (const pathname of publicPaths) await publicOffline(page, pathname); }
  finally { await context.setOffline(false); }
  await page.goto("/"); await expect(page.locator("#infame-main h1")).toHaveText(approvedHero); await expect(page.locator("#offline-ar")).toHaveCount(0);
  expect((await cleanCaches(page, appOrigin)).owned).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  if (english) { await page.setViewportSize({ width: 360, height: 800 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }
});

test("owned interview words stay uncached across offline owner change and logout; two actual workers preserve dirty forms until ordinary activation", async ({ page, context }, info) => {
  const { english, copy } = locale(info), proxy = await versionProxy(), first = await nativeCompany(english), second = await nativeCompany(english);
  const words = "PWA_PRIVATE_SOURCE_" + key(), offlineWords = "PWA_UNSENT_WORDS_" + key(), dirty = "PWA_DIRTY_FORM_" + key();
  const interview = await nativeInterview(first, words), sourcesURL = proxy.origin + "/api/campaign-agent/sources?" + interview.query;
  const monitor = await context.newPage(); watch(monitor); const unrelated = "pwa-test-unrelated-" + key();
  const secrets = [words, offlineWords, dirty, first.token, first.actor.sessionId, first.brand.id, interview.id];
  try {
    await signed(context, first, english); await page.goto(proxy.origin + "/");
    try { await expect(installControl(page)).toBeVisible(); }
    catch (error) { console.log(JSON.stringify({ fixtureScriptResponses: proxy.scriptResponses, failureNames: proxy.failures, pageErrorNames: errors.get(page) ?? [] })); throw error; }
    await controlled(page, proxy.origin);
    await monitor.goto(proxy.origin + "/offline.html"); await controlled(monitor, proxy.origin);
    await monitor.evaluate(async name => { const cache = await caches.open(name); await cache.put("/pwa-unrelated-sentinel", new Response("Owned unrelated sentinel")); }, unrelated);
    await page.goto(proxy.origin + "/brand/campaigns/" + interview.id);
    const card = page.locator("[data-campaign-agent-interview]"); await expect(card).toBeVisible();
    await card.getByRole("button", { name: copy("تحميل المقابلة", "Load interview"), exact: true }).click(); await expect(card).toHaveAttribute("aria-busy", "false");
    await card.getByRole("button", { name: copy("حمّل الكلمات المحفوظة", "Load saved words"), exact: true }).click(); await expect(card).toHaveAttribute("aria-busy", "false");
    expect(await card.locator("[data-agent-text-source]").evaluateAll((nodes, value) => nodes.some(node => node.textContent?.includes(value)), words)).toBe(true);
    const native = await page.evaluate(async url => { const response = await fetch(url, { cache: "no-store" }); return { status: response.status, cache: response.headers.get("cache-control"), body: await response.json() }; }, sourcesURL);
    expect(native.status).toBe(200); expect(native.cache).toBe("private, no-store"); expect(JSON.stringify(native.body).includes(words)).toBe(true);
    await cleanCaches(monitor, proxy.origin, secrets);
    const before = await db.campaignAgentCommand.count({ where: { campaignId: interview.id } }), postCount = proxy.posts.length;
    const unsent = CampaignAgentCommandSchema.parse({ operationKey: key(), scope: first.scope, campaignId: interview.id, action: "APPEND_TEXT", expectedSnapshot: interview.view.current.snapshot,
      expectedAgentRevision: interview.view.retained!.revision, payload: { originalText: { text: offlineWords, language: "en" } } });
    await context.setOffline(true);
    expect(await page.evaluate(async ({ url, command, origin }) => {
      const results = [];
      for (const [path, options] of [[url, { cache: "no-store" }], [origin + "/api/campaign-agent/commands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) }]] as const)
        try { const response = await fetch(path, options); results.push({ rejected: false, status: response.status, offline: (await response.text()).includes('id="offline-ar"') }); }
        catch { results.push({ rejected: true }); }
      return results;
    }, { url: sourcesURL, command: unsent, origin: proxy.origin })).toEqual([{ rejected: true }, { rejected: true }]);
    for (const pathname of ["/brand/campaigns/" + interview.id, "/login", "/classic", "/for-clients", "/@private-profile", "/pricing?private=1"]) {
      const probe = await context.newPage(); let failed = false; try { await probe.goto(proxy.origin + pathname, { waitUntil: "domcontentloaded" }); } catch { failed = true; }
      expect(failed).toBe(true); await expect(probe.locator("#offline-ar")).toHaveCount(0); await probe.close();
    }
    await signed(context, second, english); await cleanCaches(monitor, proxy.origin, secrets); await context.setOffline(false);
    expect((await context.request.get(sourcesURL)).status()).toBe(404);
    const deniedSource = page.waitForResponse(response => new URL(response.url()).pathname === "/api/campaign-agent/sources" && response.status() === 404);
    await card.getByRole("button", { name: copy("حمّل الكلمات المحفوظة", "Load saved words"), exact: true }).click(); await deniedSource;
    await expect.poll(() => page.locator("[data-agent-text-source]").evaluateAll((nodes, value) => nodes.some(node => node.textContent?.includes(value)), words)).toBe(false);
    const logout = await context.request.post(proxy.origin + "/api/auth/logout", { headers: { Origin: proxy.origin } }); expect(logout.status()).toBe(200);
    expect(await resolveSession(second.token)).toBeNull(); expect((await context.request.get(sourcesURL)).status()).toBe(401);
    await context.setOffline(true); await cleanCaches(monitor, proxy.origin, secrets); await context.setOffline(false);
    expect(await db.campaignAgentCommand.count({ where: { campaignId: interview.id } })).toBe(before);
    expect(proxy.posts.filter(path => path === "/api/campaign-agent/commands")).toHaveLength(0); expect(proxy.posts.length).toBe(postCount + 1); // Only explicit native logout arrived.
    await signed(context, first, english); expect((await context.request.get(sourcesURL)).status()).toBe(200);
    await page.goto(proxy.origin + "/brand/campaigns/" + interview.id); await expect(card).toBeVisible();
    await card.getByRole("button", { name: copy("تحميل المقابلة", "Load interview"), exact: true }).click(); await expect(card).toHaveAttribute("aria-busy", "false");
    const editor = card.getByLabel(copy("احكِ لنا عن الحملة", "Tell us about the campaign"), { exact: true }); await editor.fill(dirty);
    const timeOrigin = await page.evaluate(() => { const windowState = window as unknown as { pwaControllerChanges: number }; windowState.pwaControllerChanges = 0;
      navigator.serviceWorker.addEventListener("controllerchange", () => { windowState.pwaControllerChanges++; }); return performance.timeOrigin; });
    const newerWorker = context.waitForEvent("serviceworker"); proxy.next();
    await page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration("/"); if (!registration) throw new Error("Actual registration missing"); await registration.update(); });
    const workerB = await newerWorker;
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration("/"))?.waiting?.state)).toBe("installed");
    await expect(editor).toHaveValue(dirty); expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
    expect(await page.evaluate(() => (window as unknown as { pwaControllerChanges: number }).pwaControllerChanges)).toBe(0);
    expect((await cleanCaches(monitor, proxy.origin, secrets)).owned.sort()).toEqual([proxy.versions.a, proxy.versions.b].sort());
    expect(proxy.scriptVersions).toContain("a"); expect(proxy.scriptVersions).toContain("b");
    // Deliberate test client closure, not skipWaiting/claim or a product reload.
    await page.close({ runBeforeUnload: false }); await monitor.close({ runBeforeUnload: false });
    await expect.poll(() => workerB.evaluate(() => {
      const registration = (globalThis as unknown as { registration: { active?: { state: string }; waiting: unknown; installing: unknown } }).registration;
      return registration.waiting === null && registration.installing === null && registration.active?.state === "activated";
    })).toBe(true);
    const current = await context.newPage(); watch(current); await current.goto(proxy.origin + "/offline.html"); await controlled(current, proxy.origin);
    expect((await cleanCaches(current, proxy.origin, secrets)).owned).toEqual([proxy.versions.b]);
    expect(await current.evaluate(async name => { const response = await (await caches.open(name)).match("/pwa-unrelated-sentinel"); return response?.text(); }, unrelated)).toBe("Owned unrelated sentinel");
    expect(await db.campaignAgentCommand.count({ where: { campaignId: interview.id } })).toBe(before);
    expect(errors.get(current) ?? []).toEqual([]); await current.evaluate(name => caches.delete(name), unrelated); await current.close();
    expect(errors.get(monitor) ?? []).toEqual([]); expect(proxy.failures).toEqual([]);
  } finally { await context.setOffline(false); if (!monitor.isClosed()) await monitor.close(); if (!page.isClosed()) await page.close(); await proxy.close(); }
});
