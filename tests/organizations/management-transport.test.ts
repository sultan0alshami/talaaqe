import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { Session } from "@/lib/jwt";
import { POST } from "@/app/api/organizations/commands/route";
import { GET as referencesGET } from "@/app/api/organizations/references/route";
import { GET as membersGET } from "@/app/api/organizations/[id]/members/route";
import { GET as associationsGET } from "@/app/api/organizations/[id]/associations/route";
import { GET as ownAssociationsGET } from "@/app/api/brand/organization-associations/route";
import { GET as grantsGET } from "@/app/api/organization-clients/[id]/grants/route";
let session: Session | null = null;
const userIds: string[] = [];
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
afterEach(async () => {
  const orgs = await prisma.organization.findMany({ where: { ownerUserId: { in: userIds } }, select: { id: true } });
  const ids = orgs.map(row => row.id);
  await prisma.organizationCommand.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
  await prisma.outboxEvent.deleteMany({ where: { OR: userIds.map(id => ({ payload: { path: ["actorUserId"], equals: id } })) } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.brand.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  userIds.length = 0; session = null;
});
async function actor(role: "BRAND" | "CREATOR" | "ADMIN" = "BRAND") {
  const user = await prisma.user.create({ data: { id: randomUUID(), name: "اسم أصلي", email: `${randomUUID()}@example.invalid`, role, passwordHash: "synthetic-transport-only", isTest: true } });
  userIds.push(user.id); const sessionId = randomBytes(32).toString("base64url");
  await prisma.authSession.create({ data: { id: sessionId, userId: user.id, version: user.sessionVersion, expiresAt: new Date(Date.now() + 60000) } });
  const current: Session = { userId: user.id, name: user.name, email: user.email, role, sessionId, sessionVersion: user.sessionVersion };
  session = current; return { user, session: current };
}
const request = (path: string) => new Request(`${process.env.APP_ORIGIN}${path}`);
const resource = (id = "missing") => ({ params: Promise.resolve({ id }) });
function post(action: string, resourceId: string | undefined, command: unknown) { return POST(new Request(`${process.env.APP_ORIGIN}/api/organizations/commands`, { method: "POST", headers: { "Content-Type": "application/json", Origin: process.env.APP_ORIGIN! }, body: JSON.stringify({ action, ...(resourceId ? { resourceId } : {}), command }) })); }
async function failure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/); expect(await response.json()).toMatchObject({ error: { code } });
}
async function allReads(search = "?unknown=1") {
  return Promise.all([referencesGET(request(`/api/organizations/references${search}`)), membersGET(request(`/api/organizations/missing/members${search}`), resource()),
    associationsGET(request(`/api/organizations/missing/associations${search}`), resource()), ownAssociationsGET(request(`/api/brand/organization-associations${search}`)),
    grantsGET(request(`/api/organization-clients/missing/grants${search}`), resource())]);
}
it("all management transports enforce current identity before private parameters and strict queries", async () => {
  for (const response of await allReads()) await failure(response, 401, "UNAUTHENTICATED");
  for (const role of ["CREATOR", "ADMIN"] as const) { await actor(role); for (const response of await allReads()) await failure(response, 403, "FORBIDDEN"); }
  const current = await actor(); await prisma.authSession.update({ where: { id: current.session.sessionId }, data: { revokedAt: new Date() } });
  for (const response of await allReads()) await failure(response, 401, "UNAUTHENTICATED");
  expect(await prisma.adminAudit.count({ where: { actorUserId: { in: userIds } } })).toBe(0);
});
it("rejects identity injection, duplicate cursors and unknown controls without organization data", async () => {
  await actor();
  for (const search of ["?after=a&after=b", "?limit=500", "?actor=someone", "?after=", "?after=a%0Ab"])
    for (const response of await allReads(search)) await failure(response, 422, "VALIDATION");
  for (const action of ["WITHDRAW_MEMBERSHIP", "REVOKE_CLIENT", "WITHDRAW_CLIENT_PROPOSAL"])
    await failure(await post(action, "missing", { operationKey: randomUUID(), expectedRevision: 1, ownerUserId: randomUUID() }), 422, "VALIDATION");
});
it("returns only the actual user's shareable references and private UTC metadata", async () => {
  const current = await actor(), brand = await prisma.brand.create({ data: { userId: current.user.id, slug: `transport-${randomUUID()}`, name: "Private name", description: "private-description", isTest: true } });
  const response = await referencesGET(request("/api/organizations/references"));
  expect(response.status).toBe(200); const data = (await response.json()).data;
  expect(Object.keys(data).sort()).toEqual(["asOf", "brandId", "userId"]); expect(data).toMatchObject({ userId: current.user.id, brandId: brand.id });
  for (const secret of [current.user.email, current.session.sessionId, brand.name, brand.description, current.user.passwordHash]) expect(JSON.stringify(data)).not.toContain(secret);
  const empty = await ownAssociationsGET(request("/api/brand/organization-associations")); expect(empty.status).toBe(200); expect((await empty.json()).data.associations).toEqual([]);
});
it("dispatches all three lifecycle actions with exact recipients and replay-safe private receipts", async () => {
  const owner = await actor(), member = await actor(), customer = await actor(); session = owner.session;
  const created = await post("CREATE", undefined, { operationKey: randomUUID(), nameOriginal: "Native test organization", kind: "AGENCY" });
  expect(created.status).toBe(200); const org = (await created.json()).data.organization;
  const orgRevision = async () => (await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).revision;
  const proposedMember = await post("PROPOSE_MEMBER", org.id, { operationKey: randomUUID(), expectedOrganizationRevision: await orgRevision(), targetUserId: member.user.id });
  expect(proposedMember.status).toBe(200); const membership = (await proposedMember.json()).data.membership;
  const membershipCommand = { operationKey: randomUUID(), expectedRevision: membership.revision };
  await failure(await post("WITHDRAW_MEMBERSHIP", membership.id, membershipCommand), 404, "NOT_FOUND");
  session = member.session; const leave = await post("WITHDRAW_MEMBERSHIP", membership.id, membershipCommand); expect(leave.status).toBe(200); expect((await leave.json()).data.membership.state).toBe("REVOKED");
  const replay = await post("WITHDRAW_MEMBERSHIP", membership.id, membershipCommand); expect(replay.status).toBe(200); expect((await replay.json()).data.replayed).toBe(true);
  const brand = await prisma.brand.create({ data: { userId: customer.user.id, slug: `transport-${randomUUID()}`, name: "Private client", isTest: true } });
  const propose = async () => { session = owner.session; const response = await post("PROPOSE_CLIENT", org.id, { operationKey: randomUUID(), expectedOrganizationRevision: await orgRevision(), brandId: brand.id }); expect(response.status).toBe(200); return (await response.json()).data.client; };
  const first = await propose(); const withdraw = await post("WITHDRAW_CLIENT_PROPOSAL", first.id, { operationKey: randomUUID(), expectedRevision: first.revision }); expect(withdraw.status).toBe(200); expect((await withdraw.json()).data.client.state).toBe("REVOKED");
  const second = await propose(); session = customer.session;
  const revoke = await post("REVOKE_CLIENT", second.id, { operationKey: randomUUID(), expectedRevision: second.revision }); expect(revoke.status).toBe(200); expect((await revoke.json()).data.client.state).toBe("REVOKED");
  session = owner.session; const members = await membersGET(request(`/api/organizations/${org.id}/members`), resource(org.id)); expect(members.status).toBe(200);
  const associations = await associationsGET(request(`/api/organizations/${org.id}/associations`), resource(org.id)); expect(associations.status).toBe(200);
  session = customer.session; const own = await ownAssociationsGET(request("/api/brand/organization-associations")); expect(own.status).toBe(200); expect((await own.json()).data.associations[0]).toMatchObject({ delegation: "REVOKED", canRevoke: false });
  const grants = await grantsGET(request(`/api/organization-clients/${second.id}/grants`), resource(second.id)); expect(grants.status).toBe(200); expect((await grants.json()).data.canManageGrants).toBe(false);
});
