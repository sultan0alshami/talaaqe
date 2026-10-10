// Three guarded native recovery groups, run by the coordinator.
// Native actors/organizations/planning/interview producers; no mocked authority,
// SQL UPDATE bypass, external provider or encrypted-browser acceptance claim.
import { createHash, createHmac, randomUUID } from "node:crypto";
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
import type { PlanningScope } from "@/lib/brand-context/contracts";
import { executeCampaignPlanningCommand } from "@/lib/campaign-planning/service";
import { executeCampaignAgentCommand, getCampaignAgent } from "@/lib/campaign-agent/service";
import { getCampaignAgentRecoveryKey, getCampaignAgentCommandOutcome, executeCampaignAgentRecoveryBarrier } from "@/lib/campaign-agent/recovery";
import { CampaignAgentCommandSchema, CampaignAgentReceiptSchema } from "@/lib/campaign-agent/native-contracts";
import type { CampaignAgentRecoveryTarget, CampaignAgentBarrierCommand } from "@/lib/campaign-agent/recovery-contracts";
import { CampaignAgentBarrierCommandSchema, CampaignAgentBarrierReceiptSchema } from "@/lib/campaign-agent/recovery-contracts";
import { CampaignAgentFieldKeys } from "@/lib/campaign-agent/contracts";
import { CampaignFieldsSchema, type CampaignDraftFields } from "@/lib/campaigns/contracts";
import { campaignFields } from "../campaigns/fixtures";

