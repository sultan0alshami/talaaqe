import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { createOrganization, proposeClientAssociation, authorizeClientAssociation, proposeMember, acceptMembership, setClientGrant } from "@/lib/organizations/service";
import { getClientAuthority } from "@/lib/organizations/loaders";
import type { OrganizationActor } from "@/lib/organizations/context";
import type { ClientCapabilities } from "@/lib/organizations/contracts";
import { PlanningScopeSchema, BrandContextContentSchema, type PlanningScope } from "@/lib/brand-context/contracts";
import { executeBrandContextCommand, getContextOwnerReview, decideContextOwnerReview, getApprovedBrandContextVersion } from "@/lib/brand-context/service";
import { executeContextReferenceCommand, getContextReferences, getContextReferenceAsset, getContextReviewReferenceAsset,
  getContextReviewReferences, getCampaignReviewReferences, getCampaignReviewReferenceAsset } from "@/lib/brand-context/references";
import { executeCampaignPlanningCommand, getPlanningCampaign } from "@/lib/campaign-planning/service";
import { resolveCampaignPolicyReview } from "@/lib/policies";
import { campaignFields } from "../campaigns/fixtures";
import { getPrivateAsset, uploadPrivateAsset, getBrandEvidence } from "@/lib/evidence/service";
import { EvidenceError, inspectEvidence, type EvidenceStorage } from "@/lib/evidence/storage";

// Four native signed-session/organization groups. Only immutable byte storage is
// a local map seam; there is no mocked authority or producer reply, external
// provider, actual customer consent, malware scan, or live storage acceptance.
const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>();
const key = () => randomUUID();
const caps = (plan = true): ClientCapabilities => ({ view: true, plan, approveShortlist: false, reviewContent: false,
  signCustomer: false, financial: false, manageGrants: false });
const allCaps: ClientCapabilities = { view: true, plan: true, approveShortlist: true, reviewContent: true,
  signCustomer: true, financial: true, manageGrants: true };
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1kAAAAASUVORK5CYII=", "base64"));
const labelOriginal = { text: "  مرجع أصلي / Original reference  ", language: "ar" };
const notesOriginal = { text: " \tالكلمات الأصلية\nOriginal notes\r ", language: "ar" };
const nameOriginal = { text: "Native original context", language: "en" };
const content = BrandContextContentSchema.parse({ schemaVersion: 1, positioning: { text: null, language: null },
  values: [], tone: { text: "Original text-only tone", language: "en" },
  references: [{ label: { text: "Original HTTPS reference", language: "en" }, url: "https://example.invalid/original",
    notes: { text: null, language: null } }], competitors: [] });

const original = z.object({ text: z.string(), language: z.string().nullable() }).strict();
const nullableOriginal = z.object({ text: z.string().nullable(), language: z.string().nullable() }).strict();
const itemSchema = z.object({ bindingId: z.string().min(1), assetId: z.string().min(1), labelOriginal: original,
  notesOriginal: nullableOriginal, contentType: z.string(), size: z.number().int().positive() }).strict();
const manifestSchema = z.object({ kind: z.literal("MANIFEST"), id: z.string().min(1), revision: z.number().int().positive(),
  hash: z.string().regex(/^[a-f0-9]{64}$/), items: z.array(itemSchema).max(20) }).strict();
const referencesSchema = z.object({ contextId: z.string().min(1), revision: z.number().int().positive(),
  inputRevision: z.number().int().positive(), archived: z.boolean(), versionId: z.string().min(1).nullable(), scope: PlanningScopeSchema, currentAuthority: z.unknown(), references: z.union([
  z.object({ kind: z.literal("LEGACY_ABSENT") }).strict(), manifestSchema,
]) }).strict();
const resultSchema = z.object({ contextId: z.string().min(1), revision: z.number().int().positive(), referenceRevision: z.number().int().positive(),
  manifestId: z.string().min(1), manifestHash: z.string().regex(/^[a-f0-9]{64}$/), bindingId: z.string().nullable(), replayed: z.boolean() }).strict();
