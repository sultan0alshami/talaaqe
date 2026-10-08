// Candidate for tests/campaign-agent/routes.test.ts. Exactly two guarded native
// HTTP groups. Root alone adopts/runs; no provider or live legal acceptance.
// Only Next cookie context is a seam, copied from planning routes.
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { SESSION_COOKIE } from "@/lib/jwt";
import type { OrganizationActor } from "@/lib/organizations/context";
import { createOrganization, proposeClientAssociation, authorizeClientAssociation,
  proposeMember, acceptMembership, setClientGrant } from "@/lib/organizations/service";
import { getClientAuthority } from "@/lib/organizations/loaders";
import { executeCampaignPlanningCommand } from "@/lib/campaign-planning/service";
import { type PlanningScope } from "@/lib/brand-context/contracts";
import { CampaignFieldsSchema } from "@/lib/campaigns/contracts";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { executeCampaignAgentCommand, getCampaignAgent,
  type CampaignAgentRead, type CampaignAgentSourcePage } from "@/lib/campaign-agent/service";
import { AgentSnapshotSchema, CampaignAgentFieldKeys, CampaignAgentStateSchema,
  CustomerTextSourceSchema } from "@/lib/campaign-agent/contracts";
import { CampaignAgentResultSchema } from "@/lib/campaign-agent/native-contracts";
import { GET as detail } from "@/app/api/campaign-agent/route";
import { GET as sources } from "@/app/api/campaign-agent/sources/route";
import { POST as command } from "@/app/api/campaign-agent/commands/route";
import { campaignFields } from "../campaigns/fixtures";

let token: string | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) =>
  name === SESSION_COOKIE && token ? { name, value: token } : undefined }) }));
const key = () => randomUUID();
const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>(), campaigns = new Set<string>();
const form = { channel: "FORM" as const };
const allCaps = { view: true, plan: true, approveShortlist: true, reviewContent: true,
  signCustomer: true, financial: true, manageGrants: true };
const prefs = { input: "TEXT", output: "TEXT" };

beforeAll(async () => {
  const taskId = process.env.INFAME_TASK_ID;
  if (!taskId || !/^infame_[a-f0-9]{12}$/.test(taskId) || process.env.INFAME_ENV !== "test"
    || process.env.NODE_ENV === "production") throw new Error("Interview API witnesses require guarded test task");
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; kind: string; db: string; host: string }>>(
    "SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable");
  if (rows.length !== 1 || rows[0]?.id !== taskId || rows[0]?.kind !== "test"
    || rows[0]?.db !== taskId + "_test" || rows[0]?.host !== "127.0.0.1") throw new Error("Interview API target identity mismatch");
});

