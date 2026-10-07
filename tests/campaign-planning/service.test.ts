import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import type { OrganizationActor } from "@/lib/organizations/context";
import { createOrganization, proposeClientAssociation, authorizeClientAssociation, proposeMember, acceptMembership, setClientGrant } from "@/lib/organizations/service";
import { getClientAuthority } from "@/lib/organizations/loaders";
import { executeBrandContextCommand, decideContextOwnerReview, getApprovedBrandContextVersion } from "@/lib/brand-context/service";
import { BrandContextContentSchema, type PlanningScope } from "@/lib/brand-context/contracts";
import { executeCampaignPlanningCommand, listPlanningCampaigns, getPlanningCampaign, listCampaignOwnerReviews, getCampaignOwnerReview, decideCampaignOwnerReview } from "@/lib/campaign-planning/service";
import { CampaignPlanningCommandSchema, CampaignPlanningReceiptSchema, CampaignPlanningResultSchema, PlanningCampaignListSchema, PlanningCampaignSchema,
  CampaignOwnerReviewsSchema, CampaignOwnerReviewSchema, CampaignOwnerReviewResultSchema, type PlanningCampaign } from "@/lib/campaign-planning/contracts";
import { getLegacyCampaignOverview, selectLegacyOwnerCampaign } from "@/lib/campaign-planning/legacy";
import { createCampaign, getCampaign, listCampaigns, applyCampaignMutation, generateCampaignBrief, approveCampaignBrief } from "@/lib/campaigns/service";
import { CampaignFieldsSchema } from "@/lib/campaigns/contracts";
import { getCampaignMatches, runCampaignMatching, decideCampaignMatch } from "@/lib/matching/persistence";
import { getDealComposeContext } from "@/lib/deals/readiness";
import { saveOfferDraft, getOfferDraft } from "@/lib/deals/drafts";
import { createDealOffer, applyDealCommand, getDeal } from "@/lib/deals/service";
import { getAdminCampaigns } from "@/lib/admin/campaigns";
import { resolveCampaignPolicyReview } from "@/lib/policies";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { cleanupReviewedEvidence, reviewedOwnershipFixture } from "../helpers/reviewed-evidence";
import { campaignFields } from "../campaigns/fixtures";
import { fixture as directFixture, users as directFixtureUsers } from "../deals/fixtures";

// Exactly three full native groups. Root alone runs guarded native targets.
// Real sessions/org/context/evidence/domain
// commands use owned synthetic rows/bytes; no live provider/legal acceptance,
// Date replacement, producer/auth mock or test-module fixture import.
const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>(), campaigns = new Set<string>(), creators = new Set<string>();
const key = () => randomUUID(), allCaps = { view: true, plan: true, approveShortlist: true, reviewContent: true, signCustomer: true, financial: true, manageGrants: true };
const policyOptions = { policyReviewResolver: resolveCampaignPolicyReview };
afterEach(async () => {
  const workspaces = await prisma.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } });
  if (workspaces.length) {
    const ids = workspaces.map(row => row.id);
    for (const table of ["PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission", "CampaignBriefProvenance", "CampaignProposalDependency",
      "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding", "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const) {
      await prisma.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join(ids)})`);
    }
    await prisma.planningWorkspace.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.deal.deleteMany({ where: { brandId: { in: [...brands] } } });
  await prisma.offerDraftCommand.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await prisma.offerDraft.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await prisma.matchDecisionRecord.deleteMany({ where: { campaignId: { in: [...campaigns] } } });
  await prisma.campaign.deleteMany({ where: { brandId: { in: [...brands] } } });
  await prisma.creator.deleteMany({ where: { id: { in: [...creators] } } });
  await cleanupReviewedEvidence(prisma, [...users], "test");
  await prisma.organizationCommand.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await prisma.clientGrant.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organizationClient.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [...organizations] } } });
  await prisma.brand.deleteMany({ where: { id: { in: [...brands] } } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
  if (users.size) await prisma.outboxEvent.deleteMany({ where: { OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
  for (const set of [users, brands, organizations, campaigns, creators]) set.clear();
});
async function sign(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } }), token = await openSession(user.id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Synthetic planning native session did not resolve");
  const actor: OrganizationActor = { userId: session.userId, role: session.role, sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  return { user, actor, token };
}
async function person(role: "BRAND" | "CREATOR" | "ADMIN" = "BRAND") {
  const id = key(); users.add(id); await prisma.user.create({ data: { id, role, active: true, isTest: true, name: "Synthetic planning actor",
    email: `${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } }); return sign(id);
}
async function company() {
  const owner = await person(), brand = await prisma.brand.create({ data: { userId: owner.user.id, slug: "planning-" + key().replace(/-/g, "").slice(0, 16),
    name: "Synthetic manual company", countryCode: "KW", isTest: true } }); brands.add(brand.id);
  return { ...owner, brand, scope: { kind: "OWN_BRAND", brandId: brand.id } as PlanningScope };
}
async function agency(customer: Awaited<ReturnType<typeof company>>, nameOriginal: string, capabilities = allCaps) {
  const owner = await person(), seat = await person(), { organization } = await createOrganization(owner.actor, { operationKey: key(), kind: "AGENCY", nameOriginal }); organizations.add(organization.id);
  const revision = async () => (await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).revision;
  const proposal = await proposeClientAssociation(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), brandId: customer.brand.id });
  const { client } = await authorizeClientAssociation(customer.actor, proposal.client.id, { operationKey: key(), expectedRevision: proposal.client.revision, capabilities: allCaps });
  const member = await proposeMember(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), targetUserId: seat.user.id });
  const { membership } = await acceptMembership(seat.actor, member.membership.id, { operationKey: key(), expectedRevision: member.membership.revision });
  const { grant } = await setClientGrant(owner.actor, client.id, { operationKey: key(), expectedClientRevision: client.revision, membershipId: membership.id, expectedGrantRevision: null, capabilities });
  return { owner, seat, organization, client, membership, grant, scope: { kind: "CLIENT", clientId: client.id } as PlanningScope };
}
type Company = Awaited<ReturnType<typeof company>>;
type Agency = Awaited<ReturnType<typeof agency>>;
const contextContent = BrandContextContentSchema.parse({ schemaVersion: 1, positioning: { text: "  Original private positioning\nتموضع أصلي  ", language: "ar" },
  values: [], tone: { text: "  Exact approved original tone  ", language: "en" }, references: [], competitors: [] });
