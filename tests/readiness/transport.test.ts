import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { SESSION_COOKIE } from "@/lib/jwt";
import { GET } from "@/app/api/readiness/publication/route";
import { PublicationReadinessSchema } from "@/lib/readiness/contracts";

// Only Next's request-cookie context is a seam. Actual signed tokens, current
// native sessions/roles, own-profile service and route are unmocked; all subjects
// are owned synthetic guarded data. No .test import or publication mutation.
let token: string | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => name === SESSION_COOKIE && token ? { name, value: token } : undefined }) }));
const users = new Set<string>(), creators = new Set<string>(), brands = new Set<string>();
afterEach(async () => {
  await prisma.creator.deleteMany({ where: { id: { in: [...creators] } } });
  await prisma.brand.deleteMany({ where: { id: { in: [...brands] } } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
  users.clear(); creators.clear(); brands.clear(); token = null;
});
async function actor(role: "CREATOR" | "BRAND" | "ADMIN", profile = true) {
  const id = randomUUID(), suffix = id.replace(/-/g, "").slice(0, 16); users.add(id);
  const user = await prisma.user.create({ data: { id, role, active: true, isTest: true, name: "Synthetic readiness transport", email: `${id}@example.invalid`,
    passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  let profileId: string | null = null;
  if (profile && role === "CREATOR") {
    const value = await prisma.creator.create({ data: { userId: id, handle: "wire_" + suffix, displayName: "Synthetic own creator", isTest: true } }); creators.add(value.id); profileId = value.id;
  } else if (profile && role === "BRAND") {
    const value = await prisma.brand.create({ data: { userId: id, slug: "wire-" + suffix, name: "Synthetic own company", isTest: true,
      profileFacts: { contactName: "synthetic private contact canary" } } }); brands.add(value.id); profileId = value.id;
  }
  token = await openSession(id, user.sessionVersion, user.passwordHash); const session = await resolveSession(token);
  if (!session) throw new Error("Synthetic native readiness session did not resolve");
  return { user, session, token, profileId };
}
function get(search = "") { return GET(new Request(`${process.env.APP_ORIGIN}/api/readiness/publication${search}`)); }
async function envelope(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
  const body = await response.json(); expect(body.requestId).toBe(response.headers.get("x-request-id")); return body;
}
async function failure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status); const body = await envelope(response);
  expect(Object.keys(body).sort()).toEqual(["error", "requestId"]);
  expect(body.error).toEqual({ code, message: code, requestId: body.requestId, retryable: status === 503 || status === 429 }); return body;
}

describe("publication readiness GET adapter: actual native self-profile sessions", () => {
  it("allows genuine CREATOR and BRAND roles and returns only own typed missing-draft metadata without creating or publishing", async () => {
    for (const role of ["CREATOR", "BRAND"] as const) {
      const f = await actor(role), response = await get(); expect(response.status).toBe(200);
      const result = PublicationReadinessSchema.parse((await envelope(response)).data);
      expect(result).toMatchObject({ scope: "OWN_PROFILE", role, profileId: f.profileId, draftId: null, draftRevision: null,
        status: "BLOCKED", blockerCode: "DRAFT_REQUIRED", requiresExplicitPublicationConsent: true });
      expect(result.remedies).toEqual([{ kind: "ONBOARDING", href: role === "CREATOR" ? "/creator/onboarding" : "/brand/onboarding", onboardingStep: 0 }]);
      for (const canary of [f.token, f.session.sessionId, f.user.email, "passwordHash", "synthetic private contact canary"]) expect(JSON.stringify(result)).not.toContain(canary);
      expect(await prisma.onboardingDraft.count({ where: { userId: f.user.id } })).toBe(0);
      const profile = role === "CREATOR" ? await prisma.creator.findUniqueOrThrow({ where: { id: f.profileId! } }) : await prisma.brand.findUniqueOrThrow({ where: { id: f.profileId! } });
      expect(profile.publicConsentAt).toBeNull(); expect(profile.state).toBe("DRAFT");
    }
  });

  it("checks anonymous/current signed roles and revocation/version/activity before malformed private query parsing", async () => {
    await failure(await get("?userId=private&portfolioVersion=NaN"), 401, "UNAUTHENTICATED");
    await actor("ADMIN"); await failure(await get("?userId=private&portfolioVersion=NaN"), 403, "FORBIDDEN");
    for (const change of ["revoke", "version", "inactive", "role"] as const) {
      const f = await actor("CREATOR");
      if (change === "revoke") await prisma.authSession.update({ where: { id: f.session.sessionId }, data: { revokedAt: new Date() } });
      if (change === "version") await prisma.user.update({ where: { id: f.user.id }, data: { sessionVersion: { increment: 1 } } });
      if (change === "inactive") await prisma.user.update({ where: { id: f.user.id }, data: { active: false } });
      if (change === "role") await prisma.user.update({ where: { id: f.user.id }, data: { role: "BRAND" } });
      await failure(await get("?visibleAccountIds=%7BnotJSON&userId=other"), 401, "UNAUTHENTICATED");
      expect(await prisma.adminAudit.count({ where: { actorUserId: f.user.id, action: "publication.readiness_accessed" } })).toBe(0);
    }
  });

  it("rejects duplicate/unknown flags, noncanonical numbers and malformed/duplicate/oversized selected-ID JSON", async () => {
    const f = await actor("CREATOR");
    for (const search of ["?portfolioVersion=1&portfolioVersion=2", "?visibleAccountIds=%5B%5D&visibleAccountIds=%5B%5D", "?role=BRAND", "?userId=other", "?draftId=private", "?limit=100"]) {
      await failure(await get(search), 422, "VALIDATION");
    }
    for (const number of ["0", "01", "%2B1", "1.0", "1e1", "%201", "-1", "NaN", "Infinity", "9007199254740992"]) await failure(await get(`?portfolioVersion=${number}`), 422, "VALIDATION");
    for (const value of ["notJSON", "{}", '"one-id"', "null", '["x","x"]', '[""]', '["invalid\\nidentity"]', JSON.stringify(Array.from({ length: 101 }, (_, i) => `synthetic-${i}`))]) {
      await failure(await get("?visibleAccountIds=" + encodeURIComponent(value)), 422, "VALIDATION");
    }
    expect(await prisma.adminAudit.count({ where: { actorUserId: f.user.id, action: "publication.readiness_accessed" } })).toBe(0);
  });

  it("accepts strict positive version and explicit empty selection without inventing another resource or upgrading publication consent", async () => {
    const f = await actor("CREATOR"), response = await get("?portfolioVersion=2147483648&visibleAccountIds=%5B%5D");
    expect(response.status).toBe(200); expect(PublicationReadinessSchema.parse((await envelope(response)).data)).toMatchObject({ profileId: f.profileId,
      status: "BLOCKED", blockerCode: "DRAFT_REQUIRED", requiresExplicitPublicationConsent: true });
    expect(await prisma.onboardingDraft.count({ where: { userId: f.user.id } })).toBe(0);
    const noProfile = await actor("BRAND", false); const body = await failure(await get(), 404, "NOT_FOUND");
    expect(JSON.stringify(body)).not.toContain(noProfile.user.email); expect(await prisma.brand.count({ where: { userId: noProfile.user.id } })).toBe(0);
  });
});
