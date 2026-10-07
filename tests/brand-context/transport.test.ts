import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { SESSION_COOKIE } from "@/lib/jwt";
import type { OrganizationActor } from "@/lib/organizations/context";
import { createOrganization, proposeClientAssociation, authorizeClientAssociation, proposeMember, acceptMembership, setClientGrant } from "@/lib/organizations/service";
import { getClientAuthority } from "@/lib/organizations/loaders";
import { GET as list } from "@/app/api/brand-contexts/route";
import { GET as detail } from "@/app/api/brand-contexts/detail/route";
import { GET as version } from "@/app/api/brand-contexts/version/route";
import { POST as command } from "@/app/api/brand-contexts/commands/route";
import { GET as reviews } from "@/app/api/brand-contexts/reviews/route";
import { GET as reviewDetail } from "@/app/api/brand-contexts/reviews/detail/route";
import { POST as reviewCommand } from "@/app/api/brand-contexts/reviews/commands/route";
import { POST as legacyCreate } from "@/app/api/campaigns/route";
import { BrandContextContentSchema, BrandContextCommandResultSchema, BrandContextListSchema, BrandContextDetailResponseSchema,
  BrandContextVersionResponseSchema, ContextOwnerReviewsSchema, ContextOwnerReviewResponseSchema, ContextOwnerReviewResultSchema } from "@/lib/brand-context/contracts";

