import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { Session } from "@/lib/jwt";
import { POST } from "@/app/api/organizations/commands/route";
import { GET as organizationGET } from "@/app/api/organizations/[id]/route";
import { GET as clientsGET } from "@/app/api/organizations/[id]/clients/route";
import { GET as authorityGET } from "@/app/api/organization-clients/[id]/authority/route";

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
  const user = await prisma.user.create({ data: { id: randomUUID(), name: "اسم أصلي", email: `${randomUUID()}@example.invalid`,
    role, passwordHash: "synthetic-transport", isTest: true } });
  userIds.push(user.id);
  const sessionId = randomBytes(32).toString("base64url");
  await prisma.authSession.create({ data: { id: sessionId, userId: user.id, version: user.sessionVersion, expiresAt: new Date(Date.now() + 120000) } });
  session = { userId: user.id, name: user.name, email: user.email, role, sessionId, sessionVersion: user.sessionVersion };
  return user;
}
function post(body: unknown, origin = process.env.APP_ORIGIN) {
  return POST(new Request(`${process.env.APP_ORIGIN}/api/organizations/commands`, { method: "POST",
    headers: { "Content-Type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) }));
}
function get(id = "missing", search = "") {
  return organizationGET(new Request(`${process.env.APP_ORIGIN}/api/organizations/${id}${search}`), { params: Promise.resolve({ id }) });
}
async function failure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
  expect(await response.json()).toMatchObject({ error: { code } });
}
const create = () => ({ action: "CREATE", command: { operationKey: randomUUID(), kind: "AGENCY", nameOriginal: "  مؤسسة أصلية <script>  " } });
it("checks anonymous/current genuine roles before reading commands or parsing queries", async () => {
  await failure(await get("missing", "?invalid=1"), 401, "UNAUTHENTICATED");
  await failure(await post({ invalid: true }), 401, "UNAUTHENTICATED");
  for (const role of ["CREATOR", "ADMIN"] as const) { await actor(role); await failure(await post(create()), 403, "FORBIDDEN"); }
});
it.each(["session", "version", "suspension"] as const)("denies actual %s invalidation before private preflight/input despite stale adapter", async reason => {
  const user = await actor();
  if (reason === "session") await prisma.authSession.update({ where: { id: session!.sessionId }, data: { revokedAt: new Date() } });
  if (reason === "version") await prisma.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
  if (reason === "suspension") await prisma.user.update({ where: { id: user.id }, data: { active: false } });
  await failure(await get("missing", "?invalid=1"), 401, "UNAUTHENTICATED");
  await failure(await post({ invalid: true }), 401, "UNAUTHENTICATED");
  expect(await prisma.organizationCommand.count({ where: { actorUserId: user.id } })).toBe(0);
});
it("requires exact origin and strict action/resource/body contracts without identity injection", async () => {
  await actor();
  await failure(await post(create(), "https://wrong.example.invalid"), 403, "FORBIDDEN");
  for (const body of [{ ...create(), resourceId: "invented" }, { ...create(), actorUserId: randomUUID() },
    { action: "PROPOSE_MEMBER", command: {} }, { action: "UNKNOWN", command: {} },
    { ...create(), command: { ...create().command, role: "ADMIN" } }]) await failure(await post(body), 422, "VALIDATION");
  expect(await prisma.organization.count({ where: { ownerUserId: session!.userId } })).toBe(0);
});
it("returns only a saved organization receipt, exact replay and native member-scoped reads", async () => {
  const owner = await actor(), input = create(), first = await post(input);
  expect(first.status).toBe(200); const saved = (await first.json()).data;
  expect(saved.organization.name).toBe(input.command.nameOriginal); expect(saved.replayed).toBe(false);
  expect(Object.keys(saved.organization).sort()).toEqual(["active", "id", "kind", "name", "revision"]);
  const repeat = await post(input); expect(repeat.status).toBe(200);
  expect((await repeat.json()).data).toEqual({ ...saved, replayed: true });
  await failure(await post({ ...input, command: { ...input.command, nameOriginal: "changed" } }), 409, "IDEMPOTENCY_CONFLICT");
  const loaded = await get(saved.organization.id); expect(loaded.status).toBe(200);
  const body = await loaded.json(); expect(body.data.membership.userId).toBe(owner.id);
  for (const privateValue of [session!.sessionId, session!.email, "passwordHash"]) expect(JSON.stringify(body).includes(privateValue)).toBe(false);
  await actor(); await failure(await get(saved.organization.id), 404, "NOT_FOUND");
});
it("validates repeated/unsupported pagination and authority flags without granting owner client access", async () => {
  await actor(); const saved = (await (await post(create())).json()).data;
  for (const query of ["?after=a&after=b", "?limit=500", "?after=a%0Ab", "?after="]) {
    await failure(await clientsGET(new Request(`${process.env.APP_ORIGIN}/api/organizations/${saved.organization.id}/clients${query}`),
      { params: Promise.resolve({ id: saved.organization.id }) }), 422, "VALIDATION");
  }
  const empty = await clientsGET(new Request(`${process.env.APP_ORIGIN}/api/organizations/${saved.organization.id}/clients`),
    { params: Promise.resolve({ id: saved.organization.id }) });
  expect(empty.status).toBe(200); expect((await empty.json()).data.clients).toEqual([]);
  for (const query of ["", "?capability=admin", "?capability=view&capability=financial", "?capability=view&actor=other"]) {
    await failure(await authorityGET(new Request(`${process.env.APP_ORIGIN}/api/organization-clients/missing/authority${query}`),
      { params: Promise.resolve({ id: "missing" }) }), 422, "VALIDATION");
  }
  await failure(await authorityGET(new Request(`${process.env.APP_ORIGIN}/api/organization-clients/missing/authority?capability=view`),
    { params: Promise.resolve({ id: "missing" }) }), 404, "NOT_FOUND");
});
