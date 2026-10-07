import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { expect, test, type BrowserContext, type Page, type TestInfo, type Response, type Locator } from "@playwright/test";
import { assertLocalTarget, taskState, workspace } from "../scripts/task-state.mjs";
import { prisma as db } from "../src/lib/prisma";
import { openSession, resolveSession } from "../src/lib/identity";
import { SESSION_COOKIE } from "../src/lib/jwt";
import type { OrganizationActor } from "../src/lib/organizations/context";
import { createOrganization, proposeClientAssociation, authorizeClientAssociation, proposeMember, acceptMembership, setClientGrant } from "../src/lib/organizations/service";
import { getClientAuthority } from "../src/lib/organizations/loaders";
import { BrandContextContentSchema, BrandContextCommandResultSchema, BrandContextDetailResponseSchema, BrandContextVersionResponseSchema, ContextOwnerReviewResultSchema, type PlanningScope } from "../src/lib/brand-context/contracts";
import { CampaignFieldsSchema } from "../src/lib/campaigns/contracts";
import { CampaignPlanningCommandSchema, CampaignPlanningResultSchema, PlanningCampaignSchema, PlanningCampaignListSchema, CampaignOwnerReviewsSchema,
  CampaignOwnerReviewSchema, CampaignOwnerReviewResultSchema, type PlanningCampaign } from "../src/lib/campaign-planning/contracts";
import { campaignFields } from "../tests/campaigns/fixtures";

