import { createHash } from "node:crypto";
import { Prisma, PrismaClient, type OnboardingDraft, type SourceJob } from "@prisma/client";
import { z } from "zod";
import { AvailabilitySchema, ArabicDialectSchema, ContentLanguageSchema, CountryCodeSchema, LocationSchema, normalizeBrandSlug, normalizeInfameHandle, PlatformSchema } from "@/lib/contracts/vocabulary";
import { CurrencyCodeSchema } from "@/lib/contracts/money";

import { OnboardingError } from "./errors";
export { OnboardingError } from "./errors";
import { beginOnboardingSession, lockOnboardingSession, withOnboardingSession,
  type OnboardingSession, type OnboardingReadOptions, type OnboardingCommandOptions } from "./session";
export type Json = Prisma.JsonValue;
export type DraftRole = "CREATOR" | "BRAND";
export type Transaction = Prisma.TransactionClient;
// Assigned by the trusted server adapter, never copied from model tool arguments.
// A voice adapter must pass VOICE even if the transport payload claims FORM.
export type CommandContext = { channel: "FORM" | "VOICE" };

const safeKey = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/).refine((key) => !["constructor", "prototype", "__proto__"].includes(key));
const nullableIdentityText = z.string().trim().min(1).max(200).regex(/^[^\u0000-\u001f\u007f]+$/).nullable();
export const SourceIdentitySchema = z.object({
  platform: PlatformSchema.nullable(), providerAccountId: nullableIdentityText,
  normalizedHandle: nullableIdentityText, confirmedOrigin: z.string().max(500).nullable(),
}).strict();
export type SourceIdentity = z.infer<typeof SourceIdentitySchema>;
export type SourceMapping = { source: z.infer<typeof PlatformSchema> | "WEBSITE"; identity: SourceIdentity; revision: number; confirmedAt: string | null };
export type SourceConsent = { identityHash: string; sourceRevision: number; scopes: string[]; consentVersion: string; grantedAt: string };
export type ProposedFact = { id: string; jobId: string; fieldKey: string; value: Json; unit: string | null; source: string; evidenceAt: string | null; retrievedAt?: string; sourceHash?: string; sourceReference: string | null; reviewStatus: "PROPOSED"; visibility: "PRIVATE" };
export type DraftState = {
  version: 1; answers: Record<string, Json>; sources: Record<string, SourceMapping>;
  facts: Record<string, ProposedFact[]>; mappingRevision: number; factsRevision: number; generatedSectionsStale: boolean;
};
export type JobDTO = {
  id: string; sourceKey: string; source: string; revision: number; status: string; attempts: number;
  completedItems: number; totalItems: number | null; billingUncertain: boolean; errorCode: string | null;
  startedAt: string | null; completedAt: string | null; createdAt: string;
};
export type DraftDTO = {
  id: string; role: DraftRole; revision: number; step: string; mode: string; input: DraftState;
  consent: Record<string, SourceConsent>; transcript: Json; jobs: JobDTO[]; completedAt: string | null; updatedAt: string;
};

