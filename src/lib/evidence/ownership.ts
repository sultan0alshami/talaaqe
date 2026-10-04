import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { OwnershipChallenge, SocialAccount } from "@prisma/client";
import { accountContext, canonicalHash, event, Id, identity, identityHash, inputJson, Key, lock, parse, previous, receipt, requireMapping, requireRevision, Revision, Review, reviewLanguage, transaction, type EvidenceOptions, type Tx } from "./common";
import { usableAsset } from "./assets";
import { EvidenceError, MAX_EVIDENCE_BYTES } from "./storage";
// Metadata-only current read gate. The caller locks owner/reviewer Users and the
// account first. Accepted review performed physical byte/checksum validation;
// this function never calls a provider or storage and cannot expose private keys.
export async function acceptedOwnershipProof(tx: Tx, account: SocialAccount, ownerUserId: string, now: Date): Promise<boolean> {
  if (!Number.isFinite(now.getTime()) || account.ownershipStatus !== "VERIFIED" || !account.ownershipReviewedBy || !account.ownershipReviewedAt
    || account.ownershipReviewedAt > now || !account.ownershipProofAssetId || account.ownershipIdentityHash !== identityHash(account)) return false;
  const creator = await tx.creator.findUnique({ where: { id: account.creatorId }, select: { userId: true } });
  if (creator?.userId !== ownerUserId) return false;
  const owner = await tx.user.findUnique({ where: { id: ownerUserId }, select: { active: true, role: true } });
  const reviewer = await tx.user.findUnique({ where: { id: account.ownershipReviewedBy }, select: { active: true, role: true } });
  if (!owner?.active || owner.role !== "CREATOR" || !reviewer?.active || reviewer.role !== "ADMIN") return false;
  const candidates = await tx.ownershipChallenge.findMany({ where: { accountId: account.id, ownerUserId, status: "VERIFIED", mappingRevision: account.mappingRevision,
    identityHash: account.ownershipIdentityHash, proofAssetId: account.ownershipProofAssetId, reviewedBy: account.ownershipReviewedBy, reviewedAt: account.ownershipReviewedAt }, orderBy: { id: "asc" }, take: 2 });
  if (candidates.length !== 1) return false;
  await lock(tx, "OwnershipChallenge", candidates[0]!.id, true);
  const challenge = await tx.ownershipChallenge.findUniqueOrThrow({ where: { id: candidates[0]!.id } });
  if (challenge.status !== "VERIFIED" || challenge.ownerUserId !== ownerUserId || challenge.accountId !== account.id
    || challenge.mappingRevision !== account.mappingRevision || challenge.identityHash !== identityHash(account) || canonicalHash(challenge.identity) !== challenge.identityHash
    || challenge.proofAssetId !== account.ownershipProofAssetId || challenge.reviewedBy !== account.ownershipReviewedBy || !challenge.reviewedAt
    || challenge.reviewedAt.getTime() !== account.ownershipReviewedAt.getTime() || !challenge.submittedAt
    || challenge.submittedAt < challenge.createdAt || challenge.submittedAt > challenge.reviewedAt || challenge.reviewedAt >= challenge.expiresAt) return false;
  await lock(tx, "PrivateAsset", account.ownershipProofAssetId, true);
  const asset = await tx.privateAsset.findUnique({ where: { id: account.ownershipProofAssetId } });
  return !!asset && asset.ownerUserId === ownerUserId && asset.purpose === "OWNERSHIP_PROOF" && !asset.deletedAt && asset.createdAt <= challenge.submittedAt
    && asset.size > 0 && asset.size <= MAX_EVIDENCE_BYTES && ["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(asset.contentType) && /^[a-f0-9]{64}$/.test(asset.checksum);
}

const Start = z.object({ operationKey: Key, accountId: Id, expectedMappingRevision: Revision, expectedEvidenceRevision: Revision }).strict();
const Submit = z.object({ operationKey: Key, expectedRevision: Revision, assetId: Id }).strict();
const Decision = Review.extend({ observedChallengeCode: z.string().max(100).optional() }).strict();
export async function ownershipChallengeDTO(tx: Tx, challenge: OwnershipChallenge) { return { id: challenge.id, accountId: challenge.accountId, revision: challenge.revision, status: challenge.status,
  mappingRevision: challenge.mappingRevision, identity: challenge.identity, challengeCode: challenge.challengeCode, proofAssetId: challenge.proofAssetId,
  submittedAt: challenge.submittedAt?.toISOString() ?? null, reviewedAt: challenge.reviewedAt?.toISOString() ?? null,
  reviewNote: challenge.reviewNote ? { text: challenge.reviewNote, language: await reviewLanguage(tx, "OwnershipChallenge", challenge.id, challenge.revision) } : null, expiresAt: challenge.expiresAt.toISOString() }; }
const dto = ownershipChallengeDTO;
export async function createOwnershipChallenge(actor: string, input: unknown, options: EvidenceOptions) {
  const command = parse(Start, input), hash = canonicalHash({ action: "START_OWNERSHIP", ...command });
  return transaction(options, async (tx, now) => {
    const { account } = await accountContext(tx, actor, command.accountId);
    requireMapping(account, command.expectedMappingRevision);
    const replay = await previous(tx, actor, command.operationKey, hash);
    if (replay) return { challenge: await dto(tx, await tx.ownershipChallenge.findUniqueOrThrow({ where: { id: replay.resourceId } })), replayed: true };
    requireRevision(account.evidenceRevision, command.expectedEvidenceRevision);
    if (!account.intendedConfirmedAt || !account.consentAt) throw new EvidenceError("ACCOUNT_CONSENT_REQUIRED");
    const pending = await tx.ownershipChallenge.findFirst({ where: { accountId: account.id, status: "PENDING" } });
    if (pending && pending.expiresAt > now && pending.mappingRevision === account.mappingRevision && pending.identityHash === identityHash(account)) throw new EvidenceError("CHALLENGE_PENDING");
    if (pending) await tx.ownershipChallenge.update({ where: { id: pending.id }, data: { status: "EXPIRED", revision: { increment: 1 }, updatedAt: now } });
    const challenge = await tx.ownershipChallenge.create({ data: { accountId: account.id, ownerUserId: actor, identity: inputJson(identity(account)), identityHash: identityHash(account), mappingRevision: account.mappingRevision,
      challengeCode: "infame-" + randomBytes(16).toString("hex"), expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000), createdAt: now, updatedAt: now } });
    await tx.socialAccount.update({ where: { id: account.id }, data: { evidenceRevision: { increment: 1 } } });
    await receipt(tx, actor, command.operationKey, hash, "OwnershipChallenge", challenge.id, challenge.revision, now);
    await event(tx, actor, command.operationKey, "ownership.challenge_created", "OwnershipChallenge", challenge.id, 1, now, { accountId: account.id });
    return { challenge: await dto(tx, challenge), replayed: false };
  });
}
async function context(tx: Tx, actor: string, id: string, review: boolean) {
  const initial = await tx.ownershipChallenge.findUnique({ where: { id } }); if (!initial) throw new EvidenceError("NOT_FOUND", 404);
  const { creator, account } = await accountContext(tx, actor, initial.accountId, review);
  if (creator.userId !== initial.ownerUserId) throw new EvidenceError("STALE_OWNER");
  await lock(tx, "OwnershipChallenge", id);
  const challenge = await tx.ownershipChallenge.findUniqueOrThrow({ where: { id } });
  requireMapping(account, challenge.mappingRevision, challenge.identityHash);
  return { account, challenge };
}
export async function submitOwnershipProof(actor: string, id: string, input: unknown, options: EvidenceOptions) {
  parse(Id, id); const command = parse(Submit, input), hash = canonicalHash({ action: "SUBMIT_OWNERSHIP", id, ...command });
  return transaction(options, async (tx, now) => {
    const { account, challenge } = await context(tx, actor, id, false);
    const replay = await previous(tx, actor, command.operationKey, hash);
    if (replay) return { challenge: await dto(tx, challenge), replayed: true };
    requireRevision(challenge.revision, command.expectedRevision);
    if (challenge.status !== "PENDING" || challenge.expiresAt <= now || challenge.submittedAt) throw new EvidenceError("INVALID_STATE");
    await usableAsset(tx, command.assetId, actor, "OWNERSHIP_PROOF", options);
    const updated = await tx.ownershipChallenge.update({ where: { id }, data: { revision: { increment: 1 }, proofAssetId: command.assetId, submittedAt: now, updatedAt: now } });
    await tx.socialAccount.update({ where: { id: account.id }, data: { evidenceRevision: { increment: 1 }, ownershipStatus: "PENDING", ownershipIdentityHash: null, ownershipReviewedAt: null, ownershipReviewedBy: null, ownershipProofAssetId: null, publicVisible: false, brandVisible: false } });
    await receipt(tx, actor, command.operationKey, hash, "OwnershipChallenge", id, updated.revision, now);
    await event(tx, actor, command.operationKey, "ownership.submitted", "OwnershipChallenge", id, updated.revision, now, { accountId: account.id });
    return { challenge: await dto(tx, updated), replayed: false };
  });
}
export async function reviewOwnershipProof(actor: string, id: string, input: unknown, options: EvidenceOptions) {
  parse(Id, id); const command = parse(Decision, input), hash = canonicalHash({ action: "REVIEW_OWNERSHIP", id, ...command });
  return transaction(options, async (tx, now) => {
    const { account, challenge } = await context(tx, actor, id, true);
    const replay = await previous(tx, actor, command.operationKey, hash);
    if (replay) return { challenge: await dto(tx, challenge), replayed: true };
    requireRevision(challenge.revision, command.expectedRevision);
    if (command.decision === "REVOKED" ? challenge.status !== "VERIFIED" : challenge.status !== "PENDING") throw new EvidenceError("INVALID_STATE");
    if (command.decision === "VERIFIED") {
      if (challenge.expiresAt <= now || !challenge.submittedAt || challenge.submittedAt > now || !challenge.proofAssetId || command.observedChallengeCode !== challenge.challengeCode) throw new EvidenceError("INVALID_EVIDENCE");
      await usableAsset(tx, challenge.proofAssetId, challenge.ownerUserId, "OWNERSHIP_PROOF", options);
    }
    const updated = await tx.ownershipChallenge.update({ where: { id }, data: { revision: { increment: 1 }, status: command.decision, reviewedBy: actor, reviewedAt: now, reviewNote: command.note.text, updatedAt: now } });
    await tx.socialAccount.update({ where: { id: account.id }, data: { evidenceRevision: { increment: 1 }, ownershipStatus: command.decision,
      ownershipIdentityHash: command.decision === "VERIFIED" ? challenge.identityHash : null, ownershipReviewedBy: actor, ownershipReviewedAt: now,
      ownershipProofAssetId: command.decision === "VERIFIED" ? challenge.proofAssetId : null, ...(command.decision !== "VERIFIED" ? { publicVisible: false, brandVisible: false } : {}) } });
    if (command.decision !== "VERIFIED") await tx.creator.update({ where: { id: account.creatorId }, data: { state: "PRIVATE", brandVisible: false } });
    await receipt(tx, actor, command.operationKey, hash, "OwnershipChallenge", id, updated.revision, now, { noteLanguage: command.note.language });
    await event(tx, actor, command.operationKey, "ownership.reviewed", "OwnershipChallenge", id, updated.revision, now, { accountId: account.id, status: command.decision });
    return { challenge: await dto(tx, updated), replayed: false };
  });
}
