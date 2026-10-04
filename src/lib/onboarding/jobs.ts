import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { PrismaClient, type OnboardingDraft, type SourceJob } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { EvidenceSourceSchema } from "@/lib/contracts/vocabulary";
import type { WebsiteDependencies } from "@/lib/imports/website/types";
import { websiteErrorCode, WEBSITE_TEXT_FIELDS } from "@/lib/imports/website/types";
import { assertWebsiteCapability, collectConfirmedWebsite } from "@/lib/imports/website";
import { validateWebsiteUrl } from "@/lib/imports/website/destination";
import {
  canonicalHash, checkedJson, CommandBaseSchema, commandReplay, consentOf, draftDTO, inputJson, jobDTO,
  OnboardingError, parse, persistCommand, record, requireConsent, requireRevision, sourceKey, stateOf, withOwnedDraft,
  type CommandContext, type DraftDTO, type DraftRole, type DraftState, type JobDTO, type Json, type ProposedFact, type Transaction,
} from "./drafts";

const QueueSchema = CommandBaseSchema.extend({ sourceKey: z.string(), channel: z.enum(["FORM", "VOICE"]).default("FORM") }).strict();
const fieldKey = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,99}$/).refine((key) => !["constructor", "prototype", "__proto__"].includes(key));
const FactValueSchema = z.union([z.string().max(10_000), z.number().finite(), z.boolean(), z.array(z.string().max(200)).max(100), z.record(z.string().max(100), z.number().finite()), z.null()]);
const FactSchema = z.object({ fieldKey, value: FactValueSchema, unit: z.string().max(100).nullable(), source: EvidenceSourceSchema,
  evidenceAt: z.string().datetime({ offset: true }).nullable(), sourceReference: z.string().max(500).nullable(),
  retrievedAt: z.string().datetime({ offset: false }).optional(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
const ProgressSchema = z.object({ executionToken: z.string().regex(/^[a-f0-9]{64}$/), facts: z.array(FactSchema).max(100),
  completedItems: z.number().int().nonnegative().max(10_000), totalItems: z.number().int().nonnegative().max(10_000).nullable() });
const CheckpointSchema = ProgressSchema.strict();
const CompletionSchema = ProgressSchema.extend({ status: z.enum(["SUCCEEDED", "PARTIAL"]) }).strict();
const FailureSchema = z.object({ executionToken: z.string().regex(/^[a-f0-9]{64}$/), errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/), billingUncertain: z.boolean() }).strict();
type Progress = z.infer<typeof ProgressSchema>;
type StoredResult = { executionTokenHash?: string; observations: ProposedFact[]; completedItems: number; totalItems: number | null; billingUncertain: boolean; completionHash?: string; failureHash?: string };

function resultOf(job: SourceJob): StoredResult {
  const result = record(job.result);
  return {
    executionTokenHash: typeof result.executionTokenHash === "string" ? result.executionTokenHash : undefined,
    observations: Array.isArray(result.observations) ? result.observations as unknown as ProposedFact[] : [],
    completedItems: typeof result.completedItems === "number" ? result.completedItems : 0,
    totalItems: typeof result.totalItems === "number" ? result.totalItems : null, billingUncertain: result.billingUncertain === true,
    completionHash: typeof result.completionHash === "string" ? result.completionHash : undefined,
    failureHash: typeof result.failureHash === "string" ? result.failureHash : undefined,
  };
}
function storedResult(result: StoredResult): Json {
  // Omit optional undefined properties: JSON columns never contain transport tokens.
  return checkedJson(Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined)), 524_288);
}
function tokenHash(token: string): string { return createHash("sha256").update(token).digest("hex"); }
function requireExecution(job: SourceJob, token: string): StoredResult {
  const result = resultOf(job), hash = tokenHash(token);
  if (!result.executionTokenHash || !/^[a-f0-9]{64}$/.test(result.executionTokenHash) || !timingSafeEqual(Buffer.from(result.executionTokenHash, "hex"), Buffer.from(hash, "hex"))) throw new OnboardingError("EXECUTION_NOT_AUTHORIZED", 403);
  return result;
}
function currentSource(draft: OnboardingDraft, job: SourceJob): boolean {
  if (draft.completedAt) return false;
  const checkpoint = record(job.identity), key = typeof checkpoint.sourceKey === "string" ? checkpoint.sourceKey : "";
  const state = stateOf(draft), mapping = state.sources[key];
  if (!mapping || mapping.source !== job.source || mapping.revision !== job.revision || canonicalHash(mapping.identity) !== canonicalHash(checkpoint.identity ?? null)) return false;
  try { return canonicalHash(requireConsent(state, consentOf(draft), key)) === checkpoint.consentHash; } catch (error) { if (error instanceof OnboardingError) return false; throw error; }
}
function sameAccount(left: Record<string, Json>, right: Record<string, Json>): boolean {
  if (left.platform !== right.platform) return false;
  if (left.platform === null) return typeof left.confirmedOrigin === "string" && left.confirmedOrigin === right.confirmedOrigin;
  if (typeof left.providerAccountId === "string" && typeof right.providerAccountId === "string") return left.providerAccountId === right.providerAccountId;
  return typeof left.normalizedHandle === "string" && left.normalizedHandle === right.normalizedHandle;
}
async function staleIfNeeded(tx: Transaction, draft: OnboardingDraft, job: SourceJob): Promise<SourceJob | null> {
  if (job.status === "STALE") return job;
  if (currentSource(draft, job)) return null;
  return tx.sourceJob.update({ where: { id: job.id }, data: { status: "STALE", errorCode: "SOURCE_CHANGED", completedAt: new Date() } });
}
async function withJob<T>(client: PrismaClient, actorUserId: string, jobId: string,
  operation: (tx: Transaction, draft: OnboardingDraft, role: DraftRole, job: SourceJob) => Promise<T>): Promise<T> {
  const reference = await client.sourceJob.findUnique({ where: { id: jobId }, select: { draftId: true } });
  if (!reference) throw new OnboardingError("NOT_FOUND", 404);
  return withOwnedDraft(client, actorUserId, reference.draftId, async (tx, draft, role) => {
    await tx.$queryRaw`SELECT id FROM "SourceJob" WHERE id = ${jobId} FOR UPDATE`;
    const job = await tx.sourceJob.findUnique({ where: { id: jobId } });
    if (!job || job.draftId !== draft.id) throw new OnboardingError("NOT_FOUND", 404);
    return operation(tx, draft, role, job);
  });
}

