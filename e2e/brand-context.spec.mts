import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { expect, test, type BrowserContext, type Page, type TestInfo, type Response } from "@playwright/test";
import { assertLocalTarget, taskState, workspace } from "../scripts/task-state.mjs";
import { prisma as db } from "../src/lib/prisma";
import { openSession, resolveSession } from "../src/lib/identity";
import { SESSION_COOKIE } from "../src/lib/jwt";
import type { OrganizationActor } from "../src/lib/organizations/context";
import { createOrganization, proposeClientAssociation, authorizeClientAssociation, proposeMember, acceptMembership, setClientGrant } from "../src/lib/organizations/service";
import { getClientAuthority } from "../src/lib/organizations/loaders";
import { BrandContextContentSchema, BrandContextCommandResultSchema, BrandContextListSchema, BrandContextDetailResponseSchema,
  BrandContextVersionResponseSchema, ContextOwnerReviewsSchema, ContextOwnerReviewResponseSchema, ContextOwnerReviewResultSchema, type PlanningScope } from "../src/lib/brand-context/contracts";

// IGNORED DRAFT for e2e/brand-context.spec.mts; relative imports target that leaf.
// Exactly two initial native browser journeys across the existing AR360/ENLTR
// projects. Root alone activates/runs. No transport/auth/producer/Date mocks,
// test-module fixture imports, legal verification or live provider claims.
const state = taskState(), origin = "http://localhost:3100";
if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("Context browser fixtures require the exact guarded E2E target");
const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>(), errors = new WeakMap<Page, string[]>();
const allCaps = { view: true, plan: true, approveShortlist: true, reviewContent: true, signCustomer: true, financial: true, manageGrants: true };
const emptyContent = BrandContextContentSchema.parse({ schemaVersion: 1, positioning: { text: null, language: null }, values: [],
  tone: { text: null, language: null }, references: [], competitors: [] });
test.setTimeout(90000);
test.beforeAll(async () => {
  const rows = await db.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]!.id !== state.id || rows[0]!.kind !== "e2e" || rows[0]!.db !== state.targets.e2e || rows[0]!.host !== "127.0.0.1") throw new Error("Incorrect context browser database identity");
});
test.beforeEach(async ({ page }) => {
  const seen: string[] = []; errors.set(page, seen);
  page.on("pageerror", error => seen.push(error.name));
  page.on("console", message => { if (message.type() === "error" && /hydrat|server.rendered|server HTML|text content.*match/i.test(message.text())) seen.push("HYDRATION_MISMATCH"); });
});
test.afterEach(async ({ page }) => {
  const rows = await db.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } });
  if (rows.length) {
    const ids = rows.map(row => row.id);
    for (const table of ["PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission", "CampaignBriefProvenance", "CampaignProposalDependency",
      "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding", "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const) {
      await db.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join(ids)})`);
    }
    await db.planningWorkspace.deleteMany({ where: { id: { in: ids } } });
  }
  await db.organizationCommand.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await db.clientGrant.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await db.organizationClient.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await db.organizationMembership.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await db.organization.deleteMany({ where: { id: { in: [...organizations] } } });
  await db.brand.deleteMany({ where: { id: { in: [...brands] } } });
  await db.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
  if (users.size) await db.outboxEvent.deleteMany({ where: { OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await db.user.deleteMany({ where: { id: { in: [...users] } } }); users.clear(); brands.clear(); organizations.clear();
  expect(errors.get(page) ?? [], "Actual page errors/hydration metadata").toEqual([]);
});
test.afterAll(async () => { await db.$disconnect(); });
function locale(info: TestInfo) {
  const english = info.project.name === "english-desktop";
  return { english, copy: (ar: string, en: string) => english ? en : ar };
}
async function person(english: boolean) {
  const id = randomUUID(); users.add(id);
  const user = await db.user.create({ data: { id, role: "BRAND", active: true, isTest: true, language: english ? "en" : "ar",
    name: "Synthetic context browser actor", email: `${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  const token = await openSession(id, user.sessionVersion, user.passwordHash), current = await resolveSession(token);
  if (!current) throw new Error("Synthetic current context browser session did not resolve");
  const actor: OrganizationActor = { userId: current.userId, role: current.role, sessionId: current.sessionId, sessionVersion: current.sessionVersion };
  return { user, actor, token };
}
async function signed(context: BrowserContext, subject: Awaited<ReturnType<typeof person>>, english: boolean) {
  expect(await resolveSession(subject.token)).not.toBeNull();
  await context.addCookies([{ name: SESSION_COOKIE, value: subject.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "infame_lang", value: english ? "en" : "ar", domain: "localhost", path: "/" }]);
}
async function company(english: boolean) {
  const owner = await person(english), brand = await db.brand.create({ data: { userId: owner.user.id, slug: "context-browser-" + randomUUID().replace(/-/g, "").slice(0, 16),
    name: "شركة أصلية Synthetic company", countryCode: "KW", isTest: true } }); brands.add(brand.id);
  return { ...owner, brand, scope: { kind: "OWN_BRAND", brandId: brand.id } as const };
}
async function agency(customer: Awaited<ReturnType<typeof company>>, english: boolean, nameOriginal: string) {
  const owner = await person(english), seat = await person(english);
  const { organization } = await createOrganization(owner.actor, { operationKey: randomUUID(), kind: "AGENCY", nameOriginal }); organizations.add(organization.id);
  const revision = async () => (await db.organization.findUniqueOrThrow({ where: { id: organization.id } })).revision;
  const proposal = await proposeClientAssociation(owner.actor, organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: await revision(), brandId: customer.brand.id });
  const { client } = await authorizeClientAssociation(customer.actor, proposal.client.id, { operationKey: randomUUID(), expectedRevision: proposal.client.revision, capabilities: allCaps });
  const member = await proposeMember(owner.actor, organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: await revision(), targetUserId: seat.user.id });
  const { membership } = await acceptMembership(seat.actor, member.membership.id, { operationKey: randomUUID(), expectedRevision: member.membership.revision });
  await setClientGrant(owner.actor, client.id, { operationKey: randomUUID(), expectedClientRevision: client.revision, membershipId: membership.id, expectedGrantRevision: null, capabilities: allCaps });
  return { owner, seat, client, organization, scope: { kind: "CLIENT", clientId: client.id } as const };
}
function scopeQuery(scope: PlanningScope) { return scope.kind === "OWN_BRAND" ? `scope=OWN_BRAND&brandId=${scope.brandId}` : `scope=CLIENT&clientId=${scope.clientId}`; }
async function read<T>(context: BrowserContext, url: string, schema: z.ZodType<T>) {
  const response = await context.request.get(url); expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toBe("private, no-store");
  return schema.parse((await response.json()).data);
}
async function nativeCommand(context: BrowserContext, input: unknown) {
  const response = await context.request.post("/api/brand-contexts/commands", { headers: { Origin: origin }, data: input });
  expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toBe("private, no-store"); return BrandContextCommandResultSchema.parse((await response.json()).data);
}
async function prerequisite(context: BrowserContext, scope: PlanningScope, expectedAuthority?: Awaited<ReturnType<typeof getClientAuthority>>) {
  const made = await nativeCommand(context, { operationKey: randomUUID(), scope, ...(expectedAuthority ? { expectedAuthority } : {}), action: "CREATE", expectedRevision: 0,
    payload: { nameOriginal: { text: "Synthetic native prerequisite only", language: "en" }, content: emptyContent } });
  const source = await read(context, `/api/brand-contexts/detail?${scopeQuery(scope)}&contextId=${made.contextId}`, BrandContextDetailResponseSchema);
  expect(source.context.content).toEqual(emptyContent);
  await nativeCommand(context, { operationKey: randomUUID(), scope, ...(expectedAuthority ? { expectedAuthority } : {}), action: "SET_ARCHIVED",
    contextId: made.contextId, expectedRevision: made.revision, payload: { archived: true } });
  expect((await read(context, `/api/brand-contexts?${scopeQuery(scope)}`, BrandContextListSchema)).contexts).toEqual([]);
}
function commandResponse(response: Response, action: string, contextId?: string) {
  if (new URL(response.url()).pathname !== "/api/brand-contexts/commands" || response.request().method() !== "POST") return false;
  const body = response.request().postDataJSON(); return body.action === action && (contextId === undefined || body.contextId === contextId);
}
async function fieldLanguage(page: Page, field: "name" | "positioning" | "tone", language: string, copy: (ar: string, en: string) => string) {
  const control = page.locator(`[data-context-field="${field}"]`).getByLabel(copy("لغة النص", "Text language"), { exact: true });
  if (await control.evaluate(element => element.tagName === "SELECT")) await control.selectOption(language); else await control.fill(language);
}
async function fill(page: Page, copy: (ar: string, en: string) => string, name: string, positioning: string, tone: string) {
  await page.getByLabel(copy("اسم السياق", "Context name"), { exact: true }).fill(name); await fieldLanguage(page, "name", "ar", copy);
  await page.getByLabel(copy("التموضع", "Positioning"), { exact: true }).fill(positioning); await fieldLanguage(page, "positioning", "en", copy);
  await page.getByLabel(copy("النبرة", "Tone"), { exact: true }).fill(tone); await fieldLanguage(page, "tone", "ar", copy);
}
async function open(page: Page, contextId: string, name: string) { await page.locator(`[data-context-id="${contextId}"]`).getByRole("button", { name: name.trim(), exact: true }).click(); }
async function save(page: Page, copy: (ar: string, en: string) => string, action: "CREATE" | "UPDATE", contextId?: string) {
  const received = page.waitForResponse(response => commandResponse(response, action, contextId));
  await page.getByRole("button", { name: copy("حفظ السياق", "Save context"), exact: true }).click();
  const response = await received; expect(response.status()).toBe(200); return BrandContextCommandResultSchema.parse((await response.json()).data);
}
async function submit(page: Page, contextId: string, copy: (ar: string, en: string) => string) {
  const received = page.waitForResponse(response => commandResponse(response, "SUBMIT", contextId));
  await page.getByRole("button", { name: copy("إرسال لمراجعة المالك", "Submit for owner review"), exact: true }).click();
  const response = await received; expect(response.status()).toBe(200); return BrandContextCommandResultSchema.parse((await response.json()).data);
}
async function reviewAndApprove(page: Page, submissionId: string, positioning: string, copy: (ar: string, en: string) => string) {
  await expect(page.getByRole("heading", { name: copy("مراجعات المالك", "Owner reviews"), exact: true })).toBeVisible();
  const approval = page.getByRole("button", { name: copy("اعتماد هذه النسخة", "Approve this version"), exact: true });
  if (await approval.count()) await expect(approval).toBeDisabled();
  const loaded = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === "/api/brand-contexts/reviews/detail" && url.searchParams.get("submissionId") === submissionId; });
  await page.locator(`[data-context-submission-id="${submissionId}"]`).getByRole("button", { name: copy("مراجعة الطلب", "Review submission"), exact: true }).click();
  const detail = await loaded; expect(detail.status()).toBe(200); const snapshot = ContextOwnerReviewResponseSchema.parse((await detail.json()).data);
  expect(snapshot.review.content.positioning.text).toBe(positioning);
  const original = page.getByText(positioning, { exact: true }); await expect(original).toBeVisible(); expect(await original.evaluate(element => element.textContent)).toBe(positioning);
  await expect(approval).toBeEnabled();
  const received = page.waitForResponse(response => new URL(response.url()).pathname === "/api/brand-contexts/reviews/commands" && response.request().method() === "POST");
  await approval.click(); const response = await received; expect(response.status()).toBe(200);
  const body = response.request().postDataJSON(); expect(body).toMatchObject({ submissionId, decision: "APPROVE" });
  const result = ContextOwnerReviewResultSchema.parse((await response.json()).data);
  // A receipt confirms history; wait for the actual GET-only current decision
  // before navigation or screenshots can claim the displayed state is approved.
  await expect(page.getByText(copy("هذه النسخة معتمدة. يبقى القرار والمحتوى المقدّم محفوظين.", "This version is approved. Its decision and submitted content are retained."), { exact: true })).toBeVisible();
  await expect(page.locator(`[data-context-submission-id="${submissionId}"]`).getByText(copy("معتمد", "Approved"), { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: copy("إلغاء الانتظار", "Cancel request"), exact: true })).toHaveCount(0);
  return result;
}
async function screenshot(page: Page, info: TestInfo, stage: string) {
  mkdirSync(path.join(workspace, ".infame", "artifacts"), { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(workspace, ".infame", "artifacts", `brand-context-${stage}-${info.project.name}.png`), fullPage: true });
}

