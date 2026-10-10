import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { captureOrganizationActor } from "@/lib/organizations/context";
import { SESSION_COOKIE } from "@/lib/jwt";
import { CampaignFieldObjectSchema, CampaignRequirementsSchema } from "@/lib/campaigns/contracts";
import { FameIndustrySchema } from "@/lib/contracts/vocabulary";
import { NICHE_SOURCE, NICHE_TAXONOMY, FAME_RELATED_NICHES } from "@/lib/contracts/taxonomy";
import { createCampaign, generateCampaignBrief, approveCampaignBrief, applyCampaignMutation } from "@/lib/campaigns/service";
import { resolveCampaignPolicyReview } from "@/lib/policies";
import { executeCampaignPlanningCommand, getPlanningCampaign } from "@/lib/campaign-planning/service";
import { createOrganization, proposeClientAssociation, authorizeClientAssociation, proposeMember, acceptMembership, setClientGrant } from "@/lib/organizations/service";
import { getClientAuthority } from "@/lib/organizations/loaders";
import type { PlanningScope } from "@/lib/brand-context/contracts";
import { getAdminBriefs } from "@/lib/admin/briefs";
import { getAdminTaxonomy } from "@/lib/admin/taxonomy";
import { ADMIN_BRIEFS_MAX_JSON_BYTES, AdminBriefsSchema } from "@/lib/admin/briefs-contracts";
import { AdminTaxonomySchema, type AdminTaxonomyDTO } from "@/lib/admin/taxonomy-contracts";
import { PATCH as retiredQuality } from "@/app/api/admin/briefs/[id]/route";
import { POST as retiredCategoryCreate } from "@/app/api/admin/categories/route";
import { PATCH as retiredCategoryPatch, DELETE as retiredCategoryDelete } from "@/app/api/admin/categories/[id]/route";
import { GET as retiredSkills, POST as retiredSkillCreate } from "@/app/api/admin/skills/route";
import { campaignFields } from "../campaigns/fixtures";

