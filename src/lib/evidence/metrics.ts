import { Prisma, type FactCorrection, type MetricsSnapshot } from "@prisma/client";
import { z } from "zod";
import { AudienceAgeBucketSchema, AudienceGenderSchema, CountryCodeSchema, DateRangeSchema, DealFormatSchema, PLATFORM_FORMATS, UtcDateTimeSchema, VisibilitySchema } from "@/lib/contracts/vocabulary";
import { accountContext, canonicalHash, event, Id, identityHash, inputJson, Key, lock, Note, parse, previous, receipt, record, requireMapping, requireRevision, Revision, transaction, type EvidenceOptions, type Tx } from "./common";
import { usableAsset } from "./assets";
import { EvidenceError } from "./storage";
import { snapshotScopeHash } from "./metrics-readiness";
import { metricFields, SnapshotSharingCommandSchema as ApproveSnapshot } from "./metrics-sharing-contract";
const Count = z.string().regex(/^(0|[1-9][0-9]{0,15})$/).refine(v => BigInt(v) <= BigInt(Number.MAX_SAFE_INTEGER));
const Percent = z.number().finite().min(0).max(100);
const Context = z.object({ unit: z.literal("PERCENT"), window: DateRangeSchema, definition: z.string().trim().min(1).max(500), visibility: VisibilitySchema.default("PRIVATE") }).strict();
const View = z.object({ format: DealFormatSchema, value: z.number().finite().nonnegative(), unit: z.enum(["VIEWS", "IMPRESSIONS"]), window: DateRangeSchema, definition: z.string().trim().min(1).max(500), visibility: VisibilitySchema.default("PRIVATE") }).strict();
function dimension(keySchema: z.ZodType<string>) {
  return z.object({ value: z.array(z.object({ key: keySchema, percent: Percent }).strict()).min(1).max(300),
    visibility: VisibilitySchema.default("PRIVATE"), roundingToleranceDocumented: z.boolean().optional() }).strict().refine(r => new Set(r.value.map(b => b.key)).size === r.value.length && r.value.reduce((sum, b) => sum + b.percent, 0) <= 100 + (r.roundingToleranceDocumented ? .01 + 1e-9 : 1e-9));
}
const CityKey = z.string().regex(/^[A-Z]{2}:[a-z0-9]+(?:-[a-z0-9]+)*$/).refine(k => CountryCodeSchema.safeParse(k.slice(0, 2)).success);
const Demographics = z.object({ age: dimension(AudienceAgeBucketSchema).nullable().optional(), gender: dimension(AudienceGenderSchema).nullable().optional(),
  countries: dimension(CountryCodeSchema).nullable().optional(), cities: dimension(CityKey).nullable().optional() }).strict();
export const ScreenshotMetricsSchema = z.object({ followers: Count.optional(), averageViews: Count.optional(),
  engagementRate: z.string().regex(/^(0|[1-9][0-9]{0,2})(\.[0-9]{1,8})?$/).refine(v => Number(v) <= 100).optional(),
  engagementContext: Context.optional(), demographics: Demographics.optional(), formatMetrics: z.array(View).max(20).optional() }).strict()
  .refine(m => m.followers !== undefined || m.averageViews !== undefined || m.engagementRate !== undefined || m.demographics !== undefined || !!m.formatMetrics?.length)
  .refine(m => m.engagementRate === undefined || m.engagementContext !== undefined);
const Submit = z.object({ operationKey: Key, accountId: Id, expectedMappingRevision: Revision, expectedEvidenceRevision: Revision,
  evidenceAssetId: Id, observedAt: UtcDateTimeSchema }).extend(ScreenshotMetricsSchema.shape).strict();
