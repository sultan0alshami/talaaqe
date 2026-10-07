import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { createOrganization, proposeClientAssociation, authorizeClientAssociation } from "@/lib/organizations/service";
import type { OrganizationActor } from "@/lib/organizations/context";
import { canonicalHash, inputJson } from "@/lib/onboarding/drafts";
import { createCampaign, generateCampaignBrief, approveCampaignBrief, getCampaign, applyCampaignMutation } from "@/lib/campaigns/service";
import { CampaignBriefContentSchema, CampaignDraftFieldsSchema } from "@/lib/campaigns/contracts";
import { campaignFields } from "../campaigns/fixtures";

// Root alone runs guarded targets. Existing parents,
// signed sessions and organization commands below are genuine native calls on
// owned synthetic subjects, not live company/agency/legal acceptance.
const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>(), clients = new Set<string>();
const workspaces = new Set<string>(), campaigns = new Set<string>();
const creators = new Set<string>(), deals = new Set<string>();
const tables = ["PlanningWorkspace", "BrandContext", "BrandContextSubmission", "BrandContextVersion", "CampaignPlanningBinding",
  "CampaignContextSelection", "CampaignPlanningState", "CampaignProposalDependency", "CampaignBriefProvenance", "CampaignPlanningSubmission",
  "BrandContextCommand", "CampaignPlanningCommand", "PlanningReviewCommand"] as const;
type Table = typeof tables[number];
const key = () => randomUUID();
const at = () => new Date(Date.now() - 60000);
async function tableExists(table: Table) {
  return (await prisma.$queryRaw<Array<{ exists: boolean }>>`SELECT to_regclass(${`"${table}"`}) IS NOT NULL AS "exists"`)[0]?.exists === true;
}
async function requireStorage() {
  for (const table of tables) expect(await tableExists(table), `Frozen M03 storage table ${table} must exist before native constraints can be exercised`).toBe(true);
}