// IGNORED PREPARATION ONLY: exactly three native groups, no execution by author.
// Native signed sessions, producer approval/history, actual M03 OWN/CLIENT
// consent/grants/bindings, persisted assignments and PostgreSQL waits are real
// owned disposable fixtures. Bulk stored history and reviewed-policy fixtures
// are explicitly synthetic counting/parsing data, never legal/provider proof.
// Only Next cookies is a seam for already-retired mutation handlers; no auth,
// DB/SQL/query-result/time/provider mock and no registered .test helper import.
const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>(), campaigns = new Set<string>(), creators = new Set<string>(), policies = new Set<string>(), assets = new Set<string>(), categories = new Set<string>();
let token: string | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => name === SESSION_COOKIE && token ? { name, value: token } : undefined }) }));
const key = () => randomUUID(), secret = "PROTECTED_ADMIN_BRIEF_WORDS_" + key();
const unknownTag = "PRIVATE_UNKNOWN_ASSIGNMENT_" + key();
const caps = { view: true, plan: true, approveShortlist: true, reviewContent: true, signCustomer: true, financial: true, manageGrants: true };
beforeAll(async () => {
  const taskId = process.env.INFAME_TASK_ID;
  if (!taskId || !/^infame_[a-f0-9]{12}$/.test(taskId) || process.env.INFAME_ENV !== "test" || process.env.NODE_ENV === "production") throw new Error("Administrative leaf fixtures require guarded test task");
  const rows = await prisma.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]?.id !== taskId || rows[0]?.kind !== "test" || rows[0]?.db !== taskId + "_test" || rows[0]?.host !== "127.0.0.1") throw new Error("Administrative leaf disposable identity mismatch");
});
afterEach(async () => {
  token = null;
  const spaces = await prisma.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } }), ids = spaces.map(row => row.id);
  if (ids.length) await prisma.$transaction(async tx => {
    for (const table of ["CampaignPlanningCommand", "CampaignPlanningSubmission", "PlanningReviewCommand", "CampaignBriefProvenance", "CampaignProposalDependency", "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding", "BrandContextCommand", "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const) {
      await tx.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join(ids)})`);
    }
    await tx.planningWorkspace.deleteMany({ where: { id: { in: ids } } });
  });
  await prisma.campaign.deleteMany({ where: { id: { in: [...campaigns] } } });
  await prisma.creator.deleteMany({ where: { id: { in: [...creators] } } });
  await prisma.policyVersion.deleteMany({ where: { id: { in: [...policies] } } });
  await prisma.privateAsset.deleteMany({ where: { id: { in: [...assets] } } });
  await prisma.category.deleteMany({ where: { id: { in: [...categories] } } });
  await prisma.organizationCommand.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await prisma.clientGrant.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organizationClient.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [...organizations] } } });
  await prisma.brand.deleteMany({ where: { id: { in: [...brands] } } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
  if (users.size) await prisma.outboxEvent.deleteMany({ where: { OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
  for (const owned of [users, brands, organizations, campaigns, creators, policies, assets, categories]) owned.clear();
});
async function person(role: "ADMIN" | "BRAND" | "CREATOR" = "BRAND") {
  const id = key(); users.add(id);
  const user = await prisma.user.create({ data: { id, role, name: "Synthetic admin leaf actor", email: `${id}@example.invalid`, passwordHash: "not-a-login", active: true, isTest: true, emailVerifiedAt: new Date(Date.now() - 60000) } });
  const token = await openSession(id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Actual administrative fixture session did not resolve");
  return { user, actor: captureOrganizationActor(session), token };
}
type Account = Awaited<ReturnType<typeof person>>;
async function company() {
  const owner = await person(), brand = await prisma.brand.create({ data: { userId: owner.user.id, slug: "abt-" + key(), name: "  Original Arabic company  ", countryCode: "KW", state: "PRIVATE", isTest: true } });
  brands.add(brand.id); return { ...owner, brand, scope: { kind: "OWN_BRAND", brandId: brand.id } as PlanningScope };
}
type Company = Awaited<ReturnType<typeof company>>;
async function reviewedPolicy() {
  // Existing controlled policy fixture pattern: persisted current reviewer and
  // an explicitly synthetic evidence reference, not a new provisioning grant.
  const reviewer = await person("ADMIN"), now = new Date(Date.now() - 1000), id = key(); policies.add(id);
  const asset = await prisma.privateAsset.create({ data: { ownerUserId: reviewer.user.id, purpose: "LEGAL_POLICY_REVIEW", contentType: "text/plain", size: 1, storageKey: "synthetic-admin-policy:" + id, checksum: "f".repeat(64) } }); assets.add(asset.id);
  await prisma.policyVersion.create({ data: { id, kind: "MARKET", countryCodes: ["NR"], status: "VERIFIED", evidenceAssetId: asset.id, reviewedBy: reviewer.user.id,
    reviewedAt: now, createdAt: new Date(now.getTime() - 60000), expiresAt: new Date(campaignFields.period.endsAt),
    content: { schemaVersion: 1, kind: "MARKET", marketCountryCode: "NR", brandCountryCodes: ["KW"], creatorCountryCodes: ["GB"], licenceRequired: false, licencePolicyId: null,
      reviewReference: "Synthetic retained administrative policy fixture only", reviewedBasis: "FOUNDER_APPROVED_LEGAL_REVIEW" } } });
  return id;
}
async function earlierHistory(owner: Company, withReview = false) {
  const fields = { ...campaignFields, ...(withReview ? { marketCountryCodes: ["NR"] } : {}), title: "متطلبات تاريخية أصلية", summary: "Original single-language historical summary", budget: { amountMinor: "9007199254740993", currencyCode: "KWD" } };
  const created = await createCampaign(owner.user.id, { operationKey: key(), fields }, prisma, owner.actor); campaigns.add(created.campaign.id);
  const generated = await generateCampaignBrief(owner.user.id, created.campaign.id, { operationKey: key(), expectedRevision: created.campaign.revision }, prisma, owner.actor);
  const approved = await approveCampaignBrief(owner.user.id, created.campaign.id, { operationKey: key(), expectedRevision: generated.campaign.revision, briefId: generated.brief.id, expectedBriefVersion: generated.brief.version }, prisma,
    { channel: "FORM", serverAuth: owner.actor, ...(withReview ? { policyReviewResolver: resolveCampaignPolicyReview } : {}) });
  const changed = await applyCampaignMutation(owner.user.id, created.campaign.id, { action: "UPDATE_FIELDS", operationKey: key(), expectedRevision: approved.campaign.revision,
    payload: { patch: { title: "نسخة أحدث", tone: "Later tone", budget: { amountMinor: "12005", currencyCode: "KWD" } } } }, prisma, { channel: "FORM", serverAuth: owner.actor });
  const later = await generateCampaignBrief(owner.user.id, created.campaign.id, { operationKey: key(), expectedRevision: changed.campaign.revision }, prisma, owner.actor);
  expect(later.brief.version).toBeGreaterThan(approved.brief.version); expect(later.brief.approvedAt).toBeNull();
  return { campaignId: created.campaign.id, first: approved.brief, later: later.brief };
}
async function protectedBriefs(customer: Company) {
  const seat = await person(), agencyOwner = await person();
  const { organization } = await createOrganization(agencyOwner.actor, { operationKey: key(), kind: "AGENCY", nameOriginal: "Synthetic brief exclusion agency" }); organizations.add(organization.id);
  const revision = async () => (await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).revision;
  const proposed = await proposeClientAssociation(agencyOwner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), brandId: customer.brand.id });
  const { client } = await authorizeClientAssociation(customer.actor, proposed.client.id, { operationKey: key(), expectedRevision: proposed.client.revision, capabilities: caps });
  const pending = await proposeMember(agencyOwner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), targetUserId: seat.user.id });
  const { membership } = await acceptMembership(seat.actor, pending.membership.id, { operationKey: key(), expectedRevision: pending.membership.revision });
  await setClientGrant(agencyOwner.actor, client.id, { operationKey: key(), expectedClientRevision: client.revision, membershipId: membership.id, expectedGrantRevision: null, capabilities: caps });
  const saved: Array<{ campaignId: string; briefId: string }> = [];
  for (const [account, scope] of [[customer, customer.scope], [seat, { kind: "CLIENT", clientId: client.id }]] as const) {
    const authority = scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(account.actor, scope.clientId, "plan") } : {};
    const created = await executeCampaignPlanningCommand(account.actor, { operationKey: key(), scope, ...authority, action: "CREATE", expectedCampaignRevision: 0, expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0,
      payload: { fields: { ...campaignFields, title: secret, summary: secret }, selection: { kind: "NONE" }, narrative: null } }); campaigns.add(created.campaignId);
    const current = await getPlanningCampaign(account.actor, { scope, campaignId: created.campaignId });
    const generated = await executeCampaignPlanningCommand(account.actor, { operationKey: key(), scope, ...authority, action: "GENERATE_BRIEF", campaignId: created.campaignId,
      expectedCampaignRevision: current.campaign.revision, expectedPlanningRevision: current.planning.revision, expectedSelectionId: current.planning.selection.id, expectedSelectionRevision: current.planning.selection.revision, payload: {} });
    saved.push({ campaignId: created.campaignId, briefId: generated.briefId! });
  }
  return saved;
}
function privacy(value: unknown, account?: Account) {
  const encoded = JSON.stringify(value);
  for (const hidden of [secret, unknownTag, "approvedByUserId", "policyReview", "conversation", "proposals", "passwordHash", "sessionId", ...(account ? [account.token, account.actor.sessionId] : [])]) expect(encoded.includes(hidden)).toBe(false);
}
async function preceding(id: string) {
  const previous = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM "CampaignBrief" WHERE id COLLATE "C" < ${id} COLLATE "C" ORDER BY id COLLATE "C" DESC LIMIT 1`;
  return previous[0] ? { after: previous[0].id } : {};
}
async function pageAt(admin: Account, id: string) {
  const page = await getAdminBriefs(admin.actor, await preceding(id)); expect(page.briefs[0]?.id).toBe(id); return page;
}
async function auditCount(account: Account, action: string) { return prisma.adminAudit.count({ where: { actorUserId: account.user.id, action } }); }
async function observedBriefs(admin: Account, query: { after?: string } = {}) {
  const sql: string[] = [], client = new PrismaClient({ log: [{ emit: "event", level: "query" }] }); client.$on("query", event => { sql.push(event.query); });
  try { return { page: await getAdminBriefs(admin.actor, query, { client }), sql }; } finally { await client.$disconnect(); }
}
function assertBriefSQL(sql: string[]) {
  const pages = sql.filter(statement => /\bSELECT\b/i.test(statement) && /"CampaignBrief"/.test(statement) && /\bLIMIT\b/i.test(statement)); expect(pages.length).toBeGreaterThan(0);
  for (const statement of pages) {
    expect(statement).toContain('"CampaignPlanningBinding"'); expect(statement).toMatch(/\bNOT\s+EXISTS\b/i);
    expect(statement.indexOf("WHERE")).toBeLessThan(statement.lastIndexOf("LIMIT")); expect(statement).toMatch(/\bORDER\s+BY\b[\s\S]*\bLIMIT\b/i);
    expect(statement).not.toMatch(/\bc\.input\b|"conversation"|"proposals"|"email"|"passwordHash"|"transcript"/i);
  }
}
function latch() { let release!: () => void; return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() }; }
async function blockedBy(pid: number, table: "AuthSession" | "AdminAudit") {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ pid: number }>>`SELECT a.pid FROM pg_stat_activity a WHERE a.datname=current_database() AND a.wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(a.pid)) AND a.query LIKE ${`%"${table}"%`}`;
    if (rows.length) return; await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Administrative read never reached the actual held PostgreSQL lock");
}
async function taxonomyExpected() {
  const rows = await prisma.creator.findMany({ select: { id: true, nicheIds: true, fameTags: true } });
  const niches = new Set(NICHE_TAXONOMY.map(row => row.slug)), fame = new Set<string>(FameIndustrySchema.options);
  return { niches: NICHE_TAXONOMY.map(row => ({ ...row, assignmentCount: rows.filter(creator => creator.nicheIds.includes(row.slug)).length })),
    fame: FameIndustrySchema.options.map(industry => ({ industry, relatedNicheSlugs: [...FAME_RELATED_NICHES[industry]], assignmentCount: rows.filter(creator => creator.fameTags.includes(industry)).length })),
    unknownAssignments: { nicheCreators: rows.filter(row => row.nicheIds.some(tag => !niches.has(tag))).length, fameCreators: rows.filter(row => row.fameTags.some(tag => !fame.has(tag))).length } };
}

