import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { expect, test, type BrowserContext, type Frame, type Page } from "@playwright/test";
import { assertLocalTarget, taskState, workspace } from "../scripts/task-state.mjs";
import { prisma as db } from "../src/lib/prisma";
import { authenticate, openSession, resolveSession } from "../src/lib/identity";
import { SESSION_COOKIE } from "../src/lib/jwt";
import { ClientGrantSchema, MembershipSchema, OrganizationClientSchema, OrganizationClientsSchema,
  OrganizationDirectorySchema, OrganizationSchema, type ClientCapabilities } from "../src/lib/organizations/contracts";

const state = taskState(), origin = "http://localhost:3100", userIds: string[] = [];
const privateSentinel = "private-browser-organization-content";
const originalName = `  مؤسسة أصلية Browser <script> ${"long".repeat(18)}  `;
const orgResult = z.object({ organization: OrganizationSchema, replayed: z.boolean() }).strict();
const memberResult = z.object({ membership: MembershipSchema, replayed: z.boolean() }).strict();
const clientResult = z.object({ client: OrganizationClientSchema, replayed: z.boolean() }).strict();
const grantResult = z.object({ grant: ClientGrantSchema, replayed: z.boolean() }).strict();
const directoryEndpoint = (url: URL) => url.pathname === "/api/organizations";
const commandEndpoint = (url: URL) => url.pathname === "/api/organizations/commands";
const clientEndpoint = (id: string) => (url: URL) => url.pathname === `/api/organizations/${id}/clients`;
const entry = (page: Page, id: string) => page.locator(`[data-organization-id="${id}"]`);
const clientRow = (page: Page, id: string) => page.locator(`[data-organization-client-id="${id}"]`);
const snapshotTime = (page: Page) => page.locator("main time");
const capabilities = (view = false): ClientCapabilities => ({ view, plan: false, approveShortlist: false, reviewContent: false, signCustomer: false, financial: false, manageGrants: false });
const allCapabilities: ClientCapabilities = { view: true, plan: true, approveShortlist: true, reviewContent: true, signCustomer: true, financial: true, manageGrants: true };

if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("Organization browser acceptance requires the exact isolated E2E target");
test.setTimeout(60000);
test.beforeAll(async () => {
  const rows = await db.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id, kind, current_database() AS db, host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0].id !== state.id || rows[0].kind !== "e2e" || rows[0].db !== state.targets.e2e || rows[0].host !== "127.0.0.1") throw new Error("Incorrect organization browser database identity");
});
test.afterEach(async () => {
  // Receipt UPDATE is immutable; explicit deletion of only these tracked local
  // fixtures is permitted. No invitation, provider, payment or delivery occurs.
  const organizations = await db.organization.findMany({ where: { ownerUserId: { in: userIds } }, select: { id: true } });
  const ids = organizations.map(row => row.id);
  const receipts = await db.organizationCommand.findMany({ where: { OR: [{ actorUserId: { in: userIds } }, { organizationId: { in: ids } }] }, select: { id: true } });
  await db.outboxEvent.deleteMany({ where: { OR: [
    { deduplicationKey: { in: receipts.map(row => `organization:${row.id}`) } },
    ...userIds.map(id => ({ payload: { path: ["actorUserId"], equals: id } })),
  ] } });
  await db.adminAudit.deleteMany({ where: { actorUserId: { in: userIds } } });
  await db.organizationCommand.deleteMany({ where: { id: { in: receipts.map(row => row.id) } } });
  await db.clientGrant.deleteMany({ where: { organizationId: { in: ids } } });
  await db.organizationClient.deleteMany({ where: { organizationId: { in: ids } } });
  await db.organizationMembership.deleteMany({ where: { organizationId: { in: ids } } });
  await db.organization.deleteMany({ where: { id: { in: ids } } });
  await db.brand.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  userIds.length = 0;
});
test.afterAll(async () => { await db.$disconnect(); });

