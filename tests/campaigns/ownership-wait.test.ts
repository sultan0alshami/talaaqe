import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterEach, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCampaign, getCampaign } from "@/lib/campaigns/service";

const users: string[] = [];
afterEach(async () => {
  await prisma.campaign.deleteMany({ where: { brand: { userId: { in: users } } } });
  await prisma.user.deleteMany({ where: { id: { in: users.splice(0) } } });
});
function latch() {
  let release!: () => void;
  return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
}
it("withdraws old-owner campaign access after waiting for a concurrent brand reassignment", async () => {
  const owner = randomUUID(), replacement = randomUUID(); users.push(owner, replacement);
  await prisma.user.createMany({ data: [owner, replacement].map(id => ({ id, name: "Synthetic brand ownership wait", email: `${id}@example.invalid`, passwordHash: "not-a-login", role: "BRAND" as const, isTest: true })) });
  const brand = await prisma.brand.create({ data: { userId: owner, slug: `brand-${owner}`, name: "Private synthetic company" } });
  const campaign = (await createCampaign(owner, { operationKey: randomUUID(), fields: { title: "Private synthetic campaign" } })).campaign;
  const held = latch(), release = latch(), readOwner = latch();
  const client = prisma.$extends({ query: { brand: { async findUnique({ args, query }) {
    const row = await query(args);
    if (args.where.userId === owner) readOwner.release();
    return row;
  } } } }) as unknown as PrismaClient;
  const holding = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Brand" WHERE id=${brand.id} FOR UPDATE`;
    held.release(); await release.promise;
    await tx.brand.update({ where: { id: brand.id }, data: { userId: replacement } });
  });
  try {
    await held.promise;
    const operation = getCampaign(owner, campaign.id, client).then(value => ({ value, code: "EXPOSED" }), (error: unknown) => error);
    await readOwner.promise;
    release.release(); await holding;
    expect(await operation).toMatchObject({ code: "NOT_FOUND", status: 404 });
  } finally { release.release(); await holding; }
});
