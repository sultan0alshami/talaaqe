import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import type { OrganizationActor } from "@/lib/organizations/context";
import { createOrganization, proposeClientAssociation, authorizeClientAssociation } from "@/lib/organizations/service";
import { canonicalHash, inputJson } from "@/lib/onboarding/drafts";
import { BrandContextContentSchema, ApprovedBrandContextVersionSchema } from "@/lib/brand-context/contracts";
import { CampaignBriefContentSchema, CampaignDraftFieldsSchema } from "@/lib/campaigns/contracts";
import { BriefPlanningProvenanceSchema } from "@/lib/campaign-planning/contracts";

// Four native PostgreSQL groups. Actual signed organization setup and raw valid
// M03 storage fixtures exercise additive guards; they are not managed-service,
// customer consent, legal, holiday/provider or live storage acceptance.
// This leaf imports no test-module fixtures and executes no test commands.
const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>();
const workspaces = new Set<string>(), campaigns = new Set<string>();
const managedTables = ["ManagedOrder", "ManagedOrderSubmission", "ManagedOrderState", "ManagedOrderCommand"] as const;
type PlanningTable = "PlanningWorkspace" | "BrandContext" | "BrandContextSubmission" | "BrandContextVersion" | "CampaignPlanningBinding"
  | "CampaignContextSelection" | "CampaignPlanningState" | "CampaignBriefProvenance" | "ContextReferenceManifest" | "ContextReferenceState" | "ContextSubmissionReferences";
type Table = typeof managedTables[number] | PlanningTable;
type Fields = Record<string, unknown>;
type Db = PrismaClient | Prisma.TransactionClient;
const key = () => randomUUID();
const at = () => new Date(Date.now() - 60000);
const jsonColumns = new Set(["content", "snapshot", "items", "result"]);
const retention = ["23001", "23503"];

async function exists(table: string) {
  return (await prisma.$queryRaw<Array<{ present: boolean }>>`SELECT to_regclass(${`"${table}"`}) IS NOT NULL AS present`)[0]?.present === true;
}
async function requireStorage() {
  for (const table of managedTables) expect(await exists(table), `Frozen additive M04 table ${table} must exist`).toBe(true);
}
function value(column: string, data: unknown) {
  if (data === null) return Prisma.sql`NULL`;
  if (jsonColumns.has(column)) return Prisma.sql`${JSON.stringify(data)}::jsonb`;
  if (column === "scope" && data === "OWN_BRAND") return Prisma.sql`'OWN_BRAND'`;
  if (column === "scope" && data === "CLIENT") return Prisma.sql`'CLIENT'`;
  if (column === "state" && data === "PENDING") return Prisma.sql`'PENDING'`;
  if (column === "state" && data === "APPROVED") return Prisma.sql`'APPROVED'`;
  if (column === "status" && data === "REQUESTED") return Prisma.sql`'REQUESTED'`;
  // Bind UTC civil timestamps explicitly; a Date parameter can use session TZ.
  if (data instanceof Date) return Prisma.sql`${data.toISOString()}::timestamp(3)`;
  return Prisma.sql`${data}`;
}
async function insert(table: Table, data: Fields, db: Db = prisma) {
  const entries = Object.entries(data);
  await db.$executeRaw(Prisma.sql`INSERT INTO ${Prisma.raw('"' + table + '"')}
    (${Prisma.join(entries.map(([column]) => Prisma.raw('"' + column + '"')))})
    VALUES (${Prisma.join(entries.map(([column, data]) => value(column, data)))})`);
}
async function patch(table: Table, id: string, data: Fields, column: "id" | "orderId" = "id") {
  await prisma.$executeRaw(Prisma.sql`UPDATE ${Prisma.raw('"' + table + '"')}
    SET ${Prisma.join(Object.entries(data).map(([name, data]) => Prisma.sql`${Prisma.raw('"' + name + '"')}=${value(name, data)}`))}
    WHERE ${Prisma.raw('"' + column + '"')}=${id}`);
}
async function row(table: Table, id: string, column: "id" | "orderId" | "submissionId" = "id") {
  return (await prisma.$queryRaw<Fields[]>(Prisma.sql`SELECT * FROM ${Prisma.raw('"' + table + '"')}
    WHERE ${Prisma.raw('"' + column + '"')}=${id}`))[0]!;
}
async function constrained(operation: Promise<unknown>, codes = ["23514"]) {
  const failure = await operation.then(() => null, (error: unknown) => error);
  expect(failure).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  if (!(failure instanceof Prisma.PrismaClientKnownRequestError)) throw new Error("Expected an actual PostgreSQL managed-order rejection");
  expect(failure.code).toBe("P2010");
  expect(codes).toContain(String(failure.meta?.code));
}

