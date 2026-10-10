import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { SESSION_COOKIE } from "@/lib/jwt";
import { CampaignStatusSchema, type CampaignStatus } from "@/lib/contracts/vocabulary";
import type { OrganizationActor } from "@/lib/organizations/context";
import type { PlanningScope } from "@/lib/brand-context/contracts";
import { getClientAuthority } from "@/lib/organizations/loaders";
import { acceptMembership, authorizeClientAssociation, createOrganization, proposeClientAssociation, proposeMember, setClientGrant } from "@/lib/organizations/service";
import { decideCampaignOwnerReview, executeCampaignPlanningCommand, getPlanningCampaign } from "@/lib/campaign-planning/service";
import { ManagedOrderCommandSchema } from "@/lib/managed/contracts";
import { submitManagedOrder } from "@/lib/managed/orders";
import { getAdminAnalytics } from "@/lib/admin/analytics";
import { AdminAnalyticsSchema, AdminAnalyticsQuerySchema, AdminAnalyticsUnavailableMetrics, type AdminAnalyticsDTO } from "@/lib/admin/analytics-contracts";
import { loadAdminAnalytics } from "@/lib/admin/transport";
import { GET } from "@/app/api/admin/analytics/route";
import { GET as retiredProjects } from "@/app/api/admin/projects/route";
import { campaignFields } from "../campaigns/fixtures";

// PREPARATION ONLY. Root may adopt this as one registered test module or split
// its three native groups. Never import a registered .test module as a helper.
// Only Next's cookie context is a seam: signed JWT/User/AuthSession, owned M03
// OWN/two CLIENT producers, consent/grants, managed request, canonical metadata
// and PostgreSQL are genuine disposable fixtures. Stored lifecycle labels are
// counting fixtures, not live payment/delivery/provider/operational acceptance.
// Fault injection below is expressly a result/failure seam AFTER native SQL;
// it proves fail-closed handling, never native overflow or live downtime.
let token: string | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => name === SESSION_COOKIE && token ? { name, value: token } : undefined }) }));
const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>(), campaigns = new Set<string>(), creators = new Set<string>(), projects = new Set<string>(), categories = new Set<string>();
const key = () => randomUUID();
const hidden = "ADMIN_ANALYTICS_PRIVATE_CANARY_" + key();
const caps = { view: true, plan: true, approveShortlist: true, reviewContent: true, signCustomer: true, financial: true, manageGrants: true };
const unavailable = ["REVENUE", "SUBSCRIPTIONS", "GROWTH", "MATCH_LATENCY", "ACCEPTANCE_RATE"];
const at = new Date("2026-03-01T00:00:00.500Z"); // Leap/month boundary; Saudi UI must not shift UTC buckets.

