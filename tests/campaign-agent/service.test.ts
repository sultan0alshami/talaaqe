// Exactly three guarded native groups for the reviewed D067 freeze.
// Native sessions/organizations/planning commands; synthetic owned words only.
// No provider, SQL trigger bypass, reset, registered-test import or fake authority.
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, beforeAll, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { createOrganization, proposeClientAssociation, authorizeClientAssociation, proposeMember,
  acceptMembership, setClientGrant } from "@/lib/organizations/service";
import { getClientAuthority } from "@/lib/organizations/loaders";
import type { OrganizationActor } from "@/lib/organizations/context";
import { executeBrandContextCommand, decideContextOwnerReview, getApprovedBrandContextVersion } from "@/lib/brand-context/service";
import { BrandContextContentSchema, type PlanningScope } from "@/lib/brand-context/contracts";
import { executeCampaignPlanningCommand, getPlanningCampaign, decideCampaignOwnerReview } from "@/lib/campaign-planning/service";
import { executeCampaignAgentCommand, getCampaignAgent, getCampaignAgentTextSources } from "@/lib/campaign-agent/service";
import { CampaignAgentCommandSchema, CampaignAgentReceiptSchema } from "@/lib/campaign-agent/native-contracts";
import { CampaignAgentFieldKeys, CampaignAgentStateSchema, CustomerTextSourceSchema, FieldConfirmationSchema } from "@/lib/campaign-agent/contracts";
import { CampaignBriefContentSchema, CampaignFieldObjectSchema, CampaignFieldsSchema, type CampaignDraftFields } from "@/lib/campaigns/contracts";
import { campaignFields } from "../campaigns/fixtures";

const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>(), campaigns = new Set<string>();
const key = () => randomUUID(), form = { channel: "FORM" as const };
const allCaps = { view: true, plan: true, approveShortlist: true, reviewContent: true, signCustomer: true, financial: true, manageGrants: true };
const agentTables = ["CampaignAgentCommand", "CampaignAgentConfirmationBatch", "CampaignAgentTextSource", "CampaignAgent"] as const;
type AgentTable = typeof agentTables[number];
type AgentView = Awaited<ReturnType<typeof getCampaignAgent>>;
type SourcePage = Awaited<ReturnType<typeof getCampaignAgentTextSources>>;
type Fields = Record<string, unknown>;

beforeAll(async () => {
  const taskId = process.env.INFAME_TASK_ID;
  if (!taskId || !/^infame_[a-f0-9]{12}$/.test(taskId) || process.env.INFAME_ENV !== "test" || process.env.NODE_ENV === "production") throw new Error("Native interview witnesses require guarded test task");
  const rows = await prisma.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]?.id !== taskId || rows[0]?.kind !== "test" || rows[0]?.db !== taskId + "_test" || rows[0]?.host !== "127.0.0.1") throw new Error("Native interview target identity mismatch");
});
async function present(table: string) { return (await prisma.$queryRaw<Array<{ present: boolean }>>`SELECT to_regclass(${`"${table}"`}) IS NOT NULL AS present`)[0]?.present === true; }
async function stored(table: AgentTable, campaignId: string) {
  return prisma.$queryRaw<Fields[]>(Prisma.sql`SELECT * FROM ${Prisma.raw('"' + table + '"')} WHERE "campaignId"=${campaignId} ORDER BY id`);
}
afterEach(async () => {
  for (const table of agentTables) if (campaigns.size && await present(table)) await prisma.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "campaignId" IN (${Prisma.join([...campaigns])})`);
  const workspaces = await prisma.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } });
  if (workspaces.length) {
    const ids = workspaces.map(item => item.id);
    for (const table of ["PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission", "CampaignBriefProvenance", "CampaignProposalDependency",
      "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding", "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const) await prisma.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join(ids)})`);
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
  for (const set of [users, brands, organizations, campaigns]) set.clear();
});

