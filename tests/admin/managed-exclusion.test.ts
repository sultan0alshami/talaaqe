import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import type { OrganizationActor } from "@/lib/organizations/context";
import type { PlanningScope } from "@/lib/brand-context/contracts";
import { getClientAuthority } from "@/lib/organizations/loaders";
import { acceptMembership, authorizeClientAssociation, createOrganization, proposeClientAssociation,
  proposeMember, setClientGrant } from "@/lib/organizations/service";
import { executeCampaignPlanningCommand, getPlanningCampaign, decideCampaignOwnerReview } from "@/lib/campaign-planning/service";
import { ManagedOrderCommandSchema } from "@/lib/managed/contracts";
import { submitManagedOrder } from "@/lib/managed/orders";
import { getAdminCampaigns } from "@/lib/admin/campaigns";
import { AdminCampaignsSchema, type AdminCampaignsDTO } from "@/lib/admin/contracts";
import { inputJson } from "@/lib/onboarding/drafts";
import { campaignFields } from "../campaigns/fixtures";

// Exactly two native groups. Root alone activates/runs against the guarded
// disposable test target. Native JWT/User/AuthSession, organization consent,
// M03 producers/approvals and one actual managed request are real owned
// synthetic fixtures. No auth/domain/query/Date mock or .test import is used.
// Structural bulk planning rows only exercise page exclusion, not live service,
// operational governance, approved legal identity, tax or provider readiness.
const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>(), campaigns = new Set<string>();
const key = () => randomUUID();
const all = { view: true, plan: true, approveShortlist: true, reviewContent: true, signCustomer: true, financial: true, manageGrants: true };
const hidden = "PROTECTED_PLANNING_ONLY_" + key();
const hiddenBudget = "771122334455660001";
beforeAll(async () => {
  const taskId = process.env.INFAME_TASK_ID;
  if (!taskId || !/^infame_[a-f0-9]{12}$/.test(taskId) || process.env.INFAME_ENV !== "test" || process.env.NODE_ENV === "production") throw new Error("Admin exclusion fixtures require the guarded test task");
  const rows = await prisma.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]?.id !== taskId || rows[0]?.kind !== "test" || rows[0]?.db !== taskId + "_test" || rows[0]?.host !== "127.0.0.1") throw new Error("Admin exclusion fixture target identity mismatch");
});
afterEach(async () => {
  const scopes = await prisma.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } });
  const ids = scopes.map(row => row.id);
  if (ids.length) {
    await prisma.$transaction(async tx => {
      for (const table of ["ManagedOrderCommand", "ManagedOrderState", "ManagedOrderSubmission", "ManagedOrder",
        "ContextReferenceCommand", "ContextSubmissionReferences", "ContextReferenceState", "ContextReferenceManifest", "ContextAssetBinding",
        "PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission", "CampaignBriefProvenance",
        "CampaignProposalDependency", "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding", "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const) {
        await tx.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join(ids)})`);
      }
      await tx.planningWorkspace.deleteMany({ where: { id: { in: ids } } });
    });
  }
  await prisma.campaign.deleteMany({ where: { id: { in: [...campaigns] } } });
  await prisma.organizationCommand.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await prisma.clientGrant.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organizationClient.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [...organizations] } } });
  await prisma.brand.deleteMany({ where: { id: { in: [...brands] } } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
  if (users.size) await prisma.outboxEvent.deleteMany({ where: { OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await prisma.user.deleteMany({ where: { id: { in: [...users] } } }); users.clear(); brands.clear(); organizations.clear(); campaigns.clear();
});
async function person(role: "BRAND" | "ADMIN" = "BRAND") {
  const id = key(); users.add(id);
  const user = await prisma.user.create({ data: { id, role, active: true, isTest: true, name: "Synthetic admin-exclusion actor",
    email: `admin-exclusion-${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  const token = await openSession(user.id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Actual admin-exclusion native session did not resolve");
  const actor: OrganizationActor = { userId: session.userId, role: session.role, sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  expect(actor.role).toBe(role); return { user, actor, token };
}
type Account = Awaited<ReturnType<typeof person>>;
async function company() {
  const owner = await person(), brand = await prisma.brand.create({ data: { userId: owner.user.id, name: "  Original legacy company  ",
    slug: "admin-x-" + key(), countryCode: "KW", state: "PRIVATE", isTest: true } }); brands.add(brand.id);
  return { ...owner, brand, scope: { kind: "OWN_BRAND", brandId: brand.id } as PlanningScope };
}
type Company = Awaited<ReturnType<typeof company>>;
async function agency(customer: Company, label: string) {
  const owner = await person(), seat = await person();
  const { organization } = await createOrganization(owner.actor, { operationKey: key(), kind: "AGENCY", nameOriginal: "Synthetic admin-exclusion agency " + label }); organizations.add(organization.id);
  const revision = async () => (await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).revision;
  const proposed = await proposeClientAssociation(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), brandId: customer.brand.id });
  const { client } = await authorizeClientAssociation(customer.actor, proposed.client.id, { operationKey: key(), expectedRevision: proposed.client.revision, capabilities: all });
  const pending = await proposeMember(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), targetUserId: seat.user.id });
  const { membership } = await acceptMembership(seat.actor, pending.membership.id, { operationKey: key(), expectedRevision: pending.membership.revision });
  await setClientGrant(owner.actor, client.id, { operationKey: key(), expectedClientRevision: client.revision, membershipId: membership.id, expectedGrantRevision: null, capabilities: all });
  return { owner, seat, client, scope: { kind: "CLIENT", clientId: client.id } as PlanningScope };
}
async function planningAuthority(account: Account, scope: PlanningScope) {
  return scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(account.actor, scope.clientId, "plan") } : {};
}
async function fresh(account: Account, scope: PlanningScope, label: string) {
  const result = await executeCampaignPlanningCommand(account.actor, { operationKey: key(), scope, ...await planningAuthority(account, scope), action: "CREATE",
    expectedCampaignRevision: 0, expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0,
    payload: { fields: { ...campaignFields, title: hidden + "_" + label, summary: hidden + "_SUMMARY_" + label,
      budget: { amountMinor: hiddenBudget, currencyCode: "KWD" } }, selection: { kind: "NONE" }, narrative: null } });
  campaigns.add(result.campaignId); return result.campaignId;
}
async function step(account: Account, scope: PlanningScope, campaignId: string, action: string, payload: unknown) {
  const current = await getPlanningCampaign(account.actor, { scope, campaignId });
  return executeCampaignPlanningCommand(account.actor, { operationKey: key(), scope, ...await planningAuthority(account, scope), campaignId, action, payload,
    expectedCampaignRevision: current.campaign.revision, expectedPlanningRevision: current.planning.revision,
    expectedSelectionId: current.planning.selection.id, expectedSelectionRevision: current.planning.selection.revision });
}
async function managed(customer: Company) {
  const campaignId = await fresh(customer, customer.scope, "SUBMITTED_MANAGED"), generated = await step(customer, customer.scope, campaignId, "GENERATE_BRIEF", {});
  const sent = await step(customer, customer.scope, campaignId, "SUBMIT_BRIEF", { briefId: generated.briefId!, expectedBriefVersion: generated.version! });
  expect((await decideCampaignOwnerReview(customer.actor, { operationKey: key(), submissionId: sent.submissionId!, expectedRevision: 1, decision: "APPROVE" })).state).toBe("APPROVED");
  const current = await getPlanningCampaign(customer.actor, { scope: customer.scope, campaignId });
  const input = ManagedOrderCommandSchema.parse({ action: "SUBMIT", operationKey: key(), scope: customer.scope, campaignId,
    expectedCampaignRevision: current.campaign.revision, expectedPlanningRevision: current.planning.revision,
    expectedSelectionId: current.planning.selection.id, expectedSelectionRevision: current.planning.selection.revision,
    briefId: generated.briefId!, expectedBriefVersion: generated.version!, disclosureVersion: "infame-order-disclosure-v1" });
  return { campaignId, result: await submitManagedOrder(customer.actor, input) };
}
async function stored(customer: Company, id: string, title: string, amountMinor: string, protectedRow = false, workspaceId?: string) {
  campaigns.add(id);
  const fields = { title, budget: { amountMinor, currencyCode: "KWD" } };
  const row = await prisma.campaign.create({ data: { id, brandId: customer.brand.id, title, revision: 1, status: "DRAFT",
    input: inputJson({ schemaVersion: 1, fieldsRevision: 1, fields, proposals: [], clarificationCount: 0 }), createdAt: new Date() } });
  if (protectedRow) {
    if (!workspaceId) throw new Error("Ordered protected draft requires actual native planning workspace");
    const selectionId = key(), at = new Date();
    await prisma.campaignPlanningBinding.create({ data: { campaignId: id, workspaceId, brandId: customer.brand.id, createdAt: at } });
    await prisma.campaignContextSelection.create({ data: { id: selectionId, campaignId: id, workspaceId, revision: 1, contextVersionId: null, contentHash: null, createdAt: at } });
    await prisma.campaignPlanningState.create({ data: { campaignId: id, workspaceId, revision: 1, selectionId, selectionRevision: 1, createdAt: at, updatedAt: at } });
  }
  return row;
}
async function afterBefore(id: string) {
  const previous = await prisma.campaign.findFirst({ where: { id: { lt: id } }, orderBy: { id: "desc" }, select: { id: true } });
  return previous ? { after: previous.id } : {};
}
function projection(page: AdminCampaignsDTO) {
  expect(AdminCampaignsSchema.safeParse(page).success).toBe(true); expect(page.scope).toBe("ALL_STORED_RECORDS");
  expect(Object.keys(page).sort()).toEqual(["asOf", "campaigns", "nextCursor", "scope"]);
  for (const row of page.campaigns) expect(Object.keys(row).sort()).toEqual(["brandName", "budget", "budgetSource", "createdAt", "id", "revision", "status", "title"]);
  for (const forbidden of [hidden, '"input":', '"proposals":', '"conversation":', '"briefs":']) expect(JSON.stringify(page)).not.toContain(forbidden);
  expect(page.campaigns.some(row => row.budget?.amountMinor === hiddenBudget)).toBe(false);
}
async function observedRead(admin: Account, query: { after?: string }) {
  const sql: string[] = [], client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  // Capture actual executed SQL only, never parameter payloads/session IDs.
  // This observer neither changes scheduling/results nor mocks the query.
  client.$on("query", event => { sql.push(event.query); });
  try { const result = await getAdminCampaigns(admin.actor, query, { client }); return { result, sql }; }
  finally { await client.$disconnect(); }
}
function preprojectionFilter(sql: string[]) {
  const paged = sql.filter(statement => /^\s*SELECT\b/i.test(statement) && /\bFROM\s+(?:"[^"]+"\.)?"Campaign"(?:\s|$)/i.test(statement)
    && /\bORDER\s+BY\b/i.test(statement) && /\bLIMIT\b/i.test(statement));
  expect(paged.length, "Actual canonical campaign page SELECT must be captured").toBeGreaterThan(0);
  for (const statement of paged) {
    const upper = statement.toUpperCase(), where = upper.indexOf("WHERE"), limit = upper.lastIndexOf("LIMIT");
    const predicate = statement.slice(where, limit);
    expect(where).toBeGreaterThanOrEqual(0); expect(predicate).toContain('"CampaignPlanningBinding"');
    expect(/\bNOT\s+(?:EXISTS|IN)\b/i.test(predicate), "Native SQL must exclude binding before LIMIT/projection").toBe(true);
    // Full legacy fields must still undergo strict D047 validation. If root
    // uses JSON-piece projection, it must not ALSO hydrate top-level input.
    const select = statement.slice(0, upper.indexOf("FROM"));
    if (/(?:"input"|\binput\b)\s*(?:->|#>)/i.test(select)) {
      expect(/(?:"input"|\binput\b)\s*(?:,|AS\s+(?:"[^"]+"|[A-Za-z_]\w*)\s*(?:,|$)|$)/i.test(select)).toBe(false);
    }
  }
}

describe("ordinary ADMIN canonical campaign reads exclude M03/managed content", () => {
  it("excludes actual OWN/two same-Brand CLIENT drafts and a real managed submission while preserving native legacy metadata", async () => {
    const admin = await person("ADMIN"), owner = await company(), a = await agency(owner, "A"), b = await agency(owner, "B");
    const ownId = await fresh(owner, owner.scope, "OWN_DRAFT"), aId = await fresh(a.seat, a.scope, "CLIENT_A_DRAFT"), bId = await fresh(b.seat, b.scope, "CLIENT_B_DRAFT");
    await step(a.seat, a.scope, aId, "PROPOSE_FIELDS", { type: "PROPOSE_FIELDS", patch: { summary: hidden + "_UNAPPROVED_PROPOSAL" }, originalText: { text: hidden + "_ORIGINAL_PROPOSAL", language: "en" } });
    const generated = await step(a.seat, a.scope, aId, "GENERATE_BRIEF", {});
    expect((await prisma.campaignBrief.findUniqueOrThrow({ where: { id: generated.briefId! } })).approvedAt).toBeNull();
    const submitted = await managed(owner), protectedIds = [ownId, aId, bId, submitted.campaignId];
    expect(await prisma.managedOrder.findUnique({ where: { campaignId: submitted.campaignId }, select: { id: true } })).toEqual({ id: submitted.result.orderId });
    const bindings = await prisma.campaignPlanningBinding.findMany({ where: { campaignId: { in: protectedIds } }, select: { campaignId: true, workspaceId: true } });
    expect(bindings).toHaveLength(4); expect(new Set(bindings.map(row => row.workspaceId)).size).toBe(3);
    expect((await resolveSession(admin.token))?.role).toBe("ADMIN");
    // Each cursor puts a protected row at the old loader's first slot, avoiding
    // assumptions about unrelated task-owned records or baseline ordering.
    for (const id of protectedIds) {
      const reading = await observedRead(admin, await afterBefore(id)); projection(reading.result);
      expect(reading.result.campaigns.some(row => protectedIds.includes(row.id))).toBe(false); preprojectionFilter(reading.sql);
    }
    const previous = await prisma.campaign.findFirst({ orderBy: { id: "desc" }, select: { id: true } });
    const id = (previous?.id ?? "admin-legacy") + "~legacy:" + key(); if (id.length > 200) throw new Error("Owned legacy fixture ID exceeds native bounds");
    const title = "  Approved legacy administration header  ", budget = "9223372036854775807";
    const legacy = await stored(owner, id, title, budget);
    const page = await getAdminCampaigns(admin.actor, previous ? { after: previous.id } : {}); projection(page);
    expect(page.campaigns.find(row => row.id === legacy.id)).toEqual({ id: legacy.id, title, brandName: owner.brand.name, status: "DRAFT", revision: 1,
      createdAt: legacy.createdAt.toISOString(), budget: { amountMinor: budget, currencyCode: "KWD" }, budgetSource: "SAVED_INPUT" });
    for (const secret of [admin.token, admin.actor.sessionId, owner.token, a.seat.token, b.seat.token, generated.briefId!, submitted.result.submissionId]) expect(JSON.stringify(page)).not.toContain(secret);
  }, 30000);

  it("filters 35 strongly bound protected rows before thirty-row paging and preserves 32 ordered legacy rows/exclusive cursors", async () => {
    const admin = await person("ADMIN"), owner = await company(), seedId = await fresh(owner, owner.scope, "NATIVE_WORKSPACE_SEED");
    const seed = await prisma.campaignPlanningBinding.findUniqueOrThrow({ where: { campaignId: seedId }, select: { workspaceId: true } });
    const maximum = await prisma.campaign.findFirst({ orderBy: { id: "desc" }, select: { id: true } });
    const prefix = (maximum?.id ?? "admin-page") + "~managed-exclusion:" + key() + ":";
    if (prefix.length + 3 > 200) throw new Error("Owned ordered-page fixture IDs exceed native bounds");
    const protectedIds: string[] = [], legacyIds: string[] = [];
    for (let index = 0; index < 67; index++) {
      const id = prefix + String(index).padStart(3, "0"), protectedRow = index < 35;
      await stored(owner, id, protectedRow ? hidden + "_ORDERED_" + index : "  Legacy original " + index + "  ", protectedRow ? hiddenBudget : String(index), protectedRow, seed.workspaceId);
      (protectedRow ? protectedIds : legacyIds).push(id);
    }
    expect(await prisma.campaignPlanningBinding.count({ where: { campaignId: { in: protectedIds } } })).toBe(35);
    expect(await prisma.campaignPlanningBinding.count({ where: { campaignId: { in: legacyIds } } })).toBe(0);
    const start = maximum ? { after: maximum.id } : {}, first = await observedRead(admin, start); projection(first.result);
    expect(first.result.campaigns.map(row => row.id)).toEqual(legacyIds.slice(0, 30)); expect(first.result.nextCursor).toBe(legacyIds[29]); preprojectionFilter(first.sql);
    const next = await observedRead(admin, { after: first.result.nextCursor! }); projection(next.result);
    expect(next.result.campaigns.map(row => row.id)).toEqual(legacyIds.slice(30)); expect(next.result.nextCursor).toBeNull(); preprojectionFilter(next.sql);
    const afterMaximum = await getAdminCampaigns(admin.actor, { after: legacyIds.at(-1)! }); projection(afterMaximum);
    expect(afterMaximum.campaigns).toEqual([]); expect(afterMaximum.nextCursor).toBeNull();
    const afterProtected = await getAdminCampaigns(admin.actor, { after: protectedIds[20] }); projection(afterProtected);
    expect(afterProtected.campaigns.map(row => row.id)).toEqual(legacyIds.slice(0, 30)); expect(afterProtected.nextCursor).toBe(legacyIds[29]);
    const audits = await prisma.adminAudit.findMany({ where: { actorUserId: admin.user.id, action: "admin.campaigns_accessed" } });
    expect(audits).toHaveLength(4);
    for (const audit of audits) {
      expect(Object.keys(audit.snapshot as object).sort()).toEqual(["after", "asOf", "nextCursor", "returned", "scope"]);
      expect(JSON.stringify(audit.snapshot)).not.toContain(hidden); expect(JSON.stringify(audit.snapshot)).not.toContain(admin.actor.sessionId);
    }
  }, 30000);
});
