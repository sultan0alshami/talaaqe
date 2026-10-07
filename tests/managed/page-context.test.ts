import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import type { OrganizationActor } from "@/lib/organizations/context";
import type { ClientCapabilities } from "@/lib/organizations/contracts";
import type { PlanningScope } from "@/lib/brand-context/contracts";
import { getClientAuthority } from "@/lib/organizations/loaders";
import { acceptMembership, authorizeClientAssociation, createOrganization, proposeClientAssociation,
  proposeMember, setClientGrant } from "@/lib/organizations/service";
import { executeCampaignPlanningCommand, getPlanningCampaign, decideCampaignOwnerReview } from "@/lib/campaign-planning/service";
import { campaignBriefDTO } from "@/lib/campaigns/core";
import { ManagedOrderCommandSchema, ManagedOrderDetailSchema, ManagedOrderListSchema } from "@/lib/managed/contracts";
import { submitManagedOrder } from "@/lib/managed/orders";
import { getManagedRequestListPageContext, getManagedRequestDetailPageContext } from "@/lib/managed/page-context";
import { campaignFields } from "../campaigns/fixtures";

// Exactly two complete native page-context groups. Root activates/runs the
// guarded target. Native signed actors, agency consent/grants, M03 approved
// producers and PostgreSQL are owned synthetic fixtures. No .test imports or
// auth/domain/Date mocks, browser UI or live provider/legal acceptance claim.
const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>();
const key = () => randomUUID();
const all: ClientCapabilities = { view: true, plan: true, approveShortlist: true, reviewContent: true,
  signCustomer: true, financial: true, manageGrants: true };
const pageKeys = ["actorReference", "scope", "initialList", "initialDetail", "profileRequired"];
const privateNarrative = "Unsubmitted managed-page original narrative canary";
const privateProposal = "Unapproved managed-page original proposal canary";
const managedTables = ["ManagedOrderCommand", "ManagedOrderState", "ManagedOrderSubmission", "ManagedOrder"] as const;

