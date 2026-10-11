// Preparation only. Root adopts/runs on the guarded disposable native target.
// Real auth and ledger reserve/claim rows; provider declarations are synthetic.
// Never call a ledger/domain wrapper inside an aggregate transaction. No tokens,
// real provider traffic, pricing claims or raw source words are printed.
import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { afterEach, beforeAll, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { createAiBudgetLedger } from "@/lib/ai-budget/ledger";
import { AiLedgerMetadataSchema, ReserveAiSchema, type AiActor } from "@/lib/ai-budget/contracts";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { executeCampaignPlanningCommand } from "@/lib/campaign-planning/service";
import { executeCampaignAgentCommand, getCampaignAgent, getCampaignAgentTextSources } from "@/lib/campaign-agent/service";
import { CampaignAgentFieldKeys } from "@/lib/campaign-agent/contracts";
import { CampaignAgentBatchSchema, type CampaignAgentBatch } from "@/lib/campaign-agent/native-contracts";
import { CampaignFieldsSchema } from "@/lib/campaigns/contracts";
import { campaignFields } from "@/../tests/campaigns/fixtures";
import { COMMERCIAL_POLICY_VERSION, PLANNING_PLANS } from "@/lib/commercial/contracts";
import { PlanningAiSessionSchema, PlanningAiOperationSchema } from "@/lib/planning/contracts";
import { PlanningScopeFingerprintSchema, PlanningAiRequestSchema, PlanningProviderWireSchema, PlanningRetainedContentSchema,
  planningScopeFingerprintHash, planningRequestHash,
  type PlanningScopeFingerprint } from "@/lib/planning/output-contracts";

type Table = "PlanningAiPool" | "PlanningAiEnrollment" | "PlanningAiSeat" | "PlanningAiCycle" | "PlanningAiSession"
  | "PlanningAiOperation" | "PlanningAiAttempt" | "PlanningAiResult";
type Db = PrismaClient | Prisma.TransactionClient;
type Fields = Record<string, unknown>;
const users = new Set<string>(), brands = new Set<string>(), campaigns = new Set<string>();
const retainedUsers = new Set<string>(), retainedBrands = new Set<string>(), retainedCampaigns = new Set<string>();
const key = (prefix: string) => prefix + "~*:" + randomUUID();
const syntheticHash = (input: unknown) => canonicalHash({ domain: "synthetic-planning-storage-evidence", input });
const tables = ["PlanningAiAttempt", "PlanningAiResult"] as const;
const jsonColumns = new Set(["request", "scopeFingerprint", "pricing", "knownFailureEvidenceJson", "executionEvidenceJson", "terminalEvidenceJson", "content"]);
const pricing = { version: "synthetic-planning-price-v1", modelId: "synthetic-planning-model", asOf: "2026-10-11", currency: "USD",
  prices: [{ unit: "INPUT_TOKENS", quantity: "1000000", priceMicros: "1" }] };

beforeAll(async () => {
  const taskId = process.env.INFAME_TASK_ID;
  if (!taskId || !/^infame_[a-f0-9]{12}$/.test(taskId) || process.env.INFAME_ENV !== "test" || process.env.NODE_ENV === "production") throw new Error("Planning result storage requires guarded test task");
  const rows = await prisma.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]?.id !== taskId || rows[0]?.kind !== "test" || rows[0]?.db !== taskId + "_test" || rows[0]?.host !== "127.0.0.1") throw new Error("Planning result storage target mismatch");
});
async function requireStorage() {
  for (const name of tables) {
    const rows = await prisma.$queryRaw<Array<{ present: boolean }>>`SELECT to_regclass(${`"${name}"`}) IS NOT NULL AS present`;
    expect(rows[0]?.present === true, "Frozen native result table must exist: " + name).toBe(true);
  }
}
function sqlValue(table: Table, column: string, input: unknown) {
  if (input === null) return Prisma.sql`NULL`;
  if (input instanceof Date) return Prisma.sql`${input.toISOString()}::timestamp(3)`;
  if (jsonColumns.has(column)) return Prisma.sql`${JSON.stringify(input)}::jsonb`;
  if (table === "PlanningAiSession" && column === "scope") return Prisma.sql`${input}::"PlanningWorkspaceScope"`;
  if ((table === "PlanningAiSession" && column === "creationKey") || (table === "PlanningAiAttempt" && column === "operationKey")) return Prisma.sql`${input}::uuid`;
  return Prisma.sql`${input}`;
}
async function insert(db: Db, table: Table, fields: Fields) {
  const entries = Object.entries(fields);
  await db.$executeRaw(Prisma.sql`INSERT INTO ${Prisma.raw('"' + table + '"')}
    (${Prisma.join(entries.map(([column]) => Prisma.raw('"' + column + '"')))}) VALUES
    (${Prisma.join(entries.map(([column, input]) => sqlValue(table, column, input)))})`);
}
async function patch(db: Db, table: Table, id: string, fields: Fields) {
  await db.$executeRaw(Prisma.sql`UPDATE ${Prisma.raw('"' + table + '"')} SET
    ${Prisma.join(Object.entries(fields).map(([column, input]) => Prisma.sql`${Prisma.raw('"' + column + '"')}=${sqlValue(table, column, input)}`))} WHERE id=${id}`);
}
async function row(db: Db, table: Table, id: string) {
  return (await db.$queryRaw<Fields[]>(Prisma.sql`SELECT * FROM ${Prisma.raw('"' + table + '"')} WHERE id=${id}`))[0];
}
async function constrained(tx: Prisma.TransactionClient, operation: () => Promise<unknown>, codes: readonly string[] = ["23514"]) {
  await tx.$executeRaw`SAVEPOINT planning_attempt_witness`;
  let error: unknown = null; try { await operation(); } catch (failure) { error = failure; }
  await tx.$executeRaw`ROLLBACK TO SAVEPOINT planning_attempt_witness`;
  await tx.$executeRaw`RELEASE SAVEPOINT planning_attempt_witness`;
  expect(error instanceof Prisma.PrismaClientKnownRequestError).toBe(true);
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw new Error("Expected native planning attempt rejection");
  expect(error.code).toBe("P2010"); expect(codes).toContain(String(error.meta?.code));
}
async function rollback(action: (tx: Prisma.TransactionClient) => Promise<void>) {
  const sentinel = new Error("Deliberate whole planning attempt fixture rollback");
  try {
    await prisma.$transaction(async tx => { await action(tx); throw sentinel; }, { maxWait: 10000, timeout: 60000 });
    throw new Error("Planning result fixture must not commit");
  } catch (error) { if (error !== sentinel) throw error; }
}
async function person(role: "BRAND" | "ADMIN" = "BRAND") {
  const id = randomUUID(); users.add(id);
  const user = await prisma.user.create({ data: { id, role, active: true, isTest: true, name: "Synthetic planning storage actor",
    email: id + "@example.invalid", passwordHash: "not-a-login-hash", emailVerifiedAt: new Date(Date.now() - 60000) } });
  const token = await openSession(user.id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Owned native planning storage session did not resolve");
  const actor: AiActor = { userId: session.userId, role: session.role, sessionVersion: session.sessionVersion, sessionId: session.sessionId };
  return { user, actor: Object.freeze(actor) };
}
async function company(initialFields: unknown = {}, confirmComplete = false) {
  const owner = await person();
  const brand = await prisma.brand.create({ data: { userId: owner.user.id, slug: "attempt-" + randomUUID().replace(/-/g, "").slice(0, 16),
    name: "Synthetic planning storage brand", isTest: true } }); brands.add(brand.id);
  const scope = { kind: "OWN_BRAND" as const, brandId: brand.id };
  const created = await executeCampaignPlanningCommand(owner.actor, { operationKey: randomUUID(), scope, action: "CREATE",
    expectedCampaignRevision: 0, expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0,
    payload: { fields: initialFields, selection: { kind: "NONE" }, narrative: null } }); campaigns.add(created.campaignId);
  for (const [action, payload] of [["INITIALIZE", { preferences: { input: "TEXT", output: "TEXT" } }],
    ["APPEND_TEXT", { originalText: { text: "Synthetic native storage source only", language: "en" } }]] as const) {
    const before = await getCampaignAgent(owner.actor, { scope, campaignId: created.campaignId });
    await executeCampaignAgentCommand(owner.actor, { operationKey: randomUUID(), scope, campaignId: created.campaignId,
      expectedAgentRevision: before.retained?.revision ?? 0, expectedSnapshot: before.current.snapshot, action, payload }, { channel: "FORM" });
  }
  let view = await getCampaignAgent(owner.actor, { scope, campaignId: created.campaignId });
  let confirmationBatch: CampaignAgentBatch | null = null;
  if (confirmComplete) {
    const complete = CampaignFieldsSchema.parse(view.current.fields);
    const fields = CampaignAgentFieldKeys.map(field => {
      const valueHash = canonicalHash({ domain: "infame-campaign-field-value-v1", field, value: complete[field] });
      return { field, valueHash, source: { kind: "CUSTOMER_FIELD_CHOICE", capturedValueHash: valueHash } };
    });
    await executeCampaignAgentCommand(owner.actor, { operationKey: randomUUID(), scope, campaignId: created.campaignId, action: "CONFIRM_FIELDS",
      expectedAgentRevision: view.retained!.revision, expectedSnapshot: view.current.snapshot, payload: { fields } }, { channel: "FORM" });
    view = await getCampaignAgent(owner.actor, { scope, campaignId: created.campaignId });
    if (view.coverage !== "CURRENT" || view.retained?.confirmation.kind !== "REVIEWED_SET") throw new Error("Actual complete customer confirmation required");
    const rows = await prisma.$queryRaw<Array<{ content: unknown; contentHash: string }>>`SELECT content,"contentHash" FROM "CampaignAgentConfirmationBatch"
      WHERE id=${view.retained.confirmation.confirmationBatchId} AND "agentId"=${view.retained.id}
        AND "campaignId"=${view.binding.campaignId} AND "workspaceId"=${view.binding.workspaceId}`;
    if (rows.length !== 1) throw new Error("Actual scoped customer confirmation batch required");
    confirmationBatch = CampaignAgentBatchSchema.parse(rows[0]!.content);
    expect(confirmationBatch.contentHash === rows[0]!.contentHash).toBe(true);
    expect(confirmationBatch.confirmations.map(item => item.field)).toEqual(CampaignAgentFieldKeys);
  }
  const sources = await getCampaignAgentTextSources(owner.actor, { scope, campaignId: created.campaignId });
  if (!view.retained || !sources.sources[0]) throw new Error("Owned actual agent/source fixture required");
  return { ...owner, brand, scope, view, confirmationBatch, source: { id: sources.sources[0].id, sourceHash: sources.sources[0].sourceHash } };
}
type Company = Awaited<ReturnType<typeof company>>;
function ids() { return { poolId: key("pool"), enrollmentId: key("enrollment"), cycleId: key("cycle"), seatId: key("seat"), sessionId: key("session") }; }
type Ids = ReturnType<typeof ids>;
type Slot = { id: string; kind: PlanningScopeFingerprint["operation"]["kind"]; ordinal: number };
function fingerprint(f: Company, p: Ids, op: Slot): PlanningScopeFingerprint {
  return PlanningScopeFingerprintSchema.parse({ schemaVersion: 1, binding: f.view.binding, brandId: f.brand.id, organizationId: null, clientId: null,
    actor: { userId: f.actor.userId, role: "BRAND", sessionVersion: f.actor.sessionVersion },
    brandOwner: { userId: f.user.id, sessionVersion: f.user.sessionVersion }, authority: null,
    pool: { id: p.poolId, scope: "OWN_BRAND", brandId: f.brand.id, organizationId: null },
    enrollment: { id: p.enrollmentId, revision: 1, subscriberUserId: f.user.id }, seat: { id: p.seatId, userId: f.user.id, revision: 1, membershipId: null },
    cycle: { id: p.cycleId, startsAt: new Date(Date.now() - 60000).toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString(),
      planId: "STARTER", policyVersion: COMMERCIAL_POLICY_VERSION, priceVersion: "synthetic-attempt-price-v1" },
    sessionId: p.sessionId, operation: { ...op, selectedArtifacts: [] },
    agent: { id: f.view.retained!.id, revision: f.view.retained!.revision, stateHash: f.view.retained!.stateHash },
    snapshot: f.view.current.snapshot, context: null, sources: [f.source], confirmation: op.kind === "BRIEF" && f.confirmationBatch ? {
      batchId: f.confirmationBatch.id, batchHash: f.confirmationBatch.contentHash, reviewedSnapshot: f.confirmationBatch.reviewedSnapshot,
      fields: f.confirmationBatch.confirmations.map(item => ({ field: item.field, id: item.id,
        valueHash: item.valueHash, confirmationHash: item.confirmationHash })) } : null });
}
async function claimed(f: Company, fp: PlanningScopeFingerprint, sequence = 1) {
  const id = randomUUID(), operationKey = randomUUID().toUpperCase();
  const request = PlanningAiRequestSchema.parse({ schemaVersion: 1, operationKey, sessionId: fp.sessionId, kind: fp.operation.kind,
    ordinal: fp.operation.ordinal, expectedFingerprintHash: planningScopeFingerprintHash(fp), sourceMessage: f.source,
    requestedLanguage: null, selectedArtifacts: [] });
  const requestHash = planningRequestHash(f.actor.userId, request);
  const command = ReserveAiSchema.parse({ operationKey: randomUUID(), purpose: fp.operation.kind === "REPLY" ? "CAMPAIGN_CHAT" : fp.operation.kind === "BRIEF" ? "BRIEF" : "CONTENT_THEME",
    payloadHash: syntheticHash({ requestHash }), reservedMicros: "1", pricing, context: { resourceType: "JOB", resourceId: id, sourceRevision: fp.agent.revision }, executionTimeoutMs: 300000 });
  const service = createAiBudgetLedger({ caps: { userDailyMicros: "1000000", platformDailyMicros: "10000000" } });
  const reserved = await service.reserve(f.actor, command), execution = await service.claim(f.actor, reserved.reservation.id);
  const reservation = await prisma.aiReservation.findUniqueOrThrow({ where: { id: execution.reservationId } });
  const metadata = AiLedgerMetadataSchema.parse(reservation.result);
  if (!metadata.executionTokenHash || !metadata.claimedAt || !metadata.deadlineAt) throw new Error("Actual immutable ledger claim required");
  const at = new Date();
  const record: Fields & { id: string } = { id, operationId: fp.operation.id, sessionId: fp.sessionId, poolId: fp.pool.id, seatId: fp.seat.id,
    actorUserId: f.actor.userId, actorRole: "BRAND", actorSessionVersion: f.actor.sessionVersion, operationKey, sequence,
    request, requestHash, scopeFingerprint: fp, scopeFingerprintHash: planningScopeFingerprintHash(fp), payloadHash: command.payloadHash,
    ledgerRequestHash: metadata.requestHash, reservationId: execution.reservationId, ledgerOperationKey: command.operationKey,
    ledgerPurpose: command.purpose, pricing: command.pricing, pricingHash: canonicalHash(command.pricing), reservedMicros: BigInt(command.reservedMicros),
    executionTimeoutMs: command.executionTimeoutMs, executionTokenHash: metadata.executionTokenHash,
    claimedAt: new Date(metadata.claimedAt), deadlineAt: new Date(metadata.deadlineAt), registryVersion: "synthetic-registry-v1",
    state: "RUNNING", knownFailureEvidenceJson: null, executionEvidenceJson: null, providerRequestId: null,
    revision: 1, createdAt: at, updatedAt: at };
  const confirmedFields = fp.operation.kind === "BRIEF" && f.confirmationBatch
    ? CampaignFieldsSchema.parse(Object.fromEntries(f.confirmationBatch.confirmations.map(item => [item.field, item.value]))) : null;
  return { fp, record, service, execution, command, confirmedFields };
}
async function parents(tx: Prisma.TransactionClient, f: Company, p: Ids, fp: PlanningScopeFingerprint, slots: Slot[]) {
  const at = new Date(Date.now() - 1000), plan = PLANNING_PLANS[0];
  await insert(tx, "PlanningAiPool", { id: p.poolId, scope: "OWN_BRAND", brandId: f.brand.id, organizationId: null, state: "ACTIVE", revision: 1, createdAt: at, updatedAt: at });
  const terms = { planId: plan.id, policyVersion: COMMERCIAL_POLICY_VERSION, priceVersion: fp.cycle.priceVersion,
    netAmountMinor: BigInt(plan.netMonthly.amountMinor), currency: "SAR" };
  await insert(tx, "PlanningAiEnrollment", { id: p.enrollmentId, poolId: p.poolId, acceptingOwnerUserId: f.user.id, subscriberUserId: f.user.id,
    kind: "PAID", ...terms, state: "ACTIVE", revision: 1, acceptanceReference: key("synthetic-acceptance"), acceptanceHash: syntheticHash(p), acceptedAt: at, createdAt: at, updatedAt: at });
  await insert(tx, "PlanningAiSeat", { id: p.seatId, poolId: p.poolId, userId: f.user.id, organizationId: null, membershipId: null, state: "ACTIVE", revision: 1, createdAt: at, updatedAt: at });
  await insert(tx, "PlanningAiCycle", { id: p.cycleId, poolId: p.poolId, enrollmentId: p.enrollmentId, trialClaimId: null, source: "MERCHANT",
    sourceEventId: key("synthetic-event"), subscriptionId: key("synthetic-subscription"), ...terms, allowance: plan.sessions, held: 0, consumed: 0,
    state: "ACTIVE", revision: 1, startsAt: new Date(fp.cycle.startsAt), endsAt: new Date(fp.cycle.endsAt), createdAt: at, updatedAt: at });
  await insert(tx, "PlanningAiSession", { id: p.sessionId, poolId: p.poolId, cycleId: p.cycleId, scope: "OWN_BRAND", brandId: f.brand.id,
    organizationId: null, clientId: null, workspaceId: f.view.binding.workspaceId, campaignId: f.view.binding.campaignId, agentId: f.view.retained!.id,
    createdByUserId: f.user.id, creationSeatId: p.seatId, creationKey: randomUUID(), allowanceState: "HELD", firstAttachedResultId: null,
    revision: 1, createdAt: at, updatedAt: at });
  for (const op of slots) await insert(tx, "PlanningAiOperation", { ...op, sessionId: p.sessionId, state: "OPEN", successfulResultId: null, revision: 1, createdAt: at, updatedAt: at });
}
type Run = Awaited<ReturnType<typeof claimed>>;
function retain(f: Company) { retainedUsers.add(f.user.id); retainedBrands.add(f.brand.id); retainedCampaigns.add(f.view.binding.campaignId); }
async function prelock(tx: Prisma.TransactionClient, f: Company, p: Ids, sessionIds: string[], runs: Run[]) {
  await tx.$queryRaw`SELECT id FROM "PlanningWorkspace" WHERE id=${f.view.binding.workspaceId} FOR KEY SHARE`;
  await tx.$queryRaw`SELECT "campaignId" FROM "CampaignPlanningBinding" WHERE "campaignId"=${f.view.binding.campaignId} FOR KEY SHARE`;
  await tx.$queryRaw`SELECT id FROM "CampaignAgent" WHERE id=${f.view.retained!.id} FOR KEY SHARE`;
  await tx.$queryRaw`SELECT id FROM "PlanningAiPool" WHERE id=${p.poolId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "PlanningAiEnrollment" WHERE id=${p.enrollmentId} FOR UPDATE`;
  const seatIds = [...new Set(runs.map(run => String(run.record.seatId)))].sort();
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "PlanningAiSeat" WHERE id IN (${Prisma.join(seatIds)}) ORDER BY id FOR UPDATE`);
  await tx.$queryRaw`SELECT id FROM "PlanningAiCycle" WHERE id=${p.cycleId} FOR UPDATE`;
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "PlanningAiSession" WHERE id IN (${Prisma.join([...sessionIds].sort())}) ORDER BY id FOR UPDATE`);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "PlanningAiOperation" WHERE id IN (${Prisma.join([...new Set(runs.map(run => String(run.record.operationId)))].sort())}) ORDER BY id FOR UPDATE`);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "PlanningAiAttempt" WHERE id IN (${Prisma.join(runs.map(run => run.record.id).sort())}) ORDER BY id FOR UPDATE`);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "AiReservation" WHERE id IN (${Prisma.join(runs.map(run => run.execution.reservationId).sort())}) ORDER BY id FOR UPDATE`);
}
async function terminal(run: Run, executionBasis = "PROVIDER_TERMINAL_RESPONSE") {
  const ledgerRow = await prisma.aiReservation.findUniqueOrThrow({ where: { id: run.execution.reservationId } });
  const meta = AiLedgerMetadataSchema.parse(ledgerRow.result);
  const execution = { executionBasis, reference: key("synthetic-terminal-declaration"), evidenceHash: syntheticHash(run.record.id),
    resolvedAt: new Date().toISOString(), reservationId: run.execution.reservationId };
  if (ledgerRow.status === "SETTLED" && meta.settlementHash && ledgerRow.actualMicros !== null)
    return { ...execution, billingBasis: { kind: "SETTLED", settlementHash: meta.settlementHash, actualMicros: ledgerRow.actualMicros.toString() } };
  if (ledgerRow.status === "RELEASED" && meta.noCallReason)
    return { ...execution, billingBasis: { kind: "RELEASED", noCallReason: meta.noCallReason } };
  throw new Error("Actual terminal ledger evidence required");
}
function executionPart(evidence: Awaited<ReturnType<typeof terminal>>) {
  const { billingBasis: billing, ...execution } = evidence; void billing; return execution;
}
async function settleZero(run: Run) {
  await run.service.settle(run.execution.executionToken, { reservationId: run.execution.reservationId, actualMicros: "0",
    usage: [{ unit: "INPUT_TOKENS", quantity: "0" }], pricing });
}
async function attached(run: Run, evidence: Awaited<ReturnType<typeof terminal>>, id = key("result")) {
  const wire = PlanningProviderWireSchema.parse(run.fp.operation.kind === "BRIEF" ? { kind: "BRIEF", narrative: {
    overview: { text: "  مسودة تخزين اصطناعية\nSynthetic assisted narrative  ", language: "ar" },
    requirementsExplanation: { text: "Synthetic explanation; customer fields remain separate and unchanged.", language: "en" }, hypotheses: [], openQuestions: [] } }
    : { kind: "REPLY", reply: { text: "Synthetic storage assistant declaration", language: "en" }, proposals: [], recommendations: [], openQuestions: [] });
  const providerText = "\n  " + JSON.stringify(wire, null, 2) + "\n";
  let output: unknown = wire;
  if (wire.kind === "BRIEF") {
    if (!run.confirmedFields || !run.fp.confirmation) throw new Error("Native confirmed customer fields required for BRIEF enrichment");
    output = { ...wire, customerFields: run.confirmedFields, fieldsHash: run.fp.snapshot.fieldsHash,
      confirmationBatchId: run.fp.confirmation.batchId, confirmationBatchHash: run.fp.confirmation.batchHash,
      binding: run.fp.binding, snapshot: run.fp.snapshot, sources: run.fp.sources };
  }
  const content = PlanningRetainedContentSchema.parse({ schemaVersion: 1, attemptId: run.record.id, operationId: run.fp.operation.id,
    sessionId: run.fp.sessionId, binding: run.fp.binding, snapshot: run.fp.snapshot, scopeFingerprintHash: planningScopeFingerprintHash(run.fp),
    provider: { id: "ANTHROPIC", modelId: pricing.modelId, registryVersion: run.record.registryVersion, requestId: null }, output });
  return { id, attemptId: run.record.id, operationId: run.fp.operation.id, sessionId: run.fp.sessionId, poolId: run.fp.pool.id,
    disposition: "ATTACHED", outputHash: createHash("sha256").update(providerText, "utf8").digest("hex"), wireHash: canonicalHash(wire),
    providerRequestId: null, content, contentHash: canonicalHash(content), reasonCode: null, terminalEvidenceJson: evidence, createdAt: new Date() };
}
async function finalizeRetained(f: Company, p: Ids, sessionIds: string[], runs: Run[], admin?: AiActor) {
  // Ledger wrappers finish before any planning parent/reservation lock. A known
  // synthetic storage declaration is not represented as genuine provider proof.
  const evidence = new Map<string, Awaited<ReturnType<typeof terminal>>>();
  for (const run of runs) {
    const ledgerRow = await prisma.aiReservation.findUniqueOrThrow({ where: { id: run.execution.reservationId } });
    if (ledgerRow.status === "UNKNOWN") {
      if (!admin) throw new Error("Owned native admin required to finalize uncertain billing fixture");
      await run.service.reconcile(admin, { reservationId: run.execution.reservationId,
        reviewReference: "synthetic-finalize-" + randomUUID(), resolution: { kind: "CHARGE", actualMicros: "0",
          usage: [{ unit: "INPUT_TOKENS", quantity: "0" }], pricing } });
    } else if (ledgerRow.status === "RUNNING")
      await run.service.releaseKnownNoCall(run.execution.executionToken, { reservationId: run.execution.reservationId, reason: "FAILED_BEFORE_INVOCATION" });
    const finished = await prisma.aiReservation.findUniqueOrThrow({ where: { id: run.execution.reservationId } });
    const meta = AiLedgerMetadataSchema.parse(finished.result);
    evidence.set(run.record.id, await terminal(run, finished.status === "RELEASED"
      ? meta.noCallReason === "PROVIDER_CONFIRMED_NO_CALL" ? "PROVIDER_CONFIRMED_NO_CALL" : "TRUSTED_PRE_CALL_STOP"
      : "PROVIDER_TERMINAL_RESPONSE"));
  }
  await prisma.$transaction(async tx => {
    await prelock(tx, f, p, sessionIds, runs);
    for (const run of runs) {
      const saved = await row(tx, "PlanningAiAttempt", run.record.id);
      if (saved?.state === "RUNNING" || saved?.state === "UNKNOWN") {
        const proof = evidence.get(run.record.id)!;
        await patch(tx, "PlanningAiAttempt", run.record.id, { state: "FAILED_KNOWN", revision: Number(saved.revision) + 1,
          updatedAt: new Date(), executionEvidenceJson: executionPart(proof), knownFailureEvidenceJson: proof });
      }
    }
    for (const sessionId of sessionIds) {
      const saved = await row(tx, "PlanningAiSession", sessionId);
      if (saved?.allowanceState === "HELD") await patch(tx, "PlanningAiSession", sessionId,
        { allowanceState: "RELEASED", revision: Number(saved.revision) + 1, updatedAt: new Date() });
    }
    await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
  }, { timeout: 60000 });
  expect(await row(prisma, "PlanningAiCycle", p.cycleId)).toMatchObject({ held: 0, consumed: 0 });
}

afterEach(async () => {
  const discardedUsers = [...users].filter(id => !retainedUsers.has(id)), discardedBrands = [...brands].filter(id => !retainedBrands.has(id)),
    discardedCampaigns = [...campaigns].filter(id => !retainedCampaigns.has(id));
  if (!discardedUsers.length) { users.clear(); brands.clear(); campaigns.clear(); return; }
  // Every planning principal/attempt in group1 is already rolled back. These are
  // only owned ordinary producer/auth/ledger rows, whose existing cleanup allows
  // deletion; no PlanningAi* retained-history guard is bypassed or disabled.
  if (discardedCampaigns.length) for (const table of ["CampaignAgentCommand", "CampaignAgentConfirmationBatch", "CampaignAgentTextSource", "CampaignAgent"])
    await prisma.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "campaignId" IN (${Prisma.join(discardedCampaigns)})`);
  const workspaces = await prisma.planningWorkspace.findMany({ where: { brandId: { in: discardedBrands } }, select: { id: true } });
  if (workspaces.length) {
    const workspaceIds = workspaces.map(item => item.id);
    for (const table of ["PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission", "CampaignBriefProvenance", "CampaignProposalDependency",
      "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding", "BrandContextVersion", "BrandContextSubmission", "BrandContext"])
      await prisma.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join(workspaceIds)})`);
    await prisma.planningWorkspace.deleteMany({ where: { id: { in: workspaceIds } } });
  }
  await prisma.campaign.deleteMany({ where: { id: { in: discardedCampaigns } } });
  await prisma.aiReservation.deleteMany({ where: { userId: { in: discardedUsers } } });
  await prisma.brand.deleteMany({ where: { id: { in: discardedBrands } } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: discardedUsers } } });
  await prisma.outboxEvent.deleteMany({ where: { OR: discardedUsers.map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await prisma.user.deleteMany({ where: { id: { in: discardedUsers } } });
  users.clear(); brands.clear(); campaigns.clear();
});

it("attaches synthetic terminal output atomically with immediate bulk counters, immutable first pointers and all fourteen bounded inclusion slots", async () => {
  await requireStorage();
  const declaredRow = async (db: Db, table: "PlanningAiSession" | "PlanningAiOperation", id: string) => {
    const stored = await row(db, table, id);
    if (!stored) throw new Error("Actual native planning state row required");
    return Object.fromEntries(Object.entries(stored).map(([field, value]) => [field, value instanceof Date ? value.toISOString() : value]));
  };
  const completeFields = CampaignFieldsSchema.parse({ ...campaignFields, title: "  متطلبات أصلية\nOriginal confirmed requirements  ",
    impressionsTarget: null, budget: { amountMinor: "9223372036854775807", currencyCode: "KWD" } });
  const f = await company(completeFields, true), p = ids(), secondSessionId = key("second-session");
  const a: Slot = { id: key("operation"), kind: "REPLY", ordinal: 1 }, b: Slot = { id: key("operation"), kind: "REPLY", ordinal: 1 },
    later: Slot = { id: key("operation"), kind: "BRIEF", ordinal: 1 };
  const fp = fingerprint(f, p, a), fp2 = fingerprint(f, { ...p, sessionId: secondSessionId }, b); fp2.cycle = fp.cycle;
  const laterFp = fingerprint(f, p, later); laterFp.cycle = fp.cycle;
  const first = await claimed(f, fp), second = await claimed(f, fp2), subsequent = await claimed(f, laterFp);
  const runs = [first, second, subsequent], sessionIds = [p.sessionId, secondSessionId];
  await prisma.$transaction(async tx => {
    await parents(tx, f, p, fp, [a, later]);
    const at = new Date();
    await insert(tx, "PlanningAiSession", { id: secondSessionId, poolId: p.poolId, cycleId: p.cycleId, scope: "OWN_BRAND", brandId: f.brand.id,
      organizationId: null, clientId: null, workspaceId: f.view.binding.workspaceId, campaignId: f.view.binding.campaignId, agentId: f.view.retained!.id,
      createdByUserId: f.user.id, creationSeatId: p.seatId, creationKey: randomUUID(), allowanceState: "HELD", firstAttachedResultId: null,
      revision: 1, createdAt: at, updatedAt: at });
    await insert(tx, "PlanningAiOperation", { ...b, sessionId: secondSessionId, state: "OPEN", successfulResultId: null, revision: 1, createdAt: at, updatedAt: at });
    for (const run of runs) await insert(tx, "PlanningAiAttempt", run.record);
  }, { timeout: 60000 }); retain(f);
  try {
    for (const run of runs) await settleZero(run);
    const firstResult = await attached(first, await terminal(first), key("result00")), secondResult = await attached(second, await terminal(second), key("result01")),
      laterResult = await attached(subsequent, await terminal(subsequent), key("result02"));
    firstResult.createdAt = secondResult.createdAt;
    expect(firstResult.outputHash).not.toBe(firstResult.wireHash); expect(firstResult.wireHash).not.toBe(firstResult.contentHash);
    expect(subsequent.command.purpose).toBe("BRIEF");
    expect(subsequent.record.ledgerPurpose).toBe("BRIEF");
    const assistedBrief = laterResult.content.output;
    if (assistedBrief.kind !== "BRIEF" || !subsequent.fp.confirmation) throw new Error("Actual confirmed BRIEF fixture required");
    expect(Object.keys(assistedBrief.customerFields)).toEqual(CampaignAgentFieldKeys);
    expect(assistedBrief.customerFields).toEqual(completeFields);
    expect(assistedBrief.customerFields.budget).toEqual({ amountMinor: "9223372036854775807", currencyCode: "KWD" });
    expect(assistedBrief.customerFields.impressionsTarget).toBeNull();
    expect(assistedBrief.customerFields.title).toBe(completeFields.title);
    expect(assistedBrief.confirmationBatchId).toBe(f.confirmationBatch!.id);
    expect(assistedBrief.confirmationBatchHash).toBe(f.confirmationBatch!.contentHash);
    const normalizedBriefWire = PlanningProviderWireSchema.parse({ kind: "BRIEF", narrative: assistedBrief.narrative });
    const exactBriefText = "\n  " + JSON.stringify(normalizedBriefWire, null, 2) + "\n";
    expect(laterResult.outputHash).toBe(createHash("sha256").update(exactBriefText, "utf8").digest("hex"));
    expect(laterResult.wireHash).toBe(canonicalHash(normalizedBriefWire));
    expect(laterResult.contentHash).toBe(canonicalHash(laterResult.content));
    expect(laterResult.outputHash).not.toBe(laterResult.wireHash);
    expect(laterResult.wireHash).not.toBe(laterResult.contentHash);
    await rollback(async tx => {
      await prelock(tx, f, p, sessionIds, runs); await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      const heldBefore = await declaredRow(tx, "PlanningAiSession", p.sessionId), openBefore = await declaredRow(tx, "PlanningAiOperation", a.id);
      expect(PlanningAiSessionSchema.parse(heldBefore)).toEqual(heldBefore);
      expect(PlanningAiOperationSchema.parse(openBefore)).toEqual(openBefore);
      for (const change of [{ wireHash: firstResult.contentHash }, { contentHash: syntheticHash("wrong retained hash") },
        { operationId: b.id }, { sessionId: secondSessionId }, { disposition: "ATTACHED", reasonCode: "INVALID_FIELD_VALUE" },
        { terminalEvidenceJson: { ...firstResult.terminalEvidenceJson, executionBasis: "TRUSTED_PRE_CALL_STOP" } }])
        await constrained(tx, () => insert(tx, "PlanningAiResult", { ...firstResult, ...change }), ["23514", "23503"]);
      // Keep claim, wire, raw-output and retained-content hashes coherent, so
      // these fail on the captured customer confirmation/value relationship.
      const wrongBatchOutputs = [{ ...assistedBrief, confirmationBatchId: key("wrong-native-batch") },
        { ...assistedBrief, confirmationBatchHash: syntheticHash("wrong native batch hash") }];
      for (const output of wrongBatchOutputs) {
        const content = { ...laterResult.content, output };
        await constrained(tx, () => insert(tx, "PlanningAiResult", { ...laterResult, content, contentHash: canonicalHash(content) }));
      }
      const rewrittenFields = CampaignFieldsSchema.parse({ ...assistedBrief.customerFields, budget: { amountMinor: "1", currencyCode: "KWD" } });
      const rewrittenFieldsHash = canonicalHash({ domain: "infame-campaign-fields-v1", fields: rewrittenFields });
      const rewrittenContent = { ...laterResult.content, output: { ...assistedBrief, customerFields: rewrittenFields,
        fieldsHash: rewrittenFieldsHash, snapshot: { ...assistedBrief.snapshot, fieldsHash: rewrittenFieldsHash } } };
      await constrained(tx, () => insert(tx, "PlanningAiResult", { ...laterResult, content: rewrittenContent, contentHash: canonicalHash(rewrittenContent) }));
      const wrongValueFingerprint = structuredClone(subsequent.fp);
      const budgetPin = wrongValueFingerprint.confirmation!.fields.find(pin => pin.field === "budget");
      if (!budgetPin) throw new Error("Actual complete budget confirmation pin required");
      budgetPin.valueHash = canonicalHash({ domain: "infame-campaign-field-value-v1", field: "budget", value: rewrittenFields.budget });
      const nativeBriefGrammar = await tx.$queryRaw<Array<{ good: boolean | null; wrongValuePin: boolean | null }>>`
        SELECT infame_planning_ai_brief(${JSON.stringify(assistedBrief)}::jsonb, ${JSON.stringify(subsequent.fp)}::jsonb) AS good,
          infame_planning_ai_brief(${JSON.stringify(assistedBrief)}::jsonb, ${JSON.stringify(wrongValueFingerprint)}::jsonb) AS "wrongValuePin"`;
      expect(nativeBriefGrammar[0]).toStrictEqual({ good: true, wrongValuePin: false });
      const results = [firstResult, secondResult], columns = Object.keys(firstResult);
      await tx.$executeRaw(Prisma.sql`INSERT INTO "PlanningAiResult" (${Prisma.join(columns.map(column => Prisma.raw('"' + column + '"')))})
        VALUES ${Prisma.join(results.map(result => Prisma.sql`(${Prisma.join(columns.map(column => sqlValue("PlanningAiResult", column, (result as unknown as Fields)[column])))})`))}`);
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      expect(await row(tx, "PlanningAiCycle", p.cycleId)).toMatchObject({ held: 0, consumed: 2 });
      expect(await row(tx, "PlanningAiSession", p.sessionId)).toMatchObject({ allowanceState: "CONSUMED", firstAttachedResultId: firstResult.id });
      expect(await row(tx, "PlanningAiSession", secondSessionId)).toMatchObject({ allowanceState: "CONSUMED", firstAttachedResultId: secondResult.id });
      for (const sessionId of sessionIds) {
        const consumed = await declaredRow(tx, "PlanningAiSession", sessionId);
        expect(PlanningAiSessionSchema.parse(consumed)).toEqual(consumed);
        for (const incoherent of [{ ...consumed, firstAttachedResultId: null }, { ...consumed, allowanceState: "HELD" },
          { ...consumed, allowanceState: "RELEASED" }, { ...heldBefore, allowanceState: "CONSUMED" }])
          expect(PlanningAiSessionSchema.safeParse(incoherent).success).toBe(false);
      }
      for (const [run, result] of [[first, firstResult], [second, secondResult]] as const) {
        expect(await row(tx, "PlanningAiAttempt", run.record.id)).toMatchObject({ state: "RESULT_RECORDED" });
        expect(await row(tx, "PlanningAiOperation", run.fp.operation.id)).toMatchObject({ state: "SUCCEEDED", successfulResultId: result.id });
        const succeeded = await declaredRow(tx, "PlanningAiOperation", run.fp.operation.id);
        expect(PlanningAiOperationSchema.parse(succeeded)).toEqual(succeeded);
        for (const incoherent of [{ ...succeeded, successfulResultId: null }, { ...succeeded, state: "OPEN" }, { ...openBefore, state: "SUCCEEDED" }])
          expect(PlanningAiOperationSchema.safeParse(incoherent).success).toBe(false);
      }
      await insert(tx, "PlanningAiResult", laterResult); await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      const retainedBrief = await row(tx, "PlanningAiResult", laterResult.id);
      expect(retainedBrief).toMatchObject({ disposition: "ATTACHED", content: laterResult.content,
        outputHash: laterResult.outputHash, wireHash: laterResult.wireHash, contentHash: laterResult.contentHash });
      expect(await row(tx, "PlanningAiOperation", later.id)).toMatchObject({ kind: "BRIEF", state: "SUCCEEDED", successfulResultId: laterResult.id });
      expect(await row(tx, "PlanningAiAttempt", subsequent.record.id)).toMatchObject({ ledgerPurpose: "BRIEF", state: "RESULT_RECORDED" });
      expect(await row(tx, "PlanningAiSession", p.sessionId)).toMatchObject({ firstAttachedResultId: firstResult.id });
      expect(await row(tx, "PlanningAiCycle", p.cycleId)).toMatchObject({ held: 0, consumed: 2 });
      const at = new Date();
      for (let ordinal = 2; ordinal <= 10; ordinal++) await insert(tx, "PlanningAiOperation", { id: key("operation"), sessionId: p.sessionId,
        kind: "REPLY", ordinal, state: "OPEN", successfulResultId: null, revision: 1, createdAt: at, updatedAt: at });
      for (const kind of ["STRATEGY", "IDEAS_PACK", "COMBINED_REFINEMENT"]) await insert(tx, "PlanningAiOperation", { id: key("operation"), sessionId: p.sessionId,
        kind, ordinal: 1, state: "OPEN", successfulResultId: null, revision: 1, createdAt: at, updatedAt: at });
      const slots = await tx.$queryRaw<Array<{ kind: string; ordinal: number }>>`SELECT kind,ordinal FROM "PlanningAiOperation" WHERE "sessionId"=${p.sessionId} ORDER BY kind,ordinal`;
      expect(slots).toHaveLength(14); expect(slots.filter(slot => slot.kind === "REPLY").map(slot => slot.ordinal)).toEqual([1,2,3,4,5,6,7,8,9,10]);
      await constrained(tx, () => insert(tx, "PlanningAiOperation", { id: key("operation"), sessionId: p.sessionId, kind: "REPLY", ordinal: 1,
        state: "OPEN", successfulResultId: null, revision: 1, createdAt: at, updatedAt: at }), ["23505"]);
      await constrained(tx, () => insert(tx, "PlanningAiOperation", { id: key("operation"), sessionId: p.sessionId, kind: "REPLY", ordinal: 2,
        state: "OPEN", successfulResultId: null, revision: 1, createdAt: at, updatedAt: at }), ["23505"]);
      await constrained(tx, () => insert(tx, "PlanningAiOperation", { id: key("operation"), sessionId: p.sessionId, kind: "BRIEF", ordinal: 2,
        state: "OPEN", successfulResultId: null, revision: 1, createdAt: at, updatedAt: at }));
      await constrained(tx, async () => {
        await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`;
        const cycle = await row(tx, "PlanningAiCycle", p.cycleId);
        await patch(tx, "PlanningAiCycle", p.cycleId, { consumed: 3, revision: Number(cycle!.revision) + 1, updatedAt: new Date() });
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      });
      for (const [table, id, change] of [["PlanningAiSession", p.sessionId, { allowanceState: "RELEASED" }],
        ["PlanningAiOperation", a.id, { state: "OPEN", successfulResultId: null }],
        ["PlanningAiAttempt", first.record.id, { state: "UNKNOWN" }]] as const) {
        const saved = await row(tx, table, id);
        await constrained(tx, () => patch(tx, table, id, { ...change, revision: Number(saved!.revision) + 1, updatedAt: new Date() }));
      }
      await constrained(tx, () => patch(tx, "PlanningAiResult", firstResult.id, { outputHash: syntheticHash("rewrite") }));
      await constrained(tx, () => tx.$executeRaw`DELETE FROM "PlanningAiResult" WHERE id=${firstResult.id}`);
    });
    expect(await row(prisma, "PlanningAiResult", firstResult.id)).toBeUndefined();
    expect(await row(prisma, "PlanningAiSession", p.sessionId)).toMatchObject({ allowanceState: "HELD", firstAttachedResultId: null });
    expect(await row(prisma, "PlanningAiCycle", p.cycleId)).toMatchObject({ held: 2, consumed: 0 });
  } finally { await finalizeRetained(f, p, sessionIds, runs); }
  for (const sessionId of sessionIds) {
    const released = await declaredRow(prisma, "PlanningAiSession", sessionId);
    expect(released).toMatchObject({ allowanceState: "RELEASED", firstAttachedResultId: null });
    expect(PlanningAiSessionSchema.parse(released)).toEqual(released);
    expect(PlanningAiSessionSchema.safeParse({ ...released, firstAttachedResultId: key("incoherent-result-pointer") }).success).toBe(false);
  }
}, 60000);

