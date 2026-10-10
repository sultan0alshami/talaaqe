// Candidate e2e/admin-briefs-taxonomy.spec.mts: exactly two mounted journeys in
// existing Arabic360/English projects. Root alone adopts/runs. Native cookies,
// producers, persisted assignments, SQL503 and role/session denials are genuine
// owned synthetic mechanics; response delivery/body rewrites are labelled seams.
// No provider, production/legal proof, source DB, resets, screenshots or traces.
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { expect, test, type APIResponse, type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";
import { assertLocalTarget, taskState } from "../scripts/task-state.mjs";
import { prisma as db } from "../src/lib/prisma";
import { openSession, resolveSession } from "../src/lib/identity";
import { captureOrganizationActor } from "../src/lib/organizations/context";
import { SESSION_COOKIE } from "../src/lib/jwt";
import { createCampaign, generateCampaignBrief, approveCampaignBrief, applyCampaignMutation } from "../src/lib/campaigns/service";
import { executeCampaignPlanningCommand, getPlanningCampaign } from "../src/lib/campaign-planning/service";
import { AdminBriefsSchema, type AdminBriefsDTO } from "../src/lib/admin/briefs-contracts";
import { AdminTaxonomySchema, type AdminTaxonomyDTO } from "../src/lib/admin/taxonomy-contracts";
import { CampaignFieldObjectSchema } from "../src/lib/campaigns/contracts";
import { NICHE_SOURCE, NICHE_TAXONOMY, FAME_RELATED_NICHES } from "../src/lib/contracts/taxonomy";
import { campaignFields } from "../tests/campaigns/fixtures";

const state = taskState(), key = () => randomUUID();
if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("Admin catalog browser requires exact guarded E2E target");
const users = new Set<string>(), brands = new Set<string>(), campaigns = new Set<string>(), creators = new Set<string>();
const errors = new WeakMap<Page, string[]>();
const briefsEndpoint = "**/api/admin/briefs*", taxonomyEndpoint = "**/api/admin/categories*";
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 10000 }); test.setTimeout(120000);
test.beforeAll(async () => {
  const rows = await db.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]?.id !== state.id || rows[0]?.kind !== "e2e" || rows[0]?.db !== state.targets.e2e || rows[0]?.host !== "127.0.0.1") throw new Error("Admin catalog browser marker mismatch");
});
test.beforeEach(async ({ page }) => {
  const seen: string[] = []; errors.set(page, seen); page.on("pageerror", error => seen.push(error.name));
  page.on("console", message => { if (message.type() === "error" && /hydrat|server.rendered|server HTML|text content.*match/i.test(message.text())) seen.push("HYDRATION_MISMATCH"); });
  await page.addInitScript(() => {
    const observed = window as unknown as { adminCatalogDenialBodyReads: number }; observed.adminCatalogDenialBodyReads = 0;
    const relevant = (response: Response) => (response.status === 401 || response.status === 403) && /\/api\/admin\/(briefs|categories)(?:\?|$)/.test(response.url);
    for (const name of ["json", "text", "arrayBuffer"] as const) {
      const original = Response.prototype[name];
      Object.defineProperty(Response.prototype, name, { configurable: true, writable: true, value: function(this: Response, ...args: unknown[]) {
        if (relevant(this)) observed.adminCatalogDenialBodyReads++; return Reflect.apply(original, this, args);
      } });
    }
    // Stream-reader observation also catches bounded-decoder body access; it
    // forwards the actual getter and records only a count, never body bytes.
    const descriptor = Object.getOwnPropertyDescriptor(Response.prototype, "body");
    if (descriptor?.get) {
      const original = descriptor.get;
      Object.defineProperty(Response.prototype, "body", { ...descriptor, get: function(this: Response) {
        if (relevant(this)) observed.adminCatalogDenialBodyReads++; return Reflect.apply(original, this, []);
      } });
    }
  });
});
test.afterEach(async ({ page }) => {
  const spaces = await db.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } }), ids = spaces.map(row => row.id);
  if (ids.length) {
    for (const table of ["CampaignPlanningCommand", "CampaignPlanningSubmission", "PlanningReviewCommand", "CampaignBriefProvenance", "CampaignProposalDependency", "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding", "BrandContextCommand", "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const) {
      await db.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join(ids)})`);
    }
    await db.planningWorkspace.deleteMany({ where: { id: { in: ids } } });
  }
  await db.campaign.deleteMany({ where: { id: { in: [...campaigns] } } }); await db.creator.deleteMany({ where: { id: { in: [...creators] } } });
  await db.brand.deleteMany({ where: { id: { in: [...brands] } } }); await db.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
  if (users.size) await db.outboxEvent.deleteMany({ where: { OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await db.user.deleteMany({ where: { id: { in: [...users] } } }); for (const owned of [users, brands, campaigns, creators]) owned.clear();
  expect(errors.get(page) ?? [], "Page/hydration error categories only").toEqual([]);
});
test.afterAll(async () => { await db.$disconnect(); });
function locale(info: TestInfo) { const english = info.project.name === "english-desktop"; return { english, copy: (ar: string, en: string) => english ? en : ar }; }
async function person(english: boolean, role: "ADMIN" | "BRAND" | "CREATOR" = "BRAND") {
  const id = key(); users.add(id); const user = await db.user.create({ data: { id, role, language: english ? "en" : "ar", active: true, isTest: true, name: "Synthetic admin catalog actor", email: id + "@example.invalid", passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  const token = await openSession(id, user.sessionVersion, user.passwordHash), session = await resolveSession(token); if (!session) throw new Error("Actual admin catalog native session did not resolve");
  return { user, token, actor: captureOrganizationActor(session) };
}
type Account = Awaited<ReturnType<typeof person>>;
async function signed(context: BrowserContext, account: Account, english: boolean) {
  expect(await resolveSession(account.token) !== null).toBe(true);
  await context.addCookies([{ name: SESSION_COOKIE, value: account.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }, { name: "infame_lang", value: english ? "en" : "ar", domain: "localhost", path: "/" }]);
}
async function setup(english: boolean) {
  const admin = await person(english, "ADMIN"), owner = await person(english), title = "حملة أصلية محفوظة " + key(), poison = "PROTECTED_CATALOG_BODY_" + key(), unknown = "PRIVATE_UNLISTED_TAG_" + key();
  const brand = await db.brand.create({ data: { userId: owner.user.id, name: "علامة أصلية طويلة Original retained brand", slug: "catalog-" + key(), countryCode: "KW", state: "PRIVATE", isTest: true } }); brands.add(brand.id);
  const made = await createCampaign(owner.user.id, { operationKey: key(), fields: { ...campaignFields, title, summary: "ملخص أصلي محفوظ", budget: { amountMinor: "9007199254740993", currencyCode: "KWD" } } }, db, owner.actor); campaigns.add(made.campaign.id);
  const generated = await generateCampaignBrief(owner.user.id, made.campaign.id, { operationKey: key(), expectedRevision: made.campaign.revision }, db, owner.actor);
  const approved = await approveCampaignBrief(owner.user.id, made.campaign.id, { operationKey: key(), expectedRevision: generated.campaign.revision, briefId: generated.brief.id, expectedBriefVersion: generated.brief.version }, db, { channel: "FORM", serverAuth: owner.actor });
  const changed = await applyCampaignMutation(owner.user.id, made.campaign.id, { action: "UPDATE_FIELDS", operationKey: key(), expectedRevision: approved.campaign.revision, payload: { patch: { title: "عنوان أحدث لا يحل محل التاريخ", budget: { amountMinor: "12005", currencyCode: "KWD" }, tone: "A later explicit tone" } } }, db, { channel: "FORM", serverAuth: owner.actor });
  const later = await generateCampaignBrief(owner.user.id, made.campaign.id, { operationKey: key(), expectedRevision: changed.campaign.revision }, db, owner.actor);
  const bulkIds = Array.from({ length: 32 }, (_, i) => "!catalog-" + admin.user.id + "-" + String(i).padStart(3, "0"));
  await db.campaignBrief.createMany({ data: bulkIds.map((id, i) => ({ id, campaignId: made.campaign.id, version: 100 + i, inputRevision: approved.brief.inputRevision,
    approvedAt: i === 0 ? null : new Date(approved.brief.approvedAt!), approvedByUserId: i === 0 ? null : owner.user.id, createdAt: new Date(approved.brief.createdAt),
    content: { ...approved.brief.content, approvedByUserId: i === 0 ? null : owner.user.id, requirements: { ...approved.brief.content.requirements, version: 100 + i } } })) });
  const scope = { kind: "OWN_BRAND" as const, brandId: brand.id };
  const planned = await executeCampaignPlanningCommand(owner.actor, { operationKey: key(), scope, action: "CREATE", expectedCampaignRevision: 0, expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0,
    payload: { fields: { ...campaignFields, title: poison, summary: poison }, selection: { kind: "NONE" }, narrative: null } }); campaigns.add(planned.campaignId);
  const planning = await getPlanningCampaign(owner.actor, { scope, campaignId: planned.campaignId });
  await executeCampaignPlanningCommand(owner.actor, { operationKey: key(), scope, campaignId: planned.campaignId, action: "GENERATE_BRIEF", expectedCampaignRevision: planning.campaign.revision, expectedPlanningRevision: planning.planning.revision, expectedSelectionId: planning.planning.selection.id, expectedSelectionRevision: planning.planning.selection.revision, payload: {} });
  await db.campaignBrief.create({ data: { id: "!catalog-" + admin.user.id + "-000-protected", campaignId: planned.campaignId, version: 99, inputRevision: 1, content: { unsubmittedPrivateCanary: poison } } });
  await db.campaign.update({ where: { id: made.campaign.id }, data: { input: { currentPrivateCanary: poison }, conversation: [{ unsubmittedPrivateCanary: poison }] } });
  const creatorUser = await person(english, "CREATOR");
  for (const [i, nicheIds, fameTags] of [[0, ["beauty", "beauty", "skincare", unknown], ["sports", "sports", "social_only", unknown]], [1, ["skincare", "Beauty"], ["sports", "social-only"]]] as const) {
    const row = await db.creator.create({ data: { userId: i === 0 ? creatorUser.user.id : null, handle: "catalog_" + key().replaceAll("-", "").slice(0, 20), displayName: unknown, bio: unknown, state: "PRIVATE", isTest: true, nicheIds: [...nicheIds], fameTags: [...fameTags], profileFacts: { privateCanary: poison } } }); creators.add(row.id);
  }
  await db.user.update({ where: { id: owner.user.id }, data: { active: false } }); await db.user.update({ where: { id: creatorUser.user.id }, data: { active: false } });
  return { admin, owner, brand, title, poison, unknown, bulkIds, first: approved.brief, later: later.brief, mutableBriefId: bulkIds[0]!, protectedCampaignId: planned.campaignId };
}
async function wire(response: APIResponse) {
  expect(response.headers()["cache-control"]).toBe("private, no-store"); const body = await response.json(), requestId = response.headers()["x-request-id"];
  expect(requestId).toMatch(/^[a-f0-9-]{36}$/); expect(body.requestId).toBe(requestId); return body;
}
async function briefs(page: Page, after: string | null = null) {
  const response = await page.request.get("/api/admin/briefs" + (after ? "?" + new URLSearchParams({ after }).toString() : "")); expect(response.status()).toBe(200);
  const input = (await wire(response)).data; expect(AdminBriefsSchema.safeParse(input).success).toBe(true); return input as AdminBriefsDTO;
}
async function taxonomy(page: Page) {
  const response = await page.request.get("/api/admin/categories"); expect(response.status()).toBe(200); const input = (await wire(response)).data; expect(AdminTaxonomySchema.safeParse(input).success).toBe(true); return input as AdminTaxonomyDTO;
}
const briefScreen = (page: Page) => page.locator("[data-admin-briefs]"), taxonomyScreen = (page: Page) => page.locator("[data-admin-taxonomy]");
const briefRefresh = (page: Page) => briefScreen(page).locator("[data-admin-briefs-refresh]"), taxonomyRefresh = (page: Page) => taxonomyScreen(page).locator("[data-admin-taxonomy-refresh]");
const time = (screen: Locator) => screen.locator("header time");
const count = (value: number, english: boolean) => new Intl.NumberFormat(english ? "en" : "ar").format(value);
async function rowIds(page: Page, expected: AdminBriefsDTO) { expect(await briefScreen(page).locator("[data-admin-brief-id]").evaluateAll(elements => elements.map(element => element.getAttribute("data-admin-brief-id")))).toEqual(expected.briefs.map(row => row.id)); }
async function privateAbsent(page: Page, values: string[]) { const html = await page.content(); for (const value of values) expect(html.includes(value), "Protected serialization is absent").toBe(false); }
async function geometry(page: Page, screen: Locator, refresh: Locator, english: boolean) {
  const info = await screen.evaluate(el => ({ max: getComputedStyle(el).maxWidth, width: el.getBoundingClientRect().width, titleSize: getComputedStyle(el.querySelector("h1")!).fontSize }));
  expect(info.max).toBe("1040px"); expect(info.width).toBeLessThanOrEqual(1040); expect(info.titleSize).toBe("24px");
  expect(await refresh.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44); await refresh.focus(); await expect(refresh).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  if (english) { await page.setViewportSize({ width: 360, height: 800 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true); }
}
function latch() { let release!: () => void; return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() }; }
async function noDenialBodyReads(page: Page) { expect(await page.evaluate(() => (window as unknown as { adminCatalogDenialBodyReads: number }).adminCatalogDenialBodyReads)).toBe(0); }
async function completeBriefRead(page: Page, trigger: () => Promise<void>, after: string | null = null) {
  const query = after === null ? "" : "?" + new URLSearchParams({ after }).toString();
  const delivered = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/api/admin/briefs" && url.search === query && response.request().method() === "GET" && response.status() === 200;
  });
  await trigger(); const response = await delivered;
  expect(await response.finished() === null, "Successful native read delivery completed").toBe(true);
  const data = (await response.json()).data;
  expect(AdminBriefsSchema.safeParse(data).success, "Successful native brief DTO").toBe(true);
  await expect(briefRefresh(page)).toBeEnabled();
  await expect(time(briefScreen(page))).toHaveAttribute("datetime", (data as AdminBriefsDTO).asOf);
  await expect(briefScreen(page).getByRole("alert")).toHaveCount(0);
}

test("native historical requirements and taxonomy replace the original data within retained responsive admin composition", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await setup(english); await signed(context, f.admin, english); await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/admin/briefs");
  // FIRST meaningful mounted assertion: the old SSR has no canonical native
  // original title. Missing a new data hook is not the recorded baseline RED.
  await expect(page.getByText(f.title, { exact: true }).first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", english ? "ltr" : "rtl"); const first = await briefs(page); await rowIds(page, first);
  expect(first.briefs.some(row => row.id === f.mutableBriefId)).toBe(true); expect(first.briefs.every(row => row.campaignId !== f.protectedCampaignId)).toBe(true);
  const native = first.briefs.find(row => row.id === f.mutableBriefId)!; const row = briefScreen(page).locator('[data-admin-brief-id="' + native.id + '"]');
  await row.locator("[data-admin-brief-expand]").focus(); await page.keyboard.press("Enter"); await expect(row.locator("[data-admin-brief-expand]")).toHaveAttribute("aria-expanded", "true");
  const region = briefScreen(page).getByRole("region"); await expect(region.locator("[data-admin-brief-field]")).toHaveCount(32);
  const keys = await region.locator("[data-admin-brief-field]").evaluateAll(elements => elements.map(element => element.getAttribute("data-admin-brief-field")));
  expect(keys).toEqual([...Object.keys(CampaignFieldObjectSchema.shape), "brandCountryCode", "mandatoryPolicyVersionIds"]);
  // Independent fixed-fixture text oracle, not a ReactNode equality or reuse of
  // the component's own projection. Every original central field has a witness.
  const none = copy("بدون تفضيل / لا يوجد", "No preference / none"), no = copy("لا", "No"), kuwait = copy("الكويت (KW)", "Kuwait (KW)");
  const expected: Record<keyof typeof campaignFields, readonly string[]> = {
    originalLanguage: ["ar"], title: [f.title], productService: ["منتج أصلي"], goal: [copy("الوعي بالعلامة", "Awareness")], summary: ["ملخص أصلي محفوظ"],
    marketCountryCodes: [kuwait], targetAgeBuckets: ["18-24"], targetGenders: [copy("نساء", "Female")], targetCountryCodes: [kuwait], targetCityKeys: [none],
    contentLanguages: ["ar"], dialects: [copy("خليجية", "Gulf")], nicheSlugs: [copy("جمال وعناية", "Beauty & Skincare")], deliverables: ["INSTAGRAM", copy("ستوري", "Story"), "× 2"],
    budget: ["9007199254740.993 KWD"], desiredCreatorCount: ["3"], impressionsTarget: ["10001"],
    period: ["2026-11-01 13:00:00", "2026-11-10 13:00:00", "Asia/Kuwait"], physicalPresenceRequired: [no], presenceCountryCodes: [none], travelAllowed: [no],
    tone: ["ودي"], noGoTopics: [none], preferredTiers: [none], dataVerificationRequired: [no], preferredLicencePolicyIds: [none], usageRights: ["للحملة فقط"],
    kpis: ["الزيارات — زيادة الزيارات"], assumptions: [none], openQuestions: [none],
  };
  expect(Object.keys(expected)).toEqual(Object.keys(CampaignFieldObjectSchema.shape));
  for (const [field, fragments] of Object.entries(expected)) {
    const actual = (await region.locator('[data-admin-brief-field="' + field + '"] dd').textContent())?.replace(/\s+/g, " ").trim() ?? "";
    for (const fragment of fragments) expect(actual.includes(fragment), "Stored historical field display: " + field).toBe(true);
  }
  expect((await region.locator('[data-admin-brief-field="brandCountryCode"] dd').textContent())?.includes(kuwait)).toBe(true);
  expect((await region.locator('[data-admin-brief-field="mandatoryPolicyVersionIds"] dd').textContent())?.includes(copy("لا توجد نسخ إلزامية محفوظة", "No mandatory versions stored"))).toBe(true);
  expect((await row.textContent())?.includes("9007199254740.993 KWD")).toBe(true); expect((await region.locator('[data-admin-brief-field="budget"] dd').textContent())?.includes("9007199254740.993")).toBe(true);
  await expect(region.locator("time").first()).toHaveAttribute("datetime", f.first.content.requirements.period.startsAt); await expect(briefScreen(page)).toContainText(copy("المسار السابق", "earlier workflow")); await expect(briefScreen(page)).toContainText("UTC");
  await privateAbsent(page, [f.poison, f.admin.token, f.admin.actor.sessionId]); expect((await briefScreen(page).textContent())?.includes("%"), "No invented quality percent").toBe(false);
  const next = await briefs(page, first.nextCursor); await briefScreen(page).getByRole("button", { name: copy("الصفحة التالية", "Next page"), exact: true }).click(); await expect.poll(() => briefScreen(page).locator("[data-admin-brief-id]").count()).toBe(next.briefs.length); await rowIds(page, next);
  await briefScreen(page).getByRole("button", { name: copy("الصفحة السابقة", "Previous page"), exact: true }).click(); await expect.poll(() => briefScreen(page).locator("[data-admin-brief-id]").count()).toBe(first.briefs.length); await rowIds(page, first);
  await geometry(page, briefScreen(page), briefRefresh(page), english);
  await page.goto("/admin/categories"); const catalog = await taxonomy(page); await expect(taxonomyScreen(page)).toContainText(NICHE_SOURCE.version);
  await expect(taxonomyScreen(page).locator("[data-taxonomy-catalog-count]")).toHaveText(count(139, english)); await expect(taxonomyScreen(page).locator("[data-taxonomy-parent-grid] [data-taxonomy-niche]")).toHaveCount(30); await expect(taxonomyScreen(page).locator("[data-taxonomy-child-region] [data-taxonomy-niche]")).toHaveCount(109); await expect(taxonomyScreen(page).locator("[data-taxonomy-fame]")).toHaveCount(12);
  for (const slug of ["beauty", "skincare"]) await expect(taxonomyScreen(page).locator('[data-taxonomy-niche="' + slug + '"] [data-taxonomy-assignment-count]')).toHaveText(count(catalog.niches.find(row => row.slug === slug)!.assignmentCount, english));
  await expect(taxonomyScreen(page).locator('[data-taxonomy-fame="sports"] [data-taxonomy-assignment-count]')).toHaveText(count(catalog.fame.find(row => row.industry === "sports")!.assignmentCount, english));
  for (const kind of ["nicheCreators", "fameCreators"] as const) await expect(taxonomyScreen(page).locator('[data-taxonomy-unknown="' + kind + '"]')).toHaveText(count(catalog.unknownAssignments[kind], english));
  expect(catalog.niches.map(row => row.slug)).toEqual(NICHE_TAXONOMY.map(row => row.slug)); expect(catalog.fame.find(row => row.industry === "social-only")?.relatedNicheSlugs).toEqual([...FAME_RELATED_NICHES["social-only"]]);
  await expect(taxonomyScreen(page)).toContainText(copy("الخاصة والاختبارية وغير النشطة", "private, test and inactive")); await taxonomyScreen(page).locator("[data-taxonomy-parent-filter]").selectOption("beauty"); await expect(taxonomyScreen(page).locator("[data-taxonomy-parent-grid] [data-taxonomy-niche]")).toHaveCount(1);
  await taxonomyScreen(page).locator("[data-taxonomy-search]").fill("skincare"); await expect(taxonomyScreen(page).locator("[data-taxonomy-child-region] [data-taxonomy-niche]")).toHaveCount(1); await expect(taxonomyScreen(page).locator('[data-taxonomy-niche="skincare"]')).toBeVisible();
  await taxonomyScreen(page).getByRole("button", { name: copy("مسح التصفية", "Clear filters"), exact: true }).click(); await expect(taxonomyScreen(page).locator("[data-taxonomy-child-region] [data-taxonomy-niche]")).toHaveCount(109);
  await privateAbsent(page, [f.poison, f.unknown, f.admin.token]); await expect(taxonomyScreen(page).getByRole("button", { name: /إضافة|حذف|Add category|Delete/i })).toHaveCount(0);
  await geometry(page, taxonomyScreen(page), taxonomyRefresh(page), english);
  await info.attach("admin-catalog-metadata", { contentType: "application/json", body: JSON.stringify({ locale: english ? "en" : "ar", historicalFields: 32, catalog: 139, parents: 30, children: 109, fame: 12, protectedBodiesAbsent: true, privateTrace: false }) });
});

test("current native failures retain honest snapshots and captured read cursors while401/403 clear before bodies and reject late restoration", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await setup(english); await signed(context, f.admin, english); await page.goto("/admin/briefs"); await expect(page.getByText(f.title, { exact: true }).first()).toBeVisible();
  const initial = await briefs(page), originalTime = await time(briefScreen(page)).getAttribute("datetime"); if (!originalTime || !initial.nextCursor) throw new Error("Actual initial page/cursor is required");
  for (const url of ["/api/admin/briefs?after=a&after=b", "/api/admin/briefs?actorUserId=forged", "/api/admin/categories?limit=1"]) { const response = await page.request.get(url); expect(response.status()).toBe(422); expect((await wire(response)).error.code).toBe("VALIDATION"); }
  // Actual native503 from an owned unapproved corrupted row; no SQL/result mock
  // or approved-trigger bypass. Restoration targets only the same owned row.
  const original = await db.campaignBrief.findUniqueOrThrow({ where: { id: f.mutableBriefId } });
  await db.campaignBrief.update({ where: { id: original.id }, data: { content: { ...f.first.content, approvedByUserId: null, inputRevision: original.inputRevision + 1, requirements: { ...f.first.content.requirements, version: original.version } } } });
  const nativeFailure = await page.request.get("/api/admin/briefs"); expect(nativeFailure.status()).toBe(503); expect((await wire(nativeFailure)).error.code).toBe("INVALID_STORED_BRIEF");
  await briefRefresh(page).click(); await expect(briefScreen(page).getByRole("alert")).toBeVisible(); await rowIds(page, initial); await expect(time(briefScreen(page))).toHaveAttribute("datetime", originalTime);
  await expect(briefScreen(page)).toContainText(copy("نسخة سابقة", "previous snapshot")); await db.campaignBrief.update({ where: { id: original.id }, data: { content: original.content as Prisma.InputJsonValue } });
  await completeBriefRead(page, () => briefScreen(page).getByRole("button", { name: copy("أعد القراءة نفسها", "Retry the same read"), exact: true }).click());
  const requests: string[] = []; const reached = latch(), release = latch();
  await page.route(briefsEndpoint, async route => { requests.push(new URL(route.request().url()).search); const response = await route.fetch(); expect(response.status()).toBe(200); reached.release(); await release.promise; await route.fulfill({ response }); });
  try {
    await briefRefresh(page).click(); await reached.promise; await expect(briefRefresh(page)).toBeDisabled(); await expect(briefScreen(page).getByRole("table")).toHaveAttribute("aria-busy", "true");
    await briefRefresh(page).evaluate(el => (el as HTMLButtonElement).click()); expect(requests).toHaveLength(1);
    await completeBriefRead(page, async () => { release.release(); });
  } finally { release.release(); await page.unroute(briefsEndpoint); }
  // Labelled malformed-body/old-timestamp delivery seams preserve the latest
  // genuine snapshot, rather than claiming a provider/server failure.
  for (const mode of ["MALFORMED", "OLD_ASOF"] as const) {
    const stamp = await time(briefScreen(page)).getAttribute("datetime");
    await page.route(briefsEndpoint, async route => { const actual = await route.fetch(); expect(actual.status()).toBe(200); if (mode === "MALFORMED") return route.fulfill({ response: actual, body: "MALFORMED_DELIVERY_SEAM" });
      const envelope = await actual.json(); return route.fulfill({ response: actual, body: JSON.stringify({ ...envelope, data: { ...envelope.data, asOf: "2000-01-01T00:00:00.000Z" } }) }); });
    await briefRefresh(page).click(); await expect(briefScreen(page).getByRole("alert")).toBeVisible(); await expect(briefRefresh(page)).toBeEnabled(); await rowIds(page, initial); await expect(time(briefScreen(page))).toHaveAttribute("datetime", stamp!); await page.unroute(briefsEndpoint);
    await completeBriefRead(page, () => briefScreen(page).getByRole("button", { name: copy("أعد القراءة نفسها", "Retry the same read"), exact: true }).click());
  }
  const captured: string[] = []; let failNext = true;
  await page.route(briefsEndpoint, async route => { captured.push(new URL(route.request().url()).search); if (failNext) { failNext = false; return route.abort("failed"); } return route.continue(); });
  await briefScreen(page).getByRole("button", { name: copy("الصفحة التالية", "Next page"), exact: true }).click(); await expect(briefScreen(page).getByRole("alert")).toBeVisible(); await rowIds(page, initial);
  await completeBriefRead(page, () => briefScreen(page).getByRole("button", { name: copy("أعد القراءة نفسها", "Retry the same read"), exact: true }).click(), initial.nextCursor);
  expect(captured).toHaveLength(2); expect(captured[0]).toBe(captured[1]); expect(new URLSearchParams(captured[1]).get("after")).toBe(initial.nextCursor); await rowIds(page, await briefs(page, initial.nextCursor)); await page.unroute(briefsEndpoint);
  await db.authSession.update({ where: { id: f.admin.actor.sessionId }, data: { revokedAt: new Date() } });
  const deniedQuery = await page.request.get("/api/admin/briefs?after=a&after=b"); expect(deniedQuery.status()).toBe(401); expect((await wire(deniedQuery)).error.code).toBe("UNAUTHENTICATED");
  let native401 = false; await page.route(briefsEndpoint, async route => { const response = await route.fetch(); expect(response.status()).toBe(401); native401 = true; await route.fulfill({ status: 401, headers: response.headers(), body: "MALFORMED_NATIVE_DENIAL" }); });
  await briefRefresh(page).click(); await expect(briefScreen(page).getByRole("alert")).toContainText(copy("انتهت الجلسة", "Your session ended")); expect(native401).toBe(true);
  await expect(briefScreen(page).locator("[data-admin-brief-id]")).toHaveCount(0); await expect(briefScreen(page).getByRole("region")).toHaveCount(0); await expect(time(briefScreen(page))).toHaveCount(0); await expect(briefRefresh(page)).toBeDisabled(); await expect(briefScreen(page).getByRole("heading", { level: 1 })).toBeFocused(); await noDenialBodyReads(page); await page.unroute(briefsEndpoint);
  const currentUser = await db.user.findUniqueOrThrow({ where: { id: f.admin.user.id } }), newToken = await openSession(currentUser.id, currentUser.sessionVersion, currentUser.passwordHash);
  const renewed = { ...f.admin, token: newToken }; await signed(context, renewed, english); await briefRefresh(page).evaluate(el => (el as HTMLButtonElement).click()); await expect(time(briefScreen(page))).toHaveCount(0);
  await page.goto("/admin/categories"); await expect(taxonomyScreen(page).locator("[data-taxonomy-catalog-count]")).toHaveText(count(139, english));
  await taxonomyScreen(page).locator("[data-taxonomy-search]").fill(f.unknown); await taxonomyScreen(page).locator("[data-taxonomy-parent-filter]").selectOption("beauty");
  const oldReached = latch(), oldRelease = latch(), delivered = latch(); let held = false;
  await page.route(taxonomyEndpoint, async route => {
    if (!held) { held = true; const response = await route.fetch(); expect(response.status()).toBe(200); oldReached.release(); await oldRelease.promise; try { await route.fulfill({ response }).catch(() => {}); } finally { delivered.release(); } }
    else { const response = await route.fetch(); expect(response.status()).toBe(403); await route.fulfill({ status: 403, headers: response.headers(), body: "MALFORMED_NATIVE_FORBIDDEN" }); }
  });
  try {
    await taxonomyRefresh(page).click(); await oldReached.promise; await page.reload(); await expect(taxonomyScreen(page).locator("[data-taxonomy-catalog-count]")).toHaveText(count(139, english));
    await taxonomyScreen(page).locator("[data-taxonomy-search]").fill(f.unknown); await taxonomyScreen(page).locator("[data-taxonomy-parent-filter]").selectOption("beauty");
    const wrong = await person(english, "BRAND"); await signed(context, wrong, english); const wrongQuery = await page.request.get("/api/admin/categories?malformed=1"); expect(wrongQuery.status()).toBe(403); expect((await wire(wrongQuery)).error.code).toBe("FORBIDDEN");
    await taxonomyRefresh(page).click(); await expect(taxonomyScreen(page).getByRole("alert")).toContainText(copy("بيانات التصنيف غير متاحة", "Taxonomy data is unavailable"));
    await expect(taxonomyScreen(page).locator("[data-taxonomy-niche]")).toHaveCount(0); await expect(taxonomyScreen(page).locator("[data-taxonomy-fame]")).toHaveCount(0); await expect(taxonomyScreen(page).locator("[data-taxonomy-search]")).toHaveCount(0); await expect(taxonomyScreen(page).locator("[data-taxonomy-parent-filter]")).toHaveCount(0); await expect(time(taxonomyScreen(page))).toHaveCount(0); await expect(taxonomyRefresh(page)).toBeDisabled(); await expect(taxonomyScreen(page).getByRole("heading", { level: 1 })).toBeFocused(); await noDenialBodyReads(page);
    oldRelease.release(); await delivered.promise; await page.waitForTimeout(100); await expect(taxonomyScreen(page).locator("[data-taxonomy-niche]")).toHaveCount(0); await expect(time(taxonomyScreen(page))).toHaveCount(0); await noDenialBodyReads(page);
    await signed(context, renewed, english); await taxonomyRefresh(page).evaluate(el => (el as HTMLButtonElement).click()); await expect(time(taxonomyScreen(page))).toHaveCount(0);
  } finally { oldRelease.release(); await page.unroute(taxonomyEndpoint); }
  await info.attach("admin-catalog-recovery-metadata", { contentType: "application/json", body: JSON.stringify({ locale: english ? "en" : "ar", native503: true, native401: true, native403: true, exactReadCursorRetried: true, denialBodyReads: 0, lateRestoration: false, privateTrace: false }) });
});
