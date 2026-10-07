import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { SESSION_COOKIE } from "@/lib/jwt";
import type { OrganizationActor } from "@/lib/organizations/context";
import type { ClientCapabilities } from "@/lib/organizations/contracts";
import { createOrganization, proposeClientAssociation, authorizeClientAssociation, proposeMember,
  acceptMembership, setClientGrant } from "@/lib/organizations/service";
import { getClientAuthority } from "@/lib/organizations/loaders";
import { BrandContextContentSchema, BrandContextCommandResultSchema, ContextOwnerReviewResultSchema,
  type PlanningScope } from "@/lib/brand-context/contracts";
import { ContextReferenceCommandResultSchema, ContextReferenceResponseSchema, ContextReviewReferenceResponseSchema,
  CampaignReviewReferenceResponseSchema } from "@/lib/brand-context/reference-contracts";
import { CampaignPlanningCommandSchema, CampaignPlanningResultSchema, PlanningCampaignSchema } from "@/lib/campaign-planning/contracts";
import { createLocalEvidenceStorage } from "@/lib/evidence/storage";
import { MAX_EVIDENCE_BYTES } from "@/lib/evidence/limits";
import { commandContextReferences as directReferenceCommand } from "@/lib/brand-context/reference-transport";
import { GET as references } from "@/app/api/brand-contexts/references/route";
import { POST as referenceCommand } from "@/app/api/brand-contexts/references/commands/route";
import { GET as referenceAsset } from "@/app/api/brand-contexts/references/assets/[bindingId]/route";
import { GET as contextReviewReferences } from "@/app/api/brand-contexts/reviews/references/route";
import { GET as contextReviewAsset } from "@/app/api/brand-contexts/reviews/references/assets/[bindingId]/route";
import { GET as campaignReviewReferences } from "@/app/api/planning-campaigns/reviews/references/route";
import { GET as campaignReviewAsset } from "@/app/api/planning-campaigns/reviews/references/assets/[bindingId]/route";
import { POST as contextCommand } from "@/app/api/brand-contexts/commands/route";
import { POST as contextReviewCommand } from "@/app/api/brand-contexts/reviews/commands/route";
import { POST as planningCommand } from "@/app/api/planning-campaigns/commands/route";
import { GET as planningDetail } from "@/app/api/planning-campaigns/detail/route";
import { campaignFields } from "../campaigns/fixtures";

// Ignored independent draft for tests/brand-context/reference-transport.test.ts.
// Exactly two native groups. Only Next's cookie context is a seam. Sessions,
// organization/context/campaign producers, storage runtime, local immutable
// files, permissions, receipts and PostgreSQL are actual guarded test operations.
// This is synthetic local acceptance, not live customer/provider/cloud evidence.
let token: string | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) =>
  name === SESSION_COOKIE && token ? { name, value: token } : undefined }) }));
const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>();
const key = () => randomUUID();
const allCaps: ClientCapabilities = { view: true, plan: true, approveShortlist: true, reviewContent: true,
  signCustomer: true, financial: true, manageGrants: true };
const viewCaps: ClientCapabilities = { view: true, plan: false, approveShortlist: false, reviewContent: false,
  signCustomer: false, financial: false, manageGrants: false };
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1kAAAAASUVORK5CYII=", "base64"));
const labelOriginal = { text: "  مرجع الحملة الأصلي / Original reference  ", language: "ar" };
const notesOriginal = { text: " \tألوان المنتج الأصلية\nOriginal notes\r ", language: "ar" };
const contextContent = BrandContextContentSchema.parse({ schemaVersion: 1, positioning: { text: "Original private positioning", language: "en" },
  values: [], tone: { text: "نبرة أصلية يراجعها العميل", language: "ar" }, references: [], competitors: [] });