it("requires native Attempt/Result storage and binds RUNNING attempts to exact claim, request, fingerprint, operation and seat identities", async () => {
  await requireStorage();
  // Direct grammar checks deliberately exclude ledger/claim equality. An SQL
  // NULL, accepted malformed member or thrown exception is not a false result.
  const goodDeliverables = [{ platform: "INSTAGRAM", format: "STORY", count: 1 }];
  const nullFormat = [{ platform: "INSTAGRAM", format: null, count: 1 }];
  const deliveryGrammar = await prisma.$queryRaw<Array<{ good: boolean | null; bad: boolean | null }>>`
    SELECT infame_planning_ai_field_value('deliverables', ${JSON.stringify(goodDeliverables)}::jsonb) AS good,
      infame_planning_ai_field_value('deliverables', ${JSON.stringify(nullFormat)}::jsonb) AS bad`;
  expect(deliveryGrammar[0]).toStrictEqual({ good: true, bad: false });
  const nullUnit = { ...pricing, prices: [{ ...pricing.prices[0], unit: null }] };
  const pricingGrammar = await prisma.$queryRaw<Array<{ good: boolean | null; bad: boolean | null }>>`
    SELECT infame_planning_ai_pricing(${JSON.stringify(pricing)}::jsonb) AS good,
      infame_planning_ai_pricing(${JSON.stringify(nullUnit)}::jsonb) AS bad`;
  expect(pricingGrammar[0]).toStrictEqual({ good: true, bad: false });
  const f = await company(), other = await person(), p = ids();
  const op: Slot = { id: key("operation"), kind: "REPLY", ordinal: 1 }, nextOp: Slot = { id: key("operation"), kind: "REPLY", ordinal: 2 };
  const fp = fingerprint(f, p, op);
  const sourceProposal = { kind: "REPLY", reply: { text: "Synthetic source proposal declaration only", language: null },
    proposals: [{ kind: "SOURCE_PROPOSAL", field: "deliverables", value: goodDeliverables,
      source: { kind: "CUSTOMER_TEXT", references: [f.source] } }], recommendations: [], openQuestions: [] };
  const malformedProposal = { ...sourceProposal, proposals: [{ ...sourceProposal.proposals[0], value: nullFormat }] };
  const proposalGrammar = await prisma.$queryRaw<Array<{ good: boolean | null; bad: boolean | null }>>`
    SELECT infame_planning_ai_wire(${JSON.stringify(sourceProposal)}::jsonb, ${JSON.stringify(fp)}::jsonb, false) AS good,
      infame_planning_ai_wire(${JSON.stringify(malformedProposal)}::jsonb, ${JSON.stringify(fp)}::jsonb, false) AS bad`;
  expect(proposalGrammar[0]).toStrictEqual({ good: true, bad: false });
  const first = await claimed(f, fp), sibling = await claimed(f, fp, 2);
  await rollback(async tx => {
    await parents(tx, f, p, fp, [op, nextOp]);
    const foreignSeat = key("foreign-seat");
    await insert(tx, "PlanningAiSeat", { id: foreignSeat, poolId: p.poolId, userId: other.user.id, organizationId: null, membershipId: null,
      state: "ACTIVE", revision: 1, createdAt: new Date(), updatedAt: new Date() });
    for (const change of [{ state: "UNKNOWN" }, { revision: 2 }, { sequence: 0 }, { actorRole: "ADMIN" }, { actorSessionVersion: f.actor.sessionVersion + 1 },
      { requestHash: syntheticHash("wrong logical hash") }, { scopeFingerprintHash: syntheticHash("wrong scope hash") },
      { ledgerRequestHash: first.record.requestHash }, { pricingHash: syntheticHash("wrong pricing hash") },
      { executionTokenHash: syntheticHash("not the immutable claim") }, { claimedAt: new Date((first.record.claimedAt as Date).getTime() + 1) },
      { deadlineAt: new Date((first.record.deadlineAt as Date).getTime() + 1) }, { executionTimeoutMs: 299999 }, { reservedMicros: BigInt(2) },
      { payloadHash: syntheticHash("wrong provider payload") }, { ledgerOperationKey: randomUUID() }, { ledgerPurpose: "BRIEF" },
      { operationId: nextOp.id }, { seatId: foreignSeat }, { actorUserId: other.user.id },
      { pricing: { ...pricing, modelId: "different-synthetic-model" }, pricingHash: canonicalHash({ ...pricing, modelId: "different-synthetic-model" }) }]) {
      await constrained(tx, () => insert(tx, "PlanningAiAttempt", { ...first.record, ...change }), ["23514", "23503"]);
    }
    const forgedFingerprint = { ...fp, operation: { ...fp.operation, ordinal: 2 } };
    const forgedHash = canonicalHash({ domain: "infame-planning-scope-v1", ...forgedFingerprint });
    const forgedRequest = { ...(first.record.request as object), ordinal: 2, expectedFingerprintHash: forgedHash };
    await constrained(tx, () => insert(tx, "PlanningAiAttempt", { ...first.record, scopeFingerprint: forgedFingerprint, scopeFingerprintHash: forgedHash,
      request: forgedRequest, requestHash: canonicalHash({ domain: "infame-planning-request-v1", actorUserId: f.actor.userId, request: forgedRequest }) }));
    const injectedRequest = { ...(first.record.request as object), approved: true };
    await constrained(tx, () => insert(tx, "PlanningAiAttempt", { ...first.record, request: injectedRequest,
      requestHash: canonicalHash({ domain: "infame-planning-request-v1", actorUserId: f.actor.userId, request: injectedRequest }) }));
    await insert(tx, "PlanningAiAttempt", first.record);
    await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
    const saved = await row(tx, "PlanningAiAttempt", first.record.id);
    expect(saved).toMatchObject({ state: "RUNNING", revision: 1, requestHash: first.record.requestHash, ledgerRequestHash: first.record.ledgerRequestHash,
      operationKey: String(first.record.operationKey).toLowerCase(), request: first.record.request });
    expect(first.record.requestHash).not.toBe(first.record.ledgerRequestHash);
    expect(saved?.executionTokenHash === first.record.executionTokenHash).toBe(true);
    expect(await row(tx, "PlanningAiCycle", p.cycleId)).toMatchObject({ held: 1, consumed: 0 });
    await constrained(tx, () => insert(tx, "PlanningAiAttempt", sibling.record), ["23505"]);
    await constrained(tx, () => patch(tx, "PlanningAiAttempt", first.record.id, { revision: 2, updatedAt: new Date(), requestHash: syntheticHash("changed immutable request") }));
    await constrained(tx, () => tx.$executeRaw`DELETE FROM "PlanningAiAttempt" WHERE id=${first.record.id}`);
    await patch(tx, "PlanningAiAttempt", first.record.id, { state: "UNKNOWN", revision: 2, updatedAt: new Date() });
    await constrained(tx, () => insert(tx, "PlanningAiAttempt", sibling.record), ["23505"]);
    await constrained(tx, () => patch(tx, "PlanningAiSession", p.sessionId, { allowanceState: "RELEASED", revision: 2, updatedAt: new Date() }));
    await constrained(tx, () => patch(tx, "PlanningAiAttempt", first.record.id, { state: "RUNNING", revision: 3, updatedAt: new Date() }));
    expect(await row(tx, "PlanningAiAttempt", first.record.id)).toMatchObject({ state: "UNKNOWN", revision: 2 });
  });
  expect(await row(prisma, "PlanningAiAttempt", first.record.id)).toBeUndefined();
  expect(await row(prisma, "PlanningAiCycle", p.cycleId)).toBeUndefined();
});

