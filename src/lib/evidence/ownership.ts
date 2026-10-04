import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { OwnershipChallenge } from "@prisma/client";
import { accountContext, canonicalHash, event, Id, identity, identityHash, inputJson, Key, lock, parse, previous, receipt, requireMapping, requireRevision, Revision, Review, reviewLanguage, transaction, type EvidenceOptions, type Tx } from "./common";
import { usableAsset } from "./assets";
import { EvidenceError } from "./storage";
export { acceptedOwnershipProof } from "./readiness";

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
  return transaction(options, actor, async (tx, now, boundary) => {
    const { account } = await accountContext(tx, actor, command.accountId);
    now = await boundary.checkpoint();
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
    await receipt(tx, actor, command.operationKey, hash, "OwnershipChallenge", challenge.id, challenge.revision, now, {
      ownerUserId: actor, accountId: account.id, mappingRevision: account.mappingRevision,
      identityHash: identityHash(account), expectedEvidenceRevision: command.expectedEvidenceRevision,
    });
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
  return transaction(options, actor, async (tx, now, boundary) => {
    const { account, challenge } = await context(tx, actor, id, false);
    now = await boundary.checkpoint();
    const replay = await previous(tx, actor, command.operationKey, hash);
    if (replay) return { challenge: await dto(tx, challenge), replayed: true };
    requireRevision(challenge.revision, command.expectedRevision);
    if (challenge.status !== "PENDING" || challenge.expiresAt <= now || challenge.submittedAt) throw new EvidenceError("INVALID_STATE");
    await usableAsset(tx, command.assetId, actor, "OWNERSHIP_PROOF", options, boundary);
    now = await boundary.checkpoint();
    if (challenge.expiresAt <= now) throw new EvidenceError("INVALID_STATE");
    const updated = await tx.ownershipChallenge.update({ where: { id }, data: { revision: { increment: 1 }, proofAssetId: command.assetId, submittedAt: now, updatedAt: now } });
    await tx.socialAccount.update({ where: { id: account.id }, data: { evidenceRevision: { increment: 1 }, ownershipStatus: "PENDING", ownershipIdentityHash: null, ownershipReviewedAt: null, ownershipReviewedBy: null, ownershipProofAssetId: null, publicVisible: false, brandVisible: false } });
    await receipt(tx, actor, command.operationKey, hash, "OwnershipChallenge", id, updated.revision, now);
    await event(tx, actor, command.operationKey, "ownership.submitted", "OwnershipChallenge", id, updated.revision, now, { accountId: account.id });
    return { challenge: await dto(tx, updated), replayed: false };
  });
}
export async function reviewOwnershipProof(actor: string, id: string, input: unknown, options: EvidenceOptions) {
  parse(Id, id); const command = parse(Decision, input), hash = canonicalHash({ action: "REVIEW_OWNERSHIP", id, ...command });
  return transaction(options, actor, async (tx, now, boundary) => {
    const { account, challenge } = await context(tx, actor, id, true);
    now = await boundary.checkpoint();
    const replay = await previous(tx, actor, command.operationKey, hash);
    if (replay) return { challenge: await dto(tx, challenge), replayed: true };
    requireRevision(challenge.revision, command.expectedRevision);
    if (command.decision === "REVOKED" ? challenge.status !== "VERIFIED" : challenge.status !== "PENDING") throw new EvidenceError("INVALID_STATE");
    if (command.decision === "VERIFIED") {
      if (challenge.expiresAt <= now || !challenge.submittedAt || challenge.submittedAt > now || !challenge.proofAssetId || command.observedChallengeCode !== challenge.challengeCode) throw new EvidenceError("INVALID_EVIDENCE");
      await usableAsset(tx, challenge.proofAssetId, challenge.ownerUserId, "OWNERSHIP_PROOF", options, boundary);
      now = await boundary.checkpoint();
      if (challenge.expiresAt <= now || challenge.submittedAt > now) throw new EvidenceError("INVALID_EVIDENCE");
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
