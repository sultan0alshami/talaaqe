import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createOwnershipChallenge, submitOwnershipProof, reviewOwnershipProof, uploadPrivateAsset, getPrivateAsset, submitMetricsScreenshot, reviewMetricsScreenshot, approveMetricsSnapshot, submitFactCorrection, approveFactCorrection, submitAdvertisingLicence, reviewAdvertisingLicence, submitBusinessVerification, reviewBusinessVerification } from "@/lib/evidence/service";
import { cleanup, fixture, png, now, options, user } from "./fixtures";
afterEach(cleanup);
const key = () => randomUUID();
const note = { text: "مراجعة اختبار مستقلة", language: "ar" };
async function asset(owner: string, purpose: string, opts: Awaited<ReturnType<typeof options>>) {
  return (await uploadPrivateAsset(owner, { operationKey: key(), purpose, contentType: "image/png", bytes: png }, opts)).asset;
}
async function submitted() {
  const f = await fixture(), proof = await asset(f.owner, "OWNERSHIP_PROOF", f.options);
  const started = await createOwnershipChallenge(f.owner, { operationKey: key(), accountId: f.account.id, expectedMappingRevision: 1, expectedEvidenceRevision: 1 }, f.options);
  const result = await submitOwnershipProof(f.owner, started.challenge.id, { operationKey: key(), expectedRevision: 1, assetId: proof.id }, f.options);
  return { ...f, challenge: result.challenge, proof };
}
describe("private evidence and exact-scope review", () => {
  it("persists actual bytes, replays once, denies outsiders and never exposes storage keys", async () => {
    const f = await fixture(), input = { operationKey: key(), purpose: "OWNERSHIP_PROOF", contentType: "image/png", bytes: png };
    const first = await uploadPrivateAsset(f.owner, input, f.options), retry = await uploadPrivateAsset(f.owner, input, f.options);
    expect(retry).toMatchObject({ replayed: true, asset: { id: first.asset.id } }); expect(first.asset).not.toHaveProperty("storageKey");
    const downloaded = await getPrivateAsset(f.owner, first.asset.id, f.options);
    expect(Buffer.from(downloaded.bytes)).toEqual(png);
    expect(downloaded.headers).toMatchObject({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    expect(downloaded.headers["Content-Disposition"]).toMatch(/^attachment;/);
    await expect(getPrivateAsset(f.outsider, first.asset.id, f.options)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(uploadPrivateAsset(f.owner, { ...input, purpose: "SCREENSHOT" }, f.options)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await prisma.user.update({ where: { id: f.owner }, data: { active: false } });
    await expect(getPrivateAsset(f.owner, first.asset.id, f.options)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("requires byte presence/checksum before ownership acceptance, even with a valid metadata row", async () => {
    const f = await submitted();
    const row = await prisma.privateAsset.findUniqueOrThrow({ where: { id: f.proof.id } });
    await f.options.storage.remove(row.storageKey.replace(/^local:/, ""));
    await expect(reviewOwnershipProof(f.admin, f.challenge.id, { operationKey: key(), expectedRevision: 2, decision: "VERIFIED", observedChallengeCode: f.challenge.challengeCode, note }, f.options)).rejects.toMatchObject({ code: "ASSET_BYTES_UNAVAILABLE" });
    expect((await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } })).ownershipStatus).toBe("PENDING");
  });
  it("binds proof to stable provider identity and mapping revision, never to a handle alone", async () => {
    const f = await submitted();
    await prisma.socialAccount.update({ where: { id: f.account.id }, data: { providerAccountId: "changed-synthetic-provider", mappingRevision: 2 } });
    await expect(reviewOwnershipProof(f.admin, f.challenge.id, { operationKey: key(), expectedRevision: 2, decision: "VERIFIED", observedChallengeCode: f.challenge.challengeCode, note }, f.options)).rejects.toMatchObject({ code: "STALE_IDENTITY" });
    await expect(createOwnershipChallenge(f.outsider, { operationKey: key(), accountId: f.account.id, expectedMappingRevision: 2, expectedEvidenceRevision: 1 }, f.options)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("serializes competing reviews; a nonadmin cannot confer trust; acceptance has audit and outbox", async () => {
    const f = await submitted(), input = { operationKey: key(), expectedRevision: 2, decision: "VERIFIED", observedChallengeCode: f.challenge.challengeCode, note };
    await expect(reviewOwnershipProof(f.outsider, f.challenge.id, input, f.options)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const a = new PrismaClient(), b = new PrismaClient();
    try {
      const results = await Promise.allSettled([reviewOwnershipProof(f.admin, f.challenge.id, input, { ...f.options, client: a }),
        reviewOwnershipProof(f.admin, f.challenge.id, { ...input, operationKey: key(), decision: "REJECTED" }, { ...f.options, client: b })]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "STALE_VERSION" } });
      expect(await prisma.adminAudit.count({ where: { actorUserId: f.admin, resourceId: f.challenge.id } })).toBe(1);
      expect(await prisma.outboxEvent.count({ where: { type: "ownership.reviewed", payload: { path: ["actorUserId"], equals: f.admin } } })).toBe(1);
    } finally { await a.$disconnect(); await b.$disconnect(); }
  });
  it("waits behind an administrator suspension and rejects the review after it commits", async () => {
    const f = await submitted(), held = new PrismaClient(), reviewing = new PrismaClient();
    let release!: () => void, ready!: () => void;
    const locked = new Promise<void>(r => { ready = r; }), unblock = new Promise<void>(r => { release = r; });
    try {
      const suspension = held.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql(["SELECT id FROM \"User\" WHERE id=", " FOR UPDATE"], f.admin));
        await tx.user.update({ where: { id: f.admin }, data: { active: false } }); ready(); await unblock;
      });
      await locked;
      const review = reviewOwnershipProof(f.admin, f.challenge.id, { operationKey: key(), expectedRevision: 2, decision: "VERIFIED", observedChallengeCode: f.challenge.challengeCode, note }, { ...f.options, client: reviewing });
      const assertion = expect(review).rejects.toMatchObject({ code: "FORBIDDEN" }); release(); await suspension; await assertion;
    } finally { release(); await held.$disconnect(); await reviewing.$disconnect(); }
  });
  it("keeps screenshot claims SELF_REPORTED until review creates a separate immutable observation", async () => {
    const f = await fixture(), proof = await asset(f.owner, "SCREENSHOT", f.options), observedAt = new Date(now.getTime() - 86_400_000).toISOString();
    const submitted = await submitMetricsScreenshot(f.owner, { operationKey: key(), accountId: f.account.id, expectedMappingRevision: 1, expectedEvidenceRevision: 1, evidenceAssetId: proof.id, observedAt, followers: "1200" }, f.options);
    const original = await prisma.metricsSnapshot.findUniqueOrThrow({ where: { id: submitted.snapshot.id } });
    expect(original.source).toBe("SELF_REPORTED"); expect(original.approvedAt).toBeNull();
    await expect(reviewMetricsScreenshot(f.outsider, original.id, { operationKey: key(), expectedEvidenceRevision: 2, decision: "VERIFIED", note }, f.options)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const reviewed = await reviewMetricsScreenshot(f.admin, original.id, { operationKey: key(), expectedEvidenceRevision: 2, decision: "VERIFIED", note }, f.options);
    expect(reviewed.snapshot).toMatchObject({ source: "SCREENSHOT_VERIFIED", supersedesId: original.id, observedAt, followers: "1200" });
    expect((await prisma.metricsSnapshot.findUniqueOrThrow({ where: { id: original.id } })).source).toBe("SELF_REPORTED");
    expect(await prisma.metricsSnapshot.count({ where: { accountId: f.account.id } })).toBe(2);
    await expect(prisma.metricsSnapshot.update({ where: { id: reviewed.snapshot.id }, data: { followers: BigInt(999) } })).rejects.toThrow();
  });
  it("requires explicit granular correction approval without changing source observations", async () => {
    const f = await fixture();
    const proposed = await submitFactCorrection(f.owner, { operationKey: key(), accountId: f.account.id, expectedMappingRevision: 1, expectedEvidenceRevision: 1, field: "followers", value: 999, evidenceAt: now.toISOString() }, f.options);
    expect(proposed.correction).toMatchObject({ source: "SELF_REPORTED", approvedAt: null, visibility: "PRIVATE" });
    const approved = await approveFactCorrection(f.owner, proposed.correction.id, { operationKey: key(), expectedRevision: 1, expectedMappingRevision: 1, visibility: "BRAND_ONLY" }, f.options);
    expect(approved.correction).toMatchObject({ source: "SELF_REPORTED", visibility: "BRAND_ONLY", approvedAt: now.toISOString() });
    const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    expect(account.fieldVisibility).toMatchObject({ followers: "BRAND_ONLY" });
    expect(await prisma.metricsSnapshot.count({ where: { accountId: f.account.id } })).toBe(0);
    await expect(submitFactCorrection(f.owner, { operationKey: key(), accountId: f.account.id, expectedMappingRevision: 1, expectedEvidenceRevision: account.evidenceRevision, field: "followers", value: 888, evidenceAt: now.toISOString(), source: "API" }, f.options)).rejects.toMatchObject({ code: "INVALID_COMMAND" });
  });
  it("keeps representative and registration proofs separate and reviews only owned, usable evidence", async () => {
    const brandOwner = await user("BRAND"), admin = await user("ADMIN"), opts = await options();
    const brand = await prisma.brand.create({ data: { userId: brandOwner, name: "شركة اختبار", slug: "proof-" + brandOwner.slice(0, 8), countryCode: "KW" } });
    const proof = await asset(brandOwner, "REPRESENTATIVE", opts);
    const representation = await submitBusinessVerification(brandOwner, { operationKey: key(), brandId: brand.id, kind: "REPRESENTATIVE", jurisdiction: "KW", identifier: "original-authority", evidenceAssetId: proof.id }, opts);
    await expect(submitBusinessVerification(brandOwner, { operationKey: key(), brandId: brand.id, kind: "BUSINESS_REGISTRATION", jurisdiction: "KW", identifier: "original-cr", evidenceAssetId: proof.id }, opts)).rejects.toMatchObject({ code: "INVALID_EVIDENCE" });
    await reviewBusinessVerification(admin, representation.verification.id, { operationKey: key(), expectedRevision: 1, decision: "VERIFIED", note }, opts);
    expect(await prisma.businessVerification.count({ where: { brandId: brand.id, kind: "REPRESENTATIVE", status: "VERIFIED" } })).toBe(1);
    expect(await prisma.businessVerification.count({ where: { brandId: brand.id, kind: "BUSINESS_REGISTRATION" } })).toBe(0);
  });
  it("binds licence scope to owned accounts and blocks approval without a reviewed jurisdiction policy", async () => {
    const f = await fixture(), proof = await asset(f.owner, "ADVERTISING_LICENCE", f.options);
    const input = { operationKey: key(), creatorId: f.creator.id, jurisdiction: "KW", issuer: "مصدر اختبار", holderName: "صاحب اختبار", licenceNumber: "SYNTHETIC-ONLY", type: "اختبار", scope: "حساب واحد", accountBindings: [{ accountId: f.account.id, mappingRevision: 1 }], platformScope: ["INSTAGRAM"], evidenceAssetId: proof.id, validFrom: now.toISOString(), expiresAt: "2026-12-01T00:00:00.000Z" };
    const licence = await submitAdvertisingLicence(f.owner, input, f.options);
    await expect(reviewAdvertisingLicence(f.admin, licence.licence.id, { operationKey: key(), expectedRevision: 1, decision: "VERIFIED", policyVersionId: "not-reviewed", note }, f.options)).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE" });
    await prisma.socialAccount.update({ where: { id: f.account.id }, data: { providerAccountId: "changed-provider", mappingRevision: 2 } });
    await expect(reviewAdvertisingLicence(f.admin, licence.licence.id, { operationKey: key(), expectedRevision: 1, decision: "VERIFIED", policyVersionId: "not-reviewed", note }, f.options)).rejects.toMatchObject({ code: "STALE_IDENTITY" });
    expect((await prisma.advertisingLicence.findUniqueOrThrow({ where: { id: licence.licence.id } })).status).toBe("PENDING");
  });
  it("requires byte checksum integrity on every private download, not only at upload", async () => {
    const f = await fixture(), proof = await asset(f.owner, "OWNERSHIP_PROOF", f.options);
    const corrupt = { ...f.options.storage, get: async () => Buffer.concat([png, Buffer.from("changed")]) };
    await expect(getPrivateAsset(f.owner, proof.id, { ...f.options, storage: corrupt })).rejects.toMatchObject({ code: "ASSET_BYTES_UNAVAILABLE" });
    expect(await prisma.adminAudit.count({ where: { action: "evidence.accessed", resourceId: proof.id } })).toBe(0);
  });
  it("retains unknown demographic residual and needs explicit per-field owner approval before sharing", async () => {
    const f = await fixture(), proof = await asset(f.owner, "SCREENSHOT", f.options);
    const input = { operationKey: key(), accountId: f.account.id, expectedMappingRevision: 1, expectedEvidenceRevision: 1, evidenceAssetId: proof.id,
      observedAt: now.toISOString(), followers: "1000", demographics: { age: { value: [{ key: "25-34", percent: 40 }] } } };
    const proposed = await submitMetricsScreenshot(f.owner, input, f.options);
    const pendingAccount = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    expect(pendingAccount.fieldVisibility).toMatchObject({ followers: "PRIVATE", "demographics.age": "PRIVATE" });
    const reviewed = await reviewMetricsScreenshot(f.admin, proposed.snapshot.id, { operationKey: key(), expectedEvidenceRevision: 2, decision: "VERIFIED", note }, f.options);
    await approveMetricsSnapshot(f.owner, reviewed.snapshot.id, { operationKey: key(), expectedMappingRevision: 1, expectedEvidenceRevision: 3, visibility: { followers: "BRAND_ONLY" } }, f.options);
    const approvedAccount = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    expect(approvedAccount.fieldVisibility).toMatchObject({ followers: "BRAND_ONLY", "demographics.age": "PRIVATE" });
    const observation = await prisma.metricsSnapshot.findUniqueOrThrow({ where: { id: reviewed.snapshot.id } });
    expect(observation.demographics).toMatchObject({ age: { value: [{ key: "25-34", percent: 40 }] } });
    expect(observation.approvedBy).toBe(f.admin);
    await expect(approveMetricsSnapshot(f.outsider, observation.id, { operationKey: key(), expectedMappingRevision: 1, expectedEvidenceRevision: 4, visibility: { followers: "PUBLIC" } }, f.options)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("verifies an exact licence against actual reviewed private policy bytes, then revokes without rewriting scope", async () => {
    const f = await fixture(), proof = await asset(f.owner, "ADVERTISING_LICENCE", f.options), policyProof = await asset(f.admin, "LEGAL_POLICY_REVIEW", f.options);
    const policyId = "evidence-policy-" + key(), prior = new Date(now.getTime() - 1000);
    try {
      await prisma.policyVersion.create({ data: { id: policyId, kind: "MARKET", status: "VERIFIED", countryCodes: ["KW"], evidenceAssetId: policyProof.id, reviewedBy: f.admin,
        createdAt: prior, reviewedAt: now, content: { schemaVersion: 1, kind: "MARKET", marketCountryCode: "KW", brandCountryCodes: ["KW"], creatorCountryCodes: ["KW"],
          licenceRequired: true, licencePolicyId: "synthetic-private-evidence-licence", reviewedBasis: "FOUNDER_APPROVED_LEGAL_REVIEW", reviewReference: "Synthetic test only; not a live legal approval" } } });
      const licence = await submitAdvertisingLicence(f.owner, { operationKey: key(), creatorId: f.creator.id, jurisdiction: "KW", issuer: "مصدر اختبار",
        holderName: "صاحب اختبار", licenceNumber: "SYNTHETIC", type: "اختبار", scope: "حساب واحد", accountBindings: [{ accountId: f.account.id, mappingRevision: 1 }],
        platformScope: ["INSTAGRAM"], evidenceAssetId: proof.id, validFrom: prior.toISOString(), expiresAt: "2026-12-01T00:00:00.000Z" }, f.options);
      const reviewed = await reviewAdvertisingLicence(f.admin, licence.licence.id, { operationKey: key(), expectedRevision: 1, decision: "VERIFIED", policyVersionId: policyId, note }, f.options);
      expect(reviewed.licence).toMatchObject({ status: "VERIFIED", revision: 2, policyVersion: "synthetic-private-evidence-licence", reviewMethod: "MANUAL_REVIEW" });
      const revoked = await reviewAdvertisingLicence(f.admin, licence.licence.id, { operationKey: key(), expectedRevision: 2, decision: "REVOKED", note }, f.options);
      expect(revoked.licence).toMatchObject({ status: "REVOKED", revision: 3, accountIds: [f.account.id] });
    } finally { await prisma.policyVersion.deleteMany({ where: { id: policyId } }); }
  });
  it("allows a self-reported screenshot to be explicitly approved without manufacturing a screenshot badge", async () => {
    const f = await fixture(), proof = await asset(f.owner, "SCREENSHOT", f.options);
    const proposed = await submitMetricsScreenshot(f.owner, { operationKey: key(), accountId: f.account.id, expectedMappingRevision: 1, expectedEvidenceRevision: 1, evidenceAssetId: proof.id, observedAt: now.toISOString(), followers: "999" }, f.options);
    const approved = await approveMetricsSnapshot(f.owner, proposed.snapshot.id, { operationKey: key(), expectedMappingRevision: 1, expectedEvidenceRevision: 2, visibility: { followers: "PUBLIC" } }, f.options);
    expect(approved.snapshot).toMatchObject({ source: "SELF_REPORTED", approvedAt: now.toISOString() });
    const reviewed = await reviewMetricsScreenshot(f.admin, proposed.snapshot.id, { operationKey: key(), expectedEvidenceRevision: 3, decision: "VERIFIED", note }, f.options);
    expect(reviewed.snapshot).toMatchObject({ source: "SCREENSHOT_VERIFIED", supersedesId: proposed.snapshot.id });
  });
});