// Canonical JSON hashing is order independent and never accepts executable/prototype keys,
// nonfinite numbers, undefined, or excessively deep/large transport objects.
export function checkedJson(value: unknown, maxBytes = 65_536): Json {
  const walk = (item: unknown, depth: number): void => {
    if (depth > 12) throw new OnboardingError("INVALID_PAYLOAD", 400);
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (Array.isArray(item)) { item.forEach((entry) => walk(entry, depth + 1)); return; }
    if (typeof item === "object" && Object.getPrototypeOf(item) === Object.prototype) {
      for (const [key, entry] of Object.entries(item)) {
        if (["__proto__", "prototype", "constructor"].includes(key)) throw new OnboardingError("INVALID_PAYLOAD", 400);
        walk(entry, depth + 1);
      }
      return;
    }
    throw new OnboardingError("INVALID_PAYLOAD", 400);
  };
  walk(value, 0);
  if (Buffer.byteLength(JSON.stringify(value)) > maxBytes) throw new OnboardingError("PAYLOAD_TOO_LARGE", 413);
  return value as Json;
}
export function canonicalHash(value: unknown): string {
  const order = (item: Json): Json => Array.isArray(item) ? item.map(order) : item !== null && typeof item === "object"
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, order(item[key]!)])) : item;
  return createHash("sha256").update(JSON.stringify(order(checkedJson(value, 524_288)))).digest("hex");
}
export function record(value: Json | undefined | null): Record<string, Json> { return value && !Array.isArray(value) && typeof value === "object" ? value as Record<string, Json> : {}; }
export function inputJson(value: unknown): Prisma.InputJsonValue { return checkedJson(value, 524_288) as Prisma.InputJsonValue; }
export function parse<T>(schema: z.ZodType<T>, value: unknown, code = "INVALID_COMMAND"): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new OnboardingError(code, 400);
  return result.data;
}
export function sourceKey(value: unknown): string { return parse(safeKey, value); }
export function stateOf(draft: Pick<OnboardingDraft, "input">): DraftState {
  const state = record(draft.input);
  return {
    version: 1, answers: record(state.answers), sources: record(state.sources) as unknown as Record<string, SourceMapping>,
    facts: record(state.facts) as unknown as Record<string, ProposedFact[]>,
    mappingRevision: typeof state.mappingRevision === "number" ? state.mappingRevision : 1,
    factsRevision: typeof state.factsRevision === "number" ? state.factsRevision : 1,
    generatedSectionsStale: state.generatedSectionsStale === true,
  };
}
export function consentOf(draft: OnboardingDraft): Record<string, SourceConsent> { return record(draft.consent) as unknown as Record<string, SourceConsent>; }
export function jobDTO(job: SourceJob): JobDTO {
  const identity = record(job.identity), result = record(job.result);
  return {
    id: job.id, sourceKey: typeof identity.sourceKey === "string" ? identity.sourceKey : "", source: job.source, revision: job.revision,
    status: job.status, attempts: job.attempts, completedItems: typeof result.completedItems === "number" ? result.completedItems : 0,
    totalItems: typeof result.totalItems === "number" ? result.totalItems : null, billingUncertain: result.billingUncertain === true,
    errorCode: job.errorCode, startedAt: job.startedAt?.toISOString() ?? null, completedAt: job.completedAt?.toISOString() ?? null, createdAt: job.createdAt.toISOString(),
  };
}
export async function draftDTO(tx: Transaction, draft: OnboardingDraft, role: DraftRole): Promise<DraftDTO> {
  const jobs = await tx.sourceJob.findMany({ where: { draftId: draft.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return { id: draft.id, role, revision: draft.revision, step: draft.step, mode: draft.mode, input: stateOf(draft), consent: consentOf(draft),
    transcript: draft.transcript, jobs: jobs.map(jobDTO), completedAt: draft.completedAt?.toISOString() ?? null, updatedAt: draft.updatedAt.toISOString() };
}

async function authorize(tx: Transaction, actorUserId: string): Promise<DraftRole> {
  // Every service uses User -> Draft -> Job lock order. A suspension/role change
  // linearizes with these operations; replay does not bypass current authorization.
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actorUserId} FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: actorUserId }, select: { active: true, role: true } });
  if (!user?.active || (user.role !== "CREATOR" && user.role !== "BRAND")) throw new OnboardingError("FORBIDDEN", 403);
  return user.role;
}
// Accepted server jobs keep their separate active-owner/token/consent lane.
// Interactive functions never reach it from missing authentication metadata.
export async function withAcceptedJobDraft<T>(client: PrismaClient, actorUserId: string, draftId: string,
  operation: (tx: Transaction, draft: OnboardingDraft, role: DraftRole) => Promise<T>,
  beforeDomainLock?: (tx: Transaction, role: DraftRole) => Promise<void>): Promise<T> {
  return client.$transaction(async (tx) => {
    const role = await authorize(tx, actorUserId);
    const owned = await tx.onboardingDraft.findFirst({ where: { id: draftId, userId: actorUserId, kind: role }, select: { id: true } });
    if (!owned) throw new OnboardingError("NOT_FOUND", 404);
    // Proof consumers acquire the current reviewer Users before domain rows,
    // consistently with evidence review. Other callers retain the same order.
    if (beforeDomainLock) await beforeDomainLock(tx, role);
    await tx.$queryRaw`SELECT id FROM "OnboardingDraft" WHERE id = ${draftId} FOR UPDATE`;
    const current = await tx.onboardingDraft.findUnique({ where: { id: draftId } });
    if (!current || current.userId !== actorUserId || current.kind !== role) throw new OnboardingError("NOT_FOUND", 404);
    return operation(tx, current, role);
  }, { maxWait: 10_000, timeout: 20_000 });
}
export async function withOwnedDraft<T>(session: OnboardingSession, draftId: string,
  operation: (tx: Transaction, draft: OnboardingDraft, role: DraftRole) => Promise<T>,
  beforeDomainLock?: (tx: Transaction, role: DraftRole) => Promise<void>): Promise<T> {
  return withOnboardingSession(session, true, async tx => {
    const actorUserId = session.actor.userId, role = session.actor.role as DraftRole;
    const owned = await tx.onboardingDraft.findFirst({ where: { id: draftId, userId: actorUserId, kind: role }, select: { id: true } });
    // Publication captures/locks the complete sorted owner/reviewer inventory
    // before the exact Session. It must take owner update locks up front.
    if (owned && beforeDomainLock) await beforeDomainLock(tx, role);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actorUserId} FOR UPDATE`;
    await lockOnboardingSession(tx);
    if (!owned) throw new OnboardingError("NOT_FOUND", 404);
    await tx.$queryRaw`SELECT id FROM "OnboardingDraft" WHERE id=${draftId} FOR UPDATE`;
    const current = await tx.onboardingDraft.findUnique({ where: { id: draftId } });
    if (!current || current.userId !== actorUserId || current.kind !== role) throw new OnboardingError("NOT_FOUND", 404);
    return operation(tx, current, role);
  });
}
export async function createOrResumeDraft(actorUserId: string, options: OnboardingReadOptions = {}): Promise<DraftDTO> {
  const session = await beginOnboardingSession(actorUserId, options);
  return withOnboardingSession(session, true, async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actorUserId} FOR UPDATE`;
    await lockOnboardingSession(tx);
    const role = session.actor.role as DraftRole;
    const draft = await tx.onboardingDraft.upsert({ where: { userId_kind: { userId: actorUserId, kind: role } }, create: { userId: actorUserId, kind: role }, update: {} });
    return draftDTO(tx, draft, role);
  });
}
export function getDraft(actorUserId: string, draftId: string, options?: OnboardingReadOptions): Promise<DraftDTO>;
export function getDraft(actorUserId: string, draftId: null, options?: OnboardingReadOptions): Promise<DraftDTO | null>;
export async function getDraft(actorUserId: string, draftId: string | null, options: OnboardingReadOptions = {}): Promise<DraftDTO | null> {
  const session = await beginOnboardingSession(actorUserId, options);
  return withOnboardingSession(session, false, async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actorUserId} FOR SHARE`;
    await lockOnboardingSession(tx);
    const role = session.actor.role as DraftRole;
    const reference = await tx.onboardingDraft.findFirst({ where: { ...(draftId === null ? {} : { id: draftId }), userId: actorUserId, kind: role }, select: { id: true } });
    if (!reference) { if (draftId === null) return null; throw new OnboardingError("NOT_FOUND", 404); }
    await tx.$queryRaw`SELECT id FROM "OnboardingDraft" WHERE id=${reference.id} FOR SHARE`;
    const current = await tx.onboardingDraft.findUnique({ where: { id: reference.id } });
    if (!current || current.userId !== actorUserId || current.kind !== role) throw new OnboardingError("NOT_FOUND", 404);
    return draftDTO(tx, current, role);
  });
}

export const CommandBaseSchema = z.object({ operationKey: z.string().min(1).max(120).regex(/^[A-Za-z0-9_:-]+$/), expectedRevision: z.number().int().positive().max(2_147_483_646) });
const CommandSchema = CommandBaseSchema.extend({
  action: z.enum(["SET_ANSWER", "CONFIRM_ACCOUNT", "GRANT_IMPORT_CONSENT", "BACK", "PAUSE", "SAVE_DRAFT"]),
  channel: z.enum(["FORM", "VOICE"]).default("FORM"), payload: z.record(z.string(), z.unknown()),
}).strict();
type DraftCommand = z.infer<typeof CommandSchema>;

export async function commandReplay<T>(tx: Transaction, draft: OnboardingDraft, operationKey: string, hash: string): Promise<T | null> {
  const previous = await tx.draftCommand.findUnique({ where: { draftId_operationKey: { draftId: draft.id, operationKey } } });
  if (!previous) return null;
  if (previous.payloadHash !== hash) throw new OnboardingError("IDEMPOTENCY_CONFLICT");
  return previous.result as unknown as T;
}
export function requireRevision(draft: OnboardingDraft, expectedRevision: number): void {
  if (draft.completedAt) throw new OnboardingError("DRAFT_COMPLETED");
  if (draft.revision !== expectedRevision) throw new OnboardingError("STALE_VERSION");
}
export async function persistCommand<T>(tx: Transaction, draft: OnboardingDraft, expectedRevision: number, operationKey: string, hash: string,
  data: Prisma.OnboardingDraftUpdateManyMutationInput, makeResult: (draft: OnboardingDraft) => Promise<T>): Promise<T> {
  const changed = await tx.onboardingDraft.updateMany({ where: { id: draft.id, revision: expectedRevision, completedAt: null }, data: { ...data, revision: { increment: 1 } } });
  if (changed.count !== 1) throw new OnboardingError("STALE_VERSION");
  const result = await makeResult(await tx.onboardingDraft.findUniqueOrThrow({ where: { id: draft.id } }));
  await tx.draftCommand.create({ data: { draftId: draft.id, operationKey, payloadHash: hash, result: inputJson(result) } });
  return result;
}

export async function invalidateSource(tx: Transaction, draft: OnboardingDraft, state: DraftState, key: string): Promise<void> {
  // Keep the historical job observations for owner-only recovery, detach canonical
  // proposals for the corrected source, and preserve every other source's progress.
  delete state.facts[key];
  state.factsRevision += 1;
  state.generatedSectionsStale = true;
  // A corrected source must stop contributing to discovery/publication immediately,
  // even before the owner saves the edited profile. Reapproval is explicit.
  const creator = await tx.creator.findUnique({ where: { userId: draft.userId }, select: { id: true } });
  if (creator) {
    await tx.creator.update({ where: { id: creator.id }, data: { state: "PRIVATE", brandVisible: false } });
    const prior = state.sources[key];
    if (prior && prior.source !== "WEBSITE") await tx.socialAccount.updateMany({ where: { creatorId: creator.id, platform: prior.source,
      OR: [ ...(prior.identity.normalizedHandle ? [{ handle: prior.identity.normalizedHandle.replace(/^@/, "") }] : []), ...(prior.identity.providerAccountId ? [{ providerAccountId: prior.identity.providerAccountId }] : []) ],
    }, data: { publicVisible: false, brandVisible: false, factsApprovedAt: null } });
  }
  const jobs = await tx.sourceJob.findMany({ where: { draftId: draft.id, status: { not: "STALE" } }, select: { id: true, identity: true } });
  const ids = jobs.filter((job) => record(job.identity).sourceKey === key).map((job) => job.id);
  if (ids.length) await tx.sourceJob.updateMany({ where: { id: { in: ids } }, data: { status: "STALE", completedAt: new Date(), errorCode: "SOURCE_CHANGED" } });
}
export function requireConfirmed(state: DraftState, key: string): SourceMapping {
  const mapping = state.sources[key];
  if (!mapping?.confirmedAt) throw new OnboardingError("SOURCE_NOT_CONFIRMED");
  return mapping;
}
export function requireConsent(state: DraftState, consents: Record<string, SourceConsent>, key: string): SourceConsent {
  const mapping = requireConfirmed(state, key), consent = consents[key];
  if (!consent || consent.sourceRevision !== mapping.revision || consent.identityHash !== canonicalHash(mapping.identity) || !consent.scopes.includes("public-profile")) throw new OnboardingError("CONSENT_REQUIRED");
  return consent;
}

const text = z.string().min(1).max(500).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+$/);
const language = ContentLanguageSchema.unwrap();
const infameHandle = z.string().transform((value, context) => {
  try { return normalizeInfameHandle(value); } catch { context.addIssue({ code: "custom", message: "Invalid handle" }); return z.NEVER; }
});
const brandSlug = z.string().transform((value, context) => {
  try { return normalizeBrandSlug(value); } catch { context.addIssue({ code: "custom", message: "Invalid slug" }); return z.NEVER; }
});
const answerSchemas: Record<string, { schema: z.ZodType; roles: DraftRole[] }> = {
  displayName: { schema: text.max(100), roles: ["CREATOR"] }, companyName: { schema: text.max(200), roles: ["BRAND"] },
  // A primary social handle is not the Infame public handle. These are proposals,
  // not database reservations or evidence of ownership/publication readiness.
  primaryHandle: { schema: nullableIdentityText.unwrap().max(100), roles: ["CREATOR"] },
  infameHandle: { schema: infameHandle, roles: ["CREATOR"] }, brandSlug: { schema: brandSlug, roles: ["BRAND"] },
  contactName: { schema: text.max(100), roles: ["BRAND"] }, representativeRole: { schema: text.max(100), roles: ["BRAND"] },
  bio: { schema: text.max(500), roles: ["CREATOR"] }, description: { schema: text.max(500), roles: ["BRAND"] },
  platforms: { schema: z.array(PlatformSchema).max(5).refine((values) => new Set(values).size === values.length), roles: ["CREATOR", "BRAND"] },
  location: { schema: LocationSchema, roles: ["CREATOR", "BRAND"] },
  languages: { schema: z.array(language).min(1).max(20), roles: ["CREATOR", "BRAND"] },
  dialects: { schema: z.array(ArabicDialectSchema).max(12), roles: ["CREATOR"] },
  availability: { schema: AvailabilitySchema, roles: ["CREATOR"] }, travelWilling: { schema: z.boolean(), roles: ["CREATOR"] },
  preferredCurrency: { schema: CurrencyCodeSchema, roles: ["CREATOR", "BRAND"] }, noWebsite: { schema: z.boolean(), roles: ["BRAND"] },
  targetMarkets: { schema: z.array(CountryCodeSchema).min(1).max(50).refine((values) => new Set(values).size === values.length), roles: ["BRAND"] },
  nicheSlugs: { schema: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)).min(1).max(20).refine((values) => new Set(values).size === values.length), roles: ["CREATOR"] },
};
const creatorSteps = ["WELCOME", "NAME", "PRIMARY_HANDLE", "PLATFORMS", "HANDLE_MAPPING", "ACCOUNT_CONFIRMATION", "IMPORT_PERMISSION", "IMPORTING", "FACT_REVIEW", "MISSING_ESSENTIALS", "PORTFOLIO_DRAFT", "PREVIEW", "SAVED_DRAFT"];
const brandSteps = ["WELCOME", "COMPANY_IDENTITY", "WEBSITE", ...creatorSteps.slice(3)];

function validateMapping(value: unknown, role: DraftRole): { sourceKey: string; source: SourceMapping["source"]; identity: SourceIdentity } {
  const mapping = parse(z.object({ sourceKey: safeKey, source: z.union([PlatformSchema, z.literal("WEBSITE")]), identity: SourceIdentitySchema }).strict(), value);
  if (mapping.source === "WEBSITE") {
    if (role !== "BRAND" || mapping.identity.platform !== null || mapping.identity.providerAccountId !== null || mapping.identity.normalizedHandle !== null || !mapping.identity.confirmedOrigin) throw new OnboardingError("INVALID_SOURCE", 400);
    let url: URL;
    try { url = new URL(mapping.identity.confirmedOrigin); } catch { throw new OnboardingError("INVALID_SOURCE", 400); }
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash || url.origin !== mapping.identity.confirmedOrigin) throw new OnboardingError("INVALID_SOURCE", 400);
  } else if (mapping.identity.platform !== mapping.source || mapping.identity.confirmedOrigin !== null || (!mapping.identity.providerAccountId && !mapping.identity.normalizedHandle)) throw new OnboardingError("INVALID_SOURCE", 400);
  return mapping;
}
async function change(tx: Transaction, draft: OnboardingDraft, role: DraftRole, command: DraftCommand): Promise<Prisma.OnboardingDraftUpdateManyMutationInput> {
  const state = stateOf(draft), consent = consentOf(draft);
  let step = draft.step, mode = draft.mode;
  if ((command.action === "CONFIRM_ACCOUNT" || command.action === "GRANT_IMPORT_CONSENT") && command.channel !== "FORM") throw new OnboardingError("EXPLICIT_CONFIRMATION_REQUIRED", 400);
  if (command.action === "SET_ANSWER") {
    const payload = parse(z.object({ field: z.string(), value: z.unknown() }).strict(), command.payload);
    if (payload.field === "sourceMapping") {
      if (command.channel !== "FORM") throw new OnboardingError("EXPLICIT_CONFIRMATION_REQUIRED", 400);
      const mapping = validateMapping(payload.value, role), old = state.sources[mapping.sourceKey];
      await invalidateSource(tx, draft, state, mapping.sourceKey);
      state.sources[mapping.sourceKey] = { source: mapping.source, identity: mapping.identity, revision: (old?.revision ?? 0) + 1, confirmedAt: null };
      delete consent[mapping.sourceKey];
      state.mappingRevision += 1;
      step = "ACCOUNT_CONFIRMATION";
    } else {
      const field = Object.hasOwn(answerSchemas, payload.field) ? answerSchemas[payload.field] : undefined;
      if (!field || !field.roles.includes(role)) throw new OnboardingError("INVALID_FIELD", 400);
      if (["primaryHandle", "infameHandle", "brandSlug", "preferredCurrency"].includes(payload.field) && command.channel !== "FORM") throw new OnboardingError("EXPLICIT_CONFIRMATION_REQUIRED", 400);
      state.answers[payload.field] = checkedJson(parse(field.schema, payload.value));
      state.generatedSectionsStale = true;
      if (step === "WELCOME") step = role === "CREATOR" ? "NAME" : "COMPANY_IDENTITY";
    }
  } else if (command.action === "CONFIRM_ACCOUNT") {
    const payload = parse(z.object({ sourceKey: safeKey, identity: SourceIdentitySchema }).strict(), command.payload);
    const mapping = state.sources[payload.sourceKey];
    if (!mapping || canonicalHash(mapping.identity) !== canonicalHash(payload.identity)) throw new OnboardingError("SOURCE_IDENTITY_MISMATCH");
    mapping.confirmedAt = new Date().toISOString();
    step = "IMPORT_PERMISSION";
  } else if (command.action === "GRANT_IMPORT_CONSENT") {
    const payload = parse(z.object({ sourceKey: safeKey, identity: SourceIdentitySchema, scopes: z.array(z.enum(["public-profile", "audience-metrics", "recent-posts"])).max(3).refine((values) => new Set(values).size === values.length), consentVersion: z.string().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/), granted: z.boolean() }).strict(), command.payload);
    const mapping = requireConfirmed(state, payload.sourceKey);
    if (canonicalHash(mapping.identity) !== canonicalHash(payload.identity)) throw new OnboardingError("SOURCE_IDENTITY_MISMATCH");
    if (payload.granted && !payload.scopes.includes("public-profile")) throw new OnboardingError("INVALID_CONSENT", 400);
    await invalidateSource(tx, draft, state, payload.sourceKey);
    mapping.revision += 1;
    state.mappingRevision += 1;
    if (payload.granted) consent[payload.sourceKey] = { identityHash: canonicalHash(mapping.identity), sourceRevision: mapping.revision, scopes: payload.scopes, consentVersion: payload.consentVersion, grantedAt: new Date().toISOString() };
    else delete consent[payload.sourceKey];
    // Permission is not evidence that import work has started. Queueing an actual
    // SourceJob is the separate explicit command that enters IMPORTING.
    step = "IMPORT_PERMISSION";
  } else if (command.action === "BACK") {
    const payload = parse(z.object({ step: z.string() }).strict(), command.payload);
    const steps = role === "CREATOR" ? creatorSteps : brandSteps;
    if (!steps.includes(payload.step) || steps.indexOf(payload.step) >= steps.indexOf(draft.step)) throw new OnboardingError("INVALID_STEP", 400);
    step = payload.step;
  } else {
    parse(z.object({}).strict(), command.payload);
    mode = "TEXT";
    if (command.action === "SAVE_DRAFT") step = "SAVED_DRAFT";
  }
  return { input: inputJson(state), consent: inputJson(consent), step, mode };
}

export async function applyDraftCommand(actorUserId: string, draftId: string, input: unknown, options: OnboardingCommandOptions = {}): Promise<{ draft: DraftDTO; replayed: boolean }> {
  const session = await beginOnboardingSession(actorUserId, options);
  checkedJson(input);
  const command = parse(CommandSchema, input);
  if (session.options.channel === "VOICE") command.channel = "VOICE";
  const operationKey = `draft:${command.operationKey}`, hash = canonicalHash(command);
  return withOwnedDraft(session, draftId, async (tx, draft, role) => {
    const replay = await commandReplay<{ draft: DraftDTO }>(tx, draft, operationKey, hash);
    if (replay) return { ...replay, replayed: true };
    requireRevision(draft, command.expectedRevision);
    const data = await change(tx, draft, role, command);
    const result = await persistCommand(tx, draft, command.expectedRevision, operationKey, hash, data, async (updated) => ({ draft: await draftDTO(tx, updated, role) }));
    return { ...result, replayed: false };
  });
}
