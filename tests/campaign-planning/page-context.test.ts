import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import type { OrganizationActor } from "@/lib/organizations/context";
import { createOrganization, proposeClientAssociation, authorizeClientAssociation, proposeMember, acceptMembership, setClientGrant } from "@/lib/organizations/service";
import { getClientAuthority } from "@/lib/organizations/loaders";
import { CampaignFieldsSchema } from "@/lib/campaigns/contracts";
import { createCampaign, getCampaign, applyCampaignMutation, generateCampaignBrief } from "@/lib/campaigns/service";
import { executeBrandContextCommand, decideContextOwnerReview } from "@/lib/brand-context/service";
import { BrandContextContentSchema, type PlanningScope } from "@/lib/brand-context/contracts";
import { executeCampaignPlanningCommand, getPlanningCampaign } from "@/lib/campaign-planning/service";
import { getCampaignListPageContext, getNewCampaignPageContext, getCampaignDetailPageContext,
  getCampaignBriefPageContext, getCampaignOwnerReviewsPageContext } from "@/lib/campaign-planning/page-context";

// Exactly three native groups. These are owned synthetic rows and real signed
// sessions/domain producers, not provider/legal acceptance or mocked authority.
// Root alone executes this file against the guarded task-local native database.
const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>();
const key = () => randomUUID();
const capabilities = { view: true, plan: true, approveShortlist: true, reviewContent: true, signCustomer: true, financial: true, manageGrants: true };
const fields = CampaignFieldsSchema.parse({ originalLanguage: "ar", title: "حملة أصلية للصفحة", productService: "منتج أصلي", goal: "AWARENESS", summary: "وصف أصلي واحد",
  marketCountryCodes: ["KW"], targetAgeBuckets: ["18-24"], targetGenders: ["FEMALE"], targetCountryCodes: ["KW"], targetCityKeys: [],
  contentLanguages: ["ar"], dialects: ["ar-Gulf"], nicheSlugs: ["beauty"], deliverables: [{ platform: "INSTAGRAM", format: "STORY", count: 2 }],
  budget: { amountMinor: "123456", currencyCode: "KWD" }, desiredCreatorCount: 3, impressionsTarget: 10001,
  period: { startsAt: "2026-11-01T10:00:00.000Z", endsAt: "2026-11-10T10:00:00.000Z", timeZone: "Asia/Kuwait" },
  physicalPresenceRequired: false, presenceCountryCodes: [], travelAllowed: false, tone: "ودي", noGoTopics: [], preferredTiers: [],
  dataVerificationRequired: false, preferredLicencePolicyIds: [], usageRights: "للحملة فقط", kpis: [{ name: "الزيارات", target: "زيادة الزيارات" }], assumptions: [], openQuestions: [] });
