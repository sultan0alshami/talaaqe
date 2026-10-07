import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { expect, test, type BrowserContext, type Locator, type Page, type Request as BrowserRequest, type Response, type TestInfo } from "@playwright/test";
import { assertLocalTarget, taskState } from "../scripts/task-state.mjs";
import { prisma as db } from "../src/lib/prisma";
import { openSession, resolveSession } from "../src/lib/identity";
import { SESSION_COOKIE } from "../src/lib/jwt";
import type { OrganizationActor } from "../src/lib/organizations/context";
import { createOrganization, proposeClientAssociation, authorizeClientAssociation, proposeMember, acceptMembership, setClientGrant } from "../src/lib/organizations/service";
import { getClientAuthority } from "../src/lib/organizations/loaders";
import { BrandContextContentSchema, BrandContextCommandResultSchema, BrandContextDetailResponseSchema, BrandContextVersionResponseSchema,
  ContextOwnerReviewResponseSchema, ContextOwnerReviewResultSchema, type PlanningScope } from "../src/lib/brand-context/contracts";
import { ContextReferenceResponseSchema, ContextReferenceCommandResultSchema, ContextReviewReferenceResponseSchema, CampaignReviewReferenceResponseSchema,
  type ContextReferenceManifest } from "../src/lib/brand-context/reference-contracts";
import { CampaignFieldsSchema } from "../src/lib/campaigns/contracts";
import { CampaignPlanningCommandSchema, CampaignPlanningResultSchema, PlanningCampaignSchema, CampaignOwnerReviewSchema } from "../src/lib/campaign-planning/contracts";
import { byteChecksum, createLocalEvidenceStorage } from "../src/lib/evidence/storage";
import { campaignFields } from "../tests/campaigns/fixtures";

// IGNORED CANDIDATE ONLY. Relative imports target e2e/context-references.spec.mts.
// Root activates/runs after native APIs and inert retained Studio mounts exist.
// Exactly three journeys across the existing Arabic360/English desktop projects.
// Users are owned synthetic fixtures, but sessions/organization/context/campaign
// producers, native HTTP authorization, immutable manifests and LOCAL bytes are
// real. This proves no cloud provider, malware scanning, legal or MVP readiness.
// Recovery interception always calls the real route first; only its delivery is
// faulted. Multipart boundaries are not identities: compare decoded JSON/File.
const state = taskState(), origin = "http://localhost:3100";
if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("Reference browser fixtures require the exact guarded E2E target");
const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>();
const errors = new WeakMap<BrowserContext, string[]>();
const allCaps = { view: true, plan: true, approveShortlist: true, reviewContent: true, signCustomer: true, financial: true, manageGrants: true };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1kAAAAASUVORK5CYII=", "base64");
const emptyContent = BrandContextContentSchema.parse({ schemaVersion: 1, positioning: { text: null, language: null }, values: [],
  tone: { text: null, language: null }, references: [], competitors: [] });
type Copy = (ar: string, en: string) => string;
type Manifest = Extract<ContextReferenceManifest, { kind: "MANIFEST" }>;
type FileItem = Manifest["items"][number];
const commandsPath = "/api/brand-contexts/references/commands";
const commandUrl = (url: URL) => url.pathname === commandsPath;
function currentUrl(contextId: string) { return (url: URL) => url.pathname === "/api/brand-contexts/references"
  && url.searchParams.get("contextId") === contextId && !url.searchParams.has("versionId"); }
test.setTimeout(120000);

