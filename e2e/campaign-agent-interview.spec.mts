// Exactly three journeys under the existing two locale projects (six cases).
// Actual guarded31 database/cookies/API producers; delivery loss/body seams only.
// No voice/media/provider/legal activity or browser acceptance is claimed here.
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { expect, test, type Page, type BrowserContext, type TestInfo, type Locator } from "@playwright/test";
import { taskState, assertLocalTarget, workspace } from "../scripts/task-state.mjs";
import { prisma as db } from "../src/lib/prisma";
import { openSession, resolveSession } from "../src/lib/identity";
import { SESSION_COOKIE } from "../src/lib/jwt";
import type { OrganizationActor } from "../src/lib/organizations/context";
import { createOrganization, proposeClientAssociation, authorizeClientAssociation, proposeMember, acceptMembership, setClientGrant } from "../src/lib/organizations/service";
import { getClientAuthority } from "../src/lib/organizations/loaders";
import type { PlanningScope } from "../src/lib/brand-context/contracts";
import { executeCampaignPlanningCommand, getPlanningCampaign } from "../src/lib/campaign-planning/service";
import { CampaignPlanningResultSchema, CampaignOwnerReviewResultSchema } from "../src/lib/campaign-planning/contracts";
import { executeCampaignAgentCommand, getCampaignAgent, getCampaignAgentTextSources } from "../src/lib/campaign-agent/service";
import { CampaignAgentCommandSchema, CampaignAgentResultSchema } from "../src/lib/campaign-agent/native-contracts";
import { CampaignAgentFieldKeys } from "../src/lib/campaign-agent/contracts";
import { canonicalHash } from "../src/lib/onboarding/drafts";
import { CampaignFieldsSchema } from "../src/lib/campaigns/contracts";
import { campaignFields } from "../tests/campaigns/fixtures";