const fileSchema = z.object({ bytes: z.instanceof(Uint8Array), headers: z.record(z.string(), z.string()) }).strict();
type Manifest = z.infer<typeof manifestSchema>;
function manifest(value: z.infer<typeof referencesSchema>): Manifest {
  if (value.references.kind !== "MANIFEST") throw new Error("Expected an actual persisted reference manifest");
  return value.references;
}
function byteMap() {
  const objects = new Map<string, Uint8Array>(), reads: string[] = [], writes: string[] = [];
  const storage: EvidenceStorage = { kind: "LOCAL",
    async put(objectKey, bytes, type) {
      const inspected = inspectEvidence(bytes, type), existing = objects.get(objectKey); writes.push(objectKey);
      if (existing) {
        if (inspectEvidence(existing, type).checksum !== inspected.checksum) throw new EvidenceError("STORAGE_CONFLICT");
        return { created: false };
      }
      objects.set(objectKey, Uint8Array.from(bytes)); return { created: true };
    },
    async get(objectKey) {
      reads.push(objectKey); const bytes = objects.get(objectKey);
      if (!bytes) throw new EvidenceError("ASSET_BYTES_UNAVAILABLE", 503);
      return Uint8Array.from(bytes);
    },
    async remove(objectKey) { objects.delete(objectKey); },
  };
  return { storage, objects, reads, writes };
}