async function sign(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const token = await openSession(user.id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Synthetic native interview session did not resolve");
  const actor: OrganizationActor = { userId: session.userId, role: session.role, sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  return { user, actor, token };
}
async function person(role: "BRAND" | "CREATOR" | "ADMIN" = "BRAND") {
  const id = key(); users.add(id);
  await prisma.user.create({ data: { id, role, active: true, isTest: true, name: "Synthetic interview actor", email: `${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  return sign(id);
}
async function company() {
  const owner = await person(), brand = await prisma.brand.create({ data: { userId: owner.user.id, slug: "agent-" + key().replace(/-/g, "").slice(0, 16), name: "Synthetic original company", countryCode: "KW", isTest: true } });
  brands.add(brand.id); return { ...owner, brand, scope: { kind: "OWN_BRAND", brandId: brand.id } as PlanningScope };
}
type Company = Awaited<ReturnType<typeof company>>;
async function agency(customer: Company, nameOriginal: string, capabilities = allCaps, delegated = allCaps) {
  const owner = await person(), seat = await person(), { organization } = await createOrganization(owner.actor, { operationKey: key(), kind: "AGENCY", nameOriginal });
  organizations.add(organization.id);
  const revision = async () => (await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).revision;
  const proposal = await proposeClientAssociation(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), brandId: customer.brand.id });
  const { client } = await authorizeClientAssociation(customer.actor, proposal.client.id, { operationKey: key(), expectedRevision: proposal.client.revision, capabilities: delegated });
  const member = await proposeMember(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), targetUserId: seat.user.id });
  const { membership } = await acceptMembership(seat.actor, member.membership.id, { operationKey: key(), expectedRevision: member.membership.revision });
  const { grant } = await setClientGrant(owner.actor, client.id, { operationKey: key(), expectedClientRevision: client.revision, membershipId: membership.id, expectedGrantRevision: null, capabilities });
  return { owner, seat, organization, client, membership, grant, scope: { kind: "CLIENT", clientId: client.id } as PlanningScope };
}
type Agency = Awaited<ReturnType<typeof agency>>;
const contextContent = BrandContextContentSchema.parse({ schemaVersion: 1, positioning: { text: "  Synthetic original private positioning\nتموضع أصلي  ", language: "ar" }, values: [], tone: { text: "Exact approved original tone", language: "en" }, references: [], competitors: [] });
async function approvedContext(owner: Company, a?: Agency) {
  const actor = a?.seat.actor ?? owner.actor, scope = a?.scope ?? owner.scope;
  const authority = async () => scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(actor, scope.clientId, "plan") } : {};
  const created = await executeBrandContextCommand(actor, { operationKey: key(), scope, ...(await authority()), action: "CREATE", expectedRevision: 0, payload: { nameOriginal: { text: "Synthetic approved interview context", language: "en" }, content: contextContent } });
  const submitted = await executeBrandContextCommand(actor, { operationKey: key(), scope, ...(await authority()), action: "SUBMIT", contextId: created.contextId, expectedRevision: created.revision, payload: {} });
  const approved = await decideContextOwnerReview(owner.actor, { operationKey: key(), submissionId: submitted.submissionId!, expectedRevision: 1, decision: "APPROVE" });
  const version = await getApprovedBrandContextVersion(actor, { scope, versionId: approved.versionId! });
  return { contextId: created.contextId, version: version.version, choice: { kind: "APPROVED_CONTEXT" as const, versionId: version.version.id, contentHash: version.version.contentHash } };
}
async function fresh(actor: OrganizationActor, scope: PlanningScope, fields: unknown = campaignFields, selection: unknown = { kind: "NONE" }) {
  const made = await executeCampaignPlanningCommand(actor, { operationKey: key(), scope, ...(scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(actor, scope.clientId, "plan") } : {}),
    action: "CREATE", expectedCampaignRevision: 0, expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0, payload: { fields, selection, narrative: null } });
  campaigns.add(made.campaignId); return made.campaignId;
}
async function planningStep(actor: OrganizationActor, scope: PlanningScope, campaignId: string, action: string, payload: unknown) {
  const view = await getPlanningCampaign(actor, { scope, campaignId });
  return executeCampaignPlanningCommand(actor, { operationKey: key(), scope, ...(scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(actor, scope.clientId, "plan") } : {}),
    campaignId, action, expectedCampaignRevision: view.campaign.revision, expectedPlanningRevision: view.planning.revision,
    expectedSelectionId: view.planning.selection.id, expectedSelectionRevision: view.planning.selection.revision, payload });
}
async function inputFor(actor: OrganizationActor, scope: PlanningScope, campaignId: string, action: string, payload: unknown, current?: AgentView) {
  const view = current ?? await getCampaignAgent(actor, { scope, campaignId });
  return { operationKey: key(), scope, campaignId, ...(scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(actor, scope.clientId, "plan") } : {}),
    action, expectedAgentRevision: view.retained?.revision ?? 0, expectedSnapshot: view.current.snapshot, payload };
}
async function step(actor: OrganizationActor, scope: PlanningScope, campaignId: string, action: string, payload: unknown) {
  const before = await getCampaignAgent(actor, { scope, campaignId }), input = await inputFor(actor, scope, campaignId, action, payload, before);
  const result = await executeCampaignAgentCommand(actor, input, form);
  expect(result.agentRevision).toBe((before.retained?.revision ?? 0) + 1);
  expect(result.campaignRevision).toBe(before.current.snapshot.campaignRevision + (action === "GENERATE_PROFILE" ? 1 : 0));
  expect(result.planningRevision).toBe(before.current.snapshot.planningRevision + (action === "GENERATE_PROFILE" ? 1 : 0));
  return { before, input, result };
}
const preferences = { input: "TEXT", output: "TEXT" };
async function initialize(actor: OrganizationActor, scope: PlanningScope, campaignId: string) { return step(actor, scope, campaignId, "INITIALIZE", { preferences }); }
function choices(fields: CampaignDraftFields, references?: Array<{ id: string; sourceHash: string }>) {
  return CampaignAgentFieldKeys.map(field => {
    const valueHash = canonicalHash({ domain: "infame-campaign-field-value-v1", field, value: fields[field] });
    return { field, valueHash, source: field === "title" && references ? { kind: "CUSTOMER_TEXT", references } : { kind: "CUSTOMER_FIELD_CHOICE", capturedValueHash: valueHash } };
  });
}
async function confirm(actor: OrganizationActor, scope: PlanningScope, campaignId: string, references?: Array<{ id: string; sourceHash: string }>) {
  const view = await getCampaignAgent(actor, { scope, campaignId });
  return step(actor, scope, campaignId, "CONFIRM_FIELDS", { fields: choices(CampaignFieldsSchema.parse(view.current.fields), references) });
}
async function reject(operation: Promise<unknown>, code: string, status = 409) { await expect(operation).rejects.toMatchObject({ code, status }); }
async function sqlRejected(operation: Promise<unknown>) {
  const error: unknown = await operation.then(() => null, (failure: unknown) => failure);
  expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw new Error("Expected actual immutable SQL rejection");
  expect(error.code).toBe("P2010"); expect(error.meta?.code).toBe("23514");
}
async function raw(campaignId: string) {
  return { campaign: await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } }), planning: await prisma.campaignPlanningState.findUniqueOrThrow({ where: { campaignId } }),
    agent: await stored("CampaignAgent", campaignId), sources: await stored("CampaignAgentTextSource", campaignId), batches: await stored("CampaignAgentConfirmationBatch", campaignId), commands: await stored("CampaignAgentCommand", campaignId),
    briefs: await prisma.campaignBrief.findMany({ where: { campaignId }, orderBy: { id: "asc" } }), provenance: await prisma.campaignBriefProvenance.findMany({ where: { campaignId }, orderBy: { briefId: "asc" } }),
    audits: await prisma.adminAudit.findMany({ where: { resourceType: "Campaign", resourceId: campaignId }, orderBy: { id: "asc" } }),
    events: await prisma.outboxEvent.findMany({ where: { payload: { path: ["aggregateId"], equals: campaignId } }, orderBy: { id: "asc" } }) };
}
function privateSafe(input: unknown, canaries: readonly string[]) { for (const canary of canaries) expect(JSON.stringify(input)).not.toContain(canary); }
async function batch(campaignId: string, id: string) { const rows = await stored("CampaignAgentConfirmationBatch", campaignId); const found = rows.find(item => item.id === id); if (!found) throw new Error("Expected retained synthetic confirmation batch"); return found; }

it("retains OWN original text and independent preferences, requires explicit complete confirmed fields and creates a new unapproved full profile with exact selected provenance", async () => {
  const f = await company(), context = await approvedContext(f);
  const full = CampaignFieldsSchema.parse({ ...campaignFields, title: "  Synthetic reviewed title\nعنوان أصلي  ", impressionsTarget: null, budget: { amountMinor: "9223372036854775807", currencyCode: "KWD" } });
  const campaignId = await fresh(f.actor, f.scope, full, context.choice);
  const absent = await getCampaignAgent(f.actor, { scope: f.scope, campaignId });
  expect(absent.retained).toBeNull(); expect(absent.coverage).toBe("NOT_INITIALIZED");
  expect(await stored("CampaignAgent", campaignId)).toHaveLength(0);
  await reject(getCampaignAgentTextSources(f.actor, { scope: f.scope, campaignId }), "AGENT_REQUIRED");
  await initialize(f.actor, f.scope, campaignId);
  const unavailable = await step(f.actor, f.scope, campaignId, "SET_PREFERENCES", { preferences: { input: "LIVE_VOICE", output: "TEXT_AND_VOICE" } });
  let view = await getCampaignAgent(f.actor, { scope: f.scope, campaignId });
  expect(view.retained?.preferences).toEqual({ input: "LIVE_VOICE", output: "TEXT_AND_VOICE" });
  expect(view.retained?.assistance).toEqual({ kind: "MANUAL_GUIDANCE", agent: "UNAVAILABLE" });
  expect(view.coverage).toBe("UNCONFIRMED");
  expect(unavailable.result.sourceId).toBeNull(); expect(unavailable.result.confirmationBatchId).toBeNull();
  const text = { text: "  Synthetic exact customer words\nكلمات العميل الأصلية  ", language: "ar" };
  const appended = await step(f.actor, f.scope, campaignId, "APPEND_TEXT", { originalText: text });
  const page = await getCampaignAgentTextSources(f.actor, { scope: f.scope, campaignId });
  expect(page.sources).toHaveLength(1); const source = CustomerTextSourceSchema.parse(page.sources[0]);
  expect(source).toMatchObject({ id: appended.result.sourceId, binding: page.binding, authorUserId: f.user.id, originalText: text, kind: "CUSTOMER_TEXT" });
  expect(source.capturedSnapshot).toEqual(appended.before.current.snapshot); expect(page.nextCursor).toBeNull();
  const { sourceHash: oldSourceHash, ...sourceBody } = source; void oldSourceHash;
  const rrBody = { ...sourceBody, id: key(), originalText: { text: "Synthetic valid RR source", language: "en" }, createdAt: new Date().toISOString() };
  const rrSource = CustomerTextSourceSchema.parse({ ...rrBody, sourceHash: canonicalHash({ domain: "infame-customer-text-v1", ...rrBody }) });
  let rrStatementCompleted = false;
  await sqlRejected(prisma.$transaction(async tx => {
    const [settings] = await tx.$queryRaw<Array<{ isolation: string }>>`SELECT current_setting('transaction_isolation') AS isolation`;
    expect(settings?.isolation).toBe("repeatable read");
    await tx.$executeRaw`INSERT INTO "CampaignAgentTextSource" (id,"agentId","campaignId","workspaceId","authorUserId",content,"sourceHash","createdAt")
      VALUES (${rrSource.id},${appended.result.agentId},${campaignId},${page.binding.workspaceId},${f.user.id},${JSON.stringify(rrSource)}::jsonb,${rrSource.sourceHash},${rrSource.createdAt}::timestamp(3))`;
    rrStatementCompleted = true;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
  expect(rrStatementCompleted).toBe(false); expect(await stored("CampaignAgentTextSource", campaignId)).toHaveLength(1);
  const { replayed: resultOnlyFlag, ...receipt } = appended.result; void resultOnlyFlag;
  const producer = (await stored("CampaignAgentCommand", campaignId)).find(item => item.operationKey === appended.input.operationKey)!;
  const beforeBadJournals = await raw(campaignId);
  for (const malformed of [{}, { ...receipt, agentId: key() }, { ...receipt, workspaceId: key() },
    { ...receipt, campaignId: key() }, { ...receipt, action: "GENERATE_PROFILE" }, { ...receipt, agentRevision: 0 },
    { ...receipt, campaignRevision: "1" }, { ...receipt, planningRevision: 0 }, { ...receipt, sourceId: null },
    { ...receipt, confirmationBatchId: key() }, { ...receipt, briefId: key(), briefVersion: null },
    { ...receipt, briefId: null, briefVersion: 1 }, { ...receipt, replayed: false }]) {
    await sqlRejected(prisma.$executeRaw`INSERT INTO "CampaignAgentCommand" (id,"actorUserId","operationKey","agentId","campaignId","workspaceId",action,"payloadHash",result,"createdAt")
      VALUES (${key()},${f.user.id},${key()}::uuid,${appended.result.agentId},${campaignId},${page.binding.workspaceId},${appended.result.action},${String(producer.payloadHash)},${JSON.stringify(malformed)}::jsonb,${new Date().toISOString()}::timestamp(3))`);
  }
  expect(await raw(campaignId)).toEqual(beforeBadJournals);
  const reference = [{ id: source.id, sourceHash: source.sourceHash }];
  view = await getCampaignAgent(f.actor, { scope: f.scope, campaignId });
  const validFields = choices(CampaignFieldsSchema.parse(view.current.fields), reference), completeInput = await inputFor(f.actor, f.scope, campaignId, "CONFIRM_FIELDS", { fields: validFields }, view);
  const beforeBad = await raw(campaignId);
  for (const fields of [validFields.slice(0, -1), [...validFields].reverse(), [validFields[0]!, ...validFields.slice(0, -1)],
    validFields.map((item, i) => i === 0 ? { ...item, valueHash: "a".repeat(64) } : item),
    validFields.map(item => item.field === "title" ? { ...item, source: { kind: "CUSTOMER_TEXT", references: [{ id: source.id, sourceHash: "b".repeat(64) }] } } : item)]) {
    await reject(executeCampaignAgentCommand(f.actor, { ...completeInput, operationKey: key(), payload: { fields } }, form), "VALIDATION", 422);
  }
  await reject(executeCampaignAgentCommand(f.actor, completeInput, { channel: "AGENT_TOOL" }), "VALIDATION", 422);
  await reject(executeCampaignAgentCommand(f.actor, { ...completeInput, channel: "FORM" }, form), "VALIDATION", 422);
  expect(await raw(campaignId)).toEqual(beforeBad);
  const confirmed = await executeCampaignAgentCommand(f.actor, completeInput, form), retainedBatch = await batch(campaignId, confirmed.confirmationBatchId!);
  const envelope = retainedBatch.content as { id: string; agentId: string; binding: unknown; reviewedSnapshot: unknown; confirmedByUserId: string; confirmedAt: string; confirmations: unknown[]; contentHash: string };
  expect(envelope).toMatchObject({ id: confirmed.confirmationBatchId, agentId: confirmed.agentId, binding: page.binding,
    reviewedSnapshot: view.current.snapshot, confirmedByUserId: f.user.id });
  expect(envelope.confirmations).toHaveLength(30);
  const confirmations = envelope.confirmations.map(item => FieldConfirmationSchema.parse(item));
  expect(confirmations.map(item => item.field)).toEqual(Object.keys(CampaignFieldObjectSchema.shape));
  for (const item of confirmations) expect(item).toMatchObject({ binding: page.binding, confirmationBatchId: envelope.id,
    reviewedSnapshot: view.current.snapshot, confirmedByUserId: f.user.id, confirmedAt: envelope.confirmedAt,
    value: full[item.field] });
  const { contentHash, ...batchBody } = envelope;
  expect(contentHash).toBe(canonicalHash({ domain: "infame-campaign-confirmation-batch-v1", ...batchBody }));
  expect(retainedBatch.contentHash).toBe(contentHash);
  view = await getCampaignAgent(f.actor, { scope: f.scope, campaignId }); expect(view.coverage).toBe("CURRENT");
  expect(CampaignAgentStateSchema.parse(view.retained).confirmation.kind).toBe("REVIEWED_SET");
  await step(f.actor, f.scope, campaignId, "SET_PREFERENCES", { preferences: { input: "MEDIA", output: "VOICE" } });
  expect((await getCampaignAgent(f.actor, { scope: f.scope, campaignId })).coverage).toBe("CURRENT");
  const first = await step(f.actor, f.scope, campaignId, "GENERATE_PROFILE", { confirmationBatchId: envelope.id });
  const created = await prisma.campaignBrief.findUniqueOrThrow({ where: { id: first.result.briefId! } });
  expect(created.version).toBe(first.result.briefVersion); expect(created.approvedAt).toBeNull(); expect(created.approvedByUserId).toBeNull();
  expect((created.content as { requirements: unknown }).requirements).toEqual({ ...full, campaignId, version: created.version, brandCountryCode: "KW", mandatoryPolicyVersionIds: [] });
  expect(await prisma.campaignBriefProvenance.findUniqueOrThrow({ where: { briefId: created.id } })).toMatchObject({ campaignId,
    workspaceId: page.binding.workspaceId, selectionId: first.before.current.snapshot.selection.id, selectionRevision: first.before.current.snapshot.selection.revision });
  view = await getCampaignAgent(f.actor, { scope: f.scope, campaignId }); expect(view.coverage).toBe("UNCONFIRMED");
  expect(view.retained?.confirmation).toEqual({ kind: "UNCONFIRMED" }); expect(await batch(campaignId, envelope.id)).toEqual(retainedBatch);
  expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).currentBriefVersion).toBeNull();
  await reject(executeCampaignAgentCommand(f.actor, await inputFor(f.actor, f.scope, campaignId, "GENERATE_PROFILE", { confirmationBatchId: envelope.id }), form), "STALE_CONFIRMATION");
  const secondBatch = await confirm(f.actor, f.scope, campaignId, reference), second = await step(f.actor, f.scope, campaignId, "GENERATE_PROFILE", { confirmationBatchId: secondBatch.result.confirmationBatchId });
  expect(second.result.briefId).not.toBe(first.result.briefId); expect(second.result.briefVersion).toBe(created.version + 1);
  // Central-valid fields fit their64KiB limit; the actual full brief envelope
  // adds enough required metadata to overflow its separate64KiB submission cap.
  const nearLimit = { ...full, productService: "汉".repeat(5000), summary: "汉".repeat(5000), usageRights: "汉".repeat(5000), assumptions: [] as string[], openQuestions: [] as string[] };
  const fieldBytes = () => new TextEncoder().encode(JSON.stringify(nearLimit)).byteLength;
  for (const list of [nearLimit.assumptions, nearLimit.openQuestions]) {
    while (list.length < 30 && fieldBytes() < 65480) {
      const length = Math.min(500, 65480 - fieldBytes() - 3); if (length < 1) break;
      list.push("x".repeat(length));
    }
  }
  const boundedFields = CampaignFieldsSchema.parse(nearLimit);
  expect(fieldBytes()).toBeLessThanOrEqual(65536); expect(fieldBytes()).toBeGreaterThan(65400);
  const overflowId = await fresh(f.actor, f.scope, boundedFields); await initialize(f.actor, f.scope, overflowId);
  const wrapped = CampaignBriefContentSchema.parse({ schemaVersion: 1, requirements: { ...boundedFields, campaignId: overflowId,
    version: 1, brandCountryCode: "KW", mandatoryPolicyVersionIds: [] }, approvedByUserId: null, inputRevision: 1, policyReview: null });
  expect(new TextEncoder().encode(JSON.stringify(wrapped)).byteLength).toBeGreaterThan(65536);
  const overflowBatch = await confirm(f.actor, f.scope, overflowId), beforeOverflow = await raw(overflowId);
  await reject(executeCampaignAgentCommand(f.actor, await inputFor(f.actor, f.scope, overflowId, "GENERATE_PROFILE", { confirmationBatchId: overflowBatch.result.confirmationBatchId }), form), "SNAPSHOT_TOO_LARGE", 422);
  expect(await raw(overflowId)).toEqual(beforeOverflow);
  const incomplete = await fresh(f.actor, f.scope, {}); await initialize(f.actor, f.scope, incomplete);
  const noFacts = await getCampaignAgent(f.actor, { scope: f.scope, campaignId: incomplete });
  expect(Object.keys(noFacts.current.fields)).toEqual(["desiredCreatorCount"]); expect(noFacts.coverage).toBe("UNCONFIRMED");
  const defaultChoices = choices(full).map(item => item.field === "desiredCreatorCount" ? { ...item, valueHash: canonicalHash({ domain: "infame-campaign-field-value-v1", field: item.field, value: 1 }), source: { kind: "CUSTOMER_FIELD_CHOICE", capturedValueHash: canonicalHash({ domain: "infame-campaign-field-value-v1", field: item.field, value: 1 }) } } : item);
  await reject(executeCampaignAgentCommand(f.actor, await inputFor(f.actor, f.scope, incomplete, "CONFIRM_FIELDS", { fields: defaultChoices }), form), "MISSING_REQUIREMENTS", 422);
  await reject(executeCampaignAgentCommand(f.actor, await inputFor(f.actor, f.scope, incomplete, "GENERATE_PROFILE", { confirmationBatchId: key() }), form), "CONFIRMATION_REQUIRED");
  const effect = await raw(campaignId);
  for (const command of effect.commands) { privateSafe(command.result, [text.text, "confirmedByUserId", "content", "stateHash", "replayed"]); expect((command.result as { replayed?: boolean }).replayed).toBeUndefined(); }
  privateSafe(effect.audits.map(item => item.snapshot), [text.text, f.token, f.actor.sessionId]);
  privateSafe(effect.events.map(item => item.payload), [text.text, f.token, f.actor.sessionId]);
}, 90000);

it("keeps OWN and two CLIENT interviews for one Brand private, checks current native view plus plan and leaves brief approval solely with the actual owner", async () => {
  const customer = await company(), a = await agency(customer, "Synthetic agent agency A"), b = await agency(customer, "Synthetic agent agency B");
  const own = await fresh(customer.actor, customer.scope), ca = await fresh(a.seat.actor, a.scope), cb = await fresh(b.seat.actor, b.scope);
  for (const [actor, scope, id] of [[customer.actor, customer.scope, own], [a.seat.actor, a.scope, ca], [b.seat.actor, b.scope, cb]] as const) await initialize(actor, scope, id);
  const ownWords = "Synthetic OWN interview canary", aWords = "Synthetic CLIENT A private words", bWords = "Synthetic CLIENT B private words";
  await step(customer.actor, customer.scope, own, "APPEND_TEXT", { originalText: { text: ownWords, language: "en" } });
  await step(a.seat.actor, a.scope, ca, "APPEND_TEXT", { originalText: { text: aWords, language: "en" } });
  await step(b.seat.actor, b.scope, cb, "APPEND_TEXT", { originalText: { text: bWords, language: "en" } });
  const ownView = await getCampaignAgent(customer.actor, { scope: customer.scope, campaignId: own });
  const aView = await getCampaignAgent(a.seat.actor, { scope: a.scope, campaignId: ca }), bView = await getCampaignAgent(b.seat.actor, { scope: b.scope, campaignId: cb });
  expect(new Set([ownView.binding.workspaceId, aView.binding.workspaceId, bView.binding.workspaceId]).size).toBe(3);
  const aPage = await getCampaignAgentTextSources(a.seat.actor, { scope: a.scope, campaignId: ca }); privateSafe(aPage, [ownWords, bWords]);
  for (const [actor, scope, id] of [[customer.actor, customer.scope, ca], [a.seat.actor, a.scope, own], [a.seat.actor, a.scope, cb], [b.seat.actor, b.scope, ca]] as const) {
    await reject(getCampaignAgent(actor, { scope, campaignId: id }), "NOT_FOUND", 404);
    await reject(getCampaignAgentTextSources(actor, { scope, campaignId: id }), "NOT_FOUND", 404);
  }
  await reject(getCampaignAgentTextSources(b.seat.actor, { scope: b.scope, campaignId: cb, after: aPage.sources[0]!.id }), "NOT_FOUND", 404);
  const foreignRef = [{ id: aPage.sources[0]!.id, sourceHash: aPage.sources[0]!.sourceHash }];
  const foreignCommand = await inputFor(b.seat.actor, b.scope, cb, "CONFIRM_FIELDS", { fields: choices(CampaignFieldsSchema.parse(bView.current.fields), foreignRef) });
  const sqlOnly: string[] = [], queryClient = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  queryClient.$on("query", event => { sqlOnly.push(event.query); }); // Never record event.params.
  const foreignScopeViolations: Array<{ table: string; missingPredicates: string[] }> = [];
  function inspectPrivateHydration(table: "CampaignAgentTextSource" | "CampaignAgentConfirmationBatch" | "CampaignBrief", requireContent = true) {
    const contentReads = sqlOnly.filter(query => /^\s*SELECT\b/i.test(query) && query.includes('"' + table + '"')
      && (query.includes('"content"') || /\bSELECT\s+\*/i.test(query)));
    expect(sqlOnly.length).toBeGreaterThan(0); // Actual engine reads, not source-code assertions.
    if (requireContent) expect(contentReads.length).toBeGreaterThan(0);
    for (const query of contentReads) {
      const where = query.split(/\bWHERE\b/i).slice(1).join(" WHERE ");
      const required = table === "CampaignBrief" ? ["id", "campaignId", "version"] : ["id", "agentId", "campaignId", "workspaceId"];
      const missingPredicates = required.filter(column => !new RegExp('"' + column + '"\\s*=\\s*\\$[0-9]+').test(where));
      if (missingPredicates.length) foreignScopeViolations.push({ table, missingPredicates });
    }
  }
  const beforeForeign = await raw(cb);
  try {
    await reject(executeCampaignAgentCommand(b.seat.actor, foreignCommand, { channel: "FORM", client: queryClient }), "VALIDATION", 422);
    expect(await raw(cb)).toEqual(beforeForeign);
    inspectPrivateHydration("CampaignAgentTextSource");
    // B has a genuine current review, so GENERATE reaches the supplied batch
    // lookup. A's complete private batch belongs to another CLIENT workspace.
    const foreignBatch = await confirm(a.seat.actor, a.scope, ca);
    await confirm(b.seat.actor, b.scope, cb);
    const foreignBatchCommand = await inputFor(b.seat.actor, b.scope, cb, "GENERATE_PROFILE", { confirmationBatchId: foreignBatch.result.confirmationBatchId });
    const beforeForeignBatch = await raw(cb); sqlOnly.length = 0;
    await reject(executeCampaignAgentCommand(b.seat.actor, foreignBatchCommand, { channel: "FORM", client: queryClient }), "INVALID_STORED_AGENT", 503);
    expect(await raw(cb)).toEqual(beforeForeignBatch);
    inspectPrivateHydration("CampaignAgentConfirmationBatch");
    expect(foreignScopeViolations).toEqual([]);
  } finally { sqlOnly.length = 0; await queryClient.$disconnect(); }
  const context = await approvedContext(customer, a); await planningStep(a.seat.actor, a.scope, ca, "SET_SELECTION", { selection: context.choice });
  const batchA = await confirm(a.seat.actor, a.scope, ca), profile = await step(a.seat.actor, a.scope, ca, "GENERATE_PROFILE", { confirmationBatchId: batchA.result.confirmationBatchId });
  const batchB = await confirm(b.seat.actor, b.scope, cb), privateProfileB = await step(b.seat.actor, b.scope, cb, "GENERATE_PROFILE", { confirmationBatchId: batchB.result.confirmationBatchId });
  const foreignProfileCommand = CampaignAgentCommandSchema.parse({ ...profile.input, operationKey: key() });
  const { replayed: onlyProfileResult, ...profileReceipt } = profile.result; void onlyProfileResult;
  const substitutedProfileReceipt = CampaignAgentReceiptSchema.parse({ ...profileReceipt,
    briefId: privateProfileB.result.briefId, briefVersion: privateProfileB.result.briefVersion });
  const actualProfileCommand = (await stored("CampaignAgentCommand", ca)).find(item => item.operationKey === profile.input.operationKey)!;
  const foreignProfileHash = canonicalHash({ domain: "infame-campaign-agent-command-v1", actorUserId: a.seat.user.id, command: foreignProfileCommand });
  await prisma.$executeRaw`INSERT INTO "CampaignAgentCommand" (id,"actorUserId","operationKey","agentId","campaignId","workspaceId",action,"payloadHash",result,"createdAt")
    VALUES (${key()},${a.seat.user.id},${foreignProfileCommand.operationKey}::uuid,${profile.result.agentId},${ca},${profile.result.workspaceId},${profile.result.action},${foreignProfileHash},${JSON.stringify(substitutedProfileReceipt)}::jsonb,${(actualProfileCommand.createdAt as Date).toISOString()}::timestamp(3))`;
  const beforeForeignProfile = await raw(ca), beforePrivateProfile = await raw(cb);
  const profileQueryClient = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  profileQueryClient.$on("query", event => { sqlOnly.push(event.query); }); // SQL only; never event.params.
  try {
    sqlOnly.length = 0;
    await reject(executeCampaignAgentCommand(a.seat.actor, foreignProfileCommand, { channel: "FORM", client: profileQueryClient }), "INVALID_STORED_AGENT", 503);
    expect(await raw(ca)).toEqual(beforeForeignProfile); expect(await raw(cb)).toEqual(beforePrivateProfile);
    // Metadata-first denial can avoid this SELECT completely. Any content
    // hydration that does run must restrict the full native brief identity.
    inspectPrivateHydration("CampaignBrief", false);
    expect(foreignScopeViolations).toEqual([]);
  } finally { sqlOnly.length = 0; await profileQueryClient.$disconnect(); }
  expect((await prisma.campaignBrief.findUniqueOrThrow({ where: { id: profile.result.briefId! } })).approvedAt).toBeNull();
  const submitted = await planningStep(a.seat.actor, a.scope, ca, "SUBMIT_BRIEF", { briefId: profile.result.briefId, expectedBriefVersion: profile.result.briefVersion });
  await reject(decideCampaignOwnerReview(a.seat.actor, { operationKey: key(), submissionId: submitted.submissionId, expectedRevision: 1, decision: "APPROVE" }), "NOT_FOUND", 404);
  const approved = await decideCampaignOwnerReview(customer.actor, { operationKey: key(), submissionId: submitted.submissionId, expectedRevision: 1, decision: "APPROVE" });
  expect(approved.state).toBe("APPROVED"); expect((await prisma.campaignBrief.findUniqueOrThrow({ where: { id: profile.result.briefId! } })).approvedByUserId).toBe(customer.user.id);
  // Commands already read valid fields before the scope loses view. Capture them
  // first, then remove only view while retaining plan; no fake actor is used.
  const aCurrent = await getCampaignAgent(a.seat.actor, { scope: a.scope, campaignId: ca });
  const deniedCommand = await inputFor(a.seat.actor, a.scope, ca, "CONFIRM_FIELDS", { fields: choices(CampaignFieldsSchema.parse(aCurrent.current.fields)) }, aCurrent);
  await prisma.clientGrant.update({ where: { id: a.grant.id }, data: { view: false, revision: { increment: 1 } } });
  const actualPlan = await getClientAuthority(a.seat.actor, a.client.id, "plan");
  // A real owned malformed private draft is a hydration trap. An implementation
  // that loads/parses Campaign.input before checking view would return503.
  await prisma.campaign.update({ where: { id: ca }, data: { input: { syntheticPrivateHydrationTrap: aWords } } });
  const beforeDeny = await raw(ca);
  await reject(getCampaignAgent(a.seat.actor, { scope: a.scope, campaignId: ca }), "NOT_FOUND", 404);
  await reject(getCampaignAgentTextSources(a.seat.actor, { scope: a.scope, campaignId: ca }), "NOT_FOUND", 404);
  await reject(executeCampaignAgentCommand(a.seat.actor, { ...deniedCommand, expectedAuthority: actualPlan }, form), "NOT_FOUND", 404);
  expect(await raw(ca)).toEqual(beforeDeny);
  const bCurrent = await getCampaignAgent(b.seat.actor, { scope: b.scope, campaignId: cb });
  const delegationCommand = await inputFor(b.seat.actor, b.scope, cb, "CONFIRM_FIELDS", { fields: choices(CampaignFieldsSchema.parse(bCurrent.current.fields)) }, bCurrent);
  await prisma.organizationClient.update({ where: { id: b.client.id }, data: { allowedCapabilities: { ...allCaps, view: false }, revision: { increment: 1 } } });
  await prisma.campaign.update({ where: { id: cb }, data: { input: { syntheticPrivateHydrationTrap: bWords } } });
  await reject(executeCampaignAgentCommand(b.seat.actor, { ...delegationCommand, expectedAuthority: await getClientAuthority(b.seat.actor, b.client.id, "plan") }, form), "NOT_FOUND", 404);
  await reject(getCampaignAgent(b.seat.actor, { scope: b.scope, campaignId: cb }), "NOT_FOUND", 404);
  await reject(getCampaignAgentTextSources(b.seat.actor, { scope: b.scope, campaignId: cb }), "NOT_FOUND", 404);
  const creator = await person("CREATOR"), admin = await person("ADMIN");
  for (const actor of [creator.actor, admin.actor]) await reject(executeCampaignAgentCommand(actor, { malformed: true }, { channel: "AGENT_TOOL" }), "FORBIDDEN", 403);
  const oldOwnerCommand = await inputFor(customer.actor, customer.scope, own, "SET_PREFERENCES", { preferences });
  const replacement = await person(); await prisma.brand.update({ where: { id: customer.brand.id }, data: { userId: replacement.user.id } });
  await reject(getCampaignAgent(customer.actor, { scope: customer.scope, campaignId: own }), "NOT_FOUND", 404);
  await reject(getCampaignAgent(a.seat.actor, { scope: a.scope, campaignId: ca }), "NOT_FOUND", 404);
  await reject(executeCampaignAgentCommand(customer.actor, oldOwnerCommand, form), "NOT_FOUND", 404);
}, 90000);

function latch<T>() { let resolve!: (value: T | PromiseLike<T>) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
type WaitTable = "User" | "ClientGrant" | "OrganizationClient" | "Brand" | "CampaignAgentCommand";
async function blocker(table: WaitTable, id: string | null, after?: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  const peer = new PrismaClient(), monitor = new PrismaClient(), ready = latch<number>(), release = latch<void>(), stop = new AbortController();
  const holding = peer.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout='4s'`;
    if (table === "CampaignAgentCommand") await tx.$executeRaw`LOCK TABLE "CampaignAgentCommand" IN SHARE MODE`;
    else await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw('"' + table + '"')} WHERE id=${id} FOR UPDATE`);
    const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
    ready.resolve(pid!); await release.promise; if (after) await after(tx);
  }, { maxWait: 5000, timeout: 12000 }); void holding.catch(() => {});
  let pid: number;
  try { pid = await Promise.race([ready.promise, holding.then(() => { throw new Error("Interview blocker ended before native lock"); })]); }
  catch (error) { release.resolve(); await holding.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); throw error; }
  let observed: Promise<number> | undefined;
  return { holding, release: () => release.resolve(), wait() { observed = (async () => {
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline) {
      if (stop.signal.aborted) throw new Error("Interview native wait observer cancelled");
      const rows = await monitor.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'
        AND ${pid}=ANY(pg_blocking_pids(pid)) AND query LIKE ${`%"${table}"%`} AND (${table} <> 'CampaignAgentCommand' OR query ILIKE '%INSERT%')`;
      if (rows.length) return rows[0]!.pid; await delay(20);
    }
    throw new Error("Interview command never reached its actual native wait");
  })(); return observed; }, async close() { release.resolve(); stop.abort(); await holding.catch(() => {}); await observed?.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); } };
}
async function allSources(actor: OrganizationActor, scope: PlanningScope, campaignId: string) {
  const sources: SourcePage["sources"] = [], cursors = new Set<string>(); let after: string | undefined;
  for (;;) {
    const page = await getCampaignAgentTextSources(actor, { scope, campaignId, ...(after ? { after } : {}) });
    expect(page.sources.length).toBeLessThanOrEqual(20); expect(new TextEncoder().encode(JSON.stringify(page)).byteLength).toBeLessThanOrEqual(262144);
    for (const item of page.sources) { CustomerTextSourceSchema.parse(item); expect(after === undefined || item.id > after).toBe(true); }
    sources.push(...page.sources); if (page.nextCursor === null) return sources;
    expect(page.sources.length).toBeGreaterThan(0); expect(page.nextCursor).toBe(page.sources.at(-1)!.id); expect(cursors.has(page.nextCursor)).toBe(false);
    cursors.add(page.nextCursor); after = page.nextCursor;
  }
}