const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>(), campaigns = new Set<string>();
const key = (): string => randomUUID(), form = { channel: "FORM" as const }, preferences = { input: "TEXT", output: "TEXT" } as const;
const allCaps = { view: true, plan: true, approveShortlist: true, reviewContent: true, signCustomer: true, financial: true, manageGrants: true };
const tables = ["CampaignAgentCommand", "CampaignAgentConfirmationBatch", "CampaignAgentTextSource", "CampaignAgent"] as const;
type Table = typeof tables[number];
type Fields = Record<string, unknown>;
beforeAll(async () => {
  const taskId = process.env.INFAME_TASK_ID;
  if (!taskId || !/^infame_[a-f0-9]{12}$/.test(taskId) || process.env.INFAME_ENV !== "test" || process.env.NODE_ENV === "production") throw new Error("Recovery witnesses require guarded test task");
  const rows = await prisma.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]?.id !== taskId || rows[0]?.kind !== "test" || rows[0]?.db !== taskId + "_test" || rows[0]?.host !== "127.0.0.1") throw new Error("Recovery witness target identity mismatch");
});
async function stored(table: Table, campaignId: string) { return prisma.$queryRaw<Fields[]>(Prisma.sql`SELECT * FROM ${Prisma.raw('"' + table + '"')} WHERE "campaignId"=${campaignId} ORDER BY id`); }
afterEach(async () => {
  for (const table of tables) if (campaigns.size) await prisma.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "campaignId" IN (${Prisma.join([...campaigns])})`);
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
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } }), token = await openSession(user.id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Synthetic recovery session did not resolve");
  const actor: OrganizationActor = { userId: session.userId, role: session.role, sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  return { user, actor, token };
}
async function person(role: "BRAND" | "CREATOR" | "ADMIN" = "BRAND") {
  const id = key(); users.add(id); await prisma.user.create({ data: { id, role, active: true, isTest: true, name: "Synthetic recovery actor", email: `${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } }); return sign(id);
}
async function company() {
  const owner = await person(), brand = await prisma.brand.create({ data: { userId: owner.user.id, slug: "recovery-" + key().replace(/-/g, "").slice(0, 16), name: "Synthetic recovery company", countryCode: "KW", isTest: true } });
  brands.add(brand.id); return { ...owner, brand, scope: { kind: "OWN_BRAND", brandId: brand.id } as PlanningScope };
}
type Company = Awaited<ReturnType<typeof company>>;
async function agency(customer: Company) {
  const owner = await person(), seat = await person(), other = await person(), { organization } = await createOrganization(owner.actor, { operationKey: key(), kind: "AGENCY", nameOriginal: "Synthetic recovery agency" }); organizations.add(organization.id);
  const revision = async () => (await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).revision;
  const proposal = await proposeClientAssociation(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), brandId: customer.brand.id });
  const { client } = await authorizeClientAssociation(customer.actor, proposal.client.id, { operationKey: key(), expectedRevision: proposal.client.revision, capabilities: allCaps });
  const grants = [];
  for (const member of [seat, other]) {
    const invitation = await proposeMember(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await revision(), targetUserId: member.user.id });
    const { membership } = await acceptMembership(member.actor, invitation.membership.id, { operationKey: key(), expectedRevision: invitation.membership.revision });
    const { grant } = await setClientGrant(owner.actor, client.id, { operationKey: key(), expectedClientRevision: client.revision, membershipId: membership.id, expectedGrantRevision: null, capabilities: allCaps }); grants.push(grant);
  }
  return { owner, seat, other, organization, client, grant: grants[0]!, otherGrant: grants[1]!, scope: { kind: "CLIENT", clientId: client.id } as PlanningScope };
}
async function fresh(actor: OrganizationActor, scope: PlanningScope) {
  const result = await executeCampaignPlanningCommand(actor, { operationKey: key(), scope, ...(scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(actor, scope.clientId, "plan") } : {}),
    action: "CREATE", expectedCampaignRevision: 0, expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0, payload: { fields: campaignFields, selection: { kind: "NONE" }, narrative: null } });
  campaigns.add(result.campaignId); return result.campaignId;
}
async function inputFor(actor: OrganizationActor, scope: PlanningScope, campaignId: string, action: string, payload: unknown) {
  const view = await getCampaignAgent(actor, { scope, campaignId });
  return CampaignAgentCommandSchema.parse({ operationKey: key(), scope, campaignId, ...(scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(actor, scope.clientId, "plan") } : {}),
    action, expectedAgentRevision: view.retained?.revision ?? 0, expectedSnapshot: view.current.snapshot, payload });
}
async function step(actor: OrganizationActor, scope: PlanningScope, campaignId: string, action: string, payload: unknown) {
  const input = await inputFor(actor, scope, campaignId, action, payload), result = await executeCampaignAgentCommand(actor, input, form); return { input, result };
}
async function initialize(actor: OrganizationActor, scope: PlanningScope, campaignId: string) { return step(actor, scope, campaignId, "INITIALIZE", { preferences }); }
function choices(fields: CampaignDraftFields) {
  return CampaignAgentFieldKeys.map(field => { const valueHash = canonicalHash({ domain: "infame-campaign-field-value-v1", field, value: fields[field] });
    return { field, valueHash, source: { kind: "CUSTOMER_FIELD_CHOICE", capturedValueHash: valueHash } }; });
}
async function confirm(actor: OrganizationActor, scope: PlanningScope, campaignId: string) {
  const view = await getCampaignAgent(actor, { scope, campaignId }); return step(actor, scope, campaignId, "CONFIRM_FIELDS", { fields: choices(CampaignFieldsSchema.parse(view.current.fields)) });
}
function target(actor: OrganizationActor, original: unknown): CampaignAgentRecoveryTarget {
  const command = CampaignAgentCommandSchema.parse(original), { scope, campaignId, payload, ...technical } = command; void scope; void campaignId;
  const commandHash = canonicalHash({ domain: "infame-campaign-agent-command-v1", actorUserId: actor.userId, command });
  return { ...technical, commandHash, payload: command.action === "APPEND_TEXT"
    ? { originalTextHash: canonicalHash({ domain: "infame-agent-recovery-text-v1", originalText: command.payload.originalText }) } : payload } as CampaignAgentRecoveryTarget;
}
async function barrierInput(actor: OrganizationActor, scope: PlanningScope, campaignId: string, original: unknown, operationKey: string = key()): Promise<CampaignAgentBarrierCommand> {
  const view = await getCampaignAgent(actor, { scope, campaignId });
  return { operationKey, scope, campaignId, expectedAgentRevision: view.retained?.revision ?? 0, expectedSnapshot: view.current.snapshot,
    ...(scope.kind === "CLIENT" ? { expectedAuthority: await getClientAuthority(actor, scope.clientId, "plan") } : {}), target: target(actor, original), initialPreferences: view.retained ? null : preferences };
}
async function raw(campaignId: string) {
  return { campaign: await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } }), planning: await prisma.campaignPlanningState.findUniqueOrThrow({ where: { campaignId } }),
    agent: await stored("CampaignAgent", campaignId), sources: await stored("CampaignAgentTextSource", campaignId), batches: await stored("CampaignAgentConfirmationBatch", campaignId), commands: await stored("CampaignAgentCommand", campaignId),
    briefs: await prisma.campaignBrief.findMany({ where: { campaignId }, orderBy: { id: "asc" } }),
    audits: await prisma.adminAudit.findMany({ where: { resourceType: "Campaign", resourceId: campaignId }, orderBy: { id: "asc" } }),
    events: await prisma.outboxEvent.findMany({ where: { payload: { path: ["aggregateId"], equals: campaignId } }, orderBy: { id: "asc" } }) };
}
async function reject(operation: Promise<unknown>, code: string, status = 409) { await expect(operation).rejects.toMatchObject({ code, status }); }
async function rejectKey(operation: Promise<unknown>, code: string, status: number) {
  // Never let a failed rejection matcher print a resolved key DTO, or let an
  // unexpected backend message/code print secret configuration accidentally.
  const failure: unknown = await operation.then(() => null, (error: unknown) => error);
  expect(failure instanceof Error).toBe(true);
  expect(typeof failure === "object" && failure !== null && "code" in failure && failure.code === code
    && "status" in failure && failure.status === status).toBe(true);
}
function noWords(value: unknown, words: string) { expect(JSON.stringify(value).includes(words)).toBe(false); }
function latch<T>() { let resolve!: (value: T | PromiseLike<T>) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
type WaitTable = "User" | "ClientGrant" | "CampaignAgentCommand";
async function blocker(table: WaitTable, id: string | null, after?: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  const peer = new PrismaClient(), monitor = new PrismaClient(), ready = latch<number>(), release = latch<void>(), stop = new AbortController();
  const holding = peer.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout='4s'`;
    if (table === "CampaignAgentCommand") await tx.$executeRaw`LOCK TABLE "CampaignAgentCommand" IN SHARE MODE`;
    else await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw('"' + table + '"')} WHERE id=${id} FOR UPDATE`);
    const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`; ready.resolve(pid!);
    await release.promise; if (after) await after(tx);
  }, { maxWait: 5000, timeout: 12000 }); void holding.catch(() => {});
  let pid: number;
  try { pid = await Promise.race([ready.promise, holding.then(() => { throw new Error("Recovery blocker ended before native lock"); })]); }
  catch (error) { release.resolve(); await holding.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); throw error; }
  const observations: Array<Promise<number>> = [];
  function observe(waitingQuery: string, blockingPid: number) {
    const observed = (async () => { const deadline = performance.now() + 4000;
      while (performance.now() < deadline) {
        if (stop.signal.aborted) throw new Error("Recovery native observer cancelled");
        const rows = await monitor.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'
          AND ${blockingPid}=ANY(pg_blocking_pids(pid)) AND query LIKE ${'%"' + waitingQuery + '"%'} AND (${waitingQuery} <> 'CampaignAgentCommand' OR query ILIKE '%INSERT%')`;
        if (rows.length) return rows[0]!.pid; await delay(20);
      } throw new Error("Recovery operation did not reach its actual native wait"); })(); observations.push(observed); return observed;
  }
  return { holding, pid, release: () => release.resolve(), wait: () => observe(table, pid), waitBehind: (writerPid: number) => observe("User", writerPid),
    async close() { release.resolve(); stop.abort(); await holding.catch(() => {}); await Promise.all(observations.map(item => item.catch(() => {}))); await peer.$disconnect(); await monitor.$disconnect(); } };
}

