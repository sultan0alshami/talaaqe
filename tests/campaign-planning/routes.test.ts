import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { SESSION_COOKIE } from "@/lib/jwt";
import type { OrganizationActor } from "@/lib/organizations/context";
import { createOrganization, proposeClientAssociation, authorizeClientAssociation, proposeMember, acceptMembership, setClientGrant } from "@/lib/organizations/service";
import { getClientAuthority } from "@/lib/organizations/loaders";
import { executeBrandContextCommand, decideContextOwnerReview, getApprovedBrandContextVersion } from "@/lib/brand-context/service";
import { BrandContextContentSchema, type PlanningScope } from "@/lib/brand-context/contracts";
import { CampaignFieldsSchema } from "@/lib/campaigns/contracts";
import { CampaignPlanningCommandSchema, CampaignPlanningResultSchema, CampaignPlanningReceiptSchema, PlanningCampaignSchema, PlanningCampaignListSchema,
  CampaignOwnerReviewsSchema, CampaignOwnerReviewSchema, CampaignOwnerReviewResultSchema, type PlanningCampaign } from "@/lib/campaign-planning/contracts";
import { GET as list } from "@/app/api/planning-campaigns/route";
import { GET as detail } from "@/app/api/planning-campaigns/detail/route";
import { POST as command } from "@/app/api/planning-campaigns/commands/route";
import { GET as reviews } from "@/app/api/planning-campaigns/reviews/route";
import { GET as reviewDetail } from "@/app/api/planning-campaigns/reviews/detail/route";
import { POST as reviewCommand } from "@/app/api/planning-campaigns/reviews/commands/route";
import { campaignFields } from "../campaigns/fixtures";

// Four native route groups. Only Next's cookie context is a seam; signed native
// sessions, current roles/permissions, organization/context/planning producers,
// policy resolution and PostgreSQL are real owned synthetic fixtures. These
// tests claim no live company/provider/legal acceptance. Root alone executes.
let token: string | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => name === SESSION_COOKIE && token ? { name, value: token } : undefined }) }));
const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>();
const key = () => randomUUID();
const allCaps = { view: true, plan: true, approveShortlist: true, reviewContent: true, signCustomer: true, financial: true, manageGrants: true };