test("native OWN optional no-website context keeps original words and explicit immutable owner approval after UI edit/archive", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await company(english); await signed(context, f, english); await prerequisite(context, f.scope);
  await page.emulateMedia({ reducedMotion: "reduce" }); const ssr = await page.goto("/brand/context"); expect(ssr?.status()).toBe(200);
  // This is the first UI assertion: actual native producer/session/API and200
  // SSR already succeeded, so an inert screen is a meaningful missing-form RED.
  await expect(page.getByLabel(copy("اسم السياق", "Context name"), { exact: true })).toBeVisible();
  const name = "  سياق حر / Original context " + randomUUID().slice(0, 8) + "  ", positioning = "  تموضع أصلي\nOriginal positioning stored once.  ", tone = "  هادئ / Original calm tone  ";
  await fill(page, copy, name, positioning, tone); const saved = await save(page, copy, "CREATE");
  const current = await read(context, `/api/brand-contexts/detail?${scopeQuery(f.scope)}&contextId=${saved.contextId}`, BrandContextDetailResponseSchema);
  expect(current.context.nameOriginal).toEqual({ text: name.trim(), language: "ar" }); expect(current.context.content.positioning).toEqual({ text: positioning, language: "en" });
  expect(current.context.content.tone).toEqual({ text: tone, language: "ar" }); expect(current.context.content.references).toEqual([]);
  expect((await page.reload())?.status()).toBe(200); await open(page, saved.contextId, name);
  await expect(page.getByLabel(copy("التموضع", "Positioning"), { exact: true })).toHaveValue(positioning); await expect(page.getByLabel(copy("النبرة", "Tone"), { exact: true })).toHaveValue(tone);
  const submitted = await submit(page, saved.contextId, copy); expect(submitted.submissionId).not.toBeNull();
  expect((await page.goto("/brand/context/reviews"))?.status()).toBe(200); const approved = await reviewAndApprove(page, submitted.submissionId!, positioning, copy);
  expect(approved.state).toBe("APPROVED"); expect(approved.version).toBe(1); expect(approved.versionId).not.toBeNull();
  const immutable = await read(context, `/api/brand-contexts/version?${scopeQuery(f.scope)}&versionId=${approved.versionId}`, BrandContextVersionResponseSchema);
  expect(immutable.version.content).toEqual(current.context.content);
  expect((await page.goto("/brand/context"))?.status()).toBe(200); await open(page, saved.contextId, name);
  const changed = "  كلمات جديدة\nNew draft words leave the approved version alone.  ";
  await page.getByLabel(copy("التموضع", "Positioning"), { exact: true }).fill(changed); await save(page, copy, "UPDATE", saved.contextId);
  await page.getByRole("button", { name: copy("أرشفة السياق", "Archive context"), exact: true }).click();
  const archived = page.waitForResponse(response => commandResponse(response, "SET_ARCHIVED", saved.contextId));
  await page.getByRole("button", { name: copy("تأكيد الأرشفة", "Confirm archive"), exact: true }).click(); expect((await archived).status()).toBe(200);
  await page.getByLabel(copy("عرض المؤرشف", "Show archived"), { exact: true }).check(); await open(page, saved.contextId, name);
  const retained = page.locator(`[data-context-version-id="${approved.versionId}"]`);
  await expect(retained.getByRole("heading", { name: copy("النسخة 1", "Version 1"), exact: true })).toBeVisible();
  const oldWords = retained.getByText(positioning, { exact: true }); await expect(oldWords).toBeVisible(); expect(await oldWords.evaluate(element => element.textContent)).toBe(positioning);
  const stored = await read(context, `/api/brand-contexts/detail?${scopeQuery(f.scope)}&contextId=${saved.contextId}`, BrandContextDetailResponseSchema);
  expect(stored.context.archived).toBe(true); expect(stored.context.content.positioning.text).toBe(changed);
  expect((await read(context, `/api/brand-contexts/version?${scopeQuery(f.scope)}&versionId=${approved.versionId}`, BrandContextVersionResponseSchema)).version).toEqual(immutable.version);
  expect(await db.brandContextVersion.count({ where: { contextId: saved.contextId } })).toBe(1);
  await expect(page.locator("main input[type=file]")).toHaveCount(0); await screenshot(page, info, "own-archived-version");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("native same-Brand agency scope submits exact snapshot for actual owner without agency grant and reads approved version with current view", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await company(english), a = await agency(f, english, "Synthetic browser agency A"), b = await agency(f, english, "Synthetic browser agency B");
  expect(a.client.brandId).toBe(f.brand.id); expect(b.client.brandId).toBe(f.brand.id); expect(a.client.id).not.toBe(b.client.id);
  await signed(context, b.seat, english); const hiddenName = "B UNSUBMITTED PRIVATE CONTEXT " + randomUUID().slice(0, 8);
  const hidden = await nativeCommand(context, { operationKey: randomUUID(), scope: b.scope, expectedAuthority: await getClientAuthority(b.seat.actor, b.client.id, "plan"), action: "CREATE", expectedRevision: 0,
    payload: { nameOriginal: { text: hiddenName, language: "en" }, content: { ...emptyContent, positioning: { text: "B unsent private draft canary", language: "en" } } } });
  await signed(context, a.seat, english); await prerequisite(context, a.scope, await getClientAuthority(a.seat.actor, a.client.id, "plan"));
  await page.emulateMedia({ reducedMotion: "reduce" }); expect((await page.goto("/brand/context?clientId=" + a.client.id))?.status()).toBe(200);
  await expect(page.getByLabel(copy("اسم السياق", "Context name"), { exact: true })).toBeVisible();
  const name = "  سياق الوكالة A Original " + randomUUID().slice(0, 8) + "  ", positioning = "  صياغة A أصلية\nExact agency A submitted positioning.  ", tone = "  Agency original tone / نبرة أصلية  ";
  await fill(page, copy, name, positioning, tone); const saved = await save(page, copy, "CREATE");
  const source = await read(context, `/api/brand-contexts/detail?${scopeQuery(a.scope)}&contextId=${saved.contextId}`, BrandContextDetailResponseSchema);
  expect(source.currentAuthority).toMatchObject({ clientId: a.client.id, capability: "view" }); expect(source.context.content.positioning.text).toBe(positioning);
  await expect(page.locator("body")).not.toContainText(hiddenName); const submitted = await submit(page, saved.contextId, copy); expect(submitted.submissionId).not.toBeNull();
  await signed(context, f, english); expect(await db.organizationMembership.count({ where: { userId: f.user.id, organizationId: { in: [a.organization.id, b.organization.id] } } })).toBe(0);
  const actualInbox = await read(context, "/api/brand-contexts/reviews", ContextOwnerReviewsSchema); expect(actualInbox.reviews.map(row => row.id)).toEqual([submitted.submissionId]);
  expect(JSON.stringify(actualInbox)).not.toContain(hiddenName); expect(JSON.stringify(actualInbox)).not.toContain(hidden.contextId);
  const forbidden = await context.request.get(`/api/brand-contexts/detail?${scopeQuery(a.scope)}&contextId=${saved.contextId}`); expect(forbidden.status()).toBe(404);
  expect((await page.goto("/brand/context/reviews"))?.status()).toBe(200); await expect(page.locator("body")).not.toContainText(hiddenName); await expect(page.locator("body")).not.toContainText("B unsent private draft canary");
  const approved = await reviewAndApprove(page, submitted.submissionId!, positioning, copy); expect(approved.version).toBe(1);
  await screenshot(page, info, "owner-submitted-snapshot");
  await signed(context, a.seat, english); expect((await page.goto("/brand/context?clientId=" + a.client.id))?.status()).toBe(200); await open(page, saved.contextId, name);
  const current = await read(context, `/api/brand-contexts/version?${scopeQuery(a.scope)}&versionId=${approved.versionId}`, BrandContextVersionResponseSchema);
  expect(current.currentAuthority).toMatchObject({ clientId: a.client.id, capability: "view" }); expect(current.version.content).toEqual(source.context.content);
  const displayed = page.locator(`[data-context-version-id="${approved.versionId}"]`); await expect(displayed.getByText(positioning, { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(hiddenName); expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

// IGNORED APPEND-ONLY DRAFT for e2e/brand-context.spec.mts. Preserve its original
// two journeys and helpers unchanged. These six additional journeys use that
// leaf's genuine signed native fixtures/cleanup and API schemas; no .spec import.
// Faults below are explicitly transport delivery faults after route.fetch()
// executed the actual native producer/authorization. Root alone runs targets.

const recoveryCommandUrl = (url: URL) => url.pathname === "/api/brand-contexts/commands";
const recoveryDetailUrl = (contextId: string) => (url: URL) => url.pathname === "/api/brand-contexts/detail" && url.searchParams.get("contextId") === contextId;
const recoveryButton = (page: Page, copy: (ar: string, en: string) => string, ar: string, en: string) => page.locator("main").getByRole("button", { name: copy(ar, en), exact: true });
function recovery503(actual: import("@playwright/test").APIResponse) {
  const requestId = actual.headers()["x-request-id"];
  return { error: { code: "RETRY_REQUIRED", message: "RETRY_REQUIRED", requestId, retryable: true }, requestId };
}
async function recoveryFixture(page: Page, context: BrowserContext, info: TestInfo, options: { name?: string; positioning?: string; tone?: string | null } = {}) {
  const { english, copy } = locale(info), f = await company(english); await signed(context, f, english);
  const name = options.name ?? "PRIVATE CONTEXT RECOVERY " + randomUUID().slice(0, 8), positioning = options.positioning ?? "  كلمات خاصة أصلية\nOriginal protected context words.  ";
  const made = await nativeCommand(context, { operationKey: randomUUID(), scope: f.scope, action: "CREATE", expectedRevision: 0,
    payload: { nameOriginal: { text: name, language: "en" }, content: { ...emptyContent, positioning: { text: positioning, language: "ar" }, tone: { text: options.tone ?? null, language: null } } } });
  const actual = await read(context, `/api/brand-contexts/detail?${scopeQuery(f.scope)}&contextId=${made.contextId}`, BrandContextDetailResponseSchema);
  expect(actual.context.content.positioning.text).toBe(positioning);
  expect((await page.goto("/brand/context"))?.status()).toBe(200); await open(page, made.contextId, name);
  await expect(page.getByLabel(copy("التموضع", "Positioning"), { exact: true })).toHaveValue(positioning);
  return { f, made, name, positioning, actual, english, copy };
}
async function recoveryEdit(page: Page, copy: (ar: string, en: string) => string, words: string) {
  await page.getByLabel(copy("التموضع", "Positioning"), { exact: true }).fill(words);
  await recoveryButton(page, copy, "حفظ السياق", "Save context").click();
}
async function recoveryCommittedKey(f: Awaited<ReturnType<typeof company>>, bodies: string[], contextId: string) {
  expect(bodies.length).toBeGreaterThan(0); const command = JSON.parse(bodies[0]!);
  expect(command.operationKey).toMatch(/^[a-f0-9-]{36}$/); expect(command.contextId).toBe(contextId);
  expect(await db.brandContextCommand.count({ where: { actorUserId: f.user.id, operationKey: command.operationKey } })).toBe(1);
  return command;
}

test("post-native lost context reply retries the exact UUID/body and uses GET only after confirmed receipt", async ({ page, context }, info) => {
  const s = await recoveryFixture(page, context, info), words = "  Lost reply original words stay captured  ", bodies: string[] = [], getUrls: string[] = [];
  let deliveries = 0, faultCurrent = true;
  await page.route(recoveryCommandUrl, async route => {
    bodies.push(route.request().postData()!); const actual = await route.fetch(); expect(actual.status()).toBe(200);
    if (deliveries++ === 0) await route.abort("failed"); else await route.fulfill({ response: actual });
  });
  const retry = recoveryButton(page, s.copy, "أعد الطلب نفسه", "Retry same request");
  try {
    await recoveryEdit(page, s.copy, words); await expect(retry).toBeVisible(); await expect(retry).toBeEnabled();
    const captured = await recoveryCommittedKey(s.f, bodies, s.made.contextId);
    expect((await db.brandContext.findUniqueOrThrow({ where: { id: s.made.contextId } })).revision).toBe(s.made.revision + 1);
    await page.route(recoveryDetailUrl(s.made.contextId), async route => {
      expect(route.request().method()).toBe("GET"); getUrls.push(route.request().url()); const actual = await route.fetch(); expect(actual.status()).toBe(200);
      if (faultCurrent) { faultCurrent = false; await route.fulfill({ response: actual, status: 503, json: recovery503(actual) }); }
      else await route.fulfill({ response: actual });
    });
    await retry.click();
    const reload = recoveryButton(page, s.copy, "تحديث السياق الحالي", "Reload current context"); await expect(reload).toBeVisible(); await expect(reload).toBeEnabled();
    await expect(retry).toHaveCount(0); expect(bodies).toHaveLength(2); expect(new Set(bodies).size).toBe(1);
    await reload.click();
    await expect(page.getByLabel(s.copy("التموضع", "Positioning"), { exact: true })).toHaveValue(words);
    await expect(reload).toHaveCount(0); await expect(recoveryButton(page, s.copy, "حفظ السياق", "Save context")).toBeEnabled();
    expect(bodies).toHaveLength(2); expect(getUrls).toHaveLength(2); expect(new Set(getUrls).size).toBe(1);
    expect(JSON.parse(bodies[1]!).operationKey).toBe(captured.operationKey);
    expect(await db.brandContextCommand.count({ where: { actorUserId: s.f.user.id, operationKey: captured.operationKey } })).toBe(1);
  } finally { await page.unroute(recoveryCommandUrl); await page.unroute(recoveryDetailUrl(s.made.contextId)); }
});

test("malformed and wrong-known-context200 receipts retain the exact pending key even after a valid readonly current check", async ({ page, context }, info) => {
  const s = await recoveryFixture(page, context, info), bodies: string[] = [], words = "  Pending original body must never be reminted  ";
  const other = await nativeCommand(context, { operationKey: randomUUID(), scope: s.f.scope, action: "CREATE", expectedRevision: 0,
    payload: { nameOriginal: { text: "Other known context", language: "en" }, content: emptyContent } });
  let count = 0;
  await page.route(recoveryCommandUrl, async route => {
    bodies.push(route.request().postData()!); const actual = await route.fetch(); expect(actual.status()).toBe(200); const body = await actual.json(); count++;
    if (count === 1) await route.fulfill({ response: actual, json: { ...body, data: {} } });
    else if (count === 2) {
      const wrong = { ...body.data, contextId: other.contextId }; expect(BrandContextCommandResultSchema.safeParse(wrong).success).toBe(true);
      await route.fulfill({ response: actual, json: { ...body, data: wrong } });
    } else await route.fulfill({ response: actual });
  });
  const retry = recoveryButton(page, s.copy, "أعد الطلب نفسه", "Retry same request");
  try {
    await recoveryEdit(page, s.copy, words); await expect(retry).toBeVisible(); await expect(retry).toBeEnabled(); await recoveryCommittedKey(s.f, bodies, s.made.contextId);
    await retry.click(); await expect(retry).toBeVisible(); await expect(retry).toBeEnabled();
    const received = page.waitForResponse(response => recoveryDetailUrl(s.made.contextId)(new URL(response.url())));
    await recoveryButton(page, s.copy, "التحقق من الحالة الحالية", "Check current state").click(); expect((await received).status()).toBe(200);
    await expect(retry).toBeVisible(); await expect(retry).toBeEnabled();
    await expect(page.getByLabel(s.copy("التموضع", "Positioning"), { exact: true })).toHaveValue(words);
    await retry.click(); await expect(retry).toHaveCount(0); await expect(recoveryButton(page, s.copy, "حفظ السياق", "Save context")).toBeEnabled();
    expect(bodies).toHaveLength(3); expect(new Set(bodies).size).toBe(1);
    expect((await db.brandContext.findUniqueOrThrow({ where: { id: s.made.contextId } })).revision).toBe(s.made.revision + 1);
    expect((await db.brandContext.findUniqueOrThrow({ where: { id: other.contextId } })).revision).toBe(1);
    await recoveryCommittedKey(s.f, bodies, s.made.contextId);
  } finally { await page.unroute(recoveryCommandUrl); }
});

test("actual native session revocation401 clears private editor/cache/pending before malformed denial JSON", async ({ page, context }, info) => {
  const s = await recoveryFixture(page, context, info), bodies: string[] = [], words = "PRIVATE UNSENT EDITOR AND CAPTURE CANARY";
  await page.route(recoveryCommandUrl, async route => { bodies.push(route.request().postData()!); const actual = await route.fetch(); expect(actual.status()).toBe(200); await route.abort("failed"); });
  try {
    await recoveryEdit(page, s.copy, words);
    await expect(recoveryButton(page, s.copy, "أعد الطلب نفسه", "Retry same request")).toBeVisible();
    const captured = await recoveryCommittedKey(s.f, bodies, s.made.contextId);
    await page.unroute(recoveryCommandUrl); await db.authSession.update({ where: { id: s.f.actor.sessionId }, data: { revokedAt: new Date() } });
    expect(await resolveSession(s.f.token)).toBeNull(); const nativeCodes: string[] = [];
    await page.route(recoveryDetailUrl(s.made.contextId), async route => {
      const actual = await route.fetch(); expect(actual.status()).toBe(401); expect(actual.headers()["cache-control"]).toBe("private, no-store");
      const body = await actual.json(); expect(body.error.code).toBe("UNAUTHENTICATED"); nativeCodes.push(body.error.code);
      // Correct status-first clients need not consume denial JSON. Prove the
      // native reason before relaying this labelled malformed denial body.
      await route.fulfill({ response: actual, status: 401, contentType: "application/json", body: "{labelled_native_revoked_denial" });
    });
    await recoveryButton(page, s.copy, "التحقق من الحالة الحالية", "Check current state").click(); await expect.poll(() => nativeCodes.length).toBeGreaterThan(0);
    await expect(page.getByLabel(s.copy("اسم السياق", "Context name"), { exact: true })).toHaveCount(0);
    await expect(page.getByLabel(s.copy("التموضع", "Positioning"), { exact: true })).toHaveCount(0);
    await expect(page.locator("[data-context-id]")).toHaveCount(0); await expect(page.locator("[data-context-version-id]")).toHaveCount(0);
    for (const pair of [["أعد الطلب نفسه", "Retry same request"], ["تحديث السياق الحالي", "Reload current context"], ["حفظ السياق", "Save context"], ["إرسال لمراجعة المالك", "Submit for owner review"]]) {
      await expect(recoveryButton(page, s.copy, pair[0]!, pair[1]!)).toHaveCount(0);
    }
    for (const canary of [s.name, s.positioning, words]) await expect(page.locator("body")).not.toContainText(canary);
    expect(bodies).toHaveLength(1); expect(await db.brandContextCommand.count({ where: { actorUserId: s.f.user.id, operationKey: captured.operationKey } })).toBe(1);
  } finally { await page.unroute(recoveryCommandUrl); await page.unroute(recoveryDetailUrl(s.made.contextId)); }
});

test("current native CLIENT view-only hides or disables writes and denied other-client navigation never falls back to OWN", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await company(english), a = await agency(f, english, "Recovery agency A"), b = await agency(f, english, "Recovery agency B");
  const create = async (subject: typeof a, name: string) => {
    await signed(context, subject.seat, english);
    return nativeCommand(context, { operationKey: randomUUID(), scope: subject.scope, expectedAuthority: await getClientAuthority(subject.seat.actor, subject.client.id, "plan"),
      action: "CREATE", expectedRevision: 0, payload: { nameOriginal: { text: name, language: "en" }, content: { ...emptyContent, positioning: { text: name + " original words", language: "en" } } } });
  };
  const aName = "A CURRENT VIEW PRIVATE CONTEXT", bName = "B OTHER CLIENT PRIVATE CANARY", ownName = "SEAT OWN FALLBACK PRIVATE CANARY";
  const ca = await create(a, aName), cb = await create(b, bName); await signed(context, a.seat, english);
  // A legitimate OWN profile/context makes a mistaken fallback observable.
  const seatBrand = await db.brand.create({ data: { userId: a.seat.user.id, slug: "context-fallback-" + randomUUID().replace(/-/g, "").slice(0, 16),
    name: "Synthetic seat-owned company", countryCode: "KW", isTest: true } }); brands.add(seatBrand.id);
  await nativeCommand(context, { operationKey: randomUUID(), scope: { kind: "OWN_BRAND", brandId: seatBrand.id }, action: "CREATE", expectedRevision: 0,
    payload: { nameOriginal: { text: ownName, language: "en" }, content: emptyContent } });
  const membership = await db.organizationMembership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: a.organization.id, userId: a.seat.user.id } } });
  const grant = await db.clientGrant.findUniqueOrThrow({ where: { membershipId_clientId: { membershipId: membership.id, clientId: a.client.id } } });
  await setClientGrant(a.owner.actor, a.client.id, { operationKey: randomUUID(), expectedClientRevision: a.client.revision, membershipId: membership.id,
    expectedGrantRevision: grant.revision, capabilities: { ...allCaps, plan: false } });
  const nativeView = await read(context, `/api/brand-contexts/detail?${scopeQuery(a.scope)}&contextId=${ca.contextId}`, BrandContextDetailResponseSchema);
  expect(nativeView.currentAuthority).toMatchObject({ capability: "view", clientId: a.client.id });
  const plan = await context.request.get(`/api/organization-clients/${a.client.id}/authority?capability=plan`); expect(plan.status()).toBe(404);
  expect((await page.goto("/brand/context?clientId=" + a.client.id))?.status()).toBe(200); await open(page, ca.contextId, aName);
  await expect(page.locator("body")).toContainText(aName); await expect(page.locator("body")).not.toContainText(bName); await expect(page.locator("body")).not.toContainText(ownName);
  for (const pair of [["حفظ السياق", "Save context"], ["إرسال لمراجعة المالك", "Submit for owner review"], ["أرشفة السياق", "Archive context"]]) {
    const control = recoveryButton(page, copy, pair[0]!, pair[1]!); if (await control.count()) await expect(control).toBeDisabled(); else await expect(control).toHaveCount(0);
  }
  const denied = await context.request.get(`/api/brand-contexts/detail?${scopeQuery(b.scope)}&contextId=${cb.contextId}`); expect(denied.status()).toBe(404);
  const response = await page.goto("/brand/context?clientId=" + b.client.id); expect(response?.status()).toBe(200);
  for (const value of [aName, bName, ownName]) await expect(page.locator("body")).not.toContainText(value);
  await expect(page.locator("[data-context-id]")).toHaveCount(0); await expect(page.getByLabel(copy("اسم السياق", "Context name"), { exact: true })).toHaveCount(0);
  expect((await db.brandContext.findUniqueOrThrow({ where: { id: ca.contextId } })).revision).toBe(1);
});

