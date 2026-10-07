import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { SESSION_COOKIE } from "@/lib/jwt";
import type { OrganizationActor } from "@/lib/organizations/context";
import type { ClientCapabilities } from "@/lib/organizations/contracts";
import { getClientAuthority } from "@/lib/organizations/loaders";
import { acceptMembership, authorizeClientAssociation, createOrganization, proposeClientAssociation,
  proposeMember, setClientGrant } from "@/lib/organizations/service";
import type { PlanningScope } from "@/lib/brand-context/contracts";
import { executeCampaignPlanningCommand, getPlanningCampaign, decideCampaignOwnerReview } from "@/lib/campaign-planning/service";
import { campaignBriefDTO } from "@/lib/campaigns/core";
import { ManagedOrderCommandSchema, ManagedOrderDetailSchema, ManagedOrderListSchema,
  ManagedOrderReceiptSchema, ManagedOrderResultSchema, ManagedOrderSnapshotSchema } from "@/lib/managed/contracts";
import { submitManagedOrder } from "@/lib/managed/orders";
import { loadManagedOrders, loadManagedOrder, commandManagedOrder } from "@/lib/managed/transport";
import { campaignFields } from "../campaigns/fixtures";

// Exactly two full native Request adapter groups. Only Next's asynchronous
// cookie context is mocked. Signed JWTs, current Users/AuthSessions, agency
// consent/grants, real M03 approvals and PostgreSQL are owned synthetic native
// fixtures. This is no live commercial/provider/legal acceptance. Root runs.
let token: string | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => name === SESSION_COOKIE && token ? { name, value: token } : undefined }) }));
const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>();
const key = () => randomUUID(), disclosureVersion = "infame-order-disclosure-v1" as const;
const all: ClientCapabilities = { view: true, plan: true, approveShortlist: true, reviewContent: true,
  signCustomer: true, financial: true, manageGrants: true };
const privateNarrative = "Unsubmitted managed-route original narrative canary";
const privateProposal = "Unapproved managed-route original proposal canary";
const managedTables = ["ManagedOrderCommand", "ManagedOrderState", "ManagedOrderSubmission", "ManagedOrder"] as const;