afterEach(async () => {
  token = null;
  const campaignIds = [...campaigns];
  if (campaignIds.length) {
    await prisma.campaignAgentCommand.deleteMany({ where: { campaignId: { in: campaignIds } } });
    await prisma.campaignAgentConfirmationBatch.deleteMany({ where: { campaignId: { in: campaignIds } } });
    await prisma.campaignAgentTextSource.deleteMany({ where: { campaignId: { in: campaignIds } } });
    await prisma.campaignAgent.deleteMany({ where: { campaignId: { in: campaignIds } } });
  }
  const workspaces = await prisma.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } });
  if (workspaces.length) {
    const ids = workspaces.map(row => row.id);
    for (const table of ["PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission",
      "CampaignBriefProvenance", "CampaignProposalDependency", "CampaignPlanningState", "CampaignContextSelection",
      "CampaignPlanningBinding", "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const) {
      // Identifier inventory is literal and owned; values remain parameterized.
      await prisma.$executeRaw(Prisma.sql(['DELETE FROM "' + table + '" WHERE "workspaceId" IN (', ')'], Prisma.join(ids)));
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
  for (const set of [users, brands, organizations, campaigns]) set.clear();
});

async function person(role: "BRAND" | "CREATOR" | "ADMIN" = "BRAND") {
  const id = key(); users.add(id);
  const user = await prisma.user.create({ data: { id, role, active: true, isTest: true,
    name: "Synthetic interview API actor", email: id + "@example.invalid", passwordHash: "not-a-login",
    emailVerifiedAt: new Date(Date.now() - 60000) } });
  const signed = await openSession(id, user.sessionVersion, user.passwordHash), session = await resolveSession(signed);
  if (!session) throw new Error("Synthetic interview API session failed to resolve");
  const actor: OrganizationActor = { userId: session.userId, role: session.role,
    sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  return { user, actor, token: signed };
}
type Account = Awaited<ReturnType<typeof person>>;
async function company() {
  const owner = await person(), brand = await prisma.brand.create({ data: { userId: owner.user.id,
    slug: "agent-api-" + key().replace(/-/g, "").slice(0, 16), name: "Synthetic interview API company", countryCode: "KW", isTest: true } });
  brands.add(brand.id); return { ...owner, brand, scope: { kind: "OWN_BRAND", brandId: brand.id } as PlanningScope };
}
async function agency(customer: Awaited<ReturnType<typeof company>>, nameOriginal: string) {
  const owner = await person(), seat = await person();
  const { organization } = await createOrganization(owner.actor, { operationKey: key(), kind: "AGENCY", nameOriginal }); organizations.add(organization.id);
  const revision = async () => (await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).revision;
  const proposal = await proposeClientAssociation(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), brandId: customer.brand.id });
  const { client } = await authorizeClientAssociation(customer.actor, proposal.client.id, { operationKey: key(), expectedRevision: proposal.client.revision, capabilities: allCaps });
  const member = await proposeMember(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), targetUserId: seat.user.id });
  const { membership } = await acceptMembership(seat.actor, member.membership.id, { operationKey: key(), expectedRevision: member.membership.revision });
  const { grant } = await setClientGrant(owner.actor, client.id, { operationKey: key(), expectedClientRevision: client.revision,
    membershipId: membership.id, expectedGrantRevision: null, capabilities: allCaps });
  return { owner, seat, organization, client, membership, grant, scope: { kind: "CLIENT", clientId: client.id } as PlanningScope };
}
async function authority(account: Account, scope: PlanningScope) {
  return scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(account.actor, scope.clientId, "plan") } : {};
}
async function fresh(account: Account, scope: PlanningScope, title = "Synthetic complete interview campaign") {
  const fields = CampaignFieldsSchema.parse({ ...campaignFields, title, impressionsTarget: null,
    budget: { amountMinor: "9223372036854775807", currencyCode: "KWD" } });
  const made = await executeCampaignPlanningCommand(account.actor, { operationKey: key(), scope, ...(await authority(account, scope)),
    action: "CREATE", expectedCampaignRevision: 0, expectedPlanningRevision: 0, expectedSelectionId: null,
    expectedSelectionRevision: 0, payload: { fields, selection: { kind: "NONE" }, narrative: null } });
  campaigns.add(made.campaignId); return { campaignId: made.campaignId, fields };
}
function origin() { if (!process.env.APP_ORIGIN) throw new Error("Guarded route target requires APP_ORIGIN"); return new URL(process.env.APP_ORIGIN).origin; }
function scopeQuery(scope: PlanningScope, campaignId: string) {
  const params = new URLSearchParams({ scope: scope.kind, campaignId });
  if (scope.kind === "OWN_BRAND") params.set("brandId", scope.brandId);
  else params.set("clientId", scope.clientId);
  return "?" + params.toString();
}
function get(path: string, query: string) { return new Request(origin() + "/api/campaign-agent" + path + query); }
function post(body: unknown, requestOrigin = origin(), query = "") {
  return new Request(origin() + "/api/campaign-agent/commands" + query, { method: "POST",
    headers: { origin: requestOrigin, "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
}
async function envelope(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
  expect(response.headers.get("set-cookie")).toBeNull();
  const body = await response.json(); expect(body.requestId).toBe(response.headers.get("x-request-id")); return body;
}
async function success(response: Response) {
  expect(response.status).toBe(200); const body = await envelope(response);
  expect(Object.keys(body).sort()).toEqual(["data", "requestId"]); return body.data;
}
async function failure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status); const body = await envelope(response);
  expect(Object.keys(body).sort()).toEqual(["error", "requestId"]);
  expect(body.error).toEqual({ code, message: code, requestId: body.requestId, retryable: status === 503 || status === 429 }); return body;
}
function privateSafe(value: unknown, canaries: readonly string[]) { for (const canary of canaries) expect(JSON.stringify(value)).not.toContain(canary); }
async function read(account: Account, scope: PlanningScope, campaignId: string): Promise<CampaignAgentRead> {
  token = account.token; const value = await success(await detail(get("", scopeQuery(scope, campaignId))));
  AgentSnapshotSchema.parse(value.current.snapshot); if (value.retained) CampaignAgentStateSchema.parse(value.retained);
  expect(value.binding.scope).toEqual(scope); expect(value.binding.campaignId).toBe(campaignId); return value;
}
async function inputFor(account: Account, scope: PlanningScope, campaignId: string, action: string,
  payload: unknown, view?: CampaignAgentRead) {
  const current = view ?? await read(account, scope, campaignId);
  return { operationKey: key(), scope, campaignId, ...(await authority(account, scope)), action,
    expectedAgentRevision: current.retained?.revision ?? 0, expectedSnapshot: current.current.snapshot, payload };
}
async function step(account: Account, scope: PlanningScope, campaignId: string, action: string, payload: unknown) {
  const before = await read(account, scope, campaignId), input = await inputFor(account, scope, campaignId, action, payload, before);
  token = account.token; const result = CampaignAgentResultSchema.parse(await success(await command(post(input))));
  expect(result.agentRevision).toBe((before.retained?.revision ?? 0) + 1);
  expect(result.campaignRevision).toBe(before.current.snapshot.campaignRevision + (action === "GENERATE_PROFILE" ? 1 : 0));
  expect(result.planningRevision).toBe(before.current.snapshot.planningRevision + (action === "GENERATE_PROFILE" ? 1 : 0));
  return { before, input, result };
}
async function raw(campaignId: string) {
  return { campaign: await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } }),
    planning: await prisma.campaignPlanningState.findUniqueOrThrow({ where: { campaignId } }),
    agent: await prisma.campaignAgent.findUnique({ where: { campaignId } }),
    sources: await prisma.campaignAgentTextSource.findMany({ where: { campaignId }, orderBy: { id: "asc" } }),
    batches: await prisma.campaignAgentConfirmationBatch.findMany({ where: { campaignId }, orderBy: { id: "asc" } }),
    commands: await prisma.campaignAgentCommand.findMany({ where: { campaignId }, orderBy: { id: "asc" } }),
    briefs: await prisma.campaignBrief.findMany({ where: { campaignId }, orderBy: { id: "asc" } }),
    provenance: await prisma.campaignBriefProvenance.findMany({ where: { campaignId }, orderBy: { briefId: "asc" } }),
    audits: await prisma.adminAudit.findMany({ where: { resourceType: "Campaign", resourceId: campaignId }, orderBy: { id: "asc" } }),
    events: await prisma.outboxEvent.findMany({ where: { payload: { path: ["aggregateId"], equals: campaignId } }, orderBy: { id: "asc" } }) };
}

