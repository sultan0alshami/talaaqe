import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { createOrganization, proposeClientAssociation, authorizeClientAssociation, proposeMember, acceptMembership, setClientGrant, revokeClientGrant } from "@/lib/organizations/service";
import { revokeClientAssociation } from "@/lib/organizations/lifecycle";
import { getClientAuthority } from "@/lib/organizations/loaders";
import type { OrganizationActor } from "@/lib/organizations/context";
import type { ClientCapabilities } from "@/lib/organizations/contracts";
import { executeBrandContextCommand, listBrandContexts, getBrandContext, getApprovedBrandContextVersion, listContextOwnerReviews, getContextOwnerReview, decideContextOwnerReview } from "@/lib/brand-context/service";
import { BrandContextContentSchema, BrandContextCommandSchema, BrandContextReceiptSchema, BrandContextCommandResultSchema, BrandContextListSchema,
  BrandContextDetailResponseSchema, BrandContextVersionResponseSchema, ContextOwnerReviewsSchema, ContextOwnerReviewResponseSchema,
  ContextOwnerReviewResultSchema, ContextOwnerReviewReceiptSchema, type PlanningScope, type BrandContextContent } from "@/lib/brand-context/contracts";
import { canonicalHash, inputJson } from "@/lib/onboarding/drafts";