afterEach(async () => {
  // Only this leaf's recorded workspace/user subjects are removed. No reset,
  // TRUNCATE, trigger disabling, external storage or inherited data operations.
  if (workspaces.size) {
    const ids = [...workspaces];
    await prisma.$transaction(async tx => {
      for (const table of ["ManagedOrderCommand", "ManagedOrderState", "ManagedOrderSubmission", "ManagedOrder",
        "ContextReferenceCommand", "ContextSubmissionReferences", "ContextReferenceState", "ContextReferenceManifest", "ContextAssetBinding",
        "PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission", "CampaignBriefProvenance",
        "CampaignProposalDependency", "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding",
        "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const) {
        if (await exists(table)) await tx.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')}
          WHERE "workspaceId" IN (${Prisma.join(ids)})`);
      }
      if (await exists("PlanningWorkspace")) await tx.$executeRaw(Prisma.sql`DELETE FROM "PlanningWorkspace" WHERE id IN (${Prisma.join(ids)})`);
    });
  }
  if (campaigns.size) await prisma.campaign.deleteMany({ where: { id: { in: [...campaigns] } } });
  if (users.size) await prisma.organizationCommand.deleteMany({ where: { actorUserId: { in: [...users] } } });
  if (organizations.size) {
    await prisma.clientGrant.deleteMany({ where: { organizationId: { in: [...organizations] } } });
    await prisma.organizationClient.deleteMany({ where: { organizationId: { in: [...organizations] } } });
    await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: [...organizations] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [...organizations] } } });
  }
  if (brands.size) await prisma.brand.deleteMany({ where: { id: { in: [...brands] } } });
  if (users.size) {
    await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
    await prisma.outboxEvent.deleteMany({ where: { OR: [...users].map(id => ({ payload: { path: ["actorUserId"], equals: id } })) } });
    await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
  }
  for (const set of [users, brands, organizations, workspaces, campaigns]) set.clear();
});

async function person() {
  const id = key(); users.add(id);
  const user = await prisma.user.create({ data: { id, role: "BRAND", active: true, isTest: true,
    name: "Synthetic M04 storage actor", email: `${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: at() } });
  const token = await openSession(id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Native synthetic M04 storage session did not resolve");
  const actor: OrganizationActor = { userId: session.userId, role: session.role, sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  return { user, actor };
}
async function company() {
  const owner = await person(), brand = await prisma.brand.create({ data: { userId: owner.user.id,
    slug: "managed-storage-" + key().replace(/-/g, ""), name: "Synthetic original company", countryCode: "KW", isTest: true } });
  brands.add(brand.id); return { ...owner, brand };
}
type Company = Awaited<ReturnType<typeof company>>;
type Workspace = { id: string; owner: Company; submitterUserId: string; clientRevision: number | null };
async function own(owner: Company): Promise<Workspace> {
  const id = key(); workspaces.add(id);
  await insert("PlanningWorkspace", { id, scope: "OWN_BRAND", brandId: owner.brand.id, organizationId: null, clientId: null, createdAt: at() });
  return { id, owner, submitterUserId: owner.user.id, clientRevision: null };
}
async function client(owner: Company, label: string): Promise<Workspace> {
  const agency = await person(), made = await createOrganization(agency.actor, { operationKey: key(), kind: "AGENCY", nameOriginal: "Synthetic agency " + label });
  organizations.add(made.organization.id);
  const proposed = await proposeClientAssociation(agency.actor, made.organization.id, {
    operationKey: key(), expectedOrganizationRevision: made.organization.revision, brandId: owner.brand.id });
  const associated = await authorizeClientAssociation(owner.actor, proposed.client.id, { operationKey: key(), expectedRevision: proposed.client.revision,
    capabilities: { view: true, plan: true, approveShortlist: false, reviewContent: false, signCustomer: false, financial: false, manageGrants: false } });
  const id = key(); workspaces.add(id);
  await insert("PlanningWorkspace", { id, scope: "CLIENT", brandId: owner.brand.id, organizationId: made.organization.id,
    clientId: associated.client.id, createdAt: at() });
  return { id, owner, submitterUserId: agency.user.id, clientRevision: associated.client.revision };
}
async function fixture() {
  const owner = await company(), other = await company();
  const ownWorkspace = await own(owner), a = await client(owner, "A"), b = await client(owner, "B"), foreign = await own(other);
  expect(new Set([ownWorkspace.id, a.id, b.id, foreign.id]).size).toBe(4);
  return { owner, other, own: ownWorkspace, a, b, foreign };
}

const fields = CampaignDraftFieldsSchema.parse({ originalLanguage: "ar", title: "  حملة أصلية / Original title  ", productService: "منتج أصلي",
  goal: "AWARENESS", summary: "  وصف أصلي واحد\nOriginal words retained  ", marketCountryCodes: ["KW"], targetAgeBuckets: ["18-24"],
  targetGenders: ["FEMALE"], targetCountryCodes: ["KW"], targetCityKeys: [], contentLanguages: ["ar"], dialects: ["ar-Gulf"], nicheSlugs: ["beauty"],
  deliverables: [{ platform: "INSTAGRAM", format: "STORY", count: 2 }], budget: { amountMinor: "123456", currencyCode: "KWD" },
  desiredCreatorCount: 3, impressionsTarget: 10001, period: { startsAt: "2026-11-01T10:00:00.000Z", endsAt: "2026-11-10T10:00:00.000Z", timeZone: "Asia/Kuwait" },
  physicalPresenceRequired: false, presenceCountryCodes: [], travelAllowed: false, tone: "  ودي  ", noGoTopics: [], preferredTiers: [],
  dataVerificationRequired: false, preferredLicencePolicyIds: [], usageRights: "للحملة فقط", kpis: [{ name: "الزيارات", target: "زيادة الزيارات" }], assumptions: [], openQuestions: [] });
const contextContent = BrandContextContentSchema.parse({ schemaVersion: 1, positioning: { text: "  تموضع أصلي\nOriginal positioning  ", language: "ar" },
  values: [{ text: "أصلي", language: "ar" }], tone: { text: null, language: null }, references: [], competitors: [] });
async function approvedContext(workspace: Workspace) {
  const contextId = key(), submissionId = key(), versionId = key(), createdAt = at(), approvedAt = new Date(createdAt.getTime() + 1);
  const nameOriginal = { text: "سياق أصلي / Original name", language: "ar" }, contentHash = canonicalHash({ nameOriginal, content: contextContent });
  await insert("BrandContext", { id: contextId, workspaceId: workspace.id, name: nameOriginal.text, nameLanguage: nameOriginal.language,
    content: contextContent, revision: 1, inputRevision: 1, archived: false, createdAt, updatedAt: createdAt });
  await insert("BrandContextSubmission", { id: submissionId, contextId, workspaceId: workspace.id, inputRevision: 1,
    name: nameOriginal.text, nameLanguage: nameOriginal.language, content: contextContent, contentHash,
    submittedByUserId: workspace.submitterUserId, targetOwnerUserId: workspace.owner.user.id,
    targetOwnerSessionVersion: workspace.owner.user.sessionVersion, clientRevision: workspace.clientRevision,
    state: "PENDING", revision: 1, decidedByUserId: null, decidedAt: null, createdAt });
  // The installed M03 AFTER INSERT trigger genuinely captures an empty manifest.
  // This is not LEGACY_ABSENT and no historical absence is rewritten.
  await patch("BrandContextSubmission", submissionId, { state: "APPROVED", revision: 2, decidedByUserId: workspace.owner.user.id, decidedAt: approvedAt });
  await insert("BrandContextVersion", { id: versionId, contextId, workspaceId: workspace.id, submissionId, version: 1, inputRevision: 1,
    contentHash, approvedByUserId: workspace.owner.user.id, approvedAt, createdAt });
  const capture = await row("ContextSubmissionReferences", submissionId, "submissionId");
  const manifest = await row("ContextReferenceManifest", String(capture.manifestId));
  expect(manifest.items).toEqual([]);
  return { submissionId, contextId, versionId, contentHash,
    selected: ApprovedBrandContextVersionSchema.parse({ id: versionId, contextId, version: 1, inputRevision: 1,
      nameOriginal, content: contextContent, contentHash, approvedAt: approvedAt.toISOString() }),
    references: { kind: "MANIFEST" as const, id: String(manifest.id), revision: Number(manifest.referenceRevision), hash: String(manifest.hash), items: [] } };
}
async function source(workspace: Workspace, withContext = true, approved = true) {
  const context = withContext ? await approvedContext(workspace) : null, createdAt = at();
  const campaign = await prisma.campaign.create({ data: { brandId: workspace.owner.brand.id, title: fields.title!,
    input: inputJson({ schemaVersion: 1, fields, fieldsRevision: 1, proposals: [], clarificationCount: 0 }), revision: 1 } });
  campaigns.add(campaign.id);
  await insert("CampaignPlanningBinding", { campaignId: campaign.id, workspaceId: workspace.id, brandId: workspace.owner.brand.id, createdAt });
  const selectionId = key();
  await insert("CampaignContextSelection", { id: selectionId, campaignId: campaign.id, workspaceId: workspace.id, revision: 1,
    contextVersionId: context?.versionId ?? null, contentHash: context?.contentHash ?? null, createdAt });
  await insert("CampaignPlanningState", { campaignId: campaign.id, workspaceId: workspace.id, revision: 1,
    selectionId, selectionRevision: 1, createdAt, updatedAt: createdAt });
  const approvedAt = new Date(createdAt.getTime() + 2), approvedByUserId = workspace.owner.user.id;
  const content = CampaignBriefContentSchema.parse({ schemaVersion: 1, requirements: { ...fields, campaignId: campaign.id, version: 1,
    brandCountryCode: "KW", mandatoryPolicyVersionIds: [] }, inputRevision: 1, approvedByUserId, policyReview: null });
  const storedContent = approved ? content : CampaignBriefContentSchema.parse({ ...content, approvedByUserId: null });
  const brief = await prisma.campaignBrief.create({ data: { campaignId: campaign.id, version: 1, inputRevision: 1,
    content: inputJson(storedContent), approvedAt: approved ? approvedAt : null, approvedByUserId: approved ? approvedByUserId : null, createdAt } });
  await insert("CampaignBriefProvenance", { briefId: brief.id, campaignId: campaign.id, workspaceId: workspace.id,
    selectionId, selectionRevision: 1, createdAt });
  await prisma.campaign.update({ where: { id: campaign.id }, data: { status: approved ? "BRIEF_APPROVED" : "BRIEF_GENERATED", currentBriefVersion: 1 } });
  const snapshot = { schemaVersion: 1,
    brief: { id: brief.id, campaignId: campaign.id, version: 1, inputRevision: 1, content,
      approvedAt: approvedAt.toISOString(), approvedByUserId, createdAt: createdAt.toISOString() },
    provenance: BriefPlanningProvenanceSchema.parse({ selectionId, selectionRevision: 1, versionId: context?.versionId ?? null, contentHash: context?.contentHash ?? null }),
    selectedContext: context?.selected ?? null, references: context?.references ?? { kind: "NO_CONTEXT" as const } };
  return { workspace, campaignId: campaign.id, briefId: brief.id, selectionId, approvedAt, approvedByUserId, context, snapshot };
}
type Source = Awaited<ReturnType<typeof source>>;
function orderData(s: Source, id = key()) {
  return { id, workspaceId: s.workspace.id, campaignId: s.campaignId, createdAt: new Date(Math.max(at().getTime(), s.approvedAt.getTime() + 1)) };
}
async function order(s: Source) { const data = orderData(s); await insert("ManagedOrder", data); return data; }
type Order = Awaited<ReturnType<typeof order>>;
function submissionData(s: Source, parent: Order, version = 1, override: Fields = {}) {
  return { id: key(), orderId: parent.id, workspaceId: s.workspace.id, campaignId: s.campaignId, version, briefId: s.briefId,
    briefVersion: 1, inputRevision: 1, campaignRevision: 1, planningRevision: 1, selectionId: s.selectionId, selectionRevision: 1,
    approvedByUserId: s.approvedByUserId, approvedAt: s.approvedAt, snapshot: s.snapshot, snapshotHash: canonicalHash(s.snapshot),
    submittedByUserId: s.workspace.submitterUserId, disclosureVersion: "infame-order-disclosure-v1",
    contextReferenceSubmissionId: s.context?.submissionId ?? null,
    createdAt: new Date(Math.max(at().getTime(), s.approvedAt.getTime() + 1, parent.createdAt.getTime() + 1)), ...override };
}
async function submission(s: Source, parent: Order, version = 1) {
  const data = submissionData(s, parent, version); await insert("ManagedOrderSubmission", data); return data;
}
type Submission = Awaited<ReturnType<typeof submission>>;
function stateData(parent: Order, submitted: Submission, override: Fields = {}) {
  const createdAt = new Date(Math.max(at().getTime(), submitted.createdAt.getTime() + 1));
  return { orderId: parent.id, workspaceId: parent.workspaceId, revision: 1, submissionId: submitted.id,
    submissionVersion: 1, status: "REQUESTED", createdAt, updatedAt: createdAt, ...override };
}
function commandData(s: Source, parent: Order, submitted: Submission, override: Fields = {}) {
  return { id: key(), actorUserId: s.workspace.submitterUserId, operationKey: key(), payloadHash: canonicalHash({ synthetic: "M04 native storage", orderId: parent.id }),
    orderId: parent.id, workspaceId: parent.workspaceId, campaignId: parent.campaignId, submissionId: submitted.id, submissionVersion: 1, action: "SUBMIT",
    result: { action: "SUBMIT", orderId: parent.id, submissionId: submitted.id, campaignId: parent.campaignId,
      revision: 1, submissionVersion: 1, briefId: s.briefId, briefVersion: 1, selectionId: s.selectionId, selectionRevision: 1 },
    createdAt: new Date(Math.max(at().getTime(), submitted.createdAt.getTime() + 1)), ...override };
}

function latch<T>() { let resolve!: (value: T | PromiseLike<T>) => void;
  return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
async function uniqueRace(table: "ManagedOrder" | "ManagedOrderCommand", first: Fields, second: Fields) {
  const peer = new PrismaClient(), contender = new PrismaClient(), monitor = new PrismaClient();
  const ready = latch<number>(), started = latch<number>(), release = latch<void>(), stop = new AbortController();
  let contending: Promise<void> | undefined;
  const holding = peer.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout='6s'`;
    const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
    await insert(table, first, tx); ready.resolve(pid!); await release.promise;
  }, { maxWait: 5000, timeout: 15000 });
  void holding.catch(() => {});
  try {
    const ownerPid = await Promise.race([ready.promise, holding.then(() => { throw new Error("Native unique writer exited before holding its row"); })]);
    const inserting = contender.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout='6s'`;
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
      started.resolve(pid!); await insert(table, second, tx);
    }, { maxWait: 5000, timeout: 15000 });
    contending = constrained(inserting, ["23505"]); void contending.catch(() => {});
    const contenderPid = await started.promise, deadline = performance.now() + 4000;
    let observed = false;
    while (performance.now() < deadline) {
      if (stop.signal.aborted) break;
      const waits = await monitor.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
        AND pid=${contenderPid} AND wait_event_type='Lock' AND ${ownerPid}=ANY(pg_blocking_pids(pid)) AND query LIKE ${`%"${table}"%`}`;
      if (waits.length) { observed = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(observed, `Contending ${table} INSERT must reach its real PostgreSQL unique-index wait`).toBe(true);
    release.resolve(); await holding; await contending;
  } finally {
    release.resolve(); stop.abort(); await holding.catch(() => {}); await contending?.catch(() => {});
    await peer.$disconnect(); await contender.$disconnect(); await monitor.$disconnect();
  }
}

describe("M04 additive managed-order storage: four native synthetic groups", () => {
  it("binds each order to its exact campaign/workspace and retains its original parent tuple", async () => {
    const f = await fixture(), a = await source(f.a), b = await source(f.b), candidate = await source(f.a);
    await requireStorage();
    const saved = await order(a), before = await row("ManagedOrder", saved.id);
    for (const workspaceId of [f.b.id, f.own.id, f.foreign.id]) {
      await constrained(insert("ManagedOrder", { ...orderData(candidate), workspaceId }), ["23503"]);
    }
    await constrained(insert("ManagedOrder", { ...orderData(b), campaignId: key() }), ["23503"]);
    for (const changed of [{ id: key() }, { workspaceId: f.b.id }, { campaignId: b.campaignId }, { createdAt: new Date() }]) {
      await constrained(patch("ManagedOrder", saved.id, changed));
    }
    await constrained(prisma.$executeRaw`DELETE FROM "CampaignPlanningBinding" WHERE "campaignId"=${a.campaignId}`, retention);
    expect(await row("ManagedOrder", saved.id)).toEqual(before);
    expect(before).toMatchObject({ workspaceId: f.a.id, campaignId: a.campaignId });
  });

  it("freezes full approved original snapshots and exact context/reference pins while rejecting private or contradictory receipts", async () => {
    await requireStorage(); const f = await fixture(), a = await source(f.a), other = await source(f.a), parent = await order(a);
    const saved = await submission(a, parent), before = await row("ManagedOrderSubmission", String(saved.id));
    const snapshot = structuredClone(a.snapshot);
    expect(snapshot.brief.content.requirements.summary).toBe(fields.summary);
    expect(snapshot.selectedContext?.content.tone).toEqual({ text: null, language: null });
    expect(snapshot.selectedContext?.nameOriginal.text).toBe("سياق أصلي / Original name");
    expect(snapshot.selectedContext?.content.positioning.text).toBe("  تموضع أصلي\nOriginal positioning  ");
    expect(snapshot.references.kind).toBe("MANIFEST");
    const changedSnapshots: unknown[] = [
      { ...snapshot, conversation: [{ text: "synthetic private conversation" }] },
      { ...snapshot, narrative: "synthetic private narrative" },
      { ...snapshot, proposals: [] },
      { ...snapshot, brief: { ...snapshot.brief, approvedAt: new Date(a.approvedAt.getTime() + 1).toISOString() } },
      { ...snapshot, brief: { ...snapshot.brief, content: { ...snapshot.brief.content, requirements: { ...snapshot.brief.content.requirements, summary: "replaced original" } } } },
      { ...snapshot, provenance: { ...snapshot.provenance, selectionRevision: 2 } },
      { ...snapshot, selectedContext: other.snapshot.selectedContext },
      { ...snapshot, references: other.snapshot.references }, // Same empty hash is not the same captured manifest.
      { ...snapshot, references: { kind: "LEGACY_ABSENT" } },
      { ...snapshot, references: { kind: "NO_CONTEXT" } },
    ];
    for (const altered of changedSnapshots) await constrained(insert("ManagedOrderSubmission", submissionData(a, parent, 2,
      { snapshot: altered, snapshotHash: canonicalHash(altered) })));
    for (const altered of [{ briefVersion: 2 }, { inputRevision: 2 }, { campaignRevision: 2 }, { planningRevision: 2 },
      { approvedByUserId: f.other.user.id }, { approvedAt: new Date(a.approvedAt.getTime() + 1) }, { snapshotHash: "b".repeat(64) },
      { disclosureVersion: "unreviewed-disclosure" }, { contextReferenceSubmissionId: other.context!.submissionId }, { contextReferenceSubmissionId: null }]) {
      await constrained(insert("ManagedOrderSubmission", submissionData(a, parent, 2, altered)));
    }
    await constrained(insert("ManagedOrderSubmission", submissionData(a, parent, 2, { workspaceId: f.b.id })), ["23503", "23514"]);
    await constrained(insert("ManagedOrderSubmission", submissionData(a, parent, 2, { briefId: other.briefId })), ["23503", "23514"]);
    for (const changed of [{ snapshot: { replaced: true } }, { snapshotHash: "a".repeat(64) }, { submittedByUserId: f.other.user.id },
      { selectionId: other.selectionId }, { createdAt: new Date() }]) await constrained(patch("ManagedOrderSubmission", String(saved.id), changed));
    await constrained(prisma.$executeRaw`UPDATE "CampaignBrief" SET content='{}'::jsonb WHERE id=${a.briefId}`);
    await constrained(prisma.$executeRaw`DELETE FROM "ContextSubmissionReferences" WHERE "submissionId"=${a.context!.submissionId}`, retention);
    await constrained(prisma.$executeRaw`DELETE FROM "ContextReferenceManifest" WHERE id=${a.context!.references.id}`, retention);
    expect(await row("ManagedOrderSubmission", String(saved.id))).toEqual(before);

    await insert("ManagedOrderState", stateData(parent, saved));
    const receipt = commandData(a, parent, saved); await insert("ManagedOrderCommand", receipt);
    for (const privateKey of ["snapshot", "content", "conversation", "narrative", "proposals", "contacts", "session", "authority", "supplierCost"]) {
      await constrained(insert("ManagedOrderCommand", commandData(a, parent, saved, { result: { ...receipt.result, [privateKey]: "synthetic-private-canary" } })));
    }
    for (const result of [[], { ...receipt.result, revision: { value: 1 } }, { ...receipt.result, orderId: parent.id + "-wrong" },
      { ...receipt.result, submissionId: key() }, { ...receipt.result, briefId: other.briefId }, { ...receipt.result, selectionRevision: 2 },
      { ...receipt.result, action: "PAY" }, { ...receipt.result, briefVersion: 2147483647 },
      { ...receipt.result, orderId: "x".repeat(4097) }]) {
      await constrained(insert("ManagedOrderCommand", commandData(a, parent, saved, { result })));
    }
    const { selectionId: omittedSelection, ...incomplete } = receipt.result; void omittedSelection;
    await constrained(insert("ManagedOrderCommand", commandData(a, parent, saved, { result: incomplete })));
    for (const changed of [{ operationKey: "not-a-uuid" }, { payloadHash: "A".repeat(64) }, { action: "PAY" }]) {
      await constrained(insert("ManagedOrderCommand", commandData(a, parent, saved, changed)));
    }
    const noneSource = await source(f.own, false), noneParent = await order(noneSource), none = await submission(noneSource, noneParent);
    expect(none.snapshot).toMatchObject({ selectedContext: null, references: { kind: "NO_CONTEXT" } });
    expect(none.contextReferenceSubmissionId).toBeNull();
    // This generated source really remains unapproved; a claimed snapshot cannot grant approval.
    const unapproved = await source(f.own, false, false), unapprovedParent = await order(unapproved);
    await constrained(insert("ManagedOrderSubmission", submissionData(unapproved, unapprovedParent)));
  });

  it("requires consecutive submission/state versions and a new exact current pointer without operational status escalation", async () => {
    await requireStorage(); const f = await fixture(), a = await source(f.own), foreign = await source(f.a);
    const parent = await order(a), otherParent = await order(foreign), first = await submission(a, parent), other = await submission(foreign, otherParent);
    for (const altered of [{ revision: 0 }, { revision: 2 }, { submissionVersion: 0 }, { submissionVersion: 2 }, { status: "PAID" }]) {
      await constrained(insert("ManagedOrderState", stateData(parent, first, altered)));
    }
    await constrained(insert("ManagedOrderState", stateData(parent, first, { submissionId: other.id })), ["23503", "23514"]);
    const initial = stateData(parent, first); await insert("ManagedOrderState", initial);
    const initialBefore = await row("ManagedOrderState", parent.id, "orderId");
    for (const altered of [{ revision: 3 }, { revision: 2 }, { revision: 2, submissionVersion: 2 },
      { revision: 2, status: "APPROVED" }, { revision: 2, createdAt: new Date() }, { revision: 2, workspaceId: f.a.id }]) {
      await constrained(patch("ManagedOrderState", parent.id, altered, "orderId"));
    }
    expect(await row("ManagedOrderState", parent.id, "orderId")).toEqual(initialBefore);
    for (const version of [0, 3, 2147483647]) await constrained(insert("ManagedOrderSubmission", submissionData(a, parent, version)));
    const second = await submission(a, parent, 2);
    await patch("ManagedOrderState", parent.id, { revision: 2, submissionId: second.id, submissionVersion: 2, updatedAt: new Date() }, "orderId");
    expect(await row("ManagedOrderState", parent.id, "orderId")).toMatchObject({ revision: 2, submissionId: second.id, submissionVersion: 2, status: "REQUESTED" });
    await constrained(patch("ManagedOrderState", parent.id, { revision: 3, submissionId: first.id, submissionVersion: 1 }, "orderId"));
    await constrained(prisma.$executeRaw`DELETE FROM "ManagedOrderSubmission" WHERE id=${second.id}`, retention);
    expect((await row("ManagedOrderSubmission", String(first.id))).snapshot).toEqual(first.snapshot);
  });

  it("serializes duplicate order/command inserts and retains old receipt children after the current state advances", async () => {
    await requireStorage(); const f = await fixture(), a = await source(f.a), firstOrder = orderData(a), secondOrder = orderData(a);
    await uniqueRace("ManagedOrder", firstOrder, secondOrder);
    expect(await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM "ManagedOrder" WHERE "campaignId"=${a.campaignId}`).toEqual([{ count: 1 }]);
    expect(await row("ManagedOrder", firstOrder.id)).toEqual(firstOrder);
    const first = await submission(a, firstOrder); await insert("ManagedOrderState", stateData(firstOrder, first));
    const firstCommand = commandData(a, firstOrder, first), secondCommand = commandData(a, firstOrder, first,
      { operationKey: firstCommand.operationKey, payloadHash: canonicalHash({ syntheticAlteredReplay: true }) });
    await uniqueRace("ManagedOrderCommand", firstCommand, secondCommand);
    expect(await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM "ManagedOrderCommand"
      WHERE "actorUserId"=${firstCommand.actorUserId} AND "operationKey"=${firstCommand.operationKey}`).toEqual([{ count: 1 }]);
    const historicalReceipt = await row("ManagedOrderCommand", firstCommand.id), historicalSubmission = await row("ManagedOrderSubmission", String(first.id));
    const second = await submission(a, firstOrder, 2);
    await patch("ManagedOrderState", firstOrder.id, { revision: 2, submissionId: second.id, submissionVersion: 2, updatedAt: new Date() }, "orderId");
    expect((await row("ManagedOrderState", firstOrder.id, "orderId")).submissionId).toBe(second.id);
    for (const changed of [{ operationKey: key() }, { payloadHash: "a".repeat(64) }, { actorUserId: f.other.user.id },
      { submissionId: second.id, submissionVersion: 2 }, { result: {} }, { createdAt: new Date() }]) {
      await constrained(patch("ManagedOrderCommand", firstCommand.id, changed));
    }
    // The command's scalar composite FK retains version one even when State no longer points at it.
    await constrained(prisma.$executeRaw`DELETE FROM "ManagedOrderSubmission" WHERE id=${first.id}`, retention);
    await constrained(prisma.$executeRaw`DELETE FROM "ManagedOrder" WHERE id=${firstOrder.id}`, retention);
    expect(await row("ManagedOrderCommand", firstCommand.id)).toEqual(historicalReceipt);
    expect(await row("ManagedOrderSubmission", String(first.id))).toEqual(historicalSubmission);
    expect(historicalReceipt.result).toMatchObject({ revision: 1, submissionVersion: 1, submissionId: first.id });
    expect(await prisma.campaign.findUniqueOrThrow({ where: { id: a.campaignId }, select: { input: true, conversation: true } })).toEqual({
      input: { schemaVersion: 1, fields, fieldsRevision: 1, proposals: [], clarificationCount: 0 }, conversation: [] });
  });
});
