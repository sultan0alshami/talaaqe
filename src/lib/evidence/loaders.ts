import { ReviewStatus } from "@prisma/client";
import { z } from "zod";
import { active, brandContext, creatorContext, Id, parse, transaction, type EvidenceOptions } from "./common";
import { assetDTO } from "./assets";
import { ownershipChallengeDTO } from "./ownership";
import { correctionDTO, snapshotDTO } from "./metrics";
import { businessDTO, licenceDTO } from "./verifications";
export async function getCreatorEvidence(actor: string, creatorId: string, options: EvidenceOptions) {
  parse(Id, creatorId);
  return transaction(options, actor, async (tx, _now, boundary) => {
    // These private owner loaders do not grant administrators implicit owner
    // access; administration has its own bounded, audited review queue.
    const creator = await creatorContext(tx, actor, creatorId);
    await boundary.checkpoint();
    const accounts = await tx.socialAccount.findMany({ where: { creatorId: creator.id }, orderBy: { id: "asc" } });
    const ids = accounts.map(a => a.id);
    const challenges = await tx.ownershipChallenge.findMany({ where: { accountId: { in: ids }, ownerUserId: actor }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 100 });
    const snapshots = await tx.metricsSnapshot.findMany({ where: { accountId: { in: ids } }, orderBy: [{ observedAt: "desc" }, { id: "asc" }], take: 100 });
    const corrections = await tx.factCorrection.findMany({ where: { accountId: { in: ids }, reportedBy: actor }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 100 });
    const licences = await tx.advertisingLicence.findMany({ where: { creatorId }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 100 });
    const assets = await tx.privateAsset.findMany({ where: { ownerUserId: actor, deletedAt: null }, orderBy: { createdAt: "desc" }, take: 100 });
    return { creatorId, accounts: accounts.map(a => ({ id: a.id, platform: a.platform, handle: a.handle, providerAccountId: a.providerAccountId, mappingRevision: a.mappingRevision, evidenceRevision: a.evidenceRevision,
      ownershipStatus: a.ownershipStatus, fieldVisibility: a.fieldVisibility, factsApprovedAt: a.factsApprovedAt?.toISOString() ?? null })),
      challenges: await Promise.all(challenges.map(c => ownershipChallengeDTO(tx, c))), snapshots: snapshots.map(snapshotDTO), corrections: corrections.map(correctionDTO),
      licences: await Promise.all(licences.map(l => licenceDTO(tx, l))), assets: assets.map(assetDTO) };
  });
}
export async function getBrandEvidence(actor: string, brandId: string, options: EvidenceOptions) {
  parse(Id, brandId);
  return transaction(options, actor, async (tx, _now, boundary) => {
    await brandContext(tx, actor, brandId);
    await boundary.checkpoint();
    const verifications = await tx.businessVerification.findMany({ where: { brandId }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 100 });
    const assets = await tx.privateAsset.findMany({ where: { ownerUserId: actor, deletedAt: null }, orderBy: { createdAt: "desc" }, take: 100 });
    return { brandId, verifications: await Promise.all(verifications.map(v => businessDTO(tx, v))), assets: assets.map(assetDTO) };
  });
}
export const EvidenceQueueQuerySchema = z.object({ kind: z.enum(["OWNERSHIP", "SCREENSHOT", "ADVERTISING_LICENCE", "REPRESENTATIVE", "BUSINESS_REGISTRATION"]),
  status: z.enum(ReviewStatus).default("PENDING"), limit: z.number().int().min(1).max(50).default(25), cursor: Id.optional() }).strict();
export async function listEvidenceReviewQueue(actor: string, query: unknown, options: EvidenceOptions) {
  const input = parse(EvidenceQueueQuerySchema, query);
  return transaction(options, actor, async (tx, now, boundary) => {
    await active(tx, actor, "ADMIN");
    now = await boundary.checkpoint();
    const where = { status: input.status, ...(input.cursor ? { id: { gt: input.cursor } } : {}) }, take = input.limit + 1;
    const entries = input.kind === "OWNERSHIP" ? await Promise.all((await tx.ownershipChallenge.findMany({ where, orderBy: { id: "asc" }, take })).map(async c => ({ kind: input.kind, id: c.id, data: await ownershipChallengeDTO(tx, c) })))
      : input.kind === "SCREENSHOT" ? (await tx.metricsSnapshot.findMany({ where: { reviewStatus: input.status, source: "SELF_REPORTED", evidenceAssetId: { not: null }, excludedAt: null, ...(input.cursor ? { id: { gt: input.cursor } } : {}) }, orderBy: { id: "asc" }, take })).map(s => ({ kind: input.kind, id: s.id, data: snapshotDTO(s) }))
        : input.kind === "ADVERTISING_LICENCE" ? await Promise.all((await tx.advertisingLicence.findMany({ where, orderBy: { id: "asc" }, take })).map(async l => ({ kind: input.kind, id: l.id, data: await licenceDTO(tx, l) })))
          : await Promise.all((await tx.businessVerification.findMany({ where: { ...where, kind: input.kind }, orderBy: { id: "asc" }, take })).map(async v => ({ kind: input.kind, id: v.id, data: await businessDTO(tx, v) })));
    await tx.adminAudit.create({ data: { actorUserId: actor, action: "evidence.queue_accessed", resourceType: "EvidenceQueue", resourceId: input.kind,
      snapshot: { kind: input.kind, status: input.status, count: Math.min(entries.length, input.limit) }, createdAt: now } });
    return { kind: input.kind, entries: entries.slice(0, input.limit), nextCursor: entries.length > input.limit ? entries[input.limit - 1]!.id : null };
  });
}