afterEach(async () => {
  const workspaces = await prisma.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } });
  if (workspaces.length) {
    const ids = workspaces.map(row => row.id);
    for (const table of ["PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission", "CampaignBriefProvenance",
      "CampaignProposalDependency", "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding", "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const)
      await prisma.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join(ids)})`);
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
async function person(role: "BRAND" | "CREATOR" = "BRAND") {
  const id = key(); users.add(id);
  const user = await prisma.user.create({ data: { id, role, active: true, isTest: true, name: "Synthetic native page actor",
    email: `${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: new Date() } });
  const token = await openSession(id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Actual page-test session missing");
  const actor: OrganizationActor = { userId: session.userId, role: session.role, sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  return { user, actor, token };
}
async function company() {
  const owner = await person(), brand = await prisma.brand.create({ data: { userId: owner.user.id, name: "Synthetic page company",
    slug: "native-page-" + key(), countryCode: "KW", isTest: true } }); brands.add(brand.id);
  return { ...owner, brand, scope: { kind: "OWN_BRAND", brandId: brand.id } as PlanningScope };
}
type Company = Awaited<ReturnType<typeof company>>;
async function agency(customer: Company, label: string) {
  const owner = await person(), seat = await person(), { organization } = await createOrganization(owner.actor, { operationKey: key(), kind: "AGENCY", nameOriginal: label });
  organizations.add(organization.id);
  const revision = async () => (await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).revision;
  const proposed = await proposeClientAssociation(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), brandId: customer.brand.id });
  const { client } = await authorizeClientAssociation(customer.actor, proposed.client.id, { operationKey: key(), expectedRevision: proposed.client.revision, capabilities });
  const member = await proposeMember(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), targetUserId: seat.user.id });
  const { membership } = await acceptMembership(seat.actor, member.membership.id, { operationKey: key(), expectedRevision: member.membership.revision });
  const { grant } = await setClientGrant(owner.actor, client.id, { operationKey: key(), expectedClientRevision: client.revision,
    membershipId: membership.id, expectedGrantRevision: null, capabilities });
  return { owner, seat, organization, client, membership, grant, scope: { kind: "CLIENT", clientId: client.id } as PlanningScope };
}
type Agency = Awaited<ReturnType<typeof agency>>;
async function grant(a: Agency, changes: { view?: boolean; plan?: boolean }) {
  const current = await prisma.clientGrant.findUniqueOrThrow({ where: { id: a.grant.id } }), client = await prisma.organizationClient.findUniqueOrThrow({ where: { id: a.client.id } });
  return setClientGrant(a.owner.actor, client.id, { operationKey: key(), expectedClientRevision: client.revision,
    membershipId: a.membership.id, expectedGrantRevision: current.revision, capabilities: { ...capabilities, view: current.view, plan: current.plan, ...changes } });
}
async function makePlanning(actor: OrganizationActor, scope: PlanningScope, title = "Native planned campaign", selection: unknown = { kind: "NONE" }) {
  return executeCampaignPlanningCommand(actor, { operationKey: key(), scope,
    ...(scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(actor, scope.clientId, "plan") } : {}), action: "CREATE",
    expectedCampaignRevision: 0, expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0,
    payload: { fields: { ...fields, title }, selection, narrative: null } });
}
async function step(actor: OrganizationActor, scope: PlanningScope, id: string, action: string, payload: unknown) {
  const current = await getPlanningCampaign(actor, { scope, campaignId: id });
  return executeCampaignPlanningCommand(actor, { operationKey: key(), scope,
    ...(scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(actor, scope.clientId, "plan") } : {}), campaignId: id, action,
    expectedCampaignRevision: current.campaign.revision, expectedPlanningRevision: current.planning.revision,
    expectedSelectionId: current.planning.selection.id, expectedSelectionRevision: current.planning.selection.revision, payload });
}
async function legacy(owner: Company, title: string) {
  return (await createCampaign(owner.actor.userId, { operationKey: key(), fields: { ...fields, title } }, undefined, owner.actor)).campaign;
}
function bindInput(owner: Company, id: string, revision: number) {
  return { operationKey: key(), scope: owner.scope, campaignId: id, action: "BIND_OWN", expectedCampaignRevision: revision,
    expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0, payload: { selection: { kind: "NONE" } } };
}
async function approvedContext(customer: Company, a: Agency) {
  const content = BrandContextContentSchema.parse({ schemaVersion: 1, positioning: { text: "Page-private original context canary", language: "en" },
    values: [], tone: { text: "Exact page approved tone", language: "en" }, references: [], competitors: [] });
  const expected = async () => ({ expectedAuthority: await getClientAuthority(a.seat.actor, a.client.id, "plan") });
  const created = await executeBrandContextCommand(a.seat.actor, { operationKey: key(), scope: a.scope, ...(await expected()), action: "CREATE", expectedRevision: 0,
    payload: { nameOriginal: { text: "Native page context", language: "en" }, content } });
  const submitted = await executeBrandContextCommand(a.seat.actor, { operationKey: key(), scope: a.scope, ...(await expected()), action: "SUBMIT",
    contextId: created.contextId, expectedRevision: created.revision, payload: {} });
  const approved = await decideContextOwnerReview(customer.actor, { operationKey: key(), submissionId: submitted.submissionId!, expectedRevision: 1, decision: "APPROVE" });
  const version = await prisma.brandContextVersion.findUniqueOrThrow({ where: { id: approved.versionId! } });
  return { kind: "APPROVED_CONTEXT", versionId: version.id, contentHash: version.contentHash };
}
async function rejected(value: Promise<unknown>, code: string, status = 404) { await expect(value).rejects.toMatchObject({ code, status }); }
function privateSafe(value: unknown, canaries: readonly string[]) { const body = JSON.stringify(value); for (const canary of canaries) expect(body).not.toContain(canary); }
const authorityFields = ["organizationId", "clientId", "brandId", "membershipId", "grantId", "organizationRevision", "membershipRevision", "clientRevision", "grantRevision"] as const;
function latch<T>() { let resolve!: (value: T | PromiseLike<T>) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
type WaitTable = "User" | "Brand" | "Campaign" | "ClientGrant" | "CampaignPlanningCommand" | "CampaignBrief" | "AdminAudit";
async function waitBlocked(monitor: PrismaClient, blockingPid: number, table: WaitTable, signal?: AbortSignal) {
  const deadline = performance.now() + 4000;
  while (performance.now() < deadline) {
    if (signal?.aborted) throw new Error("Page wait observation cancelled");
    const rows = await monitor.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'
      AND ${blockingPid}=ANY(pg_blocking_pids(pid)) AND query LIKE ${`%"${table}"%`}`;
    if (rows.length) return rows[0]!.pid; await delay(20);
  }
  throw new Error("Page operation did not reach its actual native wait");
}
async function blocker(table: WaitTable, id: string | null, after?: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  const peer = new PrismaClient(), monitor = new PrismaClient(), ready = latch<number>(), release = latch<void>(), stop = new AbortController();
  const holding = peer.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout='4s'`;
    if (table === "CampaignPlanningCommand" || table === "AdminAudit") await tx.$executeRaw(Prisma.sql`LOCK TABLE ${Prisma.raw('"' + table + '"')} IN SHARE MODE`);
    else if (table === "CampaignBrief") await tx.$executeRaw`LOCK TABLE "CampaignBrief" IN ACCESS EXCLUSIVE MODE`;
    else await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw('"' + table + '"')} WHERE id=${id} FOR UPDATE`);
    const pids = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
    ready.resolve(pids[0]!.pid); await release.promise; if (after) await after(tx);
  }, { maxWait: 5000, timeout: 12000 }); void holding.catch(() => {});
  let pid: number;
  try { pid = await Promise.race([ready.promise, holding.then(() => { throw new Error("Page blocker ended before obtaining its native lock"); })]); }
  catch (error) { release.resolve(); await holding.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); throw error; }
  const observed: Promise<number>[] = [];
  return { holding, monitor, release: () => release.resolve(), wait() { const result = waitBlocked(monitor, pid, table, stop.signal); observed.push(result); return result; },
    behind(blockingPid: number, waitingTable: WaitTable) { const result = waitBlocked(monitor, blockingPid, waitingTable, stop.signal); observed.push(result); return result; },
    async close() { release.resolve(); stop.abort(); await holding.catch(() => {}); await Promise.allSettled(observed); await peer.$disconnect(); await monitor.$disconnect(); } };
}
async function nativeWait<T>(held: Awaited<ReturnType<typeof blocker>>, action: Promise<T>) {
  void action.catch(() => {});
  return Promise.race([held.wait(), action.then(() => { throw new Error("Page returned before its actual native waiting"); })]);
}

it("preserves OWN missing-profile/list/legacy history and classifies bound detail/brief without CLIENT fallback or loose queries", async () => {
  const absent = await person();
  expect(await getCampaignListPageContext(absent.actor)).toEqual({ kind: "LEGACY_LIST", initialList: null, profileRequired: true });
  expect(await getNewCampaignPageContext(absent.actor)).toMatchObject({ scope: null, campaignId: null, initialCampaign: null, planAuthority: null });
  expect(await getCampaignBriefPageContext(absent.actor)).toEqual({ kind: "EMPTY" });
  const owner = await company(), old = await legacy(owner, "Private retained unbound canary"), scoped = await makePlanning(owner.actor, owner.scope);
  const list = await getCampaignListPageContext(owner.actor);
  expect(list.kind).toBe("LEGACY_LIST"); if (list.kind !== "LEGACY_LIST") throw new Error("OWN list changed family");
  expect(list.profileRequired).toBe(false); expect(list.initialList?.campaigns.map(row => row.id)).toEqual(expect.arrayContaining([old.id, scoped.campaignId]));
  const ownNew = await getNewCampaignPageContext(owner.actor);
  expect(ownNew).toMatchObject({ scope: owner.scope, campaignId: null, initialCampaign: null, planAuthority: null });
  const oldPage = await getCampaignDetailPageContext(owner.actor, old.id);
  expect(oldPage.kind).toBe("LEGACY"); if (oldPage.kind !== "LEGACY") throw new Error("Unbound history lost");
  expect(oldPage.initialCampaign.id).toBe(old.id); expect(oldPage.initialCampaign.fields.title).toBe("Private retained unbound canary");
  expect((await getCampaignBriefPageContext(owner.actor, { campaign: old.id })).kind).toBe("LEGACY");
  const bound = await getCampaignDetailPageContext(owner.actor, scoped.campaignId);
  expect(bound.kind).toBe("PLANNING"); if (bound.kind !== "PLANNING") throw new Error("Bound OWN used old editor");
  expect(bound.props.scope).toEqual(owner.scope); expect(bound.props.initialCampaign?.campaign.id).toBe(scoped.campaignId);
  expect((await getCampaignBriefPageContext(owner.actor, { campaign: scoped.campaignId })).kind).toBe("PLANNING");
  // Actual legacy producers leave21 versions. Corrupt only the oldest retained
  // version outside the bounded planning page: a detached/full legacy hydration
  // would fail before it could classify, while the thin bound branch must work.
  let retained = await legacy(owner, "Long retained native history");
  const first = await generateCampaignBrief(owner.actor.userId, retained.id, { operationKey: key(), expectedRevision: retained.revision }, undefined, owner.actor);
  retained = first.campaign;
  for (let index = 0; index < 20; index++) retained = (await applyCampaignMutation(owner.actor.userId, retained.id, { operationKey: key(), expectedRevision: retained.revision,
    action: "UPDATE_FIELDS", payload: { patch: { title: "Native retained version " + index } } }, undefined, { channel: "FORM", serverAuth: owner.actor })).campaign;
  expect(await prisma.campaignBrief.count({ where: { campaignId: retained.id } })).toBe(21);
  await executeCampaignPlanningCommand(owner.actor, bindInput(owner, retained.id, retained.revision));
  await prisma.campaignBrief.update({ where: { id: first.brief.id }, data: { content: { deliberatelyCorruptOldUnexposedVersion: true } } });
  await rejected(getCampaign(owner.actor.userId, retained.id, undefined, owner.actor), "INVALID_STORED_BRIEF", 400);
  const retainedPage = await getCampaignDetailPageContext(owner.actor, retained.id);
  expect(retainedPage.kind).toBe("PLANNING"); if (retainedPage.kind !== "PLANNING") throw new Error("Bound history was eagerly projected by legacy");
  expect(retainedPage.props.initialCampaign?.briefs).toHaveLength(20);
  const a = await agency(owner, "Native OWN no-fallback client"), privateClient = await makePlanning(a.seat.actor, a.scope, "Private client draft canary");
  await rejected(getCampaignDetailPageContext(owner.actor, privateClient.campaignId), "NOT_FOUND");
  await rejected(getCampaignDetailPageContext(owner.actor, privateClient.campaignId, { clientId: a.client.id }), "NOT_FOUND");
  await rejected(getCampaignDetailPageContext(owner.actor, old.id, { clientId: a.client.id }), "NOT_FOUND");
  await rejected(getCampaignBriefPageContext(owner.actor, { campaign: privateClient.campaignId }), "NOT_FOUND");
  for (const search of [{ clientId: [a.client.id] }, { unknown: "x" }, { clientId: "" }]) {
    await rejected(getNewCampaignPageContext(owner.actor, search), "VALIDATION", 422);
    await rejected(getCampaignListPageContext(owner.actor, search), "VALIDATION", 422);
  }
  await rejected(getCampaignDetailPageContext(owner.actor, old.id, { campaign: old.id }), "VALIDATION", 422);
  await rejected(getCampaignBriefPageContext(owner.actor, { campaign: [old.id] }), "VALIDATION", 422);
  await rejected(getCampaignOwnerReviewsPageContext(owner.actor, { clientId: a.client.id }), "VALIDATION", 422);
}, 45000);

it("binds same-Brand CLIENT A/B page props to real view/plan authority and gives the actual owner only submitted inbox without a seat", async () => {
  const customer = await company(), a = await agency(customer, "Native page agency A"), b = await agency(customer, "Native page agency B");
  const selected = await approvedContext(customer, a), ca = await makePlanning(a.seat.actor, a.scope, "Exact client A title", selected), cb = await makePlanning(b.seat.actor, b.scope, "Hidden client B title");
  const detail = await getCampaignDetailPageContext(a.seat.actor, ca.campaignId, { clientId: a.client.id });
  expect(detail.kind).toBe("PLANNING"); if (detail.kind !== "PLANNING") throw new Error("CLIENT entered legacy");
  expect(detail.props.scope).toEqual(a.scope); expect(detail.props.initialCampaign?.campaign.id).toBe(ca.campaignId);
  expect(detail.props.initialCampaign?.planning.selectedContext?.id).toBe(selected.versionId);
  expect(detail.props.planAuthority?.capability).toBe("plan"); expect(detail.props.initialCampaign?.currentAuthority?.capability).toBe("view");
  for (const field of authorityFields) expect(detail.props.planAuthority?.[field]).toBe(detail.props.initialCampaign?.currentAuthority?.[field]);
  const list = await getCampaignListPageContext(a.seat.actor, { clientId: a.client.id });
  expect(list.kind).toBe("PLANNING_LIST"); if (list.kind !== "PLANNING_LIST") throw new Error("CLIENT list family changed");
  expect(list.props.initialPage?.campaigns.map(row => row.id)).toEqual([ca.campaignId]); privateSafe(list, [cb.campaignId, "Hidden client B title"]);
  expect((await getCampaignBriefPageContext(a.seat.actor, { clientId: a.client.id })).kind).toBe("PLANNING_LIST");
  expect((await getCampaignBriefPageContext(a.seat.actor, { campaign: ca.campaignId, clientId: a.client.id })).kind).toBe("PLANNING");
  expect((await getNewCampaignPageContext(a.seat.actor, { clientId: a.client.id })).scope).toEqual(a.scope);
  await rejected(getCampaignListPageContext(a.seat.actor, { clientId: b.client.id }), "NOT_FOUND");
  await rejected(getCampaignDetailPageContext(a.seat.actor, cb.campaignId, { clientId: a.client.id }), "NOT_FOUND");
  await rejected(getCampaignDetailPageContext(a.seat.actor, ca.campaignId), "NOT_FOUND");
  await grant(a, { plan: false });
  const readOnly = await getCampaignDetailPageContext(a.seat.actor, ca.campaignId, { clientId: a.client.id });
  expect(readOnly.kind).toBe("PLANNING"); if (readOnly.kind !== "PLANNING") throw new Error("Read-only CLIENT disappeared");
  expect(readOnly.props.planAuthority).toBeNull(); expect(readOnly.props.initialCampaign?.currentAuthority?.capability).toBe("view");
  expect((await getNewCampaignPageContext(a.seat.actor, { clientId: a.client.id })).planAuthority).toBeNull();
  await grant(a, { plan: true, view: false });
  await rejected(getNewCampaignPageContext(a.seat.actor, { clientId: a.client.id }), "NOT_FOUND");
  await rejected(getCampaignListPageContext(a.seat.actor, { clientId: a.client.id }), "NOT_FOUND");
  await grant(a, { view: true });
  await step(a.seat.actor, a.scope, ca.campaignId, "SAVE_NARRATIVE", { narrative: { schemaVersion: 1, mode: "CHAT", processing: "UNPROCESSED", originalText: { text: "Unsubmitted page narrative canary", language: "en" } } });
  await step(a.seat.actor, a.scope, ca.campaignId, "PROPOSE_FIELDS", { type: "PROPOSE_FIELDS", patch: { tone: "Unapplied private tone" }, originalText: { text: "Unsubmitted page proposal canary", language: "en" } });
  const generated = await step(a.seat.actor, a.scope, ca.campaignId, "GENERATE_BRIEF", {});
  const submitted = await step(a.seat.actor, a.scope, ca.campaignId, "SUBMIT_BRIEF", { briefId: generated.briefId, expectedBriefVersion: generated.version });
  expect(await prisma.organizationMembership.count({ where: { userId: customer.user.id } })).toBe(0);
  await rejected(getCampaignDetailPageContext(customer.actor, ca.campaignId, { clientId: a.client.id }), "NOT_FOUND");
  const inbox = await getCampaignOwnerReviewsPageContext(customer.actor);
  expect(inbox.initialPage?.reviews.map(row => row.id)).toEqual([submitted.submissionId]);
  expect((await getCampaignOwnerReviewsPageContext(a.seat.actor)).initialPage?.reviews).toEqual([]);
  privateSafe(inbox, ["Unsubmitted page narrative canary", "Unsubmitted page proposal canary", "Page-private original context canary", cb.campaignId,
    customer.token, customer.actor.sessionId, a.seat.token, a.seat.actor.sessionId, customer.user.email, a.seat.user.email]);
  const peer = new PrismaClient();
  try { expect((await getCampaignDetailPageContext(a.seat.actor, ca.campaignId, { clientId: a.client.id }, { client: peer })).kind).toBe("PLANNING"); }
  finally { await peer.$disconnect(); }
}, 45000);

it("uses captured query/actor and current/final native sessions, grants and owners, with real BIND queue ordering before private legacy hydration", async () => {
  const revoked = await person(); await prisma.authSession.update({ where: { id: revoked.actor.sessionId }, data: { revokedAt: new Date() } });
  await rejected(getCampaignListPageContext(revoked.actor, { unknown: ["invalid"] }), "UNAUTHENTICATED", 401);
  const wrongRole = await person("CREATOR");
  await rejected(getNewCampaignPageContext(wrongRole.actor, { unknown: ["invalid"] }), "FORBIDDEN", 403);
  const sessionOwner = await company(), sessionCampaign = await makePlanning(sessionOwner.actor, sessionOwner.scope);
  const sessionHold = await blocker("User", sessionOwner.user.id, tx => tx.authSession.update({ where: { id: sessionOwner.actor.sessionId }, data: { revokedAt: new Date() } }));
  const sessionRead = getCampaignDetailPageContext(sessionOwner.actor, sessionCampaign.campaignId); void sessionRead.catch(() => {});
  try { expect(await nativeWait(sessionHold, sessionRead)).toBeGreaterThan(0); sessionHold.release(); await sessionHold.holding; await rejected(sessionRead, "UNAUTHENTICATED", 401); }
  finally { await sessionHold.close(); await sessionRead.catch(() => {}); }
  const owner = await company(), planned = await makePlanning(owner.actor, owner.scope);
  const roleHold = await blocker("User", owner.user.id, tx => tx.user.update({ where: { id: owner.user.id }, data: { role: "CREATOR" } }));
  const reading = getCampaignDetailPageContext(owner.actor, planned.campaignId); void reading.catch(() => {});
  try { expect(await nativeWait(roleHold, reading)).toBeGreaterThan(0); roleHold.release(); await roleHold.holding; await rejected(reading, "UNAUTHENTICATED", 401); }
  finally { await roleHold.close(); await reading.catch(() => {}); }
  const transferring = await company(), transferred = await makePlanning(transferring.actor, transferring.scope), target = await person();
  const brandHold = await blocker("Brand", transferring.brand.id, tx => tx.brand.update({ where: { id: transferring.brand.id }, data: { userId: target.user.id } }));
  const transferRead = getCampaignDetailPageContext(transferring.actor, transferred.campaignId); void transferRead.catch(() => {});
  try { expect(await nativeWait(brandHold, transferRead)).toBeGreaterThan(0); brandHold.release(); await brandHold.holding; await rejected(transferRead, "NOT_FOUND"); }
  finally { await brandHold.close(); await transferRead.catch(() => {}); }
  const customer = await company(), a = await agency(customer, "Native captured page agency A"), b = await agency(customer, "Native captured page agency B");
  const ca = await makePlanning(a.seat.actor, a.scope), cb = await makePlanning(b.seat.actor, b.scope);
  const mutableSearch: Record<string, string | string[] | undefined> = { clientId: a.client.id }, mutableActor = { ...a.seat.actor };
  const captureHold = await blocker("User", a.seat.user.id), capturedRead = getCampaignDetailPageContext(mutableActor, ca.campaignId, mutableSearch); void capturedRead.catch(() => {});
  try {
    expect(await nativeWait(captureHold, capturedRead)).toBeGreaterThan(0);
    mutableSearch.clientId = b.client.id; mutableSearch.unknown = "Must not enter captured command"; mutableActor.userId = customer.user.id;
    captureHold.release(); await captureHold.holding;
    const result = await capturedRead; expect(result.kind).toBe("PLANNING"); if (result.kind !== "PLANNING") throw new Error("Captured CLIENT changed family");
    expect(result.props.scope).toEqual(a.scope); expect(result.props.initialCampaign?.campaign.id).toBe(ca.campaignId); privateSafe(result, [cb.campaignId]);
  } finally { await captureHold.close(); await capturedRead.catch(() => {}); }
  const grantHold = await blocker("ClientGrant", a.grant.id, tx => tx.clientGrant.update({ where: { id: a.grant.id }, data: { view: false, plan: false, revision: { increment: 1 } } }));
  const denied = getCampaignDetailPageContext(a.seat.actor, ca.campaignId, { clientId: a.client.id }); void denied.catch(() => {});
  try { expect(await nativeWait(grantHold, denied)).toBeGreaterThan(0); grantHold.release(); await grantHold.holding; await rejected(denied, "NOT_FOUND"); }
  finally { await grantHold.close(); await denied.catch(() => {}); }
  await grant(a, { view: true, plan: true });
  // A real grant writer queues behind staged plan authority's User locks. On
  // commit it wins that queue before final view, changing revision but retaining
  // VIEW. Old plan metadata must then be cleared, not enabled from its snapshot.
  const auditHold = await blocker("AdminAudit", null), renewing = getCampaignDetailPageContext(a.seat.actor, ca.campaignId, { clientId: a.client.id }); void renewing.catch(() => {});
  let writer: ReturnType<typeof grant> | undefined;
  try {
    const planPid = await nativeWait(auditHold, renewing); writer = grant(a, { plan: false }); void writer.catch(() => {});
    expect(await auditHold.behind(planPid, "User")).toBeGreaterThan(0);
    auditHold.release(); await auditHold.holding; await writer;
    const result = await renewing; expect(result.kind).toBe("PLANNING"); if (result.kind !== "PLANNING") throw new Error("View permission was lost");
    expect(result.props.planAuthority).toBeNull(); expect(result.props.initialCampaign?.currentAuthority?.grantRevision).toBe((await prisma.clientGrant.findUniqueOrThrow({ where: { id: a.grant.id } })).revision);
  } finally { await auditHold.close(); await writer?.catch(() => {}); await renewing.catch(() => {}); }
  await grant(a, { plan: true });
  // Optional plan's committed native read audit must precede the final campaign
  // wait. Actual expiry while that final frame waits must reject all RSC props.
  const auditBefore = await prisma.adminAudit.count({ where: { actorUserId: a.seat.user.id, action: "organization.authority_read" } });
  const expiresAt = new Date(Date.now() + 2500); await prisma.authSession.update({ where: { id: a.seat.actor.sessionId }, data: { expiresAt } });
  const campaignHold = await blocker("Campaign", ca.campaignId), expiring = getCampaignDetailPageContext(a.seat.actor, ca.campaignId, { clientId: a.client.id }); void expiring.catch(() => {});
  try {
    expect(await nativeWait(campaignHold, expiring)).toBeGreaterThan(0);
    expect(Date.now()).toBeLessThan(expiresAt.getTime());
    expect(await prisma.adminAudit.count({ where: { actorUserId: a.seat.user.id, action: "organization.authority_read" } })).toBeGreaterThan(auditBefore);
    while (Date.now() <= expiresAt.getTime()) await delay(Math.min(30, expiresAt.getTime() - Date.now() + 1));
    expect(await resolveSession(a.seat.token)).toBeNull(); campaignHold.release(); await campaignHold.holding; await rejected(expiring, "UNAUTHENTICATED", 401);
  } finally { await campaignHold.close(); await expiring.catch(() => {}); }
  const bindingOwner = await company(), old = await legacy(bindingOwner, "Native bind-before-read canary");
  const journalHold = await blocker("CampaignPlanningCommand", null), binding = executeCampaignPlanningCommand(bindingOwner.actor, bindInput(bindingOwner, old.id, old.revision)); void binding.catch(() => {});
  let queuedPage: ReturnType<typeof getCampaignDetailPageContext> | undefined;
  try {
    const bindingPid = await nativeWait(journalHold, binding);
    queuedPage = getCampaignDetailPageContext(bindingOwner.actor, old.id); void queuedPage.catch(() => {});
    expect(await journalHold.behind(bindingPid, "User")).toBeGreaterThan(0);
    journalHold.release(); await journalHold.holding; await binding;
    expect((await queuedPage).kind).toBe("PLANNING");
  } finally { await journalHold.close(); await binding.catch(() => {}); await queuedPage?.catch(() => {}); }
  const readOwner = await company(), unbound = await legacy(readOwner, "Native read-before-bind canary");
  const briefHold = await blocker("CampaignBrief", null), legacyReading = getCampaignDetailPageContext(readOwner.actor, unbound.id); void legacyReading.catch(() => {});
  let queuedBinding: ReturnType<typeof executeCampaignPlanningCommand> | undefined;
  try {
    const readPid = await nativeWait(briefHold, legacyReading);
    queuedBinding = executeCampaignPlanningCommand(readOwner.actor, bindInput(readOwner, unbound.id, unbound.revision)); void queuedBinding.catch(() => {});
    expect(await briefHold.behind(readPid, "User")).toBeGreaterThan(0);
    briefHold.release(); await briefHold.holding;
    const result = await legacyReading; expect(result.kind).toBe("LEGACY"); if (result.kind !== "LEGACY") throw new Error("Atomic legacy read changed its classification");
    expect(result.initialCampaign.fields.title).toBe("Native read-before-bind canary"); await queuedBinding;
    expect((await getCampaignDetailPageContext(readOwner.actor, unbound.id)).kind).toBe("PLANNING");
  } finally { await briefHold.close(); await legacyReading.catch(() => {}); await queuedBinding?.catch(() => {}); }
}, 60000);