// Root alone runs guarded targets. Real signed sessions, organization invitations,
// owner-authorized associations, accepted memberships and scoped grants below
// are native synthetic fixtures, not live agency/legal consent or feature acceptance.
// Exactly six native groups; no fake producer, authority, clock or .test import.
const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>();
const key = () => randomUUID();
const allCaps: ClientCapabilities = { view: true, plan: true, approveShortlist: true, reviewContent: true, signCustomer: true, financial: true, manageGrants: true };
function caps(view = true, plan = true): ClientCapabilities {
  return { view, plan, approveShortlist: false, reviewContent: false, signCustomer: false, financial: false, manageGrants: false };
}
afterEach(async () => {
  const owned = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "PlanningWorkspace" WHERE "brandId" IN (${brands.size ? Prisma.join([...brands]) : Prisma.sql`NULL`})`);
  if (owned.length) {
    const ids = owned.map(row => row.id);
    for (const table of ["PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission", "CampaignBriefProvenance",
      "CampaignProposalDependency", "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding", "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const) {
      await prisma.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join(ids)})`);
    }
    await prisma.$executeRaw(Prisma.sql`DELETE FROM "PlanningWorkspace" WHERE id IN (${Prisma.join(ids)})`);
  }
  await prisma.organizationCommand.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await prisma.clientGrant.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organizationClient.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [...organizations] } } });
  await prisma.brand.deleteMany({ where: { id: { in: [...brands] } } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
  if (users.size) await prisma.outboxEvent.deleteMany({ where: { OR: [...users].map(id => ({ payload: { path: ["actorUserId"], equals: id } })) } });
  await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
  for (const set of [users, brands, organizations]) set.clear();
});
async function person(role: "BRAND" | "CREATOR" | "ADMIN" = "BRAND") {
  const id = key(); users.add(id);
  const user = await prisma.user.create({ data: { id, role, active: true, isTest: true, name: "Synthetic M03 service actor",
    email: `${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  const token = await openSession(id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Synthetic native context service session did not resolve");
  const actor: OrganizationActor = { userId: session.userId, role: session.role, sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  return { user, actor, token };
}
async function company() {
  const owner = await person(), brand = await prisma.brand.create({ data: { userId: owner.user.id, slug: "context-service-" + key().replace(/-/g, "").slice(0, 16),
    name: "Synthetic original company", countryCode: "KW", isTest: true, description: "private owner profile canary" } });
  brands.add(brand.id); return { ...owner, brand };
}
async function orgRevision(id: string) { return (await prisma.organization.findUniqueOrThrow({ where: { id } })).revision; }
async function agency(customer: Awaited<ReturnType<typeof company>>, label: "A" | "B", rights = caps()) {
  const owner = await person(), seat = await person();
  const { organization } = await createOrganization(owner.actor, { operationKey: key(), kind: "AGENCY", nameOriginal: "Synthetic agency " + label });
  organizations.add(organization.id);
  const proposal = await proposeClientAssociation(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await orgRevision(organization.id), brandId: customer.brand.id });
  const { client } = await authorizeClientAssociation(customer.actor, proposal.client.id, { operationKey: key(), expectedRevision: proposal.client.revision, capabilities: allCaps });
  const membershipProposal = await proposeMember(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await orgRevision(organization.id), targetUserId: seat.user.id });
  const { membership } = await acceptMembership(seat.actor, membershipProposal.membership.id, { operationKey: key(), expectedRevision: membershipProposal.membership.revision });
  const { grant } = await setClientGrant(owner.actor, client.id, { operationKey: key(), expectedClientRevision: client.revision, membershipId: membership.id,
    expectedGrantRevision: null, capabilities: rights });
  expect(client.state).toBe("ACTIVE"); expect(membership.state).toBe("ACTIVE"); expect(grant.active).toBe(true);
  return { owner, seat, organization, client, membership, grant, customer };
}
async function fixture(aRights = caps(), bRights = caps()) {
  const owner = await company(), other = await company(), a = await agency(owner, "A", aRights), b = await agency(owner, "B", bRights);
  expect(a.client.brandId).toBe(owner.brand.id); expect(b.client.brandId).toBe(owner.brand.id);
  expect(a.client.organizationId).not.toBe(b.client.organizationId);
  // Brand-owner review must work without invented agency membership or grant.
  expect(await prisma.organizationMembership.count({ where: { userId: owner.user.id, organizationId: { in: [a.organization.id, b.organization.id] } } })).toBe(0);
  return { owner, other, a, b };
}

type Company = Awaited<ReturnType<typeof company>>;
type Agency = Awaited<ReturnType<typeof agency>>;
const ownScope = (f: Company): PlanningScope => ({ kind: "OWN_BRAND", brandId: f.brand.id });
const clientScope = (f: Agency): PlanningScope => ({ kind: "CLIENT", clientId: f.client.id });
const originalName = { text: "  اسم سياق أصلي / Original context  ", language: "ar" };
const originalContent = BrandContextContentSchema.parse({ schemaVersion: 1,
  positioning: { text: " \tتموضع أصلي\nOriginal private positioning\r ", language: "ar" },
  values: [{ text: "  Original value  ", language: "en" }], tone: { text: "  هادئ وأصلي  ", language: "ar" },
  references: [{ label: { text: "Original reference", language: "en" }, url: "https://reference.example.invalid/original",
    notes: { text: "  Private reference words\n ", language: "en" } }],
  competitors: [{ name: { text: "اسم منافس أصلي", language: "ar" }, url: null, notes: { text: "  ملاحظة أصلية  ", language: "ar" } }] });
const emptyContent = BrandContextContentSchema.parse({ schemaVersion: 1, positioning: { text: null, language: null }, values: [],
  tone: { text: null, language: null }, references: [], competitors: [] });
const canonicalName = { ...originalName, text: originalName.text.trim() };
function privateSafe(data: unknown, canaries: readonly string[]) {
  const json = JSON.stringify(data); for (const canary of canaries) expect(json).not.toContain(canary);
}
async function ownCreate(f: Company, content: BrandContextContent = originalContent, nameOriginal = originalName) {
  const command = { operationKey: key(), scope: ownScope(f), action: "CREATE", expectedRevision: 0, payload: { nameOriginal, content } };
  const result = BrandContextCommandResultSchema.parse(await executeBrandContextCommand(f.actor, command)); return { command, result };
}
async function clientCreate(f: Agency, content: BrandContextContent = originalContent, nameOriginal = originalName) {
  const command = { operationKey: key(), scope: clientScope(f), expectedAuthority: await getClientAuthority(f.seat.actor, f.client.id, "plan"),
    action: "CREATE", expectedRevision: 0, payload: { nameOriginal, content } };
  const result = BrandContextCommandResultSchema.parse(await executeBrandContextCommand(f.seat.actor, command)); return { command, result };
}
async function clientCommand(f: Agency, contextId: string, expectedRevision: number, action: "UPDATE" | "SUBMIT" | "SET_ARCHIVED", payload: unknown) {
  return { operationKey: key(), scope: clientScope(f), expectedAuthority: await getClientAuthority(f.seat.actor, f.client.id, "plan"), contextId, expectedRevision, action, payload };
}
async function submitOwn(f: Company, contextId: string, expectedRevision: number) {
  const result = await executeBrandContextCommand(f.actor, { operationKey: key(), scope: ownScope(f), contextId, expectedRevision, action: "SUBMIT", payload: {} });
  expect(result.submissionId).not.toBeNull(); return result;
}
async function approveOwn(f: Company, submissionId: string) {
  return ContextOwnerReviewResultSchema.parse(await decideContextOwnerReview(f.actor, { operationKey: key(), submissionId, expectedRevision: 1, decision: "APPROVE" }));
}
async function failure(action: Promise<unknown>, code: string, status = 409) { await expect(action).rejects.toMatchObject({ code, status }); }
function latch<T>() { let resolve!: (value: T | PromiseLike<T>) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
type WaitTable = "User" | "ClientGrant" | "BrandContextCommand";
async function waitBlockedBy(monitor: PrismaClient, blockerPid: number, table: WaitTable, signal: AbortSignal) {
  const deadline = performance.now() + 4000;
  while (performance.now() < deadline) {
    if (signal.aborted) throw new Error("Native context wait witness cancelled");
    const rows = await monitor.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
      AND wait_event_type='Lock' AND ${blockerPid}=ANY(pg_blocking_pids(pid)) AND query LIKE ${`%"${table}"%`}
      AND (${table} <> 'BrandContextCommand' OR query ILIKE '%INSERT%') ORDER BY pid`;
    if (rows.length) return rows[0]!.pid;
    await delay(20);
  }
  throw new Error("Context service did not reach the required actual native wait");
}
async function hold(table: WaitTable, id: string | null, afterRelease?: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  const peer = new PrismaClient(), monitor = new PrismaClient(), ready = latch<number>(), release = latch<void>(), stop = new AbortController();
  const holding = peer.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout='4s'`;
    const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
    if (table === "BrandContextCommand") await tx.$executeRaw`LOCK TABLE "BrandContextCommand" IN SHARE MODE`;
    else await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw('"' + table + '"')} WHERE id=${id} FOR UPDATE`);
    ready.resolve(rows[0]!.pid); await release.promise; if (afterRelease) await afterRelease(tx);
  }, { maxWait: 5000, timeout: 12000 }); void holding.catch(() => {});
  let pid: number;
  try { pid = await Promise.race([ready.promise, holding.then(() => { throw new Error("Context blocker completed before acquiring its native lock"); })]); }
  catch (error) { release.resolve(); await holding.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); throw error; }
  let waiting: Promise<number> | undefined;
  return { holding, release: () => release.resolve(), wait() { waiting = waitBlockedBy(monitor, pid, table, stop.signal); return waiting; },
    async close() { release.resolve(); stop.abort(); await holding.catch(() => {}); await waiting?.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); } };
}

