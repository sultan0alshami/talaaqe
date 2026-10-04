import { randomBytes } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { Session } from "@/lib/jwt";
import { GET } from "@/app/api/admin/campaigns/route";
import { GET as legacyGET } from "@/app/api/admin/projects/route";
import { AdminCampaignsSchema } from "@/lib/admin/contracts";
import { cleanup, fixture } from "../deals/fixtures";

let session: Session | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
afterEach(async () => { session = null; await cleanup(); });
const list = (query = "") => GET(new Request(`${process.env.APP_ORIGIN}/api/admin/campaigns${query}`));
async function setup(role: "ADMIN" | "BRAND" = "ADMIN") {
  const f = await fixture(2, "10001", { now: new Date(), target: "test" });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: role === "ADMIN" ? f.target.reviewerId : f.brandUserId } });
  const sessionId = randomBytes(32).toString("base64url");
  await prisma.authSession.create({ data: { id: sessionId, userId: user.id, version: user.sessionVersion, expiresAt: new Date(Date.now() + 60000) } });
  session = { userId: user.id, role: user.role, name: user.name, email: user.email, sessionId, sessionVersion: user.sessionVersion };
  return { ...f, sessionId, actorId: user.id };
}
async function failure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
  expect(await response.json()).toMatchObject({ error: { code } });
}
it("denies anonymous and genuine wrong roles before query parsing or private reads", async () => {
  await failure(await list("?unexpected=1"), 401, "UNAUTHENTICATED");
  await setup("BRAND");
  await failure(await list("?unexpected=1"), 403, "FORBIDDEN");
});
it("loads private canonical campaign metadata while the legacy Projects API stays retired", async () => {
  const f = await setup();
  const response = await list();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const body = await response.json();
  expect(AdminCampaignsSchema.safeParse(body.data).success).toBe(true);
  const row = body.data.campaigns.find((value: { id: string }) => value.id === f.campaign.id);
  expect(row).toMatchObject({ brandName: "شركة اختبار أصلية", budget: { amountMinor: "10001", currencyCode: "KWD" }, budgetSource: "SAVED_INPUT" });
  expect(JSON.stringify(body).includes(session!.sessionId)).toBe(false);
  expect(JSON.stringify(body).includes(session!.email)).toBe(false);
  const retired = await (legacyGET as unknown as (request: Request) => Promise<Response>)(new Request(`${process.env.APP_ORIGIN}/api/admin/projects`));
  expect(retired.status).toBe(410);
});
it("rejects duplicated, unsupported and control-character cursors with domain validation", async () => {
  await setup();
  for (const query of ["?after=a&after=b", "?limit=100", "?after=a%0Ab", "?after=", "?after=okay&invented=1"]) await failure(await list(query), 422, "VALIDATION");
});
it.each(["revoked", "suspended", "version"] as const)("rechecks actual %s administrator despite a stale framework adapter", async change => {
  const f = await setup();
  if (change === "revoked") await prisma.authSession.update({ where: { id: f.sessionId }, data: { revokedAt: new Date() } });
  if (change === "suspended") await prisma.user.update({ where: { id: f.actorId }, data: { active: false } });
  if (change === "version") await prisma.user.update({ where: { id: f.actorId }, data: { sessionVersion: { increment: 1 } } });
  await failure(await list(), 401, "UNAUTHENTICATED");
  expect(await prisma.adminAudit.count({ where: { actorUserId: f.actorId, action: "admin.campaigns_accessed" } })).toBe(0);
});