afterEach(async () => {
  const workspaces = await prisma.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } });
  const ids = workspaces.map(row => row.id);
  if (ids.length) {
    // The scaffold RED precedes additive DDL. Cleanup is restricted to this
    // group's workspaces and checks each optional table before referencing it.
    for (const table of ["ContextReferenceCommand", "ContextSubmissionReferences", "ContextReferenceState", "ContextReferenceManifest", "ContextAssetBinding"] as const) {
      const exists = await prisma.$queryRaw<Array<{ present: boolean }>>`SELECT to_regclass(${`"${table}"`}) IS NOT NULL AS present`;
      if (exists[0]?.present) await prisma.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join(ids)})`);
    }
    for (const table of ["PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission", "CampaignBriefProvenance",
      "CampaignProposalDependency", "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding", "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const) {
      await prisma.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join(ids)})`);
    }
    await prisma.planningWorkspace.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.evidenceCommand.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await prisma.privateAsset.deleteMany({ where: { ownerUserId: { in: [...users] } } });
  await prisma.organizationCommand.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await prisma.clientGrant.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organizationClient.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [...organizations] } } });
  // Existing workspace cleanup already removes planning submissions, provenance,
  // selections and bindings. Delete only this fixture's native Campaign rows.
  await prisma.campaign.deleteMany({ where: { brandId: { in: [...brands] } } });
  await prisma.brand.deleteMany({ where: { id: { in: [...brands] } } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
  if (users.size) await prisma.outboxEvent.deleteMany({ where: { OR: [...users].map(id => ({ payload: { path: ["actorUserId"], equals: id } })) } });
  await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
  users.clear(); brands.clear(); organizations.clear();
});
async function person(role: "BRAND" | "ADMIN" = "BRAND") {
  const id = key(); users.add(id);
  const user = await prisma.user.create({ data: { id, role, active: true, isTest: true, name: "Synthetic native reference actor",
    email: `${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  const token = await openSession(id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Actual synthetic reference session did not resolve");
  const actor: OrganizationActor = { userId: session.userId, role: session.role, sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  return { user, actor };
}
async function company() {
  const owner = await person(), brand = await prisma.brand.create({ data: { userId: owner.user.id,
    slug: "reference-native-" + key().replace(/-/g, "").slice(0, 14), name: "Synthetic reference company", countryCode: "SA", isTest: true } });
  brands.add(brand.id); return { ...owner, brand };
}
async function member(owner: Awaited<ReturnType<typeof person>>, organizationId: string) {
  const seat = await person(), organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const proposed = await proposeMember(owner.actor, organizationId, { operationKey: key(), expectedOrganizationRevision: organization.revision, targetUserId: seat.user.id });
  const accepted = await acceptMembership(seat.actor, proposed.membership.id, { operationKey: key(), expectedRevision: proposed.membership.revision });
  return { ...seat, membership: accepted.membership };
}
async function agency(customer: Awaited<ReturnType<typeof company>>) {
  const owner = await person(), { organization } = await createOrganization(owner.actor, { operationKey: key(), kind: "AGENCY", nameOriginal: "Synthetic reference agency" });
  organizations.add(organization.id);
  const proposed = await proposeClientAssociation(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: organization.revision, brandId: customer.brand.id });
  const { client } = await authorizeClientAssociation(customer.actor, proposed.client.id, { operationKey: key(), expectedRevision: proposed.client.revision, capabilities: allCaps });
  const seat = await member(owner, organization.id), { grant } = await setClientGrant(owner.actor, client.id, { operationKey: key(), expectedClientRevision: client.revision,
    membershipId: seat.membership.id, expectedGrantRevision: null, capabilities: caps() });
  return { owner, organization, client, seat, grant, customer };
}
const ownScope = (owner: Awaited<ReturnType<typeof company>>): PlanningScope => ({ kind: "OWN_BRAND", brandId: owner.brand.id });
const clientScope = (a: Awaited<ReturnType<typeof agency>>): PlanningScope => ({ kind: "CLIENT", clientId: a.client.id });
async function authority(actor: OrganizationActor, scope: PlanningScope) {
  return scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(actor, scope.clientId, "plan") } : {};
}
async function createContext(actor: OrganizationActor, scope: PlanningScope) {
  return executeBrandContextCommand(actor, { operationKey: key(), scope, ...await authority(actor, scope), action: "CREATE", expectedRevision: 0,
    payload: { nameOriginal, content } });
}
async function submit(actor: OrganizationActor, scope: PlanningScope, contextId: string, expectedRevision: number) {
  const result = await executeBrandContextCommand(actor, { operationKey: key(), scope, ...await authority(actor, scope), contextId, expectedRevision, action: "SUBMIT", payload: {} });
  if (!result.submissionId) throw new Error("Actual native context submission omitted identity");
  return { ...result, submissionId: result.submissionId };
}
async function approve(actor: OrganizationActor, submissionId: string) {
  const result = await decideContextOwnerReview(actor, { operationKey: key(), submissionId, expectedRevision: 1, decision: "APPROVE" });
  if (!result.versionId) throw new Error("Actual native approval omitted version identity");
  return { ...result, versionId: result.versionId };
}
async function referenceCommand(actor: OrganizationActor, scope: PlanningScope, contextId: string, expectedRevision: number, expectedReferenceRevision: number,
  action: "UPLOAD" | "REPLACE", payload: unknown) {
  return { operationKey: key(), scope, ...await authority(actor, scope), contextId, expectedRevision, expectedReferenceRevision, action, payload };
}
const uploadPayload = () => ({ labelOriginal, notesOriginal, contentType: "image/png", bytes: Uint8Array.from(png) });
const capturedItem = (bindingId: string) => ({ bindingId, labelOriginal, notesOriginal });
async function rejected(operation: Promise<unknown>, code: string, status = 409) { await expect(operation).rejects.toMatchObject({ code, status }); }
function assertFile(value: unknown) {
  const file = fileSchema.parse(value); expect(file.bytes).toEqual(png);
  expect(file.headers).toMatchObject({ "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  expect(file.headers["Content-Disposition"]).toMatch(/^attachment;/); return file;
}
function latch<T>() { let resolve!: (value: T | PromiseLike<T>) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
async function blocker(table: "User" | "ClientGrant", id: string, afterRelease: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  const peer = new PrismaClient(), monitor = new PrismaClient(), ready = latch<number>(), release = latch<void>(), stop = new AbortController();
  const holding = peer.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout='4s'`;
    const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
    await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw('"' + table + '"')} WHERE id=${id} FOR UPDATE`);
    ready.resolve(pid!); await release.promise; await afterRelease(tx);
  }, { maxWait: 5000, timeout: 12000 }); void holding.catch(() => {});
  let pid: number;
  try { pid = await Promise.race([ready.promise, holding.then(() => { throw new Error("Native reference blocker exited before locking"); })]); }
  catch (error) { release.resolve(); await holding.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); throw error; }
  let waiting: Promise<number> | undefined;
  return { holding, release: () => release.resolve(), wait() {
    waiting = (async () => {
      const deadline = performance.now() + 4000;
      while (performance.now() < deadline) {
        if (stop.signal.aborted) throw new Error("Native reference wait cancelled");
        const rows = await monitor.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
          AND wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid)) AND query LIKE ${`%"${table}"%`} ORDER BY pid`;
        if (rows.length) return rows[0]!.pid;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error("Reference command did not reach the actual required native wait");
    })(); return waiting;
  }, async close() { release.resolve(); stop.abort(); await holding.catch(() => {}); await waiting?.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); } };
}