it("keeps billing resolution separate from execution, minimizes rejected results and blocks release while a sibling remains UNKNOWN", async () => {
  await requireStorage();
  // The shape helper has no native audit/ledger authority: a valid adjacent
  // declaration only proves this closed grammar handles explicit JSON null.
  const reviewedReleased = { executionBasis: "REVIEWED_EXECUTION_RESOLUTION", reference: "synthetic-review-shape-only",
    evidenceHash: syntheticHash("synthetic review grammar"), resolvedAt: new Date().toISOString(), reservationId: "synthetic-reservation-shape-only",
    billingBasis: { kind: "RELEASED", noCallReason: "RECONCILED_NO_CHARGE" } };
  const nullReason = { ...reviewedReleased, billingBasis: { ...reviewedReleased.billingBasis, noCallReason: null } };
  const terminalGrammar = await prisma.$queryRaw<Array<{ good: boolean | null; bad: boolean | null }>>`
    SELECT infame_planning_ai_terminal(${JSON.stringify(reviewedReleased)}::jsonb) AS good,
      infame_planning_ai_terminal(${JSON.stringify(nullReason)}::jsonb) AS bad`;
  expect(terminalGrammar[0]).toStrictEqual({ good: true, bad: false });
  const f = await company(), admin = await person("ADMIN"), p = ids();
  const slots: Slot[] = [1, 2, 3, 4].map(ordinal => ({ id: key("operation"), kind: "REPLY", ordinal }));
  const fps = slots.map(op => fingerprint(f, p, op)); for (const fp of fps) fp.cycle = fps[0]!.cycle;
  const runs = await Promise.all(fps.map(fp => claimed(f, fp))), [noCall, uncertain, rejected, billed] = runs as [Run, Run, Run, Run];
  const fencedRetry = await claimed(f, uncertain.fp, 2);
  await prisma.$transaction(async tx => {
    await parents(tx, f, p, fps[0]!, slots);
    for (const run of runs) await insert(tx, "PlanningAiAttempt", run.record);
  }, { timeout: 60000 }); retain(f); retainedUsers.add(admin.user.id);
  const allRuns = [...runs, fencedRetry];
  try {
    await noCall.service.releaseKnownNoCall(noCall.execution.executionToken,
      { reservationId: noCall.execution.reservationId, reason: "FAILED_BEFORE_INVOCATION" });
    await settleZero(rejected); await settleZero(billed);
    await uncertain.service.quarantine(uncertain.execution.executionToken,
      { reservationId: uncertain.execution.reservationId, reason: "BILLING_UNCERTAIN" });
    expect((await prisma.aiReservation.findUniqueOrThrow({ where: { id: uncertain.execution.reservationId } })).status).toBe("UNKNOWN");
    expect(await row(prisma, "PlanningAiAttempt", uncertain.record.id)).toMatchObject({ state: "RUNNING", revision: 1 });
    await prisma.$transaction(async tx => {
      await prelock(tx, f, p, [p.sessionId], runs);
      await patch(tx, "PlanningAiAttempt", uncertain.record.id, { state: "UNKNOWN", revision: 2, updatedAt: new Date() });
    });
    // This is a real native billing reconciliation only. Its audit must not stand
    // in for the separately reviewed execution-resolution action/provenance.
    await uncertain.service.reconcile(admin.actor, { reservationId: uncertain.execution.reservationId,
      reviewReference: "synthetic-billing-" + randomUUID(), resolution: { kind: "CHARGE", actualMicros: "0",
        usage: [{ unit: "INPUT_TOKENS", quantity: "0" }], pricing } });
    const uncertainLedger = await prisma.aiReservation.findUniqueOrThrow({ where: { id: uncertain.execution.reservationId } });
    const uncertainMeta = AiLedgerMetadataSchema.parse(uncertainLedger.result);
    if (!uncertainMeta.reconciliation?.auditId) throw new Error("Actual native billing reconciliation audit required");
    expect(await row(prisma, "PlanningAiAttempt", uncertain.record.id)).toMatchObject({ state: "UNKNOWN", revision: 2 });
    const noCallProof = await terminal(noCall, "TRUSTED_PRE_CALL_STOP"), rejectedProof = await terminal(rejected), billedProof = await terminal(billed),
      uncertainProof = await terminal(uncertain);
    const completeRejectedText = "\n  definitely malformed complete synthetic response  \n";
    const rejectedRecord = { id: key("rejected-result"), attemptId: rejected.record.id, operationId: rejected.fp.operation.id,
      sessionId: p.sessionId, poolId: p.poolId, disposition: "INVALID", outputHash: createHash("sha256").update(completeRejectedText, "utf8").digest("hex"),
      wireHash: null, providerRequestId: null, content: null, contentHash: null, reasonCode: "MALFORMED_OUTPUT",
      terminalEvidenceJson: rejectedProof, createdAt: new Date() };
    await rollback(async tx => {
      await prelock(tx, f, p, [p.sessionId], allRuns);
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      await constrained(tx, () => patch(tx, "PlanningAiAttempt", billed.record.id, { state: "FAILED_KNOWN", revision: 2, updatedAt: new Date(),
        providerRequestId: "synthetic-receipt-without-terminal-execution" }));
      const borrowedBillingAudit = { ...uncertainProof, executionBasis: "REVIEWED_EXECUTION_RESOLUTION", reference: uncertainMeta.reconciliation!.auditId };
      await constrained(tx, () => patch(tx, "PlanningAiAttempt", uncertain.record.id, { state: "FAILED_KNOWN", revision: 3, updatedAt: new Date(),
        executionEvidenceJson: executionPart(borrowedBillingAudit), knownFailureEvidenceJson: borrowedBillingAudit }));
      for (const [run, proof] of [[noCall, noCallProof], [billed, billedProof]] as const) {
        await patch(tx, "PlanningAiAttempt", run.record.id, { state: "FAILED_KNOWN", revision: 2, updatedAt: new Date(),
          executionEvidenceJson: executionPart(proof), knownFailureEvidenceJson: proof });
      }
      for (const change of [{ content: { rejectedText: completeRejectedText } }, { contentHash: syntheticHash("forbidden content") },
        { wireHash: syntheticHash("rejection has no normalized valid wire") }, { reasonCode: "AUTH_UNAVAILABLE" },
        { reasonCode: "invented-private-exception" }, { terminalEvidenceJson: { ...rejectedProof, rawProviderText: completeRejectedText } },
        { terminalEvidenceJson: { ...rejectedProof, billingBasis: { ...rejectedProof.billingBasis, actualMicros: "00" } } }])
        await constrained(tx, () => insert(tx, "PlanningAiResult", { ...rejectedRecord, ...change }));
      await insert(tx, "PlanningAiResult", rejectedRecord); await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      expect(await row(tx, "PlanningAiResult", rejectedRecord.id)).toMatchObject({ disposition: "INVALID", content: null, contentHash: null, wireHash: null,
        reasonCode: "MALFORMED_OUTPUT", outputHash: rejectedRecord.outputHash });
      const minimized = JSON.stringify(await row(tx, "PlanningAiResult", rejectedRecord.id));
      expect(minimized.includes(completeRejectedText)).toBe(false);
      expect(await row(tx, "PlanningAiAttempt", rejected.record.id)).toMatchObject({ state: "RESULT_RECORDED" });
      expect(await row(tx, "PlanningAiOperation", rejected.fp.operation.id)).toMatchObject({ state: "OPEN", successfulResultId: null });
      expect(await row(tx, "PlanningAiSession", p.sessionId)).toMatchObject({ allowanceState: "HELD", firstAttachedResultId: null });
      expect(await row(tx, "PlanningAiCycle", p.cycleId)).toMatchObject({ held: 1, consumed: 0 });
      await constrained(tx, () => patch(tx, "PlanningAiSession", p.sessionId, { allowanceState: "RELEASED", revision: 2, updatedAt: new Date() }));
      await constrained(tx, () => insert(tx, "PlanningAiAttempt", fencedRetry.record), ["23505"]);
      await constrained(tx, () => patch(tx, "PlanningAiAttempt", noCall.record.id, { state: "RUNNING", revision: 3, updatedAt: new Date() }));
      await constrained(tx, () => patch(tx, "PlanningAiAttempt", noCall.record.id, { revision: 3, updatedAt: new Date(),
        knownFailureEvidenceJson: { ...noCallProof, evidenceHash: syntheticHash("changed immutable evidence") } }));
      // Resolve the last sibling with an explicitly synthetic terminal declaration;
      // resolved billing alone above left it UNKNOWN and could not release a hold.
      await patch(tx, "PlanningAiAttempt", uncertain.record.id, { state: "FAILED_KNOWN", revision: 3, updatedAt: new Date(),
        executionEvidenceJson: executionPart(uncertainProof), knownFailureEvidenceJson: uncertainProof });
      await patch(tx, "PlanningAiSession", p.sessionId, { allowanceState: "RELEASED", revision: 2, updatedAt: new Date() });
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      expect(await row(tx, "PlanningAiCycle", p.cycleId)).toMatchObject({ held: 0, consumed: 0 });
      await constrained(tx, () => patch(tx, "PlanningAiResult", rejectedRecord.id, { content: { raw: completeRejectedText } }));
    });
    expect(await row(prisma, "PlanningAiResult", rejectedRecord.id)).toBeUndefined();
    expect(await row(prisma, "PlanningAiAttempt", uncertain.record.id)).toMatchObject({ state: "UNKNOWN", revision: 2 });
  } finally { await finalizeRetained(f, p, [p.sessionId], allRuns, admin.actor); }
  const finalCycle = await row(prisma, "PlanningAiCycle", p.cycleId);
  expect(finalCycle).toMatchObject({ held: 0, consumed: 0 });
  for (const run of runs) expect(await row(prisma, "PlanningAiAttempt", run.record.id)).toMatchObject({ state: "FAILED_KNOWN" });
}, 60000);