it("uses real native BRAND authentication before malformed input, denies private actor forgery and enforces current CLIENT view plus plan", async () => {
  token = null;
  for (const [handler, path] of [[detail, ""], [sources, "/sources"]] as const) await failure(await handler(get(path, "?scope=bad&scope=bad&actorUserId=private")), 401, "UNAUTHENTICATED");
  const unsigned = post("{private malformed words"); await failure(await command(unsigned), 401, "UNAUTHENTICATED"); expect(unsigned.bodyUsed).toBe(false);
  for (const role of ["CREATOR", "ADMIN"] as const) {
    const wrong = await person(role); token = wrong.token;
    for (const [handler, path] of [[detail, ""], [sources, "/sources"]] as const) await failure(await handler(get(path, "?scope=bad&scope=bad")), 403, "FORBIDDEN");
    const denied = post("{private malformed words"); await failure(await command(denied), 403, "FORBIDDEN"); expect(denied.bodyUsed).toBe(false);
  }
  const customer = await company(), own = await fresh(customer, customer.scope);
  const absent = await read(customer, customer.scope, own.campaignId); expect(absent.retained).toBeNull(); expect(absent.coverage).toBe("NOT_INITIALIZED");
  const initial = await inputFor(customer, customer.scope, own.campaignId, "INITIALIZE", { preferences: prefs }, absent), beforeBad = await raw(own.campaignId);
  for (const extra of [{ actorUserId: customer.user.id }, { authorUserId: customer.user.id }, { confirmedByUserId: customer.user.id },
    { serverAuth: customer.actor }, { channel: "FORM" }, { now: new Date().toISOString() }]) {
    token = customer.token; const body = await failure(await command(post({ ...initial, ...extra })), 422, "VALIDATION");
    privateSafe(body, [customer.token, customer.actor.sessionId, customer.user.email]);
  }
  const badOrigin = post(initial, "https://unrelated.example.invalid"); await failure(await command(badOrigin), 403, "FORBIDDEN"); expect(badOrigin.bodyUsed).toBe(false);
  expect(await raw(own.campaignId)).toEqual(beforeBad);
  const expired = await company(); token = expired.token;
  await prisma.authSession.update({ where: { id: expired.actor.sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
  expect(await resolveSession(expired.token)).toBeNull();
  await failure(await sources(get("/sources", "?scope=bad&scope=bad")), 401, "UNAUTHENTICATED");
  const expiredBody = post("{malformed"); await failure(await command(expiredBody), 401, "UNAUTHENTICATED"); expect(expiredBody.bodyUsed).toBe(false);

  const a = await agency(customer, "Synthetic interview API agency A"), b = await agency(customer, "Synthetic interview API agency B");
  const ca = await fresh(a.seat, a.scope), cb = await fresh(b.seat, b.scope, "B private interview canary");
  const viewA = await read(a.seat, a.scope, ca.campaignId), initA = await inputFor(a.seat, a.scope, ca.campaignId, "INITIALIZE", { preferences: prefs }, viewA);
  const viewB = await getCampaignAgent(b.seat.actor, { scope: b.scope, campaignId: cb.campaignId });
  await executeCampaignAgentCommand(b.seat.actor, { operationKey: key(), scope: b.scope, campaignId: cb.campaignId,
    ...(await authority(b.seat, b.scope)), action: "INITIALIZE", expectedAgentRevision: 0,
    expectedSnapshot: viewB.current.snapshot, payload: { preferences: prefs } }, form);
  const initializedB = await getCampaignAgent(b.seat.actor, { scope: b.scope, campaignId: cb.campaignId });
  await executeCampaignAgentCommand(b.seat.actor, { operationKey: key(), scope: b.scope, campaignId: cb.campaignId,
    ...(await authority(b.seat, b.scope)), action: "APPEND_TEXT", expectedAgentRevision: initializedB.retained!.revision,
    expectedSnapshot: initializedB.current.snapshot, payload: { originalText: { text: "B original source private canary", language: "en" } } }, form);
  token = a.seat.token;
  for (const query of [scopeQuery(a.scope, cb.campaignId), scopeQuery(b.scope, cb.campaignId)]) {
    const denied = await failure(await detail(get("", query)), 404, "NOT_FOUND"); privateSafe(denied, ["B private interview canary", "B original source private canary"]);
    await failure(await sources(get("/sources", query)), 404, "NOT_FOUND");
  }
  token = customer.token; await failure(await detail(get("", scopeQuery(a.scope, ca.campaignId))), 404, "NOT_FOUND");
  const beforeDenied = await raw(ca.campaignId);
  const planOnly = { ...allCaps, view: false };
  const withdrawn = await setClientGrant(a.owner.actor, a.client.id, { operationKey: key(), expectedClientRevision: a.client.revision,
    membershipId: a.membership.id, expectedGrantRevision: a.grant.revision, capabilities: planOnly });
  token = a.seat.token;
  await failure(await detail(get("", scopeQuery(a.scope, ca.campaignId))), 404, "NOT_FOUND");
  await failure(await sources(get("/sources", scopeQuery(a.scope, ca.campaignId))), 404, "NOT_FOUND");
  await failure(await command(post({ ...initA, expectedAuthority: await getClientAuthority(a.seat.actor, a.client.id, "plan") })), 404, "NOT_FOUND");
  expect(await raw(ca.campaignId)).toEqual(beforeDenied);
  const restored = await setClientGrant(a.owner.actor, a.client.id, { operationKey: key(), expectedClientRevision: a.client.revision,
    membershipId: a.membership.id, expectedGrantRevision: withdrawn.grant.revision, capabilities: allCaps });
  const allowed = await step(a.seat, a.scope, ca.campaignId, "INITIALIZE", { preferences: prefs }); expect(allowed.result.agentRevision).toBe(1);
  await setClientGrant(a.owner.actor, a.client.id, { operationKey: key(), expectedClientRevision: a.client.revision,
    membershipId: a.membership.id, expectedGrantRevision: restored.grant.revision, capabilities: { ...allCaps, plan: false } });
  const stable = await raw(ca.campaignId); token = a.seat.token;
  expect((await read(a.seat, a.scope, ca.campaignId)).retained?.id).toBe(allowed.result.agentId);
  await failure(await command(post(allowed.input)), 404, "NOT_FOUND"); expect(await raw(ca.campaignId)).toEqual(stable);
}, 60000);

it("completes text, explicit full-field review and a new unapproved profile over real APIs with exact replay, strict64KiB wire bounds and private envelopes", async () => {
  const owner = await company(), made = await fresh(owner, owner.scope, "  Exact reviewed Arabic title\nعنوان أصلي  ");
  const empty = await read(owner, owner.scope, made.campaignId); expect(empty.coverage).toBe("NOT_INITIALIZED");
  const initialized = await step(owner, owner.scope, made.campaignId, "INITIALIZE", { preferences: prefs });
  const changed = await step(owner, owner.scope, made.campaignId, "SET_PREFERENCES", { preferences: { input: "LIVE_VOICE", output: "TEXT_AND_VOICE" } });
  expect(changed.result.sourceId).toBeNull(); expect(changed.result.confirmationBatchId).toBeNull();
  const text = { text: "  Exact original private customer words\nكلمات العميل الأصلية\t ", language: "ar" };
  const appended = await step(owner, owner.scope, made.campaignId, "APPEND_TEXT", { originalText: text });
  token = owner.token; const response = await sources(get("/sources", scopeQuery(owner.scope, made.campaignId)));
  privateSafe([...response.headers], [text.text, "Exact original private customer words", "originalText", owner.token, owner.actor.sessionId]);
  const page = await success(response) as CampaignAgentSourcePage; expect(page.sources).toHaveLength(1); expect(page.nextCursor).toBeNull();
  const source = CustomerTextSourceSchema.parse(page.sources[0]); expect(source.id).toBe(appended.result.sourceId);
  expect(source.authorUserId).toBe(owner.user.id); expect(source.originalText).toEqual(text);
  expect(source.binding).toEqual(page.binding); expect(source.capturedSnapshot).toEqual(appended.before.current.snapshot);
  const current = await read(owner, owner.scope, made.campaignId), fields = CampaignFieldsSchema.parse(current.current.fields);
  const choices = CampaignAgentFieldKeys.map(field => {
    const valueHash = canonicalHash({ domain: "infame-campaign-field-value-v1", field, value: fields[field] });
    return { field, valueHash, source: field === "title" ? { kind: "CUSTOMER_TEXT", references: [{ id: source.id, sourceHash: source.sourceHash }] }
      : { kind: "CUSTOMER_FIELD_CHOICE", capturedValueHash: valueHash } };
  });
  const confirmed = await step(owner, owner.scope, made.campaignId, "CONFIRM_FIELDS", { fields: choices });
  const reviewed = await read(owner, owner.scope, made.campaignId); expect(reviewed.coverage).toBe("CURRENT");
  expect(reviewed.retained?.preferences).toEqual({ input: "LIVE_VOICE", output: "TEXT_AND_VOICE" });
  expect(reviewed.retained?.assistance).toEqual({ kind: "MANUAL_GUIDANCE", agent: "UNAVAILABLE" });
  const generated = await step(owner, owner.scope, made.campaignId, "GENERATE_PROFILE", { confirmationBatchId: confirmed.result.confirmationBatchId });
  const brief = await prisma.campaignBrief.findUniqueOrThrow({ where: { id: generated.result.briefId! } });
  expect(brief.approvedAt).toBeNull(); expect(brief.approvedByUserId).toBeNull(); expect(brief.version).toBe(generated.result.briefVersion);
  expect((brief.content as { requirements: unknown }).requirements).toEqual({ ...made.fields, campaignId: made.campaignId,
    version: brief.version, brandCountryCode: "KW", mandatoryPolicyVersionIds: [] });
  const binding = await prisma.campaignPlanningBinding.findUniqueOrThrow({ where: { campaignId: made.campaignId } });
  expect(generated.result.workspaceId).toBe(binding.workspaceId);
  expect(await prisma.campaignBriefProvenance.findUniqueOrThrow({ where: { briefId: brief.id } })).toMatchObject({
    campaignId: made.campaignId, workspaceId: binding.workspaceId, selectionId: generated.before.current.snapshot.selection.id,
    selectionRevision: generated.before.current.snapshot.selection.revision });
  const after = await read(owner, owner.scope, made.campaignId); expect(after.coverage).toBe("UNCONFIRMED");
  expect(after.retained?.confirmation).toEqual({ kind: "UNCONFIRMED" }); expect(after.retained?.textSourceReferences).toEqual([{ id: source.id, sourceHash: source.sourceHash }]);
  const stable = await raw(made.campaignId); token = owner.token;
  for (const old of [initialized, appended, confirmed, generated]) expect(await success(await command(post(old.input)))).toEqual({ ...old.result, replayed: true });
  expect(await raw(made.campaignId)).toEqual(stable);
  await failure(await command(post({ ...initialized.input, payload: { preferences: { input: "MEDIA", output: "VOICE" } } })), 409, "OPERATION_KEY_REUSED");
  const wire = JSON.stringify(initialized.input), exact = wire + " ".repeat(65536 - Buffer.byteLength(wire, "utf8"));
  expect(Buffer.byteLength(exact, "utf8")).toBe(65536);
  expect((await success(await command(post(exact)))).replayed).toBe(true);
  await failure(await command(post(exact + " ")), 413, "PAYLOAD_TOO_LARGE");
  const queried = post("{private malformed body", origin(), "?actorUserId=private");
  await failure(await command(queried), 422, "VALIDATION"); expect(queried.bodyUsed).toBe(false);
  for (const suffix of ["&limit=1", "&actorUserId=private", "&clientId=foreign", "&scope=OWN_BRAND", "&campaignId=duplicate", "&after=" + source.id]) {
    await failure(await detail(get("", scopeQuery(owner.scope, made.campaignId) + suffix)), 422, "VALIDATION");
  }
  for (const suffix of ["&limit=1", "&actorUserId=private", "&after=" + source.id + "&after=" + source.id]) {
    await failure(await sources(get("/sources", scopeQuery(owner.scope, made.campaignId) + suffix)), 422, "VALIDATION");
  }
  const next = await success(await sources(get("/sources", scopeQuery(owner.scope, made.campaignId) + "&after=" + source.id)));
  expect(next.sources).toEqual([]); expect(next.nextCursor).toBeNull();
  for (const item of stable.commands) {
    expect(Object.hasOwn(item.result as object, "replayed")).toBe(false);
    privateSafe(item.result, [text.text, "originalText", "confirmedByUserId", owner.token, owner.actor.sessionId]);
  }
  expect(await raw(made.campaignId)).toEqual(stable);
}, 60000);