afterEach(async () => {
  token = null;
  const workspaces = await prisma.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } });
  const ids = workspaces.map(row => row.id);
  if (ids.length) {
    // Exact test-owned scopes only; retained managed children precede M03.
    for (const table of managedTables) {
      const exists = await prisma.$queryRaw<Array<{ present: boolean }>>`SELECT to_regclass(${`"${table}"`}) IS NOT NULL AS present`;
      if (exists[0]?.present) await prisma.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join(ids)})`);
    }
    for (const table of ["ContextReferenceCommand", "ContextSubmissionReferences", "ContextReferenceState", "ContextReferenceManifest", "ContextAssetBinding",
      "PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission", "CampaignBriefProvenance",
      "CampaignProposalDependency", "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding", "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const) {
      await prisma.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join(ids)})`);
    }
    await prisma.planningWorkspace.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.campaign.deleteMany({ where: { brandId: { in: [...brands] } } });
  await prisma.organizationCommand.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await prisma.clientGrant.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organizationClient.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [...organizations] } } });
  await prisma.brand.deleteMany({ where: { id: { in: [...brands] } } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
  if (users.size) await prisma.outboxEvent.deleteMany({ where: { OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
  users.clear(); brands.clear(); organizations.clear();
});

async function sign(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const signed = await openSession(user.id, user.sessionVersion, user.passwordHash), session = await resolveSession(signed);
  if (!session) throw new Error("Synthetic native managed-route session did not resolve");
  const actor: OrganizationActor = { userId: session.userId, role: session.role, sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  expect(actor.userId).toBe(userId); expect(actor.role).toBe(user.role);
  return { user, actor, token: signed };
}
async function person(role: "BRAND" | "CREATOR" | "ADMIN" = "BRAND") {
  const id = key(); users.add(id);
  await prisma.user.create({ data: { id, role, active: true, isTest: true, name: "Synthetic managed-route actor",
    email: `${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  return sign(id);
}
type Account = Awaited<ReturnType<typeof person>>;
async function company() {
  const owner = await person(), brand = await prisma.brand.create({ data: { userId: owner.user.id, countryCode: "KW", isTest: true,
    slug: "managed-route-" + key().replace(/-/g, ""), name: "Synthetic original managed-route company" } });
  brands.add(brand.id); return { ...owner, brand, scope: { kind: "OWN_BRAND", brandId: brand.id } as PlanningScope };
}
type Company = Awaited<ReturnType<typeof company>>;
async function agency(customer: Company, label: string) {
  const owner = await person(), seat = await person();
  const { organization } = await createOrganization(owner.actor, { operationKey: key(), kind: "AGENCY", nameOriginal: "Synthetic managed-route agency " + label });
  organizations.add(organization.id);
  const revision = async () => (await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).revision;
  const proposed = await proposeClientAssociation(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), brandId: customer.brand.id });
  const { client } = await authorizeClientAssociation(customer.actor, proposed.client.id, { operationKey: key(), expectedRevision: proposed.client.revision, capabilities: all });
  const pending = await proposeMember(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), targetUserId: seat.user.id });
  const { membership } = await acceptMembership(seat.actor, pending.membership.id, { operationKey: key(), expectedRevision: pending.membership.revision });
  const { grant } = await setClientGrant(owner.actor, client.id, { operationKey: key(), expectedClientRevision: client.revision,
    membershipId: membership.id, expectedGrantRevision: null, capabilities: all });
  return { owner, seat, organization, client, membership, grant, scope: { kind: "CLIENT", clientId: client.id } as PlanningScope };
}
type Agency = Awaited<ReturnType<typeof agency>>;
async function rights(a: Agency, capabilities: ClientCapabilities) {
  const grant = await prisma.clientGrant.findUniqueOrThrow({ where: { id: a.grant.id } });
  const client = await prisma.organizationClient.findUniqueOrThrow({ where: { id: a.client.id } });
  return setClientGrant(a.owner.actor, a.client.id, { operationKey: key(), expectedClientRevision: client.revision,
    membershipId: a.membership.id, expectedGrantRevision: grant.revision, capabilities });
}
async function planningAuthority(account: Account, scope: PlanningScope) {
  return scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(account.actor, scope.clientId, "plan") } : {};
}
async function planningStep(account: Account, scope: PlanningScope, campaignId: string, action: string, payload: unknown) {
  const current = await getPlanningCampaign(account.actor, { scope, campaignId });
  return executeCampaignPlanningCommand(account.actor, { operationKey: key(), scope, ...await planningAuthority(account, scope), campaignId,
    expectedCampaignRevision: current.campaign.revision, expectedPlanningRevision: current.planning.revision,
    expectedSelectionId: current.planning.selection.id, expectedSelectionRevision: current.planning.selection.revision, action, payload });
}
async function approvedSource(owner: Company, account: Account = owner, scope = owner.scope, label = "OWN") {
  const created = await executeCampaignPlanningCommand(account.actor, { operationKey: key(), scope, ...await planningAuthority(account, scope), action: "CREATE",
    expectedCampaignRevision: 0, expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0,
    payload: { fields: { ...campaignFields, title: "  حملة أصلية " + label + "  " }, selection: { kind: "NONE" }, narrative: null } });
  await planningStep(account, scope, created.campaignId, "SAVE_NARRATIVE", { narrative: { schemaVersion: 1, mode: "CHAT", processing: "UNPROCESSED",
    originalText: { text: privateNarrative, language: "en" } } });
  await planningStep(account, scope, created.campaignId, "PROPOSE_FIELDS", { type: "PROPOSE_FIELDS", patch: { summary: privateProposal },
    originalText: { text: privateProposal, language: "en" } });
  const generated = await planningStep(account, scope, created.campaignId, "GENERATE_BRIEF", {});
  const submitted = await planningStep(account, scope, created.campaignId, "SUBMIT_BRIEF", { briefId: generated.briefId!, expectedBriefVersion: generated.version! });
  const approved = await decideCampaignOwnerReview(owner.actor, { operationKey: key(), submissionId: submitted.submissionId!, expectedRevision: 1, decision: "APPROVE" });
  expect(approved.state).toBe("APPROVED");
  const current = await getPlanningCampaign(account.actor, { scope, campaignId: created.campaignId });
  const brief = campaignBriefDTO(await prisma.campaignBrief.findUniqueOrThrow({ where: { id: generated.briefId! } }));
  expect(brief.approvedByUserId).toBe(owner.user.id); expect(brief.content.approvedByUserId).toBe(owner.user.id);
  expect(current.campaign.currentBriefVersion).toBe(brief.version);
  const input = ManagedOrderCommandSchema.parse({ action: "SUBMIT", operationKey: key(), scope, campaignId: created.campaignId,
    expectedCampaignRevision: current.campaign.revision, expectedPlanningRevision: current.planning.revision,
    expectedSelectionId: current.planning.selection.id, expectedSelectionRevision: current.planning.selection.revision,
    briefId: brief.id, expectedBriefVersion: brief.version, disclosureVersion,
    ...(scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(account.actor, scope.clientId, "signCustomer") } : {}) });
  return { owner, account, scope, campaignId: created.campaignId, brief, input };
}
function origin() { if (!process.env.APP_ORIGIN) throw new Error("Guarded route target requires APP_ORIGIN"); return new URL(process.env.APP_ORIGIN).origin; }
function get(path = "", search = "") { return new Request(`${origin()}/api/managed-orders${path}${search}`); }
function post(body: unknown, requestOrigin: string | null = origin(), search = "") {
  const headers = new Headers({ "content-type": "application/json" }); if (requestOrigin !== null) headers.set("origin", requestOrigin);
  return new Request(`${origin()}/api/managed-orders/commands${search}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}
function scopeQuery(scope: PlanningScope) { return scope.kind === "OWN_BRAND" ? `?scope=OWN_BRAND&brandId=${encodeURIComponent(scope.brandId)}` : `?scope=CLIENT&clientId=${encodeURIComponent(scope.clientId)}`; }
async function envelope(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
  const body = await response.json(); expect(body.requestId).toBe(response.headers.get("x-request-id")); return body;
}
async function success(response: Response) {
  expect(response.status).toBe(200); const body = await envelope(response); expect(Object.keys(body).sort()).toEqual(["data", "requestId"]); return body.data;
}
async function failure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status); const body = await envelope(response); expect(Object.keys(body).sort()).toEqual(["error", "requestId"]);
  expect(body.error).toEqual({ code, message: code, requestId: body.requestId, retryable: status === 503 || status === 429 }); return body;
}
async function actorFailure(status: number, code: string) {
  await failure(await loadManagedOrders(get("", "?scope=bad&limit=1&limit=1&actorUserId=private")), status, code);
  await failure(await loadManagedOrder(get("/detail", "?scope=bad&orderId=bad&orderId=bad&actorUserId=private")), status, code);
  const request = post("{malformed private original", origin(), "?scope=bad&scope=bad");
  await failure(await commandManagedOrder(request), status, code); expect(request.bodyUsed).toBe(false);
}
async function effects() {
  const workspaces = await prisma.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } });
  const ids = workspaces.map(row => row.id), rows: Record<string, unknown> = {};
  for (const table of managedTables) rows[table] = ids.length ? await prisma.$queryRaw(Prisma.sql`SELECT * FROM ${Prisma.raw('"' + table + '"')}
    WHERE "workspaceId" IN (${Prisma.join(ids)}) ORDER BY ${Prisma.raw(table === "ManagedOrderState" ? '"orderId"' : "id")}`) : [];
  const [audits, events] = await Promise.all([
    prisma.adminAudit.findMany({ where: { actorUserId: { in: [...users] }, action: { startsWith: "managed_order." } }, orderBy: { id: "asc" } }),
    prisma.outboxEvent.findMany({ where: { type: "managed_order.requested", OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) }, orderBy: { id: "asc" } }),
  ]); return JSON.stringify({ ...rows, audits, events });
}
function keys(value: object, expected: readonly string[]) { expect(Object.keys(value).sort()).toEqual([...expected].sort()); }
function privateSafe(value: unknown, accounts: readonly Account[]) {
  const json = JSON.stringify(value);
  for (const canary of [privateNarrative, privateProposal, ...accounts.flatMap(account => [account.token, account.actor.sessionId, account.user.email])]) expect(json).not.toContain(canary);
  const denied = new Set(["conversation", "narrative", "proposals", "storageKey", "passwordHash", "sessionId", "supplierCost", "supplierCosts", "laborCost", "operationsAi", "retailPrice", "price"]);
  function visit(item: unknown) {
    if (item === null || typeof item !== "object") return;
    for (const [name, child] of Object.entries(item)) { expect(denied.has(name)).toBe(false); visit(child); }
  }
  visit(value);
}

describe("managed-order native adapters: current actors, exact scope and strict private wire", () => {
  it("authenticates before parsing and isolates OWN plus same-Brand CLIENT reads/replay with current native sessions and signCustomer", async () => {
    token = null; await actorFailure(401, "UNAUTHENTICATED"); token = "not-a-signed-native-token"; await actorFailure(401, "UNAUTHENTICATED");
    for (const role of ["CREATOR", "ADMIN"] as const) { const wrong = await person(role); token = wrong.token; await actorFailure(403, "FORBIDDEN"); }
    const other = await person();
    const invalidations: Array<(account: Account) => Promise<unknown>> = [
      account => prisma.authSession.update({ where: { id: account.actor.sessionId }, data: { revokedAt: new Date() } }),
      account => prisma.authSession.update({ where: { id: account.actor.sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } }),
      account => prisma.authSession.update({ where: { id: account.actor.sessionId }, data: { version: { increment: 1 } } }),
      account => prisma.authSession.update({ where: { id: account.actor.sessionId }, data: { userId: other.user.id } }),
      account => prisma.user.update({ where: { id: account.user.id }, data: { sessionVersion: { increment: 1 } } }),
      account => prisma.user.update({ where: { id: account.user.id }, data: { active: false } }),
    ];
    for (const invalidate of invalidations) {
      const account = await person(); await invalidate(account); token = account.token;
      expect(await resolveSession(account.token)).toBeNull(); await actorFailure(401, "UNAUTHENTICATED");
    }
    const changed = await person(); await prisma.user.update({ where: { id: changed.user.id }, data: { role: "ADMIN" } });
    token = changed.token; expect(await resolveSession(token)).toBeNull(); await actorFailure(401, "UNAUTHENTICATED");
    token = (await sign(changed.user.id)).token; await actorFailure(403, "FORBIDDEN");

    const f = await company(), a = await agency(f, "A"), b = await agency(f, "B");
    const own = await approvedSource(f), ca = await approvedSource(f, a.seat, a.scope, "CLIENT A"), cb = await approvedSource(f, b.seat, b.scope, "CLIENT B");
    const ro = await submitManagedOrder(f.actor, own.input), ra = await submitManagedOrder(a.seat.actor, ca.input), rb = await submitManagedOrder(b.seat.actor, cb.input);
    token = f.token;
    const ownList = ManagedOrderListSchema.parse(await success(await loadManagedOrders(get("", scopeQuery(f.scope)))));
    expect(ownList.orders.map(row => row.id)).toEqual([ro.orderId]); expect(ownList.currentAuthority).toBeNull(); expect(ownList.scope).toEqual(f.scope);
    await failure(await loadManagedOrder(get("/detail", scopeQuery(f.scope) + `&orderId=${ra.orderId}`)), 404, "NOT_FOUND");
    await failure(await loadManagedOrder(get("/detail", scopeQuery(a.scope) + `&orderId=${ra.orderId}`)), 404, "NOT_FOUND");
    await failure(await loadManagedOrders(get("", scopeQuery(a.scope))), 404, "NOT_FOUND");
    token = a.seat.token;
    const aList = ManagedOrderListSchema.parse(await success(await loadManagedOrders(get("", scopeQuery(a.scope)))));
    expect(aList.orders.map(row => row.id)).toEqual([ra.orderId]); expect(aList.currentAuthority?.capability).toBe("view"); expect(aList.currentAuthority?.clientId).toBe(a.client.id);
    const aDetail = ManagedOrderDetailSchema.parse(await success(await loadManagedOrder(get("/detail", scopeQuery(a.scope) + `&orderId=${ra.orderId}`))));
    expect(aDetail.order.id).toBe(ra.orderId); expect(aDetail.order.submission.snapshot.brief.approvedByUserId).toBe(f.user.id); expect(aDetail.quote).toBeNull();
    privateSafe([ownList, aList, aDetail], [f, a.seat, b.seat]);
    for (const query of [scopeQuery(a.scope) + `&orderId=${rb.orderId}`, scopeQuery(b.scope) + `&orderId=${rb.orderId}`,
      scopeQuery(f.scope) + `&orderId=${ro.orderId}`, scopeQuery(a.scope) + `&orderId=${key()}`]) {
      await failure(await loadManagedOrder(get("/detail", query)), 404, "NOT_FOUND");
    }
    await failure(await loadManagedOrders(get("", scopeQuery(a.scope) + `&after=${rb.orderId}`)), 404, "NOT_FOUND");
    const outsider = await company(); token = outsider.token;
    await failure(await loadManagedOrders(get("", scopeQuery(f.scope))), 404, "NOT_FOUND");
    await failure(await loadManagedOrder(get("/detail", scopeQuery(f.scope) + `&orderId=${ro.orderId}`)), 404, "NOT_FOUND");

    const viewOnly = { ...all, plan: false, approveShortlist: false, reviewContent: false, signCustomer: false, financial: false, manageGrants: false };
    await rights(a, viewOnly); token = a.seat.token; const stable = await effects();
    await failure(await commandManagedOrder(post(ca.input)), 404, "NOT_FOUND"); expect(await effects()).toBe(stable);
    expect(ManagedOrderListSchema.parse(await success(await loadManagedOrders(get("", scopeQuery(a.scope))))).currentAuthority?.capability).toBe("view");
    await rights(a, { ...viewOnly, view: false }); const denied = await effects();
    await failure(await loadManagedOrders(get("", scopeQuery(a.scope))), 404, "NOT_FOUND");
    await failure(await loadManagedOrder(get("/detail", scopeQuery(a.scope) + `&orderId=${ra.orderId}`)), 404, "NOT_FOUND");
    await failure(await commandManagedOrder(post(ca.input)), 404, "NOT_FOUND"); expect(await effects()).toBe(denied);
    await rights(a, all); const restored = await effects();
    expect(ManagedOrderResultSchema.parse(await success(await commandManagedOrder(post(ca.input))))).toEqual({ ...ra, replayed: true }); expect(await effects()).toBe(restored);
    await prisma.authSession.update({ where: { id: a.seat.actor.sessionId }, data: { revokedAt: new Date() } });
    token = a.seat.token; await actorFailure(401, "UNAUTHENTICATED"); expect(await effects()).toBe(restored);
  }, 30000);

  it("rejects duplicate/unknown/scope/price/capability/body/origin inputs without effects and returns exact POST replay and approved-only DTOs", async () => {
    const f = await company(), source = await approvedSource(f), a = await agency(f, "strict"), client = await approvedSource(f, a.seat, a.scope, "CLIENT strict");
    token = f.token; const before = await effects();
    for (const suffix of ["&scope=OWN_BRAND", "&brandId=" + f.brand.id, "&clientId=" + a.client.id, "&actorUserId=private", "&limit=0", "&limit=01", "&limit=21", "&limit=1e1", "&limit=1&limit=1", "&after=x&after=x", "&orderId=x"]) {
      await failure(await loadManagedOrders(get("", scopeQuery(f.scope) + suffix)), 422, "VALIDATION");
    }
    for (const query of ["", "?scope=OWN_BRAND", "?scope=CLIENT", `?brandId=${f.brand.id}`, `?scope=OTHER&brandId=${f.brand.id}`,
      `?scope=OWN_BRAND&brandId=${f.brand.id}&clientId=${a.client.id}`]) {
      await failure(await loadManagedOrders(get("", query)), 422, "VALIDATION");
      await failure(await loadManagedOrder(get("/detail", query)), 422, "VALIDATION");
    }
    for (const query of [scopeQuery(f.scope), scopeQuery(f.scope) + "&orderId=x&orderId=x", scopeQuery(f.scope) + "&orderId=x&limit=1",
      scopeQuery(f.scope) + "&orderId=x&actorUserId=private", scopeQuery(f.scope) + "&orderId="]) {
      await failure(await loadManagedOrder(get("/detail", query)), 422, "VALIDATION");
    }
    for (const search of ["?actorUserId=private", "?scope=OWN_BRAND&scope=OWN_BRAND", "?limit=1"]) {
      const request = post("{malformed", origin(), search); await failure(await commandManagedOrder(request), 422, "VALIDATION"); expect(request.bodyUsed).toBe(false);
    }
    for (const requestOrigin of [null, "https://unrelated.example.invalid"]) {
      const request = post("{malformed", requestOrigin); await failure(await commandManagedOrder(request), 403, "FORBIDDEN"); expect(request.bodyUsed).toBe(false);
    }
    for (const malformed of ["{malformed", "", "[", "null"]) await failure(await commandManagedOrder(post(malformed)), malformed === "null" ? 422 : 400, "VALIDATION");
    const missingBody = new Request(`${origin()}/api/managed-orders/commands`, { method: "POST", headers: { origin: origin(), "content-type": "application/json" } });
    await failure(await commandManagedOrder(missingBody), 400, "VALIDATION");
    const { briefId: _briefId, ...missingBrief } = source.input; void _briefId;
    for (const input of [missingBrief, { ...source.input, operationKey: "not-a-uuid" }, { ...source.input, action: "ACCEPT_QUOTE" },
      { ...source.input, payload: {} }, { ...source.input, price: { amountMinor: "1", currencyCode: "KWD" } },
      { ...source.input, supplierCost: "1" }, { ...source.input, actorUserId: f.user.id },
      { ...source.input, scope: { ...f.scope, clientId: a.client.id } }, { ...source.input, disclosureVersion: "guess" },
      { ...source.input, expectedCampaignRevision: "1" }, { ...source.input, expectedAuthority: await getClientAuthority(a.seat.actor, a.client.id, "signCustomer") }]) {
      await failure(await commandManagedOrder(post(input)), 422, "VALIDATION");
    }
    token = a.seat.token;
    const { expectedAuthority: _authority, ...withoutAuthority } = client.input as typeof client.input & { expectedAuthority: unknown }; void _authority;
    for (const input of [withoutAuthority, { ...client.input, expectedAuthority: await getClientAuthority(a.seat.actor, a.client.id, "plan") },
      { ...client.input, expectedAuthority: await getClientAuthority(a.seat.actor, a.client.id, "view") },
      { ...client.input, expectedAuthority: { ...await getClientAuthority(a.seat.actor, a.client.id, "signCustomer"), clientId: key() } },
      { ...client.input, scope: { kind: "CLIENT", clientId: a.client.id, brandId: f.brand.id } }]) {
      await failure(await commandManagedOrder(post(input)), 422, "VALIDATION");
    }
    token = f.token;
    const wire = JSON.stringify(source.input), exact = wire + " ".repeat(65536 - Buffer.byteLength(wire, "utf8"));
    expect(Buffer.byteLength(exact, "utf8")).toBe(65536);
    await failure(await commandManagedOrder(post(exact + " ")), 413, "PAYLOAD_TOO_LARGE"); expect(await effects()).toBe(before);
    const rawResult = await success(await commandManagedOrder(post(exact))), result = ManagedOrderResultSchema.parse(rawResult);
    keys(rawResult, ["action", "orderId", "submissionId", "campaignId", "revision", "submissionVersion", "briefId", "briefVersion", "selectionId", "selectionRevision", "replayed"]);
    expect(result).toMatchObject({ action: "SUBMIT", campaignId: source.campaignId, revision: 1, submissionVersion: 1,
      briefId: source.brief.id, briefVersion: source.brief.version, selectionId: source.input.expectedSelectionId,
      selectionRevision: source.input.expectedSelectionRevision, replayed: false });
    const committed = await effects();
    expect(ManagedOrderResultSchema.parse(await success(await commandManagedOrder(post(source.input))))).toEqual({ ...result, replayed: true }); expect(await effects()).toBe(committed);
    expect(ManagedOrderResultSchema.parse(await success(await commandManagedOrder(post(exact))))).toEqual({ ...result, replayed: true }); expect(await effects()).toBe(committed);
    await failure(await commandManagedOrder(post({ ...source.input, expectedCampaignRevision: source.input.expectedCampaignRevision + 1 })), 409, "IDEMPOTENCY_CONFLICT");
    await failure(await commandManagedOrder(post({ ...source.input, operationKey: key() })), 409, "ORDER_ALREADY_REQUESTED"); expect(await effects()).toBe(committed);
    const commands = await prisma.managedOrderCommand.findMany({ where: { actorUserId: f.user.id, operationKey: source.input.operationKey } });
    const { replayed: _replayed, ...receipt } = result; void _replayed;
    expect(commands).toHaveLength(1); expect(ManagedOrderReceiptSchema.parse(commands[0]!.result)).toEqual(receipt);
    expect(await prisma.managedOrder.count({ where: { campaignId: source.campaignId } })).toBe(1);
    expect(await prisma.managedOrderSubmission.count({ where: { orderId: result.orderId } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { type: "managed_order.requested", payload: { path: ["aggregateId"], equals: result.orderId } } })).toBe(1);
    const rawDetail = await success(await loadManagedOrder(get("/detail", scopeQuery(f.scope) + `&orderId=${result.orderId}`))), detail = ManagedOrderDetailSchema.parse(rawDetail);
    keys(rawDetail, ["scope", "currentAuthority", "asOf", "order", "quote"]); keys(detail.order, ["id", "campaignId", "revision", "status", "submission"]);
    keys(detail.order.submission, ["id", "version", "createdAt", "disclosureVersion", "snapshotHash", "snapshot"]);
    keys(detail.order.submission.snapshot, ["schemaVersion", "brief", "provenance", "selectedContext", "references"]);
    expect(ManagedOrderSnapshotSchema.parse(detail.order.submission.snapshot).brief).toEqual(source.brief);
    expect(detail.order.submission.snapshot.selectedContext).toBeNull(); expect(detail.order.submission.snapshot.references).toEqual({ kind: "NO_CONTEXT" });
    expect(detail.quote).toBeNull(); expect(detail.order.status).toBe("REQUESTED"); expect(detail.currentAuthority).toBeNull();
    expect(ManagedOrderDetailSchema.safeParse({ ...rawDetail, supplierCost: "1" }).success).toBe(false);
    const second = await approvedSource(f, f, f.scope, "OWN second"), secondResult = await submitManagedOrder(f.actor, second.input);
    const orderedIds = [result.orderId, secondResult.orderId].sort();
    const rawList = await success(await loadManagedOrders(get("", scopeQuery(f.scope) + "&limit=1"))), list = ManagedOrderListSchema.parse(rawList);
    keys(rawList, ["scope", "currentAuthority", "asOf", "orders", "nextCursor"]); expect(list.orders).toHaveLength(1); expect(list.nextCursor).toBe(orderedIds[0]);
    keys(list.orders[0]!, ["id", "campaignId", "revision", "status", "titleOriginal", "submittedAt"]);
    expect(list.orders[0]!.id).toBe(orderedIds[0]);
    const listedSource = orderedIds[0] === result.orderId ? source : second;
    expect(list.orders[0]!.titleOriginal).toEqual({ text: listedSource.brief.content.requirements.title, language: listedSource.brief.content.requirements.originalLanguage });
    expect(ManagedOrderListSchema.safeParse({ ...rawList, brief: source.brief }).success).toBe(false);
    privateSafe([rawResult, rawDetail, rawList, commands[0]!.result], [f, a.seat]);
    expect(JSON.stringify(rawList)).not.toContain(source.brief.content.requirements.summary);
    const nextPage = ManagedOrderListSchema.parse(await success(await loadManagedOrders(get("", scopeQuery(f.scope) + `&after=${list.nextCursor}&limit=1`))));
    expect(nextPage.orders.map(row => row.id)).toEqual([orderedIds[1]]); expect(nextPage.nextCursor).toBeNull();
    expect(ManagedOrderListSchema.parse(await success(await loadManagedOrders(get("", scopeQuery(f.scope) + "&limit=20")))).orders.map(row => row.id)).toEqual(orderedIds);
    expect(ManagedOrderListSchema.parse(await success(await loadManagedOrders(get("", scopeQuery(f.scope) + `&after=${orderedIds[1]}&limit=20`)))).orders).toEqual([]);
    const beforeMissing = await effects();
    await failure(await loadManagedOrder(get("/detail", scopeQuery(f.scope) + `&orderId=${key()}`)), 404, "NOT_FOUND");
    await failure(await loadManagedOrders(get("", scopeQuery(f.scope) + `&after=${key()}`)), 404, "NOT_FOUND"); expect(await effects()).toBe(beforeMissing);
  }, 30000);
});