export async function queueSourceJob(actorUserId: string, draftId: string, input: unknown, client: PrismaClient = prisma, context: CommandContext = { channel: "FORM" }): Promise<{ draft: DraftDTO; job: JobDTO; replayed: boolean }> {
  checkedJson(input);
  const command = parse(QueueSchema, input), key = sourceKey(command.sourceKey), operationKey = `import:${command.operationKey}`, hash = canonicalHash(command);
  if (command.channel !== "FORM" || context.channel !== "FORM") throw new OnboardingError("EXPLICIT_CONFIRMATION_REQUIRED", 400);
  return withOwnedDraft(client, actorUserId, draftId, async (tx, draft, role) => {
    const replay = await commandReplay<{ draft: DraftDTO; job: JobDTO }>(tx, draft, operationKey, hash);
    if (replay) return { ...replay, replayed: true };
    requireRevision(draft, command.expectedRevision);
    const state = stateOf(draft), consent = requireConsent(state, consentOf(draft), key), mapping = state.sources[key];
    const history = await tx.sourceJob.findMany({ where: { draftId: draft.id } });
    if (history.some((job) => record(job.result).billingUncertain === true && sameAccount(record(record(job.identity).identity), record(checkedJson(mapping.identity))))) {
      // A fresh key, source key, renamed handle, or refreshed permission cannot
      // reconcile an unknown billed outcome. A trusted billing reconciliation
      // transaction must settle it before a new provider execution is permitted.
      throw new OnboardingError("BILLING_RECONCILIATION_REQUIRED");
    }
    const pending = history.filter((job) => job.status === "QUEUED" || job.status === "RUNNING");
    if (pending.some((job) => record(job.identity).sourceKey === key && currentSource(draft, job))) throw new OnboardingError("SOURCE_ALREADY_RUNNING");
    const job = await tx.sourceJob.create({ data: {
      draftId: draft.id, source: mapping.source, revision: mapping.revision, operationKey, payloadHash: hash,
      // Per-source revision is the relevant mapping/consent revision; unrelated
      // draft answers and other provider progress do not stale this source.
      identity: inputJson({ sourceKey: key, identity: mapping.identity, draftRevision: draft.revision, sourceRevision: mapping.revision, consentHash: canonicalHash(consent) }),
      result: inputJson({ observations: [], completedItems: 0, totalItems: null, billingUncertain: false }),
    } });
    const result = await persistCommand(tx, draft, command.expectedRevision, operationKey, hash, { step: "IMPORTING" }, async (updated) => ({ draft: await draftDTO(tx, updated, role), job: jobDTO(job) }));
    return { ...result, replayed: false };
  });
}