test("dirty readonly refresh and real language/context switches retain words until explicit keep/discard and preserve null versus blank", async ({ page, context }, info) => {
  const s = await recoveryFixture(page, context, info), dirty = "  UNSAVED ORIGINAL WORDS\nكلمات غير محفوظة  ", bName = "Second context for explicit discard";
  const b = await nativeCommand(context, { operationKey: randomUUID(), scope: s.f.scope, action: "CREATE", expectedRevision: 0,
    payload: { nameOriginal: { text: bName, language: "en" }, content: { ...emptyContent, positioning: { text: "B original words", language: "en" } } } });
  // Reload before typing only to establish the real second row in the view.
  expect((await page.reload())?.status()).toBe(200); await open(page, s.made.contextId, s.name);
  await page.getByLabel(s.copy("التموضع", "Positioning"), { exact: true }).fill(dirty);
  const refreshed = page.waitForResponse(response => recoveryDetailUrl(s.made.contextId)(new URL(response.url())));
  await recoveryButton(page, s.copy, "تحديث العرض الحالي", "Refresh current view").click(); expect((await refreshed).status()).toBe(200);
  await expect(page.getByLabel(s.copy("التموضع", "Positioning"), { exact: true })).toHaveValue(dirty);
  const languageReply = page.waitForResponse(response => new URL(response.url()).pathname === "/api/me/language" && response.request().method() === "PATCH");
  await page.getByRole("button", { name: s.english ? "Switch to Arabic" : "التبديل إلى الإنجليزية", exact: true }).click(); expect((await languageReply).status()).toBe(200);
  const copy = (ar: string, en: string) => s.english ? ar : en;
  await expect(page.getByLabel(copy("التموضع", "Positioning"), { exact: true })).toHaveValue(dirty);
  expect((await db.brandContext.findUniqueOrThrow({ where: { id: s.made.contextId } })).revision).toBe(1);
  const opener = page.locator(`[data-context-id="${b.contextId}"]`).getByRole("button", { name: bName, exact: true });
  await opener.click(); await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: copy("متابعة التحرير", "Keep editing"), exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0); await expect(page.getByLabel(copy("التموضع", "Positioning"), { exact: true })).toHaveValue(dirty);
  const heading = page.getByRole("heading", { name: copy("سياق العلامة التجارية", "Brand context"), exact: true });
  expect(await opener.evaluate(element => element === document.activeElement) || await heading.evaluate(element => element === document.activeElement)).toBe(true);
  await opener.click(); await page.getByRole("dialog").getByRole("button", { name: copy("تجاهل التغييرات", "Discard changes"), exact: true }).click();
  await expect(page.getByLabel(copy("التموضع", "Positioning"), { exact: true })).toHaveValue("B original words");
  await expect(page.getByRole("heading", { name: copy("تعديل السياق", "Edit context"), exact: true })).toBeFocused();
  const tone = page.getByLabel(copy("النبرة", "Tone"), { exact: true }); await expect(tone).toHaveValue("");
  await page.getByLabel(copy("التموضع", "Positioning"), { exact: true }).fill("B material edit preserves untouched null tone");
  const untouched = await save(page, copy, "UPDATE", b.contextId);
  expect((await read(context, `/api/brand-contexts/detail?${scopeQuery(s.f.scope)}&contextId=${b.contextId}`, BrandContextDetailResponseSchema)).context.content.tone.text).toBeNull();
  await tone.fill("   "); const blank = await save(page, copy, "UPDATE", b.contextId);
  expect(blank.revision).toBe(untouched.revision + 1);
  expect((await read(context, `/api/brand-contexts/detail?${scopeQuery(s.f.scope)}&contextId=${b.contextId}`, BrandContextDetailResponseSchema)).context.content.tone.text).toBe("   ");
  expect((await db.brandContext.findUniqueOrThrow({ where: { id: s.made.contextId } })).content).toEqual(s.actual.context.content);
});

