import { randomBytes, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  approveMetricsSnapshot, getBrandEvidence, getCreatorEvidence, getPrivateAsset, listEvidenceReviewQueue,
  reviewMetricsScreenshot, submitAdvertisingLicence, submitBusinessVerification, submitMetricsScreenshot, uploadPrivateAsset,
} from "@/lib/evidence/service";
import { cleanup, fixture, now, options as fixtureOptions, png, user } from "./fixtures";

// Independent local-byte witnesses, not live social-provider or legal acceptance.
afterEach(cleanup);
const key = () => randomUUID();
const acceptedNote = { text: "راجعت لقطة الاختبار الأصلية فقط؛ لم أراجع أرقامًا أخرى.", language: "ar" };
const revokedNote = { text: "Withdraw this synthetic screenshot review; keep the original observation.", language: "en" };
const rejectedNote = { text: "اللقطة المصطنعة لا تدعم القياس المقترح.", language: "ar" };
const reviewTime = new Date(now.getTime() + 60_000);
const revokeTime = new Date(now.getTime() + 120_000);

async function submitted() {
  const f = await fixture();
  const proof = (await uploadPrivateAsset(f.owner, {
    operationKey: key(), purpose: "SCREENSHOT", contentType: "image/png", bytes: png,
  }, f.options)).asset;
  const observedAt = new Date(now.getTime() - 86_400_000).toISOString();
  const parent = (await submitMetricsScreenshot(f.owner, {
    operationKey: key(), accountId: f.account.id, expectedMappingRevision: f.account.mappingRevision,
    expectedEvidenceRevision: f.account.evidenceRevision, evidenceAssetId: proof.id, observedAt, followers: "1200",
  }, f.options)).snapshot;
  return { ...f, proof, observedAt, parent };
}
async function currentRevision(accountId: string) {
  return (await prisma.socialAccount.findUniqueOrThrow({ where: { id: accountId } })).evidenceRevision;
}
function dataFor(queue: Awaited<ReturnType<typeof listEvidenceReviewQueue>>, id: string) {
  const entry = queue.entries.find(row => row.id === id);
  expect(entry, `Review queue must contain screenshot ${id}`).toBeDefined();
  return entry!.data;
}
function projectedRevision(data: unknown) {
  expect(data).toHaveProperty("account.evidenceRevision");
  const revision = (data as { account: { evidenceRevision: unknown } }).account.evidenceRevision;
  expect(typeof revision).toBe("number");
  expect(Number.isSafeInteger(revision)).toBe(true);
  return revision as number;
}
function history(decision: "VERIFIED" | "REJECTED" | "REVOKED", note: typeof acceptedNote, reviewedAt: Date, reviewerId: string) {
  return { decision, note, reviewedAt: reviewedAt.toISOString(), reviewerId };
}
function assertPrivateProjection(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const key of ["storageKey", "payloadHash", "operationKey", "resultJson", "identityHash", "sessionId", "sessionVersion"]) {
    expect(serialized).not.toContain(`"${key}"`);
  }
}