afterEach(async () => {
  const workspaces = await prisma.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } });
  const ids = workspaces.map(row => row.id);
  if (ids.length) {
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
  await prisma.campaign.deleteMany({ where: { brandId: { in: [...brands] } } });
  await prisma.organizationCommand.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await prisma.clientGrant.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organizationClient.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [...organizations] } } });
  await prisma.brand.deleteMany({ where: { id: { in: [...brands] } } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
  if (users.size) await prisma.outboxEvent.deleteMany({ where: { OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await prisma.user.deleteMany({ where: { id: { in: [...users] } } }); users.clear(); brands.clear(); organizations.clear();
});
async function sign(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const token = await openSession(user.id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Synthetic native managed-page session did not resolve");
  const actor: OrganizationActor = { userId: session.userId, role: session.role, sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  return { user, actor, token };
}
async function person(role: "BRAND" | "CREATOR" | "ADMIN" = "BRAND") {
  const id = key(); users.add(id);
  await prisma.user.create({ data: { id, role, active: true, isTest: true, name: "Synthetic managed-page actor",
    email: `managed-page-${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  return sign(id);
}
type Account = Awaited<ReturnType<typeof person>>;
async function attachBrand(owner: Account) {
  const brand = await prisma.brand.create({ data: { userId: owner.user.id, countryCode: "KW", isTest: true,
    slug: "managed-page-" + key().replace(/-/g, ""), name: "Synthetic original managed-page company" } }); brands.add(brand.id);
  return { ...owner, brand, scope: { kind: "OWN_BRAND", brandId: brand.id } as PlanningScope };
}
async function company() { return attachBrand(await person()); }
type Company = Awaited<ReturnType<typeof company>>;
async function agency(customer: Company, label: string) {
  const owner = await person(), seat = await person();
  const { organization } = await createOrganization(owner.actor, { operationKey: key(), kind: "AGENCY", nameOriginal: "Synthetic managed-page agency " + label }); organizations.add(organization.id);
  const revision = async () => (await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).revision;
  const proposed = await proposeClientAssociation(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), brandId: customer.brand.id });
  const { client } = await authorizeClientAssociation(customer.actor, proposed.client.id, { operationKey: key(), expectedRevision: proposed.client.revision, capabilities: all });
  const pending = await proposeMember(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), targetUserId: seat.user.id });
  const { membership } = await acceptMembership(seat.actor, pending.membership.id, { operationKey: key(), expectedRevision: pending.membership.revision });
  const { grant } = await setClientGrant(owner.actor, client.id, { operationKey: key(), expectedClientRevision: client.revision,
    membershipId: membership.id, expectedGrantRevision: null, capabilities: all });
  return { owner, seat, organization, client, membership, grant, scope: { kind: "CLIENT", clientId: client.id } as PlanningScope };
}
type Agency = Awaited<ReturnType<typeof agency>>;
async function rights(a: Agency, capabilities: ClientCapabilities) {
  const grant = await prisma.clientGrant.findUniqueOrThrow({ where: { id: a.grant.id } }), client = await prisma.organizationClient.findUniqueOrThrow({ where: { id: a.client.id } });
  return setClientGrant(a.owner.actor, a.client.id, { operationKey: key(), expectedClientRevision: client.revision,
    membershipId: a.membership.id, expectedGrantRevision: grant.revision, capabilities });
}
async function planningAuthority(account: Account, scope: PlanningScope) {
  return scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(account.actor, scope.clientId, "plan") } : {};
}
async function step(account: Account, scope: PlanningScope, campaignId: string, action: string, payload: unknown) {
  const current = await getPlanningCampaign(account.actor, { scope, campaignId });
  return executeCampaignPlanningCommand(account.actor, { operationKey: key(), scope, ...await planningAuthority(account, scope), campaignId,
    expectedCampaignRevision: current.campaign.revision, expectedPlanningRevision: current.planning.revision,
    expectedSelectionId: current.planning.selection.id, expectedSelectionRevision: current.planning.selection.revision, action, payload });
}
async function request(owner: Company, account: Account = owner, scope = owner.scope, label = "OWN") {
  const created = await executeCampaignPlanningCommand(account.actor, { operationKey: key(), scope, ...await planningAuthority(account, scope), action: "CREATE",
    expectedCampaignRevision: 0, expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0,
    payload: { fields: { ...campaignFields, title: "  طلب أصلي " + label + "  " }, selection: { kind: "NONE" }, narrative: null } });
  await step(account, scope, created.campaignId, "SAVE_NARRATIVE", { narrative: { schemaVersion: 1, mode: "PARAGRAPH", processing: "UNPROCESSED", originalText: { text: privateNarrative, language: "en" } } });
  await step(account, scope, created.campaignId, "PROPOSE_FIELDS", { type: "PROPOSE_FIELDS", patch: { summary: privateProposal }, originalText: { text: privateProposal, language: "en" } });
  const generated = await step(account, scope, created.campaignId, "GENERATE_BRIEF", {});
  const sent = await step(account, scope, created.campaignId, "SUBMIT_BRIEF", { briefId: generated.briefId!, expectedBriefVersion: generated.version! });
  expect((await decideCampaignOwnerReview(owner.actor, { operationKey: key(), submissionId: sent.submissionId!, expectedRevision: 1, decision: "APPROVE" })).state).toBe("APPROVED");
  const current = await getPlanningCampaign(account.actor, { scope, campaignId: created.campaignId });
  const brief = campaignBriefDTO(await prisma.campaignBrief.findUniqueOrThrow({ where: { id: generated.briefId! } }));
  expect(brief.approvedByUserId).toBe(owner.user.id); expect(brief.content.approvedByUserId).toBe(owner.user.id);
  const input = ManagedOrderCommandSchema.parse({ action: "SUBMIT", operationKey: key(), scope, campaignId: created.campaignId,
    expectedCampaignRevision: current.campaign.revision, expectedPlanningRevision: current.planning.revision,
    expectedSelectionId: current.planning.selection.id, expectedSelectionRevision: current.planning.selection.revision,
    briefId: brief.id, expectedBriefVersion: brief.version, disclosureVersion: "infame-order-disclosure-v1",
    ...(scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(account.actor, scope.clientId, "signCustomer") } : {}) });
  const result = await submitManagedOrder(account.actor, input);
  return { campaignId: created.campaignId, brief, input, result };
}
async function rejected(operation: Promise<unknown>, code: string, status: number) { await expect(operation).rejects.toMatchObject({ code, status }); }
function props(value: object, actor: OrganizationActor) {
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype); expect(Object.keys(value).sort()).toEqual([...pageKeys].sort());
  expect(value).toMatchObject({ actorReference: actor.userId }); expect(JSON.parse(JSON.stringify(value))).toEqual(value);
}
function privateSafe(value: unknown, accounts: readonly Account[]) {
  const json = JSON.stringify(value);
  for (const canary of [privateNarrative, privateProposal, ...accounts.flatMap(account => [account.token, account.actor.sessionId, account.user.email, account.user.name])]) expect(json).not.toContain(canary);
  const denied = new Set(["user", "actor", "token", "email", "role", "sessionId", "sessionVersion", "passwordHash", "serverAuth", "conversation", "narrative", "proposals", "storageKey", "supplierCost", "retailPrice"]);
  function visit(item: unknown) { if (item === null || typeof item !== "object") return;
    for (const [name, child] of Object.entries(item)) { expect(denied.has(name)).toBe(false); visit(child); } }
  visit(value);
}
async function identities() {
  const [workspaces, campaigns, orders, submissions, states, commands] = await Promise.all([
    prisma.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, orderBy: { id: "asc" } }),
    prisma.campaign.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true }, orderBy: { id: "asc" } }),
    prisma.managedOrder.findMany({ where: { campaignId: { in: (await prisma.campaign.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } })).map(row => row.id) } }, orderBy: { id: "asc" } }),
    prisma.managedOrderSubmission.findMany({ where: { submittedByUserId: { in: [...users] } }, orderBy: { id: "asc" } }),
    prisma.managedOrderState.findMany({ where: { workspaceId: { in: (await prisma.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } })).map(row => row.id) } }, orderBy: { orderId: "asc" } }),
    prisma.managedOrderCommand.findMany({ where: { actorUserId: { in: [...users] } }, orderBy: { id: "asc" } }),
  ]); return JSON.stringify({ workspaces, campaigns, orders, submissions, states, commands });
}
async function actorFailure(actor: OrganizationActor, code: string, status: number) {
  await rejected(getManagedRequestListPageContext(actor, { clientId: ["malformed", "duplicate"], brandId: "foreign" }), code, status);
  await rejected(getManagedRequestDetailPageContext(actor, "", { clientId: ["malformed"], actorUserId: "private" }), code, status);
}

describe("managed request page context: native current view and serializable private props", () => {
  it("checks native actor before query/ID validation and returns exact profile or authorized empty OWN/CLIENT states without creating workspaces", async () => {
    const absent = await person(); const profile = await getManagedRequestListPageContext(absent.actor, {}, { client: prisma });
    props(profile, absent.actor); expect(profile).toEqual({ actorReference: absent.user.id, scope: null, initialList: null, initialDetail: null, profileRequired: true });
    await rejected(getManagedRequestDetailPageContext(absent.actor, key(), {}), "NOT_FOUND", 404);
    await actorFailure({ ...absent.actor, sessionId: "invalid" }, "UNAUTHENTICATED", 401);
    for (const role of ["CREATOR", "ADMIN"] as const) await actorFailure((await person(role)).actor, "FORBIDDEN", 403);
    const invalidations: Array<(account: Account) => Promise<unknown>> = [
      account => prisma.authSession.update({ where: { id: account.actor.sessionId }, data: { revokedAt: new Date() } }),
      account => prisma.authSession.update({ where: { id: account.actor.sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } }),
      account => prisma.authSession.update({ where: { id: account.actor.sessionId }, data: { version: { increment: 1 } } }),
      account => prisma.user.update({ where: { id: account.user.id }, data: { sessionVersion: { increment: 1 } } }),
      account => prisma.user.update({ where: { id: account.user.id }, data: { active: false } }),
      account => prisma.user.update({ where: { id: account.user.id }, data: { role: "ADMIN" } }),
    ];
    for (const invalidate of invalidations) { const account = await person(); await invalidate(account); expect(await resolveSession(account.token)).toBeNull(); await actorFailure(account.actor, "UNAUTHENTICATED", 401); }
    const changed = await person(); await prisma.user.update({ where: { id: changed.user.id }, data: { role: "ADMIN" } });
    await actorFailure((await sign(changed.user.id)).actor, "FORBIDDEN", 403);
    const owner = await company(), a = await agency(owner, "empty"); const before = await identities();
    const own = await getManagedRequestListPageContext(owner.actor, {}); props(own, owner.actor);
    expect(own).toEqual({ actorReference: owner.user.id, scope: owner.scope,
      initialList: { scope: owner.scope, currentAuthority: null, asOf: expect.any(String), orders: [], nextCursor: null }, initialDetail: null, profileRequired: false });
    expect(ManagedOrderListSchema.safeParse(own.initialList).success).toBe(true);
    const client = await getManagedRequestListPageContext(a.seat.actor, { clientId: a.client.id }); props(client, a.seat.actor);
    const view = await getClientAuthority(a.seat.actor, a.client.id, "view");
    expect(client).toEqual({ actorReference: a.seat.user.id, scope: a.scope,
      initialList: { scope: a.scope, currentAuthority: view, asOf: expect.any(String), orders: [], nextCursor: null }, initialDetail: null, profileRequired: false });
    expect(ManagedOrderListSchema.safeParse(client.initialList).success).toBe(true);
    await rejected(getManagedRequestListPageContext(owner.actor, { after: key() }), "NOT_FOUND", 404);
    await rejected(getManagedRequestListPageContext(a.seat.actor, { clientId: a.client.id, after: key() }), "NOT_FOUND", 404);
    await rejected(getManagedRequestDetailPageContext(owner.actor, key(), {}), "NOT_FOUND", 404);
    await rejected(getManagedRequestDetailPageContext(a.seat.actor, key(), { clientId: a.client.id }), "NOT_FOUND", 404);
    for (const query of [{ clientId: [] }, { clientId: [a.client.id] }, { clientId: "" }, { after: [] }, { after: [key()] }, { after: "" },
      { brandId: owner.brand.id }, { scope: "OWN_BRAND" }, { actorUserId: owner.user.id }, { limit: "20" }, { campaignId: key() }, { clientId: a.client.id, brandId: owner.brand.id }]) {
      await rejected(getManagedRequestListPageContext(owner.actor, query), "VALIDATION", 422);
    }
    for (const query of [{ clientId: [] }, { clientId: [a.client.id] }, { clientId: "" }, { after: key() }, { brandId: owner.brand.id }, { scope: "OWN_BRAND" }, { orderId: key() }]) {
      await rejected(getManagedRequestDetailPageContext(owner.actor, key(), query), "VALIDATION", 422);
    }
    for (const orderId of ["", "x".repeat(201)]) await rejected(getManagedRequestDetailPageContext(owner.actor, orderId, {}), "VALIDATION", 422);
    await rejected(getManagedRequestListPageContext(owner.actor, { clientId: a.client.id }), "NOT_FOUND", 404);
    await rejected(getManagedRequestListPageContext(owner.actor, { clientId: key() }), "NOT_FOUND", 404);
    await rejected(getManagedRequestListPageContext(absent.actor, { clientId: a.client.id }), "NOT_FOUND", 404);
    expect(await identities()).toBe(before); expect(await prisma.planningWorkspace.count({ where: { brandId: { in: [...brands] } } })).toBe(0);
    privateSafe([profile, own, client], [absent, owner, a.seat]);
  }, 30000);

  it("projects real submitted OWN and two same-Brand CLIENT requests with view-only reads, exact cursors and no denied CLIENT or foreign order fallback", async () => {
    const f = await company(), outsider = await company(), a = await agency(f, "A"), b = await agency(f, "B"), aOwn = await attachBrand(a.seat);
    const own = await request(f), ca = await request(f, a.seat, a.scope, "CLIENT A"), cb = await request(f, b.seat, b.scope, "CLIENT B");
    const stable = await identities(), ownList = await getManagedRequestListPageContext(f.actor, {}); props(ownList, f.actor);
    expect(ownList.scope).toEqual(f.scope); expect(ownList.profileRequired).toBe(false); expect(ownList.initialDetail).toBeNull();
    expect(ManagedOrderListSchema.parse(ownList.initialList).orders.map(row => row.id)).toEqual([own.result.orderId]);
    const ownDetail = await getManagedRequestDetailPageContext(f.actor, own.result.orderId, {}); props(ownDetail, f.actor);
    expect(ownDetail.scope).toEqual(f.scope); expect(ownDetail.initialList).toBeNull(); expect(ownDetail.profileRequired).toBe(false);
    expect(ManagedOrderDetailSchema.parse(ownDetail.initialDetail).order.submission.snapshot.brief).toEqual(own.brief);
    const aList = await getManagedRequestListPageContext(a.seat.actor, { clientId: a.client.id }), aDetail = await getManagedRequestDetailPageContext(a.seat.actor, ca.result.orderId, { clientId: a.client.id });
    props(aList, a.seat.actor); props(aDetail, a.seat.actor);
    expect(aList.scope).toEqual(a.scope); expect(aList.initialDetail).toBeNull(); expect(aList.profileRequired).toBe(false);
    expect(aDetail.scope).toEqual(a.scope); expect(aDetail.initialList).toBeNull(); expect(aDetail.profileRequired).toBe(false);
    expect(ManagedOrderListSchema.parse(aList.initialList).orders.map(row => row.id)).toEqual([ca.result.orderId]);
    const aData = ManagedOrderDetailSchema.parse(aDetail.initialDetail); expect(aData.currentAuthority?.clientId).toBe(a.client.id); expect(aData.currentAuthority?.capability).toBe("view");
    expect(aData.order.id).toBe(ca.result.orderId); expect(aData.order.submission.snapshot.brief).toEqual(ca.brief); expect(aData.quote).toBeNull();
    const bList = await getManagedRequestListPageContext(b.seat.actor, { clientId: b.client.id });
    expect(ManagedOrderListSchema.parse(bList.initialList).orders.map(row => row.id)).toEqual([cb.result.orderId]);
    const afterOwn = await getManagedRequestListPageContext(f.actor, { after: own.result.orderId });
    expect(ManagedOrderListSchema.parse(afterOwn.initialList).orders).toEqual([]);
    for (const [actor, orderId, query] of [[f.actor, ca.result.orderId, {}], [f.actor, ca.result.orderId, { clientId: a.client.id }],
      [a.seat.actor, cb.result.orderId, { clientId: a.client.id }], [a.seat.actor, cb.result.orderId, { clientId: b.client.id }],
      [a.seat.actor, own.result.orderId, {}], [outsider.actor, own.result.orderId, {}]] as const) {
      await rejected(getManagedRequestDetailPageContext(actor, orderId, query), "NOT_FOUND", 404);
    }
    await rejected(getManagedRequestListPageContext(a.seat.actor, { clientId: a.client.id, after: cb.result.orderId }), "NOT_FOUND", 404);
    await rejected(getManagedRequestListPageContext(f.actor, { after: ca.result.orderId }), "NOT_FOUND", 404);
    await rejected(getManagedRequestListPageContext(f.actor, { brandId: outsider.brand.id }), "VALIDATION", 422);
    await rejected(getManagedRequestDetailPageContext(f.actor, own.result.orderId, { after: own.result.orderId }), "VALIDATION", 422);
    await rejected(getManagedRequestDetailPageContext(a.seat.actor, ca.result.orderId, { clientId: [a.client.id, a.client.id] }), "VALIDATION", 422);
    await rejected(getManagedRequestDetailPageContext(f.actor, key(), {}), "NOT_FOUND", 404);
    privateSafe([ownList, ownDetail, aList, aDetail, bList, afterOwn], [f, outsider, a.seat, b.seat]);
    expect(JSON.stringify(ownList)).not.toContain(ca.result.orderId); expect(JSON.stringify(aList)).not.toContain(cb.result.orderId);
    const viewOnly = { ...all, plan: false, approveShortlist: false, reviewContent: false, signCustomer: false, financial: false, manageGrants: false };
    await rights(a, viewOnly);
    const readOnly = await getManagedRequestDetailPageContext(a.seat.actor, ca.result.orderId, { clientId: a.client.id });
    expect(ManagedOrderDetailSchema.parse(readOnly.initialDetail).currentAuthority?.capability).toBe("view");
    expect(ManagedOrderListSchema.parse((await getManagedRequestListPageContext(a.seat.actor, { clientId: a.client.id })).initialList).orders.map(row => row.id)).toEqual([ca.result.orderId]);
    const actualOwnEmpty = await getManagedRequestListPageContext(a.seat.actor, {});
    expect(actualOwnEmpty.scope).toEqual(aOwn.scope); expect(ManagedOrderListSchema.parse(actualOwnEmpty.initialList).orders).toEqual([]);
    await rights(a, { ...viewOnly, view: false });
    await rejected(getManagedRequestListPageContext(a.seat.actor, { clientId: a.client.id }), "NOT_FOUND", 404);
    await rejected(getManagedRequestDetailPageContext(a.seat.actor, ca.result.orderId, { clientId: a.client.id }), "NOT_FOUND", 404);
    await rights(a, all);
    expect(ManagedOrderDetailSchema.parse((await getManagedRequestDetailPageContext(a.seat.actor, ca.result.orderId, { clientId: a.client.id })).initialDetail).order.id).toBe(ca.result.orderId);
    await prisma.authSession.update({ where: { id: a.seat.actor.sessionId }, data: { revokedAt: new Date() } });
    await actorFailure(a.seat.actor, "UNAUTHENTICATED", 401);
    await rejected(getManagedRequestListPageContext(a.seat.actor, { clientId: a.client.id }), "UNAUTHENTICATED", 401);
    await rejected(getManagedRequestDetailPageContext(a.seat.actor, ca.result.orderId, { clientId: a.client.id }), "UNAUTHENTICATED", 401);
    expect(await identities()).toBe(stable);
  }, 30000);
});
