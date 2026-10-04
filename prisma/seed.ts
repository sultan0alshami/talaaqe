// Idempotent synthetic local fixtures. No wipes, real people, production grants or public profiles.
import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NICHE_TAXONOMY } from "../src/lib/contracts/taxonomy";
import { taskState, assertLocalTarget, workspace } from "../scripts/task-state.mjs";
const prisma = new PrismaClient();
async function main() {
  const state = taskState();
  const target = ["dev", "test", "e2e"].find(kind => assertLocalTarget(state, kind) === process.env.DATABASE_URL);
  if (!target) throw new Error("Seed refuses unknown or nonlocal database targets");
  const marker = await prisma.$queryRaw<{ id: string; kind: string }[]>`SELECT id, kind FROM "infame_task_meta"."infame_disposable"`;
  if (marker.length !== 1 || marker[0].id !== state.id || marker[0].kind !== target) throw new Error("Seed requires exact disposable task marker");
  const credentialsFile = path.join(workspace, ".infame", `fixtures-${target}.json`);
  const fixtures: { password: string } = existsSync(credentialsFile) ? JSON.parse(readFileSync(credentialsFile, "utf8")) : { password: randomBytes(24).toString("base64url") };
  if (!existsSync(credentialsFile)) writeFileSync(credentialsFile, JSON.stringify(fixtures), { mode: 0o600, flag: "wx" });
  const passwordHash = await bcrypt.hash(fixtures.password, 12);
  for (const [name, email, role] of [["Synthetic creator", "creator@example.invalid", Role.CREATOR], ["Synthetic brand", "brand@example.invalid", Role.BRAND]] as const) {
    const user = await prisma.user.upsert({ where: { email }, update: { isTest: true }, create: { name, email, passwordHash, role, isTest: true } });
    if (role === Role.CREATOR) await prisma.creator.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id, handle: "synthetic_creator", displayName: name, isTest: true } });
    else await prisma.brand.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id, slug: "synthetic-brand", name, isTest: true } });
  }
  for (const niche of NICHE_TAXONOMY) await prisma.niche.upsert({ where: { id: niche.slug }, update: {}, create: { id: niche.slug, parentId: niche.parentSlug, labelAr: niche.labelAr, labelEn: niche.labelEn, sortOrder: niche.sortOrder } });
  console.log(`Idempotent ${target} synthetic seed complete; existing profile content preserved. Credentials remain in ignored fixture files.`);
}
main().finally(() => prisma.$disconnect());
