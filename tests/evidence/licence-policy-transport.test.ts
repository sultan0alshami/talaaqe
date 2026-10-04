import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { Session } from "@/lib/jwt";
import { loadLicencePolicyOptions } from "@/lib/evidence/transport";
import { GET } from "@/app/api/evidence/licences/[id]/policies/route";
import { submitAdvertisingLicence, uploadPrivateAsset } from "@/lib/evidence/service";
import { cleanup, fixture, png, user } from "./fixtures";

let currentSession: Session | null = null;
const policies: string[] = [];
vi.mock("@/lib/auth", () => ({ getSession: async () => currentSession }));
afterEach(async () => {
  currentSession = null;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await prisma.policyVersion.deleteMany({ where: { id: { in: policies.splice(0) } } });
  await cleanup();
});
async function authenticated(userId: string) {
  const account = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const sessionId = randomBytes(32).toString("base64url");
  await prisma.authSession.create({ data: { id: sessionId, userId, version: account.sessionVersion,
    expiresAt: new Date(Date.now() + 60_000) } });
  currentSession = { userId, role: account.role, name: account.name, email: account.email, sessionId, sessionVersion: account.sessionVersion };
  vi.stubEnv("EVIDENCE_STORAGE_MODE", "local");
  return sessionId;
}
function request(id: string, query = "") {
  return new Request(`${process.env.APP_ORIGIN}/api/evidence/licences/${encodeURIComponent(id)}/policies${query ? "?" + query : ""}`);
}
function context(id: string) { return { params: Promise.resolve({ id }) }; }
function assertPrivateResponse(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
}
async function assertError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  assertPrivateResponse(response);
  expect(await response.json()).toMatchObject({ error: { code, requestId: response.headers.get("x-request-id") } });
}
async function submittedLicence() {
  const f = await fixture();
  // HTTP uses the real current clock. Domain fixture dates must precede that
  // clock rather than the historical/fixed clock used by other domain tests.
  const submittedAt = new Date(Date.now() - 60_000), options = { ...f.options, now: submittedAt };
  const proof = (await uploadPrivateAsset(f.owner, { operationKey: randomUUID(), purpose: "ADVERTISING_LICENCE",
    contentType: "image/png", bytes: png }, options)).asset;
  const licence = (await submitAdvertisingLicence(f.owner, { operationKey: randomUUID(), creatorId: f.creator.id,
    jurisdiction: "KW", issuer: "Synthetic transport fixture issuer", holderName: "Synthetic private holder",
    licenceNumber: "PRIVATE-TRANSPORT-LICENCE-NUMBER", type: "Synthetic licence", scope: "Synthetic private account scope",
    accountBindings: [{ accountId: f.account.id, mappingRevision: f.account.mappingRevision }], platformScope: ["INSTAGRAM"],
    evidenceAssetId: proof.id, validFrom: new Date(submittedAt.getTime() - 86_400_000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString() }, options)).licence;
  return { ...f, options, submittedAt, proof, licence };
}
async function prepared() {
  const f = await submittedLicence();
  const policyProof = (await uploadPrivateAsset(f.admin, { operationKey: randomUUID(), purpose: "LEGAL_POLICY_REVIEW",
    contentType: "image/png", bytes: png }, f.options)).asset;
  const reference = "مرجع اختبار أصلي <b>محلي فقط</b>\nSynthetic fixture; no live legal approval.";
  const businessKey = "synthetic-transport-business-policy-key";
  const id = randomUUID(); policies.push(id);
  const policy = await prisma.policyVersion.create({ data: { id, kind: "MARKET", status: "VERIFIED", countryCodes: ["KW"],
    evidenceAssetId: policyProof.id, reviewedBy: f.admin, createdAt: f.submittedAt,
    reviewedAt: new Date(f.submittedAt.getTime() + 1000), expiresAt: new Date(Date.now() + 3_600_000),
    content: { schemaVersion: 1, kind: "MARKET", marketCountryCode: "KW", brandCountryCodes: ["KW"], creatorCountryCodes: ["KW"],
      licenceRequired: true, licencePolicyId: businessKey, reviewReference: reference, reviewedBasis: "FOUNDER_APPROVED_LEGAL_REVIEW" } } });
  return { ...f, policy, policyProof, reference, businessKey };
}

describe("private licence-policy options HTTP boundary", () => {
  it("denies anonymous requests before inspecting missing resources or invalid queries", async () => {
    const id = "missing-anonymous-licence", lookup = vi.spyOn(prisma.advertisingLicence, "findUnique");
    await assertError(await GET(request(id, "unknown=1"), context(id)), 401, "UNAUTHENTICATED");
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each(["CREATOR", "BRAND"] as const)("denies a current %s before a missing-resource lookup or query validation", async role => {
    await authenticated(await user(role));
    const id = "missing-nonadmin-licence", lookup = vi.spyOn(prisma.advertisingLicence, "findUnique");
    await assertError(await loadLicencePolicyOptions(request(id, "unknown=1"), context(id)), 403, "FORBIDDEN");
    expect(lookup).not.toHaveBeenCalled();
  });

  it("returns the actual scoped MARKET row ID and original reference through the thin GET with no private proof data", async () => {
    const f = await prepared(); await authenticated(f.admin);
    const response = await GET(request(f.licence.id), context(f.licence.id));
    expect(response.status).toBe(200); assertPrivateResponse(response);
    const body = await response.json();
    expect(body).toEqual({ data: { licenceId: f.licence.id, jurisdiction: "KW", creatorCountryCode: "KW", nextCursor: null,
      options: [{ id: f.policy.id, licencePolicyId: f.businessKey, marketCountryCode: "KW", reviewReference: f.reference,
        reviewedAt: f.policy.reviewedAt!.toISOString(), expiresAt: f.policy.expiresAt!.toISOString() }] },
      requestId: response.headers.get("x-request-id") });
    expect(f.policy.id).not.toBe(f.businessKey);
    const serialized = JSON.stringify(body);
    for (const privateKey of ["evidenceAssetId", "storageKey", "payloadHash", "operationKey", "resultJson", "sessionId", "sessionVersion", "licenceNumber", "holderName"]) {
      expect(serialized).not.toContain(`"${privateKey}"`);
    }
    for (const privateValue of [f.proof.id, f.policyProof.id, "PRIVATE-TRANSPORT-LICENCE-NUMBER", "Synthetic private holder"]) expect(serialized).not.toContain(privateValue);
    expect(await prisma.adminAudit.count({ where: { actorUserId: f.admin, resourceId: f.licence.id, action: "evidence.licence_policy_options_accessed" } })).toBe(1);
  });

  it.each([1, 50])("accepts the valid integer limit boundary %i", async limit => {
    const f = await prepared(); await authenticated(f.admin);
    const response = await loadLicencePolicyOptions(request(f.licence.id, `limit=${limit}`), context(f.licence.id));
    expect(response.status).toBe(200); assertPrivateResponse(response);
    expect(await response.json()).toMatchObject({ data: { options: [{ id: f.policy.id }], nextCursor: null } });
  });

  it.each([
    ["unknown query key", "unknown=1"],
    ["duplicate limit", "limit=1&limit=1"],
    ["duplicate cursor", "cursor=a&cursor=a"],
    ["empty cursor", "cursor="],
    ["cursor containing spaces", "cursor=bad%20cursor"],
    ["control-character cursor", "cursor=%00"],
    ["oversized cursor", `cursor=${"x".repeat(201)}`],
    ["zero limit", "limit=0"],
    ["negative limit", "limit=-1"],
    ["excessive limit", "limit=51"],
    ["fractional limit", "limit=1.5"],
    ["exponent limit", "limit=1e1"],
    ["empty limit", "limit="],
  ] as const)("rejects %s strictly without a policy-access audit", async (_label, query) => {
    const f = await submittedLicence(); await authenticated(f.admin);
    await assertError(await loadLicencePolicyOptions(request(f.licence.id, query), context(f.licence.id)), 422, "VALIDATION");
    expect(await prisma.adminAudit.count({ where: { actorUserId: f.admin, action: "evidence.licence_policy_options_accessed" } })).toBe(0);
  });

  it("rechecks a revoked actual admin session despite stale authenticated adapter context", async () => {
    const f = await prepared(), sessionId = await authenticated(f.admin);
    await prisma.authSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    await assertError(await loadLicencePolicyOptions(request(f.licence.id), context(f.licence.id)), 401, "UNAUTHENTICATED");
    expect(await prisma.adminAudit.count({ where: { actorUserId: f.admin, action: "evidence.licence_policy_options_accessed" } })).toBe(0);
  });

  it("rejects a remapped licence account rather than listing policies for its previous identity", async () => {
    const f = await prepared(); await authenticated(f.admin);
    await prisma.socialAccount.update({ where: { id: f.account.id }, data: { mappingRevision: { increment: 1 }, handle: "changed_transport_identity" } });
    await assertError(await loadLicencePolicyOptions(request(f.licence.id), context(f.licence.id)), 409, "STALE_IDENTITY");
    expect(await prisma.adminAudit.count({ where: { actorUserId: f.admin, action: "evidence.licence_policy_options_accessed" } })).toBe(0);
  });

  it("returns a private 404 for an active admin's missing licence", async () => {
    const f = await fixture(); await authenticated(f.admin);
    const id = randomUUID();
    await assertError(await loadLicencePolicyOptions(request(id), context(id)), 404, "NOT_FOUND");
    expect(await prisma.adminAudit.count({ where: { actorUserId: f.admin, action: "evidence.licence_policy_options_accessed" } })).toBe(0);
  });
});