afterEach(async () => {
  token = null;
  const workspaces = await prisma.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } });
  if (workspaces.length) {
    const ids = workspaces.map(row => row.id);
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
  if (users.size) await prisma.outboxEvent.deleteMany({ where: { OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
  users.clear(); brands.clear(); organizations.clear();
});

async function person(role: "BRAND" | "CREATOR" | "ADMIN" = "BRAND") {
  const id = key(); users.add(id);
  const user = await prisma.user.create({ data: { id, role, active: true, isTest: true, name: "Synthetic planning route actor",
    email: `${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  const signed = await openSession(id, user.sessionVersion, user.passwordHash), session = await resolveSession(signed);
  if (!session) throw new Error("Synthetic native planning route session did not resolve");
  const actor: OrganizationActor = { userId: session.userId, role: session.role, sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  expect(actor.userId).toBe(id); expect(actor.role).toBe(role);
  return { user, actor, token: signed };
}
async function company() {
  const owner = await person(), brand = await prisma.brand.create({ data: { userId: owner.user.id, slug: "planning-api-" + key().replace(/-/g, "").slice(0, 16),
    name: "Synthetic original planning company", countryCode: "KW", isTest: true } });
  brands.add(brand.id); return { ...owner, brand, scope: { kind: "OWN_BRAND", brandId: brand.id } as PlanningScope };
}
type Account = Awaited<ReturnType<typeof person>>;
async function agency(customer: Awaited<ReturnType<typeof company>>, nameOriginal: string) {
  const owner = await person(), seat = await person();
  const { organization } = await createOrganization(owner.actor, { operationKey: key(), kind: "AGENCY", nameOriginal }); organizations.add(organization.id);
  const revision = async () => (await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).revision;
  const proposed = await proposeClientAssociation(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), brandId: customer.brand.id });
  const { client } = await authorizeClientAssociation(customer.actor, proposed.client.id, { operationKey: key(), expectedRevision: proposed.client.revision, capabilities: allCaps });
  const proposedMember = await proposeMember(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), targetUserId: seat.user.id });
  const { membership } = await acceptMembership(seat.actor, proposedMember.membership.id, { operationKey: key(), expectedRevision: proposedMember.membership.revision });
  const { grant } = await setClientGrant(owner.actor, client.id, { operationKey: key(), expectedClientRevision: client.revision, membershipId: membership.id, expectedGrantRevision: null, capabilities: allCaps });
  return { owner, seat, organization, client, membership, grant, scope: { kind: "CLIENT", clientId: client.id } as PlanningScope };
}
function origin() { if (!process.env.APP_ORIGIN) throw new Error("Guarded route target requires APP_ORIGIN"); return new URL(process.env.APP_ORIGIN).origin; }
function get(path: string, search = "") { return new Request(`${origin()}/api/planning-campaigns${path}${search}`); }
function post(path: string, body: unknown, requestOrigin = origin()) {
  return new Request(`${origin()}/api/planning-campaigns${path}`, { method: "POST", headers: { origin: requestOrigin, "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
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
function privateSafe(value: unknown, canaries: readonly string[]) { for (const canary of canaries) expect(JSON.stringify(value)).not.toContain(canary); }
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
async function authority(account: Account, scope: PlanningScope) {
  return scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(account.actor, scope.clientId, "plan") } : {};
}
async function fresh(account: Account, scope: PlanningScope, fields: unknown = campaignFields, selection: unknown = { kind: "NONE" }) {
  const input = CampaignPlanningCommandSchema.parse({ operationKey: key(), scope, ...(await authority(account, scope)), action: "CREATE",
    expectedCampaignRevision: 0, expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0, payload: { fields, selection, narrative: null } });
  token = account.token; const result = CampaignPlanningResultSchema.parse(await success(await command(post("/commands", input)))); return { input, result };
}
async function current(account: Account, scope: PlanningScope, campaignId: string) {
  token = account.token; return PlanningCampaignSchema.parse(await success(await detail(get("/detail", scopeQuery(scope) + `&campaignId=${campaignId}`))));
}
async function inputFor(account: Account, scope: PlanningScope, value: PlanningCampaign, action: string, payload: unknown) {
  return CampaignPlanningCommandSchema.parse({ operationKey: key(), scope, ...(await authority(account, scope)), campaignId: value.campaign.id,
    expectedCampaignRevision: value.campaign.revision, expectedPlanningRevision: value.planning.revision, expectedSelectionId: value.planning.selection.id,
    expectedSelectionRevision: value.planning.selection.revision, action, payload });
}
async function step(account: Account, scope: PlanningScope, campaignId: string, action: string, payload: unknown) {
  const before = await current(account, scope, campaignId), input = await inputFor(account, scope, before, action, payload);
  token = account.token; const result = CampaignPlanningResultSchema.parse(await success(await command(post("/commands", input))));
  expect(result.campaignRevision).toBe(before.campaign.revision + 1); expect(result.planningRevision).toBe(before.planning.revision + 1); return { input, result };
}
async function submitted(account: Account, scope: PlanningScope, campaignId: string) {
  const generated = await step(account, scope, campaignId, "GENERATE_BRIEF", {});
  return step(account, scope, campaignId, "SUBMIT_BRIEF", { briefId: generated.result.briefId, expectedBriefVersion: generated.result.version });
}
async function snapshot(campaignId: string) {
  return { campaign: await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } }), state: await prisma.campaignPlanningState.findUniqueOrThrow({ where: { campaignId } }),
    receipts: await prisma.campaignPlanningCommand.findMany({ where: { campaignId }, orderBy: { id: "asc" } }),
    decisions: await prisma.planningReviewCommand.findMany({ where: { campaignSubmission: { campaignId } }, orderBy: { id: "asc" } }),
    submissions: await prisma.campaignPlanningSubmission.findMany({ where: { campaignId }, orderBy: { id: "asc" } }),
    audits: await prisma.adminAudit.findMany({ where: { resourceType: "Campaign", resourceId: campaignId }, orderBy: { id: "asc" } }),
    events: await prisma.outboxEvent.findMany({ where: { payload: { path: ["aggregateId"], equals: campaignId } }, orderBy: { id: "asc" } }) };
}
const contextContent = BrandContextContentSchema.parse({ schemaVersion: 1, positioning: { text: "  Submitted original context\nتموضع أصلي  ", language: "ar" },
  values: [], tone: { text: "Original human-approved tone", language: "en" }, references: [], competitors: [] });
async function approvedContext(owner: Awaited<ReturnType<typeof company>>, account: Account, scope: PlanningScope) {
  const made = await executeBrandContextCommand(account.actor, { operationKey: key(), scope, ...(await authority(account, scope)), action: "CREATE", expectedRevision: 0,
    payload: { nameOriginal: { text: "Synthetic exact original context", language: "en" }, content: contextContent } });
  const sent = await executeBrandContextCommand(account.actor, { operationKey: key(), scope, ...(await authority(account, scope)), contextId: made.contextId, action: "SUBMIT", expectedRevision: made.revision, payload: {} });
  const approved = await decideContextOwnerReview(owner.actor, { operationKey: key(), submissionId: sent.submissionId!, expectedRevision: 1, decision: "APPROVE" });
  const version = await getApprovedBrandContextVersion(account.actor, { scope, versionId: approved.versionId! }); expect(version.version.content).toEqual(contextContent);
  return { kind: "APPROVED_CONTEXT" as const, versionId: version.version.id, contentHash: version.version.contentHash };
}

describe("scoped planning routes: genuine signed native actors and strict private transport", () => {
  it("authorizes all six handlers before malformed/duplicate query and body parsing, and preserves private request envelopes", async () => {
    token = null;
    for (const [handler, path] of [[list, ""], [detail, "/detail"], [reviews, "/reviews"], [reviewDetail, "/reviews/detail"]] as const) {
      await failure(await handler(get(path, "?actorUserId=private&limit=1&limit=1")), 401, "UNAUTHENTICATED");
    }
    for (const [handler, path] of [[command, "/commands"], [reviewCommand, "/reviews/commands"]] as const) {
      const request = post(path, "{private malformed original"); await failure(await handler(request), 401, "UNAUTHENTICATED"); expect(request.bodyUsed).toBe(false);
    }
    for (const role of ["CREATOR", "ADMIN"] as const) {
      const wrong = await person(role); token = wrong.token;
      await failure(await detail(get("/detail", "?scope=bad&scope=bad")), 403, "FORBIDDEN");
      const request = post("/reviews/commands", "{malformed"); await failure(await reviewCommand(request), 403, "FORBIDDEN"); expect(request.bodyUsed).toBe(false);
    }
    const f = await company(); token = f.token;
    const empty = PlanningCampaignListSchema.parse(await success(await list(get("", scopeQuery(f.scope))))); expect(empty.campaigns).toEqual([]);
    await failure(await list(get("", scopeQuery(f.scope) + "&limit=1&limit=1")), 422, "VALIDATION");
    const queried = post("/commands?actorUserId=private", "{malformed"); await failure(await command(queried), 422, "VALIDATION"); expect(queried.bodyUsed).toBe(false);
    const foreign = post("/commands", "{malformed", "https://unrelated.example.invalid"); await failure(await command(foreign), 403, "FORBIDDEN"); expect(foreign.bodyUsed).toBe(false);
    await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { revokedAt: new Date() } }); expect(await resolveSession(f.token)).toBeNull();
    await failure(await reviews(get("/reviews", "?limit=1&limit=1")), 401, "UNAUTHENTICATED");
    const revoked = post("/commands", "{malformed"); await failure(await command(revoked), 401, "UNAUTHENTICATED"); expect(revoked.bodyUsed).toBe(false);
    expect(await prisma.campaign.count({ where: { brandId: f.brand.id } })).toBe(0);
  });

  it("completes manual OWN/NONE literal notes and immutable brief approval over actual APIs, with exact authorized replay and no owner fallback", async () => {
    const f = await company(), made = await fresh(f, f.scope);
    const original = { text: "  Literal campaign notes\nملاحظات أصلية\t ", language: "ar" };
    await step(f, f.scope, made.result.campaignId, "SAVE_NARRATIVE", { narrative: { schemaVersion: 1, mode: "PARAGRAPH", processing: "UNPROCESSED", originalText: original } });
    const before = await current(f, f.scope, made.result.campaignId);
    expect(before.planning.selection.kind).toBe("NONE"); expect(before.planning.selectedContext).toBeNull(); expect(before.planning.narrative?.originalText).toEqual(original); expect(before.campaign.conversation).toEqual([]);
    const sent = await submitted(f, f.scope, made.result.campaignId); token = f.token;
    const inbox = CampaignOwnerReviewsSchema.parse(await success(await reviews(get("/reviews")))); expect(inbox.reviews.map(row => row.id)).toEqual([sent.result.submissionId]);
    privateSafe(inbox, [original.text, "conversation", "narrative", f.token, f.actor.sessionId]);
    const review = CampaignOwnerReviewSchema.parse(await success(await reviewDetail(get("/reviews/detail", `?submissionId=${sent.result.submissionId}`))));
    expect(review.review.selectedContext).toBeNull(); expect(review.review.content.requirements.budget).toEqual(campaignFields.budget); expect(review.review.content.approvedByUserId).toBeNull();
    const decide = { operationKey: key(), submissionId: sent.result.submissionId!, expectedRevision: 1, decision: "APPROVE" };
    const approved = CampaignOwnerReviewResultSchema.parse(await success(await reviewCommand(post("/reviews/commands", decide)))); expect(approved.state).toBe("APPROVED");
    const stored = await current(f, f.scope, made.result.campaignId); expect(stored.briefs[0]!.approvedByUserId).toBe(f.user.id); expect(stored.briefs[0]!.content.requirements.budget).toEqual(campaignFields.budget);
    expect(stored.planning.narrative?.originalText).toEqual(original); expect(PlanningCampaignSchema.safeParse({ ...stored, privateRawTranscript: original.text }).success).toBe(false);
    const stable = await snapshot(made.result.campaignId); token = f.token;
    expect(await success(await command(post("/commands", made.input)))).toEqual({ ...made.result, replayed: true });
    expect(await success(await reviewCommand(post("/reviews/commands", decide)))).toEqual({ ...approved, replayed: true }); expect(await snapshot(made.result.campaignId)).toEqual(stable);
    await failure(await command(post("/commands", { ...made.input, payload: { ...made.input.payload, fields: { ...campaignFields, title: "Changed reused key" } } })), 409, "OPERATION_KEY_REUSED");
    expect(await snapshot(made.result.campaignId)).toEqual(stable);
    const outsider = await company(); token = outsider.token;
    await failure(await detail(get("/detail", scopeQuery(outsider.scope) + `&campaignId=${made.result.campaignId}`)), 404, "NOT_FOUND");
    await failure(await detail(get("/detail", scopeQuery(f.scope) + `&campaignId=${made.result.campaignId}`)), 404, "NOT_FOUND");
    await failure(await reviewDetail(get("/reviews/detail", `?submissionId=${sent.result.submissionId}`)), 404, "NOT_FOUND");
    expect(PlanningCampaignListSchema.parse(await success(await list(get("", scopeQuery(outsider.scope))))).campaigns).toEqual([]);
    expect(await snapshot(made.result.campaignId)).toEqual(stable);
    for (const receipt of stable.receipts) { expect(CampaignPlanningReceiptSchema.safeParse(receipt.result).success).toBe(true); privateSafe(receipt.result, ["selectionId", "content", "authority", "session", "replayed", original.text]); }
  });

  it("accepts valid Arabic campaign wire above64KiB up to512KiB, keeps owner decisions64KiB, and rejects schema/size errors without effects", async () => {
    const f = await company(), fields = { ...campaignFields, productService: "ع".repeat(5000), summary: "ص".repeat(5000), usageRights: "ح".repeat(5000),
      kpis: Array.from({ length: 30 }, (_, i) => ({ name: `Synthetic original KPI ${i}`, target: "ك".repeat(1000) })) };
    expect(CampaignFieldsSchema.safeParse(fields).success).toBe(true);
    const made = await fresh(f, f.scope, fields); expect(bytes(made.input)).toBeGreaterThan(65536); expect(bytes(made.input)).toBeLessThan(524288);
    const wire = JSON.stringify(made.input), exact = wire + " ".repeat(524288 - Buffer.byteLength(wire, "utf8")); expect(Buffer.byteLength(exact, "utf8")).toBe(524288);
    token = f.token; expect((await success(await command(post("/commands", exact)))).replayed).toBe(true);
    const stable = await snapshot(made.result.campaignId);
    await failure(await command(post("/commands", exact + " ")), 413, "PAYLOAD_TOO_LARGE");
    for (const input of [{ ...made.input, operationKey: key(), actorUserId: f.user.id }, { ...made.input, operationKey: "not-a-uuid" },
      { ...made.input, operationKey: key(), payload: { ...made.input.payload, fields: { ...fields, marketCountryCodes: ["KW", "KW"] } } }]) {
      await failure(await command(post("/commands", input)), 422, "VALIDATION");
    }
    for (const suffix of ["&limit=0", "&limit=01", "&limit=21", "&limit=1e1", "&limit=1&limit=1", "&campaignIds=x&campaignIds=x", "&userId=private", "&clientId=other"]) {
      await failure(await list(get("", scopeQuery(f.scope) + suffix)), 422, "VALIDATION");
    }
    await failure(await reviews(get("/reviews", "?limit=21")), 422, "VALIDATION"); await failure(await reviewDetail(get("/reviews/detail", "?submissionId=x&submissionId=x")), 422, "VALIDATION");
    expect(await snapshot(made.result.campaignId)).toEqual(stable); expect((await current(f, f.scope, made.result.campaignId)).campaign.fields).toEqual(fields);
    const generated = await step(f, f.scope, made.result.campaignId, "GENERATE_BRIEF", {}), big = await current(f, f.scope, made.result.campaignId);
    expect(bytes(big.briefs[0]!.content)).toBeGreaterThan(65536);
    const beforeSubmit = await snapshot(made.result.campaignId), largeSubmit = await inputFor(f, f.scope, big, "SUBMIT_BRIEF", { briefId: generated.result.briefId, expectedBriefVersion: generated.result.version });
    token = f.token; await failure(await command(post("/commands", largeSubmit)), 422, "SNAPSHOT_TOO_LARGE"); expect(await snapshot(made.result.campaignId)).toEqual(beforeSubmit);
    const small = await fresh(f, f.scope), sent = await submitted(f, f.scope, small.result.campaignId);
    const decision = { operationKey: key(), submissionId: sent.result.submissionId!, expectedRevision: 1, decision: "DECLINE" };
    const decisionWire = JSON.stringify(decision), decisionExact = decisionWire + " ".repeat(65536 - Buffer.byteLength(decisionWire, "utf8")); expect(Buffer.byteLength(decisionExact, "utf8")).toBe(65536);
    token = f.token; expect(CampaignOwnerReviewResultSchema.parse(await success(await reviewCommand(post("/reviews/commands", decisionExact)))).state).toBe("DECLINED");
    const decided = await snapshot(small.result.campaignId); await failure(await reviewCommand(post("/reviews/commands", decisionExact + " ")), 413, "PAYLOAD_TOO_LARGE");
    await failure(await reviewCommand(post("/reviews/commands", { ...decision, operationKey: key(), policyReview: { reviewed: true } })), 422, "VALIDATION");
    expect(await snapshot(small.result.campaignId)).toEqual(decided);
    const headers = await success(await list(get("", scopeQuery(f.scope)))); privateSafe(headers, [fields.productService, fields.summary, fields.usageRights]);
  });

  it("isolates two genuine same-Brand CLIENTs and submitted owner review, then gates exact replay by current view/plan permission", async () => {
    const f = await company(), a = await agency(f, "Synthetic planning route agency A"), b = await agency(f, "Synthetic planning route agency B");
    const choice = await approvedContext(f, a.seat, a.scope), ca = await fresh(a.seat, a.scope, campaignFields, choice), cb = await fresh(b.seat, b.scope, { ...campaignFields, title: "B unsent private canary" });
    const hidden = "Unsubmitted CLIENT narrative private canary";
    await step(a.seat, a.scope, ca.result.campaignId, "SAVE_NARRATIVE", { narrative: { schemaVersion: 1, mode: "CHAT", processing: "UNPROCESSED", originalText: { text: hidden, language: "en" } } });
    token = a.seat.token;
    const onlyA = PlanningCampaignListSchema.parse(await success(await list(get("", scopeQuery(a.scope))))); expect(onlyA.campaigns.map(row => row.id)).toEqual([ca.result.campaignId]); expect(onlyA.currentAuthority?.capability).toBe("view");
    await failure(await detail(get("/detail", scopeQuery(a.scope) + `&campaignId=${cb.result.campaignId}`)), 404, "NOT_FOUND");
    await failure(await detail(get("/detail", scopeQuery(b.scope) + `&campaignId=${cb.result.campaignId}`)), 404, "NOT_FOUND");
    const sent = await submitted(a.seat, a.scope, ca.result.campaignId); token = a.seat.token;
    await failure(await reviewDetail(get("/reviews/detail", `?submissionId=${sent.result.submissionId}`)), 404, "NOT_FOUND");
    await failure(await reviewCommand(post("/reviews/commands", { operationKey: key(), submissionId: sent.result.submissionId, expectedRevision: 1, decision: "APPROVE" })), 404, "NOT_FOUND");
    token = f.token; expect(await prisma.organizationMembership.count({ where: { userId: f.user.id, organizationId: { in: [a.organization.id, b.organization.id] } } })).toBe(0);
    const inbox = CampaignOwnerReviewsSchema.parse(await success(await reviews(get("/reviews")))); expect(inbox.reviews.map(row => row.id)).toEqual([sent.result.submissionId]);
    privateSafe(inbox, [hidden, cb.result.campaignId, "B unsent private canary", a.seat.user.email, a.seat.token]);
    const review = CampaignOwnerReviewSchema.parse(await success(await reviewDetail(get("/reviews/detail", `?submissionId=${sent.result.submissionId}`))));
    expect(review.review.selectedContext?.id).toBe(choice.versionId); expect(review.review.selectedContext?.content).toEqual(contextContent); privateSafe(review, [hidden, "narrative", "proposals", "B unsent private canary"]);
    await failure(await detail(get("/detail", scopeQuery(a.scope) + `&campaignId=${ca.result.campaignId}`)), 404, "NOT_FOUND");
    expect(PlanningCampaignListSchema.parse(await success(await list(get("", scopeQuery(f.scope))))).campaigns).toEqual([]);
    expect(CampaignOwnerReviewResultSchema.parse(await success(await reviewCommand(post("/reviews/commands", { operationKey: key(), submissionId: sent.result.submissionId, expectedRevision: 1, decision: "APPROVE" })))).state).toBe("APPROVED");
    expect((await current(a.seat, a.scope, ca.result.campaignId)).briefs[0]!.approvedByUserId).toBe(f.user.id);
    const before = await snapshot(ca.result.campaignId);
    const viewOnly = { view: true, plan: false, approveShortlist: false, reviewContent: false, signCustomer: false, financial: false, manageGrants: false };
    const withdrawn = await setClientGrant(a.owner.actor, a.client.id, { operationKey: key(), expectedClientRevision: a.client.revision, membershipId: a.membership.id, expectedGrantRevision: a.grant.revision, capabilities: viewOnly });
    token = a.seat.token; await failure(await command(post("/commands", ca.input)), 404, "NOT_FOUND"); expect(await snapshot(ca.result.campaignId)).toEqual(before);
    expect((await current(a.seat, a.scope, ca.result.campaignId)).currentAuthority?.capability).toBe("view");
    await setClientGrant(a.owner.actor, a.client.id, { operationKey: key(), expectedClientRevision: a.client.revision, membershipId: a.membership.id, expectedGrantRevision: withdrawn.grant.revision, capabilities: allCaps });
    token = a.seat.token; expect(await success(await command(post("/commands", ca.input)))).toEqual({ ...ca.result, replayed: true }); expect(await snapshot(ca.result.campaignId)).toEqual(before);
    await failure(await command(post("/commands", { ...ca.input, scope: b.scope })), 422, "VALIDATION");
    token = b.seat.token; expect((await current(b.seat, b.scope, cb.result.campaignId)).campaign.title).toBe("B unsent private canary");
  }, 30000);
});