describe("bounded administrative briefs and taxonomy", () => {
  it("projects full immutable historical requirements, excludes M03 before projection/page limit, and traverses31+tail plus large valid byte-limited pages", async () => {
    const admin = await person("ADMIN"), owner = await company(); await reviewedPolicy(); const history = await earlierHistory(owner, true);
    expect(history.first.content.policyReview).not.toBeNull(); expect(history.first.content.requirements.mandatoryPolicyVersionIds.length).toBeGreaterThan(0);
    const protectedRows = await protectedBriefs(owner), first = await pageAt(admin, history.first.id), row = first.briefs[0]!;
    expect(AdminBriefsSchema.safeParse(first).success).toBe(true); expect(first.scope).toBe("EARLIER_WORKFLOW");
    expect(row).toEqual({ id: history.first.id, campaignId: history.campaignId, brandName: owner.brand.name, version: history.first.version, inputRevision: history.first.inputRevision,
      requirements: history.first.content.requirements, approvedAt: history.first.approvedAt, createdAt: history.first.createdAt });
    for (const field of Object.keys(CampaignFieldObjectSchema.shape)) expect(Object.hasOwn(row.requirements, field)).toBe(true);
    expect(row.requirements.budget).toEqual({ amountMinor: "9007199254740993", currencyCode: "KWD" }); privacy(first, admin);
    await prisma.campaign.update({ where: { id: history.campaignId }, data: { input: { unrelatedCurrentInput: secret }, conversation: [{ originalUnsubmittedWords: secret }] } });
    await prisma.user.update({ where: { id: owner.user.id }, data: { active: false } });
    expect((await pageAt(admin, history.first.id)).briefs[0]?.requirements).toEqual(history.first.content.requirements);
    const later = (await pageAt(admin, history.later.id)).briefs[0]!; expect(later.requirements).toEqual(history.later.content.requirements); expect(later.approvedAt).toBeNull();
    const prefix = "zz-admin-briefs-" + key() + "-", smallIds = Array.from({ length: 32 }, (_, i) => prefix + (i < 16 ? "S" : "s") + (i % 2 ? "_" : "-") + String(i).padStart(3, "0")).sort();
    await prisma.campaignBrief.createMany({ data: smallIds.map((id, i) => ({ id, campaignId: history.campaignId, version: 100 + i, inputRevision: history.later.inputRevision,
      content: { ...history.later.content, approvedByUserId: null, policyReview: null, requirements: { ...history.later.content.requirements, version: 100 + i, mandatoryPolicyVersionIds: [] } } })) });
    // These35 invalid protected bodies must neither fill the31-row SQL window
    // nor be parsed/hydrated. Their binding came from real M03 OWN/CLIENT calls.
    const protectedIds = Array.from({ length: 35 }, (_, i) => prefix + "P" + String(i).padStart(3, "0"));
    await prisma.campaignBrief.createMany({ data: protectedIds.map((id, i) => ({ id, campaignId: protectedRows[i % protectedRows.length]!.campaignId, version: 100 + i, inputRevision: 1, content: { privateProtectedCanary: secret } })) });
    const page = await observedBriefs(admin, await preceding(protectedIds[0]!)); assertBriefSQL(page.sql); privacy(page.page, admin);
    expect(page.page.briefs.map(item => item.id)).toEqual(smallIds.slice(0, 30)); expect(page.page.nextCursor).toBe(smallIds[29]);
    const tail = await getAdminBriefs(admin.actor, { after: page.page.nextCursor! }); expect(tail.briefs.slice(0, 2).map(item => item.id)).toEqual(smallIds.slice(30));
    // Use independently observed eligible tail metadata rather than assume the
    // guarded target contains no other owner's records after our synthetic IDs.
    const remaining = await prisma.$queryRaw<Array<{ id: string }>>`SELECT b.id FROM "CampaignBrief" b JOIN "Campaign" c ON c.id=b."campaignId" WHERE b.id COLLATE "C" > ${smallIds[29]!} COLLATE "C" AND NOT EXISTS (SELECT 1 FROM "CampaignPlanningBinding" p WHERE p."campaignId"=c.id) ORDER BY b.id COLLATE "C" ASC`;
    expect(tail.briefs.map(item => item.id)).toEqual(remaining.slice(0, 30).map(item => item.id)); expect(tail.nextCursor).toBe(remaining.length > 30 ? remaining[29]!.id : null);
    // Approved history is immutable. Exercise stored-content rejection only on
    // the owned unapproved revision, without disabling its native guards.
    const beforeAudit = await auditCount(admin, "admin.briefs_accessed"), stored = await prisma.campaignBrief.findUniqueOrThrow({ where: { id: history.later.id } });
    for (const corrupt of [{ ...history.later.content, requirements: { ...history.later.content.requirements, campaignId: protectedRows[0]!.campaignId } },
      { ...history.later.content, inputRevision: history.later.inputRevision + 1 }, { ...history.later.content, approvedByUserId: admin.user.id }]) {
      await prisma.campaignBrief.update({ where: { id: stored.id }, data: { content: corrupt } });
      await expect(pageAt(admin, stored.id)).rejects.toMatchObject({ code: "INVALID_STORED_BRIEF", status: 503 }); expect(await auditCount(admin, "admin.briefs_accessed")).toBe(beforeAudit);
    }
    await prisma.campaignBrief.update({ where: { id: stored.id }, data: { content: stored.content as Prisma.InputJsonValue } });
    const largeIds = Array.from({ length: 12 }, (_, i) => prefix + "t" + String(i).padStart(3, "0"));
    const large = CampaignRequirementsSchema.parse({ ...history.later.content.requirements, originalLanguage: "zh", productService: "界".repeat(5000), summary: "語".repeat(5000), usageRights: "権".repeat(5000),
      noGoTopics: Array.from({ length: 50 }, (_, i) => `${i}:` + "禁".repeat(197)), assumptions: Array.from({ length: 30 }, () => "仮".repeat(500)), openQuestions: Array.from({ length: 30 }, () => "問".repeat(500)),
      kpis: Array.from({ length: 30 }, (_, i) => ({ name: `Stored original KPI ${i}`, target: "指".repeat(1000) })) });
    expect(Buffer.byteLength(JSON.stringify(large), "utf8") * 30).toBeGreaterThan(ADMIN_BRIEFS_MAX_JSON_BYTES);
    await prisma.campaignBrief.createMany({ data: largeIds.map((id, i) => ({ id, campaignId: history.campaignId, version: 200 + i, inputRevision: history.later.inputRevision,
      content: { ...history.later.content, approvedByUserId: null, policyReview: null, requirements: { ...large, version: 200 + i, mandatoryPolicyVersionIds: [] } } })) });
    let query = await preceding(largeIds[0]!), sawReduced = false; const seen: string[] = [];
    for (let i = 0; i < 20; i++) {
      const result = await getAdminBriefs(admin.actor, query); expect(AdminBriefsSchema.safeParse(result).success).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(1900000); expect(result.briefs.length).toBeLessThanOrEqual(30);
      seen.push(...result.briefs.filter(item => largeIds.includes(item.id)).map(item => item.id));
      if (!result.nextCursor) break;
      expect(result.briefs.length).toBeGreaterThan(0); expect(result.nextCursor).toBe(result.briefs.at(-1)!.id);
      if (result.briefs.length < 30) sawReduced = true; query = { after: result.nextCursor };
      if (i === 19) throw new Error("Bounded large-history traversal did not terminate");
    }
    expect(sawReduced).toBe(true); expect(seen).toEqual(largeIds); expect(new Set(seen).size).toBe(largeIds.length);
    const audit = await prisma.adminAudit.findFirstOrThrow({ where: { actorUserId: admin.user.id, action: "admin.briefs_accessed" }, orderBy: { createdAt: "desc" } });
    expect(audit).toMatchObject({ resourceType: "AdminBriefs", resourceId: "platform" });
    expect(Object.keys(audit.snapshot as object).sort()).toEqual(["after", "asOf", "nextCursor", "returned", "scope"]); privacy(audit.snapshot, admin);
  }, 60000);

  it("requires current native ADMIN before queries/null output and denies genuine waits/final real expiry with audit rollback", async () => {
    const admin = await person("ADMIN"), wrong = await person("BRAND");
    await expect(getAdminBriefs(null as never, { unsupported: true })).rejects.toMatchObject({ status: 401 });
    await expect(getAdminTaxonomy(null as never)).rejects.toMatchObject({ status: 401 });
    await expect(getAdminBriefs(wrong.actor, { unsupported: true })).rejects.toMatchObject({ status: 403 }); await expect(getAdminTaxonomy(wrong.actor)).rejects.toMatchObject({ status: 403 });
    await expect(getAdminBriefs(admin.actor, { unsupported: true })).rejects.toMatchObject({ code: "VALIDATION", status: 422 });
    await expect(getAdminBriefs(admin.actor, { after: "bad\nprivate" })).rejects.toMatchObject({ code: "VALIDATION", status: 422 });
    for (const kind of ["BRIEFS", "TAXONOMY"] as const) {
      const actor = await person("ADMIN"), peer = new PrismaClient(), held = latch(), release = latch(); let pid = 0;
      const action = kind === "BRIEFS" ? "admin.briefs_accessed" : "admin.taxonomy_accessed";
      const holding = peer.$transaction(async tx => { pid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`)[0]!.pid;
        await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${actor.actor.sessionId} FOR UPDATE`; held.release(); await release.promise;
        await tx.authSession.update({ where: { id: actor.actor.sessionId }, data: { revokedAt: new Date() } }); }, { timeout: 12000 });
      let reading: Promise<{ exposed: boolean; status?: number }> | undefined;
      try {
        await held.promise;
        reading = (kind === "BRIEFS" ? getAdminBriefs(actor.actor) : getAdminTaxonomy(actor.actor)).then(() => ({ exposed: true }), (error: { status?: number }) => ({ exposed: false, status: error.status }));
        await blockedBy(pid, "AuthSession"); release.release(); await holding; const result = await reading; expect(result.exposed).toBe(false); expect([401, 503]).toContain(result.status);
        await expect(kind === "BRIEFS" ? getAdminBriefs(actor.actor) : getAdminTaxonomy(actor.actor)).rejects.toMatchObject({ status: 401 }); expect(await auditCount(actor, action)).toBe(0);
      } finally { release.release(); await holding; await reading; await peer.$disconnect(); }
      const expiring = await person("ADMIN"), auditPeer = new PrismaClient(), auditHeld = latch(), auditRelease = latch(); let auditPid = 0;
      const auditHolding = auditPeer.$transaction(async tx => { auditPid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`)[0]!.pid;
        await tx.$executeRaw`LOCK TABLE "AdminAudit" IN ACCESS EXCLUSIVE MODE`; auditHeld.release(); await auditRelease.promise; }, { timeout: 12000 });
      let expired: Promise<{ exposed: boolean; status?: number }> | undefined;
      try {
        await auditHeld.promise; const expiresAt = new Date(Date.now() + 2500); await prisma.authSession.update({ where: { id: expiring.actor.sessionId }, data: { expiresAt } });
        const historicalClock = new Date("2000-01-01T00:00:00.000Z");
        expired = (kind === "BRIEFS" ? getAdminBriefs(expiring.actor, {}, { now: historicalClock }) : getAdminTaxonomy(expiring.actor, { now: historicalClock })).then(() => ({ exposed: true }), (error: { status?: number }) => ({ exposed: false, status: error.status }));
        await blockedBy(auditPid, "AdminAudit"); expect(Date.now() < expiresAt.getTime()).toBe(true);
        await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 30))); auditRelease.release(); await auditHolding;
        expect(await expired).toEqual({ exposed: false, status: 401 }); expect(await auditCount(expiring, action)).toBe(0);
      } finally { auditRelease.release(); await auditHolding; await expired; await auditPeer.$disconnect(); }
    }
  }, 60000);

  it("returns exact139/12 catalogs and distinct stored assignments/unknown zeroes without private hydration or retired mutations", async () => {
    const admin = await person("ADMIN"), before = await taxonomyExpected();
    const target = await person("CREATOR");
    for (const [i, nicheIds, fameTags] of [[0, ["beauty", "beauty", "skincare", unknownTag, unknownTag], ["sports", "sports", "social_only", unknownTag]],
      [1, ["skincare", "Beauty", " beauty "], ["sports", "social-only", "Sports"]], [2, [], []]] as const) {
      const creator = await prisma.creator.create({ data: { userId: i === 0 ? target.user.id : null, handle: "abt_" + key().replaceAll("-", "").slice(0, 20), displayName: unknownTag, bio: unknownTag,
        state: "PRIVATE", isTest: true, nicheIds: [...nicheIds], fameTags: [...fameTags], profileFacts: { privateCanary: secret } } }); creators.add(creator.id);
    }
    await prisma.user.update({ where: { id: target.user.id }, data: { active: false } });
    const anticipated = await taxonomyExpected(), sql: string[] = [], client = new PrismaClient({ log: [{ emit: "event", level: "query" }] }); client.$on("query", event => { sql.push(event.query); });
    let dto!: AdminTaxonomyDTO;
    try { dto = await getAdminTaxonomy(admin.actor, { client }); } finally { await client.$disconnect(); }
    expect(AdminTaxonomySchema.safeParse(dto).success).toBe(true); expect(dto.scope).toBe("ALL_STORED_CREATOR_ASSIGNMENTS"); expect(dto.source).toEqual(NICHE_SOURCE);
    expect(dto.niches).toEqual(anticipated.niches); expect(dto.fame).toEqual(anticipated.fame); expect(dto.unknownAssignments).toEqual(anticipated.unknownAssignments);
    expect(dto.niches).toHaveLength(139); expect(dto.niches.filter(row => row.parentSlug === null)).toHaveLength(30); expect(dto.niches.filter(row => row.parentSlug !== null)).toHaveLength(109); expect(dto.fame).toHaveLength(12);
    const count = (rows: AdminTaxonomyDTO["niches"], slug: string) => rows.find(row => row.slug === slug)!.assignmentCount;
    expect(count(dto.niches, "beauty") - count(before.niches, "beauty")).toBe(1); expect(count(dto.niches, "skincare") - count(before.niches, "skincare")).toBe(2);
    expect(dto.fame.find(row => row.industry === "sports")!.assignmentCount - before.fame.find(row => row.industry === "sports")!.assignmentCount).toBe(2);
    expect(dto.unknownAssignments.nicheCreators - before.unknownAssignments.nicheCreators).toBe(2); expect(dto.unknownAssignments.fameCreators - before.unknownAssignments.fameCreators).toBe(2);
    for (const row of dto.niches) if (anticipated.niches.find(item => item.slug === row.slug)!.assignmentCount === 0) expect(row.assignmentCount).toBe(0);
    privacy(dto, admin);
    const selects = sql.filter(statement => /\bSELECT\b/i.test(statement) && /"Creator"/.test(statement)); expect(selects.length).toBeGreaterThan(0);
    for (const statement of selects) expect(statement).not.toMatch(/"(?:displayName|bio|profileFacts|userId|handle|city|languages|minimumMinor)"|SELECT\s+\*/i);
    expect(sql.some(statement => /\bSELECT\b/i.test(statement) && /"(?:Category|Skill|Provider)"/.test(statement))).toBe(false);
    const audit = await prisma.adminAudit.findFirstOrThrow({ where: { actorUserId: admin.user.id, action: "admin.taxonomy_accessed" } });
    expect(audit).toMatchObject({ resourceType: "AdminTaxonomy", resourceId: "platform" });
    expect(audit.snapshot).toEqual({ asOf: dto.asOf, scope: dto.scope, nicheEntries: 139, fameEntries: 12, unknownNicheCreators: dto.unknownAssignments.nicheCreators, unknownFameCreators: dto.unknownAssignments.fameCreators });
    const category = await prisma.category.create({ data: { nameAr: "فئة قديمة للاختبار", nameEn: "Synthetic obsolete category", demoCount: 1900000000 } }); categories.add(category.id);
    const skill = await prisma.skill.create({ data: { name: "obsolete-synthetic-" + key(), categoryId: category.id } }); token = admin.token;
    const origin = process.env.APP_ORIGIN; if (!origin) throw new Error("Retired mutation native cookie test needs guarded APP_ORIGIN");
    const request = (path: string, method: string, input?: unknown) => new Request(new URL(path, origin), { method, headers: { Origin: new URL(origin).origin, "Content-Type": "application/json" }, body: input === undefined ? undefined : JSON.stringify(input) });
    const categoryBefore = await prisma.category.findUniqueOrThrow({ where: { id: category.id } });
    const calls = [
      () => retiredCategoryCreate(request("/api/admin/categories", "POST", { nameAr: "تغيير", nameEn: "Changed" })),
      () => retiredCategoryPatch(request(`/api/admin/categories/${category.id}`, "PATCH", { nameAr: "تغيير" }), { params: Promise.resolve({ id: category.id }) }),
      () => retiredCategoryDelete(request(`/api/admin/categories/${category.id}`, "DELETE"), { params: Promise.resolve({ id: category.id }) }),
      () => retiredSkillCreate(request("/api/admin/skills", "POST", { name: "changed", categoryId: category.id })),
      () => (retiredSkills as unknown as (request: Request) => Promise<Response>)(request("/api/admin/skills", "GET")),
      () => retiredQuality(request("/api/admin/briefs/unknown", "PATCH", { qualityScore: 100 }), { params: Promise.resolve({ id: "unknown" }) }),
    ];
    for (const call of calls) expect((await call()).status).toBe(410);
    expect(await prisma.category.findUniqueOrThrow({ where: { id: category.id } })).toEqual(categoryBefore); expect(await prisma.skill.count({ where: { categoryId: category.id } })).toBe(1); expect(await prisma.skill.findUnique({ where: { id: skill.id } })).not.toBeNull();
    const after = await getAdminTaxonomy(admin.actor); expect(after.niches).toEqual(dto.niches); expect(after.fame).toEqual(dto.fame); expect(after.unknownAssignments).toEqual(dto.unknownAssignments);
  }, 60000);
});