it("derives stable purpose-separated recovery keys only under current native view plus plan without writes or secret disclosure", async () => {
  const f = await company(), id = await fresh(f.actor, f.scope), id2 = await fresh(f.actor, f.scope), before = await raw(id);
  const recovery = await getCampaignAgentRecoveryKey(f.actor, { scope: f.scope, campaignId: id });
  expect(Object.keys(recovery).sort()).toEqual(["schemaVersion", "asOf", "binding", "actorReference", "algorithm", "keyId", "keyBase64Url"].sort());
  expect(recovery.algorithm === "AES-GCM" && recovery.actorReference === f.user.id).toBe(true);
  expect(/^[A-Za-z0-9_-]{43}$/.test(recovery.keyBase64Url)).toBe(true);
  const bytes = Buffer.from(recovery.keyBase64Url, "base64url"); expect(bytes.length).toBe(32);
  expect(createHash("sha256").update(bytes).digest("hex") === recovery.keyId).toBe(true);
  const secret = process.env.AUTH_SECRET; expect(typeof secret === "string" && secret.length >= 32).toBe(true);
  if (!secret) throw new Error("Guarded test authentication configuration missing");
  const message = canonicalHash({ domain: "infame-campaign-agent-recovery-key-v1", userId: f.user.id, binding: recovery.binding });
  expect(createHmac("sha256", secret).update(message, "utf8").digest("base64url") === recovery.keyBase64Url).toBe(true);
  expect(recovery.keyBase64Url === secret || recovery.keyBase64Url === f.token || recovery.keyBase64Url === f.actor.sessionId).toBe(false);
  expect(await raw(id)).toEqual(before); expect((await getCampaignAgent(f.actor, { scope: f.scope, campaignId: id })).retained).toBeNull();
  const again = await getCampaignAgentRecoveryKey(f.actor, { scope: f.scope, campaignId: id }); expect(again.keyBase64Url === recovery.keyBase64Url).toBe(true);
  const renewed = await sign(f.user.id), afterSign = await raw(id), restored = await getCampaignAgentRecoveryKey(renewed.actor, { scope: f.scope, campaignId: id });
  expect(restored.keyBase64Url === recovery.keyBase64Url && restored.keyId === recovery.keyId).toBe(true); expect(await raw(id)).toEqual(afterSign);
  expect((await getCampaignAgentRecoveryKey(f.actor, { scope: f.scope, campaignId: id2 })).keyBase64Url === recovery.keyBase64Url).toBe(false);
  const a = await agency(f), clientId = await fresh(a.seat.actor, a.scope), sharedBefore = await raw(clientId);
  const seatKey = await getCampaignAgentRecoveryKey(a.seat.actor, { scope: a.scope, campaignId: clientId }), otherKey = await getCampaignAgentRecoveryKey(a.other.actor, { scope: a.scope, campaignId: clientId });
  expect(seatKey.keyBase64Url === otherKey.keyBase64Url).toBe(false); expect(seatKey.keyBase64Url === recovery.keyBase64Url).toBe(false); expect(await raw(clientId)).toEqual(sharedBefore);
  await rejectKey(getCampaignAgentRecoveryKey(f.actor, { scope: f.scope, campaignId: clientId }), "NOT_FOUND", 404);
  const admin = await person("ADMIN");
  try {
    process.env.AUTH_SECRET = "Synthetic in-memory recovery derivation rotation only 2026";
    const rotated = await getCampaignAgentRecoveryKey(f.actor, { scope: f.scope, campaignId: id });
    expect(rotated.keyId === recovery.keyId || rotated.keyBase64Url === recovery.keyBase64Url).toBe(false);
    process.env.AUTH_SECRET = "";
    await rejectKey(getCampaignAgentRecoveryKey(f.actor, { scope: f.scope, campaignId: id }), "RECOVERY_UNAVAILABLE", 503);
    await rejectKey(getCampaignAgentRecoveryKey(admin.actor, { malformed: true }), "FORBIDDEN", 403);
  } finally { process.env.AUTH_SECRET = secret; }
  const heldGrant = await blocker("ClientGrant", a.grant.id, tx => tx.clientGrant.update({ where: { id: a.grant.id }, data: { plan: false, revision: { increment: 1 } } }));
  const deniedKey = getCampaignAgentRecoveryKey(a.seat.actor, { scope: a.scope, campaignId: clientId }); void deniedKey.catch(() => {});
  try { expect(await Promise.race([heldGrant.wait(), deniedKey.then(() => { throw new Error("Key escaped native grant wait"); })])).toBeGreaterThan(0);
    heldGrant.release(); await heldGrant.holding; await rejectKey(deniedKey, "NOT_FOUND", 404); expect(await raw(clientId)).toEqual(sharedBefore);
  } finally { await heldGrant.close(); await deniedKey.catch(() => {}); }
  const revoked = await company(), revokedId = await fresh(revoked.actor, revoked.scope), heldUser = await blocker("User", revoked.user.id,
    tx => tx.authSession.update({ where: { id: revoked.actor.sessionId }, data: { revokedAt: new Date() } }));
  const deniedSession = getCampaignAgentRecoveryKey(revoked.actor, { scope: revoked.scope, campaignId: revokedId }); void deniedSession.catch(() => {});
  try { expect(await Promise.race([heldUser.wait(), deniedSession.then(() => { throw new Error("Key escaped native User wait"); })])).toBeGreaterThan(0);
    heldUser.release(); await heldUser.holding; await rejectKey(deniedSession, "UNAUTHENTICATED", 401);
    await rejectKey(getCampaignAgentRecoveryKey(revoked.actor, { malformed: true }), "UNAUTHENTICATED", 401);
  } finally { await heldUser.close(); await deniedSession.catch(() => {}); }
}, 90000);