async function approvedContext(owner: Company, scope = owner.scope, seat?: Agency) {
  const actor = seat?.seat.actor ?? owner.actor, expected = async () => seat ? { expectedAuthority: await getClientAuthority(actor, seat.client.id, "plan") } : {};
  const made = await executeBrandContextCommand(actor, { operationKey: key(), scope, ...(await expected()), action: "CREATE", expectedRevision: 0,
    payload: { nameOriginal: { text: "Original approved planning context", language: "en" }, content: contextContent } });
  const submitted = await executeBrandContextCommand(actor, { operationKey: key(), scope, ...(await expected()), action: "SUBMIT", contextId: made.contextId, expectedRevision: made.revision, payload: {} });
  const approved = await decideContextOwnerReview(owner.actor, { operationKey: key(), submissionId: submitted.submissionId!, expectedRevision: 1, decision: "APPROVE" });
  const version = await getApprovedBrandContextVersion(actor, { scope, versionId: approved.versionId! });
  expect(version.version.content).toEqual(contextContent); return { contextId: made.contextId, parentRevision: submitted.revision, version: version.version,
    choice: { kind: "APPROVED_CONTEXT" as const, versionId: version.version.id, contentHash: version.version.contentHash } };
}
async function createPlanning(actor: OrganizationActor, scope: PlanningScope, selection: unknown = { kind: "NONE" }, fields: unknown = {}) {
  const command = { operationKey: key(), scope, ...(scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(actor, scope.clientId, "plan") } : {}),
    action: "CREATE", expectedCampaignRevision: 0, expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0, payload: { fields, selection, narrative: null } };
  const result = CampaignPlanningResultSchema.parse(await executeCampaignPlanningCommand(actor, command, policyOptions)); campaigns.add(result.campaignId); return { command, result };
}
async function planning(actor: OrganizationActor, scope: PlanningScope, campaignId: string) { return PlanningCampaignSchema.parse(await getPlanningCampaign(actor, { scope, campaignId })); }
async function inputFor(actor: OrganizationActor, scope: PlanningScope, current: PlanningCampaign, action: string, payload: unknown) {
  return { operationKey: key(), scope, ...(scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(actor, scope.clientId, "plan") } : {}), campaignId: current.campaign.id,
    expectedCampaignRevision: current.campaign.revision, expectedPlanningRevision: current.planning.revision, expectedSelectionId: current.planning.selection.id,
    expectedSelectionRevision: current.planning.selection.revision, action, payload };
}
async function step(actor: OrganizationActor, scope: PlanningScope, campaignId: string, action: string, payload: unknown) {
  const before = await planning(actor, scope, campaignId), command = await inputFor(actor, scope, before, action, payload), result = await executeCampaignPlanningCommand(actor, command, policyOptions);
  expect(result.campaignRevision).toBe(before.campaign.revision + 1); expect(result.planningRevision).toBe(before.planning.revision + 1); return { before, command, result };
}
async function reject(action: Promise<unknown>, code: string, status = 409) { await expect(action).rejects.toMatchObject({ status, code }); }
function privateSafe(value: unknown, canaries: readonly string[]) { for (const canary of canaries) expect(JSON.stringify(value)).not.toContain(canary); }

async function acceptedLegacy() {
  const existing = new Set(directFixtureUsers);
  let legacy: Awaited<ReturnType<typeof directFixture>>;
  try { legacy = await directFixture(2, "10001", { now: new Date(), target: "test" }); }
  finally {
    const added = directFixtureUsers.filter(id => !existing.has(id)); for (const id of added) users.add(id);
    for (const row of await prisma.brand.findMany({ where: { userId: { in: added } }, select: { id: true } })) brands.add(row.id);
    for (const row of await prisma.creator.findMany({ where: { userId: { in: added } }, select: { id: true } })) creators.add(row.id);
    for (const row of await prisma.campaign.findMany({ where: { brand: { userId: { in: added } } }, select: { id: true } })) campaigns.add(row.id);
  }
  brands.add(legacy.brandId); creators.add(legacy.target.id); campaigns.add(legacy.campaign.id);
  // Explicit synthetic eligibility after actual proof review; no publication,
  // provider/legal or policy verification claim is made by these fixture flags.
  await prisma.creator.update({ where: { id: legacy.target.id }, data: { state: "PUBLISHED", brandVisible: true } });
  const options = { policyVerifier: legacy.options.policyVerifier }; // Existing labelled synthetic reviewed historical terms, never planning resolver input.
  const offered = await createDealOffer(legacy.brandUserId, legacy.input, options);
  const accepted = await applyDealCommand(legacy.target.userId, offered.deal.id, { operationKey: key(), expectedVersion: offered.deal.version,
    action: "ACCEPT", offerId: offered.deal.currentOffer.id, expectedOfferVersion: offered.deal.currentOffer.version, language: "ar" }, options);
  expect(accepted.deal.status).toBe("ACCEPTED"); expect(accepted.deal.agreement).not.toBeNull();
  const brand = await prisma.brand.findUniqueOrThrow({ where: { id: legacy.brandId } });
  return { legacy, options, deal: accepted.deal, owner: { ...await sign(legacy.brandUserId), brand, scope: { kind: "OWN_BRAND", brandId: brand.id } as PlanningScope },
    recipient: await sign(legacy.target.userId) };
}
async function submitBrief(actor: OrganizationActor, scope: PlanningScope, campaignId: string, briefId: string, version: number) {
  return step(actor, scope, campaignId, "SUBMIT_BRIEF", { briefId, expectedBriefVersion: version });
}
async function approveBrief(owner: Company, submissionId: string) {
  return CampaignOwnerReviewResultSchema.parse(await decideCampaignOwnerReview(owner.actor, { operationKey: key(), submissionId, expectedRevision: 1, decision: "APPROVE" }, policyOptions));
}
function latch<T>() { let resolve!: (value: T | PromiseLike<T>) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
type WaitTable = "User" | "ClientGrant" | "OrganizationClient" | "Brand" | "CampaignPlanningCommand";
async function blocker(table: WaitTable, id: string | null, after?: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  const peer = new PrismaClient(), monitor = new PrismaClient(), ready = latch<number>(), release = latch<void>(), stop = new AbortController();
  const holding = peer.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout='4s'`;
    if (table === "CampaignPlanningCommand") await tx.$executeRaw`LOCK TABLE "CampaignPlanningCommand" IN SHARE MODE`;
    else await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw('"' + table + '"')} WHERE id=${id} FOR UPDATE`);
    const pids = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`; ready.resolve(pids[0]!.pid); await release.promise; if (after) await after(tx);
  }, { maxWait: 5000, timeout: 12000 }); void holding.catch(() => {});
  let pid: number;
  try { pid = await Promise.race([ready.promise, holding.then(() => { throw new Error("Planning blocker ended before its native lock"); })]); }
  catch (error) { release.resolve(); await holding.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); throw error; }
  let observed: Promise<number> | undefined;
  return { holding, release: () => release.resolve(), wait() { observed = (async () => {
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline) {
      if (stop.signal.aborted) throw new Error("Planning native wait observer cancelled");
      const rows = await monitor.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'
        AND ${pid}=ANY(pg_blocking_pids(pid)) AND query LIKE ${`%"${table}"%`} AND (${table} <> 'CampaignPlanningCommand' OR query ILIKE '%INSERT%')`;
      if (rows.length) return rows[0]!.pid; await delay(20);
    }
    throw new Error("Planning did not reach its actual native wait");
  })(); return observed; }, async close() { release.resolve(); stop.abort(); await holding.catch(() => {}); await observed?.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); } };
}

