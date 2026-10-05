import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { expect, test, type BrowserContext, type Frame, type Locator, type Page } from "@playwright/test";
import { assertLocalTarget, taskState, workspace } from "../scripts/task-state.mjs";
import { prisma as db } from "../src/lib/prisma";
import { authenticate, openSession, resolveSession } from "../src/lib/identity";
import { SESSION_COOKIE } from "../src/lib/jwt";
import { ClientGrantSchema, ClientGrantsSchema, MembershipSchema, OrganizationClientSchema,
  OrganizationClientsSchema, OrganizationDirectorySchema, OrganizationSchema, OwnBrandAssociationsSchema, type ClientCapabilities } from "../src/lib/organizations/contracts";

// Actual authenticated HTTP/browser acceptance on the guarded E2E database.
// All fixture identities and consent are synthetic; no outreach or billing.
const state = taskState(), origin = "http://localhost:3100", userIds: string[] = [];
const privateSentinel = "private-management-browser-content";
const originalName = `  وكالة إنفيم الأصلية <script> ${"اسمطويل".repeat(10)}  `;
const all: ClientCapabilities = { view: true, plan: true, approveShortlist: true, reviewContent: true, signCustomer: true, financial: true, manageGrants: true };
const none: ClientCapabilities = { view: false, plan: false, approveShortlist: false, reviewContent: false, signCustomer: false, financial: false, manageGrants: false };
const OrgResult = z.object({ organization: OrganizationSchema, replayed: z.boolean() }).strict();
const MemberResult = z.object({ membership: MembershipSchema, replayed: z.boolean() }).strict();
const ClientResult = z.object({ client: OrganizationClientSchema, replayed: z.boolean() }).strict();
const GrantResult = z.object({ grant: ClientGrantSchema, replayed: z.boolean() }).strict();
const commandEndpoint = (url: URL) => url.pathname === "/api/organizations/commands";
const membershipRow = (page: Page, id: string) => page.locator(`[data-membership-id="${id}"]`);
const associationRow = (page: Page, id: string) => page.locator(`[data-association-id="${id}"]`);
const grantRow = (page: Page, id: string) => page.locator(`[data-grant-id="${id}"]`);
const organizationRow = (page: Page, id: string) => page.locator(`[data-organization-id="${id}"]`);

if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("Management browser acceptance requires exact isolated E2E target");
test.setTimeout(90000);
test.beforeAll(async () => {
  const rows = await db.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id, kind, current_database() AS db, host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0].id !== state.id || rows[0].kind !== "e2e" || rows[0].db !== state.targets.e2e || rows[0].host !== "127.0.0.1") throw new Error("Incorrect management browser database identity");
});
test.afterEach(async () => {
  const organizations = await db.organization.findMany({ where: { ownerUserId: { in: userIds } }, select: { id: true } });
  const ids = organizations.map(row => row.id);
  const receipts = await db.organizationCommand.findMany({ where: { OR: [{ actorUserId: { in: userIds } }, { organizationId: { in: ids } }] }, select: { id: true } });
  await db.outboxEvent.deleteMany({ where: { OR: [{ deduplicationKey: { in: receipts.map(row => `organization:${row.id}`) } },
    ...userIds.map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } }))] } });
  await db.adminAudit.deleteMany({ where: { actorUserId: { in: userIds } } });
  await db.organizationCommand.deleteMany({ where: { id: { in: receipts.map(row => row.id) } } });
  await db.clientGrant.deleteMany({ where: { organizationId: { in: ids } } });
  await db.organizationClient.deleteMany({ where: { organizationId: { in: ids } } });
  await db.organizationMembership.deleteMany({ where: { organizationId: { in: ids } } });
  await db.organization.deleteMany({ where: { id: { in: ids } } });
  await db.brand.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } }); userIds.length = 0;
});
test.afterAll(async () => { await db.$disconnect(); });