let previousStorageMode: string | undefined;
beforeEach(() => { previousStorageMode = process.env.EVIDENCE_STORAGE_MODE; process.env.EVIDENCE_STORAGE_MODE = "local"; });
afterEach(async () => {
  token = null;
  try {
    const ownedAssets = await prisma.privateAsset.findMany({ where: { ownerUserId: { in: [...users] } }, select: { storageKey: true } });
    const workspaces = await prisma.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } });
    const ids = workspaces.map(row => row.id);
    if (ids.length) {
      for (const table of ["ContextReferenceCommand", "ContextSubmissionReferences", "ContextReferenceState", "ContextReferenceManifest", "ContextAssetBinding",
        "PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission", "CampaignBriefProvenance",
        "CampaignProposalDependency", "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding", "BrandContextVersion",
        "BrandContextSubmission", "BrandContext"] as const) {
        await prisma.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join(ids)})`);
      }
      await prisma.planningWorkspace.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.evidenceCommand.deleteMany({ where: { actorUserId: { in: [...users] } } });
    await prisma.privateAsset.deleteMany({ where: { ownerUserId: { in: [...users] } } });
    // Only keys witnessed in this group's owned native PrivateAsset rows may be
    // removed. The existing local adapter enforces the task/path/symlink guards.
    if (ownedAssets.length) {
      const taskId = process.env.INFAME_TASK_ID;
      if (!taskId || !/^infame_[a-f0-9]{12}$/.test(taskId)) throw new Error("Owned local cleanup requires guarded task identity");
      const storage = await createLocalEvidenceStorage({ taskId, target: "test" });
      for (const { storageKey } of ownedAssets) {
        if (!storageKey.startsWith("local:")) throw new Error("Unexpected non-local owned test asset");
        await storage.remove(storageKey.slice("local:".length));
      }
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
    await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
  } finally {
    if (previousStorageMode === undefined) delete process.env.EVIDENCE_STORAGE_MODE;
    else process.env.EVIDENCE_STORAGE_MODE = previousStorageMode;
    users.clear(); brands.clear(); organizations.clear();
  }
});
async function person(role: "BRAND" | "CREATOR" | "ADMIN" = "BRAND") {
  const id = key(); users.add(id);
  const user = await prisma.user.create({ data: { id, role, active: true, isTest: true, name: "Synthetic native reference route actor",
    email: id + "@example.invalid", passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  const signed = await openSession(id, user.sessionVersion, user.passwordHash), session = await resolveSession(signed);
  if (!session) throw new Error("Synthetic actual reference route session did not resolve");
  const actor: OrganizationActor = { userId: session.userId, role: session.role, sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  return { user, actor, token: signed };
}
type Account = Awaited<ReturnType<typeof person>>;
async function company() {
  const owner = await person(), brand = await prisma.brand.create({ data: { userId: owner.user.id,
    slug: "reference-api-" + key().replace(/-/g, "").slice(0, 14), name: "Synthetic reference route company", countryCode: "SA", isTest: true } });
  brands.add(brand.id); return { ...owner, brand, scope: { kind: "OWN_BRAND", brandId: brand.id } as PlanningScope };
}
async function member(owner: Account, organizationId: string) {
  const seat = await person(), organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const proposed = await proposeMember(owner.actor, organizationId, { operationKey: key(), expectedOrganizationRevision: organization.revision, targetUserId: seat.user.id });
  const accepted = await acceptMembership(seat.actor, proposed.membership.id, { operationKey: key(), expectedRevision: proposed.membership.revision });
  return { ...seat, membership: accepted.membership };
}
async function agency(customer: Awaited<ReturnType<typeof company>>) {
  const owner = await person(), { organization } = await createOrganization(owner.actor, { operationKey: key(), kind: "AGENCY", nameOriginal: "Synthetic reference transport agency" });
  organizations.add(organization.id);
  const proposed = await proposeClientAssociation(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: organization.revision, brandId: customer.brand.id });
  const { client } = await authorizeClientAssociation(customer.actor, proposed.client.id, { operationKey: key(), expectedRevision: proposed.client.revision, capabilities: allCaps });
  const seat = await member(owner, organization.id);
  await setClientGrant(owner.actor, client.id, { operationKey: key(), expectedClientRevision: client.revision,
    membershipId: seat.membership.id, expectedGrantRevision: null, capabilities: allCaps });
  return { owner, organization, client, seat, scope: { kind: "CLIENT", clientId: client.id } as PlanningScope };
}
function origin() {
  if (!process.env.APP_ORIGIN) throw new Error("Guarded reference route target requires APP_ORIGIN");
  return new URL(process.env.APP_ORIGIN).origin;
}
function get(path: string, search = "") { return new Request(origin() + path + search); }
function post(path: string, body: unknown) {
  return new Request(origin() + path, { method: "POST", headers: { origin: origin(), "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body) });
}
function scoped(scope: PlanningScope, contextId: string, versionId?: string) {
  const params = new URLSearchParams(scope.kind === "OWN_BRAND" ? { scope: scope.kind, brandId: scope.brandId } : { scope: scope.kind, clientId: scope.clientId });
  params.set("contextId", contextId); if (versionId) params.set("versionId", versionId); return "?" + params.toString();
}
const ownerQuery = (submissionId: string) => "?submissionId=" + encodeURIComponent(submissionId);
const fileParams = (bindingId: string) => ({ params: Promise.resolve({ bindingId }) });
async function envelope(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
  const body = await response.json(); expect(body.requestId).toBe(response.headers.get("x-request-id")); return body;
}
async function success(response: Response) {
  expect(response.status).toBe(200); const body = await envelope(response);
  expect(Object.keys(body).sort()).toEqual(["data", "requestId"]); return body.data;
}
async function failure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status); const body = await envelope(response);
  expect(Object.keys(body).sort()).toEqual(["error", "requestId"]);
  expect(body.error).toEqual({ code, message: code, requestId: body.requestId, retryable: status === 503 || status === 429 });
  return body;
}
async function assertFile(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(response.headers.get("content-disposition")).toBe('attachment; filename="reference.png"');
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
  expect(response.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
}
async function authority(account: Account, scope: PlanningScope) {
  return scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(account.actor, scope.clientId, "plan") } : {};
}
async function freshContext(account: Account, scope: PlanningScope) {
  token = account.token;
  return BrandContextCommandResultSchema.parse(await success(await contextCommand(post("/api/brand-contexts/commands", {
    operationKey: key(), scope, ...await authority(account, scope), action: "CREATE", expectedRevision: 0,
    payload: { nameOriginal: { text: "سياق أصلي خاص", language: "ar" }, content: contextContent },
  }))));
}
async function uploadInput(account: Account, scope: PlanningScope, contextId: string, expectedRevision: number, expectedReferenceRevision = 0) {
  return { operationKey: key(), scope, ...await authority(account, scope), contextId, expectedRevision, expectedReferenceRevision,
    action: "UPLOAD", payload: { labelOriginal, notesOriginal } };
}
function upload(input: unknown, modify?: (form: FormData) => void, metadata?: Uint8Array) {
  const form = new FormData();
  form.append("command", new Blob([metadata ? new Uint8Array(metadata) : JSON.stringify(input)], { type: "application/json" }), "command.json");
  form.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "مرجع.png");
  modify?.(form);
  return new Request(origin() + "/api/brand-contexts/references/commands", { method: "POST", headers: { origin: origin() }, body: form });
}
async function manifest(account: Account, scope: PlanningScope, contextId: string, versionId?: string) {
  token = account.token;
  const response = ContextReferenceResponseSchema.parse(await success(await references(get("/api/brand-contexts/references", scoped(scope, contextId, versionId)))));
  if (response.references.kind !== "MANIFEST") throw new Error("Expected native persisted manifest");
  return response.references;
}
async function contextSubmission(account: Account, scope: PlanningScope, contextId: string) {
  const current = await prisma.brandContext.findUniqueOrThrow({ where: { id: contextId } }); token = account.token;
  const sent = BrandContextCommandResultSchema.parse(await success(await contextCommand(post("/api/brand-contexts/commands", {
    operationKey: key(), scope, ...await authority(account, scope), contextId, expectedRevision: current.revision, action: "SUBMIT", payload: {},
  }))));
  if (!sent.submissionId) throw new Error("Actual context producer omitted submission"); return sent.submissionId;
}
async function campaignSubmission(account: Account, scope: PlanningScope, selection: unknown) {
  token = account.token;
  const made = CampaignPlanningResultSchema.parse(await success(await planningCommand(post("/api/planning-campaigns/commands", CampaignPlanningCommandSchema.parse({
    operationKey: key(), scope, ...await authority(account, scope), action: "CREATE", expectedCampaignRevision: 0, expectedPlanningRevision: 0,
    expectedSelectionId: null, expectedSelectionRevision: 0, payload: { fields: campaignFields, selection, narrative: null },
  })))));
  const step = async (action: string, payload: unknown) => {
    const params = new URLSearchParams(scope.kind === "OWN_BRAND" ? { scope: scope.kind, brandId: scope.brandId } : { scope: scope.kind, clientId: scope.clientId });
    params.set("campaignId", made.campaignId); token = account.token;
    const current = PlanningCampaignSchema.parse(await success(await planningDetail(get("/api/planning-campaigns/detail", "?" + params.toString()))));
    return CampaignPlanningResultSchema.parse(await success(await planningCommand(post("/api/planning-campaigns/commands", CampaignPlanningCommandSchema.parse({
      operationKey: key(), scope, ...await authority(account, scope), campaignId: made.campaignId, expectedCampaignRevision: current.campaign.revision,
      expectedPlanningRevision: current.planning.revision, expectedSelectionId: current.planning.selection.id,
      expectedSelectionRevision: current.planning.selection.revision, action, payload,
    })))));
  };
  const brief = await step("GENERATE_BRIEF", {}), sent = await step("SUBMIT_BRIEF", { briefId: brief.briefId, expectedBriefVersion: brief.version });
  if (!sent.submissionId) throw new Error("Actual campaign producer omitted submission"); return { campaignId: made.campaignId, submissionId: sent.submissionId };
}
async function snapshot(contextId: string) {
  return { context: await prisma.brandContext.findUniqueOrThrow({ where: { id: contextId } }),
    commands: await prisma.contextReferenceCommand.findMany({ where: { contextId }, orderBy: { id: "asc" } }),
    bindings: await prisma.contextAssetBinding.findMany({ where: { contextId }, orderBy: { id: "asc" } }) };
}
function streamRequest(body: ReadableStream<Uint8Array>, signal?: AbortSignal, contentLength?: string, type = "application/json") {
  const headers: Record<string, string> = { origin: origin(), "content-type": type };
  if (contentLength !== undefined) headers["content-length"] = contentLength;
  const init: RequestInit & { duplex: "half" } = { method: "POST", headers, body, signal, duplex: "half" };
  return new Request(origin() + "/api/brand-contexts/references/commands", init);
}

describe("reference transport: two actual signed native API groups", () => {
  it("uploads original Arabic through actual local storage, isolates CLIENT/view/owner lanes, pins both reviews and edits metadata without storage", async () => {
    const customer = await company(), a = await agency(customer), b = await agency(customer), made = await freshContext(a.seat, a.scope);
    const input = await uploadInput(a.seat, a.scope, made.contextId, made.revision); token = a.seat.token;
    const saved = ContextReferenceCommandResultSchema.parse(await success(await referenceCommand(upload(input))));
    expect(saved).toMatchObject({ contextId: made.contextId, revision: made.revision + 1, referenceRevision: 1, replayed: false });
    const current = await manifest(a.seat, a.scope, made.contextId);
    expect(current.items).toHaveLength(1); const item = current.items[0]!;
    expect(item).toMatchObject({ bindingId: saved.bindingId, labelOriginal, notesOriginal, contentType: "image/png", size: png.byteLength });
    const persisted = await prisma.privateAsset.findUniqueOrThrow({ where: { id: item.assetId } }); expect(persisted.storageKey).toMatch(/^local:/);
    const stable = await snapshot(made.contextId); token = a.seat.token;
    expect(await success(await referenceCommand(upload(input)))).toEqual({ ...saved, replayed: true });
    expect(await snapshot(made.contextId)).toEqual(stable);
    await assertFile(await referenceAsset(get("/api/brand-contexts/references/assets/" + item.bindingId, scoped(a.scope, made.contextId)), fileParams(item.bindingId)));
    token = b.seat.token;
    await failure(await references(get("/api/brand-contexts/references", scoped(b.scope, made.contextId))), 404, "NOT_FOUND");
    const viewer = await member(a.owner, a.organization.id);
    await setClientGrant(a.owner.actor, a.client.id, { operationKey: key(), expectedClientRevision: a.client.revision,
      membershipId: viewer.membership.id, expectedGrantRevision: null, capabilities: viewCaps });
    expect(await manifest(viewer, a.scope, made.contextId)).toEqual(current); token = viewer.token;
    await assertFile(await referenceAsset(get("/api/brand-contexts/references/assets/" + item.bindingId, scoped(a.scope, made.contextId)), fileParams(item.bindingId)));
    const forgedPlan = { ...await getClientAuthority(viewer.actor, a.client.id, "view"), capability: "plan" };
    await failure(await referenceCommand(post("/api/brand-contexts/references/commands", { operationKey: key(), scope: a.scope,
      expectedAuthority: forgedPlan, contextId: made.contextId, expectedRevision: saved.revision, expectedReferenceRevision: saved.referenceRevision,
      action: "REPLACE", payload: { items: [] } })), 404, "NOT_FOUND");
    const submissionId = await contextSubmission(a.seat, a.scope, made.contextId); token = customer.token;
    expect(await prisma.organizationMembership.count({ where: { userId: customer.user.id, organizationId: { in: [a.organization.id, b.organization.id] } } })).toBe(0);
    await failure(await references(get("/api/brand-contexts/references", scoped(a.scope, made.contextId))), 404, "NOT_FOUND");
    const ownerManifest = ContextReviewReferenceResponseSchema.parse(await success(await contextReviewReferences(get("/api/brand-contexts/reviews/references", ownerQuery(submissionId)))));
    expect(ownerManifest).toEqual({ submissionId, contextId: made.contextId, references: current });
    await assertFile(await contextReviewAsset(get("/api/brand-contexts/reviews/references/assets/" + item.bindingId, ownerQuery(submissionId)), fileParams(item.bindingId)));
    const approved = ContextOwnerReviewResultSchema.parse(await success(await contextReviewCommand(post("/api/brand-contexts/reviews/commands", {
      operationKey: key(), submissionId, expectedRevision: 1, decision: "APPROVE",
    }))));
    if (!approved.versionId) throw new Error("Actual context approval omitted version");
    expect(await manifest(a.seat, a.scope, made.contextId, approved.versionId)).toEqual(current);
    const version = await prisma.brandContextVersion.findUniqueOrThrow({ where: { id: approved.versionId } });
    const campaign = await campaignSubmission(a.seat, a.scope, { kind: "APPROVED_CONTEXT", versionId: version.id, contentHash: version.contentHash }); token = customer.token;
    const campaignManifest = CampaignReviewReferenceResponseSchema.parse(await success(await campaignReviewReferences(get("/api/planning-campaigns/reviews/references", ownerQuery(campaign.submissionId)))));
    expect(campaignManifest).toEqual({ submissionId: campaign.submissionId, campaignId: campaign.campaignId, contextVersionId: version.id, references: current });
    await assertFile(await campaignReviewAsset(get("/api/planning-campaigns/reviews/references/assets/" + item.bindingId, ownerQuery(campaign.submissionId)), fileParams(item.bindingId)));
    process.env.EVIDENCE_STORAGE_MODE = "unavailable"; token = a.seat.token;
    const context = await prisma.brandContext.findUniqueOrThrow({ where: { id: made.contextId } });
    const replaced = ContextReferenceCommandResultSchema.parse(await success(await referenceCommand(post("/api/brand-contexts/references/commands", {
      operationKey: key(), scope: a.scope, ...await authority(a.seat, a.scope), contextId: made.contextId,
      expectedRevision: context.revision, expectedReferenceRevision: saved.referenceRevision, action: "REPLACE", payload: { items: [] },
    }))));
    expect(replaced.referenceRevision).toBe(saved.referenceRevision + 1); expect((await manifest(a.seat, a.scope, made.contextId)).items).toEqual([]);
    token = customer.token;
    expect(ContextReviewReferenceResponseSchema.parse(await success(await contextReviewReferences(get("/api/brand-contexts/reviews/references", ownerQuery(submissionId))))).references).toEqual(current);
    expect(CampaignReviewReferenceResponseSchema.parse(await success(await campaignReviewReferences(get("/api/planning-campaigns/reviews/references", ownerQuery(campaign.submissionId))))).references).toEqual(current);
    await failure(await campaignReviewAsset(get("/api/planning-campaigns/reviews/references/assets/" + item.bindingId, ownerQuery(campaign.submissionId)), fileParams(item.bindingId)), 503, "CAPABILITY_UNAVAILABLE");
  });

  it("authenticates before malformed input, rejects ambiguous/oversized transport, bounds real abort/stalled bodies and recovers an unread native receipt exactly", async () => {
    token = null;
    const invalid = post("/api/brand-contexts/references/commands", "{private malformed command");
    await failure(await directReferenceCommand(invalid), 401, "UNAUTHENTICATED"); expect(invalid.bodyUsed).toBe(false);
    for (const [handler, path] of [[references, "/api/brand-contexts/references"], [contextReviewReferences, "/api/brand-contexts/reviews/references"],
      [campaignReviewReferences, "/api/planning-campaigns/reviews/references"]] as const) {
      await failure(await handler(get(path, "?submissionId=x&submissionId=x&scope=bad")), 401, "UNAUTHENTICATED");
    }
    const wrong = await person("CREATOR"); token = wrong.token;
    const wrongBody = post("/api/brand-contexts/references/commands", "{malformed");
    await failure(await referenceCommand(wrongBody), 403, "FORBIDDEN"); expect(wrongBody.bodyUsed).toBe(false);
    const owner = await company(), made = await freshContext(owner, owner.scope), input = await uploadInput(owner, owner.scope, made.contextId, made.revision); token = owner.token;
    const before = await snapshot(made.contextId);
    await failure(await references(get("/api/brand-contexts/references", scoped(owner.scope, made.contextId) + "&contextId=" + made.contextId)), 422, "VALIDATION");
    await failure(await contextReviewReferences(get("/api/brand-contexts/reviews/references", "?submissionId=x&scope=OWN_BRAND")), 422, "VALIDATION");
    const queried = post("/api/brand-contexts/references/commands?scope=OWN_BRAND", "{malformed");
    await failure(await referenceCommand(queried), 422, "VALIDATION"); expect(queried.bodyUsed).toBe(false);
    await failure(await referenceCommand(upload(input, form => form.append("command", new Blob([JSON.stringify(input)], { type: "application/json" }), "duplicate.json"))), 422, "VALIDATION");
    await failure(await referenceCommand(upload({ ...input, payload: { ...input.payload, contentType: "image/png", bytes: [137, 80] } })), 422, "VALIDATION");
    await failure(await referenceCommand(upload(input, undefined, Uint8Array.from([0xc3, 0x28]))), 422, "VALIDATION");
    const tooBig = new Request(origin() + "/api/brand-contexts/references/commands", { method: "POST", headers: {
      origin: origin(), "content-type": "multipart/form-data; boundary=native-bound", "content-length": String(MAX_EVIDENCE_BYTES + 96 * 1024 + 1),
    }, body: "x" });
    await failure(await referenceCommand(tooBig), 413, "PAYLOAD_TOO_LARGE"); expect(tooBig.bodyUsed).toBe(false);
    let abortCancelled = false;
    const abortStream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Uint8Array.from([123])); },
      pull() { return new Promise<void>(() => {}); }, cancel() { abortCancelled = true; return new Promise<void>(() => {}); } });
    const abort = new AbortController(), abortRequest = streamRequest(abortStream, abort.signal), abortStarted = performance.now();
    const abortedResponse = referenceCommand(abortRequest), timer = setTimeout(() => abort.abort(), 25);
    try { await failure(await abortedResponse, 408, "UPLOAD_ABORTED"); } finally { clearTimeout(timer); }
    expect(abortRequest.bodyUsed).toBe(true); expect(abortCancelled).toBe(true); expect(performance.now() - abortStarted).toBeLessThan(1500);
    let timeoutCancelled = false;
    const stalled = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Uint8Array.from([123])); },
      pull() { return new Promise<void>(() => {}); }, cancel() { timeoutCancelled = true; return new Promise<void>(() => {}); } });
    const stalledRequest = streamRequest(stalled), started = performance.now();
    await failure(await referenceCommand(stalledRequest), 408, "UPLOAD_TIMEOUT");
    expect(timeoutCancelled).toBe(true); expect(performance.now() - started).toBeGreaterThanOrEqual(19_000);
    expect(performance.now() - started).toBeLessThan(23_000); expect(await snapshot(made.contextId)).toEqual(before);
    // Receipt-loss recovery: an actual producer completes, but its response body
    // is discarded. This does not claim a simulated PostgreSQL commit failure.
    const unread = await referenceCommand(upload(input)); expect(unread.status).toBe(200); expect(unread.bodyUsed).toBe(false);
    const committed = await snapshot(made.contextId);
    const recovered = ContextReferenceCommandResultSchema.parse(await success(await referenceCommand(upload(input))));
    expect(recovered.replayed).toBe(true); expect(committed.commands).toHaveLength(1); expect(committed.bindings).toHaveLength(1);
    expect(await snapshot(made.contextId)).toEqual(committed); expect((await manifest(owner, owner.scope, made.contextId)).items[0]!.bindingId).toBe(recovered.bindingId);
  }, 25_000);
});
