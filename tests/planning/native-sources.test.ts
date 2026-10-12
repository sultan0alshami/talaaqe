// S2 preparation: exactly three native groups, root alone adopts/runs.
// Genuine M03/agent producers and native sessions; no provider, fake authority,
// immutable-record UPDATE, trigger bypass, reset or registered-test imports.
import { randomUUID, createHash } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { canonicalHash, inputJson } from "@/lib/onboarding/drafts";
import { captureOrganizationActor } from "@/lib/organizations/context";
import { acceptMembership, authorizeClientAssociation, createOrganization, proposeClientAssociation, proposeMember, setClientGrant } from "@/lib/organizations/service";
import { getClientAuthority } from "@/lib/organizations/loaders";
import { BrandContextContentSchema, type PlanningScope } from "@/lib/brand-context/contracts";
import { decideContextOwnerReview, executeBrandContextCommand, getApprovedBrandContextVersion } from "@/lib/brand-context/service";
import { brandContextScopeInternals } from "@/lib/brand-context/scope";
import { executeCampaignPlanningCommand, getPlanningCampaign } from "@/lib/campaign-planning/service";
import { beginPlanningCall, planningScopeInternals, type PlanningBoundScopeProof } from "@/lib/campaign-planning/scope";
import { createAiBudgetLedger, readAiPlanningNativeFrame, type AiPlanningNativeFrame } from "@/lib/ai-budget/ledger";
import { executeCampaignAgentCommand, getCampaignAgent, getCampaignAgentTextSources } from "@/lib/campaign-agent/service";
import { CampaignAgentFieldKeys, CampaignAgentStateSchema, CustomerTextSourceSchema, type AgentBinding, type AgentSnapshot, type CampaignAgentState, type CustomerTextSource } from "@/lib/campaign-agent/contracts";
import { CampaignAgentBatchSchema, type CampaignAgentBatch } from "@/lib/campaign-agent/native-contracts";
import { CampaignFieldsSchema, type CampaignDraftFields } from "@/lib/campaigns/contracts";
import { campaignFields } from "../campaigns/fixtures";

const users = new Set<string>(), brands = new Set<string>(), orgs = new Set<string>(), campaigns = new Set<string>(), peers = new Set<PrismaClient>();
const preferences = { input: "TEXT" as const, output: "TEXT" as const }, form = { channel: "FORM" as const };
const privateProfile = "unrequested-private-brand-profile-canary", contextWords = "approved-original-context-source-canary";
const capabilities = { view: true, plan: true, approveShortlist: false, reviewContent: false, signCustomer: false, financial: false, manageGrants: false };
const contextContent = BrandContextContentSchema.parse({ schemaVersion: 1, positioning: { text: "  " + contextWords + "\nتموضع أصلي  ", language: "ar" },
  values: [], tone: { text: "Approved original tone", language: "en" }, references: [], competitors: [] });
type SourceRef = { id: string; sourceHash: string };
type SourceProof = object;
type Material = { binding: AgentBinding; current: { snapshot: AgentSnapshot; fields: CampaignDraftFields }; agent: { id: string; revision: number; stateHash: string };
  preferences: CampaignAgentState["preferences"]; coverage: "UNCONFIRMED" | "CURRENT" | "STALE"; sources: CustomerTextSource[]; confirmation: CampaignAgentBatch | null; context: unknown | null };
type SourceBag = { bindSourcesInFrame(frame: AiPlanningNativeFrame, proof: PlanningBoundScopeProof, input: { campaignId: string; sourceReferences: SourceRef[] }): Promise<SourceProof>;
  readSourcesProof(frame: AiPlanningNativeFrame, proof: unknown): Promise<Readonly<Material>>; recheckSourcesProof(frame: AiPlanningNativeFrame, proof: unknown): Promise<void> };
