import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { captureOrganizationActor } from "@/lib/organizations/context";
import { getPrivateAsset, getCreatorEvidence, getBrandEvidence, uploadPrivateAsset } from "@/lib/evidence/service";
import { EXTERNAL_COLLABORATION_ATTACHMENT_PURPOSE as purpose } from "@/lib/external-collaborations/contracts";
import { byteChecksum } from "@/lib/evidence/storage";
import { cleanup, fixture, png, user } from "../evidence/fixtures";

afterEach(cleanup);
async function actor(id: string) {
  const row = await prisma.user.findUniqueOrThrow({ where: { id } });
  const session = await resolveSession(await openSession(id, row.sessionVersion, row.passwordHash));
  if (!session) throw new Error("Native fixture session missing");
  return captureOrganizationActor(session);
}
it("keeps organizer attachment bytes and metadata out of generic evidence paths", async () => {
  const f = await fixture(), company = await user("BRAND");
  const brand = await prisma.brand.create({ data: { userId: company, slug: randomUUID(), name: "Synthetic company", isTest: true } });
  const creatorAuth = await actor(f.owner), adminAuth = await actor(f.admin), brandAuth = await actor(company);
  let reads = 0;
  const storage = { ...f.options.storage, async get(key: string) { reads++; return f.options.storage.get(key); } };
  const normal = await uploadPrivateAsset(f.owner, { operationKey: randomUUID(), purpose: "OWNERSHIP_PROOF", contentType: "image/png", bytes: png }, { storage, serverAuth: creatorAuth });
  const privateIds: string[] = [];
  for (const ownerUserId of [f.owner, company]) {
    const id = randomUUID(), object = randomUUID() + "/" + id;
    await storage.put(object, png, "image/png");
    await prisma.privateAsset.create({ data: { id, ownerUserId, purpose, storageKey: "local:" + object,
      contentType: "image/png", size: png.length, checksum: byteChecksum(png) } });
    privateIds.push(id);
  }
  for (const serverAuth of [creatorAuth, adminAuth]) {
    await expect(getPrivateAsset(serverAuth.userId, privateIds[0]!, { storage, serverAuth })).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  }
  expect(reads).toBe(0);
  expect((await getCreatorEvidence(f.owner, f.creator.id, { storage, serverAuth: creatorAuth })).assets.map(value => value.id)).toEqual([normal.asset.id]);
  expect((await getBrandEvidence(company, brand.id, { storage, serverAuth: brandAuth })).assets.map(value => value.id)).not.toContain(privateIds[1]);
  await expect(uploadPrivateAsset(f.owner, { operationKey: randomUUID(), purpose, contentType: "image/png", bytes: png },
    { storage, serverAuth: creatorAuth })).rejects.toMatchObject({ code: "INVALID_COMMAND", status: 400 });
  const ordinary = await getPrivateAsset(f.owner, normal.asset.id, { storage, serverAuth: creatorAuth });
  expect(Buffer.from(ordinary.bytes)).toEqual(png); expect(reads).toBe(1);
});
