import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { Session } from "@/lib/jwt";
import { GET } from "@/app/api/admin/users/route";
import { PATCH } from "@/app/api/admin/users/[id]/route";
import { AdminUsersSchema, AdminUserStatusResultSchema } from "@/lib/admin/contracts";
import { cleanup, fixture, users } from "../deals/fixtures";

let session: Session | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
afterEach(async () => { session = null; await prisma.adminCommand.deleteMany({ where: { actorUserId: { in: users } } }); await cleanup(); });
const origin = process.env.APP_ORIGIN!;
async function setup() {
  const f = await fixture(2, "10001", { now: new Date(), target: "test" });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: f.target.reviewerId } });
  const sessionId = randomBytes(32).toString("base64url");
  await prisma.authSession.create({ data: { id: sessionId, userId: user.id, version: user.sessionVersion, expiresAt: new Date(Date.now() + 60000) } });
  session = { userId: user.id, role: user.role, name: user.name, email: user.email, sessionId, sessionVersion: user.sessionVersion };
  return { ...f, sessionId };
}
const list = (suffix = "") => new Request(origin + "/api/admin/users" + suffix);
const invokeList = (request: Request) => (GET as unknown as (request: Request) => Promise<Response>)(request);
const input = () => ({ operationKey: randomUUID(), expectedActive: true, expectedVersion: 1, active: false, reason: { text: "سبب أصلي لا يتغير", language: "ar" } });
const patch = (id: string, value: unknown, sendOrigin = true) => PATCH(new Request(origin + "/api/admin/users/" + id, { method: "PATCH", headers: { "Content-Type": "application/json", ...(sendOrigin ? { Origin: origin } : {}) }, body: JSON.stringify(value) }), { params: Promise.resolve({ id }) });
async function failure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({ error: { code } });
}

it("requires current ADMIN identity and private responses before listing or changing status", async () => {
  await failure(await invokeList(list()), 401, "UNAUTHENTICATED");
  const f = await setup();
  const creator = await prisma.user.findUniqueOrThrow({ where: { id: f.target.userId } });
  const id = randomBytes(32).toString("base64url");
  await prisma.authSession.create({ data: { id, userId: creator.id, version: 1, expiresAt: new Date(Date.now() + 60000) } });
  session = { userId: creator.id, name: creator.name, email: creator.email, role: "CREATOR", sessionId: id, sessionVersion: 1 };
  await failure(await invokeList(list("?unexpected=1")), 403, "FORBIDDEN");
  await failure(await patch(f.brandUserId, input()), 403, "FORBIDDEN");
  expect((await prisma.user.findUniqueOrThrow({ where: { id: f.brandUserId } })).active).toBe(true);
});
it("returns validated minimal original-name rows and rejects duplicated or unsupported queries", async () => {
  const f = await setup();
  await prisma.user.update({ where: { id: f.target.userId }, data: { name: "الاسم الأصلي", nameEn: "Never substitute this legacy translation" } });
  const response = await invokeList(list());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const body = await response.json();
  expect(AdminUsersSchema.safeParse(body.data).success).toBe(true);
  expect(body.data.users.find((row: { id: string }) => row.id === f.target.userId).name).toBe("الاسم الأصلي");
  expect(JSON.stringify(body).includes(session!.sessionId)).toBe(false);
  expect(JSON.stringify(body).includes("Never substitute this legacy translation")).toBe(false);
  await failure(await invokeList(list("?limit=100")), 422, "VALIDATION");
  await failure(await invokeList(list("?after=a&after=b")), 422, "VALIDATION");
});
it("origin-checks strict reasoned commands and returns an actual current-session mutation receipt", async () => {
  const f = await setup();
  await failure(await patch(f.target.userId, input(), false), 403, "FORBIDDEN");
  await failure(await patch(f.target.userId, { active: false }), 422, "VALIDATION");
  await failure(await patch(f.target.userId, { ...input(), reason: { text: " ", language: null } }), 422, "VALIDATION");
  const request = input(), response = await patch(f.target.userId, request);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const body = await response.json();
  expect(AdminUserStatusResultSchema.safeParse(body.data).success).toBe(true);
  expect(body.data).toMatchObject({ userId: f.target.userId, active: false, statusVersion: 2, replayed: false });
  expect((await prisma.user.findUniqueOrThrow({ where: { id: f.target.userId } })).active).toBe(false);
  expect((await (await patch(f.target.userId, request)).json()).data.replayed).toBe(true);
});
it.each(["revoked", "suspended", "version"] as const)("rechecks actual %s ADMIN identity despite a stale framework adapter", async change => {
  const f = await setup();
  if (change === "revoked") await prisma.authSession.update({ where: { id: f.sessionId }, data: { revokedAt: new Date() } });
  if (change === "suspended") await prisma.user.update({ where: { id: f.target.reviewerId }, data: { active: false } });
  if (change === "version") await prisma.user.update({ where: { id: f.target.reviewerId }, data: { sessionVersion: 2 } });
  await failure(await invokeList(list()), 401, "UNAUTHENTICATED");
  await failure(await patch(f.target.userId, input()), 401, "UNAUTHENTICATED");
  expect(await prisma.adminCommand.count({ where: { actorUserId: f.target.reviewerId } })).toBe(0);
});