test.beforeAll(async () => {
  const rows = await db.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]!.id !== state.id || rows[0]!.kind !== "e2e" || rows[0]!.db !== state.targets.e2e || rows[0]!.host !== "127.0.0.1") throw new Error("Incorrect reference browser database identity");
});
test.beforeEach(async ({ page, context }) => {
  const seen: string[] = []; errors.set(context, seen);
  function watch(target: Page) {
    target.on("pageerror", error => seen.push(error.name));
    target.on("console", message => { if (message.type() === "error" && /hydrat|server.rendered|server HTML|text content.*match/i.test(message.text())) seen.push("HYDRATION_MISMATCH"); });
  }
  watch(page); context.on("page", watch);
});
test.afterEach(async ({ context }) => {
  const assets = await db.privateAsset.findMany({ where: { ownerUserId: { in: [...users] } }, select: { id: true, storageKey: true } });
  for (const asset of assets) expect(asset.storageKey.startsWith("local:")).toBe(true);
  const workspaces = await db.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } });
  if (workspaces.length) {
    const ids = workspaces.map(row => row.id);
    for (const table of ["ContextReferenceCommand", "ContextSubmissionReferences", "ContextReferenceState", "ContextReferenceManifest", "ContextAssetBinding",
      "PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission", "CampaignBriefProvenance", "CampaignProposalDependency",
      "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding", "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const) {
      await db.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join(ids)})`);
    }
    await db.planningWorkspace.deleteMany({ where: { id: { in: ids } } });
  }
  await db.evidenceCommand.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await db.privateAsset.deleteMany({ where: { id: { in: assets.map(asset => asset.id) } } });
  if (assets.length) {
    // Positive fixture metadata deletion precedes byte cleanup. The production
    // local adapter rechecks task identity, fixed e2e root and exact safe keys.
    const storage = await createLocalEvidenceStorage({ taskId: state.id, target: "e2e" });
    for (const asset of assets) await storage.remove(asset.storageKey.slice("local:".length));
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
  expect(errors.get(context) ?? [], "Actual page errors/hydration metadata").toEqual([]);
});
test.afterAll(async () => { await db.$disconnect(); });

function locale(info: TestInfo) { const english = info.project.name === "english-desktop"; return { english, copy: (ar: string, en: string) => english ? en : ar }; }
async function person(english: boolean) {
  const id = randomUUID(); users.add(id);
  const user = await db.user.create({ data: { id, role: "BRAND", active: true, isTest: true, language: english ? "en" : "ar",
    name: "Synthetic native reference browser actor", email: `${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  const token = await openSession(id, user.sessionVersion, user.passwordHash), current = await resolveSession(token);
  if (!current) throw new Error("Synthetic current reference browser session did not resolve");
  const actor: OrganizationActor = { userId: current.userId, role: current.role, sessionId: current.sessionId, sessionVersion: current.sessionVersion };
  return { user, token, actor };
}
type Person = Awaited<ReturnType<typeof person>>;
async function signed(context: BrowserContext, subject: Person, english: boolean) {
  expect(await resolveSession(subject.token)).not.toBeNull();
  await context.addCookies([{ name: SESSION_COOKIE, value: subject.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "infame_lang", value: english ? "en" : "ar", domain: "localhost", path: "/" }]);
}
async function company(english: boolean) {
  const owner = await person(english), brand = await db.brand.create({ data: { userId: owner.user.id, slug: "reference-browser-" + randomUUID().replace(/-/g, "").slice(0, 16),
    name: "شركة أصلية Synthetic reference company", countryCode: "KW", isTest: true } }); brands.add(brand.id);
  return { ...owner, brand, scope: { kind: "OWN_BRAND", brandId: brand.id } as const };
}
async function agency(customer: Awaited<ReturnType<typeof company>>, english: boolean, nameOriginal: string) {
  const owner = await person(english), seat = await person(english);
  const { organization } = await createOrganization(owner.actor, { operationKey: randomUUID(), kind: "AGENCY", nameOriginal }); organizations.add(organization.id);
  const revision = async () => (await db.organization.findUniqueOrThrow({ where: { id: organization.id } })).revision;
  const proposed = await proposeClientAssociation(owner.actor, organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: await revision(), brandId: customer.brand.id });
  const { client } = await authorizeClientAssociation(customer.actor, proposed.client.id, { operationKey: randomUUID(), expectedRevision: proposed.client.revision, capabilities: allCaps });
  const member = await proposeMember(owner.actor, organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: await revision(), targetUserId: seat.user.id });
  const { membership } = await acceptMembership(seat.actor, member.membership.id, { operationKey: randomUUID(), expectedRevision: member.membership.revision });
  const { grant } = await setClientGrant(owner.actor, client.id, { operationKey: randomUUID(), expectedClientRevision: client.revision, membershipId: membership.id, expectedGrantRevision: null, capabilities: allCaps });
  return { owner, seat, client, organization, membership, grant, scope: { kind: "CLIENT", clientId: client.id } as const };
}
function scopeQuery(scope: PlanningScope) { return scope.kind === "OWN_BRAND" ? `scope=OWN_BRAND&brandId=${scope.brandId}` : `scope=CLIENT&clientId=${scope.clientId}`; }
function contextRoute(scope: PlanningScope) { return "/brand/context" + (scope.kind === "CLIENT" ? `?clientId=${scope.clientId}` : ""); }
function referencePath(scope: PlanningScope, contextId: string, versionId?: string) {
  return `/api/brand-contexts/references?${scopeQuery(scope)}&contextId=${contextId}` + (versionId ? `&versionId=${versionId}` : "");
}
async function authority(account: Person, scope: PlanningScope) { return scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(account.actor, scope.clientId, "plan") } : {}; }
async function read<T>(context: BrowserContext, url: string, schema: z.ZodType<T>) {
  const response = await context.request.get(url); expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toBe("private, no-store");
  const body = await response.json(); expect(body.requestId).toBe(response.headers()["x-request-id"]); return schema.parse(body.data);
}
async function contextCommand(context: BrowserContext, input: unknown) {
  const response = await context.request.post("/api/brand-contexts/commands", { headers: { Origin: origin }, data: input }); expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("private, no-store"); return BrandContextCommandResultSchema.parse((await response.json()).data);
}
async function createContext(context: BrowserContext, account: Person, scope: PlanningScope, name: string, positioning: string) {
  return contextCommand(context, { operationKey: randomUUID(), scope, ...(await authority(account, scope)), action: "CREATE", expectedRevision: 0,
    payload: { nameOriginal: { text: name, language: "ar" }, content: { ...emptyContent, positioning: { text: positioning, language: "ar" } } } });
}
async function contextStep(context: BrowserContext, account: Person, scope: PlanningScope, contextId: string, action: "SUBMIT" | "SET_ARCHIVED", payload: unknown) {
  const source = await read(context, `/api/brand-contexts/detail?${scopeQuery(scope)}&contextId=${contextId}`, BrandContextDetailResponseSchema);
  return contextCommand(context, { operationKey: randomUUID(), scope, ...(await authority(account, scope)), contextId, action, expectedRevision: source.context.revision, payload });
}
function manifest(value: ContextReferenceManifest): Manifest { if (value.kind !== "MANIFEST") throw new Error("Native read did not contain a recorded manifest"); return value; }
const panel = (page: Page) => page.locator("[data-context-reference-panel]");
const fileButton = (within: Locator, copy: Copy, ar: string, en: string) => within.getByRole("button", { name: copy(ar, en), exact: true });
function literalLabel(within: Locator, copy: Copy) { return within.getByLabel(copy("عنوان الملف الأصلي", "Original file label"), { exact: true }); }
function originalLanguage(field: Locator, copy: Copy) { return field.locator("xpath=../..").getByLabel(copy("لغة النص الأصلي", "Original text language"), { exact: true }); }
async function loadFiles(page: Page, within: Locator, copy: Copy, url: string, schema: z.ZodType<unknown>, refresh = false) {
  const path = new URL(url, origin), received = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === path.pathname
    && new URL(response.url()).search === path.search);
  await fileButton(within, copy, refresh ? "تحديث القراءة" : "تحميل الملفات", refresh ? "Refresh read" : "Load files").click();
  const response = await received; expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toBe("private, no-store"); return schema.parse((await response.json()).data);
}
async function loadCurrent(page: Page, copy: Copy, scope: PlanningScope, contextId: string) {
  const received = page.waitForResponse(response => currentUrl(contextId)(new URL(response.url())) && response.request().method() === "GET");
  await fileButton(panel(page), copy, "تحميل الملفات الخاصة", "Load private files").click();
  const response = await received; expect(response.status()).toBe(200); return ContextReferenceResponseSchema.parse((await response.json()).data);
}
async function openContext(page: Page, contextId: string, name: string) {
  await page.locator(`[data-context-id="${contextId}"]`).getByRole("button", { name: name.trim(), exact: true }).click();
}
async function selectFile(page: Page, copy: Copy, filename: string, label: string, notes: string | null = null) {
  const within = panel(page); await within.getByLabel(copy("الملف المرجعي", "Reference file"), { exact: true }).setInputFiles({ name: filename, mimeType: "image/png", buffer: png });
  const labelInput = literalLabel(within, copy); await labelInput.fill(label); await originalLanguage(labelInput, copy).fill("ar-SA");
  if (notes !== null) {
    await within.getByLabel(copy("لم أقدّم ملاحظات", "Notes not supplied"), { exact: true }).uncheck();
    const notesInput = within.getByLabel(copy("الملاحظات الأصلية", "Original notes"), { exact: true }).last(); await notesInput.fill(notes); await originalLanguage(notesInput, copy).fill("ar");
  }
  await expect(within.getByRole("img", { name: copy("معاينة الصورة المختارة محليًا", "Local preview of the selected image"), exact: true })).toBeVisible();
}
function isFileCommand(response: Response) { return new URL(response.url()).pathname === commandsPath && response.request().method() === "POST"; }
async function uploadUI(page: Page, copy: Copy) {
  const received = page.waitForResponse(isFileCommand); await fileButton(panel(page), copy, "رفع الملف الخاص", "Upload private file").click();
  const response = await received; expect(response.status()).toBe(200); const result = ContextReferenceCommandResultSchema.parse((await response.json()).data);
  await expect(panel(page).getByRole("region", { name: copy("استعادة الطلب", "Request recovery"), exact: true })).toHaveCount(0);
  await expect(literalLabel(panel(page), copy)).toHaveCount(0); return result;
}
async function nativeUpload(context: BrowserContext, account: Person, scope: PlanningScope, contextId: string, label: string) {
  const current = await read(context, referencePath(scope, contextId), ContextReferenceResponseSchema);
  const command = { operationKey: randomUUID(), scope, ...(await authority(account, scope)), contextId, action: "UPLOAD",
    expectedRevision: current.revision, expectedReferenceRevision: current.references.kind === "MANIFEST" ? current.references.revision : 0,
    payload: { labelOriginal: { text: label, language: "ar-SA" }, notesOriginal: { text: null, language: null } } };
  const response = await context.request.post(commandsPath, { headers: { Origin: origin }, multipart: {
    command: { name: "command.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(command)) },
    file: { name: "مرجع-أصلي.png", mimeType: "image/png", buffer: png },
  } });
  expect(response.status()).toBe(200); return ContextReferenceCommandResultSchema.parse((await response.json()).data);
}
async function nativeRemove(context: BrowserContext, account: Person, scope: PlanningScope, contextId: string) {
  const source = await read(context, referencePath(scope, contextId), ContextReferenceResponseSchema);
  const response = await context.request.post(commandsPath, { headers: { Origin: origin }, data: {
    operationKey: randomUUID(), scope, ...(await authority(account, scope)), contextId, action: "REPLACE", expectedRevision: source.revision,
    expectedReferenceRevision: manifest(source.references).revision, payload: { items: [] },
  } });
  expect(response.status()).toBe(200); return ContextReferenceCommandResultSchema.parse((await response.json()).data);
}
async function exactItem(within: Locator, item: FileItem) {
  const row = within.locator(`[data-reference-binding="${item.bindingId}"]`); await expect(row).toBeVisible();
  expect(await row.locator("p").first().evaluate(element => element.textContent)).toBe(item.labelOriginal.text);
  await expect(row).toContainText(item.contentType); await expect(row).toContainText(item.labelOriginal.language!); return row;
}
async function actualLocalBytes(item: FileItem) {
  const stored = await db.privateAsset.findUniqueOrThrow({ where: { id: item.assetId } });
  expect(stored).toMatchObject({ purpose: "MARKETING_REFERENCE", contentType: "image/png", size: png.byteLength, checksum: byteChecksum(png), deletedAt: null });
  expect(stored.storageKey.startsWith("local:")).toBe(true);
  const storage = await createLocalEvidenceStorage({ taskId: state.id, target: "e2e" }); expect(storage.kind).toBe("LOCAL"); expect(Buffer.from(await storage.get(stored.storageKey.slice("local:".length)))).toEqual(png);
}
async function downloadBytes(page: Page, within: Locator, item: FileItem, copy: Copy, url: string, keyboard = false) {
  const row = await exactItem(within, item), control = row.getByRole("button", { name: copy("تنزيل: ", "Download: ") + item.labelOriginal.text.trim(), exact: true });
  const request = page.waitForResponse(response => response.url() === new URL(url, origin).href && response.request().method() === "GET"), received = page.waitForEvent("download");
  if (keyboard) { await control.focus(); await expect(control).toBeFocused(); await control.press("Enter"); } else await control.click();
  const response = await request; expect(response.status()).toBe(200); expect(response.headers()).toMatchObject({ "cache-control": "private, no-store", "content-type": "image/png", "x-content-type-options": "nosniff" });
  expect(response.headers()["content-disposition"]).toMatch(/^attachment;/);
  // Browser/CDP Response.body() may omit attachment bytes. Prove the completed
  // actual UI download instead, both through its saved artifact and byte stream.
  const download = await received; expect(await download.failure()).toBeNull(); const savedPath = await download.path(); if (!savedPath) throw new Error("Native download omitted its saved artifact");
  const savedBytes = await readFile(savedPath); expect(savedBytes.byteLength).toBe(item.size); expect(savedBytes).toEqual(png);
  const stream = await download.createReadStream(); if (!stream) throw new Error("Native download omitted bytes");
  const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk)); expect(Buffer.concat(chunks)).toEqual(png);
}
async function contextReviewUI(page: Page, copy: Copy, submissionId: string) {
  expect((await page.goto("/brand/context/reviews"))?.status()).toBe(200);
  const received = page.waitForResponse(response => new URL(response.url()).pathname === "/api/brand-contexts/reviews/detail" && new URL(response.url()).searchParams.get("submissionId") === submissionId);
  await page.locator(`[data-context-submission-id="${submissionId}"]`).getByRole("button", { name: copy("مراجعة الطلب", "Review submission"), exact: true }).click();
  const response = await received; expect(response.status()).toBe(200); return ContextOwnerReviewResponseSchema.parse((await response.json()).data);
}
function submittedPanel(page: Page, copy: Copy) { return page.locator("[data-reference-read-only-panel]").filter({ has: page.getByRole("heading", { name: copy("الملفات المقدّمة للمراجعة", "Files submitted for review"), exact: true }) }); }
async function screenshot(page: Page, info: TestInfo, name: string) { await info.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" }); }
async function campaignCommand(context: BrowserContext, input: unknown) {
  const response = await context.request.post("/api/planning-campaigns/commands", { headers: { Origin: origin }, data: CampaignPlanningCommandSchema.parse(input) });
  expect(response.status()).toBe(200); return CampaignPlanningResultSchema.parse((await response.json()).data);
}
async function campaignStep(context: BrowserContext, account: Person, scope: PlanningScope, campaignId: string, action: "GENERATE_BRIEF" | "SUBMIT_BRIEF", payload: unknown) {
  const current = await read(context, `/api/planning-campaigns/detail?${scopeQuery(scope)}&campaignId=${campaignId}`, PlanningCampaignSchema);
  return campaignCommand(context, { operationKey: randomUUID(), scope, ...(await authority(account, scope)), campaignId, action, payload,
    expectedCampaignRevision: current.campaign.revision, expectedPlanningRevision: current.planning.revision,
    expectedSelectionId: current.planning.selection.id, expectedSelectionRevision: current.planning.selection.revision });
}

test("native OWN no-website save uploads exact Arabic PNG metadata and bytes, approves its submission and retains old approved files after draft removal/reload", async ({ page, context }, info) => {
  const { english, copy } = locale(info), owner = await company(english); await signed(context, owner, english);
  const prerequisite = await createContext(context, owner, owner.scope, "Synthetic native API prerequisite", "Native producer before file-panel RED");
  await contextStep(context, owner, owner.scope, prerequisite.contextId, "SET_ARCHIVED", { archived: true });
  await page.emulateMedia({ reducedMotion: "reduce" }); expect((await page.goto(contextRoute(owner.scope)))?.status()).toBe(200);
  const name = "سياق بدون موقع " + randomUUID().slice(0, 8), positioning = "  تموضع أصلي بدون موقع\nOriginal no-website words.  ";
  await page.getByLabel(copy("اسم السياق", "Context name"), { exact: true }).fill(name);
  const nameLanguage = page.locator('[data-context-field="name"]').getByLabel(copy("لغة النص", "Text language"), { exact: true });
  if (await nameLanguage.evaluate(element => element.tagName === "SELECT")) await nameLanguage.selectOption("ar"); else await nameLanguage.fill("ar");
  await page.getByLabel(copy("التموضع", "Positioning"), { exact: true }).fill(positioning);
  const savedReply = page.waitForResponse(response => new URL(response.url()).pathname === "/api/brand-contexts/commands" && response.request().postDataJSON()?.action === "CREATE");
  await page.getByRole("button", { name: copy("حفظ السياق", "Save context"), exact: true }).click();
  const savedResponse = await savedReply; expect(savedResponse.status()).toBe(200); const saved = BrandContextCommandResultSchema.parse((await savedResponse.json()).data);
  const source = await read(context, `/api/brand-contexts/detail?${scopeQuery(owner.scope)}&contextId=${saved.contextId}`, BrandContextDetailResponseSchema);
  expect(source.context.content.references).toEqual([]); expect(source.context.content.positioning.text).toBe(positioning);
  // Genuine native producer/200 SSR/UI save precedes the first file assertion.
  await expect(panel(page).getByRole("heading", { name: copy("ملفات السياق الخاصة", "Private context files"), exact: true })).toBeVisible();
  expect((await loadCurrent(page, copy, owner.scope, saved.contextId)).references.kind).toBe("LEGACY_ABSENT");
  const prefix = "  مرجع_أصلي_", label = prefix + "W".repeat(200 - prefix.length - 2) + "  ", notes = "  ملاحظات أصلية\nتُحفظ المسافات والكلمات.  "; expect(label).toHaveLength(200);
  await selectFile(page, copy, "مرجع-بدون-موقع.png", label, notes); const uploaded = await uploadUI(page, copy);
  const current = await read(context, referencePath(owner.scope, saved.contextId), ContextReferenceResponseSchema), files = manifest(current.references), item = files.items[0]!;
  expect(files.items).toHaveLength(1); expect(item).toMatchObject({ bindingId: uploaded.bindingId, contentType: "image/png", size: png.byteLength,
    labelOriginal: { text: label, language: "ar-SA" }, notesOriginal: { text: notes, language: "ar" } });
  expect(current.inputRevision).toBe(source.context.inputRevision); expect(current.revision).toBe(saved.revision + 1); await actualLocalBytes(item);
  const savedList = panel(page).getByRole("region", { name: copy("القائمة المحفوظة الحالية", "Current saved list"), exact: true });
  const row = await exactItem(savedList, item); await downloadBytes(page, savedList, item, copy,
    `/api/brand-contexts/references/assets/${item.bindingId}?${scopeQuery(owner.scope)}&contextId=${saved.contextId}`, true);
  const geometry = await row.locator("p").first().evaluate(element => { const range = document.createRange(); range.selectNodeContents(element);
    const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0); return { lines: rects.length, inside: rects.every(rect => rect.left >= 0 && rect.right <= innerWidth) }; });
  expect(geometry.inside).toBe(true); if (!english) expect(geometry.lines).toBeGreaterThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  const submitReply = page.waitForResponse(response => new URL(response.url()).pathname === "/api/brand-contexts/commands" && response.request().postDataJSON()?.action === "SUBMIT");
  await page.getByRole("button", { name: copy("إرسال لمراجعة المالك", "Submit for owner review"), exact: true }).click();
  const submittedResponse = await submitReply; expect(submittedResponse.status()).toBe(200); const sent = BrandContextCommandResultSchema.parse((await submittedResponse.json()).data); expect(sent.submissionId).not.toBeNull();
  await contextReviewUI(page, copy, sent.submissionId!); const reviewFiles = submittedPanel(page, copy);
  const pinned = await loadFiles(page, reviewFiles, copy, `/api/brand-contexts/reviews/references?submissionId=${sent.submissionId}`, ContextReviewReferenceResponseSchema);
  expect(ContextReviewReferenceResponseSchema.parse(pinned)).toEqual({ submissionId: sent.submissionId, contextId: saved.contextId, references: files });
  await downloadBytes(page, reviewFiles, item, copy, `/api/brand-contexts/reviews/references/assets/${item.bindingId}?submissionId=${sent.submissionId}`);
  const approvedReply = page.waitForResponse(response => new URL(response.url()).pathname === "/api/brand-contexts/reviews/commands" && response.request().method() === "POST");
  await page.getByRole("button", { name: copy("اعتماد هذه النسخة", "Approve this version"), exact: true }).click();
  const approvedResponse = await approvedReply; expect(approvedResponse.status()).toBe(200); const approved = ContextOwnerReviewResultSchema.parse((await approvedResponse.json()).data);
  expect(approved.state).toBe("APPROVED"); expect(approved.versionId).not.toBeNull();
  await expect(page.locator(`[data-context-submission-id="${sent.submissionId}"]`).getByText(copy("معتمد", "Approved"), { exact: true })).toBeVisible();
  const historical = await read(context, `/api/brand-contexts/version?${scopeQuery(owner.scope)}&versionId=${approved.versionId}`, BrandContextVersionResponseSchema);
  expect((await page.goto(contextRoute(owner.scope)))?.status()).toBe(200); await openContext(page, saved.contextId, name); await loadCurrent(page, copy, owner.scope, saved.contextId);
  await panel(page).locator(`[data-reference-editor-binding="${item.bindingId}"]`).getByRole("button", { name: copy("إزالة من المسودة", "Remove from draft"), exact: true }).click();
  await fileButton(panel(page), copy, "حفظ عناوين الملفات وترتيبها", "Save file labels and order").click(); const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: copy("تأكيد إزالة الملفات من القائمة الحالية", "Confirm removal from the current file list"), exact: true })).toBeVisible();
  const removalReply = page.waitForResponse(isFileCommand); await dialog.getByRole("button", { name: copy("تأكيد الإزالة والحفظ", "Confirm removal and save"), exact: true }).click();
  expect((await removalReply).status()).toBe(200); await expect(dialog).toHaveCount(0); await expect(panel(page).locator("[data-reference-binding]")).toHaveCount(0);
  expect((await page.reload())?.status()).toBe(200); await openContext(page, saved.contextId, name); const removed = await loadCurrent(page, copy, owner.scope, saved.contextId);
  expect(manifest(removed.references).items).toEqual([]); expect(removed.inputRevision).toBe(source.context.inputRevision);
  const versionFiles = page.locator(`[data-context-version-id="${approved.versionId}"]`).locator("[data-reference-read-only-panel]");
  await expect(versionFiles.getByRole("heading", { name: copy("ملفات النسخة المعتمدة", "Approved version files"), exact: true })).toBeVisible();
  const old = await loadFiles(page, versionFiles, copy, referencePath(owner.scope, saved.contextId, approved.versionId!), ContextReferenceResponseSchema);
  expect(ContextReferenceResponseSchema.parse(old)).toMatchObject({ contextId: saved.contextId, versionId: approved.versionId, references: files });
  await downloadBytes(page, versionFiles, item, copy, `/api/brand-contexts/references/assets/${item.bindingId}?${scopeQuery(owner.scope)}&contextId=${saved.contextId}&versionId=${approved.versionId}`);
  expect((await read(context, `/api/brand-contexts/version?${scopeQuery(owner.scope)}&versionId=${approved.versionId}`, BrandContextVersionResponseSchema)).version).toEqual(historical.version);
  await actualLocalBytes(item); await screenshot(page, info, "owned-approved-file-retained-after-removal");
});