describe("M03 brand context service: native signed synthetic manual planning", () => {
  it("supports blank no-website OWN planning, preserves original words and immutable approved versions through editing/archive", async () => {
    const f = await company(), made = await ownCreate(f, emptyContent);
    expect(made.result).toMatchObject({ revision: 1, inputRevision: 1, action: "CREATE", archived: false, submissionId: null, replayed: false });
    let detail = BrandContextDetailResponseSchema.parse(await getBrandContext(f.actor, { scope: ownScope(f), contextId: made.result.contextId }));
    expect(detail.currentAuthority).toBeNull(); expect(detail.context.content).toEqual(emptyContent); expect(detail.context.nameOriginal).toEqual(canonicalName);
    const updated = await executeBrandContextCommand(f.actor, { operationKey: key(), scope: ownScope(f), action: "UPDATE", contextId: made.result.contextId,
      expectedRevision: 1, payload: { nameOriginal: originalName, content: originalContent } });
    expect(updated).toMatchObject({ revision: 2, inputRevision: 2, action: "UPDATE" });
    const submitted = await submitOwn(f, updated.contextId, updated.revision);
    expect(submitted).toMatchObject({ revision: 3, inputRevision: 2, action: "SUBMIT" });
    const approved = await approveOwn(f, submitted.submissionId!); expect(approved).toMatchObject({ revision: 2, state: "APPROVED", version: 1, replayed: false });
    expect(approved.versionId).not.toBeNull();
    const ownerReceipt = await prisma.planningReviewCommand.findFirstOrThrow({ where: { actorUserId: f.user.id, contextSubmissionId: submitted.submissionId! } });
    const { replayed: ownerReplayed, ...ownerHistory } = approved; void ownerReplayed;
    expect(ContextOwnerReviewReceiptSchema.parse(ownerReceipt.result)).toEqual(ownerHistory);
    const version = BrandContextVersionResponseSchema.parse(await getApprovedBrandContextVersion(f.actor, { scope: ownScope(f), versionId: approved.versionId! }));
    expect(version.version.nameOriginal).toEqual(canonicalName); expect(version.version.content).toEqual(originalContent);
    expect(version.version.contentHash).toBe(canonicalHash({ nameOriginal: canonicalName, content: originalContent }));
    const storedBefore = await prisma.brandContextSubmission.findUniqueOrThrow({ where: { id: submitted.submissionId! } });
    const editedContent = { ...originalContent, tone: { text: "  تعديل أصلي بلا استبدال النسخة  ", language: "ar" } };
    const edited = await executeBrandContextCommand(f.actor, { operationKey: key(), scope: ownScope(f), action: "UPDATE", contextId: updated.contextId,
      expectedRevision: submitted.revision, payload: { nameOriginal: originalName, content: editedContent } });
    expect(edited).toMatchObject({ revision: 4, inputRevision: 4 });
    const archived = await executeBrandContextCommand(f.actor, { operationKey: key(), scope: ownScope(f), action: "SET_ARCHIVED", contextId: updated.contextId,
      expectedRevision: edited.revision, payload: { archived: true } });
    expect(archived).toMatchObject({ revision: 5, inputRevision: 4, archived: true });
    expect((await listBrandContexts(f.actor, { scope: ownScope(f) })).contexts).toEqual([]);
    expect((await listBrandContexts(f.actor, { scope: ownScope(f), archived: true })).contexts.map(row => row.id)).toEqual([updated.contextId]);
    const retained = await getApprovedBrandContextVersion(f.actor, { scope: ownScope(f), versionId: approved.versionId! }); expect(retained.version).toEqual(version.version);
    expect(await prisma.brandContextSubmission.findUniqueOrThrow({ where: { id: submitted.submissionId! } })).toEqual(storedBefore);
    await failure(submitOwn(f, updated.contextId, archived.revision), "ARCHIVED");
    await failure(executeBrandContextCommand(f.actor, { operationKey: key(), scope: ownScope(f), action: "SET_ARCHIVED", contextId: updated.contextId,
      expectedRevision: archived.revision, payload: { archived: true } }), "INVALID_STATE");
    detail = await getBrandContext(f.actor, { scope: ownScope(f), contextId: updated.contextId });
    expect(detail.context.content).toEqual(editedContent); expect(detail.context.versions).toEqual([version.version]);
    expect(BrandContextDetailResponseSchema.safeParse({ ...detail, ownerEmail: f.user.email }).success).toBe(false);
    expect(BrandContextVersionResponseSchema.safeParse({ ...retained, version: { ...retained.version, approvedByUserId: f.user.id } }).success).toBe(false);
    const restored = await executeBrandContextCommand(f.actor, { operationKey: key(), scope: ownScope(f), action: "SET_ARCHIVED", contextId: updated.contextId,
      expectedRevision: archived.revision, payload: { archived: false } });
    expect(restored).toMatchObject({ revision: 6, inputRevision: 4, archived: false });
  });

  it("separates same-Brand OWN and two CLIENT scopes and enforces each current view/plan permission without readonly upsert", async () => {
    const f = await fixture(), own = await ownCreate(f.owner, originalContent, { text: "OWN private name", language: "en" }),
      a = await clientCreate(f.a, originalContent, { text: "A private name", language: "en" }), b = await clientCreate(f.b, originalContent, { text: "B private name", language: "en" });
    const lists = [await listBrandContexts(f.owner.actor, { scope: ownScope(f.owner) }), await listBrandContexts(f.a.seat.actor, { scope: clientScope(f.a) }), await listBrandContexts(f.b.seat.actor, { scope: clientScope(f.b) })];
    for (const list of lists) expect(BrandContextListSchema.safeParse(list).success).toBe(true);
    expect(lists.map(list => list.contexts.map(row => row.id))).toEqual([[own.result.contextId], [a.result.contextId], [b.result.contextId]]);
    expect(lists[1]!.currentAuthority).toMatchObject({ clientId: f.a.client.id, capability: "view" });
    await failure(getBrandContext(f.a.seat.actor, { scope: clientScope(f.a), contextId: b.result.contextId }), "NOT_FOUND", 404);
    await failure(getBrandContext(f.owner.actor, { scope: clientScope(f.a), contextId: a.result.contextId }), "NOT_FOUND", 404);
    await failure(getBrandContext(f.a.seat.actor, { scope: ownScope(f.owner), contextId: own.result.contextId }), "NOT_FOUND", 404);
    await failure(listBrandContexts(f.a.seat.actor, { scope: clientScope(f.b) }), "NOT_FOUND", 404);
    const currentGrant = await prisma.clientGrant.findUniqueOrThrow({ where: { id: f.a.grant.id } });
    await setClientGrant(f.a.owner.actor, f.a.client.id, { operationKey: key(), expectedClientRevision: f.a.client.revision, membershipId: f.a.membership.id,
      expectedGrantRevision: currentGrant.revision, capabilities: caps(true, false) });
    expect((await getBrandContext(f.a.seat.actor, { scope: clientScope(f.a), contextId: a.result.contextId })).context.id).toBe(a.result.contextId);
    await failure(executeBrandContextCommand(f.a.seat.actor, { ...a.command, operationKey: key() }), "NOT_FOUND", 404);
    const empty = await listBrandContexts(f.other.actor, { scope: ownScope(f.other) }); expect(empty.contexts).toEqual([]);
    expect(await prisma.planningWorkspace.count({ where: { brandId: f.other.brand.id } })).toBe(0);
    expect(BrandContextListSchema.safeParse({ ...lists[1], currentAuthority: { ...lists[1]!.currentAuthority!, capability: "plan" } }).success).toBe(false);
    expect(BrandContextListSchema.safeParse({ ...lists[1], contexts: lists[1]!.contexts.map(row => ({ ...row, content: originalContent })) }).success).toBe(false);
  });

  it("returns only minimal plan-only receipts/replays and never turns all saved agency capabilities into actual owner approval", async () => {
    const f = await fixture(caps(false, true), allCaps), made = await clientCreate(f.a);
    expect(BrandContextCommandResultSchema.safeParse(made.result).success).toBe(true);
    expect(Object.keys(made.result).sort()).toEqual(["action", "archived", "contextId", "inputRevision", "replayed", "revision", "submissionId"]);
    const receipt = await prisma.brandContextCommand.findUniqueOrThrow({ where: { actorUserId_operationKey: { actorUserId: f.a.seat.user.id, operationKey: made.command.operationKey } } });
    const { replayed: _replayed, ...history } = made.result; void _replayed;
    expect(BrandContextReceiptSchema.parse(receipt.result)).toEqual(history);
    privateSafe([made.result, receipt.result], [originalContent.positioning.text!, originalName.text.trim(), f.owner.user.email, f.a.seat.token, f.a.seat.actor.sessionId, "currentAuthority", "content", "nameOriginal"]);
    await failure(getBrandContext(f.a.seat.actor, { scope: clientScope(f.a), contextId: made.result.contextId }), "NOT_FOUND", 404);
    await failure(listBrandContexts(f.a.seat.actor, { scope: clientScope(f.a) }), "NOT_FOUND", 404);
    // Same current plan permission and exact binding, new authority revision.
    await setClientGrant(f.a.owner.actor, f.a.client.id, { operationKey: key(), expectedClientRevision: f.a.client.revision, membershipId: f.a.membership.id,
      expectedGrantRevision: f.a.grant.revision, capabilities: { ...caps(false, true), reviewContent: true } });
    const replay = await executeBrandContextCommand(f.a.seat.actor, made.command); expect(replay).toEqual({ ...made.result, replayed: true });
    expect(await prisma.brandContextCommand.count({ where: { actorUserId: f.a.seat.user.id, operationKey: made.command.operationKey } })).toBe(1);
    const other = await clientCreate(f.b), submit = await executeBrandContextCommand(f.b.seat.actor, await clientCommand(f.b, other.result.contextId, other.result.revision, "SUBMIT", {}));
    await failure(decideContextOwnerReview(f.b.seat.actor, { operationKey: key(), submissionId: submit.submissionId!, expectedRevision: 1, decision: "APPROVE" }), "NOT_FOUND", 404);
    const current = await prisma.clientGrant.findUniqueOrThrow({ where: { id: f.a.grant.id } });
    await revokeClientGrant(f.a.owner.actor, current.id, { operationKey: key(), expectedRevision: current.revision });
    await failure(executeBrandContextCommand(f.a.seat.actor, made.command), "NOT_FOUND", 404);
    expect(BrandContextCommandResultSchema.safeParse({ ...made.result, content: originalContent }).success).toBe(false);
  });

  it("shows only immutable submitted snapshots to the actual targeted Brand owner and rejects stale, transferred or withdrawn approval", async () => {
    const f = await fixture(), a = await clientCreate(f.a, originalContent, { text: "A submitted name", language: "en" });
    const hidden = await clientCreate(f.b, { ...originalContent, positioning: { text: "B unsubmitted private draft canary", language: "en" } }, { text: "B hidden name", language: "en" });
    const submitted = await executeBrandContextCommand(f.a.seat.actor, await clientCommand(f.a, a.result.contextId, a.result.revision, "SUBMIT", {}));
    expect(submitted.submissionId).not.toBeNull();
    const inbox = ContextOwnerReviewsSchema.parse(await listContextOwnerReviews(f.owner.actor));
    expect(inbox.reviews.map(row => row.id)).toEqual([submitted.submissionId]);
    privateSafe(inbox, ["B unsubmitted private draft canary", "B hidden name", hidden.result.contextId, f.a.seat.user.email, f.a.seat.token]);
    const before = ContextOwnerReviewResponseSchema.parse(await getContextOwnerReview(f.owner.actor, { submissionId: submitted.submissionId! }));
    expect(before.review).toMatchObject({ contextId: a.result.contextId, scope: clientScope(f.a), sourceStale: false, approvalAvailable: true });
    expect(before.review.content).toEqual(originalContent);
    expect(before.review.contentHash).toBe(canonicalHash({ nameOriginal: { text: "A submitted name", language: "en" }, content: originalContent }));
    await failure(getBrandContext(f.owner.actor, { scope: clientScope(f.a), contextId: a.result.contextId }), "NOT_FOUND", 404);
    await failure(getContextOwnerReview(f.other.actor, { submissionId: submitted.submissionId! }), "NOT_FOUND", 404);
    const edited = await executeBrandContextCommand(f.a.seat.actor, await clientCommand(f.a, a.result.contextId, submitted.revision, "UPDATE", {
      nameOriginal: { text: "A changed unsubmitted name", language: "en" }, content: { ...originalContent, positioning: { text: "A changed private draft canary", language: "en" } },
    }));
    const stale = await getContextOwnerReview(f.owner.actor, { submissionId: submitted.submissionId! });
    expect(stale.review.content).toEqual(before.review.content); expect(stale.review.nameOriginal).toEqual(before.review.nameOriginal);
    expect(stale.review).toMatchObject({ sourceStale: true, approvalAvailable: false });
    await failure(decideContextOwnerReview(f.owner.actor, { operationKey: key(), submissionId: submitted.submissionId!, expectedRevision: 1, decision: "APPROVE" }), "STALE_REVIEW");
    const decline = { operationKey: key(), submissionId: submitted.submissionId!, expectedRevision: 1, decision: "DECLINE" };
    const declined = await decideContextOwnerReview(f.owner.actor, decline); expect(declined).toMatchObject({ state: "DECLINED", versionId: null, version: null, revision: 2 });
    expect(await decideContextOwnerReview(f.owner.actor, decline)).toEqual({ ...declined, replayed: true });
    await failure(decideContextOwnerReview(f.owner.actor, { ...decline, operationKey: key(), expectedRevision: 2, decision: "APPROVE" }), "REVIEW_DECIDED");
    const resubmitted = await executeBrandContextCommand(f.a.seat.actor, await clientCommand(f.a, a.result.contextId, edited.revision, "SUBMIT", {}));
    await authorizeClientAssociation(f.owner.actor, f.a.client.id, { operationKey: key(), expectedRevision: f.a.client.revision, capabilities: allCaps });
    expect((await getContextOwnerReview(f.owner.actor, { submissionId: resubmitted.submissionId! })).review).toMatchObject({ sourceStale: true, approvalAvailable: false });
    await failure(decideContextOwnerReview(f.owner.actor, { operationKey: key(), submissionId: resubmitted.submissionId!, expectedRevision: 1, decision: "APPROVE" }), "STALE_REVIEW");
    const currentA = await prisma.organizationClient.findUniqueOrThrow({ where: { id: f.a.client.id } });
    await revokeClientAssociation(f.owner.actor, currentA.id, { operationKey: key(), expectedRevision: currentA.revision });
    await failure(getContextOwnerReview(f.owner.actor, { submissionId: resubmitted.submissionId! }), "NOT_FOUND", 404);
    await failure(decideContextOwnerReview(f.owner.actor, { operationKey: key(), submissionId: resubmitted.submissionId!, expectedRevision: 1, decision: "APPROVE" }), "NOT_FOUND", 404);
    const pendingB = await executeBrandContextCommand(f.b.seat.actor, await clientCommand(f.b, hidden.result.contextId, hidden.result.revision, "SUBMIT", {}));
    const replacement = await person(); await prisma.brand.update({ where: { id: f.owner.brand.id }, data: { userId: replacement.user.id } });
    for (const actor of [f.owner.actor, replacement.actor]) await failure(getContextOwnerReview(actor, { submissionId: pendingB.submissionId! }), "NOT_FOUND", 404);
    const own = await company(), made = await ownCreate(own), pendingOwn = await submitOwn(own, made.result.contextId, made.result.revision);
    const renewedUser = await prisma.user.update({ where: { id: own.user.id }, data: { sessionVersion: { increment: 1 } } });
    const renewedToken = await openSession(renewedUser.id, renewedUser.sessionVersion, renewedUser.passwordHash), renewedSession = await resolveSession(renewedToken);
    if (!renewedSession) throw new Error("Synthetic changed-version owner session did not resolve");
    const renewedActor: OrganizationActor = { userId: renewedSession.userId, role: renewedSession.role, sessionId: renewedSession.sessionId, sessionVersion: renewedSession.sessionVersion };
    expect((await getContextOwnerReview(renewedActor, { submissionId: pendingOwn.submissionId! })).review).toMatchObject({ sourceStale: true, approvalAvailable: false });
    await failure(decideContextOwnerReview(renewedActor, { operationKey: key(), submissionId: pendingOwn.submissionId!, expectedRevision: 1, decision: "APPROVE" }), "STALE_REVIEW");

    // A permanently invalid CLIENT delegation must be excluded before bounded
    // inbox capture, so it cannot poison an unrelated valid OWN review page.
    const filteredOwner = await company(), filteredAgency = await agency(filteredOwner, "A"), invalidName = "Invalid old-session CLIENT submission canary";
    const invalidContext = await clientCreate(filteredAgency, originalContent, { text: invalidName, language: "en" });
    const invalidSubmitted = await executeBrandContextCommand(filteredAgency.seat.actor, await clientCommand(filteredAgency,
      invalidContext.result.contextId, invalidContext.result.revision, "SUBMIT", {}));
    expect((await listContextOwnerReviews(filteredOwner.actor)).reviews.map(row => row.id)).toEqual([invalidSubmitted.submissionId]);
    expect((await getContextOwnerReview(filteredOwner.actor, { submissionId: invalidSubmitted.submissionId! })).review).toMatchObject({ sourceStale: false, approvalAvailable: true });
    const resetUser = await prisma.user.update({ where: { id: filteredOwner.user.id }, data: { sessionVersion: { increment: 1 } } });
    expect(await resolveSession(filteredOwner.token)).toBeNull();
    const resetToken = await openSession(resetUser.id, resetUser.sessionVersion, resetUser.passwordHash), resetSession = await resolveSession(resetToken);
    if (!resetSession) throw new Error("Synthetic reset-owner inbox session did not resolve");
    const resetActor: OrganizationActor = { userId: resetSession.userId, role: resetSession.role, sessionId: resetSession.sessionId, sessionVersion: resetSession.sessionVersion };
    expect(await prisma.organizationClient.findUniqueOrThrow({ where: { id: filteredAgency.client.id } })).toMatchObject({ state: "ACTIVE",
      authorizingUserId: filteredOwner.user.id, authorizingSessionVersion: filteredOwner.user.sessionVersion });
    const resetOwner = { ...filteredOwner, user: resetUser, actor: resetActor, token: resetToken }, validContext = await ownCreate(resetOwner);
    const validSubmitted = await submitOwn(resetOwner, validContext.result.contextId, validContext.result.revision);
    await failure(getContextOwnerReview(resetActor, { submissionId: invalidSubmitted.submissionId! }), "NOT_FOUND", 404);
    const filteredInbox = ContextOwnerReviewsSchema.parse(await listContextOwnerReviews(resetActor));
    expect(filteredInbox.reviews.map(row => row.id)).toEqual([validSubmitted.submissionId]);
    privateSafe(filteredInbox, [invalidName, invalidContext.result.contextId, invalidSubmitted.submissionId!, filteredAgency.client.id]);
    expect(ContextOwnerReviewResponseSchema.safeParse({ ...before, review: { ...before.review, targetOwnerSessionVersion: 1 } }).success).toBe(false);
  });

  it("binds exact UUID history, serializes concurrent revisions, detects same-content ABA and limits thin private reads/audits", async () => {
    const f = await company(), made = await ownCreate(f);
    const effects = async () => ({ receipts: await prisma.brandContextCommand.findMany({ where: { actorUserId: f.user.id }, orderBy: { id: "asc" } }),
      audits: await prisma.adminAudit.findMany({ where: { actorUserId: f.user.id }, orderBy: { id: "asc" } }),
      events: await prisma.outboxEvent.findMany({ where: { payload: { path: ["actorUserId"], equals: f.user.id } }, orderBy: { id: "asc" } }) });
    const initial = await effects(); expect(initial.receipts).toHaveLength(1); expect(initial.audits.length).toBeGreaterThan(0); expect(initial.events.length).toBeGreaterThan(0);
    expect(await executeBrandContextCommand(f.actor, made.command)).toEqual({ ...made.result, replayed: true });
    expect(await effects()).toEqual(initial);
    await failure(executeBrandContextCommand(f.actor, { ...made.command, payload: { ...made.command.payload, nameOriginal: { text: "Different key payload", language: "en" } } }), "OPERATION_KEY_REUSED");
    const pending = await submitOwn(f, made.result.contextId, made.result.revision);
    const payloadB = { nameOriginal: originalName, content: { ...originalContent, tone: { text: "B changed tone", language: "en" } } };
    const b = await executeBrandContextCommand(f.actor, { operationKey: key(), scope: ownScope(f), action: "UPDATE", contextId: made.result.contextId, expectedRevision: pending.revision, payload: payloadB });
    const a = await executeBrandContextCommand(f.actor, { operationKey: key(), scope: ownScope(f), action: "UPDATE", contextId: made.result.contextId, expectedRevision: b.revision,
      payload: { nameOriginal: originalName, content: originalContent } });
    expect(a.inputRevision).toBeGreaterThan(made.result.inputRevision);
    const oldReview = await getContextOwnerReview(f.actor, { submissionId: pending.submissionId! });
    expect(oldReview.review.contentHash).toBe(canonicalHash({ nameOriginal: canonicalName, content: originalContent }));
    expect(oldReview.review).toMatchObject({ sourceStale: true, approvalAvailable: false });
    await failure(decideContextOwnerReview(f.actor, { operationKey: key(), submissionId: pending.submissionId!, expectedRevision: 1, decision: "APPROVE" }), "STALE_REVIEW");
    await failure(executeBrandContextCommand(f.actor, { operationKey: key(), scope: ownScope(f), action: "UPDATE", contextId: made.result.contextId,
      expectedRevision: b.revision, payload: { nameOriginal: originalName, content: originalContent } }), "STALE_VERSION");
    const racing = await ownCreate(f), inputs = ["winner A", "winner B"].map(text => ({ operationKey: key(), scope: ownScope(f), action: "UPDATE", contextId: racing.result.contextId,
      expectedRevision: racing.result.revision, payload: { nameOriginal: { text, language: "en" }, content: originalContent } }));
    const outcomes = await Promise.allSettled(inputs.map(input => executeBrandContextCommand(f.actor, input)));
    expect(outcomes.map(outcome => outcome.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = outcomes.find(outcome => outcome.status === "rejected"); if (rejected?.status === "rejected") expect(rejected.reason).toMatchObject({ status: 409, code: "STALE_VERSION" });
    expect((await prisma.brandContext.findUniqueOrThrow({ where: { id: racing.result.contextId } })).revision).toBe(2);
    expect(await prisma.brandContextCommand.count({ where: { actorUserId: f.user.id, operationKey: { in: inputs.map(input => input.operationKey) } } })).toBe(1);
    const parent = await prisma.brandContext.findUniqueOrThrow({ where: { id: made.result.contextId } });
    const privateContent = { ...originalContent, positioning: { text: "bounded list private content canary", language: "en" } };
    await prisma.brandContext.createMany({ data: Array.from({ length: 21 }, (_, index) => ({ id: key(), updatedAt: new Date(), workspaceId: parent.workspaceId, name: `Synthetic bounded header ${index}`, nameLanguage: "en",
      content: inputJson(privateContent), revision: 1, inputRevision: 1, archived: false })) });
    let nativeHeaderQueries = 0;
    const observer = prisma.$extends({ query: { brandContext: { async findMany({ args, query }) {
      const rows = await query(args); nativeHeaderQueries++;
      expect(args.take).toBeGreaterThan(0); expect(args.take).toBeLessThanOrEqual(21); expect(rows.length).toBeLessThanOrEqual(21);
      for (const row of rows) expect(Object.hasOwn(row, "content")).toBe(false);
      return rows;
    } } } }) as unknown as PrismaClient; // Query-preserving native extension; no result substitution.
    const first = BrandContextListSchema.parse(await listBrandContexts(f.actor, { scope: ownScope(f), limit: 20 }, { client: observer }));
    expect(first.contexts).toHaveLength(20); expect(first.nextCursor).not.toBeNull(); expect(nativeHeaderQueries).toBeGreaterThan(0);
    const second = await listBrandContexts(f.actor, { scope: ownScope(f), after: first.nextCursor!, limit: 20 });
    expect(second.contexts).toHaveLength(3); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.contexts, ...second.contexts].map(row => row.id)).size).toBe(23);
    privateSafe([first, second], ["bounded list private content canary"]);
    const final = await effects(); privateSafe(final.audits.map(row => row.snapshot), [originalContent.positioning.text!, canonicalName.text, f.token, f.actor.sessionId, f.user.email]);
    privateSafe(final.events.map(row => row.payload), [originalContent.positioning.text!, canonicalName.text, f.token, f.actor.sessionId, f.user.email]);
    expect(BrandContextCommandSchema.safeParse(made.command).success).toBe(true);
  });

  it("rechecks native signed sessions/grants after genuine waits and rolls back tentative state/journals on actual final expiry", async () => {
    const f = await fixture(), made = await ownCreate(f.owner), a = await clientCreate(f.a);
    const raw = (id: string) => prisma.brandContext.findUniqueOrThrow({ where: { id } });
    const before = await raw(made.result.contextId), beforeA = await raw(a.result.contextId);
    const ownCommand = { operationKey: key(), scope: ownScope(f.owner), action: "UPDATE", contextId: made.result.contextId, expectedRevision: made.result.revision,
      payload: { nameOriginal: originalName, content: { ...originalContent, tone: { text: "Must roll back", language: "en" } } } };
    const blockedUser = await hold("User", f.owner.user.id, tx => tx.authSession.update({ where: { id: f.owner.actor.sessionId }, data: { revokedAt: new Date() } }));
    const revoked = executeBrandContextCommand(f.owner.actor, ownCommand); void revoked.catch(() => {});
    try {
      expect(await Promise.race([blockedUser.wait(), revoked.then(() => { throw new Error("Context write completed before its actual User wait"); })])).toBeGreaterThan(0);
      blockedUser.release(); await blockedUser.holding; await failure(revoked, "UNAUTHENTICATED", 401);
      expect(await raw(made.result.contextId)).toEqual(before);
      expect(await prisma.brandContextCommand.count({ where: { actorUserId: f.owner.user.id, operationKey: ownCommand.operationKey } })).toBe(0);
    } finally { await blockedUser.close(); await revoked.catch(() => {}); }
    const clientInput = await clientCommand(f.a, a.result.contextId, a.result.revision, "UPDATE", { nameOriginal: originalName, content: originalContent });
    const blockedGrant = await hold("ClientGrant", f.a.grant.id, tx => tx.clientGrant.update({ where: { id: f.a.grant.id }, data: { plan: false, revision: { increment: 1 } } }));
    const denied = executeBrandContextCommand(f.a.seat.actor, clientInput); void denied.catch(() => {});
    try {
      expect(await Promise.race([blockedGrant.wait(), denied.then(() => { throw new Error("Context write completed before its actual ClientGrant wait"); })])).toBeGreaterThan(0);
      blockedGrant.release(); await blockedGrant.holding; await failure(denied, "NOT_FOUND", 404);
      expect(await raw(a.result.contextId)).toEqual(beforeA);
      expect(await prisma.brandContextCommand.count({ where: { actorUserId: f.a.seat.user.id, operationKey: clientInput.operationKey } })).toBe(0);
    } finally { await blockedGrant.close(); await denied.catch(() => {}); }
    // A separate fresh native owner isolates expiry from the preceding revoked
    // session/delegation. Stored expiry is mutable; no Date replacement is used.
    const owner = await company(), created = await ownCreate(owner), beforeExpiry = await raw(created.result.contextId);
    const expiryInput = { operationKey: key(), scope: ownScope(owner), action: "UPDATE", contextId: created.result.contextId,
      expectedRevision: created.result.revision, payload: { nameOriginal: originalName, content: { ...originalContent, tone: { text: "Expired write must roll back", language: "en" } } } };
    const expiresAt = new Date(Date.now() + 2500);
    await prisma.authSession.update({ where: { id: owner.actor.sessionId }, data: { expiresAt } });
    expect(await resolveSession(owner.token)).not.toBeNull();
    const blockedJournal = await hold("BrandContextCommand", null), expired = executeBrandContextCommand(owner.actor, expiryInput); void expired.catch(() => {});
    let settled = false; void expired.then(() => { settled = true; }, () => { settled = true; });
    try {
      expect(await Promise.race([blockedJournal.wait(), expired.then(() => { throw new Error("Context write completed before its actual journal INSERT wait"); })])).toBeGreaterThan(0);
      expect(Date.now()).toBeLessThan(expiresAt.getTime());
      while (Date.now() <= expiresAt.getTime()) await delay(Math.min(50, expiresAt.getTime() - Date.now() + 1));
      expect(await resolveSession(owner.token)).toBeNull(); expect(settled).toBe(false);
      blockedJournal.release(); await blockedJournal.holding; await failure(expired, "UNAUTHENTICATED", 401);
      expect(await raw(created.result.contextId)).toEqual(beforeExpiry);
      expect(await prisma.brandContextCommand.count({ where: { actorUserId: owner.user.id, operationKey: expiryInput.operationKey } })).toBe(0);
      expect(await prisma.brandContextCommand.count({ where: { actorUserId: owner.user.id } })).toBe(1);
    } finally { await blockedJournal.close(); await expired.catch(() => {}); }
    for (const role of ["CREATOR", "ADMIN"] as const) {
      const actor = await person(role); await failure(executeBrandContextCommand(actor.actor, { malformed: true }), "FORBIDDEN", 403);
    }
    await failure(executeBrandContextCommand(f.owner.actor, { malformed: true }), "UNAUTHENTICATED", 401);
  }, 20000);
});
