// Exactly two journeys in the existing Arabic360/English projects. Root alone
// adopts/runs. Genuine disposable cookies/M03/count records; delivery/body seams
// below test recovery, never live downtime, revenue or operational acceptance.
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { expect, test, type BrowserContext, type Page, type TestInfo, type APIResponse } from "@playwright/test";
import { assertLocalTarget, taskState } from "../scripts/task-state.mjs";
import { prisma as db } from "../src/lib/prisma";
import { openSession, resolveSession } from "../src/lib/identity";
import { SESSION_COOKIE } from "../src/lib/jwt";
import type { OrganizationActor } from "../src/lib/organizations/context";
import type { PlanningScope } from "../src/lib/brand-context/contracts";
import { createOrganization, proposeClientAssociation, authorizeClientAssociation, proposeMember, acceptMembership, setClientGrant } from "../src/lib/organizations/service";
import { getClientAuthority } from "../src/lib/organizations/loaders";
import { executeCampaignPlanningCommand, getPlanningCampaign, decideCampaignOwnerReview } from "../src/lib/campaign-planning/service";
import { submitManagedOrder } from "../src/lib/managed/orders";
import { AdminAnalyticsSchema, AdminAnalyticsUnavailableMetrics, type AdminAnalyticsDTO } from "../src/lib/admin/analytics-contracts";
import { CampaignStatusSchema, type CampaignStatus } from "../src/lib/contracts/vocabulary";
import { campaignFields } from "../tests/campaigns/fixtures";