test("native same-Brand CLIENT isolation/view-only and seatless actual-owner context/campaign pins survive draft removal/archive; denied file read clears private parents", async ({ page, context }, info) => {
  const { english, copy } = locale(info), owner = await company(english), a = await agency(owner, english, "Synthetic native file agency A"), b = await agency(owner, english, "Synthetic native file agency B");
  const aName = "سياق العميل أ " + randomUUID().slice(0, 8), aWords = "PRIVATE EXACT A ORIGINAL WORDS", aLabel = "  مرجع خاص للعميل أ  ", bName = "B OTHER CLIENT PRIVATE CANARY", bLabel = "مرجع_العميل_الآخر_خاص";
  await signed(context, a.seat, english); const made = await createContext(context, a.seat, a.scope, aName, aWords); await nativeUpload(context, a.seat, a.scope, made.contextId, aLabel);
  const original = await read(context, referencePath(a.scope, made.contextId), ContextReferenceResponseSchema), files = manifest(original.references), item = files.items[0]!; await actualLocalBytes(item);
  await signed(context, b.seat, english); const other = await createContext(context, b.seat, b.scope, bName, "B UNSUBMITTED PRIVATE WORDS"); await nativeUpload(context, b.seat, b.scope, other.contextId, bLabel);
  await signed(context, a.seat, english); const sent = await contextStep(context, a.seat, a.scope, made.contextId, "SUBMIT", {}); expect(sent.submissionId).not.toBeNull();
  await signed(context, owner, english); expect(await db.organizationMembership.count({ where: { userId: owner.user.id, organizationId: { in: [a.organization.id, b.organization.id] } } })).toBe(0);
  expect((await context.request.get(referencePath(a.scope, made.contextId))).status()).toBe(404);
  const approvalResponse = await context.request.post("/api/brand-contexts/reviews/commands", { headers: { Origin: origin }, data: { operationKey: randomUUID(), submissionId: sent.submissionId, expectedRevision: 1, decision: "APPROVE" } });
  expect(approvalResponse.status()).toBe(200); const approved = ContextOwnerReviewResultSchema.parse((await approvalResponse.json()).data); expect(approved.versionId).not.toBeNull();
  await signed(context, a.seat, english); const selected = (await read(context, `/api/brand-contexts/version?${scopeQuery(a.scope)}&versionId=${approved.versionId}`, BrandContextVersionResponseSchema)).version;
  const campaign = await campaignCommand(context, { operationKey: randomUUID(), scope: a.scope, ...(await authority(a.seat, a.scope)), action: "CREATE",
    expectedCampaignRevision: 0, expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0,
    payload: { fields: CampaignFieldsSchema.parse({ ...campaignFields, title: "Native exact reference-pinned campaign" }),
      selection: { kind: "APPROVED_CONTEXT", versionId: selected.id, contentHash: selected.contentHash }, narrative: null } });
  const generated = await campaignStep(context, a.seat, a.scope, campaign.campaignId, "GENERATE_BRIEF", {}); expect(generated.briefId).not.toBeNull(); expect(generated.version).not.toBeNull();
  const campaignSent = await campaignStep(context, a.seat, a.scope, campaign.campaignId, "SUBMIT_BRIEF", { briefId: generated.briefId, expectedBriefVersion: generated.version }); expect(campaignSent.submissionId).not.toBeNull();
  await nativeRemove(context, a.seat, a.scope, made.contextId);
  expect((await context.request.get(`/api/evidence/assets/${item.assetId}`)).status()).toBe(404);
  expect((await context.request.get(referencePath(b.scope, other.contextId))).status()).toBe(404);
  expect((await context.request.get(`/api/brand-contexts/references/assets/${item.bindingId}?${scopeQuery(b.scope)}&contextId=${other.contextId}`)).status()).toBe(404);
  let grant = (await setClientGrant(a.owner.actor, a.client.id, { operationKey: randomUUID(), expectedClientRevision: a.client.revision,
    membershipId: a.membership.id, expectedGrantRevision: a.grant.revision, capabilities: { ...allCaps, plan: false } })).grant;
  expect((await context.request.get(`/api/organization-clients/${a.client.id}/authority?capability=plan`)).status()).toBe(404);
  await page.emulateMedia({ reducedMotion: "reduce" }); expect((await page.goto(contextRoute(a.scope)))?.status()).toBe(200);
  await openContext(page, made.contextId, aName);
  // Native exact CLIENT producers/permissions/200 SSR precede file-panel RED.
  await expect(panel(page).getByRole("heading", { name: copy("ملفات السياق الخاصة", "Private context files"), exact: true })).toBeVisible();
  const view = await loadCurrent(page, copy, a.scope, made.contextId); expect(view.currentAuthority).toMatchObject({ capability: "view", clientId: a.client.id }); expect(view.archived).toBe(false); expect(manifest(view.references).items).toEqual([]);
  await expect(panel(page).getByLabel(copy("الملف المرجعي", "Reference file"), { exact: true })).toBeDisabled();
  for (const pair of [["حفظ عناوين الملفات وترتيبها", "Save file labels and order"], ["رفع الملف الخاص", "Upload private file"]]) {
    const control = fileButton(panel(page), copy, pair[0]!, pair[1]!); if (await control.count()) await expect(control).toBeDisabled(); else await expect(control).toHaveCount(0);
  }
  for (const canary of [bName, bLabel, "B UNSUBMITTED PRIVATE WORDS"]) await expect(page.locator("body")).not.toContainText(canary);
  expect((await page.goto(contextRoute(b.scope)))?.status()).toBe(200); await expect(page.locator("[data-context-id]")).toHaveCount(0);
  for (const canary of [aName, aLabel, aWords, bName, bLabel]) await expect(page.locator("body")).not.toContainText(canary);
  expect((await page.goto(contextRoute(a.scope)))?.status()).toBe(200); await openContext(page, made.contextId, aName);
  const versionFiles = page.locator(`[data-context-version-id="${selected.id}"]`).locator("[data-reference-read-only-panel]");
  const retained = await loadFiles(page, versionFiles, copy, referencePath(a.scope, made.contextId, selected.id), ContextReferenceResponseSchema); expect(ContextReferenceResponseSchema.parse(retained)).toMatchObject({ contextId: made.contextId, versionId: selected.id, references: files });
  grant = (await setClientGrant(a.owner.actor, a.client.id, { operationKey: randomUUID(), expectedClientRevision: a.client.revision,
    membershipId: a.membership.id, expectedGrantRevision: grant.revision, capabilities: { ...allCaps, view: false, plan: false } })).grant;
  expect(grant.capabilities.view).toBe(false);
  const deniedReply = page.waitForResponse(response => new URL(response.url()).pathname === "/api/brand-contexts/references" && new URL(response.url()).searchParams.get("versionId") === selected.id);
  await fileButton(versionFiles, copy, "تحديث القراءة", "Refresh read").click(); expect((await deniedReply).status()).toBe(404);
  await expect(page.locator("[data-context-id], [data-context-version-id], [data-reference-binding], [data-reference-editor-binding]")).toHaveCount(0);
  await expect(page.getByLabel(copy("اسم السياق", "Context name"), { exact: true })).toHaveCount(0);
  for (const canary of [aName, aLabel, aWords, bName, bLabel]) await expect(page.locator("body")).not.toContainText(canary);
  // Restore only the fixture seat's native grant to archive the active parent.
  // The actual company owner still has no agency seat/grant and uses only pins.
  await setClientGrant(a.owner.actor, a.client.id, { operationKey: randomUUID(), expectedClientRevision: a.client.revision,
    membershipId: a.membership.id, expectedGrantRevision: grant.revision, capabilities: allCaps });
  await signed(context, a.seat, english); await contextStep(context, a.seat, a.scope, made.contextId, "SET_ARCHIVED", { archived: true });
  await signed(context, owner, english); await contextReviewUI(page, copy, sent.submissionId!); const contextFiles = submittedPanel(page, copy);
  const contextPin = await loadFiles(page, contextFiles, copy, `/api/brand-contexts/reviews/references?submissionId=${sent.submissionId}`, ContextReviewReferenceResponseSchema); expect(ContextReviewReferenceResponseSchema.parse(contextPin)).toEqual({ submissionId: sent.submissionId, contextId: made.contextId, references: files });
  expect((await db.brandContext.findUniqueOrThrow({ where: { id: made.contextId } })).archived).toBe(true);
  expect(await db.organizationMembership.count({ where: { userId: owner.user.id, organizationId: a.organization.id } })).toBe(0);
  await downloadBytes(page, contextFiles, item, copy, `/api/brand-contexts/reviews/references/assets/${item.bindingId}?submissionId=${sent.submissionId}`);
  for (const canary of [bName, bLabel, "B UNSUBMITTED PRIVATE WORDS"]) await expect(page.locator("body")).not.toContainText(canary);
  expect((await page.goto("/brand/campaigns/reviews"))?.status()).toBe(200);
  const campaignRead = page.waitForResponse(response => new URL(response.url()).pathname === "/api/planning-campaigns/reviews/detail" && new URL(response.url()).searchParams.get("submissionId") === campaignSent.submissionId);
  await page.locator(`[data-campaign-submission-id="${campaignSent.submissionId}"]`).getByRole("button", { name: copy("راجع النسخة المقدّمة", "Review submitted version"), exact: true }).click();
  const campaignResponse = await campaignRead; expect(campaignResponse.status()).toBe(200); expect(CampaignOwnerReviewSchema.parse((await campaignResponse.json()).data).review.provenance.versionId).toBe(selected.id);
  const campaignFiles = submittedPanel(page, copy), campaignPin = await loadFiles(page, campaignFiles, copy, `/api/planning-campaigns/reviews/references?submissionId=${campaignSent.submissionId}`, CampaignReviewReferenceResponseSchema);
  expect(CampaignReviewReferenceResponseSchema.parse(campaignPin)).toMatchObject({ submissionId: campaignSent.submissionId, campaignId: campaign.campaignId, contextVersionId: selected.id, references: files });
  await downloadBytes(page, campaignFiles, item, copy, `/api/planning-campaigns/reviews/references/assets/${item.bindingId}?submissionId=${campaignSent.submissionId}`, true);
  await actualLocalBytes(item); await screenshot(page, info, "seatless-owner-exact-campaign-file-pin");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

type CapturedUpload = { json: string; command: { operationKey: string; contextId: string }; filename: string; contentType: string; bytes: Buffer };
async function decodeUpload(request: BrowserRequest): Promise<CapturedUpload> {
  const bytes = request.postDataBuffer(); if (!bytes) throw new Error("Actual browser upload omitted multipart bytes");
  const form = await new globalThis.Response(new Uint8Array(bytes), { headers: { "Content-Type": request.headers()["content-type"]! } }).formData();
  expect([...form.keys()].sort()).toEqual(["command", "file"]); const metadata = form.get("command"), file = form.get("file");
  if (!(metadata instanceof File) || !(file instanceof File)) throw new Error("Actual browser upload did not contain exact command/File parts");
  const json = await metadata.text(), command = z.object({ operationKey: z.uuid(), contextId: z.string().min(1) }).passthrough().parse(JSON.parse(json));
  return { json, command, filename: file.name, contentType: file.type, bytes: Buffer.from(await file.arrayBuffer()) };
}

test("post-native committed lost upload retries exact UUID/JSON/File without duplicate mutation, confirmed receipt reads GET only, retained selection survives read/language/navigation and malformed native revoked401 clears private UI", async ({ page, context }, info) => {
  const { english, copy: initialCopy } = locale(info), owner = await company(english); await signed(context, owner, english);
  const name = "PRIVATE RECOVERY CONTEXT " + randomUUID().slice(0, 8), originalWords = "PRIVATE ORIGINAL RECOVERY WORDS";
  const made = await createContext(context, owner, owner.scope, name, originalWords); await nativeUpload(context, owner, owner.scope, made.contextId, "مرجع_محفوظ_سابق");
  const alternateName = "Second native context for navigation intent", alternate = await createContext(context, owner, owner.scope, alternateName, "Alternate original words");
  await page.emulateMedia({ reducedMotion: "reduce" }); expect((await page.goto(contextRoute(owner.scope)))?.status()).toBe(200); await openContext(page, made.contextId, name);
  await expect(panel(page).getByRole("heading", { name: initialCopy("ملفات السياق الخاصة", "Private context files"), exact: true })).toBeVisible();
  const before = await loadCurrent(page, initialCopy, owner.scope, made.contextId), initialFiles = manifest(before.references); expect(before).toMatchObject({ contextId: made.contextId, versionId: null });
  const selectedName = "اختيار-خاص-للاستعادة.png", label = "  عنوان عربي غير محفوظ يبقى حرفيًا  "; await selectFile(page, initialCopy, selectedName, label);
  const preview = panel(page).getByRole("img", { name: initialCopy("معاينة الصورة المختارة محليًا", "Local preview of the selected image"), exact: true }), previewURL = await preview.getAttribute("src"); expect(previewURL).toMatch(/^blob:/);
  const readonly = page.waitForResponse(response => currentUrl(made.contextId)(new URL(response.url())));
  await fileButton(panel(page), initialCopy, "تحديث الملفات", "Refresh files").click(); expect((await readonly).status()).toBe(200);
  await expect(literalLabel(panel(page), initialCopy)).toHaveValue(label); await expect(preview).toHaveAttribute("src", previewURL!); await expect(panel(page)).toContainText(selectedName);
  const languageReply = page.waitForResponse(response => new URL(response.url()).pathname === "/api/me/language" && response.request().method() === "PATCH");
  await page.getByRole("button", { name: english ? "Switch to Arabic" : "التبديل إلى الإنجليزية", exact: true }).click(); expect((await languageReply).status()).toBe(200);
  const copy: Copy = (ar, en) => english ? ar : en;
  await expect(literalLabel(panel(page), copy)).toHaveValue(label); await expect(panel(page).getByRole("img", { name: copy("معاينة الصورة المختارة محليًا", "Local preview of the selected image"), exact: true })).toHaveAttribute("src", previewURL!);
  // File selection/dirty labels must participate in the existing parent guard.
  // Root supplies this integration; no test-only state instrumentation is used.
  await page.locator(`[data-context-id="${alternate.contextId}"]`).getByRole("button", { name: alternateName, exact: true }).click();
  const leaveDialog = page.getByRole("dialog"); await expect(leaveDialog).toBeVisible();
  await leaveDialog.getByRole("button", { name: copy("متابعة التحرير", "Keep editing"), exact: true }).click(); await expect(leaveDialog).toHaveCount(0);
  await expect(literalLabel(panel(page), copy)).toHaveValue(label); await expect(panel(page)).toContainText(selectedName);
  await expect(panel(page).getByRole("img", { name: copy("معاينة الصورة المختارة محليًا", "Local preview of the selected image"), exact: true })).toHaveAttribute("src", previewURL!);
  const uploads: CapturedUpload[] = [], receipts: Array<z.infer<typeof ContextReferenceCommandResultSchema>> = [], getUrls: string[] = [];
  let faultNextRead = false;
  await page.route(commandUrl, async route => {
    uploads.push(await decodeUpload(route.request())); const actual = await route.fetch(); expect(actual.status()).toBe(200);
    const envelope = await actual.json(), receipt = ContextReferenceCommandResultSchema.parse(envelope.data); receipts.push(receipt);
    if (receipts.length === 1) await route.abort("failed");
    else if (receipts.length === 2 || receipts.length === 3) {
      // The native replay is genuine200. Fault only one contradictory scalar
      // in its delivered, otherwise valid envelope; do not mock a producer.
      expect(receipt.bindingId).not.toBe(initialFiles.items[0]!.bindingId); expect(receipt.manifestId).not.toBe(initialFiles.id);
      const contradictory = ContextReferenceCommandResultSchema.parse(receipts.length === 2
        ? { ...receipt, bindingId: initialFiles.items[0]!.bindingId }
        : { ...receipt, manifestId: initialFiles.id });
      await route.fulfill({ response: actual, json: { ...envelope, data: contradictory } });
    } else await route.fulfill({ response: actual });
  });
  await page.route(currentUrl(made.contextId), async route => {
    expect(route.request().method()).toBe("GET"); getUrls.push(route.request().url()); const actual = await route.fetch(); expect(actual.status()).toBe(200);
    if (faultNextRead) { faultNextRead = false; await route.fulfill({ response: actual, status: 503, json: { error: { code: "CAPABILITY_UNAVAILABLE", message: "Labelled post-native delivery fault" }, requestId: actual.headers()["x-request-id"] } }); }
    else await route.fulfill({ response: actual });
  });
  try {
    await fileButton(panel(page), copy, "رفع الملف الخاص", "Upload private file").click();
    const retry = fileButton(panel(page), copy, "إعادة الطلب نفسه", "Retry exact request"), check = fileButton(panel(page), copy, "تحقق من الحالة الحالية", "Check current state");
    await expect(retry).toBeVisible(); await expect(retry).toBeEnabled(); expect(uploads).toHaveLength(1); expect(receipts[0]!.replayed).toBe(false);
    const captured = uploads[0]!; expect(captured.command.contextId).toBe(made.contextId); expect(captured.filename).toBe(selectedName); expect(captured.contentType).toBe("image/png"); expect(captured.bytes).toEqual(png);
    expect(await db.contextReferenceCommand.count({ where: { actorUserId: owner.user.id, operationKey: captured.command.operationKey } })).toBe(1);
    expect((await db.brandContext.findUniqueOrThrow({ where: { id: made.contextId } })).revision).toBe(before.revision + 1);
    const retainedURL = page.url();
    if (!english) await page.getByRole("button", { name: copy("فتح قائمة مساحة العمل", "Open workspace menu"), exact: true }).click();
    await page.getByRole("link", { name: copy("حملاتي", "Campaigns"), exact: true }).click();
    const unknownLeave = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: copy("كلمات غير محفوظة", "Unsaved words"), exact: true }) });
    await expect(unknownLeave).toBeVisible(); await expect(unknownLeave.getByRole("button", { name: copy("تجاهل التغييرات", "Discard changes"), exact: true })).toBeDisabled();
    await unknownLeave.getByRole("button", { name: copy("متابعة التحرير", "Keep editing"), exact: true }).click(); await expect(unknownLeave).toHaveCount(0);
    expect(page.url()).toBe(retainedURL); await expect(literalLabel(panel(page), copy)).toHaveValue(label); expect(uploads).toHaveLength(1);
    await expect(panel(page).getByRole("img", { name: copy("معاينة الصورة المختارة محليًا", "Local preview of the selected image"), exact: true })).toHaveAttribute("src", previewURL!);
    await check.click(); await expect(retry).toBeVisible(); await expect(retry).toBeEnabled(); await expect(literalLabel(panel(page), copy)).toHaveValue(label);
    await expect(panel(page)).toContainText(selectedName); expect(uploads).toHaveLength(1); // A GET cannot prove the unknown original receipt.
    for (const delivery of [2, 3]) {
      const readsBefore = getUrls.length; await retry.click(); await expect(retry).toBeVisible(); await expect(retry).toBeEnabled();
      expect(uploads).toHaveLength(delivery); expect(receipts[delivery - 1]!.replayed).toBe(true);
      expect(uploads[delivery - 1]!.json).toBe(captured.json); expect(uploads[delivery - 1]!.command.operationKey).toBe(captured.command.operationKey);
      expect(uploads[delivery - 1]!.filename).toBe(captured.filename); expect(uploads[delivery - 1]!.contentType).toBe(captured.contentType); expect(uploads[delivery - 1]!.bytes).toEqual(captured.bytes);
      await expect(literalLabel(panel(page), copy)).toHaveValue(label); await expect(panel(page)).toContainText(selectedName);
      await expect(panel(page).getByRole("img", { name: copy("معاينة الصورة المختارة محليًا", "Local preview of the selected image"), exact: true })).toHaveAttribute("src", previewURL!);
      // A scalar identity contradicting the captured source cannot establish a
      // receipt or start confirmed GET reconciliation. Exact retry remains.
      expect(getUrls).toHaveLength(readsBefore);
      expect(await db.contextReferenceCommand.count({ where: { actorUserId: owner.user.id, operationKey: captured.command.operationKey } })).toBe(1);
      expect((await db.brandContext.findUniqueOrThrow({ where: { id: made.contextId } })).revision).toBe(before.revision + 1);
    }
    faultNextRead = true; await retry.click(); await expect(retry).toHaveCount(0); await expect(check).toBeVisible(); await expect(check).toBeEnabled();
    expect(uploads).toHaveLength(4); expect(receipts[3]!.replayed).toBe(true); expect(uploads[3]!.json).toBe(captured.json);
    expect(uploads[3]!.command.operationKey).toBe(captured.command.operationKey); expect(uploads[3]!.filename).toBe(captured.filename); expect(uploads[3]!.contentType).toBe(captured.contentType); expect(uploads[3]!.bytes).toEqual(captured.bytes);
    // The receipt is already confirmed, but its current GET failed. A genuine
    // second producer now advances the immutable manifest before GET recovery.
    // Keeping labels must merge onto current bindings, never stage their removal.
    const concurrentLabel = "مرجع_محفوظ_من_طلب_آخر", concurrent = await nativeUpload(context, owner, owner.scope, made.contextId, concurrentLabel);
    await check.click();
    const keepLabels = fileButton(panel(page), copy, "راجعت القائمة؛ احتفظ بكلماتي", "Reviewed list; keep my labels");
    await expect(keepLabels).toBeVisible(); await expect(keepLabels).toBeEnabled(); await expect(retry).toHaveCount(0); expect(uploads).toHaveLength(4);
    await keepLabels.click(); await expect(check).toHaveCount(0); await expect(literalLabel(panel(page), copy)).toHaveCount(0);
    await expect(panel(page).locator("[data-reference-editor-binding]")).toHaveCount(3);
    await expect(panel(page).locator(`[data-reference-editor-binding="${receipts[0]!.bindingId}"]`).getByLabel(copy("عنوان المرجع 2", "Reference label 2"), { exact: true })).toHaveValue(label);
    await expect(panel(page).locator(`[data-reference-editor-binding="${concurrent.bindingId}"]`).getByLabel(copy("عنوان المرجع 3", "Reference label 3"), { exact: true })).toHaveValue(concurrentLabel);
    await expect(fileButton(panel(page), copy, "حفظ عناوين الملفات وترتيبها", "Save file labels and order")).toHaveCount(0);
    await expect(panel(page).getByLabel(copy("الملف المرجعي", "Reference file"), { exact: true })).toBeEnabled();
    expect(uploads).toHaveLength(4); expect(getUrls).toHaveLength(3); expect(new Set(getUrls).size).toBe(1);
    expect(await db.contextReferenceCommand.count({ where: { actorUserId: owner.user.id, operationKey: captured.command.operationKey } })).toBe(1);
    const current = await read(context, referencePath(owner.scope, made.contextId), ContextReferenceResponseSchema), committedFiles = manifest(current.references);
    expect(current.revision).toBe(before.revision + 2); expect(current.inputRevision).toBe(before.inputRevision); expect(committedFiles.revision).toBe(initialFiles.revision + 2);
    expect(committedFiles.items).toHaveLength(3); expect(await db.contextAssetBinding.count({ where: { contextId: made.contextId } })).toBe(3);
    const saved = committedFiles.items.find(item => item.bindingId === receipts[0]!.bindingId)!; expect(saved.labelOriginal).toEqual({ text: label, language: "ar-SA" }); await actualLocalBytes(saved);
    await screenshot(page, info, "post-native-upload-exact-replay-current-read");
  } finally { await page.unroute(commandUrl); await page.unroute(currentUrl(made.contextId)); }
  const unsentName = "PRIVATE-LOCAL-SELECTED-FILE.png", unsentLabel = "PRIVATE UNSENT ORIGINAL FILE LABEL", unsentWords = "PRIVATE UNSENT PARENT EDITOR WORDS";
  await selectFile(page, copy, unsentName, unsentLabel); await page.getByLabel(copy("التموضع", "Positioning"), { exact: true }).fill(unsentWords);
  await db.authSession.update({ where: { id: owner.actor.sessionId }, data: { revokedAt: new Date() } }); expect(await resolveSession(owner.token)).toBeNull(); let nativeDenials = 0;
  await page.route(currentUrl(made.contextId), async route => {
    const actual = await route.fetch(); expect(actual.status()).toBe(401); expect(actual.headers()["cache-control"]).toBe("private, no-store");
    expect((await actual.json()).error.code).toBe("UNAUTHENTICATED"); nativeDenials++;
    await route.fulfill({ response: actual, status: 401, contentType: "application/json", body: "{labelled_native_revoked_file_denial" });
  });
  try {
    await fileButton(panel(page), copy, "تحديث الملفات", "Refresh files").click(); await expect.poll(() => nativeDenials).toBe(1);
    await expect(page.locator("[data-context-id], [data-context-version-id], [data-reference-binding], [data-reference-editor-binding]")).toHaveCount(0);
    for (const pair of [["اسم السياق", "Context name"], ["التموضع", "Positioning"], ["عنوان الملف الأصلي", "Original file label"], ["الملف المرجعي", "Reference file"]]) await expect(page.getByLabel(copy(pair[0]!, pair[1]!), { exact: true })).toHaveCount(0);
    await expect(page.getByRole("img", { name: copy("معاينة الصورة المختارة محليًا", "Local preview of the selected image"), exact: true })).toHaveCount(0);
    for (const canary of [name, originalWords, selectedName, label.trim(), unsentName, unsentLabel, unsentWords]) await expect(page.locator("body")).not.toContainText(canary);
    expect(uploads).toHaveLength(4); expect(await db.contextReferenceCommand.count({ where: { actorUserId: owner.user.id, operationKey: uploads[0]!.command.operationKey } })).toBe(1);
  } finally { await page.unroute(currentUrl(made.contextId)); }
});
