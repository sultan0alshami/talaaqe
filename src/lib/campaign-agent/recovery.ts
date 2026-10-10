import { createHash, createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { organizationAwait, validateClientDelegation, type OrganizationActor, type OrganizationOptions } from "@/lib/organizations/context";
import { beginPlanningCall, capturePlanningScope, withPlanningScope, planningMissing, type PlanningCall, type PlanningScopeFrame } from "@/lib/campaign-planning/scope";
import { runtimeConfig } from "@/lib/env";
import { OrganizationError, ClientAuthoritySchema } from "@/lib/organizations/contracts";
import { canonicalHash, inputJson } from "@/lib/onboarding/drafts";
import { CampaignAgentError, CampaignAgentCommandSchema, CampaignAgentQuerySchema, CampaignAgentReceiptSchema } from "./native-contracts";
import { campaignAgentRecoveryInternals as native, type CampaignAgentOptions } from "./service";
import { CampaignAgentBarrierCommandSchema, CampaignAgentBarrierReceiptSchema, CampaignAgentBarrierResultSchema,
  CampaignAgentOutcomeInputSchema, CampaignAgentRecoveryKeySchema,
  type CampaignAgentRecoveryKey, type CampaignAgentOutcome, type CampaignAgentBarrierResult, type CampaignAgentRecoveryTarget } from "./recovery-contracts";

type Tx = Prisma.TransactionClient;
type AgentFrame = Awaited<ReturnType<typeof native.load>>;
const fail = (code: string, status = 409): never => { throw new CampaignAgentError(code, status); };
function parsed<T>(schema: z.ZodType<T>, input: unknown, stored = false): T {
  const value = schema.safeParse(input); return value.success ? value.data : fail(stored ? "INVALID_STORED_AGENT" : "VALIDATION", stored ? 503 : 422);
}
const now = (options: { now?: Date }) => options.now === undefined ? new Date() : new Date(options.now.getTime());
const same = (left: unknown, right: unknown) => canonicalHash(left) === canonicalHash(right);
const identities = ["organizationId", "clientId", "brandId", "membershipId", "grantId"] as const;
async function readRetry<T>(call: PlanningCall, action: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    call.checkpoint();
    try { return await action(); } catch (error) {
      if (!(error instanceof OrganizationError) || error.code !== "RETRY_REQUIRED" || attempt === 2) throw error;
    }
  }
  return fail("RETRY_REQUIRED", 503);
}
async function requirePlan(tx: Tx, call: PlanningCall, frame: PlanningScopeFrame) {
  if (frame.scope.kind === "OWN_BRAND") return;
  const authority = frame.currentAuthority;
  if (!authority) return planningMissing();
  const grant = await organizationAwait(call.checkpoint, () => tx.clientGrant.findUnique({ where: { id: authority.grantId } }));
  const client = await organizationAwait(call.checkpoint, () => tx.organizationClient.findUnique({ where: { id: authority.clientId } }));
  if (!grant?.active || !grant.plan || !client || grant.clientId !== client.id || grant.membershipId !== authority.membershipId
    || grant.organizationId !== authority.organizationId) return planningMissing();
  const delegated = await validateClientDelegation(tx, client, frame.ownerIds, call.checkpoint);
  if (!delegated.capabilities.plan) return planningMissing();
}
function targetIdentity(scope: PlanningScopeFrame, target: object) {
  if (scope.scope.kind === "CLIENT") {
    if (!scope.currentAuthority || !("expectedAuthority" in target)) return fail("STALE_VERSION");
    const original = ClientAuthoritySchema.safeParse(target.expectedAuthority);
    if (!original.success || original.data.capability !== "plan"
      || identities.some(key => original.data[key] !== scope.currentAuthority![key])) return fail("STALE_VERSION");
  } else if ("expectedAuthority" in target) return fail("VALIDATION", 422);
}
async function originalOutcome(tx: Tx, call: PlanningCall, scope: PlanningScopeFrame, frame: AgentFrame,
  target: CampaignAgentRecoveryTarget): Promise<CampaignAgentOutcome> {
  targetIdentity(scope, target);
  const prior = await organizationAwait(call.checkpoint, () => tx.campaignAgentCommand.findUnique({ where: {
    actorUserId_operationKey: { actorUserId: call.actor.userId, operationKey: target.operationKey } } }));
  if (!prior) return { status: "UNKNOWN", binding: frame.binding, receipt: null };
  if (!frame.row || prior.agentId !== frame.row.id || prior.campaignId !== frame.binding.campaignId || prior.workspaceId !== frame.binding.workspaceId) return planningMissing();
  if (prior.payloadHash !== target.commandHash) return fail("OPERATION_KEY_REUSED");
  if (prior.action !== target.action) return fail("INVALID_STORED_AGENT", 503);
  let payload: unknown = target.payload;
  if (target.action === "APPEND_TEXT") {
    const receipt = parsed(CampaignAgentReceiptSchema, prior.result, true);
    if (!receipt.sourceId) return fail("INVALID_STORED_AGENT", 503);
    const source = await native.source(tx, call, frame, receipt.sourceId);
    if (target.payload.originalTextHash !== canonicalHash({ domain: "infame-agent-recovery-text-v1", originalText: source.originalText })) return fail("INVALID_STORED_AGENT", 503);
    payload = { originalText: source.originalText };
  }
  const { commandHash, ...metadata } = target; void commandHash;
  const command = parsed(CampaignAgentCommandSchema, { ...metadata, scope: frame.binding.scope, campaignId: frame.binding.campaignId, payload }, true);
  if (canonicalHash({ domain: "infame-campaign-agent-command-v1", actorUserId: call.actor.userId, command }) !== target.commandHash) return fail("INVALID_STORED_AGENT", 503);
  const result = await native.replay(tx, call, frame, command, target.commandHash);
  return result.found ? { status: "COMMITTED", binding: frame.binding, receipt: result.result } : fail("INVALID_STORED_AGENT", 503);
}
async function barrierReplay(tx: Tx, call: PlanningCall, scope: PlanningScopeFrame, frame: AgentFrame,
  command: z.infer<typeof CampaignAgentBarrierCommandSchema>, commandHash: string): Promise<CampaignAgentBarrierResult | null> {
  targetIdentity(scope, command);
  targetIdentity(scope, command.target);
  const prior = await organizationAwait(call.checkpoint, () => tx.campaignAgentCommand.findUnique({ where: {
    actorUserId_operationKey: { actorUserId: call.actor.userId, operationKey: command.operationKey } } }));
  if (!prior) return null;
  if (!frame.row || prior.agentId !== frame.row.id || prior.campaignId !== frame.binding.campaignId || prior.workspaceId !== frame.binding.workspaceId) return planningMissing();
  if (prior.action !== "RECOVERY_BARRIER" || prior.payloadHash !== commandHash) return fail("OPERATION_KEY_REUSED");
  const receipt = parsed(CampaignAgentBarrierReceiptSchema, prior.result, true);
  if (command.target.expectedAgentRevision > command.expectedAgentRevision) return fail("INVALID_STORED_AGENT", 503);
  if (receipt.agentId !== prior.agentId || receipt.campaignId !== prior.campaignId || receipt.workspaceId !== prior.workspaceId
    || receipt.agentRevision !== command.expectedAgentRevision + 1 || receipt.agentRevision > frame.row.revision
    || receipt.campaignRevision !== command.expectedSnapshot.campaignRevision || receipt.planningRevision !== command.expectedSnapshot.planningRevision
    || receipt.campaignRevision > frame.current.snapshot.campaignRevision || receipt.planningRevision > frame.current.snapshot.planningRevision
    || receipt.targetOperationKey !== command.target.operationKey || receipt.targetCommandHash !== command.target.commandHash) return fail("INVALID_STORED_AGENT", 503);
  const outcome = await originalOutcome(tx, call, scope, frame, command.target);
  if (receipt.targetOutcome === "COMMITTED") {
    if (outcome.status !== "COMMITTED" || !same(outcome.receipt, receipt.originalReceipt)) return fail("INVALID_STORED_AGENT", 503);
  } else if (outcome.status !== "UNKNOWN") return fail("INVALID_STORED_AGENT", 503);
  return parsed(CampaignAgentBarrierResultSchema, { ...receipt, replayed: true }, true);
}

