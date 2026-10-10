// Two guarded native HTTP recovery groups.
// Real native users/sessions/grants/planning/interview producers. The sole seam
// is Next's cookie context. No provider/browser/live-voice acceptance is claimed.
// Key material is never passed to a matcher, thrown message or console output.
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { SESSION_COOKIE } from "@/lib/jwt";
import type { OrganizationActor } from "@/lib/organizations/context";
import type { PlanningScope } from "@/lib/brand-context/contracts";
import { createOrganization, proposeClientAssociation, authorizeClientAssociation, proposeMember,
  acceptMembership, setClientGrant } from "@/lib/organizations/service";
import { getClientAuthority } from "@/lib/organizations/loaders";
import { executeCampaignPlanningCommand } from "@/lib/campaign-planning/service";
import { executeCampaignAgentCommand, getCampaignAgent } from "@/lib/campaign-agent/service";
import { CampaignAgentCommandSchema } from "@/lib/campaign-agent/native-contracts";
import { CampaignAgentFieldKeys } from "@/lib/campaign-agent/contracts";
import { CampaignAgentRecoveryKeySchema, CampaignAgentOutcomeSchema, CampaignAgentBarrierResultSchema,
  type CampaignAgentRecoveryTarget, type CampaignAgentBarrierCommand } from "@/lib/campaign-agent/recovery-contracts";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { CampaignFieldsSchema } from "@/lib/campaigns/contracts";
import { GET as recoveryKey } from "@/app/api/campaign-agent/recovery-key/route";
import { POST as outcome } from "@/app/api/campaign-agent/outcome/route";
import { POST as recoveryBarrier } from "@/app/api/campaign-agent/recovery-barrier/route";
import { POST as agentCommand } from "@/app/api/campaign-agent/commands/route";
import { campaignFields } from "../campaigns/fixtures";

let token: string | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) =>
  name === SESSION_COOKIE && token ? { name, value: token } : undefined }) }));
const key = (): string => randomUUID(), form = { channel: "FORM" as const };
const preferences = { input: "TEXT", output: "TEXT" } as const;
const allCaps = { view: true, plan: true, approveShortlist: true, reviewContent: true,
  signCustomer: true, financial: true, manageGrants: true };
const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>(), campaigns = new Set<string>();

