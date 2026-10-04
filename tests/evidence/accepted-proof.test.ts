import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { acceptedOwnershipProof, createOwnershipChallenge, submitOwnershipProof, reviewOwnershipProof, uploadPrivateAsset } from "@/lib/evidence/service";
import { cleanup, fixture, png, now, user } from "./fixtures";
afterEach(cleanup);
it("requires the accepted current owner challenge and real reviewed asset binding, then denies deletion or owner replacement", async () => {
  const f = await fixture(), key = () => randomUUID();
  await prisma.socialAccount.update({ where: { id: f.account.id }, data: { ownershipStatus: "VERIFIED", ownershipReviewedBy: f.admin, ownershipReviewedAt: now,
    ownershipIdentityHash: canonicalHash({ platform: f.account.platform, providerAccountId: f.account.providerAccountId, normalizedHandle: f.account.handle, confirmedOrigin: null }) } });
  let account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
  expect(await prisma.$transaction(tx => acceptedOwnershipProof(tx, account, f.owner, now))).toBe(false);
  const proof = (await uploadPrivateAsset(f.owner, { operationKey: key(), purpose: "OWNERSHIP_PROOF", contentType: "image/png", bytes: png }, f.options)).asset;
  const challenge = (await createOwnershipChallenge(f.owner, { operationKey: key(), accountId: f.account.id, expectedMappingRevision: 1, expectedEvidenceRevision: 1 }, f.options)).challenge;
  await submitOwnershipProof(f.owner, challenge.id, { operationKey: key(), expectedRevision: 1, assetId: proof.id }, f.options);
  await reviewOwnershipProof(f.admin, challenge.id, { operationKey: key(), expectedRevision: 2, decision: "VERIFIED", observedChallengeCode: challenge.challengeCode, note: { text: "إثبات اختبار مصطنع", language: "ar" } }, f.options);
  account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
  expect(await prisma.$transaction(tx => acceptedOwnershipProof(tx, account, f.owner, now))).toBe(true);
  await prisma.privateAsset.update({ where: { id: proof.id }, data: { deletedAt: now, revision: { increment: 1 } } });
  expect(await prisma.$transaction(tx => acceptedOwnershipProof(tx, account, f.owner, now))).toBe(false);
  await prisma.privateAsset.update({ where: { id: proof.id }, data: { deletedAt: null, revision: { increment: 1 } } });
  const replacement = await user("CREATOR");
  await prisma.creator.update({ where: { id: f.creator.id }, data: { userId: replacement } });
  expect(await prisma.$transaction(tx => acceptedOwnershipProof(tx, account, replacement, now))).toBe(false);
  expect(await prisma.$transaction(tx => acceptedOwnershipProof(tx, account, f.owner, now))).toBe(false);
});
it("rejects rewriting a real rejected review as VERIFIED without a VERIFIED journal", async () => {
  const f = await fixture(), key = () => randomUUID();
  const proof = (await uploadPrivateAsset(f.owner, { operationKey: key(), purpose: "OWNERSHIP_PROOF", contentType: "image/png", bytes: png }, f.options)).asset;
  const challenge = (await createOwnershipChallenge(f.owner, { operationKey: key(), accountId: f.account.id, expectedMappingRevision: 1, expectedEvidenceRevision: 1 }, f.options)).challenge;
  await submitOwnershipProof(f.owner, challenge.id, { operationKey: key(), expectedRevision: 1, assetId: proof.id }, f.options);
  await reviewOwnershipProof(f.admin, challenge.id, { operationKey: key(), expectedRevision: 2, decision: "REJECTED", note: { text: "رفض اختبار مصطنع", language: "ar" } }, f.options);
  await prisma.ownershipChallenge.update({ where: { id: challenge.id }, data: { status: "VERIFIED" } });
  await prisma.socialAccount.update({ where: { id: f.account.id }, data: { ownershipStatus: "VERIFIED", ownershipProofAssetId: proof.id, ownershipIdentityHash: canonicalHash({ platform: f.account.platform, providerAccountId: f.account.providerAccountId, normalizedHandle: f.account.handle, confirmedOrigin: null }) } });
  const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
  expect(await prisma.$transaction(tx => acceptedOwnershipProof(tx, account, f.owner, now))).toBe(false);
});
it("rejects substituting another genuinely uploaded asset for the accepted ownership submission", async () => {
  const f = await fixture(), key = () => randomUUID();
  const upload = () => uploadPrivateAsset(f.owner, { operationKey: key(), purpose: "OWNERSHIP_PROOF", contentType: "image/png", bytes: png }, f.options);
  const first = (await upload()).asset, second = (await upload()).asset;
  const challenge = (await createOwnershipChallenge(f.owner, { operationKey: key(), accountId: f.account.id, expectedMappingRevision: 1, expectedEvidenceRevision: 1 }, f.options)).challenge;
  await submitOwnershipProof(f.owner, challenge.id, { operationKey: key(), expectedRevision: 1, assetId: first.id }, f.options);
  await reviewOwnershipProof(f.admin, challenge.id, { operationKey: key(), expectedRevision: 2, decision: "VERIFIED", observedChallengeCode: challenge.challengeCode, note: { text: "مراجعة ملف الاختبار الأول فقط", language: "ar" } }, f.options);
  const read = async () => {
    const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    return prisma.$transaction(tx => acceptedOwnershipProof(tx, account, f.owner, now));
  };
  expect(await read()).toBe(true);
  await prisma.ownershipChallenge.update({ where: { id: challenge.id }, data: { proofAssetId: second.id } });
  await prisma.socialAccount.update({ where: { id: f.account.id }, data: { ownershipProofAssetId: second.id } });
  expect(await read()).toBe(false);
});
it("rejects rewriting the accepted challenge and account identity while retaining the original START journal", async () => {
  const f = await fixture(), key = () => randomUUID();
  const proof = (await uploadPrivateAsset(f.owner, { operationKey: key(), purpose: "OWNERSHIP_PROOF", contentType: "image/png", bytes: png }, f.options)).asset;
  const challenge = (await createOwnershipChallenge(f.owner, { operationKey: key(), accountId: f.account.id, expectedMappingRevision: 1, expectedEvidenceRevision: 1 }, f.options)).challenge;
  await submitOwnershipProof(f.owner, challenge.id, { operationKey: key(), expectedRevision: 1, assetId: proof.id }, f.options);
  await reviewOwnershipProof(f.admin, challenge.id, { operationKey: key(), expectedRevision: 2, decision: "VERIFIED", observedChallengeCode: challenge.challengeCode, note: { text: "مراجعة الهوية الأصلية للاختبار فقط", language: "ar" } }, f.options);
  const identity = { platform: f.account.platform, normalizedHandle: "changed_synthetic_identity", providerAccountId: f.account.providerAccountId, confirmedOrigin: null }, identityHash = canonicalHash(identity);
  const read = async () => {
    const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    return prisma.$transaction(tx => acceptedOwnershipProof(tx, account, f.owner, now));
  };
  expect(await read()).toBe(true);
  await prisma.ownershipChallenge.update({ where: { id: challenge.id }, data: { identity, identityHash, mappingRevision: 2 } });
  await prisma.socialAccount.update({ where: { id: f.account.id }, data: { handle: identity.normalizedHandle, mappingRevision: 2, ownershipIdentityHash: identityHash } });
  expect(await read()).toBe(false);
});