// Resolve only AFTER each real fixture exists. A missing new module becomes the
// intended missing-binder failure inside the native frame, never collection RED.
async function sourceBag(): Promise<SourceBag> {
  const modulePath = "@/lib/campaign-agent/planning-source";
  const loaded = await import(modulePath).catch(() => undefined) as { campaignAgentPlanningInternals?: SourceBag } | undefined;
  return loaded?.campaignAgentPlanningInternals as SourceBag;
}
async function person() {
  const id = randomUUID(); users.add(id);
  const user = await prisma.user.create({ data: { id, role: "BRAND", active: true, isTest: true, name: "Synthetic native source actor", email: id + "@example.invalid",
    passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  const token = await openSession(id, user.sessionVersion, user.passwordHash), current = await resolveSession(token);
  if (!current) throw new Error("Owned actual source session did not resolve"); return { user, token, actor: captureOrganizationActor(current) };
}
type Actor = Awaited<ReturnType<typeof person>>;
async function company() {
  const own = await person(), brand = await prisma.brand.create({ data: { userId: own.user.id, slug: "nss-" + randomUUID(), name: privateProfile,
    description: privateProfile, countryCode: "KW", isTest: true } }); brands.add(brand.id);
  return { ...own, brand, scope: { kind: "OWN_BRAND", brandId: brand.id } as PlanningScope };
}
type Company = Awaited<ReturnType<typeof company>>;
async function agency(customer: Company) {
  const owner = await person(), seat = await person(), organization = (await createOrganization(owner.actor, { operationKey: randomUUID(), nameOriginal: "وكالة أصلية لاختبار المصادر", kind: "AGENCY" })).organization; orgs.add(organization.id);
  const revision = async () => (await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).revision;
  const pending = (await proposeClientAssociation(owner.actor, organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: await revision(), brandId: customer.brand.id })).client;
  const client = (await authorizeClientAssociation(customer.actor, pending.id, { operationKey: randomUUID(), expectedRevision: pending.revision, capabilities })).client;
  const proposal = (await proposeMember(owner.actor, organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: await revision(), targetUserId: seat.user.id })).membership;
  const membership = (await acceptMembership(seat.actor, proposal.id, { operationKey: randomUUID(), expectedRevision: proposal.revision })).membership;
  await setClientGrant(customer.actor, client.id, { operationKey: randomUUID(), expectedClientRevision: client.revision, membershipId: membership.id, expectedGrantRevision: null, capabilities });
  return { owner, seat, scope: { kind: "CLIENT", clientId: client.id } as PlanningScope };
}
async function expected(actor: Actor, scope: PlanningScope) { return scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(actor.actor, scope.clientId, "plan") } : {}; }
async function approved(owner: Company) {
  const made = await executeBrandContextCommand(owner.actor, { operationKey: randomUUID(), scope: owner.scope, action: "CREATE", expectedRevision: 0,
    payload: { nameOriginal: { text: "Approved original source name", language: "en" }, content: contextContent } });
  const submitted = await executeBrandContextCommand(owner.actor, { operationKey: randomUUID(), scope: owner.scope, contextId: made.contextId, expectedRevision: made.revision, action: "SUBMIT", payload: {} });
  const accepted = await decideContextOwnerReview(owner.actor, { operationKey: randomUUID(), submissionId: submitted.submissionId!, expectedRevision: 1, decision: "APPROVE" });
  const value = await getApprovedBrandContextVersion(owner.actor, { scope: owner.scope, versionId: accepted.versionId! });
  return { contextId: made.contextId, version: value.version, choice: { kind: "APPROVED_CONTEXT" as const, versionId: value.version.id, contentHash: value.version.contentHash } };
}
async function campaign(actor: Actor, scope: PlanningScope, selection: unknown = { kind: "NONE" }) {
  const result = await executeCampaignPlanningCommand(actor.actor, { operationKey: randomUUID(), scope, ...await expected(actor, scope), action: "CREATE", expectedCampaignRevision: 0,
    expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0, payload: { fields: campaignFields, selection, narrative: null } });
  campaigns.add(result.campaignId); return result.campaignId;
}
async function agentStep(actor: Actor, scope: PlanningScope, campaignId: string, action: string, payload: unknown) {
  const view = await getCampaignAgent(actor.actor, { scope, campaignId });
  return executeCampaignAgentCommand(actor.actor, { operationKey: randomUUID(), scope, campaignId, ...await expected(actor, scope), action,
    expectedAgentRevision: view.retained?.revision ?? 0, expectedSnapshot: view.current.snapshot, payload }, form);
}
async function interviewed(actor: Actor, scope: PlanningScope, selection: unknown = { kind: "NONE" }, confirmed = true) {
  const campaignId = await campaign(actor, scope, selection); await agentStep(actor, scope, campaignId, "INITIALIZE", { preferences });
  await agentStep(actor, scope, campaignId, "APPEND_TEXT", { originalText: { text: "  REQUESTED_ORIGINAL_" + randomUUID() + "\nكلمات أصلية  ", language: "ar" } });
  await agentStep(actor, scope, campaignId, "APPEND_TEXT", { originalText: { text: "UNREQUESTED_RETAINED_" + randomUUID(), language: "en" } });
  const sources = (await getCampaignAgentTextSources(actor.actor, { scope, campaignId })).sources;
  if (sources.length !== 2) throw new Error("Actual owned source producer fixture missing");
  const refs = sources.map(value => ({ id: value.id, sourceHash: value.sourceHash })).sort((a, b) => a.id < b.id ? -1 : 1);
  if (confirmed) {
    const view = await getCampaignAgent(actor.actor, { scope, campaignId }), fields = CampaignFieldsSchema.parse(view.current.fields);
    const choices = CampaignAgentFieldKeys.map(field => { const valueHash = canonicalHash({ domain: "infame-campaign-field-value-v1", field, value: fields[field] });
      return { field, valueHash, source: field === "title" ? { kind: "CUSTOMER_TEXT", references: refs } : { kind: "CUSTOMER_FIELD_CHOICE", capturedValueHash: valueHash } }; });
    await agentStep(actor, scope, campaignId, "CONFIRM_FIELDS", { fields: choices });
  }
  const view = await getCampaignAgent(actor.actor, { scope, campaignId });
  if (!view.retained) throw new Error("Actual initialized agent missing");
  return { actor, scope, campaignId, sources, refs, view };
}
type Interview = Awaited<ReturnType<typeof interviewed>>;
function observedDb() {
  const queries: string[] = [], sourceBodyIds: string[] = [], agentBodyIds: string[] = [];
  const db = new PrismaClient({ log: [{ emit: "event", level: "query" }] }); peers.add(db);
  db.$on("query", event => {
    queries.push(event.query);
    const source = /\bSELECT\b/.test(event.query) && event.query.includes('"CampaignAgentTextSource"') && event.query.includes('"content"');
    const agent = /\bSELECT\b/.test(event.query) && event.query.includes('"CampaignAgent"') && event.query.includes('"state"');
    if (source || agent) { const values: unknown = JSON.parse(event.params); if (Array.isArray(values)) for (const value of values) if (typeof value === "string") (source ? sourceBodyIds : agentBodyIds).push(value); }
  });
  return { db, queries, sourceBodyIds, agentBodyIds, clear: () => { queries.length = 0; sourceBodyIds.length = 0; agentBodyIds.length = 0; } };
}
type Observer = ReturnType<typeof observedDb>;
function ledger(db: PrismaClient) { return createAiBudgetLedger({ client: db, caps: { userDailyMicros: "1000000", platformDailyMicros: "1000000000" } }); }
async function captured(f: Interview, observer: Observer) {
  const call = await beginPlanningCall(f.actor.actor, { client: observer.db }), brand = await brandContextScopeInternals.capturePlanningIdentity(call, f.scope);
  const capture = await planningScopeInternals.capturePlanningIdentity(call, f.scope, [f.campaignId]); return { call, brand, capture };
}
type Capture = Awaited<ReturnType<typeof captured>>;
async function frame<T>(f: Interview, c: Capture, observer: Observer, work: (native: AiPlanningNativeFrame, scope: PlanningBoundScopeProof) => Promise<T>) {
  return ledger(observer.db).withPlanningActorTransaction(f.actor.actor, async () => ({ ownerIds: c.brand.ownerIds, reviewerIds: c.capture.reviewerIds }), async native => {
    const brandProof = await brandContextScopeInternals.bindPlanningInFrame(native, c.brand, c.call.checkpoint);
    const scopeProof = await planningScopeInternals.preparePlanningInFrame(native, brandProof, c.call, c.capture); return work(native, scopeProof);
  });
}
const unavailable = { accepted: false, code: "SCOPE_PROOF_UNAVAILABLE", status: 503 }, baseUnavailable = { accepted: false, code: "PLANNING_FRAME_UNAVAILABLE", status: 503 };
const retry = { accepted: false, code: "RETRY_REQUIRED", status: 503 }, corrupt = { accepted: false, code: "INVALID_STORED_AGENT", status: 503 };
const validation = { accepted: false, code: "VALIDATION", status: 422 }, unauthorized = { accepted: false, code: "UNAUTHENTICATED", status: 401 };
async function observe(work: () => Promise<unknown>) {
  try { await work(); return { accepted: true, code: "ACCEPTED", status: 200 }; }
  catch (error) { const safe = error as { code?: string; status?: number }; return { accepted: false, code: safe.code ?? "OTHER_ERROR", status: safe.status ?? 0 }; }
}
function projection(value: unknown, actors: Actor[]) {
  const json = JSON.stringify(value);
  for (const secret of [privateProfile, ...actors.flatMap(actor => [actor.token, actor.actor.sessionId])]) expect(json.includes(secret)).toBe(false);
  for (const field of ["sessionId", "executionToken", "client", "options", "reader", "conversation", "narrative", "proposals", "contactName"]) expect(json.includes('"' + field + '"')).toBe(false);
}
async function closed(bag: SourceBag, native: AiPlanningNativeFrame, proof: SourceProof) {
  expect(await observe(() => bag.readSourcesProof(native, proof))).toEqual(baseUnavailable); expect(await observe(() => bag.recheckSourcesProof(native, proof))).toEqual(baseUnavailable);
}
async function image(campaignId: string) {
  const agent = await prisma.campaignAgent.findUnique({ where: { campaignId } }), campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  const sources = await prisma.campaignAgentTextSource.findMany({ where: { campaignId }, orderBy: { id: "asc" } });
  const batches = await prisma.campaignAgentConfirmationBatch.findMany({ where: { campaignId }, orderBy: { id: "asc" } });
  return createHash("sha256").update(JSON.stringify({ agent, campaign, sources, batches })).digest("hex");
}
async function mutateAgent(tx: Prisma.TransactionClient, campaignId: string, malformed = false) {
  const row = await tx.campaignAgent.findUniqueOrThrow({ where: { campaignId } }), prior = CampaignAgentStateSchema.parse(row.state), date = new Date();
  const value = { ...prior, revision: row.revision + 1, updatedAt: date.toISOString(), preferences: { input: "TEXT" as const, output: "TEXT_AND_VOICE" as const },
    ...(malformed ? { snapshot: { ...prior.snapshot, fieldsHash: "f".repeat(64) } } : {}) };
  const { stateHash: oldHash, ...body } = value; void oldHash;
  const state = { ...body, stateHash: canonicalHash({ domain: "infame-campaign-agent-state-v1", ...body }) };
  await tx.campaignAgent.update({ where: { id: row.id }, data: { revision: state.revision, state: inputJson(state), stateHash: state.stateHash, updatedAt: date } });
}
async function reviseAgent(tx: Prisma.TransactionClient, campaignId: string, patch: (state: CampaignAgentState) => CampaignAgentState) {
  const row = await tx.campaignAgent.findUniqueOrThrow({ where: { campaignId } }), date = new Date();
  const { stateHash: previousHash, ...body } = { ...patch(CampaignAgentStateSchema.parse(row.state)), revision: row.revision + 1, updatedAt: date.toISOString() }; void previousHash;
  const state = CampaignAgentStateSchema.parse({ ...body, stateHash: canonicalHash({ domain: "infame-campaign-agent-state-v1", ...body }) });
  await tx.campaignAgent.update({ where: { id: row.id }, data: { revision: state.revision, state: inputJson(state), stateHash: state.stateHash, updatedAt: date } });
}
function confirmationHash(value: CampaignAgentBatch["confirmations"][number]) {
  const { confirmationHash: previous, value: duplicate, ...body } = value; void previous; void duplicate;
  return canonicalHash({ domain: "infame-field-confirmation-v1", ...body });
}
function batchHash(value: CampaignAgentBatch) {
  const { contentHash: previous, ...body } = value; void previous;
  return canonicalHash({ domain: "infame-campaign-confirmation-batch-v1", ...body });
}
function latch() { let release!: () => void; return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() }; }
async function hold(table: "CampaignAgent" | "CampaignAgentTextSource" | "CampaignAgentConfirmationBatch", id: string, mutation: (tx: Prisma.TransactionClient) => Promise<void> = async () => {}) {
  const db = new PrismaClient(); peers.add(db); const ready = latch(), release = latch(); let pid = 0;
  const done = db.$transaction(async tx => {
    pid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`)[0]!.pid;
    await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw('"' + table + '"')} WHERE id=${id} FOR UPDATE`); ready.release(); await release.promise; await mutation(tx);
  }, { maxWait: 10000, timeout: 15000 }); void done.catch(() => {}); await ready.promise; return { pid, release: release.release, done };
}
async function blockedBy(pid: number, table: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { const rows = await prisma.$queryRaw<Array<{ pid: number }>>`SELECT a.pid::int AS pid FROM pg_stat_activity a WHERE a.datname=current_database() AND a.wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(a.pid)) AND a.query LIKE ${'%"' + table + '"%'}`;
    if (rows.length) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error("Native source witness did not reach its actual row wait");
}
beforeAll(async () => {
  const taskId = process.env.INFAME_TASK_ID;
  if (!taskId || !/^infame_[a-f0-9]{12}$/.test(taskId) || process.env.INFAME_ENV !== "test" || process.env.NODE_ENV === "production") throw new Error("Native sources require guarded test task");
  const rows = await prisma.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]?.id !== taskId || rows[0]?.kind !== "test" || rows[0]?.db !== taskId + "_test" || rows[0]?.host !== "127.0.0.1") throw new Error("Native source target identity mismatch");
});
afterEach(async () => {
  if (campaigns.size) for (const table of ["CampaignAgentCommand", "CampaignAgentConfirmationBatch", "CampaignAgentTextSource", "CampaignAgent"] as const)
    await prisma.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "campaignId" IN (${Prisma.join([...campaigns])})`);
  const ids = (await prisma.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } })).map(row => row.id);
  if (ids.length) { for (const table of ["PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission", "CampaignBriefProvenance", "CampaignProposalDependency", "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding", "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const)
      await prisma.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join(ids)})`); await prisma.planningWorkspace.deleteMany({ where: { id: { in: ids } } }); }
  await prisma.campaign.deleteMany({ where: { id: { in: [...campaigns] } } }); await prisma.organizationCommand.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await prisma.clientGrant.deleteMany({ where: { organizationId: { in: [...orgs] } } }); await prisma.organizationClient.deleteMany({ where: { organizationId: { in: [...orgs] } } });
  await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: [...orgs] } } }); await prisma.organization.deleteMany({ where: { id: { in: [...orgs] } } });
  await prisma.brand.deleteMany({ where: { id: { in: [...brands] } } }); await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
  if (users.size) await prisma.outboxEvent.deleteMany({ where: { OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await prisma.authSession.deleteMany({ where: { userId: { in: [...users] } } }); await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
  for (const set of [users, brands, orgs, campaigns]) set.clear(); for (const db of peers) await db.$disconnect(); peers.clear();
});

describe("S2 genuine planning source hydration", () => {
  it("hydrates exact native complete review, requested original text and approved context without exposing unrequested bodies or granting approval", async () => {
    const owner = await company(), context = await approved(owner), f = await interviewed(owner, owner.scope, context.choice), observer = observedDb(), c = await captured(f, observer);
    expect((await resolveSession(owner.token))?.userId).toBe(owner.user.id); const bag = await sourceBag();
    let savedFrame!: AiPlanningNativeFrame, savedProof!: SourceProof;
    const before = await image(f.campaignId), expectedBatch = CampaignAgentBatchSchema.parse((await prisma.campaignAgentConfirmationBatch.findUniqueOrThrow({ where: { id: f.view.retained!.confirmation.kind === "REVIEWED_SET" ? f.view.retained!.confirmation.confirmationBatchId : "missing" } })).content);
    // New module lookup happens only after all genuine native producers above.
    const result = await frame(f, c, observer, async (native, scope) => {
      savedFrame = native; savedProof = await bag.bindSourcesInFrame(native, scope, { campaignId: f.campaignId, sourceReferences: [f.refs[0]!] });
      const material = await bag.readSourcesProof(native, savedProof); projection(material, [owner]);
      expect(Object.keys(material).sort()).toEqual(["agent", "binding", "confirmation", "context", "coverage", "current", "preferences", "sources"].sort());
      expect(material.coverage).toBe("CURRENT"); expect(material.sources.length).toBe(1); expect(material.confirmation?.confirmations.length).toBe(30);
      expect(canonicalHash(material.current.fields)).toBe(canonicalHash(CampaignFieldsSchema.parse(campaignFields))); expect(canonicalHash(material.current.snapshot)).toBe(canonicalHash(f.view.current.snapshot));
      expect(canonicalHash(material.confirmation)).toBe(canonicalHash(expectedBatch)); expect(canonicalHash(material.context)).toBe(canonicalHash(context.version));
      const source = f.sources.find(value => value.id === f.refs[0]!.id)!;
      expect(canonicalHash(material.sources[0])).toBe(canonicalHash(source)); expect(material.sources[0]?.originalText.text === source.originalText.text).toBe(true);
      const hidden = f.sources.find(value => value.id !== source.id)!; expect(JSON.stringify(material).includes(hidden.originalText.text)).toBe(false);
      expect(Object.isFrozen(material) && Object.isFrozen(material.sources) && Object.isFrozen(material.confirmation?.confirmations)).toBe(true);
      for (const fake of [{}, { ...savedProof }, material]) expect(await observe(() => bag.readSourcesProof(native, fake))).toEqual(unavailable);
      await bag.recheckSourcesProof(native, savedProof); return { read: true };
    }); expect(result.executionClaim === null).toBe(true); expect(await image(f.campaignId)).toBe(before); await closed(bag, savedFrame, savedProof);
    await frame(f, c, observer, async native => { expect(await observe(() => bag.readSourcesProof(native, savedProof))).toEqual(unavailable); return true; });
    const a = await agency(owner), client = await interviewed(a.seat, a.scope), clientCapture = await captured(client, observer);
    const clientResult = await frame(client, clientCapture, observer, async (native, scope) => { const proof = await bag.bindSourcesInFrame(native, scope, { campaignId: client.campaignId, sourceReferences: [] });
      const material = await bag.readSourcesProof(native, proof); projection(material, [a.seat]); expect(material.context === null).toBe(true); expect(material.coverage).toBe("CURRENT"); expect(material.sources.length).toBe(0);
      await bag.recheckSourcesProof(native, proof); return true; }); expect(clientResult.executionClaim === null).toBe(true);
    const planning = await getPlanningCampaign(owner.actor, { scope: owner.scope, campaignId: f.campaignId });
    await executeCampaignPlanningCommand(owner.actor, { operationKey: randomUUID(), scope: owner.scope, campaignId: f.campaignId, action: "UPDATE_FIELDS",
      expectedCampaignRevision: planning.campaign.revision, expectedPlanningRevision: planning.planning.revision, expectedSelectionId: planning.planning.selection.id,
      expectedSelectionRevision: planning.planning.selection.revision, payload: { patch: { title: "Current changed original title" } } });
    const stale = await captured(f, observer); await frame(f, stale, observer, async (native, scope) => { const proof = await bag.bindSourcesInFrame(native, scope, { campaignId: f.campaignId, sourceReferences: [] });
      const material = await bag.readSourcesProof(native, proof); expect(material.coverage).toBe("STALE"); expect(material.confirmation === null).toBe(true); expect(material.current.fields.title === "Current changed original title").toBe(true); return true; });
  }, 60000);

  it("denies foreign or corrupt references before foreign bodies and refuses missing immutable lineage while rollback preserves genuine records", async () => {
    const owner = await company(), a = await agency(owner), b = await agency(owner), f = await interviewed(a.seat, a.scope), foreign = await interviewed(b.seat, b.scope);
    const observer = observedDb(), c = await captured(f, observer), bag = await sourceBag();
    await frame(f, c, observer, async (native, scope) => {
      observer.clear(); expect(await observe(() => bag.bindSourcesInFrame(native, scope, { campaignId: f.campaignId, sourceReferences: [foreign.refs[0]!] }))).toEqual(validation);
      expect(observer.sourceBodyIds.includes(foreign.refs[0]!.id)).toBe(false);
      expect(await observe(() => bag.bindSourcesInFrame(native, scope, { campaignId: foreign.campaignId, sourceReferences: foreign.refs.slice(0, 1) }))).toEqual({ accepted: false, code: "NOT_FOUND", status: 404 });
      expect(observer.agentBodyIds.includes(foreign.view.retained!.id) || observer.agentBodyIds.includes(foreign.campaignId)).toBe(false);
      expect(await observe(() => bag.bindSourcesInFrame(native, scope, { campaignId: f.campaignId, sourceReferences: [{ id: f.refs[0]!.id, sourceHash: "e".repeat(64) }] }))).toEqual(validation);
      const valid = await bag.bindSourcesInFrame(native, scope, { campaignId: f.campaignId, sourceReferences: [f.refs[0]!] }); await bag.recheckSourcesProof(native, valid); return true;
    });
    const original = await image(f.campaignId), batchId = f.view.retained!.confirmation.kind === "REVIEWED_SET" ? f.view.retained!.confirmation.confirmationBatchId : "missing";
    for (const table of ["CampaignAgentTextSource", "CampaignAgentConfirmationBatch"] as const) {
      let deleted = false;
      expect(await observe(() => frame(f, c, observer, async (native, scope) => {
        const base = await readAiPlanningNativeFrame(native); await base.tx.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE id=${table === "CampaignAgentTextSource" ? f.refs[0]!.id : batchId}`); deleted = true;
        return bag.bindSourcesInFrame(native, scope, { campaignId: f.campaignId, sourceReferences: [] });
      }))).toEqual(corrupt); expect(deleted).toBe(true); expect(await image(f.campaignId)).toBe(original);
    }
    let changed = false;
    expect(await observe(() => frame(f, c, observer, async (native, scope) => { const base = await readAiPlanningNativeFrame(native); await mutateAgent(base.tx, f.campaignId, true); changed = true;
      return bag.bindSourcesInFrame(native, scope, { campaignId: f.campaignId, sourceReferences: [] }); }))).toEqual(corrupt);
    expect(changed).toBe(true); expect(await image(f.campaignId)).toBe(original);
    // Adjacent controls copy actual producer envelopes into new owned records.
    // Every INSERT passes native scalar/binding/date guards; the original
    // immutable source/batch is never edited. The owner frame always rolls back.
    const rollback = Object.assign(new Error("SYNTHETIC_STORED_BODY_CONTROL"), { code: "SYNTHETIC_FIXTURE_ROLLBACK", status: 409 });
    for (const valid of [true, false]) {
      const sourceId = randomUUID(), produced = f.sources[0]!, { sourceHash: oldHash, ...sourceBody } = { ...produced, id: sourceId }; void oldHash;
      const goodHash = canonicalHash({ domain: "infame-customer-text-v1", ...sourceBody });
      const storedSource = { ...sourceBody, sourceHash: valid ? goodHash : produced.sourceHash }; let inserted = false, hydrated = false;
      expect(CustomerTextSourceSchema.safeParse(storedSource).success).toBe(valid);
      const outcome = await observe(() => frame(f, c, observer, async (native, scope) => {
        const base = await readAiPlanningNativeFrame(native);
        await base.tx.campaignAgentTextSource.create({ data: { id: sourceId, agentId: f.view.retained!.id, campaignId: f.campaignId,
          workspaceId: f.view.binding.workspaceId, authorUserId: produced.authorUserId, content: inputJson(storedSource), sourceHash: storedSource.sourceHash, createdAt: new Date(produced.createdAt) } });
        await reviseAgent(base.tx, f.campaignId, state => ({ ...state, textSourceReferences: [...state.textSourceReferences, { id: sourceId, sourceHash: storedSource.sourceHash }] })); inserted = true;
        const proof = await bag.bindSourcesInFrame(native, scope, { campaignId: f.campaignId, sourceReferences: [{ id: sourceId, sourceHash: storedSource.sourceHash }] });
        const material = await bag.readSourcesProof(native, proof); hydrated = true;
        expect(canonicalHash(material.sources[0])).toBe(canonicalHash(storedSource)); throw rollback;
      }));
      expect(inserted).toBe(true); expect(hydrated).toBe(valid);
      expect(outcome).toEqual(valid ? { accepted: false, code: "SYNTHETIC_FIXTURE_ROLLBACK", status: 409 } : corrupt);
      expect(await image(f.campaignId)).toBe(original);
    }
    const producedBatch = CampaignAgentBatchSchema.parse((await prisma.campaignAgentConfirmationBatch.findUniqueOrThrow({ where: { id: batchId } })).content);
    for (const valid of [true, false]) {
      const copiedId = randomUUID();
      const confirmations = producedBatch.confirmations.map(item => { const next = { ...item, id: randomUUID(), confirmationBatchId: copiedId }; return { ...next, confirmationHash: confirmationHash(next) }; });
      const copied = { ...producedBatch, id: copiedId, confirmations }; const good = { ...copied, contentHash: batchHash(copied) };
      const stored = valid ? good : (() => {
        const bad = { ...good, confirmations: good.confirmations.map(item => item.field === "title" ? (() => { const changed = { ...item, valueHash: "d".repeat(64) }; return { ...changed, confirmationHash: confirmationHash(changed) }; })() : item) };
        return { ...bad, contentHash: batchHash(bad) };
      })(); let inserted = false, hydrated = false;
      expect(CampaignAgentBatchSchema.safeParse(stored).success).toBe(valid);
      const outcome = await observe(() => frame(f, c, observer, async (native, scope) => {
        const base = await readAiPlanningNativeFrame(native);
        await base.tx.campaignAgentConfirmationBatch.create({ data: { id: copiedId, agentId: good.agentId, campaignId: f.campaignId,
          workspaceId: f.view.binding.workspaceId, confirmedByUserId: good.confirmedByUserId, confirmedAt: new Date(good.confirmedAt), contentHash: stored.contentHash, content: inputJson(stored) } });
        // The Agent pins the valid copy. The malformed Batch alone carries a
        // bad value/hash pair, so invalid-Agent parsing cannot fake this witness.
        await reviseAgent(base.tx, f.campaignId, state => ({ ...state, confirmation: { kind: "REVIEWED_SET", confirmationBatchId: copiedId, reviewedSnapshot: good.reviewedSnapshot,
          fields: good.confirmations.map(item => ({ field: item.field, id: item.id, valueHash: item.valueHash, confirmationHash: item.confirmationHash })) } })); inserted = true;
        const proof = await bag.bindSourcesInFrame(native, scope, { campaignId: f.campaignId, sourceReferences: [] });
        const material = await bag.readSourcesProof(native, proof); hydrated = true;
        expect(canonicalHash(material.confirmation)).toBe(canonicalHash(good)); throw rollback;
      }));
      expect(inserted).toBe(true); expect(hydrated).toBe(valid);
      expect(outcome).toEqual(valid ? { accepted: false, code: "SYNTHETIC_FIXTURE_ROLLBACK", status: 409 } : corrupt);
      expect(await image(f.campaignId)).toBe(original);
    }
  }, 60000);

  it("holds native agent/source locks, rejects captured agent drift and rolls back final changes or real expiry without retained proof access", async () => {
    const owner = await company(), f = await interviewed(owner, owner.scope), observer = observedDb(), c = await captured(f, observer), bag = await sourceBag();
    const sourceWait = await hold("CampaignAgentTextSource", f.refs[0]!.id); let pending: Promise<unknown> | undefined;
    try { pending = frame(f, c, observer, async (native, scope) => { const proof = await bag.bindSourcesInFrame(native, scope, { campaignId: f.campaignId, sourceReferences: [f.refs[0]!] }); await bag.recheckSourcesProof(native, proof); return true; });
      void pending.catch(() => {}); await blockedBy(sourceWait.pid, "CampaignAgentTextSource"); sourceWait.release(); await sourceWait.done; await pending;
    } finally { sourceWait.release(); await sourceWait.done; await pending?.catch(() => {}); }
    const batchId = f.view.retained!.confirmation.kind === "REVIEWED_SET" ? f.view.retained!.confirmation.confirmationBatchId : "missing";
    const batchWait = await hold("CampaignAgentConfirmationBatch", batchId); let batchPending: Promise<unknown> | undefined;
    try {
      batchPending = frame(f, c, observer, async (native, scope) => { const proof = await bag.bindSourcesInFrame(native, scope, { campaignId: f.campaignId, sourceReferences: [] });
        const material = await bag.readSourcesProof(native, proof); expect(material.confirmation?.confirmations.length).toBe(30); await bag.recheckSourcesProof(native, proof); return true; });
      void batchPending.catch(() => {}); await blockedBy(batchWait.pid, "CampaignAgentConfirmationBatch"); batchWait.release(); await batchWait.done; await batchPending;
    } finally { batchWait.release(); await batchWait.done; await batchPending?.catch(() => {}); }
    const agentWait = await hold("CampaignAgent", f.view.retained!.id, async tx => { await mutateAgent(tx, f.campaignId); }); observer.clear(); let waiting: Promise<Awaited<ReturnType<typeof observe>>> | undefined;
    try { waiting = observe(() => frame(f, c, observer, (native, scope) => bag.bindSourcesInFrame(native, scope, { campaignId: f.campaignId, sourceReferences: [] })));
      await blockedBy(agentWait.pid, "CampaignAgent"); agentWait.release(); await agentWait.done; expect(await waiting).toEqual(retry); expect(observer.agentBodyIds.length).toBe(0);
    } finally { agentWait.release(); await agentWait.done; await waiting; }
    const refreshed = await captured(f, observer), original = await image(f.campaignId); let savedFrame!: AiPlanningNativeFrame, savedProof!: SourceProof, mutated = false, failure: Awaited<ReturnType<typeof observe>> | undefined;
    expect(await observe(() => frame(f, refreshed, observer, async (native, scope) => { savedFrame = native; savedProof = await bag.bindSourcesInFrame(native, scope, { campaignId: f.campaignId, sourceReferences: [] });
      const base = await readAiPlanningNativeFrame(native); await mutateAgent(base.tx, f.campaignId); mutated = true; observer.clear();
      try { await bag.recheckSourcesProof(native, savedProof); } catch (error) { const safe = error as { code?: string; status?: number }; failure = { accepted: false, code: safe.code ?? "OTHER_ERROR", status: safe.status ?? 0 }; throw error; } return true;
    }))).toEqual(retry); expect(mutated).toBe(true); expect(failure).toEqual(retry); expect(await image(f.campaignId)).toBe(original);
    expect(observer.queries.some(query => /FOR\s+(UPDATE|SHARE)/.test(query))).toBe(false); await closed(bag, savedFrame, savedProof);
    const expired = await interviewed(owner, owner.scope), expiryCapture = await captured(expired, observer), held = await hold("CampaignAgentTextSource", expired.refs[0]!.id);
    let expiry: Promise<Awaited<ReturnType<typeof observe>>> | undefined, entered = false;
    const nameHash = createHash("sha256").update(owner.user.name).digest("hex");
    try {
      const expiresAt = new Date(Date.now() + 3000); await prisma.authSession.update({ where: { id: owner.actor.sessionId }, data: { expiresAt } });
      expiry = observe(() => frame(expired, expiryCapture, observer, async (native, scope) => { const base = await readAiPlanningNativeFrame(native);
        await base.tx.user.update({ where: { id: owner.user.id }, data: { name: "Synthetic source expiry rollback" } }); entered = true;
        return bag.bindSourcesInFrame(native, scope, { campaignId: expired.campaignId, sourceReferences: expired.refs.slice(0, 1) }); }));
      await blockedBy(held.pid, "CampaignAgentTextSource"); expect(Date.now() < expiresAt.getTime()).toBe(true);
      await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 40))); held.release(); await held.done;
      expect(await expiry).toEqual(unauthorized); expect(entered).toBe(true);
      const name = (await prisma.user.findUniqueOrThrow({ where: { id: owner.user.id }, select: { name: true } })).name;
      expect(createHash("sha256").update(name).digest("hex")).toBe(nameHash); expect(await resolveSession(owner.token) === null).toBe(true);
    } finally { held.release(); await held.done; await expiry; }
  }, 60000);
});
