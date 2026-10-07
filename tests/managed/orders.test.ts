import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { canonicalHash } from "@/lib/onboarding/drafts";
import type { OrganizationActor } from "@/lib/organizations/context";
import type { ClientCapabilities } from "@/lib/organizations/contracts";
import { getClientAuthority } from "@/lib/organizations/loaders";
import { acceptMembership, authorizeClientAssociation, createOrganization, proposeClientAssociation,
  proposeMember, setClientGrant } from "@/lib/organizations/service";
import { BrandContextContentSchema, type PlanningScope } from "@/lib/brand-context/contracts";
import { executeBrandContextCommand, decideContextOwnerReview, getApprovedBrandContextVersion } from "@/lib/brand-context/service";
import { executeContextReferenceCommand, getContextReferences, getCampaignReviewReferences } from "@/lib/brand-context/references";
import { executeCampaignPlanningCommand, getPlanningCampaign, decideCampaignOwnerReview } from "@/lib/campaign-planning/service";
import { campaignBriefDTO } from "@/lib/campaigns/core";
import { createLocalEvidenceStorage, type EvidenceStorage } from "@/lib/evidence/storage";
import { submitManagedOrder, getManagedOrder, listManagedOrders } from "@/lib/managed/orders";
import { campaignFields } from "../campaigns/fixtures";

// Exactly three complete native groups. Root alone adopts/runs guarded targets.
// Signed sessions, agency consent, M03 approvals, local PNG storage and SQL rows
// are real synthetic task-local witnesses, not live legal/commercial/provider
// acceptance. No authority/producer/Date mock or .test module import is used.
const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>(), creators = new Set<string>();
const files: Array<{ storage: EvidenceStorage; key: string }> = [];
const key = () => randomUUID(), disclosureVersion = "infame-order-disclosure-v1" as const;
const all: ClientCapabilities = { view: true, plan: true, approveShortlist: true, reviewContent: true,
  signCustomer: true, financial: true, manageGrants: true };
const none: ClientCapabilities = { view: false, plan: false, approveShortlist: false, reviewContent: false,
  signCustomer: false, financial: false, manageGrants: false };
const privateNarrative = "Unsubmitted agency narrative must stay private";
const privateProposal = "Unapproved proposal must stay private";
const privateContextDraft = "Unapproved context edit must stay private";
const approvedPositioning = "  تموضع أصلي معتمد\nOriginal approved positioning  ";
const contextContent = BrandContextContentSchema.parse({ schemaVersion: 1,
  positioning: { text: approvedPositioning, language: "ar" }, values: [],
  tone: { text: "Approved original tone", language: "en" }, references: [], competitors: [] });
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1kAAAAASUVORK5CYII=", "base64"));
const labelOriginal = { text: "  مرجع معتمد / Approved reference  ", language: "ar" };
const notesOriginal = { text: " \tملاحظة أصلية\nOriginal retained notes\r ", language: "ar" };
const managedTables = ["ManagedOrderCommand", "ManagedOrderState", "ManagedOrderSubmission", "ManagedOrder"] as const;
type ManagedTable = typeof managedTables[number];

