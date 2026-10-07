import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { captureOrganizationActor, checkOrganizationActor, organizationAwait, organizationDb,
  type OrganizationActor, type OrganizationOptions } from "@/lib/organizations/context";
import { createEvidenceReceiptReader } from "@/lib/evidence/receipt-reader";
import { inspectEvidence, type EvidenceStorage } from "@/lib/evidence/storage";
import { canonicalHash, inputJson } from "@/lib/onboarding/drafts";
import { BrandContextError, parseBrandContextInput } from "./contracts";
import { contextParentBindingSelect, lockPlanningRows, resolvePlanningWorkspace, withBrandContextScope,
  withContextOwnerReviews, type BrandContextScopeContext } from "./scope";
import { beginPlanningCall, captureCampaignOwnerReviewScope, withCampaignOwnerReviewScope,
  type CampaignOwnerScopeFrame } from "@/lib/campaign-planning/scope";
import { ContextReferenceCommandSchema, ContextReferenceItemsSchema, ContextReferenceReceiptSchema,
  ContextReferenceCommandResultSchema, ContextReferenceResponseSchema, ContextReferenceQuerySchema,
  ContextReferenceAssetQuerySchema, ContextReviewReferenceAssetQuerySchema, ContextReviewReferenceQuerySchema,
  ContextReviewReferenceResponseSchema, CampaignReviewReferenceResponseSchema,
  type ContextReferenceCommand, type ContextReferenceCommandResult, type ContextReferenceResponse,
  type ContextReviewReferenceResponse, type CampaignReviewReferenceResponse } from "./reference-contracts";

