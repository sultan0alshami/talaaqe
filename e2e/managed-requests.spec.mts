import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { expect, test, type APIResponse, type BrowserContext, type Page, type TestInfo, type Locator } from "@playwright/test";
import { assertLocalTarget, taskState } from "../scripts/task-state.mjs";
import { prisma as db } from "../src/lib/prisma";
import { openSession, resolveSession } from "../src/lib/identity";
import { SESSION_COOKIE } from "../src/lib/jwt";
import type { OrganizationActor } from "../src/lib/organizations/context";
import type { ClientCapabilities } from "../src/lib/organizations/contracts";
import { createOrganization, proposeClientAssociation, authorizeClientAssociation, proposeMember, acceptMembership, setClientGrant } from "../src/lib/organizations/service";
import { getClientAuthority } from "../src/lib/organizations/loaders";
import { BrandContextDetailResponseSchema, BrandContextContentSchema, BrandContextCommandResultSchema, BrandContextVersionResponseSchema, ContextOwnerReviewResultSchema, type PlanningScope } from "../src/lib/brand-context/contracts";
import { ContextReferenceResponseSchema, ContextReferenceCommandResultSchema } from "../src/lib/brand-context/reference-contracts";
import { CampaignFieldsSchema } from "../src/lib/campaigns/contracts";
import { campaignBriefDTO } from "../src/lib/campaigns/core";
import { CampaignPlanningCommandSchema, CampaignPlanningResultSchema, PlanningCampaignSchema, CampaignOwnerReviewResultSchema } from "../src/lib/campaign-planning/contracts";
import { ManagedOrderCommandSchema, ManagedOrderResultSchema, ManagedOrderDetailSchema } from "../src/lib/managed/contracts";
import { createLocalEvidenceStorage } from "../src/lib/evidence/storage";
import { canonicalHash } from "../src/lib/onboarding/drafts";
import { campaignFields } from "../tests/campaigns/fixtures";

// Exactly three customer journeys in the existing Arabic360/English projects.
// Root alone adopts/runs this candidate. Native JWT/User/AuthSession, agency
// consent/grants, M03 approvals, actual local PNG and mounted HTTP producers are
// real owned synthetic records. Only delivery interception is used for recovery;
// no authority, producer, provider, clock or test-module fixture mock is used.
const state = taskState(), origin = "http://localhost:3100", commandUrl = "**/api/managed-orders/commands";
if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("Managed request UI requires the guarded E2E target");
const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>(), errors = new WeakMap<Page, string[]>();
const key = () => randomUUID();
const all: ClientCapabilities = { view: true, plan: true, approveShortlist: true, reviewContent: true, signCustomer: true, financial: true, manageGrants: true };
const none: ClientCapabilities = { view: false, plan: false, approveShortlist: false, reviewContent: false, signCustomer: false, financial: false, manageGrants: false };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1kAAAAASUVORK5CYII=", "base64");
const positioning = "  تموضع أصلي معتمد\nOriginal approved context words  ";
const contextContent = BrandContextContentSchema.parse({ schemaVersion: 1, positioning: { text: positioning, language: "ar" },
  values: [], tone: { text: "Approved original tone", language: "en" }, references: [], competitors: [] });
const fileLabel = "  مرجع معتمد طويل / Original retained approved reference  ";
const fileNote = "  ملاحظة أصلية\nOriginal private approved file note  ";
const privateDraft = "UNSUBMITTED_CURRENT_CONTEXT_MUST_NOT_BE_SHARED";

