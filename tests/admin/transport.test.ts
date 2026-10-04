import { randomBytes } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { Session } from "@/lib/jwt";
import { GET } from "@/app/api/admin/overview/route";
import { GET as retiredProvidersGET } from "@/app/api/admin/providers/route";
import { AdminOverviewSchema } from "@/lib/admin/contracts";
import { cleanup, fixture } from "../deals/fixtures";

let session: Session | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
afterEach(async () => { session = null; vi.restoreAllMocks(); await cleanup(); });
const request = (suffix = "") => new Request(`http://localhost:3100/api/admin/overview${suffix}`);
async function authenticate(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const sessionId = randomBytes(32).toString("base64url");
  await prisma.authSession.create({ data: { id: sessionId, userId, version: user.sessionVersion, expiresAt: new Date(Date.now() + 60000) } });
  session = { userId, role: user.role, name: user.name, email: user.email, sessionId, sessionVersion: user.sessionVersion };
  return sessionId;
}
async function failure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const id = response.headers.get("x-request-id");
  expect(id).toMatch(/^[a-f0-9-]{36}$/);
  expect(await response.json()).toMatchObject({ error: { code, requestId: id } });
}

it("denies anonymous and current non-admin actors before metadata queries or query parsing", async () => {
  const f = await fixture(2, "10001", { now: new Date(), target: "test" });
  const count = vi.spyOn(prisma.campaign, "count");
  await failure(await GET(request("?unsupported=1")), 401, "UNAUTHENTICATED");
  await authenticate(f.target.userId);
  await failure(await GET(request("?unsupported=1")), 403, "FORBIDDEN");
  await authenticate(f.brandUserId);
  await failure(await GET(request()), 403, "FORBIDDEN");
  expect(count).not.toHaveBeenCalled();
});

it("returns only the validated actual canonical metadata and keeps other legacy routes retired", async () => {
  const f = await fixture(2, "10001", { now: new Date(), target: "test" });
  await authenticate(f.target.reviewerId);
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const body = await response.json();
  expect(AdminOverviewSchema.safeParse(body.data).success).toBe(true);
  expect(body.requestId).toBe(response.headers.get("x-request-id"));
  expect(body.data.counts.campaigns).toBe(await prisma.campaign.count());
  expect(JSON.stringify(body).includes(session!.sessionId)).toBe(false);
  expect(JSON.stringify(body).includes(session!.email)).toBe(false);
  await failure(await GET(request("?limit=8")), 422, "VALIDATION");
  // The legacy wrapper inspects its actual runtime Request although the old
  // zero-argument callback inferred a zero-argument TypeScript signature.
  const retired = await (retiredProvidersGET as unknown as (request: Request) => Promise<Response>)(new Request("http://localhost:3100/api/admin/providers"));
  expect(retired.status).toBe(410);
});

it.each(["revoked", "suspended", "role", "version"] as const)("rechecks a stale framework session after actual %s invalidation", async change => {
  const f = await fixture(2, "10001", { now: new Date(), target: "test" });
  const sessionId = await authenticate(f.target.reviewerId);
  if (change === "revoked") await prisma.authSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
  if (change === "suspended") await prisma.user.update({ where: { id: f.target.reviewerId }, data: { active: false } });
  if (change === "role") await prisma.user.update({ where: { id: f.target.reviewerId }, data: { role: "BRAND" } });
  if (change === "version") await prisma.user.update({ where: { id: f.target.reviewerId }, data: { sessionVersion: 2 } });
  await failure(await GET(request()), 401, "UNAUTHENTICATED");
  expect(await prisma.adminAudit.count({ where: { actorUserId: f.target.reviewerId, action: "admin.overview_accessed" } })).toBe(0);
});