async function setup(english: boolean) {
  const password = `Synthetic organization browser ${randomUUID()}`, passwordHash = await bcrypt.hash(password, 12), language = english ? "en" : "ar";
  const accounts = [];
  for (const role of ["BRAND", "BRAND", "BRAND", "BRAND", "CREATOR", "ADMIN"] as const) {
    const id = randomUUID(); userIds.push(id);
    const user = await db.user.create({ data: { id, role, name: `اسم أصلي ${id.slice(0, 8)}`, nameEn: privateSentinel,
      email: `${id}@example.invalid`, passwordHash, language, isTest: true, emailVerifiedAt: new Date(Date.now() - 1000) } });
    accounts.push({ id: user.id, email: user.email, role });
  }
  const [owner, customerA, customerB, member, creator, admin] = accounts;
  const brands = [];
  for (const [i, account] of [customerA, customerB].entries()) brands.push(await db.brand.create({ data: {
    userId: account.id, slug: `org-e2e-${randomUUID()}`, name: `اسم العميل الأصلي ${i + 1} ${"طويل ".repeat(18)}`,
    description: privateSentinel, profileFacts: { private: privateSentinel }, isTest: true,
  } }));
  async function login(context: BrowserContext, account: { id: string; email: string }) {
    const user = await authenticate(account.email, password);
    if (!user) throw new Error("Synthetic native organization authentication failed");
    const token = await openSession(user.id, user.sessionVersion, user.passwordHash), current = await resolveSession(token);
    if (!current) throw new Error("Synthetic native organization session did not resolve");
    await context.addCookies([{ name: SESSION_COOKIE, value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
      { name: "infame_lang", value: language, domain: "localhost", path: "/" }]);
    return { userId: current.userId, sessionId: current.sessionId, sessionVersion: current.sessionVersion };
  }
  return { owner, customerA, customerB, member, creator, admin, brands, login };
}
async function actualRead<T>(page: Page, url: string, schema: z.ZodType<T>) {
  const response = await page.request.get(url);
  expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toBe("private, no-store");
  const parsed = schema.safeParse((await response.json()).data);
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error("Invalid actual organization read DTO");
  return parsed.data;
}
async function actualCommand<T>(page: Page, body: unknown, schema: z.ZodType<T>) {
  const response = await page.request.post("/api/organizations/commands", { headers: { Origin: origin }, data: body });
  expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toBe("private, no-store");
  const parsed = schema.safeParse((await response.json()).data);
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error("Invalid actual organization command receipt");
  return parsed.data;
}
async function revision(id: string) { return (await db.organization.findUniqueOrThrow({ where: { id } })).revision; }
function safe(value: unknown, secrets: readonly string[]) {
  const encoded = JSON.stringify(value);
  for (const secret of secrets) expect(encoded.includes(secret)).toBe(false);
}
async function expectOrganizationTextWithinViewport(page: Page) {
  const paragraph = page.locator("main p[dir=auto]");
  await expect(paragraph).toHaveCount(1);
  await expect(paragraph).toHaveText(originalName.trim());
  await expect(paragraph).toBeVisible();
  const rendered = await paragraph.evaluate((element, expected) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
    return { original: element.textContent === expected, count: rects.length,
      inside: rects.length > 0 && rects.every(rect => rect.left >= 0 && rect.right <= innerWidth) };
  }, originalName);
  expect(rendered.original).toBe(true); expect(rendered.count).toBeGreaterThan(0); expect(rendered.inside).toBe(true);
}
async function prepareAgency(page: Page, context: BrowserContext, f: Awaited<ReturnType<typeof setup>>) {
  await f.login(context, f.owner);
  const organization = (await actualCommand(page, { action: "CREATE", command: { operationKey: randomUUID(), nameOriginal: originalName, kind: "AGENCY" } }, orgResult)).organization;
  const pending = (await actualCommand(page, { action: "PROPOSE_MEMBER", resourceId: organization.id,
    command: { operationKey: randomUUID(), expectedOrganizationRevision: await revision(organization.id), targetUserId: f.member.id } }, memberResult)).membership;
  const clients = [];
  for (const [index, account] of [f.customerA, f.customerB].entries()) {
    await f.login(context, f.owner);
    const proposed = (await actualCommand(page, { action: "PROPOSE_CLIENT", resourceId: organization.id,
      command: { operationKey: randomUUID(), expectedOrganizationRevision: await revision(organization.id), brandId: f.brands[index].id } }, clientResult)).client;
    await f.login(context, account);
    clients.push((await actualCommand(page, { action: "AUTHORIZE_CLIENT", resourceId: proposed.id,
      command: { operationKey: randomUUID(), expectedRevision: proposed.revision, capabilities: allCapabilities } }, clientResult)).client);
  }
  return { organization, pending, clients };
}
async function setView(page: Page, clientId: string, membershipId: string) {
  return actualCommand(page, { action: "SET_GRANT", resourceId: clientId, command: { operationKey: randomUUID(),
    expectedClientRevision: (await db.organizationClient.findUniqueOrThrow({ where: { id: clientId } })).revision,
    expectedGrantRevision: null, membershipId, capabilities: capabilities(true) } }, grantResult);
}