const state = taskState();
if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("Interview browser witnesses require exact guarded E2E target");
const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>(), campaigns = new Set<string>(), errors = new WeakMap<Page, string[]>();
const allCaps = { view: true, plan: true, approveShortlist: true, reviewContent: true, signCustomer: true, financial: true, manageGrants: true };
// Trace network bodies would retain the authenticated recovery key response.
// Assertions and synthetic-only screenshots provide bounded browser evidence.
test.use({ trace: "off", actionTimeout: 10000 });
test.setTimeout(120000);
test.beforeAll(async () => {
  const rows = await db.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]!.id !== state.id || rows[0]!.kind !== "e2e" || rows[0]!.db !== state.targets.e2e || rows[0]!.host !== "127.0.0.1") throw new Error("Interview browser target identity mismatch");
});
test.beforeEach(async ({ page }) => {
  const seen: string[] = []; errors.set(page, seen); page.on("pageerror", error => seen.push(error.name));
  page.on("console", message => { if (message.type() === "error" && /hydrat|server.rendered|server HTML|text content.*match/i.test(message.text())) seen.push("HYDRATION_MISMATCH"); });
});
test.afterEach(async ({ page }) => {
  for (const table of ["CampaignAgentCommand", "CampaignAgentConfirmationBatch", "CampaignAgentTextSource", "CampaignAgent"] as const) if (campaigns.size) await db.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "campaignId" IN (${Prisma.join([...campaigns])})`);
  const workspaces = await db.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } });
  if (workspaces.length) {
    const ids = workspaces.map(row => row.id);
    for (const table of ["PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission", "CampaignBriefProvenance", "CampaignProposalDependency", "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding", "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const) await db.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join(ids)})`);
    await db.planningWorkspace.deleteMany({ where: { id: { in: ids } } });
  }
  await db.campaign.deleteMany({ where: { brandId: { in: [...brands] } } });
  await db.organizationCommand.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await db.clientGrant.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await db.organizationClient.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await db.organizationMembership.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await db.organization.deleteMany({ where: { id: { in: [...organizations] } } }); await db.brand.deleteMany({ where: { id: { in: [...brands] } } });
  await db.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
  if (users.size) await db.outboxEvent.deleteMany({ where: { OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await db.user.deleteMany({ where: { id: { in: [...users] } } }); for (const set of [users, brands, organizations, campaigns]) set.clear();
  expect(errors.get(page) ?? [], "Actual page/hydration error metadata").toEqual([]);
});
test.afterAll(async () => { await db.$disconnect(); });
type Copy = (ar: string, en: string) => string;
function locale(info: TestInfo) { const english = info.project.name === "english-desktop"; return { english, copy: (ar: string, en: string) => english ? en : ar }; }
async function person(english: boolean) {
  const id = randomUUID(); users.add(id); const user = await db.user.create({ data: { id, role: "BRAND", active: true, isTest: true, language: english ? "en" : "ar", name: "Synthetic interview browser actor", email: `${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  const token = await openSession(id, user.sessionVersion, user.passwordHash), current = await resolveSession(token); if (!current) throw new Error("Native browser session did not resolve");
  const actor: OrganizationActor = { userId: current.userId, role: current.role, sessionId: current.sessionId, sessionVersion: current.sessionVersion }; return { user, actor, token };
}
async function signed(context: BrowserContext, account: Awaited<ReturnType<typeof person>>, english: boolean) {
  expect((await resolveSession(account.token)) !== null).toBe(true);
  await context.addCookies([{ name: SESSION_COOKIE, value: account.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }, { name: "infame_lang", value: english ? "en" : "ar", domain: "localhost", path: "/" }]);
}
async function company(english: boolean) {
  const owner = await person(english), brand = await db.brand.create({ data: { userId: owner.user.id, slug: "interview-browser-" + randomUUID().replace(/-/g, "").slice(0, 16), name: "Synthetic original interview company", countryCode: "KW", isTest: true } });
  brands.add(brand.id); return { ...owner, brand, scope: { kind: "OWN_BRAND", brandId: brand.id } as PlanningScope };
}
async function agency(customer: Awaited<ReturnType<typeof company>>, english: boolean) {
  const owner = await person(english), seat = await person(english), { organization } = await createOrganization(owner.actor, { operationKey: randomUUID(), kind: "AGENCY", nameOriginal: "Synthetic interview browser agency" }); organizations.add(organization.id);
  const revision = async () => (await db.organization.findUniqueOrThrow({ where: { id: organization.id } })).revision;
  const proposed = await proposeClientAssociation(owner.actor, organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: await revision(), brandId: customer.brand.id });
  const { client } = await authorizeClientAssociation(customer.actor, proposed.client.id, { operationKey: randomUUID(), expectedRevision: proposed.client.revision, capabilities: allCaps });
  const invite = await proposeMember(owner.actor, organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: await revision(), targetUserId: seat.user.id });
  const { membership } = await acceptMembership(seat.actor, invite.membership.id, { operationKey: randomUUID(), expectedRevision: invite.membership.revision });
  const { grant } = await setClientGrant(owner.actor, client.id, { operationKey: randomUUID(), expectedClientRevision: client.revision, membershipId: membership.id, expectedGrantRevision: null, capabilities: allCaps });
  return { owner, seat, client, grant, scope: { kind: "CLIENT", clientId: client.id } as PlanningScope };
}
async function campaign(actor: OrganizationActor, scope: PlanningScope, fields: unknown = campaignFields) {
  const made = await executeCampaignPlanningCommand(actor, { operationKey: randomUUID(), scope, ...(scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(actor, scope.clientId, "plan") } : {}), action: "CREATE", expectedCampaignRevision: 0, expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0, payload: { fields, selection: { kind: "NONE" }, narrative: null } }); campaigns.add(made.campaignId); return made.campaignId;
}
function url(scope: PlanningScope, id: string) { return `/brand/campaigns/${id}${scope.kind === "CLIENT" ? `?clientId=${scope.clientId}` : ""}`; }
const card = (page: Page) => page.locator("[data-campaign-agent-interview]");
const button = (page: Page, copy: Copy, ar: string, en: string) => card(page).getByRole("button", { name: copy(ar, en), exact: true });
async function ready(page: Page, copy: Copy) { await expect(button(page, copy, "إيقاف الانتظار", "Stop waiting")).toHaveCount(0); await expect(card(page)).toHaveAttribute("aria-busy", "false"); }
async function mounted(page: Page, copy: Copy) {
  await expect(card(page).getByRole("heading", { name: copy("من فكرتك إلى ملف الحملة", "From your idea to a campaign profile"), exact: true })).toBeVisible();
  await expect(button(page, copy, "تحميل المقابلة", "Load interview").or(button(page, copy, "اقرأ الحالة الحالية", "Read current state"))).toBeEnabled();
  if (await button(page, copy, "تحميل المقابلة", "Load interview").count()) await button(page, copy, "تحميل المقابلة", "Load interview").click();
  await ready(page, copy);
}
async function open(page: Page, scope: PlanningScope, id: string, copy: Copy) {
  expect((await page.goto(url(scope, id)))?.status()).toBe(200); await mounted(page, copy);
}
async function reload(page: Page, copy: Copy) {
  const onDialog = (dialog: import("@playwright/test").Dialog) => { if (dialog.type() === "beforeunload") void dialog.accept(); else void dialog.dismiss(); };
  page.on("dialog", onDialog);
  try { expect((await page.reload())?.status()).toBe(200); await mounted(page, copy); }
  finally { page.off("dialog", onDialog); }
}
async function uiCommand(page: Page, copy: Copy, action: string, control: Locator) {
  const incoming = page.waitForResponse(response => new URL(response.url()).pathname === "/api/campaign-agent/commands" && response.request().method() === "POST");
  await control.click(); const response = await incoming; expect(response.status()).toBe(200); const input = CampaignAgentCommandSchema.parse(response.request().postDataJSON()); expect(input.action).toBe(action);
  const result = CampaignAgentResultSchema.parse((await response.json()).data); await ready(page, copy); return { input, result };
}
async function initializeUi(page: Page, copy: Copy) { return uiCommand(page, copy, "INITIALIZE", button(page, copy, "ابدأ المقابلة اليدوية", "Start manual interview")); }
async function seedInterview(actor: OrganizationActor, scope: PlanningScope, id: string, words?: string) {
  let view = await getCampaignAgent(actor, { scope, campaignId: id });
  const run = async (action: string, payload: unknown) => {
    const input = CampaignAgentCommandSchema.parse({ operationKey: randomUUID(), scope, campaignId: id, ...(scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(actor, scope.clientId, "plan") } : {}), action, expectedAgentRevision: view.retained?.revision ?? 0, expectedSnapshot: view.current.snapshot, payload });
    const result = await executeCampaignAgentCommand(actor, input, { channel: "FORM" }); view = await getCampaignAgent(actor, { scope, campaignId: id }); return result;
  };
  await run("INITIALIZE", { preferences: { input: "TEXT", output: "TEXT" } });
  if (words) await run("APPEND_TEXT", { originalText: { text: words, language: "en" } });
}
async function localRecovery(page: Page) { return page.evaluate(() => Object.entries(sessionStorage).filter(([key]) => key.startsWith("infame:agent-recovery:v1")).map(([key, value]) => ({ key, value }))); }
function opaqueStorage(entries: Array<{ key: string; value: string }>, words: string) {
  expect(entries.length).toBeGreaterThan(0); const joined = entries.map(item => item.value).join("\n");
  expect(joined.includes(words) || joined.includes('"originalText":') || joined.includes('"body":') || joined.includes('"keyBase64Url":')).toBe(false);
}
function deferred<T>() { let resolve!: (value: T | PromiseLike<T>) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
async function artifact(page: Page, info: TestInfo, stage: string) {
  mkdirSync(path.join(workspace, ".infame", "artifacts"), { recursive: true }); await page.screenshot({ path: path.join(workspace, ".infame", "artifacts", `campaign-interview-${stage}-${info.project.name}.png`), fullPage: true });
  await page.screenshot({ path: path.join(workspace, ".infame", "artifacts", `campaign-interview-${stage}-${info.project.name}-viewport.png`), fullPage: false });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("manual interview retains original words and12 independent unavailable preferences, confirms30 actual values and creates a separate unapproved profile", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await company(english); await signed(context, f, english);
  const fields = CampaignFieldsSchema.parse({ ...campaignFields, title: "Synthetic original profile / حملة أصلية", impressionsTarget: null,
    budget: { amountMinor: "9223372036854775807", currencyCode: "KWD" } }), id = await campaign(f.actor, f.scope, fields);
  await page.emulateMedia({ reducedMotion: "reduce" }); await open(page, f.scope, id, copy); await initializeUi(page, copy);
  const inputLabels = [["TEXT", "كتابة", "Text"], ["MEDIA", "وسائط — غير متاحة حاليًا", "Media — currently unavailable"], ["VOICE_MESSAGE", "رسالة صوتية — غير متاحة حاليًا", "Voice message — currently unavailable"], ["LIVE_VOICE", "صوت مباشر — غير متاح حاليًا", "Live voice — currently unavailable"]] as const;
  const outputLabels = [["TEXT", "نص", "Text"], ["VOICE", "صوت — غير متاح حاليًا", "Voice — currently unavailable"], ["TEXT_AND_VOICE", "نص وصوت — النص متاح", "Text and voice — text available"]] as const;
  for (const [input, arInput, enInput] of inputLabels) for (const [output, arOutput, enOutput] of outputLabels) {
    if (input !== "TEXT" || output !== "TEXT") {
      await card(page).getByRole("group", { name: copy("الإدخال", "Input"), exact: true }).getByRole("radio", { name: copy(arInput, enInput), exact: true }).check();
      await card(page).getByRole("group", { name: copy("الرد", "Output"), exact: true }).getByRole("radio", { name: copy(arOutput, enOutput), exact: true }).check();
      await uiCommand(page, copy, "SET_PREFERENCES", button(page, copy, "احفظ اختياراتي", "Save my preferences"));
    }
    const saved = await getCampaignAgent(f.actor, { scope: f.scope, campaignId: id }); expect(saved.retained?.preferences).toEqual({ input, output }); expect(saved.retained?.assistance).toEqual({ kind: "MANUAL_GUIDANCE", agent: "UNAVAILABLE" });
    await expect(page.getByRole("button", { name: copy("راجع واحفظ التفاصيل", "Review and save details"), exact: true })).toBeEnabled();
    await expect(card(page)).toContainText(copy("المساعد الذكي والوسائط والصوت غير متاحة في هذه المرحلة.", "The AI assistant, media and voice are unavailable in this phase."));
  }
  await expect(card(page).locator("input[type=file],audio,video")).toHaveCount(0);
  const words = "  Synthetic exact original words\nكلمات العميل الأصلية " + "long-original-word".repeat(40) + "  ";
  await card(page).getByLabel(copy("احكِ لنا عن الحملة", "Tell us about the campaign"), { exact: true }).fill(words);
  await card(page).getByLabel(copy("لغة الكلمات الأصلية — اختيارية", "Original words' language — optional"), { exact: true }).fill("ar");
  const savedWords = await uiCommand(page, copy, "APPEND_TEXT", button(page, copy, "احفظ كلماتي", "Save my words")); expect(savedWords.input.action).toBe("APPEND_TEXT");
  await reload(page, copy); await button(page, copy, "حمّل الكلمات المحفوظة", "Load saved words").click(); await ready(page, copy);
  const source = card(page).locator("[data-agent-text-source] p[dir=auto]"); await expect(source).toHaveText(words); expect(await source.evaluate(node => node.textContent)).toBe(words);
  expect((await getCampaignAgentTextSources(f.actor, { scope: f.scope, campaignId: id })).sources[0]?.originalText).toEqual({ text: words, language: "ar" });
  const rows = card(page).locator("[data-agent-review-field]"); await expect(rows).toHaveCount(30);
  await rows.first().getByRole("checkbox", { name: copy("راجعت هذه القيمة وأؤكّدها", "I reviewed and confirm this value"), exact: true }).check();
  await expect(page.getByRole("button", { name: copy("راجع واحفظ التفاصيل", "Review and save details"), exact: true })).toBeDisabled();
  const discardReview = button(page, copy, "ألغِ هذه المراجعة لتعديل التفاصيل", "Discard this review to edit details");
  await expect(discardReview).toBeVisible(); await discardReview.click();
  await expect(page.getByRole("button", { name: copy("راجع واحفظ التفاصيل", "Review and save details"), exact: true })).toBeEnabled();
  await expect(source).toHaveText(words);
  await expect(page.getByRole("form", { name: copy("تفاصيل الحملة", "Campaign details") }).locator("input").first()).toBeFocused();
  const reviewButton = button(page, copy, "راجع تأكيد التفاصيل الثلاثين", "Review confirmation of all 30 details"); await expect(reviewButton).toBeDisabled();
  for (const row of await rows.all()) await row.getByRole("checkbox", { name: copy("راجعت هذه القيمة وأؤكّدها", "I reviewed and confirm this value"), exact: true }).check();
  await reviewButton.focus(); await page.keyboard.press("Enter"); const dialog = page.getByRole("dialog", { name: copy("أكّد التفاصيل التي راجعتها", "Confirm the details you reviewed"), exact: true }); await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape"); await expect(reviewButton).toBeFocused(); await reviewButton.click();
  const batch = await uiCommand(page, copy, "CONFIRM_FIELDS", dialog.getByRole("button", { name: copy("أؤكّد التفاصيل الثلاثين", "Confirm all 30 details"), exact: true }));
  expect(batch.input.action).toBe("CONFIRM_FIELDS"); if (batch.input.action !== "CONFIRM_FIELDS") throw new Error("Expected actual30-field confirmation"); expect(batch.input.payload.fields).toHaveLength(30);
  const generated = await uiCommand(page, copy, "GENERATE_PROFILE", button(page, copy, "جهّز ملف الحملة للمراجعة", "Prepare campaign profile for review"));
  const brief = await db.campaignBrief.findUniqueOrThrow({ where: { id: generated.result.briefId! } }); expect(brief.approvedAt).toBeNull(); expect(brief.approvedByUserId).toBeNull();
  const profile = card(page).getByRole("region", { name: copy("ملف الحملة الناتج", "Generated campaign profile"), exact: true });
  await expect(profile.getByRole("heading", { name: fields.title, exact: true })).toBeVisible();
  await expect(profile.getByText(copy("غير معتمد", "Unapproved"), { exact: true })).toBeVisible();
  await expect(profile.locator("dl > div")).toHaveCount(30);
  await profile.getByRole("heading", { name: fields.title, exact: true }).scrollIntoViewIfNeeded();
  expect((brief.content as { requirements: unknown }).requirements).toEqual({ ...fields, campaignId: id, version: brief.version, brandCountryCode: "KW", mandatoryPolicyVersionIds: [] });
  await artifact(page, info, "interview-unapproved-profile");
  const parentSubmission = page.waitForResponse(response => new URL(response.url()).pathname === "/api/planning-campaigns/commands" && response.request().method() === "POST");
  await page.locator("main").getByRole("button", { name: copy("أرسل النسخة لمراجعة المالك", "Submit version for owner review"), exact: true }).click();
  const sentResponse = await parentSubmission; expect(sentResponse.status()).toBe(200); const sent = CampaignPlanningResultSchema.parse((await sentResponse.json()).data); expect(sent.briefId).toBe(brief.id);
  expect((await db.campaignBrief.findUniqueOrThrow({ where: { id: brief.id } })).approvedAt).toBeNull();
  await page.goto("/brand/campaigns/reviews"); const row = page.locator(`[data-campaign-submission-id="${sent.submissionId}"]`);
  await row.getByRole("button", { name: copy("راجع النسخة المقدّمة", "Review submitted version"), exact: true }).click();
  const approval = page.waitForResponse(response => new URL(response.url()).pathname === "/api/planning-campaigns/reviews/commands" && response.request().method() === "POST");
  await page.locator("main").getByRole("button", { name: copy("راجعت النسخة وأعتمدها", "I reviewed and approve this version"), exact: true }).click();
  const approvedResponse = await approval; expect(approvedResponse.status()).toBe(200); expect(CampaignOwnerReviewResultSchema.parse((await approvedResponse.json()).data).state).toBe("APPROVED");
  expect((await db.campaignBrief.findUniqueOrThrow({ where: { id: brief.id } })).approvedByUserId).toBe(f.user.id); await artifact(page, info, "profile-owner-approved");
});

test("encrypted exact request survives unknown reload, blocks parent navigation and retries unchanged while confirmed recovery performs only reads", async ({ page, context }, info) => {
  const { english, copy } = locale(info), f = await company(english); await signed(context, f, english);
  const longFields = CampaignFieldsSchema.parse({ ...campaignFields, summary: "Synthetic summary " + "s".repeat(4800),
    productService: "Synthetic product " + "p".repeat(4800), usageRights: "Synthetic rights " + "r".repeat(4800),
    assumptions: Array.from({ length: 20 }, (_, index) => "Synthetic assumption " + index + "a".repeat(440)),
    openQuestions: Array.from({ length: 20 }, (_, index) => "Synthetic question " + index + "q".repeat(440)) });
  const id = await campaign(f.actor, f.scope, longFields);
  await page.emulateMedia({ reducedMotion: "reduce" }); await open(page, f.scope, id, copy); await initializeUi(page, copy);
  const words = "  Synthetic reloadable original words\nكلمات الاستعادة الأصلية  ";
  const input = card(page).getByLabel(copy("احكِ لنا عن الحملة", "Tell us about the campaign"), { exact: true }); await input.fill(words);
  const parentLink = page.locator("main").getByRole("link", { name: copy("كل الحملات", "All campaigns"), exact: true }); await parentLink.click();
  const leave = page.getByRole("dialog", { name: copy("مدخلات غير محفوظة", "Unsaved input"), exact: true }); await expect(leave).toBeVisible(); await page.keyboard.press("Escape"); await expect(parentLink).toBeFocused();
  const endpoint = "**/api/campaign-agent/commands", attempts: string[] = [], interrupted = deferred<void>();
  await page.route(endpoint, async route => { const original = route.request().postData(); if (!original) throw new Error("Actual interview request body missing");
    const parsed = CampaignAgentCommandSchema.parse(JSON.parse(original)); if (parsed.action !== "APPEND_TEXT") { await route.continue(); return; }
    attempts.push(original); opaqueStorage(await localRecovery(page), words);
    if (attempts.length === 1) { await route.abort("failed"); interrupted.resolve(); } else await route.continue();
  });
  try {
    await button(page, copy, "احفظ كلماتي", "Save my words").click(); await interrupted.promise; await ready(page, copy);
    await expect(button(page, copy, "أعد الطلب نفسه", "Retry exact request")).toBeVisible(); const originalCount = attempts.length;
    await parentLink.click(); await expect(page).toHaveURL(new RegExp(`/brand/campaigns/${id}`));
    await expect(page.locator("main").getByRole("button", { name: copy("راجع واحفظ التفاصيل", "Review and save details"), exact: true })).toBeDisabled();
    await reload(page, copy); await expect(button(page, copy, "أعد الطلب نفسه", "Retry exact request")).toBeVisible();
    await expect(card(page).getByLabel(copy("احكِ لنا عن الحملة", "Tell us about the campaign"), { exact: true })).toHaveValue(words);
    expect(attempts.length).toBe(originalCount); opaqueStorage(await localRecovery(page), words);
    await uiCommand(page, copy, "APPEND_TEXT", button(page, copy, "أعد الطلب نفسه", "Retry exact request"));
    expect(attempts.length).toBe(2); expect(attempts[0] === attempts[1]).toBe(true);
    const original = CampaignAgentCommandSchema.parse(JSON.parse(attempts[0]!));
    expect(await db.campaignAgentCommand.count({ where: { actorUserId: f.user.id, operationKey: original.operationKey } })).toBe(1);
    expect(await db.campaignAgentTextSource.count({ where: { campaignId: id } })).toBe(1);
  } finally { await page.unroute(endpoint); }
  const knownWords = "Synthetic committed reply with failed current read", committed = deferred<void>(); let blockRead = false, businessPosts = 0;
  const stateURL = (url: URL) => url.pathname === "/api/campaign-agent";
  await page.route(stateURL, async route => { if (!blockRead) { await route.continue(); return; } await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "RETRY_REQUIRED", retryable: true }, requestId: randomUUID() }) }); });
  await page.route(endpoint, async route => { businessPosts++; const actual = await route.fetch(); expect(actual.status()).toBe(200); blockRead = true; await route.fulfill({ response: actual }); committed.resolve(); });
  try {
    await input.fill(knownWords); await button(page, copy, "احفظ كلماتي", "Save my words").click(); await committed.promise; await ready(page, copy);
    await expect(card(page)).toContainText(copy("وصل إيصال محفوظ.", "A retained receipt was received.")); await expect(button(page, copy, "أعد الطلب نفسه", "Retry exact request")).toHaveCount(0);
    opaqueStorage(await localRecovery(page), knownWords); const committedPosts = businessPosts;
    await reload(page, copy); expect(businessPosts).toBe(committedPosts);
    await expect(button(page, copy, "أعد الطلب نفسه", "Retry exact request")).toHaveCount(0);
    blockRead = false; await button(page, copy, "تحقق من الحالة الحالية", "Check current state").click(); await ready(page, copy); expect(businessPosts).toBe(committedPosts);
    expect(await db.campaignAgentTextSource.count({ where: { campaignId: id } })).toBe(2); await artifact(page, info, "encrypted-confirmed-recovery");
  } finally { blockRead = false; await page.unroute(endpoint); await page.unroute(stateURL); }
// Insert inside existing G2, immediately after its confirmed-recovery finally
// block and before closing test. Reuses actual page/context/f/copy/id/endpoint
// helpers. No new journey/project, producer/hash/auth mock or execution claim.
// Delivery failure is before the original business request reaches the server.
  const lostWords = "Synthetic cipher-loss pending words / كلمات أصلية غير ملتزمة";
  const beforeLostSources = await db.campaignAgentTextSource.count({ where: { campaignId: id } });
  const lostDelivery = deferred<void>(); let lostBody: string | null = null, lateAttempts = 0;
  await page.route(endpoint, async route => {
    const exact = route.request().postData(); if (exact === null) throw new Error("Cipher-loss original body missing");
    const original = CampaignAgentCommandSchema.parse(JSON.parse(exact));
    if (original.action !== "APPEND_TEXT") { await route.continue(); return; }
    lostBody = exact; lateAttempts++; opaqueStorage(await localRecovery(page), lostWords);
    await route.abort("failed"); lostDelivery.resolve();
  });
  try {
    await card(page).getByLabel(copy("احكِ لنا عن الحملة", "Tell us about the campaign"), { exact: true }).fill(lostWords);
    await button(page, copy, "احفظ كلماتي", "Save my words").click(); await lostDelivery.promise; await ready(page, copy);
    if (lostBody === null) throw new Error("Original lost APPEND was not captured");
    const original = CampaignAgentCommandSchema.parse(JSON.parse(lostBody));
    expect(await db.campaignAgentCommand.count({ where: { actorUserId: f.user.id, operationKey: original.operationKey } })).toBe(0);
    expect(await db.campaignAgentTextSource.count({ where: { campaignId: id } })).toBe(beforeLostSources);
    // Delete only this actor/campaign's ciphertext. Keep exact safe UNKNOWN stub.
    // Never pass secret key material into browser evaluation or artifact logs.
    const removal = await page.evaluate(({ actor, campaignId, operationKey }) => {
      let removed = 0, stubKept = false;
      for (const [key, value] of Object.entries(sessionStorage)) {
        if (!key.startsWith("infame:agent-recovery:v1")) continue;
        let item: Record<string, unknown>; try { item = JSON.parse(value); } catch { continue; }
        const bound = item.binding as { campaignId?: unknown } | undefined;
        if (item.actorReference !== actor || bound?.campaignId !== campaignId) continue;
        if (typeof item.ciphertextBase64Url === "string") { sessionStorage.removeItem(key); removed++; }
        else if (item.operationKey === operationKey && item.phase === "UNKNOWN") stubKept = true;
      }
      return { removed, stubKept };
    }, { actor: f.user.id, campaignId: id, operationKey: original.operationKey });
    expect(removal).toEqual({ removed: 1, stubKept: true });
    const beforeReloadAttempts = lateAttempts; await reload(page, copy);
    expect(lateAttempts).toBe(beforeReloadAttempts);
    await expect(card(page)).toContainText(copy("تعذّر فتح الطلب المشفّر.", "The encrypted request could not be opened."));
    await expect(button(page, copy, "أعد الطلب نفسه", "Retry exact request")).toHaveCount(0);
    await expect(button(page, copy, "احفظ كلماتي", "Save my words")).toBeDisabled();
    const outcomeResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/campaign-agent/outcome" && response.request().method() === "POST");
    await button(page, copy, "تحقق من نتيجة الطلب", "Check request outcome").click();
    const unknownReply = await outcomeResponse; expect(unknownReply.status()).toBe(200);
    expect((await unknownReply.json()).data).toMatchObject({ status: "UNKNOWN", receipt: null }); await ready(page, copy);
    expect(lateAttempts).toBe(beforeReloadAttempts);
    await expect(button(page, copy, "احفظ كلماتي", "Save my words")).toBeDisabled();
    await expect(card(page)).toContainText(copy("لم نجد إيصالًا محفوظًا.", "No retained receipt was found."));
    await button(page, copy, "راجع إنهاء الطلب السابق", "Review abandoning earlier request").click(); await ready(page, copy);
    const barrierDialog = page.getByRole("dialog", { name: copy("راجع إنهاء الطلب السابق", "Review abandoning earlier request"), exact: true });
    await expect(barrierDialog).toBeVisible();
    const confirmBarrier = barrierDialog.getByRole("button", { name: copy("أكّد الحاجز واحتفظ بكلماتي", "Confirm barrier and keep my words"), exact: true });
    await expect(confirmBarrier).toBeDisabled();
    await barrierDialog.getByRole("checkbox", { name: copy("راجعت الحالة واختيارات المتابعة", "I reviewed the state and continuation choices"), exact: true }).check();
    const barrierResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/campaign-agent/recovery-barrier" && response.request().method() === "POST");
    await confirmBarrier.click(); const barrierReply = await barrierResponse; expect(barrierReply.status()).toBe(200);
    const barrierWire = barrierReply.request().postDataJSON(), barrierReceipt = (await barrierReply.json()).data;
    expect(barrierWire.target.operationKey).toBe(original.operationKey);
    expect(barrierWire.operationKey === original.operationKey).toBe(false);
    expect(barrierReceipt).toMatchObject({ action: "RECOVERY_BARRIER", targetOperationKey: original.operationKey,
      targetOutcome: "FENCED", originalReceipt: null, replayed: false });
    await ready(page, copy); await expect(card(page).locator("[data-agent-recovery-panel]")).toHaveCount(0);
    expect(lateAttempts).toBe(beforeReloadAttempts); // Barrier never resubmitted original words.
    expect(await db.campaignAgentTextSource.count({ where: { campaignId: id } })).toBe(beforeLostSources);
    expect((await localRecovery(page)).some(item => item.value.includes(original.operationKey))).toBe(false);
    // The original could have been queued elsewhere. Deliver the exact original
    // wire through current native cookies now: its old expected revision is fenced.
    const late = await context.request.post("/api/campaign-agent/commands", { headers: { Origin: new URL(page.url()).origin, "Content-Type": "application/json" }, data: lostBody });
    expect(late.status()).toBe(409); expect((await late.json()).error.code).toBe("STALE_VERSION");
    expect(await db.campaignAgentCommand.count({ where: { actorUserId: f.user.id, operationKey: original.operationKey } })).toBe(0);
    expect(await db.campaignAgentTextSource.count({ where: { campaignId: id } })).toBe(beforeLostSources);
    await expect(button(page, copy, "اقرأ الحالة الحالية", "Read current state")).toBeEnabled(); await artifact(page, info, "explicit-fenced-cipher-loss");
  } finally { await page.unroute(endpoint); }

  // A confirmed old generation remains known history after genuine producers
  // advance more than one brief page. It must not substitute the latest profile
  // or permanently block current-authorized manual work.
  const reviewState = await getCampaignAgent(f.actor, { scope: f.scope, campaignId: id });
  const reviewedFields = CampaignFieldsSchema.parse(reviewState.current.fields);
  await executeCampaignAgentCommand(f.actor, { operationKey: randomUUID(), scope: f.scope, campaignId: id, action: "CONFIRM_FIELDS",
    expectedAgentRevision: reviewState.retained!.revision, expectedSnapshot: reviewState.current.snapshot,
    payload: { fields: CampaignAgentFieldKeys.map(field => {
      const valueHash = canonicalHash({ domain: "infame-campaign-field-value-v1", field, value: reviewedFields[field] });
      return { field, valueHash, source: { kind: "CUSTOMER_FIELD_CHOICE", capturedValueHash: valueHash } };
    }) } }, { channel: "FORM" });
  await button(page, copy, "اقرأ الحالة الحالية", "Read current state").click(); await ready(page, copy);
  let historyReadBlocked = false, generationPosts = 0;
  await page.route(stateURL, async route => {
    if (!historyReadBlocked) { await route.continue(); return; }
    await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  await page.route(endpoint, async route => {
    generationPosts++; const actual = await route.fetch(); expect(actual.status()).toBe(200);
    historyReadBlocked = true; await route.fulfill({ response: actual });
  });
  try {
    const generated = await uiCommand(page, copy, "GENERATE_PROFILE", button(page, copy, "جهّز ملف الحملة للمراجعة", "Prepare campaign profile for review"));
    await expect(card(page)).toContainText(copy("وصل إيصال محفوظ.", "A retained receipt was received."));
    for (let version = 0; version < 21; version++) {
      for (const action of ["UPDATE_FIELDS", "GENERATE_BRIEF"] as const) {
        const current = await getPlanningCampaign(f.actor, { scope: f.scope, campaignId: id });
        await executeCampaignPlanningCommand(f.actor, { operationKey: randomUUID(), scope: f.scope, campaignId: id, action,
          expectedCampaignRevision: current.campaign.revision, expectedPlanningRevision: current.planning.revision,
          expectedSelectionId: current.planning.selection.id, expectedSelectionRevision: current.planning.selection.revision,
          payload: action === "UPDATE_FIELDS" ? { patch: { tone: "Synthetic later original tone " + version } } : {} });
      }
    }
    const current = await getPlanningCampaign(f.actor, { scope: f.scope, campaignId: id });
    expect(current.briefs).toHaveLength(20); expect(current.briefs.some(brief => brief.id === generated.result.briefId)).toBe(false);
    expect(new TextEncoder().encode(JSON.stringify(current)).byteLength).toBeGreaterThan(524288);
    expect(await db.campaignBrief.count({ where: { campaignId: id } })).toBe(22);
    historyReadBlocked = false; await reload(page, copy); expect(generationPosts).toBe(1);
    await button(page, copy, "تحقق من الحالة الحالية", "Check current state").click(); await ready(page, copy);
    const acknowledgeHistory = button(page, copy, "راجعت التفاصيل؛ احتفظ بكلماتي", "Reviewed details; keep my words");
    await expect(acknowledgeHistory).toBeVisible(); await acknowledgeHistory.click(); await ready(page, copy);
    await expect(card(page).getByLabel(copy("احكِ لنا عن الحملة", "Tell us about the campaign"), { exact: true })).toBeEnabled();
    const originalProfile = card(page).getByRole("region", { name: copy("ملف الحملة الناتج", "Generated campaign profile"), exact: true });
    await expect(originalProfile).toHaveAttribute("data-agent-profile-id", generated.result.briefId!);
    await expect(originalProfile).toHaveAttribute("data-agent-profile-version", String(generated.result.briefVersion));
    await expect(originalProfile.locator("article")).toHaveCount(0);
    expect(generationPosts).toBe(1); expect((await db.campaignBrief.findUniqueOrThrow({ where: { id: generated.result.briefId! } })).approvedAt).toBeNull();
    expect(await db.campaignAgentCommand.count({ where: { actorUserId: f.user.id, operationKey: generated.input.operationKey } })).toBe(1);
  } finally { historyReadBlocked = false; await page.unroute(endpoint); await page.unroute(stateURL); }
});

test("real CLIENT permissions and401/403/404 malformed denials clear parent and interview privacy before delayed source responses can restore it", async ({ page, context }, info) => {
  const { english, copy } = locale(info); await page.emulateMedia({ reducedMotion: "reduce" });
  for (const status of [404, 401, 403]) {
    const customer = await company(english), a = await agency(customer, english), id = await campaign(a.seat.actor, a.scope, { ...campaignFields, title: `Synthetic protected parent ${status}` });
    const words = `Synthetic protected interview words ${status}`; await seedInterview(a.seat.actor, a.scope, id, words); await signed(context, a.seat, english); await open(page, a.scope, id, copy);
    await button(page, copy, "حمّل الكلمات المحفوظة", "Load saved words").click(); await ready(page, copy); await expect(card(page)).toContainText(words);
    const sourcesURL = (url: URL) => url.pathname === "/api/campaign-agent/sources", reached = deferred<void>(), release = deferred<void>(), delivered = deferred<void>();
    await page.route(sourcesURL, async route => { const actual = await route.fetch(); expect(actual.status()).toBe(200); reached.resolve(); await release.promise;
      try { await route.fulfill({ response: actual }); } catch { /* Expected aborted old delivery after private denial. */ } finally { delivered.resolve(); }
    });
    const stateURL = (url: URL) => url.pathname === "/api/campaign-agent";
    await page.route(stateURL, async route => { const actual = await route.fetch(); expect(actual.status()).toBe(status);
      await route.fulfill({ response: actual, contentType: "application/json", body: "{ malformed denied private body " + words });
    });
    try {
      await button(page, copy, "حمّل الكلمات المحفوظة", "Load saved words").click(); await reached.promise;
      if (status === 404) await db.clientGrant.update({ where: { id: a.grant.id }, data: { view: false, plan: true, revision: { increment: 1 } } });
      if (status === 401) await db.authSession.update({ where: { id: a.seat.actor.sessionId }, data: { revokedAt: new Date() } });
      if (status === 403) {
        const changed = await db.user.update({ where: { id: a.seat.user.id }, data: { role: "CREATOR" } });
        const creatorToken = await openSession(changed.id, changed.sessionVersion, changed.passwordHash);
        expect((await resolveSession(creatorToken))?.role).toBe("CREATOR");
        await context.addCookies([{ name: SESSION_COOKIE, value: creatorToken, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
      }
      await button(page, copy, "إيقاف الانتظار", "Stop waiting").click(); await ready(page, copy);
      await button(page, copy, "اقرأ الحالة الحالية", "Read current state").click();
      await expect.poll(async () => await card(page).count() === 0 || await card(page).getAttribute("aria-busy") === "false").toBe(true);
      await expect(page.locator("main")).not.toContainText(words); await expect(page.locator("main")).not.toContainText(`Synthetic protected parent ${status}`);
      await expect(card(page).getByLabel(copy("احكِ لنا عن الحملة", "Tell us about the campaign"), { exact: true })).toHaveCount(0);
      release.resolve(); await delivered.promise; await expect(page.locator("main")).not.toContainText(words);
      const persisted = await localRecovery(page); expect(persisted.every(item => !item.value.includes('"ciphertextBase64Url"') && !item.value.includes(words))).toBe(true);
      expect(await page.evaluate(() => document.documentElement.dir)).toBe(english ? "ltr" : "rtl"); await artifact(page, info, `denial-${status}`);
    } finally { release.resolve(); await page.unroute(sourcesURL); await page.unroute(stateURL); }
  }
});
