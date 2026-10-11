// S1b candidate: exactly three native groups, root alone adopts/runs.
// Actual M03 producers, native sessions/guards/row waits; controlled synthetic
// policy/evidence fixtures are not legal, provider, paid or publication readiness.
import { createHash, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { captureOrganizationActor } from "@/lib/organizations/context";
import { acceptMembership, authorizeClientAssociation, createOrganization, proposeClientAssociation, proposeMember, setClientGrant } from "@/lib/organizations/service";
import { getClientAuthority } from "@/lib/organizations/loaders";
import { brandContextScopeInternals, type BrandContextPlanningProof } from "@/lib/brand-context/scope";
import { BrandContextContentSchema, type PlanningScope } from "@/lib/brand-context/contracts";
import { decideContextOwnerReview, executeBrandContextCommand } from "@/lib/brand-context/service";
import { executeCampaignPlanningCommand } from "@/lib/campaign-planning/service";
import { beginPlanningCall, planningScopeInternals, type PlanningBoundScopeProof, type PlanningNativeScopeCapture } from "@/lib/campaign-planning/scope";
import { createAiBudgetLedger, readAiPlanningNativeFrame, type AiPlanningNativeFrame } from "@/lib/ai-budget/ledger";
import { createCampaign } from "@/lib/campaigns/service";
import { CampaignRequirementsSchema } from "@/lib/campaigns/contracts";
import { MarketPolicyContentSchema, resolveCampaignPolicyReview } from "@/lib/policies";
import { campaignFields } from "../campaigns/fixtures";

const users = new Set<string>(), brands = new Set<string>(), orgs = new Set<string>(), campaigns = new Set<string>();
const policies = new Set<string>(), assets = new Set<string>(), peers = new Set<PrismaClient>();
const words = "synthetic-private-campaign-context-source-body-canary", hash = (text: string) => createHash("sha256").update(text).digest("hex");
const caps = { view: true, plan: true, approveShortlist: false, reviewContent: false, signCustomer: false, financial: false, manageGrants: false };
const content = BrandContextContentSchema.parse({ schemaVersion: 1, positioning: { text: words, language: "en" }, values: [],
  tone: { text: "Synthetic approved tone", language: "en" }, references: [], competitors: [] });
async function person(role: "BRAND" | "ADMIN" = "BRAND") {
  const id = randomUUID(); users.add(id);
  const user = await prisma.user.create({ data: { id, role, active: true, isTest: true, name: "Synthetic campaign scope actor",
    email: id + "@example.invalid", passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  const token = await openSession(id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Owned native campaign scope session did not resolve");
  return { user, token, actor: captureOrganizationActor(session) };
}
type Actor = Awaited<ReturnType<typeof person>>;
async function company() {
  const owner = await person(), brand = await prisma.brand.create({ data: { userId: owner.user.id, slug: "ncs-" + randomUUID(),
    name: words, description: words, countryCode: "KW", isTest: true } }); brands.add(brand.id);
  return { ...owner, brand, scope: { kind: "OWN_BRAND", brandId: brand.id } as PlanningScope };
}
type Company = Awaited<ReturnType<typeof company>>;
async function agency(customer: Company) {
  const owner = await person(), seat = await person();
  const organization = (await createOrganization(owner.actor, { operationKey: randomUUID(), nameOriginal: "وكالة اختبار أصلية", kind: "AGENCY" })).organization; orgs.add(organization.id);
  const revision = async () => (await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).revision;
  const pending = (await proposeClientAssociation(owner.actor, organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: await revision(), brandId: customer.brand.id })).client;
  const client = (await authorizeClientAssociation(customer.actor, pending.id, { operationKey: randomUUID(), expectedRevision: pending.revision, capabilities: caps })).client;
  const proposed = (await proposeMember(owner.actor, organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: await revision(), targetUserId: seat.user.id })).membership;
  const membership = (await acceptMembership(seat.actor, proposed.id, { operationKey: randomUUID(), expectedRevision: proposed.revision })).membership;
  await setClientGrant(customer.actor, client.id, { operationKey: randomUUID(), expectedClientRevision: client.revision, membershipId: membership.id, expectedGrantRevision: null, capabilities: caps });
  return { owner, seat, client, scope: { kind: "CLIENT", clientId: client.id } as PlanningScope };
}
async function expected(actor: Actor, scope: PlanningScope) { return scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(actor.actor, scope.clientId, "plan") } : {}; }
async function approved(owner: Company) {
  const made = await executeBrandContextCommand(owner.actor, { operationKey: randomUUID(), scope: owner.scope, action: "CREATE", expectedRevision: 0,
    payload: { nameOriginal: { text: words, language: "en" }, content } });
  const submitted = await executeBrandContextCommand(owner.actor, { operationKey: randomUUID(), scope: owner.scope, action: "SUBMIT", contextId: made.contextId, expectedRevision: made.revision, payload: {} });
  const decision = await decideContextOwnerReview(owner.actor, { operationKey: randomUUID(), submissionId: submitted.submissionId!, expectedRevision: 1, decision: "APPROVE" });
  const version = await prisma.brandContextVersion.findUniqueOrThrow({ where: { id: decision.versionId! } });
  return { contextId: made.contextId, version, choice: { kind: "APPROVED_CONTEXT" as const, versionId: version.id, contentHash: version.contentHash } };
}
async function made(actor: Actor, scope: PlanningScope, selection: unknown = { kind: "NONE" }) {
  const result = await executeCampaignPlanningCommand(actor.actor, { operationKey: randomUUID(), scope, ...await expected(actor, scope), action: "CREATE",
    expectedCampaignRevision: 0, expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0,
    payload: { fields: { title: words }, selection, narrative: null } }); campaigns.add(result.campaignId); return result.campaignId;
}
function observedDb() {
  const queries: string[] = [], lockedIds: string[] = [];
  const db = new PrismaClient({ log: [{ emit: "event", level: "query" }] }); peers.add(db);
  db.$on("query", event => {
    queries.push(event.query); // SQL shapes only. Never log query params.
    if (/FOR\s+(UPDATE|SHARE)/.test(event.query) && !event.query.includes('"AuthSession"')) {
      const params: unknown = JSON.parse(event.params);
      if (Array.isArray(params)) for (const value of params) if (typeof value === "string") lockedIds.push(value);
    }
  });
  return { db, queries, lockedIds, clear: () => { queries.length = 0; lockedIds.length = 0; } };
}
type Observer = ReturnType<typeof observedDb>;
function ledger(db: PrismaClient) { return createAiBudgetLedger({ client: db, caps: { userDailyMicros: "1000000", platformDailyMicros: "1000000000" } }); }
function privateSafe(value: unknown, actors: Actor[]) {
  const json = JSON.stringify(value);
  for (const secret of [words, ...actors.flatMap(actor => [actor.token, actor.actor.sessionId])]) expect(json.includes(secret)).toBe(false);
  for (const field of ["sessionId", "executionToken", "name", "nameOriginal", "content", "input", "narrative", "conversation", "tx", "evidenceActors", "contextIds"])
    expect(json.includes('"' + field + '"')).toBe(false);
}
function thin(observer: Observer) {
  const bodies = ["name", "nameOriginal", "content", "input", "narrative", "conversation"];
  expect(observer.queries.some(query => /\bSELECT\b/.test(query) && /"(?:Brand|BrandContext|BrandContextSubmission|Campaign|CampaignPlanningState)"/.test(query)
    && bodies.some(field => query.includes('"' + field + '"')))).toBe(false);
}
const retry = { accepted: false, code: "RETRY_REQUIRED", status: 503 }, missing = { accepted: false, code: "NOT_FOUND", status: 404 };
const unavailable = { accepted: false, code: "SCOPE_PROOF_UNAVAILABLE", status: 503 }, baseUnavailable = { accepted: false, code: "PLANNING_FRAME_UNAVAILABLE", status: 503 };
const unauthorized = { accepted: false, code: "UNAUTHENTICATED", status: 401 }, invalid = { accepted: false, code: "VALIDATION", status: 422 };
async function observe(work: () => Promise<unknown>) {
  try { await work(); return { accepted: true, code: "ACCEPTED", status: 200 }; }
  catch (error) { const safe = error as { code?: string; status?: number }; return { accepted: false, code: safe.code ?? "OTHER_ERROR", status: safe.status ?? 0 }; }
}
function latch() { let release!: () => void; return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() }; }
async function hold(table: "PlanningWorkspace" | "BrandContextVersion", id: string, mutation: (tx: Prisma.TransactionClient) => Promise<void> = async () => {}) {
  const db = new PrismaClient(); peers.add(db); const ready = latch(), release = latch(); let pid = 0;
  const done = db.$transaction(async tx => {
    pid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`)[0]!.pid;
    await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw('"' + table + '"')} WHERE id=${id} FOR UPDATE`);
    ready.release(); await release.promise; await mutation(tx);
  }, { maxWait: 10000, timeout: 15000 }); void done.catch(() => {}); await ready.promise;
  return { pid, release: release.release, done };
}
async function blockedBy(pid: number, table: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ pid: number }>>`SELECT a.pid::int AS pid FROM pg_stat_activity a WHERE a.datname=current_database() AND a.wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(a.pid)) AND a.query LIKE ${'%"' + table + '"%'}`;
    if (rows.length) return; await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Campaign scope did not reach its actual native lock wait");
}
async function captured(actor: Actor, scope: PlanningScope, ids: string[], observer: Observer) {
  const call = await beginPlanningCall(actor.actor, { client: observer.db }), brand = await brandContextScopeInternals.capturePlanningIdentity(call, scope);
  const capture = await planningScopeInternals.capturePlanningIdentity(call, scope, ids); return { call, brand, capture };
}
type Capture = Awaited<ReturnType<typeof captured>>;
async function run(actor: Actor, capture: Capture, observer: Observer, extraOwners: string[] = []) {
  return ledger(observer.db).withPlanningActorTransaction(actor.actor,
    async () => ({ ownerIds: [...capture.brand.ownerIds, ...extraOwners], reviewerIds: capture.capture.reviewerIds }), async frame => {
      const brandProof = await brandContextScopeInternals.bindPlanningInFrame(frame, capture.brand, capture.call.checkpoint);
      const proof = await planningScopeInternals.preparePlanningInFrame(frame, brandProof, capture.call, capture.capture);
      const view = await planningScopeInternals.readPlanningProof(frame, proof); privateSafe(view, [actor]);
      await planningScopeInternals.recheckPlanningProof(frame, proof); return view;
    });
}
async function closed(frame: AiPlanningNativeFrame, proof: PlanningBoundScopeProof) {
  expect(await observe(() => planningScopeInternals.readPlanningProof(frame, proof))).toEqual(baseUnavailable);
  expect(await observe(() => planningScopeInternals.recheckPlanningProof(frame, proof))).toEqual(baseUnavailable);
}
async function selection(tx: Prisma.TransactionClient, campaignId: string, workspaceId: string, oldRevision: number,
  choice: { versionId: string; contentHash: string } | null, id = randomUUID()) {
  await tx.campaignContextSelection.create({ data: { id, campaignId, workspaceId, revision: oldRevision + 1,
    contextVersionId: choice?.versionId ?? null, contentHash: choice?.contentHash ?? null, createdAt: new Date() } });
  await tx.campaignPlanningState.update({ where: { campaignId }, data: { revision: { increment: 1 }, selectionId: id, selectionRevision: oldRevision + 1, updatedAt: new Date() } });
  return id;
}
async function metadata(capture: PlanningNativeScopeCapture) {
  const workspace = await prisma.planningWorkspace.findUniqueOrThrow({ where: { id: capture.workspace.id }, select: { id: true, scope: true, brandId: true, organizationId: true, clientId: true } });
  const campaigns = await prisma.campaign.findMany({ where: { id: { in: [...capture.campaignIds] } }, select: { id: true, brandId: true, revision: true, status: true, currentBriefVersion: true, updatedAt: true }, orderBy: { id: "asc" } });
  const bindings = await prisma.campaignPlanningBinding.findMany({ where: { campaignId: { in: [...capture.campaignIds] } }, select: { campaignId: true, workspaceId: true, brandId: true }, orderBy: { campaignId: "asc" } });
  const states = await prisma.campaignPlanningState.findMany({ where: { campaignId: { in: [...capture.campaignIds] } }, select: { campaignId: true, workspaceId: true, revision: true, selectionId: true, selectionRevision: true }, orderBy: { campaignId: "asc" } });
  const selections = await prisma.campaignContextSelection.findMany({ where: { id: { in: states.map(row => row.selectionId) } }, select: { id: true, campaignId: true, workspaceId: true, revision: true, contextVersionId: true, contentHash: true }, orderBy: { id: "asc" } });
  const versions = await prisma.brandContextVersion.findMany({ where: { id: { in: selections.flatMap(row => row.contextVersionId ? [row.contextVersionId] : []) } }, select: { id: true, contextId: true, workspaceId: true, submissionId: true, version: true, inputRevision: true, contentHash: true, approvedByUserId: true, approvedAt: true }, orderBy: { id: "asc" } });
  const contexts = await prisma.brandContext.findMany({ where: { id: { in: versions.map(row => row.contextId) } }, select: { id: true, workspaceId: true, archived: true }, orderBy: { id: "asc" } });
  const submissions = await prisma.brandContextSubmission.findMany({ where: { id: { in: versions.map(row => row.submissionId) } }, select: { id: true, contextId: true, workspaceId: true, inputRevision: true, contentHash: true, state: true, decidedByUserId: true, decidedAt: true }, orderBy: { id: "asc" } });
  return { workspace, campaigns: campaigns.map(row => ({ ...row, updatedAt: row.updatedAt.toISOString() })), bindings, states, contexts, selections,
    versions: versions.map(row => ({ ...row, approvedAt: row.approvedAt.toISOString() })), submissions: submissions.map(row => ({ ...row, decidedAt: row.decidedAt?.toISOString() ?? null })), policyReviewerIds: capture.reviewerIds };
}
async function policy(status: "VERIFIED" | "PENDING" = "VERIFIED", country = "NR") {
  const reviewer = await person("ADMIN"), id = randomUUID(), reviewedAt = new Date(Date.now() - 1000); policies.add(id);
  const asset = await prisma.privateAsset.create({ data: { ownerUserId: reviewer.user.id, purpose: "LEGAL_POLICY_REVIEW", contentType: "text/plain", size: 1,
    storageKey: "synthetic-native-scope-policy:" + id, checksum: "f".repeat(64) } }); assets.add(asset.id);
  const content = MarketPolicyContentSchema.parse({ schemaVersion: 1, kind: "MARKET", marketCountryCode: country, brandCountryCodes: ["KW"], creatorCountryCodes: ["GB"],
    licenceRequired: false, licencePolicyId: null, reviewReference: "Synthetic native scope registry control only", reviewedBasis: "FOUNDER_APPROVED_LEGAL_REVIEW" });
  await prisma.policyVersion.create({ data: { id, kind: "MARKET", status, countryCodes: [country], content, evidenceAssetId: asset.id, reviewedBy: reviewer.user.id,
    reviewedAt, createdAt: new Date(reviewedAt.getTime() - 1000), expiresAt: new Date("2031-01-01T00:00:00.000Z") } });
  return { id, reviewer, country };
}
async function policyControl(p: Awaited<ReturnType<typeof policy>>, campaignId: string) {
  const requirements = CampaignRequirementsSchema.parse({ ...campaignFields, campaignId, version: 1, marketCountryCodes: [p.country], brandCountryCode: "KW", mandatoryPolicyVersionIds: [] });
  const review = await prisma.$transaction(tx => resolveCampaignPolicyReview(tx, requirements, new Date()));
  expect(review?.reviewed === true && review.mandatoryPolicyVersionIds.includes(p.id)).toBe(true);
}
beforeAll(async () => {
  const taskId = process.env.INFAME_TASK_ID;
  if (!taskId || !/^infame_[a-f0-9]{12}$/.test(taskId) || process.env.INFAME_ENV !== "test" || process.env.NODE_ENV === "production") throw new Error("Native campaign scope requires guarded test task");
  const rows = await prisma.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]?.id !== taskId || rows[0]?.kind !== "test" || rows[0]?.db !== taskId + "_test" || rows[0]?.host !== "127.0.0.1") throw new Error("Native campaign scope disposable identity mismatch");
});
afterEach(async () => {
  const workspaceIds = (await prisma.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } })).map(row => row.id);
  if (workspaceIds.length) {
    for (const table of ["PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission", "CampaignBriefProvenance", "CampaignProposalDependency",
      "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding", "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const)
      await prisma.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join(workspaceIds)})`);
    await prisma.planningWorkspace.deleteMany({ where: { id: { in: workspaceIds } } });
  }
  await prisma.campaign.deleteMany({ where: { id: { in: [...campaigns] } } });
  await prisma.organizationCommand.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await prisma.clientGrant.deleteMany({ where: { organizationId: { in: [...orgs] } } }); await prisma.organizationClient.deleteMany({ where: { organizationId: { in: [...orgs] } } });
  await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: [...orgs] } } }); await prisma.organization.deleteMany({ where: { id: { in: [...orgs] } } });
  await prisma.policyVersion.deleteMany({ where: { id: { in: [...policies] } } }); await prisma.privateAsset.deleteMany({ where: { id: { in: [...assets] } } });
  await prisma.brand.deleteMany({ where: { id: { in: [...brands] } } }); await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
  if (users.size) await prisma.outboxEvent.deleteMany({ where: { OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await prisma.authSession.deleteMany({ where: { userId: { in: [...users] } } }); await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
  for (const set of [users, brands, orgs, campaigns, policies, assets]) set.clear(); for (const db of peers) await db.$disconnect(); peers.clear();
});

describe("S1b metadata-only campaign proofs in the native ledger frame", () => {
  it("binds native OWN/CLIENT NONE and approved metadata, freezes exact fields and denies unbound/wrong-scope/copied/closed proofs without creation or bodies", async () => {
    const f = await company(), none = await made(f, f.scope), source = await approved(f), selected = await made(f, f.scope, source.choice), observer = observedDb();
    expect((await resolveSession(f.token))?.userId).toBe(f.user.id);
    // First valid M03-owned fixture reaches the new, initially absent capture.
    const capture = await captured(f, f.scope, [none, selected], observer), expected = await metadata(capture.capture); thin(observer);
    let oldFrame!: AiPlanningNativeFrame, oldProof!: PlanningBoundScopeProof, oldBrandProof!: BrandContextPlanningProof;
    const result = await ledger(observer.db).withPlanningActorTransaction(f.actor, async () => ({ ownerIds: capture.brand.ownerIds, reviewerIds: capture.capture.reviewerIds }), async frame => {
      oldFrame = frame; oldBrandProof = await brandContextScopeInternals.bindPlanningInFrame(frame, capture.brand, capture.call.checkpoint);
      oldProof = await planningScopeInternals.preparePlanningInFrame(frame, oldBrandProof, capture.call, capture.capture);
      const view = await planningScopeInternals.readPlanningProof(frame, oldProof), brand = await brandContextScopeInternals.readPlanningProof(frame, oldBrandProof); privateSafe(view, [f]);
      expect(view).toEqual({ ...brand, ...expected }); expect(Object.isFrozen(view) && Object.isFrozen(view.versions) && Object.isFrozen(view.versions[0])).toBe(true);
      expect(view.selections.find(row => row.campaignId === none)?.contextVersionId === null).toBe(true); expect(view.versions.length).toBe(1);
      for (const fake of [{}, { ...oldProof }, view]) expect(await observe(() => planningScopeInternals.readPlanningProof(frame, fake as unknown as PlanningBoundScopeProof))).toEqual(unavailable);
      await planningScopeInternals.recheckPlanningProof(frame, oldProof); return { bound: true };
    }); expect(result.executionClaim === null).toBe(true); thin(observer); await closed(oldFrame, oldProof);
    await ledger(observer.db).withPlanningActorTransaction(f.actor, async () => ({ ownerIds: capture.brand.ownerIds, reviewerIds: capture.capture.reviewerIds }), async frame => {
      expect(await observe(() => planningScopeInternals.readPlanningProof(frame, oldProof))).toEqual(unavailable); return true;
    });
    const noneCapture = await captured(f, f.scope, [none], observer), noneResult = await run(f, noneCapture, observer);
    expect(noneResult.executionClaim === null).toBe(true); privateSafe(noneResult.value, [f]);
    expect([noneResult.value.contexts.length, noneResult.value.versions.length, noneResult.value.submissions.length]).toEqual([0, 0, 0]);
    const a = await agency(f), clientCampaign = await made(a.seat, a.scope), clientCapture = await captured(a.seat, a.scope, [clientCampaign], observer);
    observer.clear(); const clientResult = await run(a.seat, clientCapture, observer); expect(clientResult.executionClaim === null).toBe(true); privateSafe(clientResult.value, [a.seat]); thin(observer);
    expect(clientResult.value.scope).toEqual(a.scope); expect(clientResult.value.currentAuthority?.capability).toBe("plan"); expect(clientResult.value.viewAuthority?.capability).toBe("view");
    const legacy = await createCampaign(f.user.id, { operationKey: randomUUID(), fields: campaignFields }, prisma, f.actor); campaigns.add(legacy.campaign.id);
    const before = await prisma.planningWorkspace.count({ where: { brandId: f.brand.id } });
    const call = await beginPlanningCall(f.actor, { client: observer.db });
    for (const ids of [[legacy.campaign.id], [clientCampaign], [randomUUID()]]) expect(await observe(() => planningScopeInternals.capturePlanningIdentity(call, f.scope, ids))).toEqual(missing);
    expect(await prisma.planningWorkspace.count({ where: { brandId: f.brand.id } })).toBe(before); thin(observer);
  }, 60000);

  it("reloads immutable Version pins after an actual wait, refuses current-selection replacement without late IDs and preserves mandatory logical reviewers", async () => {
    const f = await company(), first = await approved(f), second = await approved(f), campaignId = await made(f, f.scope, first.choice), observer = observedDb();
    const cap = await captured(f, f.scope, [campaignId], observer), versionWait = await hold("BrandContextVersion", first.version.id); observer.clear(); let pending: Promise<unknown> | undefined;
    try {
      pending = ledger(observer.db).withPlanningActorTransaction(f.actor, async () => ({ ownerIds: cap.brand.ownerIds, reviewerIds: cap.capture.reviewerIds }), async frame => {
        const brandProof = await brandContextScopeInternals.bindPlanningInFrame(frame, cap.brand, cap.call.checkpoint);
        const proof = await planningScopeInternals.preparePlanningInFrame(frame, brandProof, cap.call, cap.capture);
        const locks = observer.queries.findIndex(query => query.includes('"BrandContextVersion"') && /FOR SHARE/.test(query));
        expect(locks >= 0).toBe(true); expect(observer.queries.slice(locks + 1).some(query => /\bSELECT\b/.test(query) && query.includes('"BrandContextVersion"') && !/FOR SHARE/.test(query))).toBe(true);
        const view = await planningScopeInternals.readPlanningProof(frame, proof); privateSafe(view, [f]); expect(view.versions[0]?.id).toBe(first.version.id); return true;
      }); void pending.catch(() => {}); await blockedBy(versionWait.pid, "BrandContextVersion"); versionWait.release(); await versionWait.done; await pending; thin(observer);
    } finally { versionWait.release(); await versionWait.done; await pending?.catch(() => {}); }
    const state = await prisma.campaignPlanningState.findUniqueOrThrow({ where: { campaignId } }), replacementId = randomUUID();
    const drift = await captured(f, f.scope, [campaignId], observer), workspaceWait = await hold("PlanningWorkspace", drift.capture.workspace.id, async tx => {
      await selection(tx, campaignId, state.workspaceId, state.selectionRevision, { versionId: second.version.id, contentHash: second.version.contentHash }, replacementId);
    }); observer.clear(); let rejected: Promise<Awaited<ReturnType<typeof observe>>> | undefined;
    try {
      rejected = observe(() => run(f, drift, observer)); await blockedBy(workspaceWait.pid, "PlanningWorkspace"); workspaceWait.release(); await workspaceWait.done;
      expect(await rejected).toEqual(retry); expect(observer.lockedIds.includes(replacementId) || observer.lockedIds.includes(second.version.id) || observer.lockedIds.includes(second.contextId)).toBe(false); thin(observer);
    } finally { workspaceWait.release(); await workspaceWait.done; await rejected; }
    const reviewer = await policy(); await policyControl(reviewer, campaignId);
    const overlap = await captured(f, f.scope, [campaignId], observer);
    expect(overlap.capture.reviewerIds.includes(reviewer.reviewer.user.id)).toBe(true);
    const overlapResult = await run(f, overlap, observer, [reviewer.reviewer.user.id]); expect(overlapResult.executionClaim === null).toBe(true);
    expect(overlapResult.value.policyReviewerIds.includes(reviewer.reviewer.user.id)).toBe(true);
    const added = await policy("PENDING", "TV"), old = await captured(f, f.scope, [campaignId], observer); let promoted = false;
    expect(old.capture.reviewerIds.includes(added.reviewer.user.id)).toBe(false);
    expect(await observe(() => ledger(observer.db).withPlanningActorTransaction(f.actor,
      async () => ({ ownerIds: [...old.brand.ownerIds, added.reviewer.user.id], reviewerIds: old.capture.reviewerIds }), async frame => {
        const brandProof = await brandContextScopeInternals.bindPlanningInFrame(frame, old.brand, old.call.checkpoint), base = await readAiPlanningNativeFrame(frame);
        expect(base.ownerIds.includes(added.reviewer.user.id)).toBe(true);
        await base.tx.policyVersion.update({ where: { id: added.id }, data: { status: "VERIFIED" } }); promoted = true;
        return planningScopeInternals.preparePlanningInFrame(frame, brandProof, old.call, old.capture);
      }))).toEqual(retry); expect(promoted).toBe(true);
    expect((await prisma.policyVersion.findUniqueOrThrow({ where: { id: added.id }, select: { status: true } })).status).toBe("PENDING");
    await prisma.policyVersion.update({ where: { id: added.id }, data: { status: "VERIFIED" } }); await policyControl(added, campaignId);
  }, 60000);

  it("retains approved pins across an unapproved draft edit, rechecks selection epochs without locks, rolls back work and gives native frame/expiry priority over malformed capture", async () => {
    const f = await company(), source = await approved(f), campaignId = await made(f, f.scope, source.choice), observer = observedDb();
    const edit = await captured(f, f.scope, [campaignId], observer);
    const retained = await ledger(observer.db).withPlanningActorTransaction(f.actor, async () => ({ ownerIds: edit.brand.ownerIds, reviewerIds: edit.capture.reviewerIds }), async frame => {
      const brandProof = await brandContextScopeInternals.bindPlanningInFrame(frame, edit.brand, edit.call.checkpoint), proof = await planningScopeInternals.preparePlanningInFrame(frame, brandProof, edit.call, edit.capture);
      const base = await readAiPlanningNativeFrame(frame);
      const parent = await base.tx.brandContext.findUniqueOrThrow({ where: { id: source.contextId }, select: { revision: true } });
      await base.tx.brandContext.update({ where: { id: source.contextId }, data: { revision: parent.revision + 1, inputRevision: parent.revision + 1,
        content: { ...content, positioning: { text: "Synthetic changed unapproved draft", language: "en" } }, updatedAt: new Date() } });
      observer.clear(); await planningScopeInternals.recheckPlanningProof(frame, proof);
      expect(observer.queries.some(query => /FOR\s+(UPDATE|SHARE)/.test(query))).toBe(false);
      return planningScopeInternals.readPlanningProof(frame, proof);
    }); expect(retained.executionClaim === null).toBe(true); privateSafe(retained.value, [f]);
    expect(retained.value.versions[0]?.contentHash).toBe(source.version.contentHash);
    const current = await captured(f, f.scope, [campaignId], observer), replacement = randomUUID();
    const before = hash(JSON.stringify(await prisma.campaignPlanningState.findUniqueOrThrow({ where: { campaignId } })));
    let savedFrame!: AiPlanningNativeFrame, savedProof!: PlanningBoundScopeProof, savedBrand!: BrandContextPlanningProof, changed = false, recheckFailure: Awaited<ReturnType<typeof observe>> | undefined;
    expect(await observe(() => ledger(observer.db).withPlanningActorTransaction(f.actor, async () => ({ ownerIds: current.brand.ownerIds, reviewerIds: current.capture.reviewerIds }), async frame => {
      savedFrame = frame; savedBrand = await brandContextScopeInternals.bindPlanningInFrame(frame, current.brand, current.call.checkpoint);
      savedProof = await planningScopeInternals.preparePlanningInFrame(frame, savedBrand, current.call, current.capture); const base = await readAiPlanningNativeFrame(frame);
      await selection(base.tx, campaignId, current.capture.workspace.id, current.capture.states[0]!.selectionRevision, null, replacement); changed = true; observer.clear();
      try { await planningScopeInternals.recheckPlanningProof(frame, savedProof); }
      catch (error) { const safe = error as { code?: string; status?: number }; recheckFailure = { accepted: false, code: safe.code ?? "OTHER_ERROR", status: safe.status ?? 0 }; throw error; }
      return true;
    }))).toEqual(retry); expect(changed).toBe(true); expect(recheckFailure).toEqual(retry);
    expect(observer.queries.some(query => /FOR\s+(UPDATE|SHARE)/.test(query))).toBe(false); expect(await prisma.campaignContextSelection.count({ where: { id: replacement } })).toBe(0);
    expect(hash(JSON.stringify(await prisma.campaignPlanningState.findUniqueOrThrow({ where: { campaignId } })))).toBe(before); await closed(savedFrame, savedProof);
    const malformed = { unexpected: true } as unknown as PlanningNativeScopeCapture;
    expect(await observe(() => planningScopeInternals.preparePlanningInFrame({} as AiPlanningNativeFrame, savedBrand, current.call, malformed))).toEqual(baseUnavailable);
    expect(await observe(() => planningScopeInternals.preparePlanningInFrame(savedFrame, savedBrand, current.call, malformed))).toEqual(baseUnavailable);
    await ledger(observer.db).withPlanningActorTransaction(f.actor, async () => ({ ownerIds: current.brand.ownerIds, reviewerIds: current.capture.reviewerIds }), async frame => {
      const proof = await brandContextScopeInternals.bindPlanningInFrame(frame, current.brand, current.call.checkpoint);
      expect(await observe(() => planningScopeInternals.preparePlanningInFrame(frame, proof, current.call, malformed))).toEqual(invalid);
      const valid = await planningScopeInternals.preparePlanningInFrame(frame, proof, current.call, current.capture); await planningScopeInternals.recheckPlanningProof(frame, valid); return true;
    });
    const nameBefore = hash((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id }, select: { name: true } })).name), expiresAt = new Date(Date.now() + 3000);
    await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { expiresAt } }); let entered = false;
    expect(await observe(() => ledger(observer.db).withPlanningActorTransaction(f.actor, async () => ({ ownerIds: current.brand.ownerIds, reviewerIds: current.capture.reviewerIds }), async frame => {
      const brandProof = await brandContextScopeInternals.bindPlanningInFrame(frame, current.brand, current.call.checkpoint), base = await readAiPlanningNativeFrame(frame);
      await base.tx.user.update({ where: { id: f.user.id }, data: { name: "Synthetic expiry rollback work" } }); entered = true;
      expect(Date.now() < expiresAt.getTime()).toBe(true); await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 40)));
      return planningScopeInternals.preparePlanningInFrame(frame, brandProof, current.call, malformed);
    }))).toEqual(unauthorized); expect(entered).toBe(true);
    expect(hash((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id }, select: { name: true } })).name)).toBe(nameBefore); expect(await resolveSession(f.token) === null).toBe(true); thin(observer);
  }, 60000);
});