test("real organization creation retains original input through uncertain replay and resumes a single saved organization", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop", label = (ar: string, en: string) => english ? en : ar, f = await setup(english);
  for (const [account, status] of [[null, 401], [f.creator, 403], [f.admin, 403]] as const) {
    if (account) await f.login(context, account);
    const denied = await page.request.get("/api/organizations");
    expect(denied.status()).toBe(status); expect(denied.headers()["cache-control"]).toBe("private, no-store");
    const command = await page.request.post("/api/organizations/commands", { headers: { Origin: origin }, data: { action: "CREATE", command: { operationKey: randomUUID(), nameOriginal: originalName, kind: "AGENCY" } } });
    expect(command.status()).toBe(status);
  }
  const actor = await f.login(context, f.owner);
  await page.goto("/brand/settings");
  await expect(page.locator('main a[href="/brand/organizations"]')).toHaveCount(1);
  await page.locator('main a[href="/brand/organizations"]').click();
  await expect(page).toHaveURL(/\/brand\/organizations$/);
  await page.goto("/brand/organizations");
  await expect(page.getByRole("heading", { name: label("المؤسسات والفريق", "Organizations and team"), exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", english ? "ltr" : "rtl");
  const name = page.getByLabel(label("اسم المؤسسة", "Organization name"), { exact: true }), kind = page.getByLabel(label("نوع المؤسسة", "Organization type"), { exact: true });
  await name.focus(); await expect(name).toBeFocused(); await page.keyboard.type(originalName);
  await kind.selectOption("AGENCY");
  let firstBody = "", repeatBody = "", committedId = "", release!: () => void, requests = 0, reached = false;
  let leftDirectory = false;
  const trackNavigation = (frame: Frame) => {
    if (frame === page.mainFrame() && new URL(frame.url()).pathname !== "/brand/organizations") leftDirectory = true;
  };
  page.on("framenavigated", trackNavigation);
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route(commandEndpoint, async route => {
    requests++;
    const body = route.request().postData()!;
    if (requests === 1) firstBody = body; else repeatBody = body;
    const actual = await route.fetch(); expect(actual.status()).toBe(200);
    const saved = orgResult.parse((await actual.json()).data); committedId = saved.organization.id;
    if (requests === 1) { expect(saved.replayed).toBe(false); reached = true; await waiting; await route.abort("failed"); }
    else { expect(saved.replayed).toBe(true); await route.fulfill({ response: actual }); }
  });
  try {
    const actuation = await page.getByRole("button", { name: label("إنشاء المؤسسة", "Create organization"), exact: true }).evaluate((button: HTMLButtonElement) => {
      const settings = document.querySelector<HTMLAnchorElement>('main header a[href="/brand/settings"]');
      if (!settings) throw new Error("Expected the real initial local Settings link");
      button.click(); button.click();
      // A second event in the same JS tick must consult the synchronous command
      // guard, before React renders the disabled navigation state.
      const connected = settings.isConnected; settings.click();
      return { existed: true, connected };
    });
    expect(actuation).toEqual({ existed: true, connected: true });
    await expect.poll(() => reached).toBe(true); expect(requests).toBe(1);
    await expect(page).toHaveURL(/\/brand\/organizations$/);
    expect(leftDirectory).toBe(false);
    await expect(name).toHaveValue(originalName); await expect(name).toBeDisabled(); await expect(kind).toBeDisabled();
    expect(await db.organization.count({ where: { ownerUserId: f.owner.id } })).toBe(1);
    await expect(entry(page, committedId)).toHaveCount(0);
    release();
    await expect(page.locator("main").getByRole("alert")).toBeVisible();
    await expect(name).toHaveValue(originalName);
    // The replay returns the genuinely committed receipt200, but its GET fails.
    // Inputs clear only after a subsequent real GET, never from receipt optimism.
    await page.route(directoryEndpoint, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "RETRY_REQUIRED" } }) }));
    const failedReload = page.waitForResponse(response => directoryEndpoint(new URL(response.url())) && response.status() === 503);
    await page.getByRole("button", { name: label("إعادة محاولة الطلب نفسه", "Retry the same request"), exact: true }).click(); await failedReload;
    await expect(page.locator("main").getByRole("alert")).toBeVisible(); await expect(name).toHaveValue(originalName);
    await expect(name).toBeDisabled(); await expect(kind).toBeDisabled();
    await expect(page.getByRole("button", { name: label("إنشاء المؤسسة", "Create organization"), exact: true })).toBeDisabled();
    await expect(entry(page, committedId)).toHaveCount(0);
    expect(repeatBody === firstBody).toBe(true); expect(requests).toBe(2);
    await page.unroute(directoryEndpoint);
    const refreshed = page.waitForResponse(response => directoryEndpoint(new URL(response.url())) && response.status() === 200);
    await page.getByRole("button", { name: label("تحديث", "Refresh"), exact: true }).click(); await refreshed;
    await expect(entry(page, committedId).getByText(originalName.trim(), { exact: true })).toHaveCount(1);
    expect(repeatBody === firstBody).toBe(true); expect(requests).toBe(2);
    await expect(name).toHaveValue("");
  } finally { release(); await page.unroute(commandEndpoint); await page.unroute(directoryEndpoint); page.off("framenavigated", trackNavigation); }
  expect(leftDirectory).toBe(false);
  const key = JSON.parse(firstBody).command.operationKey as string;
  const receipt = await db.organizationCommand.findUniqueOrThrow({ where: { actorUserId_operationKey: { actorUserId: f.owner.id, operationKey: key } } });
  expect(await db.organizationCommand.count({ where: { actorUserId: f.owner.id, operationKey: key } })).toBe(1);
  expect(await db.outboxEvent.count({ where: { deduplicationKey: `organization:${receipt.id}` } })).toBe(1);
  expect((await db.organization.findUniqueOrThrow({ where: { id: committedId } })).name).toBe(originalName);
  const directory = await actualRead(page, "/api/organizations", OrganizationDirectorySchema);
  expect(directory.organizations).toHaveLength(1);
  safe(directory, [actor.sessionId, f.owner.email, privateSentinel, "passwordHash"]);
  await page.reload(); await expect(entry(page, committedId).getByText(originalName.trim(), { exact: true })).toHaveCount(1);
  const open = entry(page, committedId).getByRole("link", { name: label("عرض العملاء", "View clients"), exact: true });
  await expect(open).toHaveAttribute("href", `/brand/organizations/${committedId}`);
  await open.focus(); await expect(open).toBeFocused(); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/brand/organizations/${committedId}$`));
  await expect(page.locator("[data-organization-client-id]")).toHaveCount(0);
  expect((await actualRead(page, `/api/organizations/${committedId}/clients`, OrganizationClientsSchema)).clients).toHaveLength(0);
  await expectOrganizationTextWithinViewport(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  mkdirSync(path.join(workspace, ".infame", "artifacts"), { recursive: true });
  await page.screenshot({ path: path.join(workspace, ".infame", "artifacts", `${info.project.name}-organizations-created.png`), fullPage: true });
  if (english) {
    await page.setViewportSize({ width: 360, height: 800 });
    await expectOrganizationTextWithinViewport(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(workspace, ".infame", "artifacts", `${info.project.name}-organizations-created-360.png`), fullPage: true });
  }
});

test("pending membership acceptance and two genuine client grants expose only each seat's current read-only client", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop", label = (ar: string, en: string) => english ? en : ar, f = await setup(english), a = await prepareAgency(page, context, f);
  await f.login(context, f.member);
  const before = await page.request.get(`/api/organizations/${a.organization.id}`); expect(before.status()).toBe(404);
  await page.goto("/brand/organizations");
  const row = entry(page, a.organization.id), accept = row.getByRole("button", { name: label("قبول العضوية", "Accept membership"), exact: true });
  await expect(row.getByText(originalName.trim(), { exact: true })).toHaveCount(1); await expect(accept).toBeVisible(); await expect(row.getByRole("link")).toHaveCount(0);
  let release!: () => void, reached = false, requests = 0;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route(commandEndpoint, async route => {
    requests++;
    const actual = await route.fetch(); expect(actual.status()).toBe(200);
    const saved = memberResult.parse((await actual.json()).data);
    expect(saved.membership.id).toBe(a.pending.id); expect(saved.membership.state).toBe("ACTIVE"); reached = true;
    await waiting; await route.fulfill({ response: actual });
  });
  try {
    await accept.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect.poll(() => reached).toBe(true); expect(requests).toBe(1);
    await expect(accept).toBeDisabled();
    expect((await db.organizationMembership.findUniqueOrThrow({ where: { id: a.pending.id } })).state).toBe("ACTIVE");
    release(); await expect(accept).toHaveCount(0); await expect(row.getByRole("link")).toBeVisible();
  } finally { release(); await page.unroute(commandEndpoint); }
  expect((await actualRead(page, `/api/organizations/${a.organization.id}/clients`, OrganizationClientsSchema)).clients).toHaveLength(0);
  await f.login(context, f.customerA); await setView(page, a.clients[0].id, a.pending.id);
  const ownerMembership = await db.organizationMembership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: a.organization.id, userId: f.owner.id } } });
  await f.login(context, f.customerB); await setView(page, a.clients[1].id, ownerMembership.id);
  const actor = await f.login(context, f.member);
  await page.goto(`/brand/organizations/${a.organization.id}`);
  await expect(page.getByRole("heading", { name: label("عملاء المؤسسة", "Organization clients"), exact: true })).toBeVisible();
  const own = await actualRead(page, `/api/organizations/${a.organization.id}/clients`, OrganizationClientsSchema);
  expect(own.clients.map(client => client.id)).toEqual([a.clients[0].id]);
  expect(Object.keys(own.clients[0]).sort()).toEqual(["brandId", "brandName", "id", "organizationId", "revision", "state"]);
  safe(own, [actor.sessionId, f.customerA.email, f.customerB.email, f.brands[1].name, privateSentinel, "allowedCapabilities", "authorizingUserId", "passwordHash"]);
  await expect(clientRow(page, a.clients[0].id).getByText(f.brands[0].name.trim(), { exact: true })).toHaveCount(1);
  await expect(clientRow(page, a.clients[1].id)).toHaveCount(0); await expect(page.locator("main").getByText(f.brands[1].name.trim(), { exact: true })).toHaveCount(0);
  await expect(clientRow(page, a.clients[0].id).getByRole("button")).toHaveCount(0);
  await expect(clientRow(page, a.clients[0].id).getByRole("link")).toHaveCount(0);
  for (const client of a.clients) {
    for (const capability of ["plan", "approveShortlist", "reviewContent", "signCustomer", "financial", "manageGrants"] as const) {
      const denied = await page.request.get(`/api/organization-clients/${client.id}/authority?capability=${capability}`);
      expect(denied.status()).toBe(404); expect(denied.headers()["cache-control"]).toBe("private, no-store");
    }
  }
  expect((await page.request.get(`/api/organization-clients/${a.clients[1].id}/authority?capability=view`)).status()).toBe(404);
  const refresh = page.getByRole("button", { name: label("تحديث", "Refresh"), exact: true });
  const keyboardRefresh = page.waitForResponse(response => clientEndpoint(a.organization.id)(new URL(response.url())) && response.status() === 200);
  await refresh.focus(); await expect(refresh).toBeFocused(); await page.keyboard.press("Enter"); await keyboardRefresh;
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  await expect(clientRow(page, a.clients[0].id)).toBeVisible();
  await expectOrganizationTextWithinViewport(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  mkdirSync(path.join(workspace, ".infame", "artifacts"), { recursive: true });
  await page.screenshot({ path: path.join(workspace, ".infame", "artifacts", `${info.project.name}-organizations-clients.png`), fullPage: true });
  if (english) { await page.setViewportSize({ width: 360, height: 800 }); await expectOrganizationTextWithinViewport(page); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await expect(clientRow(page, a.clients[0].id)).toBeVisible(); }
  await f.login(context, f.owner);
  const ownerView = await actualRead(page, `/api/organizations/${a.organization.id}/clients`, OrganizationClientsSchema);
  expect(ownerView.clients.map(client => client.id)).toEqual([a.clients[1].id]);
  await page.reload(); await expect(clientRow(page, a.clients[1].id)).toBeVisible(); await expect(clientRow(page, a.clients[0].id)).toHaveCount(0);
});

test("organization reads retain explicit transient snapshots and clear private content on malformed denial or actual session revocation", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop", label = (ar: string, en: string) => english ? en : ar, f = await setup(english), a = await prepareAgency(page, context, f);
  await f.login(context, f.member); await actualCommand(page, { action: "ACCEPT_MEMBERSHIP", resourceId: a.pending.id,
    command: { operationKey: randomUUID(), expectedRevision: a.pending.revision } }, memberResult);
  await f.login(context, f.customerA); await setView(page, a.clients[0].id, a.pending.id);
  const actor = await f.login(context, f.member); await page.goto(`/brand/organizations/${a.organization.id}`);
  const endpoint = clientEndpoint(a.organization.id), originalTime = await snapshotTime(page).getAttribute("datetime");
  await expect(clientRow(page, a.clients[0].id)).toBeVisible();
  let release!: () => void, reached = false, requests = 0, asOf = "";
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route(endpoint, async route => {
    requests++; const actual = await route.fetch(); expect(actual.status()).toBe(200);
    asOf = OrganizationClientsSchema.parse((await actual.json()).data).asOf; reached = true;
    await waiting; await route.fulfill({ response: actual });
  });
  try {
    await page.getByRole("button", { name: label("تحديث", "Refresh"), exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect.poll(() => reached).toBe(true); expect(requests).toBe(1);
    await expect(snapshotTime(page)).toHaveAttribute("datetime", originalTime!); await expect(clientRow(page, a.clients[0].id)).toBeVisible();
    release(); await expect(snapshotTime(page)).toHaveAttribute("datetime", asOf);
  } finally { release(); await page.unroute(endpoint); }
  for (const [status, body] of [[503, JSON.stringify({ error: { code: "RETRY_REQUIRED" } })], [200, JSON.stringify({ data: { invented: true } })]] as const) {
    const savedTime = await snapshotTime(page).getAttribute("datetime");
    // Accepted snapshots always come from native HTTP. Only failure paths are injected.
    await page.route(endpoint, route => route.fulfill({ status, contentType: "application/json", body }));
    const failed = page.waitForResponse(response => endpoint(new URL(response.url())) && response.status() === status);
    await page.getByRole("button", { name: label("تحديث", "Refresh"), exact: true }).click(); await failed;
    await expect(page.locator("main").getByRole("alert")).toBeVisible(); await expect(clientRow(page, a.clients[0].id)).toBeVisible();
    await expect(snapshotTime(page)).toHaveAttribute("datetime", savedTime!);
    await page.unroute(endpoint);
    const recovered = page.waitForResponse(response => endpoint(new URL(response.url())) && response.status() === 200);
    await page.getByRole("button", { name: label("تحديث", "Refresh"), exact: true }).click(); await recovered;
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  }
  for (const status of [401, 403]) {
    await page.route(endpoint, route => route.fulfill({ status, contentType: "application/json", body: "invalid-json" }));
    const denied = page.waitForResponse(response => endpoint(new URL(response.url())) && response.status() === status);
    await page.getByRole("button", { name: label("تحديث", "Refresh"), exact: true }).click(); await denied;
    await expect(page.locator("main").getByRole("alert")).toBeVisible(); await expect(page.locator("[data-organization-client-id]")).toHaveCount(0);
    await expect(page.locator("main").getByText(originalName.trim(), { exact: true })).toHaveCount(0); await expect(snapshotTime(page)).toHaveCount(0);
    await page.unroute(endpoint);
    await expect(page.getByRole("button", { name: label("تحديث", "Refresh"), exact: true })).toBeDisabled();
    // Native SSR, with the still-valid actor, recovers an injected denial.
    await page.reload();
    await expect(clientRow(page, a.clients[0].id)).toBeVisible(); await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  }
  await db.authSession.update({ where: { id: actor.sessionId }, data: { revokedAt: new Date() } });
  const denied = page.waitForResponse(response => endpoint(new URL(response.url())) && response.status() === 401);
  await page.getByRole("button", { name: label("تحديث", "Refresh"), exact: true }).click();
  expect((await denied).headers()["cache-control"]).toBe("private, no-store");
  await expect(page.locator("[data-organization-client-id]")).toHaveCount(0); await expect(snapshotTime(page)).toHaveCount(0);
  await expect(page.locator("main").getByText(originalName.trim(), { exact: true })).toHaveCount(0);
  expect((await context.cookies()).some(cookie => cookie.name === SESSION_COOKIE)).toBe(true);
  await page.goto("/brand/organizations"); await expect(page).toHaveURL(/\/login(?:\?|$)/);
});
