import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createOrganization } from "@/lib/organizations/service";
import type { OrganizationActor } from "@/lib/organizations/context";
const ids: string[] = [];
afterEach(async () => {
  const organizations = await prisma.organization.findMany({ where: { ownerUserId: { in: ids } }, select: { id: true } });
  await prisma.organizationCommand.deleteMany({ where: { organizationId: { in: organizations.map(row => row.id) } } });
  await prisma.organization.deleteMany({ where: { id: { in: organizations.map(row => row.id) } } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.outboxEvent.deleteMany({ where: { OR: ids.map(id => ({ payload: { path: ["actorUserId"], equals: id } })) } });
  await prisma.brand.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } }); ids.length = 0;
});
async function fixture() {
  const user = await prisma.user.create({ data: { id: randomUUID(), name: "Synthetic native guard", email: `${randomUUID()}@example.invalid`, role: "BRAND", passwordHash: "not-a-login", isTest: true } });
  ids.push(user.id); const sessionId = randomBytes(32).toString("base64url");
  await prisma.authSession.create({ data: { id: sessionId, userId: user.id, version: user.sessionVersion, expiresAt: new Date(Date.now() + 60000) } });
  const actor: OrganizationActor = { userId: user.id, role: user.role, sessionId, sessionVersion: user.sessionVersion };
  return { actor, organization: (await createOrganization(actor, { operationKey: randomUUID(), nameOriginal: "اسم أصلي", kind: "AGENCY" })).organization };
}
it("enforces exact next revisions and immutable owner identity in actual PostgreSQL", async () => {
  const first = await fixture(), other = await fixture();
  await expect(prisma.organization.update({ where: { id: first.organization.id }, data: { name: "changed without revision" } })).rejects.toThrow();
  await expect(prisma.organization.update({ where: { id: first.organization.id }, data: { revision: { increment: 2 } } })).rejects.toThrow();
  await expect(prisma.organization.update({ where: { id: first.organization.id }, data: { ownerUserId: other.actor.userId, revision: { increment: 1 } } })).rejects.toThrow();
  expect((await prisma.organization.findUniqueOrThrow({ where: { id: first.organization.id } })).revision).toBe(1);
});
it("protects original owner membership and immutable user binding below ordinary commands", async () => {
  const first = await fixture(), other = await fixture();
  const membership = await prisma.organizationMembership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: first.organization.id, userId: first.actor.userId } } });
  await expect(prisma.organizationMembership.update({ where: { id: membership.id }, data: { state: "REVOKED", revision: { increment: 1 } } })).rejects.toThrow();
  await expect(prisma.organizationMembership.update({ where: { id: membership.id }, data: { userId: other.actor.userId, revision: { increment: 1 } } })).rejects.toThrow();
  expect((await prisma.organizationMembership.findUniqueOrThrow({ where: { id: membership.id } })).state).toBe("ACTIVE");
});
it("requires explicit exact seven-boolean authorization for ACTIVE client associations", async () => {
  const first = await fixture();
  const brand = await prisma.brand.create({ data: { userId: first.actor.userId, name: "Synthetic original", slug: `guard-${randomUUID()}`, isTest: true } });
  for (const allowedCapabilities of [{ view: true }, { view: true, plan: false, approveShortlist: false, reviewContent: false, signCustomer: false, financial: false, manageGrants: "yes" }]) {
    await expect(prisma.organizationClient.create({ data: { organizationId: first.organization.id, brandId: brand.id, state: "ACTIVE",
      authorizingUserId: first.actor.userId, authorizingSessionVersion: first.actor.sessionVersion, allowedCapabilities } })).rejects.toThrow();
  }
  await expect(prisma.organizationClient.create({ data: { organizationId: first.organization.id, brandId: brand.id, state: "ACTIVE" } })).rejects.toThrow();
  expect(await prisma.organizationClient.count({ where: { organizationId: first.organization.id } })).toBe(0);
});
it("keeps immutable committed receipts and prevents organization cascade from erasing their history", async () => {
  const first = await fixture();
  const receipt = await prisma.organizationCommand.findFirstOrThrow({ where: { organizationId: first.organization.id } });
  await expect(prisma.organizationCommand.update({ where: { id: receipt.id }, data: { result: { fabricated: true } } })).rejects.toThrow();
  await expect(prisma.organization.delete({ where: { id: first.organization.id } })).rejects.toThrow("OrganizationCommand_organizationId_fkey");
  expect(await prisma.organization.count({ where: { id: first.organization.id } })).toBe(1);
  expect((await prisma.organizationCommand.findUniqueOrThrow({ where: { id: receipt.id } })).result).toEqual(receipt.result);
});
