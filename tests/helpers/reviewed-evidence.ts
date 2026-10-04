import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createLocalEvidenceStorage, type EvidenceStorage } from "@/lib/evidence/storage";
import { createOwnershipChallenge, submitOwnershipProof, reviewOwnershipProof, uploadPrivateAsset, submitAdvertisingLicence, reviewAdvertisingLicence, submitBusinessVerification, reviewBusinessVerification } from "@/lib/evidence/service";

// Actual local bytes and domain commands, still synthetic evidence and never
// provider/legal acceptance. Callers inject the guarded target and trusted clock.
export type EvidenceTarget = "test" | "e2e";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1kAAAAASUVORK5CYII=", "base64");
const storages = new Map<EvidenceTarget, Promise<EvidenceStorage>>();
const note = { text: "مراجعة إثبات مصطنع في قاعدة اختبار معزولة فقط", language: "ar" };
export async function reviewedEvidenceOptions(client: PrismaClient, target: EvidenceTarget, now: Date) {
  const taskId = process.env.INFAME_TASK_ID;
  if (process.env.NODE_ENV === "production" || !taskId || !Number.isFinite(now.getTime())) throw new Error("Unsafe synthetic evidence context");
  const rows = await client.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id, kind, current_database() AS db, host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0].id !== taskId || rows[0].kind !== target || rows[0].db !== `${taskId}_${target}` || rows[0].host !== "127.0.0.1") throw new Error("Synthetic evidence requires exact guarded target");
  let storage = storages.get(target);
  if (!storage) { storage = createLocalEvidenceStorage({ taskId, target }); storages.set(target, storage); }
  return { client, storage: await storage, now };
}
export async function uploadSyntheticEvidence(client: PrismaClient, owner: string, purpose: string, target: EvidenceTarget, now: Date) {
  const options = await reviewedEvidenceOptions(client, target, now);
  return (await uploadPrivateAsset(owner, { operationKey: randomUUID(), purpose, contentType: "image/png", bytes: png }, options)).asset;
}
export async function reviewedOwnershipFixture(client: PrismaClient, owner: string, reviewer: string, accountId: string, target: EvidenceTarget, now: Date) {
  const options = await reviewedEvidenceOptions(client, target, now);
  const proof = await uploadSyntheticEvidence(client, owner, "OWNERSHIP_PROOF", target, now);
  const account = await client.socialAccount.findUniqueOrThrow({ where: { id: accountId } });
  const started = await createOwnershipChallenge(owner, { operationKey: randomUUID(), accountId, expectedMappingRevision: account.mappingRevision, expectedEvidenceRevision: account.evidenceRevision }, options);
  await submitOwnershipProof(owner, started.challenge.id, { operationKey: randomUUID(), expectedRevision: started.challenge.revision, assetId: proof.id }, options);
  await reviewOwnershipProof(reviewer, started.challenge.id, { operationKey: randomUUID(), expectedRevision: started.challenge.revision + 1, decision: "VERIFIED", observedChallengeCode: started.challenge.challengeCode, note }, options);
  return { proofId: proof.id, challengeId: started.challenge.id };
}
export async function reviewedLicenceFixture(input: { client: PrismaClient; owner: string; reviewer: string; creatorId: string; accountIds: string[]; marketVersionId: string; jurisdiction: string; target: EvidenceTarget; now: Date; expiresAt: Date }) {
  const { client, owner, reviewer, creatorId, target, now } = input, options = await reviewedEvidenceOptions(client, target, now);
  const accounts = await client.socialAccount.findMany({ where: { id: { in: input.accountIds } }, orderBy: { id: "asc" } });
  const proof = await uploadSyntheticEvidence(client, owner, "ADVERTISING_LICENCE", target, now);
  const submitted = await submitAdvertisingLicence(owner, { operationKey: randomUUID(), creatorId, jurisdiction: input.jurisdiction, issuer: "Synthetic test issuer", holderName: "Synthetic test holder", licenceNumber: "synthetic-test-only", type: "Synthetic licence", scope: "Synthetic account scope", accountBindings: accounts.map(a => ({ accountId: a.id, mappingRevision: a.mappingRevision })), platformScope: [...new Set(accounts.map(a => a.platform))], evidenceAssetId: proof.id, validFrom: new Date(now.getTime() - 60_000).toISOString(), expiresAt: input.expiresAt.toISOString() }, options);
  await reviewAdvertisingLicence(reviewer, submitted.licence.id, { operationKey: randomUUID(), expectedRevision: submitted.licence.revision, decision: "VERIFIED", policyVersionId: input.marketVersionId, note }, options);
  return { licenceId: submitted.licence.id, proofId: proof.id };
}
export async function reviewedRepresentativeFixture(client: PrismaClient, owner: string, reviewer: string, brandId: string, target: EvidenceTarget, now: Date) {
  const options = await reviewedEvidenceOptions(client, target, now), brand = await client.brand.findUniqueOrThrow({ where: { id: brandId } });
  const proof = await uploadSyntheticEvidence(client, owner, "REPRESENTATIVE", target, now);
  const submitted = await submitBusinessVerification(owner, { operationKey: randomUUID(), brandId, kind: "REPRESENTATIVE", jurisdiction: brand.countryCode, identifier: "Synthetic test representative authority", evidenceAssetId: proof.id }, options);
  await reviewBusinessVerification(reviewer, submitted.verification.id, { operationKey: randomUUID(), expectedRevision: 1, decision: "VERIFIED", note }, options);
  return { verificationId: submitted.verification.id, proofId: proof.id };
}
// Invoke after deleting fixture domain/policy rows, before deleting fixture Users.
export async function cleanupReviewedEvidence(client: PrismaClient, actors: readonly string[], target: EvidenceTarget) {
  if (!actors.length) return;
  const options = await reviewedEvidenceOptions(client, target, new Date());
  const assets = await client.privateAsset.findMany({ where: { ownerUserId: { in: [...actors] } } });
  for (const asset of assets) if (asset.storageKey.startsWith("local:")) await options.storage.remove(asset.storageKey.slice(6));
  await client.ownershipChallenge.deleteMany({ where: { ownerUserId: { in: [...actors] } } });
  await client.evidenceCommand.deleteMany({ where: { actorUserId: { in: [...actors] } } });
  await client.adminAudit.deleteMany({ where: { actorUserId: { in: [...actors] } } });
  await client.outboxEvent.deleteMany({ where: { OR: actors.map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await client.privateAsset.deleteMany({ where: { ownerUserId: { in: [...actors] } } });
}