/** Acquisition is returned once. Refresh/reconnect may observe RUNNING but cannot
 * recover a token or automatically repeat an uncertain external provider call. */
export async function startSourceJob(actorUserId: string, jobId: string, client: PrismaClient = prisma): Promise<{ job: JobDTO; acquired: boolean; executionToken?: string }> {
  return withJob(client, actorUserId, jobId, async (tx, draft, _role, job) => {
    const stale = await staleIfNeeded(tx, draft, job);
    if (stale) return { job: jobDTO(stale), acquired: false };
    if (job.status !== "QUEUED") return { job: jobDTO(job), acquired: false };
    const executionToken = randomBytes(32).toString("hex"), result = resultOf(job);
    result.executionTokenHash = tokenHash(executionToken);
    const updated = await tx.sourceJob.update({ where: { id: job.id }, data: { status: "RUNNING", attempts: { increment: 1 }, startedAt: new Date(), result: inputJson(storedResult(result)) } });
    return { job: jobDTO(updated), acquired: true, executionToken };
  });
}

function observations(job: SourceJob, progress: Progress): ProposedFact[] {
  if (progress.totalItems !== null && progress.completedItems > progress.totalItems) throw new OnboardingError("INVALID_PROGRESS", 400);
  const seen = new Set<string>();
  return progress.facts.map((fact) => {
    let evidenceAt: string | null;
    if (job.source === "WEBSITE") {
      const origin = record(record(job.identity).identity).confirmedOrigin;
      if (fact.source !== "PUBLIC_IMPORT" || fact.evidenceAt !== null || fact.unit !== null || !WEBSITE_TEXT_FIELDS.some((field) => field === fact.fieldKey)
        || !fact.retrievedAt || !fact.sourceHash || typeof origin !== "string" || !fact.sourceReference) throw new OnboardingError("INVALID_SOURCE_FACT", 400);
      const maximum = fact.fieldKey === "website.pageTitle" ? 200 : fact.fieldKey === "website.pageDescription" ? 2_000 : 6_000;
      if (fact.fieldKey === "website.pageHeadings") {
        if (!Array.isArray(fact.value) || !fact.value.length || fact.value.length > 20 || fact.value.some((value) => typeof value !== "string" || !value.trim() || value.length > 200)) throw new OnboardingError("INVALID_SOURCE_FACT", 400);
      } else if (typeof fact.value !== "string" || !fact.value.trim() || fact.value.length > maximum) throw new OnboardingError("INVALID_SOURCE_FACT", 400);
      const retrieval = Date.parse(fact.retrievedAt);
      if (!Number.isFinite(retrieval) || new Date(retrieval).toISOString() !== fact.retrievedAt || retrieval > Date.now() || !job.startedAt || retrieval < job.startedAt.getTime()) throw new OnboardingError("INVALID_RETRIEVAL_DATE", 400);
      try { if (validateWebsiteUrl(fact.sourceReference, origin).href !== fact.sourceReference) throw new Error("noncanonical"); }
      catch { throw new OnboardingError("INVALID_SOURCE_REFERENCE", 400); }
      evidenceAt = null;
    } else {
      if (fact.evidenceAt === null || fact.retrievedAt !== undefined || fact.sourceHash !== undefined) throw new OnboardingError("INVALID_EVIDENCE_DATE", 400);
      evidenceAt = new Date(fact.evidenceAt).toISOString();
      if (new Date(evidenceAt).getTime() > Date.now()) throw new OnboardingError("INVALID_EVIDENCE_DATE", 400);
    }
    if (fact.sourceReference) {
      let reference: URL;
      try { reference = new URL(fact.sourceReference); } catch { throw new OnboardingError("INVALID_SOURCE_REFERENCE", 400); }
      if (reference.protocol !== "https:" || reference.username || reference.password) throw new OnboardingError("INVALID_SOURCE_REFERENCE", 400);
    }
    const id = canonicalHash({ jobId: job.id, fieldKey: fact.fieldKey, evidenceAt, source: fact.source, sourceReference: fact.sourceReference,
      ...(job.source === "WEBSITE" ? { retrievedAt: fact.retrievedAt, sourceHash: fact.sourceHash } : {}) });
    if (seen.has(id)) throw new OnboardingError("DUPLICATE_OBSERVATION", 400);
    seen.add(id);
    return { ...fact, id, jobId: job.id, evidenceAt, reviewStatus: "PROPOSED", visibility: "PRIVATE" };
  });
}
function mergeObservations(existing: ProposedFact[], incoming: ProposedFact[]): ProposedFact[] {
  const result = [...existing], ids = new Map(existing.map((fact) => [fact.id, fact]));
  for (const fact of incoming) {
    const prior = ids.get(fact.id);
    if (prior && canonicalHash(prior) !== canonicalHash(fact)) throw new OnboardingError("IMMUTABLE_OBSERVATION_CONFLICT");
    if (!prior) { result.push(fact); ids.set(fact.id, fact); }
  }
  if (result.length > 1_000) throw new OnboardingError("TOO_MANY_OBSERVATIONS", 413);
  return result;
}
async function adopt(tx: Transaction, draft: OnboardingDraft, job: SourceJob, progress: Progress, result: StoredResult): Promise<StoredResult> {
  if (progress.completedItems < result.completedItems || (result.totalItems !== null && progress.totalItems !== result.totalItems)) throw new OnboardingError("INVALID_PROGRESS", 400);
  const incoming = observations(job, progress), state: DraftState = stateOf(draft), key = sourceKey(record(job.identity).sourceKey);
  result.observations = mergeObservations(result.observations, incoming);
  result.completedItems = progress.completedItems;
  result.totalItems = progress.totalItems;
  const prior = state.facts[key] ?? [], merged = mergeObservations(prior, incoming);
  if (canonicalHash(prior) !== canonicalHash(merged)) {
    state.facts[key] = merged;
    state.factsRevision += 1;
    state.generatedSectionsStale = true;
    // Background observations have an independent facts revision; they do not
    // invalidate a user's optimistic answer revision. The draft lock prevents loss.
    await tx.onboardingDraft.update({ where: { id: draft.id }, data: { input: inputJson(state) } });
  }
  return result;
}