it("serializes exact replay and one batch winner, rejects ABA/missing or corrupt lineage, pages real words and rolls back every effect after native authorization waits or expiry", async () => {
  const f = await company(), context = await approvedContext(f), campaignId = await fresh(f.actor, f.scope, campaignFields, context.choice);
  const initialized = await initialize(f.actor, f.scope, campaignId), beforeReplay = await raw(campaignId);
  expect(await executeCampaignAgentCommand(f.actor, initialized.input, form)).toEqual({ ...initialized.result, replayed: true }); expect(await raw(campaignId)).toEqual(beforeReplay);
  await reject(executeCampaignAgentCommand(f.actor, { ...initialized.input, payload: { preferences: { input: "TEXT", output: "VOICE" } } }, form), "OPERATION_KEY_REUSED");
  const text = { text: "Synthetic retained source before concurrency", language: "en" };
  const appended = await step(f.actor, f.scope, campaignId, "APPEND_TEXT", { originalText: text }), beforeAppendReplay = await raw(campaignId);
  expect(await executeCampaignAgentCommand(f.actor, appended.input, form)).toEqual({ ...appended.result, replayed: true }); expect(await raw(campaignId)).toEqual(beforeAppendReplay);
  // Native producers supply valid rows, but an immutable structural journal can
  // still join the wrong same-agent source/batch/brief. Recomputing the exact
  // command hash must not make those substituted producer joins trustworthy.
  const joinId = await fresh(f.actor, f.scope, campaignFields, context.choice); await initialize(f.actor, f.scope, joinId);
  const joinTextA = await step(f.actor, f.scope, joinId, "APPEND_TEXT", { originalText: { text: "Synthetic actual producer words A", language: "en" } });
  const joinTextB = await step(f.actor, f.scope, joinId, "APPEND_TEXT", { originalText: { text: "Synthetic different actual producer words B", language: "ar" } });
  const joinSources = await getCampaignAgentTextSources(f.actor, { scope: f.scope, campaignId: joinId });
  const joinSourceA = joinSources.sources.find(item => item.id === joinTextA.result.sourceId)!, joinSourceB = joinSources.sources.find(item => item.id === joinTextB.result.sourceId)!;
  expect(joinSourceA.originalText).not.toEqual(joinSourceB.originalText);
  const joinBatchA = await confirm(f.actor, f.scope, joinId, [{ id: joinSourceA.id, sourceHash: joinSourceA.sourceHash }]);
  const joinBatchB = await confirm(f.actor, f.scope, joinId, [{ id: joinSourceB.id, sourceHash: joinSourceB.sourceHash }]);
  const joinProfileA = await step(f.actor, f.scope, joinId, "GENERATE_PROFILE", { confirmationBatchId: joinBatchB.result.confirmationBatchId });
  const profileReplayBefore = await raw(joinId);
  expect(await executeCampaignAgentCommand(f.actor, joinProfileA.input, form)).toEqual({ ...joinProfileA.result, replayed: true });
  expect(await raw(joinId)).toEqual(profileReplayBefore);
  await planningStep(f.actor, f.scope, joinId, "UPDATE_FIELDS", { patch: { title: "Synthetic different actual profile field epoch" } });
  const joinBatchC = await confirm(f.actor, f.scope, joinId), joinProfileC = await step(f.actor, f.scope, joinId, "GENERATE_PROFILE", { confirmationBatchId: joinBatchC.result.confirmationBatchId });
  const briefA = await prisma.campaignBrief.findUniqueOrThrow({ where: { id: joinProfileA.result.briefId! } });
  const briefC = await prisma.campaignBrief.findUniqueOrThrow({ where: { id: joinProfileC.result.briefId! } });
  expect(briefC.inputRevision).not.toBe(briefA.inputRevision);
  expect((briefC.content as { requirements: { title: string } }).requirements.title).not.toBe((briefA.content as { requirements: { title: string } }).requirements.title);
  const joinPreference = await step(f.actor, f.scope, joinId, "SET_PREFERENCES", { preferences });
  type Produced = Awaited<ReturnType<typeof step>>;
  type ScalarReceipt = ReturnType<typeof CampaignAgentReceiptSchema.parse>;
  const forged: Array<{ label: string; actor: OrganizationActor; command: ReturnType<typeof CampaignAgentCommandSchema.parse> }> = [];
  async function forgeReplay(label: string, actor: OrganizationActor, produced: Produced, substitution: Partial<ScalarReceipt>, commandChanges: Record<string, unknown> = {}) {
    const command = CampaignAgentCommandSchema.parse({ ...produced.input, ...commandChanges, operationKey: key() });
    const { replayed: onlyResult, ...actual } = produced.result; void onlyResult;
    const receipt = CampaignAgentReceiptSchema.parse({ ...actual, ...substitution, action: command.action,
      agentRevision: command.expectedAgentRevision + 1,
      campaignRevision: command.expectedSnapshot.campaignRevision + (command.action === "GENERATE_PROFILE" ? 1 : 0),
      planningRevision: command.expectedSnapshot.planningRevision + (command.action === "GENERATE_PROFILE" ? 1 : 0) });
    const producer = (await stored("CampaignAgentCommand", command.campaignId)).find(item => item.operationKey === produced.input.operationKey)!;
    const createdAt = (producer.createdAt as Date).toISOString();
    const payloadHash = canonicalHash({ domain: "infame-campaign-agent-command-v1", actorUserId: actor.userId, command });
    await prisma.$executeRaw`INSERT INTO "CampaignAgentCommand" (id,"actorUserId","operationKey","agentId","campaignId","workspaceId",action,"payloadHash",result,"createdAt")
      VALUES (${key()},${actor.userId},${command.operationKey}::uuid,${receipt.agentId},${receipt.campaignId},${receipt.workspaceId},${receipt.action},${payloadHash},${JSON.stringify(receipt)}::jsonb,${createdAt}::timestamp(3))`;
    forged.push({ label, actor, command });
  }
  await forgeReplay("APPEND joins another valid same-agent text", f.actor, joinTextA, { sourceId: joinSourceB.id });
  await forgeReplay("CONFIRM joins different original source choices", f.actor, joinBatchA, { confirmationBatchId: joinBatchB.result.confirmationBatchId });
  await forgeReplay("CONFIRM joins a different historical snapshot", f.actor, joinBatchA, { confirmationBatchId: joinBatchC.result.confirmationBatchId });
  await forgeReplay("GENERATE receipt batch differs from command batch", f.actor, joinProfileA, { confirmationBatchId: joinBatchA.result.confirmationBatchId });
  await forgeReplay("GENERATE joins another actual brief field/input epoch", f.actor, joinProfileA, { briefId: joinProfileC.result.briefId, briefVersion: joinProfileC.result.briefVersion });
  const joinCurrent = await getCampaignAgent(f.actor, { scope: f.scope, campaignId: joinId });
  await forgeReplay("SET_PREFERENCES counter lies beyond the actual horizon", f.actor, joinPreference, {}, { expectedAgentRevision: joinCurrent.retained!.revision + 10 });
  // Two genuinely accepted members hold view+plan in this exact CLIENT scope.
  // A batch authored by the second member cannot stand in for the first's click.
  const joinAgency = await agency(f, "Synthetic two-member replay authority"), otherSeat = await person();
  const organizationRevision = (await prisma.organization.findUniqueOrThrow({ where: { id: joinAgency.organization.id } })).revision;
  const invitation = await proposeMember(joinAgency.owner.actor, joinAgency.organization.id, { operationKey: key(), expectedOrganizationRevision: organizationRevision, targetUserId: otherSeat.user.id });
  const accepted = await acceptMembership(otherSeat.actor, invitation.membership.id, { operationKey: key(), expectedRevision: invitation.membership.revision });
  const clientRevision = (await prisma.organizationClient.findUniqueOrThrow({ where: { id: joinAgency.client.id } })).revision;
  await setClientGrant(joinAgency.owner.actor, joinAgency.client.id, { operationKey: key(), expectedClientRevision: clientRevision, membershipId: accepted.membership.id, expectedGrantRevision: null, capabilities: allCaps });
  const sharedId = await fresh(joinAgency.seat.actor, joinAgency.scope); await initialize(joinAgency.seat.actor, joinAgency.scope, sharedId);
  const firstMemberBatch = await confirm(joinAgency.seat.actor, joinAgency.scope, sharedId), secondMemberBatch = await confirm(otherSeat.actor, joinAgency.scope, sharedId);
  expect((await batch(sharedId, firstMemberBatch.result.confirmationBatchId!)).confirmedByUserId).toBe(joinAgency.seat.user.id);
  expect((await batch(sharedId, secondMemberBatch.result.confirmationBatchId!)).confirmedByUserId).toBe(otherSeat.user.id);
  await forgeReplay("CONFIRM joins another actually authorized confirmer", joinAgency.seat.actor, firstMemberBatch, { confirmationBatchId: secondMemberBatch.result.confirmationBatchId });
  const beforeForged = new Map([[joinId, await raw(joinId)], [sharedId, await raw(sharedId)]]);
  const joins = await Promise.allSettled(forged.map(item => executeCampaignAgentCommand(item.actor, item.command, form)));
  for (const [id, before] of beforeForged) expect(await raw(id)).toEqual(before);
  expect(joins.map((outcome, index) => ({ label: forged[index]!.label,
    code: outcome.status === "rejected" ? (outcome.reason as { code?: unknown }).code : "ACCEPTED",
    status: outcome.status === "rejected" ? (outcome.reason as { status?: unknown }).status : 0 }))).toEqual(
    forged.map(item => ({ label: item.label, code: "INVALID_STORED_AGENT", status: 503 })));
  // Independent connections replay one and the same confirmed customer click.
  const sameKeyId = await fresh(f.actor, f.scope); await initialize(f.actor, f.scope, sameKeyId);
  const sameKeyView = await getCampaignAgent(f.actor, { scope: f.scope, campaignId: sameKeyId });
  const sameKeyInput = await inputFor(f.actor, f.scope, sameKeyId, "CONFIRM_FIELDS", { fields: choices(CampaignFieldsSchema.parse(sameKeyView.current.fields)) }, sameKeyView);
  const beforeSameKey = await raw(sameKeyId), sameKeyPeer = new PrismaClient();
  try {
    const replies = await Promise.all([executeCampaignAgentCommand(f.actor, sameKeyInput, form), executeCampaignAgentCommand(f.actor, sameKeyInput, { channel: "FORM", client: sameKeyPeer })]);
    expect(replies.map(item => item.replayed).sort()).toEqual([false, true]);
    const { replayed: firstReplay, ...firstReply } = replies[0]!; const { replayed: secondReplay, ...secondReply } = replies[1]!; void firstReplay; void secondReplay;
    expect(firstReply).toEqual(secondReply);
    const afterSameKey = await raw(sameKeyId);
    for (const field of ["batches", "commands", "audits", "events"] as const) expect(afterSameKey[field].length).toBe(beforeSameKey[field].length + 1);
    expect(afterSameKey.sources).toEqual(beforeSameKey.sources);
  } finally { await sameKeyPeer.$disconnect(); }
  // Lifetime protection must be a native child-row lock, not only a snapshot
  // read/hash. Both task-owned DELETEs remain blocked on this exact generation
  // writer while it waits at its real journal INSERT; they may finish afterward.
  const lifetimeId = await fresh(f.actor, f.scope); await initialize(f.actor, f.scope, lifetimeId);
  const lifetimeText = await step(f.actor, f.scope, lifetimeId, "APPEND_TEXT", { originalText: { text: "Synthetic generation child lifetime", language: "en" } });
  const lifetimePage = await getCampaignAgentTextSources(f.actor, { scope: f.scope, campaignId: lifetimeId });
  const lifetimeSource = lifetimePage.sources.find(item => item.id === lifetimeText.result.sourceId)!;
  const lifetimeBatch = await confirm(f.actor, f.scope, lifetimeId, [{ id: lifetimeSource.id, sourceHash: lifetimeSource.sourceHash }]);
  const lifetimeInput = await inputFor(f.actor, f.scope, lifetimeId, "GENERATE_PROFILE", { confirmationBatchId: lifetimeBatch.result.confirmationBatchId });
  const lifetimeHolder = await blocker("CampaignAgentCommand", null), lifetimeMonitor = new PrismaClient(), lifetimeStop = new AbortController();
  const lifetimeWaits: Array<Promise<number>> = [];
  const lifetimeWriting = executeCampaignAgentCommand(f.actor, lifetimeInput, form); void lifetimeWriting.catch(() => {});
  type LifetimeTable = "CampaignAgentTextSource" | "CampaignAgentConfirmationBatch";
  async function lifetimeDelete(table: LifetimeTable, id: string) {
    const client = new PrismaClient(), ready = latch<number>();
    const result = client.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout='7s'`;
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`; ready.resolve(pid!);
      return tx.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE id=${id} AND "campaignId"=${lifetimeId}`);
    }, { maxWait: 5000, timeout: 15000 }); void result.catch(() => {});
    try {
      const pid = await Promise.race([ready.promise, result.then(() => { throw new Error("Lifetime DELETE ended before its native PID capture"); })]);
      return { pid, result, async close() { await result.catch(() => {}); await client.$disconnect(); } };
    } catch (error) { await result.catch(() => {}); await client.$disconnect(); throw error; }
  }
  async function childWait(table: LifetimeTable, waitingPid: number, writerPid: number) {
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline) {
      if (lifetimeStop.signal.aborted) throw new Error("Lifetime child wait observer cancelled");
      const waiting = await lifetimeMonitor.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
        AND pid=${waitingPid} AND wait_event_type='Lock' AND ${writerPid}=ANY(pg_blocking_pids(pid)) AND query LIKE ${'%"' + table + '"%'} AND query ILIKE '%DELETE%'`;
      if (waiting.length === 1) return waiting[0]!.pid; await delay(20);
    }
    throw new Error("Referenced child DELETE did not block on the actual generation writer");
  }
  let deletingSource: Awaited<ReturnType<typeof lifetimeDelete>> | undefined, deletingBatch: Awaited<ReturnType<typeof lifetimeDelete>> | undefined;
  try {
    const writerPid = await Promise.race([lifetimeHolder.wait(), lifetimeWriting.then(() => { throw new Error("Generation ended before its native journal wait"); })]);
    deletingSource = await lifetimeDelete("CampaignAgentTextSource", lifetimeSource.id);
    deletingBatch = await lifetimeDelete("CampaignAgentConfirmationBatch", lifetimeBatch.result.confirmationBatchId!);
    for (const [table, deleting] of [["CampaignAgentTextSource", deletingSource], ["CampaignAgentConfirmationBatch", deletingBatch]] as const) {
      const observed = childWait(table, deleting.pid, writerPid); lifetimeWaits.push(observed);
      expect(await Promise.race([observed, deleting.result.then(() => { throw new Error("Referenced child DELETE committed before generation released its lifetime lock"); })])).toBe(deleting.pid);
    }
    lifetimeHolder.release(); await lifetimeHolder.holding;
    const profile = await lifetimeWriting;
    expect(profile.confirmationBatchId).toBe(lifetimeBatch.result.confirmationBatchId);
    expect(await deletingSource.result).toBe(1); expect(await deletingBatch.result).toBe(1);
    expect(await prisma.campaignBrief.findUniqueOrThrow({ where: { id: profile.briefId! } })).toMatchObject({ campaignId: lifetimeId, approvedAt: null, approvedByUserId: null });
    await reject(getCampaignAgent(f.actor, { scope: f.scope, campaignId: lifetimeId }), "INVALID_STORED_AGENT", 503);
  } finally {
    lifetimeStop.abort();
    lifetimeHolder.release(); await lifetimeHolder.close(); await lifetimeWriting.catch(() => {});
    await Promise.all([deletingSource?.close(), deletingBatch?.close()]);
    await Promise.all(lifetimeWaits.map(observed => observed.catch(() => {}))); await lifetimeMonitor.$disconnect();
  }
  const page = await getCampaignAgentTextSources(f.actor, { scope: f.scope, campaignId }), source = page.sources[0]!;
  const current = await getCampaignAgent(f.actor, { scope: f.scope, campaignId }), payload = { fields: choices(CampaignFieldsSchema.parse(current.current.fields), [{ id: source.id, sourceHash: source.sourceHash }]) };
  const a = await inputFor(f.actor, f.scope, campaignId, "CONFIRM_FIELDS", payload, current), b = { ...a, operationKey: key() }, peer = new PrismaClient();
  let winning: Awaited<ReturnType<typeof executeCampaignAgentCommand>> | undefined, winningInput: typeof a | undefined;
  try {
    const outcomes = await Promise.allSettled([executeCampaignAgentCommand(f.actor, a, form), executeCampaignAgentCommand(f.actor, b, { channel: "FORM", client: peer })]);
    expect(outcomes.filter(item => item.status === "fulfilled")).toHaveLength(1);
    const success = outcomes.find(item => item.status === "fulfilled"), failed = outcomes.find(item => item.status === "rejected");
    if (success?.status !== "fulfilled" || failed?.status !== "rejected") throw new Error("Expected one native confirmation winner and one loser");
    winning = success.value; winningInput = outcomes[0]!.status === "fulfilled" ? a : b;
    expect(failed.reason).toMatchObject({ code: "STALE_VERSION", status: 409 });
    expect(await stored("CampaignAgentConfirmationBatch", campaignId)).toHaveLength(1);
    const competingKeys = new Set<string>([a.operationKey, b.operationKey]);
    expect((await stored("CampaignAgentCommand", campaignId)).filter(item => competingKeys.has(String(item.operationKey)))).toHaveLength(1);
  } finally { await peer.$disconnect(); }
  if (!winning || !winningInput) throw new Error("Missing genuine native confirmation winner");
  const retainedBatch = await batch(campaignId, winning.confirmationBatchId!), reviewed = await getCampaignAgent(f.actor, { scope: f.scope, campaignId });
  const rawBeforeRead = await raw(campaignId); expect((await getCampaignAgent(f.actor, { scope: f.scope, campaignId })).retained).toEqual(reviewed.retained); expect(await raw(campaignId)).toEqual(rawBeforeRead);
  const delayedGenerate = await inputFor(f.actor, f.scope, campaignId, "GENERATE_PROFILE", { confirmationBatchId: winning.confirmationBatchId }, reviewed);
  await planningStep(f.actor, f.scope, campaignId, "UPDATE_FIELDS", { patch: { title: "Synthetic away title" } });
  await planningStep(f.actor, f.scope, campaignId, "UPDATE_FIELDS", { patch: { title: campaignFields.title } });
  const afterAba = await getCampaignAgent(f.actor, { scope: f.scope, campaignId }); expect(afterAba.current.snapshot.fieldsHash).toBe(reviewed.current.snapshot.fieldsHash); expect(afterAba.coverage).toBe("STALE");
  expect(afterAba.retained).toEqual(reviewed.retained); expect(await batch(campaignId, winning.confirmationBatchId!)).toEqual(retainedBatch);
  await reject(executeCampaignAgentCommand(f.actor, delayedGenerate, form), "STALE_VERSION");
  await reject(executeCampaignAgentCommand(f.actor, await inputFor(f.actor, f.scope, campaignId, "GENERATE_PROFILE", { confirmationBatchId: winning.confirmationBatchId }), form), "STALE_CONFIRMATION");
  await step(f.actor, f.scope, campaignId, "SET_PREFERENCES", { preferences }); expect((await getCampaignAgent(f.actor, { scope: f.scope, campaignId })).coverage).toBe("UNCONFIRMED");
  const rereviewed = await confirm(f.actor, f.scope, campaignId, [{ id: source.id, sourceHash: source.sourceHash }]);
  const beforeSelection = await getCampaignAgent(f.actor, { scope: f.scope, campaignId });
  await planningStep(f.actor, f.scope, campaignId, "SET_SELECTION", { selection: { kind: "NONE" } });
  await planningStep(f.actor, f.scope, campaignId, "SET_SELECTION", { selection: context.choice });
  const afterSelection = await getCampaignAgent(f.actor, { scope: f.scope, campaignId }); expect(afterSelection.coverage).toBe("STALE");
  expect(afterSelection.current.snapshot.selection.versionId).toBe(beforeSelection.current.snapshot.selection.versionId);
  expect(afterSelection.current.snapshot.selection.id).not.toBe(beforeSelection.current.snapshot.selection.id);
  await reject(executeCampaignAgentCommand(f.actor, await inputFor(f.actor, f.scope, campaignId, "GENERATE_PROFILE", { confirmationBatchId: rereviewed.result.confirmationBatchId }), form), "STALE_CONFIRMATION");
  const activeBatch = await confirm(f.actor, f.scope, campaignId, [{ id: source.id, sourceHash: source.sourceHash }]);
  const archivedCommand = await inputFor(f.actor, f.scope, campaignId, "GENERATE_PROFILE", { confirmationBatchId: activeBatch.result.confirmationBatchId });
  const parent = await prisma.brandContext.findUniqueOrThrow({ where: { id: context.contextId } });
  await executeBrandContextCommand(f.actor, { operationKey: key(), scope: f.scope, contextId: context.contextId, expectedRevision: parent.revision,
    action: "SET_ARCHIVED", payload: { archived: true } });
  const beforeArchived = await raw(campaignId);
  await reject(executeCampaignAgentCommand(f.actor, archivedCommand, form), "ARCHIVED");
  const archivedView = await getCampaignAgent(f.actor, { scope: f.scope, campaignId });
  await reject(executeCampaignAgentCommand(f.actor, await inputFor(f.actor, f.scope, campaignId, "CONFIRM_FIELDS", { fields: choices(CampaignFieldsSchema.parse(archivedView.current.fields)) }, archivedView), form), "ARCHIVED");
  expect(await raw(campaignId)).toEqual(beforeArchived);
  const archivedBatchBeforePreferences = await batch(campaignId, activeBatch.result.confirmationBatchId!);
  const archivedSourcesBeforePreferences = await stored("CampaignAgentTextSource", campaignId);
  await step(f.actor, f.scope, campaignId, "SET_PREFERENCES", { preferences: { input: "VOICE_MESSAGE", output: "TEXT_AND_VOICE" } });
  const archivedPreferences = await getCampaignAgent(f.actor, { scope: f.scope, campaignId });
  expect(archivedPreferences.coverage).toBe("UNCONFIRMED");
  expect(archivedPreferences.retained?.confirmation).toEqual({ kind: "UNCONFIRMED" });
  expect(archivedPreferences.retained?.preferences).toEqual({ input: "VOICE_MESSAGE", output: "TEXT_AND_VOICE" });
  expect(archivedPreferences.retained?.assistance).toEqual({ kind: "MANUAL_GUIDANCE", agent: "UNAVAILABLE" });
  expect(await batch(campaignId, activeBatch.result.confirmationBatchId!)).toEqual(archivedBatchBeforePreferences);
  expect(await stored("CampaignAgentTextSource", campaignId)).toEqual(archivedSourcesBeforePreferences);
  const archivedParent = await prisma.brandContext.findUniqueOrThrow({ where: { id: context.contextId } });
  await executeBrandContextCommand(f.actor, { operationKey: key(), scope: f.scope, contextId: context.contextId, expectedRevision: archivedParent.revision,
    action: "SET_ARCHIVED", payload: { archived: false } });
  await sqlRejected(prisma.$executeRaw`UPDATE "CampaignAgentTextSource" SET "sourceHash"=${"a".repeat(64)} WHERE id=${source.id}`);
  await sqlRejected(prisma.$executeRaw`UPDATE "CampaignAgentConfirmationBatch" SET "contentHash"=${"a".repeat(64)} WHERE id=${winning.confirmationBatchId}`);
  await prisma.$executeRaw`DELETE FROM "CampaignAgentTextSource" WHERE id=${source.id} AND "campaignId"=${campaignId}`;
  await reject(getCampaignAgent(f.actor, { scope: f.scope, campaignId }), "INVALID_STORED_AGENT", 503);
  const beforeMissingSourceReplay = await raw(campaignId);
  await reject(executeCampaignAgentCommand(f.actor, appended.input, form), "INVALID_STORED_AGENT", 503);
  await reject(executeCampaignAgentCommand(f.actor, winningInput, form), "INVALID_STORED_AGENT", 503);
  expect(await raw(campaignId)).toEqual(beforeMissingSourceReplay);
  await prisma.$executeRaw`DELETE FROM "CampaignAgentTextSource" WHERE id=${joinSourceB.id} AND "campaignId"=${joinId}`;
  const beforeDeletedProducer = await raw(joinId);
  for (const produced of [joinTextB, joinBatchB, joinProfileA]) await reject(executeCampaignAgentCommand(f.actor, produced.input, form), "INVALID_STORED_AGENT", 503);
  expect(await raw(joinId)).toEqual(beforeDeletedProducer);
  const missingBatchId = await fresh(f.actor, f.scope); await initialize(f.actor, f.scope, missingBatchId); const missingBatch = await confirm(f.actor, f.scope, missingBatchId);
  const missingCommand = await inputFor(f.actor, f.scope, missingBatchId, "GENERATE_PROFILE", { confirmationBatchId: missingBatch.result.confirmationBatchId });
  await prisma.$executeRaw`DELETE FROM "CampaignAgentConfirmationBatch" WHERE id=${missingBatch.result.confirmationBatchId} AND "campaignId"=${missingBatchId}`;
  await reject(getCampaignAgent(f.actor, { scope: f.scope, campaignId: missingBatchId }), "INVALID_STORED_AGENT", 503);
  await reject(executeCampaignAgentCommand(f.actor, missingCommand, form), "INVALID_STORED_AGENT", 503);
  const beforeMissingBatchReplay = await raw(missingBatchId);
  await reject(executeCampaignAgentCommand(f.actor, missingBatch.input, form), "INVALID_STORED_AGENT", 503);
  expect(await raw(missingBatchId)).toEqual(beforeMissingBatchReplay);
  const missingGeneratedBatchId = await fresh(f.actor, f.scope); await initialize(f.actor, f.scope, missingGeneratedBatchId);
  const usedBatch = await confirm(f.actor, f.scope, missingGeneratedBatchId), generatedFromMissing = await step(f.actor, f.scope, missingGeneratedBatchId, "GENERATE_PROFILE", { confirmationBatchId: usedBatch.result.confirmationBatchId });
  await prisma.$executeRaw`DELETE FROM "CampaignAgentConfirmationBatch" WHERE id=${usedBatch.result.confirmationBatchId} AND "campaignId"=${missingGeneratedBatchId}`;
  const beforeMissingGenerationReplay = await raw(missingGeneratedBatchId);
  await reject(executeCampaignAgentCommand(f.actor, generatedFromMissing.input, form), "INVALID_STORED_AGENT", 503);
  expect(await raw(missingGeneratedBatchId)).toEqual(beforeMissingGenerationReplay);
  const missingBriefId = await fresh(f.actor, f.scope); await initialize(f.actor, f.scope, missingBriefId);
  const keptBatch = await confirm(f.actor, f.scope, missingBriefId), removedProfile = await step(f.actor, f.scope, missingBriefId, "GENERATE_PROFILE", { confirmationBatchId: keptBatch.result.confirmationBatchId });
  await prisma.campaignBriefProvenance.delete({ where: { briefId: removedProfile.result.briefId! } });
  await prisma.campaignBrief.delete({ where: { id: removedProfile.result.briefId! } });
  const beforeMissingBriefReplay = await raw(missingBriefId);
  await reject(executeCampaignAgentCommand(f.actor, removedProfile.input, form), "INVALID_STORED_AGENT", 503);
  expect(await raw(missingBriefId)).toEqual(beforeMissingBriefReplay);
  const corruptId = await fresh(f.actor, f.scope); await initialize(f.actor, f.scope, corruptId); const corruptView = await getCampaignAgent(f.actor, { scope: f.scope, campaignId: corruptId });
  const corruptedSource = { schemaVersion: 1, id: key(), binding: corruptView.binding, capturedSnapshot: corruptView.current.snapshot,
    authorUserId: f.user.id, kind: "CUSTOMER_TEXT", originalText: { text: "Synthetic corrupt self-hash only", language: "en" }, createdAt: new Date().toISOString(), sourceHash: "f".repeat(64) };
  await prisma.$executeRaw`INSERT INTO "CampaignAgentTextSource" (id,"agentId","campaignId","workspaceId","authorUserId",content,"sourceHash","createdAt")
    VALUES (${corruptedSource.id},${corruptView.retained!.id},${corruptId},${corruptView.binding.workspaceId},${f.user.id},${JSON.stringify(corruptedSource)}::jsonb,${corruptedSource.sourceHash},${corruptedSource.createdAt}::timestamp(3))`;
  await reject(getCampaignAgentTextSources(f.actor, { scope: f.scope, campaignId: corruptId }), "INVALID_STORED_AGENT", 503);
  const paged = await fresh(f.actor, f.scope); await initialize(f.actor, f.scope, paged);
  const words = Array.from({ length: 7 }, (_, i) => ({ text: "Synthetic byte page " + i + "\n" + "汉".repeat(15000) + "  ", language: "zh" }));
  for (const originalText of words) await step(f.actor, f.scope, paged, "APPEND_TEXT", { originalText });
  const firstPage = await getCampaignAgentTextSources(f.actor, { scope: f.scope, campaignId: paged }); expect(firstPage.sources.length).toBeLessThan(7); expect(firstPage.nextCursor).not.toBeNull();
  const readWords = await allSources(f.actor, f.scope, paged); expect(readWords).toHaveLength(7);
  expect(readWords.map(item => item.originalText.text).sort()).toEqual(words.map(item => item.text).sort());
  const counted = await fresh(f.actor, f.scope); await initialize(f.actor, f.scope, counted);
  for (let i = 0; i < 64; i++) await step(f.actor, f.scope, counted, "APPEND_TEXT", { originalText: { text: "Synthetic count page " + i, language: "en" } });
  const firstCount = await getCampaignAgentTextSources(f.actor, { scope: f.scope, campaignId: counted }); expect(firstCount.sources).toHaveLength(20); expect(firstCount.nextCursor).not.toBeNull();
  expect(await allSources(f.actor, f.scope, counted)).toHaveLength(64);
  const beforeLimit = await raw(counted); await reject(executeCampaignAgentCommand(f.actor, await inputFor(f.actor, f.scope, counted, "APPEND_TEXT", { originalText: { text: "Synthetic forbidden65th", language: "en" } }), form), "TEXT_SOURCE_LIMIT", 429); expect(await raw(counted)).toEqual(beforeLimit);
  const waiting = await fresh(f.actor, f.scope); await initialize(f.actor, f.scope, waiting);
  const delayed = await inputFor(f.actor, f.scope, waiting, "APPEND_TEXT", { originalText: { text: "Synthetic dated after actual wait", language: "en" } });
  const heldBrand = await blocker("Brand", f.brand.id), datedWrite = executeCampaignAgentCommand(f.actor, delayed, form); void datedWrite.catch(() => {});
  try {
    expect(await Promise.race([heldBrand.wait(), datedWrite.then(() => { throw new Error("Text completed before actual native Brand wait"); })])).toBeGreaterThan(0);
    const releasedAt = Date.now(); heldBrand.release(); await heldBrand.holding; const made = await datedWrite;
    const dated = (await getCampaignAgentTextSources(f.actor, { scope: f.scope, campaignId: waiting })).sources.find(item => item.id === made.sourceId)!;
    expect(Date.parse(dated.createdAt)).toBeGreaterThanOrEqual(releasedAt);
  } finally { await heldBrand.close(); await datedWrite.catch(() => {}); }
  const waitReject = async (actor: OrganizationActor, scope: PlanningScope, id: string, table: WaitTable, lockId: string, after: (tx: Prisma.TransactionClient) => Promise<unknown>, code: string, status: number) => {
    const before = await raw(id), input = await inputFor(actor, scope, id, "APPEND_TEXT", { originalText: { text: "Synthetic rejected wait must roll back", language: "en" } });
    const held = await blocker(table, lockId, after), writing = executeCampaignAgentCommand(actor, input, form); void writing.catch(() => {});
    try { expect(await Promise.race([held.wait(), writing.then(() => { throw new Error("Interview completed before native authorization wait"); })])).toBeGreaterThan(0);
      held.release(); await held.holding; await reject(writing, code, status); expect(await raw(id)).toEqual(before);
    } finally { await held.close(); await writing.catch(() => {}); }
  };
  const customer = await company(), aWait = await agency(customer, "Synthetic waiting grant"), clientCampaign = await fresh(aWait.seat.actor, aWait.scope); await initialize(aWait.seat.actor, aWait.scope, clientCampaign);
  await waitReject(aWait.seat.actor, aWait.scope, clientCampaign, "ClientGrant", aWait.grant.id, tx => tx.clientGrant.update({ where: { id: aWait.grant.id }, data: { view: false, revision: { increment: 1 } } }), "NOT_FOUND", 404);
  const clientWait = await agency(customer, "Synthetic waiting association"), clientCampaign2 = await fresh(clientWait.seat.actor, clientWait.scope); await initialize(clientWait.seat.actor, clientWait.scope, clientCampaign2);
  await waitReject(clientWait.seat.actor, clientWait.scope, clientCampaign2, "OrganizationClient", clientWait.client.id, tx => tx.organizationClient.update({ where: { id: clientWait.client.id }, data: { state: "REVOKED", revision: { increment: 1 } } }), "NOT_FOUND", 404);
  const transfer = await company(), transferId = await fresh(transfer.actor, transfer.scope); await initialize(transfer.actor, transfer.scope, transferId); const nextOwner = await person();
  await waitReject(transfer.actor, transfer.scope, transferId, "Brand", transfer.brand.id, tx => tx.brand.update({ where: { id: transfer.brand.id }, data: { userId: nextOwner.user.id } }), "NOT_FOUND", 404);
  const revoked = await company(), revokedId = await fresh(revoked.actor, revoked.scope); await initialize(revoked.actor, revoked.scope, revokedId);
  await waitReject(revoked.actor, revoked.scope, revokedId, "User", revoked.user.id, tx => tx.authSession.update({ where: { id: revoked.actor.sessionId }, data: { revokedAt: new Date() } }), "UNAUTHENTICATED", 401);
  await reject(executeCampaignAgentCommand(revoked.actor, { malformed: true }, { channel: "AGENT_TOOL" }), "UNAUTHENTICATED", 401);
  const expiry = await company(), expiryId = await fresh(expiry.actor, expiry.scope); await initialize(expiry.actor, expiry.scope, expiryId);
  const expiryInput = await inputFor(expiry.actor, expiry.scope, expiryId, "APPEND_TEXT", { originalText: { text: "Synthetic uncertain text that must never commit", language: "en" } });
  const expiresAt = new Date(Date.now() + 2500); await prisma.authSession.update({ where: { id: expiry.actor.sessionId }, data: { expiresAt } });
  const beforeExpiry = await raw(expiryId), heldJournal = await blocker("CampaignAgentCommand", null), expiring = executeCampaignAgentCommand(expiry.actor, expiryInput, form); void expiring.catch(() => {});
  try {
    expect(await Promise.race([heldJournal.wait(), expiring.then(() => { throw new Error("Interview completed before real journal INSERT wait"); })])).toBeGreaterThan(0);
    expect(Date.now()).toBeLessThan(expiresAt.getTime()); while (Date.now() <= expiresAt.getTime()) await delay(Math.min(50, expiresAt.getTime() - Date.now() + 1));
    expect(await resolveSession(expiry.token)).toBeNull(); heldJournal.release(); await heldJournal.holding;
    await reject(expiring, "UNAUTHENTICATED", 401); expect(await raw(expiryId)).toEqual(beforeExpiry);
  } finally { await heldJournal.close(); await expiring.catch(() => {}); }
}, 120000);