test("200-character names and original text fit360px with reduced motion and keyboard cancel resumes the exact native GET", async ({ page, context }, info) => {
  await page.setViewportSize({ width: 360, height: 900 }); await page.emulateMedia({ reducedMotion: "reduce" });
  const longName = "اسم طويل LONG_" + "W".repeat(200 - "اسم طويل LONG_".length), longText = "  نص أصلي OriginalText_" + "كلمة_".repeat(800) + "  ";
  expect(longName).toHaveLength(200); expect(longText.length).toBeLessThanOrEqual(5000);
  const s = await recoveryFixture(page, context, info, { name: longName, positioning: longText });
  const submitted = await nativeCommand(context, { operationKey: randomUUID(), scope: s.f.scope, action: "SUBMIT", contextId: s.made.contextId, expectedRevision: s.made.revision, payload: {} });
  const approvedResponse = await context.request.post("/api/brand-contexts/reviews/commands", { headers: { Origin: origin }, data: { operationKey: randomUUID(), submissionId: submitted.submissionId, expectedRevision: 1, decision: "APPROVE" } });
  expect(approvedResponse.status()).toBe(200); const approved = ContextOwnerReviewResultSchema.parse((await approvedResponse.json()).data);
  expect((await page.reload())?.status()).toBe(200); await open(page, s.made.contextId, longName);
  const version = page.locator(`[data-context-version-id="${approved.versionId}"]`), original = version.getByText(longText, { exact: true });
  await expect(original).toBeVisible(); expect(await original.evaluate(element => element.textContent)).toBe(longText);
  for (const element of [page.locator(`[data-context-id="${s.made.contextId}"]`).getByRole("button", { name: longName, exact: true }), original]) {
    const geometry = await element.evaluate(node => { const range = document.createRange(); range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
      return { count: rects.length, inside: rects.every(rect => rect.left >= 0 && rect.right <= innerWidth) }; });
    expect(geometry.count).toBeGreaterThan(1); expect(geometry.inside).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  const urls: string[] = []; let first = true, started = false, cancelled = false, ready!: () => void, release!: () => void, finished!: () => void;
  const nativeReady = new Promise<void>(resolve => { ready = resolve; }), gate = new Promise<void>(resolve => { release = resolve; }), done = new Promise<void>(resolve => { finished = resolve; });
  await page.route(recoveryDetailUrl(s.made.contextId), async route => {
    urls.push(route.request().url()); expect(route.request().method()).toBe("GET");
    const hold = first; first = false; // Claim the held delivery before async fetch.
    if (hold) started = true;
    try {
      const actual = await route.fetch(); expect(actual.status()).toBe(200);
      if (!hold) { await route.fulfill({ response: actual }); return; }
      ready(); await gate;
      try { await route.fulfill({ response: actual }); }
      catch (error) { if (!cancelled || !(error instanceof Error) || !/handled|interception|closed|cancel|abort/i.test(error.message)) throw error; }
    } finally { if (hold) finished(); }
  });
  try {
    const refresh = recoveryButton(page, s.copy, "تحديث العرض الحالي", "Refresh current view"); await refresh.focus(); await expect(refresh).toBeFocused(); await page.keyboard.press("Enter"); await nativeReady;
    const cancel = recoveryButton(page, s.copy, "إلغاء الانتظار", "Cancel request"); await expect(cancel).toBeVisible(); await cancel.focus(); cancelled = true; await page.keyboard.press("Enter");
    const retry = recoveryButton(page, s.copy, "إعادة القراءة", "Retry read"); await expect(retry).toBeVisible(); await expect(retry).toBeEnabled();
    await expect(page.getByLabel(s.copy("التموضع", "Positioning"), { exact: true })).toHaveValue(longText);
    await expect.poll(() => page.evaluate(() => document.activeElement !== document.body && document.querySelector("main")?.contains(document.activeElement))).toBe(true);
    await retry.focus(); await expect(retry).toBeFocused(); await page.keyboard.press("Enter");
    await expect(retry).toHaveCount(0); await expect(refresh).toBeEnabled(); expect(urls).toHaveLength(2); expect(new Set(urls).size).toBe(1);
    release(); await done; await expect(page.getByLabel(s.copy("التموضع", "Positioning"), { exact: true })).toHaveValue(longText);
    expect(await db.brandContextCommand.count({ where: { contextId: s.made.contextId } })).toBe(2); expect(await db.brandContextVersion.count({ where: { contextId: s.made.contextId } })).toBe(1);
    await screenshot(page, info, "recovery-360-long-keyboard-cancel");
  } finally { release(); if (started) await done; await page.unroute(recoveryDetailUrl(s.made.contextId)); }
});

// IGNORED APPEND-ONLY DRAFT for e2e/brand-context.spec.mts after its eight frozen
// journeys. Uses existing genuine fixture/cleanup helpers, never .spec imports.
// Three independently source-established liveness groups. Root alone executes;
// no producer/session/Date mock or product mutation. The first group's labelled
// invalid wire is sent to the real native parser; its actual422 is relayed intact.

test("definite native validation422 releases editor and owner-decision captures only after current GET plus explicit review", async ({ page, context }, info) => {
  const s = await recoveryFixture(page, context, info), words = "  Entered words survive definite native rejection  ", bodies: string[] = [], codes: string[] = [];
  await page.route(recoveryCommandUrl, async route => {
    const original = route.request().postData()!; bodies.push(original);
    const actual = await route.fetch({ postData: JSON.stringify({ ...JSON.parse(original), labelledUnsupportedWireField: true }) });
    expect(actual.status()).toBe(422); const body = await actual.json(); expect(body.error.code).toBe("VALIDATION"); codes.push(body.error.code);
    await route.fulfill({ response: actual });
  });
  const release = recoveryButton(page, s.copy, "راجعت الحالة؛ احتفظ بكلماتي", "I reviewed current state; keep my words");
  try {
    await recoveryEdit(page, s.copy, words); await expect.poll(() => codes.length).toBe(1);
    const rejected = JSON.parse(bodies[0]!); expect(rejected.operationKey).toMatch(/^[a-f0-9-]{36}$/);
    expect(await db.brandContextCommand.count({ where: { actorUserId: s.f.user.id, operationKey: rejected.operationKey } })).toBe(0);
    expect((await db.brandContext.findUniqueOrThrow({ where: { id: s.made.contextId } })).revision).toBe(s.made.revision);
    await expect(release).toHaveCount(0);
    const loaded = page.waitForResponse(response => recoveryDetailUrl(s.made.contextId)(new URL(response.url())));
    await recoveryButton(page, s.copy, "التحقق من الحالة الحالية", "Check current state").click(); expect((await loaded).status()).toBe(200);
    await expect(release).toBeVisible(); await expect(release).toBeEnabled();
    await expect(page.getByLabel(s.copy("التموضع", "Positioning"), { exact: true })).toHaveValue(words); expect(bodies).toHaveLength(1);
    await expect(recoveryButton(page, s.copy, "أعد الطلب نفسه", "Retry same request")).toHaveCount(0);
    await release.click(); await expect(recoveryButton(page, s.copy, "حفظ السياق", "Save context")).toBeEnabled();
    await expect(page.getByLabel(s.copy("التموضع", "Positioning"), { exact: true })).toHaveValue(words);
  } finally { await page.unroute(recoveryCommandUrl); }
  const saved = await save(page, s.copy, "UPDATE", s.made.contextId);
  expect(saved.revision).toBe(s.made.revision + 1);
  const submitted = await nativeCommand(context, { operationKey: randomUUID(), scope: s.f.scope, contextId: s.made.contextId, expectedRevision: saved.revision, action: "SUBMIT", payload: {} });
  expect((await page.goto("/brand/context/reviews"))?.status()).toBe(200);
  await page.locator(`[data-context-submission-id="${submitted.submissionId}"]`).getByRole("button", { name: s.copy("مراجعة الطلب", "Review submission"), exact: true }).click();
  const approve = recoveryButton(page, s.copy, "اعتماد هذه النسخة", "Approve this version"); await expect(approve).toBeEnabled();
  const reviewUrl = (url: URL) => url.pathname === "/api/brand-contexts/reviews/commands", decisions: string[] = [], reviewCodes: string[] = [];
  await page.route(reviewUrl, async route => {
    const original = route.request().postData()!; decisions.push(original);
    const actual = await route.fetch({ postData: JSON.stringify({ ...JSON.parse(original), labelledUnsupportedWireField: true }) });
    expect(actual.status()).toBe(422); const body = await actual.json(); expect(body.error.code).toBe("VALIDATION"); reviewCodes.push(body.error.code);
    await route.fulfill({ response: actual });
  });
  try {
    await approve.click(); await expect.poll(() => reviewCodes.length).toBe(1); const rejected = JSON.parse(decisions[0]!);
    expect(await db.planningReviewCommand.count({ where: { actorUserId: s.f.user.id, operationKey: rejected.operationKey } })).toBe(0);
    expect((await db.brandContextSubmission.findUniqueOrThrow({ where: { id: submitted.submissionId! } })).state).toBe("PENDING");
    await expect(release).toHaveCount(0);
    const loaded = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === "/api/brand-contexts/reviews/detail" && url.searchParams.get("submissionId") === submitted.submissionId; });
    await recoveryButton(page, s.copy, "التحقق من الحالة الحالية", "Check current state").click(); expect((await loaded).status()).toBe(200);
    await expect(release).toBeVisible(); await expect(release).toBeEnabled(); expect(decisions).toHaveLength(1);
    await expect(page.getByText(words, { exact: true })).toBeVisible(); await release.click(); await expect(approve).toBeEnabled();
  } finally { await page.unroute(reviewUrl); }
  const received = page.waitForResponse(response => reviewUrl(new URL(response.url())) && response.request().method() === "POST");
  await approve.click(); const approved = await received; expect(approved.status()).toBe(200);
  expect(approved.request().postDataJSON().operationKey).not.toBe(JSON.parse(decisions[0]!).operationKey);
  expect(ContextOwnerReviewResultSchema.parse((await approved.json()).data).state).toBe("APPROVED");
});

