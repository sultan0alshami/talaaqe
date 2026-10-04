import { record, type Tx } from "./common";

// Descriptive private history belongs to its original submitter, even when a
// profile is transferred. This does not establish accepted/effective proof.
export async function ownerSubmittedResource(tx: Tx, owner: string, type: "AdvertisingLicence" | "BusinessVerification", id: string,
  evidenceAssetId: string | null, purpose: string, scopeHash: string, submittedAt: Date) {
  if (!evidenceAssetId) return false;
  const asset = await tx.privateAsset.findUnique({ where: { id: evidenceAssetId }, select: { ownerUserId: true, purpose: true } });
  if (asset?.ownerUserId !== owner || asset.purpose !== purpose) return false;
  const submissions = await tx.evidenceCommand.findMany({ where: { resourceType: type, resourceId: id, actorUserId: owner, createdAt: submittedAt }, take: 50 });
  return submissions.some(receipt => {
    const metadata = record(receipt.resultJson);
    return metadata.resourceId === id && metadata.ownerUserId === owner && metadata.scopeHash === scopeHash
      && /^[a-f0-9]{64}$/.test(receipt.payloadHash);
  });
}
