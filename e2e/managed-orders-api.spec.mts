import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { expect, test, type APIResponse, type BrowserContext, type Page } from "@playwright/test";
import { assertLocalTarget, taskState } from "../scripts/task-state.mjs";
import { prisma as db } from "../src/lib/prisma";
import { openSession, resolveSession } from "../src/lib/identity";
import { SESSION_COOKIE } from "../src/lib/jwt";
import type { OrganizationActor } from "../src/lib/organizations/context";
import { CampaignFieldsSchema } from "../src/lib/campaigns/contracts";
import { CampaignPlanningCommandSchema, CampaignPlanningResultSchema, CampaignOwnerReviewResultSchema,
  PlanningCampaignSchema } from "../src/lib/campaign-planning/contracts";
import { ManagedOrderCommandSchema, ManagedOrderDetailSchema, ManagedOrderListSchema, ManagedOrderResultSchema } from "../src/lib/managed/contracts";
import { campaignFields } from "../tests/campaigns/fixtures";

// Independently authored mounted HTTP/cookie acceptance on owned synthetic data.
// Exactly one mounted HTTP/cookie journey in the existing Arabic360 and English
// desktop projects. Native sessions and M03 CREATE/generate/submit/actual owner
// approval use the real E2E target and mounted routes. No auth/domain/network/
// Date mocks or spec-module imports. This does not claim a managed request UI,
// live provider, commercial signature, payment, legal or tax acceptance.
const state = taskState(), origin = "http://localhost:3100";
if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("Managed browser fixtures require the exact guarded E2E target");
const users = new Set<string>(), brands = new Set<string>(), errors = new WeakMap<Page, string[]>();
const key = () => randomUUID();
test.setTimeout(90000);
test.beforeAll(async () => {
  const rows = await db.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]!.id !== state.id || rows[0]!.kind !== "e2e" || rows[0]!.db !== state.targets.e2e || rows[0]!.host !== "127.0.0.1") throw new Error("Incorrect managed browser database identity");
});
test.beforeEach(async ({ page }) => {
  const seen: string[] = []; errors.set(page, seen);
  page.on("pageerror", error => seen.push(error.name));
  page.on("console", message => { if (message.type() === "error" && /hydrat|server.rendered|server HTML|text content.*match/i.test(message.text())) seen.push("HYDRATION_MISMATCH"); });
});
test.afterEach(async ({ page }) => {
  const workspaces = await db.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } });
  const ids = workspaces.map(row => row.id);
  if (ids.length) {
    // Only this journey's owned scopes; retained managed children precede M03.
    for (const table of ["ManagedOrderCommand", "ManagedOrderState", "ManagedOrderSubmission", "ManagedOrder",
      "ContextReferenceCommand", "ContextSubmissionReferences", "ContextReferenceState", "ContextReferenceManifest", "ContextAssetBinding",
      "PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission", "CampaignBriefProvenance", "CampaignProposalDependency",
      "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding", "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const) {
      await db.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join(ids)})`);
    }
    await db.planningWorkspace.deleteMany({ where: { id: { in: ids } } });
  }
  await db.campaign.deleteMany({ where: { brandId: { in: [...brands] } } });
  await db.brand.deleteMany({ where: { id: { in: [...brands] } } });
  await db.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
  if (users.size) await db.outboxEvent.deleteMany({ where: { OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await db.user.deleteMany({ where: { id: { in: [...users] } } }); users.clear(); brands.clear();
  expect(errors.get(page) ?? [], "Actual page errors/hydration metadata").toEqual([]);
});
test.afterAll(async () => { await db.$disconnect(); });

async function company(english: boolean, label: string) {
  const id = key(); users.add(id);
  const user = await db.user.create({ data: { id, role: "BRAND", active: true, isTest: true, language: english ? "en" : "ar",
    name: "Synthetic managed HTTP " + label, email: `managed-http-${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  const token = await openSession(id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Synthetic native managed browser session did not resolve");
  const actor: OrganizationActor = { userId: session.userId, role: session.role, sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  const brand = await db.brand.create({ data: { userId: id, slug: "managed-http-" + key().replace(/-/g, ""),
    name: "شركة اختبار Original managed HTTP " + label, countryCode: "KW", isTest: true } }); brands.add(brand.id);
  return { user, actor, token, brand, scope: { kind: "OWN_BRAND", brandId: brand.id } as const };
}
type Company = Awaited<ReturnType<typeof company>>;
async function signed(context: BrowserContext, account: Company, english: boolean) {
  expect(await resolveSession(account.token)).not.toBeNull();
  await context.addCookies([{ name: SESSION_COOKIE, value: account.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "infame_lang", value: english ? "en" : "ar", domain: "localhost", path: "/" }]);
  const current = (await context.cookies(origin)).find(cookie => cookie.name === SESSION_COOKIE);
  expect(current?.value).toBe(account.token); expect(current?.httpOnly).toBe(true);
}
function scopeQuery(account: Company) { return `scope=OWN_BRAND&brandId=${encodeURIComponent(account.brand.id)}`; }
async function wire(response: APIResponse) {
  expect(response.headers()["cache-control"]).toBe("private, no-store"); expect(response.headers()["x-request-id"]).toMatch(/^[a-f0-9-]{36}$/);
  const body = await response.json(); expect(body.requestId).toBe(response.headers()["x-request-id"]); return body;
}
async function read<T>(context: BrowserContext, url: string, schema: z.ZodType<T>) {
  const response = await context.request.get(url); expect(response.status()).toBe(200);
  const body = await wire(response); expect(Object.keys(body).sort()).toEqual(["data", "requestId"]); return schema.parse(body.data);
}
async function planningCommand(context: BrowserContext, input: unknown) {
  const response = await context.request.post("/api/planning-campaigns/commands", { headers: { Origin: origin }, data: input });
  expect(response.status()).toBe(200); return CampaignPlanningResultSchema.parse((await wire(response)).data);
}
async function current(context: BrowserContext, account: Company, campaignId: string) {
  return read(context, `/api/planning-campaigns/detail?${scopeQuery(account)}&campaignId=${encodeURIComponent(campaignId)}`, PlanningCampaignSchema);
}
async function planningStep(context: BrowserContext, account: Company, campaignId: string, action: string, payload: unknown) {
  const before = await current(context, account, campaignId);
  return planningCommand(context, CampaignPlanningCommandSchema.parse({ operationKey: key(), scope: account.scope, campaignId,
    expectedCampaignRevision: before.campaign.revision, expectedPlanningRevision: before.planning.revision,
    expectedSelectionId: before.planning.selection.id, expectedSelectionRevision: before.planning.selection.revision, action, payload }));
}
async function approvedSource(context: BrowserContext, account: Company) {
  const suffix = key().slice(0, 8), narrative = "  Unsubmitted managed HTTP narrative " + suffix + "\nنص حرفي خاص  ", proposal = "Unapproved managed HTTP proposal " + suffix;
  const fields = CampaignFieldsSchema.parse({ ...campaignFields, title: "  طلب حملة أصلي Mounted request " + suffix + "  " });
  const created = await planningCommand(context, CampaignPlanningCommandSchema.parse({ operationKey: key(), scope: account.scope, action: "CREATE",
    expectedCampaignRevision: 0, expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0,
    payload: { fields, selection: { kind: "NONE" }, narrative: null } }));
  await planningStep(context, account, created.campaignId, "SAVE_NARRATIVE", { narrative: { schemaVersion: 1, mode: "PARAGRAPH", processing: "UNPROCESSED",
    originalText: { text: narrative, language: "en" } } });
  await planningStep(context, account, created.campaignId, "PROPOSE_FIELDS", { type: "PROPOSE_FIELDS", patch: { summary: proposal }, originalText: { text: proposal, language: "en" } });
  const generated = await planningStep(context, account, created.campaignId, "GENERATE_BRIEF", {});
  const submitted = await planningStep(context, account, created.campaignId, "SUBMIT_BRIEF", { briefId: generated.briefId!, expectedBriefVersion: generated.version! });
  const response = await context.request.post("/api/planning-campaigns/reviews/commands", { headers: { Origin: origin }, data: {
    operationKey: key(), submissionId: submitted.submissionId!, expectedRevision: 1, decision: "APPROVE" } });
  expect(response.status()).toBe(200); expect(CampaignOwnerReviewResultSchema.parse((await wire(response)).data).state).toBe("APPROVED");
  const stored = await current(context, account, created.campaignId), brief = stored.briefs.find(row => row.id === generated.briefId);
  if (!brief || !brief.provenance || brief.approvedAt === null || brief.approvedByUserId !== account.user.id) throw new Error("Mounted M03 approval did not retain exact approved brief");
  expect(brief.content.approvedByUserId).toBe(account.user.id); expect(stored.campaign.currentBriefVersion).toBe(brief.version);
  const input = ManagedOrderCommandSchema.parse({ action: "SUBMIT", operationKey: key(), scope: account.scope, campaignId: created.campaignId,
    expectedCampaignRevision: stored.campaign.revision, expectedPlanningRevision: stored.planning.revision,
    expectedSelectionId: stored.planning.selection.id, expectedSelectionRevision: stored.planning.selection.revision,
    briefId: brief.id, expectedBriefVersion: brief.version, disclosureVersion: "infame-order-disclosure-v1" });
  const { provenance, ...approvedBrief } = brief;
  return { fields, campaignId: created.campaignId, narrative, proposal, approvedBrief, provenance, input };
}
async function browserWire(page: Page, path: string, method: "GET" | "POST" = "GET", body?: unknown) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, { method, credentials: "same-origin", ...(method === "POST" ? {
      headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
    return { status: response.status, cacheControl: response.headers.get("cache-control"), requestId: response.headers.get("x-request-id"), body: await response.json() };
  }, { path, method, body });
}
type BrowserWire = Awaited<ReturnType<typeof browserWire>>;
function browserData(response: BrowserWire) {
  expect(response.status).toBe(200); expect(response.cacheControl).toBe("private, no-store"); expect(response.requestId).toMatch(/^[a-f0-9-]{36}$/);
  expect(response.body.requestId).toBe(response.requestId); expect(Object.keys(response.body).sort()).toEqual(["data", "requestId"]); return response.body.data;
}
async function denied(response: APIResponse, status: number, code: string, canaries: readonly string[]) {
  expect(response.status()).toBe(status); const body = await wire(response); expect(Object.keys(body).sort()).toEqual(["error", "requestId"]);
  expect(body.error).toEqual({ code, message: code, requestId: body.requestId, retryable: status === 503 || status === 429 });
  for (const canary of canaries) expect(JSON.stringify(body)).not.toContain(canary);
}
async function effects(account: Company, orderId: string) {
  const [orders, submissions, states, commands, audits, events] = await Promise.all([
    db.managedOrder.findMany({ where: { id: orderId } }), db.managedOrderSubmission.findMany({ where: { orderId }, orderBy: { id: "asc" } }),
    db.managedOrderState.findMany({ where: { orderId } }), db.managedOrderCommand.findMany({ where: { orderId }, orderBy: { id: "asc" } }),
    db.adminAudit.findMany({ where: { actorUserId: account.user.id, action: { startsWith: "managed_order." } }, orderBy: { id: "asc" } }),
    db.outboxEvent.findMany({ where: { type: "managed_order.requested", payload: { path: ["aggregateId"], equals: orderId } }, orderBy: { id: "asc" } }),
  ]); return JSON.stringify({ orders, submissions, states, commands, audits, events });
}

test("mounted managed request APIs use actual browser cookies, freeze an approved M03 brief and preserve exact replay/privacy", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop", owner = await company(english, "owner"), outsider = await company(english, "foreign owner");
  await signed(context, owner, english); const source = await approvedSource(context, owner);
  // This accepted campaign page supplies a same-origin browser context only.
  // No managed-order screen/control exists or is asserted by this journey.
  expect((await page.goto(`/brand/campaigns/${source.campaignId}`))?.status()).toBe(200);
  expect(page.viewportSize()?.width).toBe(english ? 1440 : 360);
  await expect(page.locator("html")).toHaveAttribute("lang", english ? "en" : "ar"); await expect(page.locator("html")).toHaveAttribute("dir", english ? "ltr" : "rtl");
  await expect(page.locator("main")).toContainText(source.fields.title);
  const submitted = ManagedOrderResultSchema.parse(browserData(await browserWire(page, "/api/managed-orders/commands", "POST", source.input)));
  expect(submitted).toMatchObject({ action: "SUBMIT", campaignId: source.campaignId, briefId: source.approvedBrief.id,
    briefVersion: source.approvedBrief.version, revision: 1, submissionVersion: 1, replayed: false });
  const detailPath = `/api/managed-orders/detail?${scopeQuery(owner)}&orderId=${submitted.orderId}`;
  const detail = ManagedOrderDetailSchema.parse(browserData(await browserWire(page, detailPath)));
  expect(detail.scope).toEqual(owner.scope); expect(detail.currentAuthority).toBeNull(); expect(detail.quote).toBeNull(); expect(detail.order.status).toBe("REQUESTED");
  expect(detail.order.submission.snapshot.brief).toEqual(source.approvedBrief); expect(detail.order.submission.snapshot.provenance).toEqual(source.provenance);
  expect(detail.order.submission.snapshot.selectedContext).toBeNull(); expect(detail.order.submission.snapshot.references).toEqual({ kind: "NO_CONTEXT" });
  const listPath = `/api/managed-orders?${scopeQuery(owner)}&limit=20`, list = ManagedOrderListSchema.parse(browserData(await browserWire(page, listPath)));
  expect(list.orders.map(row => row.id)).toEqual([submitted.orderId]); expect(list.nextCursor).toBeNull();
  expect(list.orders[0]!.titleOriginal).toEqual({ text: source.fields.title, language: source.fields.originalLanguage });
  expect(Object.keys(list.orders[0]!).sort()).toEqual(["campaignId", "id", "revision", "status", "submittedAt", "titleOriginal"]);
  const canaries = [source.narrative, source.proposal, owner.token, owner.actor.sessionId, owner.user.email];
  for (const value of [submitted, detail, list]) for (const canary of canaries) expect(JSON.stringify(value)).not.toContain(canary);
  for (const field of ["conversation", "narrative", "proposals", "storageKey", "supplierCost", "retailPrice", "passwordHash", "sessionId"]) expect(JSON.stringify([submitted, detail, list])).not.toContain(`"${field}"`);
  expect(JSON.stringify(list)).not.toContain(source.fields.summary);
  const committed = await effects(owner, submitted.orderId);
  expect(ManagedOrderResultSchema.parse(browserData(await browserWire(page, "/api/managed-orders/commands", "POST", source.input)))).toEqual({ ...submitted, replayed: true });
  expect(await effects(owner, submitted.orderId)).toBe(committed);
  await denied(await context.request.post("/api/managed-orders/commands", { headers: { Origin: origin }, data: { ...source.input, operationKey: key() } }), 409, "ORDER_ALREADY_REQUESTED", canaries);
  for (const path of [listPath + "&limit=20", listPath + "&clientId=other", listPath + "&actorUserId=private", `/api/managed-orders?${scopeQuery(owner)}&limit=21`,
    detailPath + "&orderId=" + submitted.orderId, detailPath + "&limit=1"]) await denied(await context.request.get(path), 422, "VALIDATION", canaries);
  await denied(await context.request.post("/api/managed-orders/commands?actorUserId=private", { headers: { Origin: origin }, data: "{malformed" }), 422, "VALIDATION", canaries);
  await denied(await context.request.post("/api/managed-orders/commands", { headers: { Origin: "https://unrelated.example.invalid" }, data: source.input }), 403, "FORBIDDEN", canaries);
  expect(await effects(owner, submitted.orderId)).toBe(committed);
  await signed(context, outsider, english);
  for (const path of [listPath, detailPath]) await denied(await context.request.get(path), 404, "NOT_FOUND", [...canaries, source.campaignId, submitted.orderId, source.fields.title]);
  await denied(await context.request.post("/api/managed-orders/commands", { headers: { Origin: origin }, data: source.input }), 404, "NOT_FOUND", [...canaries, source.campaignId, submitted.orderId]);
  expect(await effects(owner, submitted.orderId)).toBe(committed);
  await signed(context, owner, english);
  await db.authSession.update({ where: { id: owner.actor.sessionId }, data: { revokedAt: new Date() } }); expect(await resolveSession(owner.token)).toBeNull();
  for (const path of [listPath + "&limit=20", detailPath + "&orderId=private"]) await denied(await context.request.get(path), 401, "UNAUTHENTICATED", canaries);
  await denied(await context.request.post("/api/managed-orders/commands?actorUserId=private", { headers: { Origin: origin }, data: "{malformed" }), 401, "UNAUTHENTICATED", canaries);
  expect(await effects(owner, submitted.orderId)).toBe(committed);
  expect(await db.managedOrder.count({ where: { campaignId: source.campaignId } })).toBe(1);
  expect(await db.managedOrderSubmission.count({ where: { orderId: submitted.orderId } })).toBe(1);
  expect(await db.managedOrderCommand.count({ where: { actorUserId: owner.user.id, operationKey: source.input.operationKey } })).toBe(1);
  expect(await db.outboxEvent.count({ where: { type: "managed_order.requested", payload: { path: ["aggregateId"], equals: submitted.orderId } } })).toBe(1);
});