// Tool/form input has no trusted source field. The only promotion path is review.
const Review = z.object({ operationKey: Key, expectedEvidenceRevision: Revision, decision: z.enum(["VERIFIED", "REJECTED", "REVOKED"]), note: Note }).strict();
export function snapshotDTO(s: MetricsSnapshot) { return { id: s.id, accountId: s.accountId, source: s.source, mappingRevision: s.mappingRevision, supersedesId: s.supersedesId,
  observedAt: s.observedAt.toISOString(), followers: s.followers?.toString() ?? null, averageViews: s.averageViews?.toString() ?? null,
  engagementRate: s.engagementRate?.toString() ?? null, demographics: s.demographics, formatMetrics: s.formatMetrics, engagementContext: s.engagementContext,
  approvedAt: s.approvedAt?.toISOString() ?? null, reviewStatus: s.reviewStatus, evidenceAssetId: s.evidenceAssetId }; }
export type MetricsSnapshotDTO = ReturnType<typeof snapshotDTO>;
async function snapshotBinding(tx: Tx, id: string, owner: string) {
  const records = await tx.evidenceCommand.findMany({ where: { resourceType: "MetricsSnapshot", resourceId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return records.find(r => record(r.resultJson).ownerUserId === owner && typeof record(r.resultJson).identityHash === "string");
}
export async function approveMetricsSnapshot(actor: string, id: string, input: unknown, options: EvidenceOptions): Promise<{ snapshot: MetricsSnapshotDTO; replayed: boolean }> {
  parse(Id, id); const command = parse(ApproveSnapshot, input), hash = canonicalHash({ action: "APPROVE_SCREENSHOT_FIELDS", id, ...command });
  return transaction(options, actor, async (tx, now, boundary) => {
    const initial = await tx.metricsSnapshot.findUnique({ where: { id } }); if (!initial) throw new EvidenceError("NOT_FOUND", 404);
    const { creator, account } = await accountContext(tx, actor, initial.accountId); await lock(tx, "MetricsSnapshot", id);
    now = await boundary.checkpoint();
    let snapshot = await tx.metricsSnapshot.findUniqueOrThrow({ where: { id } });
    const binding = await snapshotBinding(tx, id, actor), metadata = record(binding?.resultJson);
    requireMapping(account, command.expectedMappingRevision, typeof metadata.identityHash === "string" ? metadata.identityHash : "missing");
    if (snapshot.mappingRevision !== account.mappingRevision || snapshot.excludedAt || snapshot.observedAt > now || !["SELF_REPORTED", "SCREENSHOT_VERIFIED"].includes(snapshot.source)) throw new EvidenceError("INVALID_STATE");
    const replay = await previous(tx, actor, command.operationKey, hash);
    if (replay) return { snapshot: snapshotDTO(snapshot), replayed: true };
    requireRevision(account.evidenceRevision, command.expectedEvidenceRevision);
    const fields = new Set(metricFields(snapshot));
    if (Object.keys(command.visibility).some(k => !fields.has(k))) throw new EvidenceError("INVALID_COMMAND", 400);
    if (snapshot.source === "SELF_REPORTED") snapshot = await tx.metricsSnapshot.update({ where: { id }, data: { reviewStatus: "VERIFIED", approvedAt: now, approvedBy: actor } });
    else if (snapshot.reviewStatus !== "VERIFIED" || !snapshot.approvedAt || !snapshot.approvedBy) throw new EvidenceError("INVALID_STATE");
    await tx.socialAccount.update({ where: { id: account.id }, data: { evidenceRevision: { increment: 1 }, factsApprovedAt: now, fieldVisibility: inputJson({ ...record(account.fieldVisibility), ...command.visibility }) } });
    await clearPublication(tx, creator.id);
    await receipt(tx, actor, command.operationKey, hash, "MetricsSnapshot", id, account.evidenceRevision + 1, now, {
      action: "APPROVE_SCREENSHOT_FIELDS", identityHash: identityHash(account), ownerUserId: actor,
      accountId: account.id, mappingRevision: account.mappingRevision, snapshotScopeHash: snapshotScopeHash(snapshot),
      expectedMappingRevision: command.expectedMappingRevision, expectedEvidenceRevision: command.expectedEvidenceRevision,
      visibility: command.visibility,
    });
    await event(tx, actor, command.operationKey, "facts.approved", "MetricsSnapshot", id, account.evidenceRevision + 1, now, { accountId: account.id, fields: Object.keys(command.visibility) });
    return { snapshot: snapshotDTO(snapshot), replayed: false };
  });
}
async function clearPublication(tx: Tx, creatorId: string) { await tx.creator.update({ where: { id: creatorId }, data: { state: "PRIVATE", brandVisible: false } }); }
function validateMetrics(command: z.infer<typeof Submit>, platform: keyof typeof PLATFORM_FORMATS, now: Date) {
  const metrics = parse(ScreenshotMetricsSchema, Object.fromEntries(["followers", "averageViews", "engagementRate", "engagementContext", "demographics", "formatMetrics"].filter(k => Object.hasOwn(command, k)).map(k => [k, command[k as keyof typeof command]])));
  if (Date.parse(command.observedAt) > now.getTime() || metrics.engagementContext && Date.parse(metrics.engagementContext.window.endsAt) > Date.parse(command.observedAt)
    || metrics.formatMetrics?.some(v => !PLATFORM_FORMATS[platform].includes(v.format) || Date.parse(v.window.endsAt) > Date.parse(command.observedAt))
    || metrics.formatMetrics && new Set(metrics.formatMetrics.map(v => v.format)).size !== metrics.formatMetrics.length) throw new EvidenceError("INVALID_COMMAND", 400);
  return metrics;
}
export async function submitMetricsScreenshot(actor: string, input: unknown, options: EvidenceOptions) {
  const command = parse(Submit, input), hash = canonicalHash({ action: "SUBMIT_SCREENSHOT", ...command });
  return transaction(options, actor, async (tx, now, boundary) => {
    const { account, creator } = await accountContext(tx, actor, command.accountId);
    now = await boundary.checkpoint();
    requireMapping(account, command.expectedMappingRevision);
    const replay = await previous(tx, actor, command.operationKey, hash);
    if (replay) return { snapshot: snapshotDTO(await tx.metricsSnapshot.findUniqueOrThrow({ where: { id: replay.resourceId } })), replayed: true };
    requireRevision(account.evidenceRevision, command.expectedEvidenceRevision);
    const metrics = validateMetrics(command, account.platform, now);
    await usableAsset(tx, command.evidenceAssetId, actor, "SCREENSHOT", options, boundary);
    now = await boundary.checkpoint();
    const snapshot = await tx.metricsSnapshot.create({ data: { accountId: account.id, mappingRevision: account.mappingRevision, source: "SELF_REPORTED", observedAt: new Date(command.observedAt),
      importedAt: now, evidenceAssetId: command.evidenceAssetId, ...(metrics.followers !== undefined ? { followers: BigInt(metrics.followers) } : {}),
      ...(metrics.averageViews !== undefined ? { averageViews: BigInt(metrics.averageViews) } : {}), ...(metrics.engagementRate !== undefined ? { engagementRate: new Prisma.Decimal(metrics.engagementRate) } : {}),
      // Observation payloads retain a display ceiling; live owner permissions
      // reside separately on the account and default explicitly to PRIVATE.
      ...(metrics.demographics ? { demographics: inputJson(Object.fromEntries(Object.entries(metrics.demographics).map(([k, v]) => [k, v ? { ...v, visibility: "PUBLIC" } : null]))) } : {}),
      ...(metrics.formatMetrics ? { formatMetrics: inputJson(metrics.formatMetrics.map(v => ({ ...v, visibility: "PUBLIC" }))) } : {}),
      ...(metrics.engagementContext ? { engagementContext: inputJson({ ...metrics.engagementContext, visibility: "PUBLIC" }) } : {}) } });
    await tx.socialAccount.update({ where: { id: account.id }, data: { evidenceRevision: { increment: 1 },
      fieldVisibility: inputJson({ ...record(account.fieldVisibility), ...Object.fromEntries(metricFields(snapshot).map(k => [k, "PRIVATE"])) }) } }); await clearPublication(tx, creator.id);
    await receipt(tx, actor, command.operationKey, hash, "MetricsSnapshot", snapshot.id, account.evidenceRevision + 1, now, {
      identityHash: identityHash(account), ownerUserId: actor, accountId: account.id, mappingRevision: account.mappingRevision,
      snapshotScopeHash: snapshotScopeHash(snapshot), submittedMetrics: metrics, expectedEvidenceRevision: command.expectedEvidenceRevision,
    });
    await event(tx, actor, command.operationKey, "facts.screenshot_submitted", "MetricsSnapshot", snapshot.id, account.evidenceRevision + 1, now, { accountId: account.id });
    return { snapshot: snapshotDTO(snapshot), replayed: false };
  });
}
export async function reviewMetricsScreenshot(actor: string, id: string, input: unknown, options: EvidenceOptions) {
  parse(Id, id); const command = parse(Review, input), hash = canonicalHash({ action: "REVIEW_SCREENSHOT", id, ...command });
  return transaction(options, actor, async (tx, now, boundary) => {
    const initial = await tx.metricsSnapshot.findUnique({ where: { id } }); if (!initial) throw new EvidenceError("NOT_FOUND", 404);
    const { account, creator } = await accountContext(tx, actor, initial.accountId, true); await lock(tx, "MetricsSnapshot", id);
    now = await boundary.checkpoint();
    const snapshot = await tx.metricsSnapshot.findUniqueOrThrow({ where: { id } });
    const submission = await snapshotBinding(tx, id, creator.userId!);
    requireMapping(account, snapshot.mappingRevision, typeof record(submission?.resultJson).identityHash === "string" ? record(submission?.resultJson).identityHash as string : "missing");
    if (record(submission?.resultJson).ownerUserId !== creator.userId) throw new EvidenceError("STALE_OWNER");
    const replay = await previous(tx, actor, command.operationKey, hash);
    if (replay) return { snapshot: snapshotDTO(await tx.metricsSnapshot.findUniqueOrThrow({ where: { id: replay.resourceId } })), replayed: true };
    requireRevision(account.evidenceRevision, command.expectedEvidenceRevision);
    if (command.decision === "REVOKED") {
      if (snapshot.source !== "SCREENSHOT_VERIFIED" || snapshot.reviewStatus !== "VERIFIED") throw new EvidenceError("INVALID_STATE");
      const updated = await tx.metricsSnapshot.update({ where: { id }, data: { reviewStatus: "REVOKED", excludedAt: now } });
      await tx.socialAccount.update({ where: { id: account.id }, data: { evidenceRevision: { increment: 1 } } }); await clearPublication(tx, creator.id);
      await receipt(tx, actor, command.operationKey, hash, "MetricsSnapshot", id, account.evidenceRevision + 1, now, {
        noteLanguage: command.note.language, identityHash: identityHash(account), ownerUserId: creator.userId, accountId: account.id,
        mappingRevision: account.mappingRevision, snapshotScopeHash: snapshotScopeHash(updated), parentId: id,
        decision: command.decision, note: command.note, expectedEvidenceRevision: command.expectedEvidenceRevision,
      });
      await event(tx, actor, command.operationKey, "facts.screenshot_reviewed", "MetricsSnapshot", id, account.evidenceRevision + 1, now, { accountId: account.id, status: command.decision });
      return { snapshot: snapshotDTO(updated), replayed: false };
    }
    if (snapshot.source !== "SELF_REPORTED" || !["PENDING", "VERIFIED"].includes(snapshot.reviewStatus) || snapshot.excludedAt || !snapshot.evidenceAssetId || snapshot.observedAt > now) throw new EvidenceError("INVALID_STATE");
    await usableAsset(tx, snapshot.evidenceAssetId, creator.userId!, "SCREENSHOT", options, boundary);
    now = await boundary.checkpoint();
    let result = snapshot;
    if (command.decision === "VERIFIED") {
      result = await tx.metricsSnapshot.create({ data: { accountId: account.id, mappingRevision: snapshot.mappingRevision, source: "SCREENSHOT_VERIFIED",
        supersedesId: snapshot.id, observedAt: snapshot.observedAt, importedAt: now, followers: snapshot.followers, averageViews: snapshot.averageViews,
        engagementRate: snapshot.engagementRate, demographics: snapshot.demographics === null ? Prisma.DbNull : inputJson(snapshot.demographics),
        formatMetrics: snapshot.formatMetrics === null ? Prisma.DbNull : inputJson(snapshot.formatMetrics),
        engagementContext: snapshot.engagementContext === null ? Prisma.DbNull : inputJson(snapshot.engagementContext),
        evidenceAssetId: snapshot.evidenceAssetId, reviewStatus: "VERIFIED", approvedAt: now, approvedBy: actor } });
    }
    await tx.metricsSnapshot.update({ where: { id }, data: { reviewStatus: command.decision === "VERIFIED" ? "VERIFIED" : "REJECTED", excludedAt: now } });
    await tx.socialAccount.update({ where: { id: account.id }, data: { evidenceRevision: { increment: 1 } } }); await clearPublication(tx, creator.id);
    await receipt(tx, actor, command.operationKey, hash, "MetricsSnapshot", result.id, account.evidenceRevision + 1, now, {
      noteLanguage: command.note.language, identityHash: identityHash(account), ownerUserId: creator.userId, accountId: account.id,
      mappingRevision: account.mappingRevision, snapshotScopeHash: snapshotScopeHash(result), parentId: id,
      decision: command.decision, note: command.note, expectedEvidenceRevision: command.expectedEvidenceRevision,
    });
    await event(tx, actor, command.operationKey, "facts.screenshot_reviewed", "MetricsSnapshot", result.id, account.evidenceRevision + 1, now, { accountId: account.id, status: command.decision });
    return { snapshot: snapshotDTO(result), replayed: false };
  });
}
const Correction = z.object({ operationKey: Key, accountId: Id, expectedMappingRevision: Revision, expectedEvidenceRevision: Revision,
  field: z.string().max(100), value: z.unknown(), evidenceAt: UtcDateTimeSchema, context: z.unknown().optional(), roundingToleranceDocumented: z.boolean().optional() }).strict();
function correctionValue(command: z.infer<typeof Correction>, platform: keyof typeof PLATFORM_FORMATS, now: Date) {
  if (Date.parse(command.evidenceAt) > now.getTime()) throw new EvidenceError("INVALID_COMMAND", 400);
  if (command.field === "followers") parse(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), command.value);
  else if (command.field === "engagementRate") { parse(Percent, command.value); const context = parse(Context, command.context); if (Date.parse(context.window.endsAt) > Date.parse(command.evidenceAt)) throw new EvidenceError("INVALID_COMMAND", 400); }
  else if (command.field.startsWith("demographics.")) {
    const schemas = { age: AudienceAgeBucketSchema, gender: AudienceGenderSchema, countries: CountryCodeSchema, cities: CityKey };
    const key = command.field.slice(13) as keyof typeof schemas; if (!schemas[key]) throw new EvidenceError("INVALID_COMMAND", 400);
    parse(dimension(schemas[key]), { value: command.value, visibility: "PRIVATE", ...(command.roundingToleranceDocumented !== undefined ? { roundingToleranceDocumented: command.roundingToleranceDocumented } : {}) });
  } else if (command.field.startsWith("formatMetrics.")) {
    const format = parse(DealFormatSchema, command.field.slice(14));
    const view = parse(View, { ...record(inputJson(command.context ?? {}) as Prisma.JsonValue), format, value: command.value, visibility: "PRIVATE" });
    if (!PLATFORM_FORMATS[platform].includes(format) || Date.parse(view.window.endsAt) > Date.parse(command.evidenceAt)) throw new EvidenceError("INVALID_COMMAND", 400);
  } else throw new EvidenceError("INVALID_COMMAND", 400);
}
export function correctionDTO(c: FactCorrection) { const value = record(c.value); return { id: c.id, accountId: c.accountId, field: c.field, revision: c.revision,
  value: value.value, source: "SELF_REPORTED" as const, evidenceAt: value.evidenceAt, mappingRevision: value.mappingRevision,
  context: value.context ?? null, approvedAt: c.approvedAt?.toISOString() ?? null, visibility: c.publicVisible ? "PUBLIC" : c.brandVisible ? "BRAND_ONLY" : "PRIVATE" }; }
export async function submitFactCorrection(actor: string, input: unknown, options: EvidenceOptions) {
  const command = parse(Correction, input), hash = canonicalHash({ action: "SUBMIT_CORRECTION", ...command });
  return transaction(options, actor, async (tx, now, boundary) => {
    const { account, creator } = await accountContext(tx, actor, command.accountId); requireMapping(account, command.expectedMappingRevision);
    now = await boundary.checkpoint();
    const replay = await previous(tx, actor, command.operationKey, hash);
    if (replay) return { correction: correctionDTO(await tx.factCorrection.findUniqueOrThrow({ where: { id: replay.resourceId } })), replayed: true };
    requireRevision(account.evidenceRevision, command.expectedEvidenceRevision); correctionValue(command, account.platform, now);
    const correction = await tx.factCorrection.create({ data: { accountId: account.id, field: command.field, reportedBy: actor, createdAt: now,
      value: inputJson({ value: command.value, source: "SELF_REPORTED", evidenceAt: command.evidenceAt, mappingRevision: account.mappingRevision,
        identityHash: identityHash(account), ...(command.context !== undefined ? { context: command.context } : {}), ...(command.roundingToleranceDocumented !== undefined ? { roundingToleranceDocumented: command.roundingToleranceDocumented } : {}) }) } });
    await tx.socialAccount.update({ where: { id: account.id }, data: { evidenceRevision: { increment: 1 }, fieldVisibility: inputJson({ ...record(account.fieldVisibility), [command.field]: "PRIVATE" }) } }); await clearPublication(tx, creator.id);
    await receipt(tx, actor, command.operationKey, hash, "FactCorrection", correction.id, 1, now);
    await event(tx, actor, command.operationKey, "facts.correction_submitted", "FactCorrection", correction.id, 1, now, { accountId: account.id, field: command.field });
    return { correction: correctionDTO(correction), replayed: false };
  });
}
const Approve = z.object({ operationKey: Key, expectedRevision: Revision, expectedMappingRevision: Revision, visibility: VisibilitySchema }).strict();
export async function approveFactCorrection(actor: string, id: string, input: unknown, options: EvidenceOptions) {
  parse(Id, id); const command = parse(Approve, input), hash = canonicalHash({ action: "APPROVE_CORRECTION", id, ...command });
  return transaction(options, actor, async (tx, now, boundary) => {
    const initial = await tx.factCorrection.findUnique({ where: { id } }); if (!initial) throw new EvidenceError("NOT_FOUND", 404);
    const { account, creator } = await accountContext(tx, actor, initial.accountId); await lock(tx, "FactCorrection", id);
    now = await boundary.checkpoint();
    const correction = await tx.factCorrection.findUniqueOrThrow({ where: { id } }), row = record(correction.value);
    requireMapping(account, command.expectedMappingRevision, typeof row.identityHash === "string" ? row.identityHash : "missing");
    if (row.mappingRevision !== account.mappingRevision || correction.reportedBy !== actor || correction.createdAt > now) throw new EvidenceError("STALE_IDENTITY");
    const replay = await previous(tx, actor, command.operationKey, hash); if (replay) return { correction: correctionDTO(correction), replayed: true };
    requireRevision(correction.revision, command.expectedRevision);
    const updated = await tx.factCorrection.update({ where: { id }, data: { revision: { increment: 1 }, approvedAt: now, brandVisible: command.visibility !== "PRIVATE", publicVisible: command.visibility === "PUBLIC" } });
    await tx.socialAccount.update({ where: { id: account.id }, data: { evidenceRevision: { increment: 1 }, factsApprovedAt: now, fieldVisibility: inputJson({ ...record(account.fieldVisibility), [correction.field]: command.visibility }) } }); await clearPublication(tx, creator.id);
    await receipt(tx, actor, command.operationKey, hash, "FactCorrection", id, updated.revision, now);
    await event(tx, actor, command.operationKey, "facts.approved", "FactCorrection", id, updated.revision, now, { accountId: account.id, field: correction.field, visibility: command.visibility });
    return { correction: correctionDTO(updated), replayed: false };
  });
}