describe("full M03 campaign planning: native synthetic scoped/manual/legacy integration", () => {
  it("completes OWN manual/NONE/context/tone/narrative/brief review and retains actual accepted legacy parties and immutable history", async () => {
    const f = await company(), approved = await approvedContext(f); // Real context producer before inert planning RED.
    const made = await createPlanning(f.actor, f.scope); expect(made.result).toMatchObject({ campaignRevision: 1, planningRevision: 1, selectionRevision: 1, action: "CREATE" });
    let current = await planning(f.actor, f.scope, made.result.campaignId);
    expect(current.planning.selection).toMatchObject({ kind: "NONE", versionId: null, contentHash: null, revision: 1 });
    expect(current.planning.narrative).toBeNull(); expect(current.campaign.conversation).toEqual([]);
    for (const mode of ["CHAT", "PARAGRAPH"] as const) {
      const originalText = { text: " \tنص أصلي غير معالج\nOriginal durable words without extraction\r ", language: "ar" };
      await step(f.actor, f.scope, made.result.campaignId, "SAVE_NARRATIVE", { narrative: { schemaVersion: 1, mode, processing: "UNPROCESSED", originalText } });
      current = await planning(f.actor, f.scope, made.result.campaignId); expect(current.planning.narrative).toEqual({ schemaVersion: 1, mode, processing: "UNPROCESSED", originalText });
      expect(current.campaign.fields).toEqual({ desiredCreatorCount: 1 }); expect(current.campaign.conversation).toEqual([]);
    }
    await step(f.actor, f.scope, made.result.campaignId, "UPDATE_FIELDS", { patch: campaignFields });
    const fieldsBeforeSelection = (await planning(f.actor, f.scope, made.result.campaignId)).campaign.fields;
    await step(f.actor, f.scope, made.result.campaignId, "SET_SELECTION", { selection: approved.choice });
    current = await planning(f.actor, f.scope, made.result.campaignId); expect(current.campaign.fields).toEqual(fieldsBeforeSelection);
    expect(current.planning.selectedContext).toEqual(approved.version);
    const proposed = await step(f.actor, f.scope, made.result.campaignId, "PROPOSE_CONTEXT_TONE", {});
    current = await planning(f.actor, f.scope, made.result.campaignId); const proposal = current.proposals.find(row => row.id === proposed.result.proposalId)!;
    expect(proposal).toMatchObject({ origin: "CONTEXT_TONE", patch: { tone: approved.version.content.tone.text }, dependency: {
      fieldsRevision: current.campaign.fieldsRevision, selectionId: current.planning.selection.id, selectionRevision: current.planning.selection.revision } });
    await step(f.actor, f.scope, made.result.campaignId, "APPLY_PROPOSAL", { proposalId: proposal.id, toneDecision: "KEEP" });
    current = await planning(f.actor, f.scope, made.result.campaignId); expect(current.campaign.fields.tone).toBe(campaignFields.tone);
    expect(current.proposals.find(row => row.id === proposal.id)?.appliedAt).not.toBeNull();
    const replace = await step(f.actor, f.scope, made.result.campaignId, "PROPOSE_CONTEXT_TONE", {});
    await step(f.actor, f.scope, made.result.campaignId, "APPLY_PROPOSAL", { proposalId: replace.result.proposalId, toneDecision: "REPLACE" });
    current = await planning(f.actor, f.scope, made.result.campaignId); expect(current.campaign.fields).toEqual({ ...campaignFields, tone: approved.version.content.tone.text });
    const generated = await step(f.actor, f.scope, made.result.campaignId, "GENERATE_BRIEF", {}), submitted = await submitBrief(f.actor, f.scope, made.result.campaignId, generated.result.briefId!, generated.result.version!);
    const view = CampaignOwnerReviewSchema.parse(await getCampaignOwnerReview(f.actor, { submissionId: submitted.result.submissionId! }));
    expect(view.review.provenance).toMatchObject({ selectionId: generated.before.planning.selection.id, selectionRevision: generated.before.planning.selection.revision,
      versionId: approved.version.id, contentHash: approved.version.contentHash });
    expect(view.review.contentHash).toBe(canonicalHash({ content: view.review.content, provenance: view.review.provenance }));
    const ownerApproved = await approveBrief(f, submitted.result.submissionId!); expect(ownerApproved.state).toBe("APPROVED");
    const originalBrief = await prisma.campaignBrief.findUniqueOrThrow({ where: { id: generated.result.briefId! } });
    current = await planning(f.actor, f.scope, made.result.campaignId); expect(current.campaign.currentBriefVersion).toBe(generated.result.version);
    const fields = current.campaign.fields, selectionId = current.planning.selection.id;
    await step(f.actor, f.scope, made.result.campaignId, "SET_SELECTION", { selection: { kind: "NONE" } });
    current = await planning(f.actor, f.scope, made.result.campaignId); expect(current.campaign.fields).toEqual(fields);
    expect(current.campaign.status).toBe("DRAFT"); expect(current.campaign.currentBriefVersion).toBeNull(); expect(current.planning.selection.id).not.toBe(selectionId);
    expect(await prisma.campaignBrief.findUniqueOrThrow({ where: { id: originalBrief.id } })).toEqual(originalBrief);
    await step(f.actor, f.scope, made.result.campaignId, "SET_SELECTION", { selection: approved.choice });
    await executeBrandContextCommand(f.actor, { operationKey: key(), scope: f.scope, contextId: approved.contextId, expectedRevision: approved.parentRevision, action: "SET_ARCHIVED", payload: { archived: true } });
    current = await planning(f.actor, f.scope, made.result.campaignId);
    await reject(executeCampaignPlanningCommand(f.actor, await inputFor(f.actor, f.scope, current, "SET_SELECTION", { selection: approved.choice }), policyOptions), "ARCHIVED");
    await reject(executeCampaignPlanningCommand(f.actor, await inputFor(f.actor, f.scope, current, "PROPOSE_CONTEXT_TONE", {}), policyOptions), "ARCHIVED");
    const pinned = await step(f.actor, f.scope, made.result.campaignId, "GENERATE_BRIEF", {}), pinnedSubmitted = await submitBrief(f.actor, f.scope, made.result.campaignId, pinned.result.briefId!, pinned.result.version!);
    expect((await approveBrief(f, pinnedSubmitted.result.submissionId!)).state).toBe("APPROVED");
    expect(await prisma.campaignBrief.findUniqueOrThrow({ where: { id: originalBrief.id } })).toEqual(originalBrief);

    const retained = await acceptedLegacy(), oldCampaign = await getCampaign(retained.owner.user.id, retained.legacy.campaign.id, undefined, retained.owner.actor);
    const agreement = await prisma.agreementSnapshot.findUniqueOrThrow({ where: { id: retained.deal.agreement!.id } }), offer = retained.deal.offers.find(row => row.version === 1)!;
    expect(offer).toMatchObject({ proposerUserId: retained.owner.user.id, recipientUserId: retained.recipient.user.id });
    const oldCommands = await prisma.campaignCommand.findMany({ where: { campaignId: retained.legacy.campaign.id }, orderBy: { id: "asc" } });
    const historyMutation = { operationKey: key(), expectedRevision: oldCampaign.revision, action: "UPDATE_FIELDS", payload: { patch: { title: "Genuine old owner history before binding" } } };
    const history = await applyCampaignMutation(retained.owner.user.id, oldCampaign.id, historyMutation, undefined, { channel: "FORM", serverAuth: retained.owner.actor });
    const bound = await executeCampaignPlanningCommand(retained.owner.actor, { operationKey: key(), scope: retained.owner.scope, action: "BIND_OWN", campaignId: oldCampaign.id,
      expectedCampaignRevision: history.campaign.revision, expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0, payload: { selection: { kind: "NONE" } } }, policyOptions);
    expect(bound.planningRevision).toBe(1); expect(bound.selectionRevision).toBe(1);
    expect(await applyCampaignMutation(retained.owner.user.id, oldCampaign.id, historyMutation, undefined, { channel: "FORM", serverAuth: retained.owner.actor })).toEqual({ ...history, replayed: true });
    await reject(applyCampaignMutation(retained.owner.user.id, oldCampaign.id, { ...historyMutation, operationKey: key(), expectedRevision: bound.campaignRevision }, undefined,
      { channel: "FORM", serverAuth: retained.owner.actor }), "SCOPED_PLANNING_REQUIRED");
    await reject(generateCampaignBrief(retained.owner.user.id, oldCampaign.id, { operationKey: key(), expectedRevision: bound.campaignRevision }, undefined, retained.owner.actor), "SCOPED_PLANNING_REQUIRED");
    await reject(approveCampaignBrief(retained.owner.user.id, oldCampaign.id, { operationKey: key(), expectedRevision: bound.campaignRevision,
      briefId: originalBrief.id, expectedBriefVersion: originalBrief.version }, undefined, { channel: "FORM", serverAuth: retained.owner.actor }), "SCOPED_PLANNING_REQUIRED");
    const frozen = await getDeal(retained.owner.user.id, retained.deal.id, retained.options); expect(frozen.agreement).toEqual(retained.deal.agreement);
    expect(await prisma.agreementSnapshot.findUniqueOrThrow({ where: { id: agreement.id } })).toEqual(agreement);
    const confirmed = await applyDealCommand(retained.owner.user.id, retained.deal.id, { operationKey: key(), expectedVersion: frozen.version, action: "CONFIRM", agreementId: agreement.id,
      expectedAgreementVersion: agreement.version }, retained.options);
    const agreed = await applyDealCommand(retained.recipient.user.id, retained.deal.id, { operationKey: key(), expectedVersion: confirmed.deal.version, action: "CONFIRM", agreementId: agreement.id,
      expectedAgreementVersion: agreement.version }, retained.options); expect(agreed.deal.status).toBe("AGREED");
    expect(agreed.deal.briefVersion).toBe(retained.deal.briefVersion); expect(agreed.deal.agreement).toEqual(retained.deal.agreement);
    expect((await getDeal(retained.recipient.user.id, retained.deal.id, retained.options)).offers.find(row => row.version === 1)).toEqual(offer);
    for (const row of oldCommands) expect(await prisma.campaignCommand.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
    expect((await createDealOffer(retained.owner.user.id, retained.legacy.input, retained.options)).replayed).toBe(true);
    await reject(createDealOffer(retained.owner.user.id, { ...retained.legacy.input, operationKey: key(), expectedCampaignRevision: bound.campaignRevision }, retained.options), "MANAGED_CAMPAIGN_REQUIRED");
  }, 30000);

  it("keeps same-Brand OWN/two CLIENT journeys private, requires actual owner review, and denies every legacy CLIENT consumer without fallback", async () => {
    const f = await company(), a = await agency(f, "Actual synthetic agency A"), b = await agency(f, "Actual synthetic agency B"), approved = await approvedContext(f, a.scope, a);
    const first = await createPlanning(a.seat.actor, a.scope, approved.choice, { ...campaignFields, title: "A private scoped campaign" });
    const second = await createPlanning(b.seat.actor, b.scope, { kind: "NONE" }, { ...campaignFields, title: "B unsubmitted campaign canary" });
    expect(await prisma.campaignCommand.count({ where: { campaignId: { in: [first.result.campaignId, second.result.campaignId] } } })).toBe(0);
    expect(await prisma.campaignPlanningBinding.findUniqueOrThrow({ where: { campaignId: first.result.campaignId } })).toMatchObject({ brandId: f.brand.id });
    const receipt = await prisma.campaignPlanningCommand.findUniqueOrThrow({ where: { actorUserId_operationKey: { actorUserId: a.seat.user.id, operationKey: first.command.operationKey } } });
    const { replayed, ...minimal } = first.result; void replayed; expect(CampaignPlanningReceiptSchema.parse(receipt.result)).toEqual(minimal);
    privateSafe([first.result, receipt.result], ["A private scoped campaign", "selectionId", "content", "conversation", "authority", a.seat.token, a.seat.user.email]);
    expect(await executeCampaignPlanningCommand(a.seat.actor, first.command, policyOptions)).toEqual({ ...first.result, replayed: true });
    const listA = PlanningCampaignListSchema.parse(await listPlanningCampaigns(a.seat.actor, { scope: a.scope })), listB = await listPlanningCampaigns(b.seat.actor, { scope: b.scope });
    expect(listA.campaigns.map(row => row.id)).toEqual([first.result.campaignId]); expect(listB.campaigns.map(row => row.id)).toEqual([second.result.campaignId]);
    await reject(getPlanningCampaign(a.seat.actor, { scope: a.scope, campaignId: second.result.campaignId }), "NOT_FOUND", 404);
    await reject(getPlanningCampaign(f.actor, { scope: a.scope, campaignId: first.result.campaignId }), "NOT_FOUND", 404);
    const narrativeText = "PRIVATE UNSUBMITTED NARRATIVE CANARY";
    await step(a.seat.actor, a.scope, first.result.campaignId, "SAVE_NARRATIVE", { narrative: { schemaVersion: 1, mode: "PARAGRAPH", processing: "UNPROCESSED", originalText: { text: narrativeText, language: "en" } } });
    await step(a.seat.actor, a.scope, first.result.campaignId, "PROPOSE_FIELDS", { type: "PROPOSE_FIELDS", patch: { tone: "Unapplied human proposal canary" },
      originalText: { text: "Original unsubmitted proposal canary", language: "en" } });
    const generated = await step(a.seat.actor, a.scope, first.result.campaignId, "GENERATE_BRIEF", {}), submitted = await submitBrief(a.seat.actor, a.scope, first.result.campaignId, generated.result.briefId!, generated.result.version!);
    const decision = { operationKey: key(), submissionId: submitted.result.submissionId!, expectedRevision: 1, decision: "APPROVE" };
    await reject(decideCampaignOwnerReview(a.seat.actor, decision, policyOptions), "NOT_FOUND", 404);
    expect(await prisma.organizationMembership.count({ where: { userId: f.user.id, organizationId: { in: [a.organization.id, b.organization.id] } } })).toBe(0);
    const inbox = CampaignOwnerReviewsSchema.parse(await listCampaignOwnerReviews(f.actor)); expect(inbox.reviews.map(row => row.id)).toEqual([submitted.result.submissionId]);
    const snapshot = CampaignOwnerReviewSchema.parse(await getCampaignOwnerReview(f.actor, { submissionId: submitted.result.submissionId! }));
    expect(snapshot.review.content.requirements.title).toBe("A private scoped campaign"); expect(snapshot.review.selectedContext).toEqual(approved.version);
    privateSafe([inbox, snapshot], [narrativeText, "Unapplied human proposal canary", "Original unsubmitted proposal canary", "B unsubmitted campaign canary", a.seat.user.email]);
    const ownerApproved = await decideCampaignOwnerReview(f.actor, decision, policyOptions); expect(ownerApproved.state).toBe("APPROVED");
    expect(await decideCampaignOwnerReview(f.actor, decision, policyOptions)).toEqual({ ...ownerApproved, replayed: true });
    const brief = await prisma.campaignBrief.findUniqueOrThrow({ where: { id: generated.result.briefId! } }); expect(brief.approvedByUserId).toBe(f.user.id);
    const currentGrant = await prisma.clientGrant.findUniqueOrThrow({ where: { id: a.grant.id } });
    await setClientGrant(a.owner.actor, a.client.id, { operationKey: key(), expectedClientRevision: a.client.revision, membershipId: a.membership.id,
      expectedGrantRevision: currentGrant.revision, capabilities: { ...allCaps, view: false } });
    await reject(getPlanningCampaign(a.seat.actor, { scope: a.scope, campaignId: first.result.campaignId }), "NOT_FOUND", 404);
    expect(await executeCampaignPlanningCommand(a.seat.actor, first.command, policyOptions)).toEqual({ ...first.result, replayed: true });
    const grantNow = await prisma.clientGrant.findUniqueOrThrow({ where: { id: a.grant.id } });
    await setClientGrant(a.owner.actor, a.client.id, { operationKey: key(), expectedClientRevision: a.client.revision, membershipId: a.membership.id,
      expectedGrantRevision: grantNow.revision, capabilities: { ...allCaps, plan: false } });
    await reject(executeCampaignPlanningCommand(a.seat.actor, first.command, policyOptions), "NOT_FOUND", 404);

    // Real legacy functions and Root's native SSR selector equivalents must
    // exclude CLIENT before projection/count/limit and never substitute OWN.
    const old = await createCampaign(f.user.id, { operationKey: key(), fields: { title: "Genuine unbound owner campaign" } }, undefined, f.actor); campaigns.add(old.campaign.id);
    expect((await listCampaigns(f.user.id, { limit: 1 }, undefined, f.actor)).campaigns.map(row => row.id)).toEqual([old.campaign.id]);
    const overview = await getLegacyCampaignOverview(f.actor); expect(overview.campaignCount).toBe(1); expect(overview.recentCampaigns.map(row => row.id)).toEqual([old.campaign.id]);
    expect(await selectLegacyOwnerCampaign(f.actor)).toEqual({ id: old.campaign.id });
    await reject(selectLegacyOwnerCampaign(f.actor, { campaignId: first.result.campaignId }), "NOT_FOUND", 404);
    expect(await selectLegacyOwnerCampaign(f.actor, { approvedOnly: true })).toBeNull();
    await reject(getCampaign(f.user.id, first.result.campaignId, undefined, f.actor), "NOT_FOUND", 404);
    const matchingOptions = { client: prisma, serverAuth: f.actor }; // Trusted native session; never hashed/request metadata.
    await reject(getCampaignMatches(f.user.id, first.result.campaignId, undefined, matchingOptions), "NOT_FOUND", 404);
    await reject(runCampaignMatching(f.user.id, first.result.campaignId, { operationKey: key(), expectedCampaignRevision: ownerApproved.campaignRevision,
      expectedBriefVersion: generated.result.version }, matchingOptions), "NOT_FOUND", 404);
    const targetOwner = await person("CREATOR"), target = await prisma.creator.create({ data: { userId: targetOwner.user.id, handle: "planning_" + key().replace(/-/g, "").slice(0, 16),
      displayName: "Synthetic legacy consumer target", isTest: false, countryCode: "KW", state: "PUBLISHED", brandVisible: true, publicConsentAt: new Date(Date.now() - 60000) } }); creators.add(target.id);
    const reviewer = await person("ADMIN"), evidenceAt = new Date(Date.now() - 60000);
    await prisma.user.update({ where: { id: targetOwner.user.id }, data: { isTest: false } });
    const account = await prisma.socialAccount.create({ data: { creatorId: target.id, platform: "INSTAGRAM", handle: "proof_" + key().replace(/-/g, "").slice(0, 16),
      providerAccountId: "synthetic-planning-target-" + key(), intendedConfirmedAt: evidenceAt, consentAt: evidenceAt } });
    await reviewedOwnershipFixture(prisma, targetOwner.user.id, reviewer.user.id, account.id, "test", evidenceAt);
    await prisma.socialAccount.update({ where: { id: account.id }, data: { publicVisible: true, brandVisible: true } });
    await prisma.portfolioVersion.create({ data: { creatorId: target.id, version: 1, inputRevision: 1, approvedAt: evidenceAt,
      content: { title: "Synthetic original public title", bio: "Original fixture biography", sections: [], method: "APPROVED_FACT_TEMPLATE" } } });
    await prisma.creator.update({ where: { id: target.id }, data: { primaryAccountId: account.id, state: "PUBLISHED", publicConsentAt: evidenceAt, brandVisible: true } });
    expect((await getDealComposeContext(f.user.id, { campaignId: old.campaign.id, creatorId: target.id })).campaign.id).toBe(old.campaign.id);
    await reject(decideCampaignMatch(f.user.id, first.result.campaignId, { operationKey: key(), creatorId: target.id, runId: key(), decision: "SAVED", expectedDecisionRevision: 0,
      expectedBriefVersion: generated.result.version }, matchingOptions), "NOT_FOUND", 404);
    await reject(getDealComposeContext(f.user.id, { campaignId: first.result.campaignId, creatorId: target.id }), "NOT_FOUND", 404);
    const draft = await prisma.offerDraft.create({ data: { actorUserId: f.user.id, campaignId: first.result.campaignId, creatorId: target.id, terms: {} } });
    await reject(getOfferDraft(f.user.id, draft.id), "NOT_FOUND", 404);
    await reject(saveOfferDraft(f.user.id, { campaignId: first.result.campaignId, creatorId: target.id, operationKey: key(), expectedRevision: 0, patch: {} }), "NOT_FOUND", 404);
    const terms = { deliverables: [{ platform: "INSTAGRAM", format: "STORY", count: 1 }], amount: { amountMinor: "1", currencyCode: "KWD" }, period: campaignFields.period,
      usageRights: "Original fixture terms", note: { text: "Original direct fixture", language: "en" }, governingTermsVersionId: "synthetic-historical-terms", licencePolicyVersionIds: [] };
    await reject(createDealOffer(f.user.id, { operationKey: key(), campaignId: first.result.campaignId, creatorId: target.id, expectedCampaignRevision: ownerApproved.campaignRevision,
      expectedBriefVersion: generated.result.version, terms }), "NOT_FOUND", 404);
    const admin = await person("ADMIN"), adminPage = await getAdminCampaigns(admin.actor); expect(adminPage.scope).toBe("ALL_STORED_RECORDS");
    let visible = adminPage.campaigns; let after = adminPage.nextCursor;
    while (!visible.some(row => row.id === first.result.campaignId) && after) { const next = await getAdminCampaigns(admin.actor, { after }); visible = next.campaigns; after = next.nextCursor; }
    expect(visible.some(row => row.id === first.result.campaignId)).toBe(true);
    expect(CampaignPlanningCommandSchema.safeParse({ ...first.command, action: "BIND_OWN", campaignId: old.campaign.id }).success).toBe(false);
  }, 30000);

  it("rejects selection ABA/stale counters/keys, serializes one effect, and preserves data across genuine session/grant/client/owner waits and expiry", async () => {
    const f = await company(), context = await approvedContext(f), made = await createPlanning(f.actor, f.scope, context.choice, campaignFields);
    const proposed = await step(f.actor, f.scope, made.result.campaignId, "PROPOSE_CONTEXT_TONE", {}), original = await planning(f.actor, f.scope, made.result.campaignId);
    const beforeAba = original.planning.selection;
    await step(f.actor, f.scope, made.result.campaignId, "SET_SELECTION", { selection: { kind: "NONE" } });
    await step(f.actor, f.scope, made.result.campaignId, "SET_SELECTION", { selection: context.choice });
    let current = await planning(f.actor, f.scope, made.result.campaignId); expect(current.planning.selection.versionId).toBe(beforeAba.versionId);
    expect(current.planning.selection.id).not.toBe(beforeAba.id); expect(current.planning.selection.revision).toBe(beforeAba.revision + 2);
    await reject(executeCampaignPlanningCommand(f.actor, await inputFor(f.actor, f.scope, current, "APPLY_PROPOSAL", { proposalId: proposed.result.proposalId, toneDecision: "REPLACE" }), policyOptions), "STALE_PROPOSAL");
    const command = await inputFor(f.actor, f.scope, current, "SAVE_NARRATIVE", { narrative: null });
    for (const wrong of [{ expectedCampaignRevision: current.campaign.revision - 1 }, { expectedPlanningRevision: current.planning.revision - 1 },
      { expectedSelectionId: beforeAba.id }, { expectedSelectionRevision: beforeAba.revision }]) {
      await reject(executeCampaignPlanningCommand(f.actor, { ...command, ...wrong }, policyOptions), "STALE_VERSION");
    }
    const result = await executeCampaignPlanningCommand(f.actor, command, policyOptions);
    expect(await executeCampaignPlanningCommand(f.actor, command, policyOptions)).toEqual({ ...result, replayed: true });
    await reject(executeCampaignPlanningCommand(f.actor, { ...command, payload: { narrative: { schemaVersion: 1, mode: "CHAT", processing: "UNPROCESSED", originalText: { text: "Changed key words", language: "en" } } } }, policyOptions), "OPERATION_KEY_REUSED");
    current = await planning(f.actor, f.scope, made.result.campaignId);
    const candidates = await Promise.all([inputFor(f.actor, f.scope, current, "UPDATE_FIELDS", { patch: { title: "Concurrent A" } }), inputFor(f.actor, f.scope, current, "UPDATE_FIELDS", { patch: { title: "Concurrent B" } })]);
    const peer = new PrismaClient();
    try {
      const outcomes = await Promise.allSettled([executeCampaignPlanningCommand(f.actor, candidates[0], policyOptions), executeCampaignPlanningCommand(f.actor, candidates[1], { ...policyOptions, client: peer })]);
      expect(outcomes.filter(row => row.status === "fulfilled")).toHaveLength(1);
      const rejected = outcomes.find(row => row.status === "rejected"); if (rejected?.status === "rejected") expect(rejected.reason).toMatchObject({ code: "STALE_VERSION", status: 409 });
      expect(await prisma.campaignPlanningCommand.count({ where: { actorUserId: f.user.id, operationKey: { in: candidates.map(row => row.operationKey) } } })).toBe(1);
    } finally { await peer.$disconnect(); }
    const generated = await step(f.actor, f.scope, made.result.campaignId, "GENERATE_BRIEF", {}), submitted = await submitBrief(f.actor, f.scope, made.result.campaignId, generated.result.briefId!, generated.result.version!);
    await step(f.actor, f.scope, made.result.campaignId, "SET_SELECTION", { selection: context.choice });
    await reject(decideCampaignOwnerReview(f.actor, { operationKey: key(), submissionId: submitted.result.submissionId, expectedRevision: 1, decision: "APPROVE" }, policyOptions), "STALE_REVIEW");
    expect((await decideCampaignOwnerReview(f.actor, { operationKey: key(), submissionId: submitted.result.submissionId, expectedRevision: 1, decision: "DECLINE" }, policyOptions)).state).toBe("DECLINED");

    const raw = async (id: string) => ({ campaign: await prisma.campaign.findUniqueOrThrow({ where: { id } }), state: await prisma.campaignPlanningState.findUniqueOrThrow({ where: { campaignId: id } }),
      receipts: await prisma.campaignPlanningCommand.findMany({ where: { campaignId: id }, orderBy: { id: "asc" } }) });
    const waitReject = async (actor: OrganizationActor, scope: PlanningScope, id: string, table: WaitTable, lockId: string, after: (tx: Prisma.TransactionClient) => Promise<unknown>, code: string, status: number) => {
      const before = await raw(id), input = await inputFor(actor, scope, await planning(actor, scope, id), "UPDATE_FIELDS", { patch: { title: "Rejected wait must preserve private words" } });
      const held = await blocker(table, lockId, after), writing = executeCampaignPlanningCommand(actor, input, policyOptions); void writing.catch(() => {});
      try {
        expect(await Promise.race([held.wait(), writing.then(() => { throw new Error("Planning completed before genuine native waiting"); })])).toBeGreaterThan(0);
        held.release(); await held.holding; await reject(writing, code, status); expect(await raw(id)).toEqual(before);
      } finally { await held.close(); await writing.catch(() => {}); }
    };
    await waitReject(f.actor, f.scope, made.result.campaignId, "User", f.user.id, tx => tx.authSession.update({ where: { id: f.actor.sessionId }, data: { revokedAt: new Date() } }), "UNAUTHENTICATED", 401);
    const customer = await company(), a = await agency(customer, "Native waiting agency"), ca = await createPlanning(a.seat.actor, a.scope, { kind: "NONE" }, campaignFields);
    await waitReject(a.seat.actor, a.scope, ca.result.campaignId, "ClientGrant", a.grant.id, tx => tx.clientGrant.update({ where: { id: a.grant.id }, data: { plan: false, revision: { increment: 1 } } }), "NOT_FOUND", 404);
    const b = await agency(customer, "Native client withdrawal agency"), cb = await createPlanning(b.seat.actor, b.scope, { kind: "NONE" }, campaignFields);
    await waitReject(b.seat.actor, b.scope, cb.result.campaignId, "OrganizationClient", b.client.id, tx => tx.organizationClient.update({ where: { id: b.client.id }, data: { state: "REVOKED", revision: { increment: 1 } } }), "NOT_FOUND", 404);
    const transferring = await company(), transfer = await createPlanning(transferring.actor, transferring.scope, { kind: "NONE" }, campaignFields), nextOwner = await person();
    await waitReject(transferring.actor, transferring.scope, transfer.result.campaignId, "Brand", transferring.brand.id, tx => tx.brand.update({ where: { id: transferring.brand.id }, data: { userId: nextOwner.user.id } }), "NOT_FOUND", 404);
    const expires = await company(), exp = await createPlanning(expires.actor, expires.scope, { kind: "NONE" }, campaignFields), beforeExpiry = await raw(exp.result.campaignId);
    const expiryInput = await inputFor(expires.actor, expires.scope, await planning(expires.actor, expires.scope, exp.result.campaignId), "UPDATE_FIELDS", { patch: { title: "Expired operation must roll back" } });
    const expiresAt = new Date(Date.now() + 2500); await prisma.authSession.update({ where: { id: expires.actor.sessionId }, data: { expiresAt } });
    const held = await blocker("CampaignPlanningCommand", null), writing = executeCampaignPlanningCommand(expires.actor, expiryInput, policyOptions); void writing.catch(() => {});
    try {
      expect(await Promise.race([held.wait(), writing.then(() => { throw new Error("Planning completed before its actual journal INSERT wait"); })])).toBeGreaterThan(0);
      expect(Date.now()).toBeLessThan(expiresAt.getTime()); while (Date.now() <= expiresAt.getTime()) await delay(Math.min(50, expiresAt.getTime() - Date.now() + 1));
      expect(await resolveSession(expires.token)).toBeNull(); held.release(); await held.holding; await reject(writing, "UNAUTHENTICATED", 401); expect(await raw(exp.result.campaignId)).toEqual(beforeExpiry);
    } finally { await held.close(); await writing.catch(() => {}); }
    const receipts = await prisma.campaignPlanningCommand.findMany({ where: { actorUserId: { in: [...users] } } });
    for (const receipt of receipts) { expect(CampaignPlanningReceiptSchema.safeParse(receipt.result).success).toBe(true); privateSafe(receipt.result, ["selectionId", "content", "conversation", "authority", "session", "replayed", "Changed key words"]); }
    const audits = await prisma.adminAudit.findMany({ where: { actorUserId: { in: [...users] } } });
    privateSafe(audits.map(row => row.snapshot), [contextContent.positioning.text!, "Rejected wait must preserve private words", expires.token, expires.actor.sessionId]);
    // Canonical generation can preserve individually valid large original
    // fields; bounded submitted review must reject before any effect/truncation.
    const bounded = await company(), oversized = { ...campaignFields, productService: "p".repeat(5000), summary: "s".repeat(5000), usageRights: "u".repeat(5000),
      assumptions: Array.from({ length: 30 }, (_, i) => `${i}:` + "a".repeat(490)), openQuestions: Array.from({ length: 30 }, (_, i) => `${i}:` + "q".repeat(490)),
      noGoTopics: Array.from({ length: 50 }, (_, i) => `${i}:` + "n".repeat(190)), kpis: Array.from({ length: 30 }, (_, i) => ({ name: `Original KPI ${i}`, target: "t".repeat(1000) })) };
    expect(CampaignFieldsSchema.safeParse(oversized).success).toBe(true);
    const big = await createPlanning(bounded.actor, bounded.scope, { kind: "NONE" }, oversized), bigBrief = await step(bounded.actor, bounded.scope, big.result.campaignId, "GENERATE_BRIEF", {});
    const bigCurrent = await planning(bounded.actor, bounded.scope, big.result.campaignId); expect(Buffer.byteLength(JSON.stringify(bigCurrent.briefs[0]!.content), "utf8")).toBeGreaterThan(65536);
    const beforeBound = await raw(big.result.campaignId), submit = await inputFor(bounded.actor, bounded.scope, bigCurrent, "SUBMIT_BRIEF", { briefId: bigBrief.result.briefId, expectedBriefVersion: bigBrief.result.version });
    await reject(executeCampaignPlanningCommand(bounded.actor, submit, policyOptions), "SNAPSHOT_TOO_LARGE", 422); expect(await raw(big.result.campaignId)).toEqual(beforeBound);
    expect(await prisma.campaignPlanningSubmission.count({ where: { campaignId: big.result.campaignId } })).toBe(0);
    expect((await planning(bounded.actor, bounded.scope, big.result.campaignId)).campaign.fields).toEqual(oversized);
    const headers = await listPlanningCampaigns(bounded.actor, { scope: bounded.scope, limit: 1 }); expect(headers.campaigns.map(row => row.id)).toEqual([big.result.campaignId]);
    privateSafe(headers, ["p".repeat(5000), "s".repeat(5000)]);
    expect(PlanningCampaignListSchema.safeParse({ ...headers, campaigns: headers.campaigns.map(row => ({ ...row, input: oversized })) }).success).toBe(false);
  }, 40000);
});