export async function getCampaignAgentRecoveryKey(actor: OrganizationActor, input: unknown,
  options: OrganizationOptions & { now?: Date } = {}): Promise<CampaignAgentRecoveryKey> {
  const fixed = { now: options.now === undefined ? undefined : new Date(options.now.getTime()) }, call = await beginPlanningCall(actor, { ...options, ...fixed });
  const query = parsed(CampaignAgentQuerySchema, input);
  return readRetry(call, async () => {
    const capture = await capturePlanningScope(call, query.scope, { campaignIds: [query.campaignId] });
    return withPlanningScope(call, capture, { write: false, execute: async (tx, frame) => {
    await requirePlan(tx, call, frame);
    const bound = frame.campaigns.get(query.campaignId);
    if (!frame.workspace || !bound?.binding || bound.binding.workspaceId !== frame.workspace.id) return planningMissing();
    const binding = { scope: frame.scope, campaignId: query.campaignId, workspaceId: frame.workspace.id };
    let secret: string;
    try { secret = runtimeConfig().AUTH_SECRET; } catch { return fail("RECOVERY_UNAVAILABLE", 503); }
    const message = canonicalHash({ domain: "infame-campaign-agent-recovery-key-v1", userId: call.actor.userId, binding });
    const bytes = createHmac("sha256", secret).update(message, "utf8").digest();
    return parsed(CampaignAgentRecoveryKeySchema, { schemaVersion: 1, asOf: now(fixed).toISOString(), binding,
      actorReference: call.actor.userId, algorithm: "AES-GCM", keyId: createHash("sha256").update(bytes).digest("hex"), keyBase64Url: bytes.toString("base64url") });
    } });
  });
}
export async function getCampaignAgentCommandOutcome(actor: OrganizationActor, input: unknown,
  options: OrganizationOptions & { now?: Date } = {}): Promise<CampaignAgentOutcome> {
  const call = await beginPlanningCall(actor, options), query = parsed(CampaignAgentOutcomeInputSchema, input),
    capture = await capturePlanningScope(call, query.scope, { campaignIds: [query.campaignId] });
  return withPlanningScope(call, capture, { write: false, execute: async (tx, scope) => {
    await requirePlan(tx, call, scope); const frame = await native.load(tx, call, scope, query.campaignId, false);
    if (!("kind" in query.target)) return originalOutcome(tx, call, scope, frame, query.target);
    const command = query.target.command;
    targetIdentity(scope, command.target);
    const hash = canonicalHash({ domain: "infame-campaign-agent-recovery-barrier-v1", actorUserId: call.actor.userId, command });
    if (hash !== query.target.commandHash) return fail("INVALID_STORED_AGENT", 503);
    const result = await barrierReplay(tx, call, scope, frame, command, hash);
    return result ? { status: "COMMITTED" as const, binding: frame.binding, receipt: result } : { status: "UNKNOWN" as const, binding: frame.binding, receipt: null };
  } });
}
export async function executeCampaignAgentRecoveryBarrier(actor: OrganizationActor, input: unknown,
  options: CampaignAgentOptions): Promise<CampaignAgentBarrierResult> {
  const fixed = { now: options.now === undefined ? undefined : new Date(options.now.getTime()) }, channel = options.channel,
    call = await beginPlanningCall(actor, { ...options, ...fixed });
  if (channel !== "FORM") return fail("VALIDATION", 422);
  const command = parsed(CampaignAgentBarrierCommandSchema, input),
    commandHash = canonicalHash({ domain: "infame-campaign-agent-recovery-barrier-v1", actorUserId: call.actor.userId, command }),
    capture = await capturePlanningScope(call, command.scope, { campaignIds: [command.campaignId] });
  return withPlanningScope<CampaignAgentBarrierResult>(call, capture, { write: true, expectedAuthority: command.expectedAuthority,
    replay: async (tx, scope) => {
      const frame = await native.load(tx, call, scope, command.campaignId, true); targetIdentity(scope, command.target);
      const result = await barrierReplay(tx, call, scope, frame, command, commandHash);
      return result ? { found: true as const, result } : { found: false as const };
    }, execute: async (tx, scope) => {
      const frame = await native.load(tx, call, scope, command.campaignId, true); targetIdentity(scope, command.target);
      if ((frame.row?.revision ?? 0) !== command.expectedAgentRevision || !same(frame.current.snapshot, command.expectedSnapshot)) return fail("STALE_VERSION");
      if (!frame.row && (command.target.action !== "INITIALIZE" || command.target.expectedAgentRevision !== 0)) return fail("INVALID_STORED_AGENT", 503);
      if (command.target.expectedAgentRevision > (frame.row?.revision ?? 0)) return fail("VALIDATION", 422);
      if (frame.row ? command.initialPreferences !== null : command.initialPreferences === null) return fail("VALIDATION", 422);
      await native.retainedLineage(tx, call, frame);
      const target = await originalOutcome(tx, call, scope, frame, command.target), date = now(fixed), id = frame.row?.id ?? randomUUID();
      if ((frame.row?.revision ?? 0) >= 2147483646) return fail("VERSION_EXHAUSTED");
      const version = frame.bound.selection?.contextVersionId, context = version ? scope.versions.get(version) : null;
      const archived = context ? scope.contexts.get(context.contextId)?.archived === true : false;
      const state = native.stateHash({ schemaVersion: 1, id, revision: (frame.row?.revision ?? 0) + 1, binding: frame.binding,
        snapshot: frame.current.snapshot, fields: frame.current.fields, preferences: frame.retained?.preferences ?? command.initialPreferences!,
        assistance: { kind: "MANUAL_GUIDANCE", agent: "UNAVAILABLE" }, textSourceReferences: frame.retained?.textSourceReferences ?? [],
        confirmation: native.coverage(frame) === "CURRENT" && !archived ? frame.retained!.confirmation : { kind: "UNCONFIRMED" }, updatedAt: date.toISOString() });
      await native.save(tx, call, frame, state, date);
      const value = parsed(CampaignAgentBarrierReceiptSchema, { action: "RECOVERY_BARRIER", agentId: id, campaignId: command.campaignId,
        workspaceId: frame.binding.workspaceId, agentRevision: state.revision, campaignRevision: frame.current.snapshot.campaignRevision,
        planningRevision: frame.current.snapshot.planningRevision, targetOperationKey: command.target.operationKey,
        targetCommandHash: command.target.commandHash, targetOutcome: target.status === "COMMITTED" ? "COMMITTED" : "FENCED",
        originalReceipt: target.status === "COMMITTED" ? target.receipt : null });
      const receiptId = randomUUID();
      await organizationAwait(call.checkpoint, () => tx.campaignAgentCommand.create({ data: { id: receiptId, actorUserId: call.actor.userId,
        operationKey: command.operationKey, agentId: id, campaignId: command.campaignId, workspaceId: frame.binding.workspaceId,
        action: "RECOVERY_BARRIER", payloadHash: commandHash, result: inputJson(value), createdAt: date } }));
      const metadata = { agentId: id, campaignId: command.campaignId, workspaceId: frame.binding.workspaceId, agentRevision: state.revision,
        targetOperationKey: command.target.operationKey, targetOutcome: value.targetOutcome };
      await organizationAwait(call.checkpoint, () => tx.adminAudit.create({ data: { actorUserId: call.actor.userId,
        action: "campaign_agent.recovery_barrier", resourceType: "Campaign", resourceId: command.campaignId, snapshot: inputJson(metadata), createdAt: date } }));
      await organizationAwait(call.checkpoint, () => tx.outboxEvent.create({ data: { deduplicationKey: "campaign-agent:" + receiptId,
        type: "campaign_agent.recovery_barrier", payload: inputJson({ id: receiptId, type: "campaign_agent.recovery_barrier", actorUserId: call.actor.userId,
          recipientUserIds: [call.actor.userId], aggregateType: "Campaign", aggregateId: command.campaignId, aggregateVersion: state.revision,
          occurredAt: date.toISOString(), payload: metadata }), createdAt: date, availableAt: date } }));
      return parsed(CampaignAgentBarrierResultSchema, { ...value, replayed: false });
    } });
}