test("normal CLIENT refresh renews native plan revisions and restored rights without remounting or changing an uncertain command", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await company(english), a = await agency(f, english, "Native liveness agency"); await signed(context, a.seat, english);
  const initialPlan = await getClientAuthority(a.seat.actor, a.client.id, "plan"), name = "Native authority liveness context";
  const made = await nativeCommand(context, { operationKey: randomUUID(), scope: a.scope, expectedAuthority: initialPlan, action: "CREATE", expectedRevision: 0,
    payload: { nameOriginal: { text: name, language: "en" }, content: { ...emptyContent, positioning: { text: "Original authority words", language: "en" } } } });
  expect((await page.goto("/brand/context?clientId=" + a.client.id))?.status()).toBe(200); await open(page, made.contextId, name);
  await expect(page.getByLabel(copy("التموضع", "Positioning"), { exact: true })).toHaveValue("Original authority words");
  const membership = await db.organizationMembership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: a.organization.id, userId: a.seat.user.id } } });
  const grant = await db.clientGrant.findUniqueOrThrow({ where: { membershipId_clientId: { membershipId: membership.id, clientId: a.client.id } } });
  const setRights = async (capabilities: typeof allCaps) => {
    const currentGrant = await db.clientGrant.findUniqueOrThrow({ where: { id: grant.id } }), currentClient = await db.organizationClient.findUniqueOrThrow({ where: { id: a.client.id } });
    return setClientGrant(a.owner.actor, a.client.id, { operationKey: randomUUID(), expectedClientRevision: currentClient.revision, membershipId: membership.id,
      expectedGrantRevision: currentGrant.revision, capabilities });
  };
  await setRights({ ...allCaps, reviewContent: false }); const changedPlan = await getClientAuthority(a.seat.actor, a.client.id, "plan");
  expect(changedPlan.grantRevision).toBeGreaterThan(initialPlan.grantRevision);
  const order: string[] = [];
  const observe = (request: import("@playwright/test").Request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === `/api/organization-clients/${a.client.id}/authority` && url.searchParams.get("capability") === "plan") order.push("plan");
    if (request.method() === "GET" && (url.pathname === "/api/brand-contexts" || recoveryDetailUrl(made.contextId)(url))) order.push("view");
  };
  page.on("request", observe);
  const refresh = recoveryButton(page, copy, "تحديث العرض الحالي", "Refresh current view"), saveButton = recoveryButton(page, copy, "حفظ السياق", "Save context");
  try {
    const loaded = page.waitForResponse(response => recoveryDetailUrl(made.contextId)(new URL(response.url()))); await refresh.click(); expect((await loaded).status()).toBe(200);
    await expect(saveButton).toBeEnabled(); expect(order[0]).toBe("plan"); expect(order).toContain("view");
    const bodies: string[] = []; let count = 0;
    await page.route(recoveryCommandUrl, async route => { bodies.push(route.request().postData()!); const actual = await route.fetch(); expect(actual.status()).toBe(200);
      if (count++ === 0) await route.abort("failed"); else await route.fulfill({ response: actual }); });
    try {
      await recoveryEdit(page, copy, "Updated under newly renewed current plan");
      const retry = recoveryButton(page, copy, "أعد الطلب نفسه", "Retry same request"); await expect(retry).toBeVisible(); await expect(retry).toBeEnabled();
      const captured = JSON.parse(bodies[0]!); expect(captured.expectedAuthority).toEqual(changedPlan);
      await setRights(allCaps); const newestPlan = await getClientAuthority(a.seat.actor, a.client.id, "plan"); expect(newestPlan.grantRevision).toBeGreaterThan(changedPlan.grantRevision);
      order.length = 0; const current = page.waitForResponse(response => recoveryDetailUrl(made.contextId)(new URL(response.url())));
      await recoveryButton(page, copy, "التحقق من الحالة الحالية", "Check current state").click(); expect((await current).status()).toBe(200); await expect(retry).toBeEnabled();
      expect(order[0]).toBe("plan"); expect(bodies).toHaveLength(1);
      await retry.click(); await expect(retry).toHaveCount(0); await expect(saveButton).toBeEnabled();
      expect(bodies).toHaveLength(2); expect(new Set(bodies).size).toBe(1); expect(JSON.parse(bodies[1]!).expectedAuthority).toEqual(changedPlan);
      expect(await db.brandContextCommand.count({ where: { actorUserId: a.seat.user.id, operationKey: captured.operationKey } })).toBe(1);
    } finally { await page.unroute(recoveryCommandUrl); }
    await setRights({ ...allCaps, plan: false }); const readOnly = page.waitForResponse(response => recoveryDetailUrl(made.contextId)(new URL(response.url())));
    await refresh.click(); expect((await readOnly).status()).toBe(200);
    await expect.poll(async () => await saveButton.count() === 0 || await saveButton.isDisabled()).toBe(true);
    await setRights(allCaps); const restored = await getClientAuthority(a.seat.actor, a.client.id, "plan");
    const current = page.waitForResponse(response => recoveryDetailUrl(made.contextId)(new URL(response.url()))); await refresh.click(); expect((await current).status()).toBe(200); await expect(saveButton).toBeEnabled();
    const received = page.waitForResponse(response => commandResponse(response, "UPDATE", made.contextId));
    await recoveryEdit(page, copy, "Fresh write after actual plan withdrawal and restore"); const actual = await received; expect(actual.status()).toBe(200);
    expect(actual.request().postDataJSON().expectedAuthority).toEqual(restored);
  } finally { page.off("request", observe); }
});