describe("private screenshot review projections", () => {
  it("exposes the current account revision after a later submission and uses it for the original review", async () => {
    const f = await submitted();
    await submitMetricsScreenshot(f.owner, {
      operationKey: key(), accountId: f.account.id, expectedMappingRevision: f.account.mappingRevision,
      expectedEvidenceRevision: await currentRevision(f.account.id), evidenceAssetId: f.proof.id,
      observedAt: f.observedAt, followers: "1300",
    }, f.options);
    const revision = await currentRevision(f.account.id);
    expect(revision).toBe(3);
    const queue = await listEvidenceReviewQueue(f.admin, { kind: "SCREENSHOT", status: "PENDING", limit: 50 }, f.options);
    const data = dataFor(queue, f.parent.id);
    expect(data).toMatchObject({
      id: f.parent.id, source: "SELF_REPORTED", observedAt: f.observedAt, importedAt: now.toISOString(),
      excludedAt: null, approvedBy: null, reviewHistory: [],
      account: { id: f.account.id, creatorId: f.creator.id, platform: "INSTAGRAM", handle: f.account.handle,
        mappingRevision: f.account.mappingRevision, evidenceRevision: revision },
    });
    assertPrivateProjection(queue);
    const reviewed = await reviewMetricsScreenshot(f.admin, f.parent.id, {
      operationKey: key(), expectedEvidenceRevision: projectedRevision(data), decision: "VERIFIED", note: acceptedNote,
    }, { ...f.options, now: reviewTime });
    expect(reviewed.snapshot).toMatchObject({ source: "SCREENSHOT_VERIFIED", supersedesId: f.parent.id, followers: "1200" });
    expect(await currentRevision(f.account.id)).toBe(revision + 1);
  });

  it("gives the owner original source dates and explicit unreviewed history without leaking command receipts", async () => {
    const f = await submitted();
    const mine = await getCreatorEvidence(f.owner, f.creator.id, f.options);
    expect(mine.snapshots).toEqual([expect.objectContaining({
      id: f.parent.id, source: "SELF_REPORTED", observedAt: f.observedAt, importedAt: now.toISOString(),
      excludedAt: null, approvedAt: null, approvedBy: null, reviewHistory: [], followers: "1200", averageViews: null,
    })]);
    expect(mine.accounts).toEqual([expect.objectContaining({ id: f.account.id, evidenceRevision: 2 })]);
    assertPrivateProjection(mine);
  });

  it("keeps original and verified child history reachable, then exposes the original revocation note", async () => {
    const f = await submitted();
    const child = (await reviewMetricsScreenshot(f.admin, f.parent.id, {
      operationKey: key(), expectedEvidenceRevision: await currentRevision(f.account.id), decision: "VERIFIED", note: acceptedNote,
    }, { ...f.options, now: reviewTime })).snapshot;
    const verified = await listEvidenceReviewQueue(f.admin, { kind: "SCREENSHOT", status: "VERIFIED", limit: 50 }, { ...f.options, now: reviewTime });
    const originalData = dataFor(verified, f.parent.id), childData = dataFor(verified, child.id);
    expect(originalData).toMatchObject({ source: "SELF_REPORTED", observedAt: f.observedAt, importedAt: now.toISOString(),
      excludedAt: reviewTime.toISOString(), reviewHistory: [history("VERIFIED", acceptedNote, reviewTime, f.admin)] });
    expect(childData).toMatchObject({ source: "SCREENSHOT_VERIFIED", supersedesId: f.parent.id, observedAt: f.observedAt,
      importedAt: reviewTime.toISOString(), excludedAt: null, approvedBy: f.admin,
      reviewHistory: [history("VERIFIED", acceptedNote, reviewTime, f.admin)] });
    expect(projectedRevision(childData)).toBe(3);
    await reviewMetricsScreenshot(f.admin, child.id, {
      operationKey: key(), expectedEvidenceRevision: projectedRevision(childData), decision: "REVOKED", note: revokedNote,
    }, { ...f.options, now: revokeTime });
    const revoked = await listEvidenceReviewQueue(f.admin, { kind: "SCREENSHOT", status: "REVOKED", limit: 50 }, { ...f.options, now: revokeTime });
    const revokedData = dataFor(revoked, child.id);
    expect(revokedData).toMatchObject({ source: "SCREENSHOT_VERIFIED", reviewStatus: "REVOKED", supersedesId: f.parent.id,
      observedAt: f.observedAt, importedAt: reviewTime.toISOString(), approvedAt: reviewTime.toISOString(),
      approvedBy: f.admin, excludedAt: revokeTime.toISOString(),
      reviewHistory: [history("VERIFIED", acceptedNote, reviewTime, f.admin), history("REVOKED", revokedNote, revokeTime, f.admin)] });
    expect(projectedRevision(revokedData)).toBe(4);
    const mine = await getCreatorEvidence(f.owner, f.creator.id, { ...f.options, now: revokeTime });
    expect(mine.snapshots.find(row => row.id === child.id)).toMatchObject({
      observedAt: f.observedAt, importedAt: reviewTime.toISOString(), excludedAt: revokeTime.toISOString(),
      reviewHistory: [history("VERIFIED", acceptedNote, reviewTime, f.admin), history("REVOKED", revokedNote, revokeTime, f.admin)],
    });
    const original = await prisma.metricsSnapshot.findUniqueOrThrow({ where: { id: f.parent.id } });
    expect(original).toMatchObject({ source: "SELF_REPORTED", followers: BigInt(1200), excludedAt: reviewTime });
    assertPrivateProjection({ verified, revoked, mine });
  });

  it("keeps a rejected original visible with its dated original-language reason and creates no verified child", async () => {
    const f = await submitted();
    await reviewMetricsScreenshot(f.admin, f.parent.id, {
      operationKey: key(), expectedEvidenceRevision: await currentRevision(f.account.id), decision: "REJECTED", note: rejectedNote,
    }, { ...f.options, now: reviewTime });
    const rejected = await listEvidenceReviewQueue(f.admin, { kind: "SCREENSHOT", status: "REJECTED", limit: 50 }, { ...f.options, now: reviewTime });
    expect(dataFor(rejected, f.parent.id)).toMatchObject({ source: "SELF_REPORTED", reviewStatus: "REJECTED",
      observedAt: f.observedAt, importedAt: now.toISOString(), approvedBy: null, excludedAt: reviewTime.toISOString(),
      reviewHistory: [history("REJECTED", rejectedNote, reviewTime, f.admin)] });
    expect(await prisma.metricsSnapshot.count({ where: { accountId: f.account.id, source: "SCREENSHOT_VERIFIED" } })).toBe(0);
    assertPrivateProjection(rejected);
  });

  it("distinguishes owner-approved SELF_REPORTED facts from an actual admin screenshot review", async () => {
    const f = await submitted();
    await approveMetricsSnapshot(f.owner, f.parent.id, {
      operationKey: key(), expectedMappingRevision: f.account.mappingRevision,
      expectedEvidenceRevision: await currentRevision(f.account.id), visibility: { followers: "BRAND_ONLY" },
    }, f.options);
    const queue = await listEvidenceReviewQueue(f.admin, { kind: "SCREENSHOT", status: "VERIFIED", limit: 50 }, f.options);
    const data = dataFor(queue, f.parent.id);
    expect(data).toMatchObject({ source: "SELF_REPORTED", reviewStatus: "VERIFIED", approvedBy: f.owner,
      approvedAt: now.toISOString(), excludedAt: null, reviewHistory: [] });
    expect(projectedRevision(data)).toBe(3);
    expect(await prisma.metricsSnapshot.count({ where: { accountId: f.account.id, source: "SCREENSHOT_VERIFIED" } })).toBe(0);
    const child = (await reviewMetricsScreenshot(f.admin, f.parent.id, {
      operationKey: key(), expectedEvidenceRevision: projectedRevision(data), decision: "VERIFIED", note: acceptedNote,
    }, { ...f.options, now: reviewTime })).snapshot;
    expect(child).toMatchObject({ source: "SCREENSHOT_VERIFIED", supersedesId: f.parent.id });
    expect(child.id).not.toBe(f.parent.id);
  });

  it("serializes two current administrators into one immutable child and one review audit/outbox transition", async () => {
    const f = await submitted(), otherAdmin = await user("ADMIN");
    const first = new PrismaClient(), second = new PrismaClient();
    const revision = await currentRevision(f.account.id);
    try {
      const reviews = await Promise.allSettled([
        reviewMetricsScreenshot(f.admin, f.parent.id, { operationKey: key(), expectedEvidenceRevision: revision,
          decision: "VERIFIED", note: acceptedNote }, { ...f.options, now: reviewTime, client: first }),
        reviewMetricsScreenshot(otherAdmin, f.parent.id, { operationKey: key(), expectedEvidenceRevision: revision,
          decision: "VERIFIED", note: { text: "A competing synthetic review.", language: "en" } }, { ...f.options, now: reviewTime, client: second }),
      ]);
      expect(reviews.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(reviews.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "STALE_VERSION" } });
      const children = await prisma.metricsSnapshot.findMany({ where: { accountId: f.account.id, source: "SCREENSHOT_VERIFIED" } });
      expect(children).toHaveLength(1);
      expect(children[0]).toMatchObject({ supersedesId: f.parent.id, followers: BigInt(1200), observedAt: new Date(f.observedAt) });
      expect(await currentRevision(f.account.id)).toBe(revision + 1);
      expect(await prisma.evidenceCommand.count({ where: { actorUserId: { in: [f.admin, otherAdmin] }, resourceType: "MetricsSnapshot" } })).toBe(1);
      expect(await prisma.adminAudit.count({ where: { actorUserId: { in: [f.admin, otherAdmin] }, action: "facts.screenshot_reviewed" } })).toBe(1);
      expect(await prisma.outboxEvent.count({ where: { type: "facts.screenshot_reviewed", OR: [f.admin, otherAdmin].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } })).toBe(1);
      const original = await prisma.metricsSnapshot.findUniqueOrThrow({ where: { id: f.parent.id } });
      expect(original).toMatchObject({ source: "SELF_REPORTED", followers: BigInt(1200), observedAt: new Date(f.observedAt) });
    } finally { await first.$disconnect(); await second.$disconnect(); }
  });

  it("keeps owner projection/private proof scoped and rejects a creator choosing an admin review", async () => {
    const f = await submitted();
    await expect(getCreatorEvidence(f.outsider, f.creator.id, f.options)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(getCreatorEvidence(f.admin, f.creator.id, f.options)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(getPrivateAsset(f.outsider, f.proof.id, f.options)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(listEvidenceReviewQueue(f.owner, { kind: "SCREENSHOT" }, f.options)).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(reviewMetricsScreenshot(f.owner, f.parent.id, {
      operationKey: key(), expectedEvidenceRevision: await currentRevision(f.account.id), decision: "VERIFIED", note: acceptedNote,
    }, f.options)).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(await prisma.metricsSnapshot.count({ where: { accountId: f.account.id, source: "SCREENSHOT_VERIFIED" } })).toBe(0);
  });

  it("rejects revoked real owner and admin database sessions despite retained adapter context", async () => {
    const f = await submitted();
    for (const [actor, role] of [[f.owner, "CREATOR"], [f.admin, "ADMIN"]] as const) {
      const sessionId = randomBytes(32).toString("base64url");
      const sessionVersion = (await prisma.user.findUniqueOrThrow({ where: { id: actor } })).sessionVersion;
      await prisma.authSession.create({ data: { id: sessionId, userId: actor, version: sessionVersion, expiresAt: new Date(Date.now() + 60_000) } });
      const options = { ...f.options, serverAuth: { userId: actor, role, sessionId, sessionVersion } };
      const load = () => role === "CREATOR" ? getCreatorEvidence(actor, f.creator.id, options)
        : listEvidenceReviewQueue(actor, { kind: "SCREENSHOT" }, options);
      await expect(load()).resolves.toBeDefined();
      await prisma.authSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
      await expect(load()).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    }
  });

  it("does not attach a genuine review receipt to another pending snapshot with an identical observation", async () => {
    const f = await submitted();
    const unrelated = (await submitMetricsScreenshot(f.owner, {
      operationKey: key(), accountId: f.account.id, expectedMappingRevision: f.account.mappingRevision,
      expectedEvidenceRevision: await currentRevision(f.account.id), evidenceAssetId: f.proof.id,
      observedAt: f.observedAt, followers: "1200",
    }, f.options)).snapshot;
    const reviewed = await reviewMetricsScreenshot(f.admin, f.parent.id, {
      operationKey: key(), expectedEvidenceRevision: await currentRevision(f.account.id), decision: "VERIFIED", note: acceptedNote,
    }, { ...f.options, now: reviewTime });
    const receipt = await prisma.evidenceCommand.findFirstOrThrow({ where: {
      actorUserId: f.admin, resourceType: "MetricsSnapshot", resourceId: reviewed.snapshot.id,
    } });
    // Preserve the real command hash and original result binding. Only relocate
    // its untrusted row header, as independent canonical tamper witnesses do.
    await prisma.evidenceCommand.update({ where: { id: receipt.id }, data: { resourceId: unrelated.id } });
    const pending = await listEvidenceReviewQueue(f.admin, { kind: "SCREENSHOT", status: "PENDING", limit: 50 }, { ...f.options, now: reviewTime });
    expect(dataFor(pending, unrelated.id)).toMatchObject({ source: "SELF_REPORTED", reviewStatus: "PENDING", reviewHistory: [] });
    const mine = await getCreatorEvidence(f.owner, f.creator.id, { ...f.options, now: reviewTime });
    expect(mine.snapshots.find(row => row.id === unrelated.id)).toMatchObject({ reviewStatus: "PENDING", reviewHistory: [] });
  });

  it.each(["changed note", "changed payload hash", "future receipt"] as const)("omits %s from descriptive review history", async failure => {
    const f = await submitted();
    const child = (await reviewMetricsScreenshot(f.admin, f.parent.id, {
      operationKey: key(), expectedEvidenceRevision: await currentRevision(f.account.id), decision: "VERIFIED", note: acceptedNote,
    }, { ...f.options, now: reviewTime })).snapshot;
    const receipt = await prisma.evidenceCommand.findFirstOrThrow({ where: {
      actorUserId: f.admin, resourceType: "MetricsSnapshot", resourceId: child.id,
    } });
    if (failure === "changed note") {
      const metadata = receipt.resultJson as Prisma.JsonObject;
      await prisma.evidenceCommand.update({ where: { id: receipt.id }, data: {
        resultJson: { ...metadata, note: { text: "An unrelated forged note.", language: "en" } },
      } });
    }
    if (failure === "changed payload hash") await prisma.evidenceCommand.update({ where: { id: receipt.id }, data: { payloadHash: "0".repeat(64) } });
    if (failure === "future receipt") await prisma.evidenceCommand.update({ where: { id: receipt.id }, data: { createdAt: revokeTime } });
    const mine = await getCreatorEvidence(f.owner, f.creator.id, { ...f.options, now: reviewTime });
    expect(mine.snapshots.find(row => row.id === child.id)).toMatchObject({ reviewHistory: [] });
    const queue = await listEvidenceReviewQueue(f.admin, { kind: "SCREENSHOT", status: "VERIFIED", limit: 50 }, { ...f.options, now: reviewTime });
    expect(dataFor(queue, child.id)).toMatchObject({ reviewHistory: [] });
  });

  it("does not expose the former owner's private snapshots or review history after a creator ownership transfer", async () => {
    const f = await submitted();
    await reviewMetricsScreenshot(f.admin, f.parent.id, {
      operationKey: key(), expectedEvidenceRevision: await currentRevision(f.account.id), decision: "VERIFIED", note: acceptedNote,
    }, { ...f.options, now: reviewTime });
    await prisma.creator.update({ where: { id: f.creator.id }, data: { userId: f.outsider } });
    await expect(getCreatorEvidence(f.owner, f.creator.id, { ...f.options, now: reviewTime })).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(getPrivateAsset(f.outsider, f.proof.id, f.options)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    const inherited = await getCreatorEvidence(f.outsider, f.creator.id, { ...f.options, now: reviewTime });
    expect(inherited.snapshots).toEqual([]);
    expect(inherited.assets).toEqual([]);
    expect(JSON.stringify(inherited)).not.toContain(acceptedNote.text);
    expect(JSON.stringify(inherited)).not.toContain(f.proof.id);
    const newProof = (await uploadPrivateAsset(f.outsider, {
      operationKey: key(), purpose: "SCREENSHOT", contentType: "image/png", bytes: png,
    }, { ...f.options, now: revokeTime })).asset;
    const own = (await submitMetricsScreenshot(f.outsider, {
      operationKey: key(), accountId: f.account.id, expectedMappingRevision: f.account.mappingRevision,
      expectedEvidenceRevision: await currentRevision(f.account.id), evidenceAssetId: newProof.id,
      observedAt: f.observedAt, followers: "6200",
    }, { ...f.options, now: revokeTime })).snapshot;
    const current = await getCreatorEvidence(f.outsider, f.creator.id, { ...f.options, now: revokeTime });
    expect(current.snapshots).toEqual([expect.objectContaining({ id: own.id, followers: "6200", reviewHistory: [] })]);
    expect(current.assets.map(asset => asset.id)).toEqual([newProof.id]);
    expect(JSON.stringify(current)).not.toContain(acceptedNote.text);
    expect(JSON.stringify(current)).not.toContain(f.proof.id);
  });

  it("hides a former creator owner's private licence while preserving the new owner's legitimate licence submission", async () => {
    const f = await fixture();
    const privateIssuer = "Former owner's confidential synthetic issuer";
    const privateNumber = "FORMER-PRIVATE-LICENCE-ONLY";
    const expiresAt = new Date(now.getTime() + 365 * 86_400_000).toISOString();
    const proof = (await uploadPrivateAsset(f.owner, {
      operationKey: key(), purpose: "ADVERTISING_LICENCE", contentType: "image/png", bytes: png,
    }, f.options)).asset;
    const command = { creatorId: f.creator.id, jurisdiction: "KW", issuer: privateIssuer, holderName: "Former synthetic holder",
      licenceNumber: privateNumber, type: "Synthetic test licence", scope: "Original private account scope",
      accountBindings: [{ accountId: f.account.id, mappingRevision: f.account.mappingRevision }], platformScope: ["INSTAGRAM"],
      validFrom: new Date(now.getTime() - 86_400_000).toISOString(), expiresAt };
    const former = (await submitAdvertisingLicence(f.owner, { operationKey: key(), ...command, evidenceAssetId: proof.id }, f.options)).licence;
    expect((await getCreatorEvidence(f.owner, f.creator.id, f.options)).licences).toEqual([expect.objectContaining({ id: former.id, licenceNumber: privateNumber })]);
    await prisma.creator.update({ where: { id: f.creator.id }, data: { userId: f.outsider } });
    await expect(getCreatorEvidence(f.owner, f.creator.id, f.options)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(getPrivateAsset(f.outsider, proof.id, f.options)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    const inherited = await getCreatorEvidence(f.outsider, f.creator.id, f.options);
    expect(inherited.licences).toEqual([]);
    for (const privateValue of [privateIssuer, privateNumber, proof.id]) expect(JSON.stringify(inherited)).not.toContain(privateValue);
    const newProof = (await uploadPrivateAsset(f.outsider, {
      operationKey: key(), purpose: "ADVERTISING_LICENCE", contentType: "image/png", bytes: png,
    }, { ...f.options, now: revokeTime })).asset;
    const own = (await submitAdvertisingLicence(f.outsider, { operationKey: key(), ...command, issuer: "Current synthetic issuer",
      holderName: "Current synthetic holder", licenceNumber: "CURRENT-PRIVATE-LICENCE", scope: "Current private account scope",
      evidenceAssetId: newProof.id }, { ...f.options, now: revokeTime })).licence;
    const current = await getCreatorEvidence(f.outsider, f.creator.id, { ...f.options, now: revokeTime });
    expect(current.licences).toEqual([expect.objectContaining({ id: own.id, issuer: "Current synthetic issuer", licenceNumber: "CURRENT-PRIVATE-LICENCE", evidenceAssetId: newProof.id })]);
    expect(current.assets.map(asset => asset.id)).toEqual([newProof.id]);
    for (const privateValue of [privateIssuer, privateNumber, proof.id]) expect(JSON.stringify(current)).not.toContain(privateValue);
  });

  it.each(["REPRESENTATIVE", "BUSINESS_REGISTRATION"] as const)("hides the former brand owner's private %s proof and preserves new-owner submissions", async kind => {
    const owner = await user("BRAND"), successor = await user("BRAND"), options = await fixtureOptions();
    const brand = await prisma.brand.create({ data: { userId: owner, slug: `transfer-${owner}`, name: "Synthetic transferred company", countryCode: "KW", isTest: true } });
    const privateIdentifier = `FORMER-PRIVATE-${kind}`;
    const proof = (await uploadPrivateAsset(owner, {
      operationKey: key(), purpose: kind, contentType: "image/png", bytes: png,
    }, options)).asset;
    const former = (await submitBusinessVerification(owner, { operationKey: key(), brandId: brand.id, kind, jurisdiction: "KW",
      identifier: privateIdentifier, evidenceAssetId: proof.id, expiresAt: new Date(now.getTime() + 365 * 86_400_000).toISOString() }, options)).verification;
    expect((await getBrandEvidence(owner, brand.id, options)).verifications).toEqual([expect.objectContaining({ id: former.id, identifier: privateIdentifier })]);
    await prisma.brand.update({ where: { id: brand.id }, data: { userId: successor } });
    await expect(getBrandEvidence(owner, brand.id, options)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(getPrivateAsset(successor, proof.id, options)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    const inherited = await getBrandEvidence(successor, brand.id, options);
    expect(inherited.verifications).toEqual([]);
    for (const privateValue of [privateIdentifier, proof.id]) expect(JSON.stringify(inherited)).not.toContain(privateValue);
    const newProof = (await uploadPrivateAsset(successor, {
      operationKey: key(), purpose: kind, contentType: "image/png", bytes: png,
    }, { ...options, now: revokeTime })).asset;
    const own = (await submitBusinessVerification(successor, { operationKey: key(), brandId: brand.id, kind, jurisdiction: "KW",
      identifier: `CURRENT-${kind}`, evidenceAssetId: newProof.id }, { ...options, now: revokeTime })).verification;
    const current = await getBrandEvidence(successor, brand.id, { ...options, now: revokeTime });
    expect(current.verifications).toEqual([expect.objectContaining({ id: own.id, kind, identifier: `CURRENT-${kind}`, evidenceAssetId: newProof.id })]);
    expect(current.assets.map(asset => asset.id)).toEqual([newProof.id]);
    for (const privateValue of [privateIdentifier, proof.id]) expect(JSON.stringify(current)).not.toContain(privateValue);
  });

  it.each([
    ["stale revision", "STALE_VERSION"],
    ["remapped account", "STALE_IDENTITY"],
    ["missing proof bytes", "ASSET_BYTES_UNAVAILABLE"],
  ] as const)("rejects a screenshot review with %s without a child or review transition", async (failure, code) => {
    const f = await submitted();
    let revision = await currentRevision(f.account.id);
    if (failure === "stale revision") revision--;
    if (failure === "remapped account") await prisma.socialAccount.update({ where: { id: f.account.id }, data: { mappingRevision: { increment: 1 }, handle: "changed_synthetic_identity" } });
    if (failure === "missing proof bytes") {
      const asset = await prisma.privateAsset.findUniqueOrThrow({ where: { id: f.proof.id } });
      await f.options.storage.remove(asset.storageKey.replace(/^local:/, ""));
    }
    await expect(reviewMetricsScreenshot(f.admin, f.parent.id, {
      operationKey: key(), expectedEvidenceRevision: revision, decision: "VERIFIED", note: acceptedNote,
    }, { ...f.options, now: reviewTime })).rejects.toMatchObject({ code });
    expect(await prisma.metricsSnapshot.count({ where: { accountId: f.account.id, source: "SCREENSHOT_VERIFIED" } })).toBe(0);
    expect(await prisma.adminAudit.count({ where: { actorUserId: f.admin, action: "facts.screenshot_reviewed" } })).toBe(0);
    expect(await prisma.evidenceCommand.count({ where: { actorUserId: f.admin, resourceType: "MetricsSnapshot" } })).toBe(0);
  });
});
