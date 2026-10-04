import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrivateAsset } from "@prisma/client";
import { active, canonicalHash, event, Id, Key, parse, previous, receipt, transaction, lock, type EvidenceOptions, type Tx } from "./common";
import { byteChecksum, EvidenceError, inspectEvidence } from "./storage";

export const AssetPurposeSchema = z.enum(["OWNERSHIP_PROOF", "SCREENSHOT", "ADVERTISING_LICENCE", "REPRESENTATIVE", "BUSINESS_REGISTRATION", "LEGAL_POLICY_REVIEW", "CONTACT_VERIFICATION"]);
const Upload = z.object({ operationKey: Key, purpose: AssetPurposeSchema, contentType: z.string(), bytes: z.instanceof(Uint8Array) }).strict();
export function assetDTO(asset: PrivateAsset) { return { id: asset.id, revision: asset.revision, purpose: asset.purpose, contentType: asset.contentType, size: asset.size, deletedAt: asset.deletedAt?.toISOString() ?? null, createdAt: asset.createdAt.toISOString() }; }
export type PrivateAssetDTO = ReturnType<typeof assetDTO>;
export async function usableAsset(tx: Tx, assetId: string, owner: string, purpose: string, options: EvidenceOptions) {
  await lock(tx, "PrivateAsset", assetId, true);
  const asset = await tx.privateAsset.findUnique({ where: { id: assetId } });
  if (!asset || asset.ownerUserId !== owner || asset.purpose !== purpose || asset.deletedAt) throw new EvidenceError("INVALID_EVIDENCE");
  const prefix = options.storage.kind.toLowerCase() + ":";
  if (!asset.storageKey.startsWith(prefix)) throw new EvidenceError("ASSET_BYTES_UNAVAILABLE", 503);
  const bytes = await options.storage.get(asset.storageKey.slice(prefix.length));
  const inspection = inspectEvidence(bytes, asset.contentType);
  if (inspection.size !== asset.size || inspection.checksum !== asset.checksum) throw new EvidenceError("ASSET_BYTES_UNAVAILABLE", 503);
  return { asset, bytes };
}
export async function uploadPrivateAsset(actor: string, input: unknown, options: EvidenceOptions) {
  const command = parse(Upload, input), inspection = inspectEvidence(command.bytes, command.contentType);
  const hash = canonicalHash({ operationKey: command.operationKey, purpose: command.purpose, ...inspection });
  return transaction(options, async (tx, now) => {
    const user = await active(tx, actor);
    const allowed = user.role === "ADMIN" ? ["LEGAL_POLICY_REVIEW", "CONTACT_VERIFICATION"]
      : user.role === "CREATOR" ? ["OWNERSHIP_PROOF", "SCREENSHOT", "ADVERTISING_LICENCE"]
        : ["REPRESENTATIVE", "BUSINESS_REGISTRATION", "CONTACT_VERIFICATION"];
    if (!allowed.includes(command.purpose)) throw new EvidenceError("FORBIDDEN", 403);
    const replay = await previous(tx, actor, command.operationKey, hash);
    if (replay) { const asset = await tx.privateAsset.findUniqueOrThrow({ where: { id: replay.resourceId } }); await usableAsset(tx, asset.id, actor, command.purpose, options); return { asset: assetDTO(asset), replayed: true }; }
    // A stable opaque object key allows the same immutable bytes to be reconciled
    // after a transaction failure; storage is never overwritten by a retry.
    const id = createHash("sha256").update(actor + ":" + command.operationKey).digest("hex");
    const objectKey = createHash("sha256").update(actor).digest("hex").slice(0, 32) + "/" + id;
    await options.storage.put(objectKey, command.bytes, inspection.contentType);
    const asset = await tx.privateAsset.create({ data: { id, ownerUserId: actor, purpose: command.purpose, storageKey: options.storage.kind.toLowerCase() + ":" + objectKey, ...inspection, createdAt: now } });
    await receipt(tx, actor, command.operationKey, hash, "PrivateAsset", id, 1, now);
    await event(tx, actor, command.operationKey, "evidence.uploaded", "PrivateAsset", id, 1, now, { purpose: command.purpose });
    return { asset: assetDTO(asset), replayed: false };
  });
}
export async function getPrivateAsset(actor: string, id: string, options: EvidenceOptions) {
  parse(Id, id);
  return transaction(options, async (tx, now) => {
    const user = await active(tx, actor);
    const asset = await tx.privateAsset.findUnique({ where: { id } });
    if (!asset || asset.deletedAt || asset.ownerUserId !== actor && user.role !== "ADMIN") throw new EvidenceError("NOT_FOUND", 404);
    const usable = await usableAsset(tx, id, asset.ownerUserId, asset.purpose, options);
    if (user.role === "ADMIN" && asset.ownerUserId !== actor) await tx.adminAudit.create({ data: { actorUserId: actor, action: "evidence.accessed", resourceType: "PrivateAsset", resourceId: id, snapshot: { assetId: id }, createdAt: now } });
    const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" }[asset.contentType];
    return { asset: assetDTO(asset), bytes: usable.bytes, headers: { "Content-Type": asset.contentType, "Content-Disposition": 'attachment; filename="evidence.' + extension + '"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'" } };
  });
}
export { byteChecksum };