export async function checkpointSourceJob(actorUserId: string, jobId: string, input: unknown, client: PrismaClient = prisma): Promise<{ job: JobDTO }> {
  checkedJson(input);
  const progress = parse(CheckpointSchema, input);
  return withJob(client, actorUserId, jobId, async (tx, draft, _role, job) => {
    const result = requireExecution(job, progress.executionToken), stale = await staleIfNeeded(tx, draft, job);
    if (stale) return { job: jobDTO(stale) };
    if (job.status !== "RUNNING") throw new OnboardingError("JOB_NOT_RUNNING");
    const adopted = await adopt(tx, draft, job, progress, result);
    const updated = await tx.sourceJob.update({ where: { id: job.id }, data: { result: inputJson(storedResult(adopted)) } });
    return { job: jobDTO(updated) };
  });
}
export async function completeSourceJob(actorUserId: string, jobId: string, input: unknown, client: PrismaClient = prisma): Promise<{ job: JobDTO; replayed: boolean }> {
  checkedJson(input);
  const completion = parse(CompletionSchema, input), { executionToken, ...outcome } = completion, hash = canonicalHash(outcome);
  return withJob(client, actorUserId, jobId, async (tx, draft, _role, job) => {
    const result = requireExecution(job, executionToken), stale = await staleIfNeeded(tx, draft, job);
    if (stale) return { job: jobDTO(stale), replayed: false };
    if (result.completionHash) {
      if (result.completionHash !== hash) throw new OnboardingError("IDEMPOTENCY_CONFLICT");
      return { job: jobDTO(job), replayed: true };
    }
    if (job.status !== "RUNNING") throw new OnboardingError("JOB_NOT_RUNNING");
    if ((completion.status === "SUCCEEDED" && completion.totalItems !== null && completion.completedItems !== completion.totalItems)
      || (completion.status === "PARTIAL" && (completion.totalItems === null || completion.completedItems >= completion.totalItems))) throw new OnboardingError("INVALID_PROGRESS", 400);
    const adopted = await adopt(tx, draft, job, completion, result);
    adopted.completionHash = hash;
    const updated = await tx.sourceJob.update({ where: { id: job.id }, data: { status: completion.status, completedAt: new Date(), result: inputJson(storedResult(adopted)), errorCode: null } });
    return { job: jobDTO(updated), replayed: false };
  });
}
export async function failSourceJob(actorUserId: string, jobId: string, input: unknown, client: PrismaClient = prisma): Promise<{ job: JobDTO; replayed: boolean }> {
  checkedJson(input);
  const failure = parse(FailureSchema, input), { executionToken, ...outcome } = failure, hash = canonicalHash(outcome);
  return withJob(client, actorUserId, jobId, async (tx, draft, _role, job) => {
    const result = requireExecution(job, executionToken), stale = await staleIfNeeded(tx, draft, job);
    if (stale) return { job: jobDTO(stale), replayed: false };
    if (result.failureHash) {
      if (result.failureHash !== hash) throw new OnboardingError("IDEMPOTENCY_CONFLICT");
      return { job: jobDTO(job), replayed: true };
    }
    if (job.status !== "RUNNING") throw new OnboardingError("JOB_NOT_RUNNING");
    result.failureHash = hash;
    result.billingUncertain = failure.billingUncertain;
    const updated = await tx.sourceJob.update({ where: { id: job.id }, data: { status: "FAILED", completedAt: new Date(), errorCode: failure.errorCode, result: inputJson(storedResult(result)) } });
    return { job: jobDTO(updated), replayed: false };
  });
}

