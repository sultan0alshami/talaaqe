import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createLocalEvidenceStorage, type EvidenceStorage } from "@/lib/evidence/storage";
export const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1kAAAAASUVORK5CYII=", "base64");
export const users: string[] = [];
export const now = new Date("2026-10-05T12:00:00.000Z");
let storage: EvidenceStorage;
export async function options() { storage ??= await createLocalEvidenceStorage({ taskId: process.env.INFAME_TASK_ID!, target: "test" }); return { storage, now }; }
export async function user(role: "CREATOR" | "BRAND" | "ADMIN") {
  const id = randomUUID(); users.push(id);
  await prisma.user.create({ data: { id, role, name: "Synthetic private evidence actor", email: id + "@example.invalid", passwordHash: "not-a-login", isTest: true } });
  return id;
}
export async function fixture() {
  const owner = await user("CREATOR"), admin = await user("ADMIN"), outsider = await user("CREATOR");
  const creator = await prisma.creator.create({ data: { userId: owner, handle: "proof_" + owner.slice(0, 8), displayName: "صاحب إثبات اختبار", countryCode: "KW", isTest: true } });
  const account = await prisma.socialAccount.create({ data: { creatorId: creator.id, platform: "INSTAGRAM", handle: "proof_" + owner.slice(0, 8), providerAccountId: "synthetic-" + owner, intendedConfirmedAt: now, consentAt: now } });
  return { owner, admin, outsider, creator, account, options: await options() };
}
export async function cleanup() {
  const assets = await prisma.privateAsset.findMany({ where: { ownerUserId: { in: users } }, select: { storageKey: true } });
  for (const asset of assets) await storage?.remove(asset.storageKey.replace(/^(local|supabase):/, ""));
  await prisma.outboxEvent.deleteMany({ where: { OR: users.map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: users } } });
  await prisma.evidenceCommand.deleteMany({ where: { actorUserId: { in: users } } });
  await prisma.ownershipChallenge.deleteMany({ where: { ownerUserId: { in: users } } });
  await prisma.creator.deleteMany({ where: { userId: { in: users } } });
  await prisma.brand.deleteMany({ where: { userId: { in: users } } });
  await prisma.privateAsset.deleteMany({ where: { ownerUserId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } }); users.length = 0;
}
