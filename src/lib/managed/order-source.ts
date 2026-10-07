import { Prisma } from "@prisma/client";
import { organizationAwait } from "@/lib/organizations/context";
import { lockPlanningRows } from "@/lib/brand-context/scope";
import { lockCampaignPlanningRows, lockScopedCampaignMetadata } from "@/lib/campaign-planning/scope";
import { campaignBriefDTO } from "@/lib/campaigns/core";
import { CampaignFieldsSchema } from "@/lib/campaigns/contracts";
import { ContextReferenceItemsSchema } from "@/lib/brand-context/reference-contracts";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { ManagedOrderSnapshotSchema, type ManagedOrderCommand, type ManagedOrderSnapshot } from "./contracts";
import { ManagedCustomerError, type ManagedCustomerScopeContext } from "./customer-scope";

type Tx = Prisma.TransactionClient;
function fail(code: string, status = 409): never { throw new ManagedCustomerError(code, status); }
const retry = (): never => fail("RETRY_REQUIRED", 503);
async function lock(tx: Tx, table: "ContextSubmissionReferences" | "ContextReferenceManifest" | "ContextAssetBinding" | "PrivateAsset",
  ids: readonly string[], checkpoint: () => void) {
  const ordered = [...new Set(ids)].sort(); if (!ordered.length) return;
  const field = table === "ContextSubmissionReferences" ? "submissionId" : "id";
  await organizationAwait(checkpoint, () => tx.$queryRaw(Prisma.sql`SELECT ${Prisma.raw('"' + field + '"')}
    FROM ${Prisma.raw('"' + table + '"')} WHERE ${Prisma.raw('"' + field + '"')} IN (${Prisma.join(ordered)})
    ORDER BY ${Prisma.raw('"' + field + '"')} FOR SHARE`));
}