// IGNORED DRAFT for tests/brand-context/transport.test.ts. Exactly two native
// groups; root alone activates/runs guarded targets. Only Next cookie context
// is mocked. Signed sessions, organization commands, API/domain/origin checks
// and database rows are real owned synthetic fixtures, not live company/legal
// acceptance. No service/producer/Date mock and no test-module fixture import.
let token: string | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => name === SESSION_COOKIE && token ? { name, value: token } : undefined }) }));
const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>();
const key = () => randomUUID();
const allCaps = { view: true, plan: true, approveShortlist: true, reviewContent: true, signCustomer: true, financial: true, manageGrants: true };
afterEach(async () => {
  token = null;
  const rows = await prisma.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } });
  if (rows.length) {
    const ids = rows.map(row => row.id);
    for (const table of ["PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission", "CampaignBriefProvenance", "CampaignProposalDependency",
      "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding", "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const) {
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
  if (users.size) await prisma.outboxEvent.deleteMany({ where: { OR: [...users].map(id => ({ payload: { path: ["actorUserId"], equals: id } })) } });
  await prisma.user.deleteMany({ where: { id: { in: [...users] } } }); users.clear(); brands.clear(); organizations.clear();
});
async function person(role: "BRAND" | "CREATOR" | "ADMIN" = "BRAND") {
  const id = key(); users.add(id);
  const user = await prisma.user.create({ data: { id, role, active: true, isTest: true, name: "Synthetic context adapter actor",
    email: `${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  const value = await openSession(id, user.sessionVersion, user.passwordHash), session = await resolveSession(value);
  if (!session) throw new Error("Synthetic actual context adapter session did not resolve");
  const actor: OrganizationActor = { userId: session.userId, role: session.role, sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  return { user, actor, token: value };
}
async function company() {
  const owner = await person(), brand = await prisma.brand.create({ data: { userId: owner.user.id, slug: "context-wire-" + key().replace(/-/g, "").slice(0, 16),
    name: "Synthetic original company", countryCode: "KW", isTest: true } }); brands.add(brand.id); return { ...owner, brand };
}
async function agency(customer: Awaited<ReturnType<typeof company>>, nameOriginal: string) {
  const owner = await person(), seat = await person();
  const { organization } = await createOrganization(owner.actor, { operationKey: key(), kind: "AGENCY", nameOriginal }); organizations.add(organization.id);
  const revision = async () => (await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).revision;
  const proposal = await proposeClientAssociation(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), brandId: customer.brand.id });
  const { client } = await authorizeClientAssociation(customer.actor, proposal.client.id, { operationKey: key(), expectedRevision: proposal.client.revision, capabilities: allCaps });
  const member = await proposeMember(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), targetUserId: seat.user.id });
  const { membership } = await acceptMembership(seat.actor, member.membership.id, { operationKey: key(), expectedRevision: member.membership.revision });
  await setClientGrant(owner.actor, client.id, { operationKey: key(), expectedClientRevision: client.revision, membershipId: membership.id, expectedGrantRevision: null, capabilities: allCaps });
  return { owner, seat, organization, client, membership };
}
function origin() { if (!process.env.APP_ORIGIN) throw new Error("Guarded adapter target requires APP_ORIGIN"); return new URL(process.env.APP_ORIGIN).origin; }
function get(path: string, search = "") { return new Request(`${origin()}/api/brand-contexts${path}${search}`); }
function post(path: string, body: unknown, requestOrigin = origin()) {
  return new Request(`${origin()}/api/brand-contexts${path}`, { method: "POST", headers: { origin: requestOrigin, "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
}
const ownQuery = (brandId: string) => `?scope=OWN_BRAND&brandId=${encodeURIComponent(brandId)}`;
const clientQuery = (clientId: string) => `?scope=CLIENT&clientId=${encodeURIComponent(clientId)}`;
async function envelope(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
  const body = await response.json(); expect(body.requestId).toBe(response.headers.get("x-request-id")); return body;
}
async function success(response: Response) { expect(response.status).toBe(200); const body = await envelope(response); expect(Object.keys(body).sort()).toEqual(["data", "requestId"]); return body.data; }
async function failure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status); const body = await envelope(response);
  expect(Object.keys(body).sort()).toEqual(["error", "requestId"]);
  expect(body.error).toEqual({ code, message: code, requestId: body.requestId, retryable: status === 503 || status === 429 }); return body;
}
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
function boundedContent(target: number) {
  const content = { schemaVersion: 1, positioning: { text: null, language: null }, values: [], tone: { text: null, language: null },
    references: Array.from({ length: 20 }, (_, i) => ({ label: { text: `Original reference ${i}`, language: "en" }, url: null, notes: { text: "", language: "en" } })),
    competitors: Array.from({ length: 20 }, (_, i) => ({ name: { text: `Original competitor ${i}`, language: "en" }, url: null, notes: { text: "", language: "en" } })) };
  let remaining = target - bytes(content); expect(remaining).toBeGreaterThan(0);
  for (const entry of [...content.references, ...content.competitors]) { const length = Math.min(2000, remaining); entry.notes.text = "x".repeat(length); remaining -= length; }
  expect(remaining).toBe(0); expect(bytes(content)).toBe(target); return content;
}
const manual = BrandContextContentSchema.parse({ schemaVersion: 1, positioning: { text: " \tنص أصلي خاص\nOriginal private context\r ", language: "ar" },
  values: [], tone: { text: "  Original tone  ", language: "en" }, references: [], competitors: [] });
function privateSafe(data: unknown, canaries: readonly string[]) { for (const canary of canaries) expect(JSON.stringify(data)).not.toContain(canary); }

describe("brand context adapters: native cookie sessions, domain producers and purpose-local byte bounds", () => {
  it("saves/submits/approves/reads actual OWN context and accepts exact64KiB content/96KiB wire while rejecting oversize without effects", async () => {
    const f = await company(); token = f.token;
    const content = boundedContent(65536); expect(BrandContextContentSchema.safeParse(content).success).toBe(true);
    const input = { operationKey: key(), scope: { kind: "OWN_BRAND", brandId: f.brand.id }, action: "CREATE", expectedRevision: 0,
      payload: { nameOriginal: { text: "  سياق أصلي  ", language: "ar" }, content } };
    expect(bytes(input)).toBeGreaterThan(65536); expect(bytes(input)).toBeLessThan(98304);
    const created = BrandContextCommandResultSchema.parse(await success(await command(post("/commands", input))));
    const headers = BrandContextListSchema.parse(await success(await list(get("", ownQuery(f.brand.id))))); expect(headers.contexts.map(row => row.id)).toEqual([created.contextId]);
    const current = BrandContextDetailResponseSchema.parse(await success(await detail(get("/detail", ownQuery(f.brand.id) + `&contextId=${created.contextId}`))));
    expect(current.context.content).toEqual(content); expect(current.context.nameOriginal).toEqual({ text: "سياق أصلي", language: "ar" });
    const submitted = BrandContextCommandResultSchema.parse(await success(await command(post("/commands", { operationKey: key(), scope: input.scope, contextId: created.contextId,
      action: "SUBMIT", expectedRevision: created.revision, payload: {} }))));
    const inbox = ContextOwnerReviewsSchema.parse(await success(await reviews(get("/reviews")))); expect(inbox.reviews.map(row => row.id)).toEqual([submitted.submissionId]);
    const review = ContextOwnerReviewResponseSchema.parse(await success(await reviewDetail(get("/reviews/detail", `?submissionId=${submitted.submissionId}`)))); expect(review.review.content).toEqual(content);
    const approved = ContextOwnerReviewResultSchema.parse(await success(await reviewCommand(post("/reviews/commands", { operationKey: key(), submissionId: submitted.submissionId, expectedRevision: 1, decision: "APPROVE" }))));
    const saved = BrandContextVersionResponseSchema.parse(await success(await version(get("/version", ownQuery(f.brand.id) + `&versionId=${approved.versionId}`)))); expect(saved.version.content).toEqual(content);
    const wire = JSON.stringify(input), exact = wire + " ".repeat(98304 - Buffer.byteLength(wire, "utf8"));
    expect(Buffer.byteLength(exact, "utf8")).toBe(98304);
    expect((await success(await command(post("/commands", exact)))).replayed).toBe(true);
    const before = await prisma.brandContext.findUniqueOrThrow({ where: { id: created.contextId } }), count = await prisma.brandContextCommand.count({ where: { actorUserId: f.user.id } });
    await failure(await command(post("/commands", exact + " ")), 413, "PAYLOAD_TOO_LARGE");
    const tooLarge = { ...input, operationKey: key(), payload: { ...input.payload, content: boundedContent(65537) } };
    expect(BrandContextContentSchema.safeParse(tooLarge.payload.content).success).toBe(false);
    await failure(await command(post("/commands", tooLarge)), 422, "VALIDATION");
    await failure(await command(post("/commands", { ...input, operationKey: key() }, "https://unrelated.example.invalid")), 403, "FORBIDDEN");
    expect(await prisma.brandContext.findUniqueOrThrow({ where: { id: created.contextId } })).toEqual(before);
    expect(await prisma.brandContextCommand.count({ where: { actorUserId: f.user.id } })).toBe(count);
    expect(await prisma.brandContext.count({ where: { workspace: { brandId: f.brand.id } } })).toBe(1);
    // The existing campaign wire parser stays64KiB; this is no shared relaxation.
    const legacy = JSON.stringify({ operationKey: key(), fields: { title: "Synthetic legacy parser boundary" } });
    const legacyRequest = new Request(`${origin()}/api/campaigns`, { method: "POST", headers: { origin: origin(), "content-type": "application/json" }, body: legacy + " ".repeat(65537 - Buffer.byteLength(legacy, "utf8")) });
    await failure(await legacyCreate(legacyRequest), 413, "PAYLOAD_TOO_LARGE"); expect(await prisma.campaign.count({ where: { brandId: f.brand.id } })).toBe(0);
  });

  it("keeps same-Brand CLIENTs/owner review separate, authenticates before malformed body/query and rejects corrupt native output privately", async () => {
    const f = await company(), a = await agency(f, "Synthetic adapter agency A"), b = await agency(f, "Synthetic adapter agency B");
    const createFor = async (agency: typeof a, text: string) => {
      token = agency.seat.token;
      const input = { operationKey: key(), scope: { kind: "CLIENT", clientId: agency.client.id }, expectedAuthority: await getClientAuthority(agency.seat.actor, agency.client.id, "plan"),
        action: "CREATE", expectedRevision: 0, payload: { nameOriginal: { text, language: "en" }, content: manual } };
      return { input, result: BrandContextCommandResultSchema.parse(await success(await command(post("/commands", input)))) };
    };
    const ca = await createFor(a, "A submitted original"), cb = await createFor(b, "B unsubmitted private canary");
    token = a.seat.token;
    const aHeaders = BrandContextListSchema.parse(await success(await list(get("", clientQuery(a.client.id))))); expect(aHeaders.contexts.map(row => row.id)).toEqual([ca.result.contextId]);
    await failure(await detail(get("/detail", clientQuery(a.client.id) + `&contextId=${cb.result.contextId}`)), 404, "NOT_FOUND");
    const submitted = BrandContextCommandResultSchema.parse(await success(await command(post("/commands", { operationKey: key(), scope: ca.input.scope,
      expectedAuthority: await getClientAuthority(a.seat.actor, a.client.id, "plan"), contextId: ca.result.contextId, expectedRevision: ca.result.revision, action: "SUBMIT", payload: {} }))));
    token = f.token; expect(await prisma.organizationMembership.count({ where: { userId: f.user.id, organizationId: { in: [a.organization.id, b.organization.id] } } })).toBe(0);
    const ownerInbox = ContextOwnerReviewsSchema.parse(await success(await reviews(get("/reviews")))); expect(ownerInbox.reviews.map(row => row.id)).toEqual([submitted.submissionId]);
    privateSafe(ownerInbox, ["B unsubmitted private canary", cb.result.contextId, a.seat.user.email, a.seat.token]);
    await failure(await detail(get("/detail", clientQuery(a.client.id) + `&contextId=${ca.result.contextId}`)), 404, "NOT_FOUND");
    expect(ContextOwnerReviewResponseSchema.safeParse(await success(await reviewDetail(get("/reviews/detail", `?submissionId=${submitted.submissionId}`)))).success).toBe(true);
    const approved = ContextOwnerReviewResultSchema.parse(await success(await reviewCommand(post("/reviews/commands", { operationKey: key(), submissionId: submitted.submissionId, expectedRevision: 1, decision: "APPROVE" }))));
    token = a.seat.token; expect(BrandContextVersionResponseSchema.safeParse(await success(await version(get("/version", clientQuery(a.client.id) + `&versionId=${approved.versionId}`)))).success).toBe(true);
    for (const suffix of ["&userId=other", "&clientId=" + a.client.id, "&brandId=" + f.brand.id, "&archived=yes", "&limit=01", "&limit=21", "&limit=1e1"]) {
      await failure(await list(get("", clientQuery(a.client.id) + suffix)), 422, "VALIDATION");
    }
    token = f.token; await failure(await reviews(get("/reviews", "?limit=1&limit=1")), 422, "VALIDATION");
    const withQuery = post("/commands?actorUserId=other", ca.input); await failure(await command(withQuery), 422, "VALIDATION"); expect(withQuery.bodyUsed).toBe(false);
    token = null; const anonymous = post("/commands", "{malformed private input");
    await failure(await command(anonymous), 401, "UNAUTHENTICATED"); expect(anonymous.bodyUsed).toBe(false);
    await failure(await list(get("", "?userId=private&scope=UNKNOWN")), 401, "UNAUTHENTICATED");
    for (const role of ["CREATOR", "ADMIN"] as const) {
      const actor = await person(role); token = actor.token; const request = post("/commands", "{malformed private input");
      await failure(await command(request), 403, "FORBIDDEN"); expect(request.bodyUsed).toBe(false);
    }
    await prisma.authSession.update({ where: { id: a.seat.actor.sessionId }, data: { revokedAt: new Date() } }); token = a.seat.token;
    const revoked = post("/commands", "{malformed private input"); await failure(await command(revoked), 401, "UNAUTHENTICATED"); expect(revoked.bodyUsed).toBe(false);
    // Storage accepts bounded objects; this owned corruption fixture violates
    // the real producer schema while preserving exact native revision guards.
    const before = await prisma.brandContext.findUniqueOrThrow({ where: { id: cb.result.contextId } }), canary = "private corrupt original data canary";
    await prisma.brandContext.update({ where: { id: before.id }, data: { content: { schemaVersion: 99, privateRawTranscript: canary }, revision: before.revision + 1,
      inputRevision: before.revision + 1, updatedAt: new Date() } }); token = b.seat.token;
    const denied = await failure(await detail(get("/detail", clientQuery(b.client.id) + `&contextId=${before.id}`)), 503, "RETRY_REQUIRED");
    privateSafe(denied, [canary, b.seat.token, b.seat.actor.sessionId, b.seat.user.email]);
    const audits = await prisma.adminAudit.findMany({ where: { actorUserId: { in: [...users] } } }), events = await prisma.outboxEvent.findMany({ where: { payload: { path: ["actorUserId"], equals: b.seat.user.id } } });
    privateSafe([audits.map(row => row.snapshot), events.map(row => row.payload)], [canary]);
  });
});