beforeAll(async () => {
  const taskId = process.env.INFAME_TASK_ID;
  if (!taskId || !/^infame_[a-f0-9]{12}$/.test(taskId) || process.env.INFAME_ENV !== "test"
    || process.env.NODE_ENV === "production") throw new Error("Recovery API witnesses require guarded test task");
  const rows = await prisma.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`
    SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]?.id !== taskId || rows[0]?.kind !== "test" || rows[0]?.db !== taskId + "_test"
    || rows[0]?.host !== "127.0.0.1") throw new Error("Recovery API disposable identity mismatch");
});
afterEach(async () => {
  token = null;
  const ownedCampaigns = [...campaigns];
  if (ownedCampaigns.length) {
    await prisma.campaignAgentCommand.deleteMany({ where: { campaignId: { in: ownedCampaigns } } });
    await prisma.campaignAgentConfirmationBatch.deleteMany({ where: { campaignId: { in: ownedCampaigns } } });
    await prisma.campaignAgentTextSource.deleteMany({ where: { campaignId: { in: ownedCampaigns } } });
    await prisma.campaignAgent.deleteMany({ where: { campaignId: { in: ownedCampaigns } } });
  }
  const workspaces = await prisma.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } });
  if (workspaces.length) {
    const ids = workspaces.map(row => row.id);
    for (const table of ["PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission",
      "CampaignBriefProvenance", "CampaignProposalDependency", "CampaignPlanningState", "CampaignContextSelection",
      "CampaignPlanningBinding", "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const) {
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
  for (const set of [users, brands, organizations, campaigns]) set.clear();
});

async function sign(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const signed = await openSession(user.id, user.sessionVersion, user.passwordHash), session = await resolveSession(signed);
  if (!session) throw new Error("Synthetic recovery API session did not resolve");
  const actor: OrganizationActor = { userId: session.userId, role: session.role, sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  return { user, actor, token: signed };
}
async function person(role: "BRAND" | "CREATOR" | "ADMIN" = "BRAND") {
  const id = key(); users.add(id);
  await prisma.user.create({ data: { id, role, active: true, isTest: true, name: "Synthetic recovery API actor",
    email: id + "@example.invalid", passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  return sign(id);
}
type Account = Awaited<ReturnType<typeof person>>;
async function company() {
  const owner = await person(), brand = await prisma.brand.create({ data: { userId: owner.user.id,
    slug: "recovery-api-" + key().replace(/-/g, "").slice(0, 16), name: "Synthetic recovery API company", countryCode: "KW", isTest: true } });
  brands.add(brand.id); return { ...owner, brand, scope: { kind: "OWN_BRAND", brandId: brand.id } as PlanningScope };
}
async function agency(customer: Awaited<ReturnType<typeof company>>) {
  const owner = await person(), seat = await person(), { organization } = await createOrganization(owner.actor,
    { operationKey: key(), kind: "AGENCY", nameOriginal: "Synthetic recovery API agency" }); organizations.add(organization.id);
  const revision = async () => (await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).revision;
  const proposed = await proposeClientAssociation(owner.actor, organization.id,
    { operationKey: key(), expectedOrganizationRevision: await revision(), brandId: customer.brand.id });
  const { client } = await authorizeClientAssociation(customer.actor, proposed.client.id,
    { operationKey: key(), expectedRevision: proposed.client.revision, capabilities: allCaps });
  const member = await proposeMember(owner.actor, organization.id,
    { operationKey: key(), expectedOrganizationRevision: await revision(), targetUserId: seat.user.id });
  const { membership } = await acceptMembership(seat.actor, member.membership.id,
    { operationKey: key(), expectedRevision: member.membership.revision });
  const { grant } = await setClientGrant(owner.actor, client.id, { operationKey: key(), expectedClientRevision: client.revision,
    membershipId: membership.id, expectedGrantRevision: null, capabilities: allCaps });
  return { owner, seat, organization, client, membership, grant, scope: { kind: "CLIENT", clientId: client.id } as PlanningScope };
}
async function authority(account: Account, scope: PlanningScope) {
  return scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(account.actor, scope.clientId, "plan") } : {};
}
async function fresh(account: Account, scope: PlanningScope) {
  const made = await executeCampaignPlanningCommand(account.actor, { operationKey: key(), scope, ...(await authority(account, scope)),
    action: "CREATE", expectedCampaignRevision: 0, expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0,
    payload: { fields: campaignFields, selection: { kind: "NONE" }, narrative: null } });
  campaigns.add(made.campaignId); return made.campaignId;
}
async function inputFor(account: Account, scope: PlanningScope, campaignId: string, action: string, payload: unknown) {
  const current = await getCampaignAgent(account.actor, { scope, campaignId });
  return CampaignAgentCommandSchema.parse({ operationKey: key(), scope, campaignId, ...(await authority(account, scope)),
    action, expectedAgentRevision: current.retained?.revision ?? 0, expectedSnapshot: current.current.snapshot, payload });
}
async function step(account: Account, scope: PlanningScope, campaignId: string, action: string, payload: unknown) {
  const input = await inputFor(account, scope, campaignId, action, payload), result = await executeCampaignAgentCommand(account.actor, input, form);
  return { input, result };
}
function target(account: Account, input: unknown): CampaignAgentRecoveryTarget {
  const command = CampaignAgentCommandSchema.parse(input), { scope, campaignId, payload, ...technical } = command; void scope; void campaignId;
  return { ...technical, commandHash: canonicalHash({ domain: "infame-campaign-agent-command-v1", actorUserId: account.user.id, command }),
    payload: command.action === "APPEND_TEXT" ? { originalTextHash: canonicalHash({ domain: "infame-agent-recovery-text-v1", originalText: command.payload.originalText }) }
      : payload } as CampaignAgentRecoveryTarget;
}
async function barrierInput(account: Account, scope: PlanningScope, campaignId: string, original: unknown): Promise<CampaignAgentBarrierCommand> {
  const current = await getCampaignAgent(account.actor, { scope, campaignId });
  return { operationKey: key(), scope, campaignId, ...(await authority(account, scope)), expectedAgentRevision: current.retained?.revision ?? 0,
    expectedSnapshot: current.current.snapshot, target: target(account, original), initialPreferences: current.retained ? null : preferences };
}
function origin() { if (!process.env.APP_ORIGIN) throw new Error("Guarded recovery API origin missing"); return new URL(process.env.APP_ORIGIN).origin; }
function scopeQuery(scope: PlanningScope, campaignId: string) {
  const value = new URLSearchParams({ scope: scope.kind, campaignId });
  if (scope.kind === "OWN_BRAND") value.set("brandId", scope.brandId); else value.set("clientId", scope.clientId);
  return "?" + value;
}
function getKey(scope: PlanningScope, campaignId: string, suffix = "") { return new Request(origin() + "/api/campaign-agent/recovery-key" + scopeQuery(scope, campaignId) + suffix); }
function post(path: "outcome" | "recovery-barrier" | "commands", body: unknown, requestOrigin = origin(), suffix = "") {
  return new Request(origin() + "/api/campaign-agent/" + path + suffix, { method: "POST",
    headers: { origin: requestOrigin, "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
async function envelope(response: Response) {
  const requestId = response.headers.get("x-request-id");
  expect(response.headers.get("cache-control") === "private, no-store").toBe(true);
  expect(typeof requestId === "string" && /^[a-f0-9-]{36}$/.test(requestId)).toBe(true);
  expect(response.headers.get("set-cookie") === null).toBe(true);
  const body: unknown = await response.json(); expect(object(body)).toBe(true);
  if (!object(body)) throw new Error("Malformed recovery response envelope");
  expect(body.requestId === requestId).toBe(true); return body;
}
async function data(response: Response): Promise<unknown> {
  // Status mismatches can never dump a resolved key DTO.
  expect(response.status === 200).toBe(true); const body = await envelope(response);
  expect(Object.keys(body).sort().join(",") === "data,requestId").toBe(true); return body.data;
}
async function failure(response: Response, status: number, code: string) {
  expect(response.status === status).toBe(true); const body = await envelope(response);
  expect(Object.keys(body).sort().join(",") === "error,requestId").toBe(true);
  expect(object(body.error)).toBe(true); if (!object(body.error)) throw new Error("Malformed recovery error envelope");
  expect(body.error.code === code && body.error.message === code && body.error.requestId === body.requestId
    && body.error.retryable === (status === 503 || status === 429)).toBe(true); return body;
}
function noWords(value: unknown, ...canaries: string[]) {
  const serialized = JSON.stringify(value); expect(canaries.every(word => !serialized.includes(word))).toBe(true);
}
async function keyData(response: Response) {
  const value = await data(response), parsed = CampaignAgentRecoveryKeySchema.safeParse(value);
  expect(parsed.success).toBe(true); if (!parsed.success) throw new Error("Malformed recovery key DTO");
  const bytes = Buffer.from(parsed.data.keyBase64Url, "base64url");
  expect(bytes.length === 32 && createHash("sha256").update(bytes).digest("hex") === parsed.data.keyId).toBe(true);
  return parsed.data;
}
async function outcomeData(response: Response, ...words: string[]) {
  const value = await data(response); noWords(value, ...words);
  const parsed = CampaignAgentOutcomeSchema.safeParse(value);
  expect(parsed.success).toBe(true); if (!parsed.success) throw new Error("Malformed recovery outcome DTO"); return parsed.data;
}
async function barrierData(response: Response, ...words: string[]) {
  const value = await data(response); noWords(value, ...words);
  const parsed = CampaignAgentBarrierResultSchema.safeParse(value);
  expect(parsed.success).toBe(true); if (!parsed.success) throw new Error("Malformed recovery barrier DTO"); return parsed.data;
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
const stamp = (value: unknown) => JSON.stringify(value, (_name, item: unknown) => typeof item === "bigint" ? item.toString() : item);
async function unchanged(campaignId: string, previous: Awaited<ReturnType<typeof raw>>) { expect(stamp(await raw(campaignId)) === stamp(previous)).toBe(true); }

it("authenticates recovery HTTP before parsing, privately binds keys to actual actor/scope and enforces current view plus plan, strict bodies and origins", async () => {
  token = null;
  const malformedKey = new Request(origin() + "/api/campaign-agent/recovery-key?scope=bad&scope=bad&actorUserId=private");
  await failure(await recoveryKey(malformedKey), 401, "UNAUTHENTICATED");
  for (const [handler, path] of [[outcome, "outcome"], [recoveryBarrier, "recovery-barrier"]] as const) {
    const request = post(path, "{malformed private words"); await failure(await handler(request), 401, "UNAUTHENTICATED"); expect(request.bodyUsed).toBe(false);
  }
  for (const role of ["CREATOR", "ADMIN"] as const) {
    const wrong = await person(role); token = wrong.token;
    await failure(await recoveryKey(malformedKey), 403, "FORBIDDEN");
    for (const [handler, path] of [[outcome, "outcome"], [recoveryBarrier, "recovery-barrier"]] as const) {
      const request = post(path, "{malformed private words"); await failure(await handler(request), 403, "FORBIDDEN"); expect(request.bodyUsed).toBe(false);
    }
  }
  const f = await company(), id = await fresh(f, f.scope), id2 = await fresh(f, f.scope);
  const original = await inputFor(f, f.scope, id, "INITIALIZE", { preferences }), technical = target(f, original), barrier = await barrierInput(f, f.scope, id, original);
  token = f.token;
  const before = await raw(id), material = await keyData(await recoveryKey(getKey(f.scope, id)));
  expect(material.actorReference === f.user.id && material.algorithm === "AES-GCM" && material.binding.campaignId === id).toBe(true);
  expect(material.keyBase64Url === f.token || material.keyBase64Url === f.actor.sessionId).toBe(false);
  const again = await keyData(await recoveryKey(getKey(f.scope, id))); expect(again.keyBase64Url === material.keyBase64Url && again.keyId === material.keyId).toBe(true);
  const another = await keyData(await recoveryKey(getKey(f.scope, id2))); expect(another.keyBase64Url === material.keyBase64Url).toBe(false);
  await unchanged(id, before); expect((await getCampaignAgent(f.actor, { scope: f.scope, campaignId: id })).retained === null).toBe(true);
  const renewed = await sign(f.user.id); token = renewed.token;
  const restored = await keyData(await recoveryKey(getKey(f.scope, id))); expect(restored.keyBase64Url === material.keyBase64Url && restored.keyId === material.keyId).toBe(true);
  for (const suffix of ["&scope=OWN_BRAND", "&clientId=foreign", "&after=cursor", "&actorUserId=forged", "&AUTH_SECRET=synthetic"])
    await failure(await recoveryKey(getKey(f.scope, id, suffix)), 422, "VALIDATION");
  const bodyFor = (path: "outcome" | "recovery-barrier") => path === "outcome" ? { scope: f.scope, campaignId: id, target: technical } : barrier;
  for (const [handler, path] of [[outcome, "outcome"], [recoveryBarrier, "recovery-barrier"]] as const) {
    for (const extra of [{ actorUserId: f.user.id }, { serverAuth: f.actor }, { now: "2026-01-01T00:00:00.000Z" },
      { AUTH_SECRET: "Synthetic submitted secret canary" }, { keyBase64Url: "a".repeat(43) }, { channel: "FORM" }])
      noWords(await failure(await handler(post(path, { ...bodyFor(path), ...extra })), 422, "VALIDATION"), f.token, f.actor.sessionId, "Synthetic submitted secret canary");
    await failure(await handler(post(path, bodyFor(path), origin(), "?campaignId=forged")), 422, "VALIDATION");
    const crossOrigin = post(path, bodyFor(path), "https://unrelated.example.invalid");
    await failure(await handler(crossOrigin), 403, "FORBIDDEN"); expect(crossOrigin.bodyUsed).toBe(false);
    await failure(await handler(post(path, " ".repeat(65537))), 413, "PAYLOAD_TOO_LARGE");
    await failure(await handler(post(path, "{malformed")), 400, "VALIDATION");
  }
  await unchanged(id, before);
  const a = await agency(f), ca = await fresh(a.seat, a.scope), originalA = await inputFor(a.seat, a.scope, ca, "INITIALIZE", { preferences });
  const barrierA = await barrierInput(a.seat, a.scope, ca, originalA), targetA = target(a.seat, originalA), beforeA = await raw(ca);
  token = a.seat.token; const aMaterial = await keyData(await recoveryKey(getKey(a.scope, ca)));
  expect(aMaterial.keyBase64Url === material.keyBase64Url).toBe(false);
  token = f.token; await failure(await recoveryKey(getKey(f.scope, ca)), 404, "NOT_FOUND");
  await failure(await outcome(post("outcome", { scope: f.scope, campaignId: ca, target: technical })), 404, "NOT_FOUND");
  token = a.seat.token; await failure(await recoveryKey(getKey(a.scope, id)), 404, "NOT_FOUND");
  const withdrawnView = await setClientGrant(a.owner.actor, a.client.id, { operationKey: key(), expectedClientRevision: a.client.revision,
    membershipId: a.membership.id, expectedGrantRevision: a.grant.revision, capabilities: { ...allCaps, view: false } });
  await failure(await recoveryKey(getKey(a.scope, ca)), 404, "NOT_FOUND");
  await failure(await outcome(post("outcome", { scope: a.scope, campaignId: ca, target: targetA })), 404, "NOT_FOUND");
  await failure(await recoveryBarrier(post("recovery-barrier", { ...barrierA, ...(await authority(a.seat, a.scope)) })), 404, "NOT_FOUND");
  const restoredGrant = await setClientGrant(a.owner.actor, a.client.id, { operationKey: key(), expectedClientRevision: a.client.revision,
    membershipId: a.membership.id, expectedGrantRevision: withdrawnView.grant.revision, capabilities: allCaps });
  const restoredA = await keyData(await recoveryKey(getKey(a.scope, ca))); expect(restoredA.keyBase64Url === aMaterial.keyBase64Url).toBe(true);
  await setClientGrant(a.owner.actor, a.client.id, { operationKey: key(), expectedClientRevision: a.client.revision,
    membershipId: a.membership.id, expectedGrantRevision: restoredGrant.grant.revision, capabilities: { ...allCaps, plan: false } });
  await failure(await recoveryKey(getKey(a.scope, ca)), 404, "NOT_FOUND");
  await failure(await outcome(post("outcome", { scope: a.scope, campaignId: ca, target: targetA })), 404, "NOT_FOUND");
  await failure(await recoveryBarrier(post("recovery-barrier", barrierA)), 404, "NOT_FOUND"); await unchanged(ca, beforeA);
  const expired = await company(); token = expired.token;
  await prisma.authSession.update({ where: { id: expired.actor.sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
  expect(await resolveSession(expired.token) === null).toBe(true);
  await failure(await recoveryKey(malformedKey), 401, "UNAUTHENTICATED");
  for (const [handler, path] of [[outcome, "outcome"], [recoveryBarrier, "recovery-barrier"]] as const) {
    const request = post(path, "{malformed private words"); await failure(await handler(request), 401, "UNAUTHENTICATED"); expect(request.bodyUsed).toBe(false);
  }
}, 90000);

it("returns read-only UNKNOWN or verified scalar history and persists exact barriers before denying late originals without duplicating campaign work", async () => {
  const f = await company(), id = await fresh(f, f.scope); await step(f, f.scope, id, "INITIALIZE", { preferences }); token = f.token;
  const words = "  Synthetic recovery API original words\nكلمات أصلية محفوظة  ";
  const pending = await inputFor(f, f.scope, id, "APPEND_TEXT", { originalText: { text: words, language: "ar" } });
  const technical = target(f, pending), beforeRead = await raw(id), lookup = { scope: f.scope, campaignId: id, target: technical };
  const unknown = await outcomeData(await outcome(post("outcome", lookup)), words);
  expect(unknown.status === "UNKNOWN" && unknown.receipt === null).toBe(true); await unchanged(id, beforeRead);
  const frozenBarrier = await barrierInput(f, f.scope, id, pending), beforeBarrier = await raw(id);
  const fenced = await barrierData(await recoveryBarrier(post("recovery-barrier", frozenBarrier)), words);
  expect(fenced.targetOutcome === "FENCED" && fenced.originalReceipt === null && fenced.replayed === false
    && fenced.agentRevision === frozenBarrier.expectedAgentRevision + 1).toBe(true);
  const afterBarrier = await raw(id);
  expect(afterBarrier.commands.length === beforeBarrier.commands.length + 1 && afterBarrier.audits.length === beforeBarrier.audits.length + 1
    && afterBarrier.events.length === beforeBarrier.events.length + 1).toBe(true);
  expect(stamp(afterBarrier.sources) === stamp(beforeBarrier.sources) && stamp(afterBarrier.batches) === stamp(beforeBarrier.batches)
    && stamp(afterBarrier.briefs) === stamp(beforeBarrier.briefs) && stamp(afterBarrier.campaign) === stamp(beforeBarrier.campaign)
    && stamp(afterBarrier.planning) === stamp(beforeBarrier.planning)).toBe(true);
  await failure(await agentCommand(post("commands", pending)), 409, "STALE_VERSION"); await unchanged(id, afterBarrier);
  const replayed = await barrierData(await recoveryBarrier(post("recovery-barrier", frozenBarrier)), words);
  expect(stamp(replayed) === stamp({ ...fenced, replayed: true })).toBe(true); await unchanged(id, afterBarrier);
  const barrierTarget = { kind: "RECOVERY_BARRIER", command: frozenBarrier,
    commandHash: canonicalHash({ domain: "infame-campaign-agent-recovery-barrier-v1", actorUserId: f.user.id, command: frozenBarrier }) };
  const barrierHistory = await outcomeData(await outcome(post("outcome", { scope: f.scope, campaignId: id, target: barrierTarget })), words);
  expect(barrierHistory.status === "COMMITTED" && stamp(barrierHistory.receipt) === stamp({ ...fenced, replayed: true })).toBe(true);
  await unchanged(id, afterBarrier);
  const reconciled = await getCampaignAgent(f.actor, { scope: f.scope, campaignId: id });
  expect(reconciled.retained?.revision === fenced.agentRevision && reconciled.coverage === "UNCONFIRMED").toBe(true);
  const appended = await step(f, f.scope, id, "APPEND_TEXT", { originalText: { text: words, language: "ar" } });
  const savedFields = CampaignFieldsSchema.parse((await getCampaignAgent(f.actor, { scope: f.scope, campaignId: id })).current.fields);
  const fields = CampaignAgentFieldKeys.map(field => { const valueHash = canonicalHash({ domain: "infame-campaign-field-value-v1", field, value: savedFields[field] });
    return { field, valueHash, source: { kind: "CUSTOMER_FIELD_CHOICE", capturedValueHash: valueHash } }; });
  const confirmed = await step(f, f.scope, id, "CONFIRM_FIELDS", { fields }), generated = await step(f, f.scope, id, "GENERATE_PROFILE", { confirmationBatchId: confirmed.result.confirmationBatchId });
  const historyBefore = await raw(id);
  for (const produced of [appended, confirmed, generated]) {
    const result = await outcomeData(await outcome(post("outcome", { scope: f.scope, campaignId: id, target: target(f, produced.input) })), words, f.token, f.actor.sessionId);
    expect(result.status === "COMMITTED" && stamp(result.receipt) === stamp({ ...produced.result, replayed: true })).toBe(true);
  }
  await unchanged(id, historyBefore);
  const created = await prisma.campaignBrief.findUniqueOrThrow({ where: { id: generated.result.briefId! } });
  expect(created.approvedAt === null && created.approvedByUserId === null && created.version === generated.result.briefVersion).toBe(true);
  const committedBarrier = await barrierInput(f, f.scope, id, appended.input), committedBefore = await raw(id);
  const committed = await barrierData(await recoveryBarrier(post("recovery-barrier", committedBarrier)), words);
  expect(committed.targetOutcome === "COMMITTED" && stamp(committed.originalReceipt) === stamp({ ...appended.result, replayed: true })
    && committed.agentRevision === committedBarrier.expectedAgentRevision + 1).toBe(true);
  const committedAfter = await raw(id);
  expect(committedAfter.sources.length === committedBefore.sources.length && committedAfter.batches.length === committedBefore.batches.length
    && committedAfter.briefs.length === committedBefore.briefs.length).toBe(true);
  await barrierData(await recoveryBarrier(post("recovery-barrier", committedBarrier)), words); await unchanged(id, committedAfter);
  const badDigest = { ...target(f, appended.input), commandHash: "a".repeat(64) };
  await failure(await outcome(post("outcome", { scope: f.scope, campaignId: id, target: badDigest })), 409, "OPERATION_KEY_REUSED");
  const textTarget = target(f, appended.input);
  if (textTarget.action !== "APPEND_TEXT") throw new Error("Expected synthetic text target");
  await failure(await outcome(post("outcome", { scope: f.scope, campaignId: id,
    target: { ...textTarget, payload: { originalTextHash: "b".repeat(64) } } })), 503, "INVALID_STORED_AGENT");
  await unchanged(id, committedAfter);
  const lostSourceId = appended.result.sourceId;
  if (!lostSourceId) throw new Error("Expected synthetic saved source");
  await prisma.campaignAgentTextSource.delete({ where: { id: lostSourceId } });
  const afterOwnedDeletion = await raw(id);
  await failure(await outcome(post("outcome", { scope: f.scope, campaignId: id, target: target(f, appended.input) })), 503, "INVALID_STORED_AGENT");
  await failure(await recoveryBarrier(post("recovery-barrier", committedBarrier)), 503, "INVALID_STORED_AGENT");
  await unchanged(id, afterOwnedDeletion);
}, 90000);