async function fixture(english: boolean) {
  const password = `Synthetic management browser ${randomUUID()}`, passwordHash = await bcrypt.hash(password, 12), language = english ? "en" : "ar";
  const users = [];
  for (let index = 0; index < 4; index++) {
    const id = randomUUID(); userIds.push(id);
    const user = await db.user.create({ data: { id, role: "BRAND", name: `اسم أصلي طويل ${id}`, nameEn: privateSentinel,
      email: `${id}@example.invalid`, passwordHash, language, isTest: true, emailVerifiedAt: new Date(Date.now() - 1000) } });
    users.push({ id: user.id, email: user.email, name: user.name });
  }
  const [owner, customerA, customerB, member] = users;
  const brands = [];
  for (const [index, account] of [customerA, customerB].entries()) brands.push(await db.brand.create({ data: {
    userId: account.id, slug: `mgmt-e2e-${randomUUID()}`, name: `اسم العميل الأصلي ${index + 1} ${"طويل ".repeat(18)}`,
    description: privateSentinel, profileFacts: { private: privateSentinel }, isTest: true,
  } }));
  async function login(context: BrowserContext, account: { id: string; email: string }) {
    const user = await authenticate(account.email, password);
    if (!user) throw new Error("Native synthetic management authentication failed");
    const token = await openSession(user.id, user.sessionVersion, user.passwordHash), current = await resolveSession(token);
    if (!current) throw new Error("Native synthetic management session did not resolve");
    await context.addCookies([{ name: SESSION_COOKIE, value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
      { name: "infame_lang", value: language, domain: "localhost", path: "/" }]);
    return { userId: current.userId, sessionId: current.sessionId, sessionVersion: current.sessionVersion };
  }
  return { owner, customerA, customerB, member, brands, login };
}
async function command<T>(page: Page, input: unknown, schema: z.ZodType<T>) {
  const response = await page.request.post("/api/organizations/commands", { headers: { Origin: origin }, data: input });
  expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toBe("private, no-store");
  return schema.parse((await response.json()).data);
}
async function uiCommand<T>(page: Page, button: Locator, schema: z.ZodType<T>) {
  const response = page.waitForResponse(response => commandEndpoint(new URL(response.url())) && response.request().method() === "POST");
  await button.click(); const actual = await response;
  expect(actual.status()).toBe(200); expect(actual.headers()["cache-control"]).toBe("private, no-store");
  return schema.parse((await actual.json()).data);
}
async function read<T>(page: Page, url: string, schema: z.ZodType<T>) {
  const response = await page.request.get(url);
  expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toBe("private, no-store");
  return schema.parse((await response.json()).data);
}
async function revision(id: string) { return (await db.organization.findUniqueOrThrow({ where: { id } })).revision; }
async function saved(page: Page, label: (ar: string, en: string) => string) {
  await expect(page.locator("main p[role=status]")).toHaveText(label("تم حفظ الطلب وتحديث البيانات.", "Request saved and data refreshed."));
}
async function safeViewport(page: Page, english: boolean, project: string, suffix: string) {
  await expect(page.locator("html")).toHaveAttribute("dir", english ? "ltr" : "rtl");
  const original = page.getByText(originalName.trim(), { exact: true });
  await expect(original).toHaveCount(1); await expect(original).toBeVisible();
  async function inspect() {
    const layout = await original.evaluate((element, expected) => {
      const range = document.createRange(); range.selectNodeContents(element);
      const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
      return { original: element.textContent === expected, visible: rects.length > 0,
        inside: rects.every(rect => rect.left >= -0.5 && rect.right <= innerWidth + 0.5), fits: document.documentElement.scrollWidth <= innerWidth };
    }, originalName);
    expect(layout).toEqual({ original: true, visible: true, inside: true, fits: true });
  }
  await inspect(); mkdirSync(path.join(workspace, ".infame", "artifacts"), { recursive: true });
  await page.screenshot({ path: path.join(workspace, ".infame", "artifacts", `${project}-organization-management-${suffix}.png`), fullPage: true });
  if (english) {
    const previousViewport = page.viewportSize();
    await page.setViewportSize({ width: 360, height: 800 }); await inspect();
    await page.screenshot({ path: path.join(workspace, ".infame", "artifacts", `${project}-organization-management-${suffix}-360.png`), fullPage: true });
    if (previousViewport) await page.setViewportSize(previousViewport);
  }
}
async function prepared(page: Page, context: BrowserContext, f: Awaited<ReturnType<typeof fixture>>, grantCaps = { ...none, view: true }) {
  await f.login(context, f.owner);
  const organization = (await command(page, { action: "CREATE", command: { operationKey: randomUUID(), nameOriginal: originalName, kind: "AGENCY" } }, OrgResult)).organization;
  const proposed = (await command(page, { action: "PROPOSE_MEMBER", resourceId: organization.id,
    command: { operationKey: randomUUID(), expectedOrganizationRevision: await revision(organization.id), targetUserId: f.member.id } }, MemberResult)).membership;
  await f.login(context, f.member);
  const membership = (await command(page, { action: "ACCEPT_MEMBERSHIP", resourceId: proposed.id,
    command: { operationKey: randomUUID(), expectedRevision: proposed.revision } }, MemberResult)).membership;
  const clients = [];
  for (const [index, owner] of [f.customerA, f.customerB].entries()) {
    await f.login(context, f.owner);
    const p = (await command(page, { action: "PROPOSE_CLIENT", resourceId: organization.id,
      command: { operationKey: randomUUID(), expectedOrganizationRevision: await revision(organization.id), brandId: f.brands[index].id } }, ClientResult)).client;
    await f.login(context, owner);
    clients.push((await command(page, { action: "AUTHORIZE_CLIENT", resourceId: p.id,
      command: { operationKey: randomUUID(), expectedRevision: p.revision, capabilities: all } }, ClientResult)).client);
  }
  await f.login(context, f.customerA);
  const grant = (await command(page, { action: "SET_GRANT", resourceId: clients[0].id,
    command: { operationKey: randomUUID(), expectedClientRevision: clients[0].revision, expectedGrantRevision: null, membershipId: membership.id, capabilities: grantCaps } }, GrantResult)).grant;
  return { organization, membership, clients, grant };
}

test("real owner proposals, recipient acceptance and exact customer consent enable only the selected client, and customer withdrawal never revives grants", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop", label = (ar: string, en: string) => english ? en : ar, f = await fixture(english);
  await page.emulateMedia({ reducedMotion: "reduce" }); await f.login(context, f.owner); await page.goto("/brand/organizations");
  await page.getByLabel(label("اسم المؤسسة", "Organization name"), { exact: true }).fill(originalName);
  await page.getByLabel(label("نوع المؤسسة", "Organization type"), { exact: true }).selectOption("AGENCY");
  const organization = (await uiCommand(page, page.getByRole("button", { name: label("إنشاء المؤسسة", "Create organization"), exact: true }), OrgResult)).organization;
  const manage = organizationRow(page, organization.id).getByRole("link", { name: label("إدارة المؤسسة", "Manage organization"), exact: true });
  await expect(manage).toBeVisible(); await manage.focus(); await expect(manage).toBeFocused(); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/brand/organizations/${organization.id}/manage$`));
  const target = page.getByLabel(label("مرجع حساب العضو", "Member account reference"), { exact: true });
  await target.focus(); await expect(target).toBeFocused(); await page.keyboard.type(f.member.id);
  const membership = (await uiCommand(page, page.getByRole("button", { name: label("طلب العضوية", "Request membership"), exact: true }), MemberResult)).membership;
  await expect(membershipRow(page, membership.id)).toBeVisible();
  await expect(membershipRow(page, membership.id)).not.toContainText(f.member.name);
  const clients = [];
  for (const brand of f.brands) {
    await page.getByLabel(label("مرجع الشركة", "Company reference"), { exact: true }).fill(brand.id);
    const p = (await uiCommand(page, page.getByRole("button", { name: label("طلب تفويض العميل", "Request client authorization"), exact: true }), ClientResult)).client;
    clients.push(p); await expect(associationRow(page, p.id)).toBeVisible(); await expect(associationRow(page, p.id)).not.toContainText(brand.name);
  }
  await safeViewport(page, english, info.project.name, "owner-proposals");
  await f.login(context, f.member); await page.goto("/brand/organizations");
  const accepted = (await uiCommand(page, organizationRow(page, organization.id).getByRole("button", { name: label("قبول العضوية", "Accept membership"), exact: true }), MemberResult)).membership;
  await expect(organizationRow(page, organization.id).getByRole("link", { name: label("عرض العملاء", "View clients"), exact: true })).toBeVisible();
  for (const [index, owner] of [f.customerA, f.customerB].entries()) {
    await f.login(context, owner); await page.goto("/brand/settings");
    await page.locator('main a[href="/brand/settings/agency-access"]').click();
    const row = associationRow(page, clients[index].id); await expect(row).toBeVisible();
    const allowed = index === 0 ? { ...none, view: true, manageGrants: true } : all;
    if (index === 0) {
      await row.getByRole("checkbox", { name: label("عرض بيانات العميل", "View client data"), exact: true }).check();
      await row.getByRole("checkbox", { name: label("إدارة صلاحيات الفريق", "Manage team permissions"), exact: true }).check();
      await expect(row.getByRole("checkbox", { name: label("الإجراءات المالية", "Financial actions"), exact: true })).not.toBeChecked();
    } else for (const checkbox of await row.getByRole("checkbox").all()) await checkbox.check();
    clients[index] = (await uiCommand(page, row.getByRole("button", { name: label("حفظ التفويض المحدد", "Save explicit authorization"), exact: true }), ClientResult)).client;
    await saved(page, label);
    expect((await db.organizationClient.findUniqueOrThrow({ where: { id: clients[index].id } })).allowedCapabilities).toEqual(allowed);
  }
  await f.login(context, f.customerA); await page.goto("/brand/settings/agency-access");
  await associationRow(page, clients[0].id).getByRole("link", { name: label("مراجعة صلاحيات الفريق", "Review team permissions"), exact: true }).click();
  await page.getByLabel(label("مرجع العضوية", "Membership reference"), { exact: true }).fill(accepted.id);
  await page.locator("#grant-view").check(); await expect(page.locator("#grant-financial")).toBeDisabled();
  const g = (await uiCommand(page, page.getByRole("button", { name: label("حفظ صلاحيات العضو", "Save member permissions"), exact: true }), GrantResult)).grant;
  await saved(page, label); expect(g.capabilities).toEqual({ ...none, view: true });
  await expect(grantRow(page, g.id)).toBeVisible(); await safeViewport(page, english, info.project.name, "view-only-grant");
  await f.login(context, f.member); await page.goto(`/brand/organizations/${organization.id}`);
  const visible = await read(page, `/api/organizations/${organization.id}/clients`, OrganizationClientsSchema);
  expect(visible.clients.map(row => row.id)).toEqual([clients[0].id]);
  const foreign = await page.request.get(`/api/organization-clients/${clients[1].id}/authority?capability=view`);
  expect(foreign.status()).toBe(404); expect(foreign.headers()["cache-control"]).toBe("private, no-store");
  await expect(page.locator("main")).not.toContainText(f.brands[1].name);
  // Native fixture deactivation represents a real unavailable agency state,
  // not a claim that an unimplemented deactivation UI has been accepted.
  await db.organization.update({ where: { id: organization.id }, data: { active: false, revision: { increment: 1 } } });
  await db.user.update({ where: { id: f.owner.id }, data: { active: false } });
  await f.login(context, f.customerA); await page.goto("/brand/settings/agency-access");
  const withdrawn = (await uiCommand(page, associationRow(page, clients[0].id).getByRole("button", { name: label("سحب وصول الوكالة", "Withdraw agency access"), exact: true }), ClientResult)).client;
  await saved(page, label); expect(withdrawn.state).toBe("REVOKED");
  expect(await db.clientGrant.findUniqueOrThrow({ where: { id: g.id } })).toMatchObject({ active: false, revision: g.revision + 1 });
  await db.organization.update({ where: { id: organization.id }, data: { active: true, revision: { increment: 1 } } });
  await db.user.update({ where: { id: f.owner.id }, data: { active: true } });
  await page.getByRole("button", { name: label("تحديث البيانات", "Refresh data"), exact: true }).click();
  await expect(associationRow(page, clients[0].id).getByRole("button", { name: label("حفظ التفويض المحدد", "Save explicit authorization"), exact: true })).toHaveCount(0);
  // Withdrawal ends both-party consent. A fresh explicit agency request must
  // precede the company's renewed consent; historic grants remain retired.
  await f.login(context, f.owner); await page.goto(`/brand/organizations/${organization.id}/manage`);
  await page.getByLabel(label("مرجع الشركة", "Company reference"), { exact: true }).fill(f.brands[0].id);
  const renewed = (await uiCommand(page, page.getByRole("button", { name: label("طلب تفويض العميل", "Request client authorization"), exact: true }), ClientResult)).client;
  expect(renewed).toMatchObject({ id: clients[0].id, state: "PENDING" }); await saved(page, label);
  await f.login(context, f.customerA); await page.goto("/brand/settings/agency-access");
  const renewedRow = associationRow(page, clients[0].id);
  await renewedRow.getByRole("checkbox", { name: label("عرض بيانات العميل", "View client data"), exact: true }).check();
  await renewedRow.getByRole("checkbox", { name: label("إدارة صلاحيات الفريق", "Manage team permissions"), exact: true }).check();
  await uiCommand(page, renewedRow.getByRole("button", { name: label("حفظ التفويض المحدد", "Save explicit authorization"), exact: true }), ClientResult); await saved(page, label);
  await f.login(context, f.member);
  const noRevival = await page.request.get(`/api/organization-clients/${clients[0].id}/authority?capability=view`); expect(noRevival.status()).toBe(404);
  expect((await read(page, `/api/organizations/${organization.id}/clients`, OrganizationClientsSchema)).clients).toEqual([]);
  expect(await db.clientGrant.findUniqueOrThrow({ where: { id: g.id } })).toMatchObject({ active: false, revision: g.revision + 1 });
});

test("a genuine saved member proposal survives uncertain reply and GET503 with the exact same key, editor values and same-tick navigation guard", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop", label = (ar: string, en: string) => english ? en : ar, f = await fixture(english);
  await f.login(context, f.owner);
  const organization = (await command(page, { action: "CREATE", command: { operationKey: randomUUID(), nameOriginal: originalName, kind: "AGENCY" } }, OrgResult)).organization;
  await page.goto(`/brand/organizations/${organization.id}/manage`);
  const target = page.getByLabel(label("مرجع حساب العضو", "Member account reference"), { exact: true }); await target.fill(f.member.id);
  const memberEndpoint = (url: URL) => url.pathname === `/api/organizations/${organization.id}/members`;
  let requests = 0, firstBody = "", repeatBody = "", membershipId = "", reached = false, left = false, release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const tracking = (frame: Frame) => { if (frame === page.mainFrame() && new URL(frame.url()).pathname !== `/brand/organizations/${organization.id}/manage`) left = true; };
  page.on("framenavigated", tracking);
  await page.route(commandEndpoint, async route => {
    requests++; const body = route.request().postData()!; if (requests === 1) firstBody = body; else repeatBody = body;
    const actual = await route.fetch(); expect(actual.status()).toBe(200); const result = MemberResult.parse((await actual.json()).data); membershipId = result.membership.id;
    if (requests === 1) { expect(result.replayed).toBe(false); reached = true; await waiting; await route.abort("failed"); }
    else { expect(result.replayed).toBe(true); await route.fulfill({ response: actual }); }
  });
  try {
    const connected = await page.getByRole("button", { name: label("طلب العضوية", "Request membership"), exact: true }).evaluate((button: HTMLButtonElement) => {
      const link = document.querySelector<HTMLAnchorElement>('main header a[href="/brand/organizations"]');
      if (!link) throw new Error("Expected actual initial Organizations link");
      button.click(); button.click(); const connected = link.isConnected; link.click(); return connected;
    });
    expect(connected).toBe(true); await expect.poll(() => reached).toBe(true); expect(requests).toBe(1); expect(left).toBe(false);
    await expect(target).toHaveValue(f.member.id); await expect(target).toBeDisabled(); await expect(membershipRow(page, membershipId)).toHaveCount(0);
    release(); await expect(page.locator("main").getByRole("alert")).toBeVisible();
    await page.route(memberEndpoint, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "RETRY_REQUIRED" } }) }));
    const failedRead = page.waitForResponse(response => memberEndpoint(new URL(response.url())) && response.status() === 503);
    await page.getByRole("button", { name: label("إعادة محاولة الطلب نفسه", "Retry the same request"), exact: true }).click(); await failedRead;
    await expect(target).toHaveValue(f.member.id); await expect(target).toBeDisabled(); await expect(membershipRow(page, membershipId)).toHaveCount(0);
    await expect(page.getByText(label("تم حفظ الطلب. حدّث البيانات لإكمال الاستعادة.", "Your request was saved. Refresh the data to finish recovery."), { exact: true })).toBeVisible();
    expect(requests).toBe(2); expect(repeatBody).toBe(firstBody);
    await page.unroute(memberEndpoint); await page.getByRole("button", { name: label("تحديث البيانات", "Refresh data"), exact: true }).click();
    await saved(page, label); await expect(target).toHaveValue(""); await expect(membershipRow(page, membershipId)).toBeVisible();
    expect(requests).toBe(2); expect(left).toBe(false);
    const key = JSON.parse(firstBody).command.operationKey as string;
    const receipt = await db.organizationCommand.findUniqueOrThrow({ where: { actorUserId_operationKey: { actorUserId: f.owner.id, operationKey: key } } });
    expect(await db.organizationCommand.count({ where: { actorUserId: f.owner.id, operationKey: key } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { deduplicationKey: `organization:${receipt.id}` } })).toBe(1);
    await safeViewport(page, english, info.project.name, "replay-recovered");
  } finally { release(); await page.unroute(commandEndpoint); await page.unroute(memberEndpoint); page.off("framenavigated", tracking); }
});

test("schema-valid wrong-state200 keeps exact grant replay, while genuine404 with malformed body immediately clears protected snapshots", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop", label = (ar: string, en: string) => english ? en : ar, f = await fixture(english), a = await prepared(page, context, f);
  await page.goto(`/brand/organization-clients/${a.clients[0].id}/grants`); await expect(grantRow(page, a.grant.id)).toBeVisible();
  let requests = 0, firstBody = "", repeatBody = "";
  await page.route(commandEndpoint, async route => {
    requests++; if (requests === 1) firstBody = route.request().postData()!; else repeatBody = route.request().postData()!;
    const actual = await route.fetch(); expect(actual.status()).toBe(200); const body = await actual.json();
    const receipt = GrantResult.parse(body.data);
    if (requests === 1) { expect(receipt.grant.active).toBe(false); await route.fulfill({ response: actual, json: { ...body, data: { ...receipt, grant: { ...receipt.grant, active: true } } } }); }
    else { expect(receipt.replayed).toBe(true); await route.fulfill({ response: actual }); }
  });
  try {
    await grantRow(page, a.grant.id).getByRole("button", { name: label("سحب الصلاحيات", "Revoke permissions"), exact: true }).click();
    await expect(page.locator("main").getByRole("alert")).toBeVisible();
    await expect(page.getByRole("button", { name: label("إعادة محاولة الطلب نفسه", "Retry the same request"), exact: true })).toBeVisible();
    expect(await db.clientGrant.findUniqueOrThrow({ where: { id: a.grant.id } })).toMatchObject({ active: false, revision: a.grant.revision + 1 });
    await expect(grantRow(page, a.grant.id).getByText(label("سجل صلاحية نشط", "Active grant record"), { exact: true })).toBeVisible();
    await page.getByRole("button", { name: label("إعادة محاولة الطلب نفسه", "Retry the same request"), exact: true }).click(); await saved(page, label);
    expect(requests).toBe(2); expect(repeatBody).toBe(firstBody);
    await expect(grantRow(page, a.grant.id).getByText(label("سجل صلاحية مسحوب", "Withdrawn grant record"), { exact: true })).toBeVisible();
  } finally { await page.unroute(commandEndpoint); }
  await grantRow(page, a.grant.id).getByRole("button", { name: label("تعديل الصلاحيات", "Edit permissions"), exact: true }).click();
  await expect(page.getByLabel(label("مرجع العضوية", "Membership reference"), { exact: true })).toHaveValue(a.membership.id);
  await command(page, { action: "REVOKE_CLIENT", resourceId: a.clients[0].id,
    command: { operationKey: randomUUID(), expectedRevision: a.clients[0].revision } }, ClientResult);
  let deniedRequests = 0;
  await page.route(commandEndpoint, async route => {
    deniedRequests++; const actual = await route.fetch(); expect(actual.status()).toBe(404);
    await route.fulfill({ status: 404, contentType: "application/json", body: "{ malformed private denial body" });
  });
  try {
    await page.getByRole("button", { name: label("حفظ صلاحيات العضو", "Save member permissions"), exact: true }).click();
    await expect(page.locator("main").getByRole("alert")).toHaveText(label("لم يعد هذا الوصول متاحًا. ارجع إلى الإعدادات أو سجّل الدخول مجددًا.", "This access is no longer available. Return to settings or sign in again."));
    await expect(grantRow(page, a.grant.id)).toHaveCount(0); await expect(page.getByText(originalName.trim(), { exact: true })).toHaveCount(0);
    await expect(page.getByLabel(label("مرجع العضوية", "Membership reference"), { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: label("تحديث البيانات", "Refresh data"), exact: true })).toBeDisabled();
    await expect(page.locator('main a[href="/login"]')).toBeVisible();
    await expect(page.locator("main")).not.toContainText("malformed private denial"); expect(deniedRequests).toBe(1);
  } finally { await page.unroute(commandEndpoint); }
});

test("refresh requires explicit review after a reduced delegation ceiling, changed grant version or suspended member and submits only current allowed permissions", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop", label = (ar: string, en: string) => english ? en : ar, f = await fixture(english), a = await prepared(page, context, f, { ...none, view: true, financial: true });
  await page.goto(`/brand/organization-clients/${a.clients[0].id}/grants`);
  const edit = () => grantRow(page, a.grant.id).getByRole("button", { name: label("تعديل الصلاحيات", "Edit permissions"), exact: true });
  const save = page.getByRole("button", { name: label("حفظ صلاحيات العضو", "Save member permissions"), exact: true });
  const clear = page.getByRole("button", { name: label("مسح الاختيار", "Clear selection"), exact: true });
  const warning = label("تغيّر التفويض أو سجل الصلاحية أو أهلية العضو. امسح الاختيار ثم راجع الصلاحيات الحالية قبل الحفظ.", "Authorization, the grant record or member eligibility changed. Clear the selection and review current permissions before saving.");
  await edit().click(); await expect(page.locator("#grant-financial")).toBeChecked();
  const changedClient = (await command(page, { action: "AUTHORIZE_CLIENT", resourceId: a.clients[0].id,
    command: { operationKey: randomUUID(), expectedRevision: a.clients[0].revision, capabilities: { ...all, financial: false } } }, ClientResult)).client;
  await page.getByRole("button", { name: label("تحديث البيانات", "Refresh data"), exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText(warning); await expect(save).toBeDisabled(); await expect(clear).toBeEnabled();
  await expect(page.locator("#grant-financial")).toBeDisabled(); await clear.click(); await edit().click();
  await expect(page.locator("#grant-financial")).not.toBeChecked(); await expect(page.locator("#grant-financial")).toBeDisabled();
  await expect(page.locator("#grant-view")).toBeChecked(); await expect(save).toBeEnabled();
  const savedGrant = (await uiCommand(page, save, GrantResult)).grant; await saved(page, label);
  expect(savedGrant.capabilities).toEqual({ ...none, view: true }); expect(savedGrant.revision).toBe(a.grant.revision + 1);
  const actual = await read(page, `/api/organization-clients/${a.clients[0].id}/grants`, ClientGrantsSchema);
  expect(actual.grants.find(row => row.grant.id === a.grant.id)?.effectiveCapabilities).toEqual({ ...none, view: true });
  await edit().click(); await expect(page.locator("#grant-view")).toBeChecked();
  const changedGrant = (await command(page, { action: "SET_GRANT", resourceId: a.clients[0].id,
    command: { operationKey: randomUUID(), expectedClientRevision: changedClient.revision, membershipId: a.membership.id,
      expectedGrantRevision: savedGrant.revision, capabilities: none } }, GrantResult)).grant;
  await page.getByRole("button", { name: label("تحديث البيانات", "Refresh data"), exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText(warning); await expect(save).toBeDisabled();
  await clear.click(); await edit().click(); await expect(page.locator("#grant-view")).not.toBeChecked();
  await page.locator("#grant-view").focus(); await expect(page.locator("#grant-view")).toBeFocused(); await page.keyboard.press("Space");
  await expect(page.locator("#grant-view")).toBeChecked();
  const current = (await uiCommand(page, save, GrantResult)).grant; await saved(page, label);
  expect(current.revision).toBe(changedGrant.revision + 1); expect(current.capabilities).toEqual({ ...none, view: true });
  await edit().click(); await expect(page.locator("#grant-view")).toBeChecked();
  // This native fixture mutation supplies a genuine unavailable member. The
  // customer stays authenticated and must review that eligibility change.
  await db.user.update({ where: { id: f.member.id }, data: { active: false } });
  await page.getByRole("button", { name: label("تحديث البيانات", "Refresh data"), exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText(warning);
  await expect(page.getByLabel(label("مرجع العضوية", "Membership reference"), { exact: true })).toHaveValue(a.membership.id);
  await expect(save).toBeDisabled(); await expect(clear).toBeEnabled(); await expect(edit()).toBeDisabled();
  const suspended = await read(page, `/api/organization-clients/${a.clients[0].id}/grants`, ClientGrantsSchema);
  expect(suspended.grants.find(row => row.grant.id === a.grant.id)).toMatchObject({ canReceiveGrant: false, effectiveCapabilities: none });
  expect(await db.clientGrant.findUniqueOrThrow({ where: { id: a.grant.id } })).toMatchObject({ active: true, revision: current.revision });
  await clear.click(); await expect(page.getByLabel(label("مرجع العضوية", "Membership reference"), { exact: true })).toHaveValue("");
  await expect(save).toBeDisabled();
  await db.user.update({ where: { id: f.member.id }, data: { active: true } });
  await page.getByRole("button", { name: label("تحديث البيانات", "Refresh data"), exact: true }).click();
  await expect(edit()).toBeEnabled(); await edit().click();
  await expect(page.locator("#grant-view")).toBeChecked(); await expect(page.locator("#grant-financial")).toBeDisabled(); await expect(save).toBeEnabled();
  const restored = (await uiCommand(page, save, GrantResult)).grant; await saved(page, label);
  expect(restored).toMatchObject({ revision: current.revision + 1, capabilities: { ...none, view: true } });
  await safeViewport(page, english, info.project.name, "reviewed-current-grant");
  const own = await read(page, "/api/brand/organization-associations", OwnBrandAssociationsSchema);
  expect(own.associations.find(row => row.client.id === a.clients[0].id)?.delegation).toBe("CURRENT");
  await expect(page.locator("main")).not.toContainText(privateSentinel);
});

test("unavailable organizations retain only the recipient's own pending and active memberships so decline and leave remain usable while owner membership stays protected", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop", label = (ar: string, en: string) => english ? en : ar, f = await fixture(english), a = await prepared(page, context, f);
  await page.emulateMedia({ reducedMotion: "reduce" }); await f.login(context, f.owner);
  const pendingOrganization = (await command(page, { action: "CREATE", command: { operationKey: randomUUID(), nameOriginal: originalName, kind: "AGENCY" } }, OrgResult)).organization;
  const pending = (await command(page, { action: "PROPOSE_MEMBER", resourceId: pendingOrganization.id,
    command: { operationKey: randomUUID(), expectedOrganizationRevision: await revision(pendingOrganization.id), targetUserId: f.member.id } }, MemberResult)).membership;
  await f.login(context, f.member); await page.goto("/brand/organizations");
  const activeRow = organizationRow(page, a.organization.id), pendingRow = organizationRow(page, pendingOrganization.id);
  await expect(activeRow.getByRole("link", { name: label("عرض العملاء", "View clients"), exact: true })).toBeVisible();
  await expect(pendingRow.getByRole("button", { name: label("قبول العضوية", "Accept membership"), exact: true })).toBeEnabled();
  // Distinct native fixture conditions: one organization is inactive, and its
  // shared agency owner is suspended. Both recipient-owned rows must survive.
  await db.organization.update({ where: { id: a.organization.id }, data: { active: false, revision: { increment: 1 } } });
  await db.user.update({ where: { id: f.owner.id }, data: { active: false } });
  await page.getByRole("button", { name: label("تحديث", "Refresh"), exact: true }).click();
  const unavailable = label("المؤسسة غير متاحة؛ يمكنك سحب عضويتك.", "Organization unavailable; you may withdraw your membership.");
  for (const row of [activeRow, pendingRow]) {
    await expect(row).toBeVisible(); await expect(row.getByText(unavailable, { exact: true })).toBeVisible();
    await expect(row.getByRole("link", { name: label("عرض العملاء", "View clients"), exact: true })).toHaveCount(0);
    await expect(row.getByRole("link", { name: label("إدارة المؤسسة", "Manage organization"), exact: true })).toHaveCount(0);
  }
  await expect(pendingRow.getByRole("button", { name: label("قبول العضوية", "Accept membership"), exact: true })).toBeDisabled();
  const ownUnavailable = await read(page, "/api/organizations", OrganizationDirectorySchema);
  expect(ownUnavailable.organizations).toHaveLength(2);
  for (const row of ownUnavailable.organizations) expect(row).toMatchObject({ available: false, isOwner: false, membership: { userId: f.member.id } });
  const declined = (await uiCommand(page, pendingRow.getByRole("button", { name: label("رفض العضوية", "Decline membership"), exact: true }), MemberResult)).membership;
  expect(declined).toMatchObject({ id: pending.id, state: "REVOKED", revision: pending.revision + 1 });
  await expect(pendingRow).toHaveCount(0); await expect(activeRow).toBeVisible();
  await expect(page.locator("main p[role=status]")).toHaveText(label("تم حفظ طلب العضوية.", "Membership request saved."));
  await safeViewport(page, english, info.project.name, "unavailable-recipient-membership");
  const leave = activeRow.getByRole("button", { name: label("مغادرة المؤسسة", "Leave organization"), exact: true });
  await leave.focus(); await expect(leave).toBeFocused();
  const left = (await uiCommand(page, leave, MemberResult)).membership;
  expect(left).toMatchObject({ id: a.membership.id, state: "REVOKED", revision: a.membership.revision + 1 });
  await expect(activeRow).toHaveCount(0);
  await expect(page.locator("main p[role=status]")).toHaveText(label("تم حفظ طلب العضوية.", "Membership request saved."));
  expect((await read(page, "/api/organizations", OrganizationDirectorySchema)).organizations).toEqual([]);
  expect(await db.clientGrant.findUniqueOrThrow({ where: { id: a.grant.id } })).toMatchObject({ active: false, revision: a.grant.revision + 1 });
  expect(await db.organizationClient.findUniqueOrThrow({ where: { id: a.clients[0].id } })).toMatchObject({ state: "ACTIVE", revision: a.clients[0].revision });
  // Re-enable only this fixture owner to inspect the protected-owner UI. Both
  // organizations remain unavailable and neither exposes management links.
  await db.organization.update({ where: { id: pendingOrganization.id }, data: { active: false, revision: { increment: 1 } } });
  await db.user.update({ where: { id: f.owner.id }, data: { active: true } });
  await f.login(context, f.owner); await page.goto("/brand/organizations");
  for (const id of [a.organization.id, pendingOrganization.id]) {
    const row = organizationRow(page, id); await expect(row).toBeVisible();
    await expect(row.getByText(label("المؤسسة غير متاحة. عضوية المالك محمية.", "Organization unavailable. The owner membership is protected."), { exact: true })).toBeVisible();
    for (const name of [label("رفض العضوية", "Decline membership"), label("مغادرة المؤسسة", "Leave organization")]) await expect(row.getByRole("button", { name, exact: true })).toHaveCount(0);
    for (const name of [label("عرض العملاء", "View clients"), label("إدارة المؤسسة", "Manage organization")]) await expect(row.getByRole("link", { name, exact: true })).toHaveCount(0);
  }
  const owned = await read(page, "/api/organizations", OrganizationDirectorySchema);
  expect(owned.organizations).toHaveLength(2);
  for (const row of owned.organizations) expect(row).toMatchObject({ available: false, isOwner: true, membership: { userId: f.owner.id, state: "ACTIVE" } });
  await expect(page.locator("main")).not.toContainText(privateSentinel);
});