export type ContextReferenceOptions = OrganizationOptions & { storage: EvidenceStorage };
export type ContextReferenceMetadataOptions = OrganizationOptions & { storage?: EvidenceStorage };
type Tx = Prisma.TransactionClient;
type Checkpoint = () => void;
type Items = z.infer<typeof ContextReferenceItemsSchema>;
type Manifest = Prisma.ContextReferenceManifestGetPayload<Record<string, never>>;
type Receipt = z.infer<typeof ContextReferenceReceiptSchema>;
const missing = (): never => { throw new BrandContextError("NOT_FOUND", 404); };
const retry = (): never => { throw new BrandContextError("RETRY_REQUIRED", 503); };
const fail = (code: string, status = 409): never => { throw new BrandContextError(code, status); };
function parsed<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); return result.success ? result.data : retry(); }
async function begin(actorInput: OrganizationActor, options: ContextReferenceMetadataOptions) {
  const actor = captureOrganizationActor(actorInput), client = organizationDb(options), storage = options.storage;
  const reader = createEvidenceReceiptReader(), checkpoint = () => reader.checkpoint();
  await checkOrganizationActor(actor, { client }, checkpoint);
  return { actor, options: { client }, storage, checkpoint, now: new Date() };
}
async function lockReferences(tx: Tx, table: "ContextReferenceState" | "ContextReferenceManifest" | "ContextAssetBinding" | "PrivateAsset",
  ids: readonly string[], write: boolean, checkpoint: Checkpoint) {
  const ordered = [...new Set(ids)].sort(); if (!ordered.length) return;
  const field = table === "ContextReferenceState" ? "contextId" : "id";
  await organizationAwait(checkpoint, () => tx.$queryRaw(Prisma.sql`SELECT ${Prisma.raw('"' + field + '"')} FROM ${Prisma.raw('"' + table + '"')}
    WHERE ${Prisma.raw('"' + field + '"')} IN (${Prisma.join(ordered)}) ORDER BY ${Prisma.raw('"' + field + '"')}
    ${Prisma.raw(write ? "FOR UPDATE" : "FOR SHARE")}`));
}
async function parent(tx: Tx, contextId: string, workspaceId: string, write: boolean, checkpoint: Checkpoint) {
  const thin = await organizationAwait(checkpoint, () => tx.brandContext.findUnique({ where: { id: contextId }, select: contextParentBindingSelect }));
  if (!thin || thin.workspaceId !== workspaceId) return missing();
  await lockPlanningRows(tx, "BrandContext", [contextId], write, checkpoint);
  const row = await organizationAwait(checkpoint, () => tx.brandContext.findUnique({ where: { id: contextId }, select: contextParentBindingSelect }));
  if (!row || row.workspaceId !== workspaceId) return missing(); return row;
}
async function currentState(tx: Tx, contextId: string, workspaceId: string, write: boolean, checkpoint: Checkpoint) {
  await lockReferences(tx, "ContextReferenceState", [contextId], write, checkpoint);
  const state = await organizationAwait(checkpoint, () => tx.contextReferenceState.findUnique({ where: { contextId } }));
  if (state && state.workspaceId !== workspaceId) return retry(); return state;
}
async function exactManifest(tx: Tx, value: { contextId: string; workspaceId: string; manifestId: string; referenceRevision: number; manifestHash: string }, checkpoint: Checkpoint) {
  await lockReferences(tx, "ContextReferenceManifest", [value.manifestId], false, checkpoint);
  const row = await organizationAwait(checkpoint, () => tx.contextReferenceManifest.findUnique({ where: { id: value.manifestId } }));
  if (!row || row.contextId !== value.contextId || row.workspaceId !== value.workspaceId || row.referenceRevision !== value.referenceRevision
    || row.hash !== value.manifestHash) return retry();
  const items = parsed(ContextReferenceItemsSchema, row.items);
  if (items.length !== row.itemCount || canonicalHash(items) !== row.hash) return retry();
  return { row, items };
}
async function bindings(tx: Tx, contextId: string, workspaceId: string, items: Items, checkpoint: Checkpoint) {
  const ids = items.map(item => item.bindingId);
  await lockReferences(tx, "ContextAssetBinding", ids, false, checkpoint);
  const rows = ids.length ? await organizationAwait(checkpoint, () => tx.contextAssetBinding.findMany({ where: { id: { in: ids }, contextId, workspaceId }, take: 20 })) : [];
  if (rows.length !== ids.length || rows.some(row => row.purpose !== "MARKETING_REFERENCE")) return missing();
  await lockReferences(tx, "PrivateAsset", rows.map(row => row.assetId), false, checkpoint);
  const assets = rows.length ? await organizationAwait(checkpoint, () => tx.privateAsset.findMany({ where: { id: { in: rows.map(row => row.assetId) } }, take: 20 })) : [];
  return items.map(item => {
    const binding = rows.find(row => row.id === item.bindingId), asset = binding ? assets.find(row => row.id === binding.assetId) : null;
    if (!binding || !asset || asset.purpose !== "MARKETING_REFERENCE" || asset.ownerUserId !== binding.uploaderUserId) return retry();
    return { item, binding, asset };
  });
}
async function project(tx: Tx, row: Manifest, items: Items, checkpoint: Checkpoint) {
  const related = await bindings(tx, row.contextId, row.workspaceId, items, checkpoint);
  return { kind: "MANIFEST" as const, id: row.id, revision: row.referenceRevision, hash: row.hash,
    items: related.map(({ item, asset }) => ({ ...item, assetId: asset.id, contentType: asset.contentType, size: asset.size })) };
}
async function chosenManifest(tx: Tx, query: z.infer<typeof ContextReferenceQuerySchema>, workspaceId: string, checkpoint: Checkpoint) {
  if (!query.versionId) {
    const state = await currentState(tx, query.contextId, workspaceId, false, checkpoint);
    return state ? exactManifest(tx, state, checkpoint) : null;
  }
  const version = await organizationAwait(checkpoint, () => tx.brandContextVersion.findUnique({ where: { id: query.versionId! },
    select: { id: true, contextId: true, workspaceId: true, submissionId: true, contentHash: true, inputRevision: true,
      approvedByUserId: true, approvedAt: true } }));
  if (!version || version.contextId !== query.contextId || version.workspaceId !== workspaceId) return missing();
  await lockPlanningRows(tx, "BrandContextSubmission", [version.submissionId], false, checkpoint);
  await lockPlanningRows(tx, "BrandContextVersion", [version.id], false, checkpoint);
  const source = await organizationAwait(checkpoint, () => tx.brandContextSubmission.findUnique({ where: { id: version.submissionId },
    select: { contextId: true, workspaceId: true, contentHash: true, inputRevision: true, state: true, decidedByUserId: true, decidedAt: true } }));
  if (!source || source.contextId !== query.contextId || source.workspaceId !== workspaceId || source.state !== "APPROVED"
    || source.contentHash !== version.contentHash || source.inputRevision !== version.inputRevision || source.decidedByUserId !== version.approvedByUserId
    || source.decidedAt?.getTime() !== version.approvedAt.getTime()) return retry();
  const capture = await organizationAwait(checkpoint, () => tx.contextSubmissionReferences.findUnique({ where: { submissionId: version.submissionId } }));
  return capture ? exactManifest(tx, capture, checkpoint) : null;
}
async function download(tx: Tx, manifest: { row: Manifest; items: Items } | null, bindingId: string, storage: EvidenceStorage, checkpoint: Checkpoint) {
  const item = manifest?.items.find(value => value.bindingId === bindingId);
  if (!manifest || !item) return missing();
  const [related] = await bindings(tx, manifest.row.contextId, manifest.row.workspaceId, [item], checkpoint);
  if (!related) return retry();
  const asset = related.asset, prefix = storage.kind.toLowerCase() + ":";
  if (asset.deletedAt || !asset.storageKey.startsWith(prefix)) return fail("ASSET_BYTES_UNAVAILABLE", 503);
  const bytes = await organizationAwait(checkpoint, () => storage.get(asset.storageKey.slice(prefix.length)));
  let inspected: ReturnType<typeof inspectEvidence>;
  try { inspected = inspectEvidence(bytes, asset.contentType); }
  catch { return fail("ASSET_BYTES_UNAVAILABLE", 503); }
  if (inspected.checksum !== asset.checksum || inspected.size !== asset.size) return fail("ASSET_BYTES_UNAVAILABLE", 503);
  const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" }[inspected.contentType];
  return { bytes, headers: { "Content-Type": inspected.contentType, "Content-Disposition": 'attachment; filename="reference.' + extension + '"',
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'" } };
}
export async function getContextReferences(actor: OrganizationActor, input: unknown, options: ContextReferenceMetadataOptions = {}): Promise<ContextReferenceResponse> {
  const query = parseBrandContextInput(ContextReferenceQuerySchema, input), call = await begin(actor, options);
  return withBrandContextScope(call.actor, query.scope, "view", { write: false, checkpoint: call.checkpoint, execute: async (tx, context) => {
    const workspace = await resolvePlanningWorkspace(tx, context, false, call.checkpoint); if (!workspace) return missing();
    const current = await parent(tx, query.contextId, workspace.id, false, call.checkpoint);
    const selected = await chosenManifest(tx, query, workspace.id, call.checkpoint);
    return parsed(ContextReferenceResponseSchema, { contextId: current.id, revision: current.revision, inputRevision: current.inputRevision,
      archived: current.archived, versionId: query.versionId ?? null, scope: context.scope, currentAuthority: context.currentAuthority,
      references: selected ? await project(tx, selected.row, selected.items, call.checkpoint) : { kind: "LEGACY_ABSENT" } });
  } }, call.options);
}
export async function getContextReferenceAsset(actor: OrganizationActor, input: unknown, options: ContextReferenceOptions) {
  const query = parseBrandContextInput(ContextReferenceAssetQuerySchema, input), call = await begin(actor, options);
  return withBrandContextScope(call.actor, query.scope, "view", { write: false, checkpoint: call.checkpoint, execute: async (tx, context) => {
    const workspace = await resolvePlanningWorkspace(tx, context, false, call.checkpoint); if (!workspace) return missing();
    await parent(tx, query.contextId, workspace.id, false, call.checkpoint);
    return download(tx, await chosenManifest(tx, query, workspace.id, call.checkpoint), query.bindingId,
      call.storage ?? fail("CAPABILITY_UNAVAILABLE", 503), call.checkpoint);
  } }, call.options);
}
export async function getContextReviewReferenceAsset(actor: OrganizationActor, input: unknown, options: ContextReferenceOptions) {
  const query = parseBrandContextInput(ContextReviewReferenceAssetQuerySchema, input), call = await begin(actor, options);
  return withContextOwnerReviews(call.actor, [query.submissionId], false, async (tx, reviews) => {
    const review = reviews.get(query.submissionId); if (!review) return missing();
    const capture = await organizationAwait(call.checkpoint, () => tx.contextSubmissionReferences.findUnique({ where: { submissionId: review.submission.id } }));
    if (capture && (capture.contextId !== review.context.id || capture.workspaceId !== review.workspace.id)) return retry();
    return download(tx, capture ? await exactManifest(tx, capture, call.checkpoint) : null, query.bindingId,
      call.storage ?? fail("CAPABILITY_UNAVAILABLE", 503), call.checkpoint);
  }, call.options, call.checkpoint);
}
export async function getContextReviewReferences(actor: OrganizationActor, input: unknown,
  options: OrganizationOptions = {}): Promise<ContextReviewReferenceResponse> {
  const packet = ContextReviewReferenceQuerySchema.safeParse(input), call = await begin(actor, options);
  const query = packet.success ? packet.data : fail("VALIDATION", 422);
  return withContextOwnerReviews(call.actor, [query.submissionId], false, async (tx, reviews) => {
    const review = reviews.get(query.submissionId); if (!review) return missing();
    const capture = await organizationAwait(call.checkpoint, () => tx.contextSubmissionReferences.findUnique({ where: { submissionId: review.submission.id } }));
    if (capture && (capture.contextId !== review.context.id || capture.workspaceId !== review.workspace.id)) return retry();
    const selected = capture ? await exactManifest(tx, capture, call.checkpoint) : null;
    return parsed(ContextReviewReferenceResponseSchema, { submissionId: review.submission.id, contextId: review.context.id,
      references: selected ? await project(tx, selected.row, selected.items, call.checkpoint) : { kind: "LEGACY_ABSENT" } });
  }, call.options, call.checkpoint);
}
async function campaignReferenceManifest(tx: Tx, frame: CampaignOwnerScopeFrame, submissionId: string, checkpoint: Checkpoint) {
  const binding = frame.bindings.get(submissionId); if (!binding) return missing();
  const versionId = binding.submittedSelection.contextVersionId;
  if (versionId === null) return { binding, versionId, selected: null };
  const version = frame.versions.get(versionId);
  if (!version || version.workspaceId !== binding.workspace.id || version.contentHash !== binding.submittedSelection.contentHash
    || !frame.contexts.has(version.contextId)) return retry();
  // The campaign owner frame already holds the exact pinned Context, Version
  // and source Submission locks. Do not enter a context transaction or acquire
  // an old owner's User lock/agency seat to read retained approved provenance.
  const source = await organizationAwait(checkpoint, () => tx.brandContextSubmission.findUnique({ where: { id: version.submissionId },
    select: { contextId: true, workspaceId: true, state: true, inputRevision: true, contentHash: true, decidedByUserId: true, decidedAt: true } }));
  if (!source || source.contextId !== version.contextId || source.workspaceId !== binding.workspace.id || source.state !== "APPROVED"
    || source.inputRevision !== version.inputRevision || source.contentHash !== version.contentHash
    || source.decidedByUserId !== version.approvedByUserId || source.decidedAt?.getTime() !== version.approvedAt.getTime()) return retry();
  const capture = await organizationAwait(checkpoint, () => tx.contextSubmissionReferences.findUnique({ where: { submissionId: version.submissionId } }));
  if (capture && (capture.contextId !== version.contextId || capture.workspaceId !== binding.workspace.id)) return retry();
  return { binding, versionId, selected: capture ? await exactManifest(tx, capture, checkpoint) : null };
}
export async function getCampaignReviewReferences(actor: OrganizationActor, input: unknown,
  options: OrganizationOptions = {}): Promise<CampaignReviewReferenceResponse> {
  const packet = ContextReviewReferenceQuerySchema.safeParse(input), call = await beginPlanningCall(actor, options);
  const query = packet.success ? packet.data : fail("VALIDATION", 422);
  const capture = await captureCampaignOwnerReviewScope(call, [query.submissionId]);
  return withCampaignOwnerReviewScope(call, capture, false, async (tx, frame) => {
    const { binding, versionId, selected } = await campaignReferenceManifest(tx, frame, query.submissionId, call.checkpoint);
    return parsed(CampaignReviewReferenceResponseSchema, { submissionId: binding.submission.id, campaignId: binding.campaign.id,
      contextVersionId: versionId, references: versionId === null ? { kind: "NO_CONTEXT" }
        : selected ? await project(tx, selected.row, selected.items, call.checkpoint) : { kind: "LEGACY_ABSENT" } });
  });
}
export async function getCampaignReviewReferenceAsset(actor: OrganizationActor, input: unknown, options: ContextReferenceOptions) {
  const packet = ContextReviewReferenceAssetQuerySchema.safeParse(input), storage = options.storage,
    call = await beginPlanningCall(actor, options);
  const query = packet.success ? packet.data : fail("VALIDATION", 422);
  const capture = await captureCampaignOwnerReviewScope(call, [query.submissionId]);
  return withCampaignOwnerReviewScope(call, capture, false, async (tx, frame) => {
    const { selected } = await campaignReferenceManifest(tx, frame, query.submissionId, call.checkpoint);
    return download(tx, selected, query.bindingId, storage, call.checkpoint);
  });
}
function commandHash(command: ContextReferenceCommand, actorUserId: string) {
  if (command.action !== "UPLOAD") return canonicalHash({ purpose: "CONTEXT_REFERENCE_V1", actorUserId, command });
  const { bytes, ...metadata } = command.payload;
  return canonicalHash({ purpose: "CONTEXT_REFERENCE_V1", actorUserId, command: { ...command,
    payload: { ...metadata, ...inspectEvidence(bytes, metadata.contentType) } } });
}
export async function executeContextReferenceCommand(actor: OrganizationActor, input: unknown,
  options: ContextReferenceMetadataOptions = {}): Promise<ContextReferenceCommandResult> {
  const parsedCommand = parseBrandContextInput(ContextReferenceCommandSchema, input);
  const command = parsedCommand.action === "UPLOAD" ? { ...parsedCommand, payload: { ...parsedCommand.payload, bytes: Uint8Array.from(parsedCommand.payload.bytes) } } : parsedCommand;
  const call = await begin(actor, options), payloadHash = commandHash(command, call.actor.userId);
  let workspaceId = "";
  const resolve = async (tx: Tx, context: BrandContextScopeContext) => {
    const workspace = await resolvePlanningWorkspace(tx, context, false, call.checkpoint); if (!workspace) return missing();
    workspaceId = workspace.id; return parent(tx, command.contextId, workspace.id, true, call.checkpoint);
  };
  return withBrandContextScope<ContextReferenceCommandResult>(call.actor, command.scope, "plan", { write: true, checkpoint: call.checkpoint,
    expectedAuthority: "expectedAuthority" in command ? command.expectedAuthority : undefined,
    replay: async (tx, context) => {
      await resolve(tx, context);
      const previous = await organizationAwait(call.checkpoint, () => tx.contextReferenceCommand.findUnique({
        where: { actorUserId_operationKey: { actorUserId: call.actor.userId, operationKey: command.operationKey } } }));
      if (!previous) return { found: false };
      if (previous.workspaceId !== workspaceId) return missing();
      if (previous.contextId !== command.contextId || previous.action !== command.action || previous.payloadHash !== payloadHash) return fail("IDEMPOTENCY_CONFLICT");
      const receipt = parsed(ContextReferenceReceiptSchema, previous.result);
      if (receipt.contextId !== command.contextId || receipt.revision !== command.expectedRevision + 1
        || receipt.referenceRevision !== command.expectedReferenceRevision + 1 || receipt.manifestId !== previous.manifestId
        || (command.action === "UPLOAD") !== (receipt.bindingId !== null)) return retry();
      const selected = await exactManifest(tx, { ...receipt, workspaceId, manifestHash: receipt.manifestHash }, call.checkpoint);
      if (command.action === "UPLOAD") {
        const match = selected.items.find(item => item.bindingId === receipt.bindingId); if (!match) return retry();
        const related = await bindings(tx, command.contextId, workspaceId, [match], call.checkpoint), inspected = inspectEvidence(command.payload.bytes, command.payload.contentType);
        const asset = related[0]?.asset;
        if (!asset || asset.checksum !== inspected.checksum || asset.contentType !== inspected.contentType || asset.size !== inspected.size
          || canonicalHash({ labelOriginal: match.labelOriginal, notesOriginal: match.notesOriginal }) !== canonicalHash({ labelOriginal: command.payload.labelOriginal, notesOriginal: command.payload.notesOriginal })) return retry();
      } else if (canonicalHash(command.payload.items) !== receipt.manifestHash) return retry();
      return { found: true, result: parsed(ContextReferenceCommandResultSchema, { ...receipt, replayed: true }) };
    },
    execute: async (tx, context) => {
      const source = await resolve(tx, context), state = await currentState(tx, command.contextId, workspaceId, true, call.checkpoint);
      if (source.archived) return fail("ARCHIVED");
      if (source.revision !== command.expectedRevision || (state?.referenceRevision ?? 0) !== command.expectedReferenceRevision) return fail("STALE_VERSION");
      if (source.revision >= 2147483646 || (state?.referenceRevision ?? 0) >= 2147483646) return fail("REVISION_EXHAUSTED");
      let items: Items, bindingId: string | null = null;
      if (command.action === "REPLACE") items = command.payload.items;
      else {
        const storage = call.storage; if (!storage) return fail("CAPABILITY_UNAVAILABLE", 503);
        const current = state ? await exactManifest(tx, state, call.checkpoint) : null;
        if ((current?.items.length ?? 0) >= 20) return fail("REFERENCE_LIMIT", 422);
        const inspected = inspectEvidence(command.payload.bytes, command.payload.contentType);
        const assetId = createHash("sha256").update("infame-context-reference:v1:" + call.actor.userId + ":" + command.operationKey).digest("hex");
        bindingId = createHash("sha256").update("binding:" + assetId).digest("hex");
        const objectKey = createHash("sha256").update(call.actor.userId).digest("hex").slice(0, 32) + "/" + assetId;
        if (await organizationAwait(call.checkpoint, () => tx.privateAsset.findUnique({ where: { id: assetId }, select: { id: true } }))) return fail("IDEMPOTENCY_CONFLICT");
        // Stable immutable keys permit reconciliation after an uncertain commit.
        // This boundary never deletes bytes on an unproved rollback.
        await organizationAwait(call.checkpoint, () => storage.put(objectKey, command.payload.bytes, inspected.contentType));
        await organizationAwait(call.checkpoint, () => tx.privateAsset.create({ data: { id: assetId, ownerUserId: call.actor.userId,
          purpose: "MARKETING_REFERENCE", storageKey: storage.kind.toLowerCase() + ":" + objectKey, ...inspected, createdAt: call.now } }));
        await organizationAwait(call.checkpoint, () => tx.contextAssetBinding.create({ data: { id: bindingId!, contextId: source.id, workspaceId,
          assetId, uploaderUserId: call.actor.userId, purpose: "MARKETING_REFERENCE", createdAt: call.now } }));
        items = [...(current?.items ?? []), { bindingId, labelOriginal: command.payload.labelOriginal, notesOriginal: command.payload.notesOriginal }];
      }
      items = parseBrandContextInput(ContextReferenceItemsSchema, items);
      await bindings(tx, source.id, workspaceId, items, call.checkpoint);
      const manifestId = randomUUID(), referenceRevision = (state?.referenceRevision ?? 0) + 1, manifestHash = canonicalHash(items), revision = source.revision + 1;
      await organizationAwait(call.checkpoint, () => tx.contextReferenceManifest.create({ data: { id: manifestId, contextId: source.id,
        workspaceId, referenceRevision, hash: manifestHash, itemCount: items.length, items: inputJson(items), createdAt: call.now } }));
      if (state) await organizationAwait(call.checkpoint, () => tx.contextReferenceState.update({ where: { contextId: source.id },
        data: { referenceRevision, manifestId, manifestHash, updatedAt: call.now } }));
      else await organizationAwait(call.checkpoint, () => tx.contextReferenceState.create({ data: { contextId: source.id, workspaceId,
        referenceRevision, manifestId, manifestHash, createdAt: call.now, updatedAt: call.now } }));
      await organizationAwait(call.checkpoint, () => tx.brandContext.update({ where: { id: source.id }, data: { revision, updatedAt: call.now } }));
      const receipt: Receipt = { contextId: source.id, revision, referenceRevision, manifestId, manifestHash, bindingId };
      const receiptId = randomUUID();
      await organizationAwait(call.checkpoint, () => tx.contextReferenceCommand.create({ data: { id: receiptId, actorUserId: call.actor.userId,
        operationKey: command.operationKey, payloadHash, contextId: source.id, workspaceId, action: command.action, manifestId, result: inputJson(receipt), createdAt: call.now } }));
      await organizationAwait(call.checkpoint, () => tx.adminAudit.create({ data: { actorUserId: call.actor.userId, action: "brand_context.references_changed",
        resourceType: "BrandContext", resourceId: source.id, snapshot: inputJson(receipt), createdAt: call.now } }));
      return parsed(ContextReferenceCommandResultSchema, { ...receipt, replayed: false });
    },
  }, call.options);
}