/** Server-only orchestration. Dependencies come from reviewed server setup,
 * never request bodies, voice/model arguments or supplied execution tokens. */
export async function runWebsiteSourceJob(actorUserId: string, jobId: string, dependencies: WebsiteDependencies = {}, client: PrismaClient = prisma): Promise<{ job: JobDTO; replayed: boolean }> {
  const prepared = await withJob(client, actorUserId, jobId, async (tx, draft, role, job) => {
    if (role !== "BRAND" || job.source !== "WEBSITE") throw new OnboardingError("INVALID_SOURCE", 400);
    const stale = await staleIfNeeded(tx, draft, job);
    if (stale) return { job: jobDTO(stale), replayed: true, input: null };
    if (job.status !== "QUEUED") return { job: jobDTO(job), replayed: true, input: null };
    try { assertWebsiteCapability(dependencies); }
    catch {
      const failed = await tx.sourceJob.update({ where: { id: job.id }, data: { status: "FAILED", errorCode: "CAPABILITY_UNAVAILABLE", completedAt: new Date() } });
      return { job: jobDTO(failed), replayed: false, input: null };
    }
    const key = sourceKey(record(job.identity).sourceKey), state = stateOf(draft), consent = requireConsent(state, consentOf(draft), key);
    const origin = state.sources[key].identity.confirmedOrigin;
    if (!origin) throw new OnboardingError("INVALID_SOURCE", 400);
    return { job: jobDTO(job), replayed: false, input: { sourceId: key, sourceRevision: job.revision, confirmedOrigin: origin, confirmedUrl: `${origin}/`, consentVersion: consent.consentVersion } };
  });
  if (!prepared.input) return { job: prepared.job, replayed: prepared.replayed };
  const claim = await startSourceJob(actorUserId, jobId, client);
  if (!claim.acquired || !claim.executionToken) return { job: claim.job, replayed: true };
  let outcome;
  try { outcome = await collectConfirmedWebsite(prepared.input, dependencies); assertWebsiteCapability(dependencies); }
  catch (error) {
    const errorCode = websiteErrorCode(error);
    return failSourceJob(actorUserId, jobId, { executionToken: claim.executionToken, errorCode, billingUncertain: false }, client);
  }
  if (outcome.status === "FAILED") return failSourceJob(actorUserId, jobId, { executionToken: claim.executionToken,
    errorCode: outcome.errors[0]?.code ?? "WEBSITE_IMPORT_FAILED", billingUncertain: false }, client);
  const facts = outcome.pages.flatMap((page) => page.facts.map((fact) => ({ fieldKey: fact.fieldKey, value: fact.observedValue, unit: null,
    source: "PUBLIC_IMPORT", evidenceAt: null, retrievedAt: fact.retrievedAt, sourceHash: fact.sourceHash, sourceReference: fact.sourceReference })));
  return completeSourceJob(actorUserId, jobId, { executionToken: claim.executionToken, facts, status: outcome.status,
    completedItems: outcome.completedItems, totalItems: outcome.totalItems }, client);
}