test.setTimeout(120000);
test.beforeAll(async () => {
  const rows = await db.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]!.id !== state.id || rows[0]!.kind !== "e2e" || rows[0]!.db !== state.targets.e2e || rows[0]!.host !== "127.0.0.1") throw new Error("Managed UI fixture database identity mismatch");
});
test.beforeEach(async ({ page }) => {
  const seen: string[] = []; errors.set(page, seen);
  page.on("pageerror", error => seen.push(error.name));
  page.on("console", message => { if (message.type() === "error" && /hydrat|server.rendered|server HTML|text content.*match/i.test(message.text())) seen.push("HYDRATION_MISMATCH"); });
});
test.afterEach(async ({ page }) => {
  const assets = await db.privateAsset.findMany({ where: { ownerUserId: { in: [...users] }, purpose: "MARKETING_REFERENCE" }, select: { storageKey: true } });
  const workspaces = await db.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } }), ids = workspaces.map(row => row.id);
  if (ids.length) {
    for (const table of ["ManagedOrderCommand", "ManagedOrderState", "ManagedOrderSubmission", "ManagedOrder", "ContextReferenceCommand", "ContextSubmissionReferences", "ContextReferenceState", "ContextReferenceManifest", "ContextAssetBinding",
      "PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission", "CampaignBriefProvenance", "CampaignProposalDependency", "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding", "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const) {
      await db.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join(ids)})`);
    }
    await db.planningWorkspace.deleteMany({ where: { id: { in: ids } } });
  }
  if (assets.length) {
    const storage = await createLocalEvidenceStorage({ taskId: state.id, target: "e2e" });
    for (const asset of assets) { if (!asset.storageKey.startsWith("local:")) throw new Error("Owned UI fixture used an unexpected storage mode"); await storage.remove(asset.storageKey.slice("local:".length)); }
  }
  await db.evidenceCommand.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await db.privateAsset.deleteMany({ where: { ownerUserId: { in: [...users] } } });
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
  expect(errors.get(page) ?? [], "Actual UI page/hydration errors").toEqual([]);
});
test.afterAll(async () => { await db.$disconnect(); });

type Copy = (ar: string, en: string) => string;
function locale(info: TestInfo) { const english = info.project.name === "english-desktop"; return { english, copy: (ar: string, en: string) => english ? en : ar }; }
async function person(english: boolean) {
  const id = key(); users.add(id);
  const user = await db.user.create({ data: { id, role: "BRAND", active: true, isTest: true, language: english ? "en" : "ar", name: "Synthetic native request customer",
    email: `${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  const token = await openSession(id, user.sessionVersion, user.passwordHash), native = await resolveSession(token);
  if (!native) throw new Error("Native UI fixture session did not resolve");
  const actor: OrganizationActor = { userId: native.userId, role: native.role, sessionId: native.sessionId, sessionVersion: native.sessionVersion };
  return { user, actor, token };
}
type Account = Awaited<ReturnType<typeof person>>;
async function signed(context: BrowserContext, account: Account, english: boolean) {
  expect(await resolveSession(account.token)).not.toBeNull();
  await context.addCookies([{ name: SESSION_COOKIE, value: account.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "infame_lang", value: english ? "en" : "ar", domain: "localhost", path: "/" }]);
}
async function company(english: boolean) {
  const owner = await person(english), brand = await db.brand.create({ data: { userId: owner.user.id, slug: "managed-ui-" + key().replace(/-/g, ""),
    name: "شركة أصلية Original request company", countryCode: "KW", isTest: true } }); brands.add(brand.id);
  return { ...owner, brand, scope: { kind: "OWN_BRAND", brandId: brand.id } as PlanningScope };
}
type Company = Awaited<ReturnType<typeof company>>;
async function agency(owner: Company, english: boolean, label: string) {
  const organizationOwner = await person(english), seat = await person(english);
  const { organization } = await createOrganization(organizationOwner.actor, { operationKey: key(), kind: "AGENCY", nameOriginal: "Synthetic native request agency " + label }); organizations.add(organization.id);
  const revision = async () => (await db.organization.findUniqueOrThrow({ where: { id: organization.id } })).revision;
  const proposal = await proposeClientAssociation(organizationOwner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), brandId: owner.brand.id });
  const { client } = await authorizeClientAssociation(owner.actor, proposal.client.id, { operationKey: key(), expectedRevision: proposal.client.revision, capabilities: all });
  const pending = await proposeMember(organizationOwner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), targetUserId: seat.user.id });
  const { membership } = await acceptMembership(seat.actor, pending.membership.id, { operationKey: key(), expectedRevision: pending.membership.revision });
  const { grant } = await setClientGrant(organizationOwner.actor, client.id, { operationKey: key(), expectedClientRevision: client.revision, membershipId: membership.id, expectedGrantRevision: null, capabilities: all });
  return { organizationOwner, seat, organization, client, membership, grant, scope: { kind: "CLIENT", clientId: client.id } as PlanningScope };
}
type Agency = Awaited<ReturnType<typeof agency>>;
async function rights(a: Agency, capabilities: ClientCapabilities) {
  const current = await db.clientGrant.findUniqueOrThrow({ where: { id: a.grant.id } }), association = await db.organizationClient.findUniqueOrThrow({ where: { id: a.client.id } });
  return setClientGrant(a.organizationOwner.actor, a.client.id, { operationKey: key(), expectedClientRevision: association.revision,
    membershipId: a.membership.id, expectedGrantRevision: current.revision, capabilities });
}
function scopeQuery(scope: PlanningScope) { return scope.kind === "OWN_BRAND" ? `scope=OWN_BRAND&brandId=${encodeURIComponent(scope.brandId)}` : `scope=CLIENT&clientId=${encodeURIComponent(scope.clientId)}`; }
function web(scope: PlanningScope, section: "campaigns" | "requests", id = "") { return `/brand/${section}${id ? "/" + encodeURIComponent(id) : ""}${scope.kind === "CLIENT" ? `?clientId=${encodeURIComponent(scope.clientId)}` : ""}`; }
async function wire(response: APIResponse) {
  expect(response.headers()["cache-control"]).toBe("private, no-store"); expect(response.headers()["x-request-id"]).toMatch(/^[a-f0-9-]{36}$/);
  const value = await response.json(); expect(value.requestId).toBe(response.headers()["x-request-id"]); return value;
}
async function read<T>(context: BrowserContext, path: string, schema: z.ZodType<T>) {
  const response = await context.request.get(path); expect(response.status()).toBe(200); return schema.parse((await wire(response)).data);
}
async function post<T>(context: BrowserContext, path: string, input: unknown, schema: z.ZodType<T>) {
  const response = await context.request.post(path, { headers: { Origin: origin }, data: input }); expect(response.status()).toBe(200); return schema.parse((await wire(response)).data);
}
async function planAuthority(account: Account, scope: PlanningScope) { return scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(account.actor, scope.clientId, "plan") } : {}; }
async function current(context: BrowserContext, scope: PlanningScope, campaignId: string) { return read(context, `/api/planning-campaigns/detail?${scopeQuery(scope)}&campaignId=${campaignId}`, PlanningCampaignSchema); }
async function planningStep(context: BrowserContext, account: Account, scope: PlanningScope, campaignId: string, action: string, payload: unknown) {
  const previous = await current(context, scope, campaignId);
  return post(context, "/api/planning-campaigns/commands", CampaignPlanningCommandSchema.parse({ operationKey: key(), scope, ...await planAuthority(account, scope), campaignId,
    expectedCampaignRevision: previous.campaign.revision, expectedPlanningRevision: previous.planning.revision,
    expectedSelectionId: previous.planning.selection.id, expectedSelectionRevision: previous.planning.selection.revision, action, payload }), CampaignPlanningResultSchema);
}
async function approvedContext(context: BrowserContext, owner: Company, account: Account, scope: PlanningScope, english: boolean) {
  const expected = () => planAuthority(account, scope);
  const made = await post(context, "/api/brand-contexts/commands", { operationKey: key(), scope, ...await expected(), action: "CREATE", expectedRevision: 0,
    payload: { nameOriginal: { text: "Original approved request context", language: "en" }, content: contextContent } }, BrandContextCommandResultSchema);
  const uploadedResponse = await context.request.post("/api/brand-contexts/references/commands", { headers: { Origin: origin }, multipart: {
    command: { name: "command.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ operationKey: key(), scope, ...await expected(), contextId: made.contextId,
      action: "UPLOAD", expectedRevision: made.revision, expectedReferenceRevision: 0,
      payload: { labelOriginal: { text: fileLabel, language: "ar" }, notesOriginal: { text: fileNote, language: "ar" } } })) },
    file: { name: "مرجع-معتمد.png", mimeType: "image/png", buffer: png },
  } });
  expect(uploadedResponse.status()).toBe(200); const uploaded = ContextReferenceCommandResultSchema.parse((await wire(uploadedResponse)).data);
  const submitted = await post(context, "/api/brand-contexts/commands", { operationKey: key(), scope, ...await expected(), contextId: made.contextId, action: "SUBMIT", expectedRevision: uploaded.revision, payload: {} }, BrandContextCommandResultSchema);
  await signed(context, owner, english);
  const approved = await post(context, "/api/brand-contexts/reviews/commands", { operationKey: key(), submissionId: submitted.submissionId, expectedRevision: 1, decision: "APPROVE" }, ContextOwnerReviewResultSchema);
  await signed(context, account, english);
  const version = await read(context, `/api/brand-contexts/version?${scopeQuery(scope)}&versionId=${approved.versionId}`, BrandContextVersionResponseSchema);
  const refs = await read(context, `/api/brand-contexts/references?${scopeQuery(scope)}&contextId=${made.contextId}&versionId=${approved.versionId}`, ContextReferenceResponseSchema);
  if (refs.references.kind !== "MANIFEST") throw new Error("Actual native approved PNG manifest was absent");
  expect(refs.references.items[0]).toMatchObject({ labelOriginal: { text: fileLabel, language: "ar" }, notesOriginal: { text: fileNote, language: "ar" }, size: png.byteLength });
  return { contextId: made.contextId, version: version.version, references: refs.references, parentRevision: submitted.revision };
}
async function source(context: BrowserContext, owner: Company, account: Account, scope: PlanningScope, english: boolean, label: string, approved = true, refs = false) {
  await signed(context, account, english); const selected = refs ? await approvedContext(context, owner, account, scope, english) : null;
  const suffix = key().slice(0, 8), title = "  طلب حملة أصلي Original managed request " + label + " " + suffix + "  ",
    summary = "  ملخص أصلي\nOriginal approved request summary " + suffix + "  ", product = "  منتج أصلي Original requested product " + suffix + "  ";
  const narrative = "UNSUBMITTED_REQUEST_NARRATIVE_" + suffix, proposal = "UNAPPROVED_REQUEST_PROPOSAL_" + suffix;
  const fields = CampaignFieldsSchema.parse({ ...campaignFields, title, summary, productService: product });
  const made = await post(context, "/api/planning-campaigns/commands", CampaignPlanningCommandSchema.parse({ operationKey: key(), scope, ...await planAuthority(account, scope), action: "CREATE",
    expectedCampaignRevision: 0, expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0,
    payload: { fields, selection: selected ? { kind: "APPROVED_CONTEXT", versionId: selected.version.id, contentHash: selected.version.contentHash } : { kind: "NONE" }, narrative: null } }), CampaignPlanningResultSchema);
  await planningStep(context, account, scope, made.campaignId, "SAVE_NARRATIVE", { narrative: { schemaVersion: 1, mode: "PARAGRAPH", processing: "UNPROCESSED", originalText: { text: narrative, language: "en" } } });
  await planningStep(context, account, scope, made.campaignId, "PROPOSE_FIELDS", { type: "PROPOSE_FIELDS", patch: { summary: proposal }, originalText: { text: proposal, language: "en" } });
  const generated = await planningStep(context, account, scope, made.campaignId, "GENERATE_BRIEF", {});
  const sent = await planningStep(context, account, scope, made.campaignId, "SUBMIT_BRIEF", { briefId: generated.briefId!, expectedBriefVersion: generated.version! });
  if (approved) {
    await signed(context, owner, english);
    const decision = await post(context, "/api/planning-campaigns/reviews/commands", { operationKey: key(), submissionId: sent.submissionId, expectedRevision: 1, decision: "APPROVE" }, CampaignOwnerReviewResultSchema); expect(decision.state).toBe("APPROVED");
    await signed(context, account, english);
  }
  const brief = campaignBriefDTO(await db.campaignBrief.findUniqueOrThrow({ where: { id: generated.briefId! } }));
  return { owner, account, scope, campaignId: made.campaignId, submissionId: sent.submissionId!, brief, fields, title, summary, product, narrative, proposal, selected };
}
type Source = Awaited<ReturnType<typeof source>>;
async function expectedCommand(context: BrowserContext, s: Source) {
  const value = await current(context, s.scope, s.campaignId);
  return ManagedOrderCommandSchema.parse({ action: "SUBMIT", operationKey: key(), scope: s.scope, campaignId: s.campaignId, disclosureVersion: "infame-order-disclosure-v1",
    expectedCampaignRevision: value.campaign.revision, expectedPlanningRevision: value.planning.revision,
    expectedSelectionId: value.planning.selection.id, expectedSelectionRevision: value.planning.selection.revision, briefId: s.brief.id, expectedBriefVersion: s.brief.version,
    ...(s.scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(s.account.actor, s.scope.clientId, "signCustomer") } : {}) });
}
const main = (page: Page) => page.locator("main");
const action = (page: Page, copy: Copy) => main(page).getByRole("button", { name: copy("اطلب عرضًا مُدارًا", "Request managed estimate"), exact: true });
const checkState = (page: Page, copy: Copy) => main(page).getByRole("button", { name: copy("تحقق من الحالة الحالية", "Check current state"), exact: true });
const retrySame = (page: Page, copy: Copy) => main(page).getByRole("button", { name: copy("أعد الطلب نفسه", "Retry same request"), exact: true });
async function cannotSubmit(page: Page, copy: Copy) { await expect.poll(async () => await action(page, copy).count() === 0 || await action(page, copy).isDisabled()).toBe(true); }
async function privacy(within: Locator, s: Source, extra: string[] = []) {
  for (const value of [s.narrative, s.proposal, privateDraft, ...extra]) await expect(within).not.toContainText(value);
  for (const forbidden of ["supplierCost", "storageKey", "passwordHash", "sessionId", "accessToken"]) await expect(within).not.toContainText(forbidden);
}
async function openDisclosure(page: Page, copy: Copy, s: Source) {
  await expect(action(page, copy)).toBeEnabled({ timeout: 5000 }); await action(page, copy).click();
  const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole("button", { name: copy("اطلب عرضًا مُدارًا", "Request managed estimate"), exact: true });
  const checkbox = dialog.getByRole("checkbox"); await expect(checkbox).toHaveCount(1); await expect(checkbox).not.toBeChecked(); await expect(confirm).toBeDisabled();
  await privacy(dialog, s); await expect(dialog).toContainText(s.title.trim());
  if (s.selected) await expect(dialog).toContainText(fileLabel.trim());
  await checkbox.focus(); await page.keyboard.press("Space"); await expect(checkbox).toBeChecked(); await expect(confirm).toBeEnabled();
  return { dialog, confirm };
}
function observedPosts(page: Page) {
  const bodies: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/managed-orders/commands" && request.method() === "POST") { const body = request.postData(); if (body === null) throw new Error("Managed UI POST omitted its captured body"); bodies.push(body); } });
  return bodies;
}
function sameCapture(raw: string, expected: ReturnType<typeof ManagedOrderCommandSchema.parse>) {
  const parsed = ManagedOrderCommandSchema.parse(JSON.parse(raw)); expect(parsed.operationKey).toMatch(/^[a-f0-9-]{36}$/);
  const { operationKey: _received, ...actual } = parsed, { operationKey: _expected, ...wanted } = expected; void _received; void _expected;
  expect(actual).toEqual(wanted); return parsed;
}
async function committedOnce(s: Source, body: string) {
  const parsed = ManagedOrderCommandSchema.parse(JSON.parse(body));
  const journal = await db.managedOrderCommand.findUniqueOrThrow({ where: { actorUserId_operationKey: { actorUserId: s.account.user.id, operationKey: parsed.operationKey } } });
  expect(journal.payloadHash).toBe(canonicalHash({ purpose: "MANAGED_ORDER_COMMAND_V1", actorUserId: s.account.user.id, command: parsed }));
  expect(await db.managedOrder.count({ where: { campaignId: s.campaignId } })).toBe(1);
  expect(await db.managedOrderSubmission.count({ where: { orderId: journal.orderId } })).toBe(1);
  expect(await db.managedOrderCommand.count({ where: { actorUserId: s.account.user.id, operationKey: parsed.operationKey } })).toBe(1);
  expect(await db.outboxEvent.count({ where: { type: "managed_order.requested", payload: { path: ["aggregateId"], equals: journal.orderId } } })).toBe(1);
  return ManagedOrderResultSchema.parse({ ...(journal.result as object), replayed: false });
}
async function detailVisible(page: Page, copy: Copy, s: Source, orderId: string) {
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/brand/requests/${orderId}`);
  expect(new URL(page.url()).searchParams.get("clientId")).toBe(s.scope.kind === "CLIENT" ? s.scope.clientId : null);
  await expect(main(page).getByRole("heading", { name: s.title.trim(), exact: true }).first()).toBeVisible();
  await expect(main(page)).toContainText(copy("طلب مسجل", "Request recorded")); await expect(main(page)).toContainText(copy("لم يصدر عرض سعر بعد", "Estimate not issued"));
  await expect(main(page).getByText(s.summary.trim(), { exact: true }).first()).toBeVisible();
  expect(await main(page).getByText(s.summary.trim(), { exact: true }).first().textContent()).toBe(s.summary);
  expect(await main(page).getByText(s.product.trim(), { exact: true }).first().textContent()).toBe(s.product);
  await expect(main(page).getByRole("button", { name: /Pay now|Checkout|Book creator|ادفع الآن|الدفع الآن|احجز صانع/i })).toHaveCount(0);
  await privacy(main(page), s);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
}
async function currentDetail(context: BrowserContext, s: Source, orderId: string) { return read(context, `/api/managed-orders/detail?${scopeQuery(s.scope)}&orderId=${orderId}`, ManagedOrderDetailSchema); }
function detailRequest(s: Source, orderId: string) { return (url: URL) => url.pathname === "/api/managed-orders/detail" && url.searchParams.get("orderId") === orderId
  && (s.scope.kind === "CLIENT" ? url.searchParams.get("clientId") === s.scope.clientId : url.searchParams.get("brandId") === s.scope.brandId); }

test("actual OWN approval opens explicit disclosure, records one frozen request, preserves original words/pins and provides honest empty/profile remedies", async ({ page, context }, info) => {
  const { english, copy } = locale(info), owner = await company(english); await signed(context, owner, english);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await db.campaign.count({ where: { brandId: owner.brand.id } })).toBe(0);
  const s = await source(context, owner, owner, owner.scope, english, "OWN", false, true), bodies = observedPosts(page);
  expect((await page.goto(web(s.scope, "campaigns", s.campaignId)))?.status()).toBe(200); await cannotSubmit(page, copy);
  expect(bodies).toHaveLength(0);
  await post(context, "/api/planning-campaigns/reviews/commands", { operationKey: key(), submissionId: s.submissionId, expectedRevision: 1, decision: "APPROVE" }, CampaignOwnerReviewResultSchema);
  s.brief = campaignBriefDTO(await db.campaignBrief.findUniqueOrThrow({ where: { id: s.brief.id } }));
  if (!s.selected) throw new Error("Native pinned context fixture omitted identity");
  await post(context, "/api/brand-contexts/commands", { operationKey: key(), scope: s.scope, contextId: s.selected.contextId, action: "UPDATE", expectedRevision: s.selected.parentRevision,
    payload: { nameOriginal: { text: "Unsubmitted current context", language: "en" }, content: { ...contextContent, positioning: { text: privateDraft, language: "en" } } } }, BrandContextCommandResultSchema);
  const refs = await read(context, `/api/brand-contexts/references?${scopeQuery(s.scope)}&contextId=${s.selected.contextId}`, ContextReferenceResponseSchema);
  if (refs.references.kind !== "MANIFEST") throw new Error("Current native reference state was absent");
  await post(context, "/api/brand-contexts/references/commands", { operationKey: key(), scope: s.scope, contextId: s.selected.contextId, action: "REPLACE",
    expectedRevision: refs.revision, expectedReferenceRevision: refs.references.revision, payload: { items: [] } }, ContextReferenceCommandResultSchema);
  await page.reload(); await expect(action(page, copy)).toBeEnabled({ timeout: 5000 });
  const summary = main(page).getByLabel(copy("ملخص الحملة", "Campaign summary"), { exact: true }), dirty = s.summary + " UNSAVED LOCAL WORDS";
  await summary.fill(dirty); await cannotSubmit(page, copy);
  if (!english) await page.getByRole("button", { name: copy("فتح قائمة مساحة العمل", "Open workspace menu"), exact: true }).click();
  const requestNavigation = page.getByRole("link", { name: copy("طلبات الحملات", "Campaign requests"), exact: true }).first();
  await expect(requestNavigation).toBeVisible(); await requestNavigation.click();
  const guard = page.getByRole("dialog", { name: copy("مدخلات غير محفوظة", "Unsaved input"), exact: true }); await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: copy("تابع التحرير", "Keep editing"), exact: true }).click(); await expect(summary).toHaveValue(dirty);
  // The editor's dirty latch ends through actual source reload, not by typing
  // matching text. Explicitly accept the browser's unsaved-input reload guard.
  const acceptReadOnlyReload = async (dialog: import("@playwright/test").Dialog) => { expect(dialog.type()).toBe("beforeunload"); await dialog.accept(); };
  page.on("dialog", acceptReadOnlyReload);
  try { expect((await page.reload())?.status()).toBe(200); }
  finally { page.off("dialog", acceptReadOnlyReload); }
  const savedSource = await current(context, s.scope, s.campaignId);
  expect(savedSource.campaign.fields.summary).toBe(s.summary); expect(savedSource.campaign.currentBriefVersion).toBe(s.brief.version);
  await expect(summary).toHaveValue(s.summary); await expect(action(page, copy)).toBeEnabled({ timeout: 5000 });
  const displayedSummaryA = s.summary, retainedBriefA = s.brief;
  if (!s.selected || s.selected.references.kind !== "MANIFEST") throw new Error("Newer-source witness requires actual approved A context/file pins");
  await expect(summary).toHaveValue(displayedSummaryA);
  const newerSummary = "  موجز B معتمد\nNew approved B summary visible before consent  ";
  const newerProduct = "  منتج B معتمد Original approved B product  ";
  const newerTone = "  Approved B campaign tone  ", newerRights = "  Approved B explicit usage rights  ";
  const newerContextValue = "  قيمة سياق B معتمدة Original approved B context value  ";
  const newerContextTone = "  Approved B context tone  ";
  const contextB = BrandContextContentSchema.parse({ ...contextContent,
    values: [{ text: newerContextValue, language: "ar" }], tone: { text: newerContextTone, language: "en" } });
  const fieldsB = CampaignFieldsSchema.parse({ ...s.fields, summary: newerSummary, productService: newerProduct, tone: newerTone,
    usageRights: newerRights, budget: { amountMinor: "654321", currencyCode: "KWD" },
    assumptions: ["  Original approved B assumption  "], openQuestions: ["  Original approved B open question  "] });
  const browser = context.browser(); if (!browser) throw new Error("Newer-source witness requires actual browser context");
  const otherClient = await browser.newContext({ baseURL: origin });
  try {
    await signed(otherClient, owner, english);
    const previousContext = await read(otherClient, `/api/brand-contexts/detail?${scopeQuery(s.scope)}&contextId=${s.selected.contextId}`, BrandContextDetailResponseSchema);
    const editedContextB = await post(otherClient, "/api/brand-contexts/commands", { operationKey: key(), scope: s.scope,
      contextId: s.selected.contextId, action: "UPDATE", expectedRevision: previousContext.context.revision,
      payload: { nameOriginal: previousContext.context.nameOriginal, content: contextB } }, BrandContextCommandResultSchema);
    const beforeFilesB = await read(otherClient, `/api/brand-contexts/references?${scopeQuery(s.scope)}&contextId=${s.selected.contextId}`, ContextReferenceResponseSchema);
    if (beforeFilesB.references.kind !== "MANIFEST") throw new Error("Actual current reference manifest absent before B upload");
    const uploadedBResponse = await otherClient.request.post("/api/brand-contexts/references/commands", { headers: { Origin: origin }, multipart: {
      command: { name: "command.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ operationKey: key(), scope: s.scope,
        contextId: s.selected.contextId, action: "UPLOAD", expectedRevision: editedContextB.revision,
        expectedReferenceRevision: beforeFilesB.references.revision,
        payload: { labelOriginal: { text: fileLabel, language: "ar" }, notesOriginal: { text: fileNote, language: "ar" } } })) },
      file: { name: "مرجع-B-معتمد.png", mimeType: "image/png", buffer: png },
    } });
    expect(uploadedBResponse.status()).toBe(200);
    const uploadedB = ContextReferenceCommandResultSchema.parse((await wire(uploadedBResponse)).data);
    const submittedContextB = await post(otherClient, "/api/brand-contexts/commands", { operationKey: key(), scope: s.scope,
      contextId: s.selected.contextId, action: "SUBMIT", expectedRevision: uploadedB.revision, payload: {} }, BrandContextCommandResultSchema);
    const approvedContextB = await post(otherClient, "/api/brand-contexts/reviews/commands", { operationKey: key(),
      submissionId: submittedContextB.submissionId, expectedRevision: 1, decision: "APPROVE" }, ContextOwnerReviewResultSchema);
    const versionB = await read(otherClient, `/api/brand-contexts/version?${scopeQuery(s.scope)}&versionId=${approvedContextB.versionId}`, BrandContextVersionResponseSchema);
    const referencesB = await read(otherClient, `/api/brand-contexts/references?${scopeQuery(s.scope)}&contextId=${s.selected.contextId}&versionId=${approvedContextB.versionId}`, ContextReferenceResponseSchema);
    if (referencesB.references.kind !== "MANIFEST") throw new Error("Actual approved B reference capture absent");
    expect(versionB.version.id).not.toBe(s.selected.version.id); expect(versionB.version.content).toEqual(contextB);
    expect(referencesB.references.id).not.toBe(s.selected.references.id);
    expect(referencesB.references.items).toHaveLength(1); expect(referencesB.references.items[0]!.bindingId).toBe(uploadedB.bindingId);
    await planningStep(otherClient, owner, s.scope, s.campaignId, "UPDATE_FIELDS", { patch: fieldsB });
    await planningStep(otherClient, owner, s.scope, s.campaignId, "SET_SELECTION", { selection: {
      kind: "APPROVED_CONTEXT", versionId: versionB.version.id, contentHash: versionB.version.contentHash,
    } });
    const generatedB = await planningStep(otherClient, owner, s.scope, s.campaignId, "GENERATE_BRIEF", {});
    const submittedB = await planningStep(otherClient, owner, s.scope, s.campaignId, "SUBMIT_BRIEF", {
      briefId: generatedB.briefId!, expectedBriefVersion: generatedB.version!,
    });
    const approvedB = await post(otherClient, "/api/planning-campaigns/reviews/commands", { operationKey: key(),
      submissionId: submittedB.submissionId, expectedRevision: 1, decision: "APPROVE" }, CampaignOwnerReviewResultSchema);
    expect(approvedB.state).toBe("APPROVED");
    const actualBriefB = campaignBriefDTO(await db.campaignBrief.findUniqueOrThrow({ where: { id: generatedB.briefId! } }));
    expect(actualBriefB.version).toBeGreaterThan(retainedBriefA.version); expect(actualBriefB.content.requirements.summary).toBe(newerSummary);
    expect(await db.campaignBrief.findUniqueOrThrow({ where: { id: retainedBriefA.id } })).toMatchObject({ id: retainedBriefA.id,
      content: retainedBriefA.content, approvedAt: new Date(retainedBriefA.approvedAt!) });
    // Update expected facts only; do not reload/replace the displayed parent A.
    s.fields = fieldsB; s.summary = newerSummary; s.product = newerProduct; s.brief = actualBriefB;
    s.selected = { ...s.selected, version: versionB.version, references: referencesB.references, parentRevision: submittedContextB.revision };
  } finally { await otherClient.close(); }
  await expect(summary).toHaveValue(displayedSummaryA); expect(bodies).toHaveLength(0);
  const expected = await expectedCommand(context, s);
  await expect(action(page, copy)).toBeEnabled({ timeout: 5000 }); await action(page, copy).click();
  const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole("button", { name: copy("اطلب عرضًا مُدارًا", "Request managed estimate"), exact: true });
  const checkbox = dialog.getByRole("checkbox"); await expect(checkbox).toHaveCount(1); await expect(checkbox).not.toBeChecked(); await expect(confirm).toBeDisabled();
  // Full approved requirements, not only the new title/version/file labels.
  for (const value of [newerSummary, newerProduct, newerTone, newerRights, fieldsB.assumptions[0]!, fieldsB.openQuestions[0]!]) {
    await expect(dialog.getByText(value.trim(), { exact: true }).first()).toBeVisible({ timeout: 5000 });
    expect(await dialog.getByText(value.trim(), { exact: true }).first().textContent()).toBe(value);
  }
  for (const section of [copy("الملخص والهدف", "Summary and objective"), copy("نطاق الحملة والمحتوى المطلوب", "Campaign scope and deliverables"),
    copy("متطلبات المحتوى", "Content requirements"), copy("التخصصات واللغات", "Niches and languages"), copy("معايير صناع المحتوى", "Creator criteria"),
    copy("الأسئلة المفتوحة", "Open questions")]) await expect(dialog.getByRole("region", { name: section, exact: true })).toBeVisible();
  await expect(dialog).toContainText(newerContextValue.trim()); await expect(dialog).toContainText(newerContextTone.trim());
  await expect(dialog).toContainText(positioning.trim()); await expect(dialog).toContainText(fileLabel.trim()); await expect(dialog).toContainText(fileNote.trim());
  await expect(dialog).toContainText("image/png"); await expect(dialog).toContainText(String(png.byteLength));
  await privacy(dialog, s); await expect(summary).toHaveValue(displayedSummaryA); expect(bodies).toHaveLength(0);
  await checkbox.focus(); await page.keyboard.press("Space"); await expect(checkbox).toBeChecked(); await expect(confirm).toBeEnabled();
  const disclosure = { dialog, confirm };
  const replied = page.waitForResponse(response => new URL(response.url()).pathname === "/api/managed-orders/commands" && response.request().method() === "POST");
  await disclosure.confirm.click(); const response = await replied; expect(response.status()).toBe(200);
  const result = ManagedOrderResultSchema.parse((await response.json()).data); await detailVisible(page, copy, s, result.orderId);
  expect(bodies).toHaveLength(1); sameCapture(bodies[0]!, expected); await committedOnce(s, bodies[0]!);
  const detail = await currentDetail(context, s, result.orderId);
  expect(detail.order.submission.snapshot.brief).toEqual(s.brief); expect(detail.order.submission.snapshot.selectedContext).toEqual(s.selected.version);
  expect(detail.order.submission.snapshot.references).toEqual(s.selected.references); expect(detail.quote).toBeNull();
  await expect(main(page)).toContainText(positioning.trim()); await expect(main(page)).toContainText(fileLabel.trim()); await expect(main(page)).toContainText(fileNote.trim());
  await page.reload(); await detailVisible(page, copy, s, result.orderId); expect(bodies).toHaveLength(1);
  await page.screenshot({ path: info.outputPath("managed-request-own-detail.png"), fullPage: true });
  expect((await page.goto(web(s.scope, "requests")))?.status()).toBe(200);
  await expect(main(page).getByRole("heading", { name: copy("طلبات الحملات", "Campaign requests"), exact: true })).toBeVisible();
  await expect(main(page).getByRole("link", { name: s.title.trim(), exact: true })).toHaveAttribute("href", web(s.scope, "requests", result.orderId));
  await privacy(main(page), s); expect(bodies).toHaveLength(1);
  expect((await page.goto(web(s.scope, "campaigns", s.campaignId)))?.status()).toBe(200); await cannotSubmit(page, copy); expect(bodies).toHaveLength(1);
  const empty = await company(english); await signed(context, empty, english);
  expect((await page.goto(web(empty.scope, "requests")))?.status()).toBe(200);
  await expect(main(page).getByRole("heading", { name: copy("طلبات الحملات", "Campaign requests"), exact: true })).toBeVisible();
  await expect(main(page).locator('a[href="/brand/campaigns/new"]')).toBeVisible();
  expect(await db.campaign.count({ where: { brandId: empty.brand.id } })).toBe(0);
  const incomplete = await person(english); await signed(context, incomplete, english);
  expect((await page.goto("/brand/requests"))?.status()).toBe(200); await expect(main(page).locator('a[href="/brand/onboarding"]')).toBeVisible();
  expect(await db.brand.count({ where: { userId: incomplete.user.id } })).toBe(0);
  expect(await db.campaign.count({ where: { brandId: owner.brand.id } })).toBe(1);
  await page.screenshot({ path: info.outputPath("managed-request-own.png"), fullPage: true });
});

test("same-Brand agency requests remain isolated and independent sign/view works without plan; real malformed native denial clears private detail", async ({ page, context }, info) => {
  const { english, copy } = locale(info), owner = await company(english), a = await agency(owner, english, "A"), b = await agency(owner, english, "B");
  const sa = await source(context, owner, a.seat, a.scope, english, "CLIENT A", true, true), sb = await source(context, owner, b.seat, b.scope, english, "CLIENT B");
  const bodies = observedPosts(page); await rights(a, { ...none, view: true, plan: true }); await signed(context, a.seat, english);
  expect((await page.goto(web(a.scope, "campaigns", sa.campaignId)))?.status()).toBe(200); await cannotSubmit(page, copy); expect(bodies).toHaveLength(0);
  await rights(a, { ...none, view: true, signCustomer: true });
  await page.reload(); await expect(action(page, copy)).toBeEnabled({ timeout: 5000 });
  await expect(main(page).getByLabel(copy("ملخص الحملة", "Campaign summary"), { exact: true })).toBeDisabled();
  const expected = await expectedCommand(context, sa), confirm = await openDisclosure(page, copy, sa);
  const received = page.waitForResponse(response => new URL(response.url()).pathname === "/api/managed-orders/commands" && response.request().method() === "POST");
  await confirm.confirm.click(); const actual = await received; expect(actual.status()).toBe(200);
  const ra = ManagedOrderResultSchema.parse((await actual.json()).data); await detailVisible(page, copy, sa, ra.orderId);
  expect(bodies).toHaveLength(1); sameCapture(bodies[0]!, expected); await committedOnce(sa, bodies[0]!);
  const bInput = await (async () => { await signed(context, b.seat, english); return expectedCommand(context, sb); })();
  const rb = await post(context, "/api/managed-orders/commands", bInput, ManagedOrderResultSchema);
  await signed(context, a.seat, english); expect((await page.goto(web(a.scope, "requests")))?.status()).toBe(200);
  await expect(main(page)).toContainText(sa.title.trim()); await expect(main(page)).not.toContainText(sb.title.trim());
  await expect(main(page).getByRole("link", { name: sa.title.trim(), exact: true })).toHaveAttribute("href", web(a.scope, "requests", ra.orderId));
  expect((await page.goto(web(a.scope, "requests", rb.orderId)))?.status()).toBe(404);
  await expect(main(page)).not.toContainText(sa.summary.trim()); await expect(main(page)).not.toContainText(sb.summary.trim());
  await signed(context, b.seat, english); expect((await page.goto(web(b.scope, "requests")))?.status()).toBe(200);
  await expect(main(page)).toContainText(sb.title.trim()); await expect(main(page)).not.toContainText(sa.title.trim());
  await signed(context, a.seat, english); await rights(a, { ...none, view: true });
  expect((await page.goto(web(a.scope, "requests", ra.orderId)))?.status()).toBe(200); await detailVisible(page, copy, sa, ra.orderId);
  expect(bodies).toHaveLength(1);
  await rights(a, { ...none, signCustomer: true }); expect((await page.goto(web(a.scope, "requests", ra.orderId)))?.status()).toBe(404);
  await expect(main(page)).not.toContainText(sa.title.trim()); await expect(main(page)).not.toContainText(sa.summary.trim());
  await rights(a, { ...none, view: true }); expect((await page.goto(web(a.scope, "requests", ra.orderId)))?.status()).toBe(200);
  await detailVisible(page, copy, sa, ra.orderId); const deniedCodes: string[] = [];
  await rights(a, none);
  const deniedUrl = detailRequest(sa, ra.orderId);
  await page.route(deniedUrl, async route => {
    const native = await route.fetch(); expect(native.status()).toBe(404); const value = await native.json(); expect(value.error.code).toBe("NOT_FOUND"); deniedCodes.push(value.error.code);
    await route.fulfill({ response: native, status: 404, contentType: "application/json", body: "{labelled_actual_native_scoped_denial" });
  });
  try {
    await expect(checkState(page, copy)).toBeVisible(); await checkState(page, copy).click();
    await expect.poll(() => deniedCodes.length).toBe(1);
    await expect(main(page)).not.toContainText(sa.title.trim()); await expect(main(page)).not.toContainText(sa.summary.trim());
    await expect(main(page)).not.toContainText(sb.title.trim()); await cannotSubmit(page, copy); expect(bodies).toHaveLength(1);
  } finally { await page.unroute(deniedUrl); }

{
  if (!sa.selected) throw new Error("Parent-denial witness requires sa's genuine pinned approved PNG context");
  const selected = sa.selected;
  await rights(a, all); await signed(context, a.seat, english);
  expect((await page.goto(web(a.scope, "campaigns", sa.campaignId)))?.status()).toBe(200);
  const files = main(page).locator("[data-reference-read-only-panel]").filter({
    has: page.getByRole("heading", { name: copy("ملفات النسخة المعتمدة", "Approved version files"), exact: true }),
  }).first();
  await expect(files).toBeVisible();
  const pinnedMetadata = (url: URL) => url.pathname === "/api/brand-contexts/references"
    && url.searchParams.get("scope") === "CLIENT" && url.searchParams.get("clientId") === a.client.id
    && url.searchParams.get("contextId") === selected.contextId && url.searchParams.get("versionId") === selected.version.id;
  const loaded = page.waitForResponse(response => pinnedMetadata(new URL(response.url())) && response.request().method() === "GET");
  await files.getByRole("button", { name: copy("تحميل الملفات", "Load files"), exact: true }).click();
  const loadedResponse = await loaded; expect(loadedResponse.status()).toBe(200);
  const loadedPacket = ContextReferenceResponseSchema.parse((await loadedResponse.json()).data);
  expect(loadedPacket.references).toEqual(selected.references);
  await expect(files).toContainText(fileLabel.trim()); await expect(files).toContainText(fileNote.trim());
  // All initial native child lookups settle before withdrawal, so a separate
  // managed-action denial cannot accidentally supply the cancellation witness.
  await page.waitForLoadState("networkidle");

  const parentDetail = (url: URL) => url.pathname === "/api/planning-campaigns/detail"
    && url.searchParams.get("scope") === "CLIENT" && url.searchParams.get("clientId") === a.client.id
    && url.searchParams.get("campaignId") === sa.campaignId && !url.searchParams.has("briefsAfter");
  let releaseHeld!: () => void;
  const released = new Promise<void>(resolve => { releaseHeld = resolve; });
  let nativeParentReady = false, parentFinished = false, nativeChildDenials = 0;
  const parentFailures: string[] = [];
  const observeParentFailure = (request: import("@playwright/test").Request) => {
    if (request.method() === "GET" && parentDetail(new URL(request.url()))) parentFailures.push(request.failure()?.errorText ?? "UNKNOWN_NATIVE_REQUEST_FAILURE");
  };
  page.on("requestfailed", observeParentFailure);
  await page.route(parentDetail, async route => {
    try {
      expect(route.request().method()).toBe("GET");
      const native = await route.fetch(); expect(native.status()).toBe(200);
      const value = PlanningCampaignSchema.parse((await native.json()).data);
      expect(value.campaign.id).toBe(sa.campaignId); expect(value.scope).toEqual(a.scope);
      expect(value.campaign.fields.summary).toBe(sa.summary); expect(value.planning.selectedContext?.id).toBe(selected.version.id);
      // This response was already authorized and produced before withdrawal.
      // Only its delivery is held; neither domain data nor status is replaced.
      nativeParentReady = true; await released;
      try { await route.fulfill({ response: native }); }
      catch (error) {
        // An actual client AbortController cancellation can close interception
        // before fulfillment. It is accepted only after observing that failure.
        if (parentFailures.length === 0) throw error;
      }
    } finally { parentFinished = true; }
  });
if (!bodies[0] || sa.brief.approvedAt === null || sa.brief.approvedByUserId === null
  || selected.references.kind !== "MANIFEST") throw new Error("Storage witness requires actual observed SUBMIT and approved scalar pins");
const recoveryCommand = ManagedOrderCommandSchema.parse(JSON.parse(bodies[0]));
expect(recoveryCommand.scope).toEqual(a.scope); expect(recoveryCommand.campaignId).toBe(sa.campaignId);
expect(recoveryCommand.briefId).toBe(sa.brief.id); expect(recoveryCommand.expectedBriefVersion).toBe(sa.brief.version);
expect(JSON.stringify(recoveryCommand)).toBe(bodies[0]);
const recoveryKey = "infame-managed-request:" + encodeURIComponent(a.seat.user.id)
  + ":" + encodeURIComponent("client:" + a.client.id) + ":" + encodeURIComponent(sa.campaignId);
// A strict MANIFEST-only subset of the production savedSchema. Every value is
// an existing native scalar; no original brief/context/reference data is saved.
const recoveryPacket = z.object({
  command: ManagedOrderCommandSchema, body: z.string().max(16384),
  sourceBinding: z.object({ inputRevision: z.number().int().positive(), approvedAt: z.iso.datetime(),
    approvedByUserId: z.string().min(1).max(200), contextVersionId: z.string().min(1).max(200),
    contextHash: z.string().regex(/^[a-f0-9]{64}$/), referenceKind: z.literal("MANIFEST"),
    manifestId: z.string().min(1).max(200), manifestHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  phase: z.literal("UNKNOWN"), receipt: z.null(),
}).strict().parse({ command: recoveryCommand, body: bodies[0], sourceBinding: {
  inputRevision: sa.brief.inputRevision, approvedAt: sa.brief.approvedAt, approvedByUserId: sa.brief.approvedByUserId,
  contextVersionId: selected.version.id, contextHash: selected.version.contentHash,
  referenceKind: "MANIFEST", manifestId: selected.references.id, manifestHash: selected.references.hash,
}, phase: "UNKNOWN", receipt: null });
expect(recoveryPacket.sourceBinding.inputRevision).toBeLessThanOrEqual(recoveryCommand.expectedCampaignRevision);
expect(recoveryPacket.sourceBinding.approvedByUserId).toBe(owner.user.id);
const recoveryWire = JSON.stringify(recoveryPacket);
for (const secret of [sa.title, sa.summary, sa.product, sa.narrative, sa.proposal, positioning, fileLabel, fileNote,
  a.seat.token, a.seat.actor.sessionId, a.seat.user.email, owner.token, owner.actor.sessionId]) expect(recoveryWire).not.toContain(secret);
for (const field of ["content", "conversation", "narrative", "proposals", "storageKey", "passwordHash", "sessionId", "accessToken", "reviewed"]) expect(recoveryWire).not.toContain(`"${field}"`);
  try {
    await main(page).getByRole("button", { name: copy("حدّث النسخة الحالية للمقارنة", "Refresh current version to compare"), exact: true }).click();
    await expect.poll(() => nativeParentReady, { timeout: 10000 }).toBe(true);
expect(bodies).toHaveLength(1);
expect(await page.evaluate(key => sessionStorage.getItem(key), recoveryKey)).toBeNull();
await page.evaluate(({ key, value }) => sessionStorage.setItem(key, value), { key: recoveryKey, value: recoveryWire });
expect(await page.evaluate(key => sessionStorage.getItem(key), recoveryKey)).toBe(recoveryWire);
expect(bodies).toHaveLength(1);
    await rights(a, none);
    await page.route(pinnedMetadata, async route => {
      expect(route.request().method()).toBe("GET");
      const native = await route.fetch(); expect(native.status()).toBe(404);
      expect(native.headers()["cache-control"]).toBe("private, no-store"); expect(native.headers()["x-request-id"]).toMatch(/^[a-f0-9-]{36}$/);
      const value = await native.json(); expect(value.error.code).toBe("NOT_FOUND"); expect(value.requestId).toBe(native.headers()["x-request-id"]);
      nativeChildDenials++;
      // Observe the genuine native body before status-first browser teardown;
      // relay its exact status, headers and body without a synthetic denial.
      await route.fulfill({ response: native });
    });
    const denied = page.waitForResponse(response => pinnedMetadata(new URL(response.url())) && response.request().method() === "GET");
    await files.getByRole("button", { name: copy("تحديث القراءة", "Refresh read"), exact: true }).click();
    const nativeDenied = await denied; expect(nativeDenied.status()).toBe(404);
    expect(nativeChildDenials).toBe(1);
    // Bounded below the parent's actual30s timeout: cancellation must follow
    // native child denial, while the old authorized200 is still undelivered.
    await expect.poll(() => parentFailures.length, { timeout: 3000 }).toBe(1);
    expect(parentFailures[0]).toMatch(/aborted|cancelled|canceled/i);
await expect.poll(() => page.evaluate(key => sessionStorage.getItem(key), recoveryKey), { timeout: 3000 }).toBeNull();
expect(bodies).toHaveLength(1);
    await expect(main(page)).not.toContainText(sa.title.trim()); await expect(main(page)).not.toContainText(sa.summary.trim());
    await expect(main(page)).not.toContainText(positioning.trim()); await expect(main(page)).not.toContainText(fileLabel.trim());
    await expect(main(page).getByLabel(copy("ملخص الحملة", "Campaign summary"), { exact: true })).toHaveCount(0);
    releaseHeld(); await expect.poll(() => parentFinished, { timeout: 5000 }).toBe(true);
    await expect(main(page)).not.toContainText(sa.title.trim()); await expect(main(page)).not.toContainText(sa.summary.trim());
    await expect(main(page)).not.toContainText(positioning.trim()); await expect(main(page)).not.toContainText(fileNote.trim());
    await expect(main(page).getByLabel(copy("ملخص الحملة", "Campaign summary"), { exact: true })).toHaveCount(0);
expect(await page.evaluate(key => sessionStorage.getItem(key), recoveryKey)).toBeNull();
expect(bodies).toHaveLength(1);
    await cannotSubmit(page, copy); expect(bodies).toHaveLength(1);
  } finally {
    releaseHeld(); await expect.poll(() => parentFinished, { timeout: 5000 }).toBe(true);
    await page.unroute(parentDetail); await page.unroute(pinnedMetadata); page.off("requestfailed", observeParentFailure);
  }
}
{
  await rights(a, all); await signed(context, a.seat, english);
  expect((await page.goto(web(a.scope, "campaigns", "new")))?.status()).toBe(200);
  const draftTitle = "Native new-page purge observer " + key().slice(0, 8);
  await main(page).getByLabel(copy("نسخة السياق", "Context version"), { exact: true }).selectOption("NONE");
  await main(page).getByLabel(copy("اسم الحملة", "Campaign title"), { exact: true }).fill(draftTitle);
  const createdResponse = page.waitForResponse(response => {
    if (new URL(response.url()).pathname !== "/api/planning-campaigns/commands" || response.request().method() !== "POST") return false;
    const input = response.request().postDataJSON(); return input.action === "CREATE" && input.scope.kind === "CLIENT" && input.scope.clientId === a.client.id;
  });
  await main(page).getByRole("button", { name: copy("راجع واحفظ التفاصيل", "Review and save details"), exact: true }).click();
  const createdNative = await createdResponse; expect(createdNative.status()).toBe(200);
  const created = CampaignPlanningResultSchema.parse((await createdNative.json()).data);
  expect(created.action).toBe("CREATE"); expect(created.briefId).toBeNull();
  await expect(main(page).getByRole("button", { name: copy("إلغاء الانتظار", "Cancel request"), exact: true })).toHaveCount(0);
  // The heading changes only once the actual CREATE's authorized current read
  // installs the campaign. There is no private-state hook or mocked producer.
  await expect(main(page).getByRole("heading", { name: copy("رتّب تفاصيل حملتك", "Shape your campaign"), exact: true })).toBeVisible();
  await expect(main(page).getByLabel(copy("اسم الحملة", "Campaign title"), { exact: true })).toHaveValue(draftTitle);
  expect(new URL(page.url()).pathname).toBe("/brand/campaigns/new"); expect(new URL(page.url()).searchParams.get("clientId")).toBe(a.client.id);
  const installed = await current(context, a.scope, created.campaignId);
  expect(installed.campaign.id).toBe(created.campaignId); expect(installed.campaign.fields.title).toBe(draftTitle);
  expect(installed.planning.selection.kind).toBe("NONE"); expect(installed.briefs).toEqual([]);
  expect(await db.managedOrder.count({ where: { campaignId: created.campaignId } })).toBe(0);
  expect(bodies).toHaveLength(1);
  const observerKey = "infame-managed-request:" + encodeURIComponent(a.seat.user.id)
    + ":" + encodeURIComponent("client:" + a.client.id) + ":" + encodeURIComponent(created.campaignId);
  const observerWire = JSON.stringify({ fixturePurpose: "SCOPED_PURGE_OBSERVER_ONLY", actorReference: a.seat.user.id,
    scopeKind: "CLIENT", clientId: a.client.id, campaignId: created.campaignId });
  for (const secret of [draftTitle, sa.summary, sa.narrative, fileNote, a.seat.token, a.seat.actor.sessionId]) expect(observerWire).not.toContain(secret);
  expect(await page.evaluate(key => sessionStorage.getItem(key), observerKey)).toBeNull();
  await page.evaluate(({ key, value }) => sessionStorage.setItem(key, value), { key: observerKey, value: observerWire });
  expect(await page.evaluate(key => sessionStorage.getItem(key), observerKey)).toBe(observerWire);
  const newPageDetail = (url: URL) => url.pathname === "/api/planning-campaigns/detail"
    && url.searchParams.get("scope") === "CLIENT" && url.searchParams.get("clientId") === a.client.id
    && url.searchParams.get("campaignId") === created.campaignId && !url.searchParams.has("briefsAfter");
  let nativeDenials = 0;
  await page.route(newPageDetail, async route => {
    expect(route.request().method()).toBe("GET");
    const native = await route.fetch(); expect(native.status()).toBe(404);
    expect(native.headers()["cache-control"]).toBe("private, no-store"); expect(native.headers()["x-request-id"]).toMatch(/^[a-f0-9-]{36}$/);
    const value = await native.json(); expect(value.error.code).toBe("NOT_FOUND"); expect(value.requestId).toBe(native.headers()["x-request-id"]);
    nativeDenials++;
    // Native denial is inspected before the browser's status-first clear.
    // Relay the original response unchanged; no synthetic status or body.
    await route.fulfill({ response: native });
  });
  try {
    await rights(a, none);
    await main(page).getByRole("button", { name: copy("حدّث النسخة الحالية للمقارنة", "Refresh current version to compare"), exact: true }).click();
    await expect.poll(() => nativeDenials, { timeout: 10000 }).toBe(1);
    await expect(main(page).getByLabel(copy("اسم الحملة", "Campaign title"), { exact: true })).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe("/brand/campaigns/new");
    // Concrete RED under routeId-only purge: the labelled observer remains
    // after actual parent denial despite its installed current campaign ID.
    await expect.poll(() => page.evaluate(key => sessionStorage.getItem(key), observerKey), { timeout: 3000 }).toBeNull();
    expect(bodies).toHaveLength(1); expect(await db.managedOrder.count({ where: { campaignId: created.campaignId } })).toBe(0);
  } finally {
    await page.unroute(newPageDetail);
    // Clean only this synthetic observer if an expected RED stops the journey.
    await page.evaluate(key => sessionStorage.removeItem(key), observerKey);
  }
}
  await page.screenshot({ path: info.outputPath("managed-request-client-denial.png"), fullPage: true });
});

test("committed lost reply and another genuine receipt preserve exact retry; confirmed recovery sends GET only and native revocation clears state", async ({ page, context }, info) => {
  const { english, copy } = locale(info), owner = await company(english);
  const a = await source(context, owner, owner, owner.scope, english, "RECOVERY A"), b = await source(context, owner, owner, owner.scope, english, "OTHER RECEIPT B");
  const expected = await expectedCommand(context, a), bInput = await expectedCommand(context, b);
  const otherResponse = await context.request.post("/api/managed-orders/commands", { headers: { Origin: origin }, data: bInput });
  expect(otherResponse.status()).toBe(200); const realB = ManagedOrderResultSchema.parse((await wire(otherResponse)).data);
  const bodies: string[] = [], getUrls: string[] = []; let deliveries = 0, realA: ReturnType<typeof ManagedOrderResultSchema.parse> | undefined, rejectCurrent = true;
let retainedSubmission1Response: APIResponse | null = null;
  let replayRetainedSubmission1 = false, deliveredAdvancedDetail = 0;
  await page.emulateMedia({ reducedMotion: "reduce" }); expect((await page.goto(web(a.scope, "campaigns", a.campaignId)))?.status()).toBe(200);
  const detailUrl = (url: URL) => url.pathname === "/api/managed-orders/detail" && realA !== undefined && url.searchParams.get("orderId") === realA.orderId;
  await page.route(commandUrl, async route => {
    expect(route.request().method()).toBe("POST"); const raw = route.request().postData(); if (raw === null) throw new Error("Recovery POST body missing"); bodies.push(raw);
    const native = await route.fetch(); expect(native.status()).toBe(200); const value = await native.json();
    realA = ManagedOrderResultSchema.parse(value.data); expect(realA.campaignId).toBe(a.campaignId);
    deliveries++;
    if (deliveries === 1) await route.abort("failed");
    else if (deliveries === 2) await route.fulfill({ response: otherResponse });
    else await route.fulfill({ response: native });
  });
  await page.route(detailUrl, async route => {
    expect(route.request().method()).toBe("GET"); getUrls.push(route.request().url());
    const native = await route.fetch(); expect(native.status()).toBe(200);
    const actualDetail = ManagedOrderDetailSchema.parse((await native.json()).data);
    if (replayRetainedSubmission1) {
      if (!retainedSubmission1Response) throw new Error("Actual retained submission1 response was not captured");
      expect(actualDetail.order.submission.version).toBe(2);
      // Explicit delivery replay of genuine earlier authorized data. Current
      // storage remains version2; this is not a fake public amendment/reversal.
      await route.fulfill({ response: retainedSubmission1Response });
    } else if (rejectCurrent) {
      await route.fulfill({ response: native, status: 503, json: { error: { code: "RETRY_REQUIRED", message: "RETRY_REQUIRED",
        requestId: native.headers()["x-request-id"], retryable: true }, requestId: native.headers()["x-request-id"] } });
    } else {
      expect(realA).toBeDefined(); expect(actualDetail.order.id).toBe(realA!.orderId);
      expect(actualDetail.order.submission.version).toBe(2); deliveredAdvancedDetail++;
      await route.fulfill({ response: native });
    }
  });
  try {
    const disclosure = await openDisclosure(page, copy, a); await disclosure.confirm.click();
    await expect(retrySame(page, copy)).toBeVisible(); await expect(retrySame(page, copy)).toBeEnabled();
    expect(bodies).toHaveLength(1); sameCapture(bodies[0]!, expected); const first = await committedOnce(a, bodies[0]!);
    expect(new URL(page.url()).pathname).toBe(`/brand/campaigns/${a.campaignId}`);
    await retrySame(page, copy).click(); await expect.poll(() => bodies.length).toBe(2);
    await expect(retrySame(page, copy)).toBeVisible(); await expect(retrySame(page, copy)).toBeEnabled();
    expect(bodies[1]).toBe(bodies[0]); expect(new URL(page.url()).pathname).not.toBe(`/brand/requests/${realB.orderId}`);
    await expect(main(page)).not.toContainText(b.title.trim());
    await retrySame(page, copy).click(); await expect.poll(() => bodies.length).toBe(3);
    await expect.poll(() => getUrls.length).toBeGreaterThan(0); await expect(retrySame(page, copy)).toHaveCount(0);
    await expect(checkState(page, copy)).toBeVisible(); await expect(checkState(page, copy)).toBeEnabled();
    expect(new Set(bodies).size).toBe(1); await committedOnce(a, bodies[0]!);
    // Any persisted request retry packet can contain the scalar capture only.
    const packets = await page.evaluate(operationKey => Object.entries(sessionStorage).filter(([, value]) => value.includes(operationKey)).map(([, value]) => value), JSON.parse(bodies[0]!).operationKey);
    for (const packet of packets) for (const secret of [a.summary, a.narrative, a.proposal, "accessToken", "passwordHash"]) expect(packet).not.toContain(secret);
    const original = await db.managedOrderSubmission.findUniqueOrThrow({ where: { id: first.submissionId } });
    expect(original.orderId).toBe(first.orderId); expect(original.version).toBe(1);
    retainedSubmission1Response = await context.request.get(`/api/managed-orders/detail?${scopeQuery(a.scope)}&orderId=${first.orderId}`);
    expect(retainedSubmission1Response.status()).toBe(200);
    const retainedDetail = ManagedOrderDetailSchema.parse((await wire(retainedSubmission1Response)).data);
    expect(retainedDetail.order.submission.id).toBe(original.id); expect(retainedDetail.order.submission.version).toBe(1);

    // Explicit authorized synthetic storage producer: same actual approved
    // source, immutable old child, one new version and exact forward state.
    const advanced = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "ManagedOrder" WHERE id=${original.orderId} AND "workspaceId"=${original.workspaceId} FOR UPDATE`;
      const now = new Date();
      const child = await tx.managedOrderSubmission.create({ data: {
        id: key(), orderId: original.orderId, workspaceId: original.workspaceId, campaignId: original.campaignId, version: 2,
        briefId: original.briefId, briefVersion: original.briefVersion, inputRevision: original.inputRevision,
        campaignRevision: original.campaignRevision, planningRevision: original.planningRevision,
        selectionId: original.selectionId, selectionRevision: original.selectionRevision,
        approvedByUserId: original.approvedByUserId, approvedAt: original.approvedAt,
        contextReferenceSubmissionId: original.contextReferenceSubmissionId, snapshot: original.snapshot as Prisma.InputJsonValue,
        snapshotHash: original.snapshotHash, submittedByUserId: original.submittedByUserId,
        disclosureVersion: original.disclosureVersion, createdAt: now,
      } });
      const changed = await tx.managedOrderState.updateMany({ where: { orderId: original.orderId, workspaceId: original.workspaceId,
        revision: 1, submissionId: original.id, submissionVersion: 1, status: "REQUESTED" },
        data: { revision: 2, submissionId: child.id, submissionVersion: 2, updatedAt: now } });
      expect(changed.count).toBe(1); return child;
    });
    expect(await db.managedOrderSubmission.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
    const genuineAdvanced = await currentDetail(context, a, first.orderId);
    expect(genuineAdvanced.order).toMatchObject({ id: first.orderId, revision: 2,
      submission: { id: advanced.id, version: 2, snapshotHash: original.snapshotHash } });
    expect(genuineAdvanced.order.submission.id).not.toBe(first.submissionId);
    const beforeMismatchPosts = bodies.length, getCount = getUrls.length;
    rejectCurrent = false; await checkState(page, copy).click();
    await expect.poll(() => deliveredAdvancedDetail, { timeout: 5000 }).toBe(1);
    await expect(checkState(page, copy)).toBeEnabled({ timeout: 5000 });
    await expect(retrySame(page, copy)).toHaveCount(0, { timeout: 3000 });
    expect(bodies).toHaveLength(beforeMismatchPosts); expect(bodies).toHaveLength(3);
    expect(new URL(page.url()).pathname).toBe(`/brand/campaigns/${a.campaignId}`);
    const pendingPackets = await page.evaluate(operationKey => Object.values(sessionStorage)
      .filter(value => value.includes(operationKey)).map(value => JSON.parse(value)), JSON.parse(bodies[0]!).operationKey);
    expect(pendingPackets).toHaveLength(1);
    expect(pendingPackets[0]).toMatchObject({ phase: "CONFIRMED", body: bodies[0], receipt: {
      orderId: first.orderId, submissionId: first.submissionId, submissionVersion: 1,
    } });
    await expect(main(page)).not.toContainText(b.title.trim());

    // User asks for current recovery again. Fetch still produces real version2;
    // only delivery now replays the genuine saved version1 response explicitly.
    replayRetainedSubmission1 = true; await checkState(page, copy).click();
    await detailVisible(page, copy, a, first.orderId);
    expect(bodies).toHaveLength(3); expect(getUrls.length).toBeGreaterThan(getCount);
    expect(new Set(getUrls).size).toBe(1);
    expect(await db.managedOrderSubmission.count({ where: { orderId: first.orderId } })).toBe(2);
    expect(await db.managedOrderSubmission.count({ where: { id: first.submissionId, orderId: first.orderId, version: 1 } })).toBe(1);
    expect(await db.managedOrderSubmission.count({ where: { id: advanced.id, orderId: first.orderId, version: 2 } })).toBe(1);
    expect(await db.managedOrderCommand.count({ where: { actorUserId: a.account.user.id,
      operationKey: JSON.parse(bodies[0]!).operationKey } })).toBe(1);
    const retainedCommand = ManagedOrderCommandSchema.parse(JSON.parse(bodies[0]!));
    const retainedJournal = await db.managedOrderCommand.findUniqueOrThrow({ where: { actorUserId_operationKey: {
      actorUserId: a.account.user.id, operationKey: retainedCommand.operationKey,
    } } });
    expect(retainedJournal.payloadHash).toBe(canonicalHash({ purpose: "MANAGED_ORDER_COMMAND_V1", actorUserId: a.account.user.id, command: retainedCommand }));
    expect(await db.managedOrder.count({ where: { campaignId: a.campaignId } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { type: "managed_order.requested", payload: { path: ["aggregateId"], equals: first.orderId } } })).toBe(1);
    expect(await db.managedOrderState.findUniqueOrThrow({ where: { orderId: first.orderId } })).toMatchObject({ revision: 2,
      submissionId: advanced.id, submissionVersion: 2 });
    expect(await db.managedOrderSubmission.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
    await privacy(main(page), a, [b.title.trim(), b.summary.trim()]);
  } finally { await page.unroute(commandUrl); await page.unroute(detailUrl); }
  if (!realA || !bodies[0]) throw new Error("Actual managed recovery receipt was not recorded");
  const revokedUrl = detailRequest(a, realA.orderId), nativeCodes: string[] = [];
  await db.authSession.update({ where: { id: owner.actor.sessionId }, data: { revokedAt: new Date() } });
  await page.route(revokedUrl, async route => {
    const native = await route.fetch(); expect(native.status()).toBe(401); const value = await native.json(); expect(value.error.code).toBe("UNAUTHENTICATED"); nativeCodes.push(value.error.code);
    await route.fulfill({ response: native, status: 401, contentType: "application/json", body: "{labelled_actual_native_session_denial" });
  });
  try {
    await expect(checkState(page, copy)).toBeVisible(); await checkState(page, copy).click(); await expect.poll(() => nativeCodes.length).toBe(1);
    await expect(main(page)).not.toContainText(a.title.trim()); await expect(main(page)).not.toContainText(a.summary.trim()); await cannotSubmit(page, copy);
    expect(bodies).toHaveLength(3);
    const stored = await page.evaluate(operationKey => Object.values(sessionStorage).filter(value => value.includes(operationKey)), JSON.parse(bodies[0]!).operationKey);
    expect(stored).toEqual([]);
  } finally { await page.unroute(revokedUrl); }
  await page.screenshot({ path: info.outputPath("managed-request-recovery-denial.png"), fullPage: true });
});