test("genuine newer same-input SUBMIT followed by unchanged UPDATE accepts valid receipt independent of editor JSON key order", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await company(english); await signed(context, f, english); await prerequisite(context, f.scope);
  expect((await page.goto("/brand/context"))?.status()).toBe(200);
  const name = "Canonical unchanged payload liveness", positioning = "Original same-input words", tone = "Original unchanged tone";
  await fill(page, copy, name, positioning, tone);
  let createdId = "", submittedRevision = 0; const captured: unknown[] = [];
  await page.route(recoveryCommandUrl, async route => {
    const input = route.request().postDataJSON(); captured.push(input);
    const actual = await route.fetch(); expect(actual.status()).toBe(200); const receipt = BrandContextCommandResultSchema.parse((await actual.json()).data);
    if (input.action === "CREATE") {
      createdId = receipt.contextId;
      // A genuine other-tab/native command advances only parent revision
      // before the browser receives its legitimate older CREATE receipt.
      const submitted = await nativeCommand(context, { operationKey: randomUUID(), scope: f.scope, contextId: createdId,
        expectedRevision: receipt.revision, action: "SUBMIT", payload: {} });
      expect(submitted.inputRevision).toBe(receipt.inputRevision); submittedRevision = submitted.revision;
    } else if (input.action === "UPDATE") {
      expect(input.expectedRevision).toBe(submittedRevision); expect(receipt.revision).toBe(submittedRevision + 1); expect(receipt.inputRevision).toBe(1);
    }
    await route.fulfill({ response: actual }); // Every delivered reply is actual native output.
  });
  try {
    await save(page, copy, "CREATE");
    const rebase = recoveryButton(page, copy, "احتفظ بكلماتي واستخدم المراجعة الحالية", "Keep my words and use the current revision");
    await expect(rebase).toBeVisible(); await expect(rebase).toBeEnabled(); await rebase.click();
    await expect(page.getByLabel(copy("التموضع", "Positioning"), { exact: true })).toHaveValue(positioning);
    const stored = await read(context, `/api/brand-contexts/detail?${scopeQuery(f.scope)}&contextId=${createdId}`, BrandContextDetailResponseSchema);
    expect(stored.context.revision).toBe(submittedRevision); expect(stored.context.inputRevision).toBe(1);
    const received = page.waitForResponse(response => commandResponse(response, "UPDATE", createdId));
    await recoveryButton(page, copy, "حفظ السياق", "Save context").click(); const actual = await received; expect(actual.status()).toBe(200);
    const input = actual.request().postDataJSON(); expect(BrandContextContentSchema.parse(input.payload.content)).toEqual(stored.context.content);
    const result = BrandContextCommandResultSchema.parse((await actual.json()).data); expect(result.inputRevision).toBe(1);
    await expect(recoveryButton(page, copy, "أعد الطلب نفسه", "Retry same request")).toHaveCount(0);
    await expect(recoveryButton(page, copy, "تحديث السياق الحالي", "Reload current context")).toHaveCount(0);
    await expect(recoveryButton(page, copy, "حفظ السياق", "Save context")).toBeEnabled(); expect(captured).toHaveLength(2);
    expect((await db.brandContext.findUniqueOrThrow({ where: { id: createdId } })).inputRevision).toBe(1);
  } finally { await page.unroute(recoveryCommandUrl); }
});
