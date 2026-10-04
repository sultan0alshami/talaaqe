import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createOwnershipChallenge, submitOwnershipProof, reviewOwnershipProof, uploadPrivateAsset, submitAdvertisingLicence } from "@/lib/evidence/service";
import { cleanup, fixture, png } from "./fixtures";

afterEach(cleanup);
const note = { text: "مراجعة وقت اختبار", language: "ar" };
async function setup() {
  const f = await fixture(), options = { storage: f.options.storage };
  const proof = (await uploadPrivateAsset(f.owner, { operationKey: randomUUID(), purpose: "OWNERSHIP_PROOF", contentType: "image/png", bytes: png }, options)).asset;
  const started = await createOwnershipChallenge(f.owner, { operationKey: randomUUID(), accountId: f.account.id, expectedMappingRevision: 1, expectedEvidenceRevision: 1 }, options);
  return { ...f, options, proof, challenge: started.challenge };
}
function delayedStorage(f: Awaited<ReturnType<typeof setup>>, expiry: Date) {
  return { ...f.options.storage, async get(key: string) {
    const bytes = await f.options.storage.get(key);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expiry.getTime() - Date.now() + 25)));
    return bytes;
  } };
}

it("rejects an ownership submission that expires during byte IO without advancing revision or issuing a receipt", async () => {
  const f = await setup(), expiry = new Date(Date.now() + 400), operationKey = randomUUID();
  await prisma.ownershipChallenge.update({ where: { id: f.challenge.id }, data: { expiresAt: expiry } });
  await expect(submitOwnershipProof(f.owner, f.challenge.id, { operationKey, expectedRevision: 1, assetId: f.proof.id },
    { ...f.options, storage: delayedStorage(f, expiry) })).rejects.toMatchObject({ code: "INVALID_STATE" });
  expect(await prisma.ownershipChallenge.findUniqueOrThrow({ where: { id: f.challenge.id } })).toMatchObject({ revision: 1, submittedAt: null });
  expect(await prisma.evidenceCommand.count({ where: { actorUserId: f.owner, operationKey } })).toBe(0);
});

it("rejects an ownership acceptance that expires during byte IO instead of backdating the review", async () => {
  const f = await setup();
  await submitOwnershipProof(f.owner, f.challenge.id, { operationKey: randomUUID(), expectedRevision: 1, assetId: f.proof.id }, f.options);
  const expiry = new Date(Date.now() + 400);
  await prisma.ownershipChallenge.update({ where: { id: f.challenge.id }, data: { expiresAt: expiry } });
  await expect(reviewOwnershipProof(f.admin, f.challenge.id, { operationKey: randomUUID(), expectedRevision: 2, decision: "VERIFIED", observedChallengeCode: f.challenge.challengeCode, note },
    { ...f.options, storage: delayedStorage(f, expiry) })).rejects.toMatchObject({ code: "INVALID_EVIDENCE" });
  expect(await prisma.ownershipChallenge.findUniqueOrThrow({ where: { id: f.challenge.id } })).toMatchObject({ revision: 2, status: "PENDING", reviewedAt: null });
});

it("rejects a licence that expires during evidence IO while preserving its account revision", async () => {
  const f = await setup(), expiry = new Date(Date.now() + 400);
  const proof = (await uploadPrivateAsset(f.owner, { operationKey: randomUUID(), purpose: "ADVERTISING_LICENCE", contentType: "image/png", bytes: png }, f.options)).asset;
  await expect(submitAdvertisingLicence(f.owner, { operationKey: randomUUID(), creatorId: f.creator.id, jurisdiction: "KW", issuer: "مصدر اختبار",
    holderName: "صاحب اختبار", licenceNumber: "SYNTHETIC", type: "اختبار", scope: "حساب واحد", accountBindings: [{ accountId: f.account.id, mappingRevision: 1 }],
    platformScope: ["INSTAGRAM"], evidenceAssetId: proof.id, validFrom: new Date(Date.now() - 1000).toISOString(), expiresAt: expiry.toISOString() },
    { ...f.options, storage: delayedStorage(f, expiry) })).rejects.toMatchObject({ code: "INVALID_SCOPE" });
  expect(await prisma.advertisingLicence.count({ where: { creatorId: f.creator.id } })).toBe(0);
  expect((await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } })).evidenceRevision).toBe(2);
});
