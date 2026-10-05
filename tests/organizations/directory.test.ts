import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getOrganizationDirectory } from "@/lib/organizations/directory";
import { OrganizationDirectorySchema } from "@/lib/organizations/contracts";
import type { OrganizationActor } from "@/lib/organizations/context";
const ids: string[] = [];
afterEach(async () => {
  await prisma.organization.deleteMany({ where: { ownerUserId: { in: ids } } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } }); ids.length = 0;
});
async function actor() {
  const user = await prisma.user.create({ data: { id: randomUUID(), name: "Original name", email: `${randomUUID()}@example.invalid`, role: "BRAND", passwordHash: "not-a-login", isTest: true } });
  ids.push(user.id); const sessionId = randomBytes(32).toString("base64url");
  await prisma.authSession.create({ data: { id: sessionId, userId: user.id, version: user.sessionVersion, expiresAt: new Date(Date.now() + 60000) } });
  return { userId: user.id, role: user.role, sessionId, sessionVersion: user.sessionVersion } satisfies OrganizationActor;
}
async function org(owner: OrganizationActor, member: OrganizationActor, state: "ACTIVE" | "PENDING" | "REVOKED", name = "اسم مؤسسة أصلي") {
  return prisma.organization.create({ data: { id: `dir-${randomUUID()}`, name, kind: "AGENCY", ownerUserId: owner.userId,
    memberships: { create: { userId: member.userId, state } } } });
}
it("returns only own active/pending membership metadata, distinguishes unavailable owners and excludes strangers/revoked seats", async () => {
  const owner = await actor(), member = await actor(), stranger = await actor(), suspended = await actor();
  const active = await org(owner, member, "ACTIVE", "  أصلي <script>  "), pending = await org(owner, member, "PENDING");
  await org(owner, member, "REVOKED"); await org(owner, stranger, "ACTIVE"); const unavailable = await org(suspended, member, "ACTIVE");
  await prisma.user.update({ where: { id: suspended.userId }, data: { active: false } });
  const result = await getOrganizationDirectory(member);
  expect(OrganizationDirectorySchema.safeParse(result).success).toBe(true);
  expect(result.organizations.map(row => row.organization.id).sort()).toEqual([active.id, pending.id, unavailable.id].sort());
  expect(result.organizations.find(row => row.organization.id === unavailable.id)?.available).toBe(false);
  expect(result.organizations.find(row => row.organization.id === active.id)?.available).toBe(true);
  expect(result.organizations.find(row => row.organization.id === active.id)?.organization.name).toBe(active.name);
  expect(result.nextCursor).toBeNull();
  expect(Object.keys(result.organizations[0]).sort()).toEqual(["available", "isOwner", "membership", "organization"]);
  expect(result.organizations.every(row => !row.isOwner)).toBe(true);
  expect(Object.keys(result.organizations[0].organization).sort()).toEqual(["active", "id", "kind", "name", "revision"]);
  expect(JSON.stringify(result).includes(owner.userId)).toBe(false);
  expect(await prisma.adminAudit.count({ where: { actorUserId: member.userId, action: "organization.directory_read" } })).toBe(1);
});
it("pages31 genuine native memberships in exclusive identity order without hidden rows consuming a page", async () => {
  const member = await actor(), owner = await actor();
  const rows = [];
  for (let index = 0; index < 31; index++) rows.push(await org(owner, member, index % 2 ? "PENDING" : "ACTIVE"));
  await org(owner, member, "REVOKED");
  const first = await getOrganizationDirectory(member);
  const second = await getOrganizationDirectory(member, { after: first.nextCursor });
  expect(first.organizations).toHaveLength(30); expect(second.organizations).toHaveLength(1);
  expect(first.nextCursor).toBe(first.organizations[29].organization.id); expect(second.nextCursor).toBeNull();
  expect([...first.organizations, ...second.organizations].map(row => row.organization.id)).toEqual(rows.map(row => row.id).sort());
});
it("checks current native session before invalid input and records no private read for denied actors", async () => {
  const member = await actor();
  await prisma.authSession.update({ where: { id: member.sessionId }, data: { revokedAt: new Date() } });
  await expect(getOrganizationDirectory(member, { injected: true })).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  expect(await prisma.adminAudit.count({ where: { actorUserId: member.userId } })).toBe(0);
});
it("identifies the protected owner for owner-only navigation without exposing another owner identity", async () => {
  const owner = await actor(), member = await actor();
  const owned = await org(owner, owner, "ACTIVE"), joined = await org(member, owner, "ACTIVE");
  const result = await getOrganizationDirectory(owner);
  expect(result.organizations.find(row => row.organization.id === owned.id)).toMatchObject({ isOwner: true });
  expect(result.organizations.find(row => row.organization.id === joined.id)).toMatchObject({ isOwner: false });
  expect(JSON.stringify(result)).not.toContain(member.userId);
});
it("keeps only the recipient's pending and active membership metadata available for withdrawal after agency deactivation or owner suspension", async () => {
  const owner = await actor(), recipient = await actor(), other = await actor();
  const pending = await org(owner, recipient, "PENDING"), active = await org(owner, recipient, "ACTIVE");
  await org(owner, other, "ACTIVE"); await org(owner, recipient, "REVOKED");
  await prisma.organization.update({ where: { id: pending.id }, data: { active: false, revision: { increment: 1 } } });
  await prisma.user.update({ where: { id: owner.userId }, data: { active: false } });
  const result = await getOrganizationDirectory(recipient);
  expect(result.organizations.map(row => row.organization.id).sort()).toEqual([pending.id, active.id].sort());
  expect(result.organizations.every(row => "available" in row && row.available === false)).toBe(true);
  expect(JSON.stringify(result)).not.toContain(owner.userId); expect(JSON.stringify(result)).not.toContain(other.userId);
});