// DB-only; caller holds the native current customer/Brand/workspace frame.
// Preflight captures exact metadata, then all source locks precede order writes.
export async function captureManagedOrderSource(tx: Tx, frame: ManagedCustomerScopeContext,
  command: ManagedOrderCommand, checkpoint: () => void): Promise<{ snapshot: ManagedOrderSnapshot;
    contextReferenceSubmissionId: string | null; inputRevision: number; approvedByUserId: string; approvedAt: Date }> {
  const query = <T>(operation: () => Promise<T>) => organizationAwait(checkpoint, operation);
  const workspace = await query(() => tx.planningWorkspace.findUnique({ where: { id: frame.workspaceId } }));
  if (!workspace) return retry();
  const firstState = await query(() => tx.campaignPlanningState.findFirst({ where: { campaignId: command.campaignId, workspaceId: frame.workspaceId },
    select: { selectionId: true } }));
  if (!firstState) return fail("NOT_FOUND", 404);
  const firstSelection = await query(() => tx.campaignContextSelection.findFirst({ where: { id: firstState.selectionId,
    campaignId: command.campaignId, workspaceId: frame.workspaceId } }));
  if (!firstSelection) return retry();
  const firstVersion = firstSelection.contextVersionId ? await query(() => tx.brandContextVersion.findFirst({
    where: { id: firstSelection.contextVersionId!, workspaceId: frame.workspaceId },
    select: { id: true, contextId: true, submissionId: true } })) : null;
  if (firstSelection.contextVersionId && !firstVersion) return retry();
  if (firstVersion) await lockPlanningRows(tx, "BrandContext", [firstVersion.contextId], false, checkpoint);
  const bound = (await lockScopedCampaignMetadata(tx, { workspace, scope: frame.scope, brandId: frame.brandId },
    [command.campaignId], true, checkpoint)).get(command.campaignId);
  if (!bound?.binding || !bound.state || !bound.selection) return retry();
  if (bound.campaign.revision !== command.expectedCampaignRevision || bound.state.revision !== command.expectedPlanningRevision
    || bound.selection.id !== command.expectedSelectionId || bound.selection.revision !== command.expectedSelectionRevision) return fail("STALE_VERSION");
  if (bound.selection.id !== firstSelection.id || bound.selection.contextVersionId !== firstVersion?.id && bound.selection.contextVersionId !== null) return retry();
  if (["CANCELLED", "COMPLETED"].includes(bound.campaign.status)) return fail("INVALID_STATE");
  if (await query(() => tx.deal.findFirst({ where: { campaignId: command.campaignId }, select: { id: true } }))) return fail("LEGACY_CAMPAIGN");
  await lockCampaignPlanningRows(tx, "CampaignContextSelection", [bound.selection.id], false, checkpoint);
  let selectedContext: unknown = null, references: unknown = { kind: "NO_CONTEXT" }, contextReferenceSubmissionId: string | null = null;
  if (firstVersion) {
    await lockPlanningRows(tx, "BrandContextVersion", [firstVersion.id], false, checkpoint);
    await lockPlanningRows(tx, "BrandContextSubmission", [firstVersion.submissionId], false, checkpoint);
    const version = await query(() => tx.brandContextVersion.findUnique({ where: { id: firstVersion.id } }));
    const source = await query(() => tx.brandContextSubmission.findUnique({ where: { id: firstVersion.submissionId }, select: {
      id: true, contextId: true, workspaceId: true, inputRevision: true, name: true, nameLanguage: true, content: true,
      contentHash: true, state: true, decidedByUserId: true, decidedAt: true } }));
    if (!version || !source || version.workspaceId !== frame.workspaceId || version.contextId !== firstVersion.contextId
      || version.submissionId !== source.id || version.contentHash !== bound.selection.contentHash || source.state !== "APPROVED"
      || source.workspaceId !== version.workspaceId || source.contextId !== version.contextId || source.inputRevision !== version.inputRevision
      || source.contentHash !== version.contentHash || source.decidedByUserId !== version.approvedByUserId
      || source.decidedAt?.getTime() !== version.approvedAt.getTime()) return retry();
    const nameOriginal = { text: source.name, language: source.nameLanguage };
    if (canonicalHash({ nameOriginal, content: source.content }) !== version.contentHash) return retry();
    selectedContext = { id: version.id, contextId: version.contextId, version: version.version, inputRevision: version.inputRevision,
      nameOriginal, content: source.content, contentHash: version.contentHash, approvedAt: version.approvedAt.toISOString() };
  }
  const scopedBrief = await query(() => tx.campaignBrief.findFirst({ where: { id: command.briefId, campaignId: command.campaignId },
    select: { id: true } }));
  if (!scopedBrief) return fail("STALE_BRIEF");
  await lockCampaignPlanningRows(tx, "CampaignBrief", [scopedBrief.id], false, checkpoint);
  await lockCampaignPlanningRows(tx, "CampaignBriefProvenance", [command.briefId], false, checkpoint);
  const latest = await query(() => tx.campaignBrief.findFirst({ where: { campaignId: command.campaignId }, orderBy: { version: "desc" }, select: { id: true } }));
  const brief = await query(() => tx.campaignBrief.findFirst({ where: { id: command.briefId, campaignId: command.campaignId } }));
  const pin = await query(() => tx.campaignBriefProvenance.findUnique({ where: { briefId: command.briefId } }));
  const brand = await query(() => tx.brand.findUnique({ where: { id: frame.brandId }, select: { id: true, userId: true, countryCode: true } }));
  if (!brief || latest?.id !== brief.id || brief.version !== command.expectedBriefVersion || !brief.approvedAt
    || brief.approvedByUserId !== brand?.userId || bound.campaign.currentBriefVersion !== brief.version) return fail("STALE_BRIEF");
  if (!brand || !frame.ownerIds.has(brand.userId) || !pin || pin.campaignId !== command.campaignId || pin.workspaceId !== frame.workspaceId
    || pin.selectionId !== bound.selection.id || pin.selectionRevision !== bound.selection.revision) return retry();
  // Freshness needs declared fields only, never conversation, narrative or
  // unapproved proposals, including for a sign-only client seat.
  const [current] = await query(() => tx.$queryRaw<Array<{ schemaVersion: unknown; fieldsRevision: unknown; fields: unknown }>>`
    SELECT input->'schemaVersion' AS "schemaVersion",input->'fieldsRevision' AS "fieldsRevision",input->'fields' AS fields
    FROM "Campaign" WHERE id=${command.campaignId}`);
  if (!current || current.schemaVersion !== 1 || typeof current.fieldsRevision !== "number"
    || !Number.isInteger(current.fieldsRevision) || current.fieldsRevision < 1 || current.fieldsRevision > bound.campaign.revision) return retry();
  let fields: ReturnType<typeof CampaignFieldsSchema.parse>, dto: ReturnType<typeof campaignBriefDTO>;
  try {
    fields = CampaignFieldsSchema.parse(current.fields); dto = campaignBriefDTO(brief);
    if (current.fieldsRevision !== brief.inputRevision) return fail("STALE_BRIEF");
  } catch (error) { if (error instanceof ManagedCustomerError) throw error; return retry(); }
  if (canonicalHash(fields) !== canonicalHash(current.fields) || canonicalHash(dto.content) !== canonicalHash(brief.content)) return retry();
  if (canonicalHash({ ...fields, campaignId: command.campaignId, version: brief.version, brandCountryCode: brand.countryCode,
    mandatoryPolicyVersionIds: dto.content.requirements.mandatoryPolicyVersionIds }) !== canonicalHash(dto.content.requirements)) return fail("STALE_BRIEF");
  const approval = await query(() => tx.campaignPlanningSubmission.findFirst({ where: { workspaceId: frame.workspaceId,
    campaignId: command.campaignId, briefId: brief.id, selectionId: bound.selection!.id, selectionRevision: bound.selection!.revision,
    inputRevision: brief.inputRevision, state: "APPROVED" }, select: { id: true } }));
  if (!approval) return fail("APPROVAL_REQUIRED");
  await lockCampaignPlanningRows(tx, "CampaignPlanningSubmission", [approval.id], false, checkpoint);
  const review = await query(() => tx.campaignPlanningSubmission.findUnique({ where: { id: approval.id }, select: {
    state: true, targetOwnerUserId: true, decidedByUserId: true, decidedAt: true } }));
  if (review?.state !== "APPROVED" || review.targetOwnerUserId !== brand.userId || review.decidedByUserId !== brief.approvedByUserId
    || review.decidedAt?.getTime() !== brief.approvedAt.getTime()) return retry();
  if (firstVersion) {
    await lock(tx, "ContextSubmissionReferences", [firstVersion.submissionId], checkpoint);
    const capture = await query(() => tx.contextSubmissionReferences.findUnique({ where: { submissionId: firstVersion.submissionId } }));
    references = { kind: "LEGACY_ABSENT" };
    if (capture) {
      if (capture.contextId !== firstVersion.contextId || capture.workspaceId !== frame.workspaceId) return retry();
      await lock(tx, "ContextReferenceManifest", [capture.manifestId], checkpoint);
      const manifest = await query(() => tx.contextReferenceManifest.findUnique({ where: { id: capture.manifestId } }));
      if (!manifest || manifest.contextId !== capture.contextId || manifest.workspaceId !== frame.workspaceId
        || manifest.referenceRevision !== capture.referenceRevision || manifest.hash !== capture.manifestHash) return retry();
      const packet = ContextReferenceItemsSchema.safeParse(manifest.items); checkpoint();
      if (!packet.success || packet.data.length !== manifest.itemCount || canonicalHash(packet.data) !== manifest.hash
        || canonicalHash(packet.data) !== canonicalHash(manifest.items)) return retry();
      await lock(tx, "ContextAssetBinding", packet.data.map(item => item.bindingId), checkpoint);
      const bindings = packet.data.length ? await query(() => tx.contextAssetBinding.findMany({ where: { id: { in: packet.data.map(item => item.bindingId) },
        workspaceId: frame.workspaceId, contextId: firstVersion.contextId }, take: 20 })) : [];
      if (bindings.length !== packet.data.length) return retry();
      await lock(tx, "PrivateAsset", bindings.map(binding => binding.assetId), checkpoint);
      const assets = bindings.length ? await query(() => tx.privateAsset.findMany({ where: { id: { in: bindings.map(binding => binding.assetId) } },
        select: { id: true, purpose: true, ownerUserId: true, contentType: true, size: true }, take: 20 })) : [];
      references = { kind: "MANIFEST", id: manifest.id, revision: manifest.referenceRevision, hash: manifest.hash,
        items: packet.data.map(item => {
          const binding = bindings.find(row => row.id === item.bindingId), asset = assets.find(row => row.id === binding?.assetId);
          if (!binding || binding.purpose !== "MARKETING_REFERENCE" || !asset || asset.purpose !== "MARKETING_REFERENCE"
            || asset.ownerUserId !== binding.uploaderUserId) return retry();
          return { ...item, assetId: asset.id, contentType: asset.contentType, size: asset.size };
        }) };
      contextReferenceSubmissionId = firstVersion.submissionId;
    }
  }
  const raw = { schemaVersion: 1, brief: dto, provenance: { selectionId: bound.selection.id, selectionRevision: bound.selection.revision,
    versionId: bound.selection.contextVersionId, contentHash: bound.selection.contentHash }, selectedContext, references };
  checkpoint();
  if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > 262144) return fail("SNAPSHOT_TOO_LARGE", 422);
  const packet = ManagedOrderSnapshotSchema.safeParse(raw); checkpoint();
  if (!packet.success || canonicalHash(packet.data) !== canonicalHash(raw)) return retry();
  return { snapshot: packet.data, contextReferenceSubmissionId, inputRevision: brief.inputRevision,
    approvedByUserId: brief.approvedByUserId!, approvedAt: brief.approvedAt };
}