const state = taskState(), key = () => randomUUID();
if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("Analytics browser witnesses require exact guarded E2E target");
const users = new Set<string>(), brands = new Set<string>(), creators = new Set<string>(), organizations = new Set<string>(), campaigns = new Set<string>(), projects = new Set<string>();
const errors = new WeakMap<Page, string[]>(), endpoint = "**/api/admin/analytics";
const caps = { view: true, plan: true, approveShortlist: true, reviewContent: true, signCustomer: true, financial: true, manageGrants: true };
test.use({ trace: "off" }); // Authenticated fixture cookies are not retained in traces.
test.setTimeout(120000);
test.beforeAll(async () => {
  const rows = await db.$queryRawUnsafe<Array<{ id: string; kind: string; db: string; host: string }>>(
    "SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable");
  if (rows.length !== 1 || rows[0]?.id !== state.id || rows[0]?.kind !== "e2e" || rows[0]?.db !== state.targets.e2e || rows[0]?.host !== "127.0.0.1") throw new Error("Analytics browser target identity mismatch");
});
test.beforeEach(async ({ page }) => {
  const seen: string[] = []; errors.set(page, seen);
  page.on("pageerror", error => seen.push(error.name));
  page.on("console", message => { if (message.type() === "error" && /hydrat|server.rendered|server HTML|text content.*match/i.test(message.text())) seen.push("HYDRATION_MISMATCH"); });
});
test.afterEach(async ({ page }) => {
  await db.project.deleteMany({ where: { id: { in: [...projects] } } });
  await db.deal.deleteMany({ where: { campaignId: { in: [...campaigns] } } });
  const workspaces = await db.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } });
  if (workspaces.length) {
    const ids = workspaces.map(row => row.id);
    for (const table of ["ManagedOrderCommand", "ManagedOrderState", "ManagedOrderSubmission", "ManagedOrder", "ContextReferenceCommand", "ContextSubmissionReferences", "ContextReferenceState", "ContextReferenceManifest", "ContextAssetBinding",
      "PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission", "CampaignBriefProvenance", "CampaignProposalDependency", "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding", "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const) {
      await db.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join(ids)})`);
    }
    await db.planningWorkspace.deleteMany({ where: { id: { in: ids } } });
  }
  await db.campaign.deleteMany({ where: { id: { in: [...campaigns] } } });
  await db.creator.deleteMany({ where: { id: { in: [...creators] } } });
  await db.organizationCommand.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await db.clientGrant.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await db.organizationClient.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await db.organizationMembership.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await db.organization.deleteMany({ where: { id: { in: [...organizations] } } });
  await db.brand.deleteMany({ where: { id: { in: [...brands] } } });
  await db.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
  if (users.size) await db.outboxEvent.deleteMany({ where: { OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await db.user.deleteMany({ where: { id: { in: [...users] } } });
  for (const owned of [users, brands, creators, organizations, campaigns, projects]) owned.clear();
  expect(errors.get(page) ?? [], "Page/hydration errors").toEqual([]);
});
test.afterAll(async () => { await db.$disconnect(); });
function locale(info: TestInfo) { const english = info.project.name === "english-desktop"; return { english, copy: (ar: string, en: string) => english ? en : ar }; }
async function person(english: boolean, role: "ADMIN" | "BRAND" | "CREATOR" = "BRAND") {
  const id = key(); users.add(id);
  const user = await db.user.create({ data: { id, role, active: true, isTest: true, language: english ? "en" : "ar", name: "Synthetic analytics browser actor",
    email: id + "@example.invalid", passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  const token = await openSession(id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Synthetic analytics native session did not resolve");
  const actor: OrganizationActor = { userId: session.userId, role: session.role, sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  return { user, token, actor };
}
type Account = Awaited<ReturnType<typeof person>>;
async function signed(context: BrowserContext, account: Account, english: boolean) {
  expect(await resolveSession(account.token)).not.toBeNull();
  await context.addCookies([{ name: SESSION_COOKIE, value: account.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "infame_lang", value: english ? "en" : "ar", domain: "localhost", path: "/" }]);
}
async function company(english: boolean, canary: string) {
  const owner = await person(english), brand = await db.brand.create({ data: { userId: owner.user.id, slug: "analytics-" + key(), name: canary + "_BRAND", countryCode: "KW", state: "PRIVATE", isTest: true } });
  brands.add(brand.id); return { ...owner, brand, scope: { kind: "OWN_BRAND", brandId: brand.id } as PlanningScope };
}
type Company = Awaited<ReturnType<typeof company>>;
async function agency(customer: Company, english: boolean) {
  const owner = await person(english), seat = await person(english);
  const { organization } = await createOrganization(owner.actor, { operationKey: key(), kind: "AGENCY", nameOriginal: "Synthetic analytics agency" }); organizations.add(organization.id);
  const revision = async () => (await db.organization.findUniqueOrThrow({ where: { id: organization.id } })).revision;
  const proposal = await proposeClientAssociation(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), brandId: customer.brand.id });
  const { client } = await authorizeClientAssociation(customer.actor, proposal.client.id, { operationKey: key(), expectedRevision: proposal.client.revision, capabilities: caps });
  const invited = await proposeMember(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), targetUserId: seat.user.id });
  const { membership } = await acceptMembership(seat.actor, invited.membership.id, { operationKey: key(), expectedRevision: invited.membership.revision });
  await setClientGrant(owner.actor, client.id, { operationKey: key(), expectedClientRevision: client.revision, membershipId: membership.id, expectedGrantRevision: null, capabilities: caps });
  return { seat, scope: { kind: "CLIENT", clientId: client.id } as PlanningScope };
}
async function authority(account: Account, scope: PlanningScope) { return scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(account.actor, scope.clientId, "plan") } : {}; }
async function planned(account: Account, scope: PlanningScope, canary: string) {
  const made = await executeCampaignPlanningCommand(account.actor, { operationKey: key(), scope, ...await authority(account, scope), action: "CREATE",
    expectedCampaignRevision: 0, expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0,
    payload: { fields: { ...campaignFields, title: canary, summary: canary + "_SUMMARY" }, selection: { kind: "NONE" }, narrative: null } });
  campaigns.add(made.campaignId); return made.campaignId;
}
async function step(account: Account, scope: PlanningScope, campaignId: string, action: string, payload: unknown) {
  const view = await getPlanningCampaign(account.actor, { scope, campaignId });
  return executeCampaignPlanningCommand(account.actor, { operationKey: key(), scope, ...await authority(account, scope), campaignId, action, payload,
    expectedCampaignRevision: view.campaign.revision, expectedPlanningRevision: view.planning.revision,
    expectedSelectionId: view.planning.selection.id, expectedSelectionRevision: view.planning.selection.revision });
}
async function protectedRows(customer: Company, english: boolean, canary: string) {
  const a = await agency(customer, english), b = await agency(customer, english);
  await planned(customer, customer.scope, canary + "_OWN");
  const clientA = await planned(a.seat, a.scope, canary + "_CLIENT_A"); await step(a.seat, a.scope, clientA, "GENERATE_BRIEF", {});
  await planned(b.seat, b.scope, canary + "_CLIENT_B");
  const campaignId = await planned(customer, customer.scope, canary + "_MANAGED_REQUEST");
  const generated = await step(customer, customer.scope, campaignId, "GENERATE_BRIEF", {});
  const submission = await step(customer, customer.scope, campaignId, "SUBMIT_BRIEF", { briefId: generated.briefId, expectedBriefVersion: generated.version });
  await decideCampaignOwnerReview(customer.actor, { operationKey: key(), submissionId: submission.submissionId, expectedRevision: 1, decision: "APPROVE" });
  const current = await getPlanningCampaign(customer.actor, { scope: customer.scope, campaignId });
  await submitManagedOrder(customer.actor, { action: "SUBMIT", operationKey: key(), scope: customer.scope, campaignId,
    expectedCampaignRevision: current.campaign.revision, expectedPlanningRevision: current.planning.revision,
    expectedSelectionId: current.planning.selection.id, expectedSelectionRevision: current.planning.selection.revision,
    briefId: generated.briefId, expectedBriefVersion: generated.version, disclosureVersion: "infame-order-disclosure-v1" });
}
async function saved(customer: Company, status: CampaignStatus, createdAt: Date, canary: string) {
  const row = await db.campaign.create({ data: { brandId: customer.brand.id, status, createdAt, title: canary,
    input: { privateInput: canary }, conversation: [{ privateWords: canary }] } }); campaigns.add(row.id); return row;
}
async function setup(english: boolean) {
  const canary = "ANALYTICS_PRIVATE_" + key(), admin = await person(english, "ADMIN"), customer = await company(english, canary);
  await protectedRows(customer, english, canary);
  const now = new Date(), midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dates = [new Date(now.getTime() - 1000), new Date(midnight - 86400000 + 1), new Date(midnight - 10 * 86400000),
    new Date(midnight - 10 * 86400000 + 1), new Date(midnight - 10 * 86400000 + 2), new Date(now.getTime() + 30 * 86400000), new Date(midnight - 10 * 86400000 + 3)];
  const eligible = [];
  for (const [index, status] of CampaignStatusSchema.options.entries()) eligible.push(await saved(customer, status, dates[index]!, canary + "_ELIGIBLE"));
  const creator = await db.creator.create({ data: { handle: "analytics_" + key().replaceAll("-", "").slice(0, 20), displayName: canary + "_CREATOR", state: "PRIVATE", isTest: true } }); creators.add(creator.id);
  const campaignId = eligible[0]!.id;
  await db.campaignBrief.createMany({ data: [1, 2].map(version => ({ campaignId, version, inputRevision: 1, content: { privateBrief: canary } })) });
  for (const algorithmVersion of ["historical-a", "historical-b", "empty-run"]) {
    const run = await db.matchRun.create({ data: { campaignId, briefVersion: 1, algorithmVersion, requirementSnapshot: { privateRequirement: canary }, policySnapshot: { privatePolicy: canary } } });
    if (algorithmVersion !== "empty-run") await db.creatorMatch.create({ data: { runId: run.id, creatorId: creator.id, score: 60, snapshot: { privateRecommendation: canary } } });
  }
  for (const status of ["OFFERED", "COMPLETED"] as const) await db.deal.create({ data: { campaignId, brandId: customer.brand.id, creatorId: creator.id, status, briefVersion: 1 } });
  const legacyUser = await person(english, "CREATOR"), provider = await db.provider.create({ data: { userId: legacyUser.user.id, providerType: "FREELANCER", languages: ["ar"] } });
  const client = await db.client.create({ data: { userId: customer.user.id } });
  const project = await db.project.create({ data: { clientId: client.id, titleAr: canary, titleEn: canary, description: canary, requiredSkills: [] } }); projects.add(project.id);
  await db.match.create({ data: { projectId: project.id, providerId: provider.id, matchScore: 100, status: "ACCEPTED", reasonAr: canary, reasonEn: canary, scoreBreakdown: { privateLegacy: canary } } });
  await db.user.update({ where: { id: customer.user.id }, data: { active: false } }); // Counts include these stored records, not current executable supply.
  return { admin, customer, canary, eligible };
}
async function wire(response: APIResponse) {
  expect(response.headers()["cache-control"]).toBe("private, no-store"); const requestId = response.headers()["x-request-id"];
  expect(requestId).toMatch(/^[a-f0-9-]{36}$/); const body = await response.json(); expect(body.requestId).toBe(requestId); return body;
}
async function nativeData(page: Page) {
  const response = await page.request.get("/api/admin/analytics"); expect(response.status()).toBe(200);
  return AdminAnalyticsSchema.parse((await wire(response)).data);
}
async function oracle(asOf: string): Promise<AdminAnalyticsDTO> {
  const at = new Date(asOf), midnight = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()), start = midnight - 6 * 86400000;
  const rows = await db.campaign.findMany({ where: { planningBindings: { none: {} } }, select: { id: true, status: true, createdAt: true } });
  const ids = rows.map(row => row.id), runs = await db.matchRun.findMany({ where: { campaignId: { in: ids } }, select: { id: true } });
  return AdminAnalyticsSchema.parse({ asOf, scope: "EARLIER_WORKFLOW_RECORDS", timeZone: "UTC",
    counts: { campaigns: rows.length, briefVersions: await db.campaignBrief.count({ where: { campaignId: { in: ids } } }), matchRuns: runs.length,
      recommendationRows: await db.creatorMatch.count({ where: { runId: { in: runs.map(row => row.id) } } }), deals: await db.deal.count({ where: { campaignId: { in: ids } } }),
      completedDeals: await db.deal.count({ where: { campaignId: { in: ids }, status: "COMPLETED" } }) },
    campaignStatuses: CampaignStatusSchema.options.map(status => ({ status, count: rows.filter(row => row.status === status).length })),
    campaignDays: Array.from({ length: 7 }, (_, index) => { const date = new Date(start + index * 86400000).toISOString().slice(0, 10);
      return { date, count: rows.filter(row => row.createdAt.toISOString().slice(0, 10) === date && row.createdAt.getTime() >= start && row.createdAt <= at).length }; }),
    window: { startsAt: new Date(start).toISOString(), endsAt: asOf }, unavailableMetrics: [...AdminAnalyticsUnavailableMetrics] });
}
const screen = (page: Page) => page.locator("[data-admin-analytics]");
const refresh = (page: Page) => screen(page).getByRole("button").first();
const time = (page: Page) => screen(page).locator("header time");
const countText = (count: number, english: boolean) => new Intl.NumberFormat(english ? "en-US" : "ar-SA").format(count);
async function rendered(page: Page, dto: AdminAnalyticsDTO, english: boolean) {
  await expect(screen(page).locator("[data-analytics-count]")).toHaveCount(6);
  for (const [name, value] of Object.entries(dto.counts)) await expect(screen(page).locator('[data-analytics-count="' + name + '"]')).toHaveText(countText(value, english));
  for (const row of dto.campaignStatuses) await expect(screen(page).locator('[data-analytics-status="' + row.status + '"] > div').first().locator("span").last()).toHaveText(countText(row.count, english));
  for (const row of dto.campaignDays) await expect(screen(page).locator('[data-analytics-day="' + row.date + '"] > span').first()).toHaveText(countText(row.count, english));
  await expect(time(page)).toHaveAttribute("datetime", dto.asOf);
}
function latch() { let release!: () => void; return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() }; }
function headers(requestId: string) { return { "Content-Type": "application/json", "Cache-Control": "private, no-store", "X-Request-Id": requestId }; }

test("canonical analytics preserves Talaqee geometry and renders only native earlier-workflow counts, seven UTC dates and truthful zero extents", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await setup(english);
  expect((await page.request.get("/api/admin/analytics")).status()).toBe(401);
  const other = await person(english); await signed(context, other, english); expect((await page.request.get("/api/admin/analytics")).status()).toBe(403);
  await signed(context, f.admin, english); const api = await nativeData(page);
  expect(api).toEqual(await oracle(api.asOf)); expect(api.scope).toBe("EARLIER_WORKFLOW_RECORDS");
  expect(JSON.stringify(api).includes(f.canary) || JSON.stringify(api).includes(f.admin.token) || JSON.stringify(api).includes(f.admin.actor.sessionId)).toBe(false);
  expect((await page.request.get("/api/admin/projects")).status()).toBe(410);
  await page.goto("/admin/analytics");
  await expect(screen(page).getByRole("heading", { name: copy("تحليلات السجلات", "Stored record analytics"), exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", english ? "ltr" : "rtl");
  const stamp = await time(page).getAttribute("datetime"); if (!stamp) throw new Error("Native analytics timestamp missing");
  const actual = await oracle(stamp); await rendered(page, actual, english);
  await expect(screen(page)).toContainText("UTC"); await expect(screen(page)).toContainText(copy("المسار السابق", "earlier-workflow"));
  for (const poison of [f.canary, "48,500", "٤٨٬٥٠٠", "3.2", "+18%", "214", "%", "٪"]) await expect(screen(page)).not.toContainText(poison);
  const html = await page.content(); expect(html.includes(f.canary)).toBe(false);
  await expect(screen(page).locator("[data-analytics-status]")).toHaveCount(7); await expect(screen(page).locator("[data-analytics-day]")).toHaveCount(7);
  const zeroDays = actual.campaignDays.filter(row => row.count === 0);
  expect(zeroDays.length, "Guarded eligible baseline must expose an actual zero day; never delete unrelated rows to force it").toBeGreaterThan(0);
  for (const row of zeroDays) expect(await screen(page).locator('[data-analytics-day="' + row.date + '"] [aria-hidden="true"] > div').evaluate(el => el.getBoundingClientRect().height)).toBe(0);
  for (const row of actual.campaignStatuses.filter(row => row.count === 0)) expect(await screen(page).locator('[data-analytics-status="' + row.status + '"] [aria-hidden="true"] > div').evaluate(el => el.getBoundingClientRect().width)).toBe(0);
  const geometry = await screen(page).evaluate(el => ({ width: el.getBoundingClientRect().width, max: getComputedStyle(el).maxWidth,
    titleSize: getComputedStyle(el.querySelector("h1")!).fontSize, titleWeight: getComputedStyle(el.querySelector("h1")!).fontWeight }));
  expect(geometry.max).toBe("1040px"); expect(geometry.width).toBeLessThanOrEqual(1040); expect(geometry.titleSize).toBe("24px"); expect(geometry.titleWeight).toBe("700");
  expect(await refresh(page).evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await refresh(page).focus(); await expect(refresh(page)).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  if (english) { await page.setViewportSize({ width: 360, height: 800 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true); }
});

test("held and failed refresh retains a stale native snapshot, while real401/403 denies before malformed bodies and cannot resurrect late old data", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await setup(english); await signed(context, f.admin, english); await page.goto("/admin/analytics");
  await expect(screen(page)).toBeVisible(); const stamp = await time(page).getAttribute("datetime"); if (!stamp) throw new Error("Actual initial snapshot missing");
  const original = await oracle(stamp), reached = latch(), release = latch(); let requests = 0;
  await page.route(endpoint, async route => { requests++; const response = await route.fetch(); expect(response.status()).toBe(200); reached.release(); await release.promise; await route.fulfill({ response }); });
  try {
    await refresh(page).click(); await reached.promise; await expect(refresh(page)).toBeDisabled();
    await expect(screen(page)).toHaveAttribute("aria-busy", "true");
    await refresh(page).evaluate(el => (el as HTMLButtonElement).click()); expect(requests).toBe(1);
    await rendered(page, original, english); release.release(); await expect(screen(page)).toHaveAttribute("aria-busy", "false");
  } finally { release.release(); await page.unroute(endpoint); }
  const currentStamp = await time(page).getAttribute("datetime"); if (!currentStamp) throw new Error("Actual refreshed snapshot missing");
  const current = await oracle(currentStamp);
  await page.route(endpoint, route => { const requestId = key(); return route.fulfill({ status: 503, headers: headers(requestId), body: JSON.stringify({ error: {
    code: "RETRY_REQUIRED", message: "RETRY_REQUIRED", requestId, retryable: true }, requestId }) }); });
  await refresh(page).click(); await expect(screen(page).getByRole("alert")).toBeVisible();
  await expect(screen(page)).toContainText(copy("آخر نسخة صالحة", "last valid snapshot")); await rendered(page, current, english); await page.unroute(endpoint);
  await page.route(endpoint, route => { const requestId = key(); return route.fulfill({ status: 200, headers: headers(requestId),
    body: JSON.stringify({ data: { ...current, counts: { ...current.counts, campaigns: -1 } }, requestId }) }); });
  await refresh(page).click(); await expect(screen(page).getByRole("alert")).toBeVisible(); await rendered(page, current, english); await page.unroute(endpoint);
  await db.authSession.update({ where: { id: f.admin.actor.sessionId }, data: { revokedAt: new Date() } });
  await page.route(endpoint, async route => { const denied = await route.fetch(); expect(denied.status()).toBe(401);
    await route.fulfill({ status: denied.status(), headers: denied.headers(), body: "MALFORMED_NATIVE_DENIAL_BODY" }); });
  await refresh(page).click(); await expect(screen(page).getByRole("alert")).toContainText(copy("انتهت الجلسة", "Your session ended"));
  await expect(time(page)).toHaveCount(0); for (const name of Object.keys(current.counts)) await expect(screen(page).locator('[data-analytics-count="' + name + '"]')).toHaveText("—");
  await expect(refresh(page)).toBeDisabled(); await page.unroute(endpoint);
  // Reauthentication is explicit. A denied component remains locked until a
  // new current-authorized SSR mount; it never accepts a successful late retry.
  const adminUser = await db.user.findUniqueOrThrow({ where: { id: f.admin.user.id } });
  const renewedToken = await openSession(adminUser.id, adminUser.sessionVersion, adminUser.passwordHash);
  await signed(context, { ...f.admin, token: renewedToken }, english); await page.reload(); await expect(time(page)).toHaveCount(1);
  const reachedOld = latch(), releaseOld = latch(); let held = false;
  await page.route(endpoint, async route => {
    if (!held) { held = true; const response = await route.fetch(); expect(response.status()).toBe(200); reachedOld.release(); await releaseOld.promise;
      await route.fulfill({ response }).catch(() => {}); }
    else { const response = await route.fetch(); expect(response.status()).toBe(403); await route.fulfill({ status: 403, headers: response.headers(), body: "MALFORMED_NATIVE_FORBIDDEN_BODY" }); }
  });
  try {
    await refresh(page).click(); await reachedOld.promise; await page.reload(); await expect(time(page)).toHaveCount(1);
    const nonAdmin = await person(english, "BRAND"); await signed(context, nonAdmin, english);
    await refresh(page).click(); await expect(screen(page).getByRole("alert")).toContainText(copy("بيانات الإدارة غير متاحة", "Admin data is unavailable"));
    await expect(time(page)).toHaveCount(0); await expect(refresh(page)).toBeDisabled();
    releaseOld.release(); await page.waitForTimeout(100);
    for (const name of Object.keys(current.counts)) await expect(screen(page).locator('[data-analytics-count="' + name + '"]')).toHaveText("—");
    await expect(time(page)).toHaveCount(0);
    await expect(screen(page)).toContainText(copy("لم تُحمّل نسخة", "No data snapshot has been loaded"));
  } finally { releaseOld.release(); await page.unroute(endpoint); }
});