beforeAll(async () => {
  const taskId = process.env.INFAME_TASK_ID;
  if (!taskId || !/^infame_[a-f0-9]{12}$/.test(taskId) || process.env.INFAME_ENV !== "test" || process.env.NODE_ENV === "production") throw new Error("Admin analytics fixtures require a guarded test target");
  const rows = await prisma.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]?.id !== taskId || rows[0]?.kind !== "test" || rows[0]?.db !== taskId + "_test" || rows[0]?.host !== "127.0.0.1") throw new Error("Admin analytics disposable identity mismatch");
});
afterEach(async () => {
  token = null;
  // Delete only this module's owned records, in retention/FK order. It never
  // deletes unrelated eligible campaigns to manufacture an empty platform.
  await prisma.project.deleteMany({ where: { id: { in: [...projects] } } });
  await prisma.category.deleteMany({ where: { id: { in: [...categories] } } });
  await prisma.deal.deleteMany({ where: { campaignId: { in: [...campaigns] } } });
  const spaces = await prisma.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } });
  const ids = spaces.map(row => row.id);
  if (ids.length) await prisma.$transaction(async tx => {
    for (const table of ["ManagedOrderCommand", "ManagedOrderState", "ManagedOrderSubmission", "ManagedOrder",
      "ContextReferenceCommand", "ContextSubmissionReferences", "ContextReferenceState", "ContextReferenceManifest", "ContextAssetBinding",
      "PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission", "CampaignBriefProvenance", "CampaignProposalDependency",
      "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding", "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const) {
      await tx.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join(ids)})`);
    }
    await tx.planningWorkspace.deleteMany({ where: { id: { in: ids } } });
  });
  await prisma.campaign.deleteMany({ where: { id: { in: [...campaigns] } } });
  await prisma.creator.deleteMany({ where: { id: { in: [...creators] } } });
  await prisma.organizationCommand.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await prisma.clientGrant.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organizationClient.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [...organizations] } } });
  await prisma.brand.deleteMany({ where: { id: { in: [...brands] } } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
  if (users.size) await prisma.outboxEvent.deleteMany({ where: { OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
  for (const owned of [users, brands, organizations, campaigns, creators, projects, categories]) owned.clear();
});
async function person(role: "ADMIN" | "BRAND" | "CREATOR" = "BRAND") {
  const id = key(); users.add(id);
  const user = await prisma.user.create({ data: { id, role, active: true, isTest: true, name: hidden + "_ACTOR",
    email: `analytics-${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  const signed = await openSession(id, user.sessionVersion, user.passwordHash), session = await resolveSession(signed);
  if (!session) throw new Error("Actual analytics fixture session did not resolve");
  const actor: OrganizationActor = { userId: session.userId, role: session.role, sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  expect(actor.role).toBe(role); return { user, actor, token: signed };
}
type Account = Awaited<ReturnType<typeof person>>;
async function company() {
  const account = await person();
  const brand = await prisma.brand.create({ data: { userId: account.user.id, name: hidden + "_BRAND", slug: "analytics-" + key(), countryCode: "KW", state: "PRIVATE", isTest: true } });
  brands.add(brand.id); return { ...account, brand, scope: { kind: "OWN_BRAND", brandId: brand.id } as PlanningScope };
}
type Company = Awaited<ReturnType<typeof company>>;
async function agency(customer: Company, label: string) {
  const owner = await person(), seat = await person();
  const { organization } = await createOrganization(owner.actor, { operationKey: key(), kind: "AGENCY", nameOriginal: hidden + label }); organizations.add(organization.id);
  const revision = async () => (await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).revision;
  const proposed = await proposeClientAssociation(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), brandId: customer.brand.id });
  const { client } = await authorizeClientAssociation(customer.actor, proposed.client.id, { operationKey: key(), expectedRevision: proposed.client.revision, capabilities: caps });
  const pending = await proposeMember(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), targetUserId: seat.user.id });
  const { membership } = await acceptMembership(seat.actor, pending.membership.id, { operationKey: key(), expectedRevision: pending.membership.revision });
  await setClientGrant(owner.actor, client.id, { operationKey: key(), expectedClientRevision: client.revision, membershipId: membership.id, expectedGrantRevision: null, capabilities: caps });
  return { seat, scope: { kind: "CLIENT", clientId: client.id } as PlanningScope };
}
async function authority(account: Account, scope: PlanningScope) { return scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(account.actor, scope.clientId, "plan") } : {}; }
async function planned(account: Account, scope: PlanningScope, label: string) {
  const result = await executeCampaignPlanningCommand(account.actor, { operationKey: key(), scope, ...await authority(account, scope), action: "CREATE",
    expectedCampaignRevision: 0, expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0,
    payload: { fields: { ...campaignFields, title: hidden + label, summary: hidden + "_SUMMARY", budget: { amountMinor: "771122334455660001", currencyCode: "KWD" } }, selection: { kind: "NONE" }, narrative: null } });
  campaigns.add(result.campaignId); return result.campaignId;
}
async function step(account: Account, scope: PlanningScope, campaignId: string, action: string, payload: unknown) {
  const current = await getPlanningCampaign(account.actor, { scope, campaignId });
  return executeCampaignPlanningCommand(account.actor, { operationKey: key(), scope, ...await authority(account, scope), campaignId, action, payload,
    expectedCampaignRevision: current.campaign.revision, expectedPlanningRevision: current.planning.revision,
    expectedSelectionId: current.planning.selection.id, expectedSelectionRevision: current.planning.selection.revision });
}
async function protectedFixtures(customer: Company) {
  const a = await agency(customer, "_CLIENT_A"), b = await agency(customer, "_CLIENT_B");
  const ownDraft = await planned(customer, customer.scope, "_OWN_DRAFT"), ca = await planned(a.seat, a.scope, "_CLIENT_A_UNSUBMITTED"), cb = await planned(b.seat, b.scope, "_CLIENT_B_DRAFT");
  await step(a.seat, a.scope, ca, "GENERATE_BRIEF", {});
  const submittedId = await planned(customer, customer.scope, "_REQUEST"), generated = await step(customer, customer.scope, submittedId, "GENERATE_BRIEF", {});
  const sent = await step(customer, customer.scope, submittedId, "SUBMIT_BRIEF", { briefId: generated.briefId!, expectedBriefVersion: generated.version! });
  expect((await decideCampaignOwnerReview(customer.actor, { operationKey: key(), submissionId: sent.submissionId!, expectedRevision: 1, decision: "APPROVE" })).state).toBe("APPROVED");
  const current = await getPlanningCampaign(customer.actor, { scope: customer.scope, campaignId: submittedId });
  await submitManagedOrder(customer.actor, ManagedOrderCommandSchema.parse({ action: "SUBMIT", operationKey: key(), scope: customer.scope, campaignId: submittedId,
    expectedCampaignRevision: current.campaign.revision, expectedPlanningRevision: current.planning.revision,
    expectedSelectionId: current.planning.selection.id, expectedSelectionRevision: current.planning.selection.revision,
    briefId: generated.briefId!, expectedBriefVersion: generated.version!, disclosureVersion: "infame-order-disclosure-v1" }));
  expect(await prisma.campaignPlanningBinding.count({ where: { campaignId: { in: [ownDraft, ca, cb, submittedId] } } })).toBe(4);
  expect(await prisma.managedOrder.count({ where: { campaignId: submittedId } })).toBe(1);
  return [ownDraft, ca, cb, submittedId];
}
async function saved(customer: Company, status: CampaignStatus, createdAt: Date) {
  const row = await prisma.campaign.create({ data: { brandId: customer.brand.id, title: hidden + "_EARLIER_TITLE", status, createdAt,
    input: { privateInput: hidden, budget: { amountMinor: "771122334455660001", currencyCode: "KWD" } }, conversation: [{ privateOriginalWords: hidden }] } });
  campaigns.add(row.id); return row;
}
async function creator() {
  const row = await prisma.creator.create({ data: { handle: "ac_" + key().replaceAll("-", "").slice(0, 24), displayName: hidden + "_CREATOR", state: "PRIVATE", isTest: true, profileFacts: { privateCanary: hidden } } });
  creators.add(row.id); return row;
}
async function children(customer: Company, campaignId: string, creatorId: string) {
  // Structural stored records deliberately include two historical rows for the
  // same creator and an empty run. No matching/eligibility/delivery claim.
  await prisma.campaignBrief.createMany({ data: [1, 2].map(version => ({ campaignId, version, inputRevision: 1, content: { privateBrief: hidden } })) });
  for (const algorithmVersion of ["historical-a", "historical-b", "empty-run"]) {
    const run = await prisma.matchRun.create({ data: { campaignId, briefVersion: 1, algorithmVersion, requirementSnapshot: { privateRequirements: hidden }, policySnapshot: { privatePolicy: hidden } } });
    if (algorithmVersion !== "empty-run") await prisma.creatorMatch.create({ data: { runId: run.id, creatorId, score: 60, snapshot: { privateRecommendation: hidden } } });
  }
  for (const status of ["OFFERED", "COMPLETED"] as const) await prisma.deal.create({ data: { campaignId, brandId: customer.brand.id, creatorId, status, briefVersion: 1,
    brandPaymentReportedAt: status === "COMPLETED" ? new Date() : null, creatorReceiptReportedAt: status === "COMPLETED" ? new Date() : null } });
}
function dates(asOf: Date) {
  const midnight = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  return Array.from({ length: 7 }, (_, i) => new Date(midnight - (6 - i) * 86400000).toISOString().slice(0, 10));
}
async function expected(asOf: Date): Promise<AdminAnalyticsDTO> {
  // Independent metadata oracle, not the loader's aggregate SQL. Full business
  // content is never selected even by this fixture helper.
  const rows = await prisma.campaign.findMany({ where: { planningBindings: { none: {} } }, select: { id: true, status: true, createdAt: true } });
  const ids = rows.map(row => row.id), runs = await prisma.matchRun.findMany({ where: { campaignId: { in: ids } }, select: { id: true } });
  const days = dates(asOf), startsAt = days[0] + "T00:00:00.000Z";
  const counts = { campaigns: rows.length,
    briefVersions: await prisma.campaignBrief.count({ where: { campaignId: { in: ids } } }), matchRuns: runs.length,
    recommendationRows: await prisma.creatorMatch.count({ where: { runId: { in: runs.map(run => run.id) } } }),
    deals: await prisma.deal.count({ where: { campaignId: { in: ids } } }), completedDeals: await prisma.deal.count({ where: { campaignId: { in: ids }, status: "COMPLETED" } }) };
  return { asOf: asOf.toISOString(), scope: "EARLIER_WORKFLOW_RECORDS", timeZone: "UTC", counts,
    campaignStatuses: CampaignStatusSchema.options.map(status => ({ status, count: rows.filter(row => row.status === status).length })),
    campaignDays: days.map(date => ({ date, count: rows.filter(row => row.createdAt.toISOString().slice(0, 10) === date && row.createdAt >= new Date(startsAt) && row.createdAt <= asOf).length })),
    window: { startsAt, endsAt: asOf.toISOString() }, unavailableMetrics: [...AdminAnalyticsUnavailableMetrics] };
}
async function readObserved(account: Account, now: Date) {
  const sql: string[] = [], client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  client.$on("query", event => { sql.push(event.query); }); // Never event.params/tokens/original words.
  try { return { data: await getAdminAnalytics(account.actor, { client, now }), sql }; } finally { await client.$disconnect(); }
}
function privateSafe(value: unknown, account?: Account) {
  const encoded = JSON.stringify(value);
  expect(encoded.includes(hidden)).toBe(false);
  if (account) for (const secret of [account.token, account.actor.sessionId, account.user.email, account.user.id]) expect(encoded.includes(secret)).toBe(false);
}
function aggregateSql(sql: string[]) {
  const aggregates = sql.filter(statement => /\bSELECT\b/i.test(statement) && /\bCOUNT\s*\(/i.test(statement) && /"Campaign"/.test(statement));
  expect(aggregates.length, "Actual canonical aggregate SQL must execute").toBeGreaterThan(0);
  for (const statement of aggregates) {
    expect(statement).toContain('"CampaignPlanningBinding"');
    expect(statement).toMatch(/\bNOT\s+EXISTS\b/i);
  }
  const canonical = sql.filter(statement => /\bSELECT\b/i.test(statement) && /"(?:Campaign|CampaignBrief|MatchRun|CreatorMatch|Deal|Brand)"/.test(statement));
  for (const statement of canonical) expect(statement).not.toMatch(/"(?:title|input|conversation|name|content|requirementSnapshot|policySnapshot|snapshot|terms|messages)"/i);
  expect(sql.some(statement => /\bSELECT\b/i.test(statement) && /"(?:Project|Match)"/.test(statement))).toBe(false);
}
function latch() { let release!: () => void; return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() }; }
function textOf(args: unknown): string {
  if (typeof args === "string") return args;
  if (args && typeof args === "object" && "strings" in args && Array.isArray(args.strings)) return args.strings.join("?");
  if (Array.isArray(args) && typeof args[0] === "string") return args[0];
  return "";
}
const isAggregate = (args: unknown) => /\bCOUNT\s*\(/i.test(textOf(args)) && /"Campaign"/.test(textOf(args));
async function waitForLock(table: "AuthSession" | "AdminAudit") {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const rows = await prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ${`%"${table}"%`}`;
    if (rows[0]?.n) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Analytics read never reached its actual PostgreSQL lock wait");
}
async function auditCount(account: Account) { return prisma.adminAudit.count({ where: { actorUserId: account.user.id, action: "admin.analytics_accessed" } }); }

describe("bounded canonical admin analytics", () => {
  it("counts eligible historical records and exact UTC/status buckets without protected, legacy or private-content influence", async () => {
    const admin = await person("ADMIN"), customer = await company(), baseline = await expected(at);
    const initial = await getAdminAnalytics(admin.actor, { now: at }); expect(initial).toEqual(baseline);
    // Genuine zeros are asserted only when the independently read eligible
    // baseline actually is empty; this is not a skipped test or destructive reset.
    if (baseline.counts.campaigns === 0) {
      expect(Object.values(initial.counts).every(count => count === 0)).toBe(true);
      expect(initial.campaignStatuses.every(row => row.count === 0)).toBe(true);
      expect(initial.campaignDays.every(row => row.count === 0)).toBe(true);
    }
    const made: Awaited<ReturnType<typeof saved>>[] = [];
    for (const [i, status] of CampaignStatusSchema.options.entries()) made.push(await saved(customer, status, new Date(dates(at)[i] + "T00:00:00.000Z")));
    const startsAt = new Date("2026-02-23T00:00:00.000Z");
    for (const createdAt of [new Date(startsAt.getTime() - 1), startsAt, at, new Date(at.getTime() + 1), new Date("2026-03-02T00:00:00.000Z")]) await saved(customer, "DRAFT", createdAt);
    const target = await creator(); await children(customer, made[0]!.id, target.id);
    // A suspended owner/private/test Brand remains in all-time stored metadata.
    await prisma.user.update({ where: { id: customer.user.id }, data: { active: false } });
    const anticipated = await expected(at), observed = await readObserved(admin, at);
    expect(observed.data).toEqual(anticipated); aggregateSql(observed.sql);
    expect(observed.data.counts).toEqual({ campaigns: baseline.counts.campaigns + 12, briefVersions: baseline.counts.briefVersions + 2,
      matchRuns: baseline.counts.matchRuns + 3, recommendationRows: baseline.counts.recommendationRows + 2,
      deals: baseline.counts.deals + 2, completedDeals: baseline.counts.completedDeals + 1 });
    expect(observed.data.campaignDays.map(row => row.count - baseline.campaignDays.find(old => old.date === row.date)!.count)).toEqual([2, 1, 1, 1, 1, 1, 2]);
    expect(observed.data.campaignStatuses.map(row => row.count - baseline.campaignStatuses.find(old => old.status === row.status)!.count)).toEqual([6, 1, 1, 1, 1, 1, 1]);
    expect(observed.data.unavailableMetrics).toEqual(unavailable); expect(AdminAnalyticsSchema.safeParse(observed.data).success).toBe(true); privateSafe(observed.data, admin);
    await prisma.user.update({ where: { id: customer.user.id }, data: { active: true } });
    const protectedIds = await protectedFixtures(customer);
    await children(customer, protectedIds[0]!, target.id); // Protected historical child joins must also be excluded.
    const afterProtected = await readObserved(admin, at); expect(afterProtected.data).toEqual(observed.data); aggregateSql(afterProtected.sql);
    // Genuine legacy poison: accepted/declined recommendation rows and a huge
    // demo count must never affect any canonical counter or derived percentage.
    const legacyClient = await prisma.client.create({ data: { userId: customer.user.id } });
    const providerAccount = await person("CREATOR"), provider = await prisma.provider.create({ data: { userId: providerAccount.user.id, providerType: "FREELANCER", languages: ["ar"] } });
    const category = await prisma.category.create({ data: { nameAr: hidden, nameEn: hidden, demoCount: 2000000000 } }); categories.add(category.id);
    const project = await prisma.project.create({ data: { clientId: legacyClient.id, categoryId: category.id, titleAr: hidden, titleEn: hidden, description: hidden, requiredSkills: [], status: "COMPLETED" } }); projects.add(project.id);
    await prisma.match.create({ data: { projectId: project.id, providerId: provider.id, matchScore: 100, reasonAr: hidden, reasonEn: hidden, scoreBreakdown: { privateLegacy: hidden }, status: "ACCEPTED" } });
    expect(await getAdminAnalytics(admin.actor, { now: at })).toEqual(observed.data);
    const audit = await prisma.adminAudit.findFirstOrThrow({ where: { actorUserId: admin.user.id, action: "admin.analytics_accessed" }, orderBy: { createdAt: "desc" } });
    expect(audit).toMatchObject({ resourceType: "AdminAnalytics", resourceId: "platform" });
    expect(audit.snapshot).toEqual({ asOf: observed.data.asOf, scope: observed.data.scope, window: observed.data.window, counts: observed.data.counts }); privateSafe(audit.snapshot);
    const dto = observed.data;
    for (const invalid of [
      { ...dto, privateInput: hidden }, { ...dto, scope: "ALL_STORED_RECORDS" }, { ...dto, timeZone: "Asia/Riyadh" },
      { ...dto, counts: { ...dto.counts, campaigns: Number.MAX_SAFE_INTEGER + 1 } }, { ...dto, counts: { ...dto.counts, deals: -1 } },
      { ...dto, counts: { ...dto.counts, completedDeals: dto.counts.deals + 1 } }, { ...dto, counts: { ...dto.counts, campaigns: dto.counts.campaigns + 1 } },
      { ...dto, campaignStatuses: [...dto.campaignStatuses].reverse() }, { ...dto, campaignDays: [...dto.campaignDays].reverse() },
      { ...dto, campaignDays: dto.campaignDays.map((row, i) => i === 1 ? { ...row, date: dto.campaignDays[0]!.date } : row) },
      { ...dto, window: { ...dto.window, startsAt: "2026-02-23T00:00:00.001Z" } }, { ...dto, window: { ...dto.window, endsAt: "2026-03-01T00:00:00.501Z" } },
      { ...dto, unavailableMetrics: unavailable.slice(1) }, { ...dto, unavailableMetrics: [...unavailable].reverse() },
      { ...dto, asOf: "invalidZ", window: { ...dto.window, endsAt: "invalidZ" } },
      { ...dto, campaignStatuses: dto.campaignStatuses.map((row, index) => index === 0 ? { ...row, count: 0.5 } : row) },
      { ...dto, campaignDays: dto.campaignDays.map((row, index) => index === 0 ? { ...row, count: -0.5 } : row) },
    ]) expect(AdminAnalyticsSchema.safeParse(invalid).success).toBe(false);
    expect(AdminAnalyticsQuerySchema.safeParse({}).success).toBe(true);
    expect(AdminAnalyticsQuerySchema.safeParse({ timeZone: "UTC" }).success).toBe(false);
  }, 60000);

  it("uses one actual snapshot and copied business clock, denies real waited/expired authority, and rolls back failed aggregates/audit", async () => {
    const admin = await person("ADMIN"), customer = await company(); await saved(customer, "DRAFT", at);
    const before = await expected(at), entered = latch(), release = latch(); let paused = false;
    const client = prisma.$extends({ query: { $allOperations: async ({ operation, args, query }) => {
      const value = await query(args);
      if (!paused && operation === "$queryRaw" && isAggregate(args)) { paused = true; entered.release(); await release.promise; }
      return value;
    } } }) as unknown as PrismaClient;
    const copiedClock = new Date(at.getTime()), reading = getAdminAnalytics(admin.actor, { client, now: copiedClock });
    try {
      await Promise.race([entered.promise, reading.then(() => { throw new Error("Snapshot read finished without its aggregate witness"); })]);
      copiedClock.setTime(Date.parse("2040-12-31T23:59:59.999Z"));
      const late = await saved(customer, "COMPLETED", at), target = await creator(); await children(customer, late.id, target.id);
      release.release(); expect(await reading).toEqual(before);
      const next = await getAdminAnalytics(admin.actor, { now: at }); expect(next).toEqual(await expected(at));
      expect(next.counts.campaigns).toBe(before.counts.campaigns + 1); expect(next.counts.briefVersions).toBe(before.counts.briefVersions + 2);
      expect(next.counts.deals).toBe(before.counts.deals + 2); expect(next.counts.recommendationRows).toBe(before.counts.recommendationRows + 2);
    } finally { release.release(); await reading.catch(() => undefined); }
    // Fault result seam is after a real canonical aggregate; unrepresentable
    // counts must fail and roll back, never round or synthesize a zero DTO.
    for (const bad of [BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1), BigInt(-1)]) {
      let changed = false; const priorAudit = await auditCount(admin);
      const invalidClient = prisma.$extends({ query: { $allOperations: async ({ operation, args, query }) => {
        const value = await query(args);
        if (!changed && operation === "$queryRaw" && isAggregate(args) && Array.isArray(value) && value[0] && typeof value[0] === "object") {
          const row = value[0] as Record<string, unknown>, field = Object.keys(row).find(name => typeof row[name] === "bigint" || typeof row[name] === "number");
          if (field) { changed = true; return [{ ...row, [field]: bad }, ...value.slice(1)]; }
        }
        return value;
      } } }) as unknown as PrismaClient;
      await expect(getAdminAnalytics(admin.actor, { client: invalidClient, now: at })).rejects.toMatchObject({ code: "INVALID_STORED_ANALYTICS", status: 503 });
      expect(changed).toBe(true); expect(await auditCount(admin)).toBe(priorAudit);
    }
    // A map/zero-fill can otherwise hide duplicate or unknown groups. These
    // injected rows deliberately preserve plausible final totals, so the raw
    // grouped metadata must be validated before normalizing missing groups.
    // Minimal test-seam aliases are status/count and date/count; adapt only the
    // seam if root uses other aliases, never weaken the semantic rejection.
    for (const corruption of ["duplicate-status", "unknown-status", "duplicate-date", "outside-date"] as const) {
      let changed = false; const priorAudit = await auditCount(admin);
      const corruptClient = prisma.$extends({ query: { $allOperations: async ({ operation, args, query }) => {
        const value = await query(args);
        if (!changed && operation === "$queryRaw" && Array.isArray(value) && value[0] && typeof value[0] === "object") {
          const row = value[0] as Record<string, unknown>;
          if (corruption.endsWith("status") && "status" in row && "count" in row) {
            changed = true;
            return [...value, corruption === "duplicate-status" ? { ...row } : { ...row, status: "UNKNOWN_SAVED_STATUS", count: BigInt(0) }];
          }
          if (corruption.endsWith("date") && "date" in row && "count" in row) {
            changed = true;
            return [...value, corruption === "duplicate-date" ? { ...row } : { ...row, date: row.date instanceof Date ? new Date("2026-03-02T00:00:00.000Z") : "2026-03-02", count: BigInt(0) }];
          }
        }
        return value;
      } } }) as unknown as PrismaClient;
      await expect(getAdminAnalytics(admin.actor, { client: corruptClient, now: at })).rejects.toMatchObject({ code: "INVALID_STORED_ANALYTICS", status: 503 });
      expect(changed).toBe(true); expect(await auditCount(admin)).toBe(priorAudit);
    }
    let faultReached = false; const priorAudit = await auditCount(admin);
    const failedClient = prisma.$extends({ query: { $allOperations: async ({ operation, args, query }) => {
      const value = await query(args);
      if (operation === "$queryRaw" && isAggregate(args)) { faultReached = true; throw new Error("Synthetic unavailable aggregate result"); }
      return value;
    } } }) as unknown as PrismaClient;
    await expect(getAdminAnalytics(admin.actor, { client: failedClient, now: at })).rejects.toBeDefined();
    expect(faultReached).toBe(true); expect(await auditCount(admin)).toBe(priorAudit);
    // Actual AuthSession holder, PostgreSQL wait, then committed revocation.
    // RepeatableRead can return its deliberate503 retry result at that change;
    // the following current read must401. Neither releases counts or an audit.
    const denied = await person("ADMIN"), peer = new PrismaClient(), held = latch(), unlock = latch();
    const holding = peer.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${denied.actor.sessionId} FOR UPDATE`;
      held.release(); await unlock.promise; await tx.authSession.update({ where: { id: denied.actor.sessionId }, data: { revokedAt: new Date() } }); }, { timeout: 10000 });
    let waiting: Promise<{ success: boolean; status?: number }> | undefined;
    try {
      await held.promise; waiting = getAdminAnalytics(denied.actor, { now: at }).then(() => ({ success: true }), (error: { status?: number }) => ({ success: false, status: error.status }));
      await waitForLock("AuthSession"); unlock.release(); await holding;
      const result = await waiting; expect(result.success).toBe(false); expect([401, 503]).toContain(result.status);
      await expect(getAdminAnalytics(denied.actor, { now: new Date("2000-01-01T00:00:00.000Z") })).rejects.toMatchObject({ status: 401 }); expect(await auditCount(denied)).toBe(0);
    } finally { unlock.release(); await holding; await waiting; await peer.$disconnect(); }
    // Hold the real audit INSERT after successful queries; real expiry defeats
    // even a historical resource clock and rolls the intended write back.
    const expiring = await person("ADMIN"), auditPeer = new PrismaClient(), auditHeld = latch(), auditUnlock = latch(), expiresAt = new Date(Date.now() + 1800);
    await prisma.authSession.update({ where: { id: expiring.actor.sessionId }, data: { expiresAt } });
    const auditHolding = auditPeer.$transaction(async tx => { await tx.$executeRaw`LOCK TABLE "AdminAudit" IN ACCESS EXCLUSIVE MODE`; auditHeld.release(); await auditUnlock.promise; }, { timeout: 10000 });
    let expiryRead: Promise<{ success: boolean; status?: number }> | undefined;
    try {
      await auditHeld.promise; expiryRead = getAdminAnalytics(expiring.actor, { now: new Date("2000-01-01T00:00:00.000Z") }).then(() => ({ success: true }), (error: { status?: number }) => ({ success: false, status: error.status }));
      await waitForLock("AdminAudit"); await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 30)));
      auditUnlock.release(); await auditHolding; expect(await expiryRead).toEqual({ success: false, status: 401 }); expect(await auditCount(expiring)).toBe(0);
    } finally { auditUnlock.release(); await auditHolding; await expiryRead; await auditPeer.$disconnect(); }
  }, 60000);

  it("authenticates actual cookies before strict query parsing and returns minimized private native envelopes without business effects", async () => {
    const origin = process.env.APP_ORIGIN; if (!origin) throw new Error("Native analytics transport requires guarded APP_ORIGIN");
    const request = (query = "") => new Request(`${new URL(origin).origin}/api/admin/analytics${query}`);
    const failure = async (response: Response, status: number, code: string) => {
      expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store");
      const id = response.headers.get("x-request-id"), body = await response.json(); expect(id).toMatch(/^[a-f0-9-]{36}$/);
      expect(body).toEqual({ error: { code, message: code, requestId: id, retryable: status === 503 }, requestId: id }); privateSafe(body);
    };
    const beforeAllAudit = await prisma.adminAudit.count({ where: { action: "admin.analytics_accessed" } });
    await failure(await GET(request("?actorUserId=private&timeZone=bad&timeZone=bad")), 401, "UNAUTHENTICATED");
    for (const role of ["BRAND", "CREATOR"] as const) { const wrong = await person(role); token = wrong.token; await failure(await loadAdminAnalytics(request("?period=bad")), 403, "FORBIDDEN"); }
    expect(await prisma.adminAudit.count({ where: { action: "admin.analytics_accessed" } })).toBe(beforeAllAudit);
    const admin = await person("ADMIN"), customer = await company(); await saved(customer, "DRAFT", new Date());
    await protectedFixtures(customer); token = admin.token;
    for (const query of ["?actorUserId=private", "?timeZone=UTC", "?period=7", "?asOf=2000-01-01", "?limit=1&limit=1", "?anything="]) await failure(await GET(request(query)), 422, "VALIDATION");
    expect(await auditCount(admin)).toBe(0);
    const businessBefore = {
      campaigns: await prisma.campaign.findMany({ where: { id: { in: [...campaigns] } }, select: { id: true, revision: true, status: true, input: true, conversation: true, currentBriefVersion: true } }),
      orders: await prisma.managedOrder.count(), runs: await prisma.matchRun.count(), deals: await prisma.deal.count(), outbox: await prisma.outboxEvent.count(),
    };
    const response = await GET(request()); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json(); expect(Object.keys(body).sort()).toEqual(["data", "requestId"]); expect(body.requestId).toBe(response.headers.get("x-request-id"));
    const data = AdminAnalyticsSchema.parse(body.data); privateSafe(body, admin); expect(data).toEqual(await expected(new Date(data.asOf)));
    expect(Object.keys(data).sort()).toEqual(["asOf", "campaignDays", "campaignStatuses", "counts", "scope", "timeZone", "unavailableMetrics", "window"]);
    const native = await getAdminAnalytics(admin.actor, { now: new Date(data.asOf) }); expect(native).toEqual(data);
    const adapted = await loadAdminAnalytics(request()), adaptedBody = await adapted.json(); expect(adapted.status).toBe(200);
    expect(AdminAnalyticsSchema.parse(adaptedBody.data).counts).toEqual(data.counts); expect(adaptedBody.requestId).toBe(adapted.headers.get("x-request-id"));
    expect(await auditCount(admin)).toBe(3);
    expect({ campaigns: await prisma.campaign.findMany({ where: { id: { in: [...campaigns] } }, select: { id: true, revision: true, status: true, input: true, conversation: true, currentBriefVersion: true } }),
      orders: await prisma.managedOrder.count(), runs: await prisma.matchRun.count(), deals: await prisma.deal.count(), outbox: await prisma.outboxEvent.count() }).toEqual(businessBefore);
    const retired = await (retiredProjects as unknown as (request: Request) => Promise<Response>)(new Request(`${new URL(origin).origin}/api/admin/projects`)); expect(retired.status).toBe(410);
    await prisma.authSession.update({ where: { id: admin.actor.sessionId }, data: { revokedAt: new Date() } }); expect(await resolveSession(admin.token)).toBeNull();
    await failure(await GET(request("?malformed=1&malformed=1")), 401, "UNAUTHENTICATED"); expect(await auditCount(admin)).toBe(3);
    for (const change of ["role", "version", "suspended", "expired"] as const) {
      const stale = await person("ADMIN"); token = stale.token;
      if (change === "role") await prisma.user.update({ where: { id: stale.user.id }, data: { role: "BRAND" } });
      if (change === "version") await prisma.user.update({ where: { id: stale.user.id }, data: { sessionVersion: { increment: 1 } } });
      if (change === "suspended") await prisma.user.update({ where: { id: stale.user.id }, data: { active: false } });
      if (change === "expired") await prisma.authSession.update({ where: { id: stale.actor.sessionId }, data: { expiresAt: new Date(Date.now() - 1) } });
      await failure(await loadAdminAnalytics(request("?actorUserId=other")), 401, "UNAUTHENTICATED"); expect(await auditCount(stale)).toBe(0);
    }
    // Actual SSR/HTML/RSC mounting belongs to the two browser journeys; this
    // group demonstrates identical loader/route data, not an invented SSR run.
  }, 60000);
});
