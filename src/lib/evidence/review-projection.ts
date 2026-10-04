import type { MetricsSnapshot } from "@prisma/client";
import { canonicalHash, lock, Note, record, type Tx } from "./common";
import { snapshotDTO } from "./metrics";
import { snapshotScopeHash } from "./metrics-readiness";
import { EvidenceError } from "./storage";

type ReviewHistory = { decision: "VERIFIED" | "REJECTED" | "REVOKED"; note: { text: string; language: string | null }; reviewedAt: string; reviewerId: string };
export async function ownerSnapshot(tx: Tx, snapshot: MetricsSnapshot, owner: string): Promise<boolean> {
  const parent = snapshot.source === "SELF_REPORTED" ? snapshot : snapshot.source === "SCREENSHOT_VERIFIED" && snapshot.supersedesId
    ? await tx.metricsSnapshot.findUnique({ where: { id: snapshot.supersedesId } }) : null;
  if (!parent || parent.source !== "SELF_REPORTED" || !parent.evidenceAssetId || snapshotScopeHash(parent) !== snapshotScopeHash(snapshot)) return false;
  const asset = await tx.privateAsset.findUnique({ where: { id: parent.evidenceAssetId }, select: { ownerUserId: true, purpose: true } });
  if (asset?.ownerUserId !== owner || asset.purpose !== "SCREENSHOT") return false;
  const submissions = await tx.evidenceCommand.findMany({ where: { resourceType: "MetricsSnapshot", resourceId: parent.id, actorUserId: owner,
    createdAt: parent.importedAt }, take: 50 });
  return submissions.some(receipt => {
    const metadata = record(receipt.resultJson), metrics = record(metadata.submittedMetrics);
    return metadata.resourceId === parent.id && metadata.ownerUserId === owner && metadata.accountId === parent.accountId
      && metadata.mappingRevision === parent.mappingRevision && metadata.snapshotScopeHash === snapshotScopeHash(parent)
      && typeof metadata.expectedEvidenceRevision === "number" && Number.isSafeInteger(metadata.expectedEvidenceRevision) && metadata.expectedEvidenceRevision > 0
      && receipt.payloadHash === canonicalHash({ action: "SUBMIT_SCREENSHOT", operationKey: receipt.operationKey, accountId: parent.accountId,
        expectedMappingRevision: parent.mappingRevision, expectedEvidenceRevision: metadata.expectedEvidenceRevision,
        evidenceAssetId: parent.evidenceAssetId, observedAt: parent.observedAt.toISOString(), ...metrics });
  });
}
// Private descriptive history, never an accepted-proof or current-trust badge.
// Owner approval has no REVIEW_SCREENSHOT receipt and cannot enter this list.
export async function screenshotReviewDTO(tx: Tx, snapshot: MetricsSnapshot, now: Date) {
  await lock(tx, "SocialAccount", snapshot.accountId, true);
  const account = await tx.socialAccount.findUnique({ where: { id: snapshot.accountId } });
  if (!account) throw new EvidenceError("NOT_FOUND", 404);
  const receipts = await tx.evidenceCommand.findMany({ where: { resourceType: "MetricsSnapshot", createdAt: { lte: now },
    AND: [
      { OR: [{ resourceId: snapshot.id }, { resultJson: { path: ["parentId"], equals: snapshot.id } }] },
      { OR: ["VERIFIED", "REJECTED", "REVOKED"].map(decision => ({ resultJson: { path: ["decision"], equals: decision } })) },
    ] }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50 });
  const reviewHistory: ReviewHistory[] = [];
  for (const receipt of receipts.reverse()) {
    const metadata = record(receipt.resultJson), parsedNote = Note.safeParse(metadata.note);
    const decision = metadata.decision, expectedEvidenceRevision = metadata.expectedEvidenceRevision, parentId = metadata.parentId;
    if (metadata.resourceId !== receipt.resourceId || !["VERIFIED", "REJECTED", "REVOKED"].includes(String(decision)) || !parsedNote.success
      || typeof expectedEvidenceRevision !== "number" || !Number.isSafeInteger(expectedEvidenceRevision) || expectedEvidenceRevision < 1
      || typeof parentId !== "string" || metadata.accountId !== snapshot.accountId || metadata.mappingRevision !== snapshot.mappingRevision
      || metadata.snapshotScopeHash !== snapshotScopeHash(snapshot)
      || receipt.payloadHash !== canonicalHash({ action: "REVIEW_SCREENSHOT", id: parentId, operationKey: receipt.operationKey,
        expectedEvidenceRevision, decision, note: parsedNote.data })) continue;
    const reviewed = receipt.resourceId === snapshot.id ? snapshot : await tx.metricsSnapshot.findUnique({ where: { id: receipt.resourceId } });
    if (!reviewed || snapshotScopeHash(reviewed) !== snapshotScopeHash(snapshot)
      || (decision === "VERIFIED" ? reviewed.source !== "SCREENSHOT_VERIFIED" || reviewed.supersedesId !== parentId
        : receipt.resourceId !== parentId || (decision === "REVOKED" ? reviewed.source !== "SCREENSHOT_VERIFIED" : reviewed.source !== "SELF_REPORTED"))
      || (receipt.resourceId !== snapshot.id && parentId !== snapshot.id)) continue;
    reviewHistory.push({ decision: decision as ReviewHistory["decision"], note: parsedNote.data,
      reviewedAt: receipt.createdAt.toISOString(), reviewerId: receipt.actorUserId });
  }
  return { ...snapshotDTO(snapshot), importedAt: snapshot.importedAt.toISOString(), excludedAt: snapshot.excludedAt?.toISOString() ?? null,
    approvedBy: snapshot.approvedBy, reviewHistory,
    account: { id: account.id, creatorId: account.creatorId, platform: account.platform, handle: account.handle,
      mappingRevision: account.mappingRevision, evidenceRevision: account.evidenceRevision } };
}