describe("M03 private context references: four native signed synthetic groups", () => {
  it("binds uploads and view downloads to exact CLIENT context while rejecting planning-free writes and generic uploader/admin access", async () => {
    const customer = await company(), a = await agency(customer), b = await agency(customer), store = byteMap();
    const scope = clientScope(a), made = await createContext(a.seat.actor, scope);
    const uploaded = resultSchema.parse(await executeContextReferenceCommand(a.seat.actor,
      await referenceCommand(a.seat.actor, scope, made.contextId, made.revision, 0, "UPLOAD", uploadPayload()), store));
    expect(uploaded).toMatchObject({ contextId: made.contextId, revision: made.revision + 1, referenceRevision: 1, replayed: false });
    const current = referencesSchema.parse(await getContextReferences(a.seat.actor, { scope, contextId: made.contextId }, store)), saved = manifest(current);
    expect(current.scope).toEqual(scope); expect(current.currentAuthority).toMatchObject({ clientId: a.client.id, capability: "view" });
    expect(current).toMatchObject({ contextId: made.contextId, revision: uploaded.revision, inputRevision: made.inputRevision, archived: false, versionId: null });
    expect(saved).toMatchObject({ id: uploaded.manifestId, revision: 1, hash: uploaded.manifestHash });
    expect(saved.items).toHaveLength(1); expect(saved.items[0]).toMatchObject({ bindingId: uploaded.bindingId, labelOriginal, notesOriginal, contentType: "image/png", size: png.byteLength });
    const item = saved.items[0]!;
    assertFile(await getContextReferenceAsset(a.seat.actor, { scope, contextId: made.contextId, bindingId: item.bindingId }, store));
    const viewer = await member(a.owner, a.organization.id);
    await setClientGrant(a.owner.actor, a.client.id, { operationKey: key(), expectedClientRevision: a.client.revision,
      membershipId: viewer.membership.id, expectedGrantRevision: null, capabilities: caps(false) });
    expect(manifest(referencesSchema.parse(await getContextReferences(viewer.actor, { scope, contextId: made.contextId }, store)))).toEqual(saved);
    assertFile(await getContextReferenceAsset(viewer.actor, { scope, contextId: made.contextId, bindingId: item.bindingId }, store));
    const forgedPlan = { ...await getClientAuthority(viewer.actor, a.client.id, "view"), capability: "plan" };
    const deniedWrite = { operationKey: key(), scope, contextId: made.contextId, expectedRevision: uploaded.revision, expectedReferenceRevision: 1,
      expectedAuthority: forgedPlan, action: "REPLACE", payload: { items: [] } };
    const readsBefore = store.reads.length;
    await rejected(executeContextReferenceCommand(viewer.actor, deniedWrite, store), "NOT_FOUND", 404);
    await rejected(getContextReferences(b.seat.actor, { scope: clientScope(b), contextId: made.contextId }, store), "NOT_FOUND", 404);
    await rejected(getContextReferenceAsset(customer.actor, { scope: ownScope(customer), contextId: made.contextId, bindingId: item.bindingId }, store), "NOT_FOUND", 404);
    const otherContext = await createContext(a.seat.actor, scope);
    await rejected(getContextReferenceAsset(a.seat.actor, { scope, contextId: otherContext.contextId, bindingId: item.bindingId }, store), "NOT_FOUND", 404);
    const admin = await person("ADMIN");
    await rejected(getPrivateAsset(a.seat.user.id, item.assetId, { storage: store.storage, serverAuth: a.seat.actor }), "NOT_FOUND", 404);
    await rejected(getPrivateAsset(admin.user.id, item.assetId, { storage: store.storage, serverAuth: admin.actor }), "NOT_FOUND", 404);
    expect(store.reads).toHaveLength(readsBefore);
    const generic = uploadPrivateAsset(a.seat.user.id, { operationKey: key(), purpose: "MARKETING_REFERENCE", contentType: "image/png", bytes: png }, { storage: store.storage, serverAuth: a.seat.actor });
    await expect(generic).rejects.toMatchObject({ status: expect.toSatisfy((status: number) => [400, 403, 422].includes(status)) });
    const own = await createContext(customer.actor, ownScope(customer)), ownUpload = resultSchema.parse(await executeContextReferenceCommand(customer.actor,
      await referenceCommand(customer.actor, ownScope(customer), own.contextId, own.revision, 0, "UPLOAD", uploadPayload()), store));
    const ownItem = manifest(referencesSchema.parse(await getContextReferences(customer.actor, { scope: ownScope(customer), contextId: own.contextId }, store))).items[0]!;
    expect(ownUpload.bindingId).toBe(ownItem.bindingId);
    expect((await getBrandEvidence(customer.user.id, customer.brand.id, { storage: store.storage, serverAuth: customer.actor })).assets.map(asset => asset.id)).not.toContain(ownItem.assetId);
    expect((await prisma.brandContext.findUniqueOrThrow({ where: { id: made.contextId } })).inputRevision).toBe(made.inputRevision);
  });

  it("keeps legacy hashes and approved reference pins while reference-only edits and ABA make pending approval stale", async () => {
    const owner = await company(), scope = ownScope(owner), store = byteMap(), made = await createContext(owner.actor, scope);
    expect(referencesSchema.parse(await getContextReferences(owner.actor, { scope, contextId: made.contextId }, store)).references).toEqual({ kind: "LEGACY_ABSENT" });
    const legacySubmission = await submit(owner.actor, scope, made.contextId, made.revision), legacy = await approve(owner.actor, legacySubmission.submissionId);
    const originalVersion = await getApprovedBrandContextVersion(owner.actor, { scope, versionId: legacy.versionId });
    // Fresh native SUBMIT captures an explicit empty manifest. Existing absent
    // sidecars remain distinct; no historical row is rewritten to fabricate one.
    const originalReferences = manifest(referencesSchema.parse(await getContextReferences(owner.actor, { scope, contextId: made.contextId, versionId: legacy.versionId }, store)));
    expect(originalReferences.items).toEqual([]); expect(originalReferences.revision).toBe(1);
    const uploaded = resultSchema.parse(await executeContextReferenceCommand(owner.actor,
      await referenceCommand(owner.actor, scope, made.contextId, legacySubmission.revision, originalReferences.revision, "UPLOAD", uploadPayload()), store));
    if (!uploaded.bindingId) throw new Error("Actual UPLOAD omitted reference binding identity");
    const first = manifest(referencesSchema.parse(await getContextReferences(owner.actor, { scope, contextId: made.contextId }, store)));
    const submitted = await submit(owner.actor, scope, made.contextId, uploaded.revision), approved = await approve(owner.actor, submitted.submissionId);
    const pending = await submit(owner.actor, scope, made.contextId, submitted.revision);
    const empty = resultSchema.parse(await executeContextReferenceCommand(owner.actor,
      await referenceCommand(owner.actor, scope, made.contextId, pending.revision, first.revision, "REPLACE", { items: [] }), store));
    expect(manifest(referencesSchema.parse(await getContextReferences(owner.actor, { scope, contextId: made.contextId }, store))).items).toEqual([]);
    const returned = resultSchema.parse(await executeContextReferenceCommand(owner.actor,
      await referenceCommand(owner.actor, scope, made.contextId, empty.revision, empty.referenceRevision, "REPLACE", { items: [capturedItem(uploaded.bindingId)] }), store));
    const current = manifest(referencesSchema.parse(await getContextReferences(owner.actor, { scope, contextId: made.contextId }, store)));
    expect(current.items).toEqual(first.items); expect(current.revision).toBe(first.revision + 2); expect(current.id).not.toBe(first.id);
    await expect(executeContextReferenceCommand(owner.actor,
      await referenceCommand(owner.actor, scope, made.contextId, returned.revision, first.revision, "REPLACE", { items: current.items.map(row => capturedItem(row.bindingId)) }), store)).rejects.toMatchObject({ status: 409 });
    const review = await getContextOwnerReview(owner.actor, { submissionId: pending.submissionId });
    expect(review.review).toMatchObject({ sourceStale: true, approvalAvailable: false, state: "PENDING" });
    await rejected(decideContextOwnerReview(owner.actor, { operationKey: key(), submissionId: pending.submissionId, expectedRevision: 1, decision: "APPROVE" }), "STALE_REVIEW");
    expect(manifest(referencesSchema.parse(await getContextReferences(owner.actor, { scope, contextId: made.contextId, versionId: approved.versionId }, store)))).toEqual(first);
    assertFile(await getContextReferenceAsset(owner.actor, { scope, contextId: made.contextId, versionId: approved.versionId, bindingId: uploaded.bindingId }, store));
    const retainedVersion = await getApprovedBrandContextVersion(owner.actor, { scope, versionId: legacy.versionId });
    expect(retainedVersion.version).toEqual(originalVersion.version);
    expect(retainedVersion.scope).toEqual(originalVersion.scope);
    expect(retainedVersion.currentAuthority).toEqual(originalVersion.currentAuthority);
    expect(manifest(referencesSchema.parse(await getContextReferences(owner.actor, { scope, contextId: made.contextId, versionId: legacy.versionId }, store)))).toEqual(originalReferences);
    const parent = await prisma.brandContext.findUniqueOrThrow({ where: { id: made.contextId } });
    expect(parent).toMatchObject({ revision: returned.revision, inputRevision: made.inputRevision, content });
    expect(await prisma.brandContextVersion.count({ where: { submissionId: pending.submissionId } })).toBe(0);
  });

  it("lets only the targeted owner without an agency seat read submitted references and reports missing immutable bytes honestly", async () => {
    const owner = await company(), a = await agency(owner), memberOnly = await member(a.owner, a.organization.id), scope = clientScope(a), store = byteMap();
    const wrongOwner = await company(), otherClient = await agency(owner);
    expect(otherClient.client.brandId).toBe(a.client.brandId);
    expect(otherClient.client.id).not.toBe(a.client.id);
    const contextMetadataSchema = z.object({ submissionId: z.string().min(1), contextId: z.string().min(1),
      references: referencesSchema.shape.references }).strict();
    const campaignMetadataSchema = z.object({ submissionId: z.string().min(1), campaignId: z.string().min(1),
      contextVersionId: z.string().nullable(), references: z.union([referencesSchema.shape.references,
        z.object({ kind: z.literal("NO_CONTEXT") }).strict()]) }).strict();
    expect(await prisma.organizationMembership.count({ where: { userId: owner.user.id, organizationId: a.organization.id } })).toBe(0);
    const made = await createContext(a.seat.actor, scope), uploaded = resultSchema.parse(await executeContextReferenceCommand(a.seat.actor,
      await referenceCommand(a.seat.actor, scope, made.contextId, made.revision, 0, "UPLOAD", uploadPayload()), store));
    if (!uploaded.bindingId) throw new Error("Actual UPLOAD omitted reference binding identity");
    const readsBefore = store.reads.length;
    await rejected(getContextReferenceAsset(memberOnly.actor, { scope, contextId: made.contextId, bindingId: uploaded.bindingId }, store), "NOT_FOUND", 404);
    await rejected(getContextReferenceAsset(owner.actor, { scope, contextId: made.contextId, bindingId: uploaded.bindingId }, store), "NOT_FOUND", 404);
    await rejected(getContextReviewReferenceAsset(owner.actor, { submissionId: key(), bindingId: uploaded.bindingId }, store), "NOT_FOUND", 404);
    expect(store.reads).toHaveLength(readsBefore);
    const submitted = await submit(a.seat.actor, scope, made.contextId, uploaded.revision);
    // Owner metadata requires the exact submitted lane, with no storage option
    // and no fabricated agency membership or grant for the company owner.
    const submittedMetadata = contextMetadataSchema.parse(await getContextReviewReferences(owner.actor, { submissionId: submitted.submissionId }));
    expect(submittedMetadata).toMatchObject({ submissionId: submitted.submissionId, contextId: made.contextId });
    expect(submittedMetadata.references).toEqual(
      referencesSchema.parse(await getContextReferences(a.seat.actor, { scope, contextId: made.contextId }, store)).references);
    await rejected(getContextReviewReferences(wrongOwner.actor, { submissionId: submitted.submissionId }), "NOT_FOUND", 404);
    await rejected(getContextReviewReferences(memberOnly.actor, { submissionId: submitted.submissionId }), "NOT_FOUND", 404);
    await rejected(getContextReviewReferences(otherClient.seat.actor, { submissionId: submitted.submissionId }), "NOT_FOUND", 404);
    const contextApproved = await approve(owner.actor, submitted.submissionId);
    const selected = (await getApprovedBrandContextVersion(a.seat.actor, { scope, versionId: contextApproved.versionId })).version;
    const policyOptions = { policyReviewResolver: resolveCampaignPolicyReview };
    const campaign = await executeCampaignPlanningCommand(a.seat.actor, { operationKey: key(), scope, ...await authority(a.seat.actor, scope),
      action: "CREATE", expectedCampaignRevision: 0, expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0,
      payload: { fields: { ...campaignFields, title: "Actual native reference-pinned campaign" },
        selection: { kind: "APPROVED_CONTEXT", versionId: selected.id, contentHash: selected.contentHash }, narrative: null } }, policyOptions);
    const campaignStep = async (action: "GENERATE_BRIEF" | "SUBMIT_BRIEF", payload: unknown) => {
      const current = await getPlanningCampaign(a.seat.actor, { scope, campaignId: campaign.campaignId });
      return executeCampaignPlanningCommand(a.seat.actor, { operationKey: key(), scope, ...await authority(a.seat.actor, scope),
        campaignId: campaign.campaignId, expectedCampaignRevision: current.campaign.revision,
        expectedPlanningRevision: current.planning.revision, expectedSelectionId: current.planning.selection.id,
        expectedSelectionRevision: current.planning.selection.revision, action, payload }, policyOptions);
    };
    const generated = await campaignStep("GENERATE_BRIEF", {});
    if (!generated.briefId || !generated.version) throw new Error("Actual native generated brief omitted its immutable identity");
    const campaignSubmitted = await campaignStep("SUBMIT_BRIEF", { briefId: generated.briefId, expectedBriefVersion: generated.version });
    if (!campaignSubmitted.submissionId) throw new Error("Actual native campaign submission omitted identity");
    const campaignSubmissionId = campaignSubmitted.submissionId;
    const campaignMetadata = campaignMetadataSchema.parse(await getCampaignReviewReferences(owner.actor, { submissionId: campaignSubmissionId }));
    expect(campaignMetadata).toEqual({ submissionId: campaignSubmissionId, campaignId: campaign.campaignId,
      contextVersionId: selected.id, references: submittedMetadata.references });
    assertFile(await getCampaignReviewReferenceAsset(owner.actor, { submissionId: campaignSubmissionId, bindingId: uploaded.bindingId }, store));
    for (const deniedActor of [wrongOwner.actor, memberOnly.actor, otherClient.seat.actor]) {
      await rejected(getCampaignReviewReferences(deniedActor, { submissionId: campaignSubmissionId }), "NOT_FOUND", 404);
      await rejected(getCampaignReviewReferenceAsset(deniedActor, { submissionId: campaignSubmissionId, bindingId: uploaded.bindingId }, store), "NOT_FOUND", 404);
    }
    expect(await prisma.organizationMembership.count({ where: { userId: owner.user.id,
      organizationId: { in: [a.organization.id, otherClient.organization.id] } } })).toBe(0);
    assertFile(await getContextReviewReferenceAsset(owner.actor, { submissionId: submitted.submissionId, bindingId: uploaded.bindingId }, store));
    await rejected(getContextReviewReferenceAsset(a.seat.actor, { submissionId: submitted.submissionId, bindingId: uploaded.bindingId }, store), "NOT_FOUND", 404);
    await rejected(getContextReviewReferenceAsset(memberOnly.actor, { submissionId: submitted.submissionId, bindingId: uploaded.bindingId }, store), "NOT_FOUND", 404);
    const removed = resultSchema.parse(await executeContextReferenceCommand(a.seat.actor,
      await referenceCommand(a.seat.actor, scope, made.contextId, submitted.revision, uploaded.referenceRevision, "REPLACE", { items: [] }), store));
    await executeBrandContextCommand(a.seat.actor, { operationKey: key(), scope, ...await authority(a.seat.actor, scope),
      contextId: made.contextId, expectedRevision: removed.revision, action: "SET_ARCHIVED", payload: { archived: true } });
    expect(campaignMetadataSchema.parse(await getCampaignReviewReferences(owner.actor, { submissionId: campaignSubmissionId }))).toEqual(campaignMetadata);
    assertFile(await getCampaignReviewReferenceAsset(owner.actor, { submissionId: campaignSubmissionId, bindingId: uploaded.bindingId }, store));
    await rejected(getContextReferenceAsset(a.seat.actor, { scope, contextId: made.contextId, bindingId: uploaded.bindingId }, store), "NOT_FOUND", 404);
    assertFile(await getContextReviewReferenceAsset(owner.actor, { submissionId: submitted.submissionId, bindingId: uploaded.bindingId }, store));
    expect(store.objects.size).toBe(1);
    const [objectKey, originalBytes] = [...store.objects.entries()][0]!;
    // Corrupt only the bytes genuinely persisted by this native upload. The
    // immutable binding/manifest and exact submitted-owner authorization stay
    // unchanged; persisted storage failure is not a malformed client upload.
    store.objects.set(objectKey, originalBytes.slice(0, 8));
    try {
      await rejected(getContextReviewReferenceAsset(owner.actor, { submissionId: submitted.submissionId, bindingId: uploaded.bindingId }, store), "ASSET_BYTES_UNAVAILABLE", 503);
    } finally { store.objects.set(objectKey, originalBytes); }
    store.objects.clear();
    await rejected(getContextReviewReferenceAsset(owner.actor, { submissionId: submitted.submissionId, bindingId: uploaded.bindingId }, store), "ASSET_BYTES_UNAVAILABLE", 503);
    await rejected(getCampaignReviewReferenceAsset(owner.actor, { submissionId: campaignSubmissionId, bindingId: uploaded.bindingId }, store), "ASSET_BYTES_UNAVAILABLE", 503);
    const readsBeforeMetadata = store.reads.length;
    expect(contextMetadataSchema.parse(await getContextReviewReferences(owner.actor, { submissionId: submitted.submissionId }))).toEqual(submittedMetadata);
    expect(campaignMetadataSchema.parse(await getCampaignReviewReferences(owner.actor, { submissionId: campaignSubmissionId }))).toEqual(campaignMetadata);
    expect(store.reads).toHaveLength(readsBeforeMetadata);
    expect((await getContextOwnerReview(owner.actor, { submissionId: submitted.submissionId })).review.sourceStale).toBe(true);
  });

  it("replays exact uploads once and rolls back changed payload, storage failure, real grant loss and signed-session revocation across native waits", async () => {
    const owner = await company(), scope = ownScope(owner), store = byteMap(), made = await createContext(owner.actor, scope);
    const command = await referenceCommand(owner.actor, scope, made.contextId, made.revision, 0, "UPLOAD", uploadPayload());
    const first = resultSchema.parse(await executeContextReferenceCommand(owner.actor, command, store));
    const before = await prisma.brandContext.findUniqueOrThrow({ where: { id: made.contextId } });
    expect(resultSchema.parse(await executeContextReferenceCommand(owner.actor, command, store))).toEqual({ ...first, replayed: true });
    await rejected(executeContextReferenceCommand(owner.actor, { ...command, payload: { ...uploadPayload(), labelOriginal: { text: "Changed same-key label", language: "en" } } }, store), "IDEMPOTENCY_CONFLICT");
    expect(await prisma.brandContext.findUniqueOrThrow({ where: { id: made.contextId } })).toEqual(before);
    const currentBefore = referencesSchema.parse(await getContextReferences(owner.actor, { scope, contextId: made.contextId }, store));
    const unavailable: EvidenceStorage = { ...store.storage, async put() { throw new EvidenceError("ASSET_BYTES_UNAVAILABLE", 503); } };
    await rejected(executeContextReferenceCommand(owner.actor,
      await referenceCommand(owner.actor, scope, made.contextId, first.revision, first.referenceRevision, "UPLOAD", uploadPayload()), { storage: unavailable }), "ASSET_BYTES_UNAVAILABLE", 503);
    expect(await prisma.brandContext.findUniqueOrThrow({ where: { id: made.contextId } })).toEqual(before);
    expect(referencesSchema.parse(await getContextReferences(owner.actor, { scope, contextId: made.contextId }, store))).toEqual(currentBefore);
    expect(await prisma.privateAsset.count({ where: { ownerUserId: owner.user.id } })).toBe(1);

    const a = await agency(owner), client = clientScope(a), clientContext = await createContext(a.seat.actor, client);
    const clientBefore = await prisma.brandContext.findUniqueOrThrow({ where: { id: clientContext.contextId } });
    const clientCommand = await referenceCommand(a.seat.actor, client, clientContext.contextId, clientContext.revision, 0, "UPLOAD", uploadPayload());
    const writesBefore = store.writes.length, heldGrant = await blocker("ClientGrant", a.grant.id,
      tx => tx.clientGrant.update({ where: { id: a.grant.id }, data: { plan: false, revision: { increment: 1 } } }));
    const denied = executeContextReferenceCommand(a.seat.actor, clientCommand, store); void denied.catch(() => {});
    try {
      expect(await Promise.race([heldGrant.wait(), denied.then(() => { throw new Error("Reference upload completed before its native ClientGrant wait"); }, () => { throw new Error("Reference upload rejected before its native ClientGrant wait"); })])).toBeGreaterThan(0);
      heldGrant.release(); await heldGrant.holding; await rejected(denied, "NOT_FOUND", 404);
      expect(await prisma.brandContext.findUniqueOrThrow({ where: { id: clientContext.contextId } })).toEqual(clientBefore);
      expect(store.writes).toHaveLength(writesBefore);
    } finally { await heldGrant.close(); await denied.catch(() => {}); }
    const nextCommand = await referenceCommand(owner.actor, scope, made.contextId, first.revision, first.referenceRevision, "UPLOAD", uploadPayload());
    const heldUser = await blocker("User", owner.user.id,
      tx => tx.authSession.update({ where: { id: owner.actor.sessionId }, data: { revokedAt: new Date() } }));
    const revoked = executeContextReferenceCommand(owner.actor, nextCommand, store); void revoked.catch(() => {});
    try {
      expect(await Promise.race([heldUser.wait(), revoked.then(() => { throw new Error("Reference upload completed before its native User wait"); }, () => { throw new Error("Reference upload rejected before its native User wait"); })])).toBeGreaterThan(0);
      heldUser.release(); await heldUser.holding; await rejected(revoked, "UNAUTHENTICATED", 401);
      expect(await prisma.brandContext.findUniqueOrThrow({ where: { id: made.contextId } })).toEqual(before);
      expect(store.writes).toHaveLength(writesBefore);
      await rejected(executeContextReferenceCommand(owner.actor, command, store), "UNAUTHENTICATED", 401);
    } finally { await heldUser.close(); await revoked.catch(() => {}); }
  });
});