afterEach(async () => {
  // Delete only this leaf's retained children, in reverse frozen FK order.
  if (workspaces.size) for (const table of ["PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission",
    "CampaignBriefProvenance", "CampaignProposalDependency", "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding",
    "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const) {
    if (await tableExists(table)) await prisma.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join([...workspaces])})`);
  }
  if (workspaces.size && await tableExists("PlanningWorkspace")) await prisma.$executeRaw(Prisma.sql`DELETE FROM "PlanningWorkspace" WHERE id IN (${Prisma.join([...workspaces])})`);
  await prisma.deal.deleteMany({ where: { id: { in: [...deals] } } });
  await prisma.campaign.deleteMany({ where: { id: { in: [...campaigns] } } });
  await prisma.creator.deleteMany({ where: { id: { in: [...creators] } } });
  await prisma.organizationCommand.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await prisma.clientGrant.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organizationClient.deleteMany({ where: { id: { in: [...clients] } } });
  await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [...organizations] } } });
  await prisma.brand.deleteMany({ where: { id: { in: [...brands] } } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
  if (users.size) await prisma.outboxEvent.deleteMany({ where: { OR: [...users].map(id => ({ payload: { path: ["actorUserId"], equals: id } })) } });
  await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
  for (const set of [users, brands, organizations, clients, workspaces, campaigns, creators, deals]) set.clear();
});

async function actor(role: "BRAND" | "CREATOR" = "BRAND") {
  const id = key(); users.add(id);
  const user = await prisma.user.create({ data: { id, role, active: true, isTest: true,
    name: "Synthetic M03 schema actor", email: `${id}@example.invalid`, passwordHash: "not-a-login",
    emailVerifiedAt: new Date(Date.now() - 60000) } });
  const token = await openSession(id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Synthetic native M03 schema session did not resolve");
  const current: OrganizationActor = { userId: session.userId, role: session.role, sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  return { user, actor: current };
}
async function company() {
  const owner = await actor();
  const brand = await prisma.brand.create({ data: { userId: owner.user.id, slug: "context-" + key().replace(/-/g, "").slice(0, 16),
    name: "Synthetic original company", countryCode: "KW", isTest: true } }); brands.add(brand.id);
  return { ...owner, brand };
}
async function agency(label: "A" | "B") {
  const owner = await actor();
  const { organization } = await createOrganization(owner.actor, { operationKey: key(), kind: "AGENCY", nameOriginal: "Synthetic agency " + label });
  organizations.add(organization.id); return { ...owner, organization };
}
async function associate(a: Awaited<ReturnType<typeof agency>>, owner: Awaited<ReturnType<typeof company>>) {
  const current = await prisma.organization.findUniqueOrThrow({ where: { id: a.organization.id } });
  const proposed = await proposeClientAssociation(a.actor, current.id, { operationKey: key(), expectedOrganizationRevision: current.revision, brandId: owner.brand.id });
  clients.add(proposed.client.id);
  const { client } = await authorizeClientAssociation(owner.actor, proposed.client.id, { operationKey: key(), expectedRevision: proposed.client.revision,
    capabilities: { view: true, plan: true, approveShortlist: false, reviewContent: false, signCustomer: false, financial: false, manageGrants: false } });
  expect(client.state).toBe("ACTIVE"); return client;
}
async function fixture() {
  const owner = await company(), other = await company(), a = await agency("A"), b = await agency("B");
  const clientA = await associate(a, owner), clientB = await associate(b, owner);
  expect(clientA.brandId).toBe(owner.brand.id); expect(clientB.brandId).toBe(owner.brand.id);
  expect(clientA.organizationId).not.toBe(clientB.organizationId); expect(clientA.id).not.toBe(clientB.id);
  return { owner, other, a, b, clientA, clientB };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
type Fields = Record<string, unknown>;
const jsonColumns = new Set(["content", "narrative", "result"]);
function value(column: string, data: unknown) {
  if (data === null) return Prisma.sql`NULL`;
  if (jsonColumns.has(column)) return Prisma.sql`${JSON.stringify(data)}::jsonb`;
  // Closed literals work for either native ENUM or checked TEXT without
  // guessing enum type names. All identities/content remain bound parameters.
  if (column === "scope" && data === "OWN_BRAND") return Prisma.sql`'OWN_BRAND'`;
  if (column === "scope" && data === "CLIENT") return Prisma.sql`'CLIENT'`;
  if (column === "state" && data === "PENDING") return Prisma.sql`'PENDING'`;
  if (column === "state" && data === "APPROVED") return Prisma.sql`'APPROVED'`;
  if (column === "state" && data === "DECLINED") return Prisma.sql`'DECLINED'`;
  return Prisma.sql`${data}`;
}
async function insert(table: Table, data: Fields) {
  const entries = Object.entries(data);
  await prisma.$executeRaw(Prisma.sql`INSERT INTO ${Prisma.raw('"' + table + '"')}
    (${Prisma.join(entries.map(([column]) => Prisma.raw('"' + column + '"')))})
    VALUES (${Prisma.join(entries.map(([column, data]) => value(column, data)))})`);
}
async function row(table: Table, id: string, column: "id" | "campaignId" | "briefId" = "id") {
  return (await prisma.$queryRaw<Fields[]>(Prisma.sql`SELECT * FROM ${Prisma.raw('"' + table + '"')} WHERE ${Prisma.raw('"' + column + '"')}=${id}`))[0]!;
}
async function patch(table: Table, id: string, data: Fields, column: "id" | "campaignId" | "briefId" = "id") {
  await prisma.$executeRaw(Prisma.sql`UPDATE ${Prisma.raw('"' + table + '"')} SET ${Prisma.join(Object.entries(data).map(([column, data]) => Prisma.sql`${Prisma.raw('"' + column + '"')}=${value(column, data)}`))}
    WHERE ${Prisma.raw('"' + column + '"')}=${id}`);
}
async function constrained(operation: Promise<unknown>, allowed = ["23514", "23503", "23505", "22P02"]) {
  const failure = await operation.then(() => null, (error: unknown) => error);
  expect(failure).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  if (!(failure instanceof Prisma.PrismaClientKnownRequestError)) throw new Error("Expected an actual PostgreSQL M03 constraint rejection");
  expect(failure.code).toBe("P2010"); expect(allowed).toContain(String(failure.meta?.code));
}
async function workspace(f: Fixture, scope: "OWN_BRAND" | "CLIENT", client: "A" | "B" = "A", override: Fields = {}) {
  const id = key(); workspaces.add(id);
  await insert("PlanningWorkspace", { id, scope, brandId: f.owner.brand.id, organizationId: scope === "CLIENT" ? (client === "A" ? f.a.organization.id : f.b.organization.id) : null,
    clientId: scope === "CLIENT" ? (client === "A" ? f.clientA.id : f.clientB.id) : null, createdAt: at(), ...override });
  return id;
}
const original = { positioning: "  تموضع أصلي / Original words  ", values: ["أصلي"], tone: "  هادئ  ", references: [], competitors: [] };
async function context(workspaceId: string, override: Fields = {}) {
  const id = key(), createdAt = at();
  await insert("BrandContext", { id, workspaceId, name: "  سياق أصلي / Original name  ", nameLanguage: "ar", content: original,
    revision: 1, inputRevision: 1, archived: false, createdAt, updatedAt: createdAt, ...override });
  return id;
}
async function submission(f: Fixture, contextId: string, workspaceId: string, client: "A" | "B" | null = null, override: Fields = {}) {
  const id = key();
  await insert("BrandContextSubmission", { id, contextId, workspaceId, inputRevision: 1, name: "  سياق أصلي / Original name  ", nameLanguage: "ar", content: original,
    contentHash: canonicalHash(original), submittedByUserId: client ? (client === "A" ? f.a.user.id : f.b.user.id) : f.owner.user.id,
    targetOwnerUserId: f.owner.user.id, targetOwnerSessionVersion: f.owner.user.sessionVersion, clientRevision: client ? (client === "A" ? f.clientA.revision : f.clientB.revision) : null,
    state: "PENDING", revision: 1, decidedByUserId: null, decidedAt: null, createdAt: at(), ...override });
  return id;
}
async function approve(id: string, ownerId: string) {
  const decidedAt = new Date();
  await patch("BrandContextSubmission", id, { state: "APPROVED", revision: 2, decidedByUserId: ownerId, decidedAt }); return decidedAt;
}
async function version(f: Fixture, contextId: string, workspaceId: string, submissionId: string, approvedAt: Date, override: Fields = {}) {
  const id = key();
  await insert("BrandContextVersion", { id, contextId, workspaceId, submissionId, version: 1, inputRevision: 1, contentHash: canonicalHash(original),
    approvedByUserId: f.owner.user.id, approvedAt, createdAt: new Date(), ...override }); return id;
}
async function approvedContext(f: Fixture, workspaceId: string, client: "A" | "B" | null = null) {
  const contextId = await context(workspaceId), submissionId = await submission(f, contextId, workspaceId, client);
  const approvedAt = await approve(submissionId, f.owner.user.id), versionId = await version(f, contextId, workspaceId, submissionId, approvedAt);
  return { contextId, submissionId, approvedAt, versionId, hash: canonicalHash(original) };
}
async function legacyCampaign(f: Fixture) {
  const command = { operationKey: key(), fields: campaignFields };
  const made = await createCampaign(f.owner.user.id, command, undefined, f.owner.actor); campaigns.add(made.campaign.id);
  return { ...made, command };
}
async function campaign(f: Fixture) {
  // CLIENT must be created without any old owner journal/history. These are
  // actual native storage fixture rows, not a mocked production command.
  const saved = await prisma.campaign.create({ data: { brandId: f.owner.brand.id, title: campaignFields.title,
    input: inputJson({ schemaVersion: 1, fields: campaignFields, fieldsRevision: 1, proposals: [], clarificationCount: 0 }) } });
  campaigns.add(saved.id); return { campaign: saved };
}
async function brief(campaignId: string) {
  const content = CampaignBriefContentSchema.parse({ schemaVersion: 1, requirements: { ...campaignFields, campaignId, version: 1,
    brandCountryCode: "KW", mandatoryPolicyVersionIds: [] }, inputRevision: 1, approvedByUserId: null, policyReview: null });
  return prisma.campaignBrief.create({ data: { campaignId, version: 1, inputRevision: 1, content: inputJson(content) } });
}
async function bind(campaignId: string, workspaceId: string, brandId: string) {
  await insert("CampaignPlanningBinding", { campaignId, workspaceId, brandId, createdAt: at() });
}
async function selection(campaignId: string, workspaceId: string, revision: number, versionId: string | null = null, hash: string | null = null, override: Fields = {}) {
  const id = key(); await insert("CampaignContextSelection", { id, campaignId, workspaceId, revision, contextVersionId: versionId, contentHash: hash, createdAt: at(), ...override }); return id;
}
async function state(campaignId: string, workspaceId: string, selectionId: string, selectionRevision: number) {
  const createdAt = at(); await insert("CampaignPlanningState", { campaignId, workspaceId, revision: 1, selectionId, selectionRevision,
    narrative: { mode: "PARAGRAPH", originalText: { text: "  نص أصلي غير معالج\nOriginal unprocessed words  ", language: "ar" } }, createdAt, updatedAt: createdAt });
}
async function provenance(briefId: string, campaignId: string, workspaceId: string, selectionId: string, selectionRevision: number) {
  await insert("CampaignBriefProvenance", { briefId, campaignId, workspaceId, selectionId, selectionRevision, createdAt: at() });
}
function latch<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) };
}
async function waitForBindingBlock(contenderPid: number, ownerPid: number, signal: AbortSignal) {
  const deadline = performance.now() + 4000;
  while (performance.now() < deadline) {
    if (signal.aborted) throw new Error("Native binding race observer cancelled");
    const rows = await prisma.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity
      WHERE pid=${contenderPid} AND datname=current_database() AND wait_event_type='Lock'
        AND ${ownerPid}=ANY(pg_blocking_pids(pid)) AND query LIKE '%"CampaignPlanningBinding"%'`;
    if (rows.length) return rows[0]!.pid;
    await new Promise<void>(resolve => setTimeout(resolve, 20));
  }
  throw new Error("CLIENT binding did not reach its actual Campaign-owner transaction wait");
}

