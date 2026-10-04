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
