import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { expect, test, type APIResponse, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { assertLocalTarget, taskState } from "../scripts/task-state.mjs";
import { prisma as db } from "../src/lib/prisma";
import { openSession, resolveSession } from "../src/lib/identity";
import { SESSION_COOKIE } from "../src/lib/jwt";
import type { OrganizationActor } from "../src/lib/organizations/context";
import { createOrganization, proposeClientAssociation, authorizeClientAssociation, proposeMember, acceptMembership, setClientGrant } from "../src/lib/organizations/service";
import { getClientAuthority } from "../src/lib/organizations/loaders";
import { BrandContextContentSchema, BrandContextCommandResultSchema, type PlanningScope } from "../src/lib/brand-context/contracts";
import { CampaignFieldsSchema } from "../src/lib/campaigns/contracts";
import { CampaignPlanningCommandSchema, CampaignPlanningResultSchema, PlanningCampaignSchema, CampaignOwnerReviewResultSchema } from "../src/lib/campaign-planning/contracts";
import { ManagedOrderCommandSchema, ManagedOrderResultSchema } from "../src/lib/managed/contracts";
import { AdminCampaignsSchema } from "../src/lib/admin/contracts";
import { formatMoneyDecimal } from "../src/lib/contracts/money";
import { campaignFields } from "../tests/campaigns/fixtures";

// Two actual cookie/API/SSR journeys in existing Arabic360/English projects.
// Root alone adopts/runs. Native sessions, consent/grants, M03 draft/approval,
// managed request and legacy producers use recorded owned synthetic subjects.
// No auth/producer/network/provider/Date mock, operational grant or spec import.
// Native privacy RED is separate evidence; these verify mounted serialization.
const state = taskState(), origin = "http://localhost:3100", key = () => randomUUID();
if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("Admin managed exclusion requires exact guarded E2E target");
const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>(), errors = new WeakMap<Page, string[]>();
const all = { view: true, plan: true, approveShortlist: true, reviewContent: true, signCustomer: true, financial: true, manageGrants: true };
test.setTimeout(120000);
test.beforeAll(async () => {
  const rows = await db.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]!.id !== state.id || rows[0]!.kind !== "e2e" || rows[0]!.db !== state.targets.e2e || rows[0]!.host !== "127.0.0.1") throw new Error("Admin exclusion fixture identity mismatch");
});
test.beforeEach(async ({ page }) => {
  const seen: string[] = []; errors.set(page, seen);
  page.on("pageerror", error => seen.push(error.name));
  page.on("console", message => { if (message.type() === "error" && /hydrat|server.rendered|server HTML|text content.*match/i.test(message.text())) seen.push("HYDRATION_MISMATCH"); });
});
test.afterEach(async ({ page }) => {
  const scopes = await db.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } }), ids = scopes.map(row => row.id);
  if (ids.length) {
    for (const table of ["ManagedOrderCommand", "ManagedOrderState", "ManagedOrderSubmission", "ManagedOrder", "ContextReferenceCommand", "ContextSubmissionReferences", "ContextReferenceState", "ContextReferenceManifest", "ContextAssetBinding",
      "PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission", "CampaignBriefProvenance", "CampaignProposalDependency", "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding", "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const) {
      await db.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join(ids)})`);
    }
    await db.planningWorkspace.deleteMany({ where: { id: { in: ids } } });
  }
  await db.campaign.deleteMany({ where: { brandId: { in: [...brands] } } });
  await db.organizationCommand.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await db.clientGrant.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await db.organizationClient.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await db.organizationMembership.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await db.organization.deleteMany({ where: { id: { in: [...organizations] } } });
  await db.brand.deleteMany({ where: { id: { in: [...brands] } } });
  await db.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
  if (users.size) await db.outboxEvent.deleteMany({ where: { OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await db.user.deleteMany({ where: { id: { in: [...users] } } }); users.clear(); brands.clear(); organizations.clear();
  expect(errors.get(page) ?? [], "Mounted admin errors/hydration metadata").toEqual([]);
});
test.afterAll(async () => { await db.$disconnect(); });
function locale(info: TestInfo) { const english = info.project.name === "english-desktop"; return { english, copy: (ar: string, en: string) => english ? en : ar }; }
async function account(english: boolean, role: "BRAND" | "ADMIN" = "BRAND") {
  const id = key(); users.add(id);
  const user = await db.user.create({ data: { id, role, active: true, isTest: true, language: english ? "en" : "ar", name: "Synthetic admin exclusion " + role,
    email: `${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  const token = await openSession(id, user.sessionVersion, user.passwordHash), native = await resolveSession(token);
  if (!native) throw new Error("Actual admin exclusion fixture session did not resolve");
  const actor: OrganizationActor = { userId: native.userId, role: native.role, sessionId: native.sessionId, sessionVersion: native.sessionVersion };
  return { user, token, actor };
}
type Account = Awaited<ReturnType<typeof account>>;
async function signed(context: BrowserContext, subject: Account, english: boolean) {
  expect(await resolveSession(subject.token)).not.toBeNull();
  await context.addCookies([{ name: SESSION_COOKIE, value: subject.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "infame_lang", value: english ? "en" : "ar", domain: "localhost", path: "/" }]);
}
async function company(english: boolean) {
  const owner = await account(english), brand = await db.brand.create({ data: { userId: owner.user.id, slug: "admin-x-" + key(),
    name: "اسم أصلي Original admin legacy company", countryCode: "KW", isTest: true } }); brands.add(brand.id);
  expect(brand.slug.length).toBeLessThanOrEqual(50);
  return { ...owner, brand, scope: { kind: "OWN_BRAND", brandId: brand.id } as PlanningScope };
}
type Company = Awaited<ReturnType<typeof company>>;
async function agency(owner: Company, english: boolean, label: string) {
  const controller = await account(english), seat = await account(english);
  const { organization } = await createOrganization(controller.actor, { operationKey: key(), kind: "AGENCY", nameOriginal: "Synthetic admin exclusion agency " + label }); organizations.add(organization.id);
  const revision = async () => (await db.organization.findUniqueOrThrow({ where: { id: organization.id } })).revision;
  const proposed = await proposeClientAssociation(controller.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), brandId: owner.brand.id });
  const { client } = await authorizeClientAssociation(owner.actor, proposed.client.id, { operationKey: key(), expectedRevision: proposed.client.revision, capabilities: all });
  const pending = await proposeMember(controller.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), targetUserId: seat.user.id });
  const { membership } = await acceptMembership(seat.actor, pending.membership.id, { operationKey: key(), expectedRevision: pending.membership.revision });
  await setClientGrant(controller.actor, client.id, { operationKey: key(), expectedClientRevision: client.revision, membershipId: membership.id, expectedGrantRevision: null, capabilities: all });
  return { controller, seat, client, organization, scope: { kind: "CLIENT", clientId: client.id } as PlanningScope };
}
function scopeQuery(scope: PlanningScope) { return new URLSearchParams(scope.kind === "OWN_BRAND" ? { scope: scope.kind, brandId: scope.brandId } : { scope: scope.kind, clientId: scope.clientId }).toString(); }
async function wire(response: APIResponse) {
  expect(response.headers()["cache-control"]).toBe("private, no-store"); expect(response.headers()["x-request-id"]).toMatch(/^[a-f0-9-]{36}$/);
  const body = await response.json(); expect(body.requestId).toBe(response.headers()["x-request-id"]); return body;
}
async function read<T>(context: BrowserContext, path: string, schema: z.ZodType<T>) { const result = await context.request.get(path); expect(result.status()).toBe(200); return schema.parse((await wire(result)).data); }
async function post<T>(context: BrowserContext, path: string, body: unknown, schema: z.ZodType<T>) {
  const result = await context.request.post(path, { headers: { Origin: origin }, data: body }); expect(result.status()).toBe(200); return schema.parse((await wire(result)).data);
}
async function authority(subject: Account, scope: PlanningScope) { return scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(subject.actor, scope.clientId, "plan") } : {}; }
async function current(context: BrowserContext, scope: PlanningScope, campaignId: string) { return read(context, `/api/planning-campaigns/detail?${scopeQuery(scope)}&campaignId=${campaignId}`, PlanningCampaignSchema); }
async function step(context: BrowserContext, subject: Account, scope: PlanningScope, campaignId: string, action: string, payload: unknown) {
  const value = await current(context, scope, campaignId);
  return post(context, "/api/planning-campaigns/commands", CampaignPlanningCommandSchema.parse({ operationKey: key(), scope, ...await authority(subject, scope), campaignId,
    expectedCampaignRevision: value.campaign.revision, expectedPlanningRevision: value.planning.revision, expectedSelectionId: value.planning.selection.id,
    expectedSelectionRevision: value.planning.selection.revision, action, payload }), CampaignPlanningResultSchema);
}
async function earlierCampaign(context: BrowserContext, owner: Company) {
  const fields = CampaignFieldsSchema.parse({ ...campaignFields, title: "  عنوان أصلي Earlier workflow allowed " + key().slice(0, 8) + "  ",
    budget: { amountMinor: "2718281828459", currencyCode: "KWD" } });
  const result = await context.request.post("/api/campaigns", { headers: { Origin: origin }, data: { operationKey: key(), fields } });
  expect(result.status()).toBe(200); const body = await wire(result);
  if (typeof body.data?.campaign?.id !== "string") throw new Error("Actual earlier campaign producer omitted identity");
  const native = await db.campaign.findUniqueOrThrow({ where: { id: body.data.campaign.id } });
  expect(native.brandId).toBe(owner.brand.id); expect(await db.campaignPlanningBinding.count({ where: { campaignId: native.id } })).toBe(0);
  return { row: native, fields, expected: { id: native.id, title: fields.title, brandName: owner.brand.name, status: native.status,
    revision: native.revision, createdAt: native.createdAt.toISOString(), budget: fields.budget, budgetSource: "SAVED_INPUT" } };
}
type Legacy = Awaited<ReturnType<typeof earlierCampaign>>;
async function protectedCampaign(context: BrowserContext, owner: Company, subject: Account, scope: PlanningScope, english: boolean, label: string, request = false) {
  await signed(context, subject, english); const suffix = key().replace(/-/g, "").slice(0, 12);
  const title = "PRIVATE_M03_TITLE_" + label + "_" + suffix, summary = "PRIVATE_M03_SUMMARY_" + suffix,
    narrative = "PRIVATE_M03_NARRATIVE_" + suffix, proposal = "PRIVATE_M03_PROPOSAL_" + suffix, contextWords = "PRIVATE_M03_CONTEXT_" + suffix;
  const budget = { amountMinor: label === "OWN" ? "91827364554637281" : label === "CLIENT_A" ? "81726354453627182" : "71625344352617283", currencyCode: "KWD" };
  const draftContext = await post(context, "/api/brand-contexts/commands", { operationKey: key(), scope, ...await authority(subject, scope), action: "CREATE", expectedRevision: 0,
    payload: { nameOriginal: { text: "Private unsubmitted context " + suffix, language: "en" }, content: BrandContextContentSchema.parse({ schemaVersion: 1,
      positioning: { text: contextWords, language: "en" }, values: [], tone: { text: null, language: null }, references: [], competitors: [] }) } }, BrandContextCommandResultSchema);
  const fields = CampaignFieldsSchema.parse({ ...campaignFields, title, summary, budget });
  const made = await post(context, "/api/planning-campaigns/commands", CampaignPlanningCommandSchema.parse({ operationKey: key(), scope, ...await authority(subject, scope), action: "CREATE",
    expectedCampaignRevision: 0, expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0,
    payload: { fields, selection: { kind: "NONE" }, narrative: null } }), CampaignPlanningResultSchema);
  await step(context, subject, scope, made.campaignId, "SAVE_NARRATIVE", { narrative: { schemaVersion: 1, mode: "PARAGRAPH", processing: "UNPROCESSED", originalText: { text: narrative, language: "en" } } });
  await step(context, subject, scope, made.campaignId, "PROPOSE_FIELDS", { type: "PROPOSE_FIELDS", patch: { summary: proposal }, originalText: { text: proposal, language: "en" } });
  const generated = await step(context, subject, scope, made.campaignId, "GENERATE_BRIEF", {});
  const value = await current(context, scope, made.campaignId); const brief = value.briefs.find(row => row.id === generated.briefId);
  if (!brief || brief.approvedAt !== null) throw new Error("Actual protected unsubmitted generated brief was not produced");
  let orderId: string | null = null;
  if (request) {
    const sent = await step(context, subject, scope, made.campaignId, "SUBMIT_BRIEF", { briefId: brief.id, expectedBriefVersion: brief.version });
    await signed(context, owner, english);
    const approved = await post(context, "/api/planning-campaigns/reviews/commands", { operationKey: key(), submissionId: sent.submissionId, expectedRevision: 1, decision: "APPROVE" }, CampaignOwnerReviewResultSchema); expect(approved.state).toBe("APPROVED");
    await signed(context, subject, english); const now = await current(context, scope, made.campaignId);
    const submitted = await post(context, "/api/managed-orders/commands", ManagedOrderCommandSchema.parse({ action: "SUBMIT", operationKey: key(), scope,
      campaignId: made.campaignId, expectedCampaignRevision: now.campaign.revision, expectedPlanningRevision: now.planning.revision,
      expectedSelectionId: now.planning.selection.id, expectedSelectionRevision: now.planning.selection.revision, briefId: brief.id,
      expectedBriefVersion: brief.version, disclosureVersion: "infame-order-disclosure-v1",
      ...(scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(subject.actor, scope.clientId, "signCustomer") } : {}) }), ManagedOrderResultSchema);
    orderId = submitted.orderId;
  }
  expect(await db.campaignPlanningBinding.count({ where: { campaignId: made.campaignId } })).toBe(1);
  return { campaignId: made.campaignId, scope, contextId: draftContext.contextId, orderId,
    secrets: [made.campaignId, title, summary, narrative, proposal, contextWords, budget.amountMinor, formatMoneyDecimal(budget)] };
}
type Protected = Awaited<ReturnType<typeof protectedCampaign>>;
async function predecessor(id: string) {
  const row = await db.campaign.findFirst({ where: { id: { lt: id } }, orderBy: { id: "desc" }, select: { id: true } });
  const after = row?.id;
  const oldWindow = await db.campaign.findMany({ where: after === undefined ? {} : { id: { gt: after } }, orderBy: { id: "asc" }, take: 30, select: { id: true } });
  expect(oldWindow[0]?.id, "Actual old ascending page must contain target first").toBe(id);
  return after;
}
function pageQuery(after?: string) { return after === undefined ? "" : "?" + new URLSearchParams({ after }); }
function absent(value: string, rows: Protected[], reflectedCursor?: string) {
  // The test may supply another protected campaign ID as its predecessor.
  // Next reflects that caller-owned cursor in router state/key/after props;
  // it must still never occur as a returned campaign header identity.
  const serialized = value.replace(/\\+"/g, '"');
  for (const row of rows) {
    const escapedId = row.campaignId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(new RegExp('"id"\\s*:\\s*"' + escapedId + '"').test(serialized)).toBe(false);
    for (const secret of row.secrets) {
      if (secret === row.campaignId && secret === reflectedCursor) continue;
      expect(value.includes(secret)).toBe(false);
    }
  }
}
async function adminWindow(context: BrowserContext, after: string | undefined, rows: Protected[]) {
  const response = await context.request.get("/api/admin/campaigns" + pageQuery(after)); expect(response.status()).toBe(200);
  const body = await wire(response); expect(Object.keys(body).sort()).toEqual(["data", "requestId"]);
  const value = AdminCampaignsSchema.parse(body.data); absent(JSON.stringify(body), rows);
  const eligible = await db.campaign.findMany({ where: { ...(after === undefined ? {} : { id: { gt: after } }), planningBindings: { none: {} } }, orderBy: { id: "asc" }, take: 31, select: { id: true } });
  expect(value.campaigns.map(row => row.id)).toEqual(eligible.slice(0, 30).map(row => row.id));
  expect(value.nextCursor).toBe(eligible.length > 30 ? eligible[29]!.id : null);
  for (const row of value.campaigns) expect(Object.keys(row).sort()).toEqual(["id", "title", "brandName", "status", "revision", "createdAt", "budget", "budgetSource"].sort());
  return value;
}
async function serializedAndVisible(page: Page, context: BrowserContext, after: string | undefined, rows: Protected[], copy: (ar: string, en: string) => string, english: boolean) {
  const url = "/admin/projects" + pageQuery(after), html = await context.request.get(url);
  expect(html.status()).toBe(200); expect(html.headers()["content-type"]).toContain("text/html"); absent(await html.text(), rows, after);
  // Installed Next expects an empty RSC hash when no router/prefetch headers
  // are sent; _rsc is removed before the strict application search query.
  const rsc = await context.request.get(url + (url.includes("?") ? "&" : "?") + "_rsc=", { headers: { RSC: "1" } });
  expect(rsc.status()).toBe(200); expect(rsc.headers()["content-type"]).toContain("text/x-component");
  const streamed = await rsc.text(); expect(streamed).toContain('"scope":"ALL_STORED_RECORDS"'); expect(streamed).toContain('"errorCode":null'); absent(streamed, rows, after);
  expect((await page.goto(url))?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: copy("إدارة الحملات", "Campaigns management"), exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.locator("html")).toHaveAttribute("dir", english ? "ltr" : "rtl");
  await expect(page.locator("main")).toContainText(copy("تعرض القائمة سجلات الحملات من المسار السابق", "The list shows campaign records from the earlier workflow"));
  await expect(page.locator("main")).toContainText(copy("تتطلب طلبات إنفيم المُدارة صلاحية منفصلة.", "Managed Infame requests require separate access."));
  for (const row of rows) { await expect(page.locator(`[data-admin-campaign="${row.campaignId}"]`)).toHaveCount(0); for (const secret of row.secrets) await expect(page.locator("main")).not.toContainText(secret); }
  const current = await page.content(); absent(current, rows, after);
  const refresh = page.getByRole("button", { name: copy("تحديث البيانات", "Refresh data"), exact: true }); await refresh.focus(); await expect(refresh).toBeFocused();
  const read = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/campaigns" && response.request().method() === "GET");
  await refresh.click(); const response = await read; expect(response.status()).toBe(200); absent(JSON.stringify(await response.json()), rows);
  for (const row of rows) await expect(page.locator(`[data-admin-campaign="${row.campaignId}"]`)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
}
async function legacyVisible(page: Page, context: BrowserContext, legacy: Legacy, rows: Protected[], copy: (ar: string, en: string) => string, english: boolean) {
  const after = await predecessor(legacy.row.id), value = await adminWindow(context, after, rows);
  expect(value.campaigns.find(row => row.id === legacy.row.id)).toEqual(legacy.expected);
  await serializedAndVisible(page, context, after, rows, copy, english);
  const row = page.locator(`[data-admin-campaign="${legacy.row.id}"]`); await expect(row).toBeVisible();
  await expect(row.getByText(legacy.fields.title, { exact: true })).toHaveCount(1); await expect(row.getByText(legacy.expected.brandName, { exact: true })).toHaveCount(1);
  await expect(row.locator('[data-budget-source="SAVED_INPUT"]')).toContainText(formatMoneyDecimal(legacy.fields.budget) + " KWD");
  await expect(row.locator("time")).toHaveAttribute("datetime", legacy.expected.createdAt);
  await expect(row.getByRole("button")).toHaveCount(0); await expect(row.getByRole("link")).toHaveCount(0);
  const table = page.getByRole("table", { name: copy("قائمة الحملات المحفوظة", "Saved campaigns list"), exact: true });
  expect(await table.evaluate(element => getComputedStyle(element).borderTopLeftRadius)).toBe("18px");
}
async function noFullContent(context: BrowserContext, row: Protected) {
  const q = scopeQuery(row.scope);
  for (const path of [`/api/campaigns/${row.campaignId}`, `/api/planning-campaigns/detail?${q}&campaignId=${row.campaignId}`,
    `/api/brand-contexts/detail?${q}&contextId=${row.contextId}`, `/api/managed-orders?${q}&campaignId=${row.campaignId}`,
    ...(row.orderId ? [`/api/managed-orders/detail?${q}&orderId=${row.orderId}`] : [])]) {
    const response = await context.request.get(path); expect(response.status()).toBe(403); const body = await wire(response);
    expect(body.error.code).toBe("FORBIDDEN"); absent(JSON.stringify(body), [row]);
  }
}

test("ordinary signed ADMIN excludes actual OWN M03 unsubmitted drafts before paging and SSR serialization while retaining earlier headers", async ({ page, context }, info) => {
  const { english, copy } = locale(info), owner = await company(english), admin = await account(english, "ADMIN"); await signed(context, owner, english);
  const legacy = await earlierCampaign(context, owner), own = await protectedCampaign(context, owner, owner, owner.scope, english, "OWN"), protectedRows = [own];
  expect(await db.campaignPlanningSubmission.count({ where: { campaignId: own.campaignId } })).toBe(0);
  expect(await db.managedOrder.count({ where: { campaignId: own.campaignId } })).toBe(0);
  const after = await predecessor(own.campaignId); await signed(context, admin, english); await page.emulateMedia({ reducedMotion: "reduce" });
  await adminWindow(context, after, protectedRows); await serializedAndVisible(page, context, after, protectedRows, copy, english);
  await noFullContent(context, own); await legacyVisible(page, context, legacy, protectedRows, copy, english);
  await page.screenshot({ path: info.outputPath("admin-own-managed-exclusion.png"), fullPage: true });
});

test("same-Brand CLIENT A request and CLIENT B unsent source stay outside ordinary ADMIN API/SSR/DOM and cannot be read through full-content APIs", async ({ page, context }, info) => {
  const { english, copy } = locale(info), owner = await company(english), admin = await account(english, "ADMIN"); await signed(context, owner, english);
  const legacy = await earlierCampaign(context, owner), a = await agency(owner, english, "A"), b = await agency(owner, english, "B");
  const ca = await protectedCampaign(context, owner, a.seat, a.scope, english, "CLIENT_A", true), cb = await protectedCampaign(context, owner, b.seat, b.scope, english, "CLIENT_B"), protectedRows = [ca, cb];
  expect(ca.orderId).not.toBeNull(); expect(await db.managedOrder.count({ where: { campaignId: ca.campaignId } })).toBe(1);
  expect(await db.campaignPlanningSubmission.count({ where: { campaignId: cb.campaignId } })).toBe(0);
  const bindings = await db.campaignPlanningBinding.findMany({ where: { campaignId: { in: [ca.campaignId, cb.campaignId] } } });
  expect(new Set(bindings.map(row => row.workspaceId)).size).toBe(2); expect(new Set(bindings.map(row => row.brandId))).toEqual(new Set([owner.brand.id]));
  const cursors = await Promise.all(protectedRows.map(row => predecessor(row.campaignId))); await signed(context, admin, english); await page.emulateMedia({ reducedMotion: "reduce" });
  for (const after of cursors) { await adminWindow(context, after, protectedRows); await serializedAndVisible(page, context, after, protectedRows, copy, english); }
  for (const row of protectedRows) await noFullContent(context, row);
  await legacyVisible(page, context, legacy, protectedRows, copy, english);
  expect(await db.managedOrder.count({ where: { campaignId: ca.campaignId } })).toBe(1);
  await page.screenshot({ path: info.outputPath("admin-client-managed-exclusion.png"), fullPage: true });
});