it("returns only verified scalar committed outcomes or truthful UNKNOWN while rejecting scope, digest and native producer substitutions without writes", async () => {
  const f = await company(), id = await fresh(f.actor, f.scope), id2 = await fresh(f.actor, f.scope); await initialize(f.actor, f.scope, id);
  const words = "  Synthetic lost packet original words\nنص أصلي محفوظ  ";
  const appended = await step(f.actor, f.scope, id, "APPEND_TEXT", { originalText: { text: words, language: "ar" } });
  const confirmed = await confirm(f.actor, f.scope, id), generated = await step(f.actor, f.scope, id, "GENERATE_PROFILE", { confirmationBatchId: confirmed.result.confirmationBatchId });
  const beforeReads = await raw(id);
  for (const produced of [appended, confirmed, generated]) {
    const technical = target(f.actor, produced.input); noWords(technical, words);
    const outcome = await getCampaignAgentCommandOutcome(f.actor, { scope: f.scope, campaignId: id, target: technical });
    expect(outcome.status).toBe("COMMITTED"); expect(outcome.receipt).toEqual({ ...produced.result, replayed: true }); noWords(outcome, words);
  }
  expect(await raw(id)).toEqual(beforeReads);
  const delayed = { ...appended.input, operationKey: key() }, pending = target(f.actor, delayed);
  const unknown = await getCampaignAgentCommandOutcome(f.actor, { scope: f.scope, campaignId: id, target: pending });
  expect(unknown).toMatchObject({ status: "UNKNOWN", receipt: null }); expect(await raw(id)).toEqual(beforeReads);
  await reject(getCampaignAgentCommandOutcome(f.actor, { scope: f.scope, campaignId: id2, target: target(f.actor, appended.input) }), "NOT_FOUND", 404);
  await reject(getCampaignAgentCommandOutcome(f.actor, { scope: f.scope, campaignId: id, target: { ...target(f.actor, appended.input), commandHash: "a".repeat(64) } }), "OPERATION_KEY_REUSED");
  await reject(getCampaignAgentCommandOutcome(f.actor, { scope: f.scope, campaignId: id, target: { ...target(f.actor, appended.input), payload: { originalText: { text: words, language: "ar" } } } }), "VALIDATION", 422);
  const a = await agency(f), shared = await fresh(a.seat.actor, a.scope); await initialize(a.seat.actor, a.scope, shared);
  const realClientText = await step(a.seat.actor, a.scope, shared, "APPEND_TEXT", { originalText: { text: "Synthetic actor-private outcome", language: "en" } });
  const otherPending = CampaignAgentCommandSchema.parse({ ...realClientText.input, expectedAuthority: await getClientAuthority(a.other.actor, a.client.id, "plan") });
  const otherOutcome = await getCampaignAgentCommandOutcome(a.other.actor, { scope: a.scope, campaignId: shared, target: target(a.other.actor, otherPending) });
  expect(otherOutcome).toMatchObject({ status: "UNKNOWN", receipt: null }); noWords(otherOutcome, "Synthetic actor-private outcome");
  await prisma.clientGrant.update({ where: { id: a.grant.id }, data: { view: false, revision: { increment: 1 } } });
  await reject(getCampaignAgentCommandOutcome(a.seat.actor, { scope: a.scope, campaignId: shared, target: target(a.seat.actor, realClientText.input) }), "NOT_FOUND", 404);
  const alternative = await step(f.actor, f.scope, id, "APPEND_TEXT", { originalText: { text: "Synthetic different retained producer", language: "en" } });
  const forgedCommand = CampaignAgentCommandSchema.parse({ ...appended.input, operationKey: key() });
  const { replayed: resultOnly, ...originalReceipt } = appended.result; void resultOnly;
  const wrongProducer = CampaignAgentReceiptSchema.parse({ ...originalReceipt, sourceId: alternative.result.sourceId });
  const originalRow = (await stored("CampaignAgentCommand", id)).find(item => item.operationKey === appended.input.operationKey)!;
  const hash = canonicalHash({ domain: "infame-campaign-agent-command-v1", actorUserId: f.user.id, command: forgedCommand });
  await prisma.$executeRaw`INSERT INTO "CampaignAgentCommand" (id,"actorUserId","operationKey","agentId","campaignId","workspaceId",action,"payloadHash",result,"createdAt")
    VALUES (${key()},${f.user.id},${forgedCommand.operationKey}::uuid,${wrongProducer.agentId},${id},${wrongProducer.workspaceId},${wrongProducer.action},${hash},${JSON.stringify(wrongProducer)}::jsonb,${(originalRow.createdAt as Date).toISOString()}::timestamp(3))`;
  const beforeForged = await raw(id);
  await reject(getCampaignAgentCommandOutcome(f.actor, { scope: f.scope, campaignId: id, target: target(f.actor, forgedCommand) }), "INVALID_STORED_AGENT", 503); expect(await raw(id)).toEqual(beforeForged);
  await prisma.$executeRaw`DELETE FROM "CampaignAgentTextSource" WHERE id=${appended.result.sourceId} AND "campaignId"=${id}`;
  const beforeMissing = await raw(id);
  await reject(getCampaignAgentCommandOutcome(f.actor, { scope: f.scope, campaignId: id, target: target(f.actor, appended.input) }), "INVALID_STORED_AGENT", 503); expect(await raw(id)).toEqual(beforeMissing);
}, 90000);

