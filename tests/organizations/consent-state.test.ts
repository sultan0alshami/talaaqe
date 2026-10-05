import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import type { OrganizationActor } from "@/lib/organizations/context";
import { authorizeClientAssociation, createOrganization, proposeClientAssociation } from "@/lib/organizations/service";
import { revokeClientAssociation, withdrawClientProposal } from "@/lib/organizations/lifecycle";
import { getOwnBrandAssociations } from "@/lib/organizations/management";
const ids: string[] = [];
const capabilities = { view: true, plan: false, approveShortlist: false, reviewContent: false, signCustomer: false, financial: false, manageGrants: false };
afterEach(async () => {
  const orgs = (await prisma.organization.findMany({ where: { ownerUserId: { in: ids } }, select: { id: true } })).map(row => row.id);
  await prisma.organizationCommand.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
  await prisma.outboxEvent.deleteMany({ where: { OR: ids.map(id => ({ payload: { path: ["actorUserId"], equals: id } })) } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.brand.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } }); ids.length = 0;
});
async function actor() {
  const user = await prisma.user.create({ data: { id: randomUUID(), name: "Original native consent actor", email: `${randomUUID()}@example.invalid`, role: "BRAND", passwordHash: "synthetic-native-only", isTest: true } });
  ids.push(user.id); const sessionId = randomBytes(32).toString("base64url");
  await prisma.authSession.create({ data: { id: sessionId, userId: user.id, version: user.sessionVersion, expiresAt: new Date(Date.now() + 60000) } });
  return { userId: user.id, role: user.role, sessionId, sessionVersion: user.sessionVersion } satisfies OrganizationActor;
}
it.each(["agency", "customer"] as const)("requires fresh two-party consent after %s withdrawal and preserves failed-authorization state", async removedBy => {
  const agency = await actor(), customer = await actor();
  const brand = await prisma.brand.create({ data: { userId: customer.userId, slug: `consent-${randomUUID()}`, name: "Private original company", isTest: true } });
  const org = (await createOrganization(agency, { operationKey: randomUUID(), nameOriginal: "Original agency", kind: "AGENCY" })).organization;
  const orgRevision = async () => (await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).revision;
  const proposal = (await proposeClientAssociation(agency, org.id, { operationKey: randomUUID(), expectedOrganizationRevision: await orgRevision(), brandId: brand.id })).client;
  let revoked;
  if (removedBy === "agency") revoked = (await withdrawClientProposal(agency, proposal.id, { operationKey: randomUUID(), expectedRevision: proposal.revision })).client;
  else {
    const accepted = (await authorizeClientAssociation(customer, proposal.id, { operationKey: randomUUID(), expectedRevision: proposal.revision, capabilities })).client;
    revoked = (await revokeClientAssociation(customer, accepted.id, { operationKey: randomUUID(), expectedRevision: accepted.revision })).client;
  }
  const before = await prisma.organizationClient.findUniqueOrThrow({ where: { id: revoked.id } }), orgBefore = await orgRevision();
  const command = { operationKey: randomUUID(), expectedRevision: revoked.revision, capabilities };
  await expect(authorizeClientAssociation(customer, revoked.id, command)).rejects.toMatchObject({ status: 409, code: "INVALID_STATE" });
  expect(await prisma.organizationClient.findUniqueOrThrow({ where: { id: revoked.id } })).toEqual(before); expect(await orgRevision()).toBe(orgBefore);
  expect(await prisma.organizationCommand.count({ where: { actorUserId: customer.userId, operationKey: command.operationKey } })).toBe(0);
  const unavailable = await getOwnBrandAssociations(customer); expect(unavailable.associations[0].canAuthorize).toBe(false);
  const fresh = (await proposeClientAssociation(agency, org.id, { operationKey: randomUUID(), expectedOrganizationRevision: await orgRevision(), brandId: brand.id })).client;
  expect(fresh).toMatchObject({ id: revoked.id, state: "PENDING", revision: revoked.revision + 1 });
  expect((await getOwnBrandAssociations(customer)).associations[0].canAuthorize).toBe(true);
  expect((await authorizeClientAssociation(customer, fresh.id, { ...command, expectedRevision: fresh.revision })).client).toMatchObject({ state: "ACTIVE", revision: fresh.revision + 1 });
});