describe("M03 additive storage: native synthetic scope/history witnesses", () => {
  it("separates OWN and two same-Brand CLIENT workspaces and rejects composite scope/version/brief substitution", async () => {
    await requireStorage(); const f = await fixture(), own = await workspace(f, "OWN_BRAND"), a = await workspace(f, "CLIENT", "A"), b = await workspace(f, "CLIENT", "B");
    expect(await row("PlanningWorkspace", own)).toMatchObject({ scope: "OWN_BRAND", brandId: f.owner.brand.id, organizationId: null, clientId: null });
    expect(await row("PlanningWorkspace", a)).toMatchObject({ scope: "CLIENT", brandId: f.owner.brand.id, organizationId: f.a.organization.id, clientId: f.clientA.id });
    expect(await row("PlanningWorkspace", b)).toMatchObject({ scope: "CLIENT", brandId: f.owner.brand.id, organizationId: f.b.organization.id, clientId: f.clientB.id });
    await constrained(workspace(f, "OWN_BRAND")); await constrained(workspace(f, "CLIENT", "A"));
    for (const invalid of [{ organizationId: f.a.organization.id }, { clientId: f.clientA.id }]) await constrained(workspace(f, "OWN_BRAND", "A", invalid));
    for (const invalid of [{ organizationId: null }, { clientId: null }, { organizationId: f.b.organization.id }, { clientId: f.clientB.id }, { brandId: f.other.brand.id }]) {
      await constrained(workspace(f, "CLIENT", "A", invalid));
    }
    const av = await approvedContext(f, a, "A"), bv = await approvedContext(f, b, "B"), first = await campaign(f), second = await campaign(f);
    await bind(first.campaign.id, a, f.owner.brand.id); await bind(second.campaign.id, b, f.owner.brand.id);
    const third = await campaign(f); await constrained(bind(third.campaign.id, a, f.other.brand.id));
    const none = await selection(first.campaign.id, a, 1); expect(await row("CampaignContextSelection", none)).toMatchObject({ contextVersionId: null, contentHash: null, revision: 1 });
    await constrained(selection(first.campaign.id, a, 2, bv.versionId, bv.hash));
    await constrained(selection(first.campaign.id, a, 2, av.versionId, "b".repeat(64)));
    await constrained(selection(first.campaign.id, a, 2, av.versionId, null));
    const chosen = await selection(first.campaign.id, a, 2, av.versionId, av.hash), otherChosen = await selection(second.campaign.id, b, 1, bv.versionId, bv.hash);
    const generated = await brief(first.campaign.id);
    await constrained(provenance(generated.id, second.campaign.id, b, otherChosen, 1));
    await constrained(provenance(generated.id, first.campaign.id, a, otherChosen, 1));
    await provenance(generated.id, first.campaign.id, a, chosen, 2);
    expect(await row("CampaignBriefProvenance", generated.id, "briefId")).toMatchObject({ campaignId: first.campaign.id, workspaceId: a, selectionId: chosen, selectionRevision: 2 });
    const old = await legacyCampaign(f); await constrained(bind(old.campaign.id, b, f.owner.brand.id));

    // Two real transactional connections race a fresh CLIENT binding against
    // an uncommitted old owner receipt; the existing client observes native PG
    // blocking only. No hook/Prisma producer/conflict is fabricated.
    const racing = await campaign(f), ownerPeer = new PrismaClient(), clientPeer = new PrismaClient();
    const ownerReady = latch<number>(), clientReady = latch<number>(), releaseOwner = latch<void>(), stop = new AbortController();
    const receiptId = key(), receiptKey = `campaign:${racing.campaign.id}:${key()}`, receiptHash = canonicalHash({ syntheticStorageRace: racing.campaign.id });
    const receiptResult = { campaignId: racing.campaign.id, revision: racing.campaign.revision };
    const owning = ownerPeer.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id=${racing.campaign.id} FOR UPDATE`;
      // This is a real existing CampaignCommand row accepted by its unchanged
      // native owner trigger, explicitly a synthetic storage/history fixture.
      await tx.campaignCommand.create({ data: { id: receiptId, campaignId: racing.campaign.id, actorUserId: f.owner.user.id,
        operationKey: receiptKey, payloadHash: receiptHash, result: receiptResult } });
      const pids = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
      ownerReady.resolve(pids[0]!.pid); await releaseOwner.promise;
    }, { maxWait: 5000, timeout: 12000 }); void owning.catch(() => {});
    let inserting: Promise<unknown> | undefined, waiting: Promise<number> | undefined;
    try {
      const ownerPid = await Promise.race([ownerReady.promise, owning.then(() => { throw new Error("Legacy owner finished before publishing its Campaign lock"); })]);
      // The receipt is genuinely uncommitted and not visible outside its owner.
      expect(await prisma.campaignCommand.findUnique({ where: { id: receiptId } })).toBeNull();
      inserting = clientPeer.$transaction(async tx => {
        const pids = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
        clientReady.resolve(pids[0]!.pid);
        await tx.$executeRaw`INSERT INTO "CampaignPlanningBinding" ("campaignId","workspaceId","brandId","createdAt")
          VALUES (${racing.campaign.id},${a},${f.owner.brand.id},CURRENT_TIMESTAMP)`;
      }, { maxWait: 5000, timeout: 10000 }); void inserting.catch(() => {});
      const clientPid = await Promise.race([clientReady.promise, inserting.then(() => { throw new Error("Binding completed before publishing its native contender identity"); })]);
      expect(clientPid).not.toBe(ownerPid);
      waiting = waitForBindingBlock(clientPid, ownerPid, stop.signal);
      expect(await Promise.race([waiting, inserting.then(() => { throw new Error("CLIENT binding completed before the actual owner Campaign wait"); })])).toBe(clientPid);
      releaseOwner.resolve(); await owning;
      await constrained(inserting, ["23514"]);
      expect(await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM "CampaignPlanningBinding" WHERE "campaignId"=${racing.campaign.id}`).toEqual([{ count: 0 }]);
      expect(await prisma.campaignCommand.findUniqueOrThrow({ where: { id: receiptId } })).toMatchObject({ campaignId: racing.campaign.id,
        actorUserId: f.owner.user.id, operationKey: receiptKey, payloadHash: receiptHash, result: receiptResult });
    } finally {
      releaseOwner.resolve(); stop.abort(); await owning.catch(() => {}); await inserting?.catch(() => {}); await waiting?.catch(() => {});
      await ownerPeer.$disconnect(); await clientPeer.$disconnect();
    }
  }, 15000);

  it("guards immutable approved lineage, exact draft/selection revisions, ABA dependencies, private receipts and referenced history", async () => {
    await requireStorage(); const f = await fixture(), own = await workspace(f, "OWN_BRAND"), foreign = await workspace(f, "CLIENT", "B");
    const accepted = await approvedContext(f, own), foreignAccepted = await approvedContext(f, foreign, "B");
    const snapshotBefore = await row("BrandContextSubmission", accepted.submissionId), versionBefore = await row("BrandContextVersion", accepted.versionId);
    for (const invalid of [{ name: "\t\n " }, { name: "n".repeat(201) }, { nameLanguage: "x" }, { nameLanguage: "x".repeat(101) },
      { content: [] }, { content: "not an object" }, { content: { text: "ع".repeat(33000) } }, { revision: 0 }, { revision: 2147483647 }, { revision: 1, inputRevision: 2 }]) {
      await constrained(context(own, invalid));
    }
    for (const invalid of [{ workspaceId: foreign }, { id: key() }, { createdAt: new Date(Date.now() + 1000) }, { revision: 3 },
      { revision: 2, inputRevision: 2 }, { revision: 2, name: "Different original name" }]) await constrained(patch("BrandContext", accepted.contextId, invalid));
    await patch("BrandContext", accepted.contextId, { revision: 2, inputRevision: 2, content: { ...original, tone: "  تعديل أصلي  " }, updatedAt: new Date() });
    expect(await row("BrandContextSubmission", accepted.submissionId)).toEqual(snapshotBefore);
    expect(await row("BrandContextVersion", accepted.versionId)).toEqual(versionBefore);
    await constrained(version(f, accepted.contextId, own, accepted.submissionId, accepted.approvedAt, { version: 2 }));
    for (const invalid of [{ revision: 3, state: "DECLINED" }, { content: { changed: true } }, { targetOwnerUserId: f.other.user.id },
      { targetOwnerSessionVersion: 2 }, { contentHash: "b".repeat(64) }, { name: "changed" }, { inputRevision: 2 }]) {
      await constrained(patch("BrandContextSubmission", accepted.submissionId, invalid));
    }
    for (const invalid of [{ contentHash: "b".repeat(64) }, { version: 2 }, { approvedByUserId: f.other.user.id },
      { approvedAt: new Date(Date.now() + 1) }, { submissionId: foreignAccepted.submissionId }, { createdAt: new Date() }]) {
      await constrained(patch("BrandContextVersion", accepted.versionId, invalid));
    }
    const pendingContext = await context(own), pending = await submission(f, pendingContext, own);
    await constrained(version(f, pendingContext, own, pending, new Date()));
    await constrained(patch("BrandContextSubmission", pending, { state: "APPROVED", revision: 2, decidedByUserId: f.other.user.id, decidedAt: new Date() }));
    await constrained(submission(f, pendingContext, own, null, { clientRevision: 1 }));
    await constrained(submission(f, foreignAccepted.contextId, foreign, "B", { clientRevision: null }));
    await constrained(submission(f, pendingContext, own, null, { state: "APPROVED", decidedByUserId: f.owner.user.id, decidedAt: new Date() }));
    const approvedAt = await approve(pending, f.owner.user.id);
    for (const mismatch of [{ contentHash: "b".repeat(64) }, { approvedByUserId: f.other.user.id }, { inputRevision: 2 },
      { approvedAt: new Date(approvedAt.getTime() + 1) }, { contextId: accepted.contextId }, { workspaceId: foreign }]) {
      await constrained(version(f, pendingContext, own, pending, approvedAt, mismatch));
    }
    const currentVersion = await version(f, pendingContext, own, pending, approvedAt);
    await constrained(version(f, pendingContext, own, pending, approvedAt, { version: 2 })); // One submission, at most one version.

    // Actual old producer persists a proposal before OWN binding, preserving its
    // strict input shape. The sidecar then proves exact stored dependencies.
    const made = await legacyCampaign(f), proposed = await applyCampaignMutation(f.owner.user.id, made.campaign.id, {
      operationKey: key(), expectedRevision: made.campaign.revision, action: "PROPOSE_FIELDS",
      payload: { type: "PROPOSE_FIELDS", patch: { tone: "  اقتراح أصلي  " }, originalText: { text: "  صياغة أصلية  ", language: "ar" } },
    }, undefined, { channel: "PARAGRAPH_TOOL", serverAuth: f.owner.actor });
    expect(proposed.proposalId).not.toBeNull();
    const generated = await generateCampaignBrief(f.owner.user.id, made.campaign.id, { operationKey: key(), expectedRevision: proposed.campaign.revision }, undefined, f.owner.actor);
    await bind(made.campaign.id, own, f.owner.brand.id);
    await constrained(selection(made.campaign.id, own, 2));
    const a1 = await selection(made.campaign.id, own, 1, currentVersion, canonicalHash(original));
    await state(made.campaign.id, own, a1, 1);
    const dependency = { campaignId: made.campaign.id, proposalId: proposed.proposalId, workspaceId: own, fieldsRevision: 1,
      selectionId: a1, selectionRevision: 1, createdAt: at() };
    await constrained(insert("CampaignProposalDependency", { ...dependency, proposalId: key() }));
    await constrained(insert("CampaignProposalDependency", { ...dependency, fieldsRevision: 2 }));
    await insert("CampaignProposalDependency", dependency);
    await constrained(selection(made.campaign.id, own, 1)); await constrained(selection(made.campaign.id, own, 3));
    const b2 = await selection(made.campaign.id, own, 2);
    await constrained(patch("CampaignPlanningState", made.campaign.id, { revision: 2, selectionId: a1, selectionRevision: 2 }, "campaignId"));
    await patch("CampaignPlanningState", made.campaign.id, { revision: 2, selectionId: b2, selectionRevision: 2, updatedAt: new Date() }, "campaignId");
    const a3 = await selection(made.campaign.id, own, 3, currentVersion, canonicalHash(original));
    await constrained(patch("CampaignPlanningState", made.campaign.id, { revision: 3, selectionId: a1, selectionRevision: 1 }, "campaignId"));
    await constrained(patch("CampaignPlanningState", made.campaign.id, { revision: 4, selectionId: a3, selectionRevision: 3 }, "campaignId"));
    await patch("CampaignPlanningState", made.campaign.id, { revision: 3, selectionId: a3, selectionRevision: 3, updatedAt: new Date() }, "campaignId");
    expect(await row("CampaignPlanningState", made.campaign.id, "campaignId")).toMatchObject({ revision: 3, selectionId: a3, selectionRevision: 3 });
    await constrained(patch("CampaignContextSelection", a1, { contextVersionId: null, contentHash: null }));
    await constrained(patch("CampaignPlanningBinding", made.campaign.id, { workspaceId: foreign }, "campaignId"));
    await constrained(patch("PlanningWorkspace", own, { createdAt: new Date() }));
    await constrained(prisma.$executeRaw`UPDATE "CampaignProposalDependency" SET "selectionId"=${a3},"selectionRevision"=3 WHERE "campaignId"=${made.campaign.id} AND "proposalId"=${proposed.proposalId}`);
    expect((await prisma.$queryRaw<Array<{ selectionId: string; selectionRevision: number }>>`SELECT "selectionId","selectionRevision" FROM "CampaignProposalDependency" WHERE "campaignId"=${made.campaign.id} AND "proposalId"=${proposed.proposalId}`)[0]).toEqual({ selectionId: a1, selectionRevision: 1 });
    await provenance(generated.brief.id, made.campaign.id, own, a3, 3);
    await constrained(patch("CampaignBriefProvenance", generated.brief.id, { selectionId: a1, selectionRevision: 1 }, "briefId"));
    // Archive only after the version is pinned: established campaign review
    // remains usable, while a fresh context approval is forbidden.
    await patch("BrandContext", pendingContext, { archived: true, revision: 2, updatedAt: new Date() });
    const archivedPending = await submission(f, pendingContext, own);
    await constrained(approve(archivedPending, f.owner.user.id));
    const reviewId = key(), review = { id: reviewId, campaignId: made.campaign.id, workspaceId: own, briefId: generated.brief.id, selectionId: a3, selectionRevision: 3,
      inputRevision: 1, campaignRevision: generated.campaign.revision, content: generated.brief.content, contentHash: canonicalHash(generated.brief.content),
      submittedByUserId: f.owner.user.id, targetOwnerUserId: f.owner.user.id, targetOwnerSessionVersion: f.owner.user.sessionVersion,
      clientRevision: null, state: "PENDING", revision: 1, decidedByUserId: null, decidedAt: null, createdAt: at() };
    // Same campaign, valid old selection, wrong exact provenance tuple.
    await constrained(insert("CampaignPlanningSubmission", { ...review, id: key(), selectionId: b2, selectionRevision: 2 }));
    await insert("CampaignPlanningSubmission", review);
    await constrained(patch("CampaignPlanningSubmission", reviewId, { state: "APPROVED", revision: 2, decidedByUserId: f.other.user.id, decidedAt: new Date() }));
    await patch("CampaignPlanningSubmission", reviewId, { state: "APPROVED", revision: 2, decidedByUserId: f.owner.user.id, decidedAt: new Date() });
    await constrained(patch("CampaignPlanningSubmission", reviewId, { state: "DECLINED", revision: 3 }));
    await constrained(patch("CampaignPlanningSubmission", reviewId, { content: { privateReplacement: true } }));

    const receipts: Array<{ table: "BrandContextCommand" | "CampaignPlanningCommand" | "PlanningReviewCommand"; data: Fields }> = [
      { table: "BrandContextCommand", data: { id: key(), actorUserId: f.owner.user.id, operationKey: key(), payloadHash: canonicalHash({ purpose: "Synthetic context receipt" }),
        contextId: accepted.contextId, workspaceId: own, action: "CREATE", result: { contextId: accepted.contextId, revision: 1 }, createdAt: at() } },
      { table: "CampaignPlanningCommand", data: { id: key(), actorUserId: f.owner.user.id, operationKey: key(), payloadHash: canonicalHash({ purpose: "Synthetic planning receipt" }),
        campaignId: made.campaign.id, workspaceId: own, action: "SELECT_CONTEXT", result: { campaignId: made.campaign.id, planningRevision: 3, selectionRevision: 3 }, createdAt: at() } },
      { table: "PlanningReviewCommand", data: { id: key(), actorUserId: f.owner.user.id, operationKey: key(), payloadHash: canonicalHash({ purpose: "Synthetic owner-review receipt" }),
        workspaceId: own, contextSubmissionId: pending, campaignSubmissionId: null, action: "APPROVE_CONTEXT", result: { submissionId: pending, versionId: currentVersion, state: "APPROVED" }, createdAt: at() } },
    ];
    for (const receipt of receipts) {
      await insert(receipt.table, receipt.data); const before = await row(receipt.table, String(receipt.data.id));
      for (const privateKey of ["content", "name", "narrative", "contact", "actor", "session", "authority"]) {
        await constrained(insert(receipt.table, { ...receipt.data, id: key(), operationKey: key(), result: { [privateKey]: "private synthetic canary" } }));
      }
      for (const result of [[], { revision: { value: 1 } }, { state: ["APPROVED"] }, { state: "x".repeat(4097) }]) {
        await constrained(insert(receipt.table, { ...receipt.data, id: key(), operationKey: key(), result }));
      }
      await constrained(insert(receipt.table, { ...receipt.data, id: key() }));
      await constrained(insert(receipt.table, { ...receipt.data, id: key(), operationKey: key(), payloadHash: "A".repeat(64) }));
      for (const changed of [{ operationKey: key() }, { payloadHash: "b".repeat(64) }, { result: {} }, { actorUserId: f.other.user.id }, { createdAt: new Date() }]) {
        await constrained(patch(receipt.table, String(receipt.data.id), changed));
      }
      expect(await row(receipt.table, String(receipt.data.id))).toEqual(before);
    }
    const reviewReceipt = receipts[2]!.data;
    await constrained(insert("PlanningReviewCommand", { ...reviewReceipt, id: key(), operationKey: key(), contextSubmissionId: null }));
    await constrained(insert("PlanningReviewCommand", { ...reviewReceipt, id: key(), operationKey: key(), campaignSubmissionId: reviewId }));
    await constrained(insert("PlanningReviewCommand", { ...reviewReceipt, id: key(), operationKey: key(), contextSubmissionId: foreignAccepted.submissionId }));
    const retentionCodes = ["23001", "23503"];
    await constrained(prisma.$executeRaw`DELETE FROM "BrandContextVersion" WHERE id=${currentVersion}`, retentionCodes);
    await constrained(prisma.$executeRaw`DELETE FROM "BrandContext" WHERE id=${pendingContext}`, retentionCodes);
    await constrained(prisma.$executeRaw`DELETE FROM "PlanningWorkspace" WHERE id=${own}`, retentionCodes);
    await constrained(prisma.$executeRaw`DELETE FROM "OrganizationClient" WHERE id=${f.clientB.id}`, retentionCodes);
    expect(await row("BrandContextSubmission", accepted.submissionId)).toEqual(snapshotBefore);
    expect(await row("BrandContextVersion", accepted.versionId)).toEqual(versionBefore);
  });

  it("preserves original strict campaign/brief bytes, owner journals and retained DIRECT party/brief references without invented old provenance", async () => {
    await requireStorage(); const f = await fixture(), old = await legacyCampaign(f);
    const generated = await generateCampaignBrief(f.owner.user.id, old.campaign.id, { operationKey: key(), expectedRevision: old.campaign.revision }, undefined, f.owner.actor);
    const approved = await approveCampaignBrief(f.owner.user.id, old.campaign.id, { operationKey: key(), expectedRevision: generated.campaign.revision,
      briefId: generated.brief.id, expectedBriefVersion: generated.brief.version }, undefined, { channel: "FORM", serverAuth: f.owner.actor });
    expect(approved.brief.approvedByUserId).toBe(f.owner.user.id);
    const creatorOwner = await actor("CREATOR"), creator = await prisma.creator.create({ data: { userId: creatorOwner.user.id,
      handle: "retain_" + key().replace(/-/g, "").slice(0, 16), displayName: "Synthetic retained direct participant", isTest: true } }); creators.add(creator.id);
    // This native DIRECT storage fixture is OFFERED, not accepted/live/legal
    // deal evidence. Existing actual accepted-party regression remains separate.
    const direct = await prisma.deal.create({ data: { campaignId: old.campaign.id, brandId: f.owner.brand.id, creatorId: creator.id,
      briefVersion: approved.brief.version, origin: "DIRECT" } }); deals.add(direct.id);
    const matchReceiptId = key(), matchKey = "synthetic-legacy-match-" + key(), matchHash = canonicalHash({ syntheticStorageReceipt: old.campaign.id });
    // Real SQL fixture verifies the original matching owner trigger, not a
    // fabricated native matching producer or matching-feature acceptance.
    await prisma.$executeRaw`INSERT INTO "MatchCommand" (id,"campaignId","actorUserId","operationKey","payloadHash",result,"createdAt")
      VALUES (${matchReceiptId},${old.campaign.id},${f.owner.user.id},${matchKey},${matchHash},${JSON.stringify({ retainedFixture: true })}::jsonb,CURRENT_TIMESTAMP)`;
    const dtoBefore = await getCampaign(f.owner.user.id, old.campaign.id, undefined, f.owner.actor);
    const bytes = async () => ({
      campaign: await prisma.$queryRaw<Array<{ input: string; conversation: string }>>`SELECT input::text AS input,conversation::text AS conversation FROM "Campaign" WHERE id=${old.campaign.id}`,
      brief: await prisma.$queryRaw<Array<{ content: string; approvedByUserId: string; approvedAt: Date }>>`SELECT content::text AS content,"approvedByUserId","approvedAt" FROM "CampaignBrief" WHERE id=${approved.brief.id}`,
      commands: await prisma.$queryRaw<Fields[]>`SELECT id,"operationKey","actorUserId","payloadHash",result::text AS result,"createdAt" FROM "CampaignCommand" WHERE "campaignId"=${old.campaign.id} ORDER BY id`,
      matching: await prisma.$queryRaw<Fields[]>`SELECT id,"operationKey","actorUserId","payloadHash",result::text AS result,"createdAt" FROM "MatchCommand" WHERE "campaignId"=${old.campaign.id} ORDER BY id`,
      direct: await prisma.deal.findUniqueOrThrow({ where: { id: direct.id } }),
    });
    const before = await bytes(); expect(before.commands).toHaveLength(3);
    const parsedInput = JSON.parse(before.campaign[0]!.input);
    expect(Object.keys(parsedInput).sort()).toEqual(["clarificationCount", "fields", "fieldsRevision", "proposals", "schemaVersion"]);
    expect(parsedInput.schemaVersion).toBe(1); expect(CampaignDraftFieldsSchema.parse(parsedInput.fields)).toEqual(campaignFields);
    expect(CampaignBriefContentSchema.parse(JSON.parse(before.brief[0]!.content)).approvedByUserId).toBe(f.owner.user.id);
    expect(before.commands.find(row => row.operationKey === `create:${old.command.operationKey}`)?.payloadHash).toBe(canonicalHash(old.command));
    const receiptData = { campaignId: old.campaign.id, actorUserId: f.other.user.id, operationKey: key(), payloadHash: "a".repeat(64), result: {} };
    await constrained(prisma.$executeRaw`INSERT INTO "CampaignCommand" (id,"campaignId","actorUserId","operationKey","payloadHash",result,"createdAt")
      VALUES (${key()},${receiptData.campaignId},${receiptData.actorUserId},${receiptData.operationKey},${receiptData.payloadHash},'{}'::jsonb,CURRENT_TIMESTAMP)`);
    await constrained(prisma.$executeRaw`INSERT INTO "MatchCommand" (id,"campaignId","actorUserId","operationKey","payloadHash",result,"createdAt")
      VALUES (${key()},${receiptData.campaignId},${receiptData.actorUserId},${key()},${receiptData.payloadHash},'{}'::jsonb,CURRENT_TIMESTAMP)`);
    const own = await workspace(f, "OWN_BRAND"), accepted = await approvedContext(f, own), fresh = await campaign(f);
    await bind(fresh.campaign.id, own, f.owner.brand.id);
    const chosen = await selection(fresh.campaign.id, own, 1, accepted.versionId, accepted.hash);
    await state(fresh.campaign.id, own, chosen, 1); const freshBrief = await brief(fresh.campaign.id);
    await provenance(freshBrief.id, fresh.campaign.id, own, chosen, 1);
    expect(await bytes()).toEqual(before); expect(await getCampaign(f.owner.user.id, old.campaign.id, undefined, f.owner.actor)).toEqual(dtoBefore);
    expect(before.direct).toMatchObject({ origin: "DIRECT", campaignId: old.campaign.id, brandId: f.owner.brand.id, creatorId: creator.id, briefVersion: approved.brief.version });
    expect(await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM "CampaignPlanningBinding" WHERE "campaignId"=${old.campaign.id}`).toEqual([{ count: 0 }]);
    expect(await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM "CampaignBriefProvenance" WHERE "briefId"=${approved.brief.id}`).toEqual([{ count: 0 }]);
  });
});