it("fences delayed originals with one exact recovery barrier across both native race orders, missing initialization, replay and final-session expiry rollback", async () => {
  const f = await company(), empty = await fresh(f.actor, f.scope), originalInit = await inputFor(f.actor, f.scope, empty, "INITIALIZE", { preferences });
  const initialBarrier = await barrierInput(f.actor, f.scope, empty, originalInit), beforeInitFence = await raw(empty);
  const initialized = await executeCampaignAgentRecoveryBarrier(f.actor, initialBarrier, form);
  expect(initialized).toMatchObject({ action: "RECOVERY_BARRIER", agentRevision: 1, targetOutcome: "FENCED", originalReceipt: null, replayed: false });
  const afterInitFence = await raw(empty);
  expect(afterInitFence.sources).toEqual(beforeInitFence.sources); expect(afterInitFence.batches).toEqual(beforeInitFence.batches); expect(afterInitFence.briefs).toEqual(beforeInitFence.briefs);
  expect(afterInitFence.campaign).toEqual(beforeInitFence.campaign); expect(afterInitFence.planning).toEqual(beforeInitFence.planning);
  expect((await getCampaignAgent(f.actor, { scope: f.scope, campaignId: empty })).retained?.preferences).toEqual(preferences);
  await reject(executeCampaignAgentCommand(f.actor, originalInit, form), "STALE_VERSION");
  expect(await executeCampaignAgentRecoveryBarrier(f.actor, initialBarrier, form)).toEqual({ ...initialized, replayed: true }); expect(await raw(empty)).toEqual(afterInitFence);
  const ownBarrierTarget = { kind: "RECOVERY_BARRIER", command: initialBarrier,
    commandHash: canonicalHash({ domain: "infame-campaign-agent-recovery-barrier-v1", actorUserId: f.user.id, command: initialBarrier }) };
  const beforeOwnOutcome = await raw(empty), ownOutcome = await getCampaignAgentCommandOutcome(f.actor, { scope: f.scope, campaignId: empty, target: ownBarrierTarget });
  expect(ownOutcome).toMatchObject({ status: "COMMITTED", receipt: { ...initialized, replayed: true } }); expect(await raw(empty)).toEqual(beforeOwnOutcome);
  await reject(executeCampaignAgentRecoveryBarrier(f.actor, { ...initialBarrier, initialPreferences: { input: "MEDIA", output: "TEXT" } }, form), "OPERATION_KEY_REUSED");
  const missing = await fresh(f.actor, f.scope), impossible = CampaignAgentCommandSchema.parse({ ...await inputFor(f.actor, f.scope, missing, "INITIALIZE", { preferences }), action: "SET_PREFERENCES", expectedAgentRevision: 1 });
  await reject(executeCampaignAgentRecoveryBarrier(f.actor, await barrierInput(f.actor, f.scope, missing, impossible), form), "INVALID_STORED_AGENT", 503);
  const id = await fresh(f.actor, f.scope); await initialize(f.actor, f.scope, id);
  const originalText = await inputFor(f.actor, f.scope, id, "APPEND_TEXT", { originalText: { text: "Synthetic delayed original behind fence", language: "en" } });
  const fenceInput = await barrierInput(f.actor, f.scope, id, originalText), heldFence = await blocker("CampaignAgentCommand", null);
  const fencing = executeCampaignAgentRecoveryBarrier(f.actor, fenceInput, form); void fencing.catch(() => {});
  let delayedWrite: ReturnType<typeof executeCampaignAgentCommand> | undefined;
  try {
    const fencePid = await Promise.race([heldFence.wait(), fencing.then(() => { throw new Error("Barrier ended before real journal INSERT wait"); })]);
    delayedWrite = executeCampaignAgentCommand(f.actor, originalText, form); void delayedWrite.catch(() => {});
    expect(await Promise.race([heldFence.waitBehind(fencePid), delayedWrite.then(() => { throw new Error("Original escaped barrier's actual User lock"); })])).toBeGreaterThan(0);
    heldFence.release(); await heldFence.holding; const fenced = await fencing; await reject(delayedWrite, "STALE_VERSION");
    expect(fenced.targetOutcome).toBe("FENCED"); expect(fenced.originalReceipt).toBeNull(); expect(await stored("CampaignAgentTextSource", id)).toHaveLength(0);
    expect((await getCampaignAgentCommandOutcome(f.actor, { scope: f.scope, campaignId: id, target: target(f.actor, originalText) })).status).toBe("UNKNOWN");
  } finally { await heldFence.close(); await fencing.catch(() => {}); await delayedWrite?.catch(() => {}); }
  const firstId = await fresh(f.actor, f.scope); await initialize(f.actor, f.scope, firstId);
  const originalFirst = await inputFor(f.actor, f.scope, firstId, "APPEND_TEXT", { originalText: { text: "Synthetic original committed before barrier", language: "en" } });
  const staleBarrier = await barrierInput(f.actor, f.scope, firstId, originalFirst), heldOriginal = await blocker("CampaignAgentCommand", null);
  const producing = executeCampaignAgentCommand(f.actor, originalFirst, form); void producing.catch(() => {});
  let queuedBarrier: ReturnType<typeof executeCampaignAgentRecoveryBarrier> | undefined;
  let observedCommitted: { command: CampaignAgentBarrierCommand; result: Awaited<ReturnType<typeof executeCampaignAgentRecoveryBarrier>> } | undefined;
  try {
    const originalPid = await Promise.race([heldOriginal.wait(), producing.then(() => { throw new Error("Original ended before real journal INSERT wait"); })]);
    queuedBarrier = executeCampaignAgentRecoveryBarrier(f.actor, staleBarrier, form); void queuedBarrier.catch(() => {});
    expect(await Promise.race([heldOriginal.waitBehind(originalPid), queuedBarrier.then(() => { throw new Error("Barrier escaped original's actual User lock"); })])).toBeGreaterThan(0);
    heldOriginal.release(); await heldOriginal.holding; const receipt = await producing; await reject(queuedBarrier, "STALE_VERSION");
    const beforeCommittedFence = await raw(firstId), refreshed = await barrierInput(f.actor, f.scope, firstId, originalFirst);
    const committedFence = await executeCampaignAgentRecoveryBarrier(f.actor, refreshed, form);
    observedCommitted = { command: refreshed, result: committedFence };
    expect(committedFence.targetOutcome).toBe("COMMITTED"); expect(committedFence.originalReceipt).toEqual({ ...receipt, replayed: true });
    expect(committedFence.agentRevision).toBe(receipt.agentRevision + 1);
    const afterCommittedFence = await raw(firstId);
    for (const field of ["sources", "batches", "briefs", "campaign", "planning"] as const) expect(afterCommittedFence[field]).toEqual(beforeCommittedFence[field]);
    for (const field of ["commands", "audits", "events"] as const) expect(afterCommittedFence[field].length).toBe(beforeCommittedFence[field].length + 1);
    expect(await executeCampaignAgentRecoveryBarrier(f.actor, refreshed, form)).toEqual({ ...committedFence, replayed: true }); expect(await raw(firstId)).toEqual(afterCommittedFence);
  } finally { await heldOriginal.close(); await producing.catch(() => {}); await queuedBarrier?.catch(() => {}); }
  if (!observedCommitted) throw new Error("Expected actual committed-target barrier fixture");
  const actualCommitted = observedCommitted;
  const freshView = await getCampaignAgent(f.actor, { scope: f.scope, campaignId: firstId });
  const pending = await inputFor(f.actor, f.scope, firstId, "SET_PREFERENCES", { preferences });
  const barrier = await barrierInput(f.actor, f.scope, firstId, pending);
  await reject(executeCampaignAgentRecoveryBarrier(f.actor, { ...barrier, operationKey: barrier.target.operationKey }, form), "VALIDATION", 422);
  const caseVariantOriginal = CampaignAgentCommandSchema.parse({ ...pending, operationKey: "a9b8c7d6-e5f4-4a3b-8c7d-6e5f4a3b2c1d" });
  const caseVariantBarrier = { ...barrier, operationKey: caseVariantOriginal.operationKey.toUpperCase(), target: target(f.actor, caseVariantOriginal) };
  expect(caseVariantBarrier.operationKey === caseVariantBarrier.target.operationKey).toBe(false);
  expect(caseVariantBarrier.operationKey.toLowerCase() === caseVariantBarrier.target.operationKey.toLowerCase()).toBe(true);
  const beforeCaseVariant = await raw(firstId);
  await reject(executeCampaignAgentRecoveryBarrier(f.actor, caseVariantBarrier, form), "VALIDATION", 422);
  expect(await raw(firstId)).toEqual(beforeCaseVariant);
  await reject(executeCampaignAgentRecoveryBarrier(f.actor, { ...barrier, expectedAgentRevision: freshView.retained!.revision - 1 }, form), "STALE_VERSION");
  await reject(executeCampaignAgentRecoveryBarrier(f.actor, { ...barrier, initialPreferences: preferences }, form), "VALIDATION", 422);
  await reject(executeCampaignAgentRecoveryBarrier(f.actor, barrier, { channel: "AGENT_TOOL" }), "VALIDATION", 422);
  const futureTarget = CampaignAgentCommandSchema.parse({ ...pending, expectedAgentRevision: freshView.retained!.revision + 10 });
  await reject(executeCampaignAgentRecoveryBarrier(f.actor, { ...barrier, target: target(f.actor, futureTarget) }, form), "VALIDATION", 422);
  // Immutable structural rows do not establish a real fence. Both examples
  // have valid exact hashes/scalar maps and lie within today's native horizon,
  // but contradict the target producer or the barrier's own captured horizon.
  const falseFencedCommands = [
    { label: "FENCED contradicts an actually committed original", command: CampaignAgentBarrierCommandSchema.parse({ ...actualCommitted.command, operationKey: key() }) },
    { label: "FENCED target revision lies beyond its captured barrier revision", command: CampaignAgentBarrierCommandSchema.parse({
      ...actualCommitted.command, operationKey: key(), target: target(f.actor, pending) }) },
  ];
  expect(falseFencedCommands[1]!.command.target.expectedAgentRevision).toBeGreaterThan(falseFencedCommands[1]!.command.expectedAgentRevision);
  expect(falseFencedCommands[1]!.command.target.expectedAgentRevision).toBeLessThanOrEqual(freshView.retained!.revision);
  const actualBarrierRow = (await stored("CampaignAgentCommand", firstId)).find(item => item.operationKey === actualCommitted.command.operationKey)!;
  const forged: Array<typeof falseFencedCommands[number] & { commandHash: string }> = [];
  for (const item of falseFencedCommands) {
    const receipt = CampaignAgentBarrierReceiptSchema.parse({ action: "RECOVERY_BARRIER", agentId: actualCommitted.result.agentId,
      campaignId: firstId, workspaceId: actualCommitted.result.workspaceId, agentRevision: item.command.expectedAgentRevision + 1,
      campaignRevision: item.command.expectedSnapshot.campaignRevision, planningRevision: item.command.expectedSnapshot.planningRevision,
      targetOperationKey: item.command.target.operationKey, targetCommandHash: item.command.target.commandHash, targetOutcome: "FENCED", originalReceipt: null });
    const commandHash = canonicalHash({ domain: "infame-campaign-agent-recovery-barrier-v1", actorUserId: f.user.id, command: item.command });
    await prisma.$executeRaw`INSERT INTO "CampaignAgentCommand" (id,"actorUserId","operationKey","agentId","campaignId","workspaceId",action,"payloadHash",result,"createdAt")
      VALUES (${key()},${f.user.id},${item.command.operationKey}::uuid,${receipt.agentId},${firstId},${receipt.workspaceId},${receipt.action},${commandHash},${JSON.stringify(receipt)}::jsonb,${(actualBarrierRow.createdAt as Date).toISOString()}::timestamp(3))`;
    forged.push({ ...item, commandHash });
  }
  const beforeFalseFences = await raw(firstId);
  const replayChecks = await Promise.allSettled(forged.flatMap(item => [
    executeCampaignAgentRecoveryBarrier(f.actor, item.command, form),
    getCampaignAgentCommandOutcome(f.actor, { scope: f.scope, campaignId: firstId, target: { kind: "RECOVERY_BARRIER", command: item.command, commandHash: item.commandHash } }),
  ]));
  expect(await raw(firstId)).toEqual(beforeFalseFences);
  expect(replayChecks.map((outcome, index) => ({ label: forged[Math.floor(index / 2)]!.label, path: index % 2 ? "outcome" : "barrier replay",
    code: outcome.status === "rejected" ? (outcome.reason as { code?: unknown }).code : "ACCEPTED",
    status: outcome.status === "rejected" ? (outcome.reason as { status?: unknown }).status : 0 }))).toEqual(
    forged.flatMap(item => ["barrier replay", "outcome"].map(path => ({ label: item.label, path, code: "INVALID_STORED_AGENT", status: 503 }))));
  // The original CLIENT authority on the enclosing barrier is a separate pin
  // from the original command target. Both members actually hold view+plan,
  // but the observer's own actor cannot substitute the other's identity tuple.
  const clientAgency = await agency(f), clientId = await fresh(clientAgency.seat.actor, clientAgency.scope);
  await initialize(clientAgency.seat.actor, clientAgency.scope, clientId);
  const clientOriginal = await inputFor(clientAgency.seat.actor, clientAgency.scope, clientId, "SET_PREFERENCES", { preferences });
  const legitimateClientBarrier = await barrierInput(clientAgency.seat.actor, clientAgency.scope, clientId, clientOriginal);
  const clientReceipt = await executeCampaignAgentRecoveryBarrier(clientAgency.seat.actor, legitimateClientBarrier, form);
  const otherAuthority = await getClientAuthority(clientAgency.other.actor, clientAgency.client.id, "plan");
  const wrongOuter = CampaignAgentBarrierCommandSchema.parse({ ...legitimateClientBarrier, operationKey: key(), expectedAuthority: otherAuthority });
  const legitimateTargetAuthority = "expectedAuthority" in legitimateClientBarrier.target ? legitimateClientBarrier.target.expectedAuthority : undefined;
  expect(wrongOuter.target.expectedAuthority?.membershipId).toBe(legitimateTargetAuthority?.membershipId);
  expect(wrongOuter.expectedAuthority?.membershipId).not.toBe(legitimateClientBarrier.expectedAuthority?.membershipId);
  const { replayed: clientOnlyResult, ...clientScalarReceipt } = clientReceipt; void clientOnlyResult;
  const clientProducer = (await stored("CampaignAgentCommand", clientId)).find(item => item.operationKey === legitimateClientBarrier.operationKey)!;
  const wrongOuterHash = canonicalHash({ domain: "infame-campaign-agent-recovery-barrier-v1", actorUserId: clientAgency.seat.user.id, command: wrongOuter });
  await prisma.$executeRaw`INSERT INTO "CampaignAgentCommand" (id,"actorUserId","operationKey","agentId","campaignId","workspaceId",action,"payloadHash",result,"createdAt")
    VALUES (${key()},${clientAgency.seat.user.id},${wrongOuter.operationKey}::uuid,${clientReceipt.agentId},${clientId},${clientReceipt.workspaceId},${clientReceipt.action},${wrongOuterHash},${JSON.stringify(clientScalarReceipt)}::jsonb,${(clientProducer.createdAt as Date).toISOString()}::timestamp(3))`;
  const beforeWrongOuter = await raw(clientId);
  await reject(getCampaignAgentCommandOutcome(clientAgency.seat.actor, { scope: clientAgency.scope, campaignId: clientId,
    target: { kind: "RECOVERY_BARRIER", command: wrongOuter, commandHash: wrongOuterHash } }), "STALE_VERSION");
  expect(await raw(clientId)).toEqual(beforeWrongOuter);
  const expiry = await company(), expiryId = await fresh(expiry.actor, expiry.scope); await initialize(expiry.actor, expiry.scope, expiryId);
  const lost = await inputFor(expiry.actor, expiry.scope, expiryId, "APPEND_TEXT", { originalText: { text: "Synthetic expired recovery work", language: "en" } });
  const expiryBarrier = await barrierInput(expiry.actor, expiry.scope, expiryId, lost), expiresAt = new Date(Date.now() + 2500);
  await prisma.authSession.update({ where: { id: expiry.actor.sessionId }, data: { expiresAt } });
  const beforeExpiry = await raw(expiryId), heldExpiry = await blocker("CampaignAgentCommand", null), expiring = executeCampaignAgentRecoveryBarrier(expiry.actor, expiryBarrier, form); void expiring.catch(() => {});
  try {
    expect(await Promise.race([heldExpiry.wait(), expiring.then(() => { throw new Error("Barrier ended before actual expiry journal wait"); })])).toBeGreaterThan(0);
    expect(Date.now()).toBeLessThan(expiresAt.getTime()); while (Date.now() <= expiresAt.getTime()) await delay(Math.min(50, expiresAt.getTime() - Date.now() + 1));
    expect(await resolveSession(expiry.token)).toBeNull(); heldExpiry.release(); await heldExpiry.holding;
    await reject(expiring, "UNAUTHENTICATED", 401); expect(await raw(expiryId)).toEqual(beforeExpiry);
    await reject(executeCampaignAgentRecoveryBarrier(expiry.actor, { malformed: true }, { channel: "AGENT_TOOL" }), "UNAUTHENTICATED", 401);
  } finally { await heldExpiry.close(); await expiring.catch(() => {}); }
  const journal = (await stored("CampaignAgentCommand", empty)).find(item => item.action === "RECOVERY_BARRIER")!;
  noWords(journal.result, "Synthetic delayed original behind fence");
  expect((journal.result as { replayed?: boolean }).replayed).toBeUndefined();
}, 120000);