afterEach(async () => {
  const workspaces = await prisma.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } });
  const ids = workspaces.map(row => row.id);
  if (ids.length) {
    // Managed sidecars first: their retained source/reference FKs protect M03.
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
  await prisma.deal.deleteMany({ where: { brandId: { in: [...brands] } } });
  await prisma.campaign.deleteMany({ where: { brandId: { in: [...brands] } } });
  for (const file of files) await file.storage.remove(file.key); files.length = 0;
  await prisma.evidenceCommand.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await prisma.privateAsset.deleteMany({ where: { ownerUserId: { in: [...users] } } });
  await prisma.organizationCommand.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await prisma.clientGrant.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organizationClient.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [...organizations] } } });
  await prisma.creator.deleteMany({ where: { id: { in: [...creators] } } });
  await prisma.brand.deleteMany({ where: { id: { in: [...brands] } } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
  if (users.size) await prisma.outboxEvent.deleteMany({ where: { OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
  for (const values of [users, brands, organizations, creators]) values.clear();
});
async function sign(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const token = await openSession(user.id, user.sessionVersion, user.passwordHash), native = await resolveSession(token);
  if (!native) throw new Error("Native synthetic order-service session did not resolve");
  const actor: OrganizationActor = { userId: native.userId, role: native.role, sessionId: native.sessionId, sessionVersion: native.sessionVersion };
  return { user, actor };
}
async function person(role: "BRAND" | "CREATOR" | "ADMIN" = "BRAND") {
  const id = key(); users.add(id);
  await prisma.user.create({ data: { id, role, active: true, isTest: true, name: "Synthetic M04 native actor",
    email: `${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  return sign(id);
}
async function company() {
  const owner = await person(), brand = await prisma.brand.create({ data: { userId: owner.user.id, countryCode: "KW", isTest: true,
    slug: "order-native-" + key().replace(/-/g, ""), name: "Synthetic original company" } }); brands.add(brand.id);
  return { ...owner, brand, scope: { kind: "OWN_BRAND", brandId: brand.id } as PlanningScope };
}
type Company = Awaited<ReturnType<typeof company>>;
async function agency(customer: Company, label: string) {
  const owner = await person(), seat = await person();
  const { organization } = await createOrganization(owner.actor, { operationKey: key(), nameOriginal: "Synthetic agency " + label, kind: "AGENCY" });
  organizations.add(organization.id);
  const revision = async () => (await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).revision;
  const proposal = await proposeClientAssociation(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), brandId: customer.brand.id });
  const { client } = await authorizeClientAssociation(customer.actor, proposal.client.id, { operationKey: key(), expectedRevision: proposal.client.revision, capabilities: all });
  const pending = await proposeMember(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), targetUserId: seat.user.id });
  const { membership } = await acceptMembership(seat.actor, pending.membership.id, { operationKey: key(), expectedRevision: pending.membership.revision });
  const { grant } = await setClientGrant(owner.actor, client.id, { operationKey: key(), expectedClientRevision: client.revision,
    membershipId: membership.id, expectedGrantRevision: null, capabilities: all });
  return { owner, seat, organization, client, membership, grant, customer, scope: { kind: "CLIENT", clientId: client.id } as PlanningScope };
}
type Agency = Awaited<ReturnType<typeof agency>>;
async function rights(a: Agency, capabilities: ClientCapabilities) {
  const current = await prisma.clientGrant.findUniqueOrThrow({ where: { id: a.grant.id } });
  const association = await prisma.organizationClient.findUniqueOrThrow({ where: { id: a.client.id } });
  return setClientGrant(a.owner.actor, a.client.id, { operationKey: key(), expectedClientRevision: association.revision,
    membershipId: a.membership.id, expectedGrantRevision: current.revision, capabilities });
}
async function planningAuthority(actor: OrganizationActor, scope: PlanningScope) {
  return scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(actor, scope.clientId, "plan") } : {};
}
async function context(owner: Company, actor: OrganizationActor, scope: PlanningScope, withFile: boolean) {
  const made = await executeBrandContextCommand(actor, { operationKey: key(), scope, ...await planningAuthority(actor, scope),
    action: "CREATE", expectedRevision: 0, payload: { nameOriginal: { text: "Original approved context", language: "en" }, content: contextContent } });
  let revision = made.revision;
  if (withFile) {
    // Actual guarded task-local storage, not a mocked byte/provider result.
    const taskId = process.env.INFAME_TASK_ID;
    if (!taskId) throw new Error("Guarded native reference fixture requires INFAME_TASK_ID");
    const storage = await createLocalEvidenceStorage({ taskId, target: "test" });
    const uploaded = await executeContextReferenceCommand(actor, { operationKey: key(), scope, ...await planningAuthority(actor, scope),
      contextId: made.contextId, expectedRevision: revision, expectedReferenceRevision: 0, action: "UPLOAD",
      payload: { labelOriginal, notesOriginal, contentType: "image/png", bytes: Uint8Array.from(png) } }, { storage });
    revision = uploaded.revision;
    const binding = await prisma.contextAssetBinding.findUniqueOrThrow({ where: { id: uploaded.bindingId! } });
    const asset = await prisma.privateAsset.findUniqueOrThrow({ where: { id: binding.assetId } });
    expect(asset.storageKey.startsWith("local:")).toBe(true);
    const objectKey = asset.storageKey.slice("local:".length); files.push({ storage, key: objectKey });
    expect(Uint8Array.from(await storage.get(objectKey))).toEqual(png);
  }
  const submitted = await executeBrandContextCommand(actor, { operationKey: key(), scope, ...await planningAuthority(actor, scope),
    contextId: made.contextId, expectedRevision: revision, action: "SUBMIT", payload: {} });
  const approved = await decideContextOwnerReview(owner.actor, { operationKey: key(), submissionId: submitted.submissionId!, expectedRevision: 1, decision: "APPROVE" });
  const selected = await getApprovedBrandContextVersion(actor, { scope, versionId: approved.versionId! });
  const references = await getContextReferences(actor, { scope, contextId: made.contextId, versionId: selected.version.id });
  return { contextId: made.contextId, version: selected.version, references: references.references,
    choice: { kind: "APPROVED_CONTEXT" as const, versionId: selected.version.id, contentHash: selected.version.contentHash } };
}
async function planning(actor: OrganizationActor, scope: PlanningScope, campaignId: string) {
  return getPlanningCampaign(actor, { scope, campaignId });
}
async function step(actor: OrganizationActor, scope: PlanningScope, campaignId: string, action: string, payload: unknown) {
  const current = await planning(actor, scope, campaignId);
  return executeCampaignPlanningCommand(actor, { operationKey: key(), scope, ...await planningAuthority(actor, scope), campaignId,
    expectedCampaignRevision: current.campaign.revision, expectedPlanningRevision: current.planning.revision,
    expectedSelectionId: current.planning.selection.id, expectedSelectionRevision: current.planning.selection.revision, action, payload });
}
async function approvedSource(owner: Company, actor = owner.actor, scope = owner.scope, label = "OWN", withFile = false) {
  const selected = withFile ? await context(owner, actor, scope, true) : null;
  const created = await executeCampaignPlanningCommand(actor, { operationKey: key(), scope, ...await planningAuthority(actor, scope), action: "CREATE",
    expectedCampaignRevision: 0, expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0,
    payload: { fields: { ...campaignFields, title: "حملة أصلية " + label }, selection: selected?.choice ?? { kind: "NONE" }, narrative: null } });
  await step(actor, scope, created.campaignId, "SAVE_NARRATIVE", { narrative: { schemaVersion: 1, mode: "PARAGRAPH",
    processing: "UNPROCESSED", originalText: { text: privateNarrative, language: "en" } } });
  await step(actor, scope, created.campaignId, "PROPOSE_FIELDS", { type: "PROPOSE_FIELDS", patch: { summary: privateProposal },
    originalText: { text: privateProposal, language: "en" } });
  const generated = await step(actor, scope, created.campaignId, "GENERATE_BRIEF", {});
  const submitted = await step(actor, scope, created.campaignId, "SUBMIT_BRIEF", { briefId: generated.briefId!, expectedBriefVersion: generated.version! });
  const approved = await decideCampaignOwnerReview(owner.actor, { operationKey: key(), submissionId: submitted.submissionId!, expectedRevision: 1, decision: "APPROVE" });
  expect(approved.state).toBe("APPROVED");
  const current = await planning(actor, scope, created.campaignId);
  const brief = campaignBriefDTO(await prisma.campaignBrief.findUniqueOrThrow({ where: { id: generated.briefId! } }));
  const pin = await prisma.campaignBriefProvenance.findUniqueOrThrow({ where: { briefId: brief.id } });
  const selector = await prisma.campaignContextSelection.findUniqueOrThrow({ where: { id: pin.selectionId } });
  const references = await getCampaignReviewReferences(owner.actor, { submissionId: submitted.submissionId! });
  const expectedSnapshot = { schemaVersion: 1, brief,
    provenance: { selectionId: selector.id, selectionRevision: selector.revision, versionId: selector.contextVersionId, contentHash: selector.contentHash },
    selectedContext: selected?.version ?? null, references: references.references };
  expect(current.campaign.currentBriefVersion).toBe(brief.version);
  return { owner, actor, scope, campaignId: created.campaignId, brief, workspaceId: pin.workspaceId, expectedSnapshot, selected };
}
type Source = Awaited<ReturnType<typeof approvedSource>>;
async function command(source: Source, operationKey = key()) {
  const current = await planning(source.actor, source.scope, source.campaignId);
  return { action: "SUBMIT" as const, operationKey, scope: source.scope, campaignId: source.campaignId,
    expectedCampaignRevision: current.campaign.revision, expectedPlanningRevision: current.planning.revision,
    expectedSelectionId: current.planning.selection.id, expectedSelectionRevision: current.planning.selection.revision,
    briefId: source.brief.id, expectedBriefVersion: source.brief.version, disclosureVersion,
    ...(source.scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(source.actor, source.scope.clientId, "signCustomer") } : {}) };
}
async function readRows(table: ManagedTable, workspaceId: string) {
  if (table === "ManagedOrderState") return prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT st.*,o."campaignId" FROM "ManagedOrderState" st
    JOIN "ManagedOrder" o ON o.id=st."orderId" AND o."workspaceId"=st."workspaceId"
    WHERE st."workspaceId"=${workspaceId} ORDER BY st."orderId"`;
  return prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`SELECT * FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId"=${workspaceId} ORDER BY id`);
}
async function effects() {
  const workspaces = await prisma.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true }, orderBy: { id: "asc" } });
  const rows: Record<string, unknown> = {};
  for (const table of managedTables) rows[table] = (await Promise.all(workspaces.map(row => readRows(table, row.id)))).flat();
  const [audits, events] = await Promise.all([
    prisma.adminAudit.findMany({ where: { actorUserId: { in: [...users] } }, orderBy: { id: "asc" } }),
    prisma.outboxEvent.findMany({ where: { OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) }, orderBy: { id: "asc" } }),
  ]); return JSON.stringify({ ...rows, audits, events });
}
async function counts(source: Source) {
  const values = await Promise.all(managedTables.map(table => readRows(table, source.workspaceId)));
  return Object.fromEntries(managedTables.map((table, index) => [table, values[index]!.length]));
}
async function failure(operation: Promise<unknown>, code: string | null, status = 409) {
  await expect(operation).rejects.toMatchObject(code ? { code, status } : { status });
}
function privateSafe(value: unknown) {
  const json = JSON.stringify(value);
  for (const canary of [privateNarrative, privateProposal, privateContextDraft, "storageKey", "sessionId", "passwordHash", "supplierCost", "operationsAi"]) expect(json).not.toContain(canary);
}
function latch<T>() { let resolve!: (value: T | PromiseLike<T>) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
type WaitTable = "User" | "ClientGrant" | "CampaignBrief" | "ManagedOrderCommand";
async function blocker(table: WaitTable, id: string | null, after?: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  const peer = new PrismaClient(), monitor = new PrismaClient(), ready = latch<number>(), release = latch<void>(), stop = new AbortController();
  const holding = peer.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout='4s'`;
    if (table === "ManagedOrderCommand") await tx.$executeRaw`LOCK TABLE "ManagedOrderCommand" IN SHARE MODE`;
    else await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw('"' + table + '"')} WHERE id=${id} FOR UPDATE`);
    const pids = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
    ready.resolve(pids[0]!.pid); await release.promise; if (after) await after(tx);
  }, { maxWait: 5000, timeout: 12000 }); void holding.catch(() => {});
  let pid: number;
  try { pid = await Promise.race([ready.promise, holding.then(() => { throw new Error("Blocker completed before acquiring native lock"); })]); }
  catch (error) { release.resolve(); await holding.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); throw error; }
  let waiting: Promise<number> | undefined;
  return { holding, release: () => release.resolve(), wait() {
    waiting = (async () => {
      const deadline = performance.now() + 4000;
      while (performance.now() < deadline) {
        if (stop.signal.aborted) throw new Error("Managed order wait witness cancelled");
        const rows = await monitor.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
          AND wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid)) AND query LIKE ${`%"${table}"%`}
          AND (${table} <> 'ManagedOrderCommand' OR query ILIKE '%INSERT%') ORDER BY pid`;
        if (rows.length) return rows[0]!.pid;
        await delay(20);
      } throw new Error("Order service did not reach required actual native wait");
    })(); return waiting;
  }, async close() { release.resolve(); stop.abort(); await holding.catch(() => {}); await waiting?.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); } };
}
async function witnessedWait(held: Awaited<ReturnType<typeof blocker>>, operation: Promise<unknown>) {
  void operation.catch(() => {});
  expect(await Promise.race([held.wait(), operation.then(() => { throw new Error("Order operation completed before native wait"); })])).toBeGreaterThan(0);
}

it("M04 native service group 1: OWN/two same-Brand client isolation, view/sign separation, real approved context/file disclosure and current sessions", async () => {
  const owner = await company(), outsider = await company(), a = await agency(owner, "A"), b = await agency(owner, "B");
  const own = await approvedSource(owner), first = await approvedSource(owner, a.seat.actor, a.scope, "A", true);
  const second = await approvedSource(owner, b.seat.actor, b.scope, "B"), signOnly = await approvedSource(owner, a.seat.actor, a.scope, "A-sign-only");
  expect(new Set([own.workspaceId, first.workspaceId, second.workspaceId]).size).toBe(3);
  expect(first.expectedSnapshot.references.kind).toBe("MANIFEST");
  if (!first.selected || first.selected.references.kind !== "MANIFEST") throw new Error("Actual approved native file pin was not produced");
  expect(first.selected.references.items[0]).toMatchObject({ labelOriginal, notesOriginal, contentType: "image/png", size: png.byteLength });
  // Later current context/reference changes must never replace an approved pin.
  let parent = await prisma.brandContext.findUniqueOrThrow({ where: { id: first.selected.contextId } });
  await executeBrandContextCommand(a.seat.actor, { operationKey: key(), scope: a.scope, ...await planningAuthority(a.seat.actor, a.scope),
    contextId: parent.id, expectedRevision: parent.revision, action: "UPDATE", payload: { nameOriginal: { text: "Private new context name", language: "en" },
      content: { ...contextContent, positioning: { text: privateContextDraft, language: "en" } } } });
  parent = await prisma.brandContext.findUniqueOrThrow({ where: { id: parent.id } });
  await executeContextReferenceCommand(a.seat.actor, { operationKey: key(), scope: a.scope, ...await planningAuthority(a.seat.actor, a.scope),
    contextId: parent.id, expectedRevision: parent.revision, expectedReferenceRevision: first.selected.references.revision,
    action: "REPLACE", payload: { items: [] } });
  const ownCommand = await command(own), firstCommand = await command(first), secondCommand = await command(second), signCommand = await command(signOnly);
  const beforeDenied = await effects();
  await rights(a, { ...none, view: true, plan: true });
  const afterRights = await effects();
  await failure(submitManagedOrder(a.seat.actor, firstCommand), "NOT_FOUND", 404);
  expect(await effects()).toBe(afterRights); expect(beforeDenied).not.toBe(afterRights); // Only native grant administration changed.
  await rights(a, all); firstCommand.expectedAuthority = await getClientAuthority(a.seat.actor, a.client.id, "signCustomer");
  const firstResult = await submitManagedOrder(a.seat.actor, firstCommand), ownResult = await submitManagedOrder(owner.actor, ownCommand);
  expect(firstResult).toMatchObject({ action: "SUBMIT", campaignId: first.campaignId, revision: 1, submissionVersion: 1,
    briefId: first.brief.id, briefVersion: first.brief.version, selectionId: firstCommand.expectedSelectionId, replayed: false });
  const detail = await getManagedOrder(a.seat.actor, { scope: a.scope, orderId: firstResult.orderId });
  expect(detail).toMatchObject({ scope: a.scope, currentAuthority: { clientId: a.client.id, capability: "view" }, quote: null,
    order: { id: firstResult.orderId, campaignId: first.campaignId, revision: 1, status: "REQUESTED", submission: { id: firstResult.submissionId,
      version: 1, disclosureVersion, snapshot: first.expectedSnapshot, snapshotHash: canonicalHash(first.expectedSnapshot) } } });
  expect(detail.order.submission.snapshot).toEqual(first.expectedSnapshot);
  expect(new TextEncoder().encode(JSON.stringify(detail.order.submission.snapshot)).byteLength).toBeLessThanOrEqual(262144);
  privateSafe(detail);
  for (const [actor, scope, orderId] of [[b.seat.actor, b.scope, firstResult.orderId], [owner.actor, owner.scope, firstResult.orderId],
    [a.seat.actor, a.scope, ownResult.orderId], [owner.actor, a.scope, firstResult.orderId], [a.owner.actor, a.scope, firstResult.orderId],
    [outsider.actor, outsider.scope, ownResult.orderId]] as const) await failure(getManagedOrder(actor, { scope, orderId }), "NOT_FOUND", 404);
  expect((await listManagedOrders(b.seat.actor, { scope: b.scope })).orders).toEqual([]);
  const secondResult = await submitManagedOrder(b.seat.actor, secondCommand);
  for (const [actor, scope, id] of [[owner.actor, owner.scope, ownResult.orderId], [a.seat.actor, a.scope, firstResult.orderId], [b.seat.actor, b.scope, secondResult.orderId]] as const) {
    const list = await listManagedOrders(actor, { scope });
    expect(list.orders.map(row => row.id)).toEqual([id]); expect(list.nextCursor).toBeNull(); privateSafe(list);
    expect(list.orders[0]).toMatchObject({ revision: 1, status: "REQUESTED", titleOriginal: { language: "ar" } });
    expect(Object.keys(list.orders[0]!).sort()).toEqual(["id", "campaignId", "revision", "status", "titleOriginal", "submittedAt"].sort());
  }
  await rights(a, { ...none, signCustomer: true }); signCommand.expectedAuthority = await getClientAuthority(a.seat.actor, a.client.id, "signCustomer");
  const signResult = await submitManagedOrder(a.seat.actor, signCommand);
  await failure(getManagedOrder(a.seat.actor, { scope: a.scope, orderId: signResult.orderId }), "NOT_FOUND", 404);
  await failure(listManagedOrders(a.seat.actor, { scope: a.scope }), "NOT_FOUND", 404);
  await rights(a, { ...none, view: true });
  expect((await getManagedOrder(a.seat.actor, { scope: a.scope, orderId: signResult.orderId })).order.id).toBe(signResult.orderId);
  const readOnly = await effects();
  await failure(submitManagedOrder(a.seat.actor, signCommand), "NOT_FOUND", 404); expect(await effects()).toBe(readOnly);
  const admin = await person("ADMIN");
  await failure(submitManagedOrder(admin.actor, ownCommand), "FORBIDDEN", 403);
  await failure(getManagedOrder(admin.actor, { scope: owner.scope, orderId: ownResult.orderId }), "FORBIDDEN", 403);
  await failure(listManagedOrders(admin.actor, { scope: owner.scope }), "FORBIDDEN", 403);
  await prisma.authSession.update({ where: { id: owner.actor.sessionId }, data: { revokedAt: new Date() } });
  await failure(getManagedOrder(owner.actor, { scope: owner.scope, orderId: ownResult.orderId }), "UNAUTHENTICATED", 401);
  await failure(submitManagedOrder(owner.actor, ownCommand), "UNAUTHENTICATED", 401);
}, 60000);

it("M04 native service group 2: exact lost-reply replay/key conflicts, changed source, immutable history, unique concurrent creation and any legacy Deal denial", async () => {
  const owner = await company(), source = await approvedSource(owner, owner.actor, owner.scope, "history");
  const input = await command(source), before = await effects(), first = await submitManagedOrder(owner.actor, input);
  expect(await counts(source)).toEqual({ ManagedOrderCommand: 1, ManagedOrderState: 1, ManagedOrderSubmission: 1, ManagedOrder: 1 });
  const saved = await effects(); expect(saved).not.toBe(before);
  expect(JSON.parse(saved).audits.length).toBe(JSON.parse(before).audits.length + 1);
  expect(JSON.parse(saved).events.length).toBe(JSON.parse(before).events.length + 1);
  const initial = await getManagedOrder(owner.actor, { scope: owner.scope, orderId: first.orderId });
  const originalBrief = await prisma.campaignBrief.findUniqueOrThrow({ where: { id: source.brief.id } });
  await step(owner.actor, owner.scope, source.campaignId, "UPDATE_FIELDS", { patch: { summary: "New unapproved source summary" } });
  const changedSource = await planning(owner.actor, owner.scope, source.campaignId);
  expect(changedSource.campaign.currentBriefVersion).toBeNull();
  expect(await prisma.campaignBrief.findUniqueOrThrow({ where: { id: source.brief.id } })).toEqual(originalBrief);
  const afterSource = await effects();
  // Simulate a lost client reply by reusing exactly the captured original command.
  expect(await submitManagedOrder(owner.actor, input)).toEqual({ ...first, replayed: true });
  expect(await effects()).toBe(afterSource);
  expect((await getManagedOrder(owner.actor, { scope: owner.scope, orderId: first.orderId })).order.submission).toEqual(initial.order.submission);
  const afterRead = await effects();
  await failure(submitManagedOrder(owner.actor, { ...input, expectedCampaignRevision: input.expectedCampaignRevision + 1 }), "IDEMPOTENCY_CONFLICT");
  await failure(submitManagedOrder(owner.actor, { ...input, operationKey: key() }), "ORDER_ALREADY_REQUESTED");
  expect(await effects()).toBe(afterRead);
  await expect(prisma.$executeRaw`UPDATE "ManagedOrderSubmission" SET snapshot='{}'::jsonb WHERE id=${first.submissionId}`).rejects.toMatchObject({ code: "P2010" });
  expect((await getManagedOrder(owner.actor, { scope: owner.scope, orderId: first.orderId })).order.submission).toEqual(initial.order.submission);

  const staleSource = await approvedSource(owner, owner.actor, owner.scope, "stale"), stale = await command(staleSource);
  await step(owner.actor, owner.scope, staleSource.campaignId, "UPDATE_FIELDS", { patch: { summary: "Changed before managed disclosure" } });
  const staleBefore = await effects();
  await failure(submitManagedOrder(owner.actor, stale), "STALE_VERSION");
  const current = await planning(owner.actor, owner.scope, staleSource.campaignId);
  await failure(submitManagedOrder(owner.actor, { ...stale, operationKey: key(), expectedCampaignRevision: current.campaign.revision,
    expectedPlanningRevision: current.planning.revision, expectedSelectionId: current.planning.selection.id,
    expectedSelectionRevision: current.planning.selection.revision }), null);
  expect(await effects()).toBe(staleBefore);

  const scopedSource = await approvedSource(owner, owner.actor, owner.scope, "foreign brief denial"), foreignOwner = await company();
  const foreignSource = await approvedSource(foreignOwner, foreignOwner.actor, foreignOwner.scope, "foreign retained brief");
  const foreignInput = { ...await command(scopedSource), briefId: foreignSource.brief.id };
  const foreignBefore = await effects(), heldForeign = await blocker("CampaignBrief", foreignSource.brief.id);
  const foreignAttempt = submitManagedOrder(owner.actor, foreignInput);
  const foreignOutcome = foreignAttempt.then(() => ({ kind: "completed" as const }),
    (error: { status?: number; code?: string }) => ({ kind: "denied" as const, status: error.status, code: error.code }));
  try {
    // A foreign brief must be rejected by scoped metadata before acquiring its
    // row lock. The competing witness observes the actual PostgreSQL blocker.
    const outcome = await Promise.race([foreignOutcome, heldForeign.wait().then(pid => ({ kind: "blocked" as const, pid }))]);
    expect(outcome).toMatchObject({ kind: "denied", status: 409 });
    await failure(foreignAttempt, null); expect(await effects()).toBe(foreignBefore);
  } finally { await heldForeign.close(); await foreignAttempt.catch(() => {}); }

  const concurrent = await approvedSource(owner, owner.actor, owner.scope, "concurrent"), firstInput = await command(concurrent), secondInput = { ...firstInput, operationKey: key() };
  const outcomes = await Promise.allSettled([submitManagedOrder(owner.actor, firstInput), submitManagedOrder(owner.actor, secondInput)]);
  expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
  const denied = outcomes.find(outcome => outcome.status === "rejected");
  if (!denied || denied.status !== "rejected") throw new Error("Concurrent native create did not leave one rejected contender");
  expect(denied.reason).toMatchObject({ code: "ORDER_ALREADY_REQUESTED", status: 409 });
  const nativeOrders = await readRows("ManagedOrder", source.workspaceId);
  expect(nativeOrders.filter(row => row.campaignId === concurrent.campaignId)).toHaveLength(1);
  for (const table of managedTables) expect((await readRows(table, source.workspaceId)).filter(row => row.campaignId === concurrent.campaignId)).toHaveLength(1);

  const legacy = await approvedSource(owner, owner.actor, owner.scope, "retained direct"), creatorUser = await person("CREATOR");
  const creator = await prisma.creator.create({ data: { userId: creatorUser.user.id, handle: "managed_" + creatorUser.user.id.slice(0, 8),
    displayName: "Synthetic retained direct creator", isTest: true } }); creators.add(creator.id);
  // Any retained Deal suffices. This native declined row claims no offer signature
  // or real creator consent; its exact saved identity/history must be untouched.
  const deal = await prisma.deal.create({ data: { campaignId: legacy.campaignId, brandId: owner.brand.id, creatorId: creator.id,
    briefVersion: legacy.brief.version, status: "DECLINED", origin: "DIRECT" } });
  const legacyBefore = await effects();
  await failure(submitManagedOrder(owner.actor, await command(legacy)), "LEGACY_CAMPAIGN");
  expect(await effects()).toBe(legacyBefore); expect(await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).toEqual(deal);
  expect(await prisma.campaignBrief.findUniqueOrThrow({ where: { id: legacy.brief.id } })).toMatchObject({ approvedByUserId: owner.user.id });
  const list = await listManagedOrders(owner.actor, { scope: owner.scope, limit: 1 });
  expect(list.orders).toHaveLength(1); expect(list.nextCursor).toBe(list.orders[0]!.id);
  const next = await listManagedOrders(owner.actor, { scope: owner.scope, after: list.nextCursor!, limit: 1 });
  expect(next.orders).toHaveLength(1); expect(next.orders[0]!.id > list.orders[0]!.id).toBe(true); expect(next.nextCursor).toBeNull();
}, 60000);

it("M04 native service group 3: proven grant/User waits deny fresh work and replay; real final expiry rolls back every native side effect", async () => {
  const owner = await company(), a = await agency(owner, "waits"), savedSource = await approvedSource(owner, a.seat.actor, a.scope, "saved"),
    waitingSource = await approvedSource(owner, a.seat.actor, a.scope, "grant-wait"), own = await approvedSource(owner, owner.actor, owner.scope, "expiry");
  const savedInput = await command(savedSource), waitingInput = await command(waitingSource);
  await submitManagedOrder(a.seat.actor, savedInput);
  const grantBefore = await effects(), heldGrant = await blocker("ClientGrant", a.grant.id, tx => tx.clientGrant.update({ where: { id: a.grant.id },
    data: { signCustomer: false, revision: { increment: 1 } } }));
  const denied = submitManagedOrder(a.seat.actor, waitingInput);
  try {
    await witnessedWait(heldGrant, denied); heldGrant.release(); await heldGrant.holding;
    await failure(denied, "NOT_FOUND", 404); expect(await effects()).toBe(grantBefore);
    await failure(submitManagedOrder(a.seat.actor, savedInput), "NOT_FOUND", 404); expect(await effects()).toBe(grantBefore);
    expect((await listManagedOrders(a.seat.actor, { scope: a.scope })).orders.map(row => row.campaignId)).toEqual([savedSource.campaignId]);
  } finally { await heldGrant.close(); await denied.catch(() => {}); }

  const ownInput = await command(own), userBefore = await effects();
  const heldUser = await blocker("User", owner.user.id, tx => tx.authSession.update({ where: { id: owner.actor.sessionId }, data: { revokedAt: new Date() } }));
  const revoked = submitManagedOrder(owner.actor, ownInput);
  try {
    await witnessedWait(heldUser, revoked); heldUser.release(); await heldUser.holding;
    await failure(revoked, "UNAUTHENTICATED", 401); expect(await effects()).toBe(userBefore);
  } finally { await heldUser.close(); await revoked.catch(() => {}); }
  const fresh = await sign(owner.user.id); own.actor = fresh.actor; owner.actor = fresh.actor;
  const expiryInput = await command(own), expiresAt = new Date(Date.now() + 2500);
  await prisma.authSession.update({ where: { id: fresh.actor.sessionId }, data: { expiresAt } });
  const expiryBefore = await effects(), heldJournal = await blocker("ManagedOrderCommand", null);
  const expired = submitManagedOrder(fresh.actor, expiryInput);
  try {
    await witnessedWait(heldJournal, expired); expect(Date.now()).toBeLessThan(expiresAt.getTime());
    while (Date.now() <= expiresAt.getTime()) await delay(Math.min(50, expiresAt.getTime() - Date.now() + 1));
    heldJournal.release(); await heldJournal.holding; await failure(expired, "UNAUTHENTICATED", 401);
    expect(await effects()).toBe(expiryBefore);
    for (const table of managedTables) expect((await readRows(table, own.workspaceId)).filter(row => row.campaignId === own.campaignId)).toEqual([]);
    expect(await prisma.campaignBrief.findUniqueOrThrow({ where: { id: own.brief.id } })).toMatchObject({ id: own.brief.id, approvedByUserId: owner.user.id });
  } finally { await heldJournal.close(); await expired.catch(() => {}); }
}, 60000);