// IGNORED DRAFT; relative imports target e2e/campaign-planning.spec.mts on root
// activation. Exactly three native customer journeys in both existing locales.
// Native signed sessions, APIs/context/org/planning producers and data are real
// owned synthetic fixtures. No transport/domain/auth/Date mock, live provider,
// legal verification, file activity or test-module fixture import is claimed.
const state = taskState(), origin = "http://localhost:3100";
if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("Planning browser fixtures require the exact guarded E2E target");
const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>(), errors = new WeakMap<Page, string[]>();
const allCaps = { view: true, plan: true, approveShortlist: true, reviewContent: true, signCustomer: true, financial: true, manageGrants: true };
test.setTimeout(90000);
test.beforeAll(async () => {
  const rows = await db.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]!.id !== state.id || rows[0]!.kind !== "e2e" || rows[0]!.db !== state.targets.e2e || rows[0]!.host !== "127.0.0.1") throw new Error("Incorrect planning browser database identity");
});
test.beforeEach(async ({ page }) => {
  const seen: string[] = []; errors.set(page, seen);
  page.on("pageerror", error => seen.push(error.name));
  page.on("console", message => { if (message.type() === "error" && /hydrat|server.rendered|server HTML|text content.*match/i.test(message.text())) seen.push("HYDRATION_MISMATCH"); });
});
test.afterEach(async ({ page }) => {
  const workspaces = await db.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } });
  if (workspaces.length) {
    const ids = workspaces.map(row => row.id);
    for (const table of ["PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission", "CampaignBriefProvenance", "CampaignProposalDependency",
      "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding", "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const) {
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
  expect(errors.get(page) ?? [], "Actual page errors/hydration metadata").toEqual([]);
});
test.afterAll(async () => { await db.$disconnect(); });
type Copy = (ar: string, en: string) => string;
function locale(info: TestInfo) { const english = info.project.name === "english-desktop"; return { english, copy: (ar: string, en: string) => english ? en : ar }; }
async function person(english: boolean) {
  const id = randomUUID(); users.add(id);
  const user = await db.user.create({ data: { id, role: "BRAND", active: true, isTest: true, language: english ? "en" : "ar",
    name: "Synthetic planning browser actor", email: `${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  const token = await openSession(id, user.sessionVersion, user.passwordHash), current = await resolveSession(token);
  if (!current) throw new Error("Synthetic current planning browser session did not resolve");
  const actor: OrganizationActor = { userId: current.userId, role: current.role, sessionId: current.sessionId, sessionVersion: current.sessionVersion };
  return { user, actor, token };
}
async function signed(context: BrowserContext, subject: Awaited<ReturnType<typeof person>>, english: boolean) {
  expect(await resolveSession(subject.token)).not.toBeNull();
  await context.addCookies([{ name: SESSION_COOKIE, value: subject.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "infame_lang", value: english ? "en" : "ar", domain: "localhost", path: "/" }]);
}
async function company(english: boolean) {
  const owner = await person(english), brand = await db.brand.create({ data: { userId: owner.user.id, slug: "planning-browser-" + randomUUID().replace(/-/g, "").slice(0, 16),
    name: "شركة أصلية Synthetic planning company", countryCode: "KW", isTest: true } }); brands.add(brand.id);
  return { ...owner, brand, scope: { kind: "OWN_BRAND", brandId: brand.id } as const };
}
async function agency(customer: Awaited<ReturnType<typeof company>>, english: boolean, nameOriginal: string) {
  const owner = await person(english), seat = await person(english);
  const { organization } = await createOrganization(owner.actor, { operationKey: randomUUID(), kind: "AGENCY", nameOriginal }); organizations.add(organization.id);
  const revision = async () => (await db.organization.findUniqueOrThrow({ where: { id: organization.id } })).revision;
  const proposed = await proposeClientAssociation(owner.actor, organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: await revision(), brandId: customer.brand.id });
  const { client } = await authorizeClientAssociation(customer.actor, proposed.client.id, { operationKey: randomUUID(), expectedRevision: proposed.client.revision, capabilities: allCaps });
  const proposedMember = await proposeMember(owner.actor, organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: await revision(), targetUserId: seat.user.id });
  const { membership } = await acceptMembership(seat.actor, proposedMember.membership.id, { operationKey: randomUUID(), expectedRevision: proposedMember.membership.revision });
  const { grant } = await setClientGrant(owner.actor, client.id, { operationKey: randomUUID(), expectedClientRevision: client.revision, membershipId: membership.id, expectedGrantRevision: null, capabilities: allCaps });
  return { owner, seat, client, organization, membership, grant, scope: { kind: "CLIENT", clientId: client.id } as const };
}
function scopeQuery(scope: PlanningScope) { return scope.kind === "OWN_BRAND" ? `scope=OWN_BRAND&brandId=${scope.brandId}` : `scope=CLIENT&clientId=${scope.clientId}`; }
function route(scope: PlanningScope, path = "") { return `/brand/campaigns${path}${scope.kind === "CLIENT" ? `?clientId=${scope.clientId}` : ""}`; }
async function read<T>(context: BrowserContext, url: string, schema: z.ZodType<T>) {
  const response = await context.request.get(url); expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toBe("private, no-store");
  const body = await response.json(); expect(body.requestId).toBe(response.headers()["x-request-id"]); return schema.parse(body.data);
}
async function nativeCommand(context: BrowserContext, input: unknown) {
  const response = await context.request.post("/api/planning-campaigns/commands", { headers: { Origin: origin }, data: input });
  expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toBe("private, no-store"); return CampaignPlanningResultSchema.parse((await response.json()).data);
}
async function nativeCreate(context: BrowserContext, scope: PlanningScope, fields: unknown, account: Awaited<ReturnType<typeof person>>) {
  const input = CampaignPlanningCommandSchema.parse({ operationKey: randomUUID(), scope, ...(scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(account.actor, scope.clientId, "plan") } : {}),
    action: "CREATE", expectedCampaignRevision: 0, expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0, payload: { fields, selection: { kind: "NONE" }, narrative: null } });
  const result = await nativeCommand(context, input);
  const current = await read(context, `/api/planning-campaigns/detail?${scopeQuery(scope)}&campaignId=${result.campaignId}`, PlanningCampaignSchema);
  expect(current.campaign.id).toBe(result.campaignId); expect(current.planning.selection.kind).toBe("NONE"); return { input, result, current };
}
async function nativeInput(context: BrowserContext, account: Awaited<ReturnType<typeof person>>, scope: PlanningScope, campaignId: string, action: string, payload: unknown) {
  const current = await read(context, `/api/planning-campaigns/detail?${scopeQuery(scope)}&campaignId=${campaignId}`, PlanningCampaignSchema);
  return CampaignPlanningCommandSchema.parse({ operationKey: randomUUID(), scope, ...(scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(account.actor, scope.clientId, "plan") } : {}), campaignId,
    expectedCampaignRevision: current.campaign.revision, expectedPlanningRevision: current.planning.revision, expectedSelectionId: current.planning.selection.id, expectedSelectionRevision: current.planning.selection.revision, action, payload });
}
const contextContent = BrandContextContentSchema.parse({ schemaVersion: 1, positioning: { text: "  Original approved positioning\nتموضع مثبت  ", language: "ar" },
  values: [], tone: { text: "  النبرة الأصلية Approved calm tone  ", language: "en" }, references: [], competitors: [] });
async function nativeContextCommand(context: BrowserContext, input: unknown) {
  const response = await context.request.post("/api/brand-contexts/commands", { headers: { Origin: origin }, data: input }); expect(response.status()).toBe(200);
  return BrandContextCommandResultSchema.parse((await response.json()).data);
}
async function approvedContext(context: BrowserContext, scope: PlanningScope, account: Awaited<ReturnType<typeof person>>, owner: Awaited<ReturnType<typeof company>>, english: boolean) {
  await signed(context, account, english);
  const expected = async () => scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(account.actor, scope.clientId, "plan") } : {};
  const made = await nativeContextCommand(context, { operationKey: randomUUID(), scope, ...(await expected()), action: "CREATE", expectedRevision: 0,
    payload: { nameOriginal: { text: "Synthetic exact approved context", language: "en" }, content: contextContent } });
  const sent = await nativeContextCommand(context, { operationKey: randomUUID(), scope, ...(await expected()), contextId: made.contextId, action: "SUBMIT", expectedRevision: made.revision, payload: {} });
  await signed(context, owner, english);
  const response = await context.request.post("/api/brand-contexts/reviews/commands", { headers: { Origin: origin }, data: { operationKey: randomUUID(), submissionId: sent.submissionId, expectedRevision: 1, decision: "APPROVE" } });
  expect(response.status()).toBe(200); const approval = ContextOwnerReviewResultSchema.parse((await response.json()).data);
  await signed(context, account, english);
  const stored = await read(context, `/api/brand-contexts/version?${scopeQuery(scope)}&versionId=${approval.versionId}`, BrandContextVersionResponseSchema); expect(stored.version.content).toEqual(contextContent);
  return { contextId: made.contextId, version: stored.version };
}
function words(title: string) { return CampaignFieldsSchema.parse({ ...campaignFields, title, productService: "  منتج أصلي Original product  ", summary: "  ملخص أصلي\nOriginal campaign summary.  ",
  targetAgeBuckets: [], targetGenders: [], targetCountryCodes: [], targetCityKeys: [], dialects: [], nicheSlugs: [], contentLanguages: ["ar", "en"],
  tone: "  Independent original campaign tone  ", noGoTopics: ["  Original no-go subject  "], kpis: [], assumptions: ["  Original assumption  "], openQuestions: ["  Original open question  "] }); }
const main = (page: Page) => page.locator("main");
const button = (page: Page, copy: Copy, ar: string, en: string) => main(page).getByRole("button", { name: copy(ar, en), exact: true });
async function settled(page: Page, copy: Copy) { await expect(button(page, copy, "إلغاء الانتظار", "Cancel request")).toHaveCount(0); }
async function fillManual(page: Page, copy: Copy, fields: ReturnType<typeof words>) {
  const form = main(page).getByRole("form", { name: copy("تفاصيل الحملة", "Campaign details"), exact: true });
  for (const [ar, en, value] of [["اسم الحملة", "Campaign title", fields.title], ["المنتج أو الخدمة", "Product or service", fields.productService], ["ملخص الحملة", "Campaign summary", fields.summary],
    ["لغة النص الأصلي", "Original text language", "ar"], ["لغات المحتوى", "Content languages", "ar, en"], ["الميزانية الإجمالية", "Total budget", "123.456"],
    ["أسلوب المحتوى", "Content tone", fields.tone], ["المواضيع المحظورة", "No-go topics", fields.noGoTopics.join("\n")], ["حقوق استخدام المحتوى", "Content usage rights", fields.usageRights],
    ["الافتراضات", "Assumptions", fields.assumptions.join("\n")], ["الأسئلة المفتوحة", "Open questions", fields.openQuestions.join("\n")]] as const) {
    await form.getByLabel(copy(ar, en), { exact: true }).fill(value);
  }
  await form.getByLabel(copy("هدف الحملة", "Campaign goal"), { exact: true }).selectOption("AWARENESS");
  await form.getByLabel(copy("أسواق الحملة", "Campaign markets"), { exact: true }).selectOption("KW"); await form.getByRole("button", { name: copy("أسواق الحملة +", "Campaign markets +"), exact: true }).click();
  await form.getByRole("button", { name: copy("أضف محتوى وحدد منصته", "Add a deliverable and choose its platform"), exact: true }).click();
  await form.getByLabel(copy("المنصة", "Platform"), { exact: true }).selectOption("INSTAGRAM"); await form.getByLabel(copy("صيغة المحتوى", "Content format"), { exact: true }).selectOption("STORY");
  await form.getByLabel(copy("العدد (١–١٠٠٠)", "Count (1–1000)"), { exact: true }).fill("2");
  await form.getByLabel(copy("عملة الحملة", "Campaign currency"), { exact: true }).selectOption("KWD");
  await form.getByLabel(copy("عدد صناع المحتوى (1–12)", "Creator count (1–12)"), { exact: true }).fill("3");
  await form.getByLabel(copy("هدف مرات الظهور (اختياري)", "Impressions target (optional)"), { exact: true }).fill("10001");
  await form.getByLabel(copy("تاريخ البداية بالتوقيت المحدد", "Start in the selected timezone"), { exact: true }).fill("2026-11-01T13:00");
  await form.getByLabel(copy("تاريخ النهاية بالتوقيت المحدد", "End in the selected timezone"), { exact: true }).fill("2026-11-10T13:00");
  await form.getByLabel(copy("المنطقة الزمنية (IANA)", "Timezone (IANA)"), { exact: true }).fill("Asia/Kuwait");
}
function commandResponse(response: Response, action: string, campaignId?: string) {
  if (new URL(response.url()).pathname !== "/api/planning-campaigns/commands" || response.request().method() !== "POST") return false;
  const input = response.request().postDataJSON(); return input.action === action && (campaignId === undefined || input.campaignId === campaignId);
}
async function uiCommand(page: Page, action: string, control: Locator, copy: Copy, campaignId?: string) {
  const received = page.waitForResponse(response => commandResponse(response, action, campaignId)); await control.click();
  const response = await received; expect(response.status()).toBe(200); const result = CampaignPlanningResultSchema.parse((await response.json()).data); await settled(page, copy); return { result, input: response.request().postDataJSON() };
}
async function uiCreate(page: Page, copy: Copy, fields: ReturnType<typeof words>) {
  const version = main(page).getByLabel(copy("نسخة السياق", "Context version"), { exact: true }); await expect(version).toHaveValue(""); await version.selectOption("NONE");
  await fillManual(page, copy, fields); return uiCommand(page, "CREATE", button(page, copy, "راجع واحفظ التفاصيل", "Review and save details"), copy);
}
async function uiGenerateSubmit(page: Page, copy: Copy, campaignId: string) {
  const generated = await uiCommand(page, "GENERATE_BRIEF", button(page, copy, "جهّز الموجز للمراجعة", "Prepare brief for review"), copy, campaignId);
  await expect(main(page).getByRole("heading", { name: copy(`نسخة الموجز ${generated.result.version}`, `Brief version ${generated.result.version}`), exact: true })).toBeVisible();
  const sent = await uiCommand(page, "SUBMIT_BRIEF", button(page, copy, "أرسل النسخة لمراجعة المالك", "Submit version for owner review"), copy, campaignId); expect(sent.result.briefId).toBe(generated.result.briefId); return sent.result;
}
async function uiReviewApprove(page: Page, context: BrowserContext, copy: Copy, submissionId: string, expected: PlanningCampaign) {
  expect((await page.goto("/brand/campaigns/reviews"))?.status()).toBe(200); await expect(main(page).getByRole("heading", { name: copy("مراجعات موجز المالك", "Owner brief reviews"), exact: true })).toBeVisible();
  await expect(button(page, copy, "راجعت النسخة وأعتمدها", "I reviewed and approve this version")).toHaveCount(0);
  const row = main(page).locator(`[data-campaign-submission-id="${submissionId}"]`), loaded = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === "/api/planning-campaigns/reviews/detail" && url.searchParams.get("submissionId") === submissionId; });
  await row.getByRole("button", { name: copy("راجع النسخة المقدّمة", "Review submitted version"), exact: true }).click(); const source = await loaded; expect(source.status()).toBe(200);
  const review = CampaignOwnerReviewSchema.parse((await source.json()).data); expect(review.review.content.requirements.title).toBe(expected.campaign.title); expect(review.review.provenance.selectionId).toBe(expected.planning.selection.id);
  const summary = main(page).getByRole("article").getByText(expected.campaign.fields.summary!, { exact: true }); await expect(summary).toBeVisible(); expect(await summary.evaluate(element => element.textContent)).toBe(expected.campaign.fields.summary);
  const received = page.waitForResponse(response => new URL(response.url()).pathname === "/api/planning-campaigns/reviews/commands" && response.request().method() === "POST");
  await button(page, copy, "راجعت النسخة وأعتمدها", "I reviewed and approve this version").click(); const response = await received; expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toMatchObject({ submissionId, decision: "APPROVE", expectedRevision: 1 }); const result = CampaignOwnerReviewResultSchema.parse((await response.json()).data);
  await settled(page, copy); await expect(row.getByText(copy("معتمد", "Approved"), { exact: true })).toBeVisible();
  expect((await read(context, `/api/planning-campaigns/reviews/detail?submissionId=${submissionId}`, CampaignOwnerReviewSchema)).review.state).toBe("APPROVED"); return result;
}
async function screenshot(page: Page, info: TestInfo, stage: string) {
  mkdirSync(path.join(workspace, ".infame", "artifacts"), { recursive: true }); await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(workspace, ".infame", "artifacts", `campaign-planning-${stage}-${info.project.name}.png`), fullPage: true });
}

test("native OWN retained full form explicitly chooses NONE, reloads literal CHAT/PARAGRAPH and obtains actual immutable owner brief approval", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await company(english); await signed(context, f, english);
  await nativeCreate(context, f.scope, { title: "Synthetic native producer prerequisite" }, f); // Real producer/session before inert-screen RED.
  await page.emulateMedia({ reducedMotion: "reduce" }); expect((await page.goto("/brand/campaigns/new"))?.status()).toBe(200);
  // First UI assertion follows genuine API/setup and200 SSR, not missing-route/auth.
  await expect(main(page).getByLabel(copy("اسم الحملة", "Campaign title"), { exact: true })).toBeVisible();
  const fields = words("  حملة أصلية Manual campaign " + randomUUID().slice(0, 8) + "  "), made = await uiCreate(page, copy, fields);
  expect(made.input.payload.selection).toEqual({ kind: "NONE" }); expect(made.input.operationKey).toMatch(/^[a-f0-9-]{36}$/);
  let stored = await read(context, `/api/planning-campaigns/detail?${scopeQuery(f.scope)}&campaignId=${made.result.campaignId}`, PlanningCampaignSchema);
  expect(stored.campaign.fields).toEqual(fields); expect(stored.planning.selection.kind).toBe("NONE"); expect(stored.campaign.conversation).toEqual([]);
  for (const [mode, original] of [["CHAT", "  كلام محادثة يدوي\nLiteral manual chat.  "], ["PARAGRAPH", "  فقرة يدوية أصلية\nLiteral original paragraph.  "]] as const) {
    await main(page).getByLabel(copy("طريقة النص", "Text mode"), { exact: true }).selectOption(mode);
    await main(page).getByLabel(copy("كلماتك الأصلية", "Your original words"), { exact: true }).fill(original); await main(page).getByLabel(copy("لغة النص", "Text language"), { exact: true }).fill("ar");
    await uiCommand(page, "SAVE_NARRATIVE", button(page, copy, "احفظ النص الحرفي", "Save literal text"), copy, made.result.campaignId);
    expect((await page.goto(route(f.scope, "/" + made.result.campaignId)))?.status()).toBe(200);
    await expect(main(page).getByLabel(copy("كلماتك الأصلية", "Your original words"), { exact: true })).toHaveValue(original); await expect(main(page).getByLabel(copy("طريقة النص", "Text mode"), { exact: true })).toHaveValue(mode);
    stored = await read(context, `/api/planning-campaigns/detail?${scopeQuery(f.scope)}&campaignId=${made.result.campaignId}`, PlanningCampaignSchema);
    expect(stored.planning.narrative).toEqual({ schemaVersion: 1, mode, processing: "UNPROCESSED", originalText: { text: original, language: "ar" } }); expect(stored.campaign.conversation).toEqual([]);
  }
  const sent = await uiGenerateSubmit(page, copy, made.result.campaignId); stored = await read(context, `/api/planning-campaigns/detail?${scopeQuery(f.scope)}&campaignId=${made.result.campaignId}`, PlanningCampaignSchema);
  expect(stored.briefs[0]!.provenance).toMatchObject({ selectionId: stored.planning.selection.id, selectionRevision: stored.planning.selection.revision, versionId: null, contentHash: null });
  const approved = await uiReviewApprove(page, context, copy, sent.submissionId!, stored); expect(approved.state).toBe("APPROVED");
  const retained = await read(context, `/api/planning-campaigns/detail?${scopeQuery(f.scope)}&campaignId=${made.result.campaignId}`, PlanningCampaignSchema); expect(retained.briefs[0]!.approvedByUserId).toBe(f.user.id); expect(retained.briefs[0]!.content.requirements.budget).toEqual(fields.budget);
  expect(retained.campaign.fields).toEqual(fields); expect(retained.planning.narrative).toEqual(stored.planning.narrative); await screenshot(page, info, "own-approved");
  expect((await page.goto("/brand/campaigns"))?.status()).toBe(200); await expect(main(page).locator(`[data-campaign-id="${made.result.campaignId}"]`)).toContainText(fields.title);
  await expect(main(page).locator("input[type=file]")).toHaveCount(0); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("native exact approved context selection leaves fields alone, reviews tone KEEP/REPLACE and retains pinned provenance after parent edit/archive", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await company(english), approved = await approvedContext(context, f.scope, f, f, english);
  const fields = words("Context-pinned original campaign " + randomUUID().slice(0, 8)), made = await nativeCreate(context, f.scope, fields, f);
  await page.emulateMedia({ reducedMotion: "reduce" }); expect((await page.goto(route(f.scope, "/" + made.result.campaignId)))?.status()).toBe(200);
  await expect(main(page).getByLabel(copy("اسم الحملة", "Campaign title"), { exact: true })).toHaveValue(fields.title);
  await button(page, copy, "تحميل السياقات المتاحة", "Load available contexts").click(); await main(page).getByLabel(copy("سياق محفوظ لعرض نسخه", "Saved context to inspect"), { exact: true }).selectOption(approved.contextId);
  const choices = main(page).getByLabel(copy("نسخة السياق", "Context version"), { exact: true }); await expect(choices.locator(`option[value="${approved.version.id}"]`)).toHaveCount(1); await choices.selectOption(approved.version.id);
  await uiCommand(page, "SET_SELECTION", button(page, copy, "احفظ اختيار السياق", "Save context choice"), copy, made.result.campaignId);
  let stored = await read(context, `/api/planning-campaigns/detail?${scopeQuery(f.scope)}&campaignId=${made.result.campaignId}`, PlanningCampaignSchema); expect(stored.campaign.fields).toEqual(fields); expect(stored.planning.selectedContext?.content).toEqual(contextContent);
  const keep = await uiCommand(page, "PROPOSE_CONTEXT_TONE", button(page, copy, "اقترح النبرة الأصلية دون تطبيق", "Propose original tone without applying"), copy, made.result.campaignId);
  const keepRow = main(page).locator(`[data-campaign-proposal-id="${keep.result.proposalId}"]`);
  const kept = await uiCommand(page, "APPLY_PROPOSAL", keepRow.getByRole("button", { name: copy("احتفظ بالنبرة الحالية", "Keep current tone"), exact: true }), copy, made.result.campaignId); expect(kept.input.payload).toEqual({ proposalId: keep.result.proposalId, toneDecision: "KEEP" });
  expect((await read(context, `/api/planning-campaigns/detail?${scopeQuery(f.scope)}&campaignId=${made.result.campaignId}`, PlanningCampaignSchema)).campaign.fields).toEqual(fields);
  const replace = await uiCommand(page, "PROPOSE_CONTEXT_TONE", button(page, copy, "اقترح النبرة الأصلية دون تطبيق", "Propose original tone without applying"), copy, made.result.campaignId);
  const replaced = await uiCommand(page, "APPLY_PROPOSAL", main(page).locator(`[data-campaign-proposal-id="${replace.result.proposalId}"]`).getByRole("button", { name: copy("راجعت التغييرات وأطبقها", "I've reviewed and apply these changes"), exact: true }), copy, made.result.campaignId);
  expect(replaced.input.payload).toEqual({ proposalId: replace.result.proposalId, toneDecision: "REPLACE" });
  stored = await read(context, `/api/planning-campaigns/detail?${scopeQuery(f.scope)}&campaignId=${made.result.campaignId}`, PlanningCampaignSchema); expect(stored.campaign.fields).toEqual({ ...fields, tone: contextContent.tone.text });
  // Genuine native companion context transitions; existing context browser
  // acceptance covers its editor/archive UI. No immutable source is rewritten.
  const parent = await read(context, `/api/brand-contexts/detail?${scopeQuery(f.scope)}&contextId=${approved.contextId}`, BrandContextDetailResponseSchema);
  const edited = await nativeContextCommand(context, { operationKey: randomUUID(), scope: f.scope, contextId: approved.contextId, action: "UPDATE", expectedRevision: parent.context.revision,
    payload: { nameOriginal: parent.context.nameOriginal, content: { ...parent.context.content, positioning: { text: "New unapproved draft positioning", language: "en" }, tone: { text: "New unapproved tone", language: "en" } } } });
  await nativeContextCommand(context, { operationKey: randomUUID(), scope: f.scope, contextId: approved.contextId, action: "SET_ARCHIVED", expectedRevision: edited.revision, payload: { archived: true } });
  expect((await page.reload())?.status()).toBe(200); await expect(main(page).getByLabel(copy("أسلوب المحتوى", "Content tone"), { exact: true })).toHaveValue(contextContent.tone.text!);
  const pinned = await read(context, `/api/planning-campaigns/detail?${scopeQuery(f.scope)}&campaignId=${made.result.campaignId}`, PlanningCampaignSchema); expect(pinned.planning.selectedContext?.content).toEqual(contextContent);
  const freshTone = await nativeInput(context, f, f.scope, made.result.campaignId, "PROPOSE_CONTEXT_TONE", {}), rejected = await context.request.post("/api/planning-campaigns/commands", { headers: { Origin: origin }, data: freshTone }); expect(rejected.status()).toBe(409); expect((await rejected.json()).error.code).toBe("ARCHIVED");
  const sent = await uiGenerateSubmit(page, copy, made.result.campaignId); const final = await read(context, `/api/planning-campaigns/detail?${scopeQuery(f.scope)}&campaignId=${made.result.campaignId}`, PlanningCampaignSchema);
  expect(final.briefs[0]!.provenance).toEqual({ selectionId: final.planning.selection.id, selectionRevision: final.planning.selection.revision, versionId: approved.version.id, contentHash: approved.version.contentHash });
  await uiReviewApprove(page, context, copy, sent.submissionId!, final); await main(page).getByText(copy("اقرأ السياق المقدّم المثبت", "Read the submitted pinned context"), { exact: true }).click(); await expect(main(page).getByText(contextContent.positioning.text!, { exact: true })).toBeVisible();
  expect((await read(context, `/api/brand-contexts/version?${scopeQuery(f.scope)}&versionId=${approved.version.id}`, BrandContextVersionResponseSchema)).version).toEqual(approved.version);
  await screenshot(page, info, "context-pinned"); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("native same-Brand CLIENT A/B isolates drafts and current view/plan while actual owner without agency seat approves only submitted immutable brief", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await company(english), a = await agency(f, english, "Synthetic planning browser agency A"), b = await agency(f, english, "Synthetic planning browser agency B");
  const approved = await approvedContext(context, a.scope, a.seat, f, english); await signed(context, b.seat, english);
  const hiddenTitle = "B UNSENT PRIVATE CAMPAIGN " + randomUUID().slice(0, 8), hidden = await nativeCreate(context, b.scope, words(hiddenTitle), b.seat);
  const hiddenWords = "B unsubmitted original narrative private canary"; await nativeCommand(context, await nativeInput(context, b.seat, b.scope, hidden.result.campaignId, "SAVE_NARRATIVE", { narrative: { schemaVersion: 1, mode: "PARAGRAPH", processing: "UNPROCESSED", originalText: { text: hiddenWords, language: "en" } } }));
  await signed(context, a.seat, english); expect((await read(context, `/api/planning-campaigns?${scopeQuery(a.scope)}`, PlanningCampaignListSchema)).campaigns).toEqual([]);
  await page.emulateMedia({ reducedMotion: "reduce" }); expect((await page.goto(route(a.scope, "/new")))?.status()).toBe(200); await expect(main(page).getByLabel(copy("اسم الحملة", "Campaign title"), { exact: true })).toBeVisible();
  const fields = words("حملة الوكالة A Original " + randomUUID().slice(0, 8)), made = await uiCreate(page, copy, fields); expect(made.input.scope).toEqual(a.scope); expect(made.input.expectedAuthority).toMatchObject({ clientId: a.client.id, capability: "plan" });
  await button(page, copy, "تحميل السياقات المتاحة", "Load available contexts").click(); await main(page).getByLabel(copy("سياق محفوظ لعرض نسخه", "Saved context to inspect"), { exact: true }).selectOption(approved.contextId);
  const version = main(page).getByLabel(copy("نسخة السياق", "Context version"), { exact: true }); await expect(version.locator(`option[value="${approved.version.id}"]`)).toHaveCount(1); await version.selectOption(approved.version.id);
  await uiCommand(page, "SET_SELECTION", button(page, copy, "احفظ اختيار السياق", "Save context choice"), copy, made.result.campaignId);
  await expect(main(page)).not.toContainText(hiddenTitle); await expect(main(page)).not.toContainText(hiddenWords); const sent = await uiGenerateSubmit(page, copy, made.result.campaignId);
  const source = await read(context, `/api/planning-campaigns/detail?${scopeQuery(a.scope)}&campaignId=${made.result.campaignId}`, PlanningCampaignSchema); expect(source.currentAuthority).toMatchObject({ clientId: a.client.id, capability: "view" }); expect(source.campaign.fields).toEqual(fields);
  const agencyDecision = await context.request.post("/api/planning-campaigns/reviews/commands", { headers: { Origin: origin }, data: { operationKey: randomUUID(), submissionId: sent.submissionId, expectedRevision: 1, decision: "APPROVE" } }); expect(agencyDecision.status()).toBe(404);
  await signed(context, f, english); expect(await db.organizationMembership.count({ where: { userId: f.user.id, organizationId: { in: [a.organization.id, b.organization.id] } } })).toBe(0);
  const inbox = await read(context, "/api/planning-campaigns/reviews", CampaignOwnerReviewsSchema); expect(inbox.reviews.map(row => row.id)).toEqual([sent.submissionId]); expect(JSON.stringify(inbox)).not.toContain(hiddenTitle); expect(JSON.stringify(inbox)).not.toContain(hidden.result.campaignId);
  const denied = await context.request.get(`/api/planning-campaigns/detail?${scopeQuery(a.scope)}&campaignId=${made.result.campaignId}`); expect(denied.status()).toBe(404);
  await uiReviewApprove(page, context, copy, sent.submissionId!, source); await expect(main(page)).not.toContainText(hiddenTitle); await expect(main(page)).not.toContainText(hiddenWords); await screenshot(page, info, "client-owner-submitted");
  await signed(context, a.seat, english); expect((await page.goto(route(a.scope, "/" + made.result.campaignId)))?.status()).toBe(200);
  const approvedBrief = await read(context, `/api/planning-campaigns/detail?${scopeQuery(a.scope)}&campaignId=${made.result.campaignId}`, PlanningCampaignSchema); expect(approvedBrief.briefs[0]!.approvedByUserId).toBe(f.user.id); expect(approvedBrief.planning.selectedContext?.id).toBe(approved.version.id);
  const before = await db.campaign.findUniqueOrThrow({ where: { id: made.result.campaignId } }), receiptCount = await db.campaignPlanningCommand.count({ where: { campaignId: made.result.campaignId } });
  await setClientGrant(a.owner.actor, a.client.id, { operationKey: randomUUID(), expectedClientRevision: a.client.revision, membershipId: a.membership.id, expectedGrantRevision: a.grant.revision,
    capabilities: { view: true, plan: false, approveShortlist: false, reviewContent: false, signCustomer: false, financial: false, manageGrants: false } });
  expect((await page.reload())?.status()).toBe(200); await expect(main(page).getByLabel(copy("اسم الحملة", "Campaign title"), { exact: true })).toHaveValue(fields.title);
  await expect(button(page, copy, "راجع واحفظ التفاصيل", "Review and save details")).toBeDisabled(); await expect(button(page, copy, "جهّز الموجز للمراجعة", "Prepare brief for review")).toBeDisabled();
  const replayDenied = await context.request.post("/api/planning-campaigns/commands", { headers: { Origin: origin }, data: made.input }); expect(replayDenied.status()).toBe(404);
  expect(await db.campaign.findUniqueOrThrow({ where: { id: made.result.campaignId } })).toEqual(before); expect(await db.campaignPlanningCommand.count({ where: { campaignId: made.result.campaignId } })).toBe(receiptCount);
  expect((await page.goto(route(b.scope, "/" + hidden.result.campaignId)))?.status()).toBe(404); await expect(main(page)).not.toContainText(hiddenTitle); await expect(main(page)).not.toContainText(hiddenWords); await expect(main(page)).not.toContainText(fields.title);
});
