import { randomUUID } from "node:crypto";
import { PrismaClient, type MetricsSnapshot, type Prisma } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { openSession, resolveSession } from "@/lib/identity";
import { uploadPrivateAsset, submitMetricsScreenshot, reviewMetricsScreenshot, approveMetricsSnapshot } from "@/lib/evidence/service";
import { acceptedSnapshotFieldConsent } from "@/lib/evidence/metrics-consent";
import { snapshotScopeHash } from "@/lib/evidence/metrics-readiness";
import { cleanup, fixture, now, png } from "./fixtures";

// Independent M02A native acceptance over task-local synthetic evidence.
// Every approval is an actual command over synthetic uploaded bytes.
// Direct row edits below are explicitly adversarial metadata fixtures, never
// live evidence. The coordinator owns product implementation and guarded runs.
afterEach(cleanup);
type Visibility = "PRIVATE" | "BRAND_ONLY" | "PUBLIC";
type Fixture = Awaited<ReturnType<typeof fixture>>;
const key = () => randomUUID();
const note = { text: "مراجعة مصطنعة لاختبار موافقة المشاركة فقط", language: "ar" };
const json = (value: unknown) => value as Prisma.InputJsonValue;

export async function snapshotSharingFixture() {
  const f = await fixture();
  let time = now.getTime();
  const tick = () => new Date(time += 1000);
  const readTime = () => new Date(time);
  async function reviewed(followers = "10000", averageViews = "1234") {
    const asset = (await uploadPrivateAsset(f.owner, { operationKey: key(), purpose: "SCREENSHOT", contentType: "image/png", bytes: png }, { ...f.options, now: tick() })).asset;
    const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    const observedAt = readTime().toISOString();
    const parent = (await submitMetricsScreenshot(f.owner, { operationKey: key(), accountId: account.id,
      expectedMappingRevision: account.mappingRevision, expectedEvidenceRevision: account.evidenceRevision,
      evidenceAssetId: asset.id, observedAt, followers, averageViews }, { ...f.options, now: tick() })).snapshot;
    const submittedAccount = await prisma.socialAccount.findUniqueOrThrow({ where: { id: account.id } });
    const child = (await reviewMetricsScreenshot(f.admin, parent.id, { operationKey: key(),
      expectedEvidenceRevision: submittedAccount.evidenceRevision, decision: "VERIFIED", note }, { ...f.options, now: tick() })).snapshot;
    return prisma.metricsSnapshot.findUniqueOrThrow({ where: { id: child.id } });
  }
  async function approve(snapshot: MetricsSnapshot, visibility: Record<string, Visibility>) {
    const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    const command = { operationKey: key(), expectedMappingRevision: account.mappingRevision,
      expectedEvidenceRevision: account.evidenceRevision, visibility };
    const at = tick();
    const result = await approveMetricsSnapshot(f.owner, snapshot.id, command, { ...f.options, now: at });
    const receipt = await prisma.evidenceCommand.findUniqueOrThrow({ where: { actorUserId_operationKey: { actorUserId: f.owner, operationKey: command.operationKey } } });
    return { command, at, result, receipt };
  }
  async function consent(snapshot: MetricsSnapshot, field = "followers", minimumVisibility: "PUBLIC" | "BRAND_ONLY" = "PUBLIC") {
    return prisma.$transaction(async tx => {
      const account = await tx.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
      const current = await tx.metricsSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } });
      return acceptedSnapshotFieldConsent(tx, account, current, f.owner, field, readTime(), minimumVisibility);
    });
  }
  return { ...f, tick, readTime, reviewed, approve, consent };
}

async function effects(f: Fixture) {
  return {
    account: await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } }),
    creator: await prisma.creator.findUniqueOrThrow({ where: { id: f.creator.id } }),
    receipts: await prisma.evidenceCommand.findMany({ where: { actorUserId: f.owner }, orderBy: { id: "asc" } }),
    audits: await prisma.adminAudit.findMany({ where: { actorUserId: f.owner }, orderBy: { id: "asc" } }),
    events: await prisma.outboxEvent.findMany({ where: { payload: { path: ["actorUserId"], equals: f.owner } }, orderBy: { id: "asc" } }),
  };
}

describe("chosen-observation owner sharing consent: native synthetic M02A", () => {
  it("persists the exact complete approval command binding and returns only boolean consent without altering metadata", async () => {
    const f = await snapshotSharingFixture(), child = await f.reviewed();
    const approval = await f.approve(child, { followers: "PUBLIC", averageViews: "BRAND_ONLY" });
    expect(approval.receipt.resultJson).toMatchObject({ action: "APPROVE_SCREENSHOT_FIELDS", resourceId: child.id,
      ownerUserId: f.owner, accountId: f.account.id, mappingRevision: child.mappingRevision,
      snapshotScopeHash: snapshotScopeHash(child), expectedMappingRevision: approval.command.expectedMappingRevision,
      expectedEvidenceRevision: approval.command.expectedEvidenceRevision, revision: approval.command.expectedEvidenceRevision + 1,
      visibility: approval.command.visibility });
    expect(approval.receipt.payloadHash).toBe(canonicalHash({ action: "APPROVE_SCREENSHOT_FIELDS", id: child.id, ...approval.command }));
    const before = await effects(f), accepted = await f.consent(child);
    expect(accepted).toBe(true); expect(typeof accepted).toBe("boolean");
    expect(await f.consent(child, "averageViews")).toBe(false);
    expect(await effects(f)).toEqual(before);
  });

  it("requires approval of the chosen newer observation rather than account-wide PUBLIC flags from an older child", async () => {
    const f = await snapshotSharingFixture(), older = await f.reviewed("10000"), newer = await f.reviewed("20000");
    await f.approve(older, { followers: "PUBLIC" });
    expect(await f.consent(older)).toBe(true);
    expect(await f.consent(newer)).toBe(false);
    await f.approve(newer, { followers: "PUBLIC" });
    expect(await f.consent(newer)).toBe(true);
  });

  it("preserves earlier followers consent when a later genuine command approves only unrelated averageViews", async () => {
    const f = await snapshotSharingFixture(), child = await f.reviewed();
    const first = await f.approve(child, { followers: "PUBLIC" });
    const unrelated = await f.approve(child, { averageViews: "PUBLIC" });
    const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    expect(account.factsApprovedAt).toEqual(unrelated.at);
    expect(unrelated.at.getTime()).toBeGreaterThan(first.at.getTime());
    expect(await f.consent(child)).toBe(true);
    expect(await f.consent(child, "averageViews")).toBe(true);
  });

  it("retains chosen SELF_REPORTED sharing after unrelated approval without asserting screenshot confidence", async () => {
    const f = await snapshotSharingFixture();
    const asset = (await uploadPrivateAsset(f.owner, { operationKey: key(), purpose: "SCREENSHOT", contentType: "image/png", bytes: png }, { ...f.options, now: f.tick() })).asset;
    const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    const submitted = (await submitMetricsScreenshot(f.owner, { operationKey: key(), accountId: account.id,
      expectedMappingRevision: account.mappingRevision, expectedEvidenceRevision: account.evidenceRevision,
      evidenceAssetId: asset.id, observedAt: f.readTime().toISOString(), followers: "10000", averageViews: "1234" }, { ...f.options, now: f.tick() })).snapshot;
    const parent = await prisma.metricsSnapshot.findUniqueOrThrow({ where: { id: submitted.id } });
    const original = await f.approve(parent, { followers: "PUBLIC" });
    const unrelated = await f.approve(parent, { averageViews: "PUBLIC" });
    const current = await prisma.metricsSnapshot.findUniqueOrThrow({ where: { id: parent.id } });
    expect(current.source).toBe("SELF_REPORTED");
    expect(current.approvedAt).toEqual(unrelated.at);
    expect(unrelated.at.getTime()).toBeGreaterThan(original.at.getTime());
    expect(await f.consent(parent)).toBe(true);
    expect(await f.consent(parent, "averageViews")).toBe(true);
  });

  it.each(["PRIVATE", "BRAND_ONLY"] as const)("uses the chosen field's newest %s approval even after another snapshot PUBLIC changes account settings", async visibility => {
    const f = await snapshotSharingFixture(), chosen = await f.reviewed("10000"), other = await f.reviewed("20000");
    await f.approve(chosen, { followers: "PUBLIC" });
    await f.approve(chosen, { followers: visibility });
    await f.approve(other, { followers: "PUBLIC" });
    const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    expect(account.fieldVisibility).toMatchObject({ followers: "PUBLIC" });
    expect(await f.consent(chosen)).toBe(false);
    expect(await f.consent(other)).toBe(true);
  });

  it.each([
    ["PRIVATE", "bad hash"], ["PRIVATE", "legacy binding"],
    ["BRAND_ONLY", "bad hash"], ["BRAND_ONLY", "legacy binding"],
  ] as const)("retains the chosen %s withdrawal barrier when its later receipt has %s and another observation becomes PUBLIC", async (visibility, corruption) => {
    const f = await snapshotSharingFixture(), chosen = await f.reviewed("10000"), other = await f.reviewed("20000");
    await f.approve(chosen, { followers: "PUBLIC" });
    const withdrawal = await f.approve(chosen, { followers: visibility });
    const metadata = { ...(withdrawal.receipt.resultJson as Prisma.JsonObject) };
    if (corruption === "legacy binding") {
      for (const field of ["action", "accountId", "mappingRevision", "snapshotScopeHash", "expectedMappingRevision", "expectedEvidenceRevision", "visibility"]) delete metadata[field];
    }
    await prisma.evidenceCommand.update({ where: { id: withdrawal.receipt.id }, data: {
      resultJson: json(metadata), payloadHash: corruption === "bad hash" ? "0".repeat(64) : withdrawal.receipt.payloadHash,
    } });
    await f.approve(other, { followers: "PUBLIC" });
    const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    expect(account.fieldVisibility).toMatchObject({ followers: "PUBLIC" });
    expect(await f.consent(chosen)).toBe(false);
    expect(await f.consent(other)).toBe(true);
  });

  it("does not trust a corrupted low revision to hide a genuinely later chosen PRIVATE withdrawal", async () => {
    const f = await snapshotSharingFixture(), chosen = await f.reviewed("10000"), other = await f.reviewed("20000");
    const original = await f.approve(chosen, { followers: "PUBLIC" });
    const withdrawal = await f.approve(chosen, { followers: "PRIVATE" });
    expect(withdrawal.at.getTime()).toBeGreaterThan(original.at.getTime());
    await prisma.evidenceCommand.update({ where: { id: withdrawal.receipt.id }, data: {
      resultJson: json({ ...(withdrawal.receipt.resultJson as Prisma.JsonObject), revision: 1 }),
    } });
    await f.approve(other, { followers: "PUBLIC" });
    const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    expect(account.fieldVisibility).toMatchObject({ followers: "PUBLIC" });
    expect(await f.consent(chosen)).toBe(false);
    expect(await f.consent(other)).toBe(true);
  });

  it.each(["opaque withdrawal", "same-revision ambiguity"] as const)("allows a fully validated later chosen PUBLIC command to supersede older %s", async history => {
    const f = await snapshotSharingFixture(), chosen = await f.reviewed();
    const publicApproval = await f.approve(chosen, { followers: "PUBLIC" });
    if (history === "opaque withdrawal") {
      const withdrawal = await f.approve(chosen, { followers: "PRIVATE" });
      await prisma.evidenceCommand.update({ where: { id: withdrawal.receipt.id }, data: { payloadHash: "0".repeat(64) } });
      // Deliberate raw current flag alone must not restore consent.
      await prisma.socialAccount.update({ where: { id: f.account.id }, data: { fieldVisibility: { followers: "PUBLIC" } } });
    } else {
      const operationKey = key(), visibility = { followers: "PRIVATE" as const };
      await prisma.evidenceCommand.create({ data: { actorUserId: f.owner, operationKey, resourceType: "MetricsSnapshot", resourceId: chosen.id,
        createdAt: publicApproval.at, resultJson: json({ ...(publicApproval.receipt.resultJson as Prisma.JsonObject), visibility }),
        payloadHash: canonicalHash({ action: "APPROVE_SCREENSHOT_FIELDS", id: chosen.id, ...publicApproval.command, operationKey, visibility }) } });
    }
    expect(await f.consent(chosen)).toBe(false);
    await f.approve(chosen, { followers: "PUBLIC" });
    expect(await f.consent(chosen)).toBe(true);
  });

  it("rechecks a captured PUBLIC account after a genuine chosen-field downgrade", async () => {
    const f = await snapshotSharingFixture(), child = await f.reviewed();
    await f.approve(child, { followers: "PUBLIC" });
    const captured = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    await f.approve(child, { followers: "PRIVATE" });
    expect(await prisma.$transaction(tx => acceptedSnapshotFieldConsent(tx, captured, child, f.owner, "followers", f.readTime()))).toBe(false);
    expect(await f.consent(child)).toBe(false);
  });

  it.each(["excluded", "future"] as const)("does not accept consent for an %s observation", async condition => {
    const f = await snapshotSharingFixture(), child = await f.reviewed();
    await f.approve(child, { followers: "PUBLIC" });
    if (condition === "excluded") {
      await prisma.metricsSnapshot.update({ where: { id: child.id }, data: { excludedAt: f.tick() } });
      const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
      expect(await prisma.$transaction(tx => acceptedSnapshotFieldConsent(tx, account, child, f.owner, "followers", f.readTime()))).toBe(false);
    } else {
      const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
      const beforeObservation = new Date(child.observedAt.getTime() - 1);
      expect(await prisma.$transaction(tx => acceptedSnapshotFieldConsent(tx, account, child, f.owner, "followers", beforeObservation))).toBe(false);
    }
  });

  it("rejects a substituted scalar in the passed observation while its native immutable row stays unchanged", async () => {
    const f = await snapshotSharingFixture(), child = await f.reviewed();
    await f.approve(child, { followers: "PUBLIC" });
    const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    const tampered = { ...child, followers: child.followers! + BigInt(1) };
    expect(await prisma.$transaction(tx => acceptedSnapshotFieldConsent(tx, account, tampered, f.owner, "followers", f.readTime()))).toBe(false);
    expect((await prisma.metricsSnapshot.findUniqueOrThrow({ where: { id: child.id } })).followers).toBe(child.followers);
    expect(await f.consent(child)).toBe(true);
  });

  it("intersects original PUBLIC approval with current sharing and never widens PRIVATE or BRAND_ONLY to public", async () => {
    const f = await snapshotSharingFixture(), child = await f.reviewed();
    await f.approve(child, { followers: "PUBLIC" });
    for (const visibility of ["PRIVATE", "BRAND_ONLY"] as const) {
      // Deliberate current-state downgrade; original approval remains genuine.
      await prisma.socialAccount.update({ where: { id: f.account.id }, data: { fieldVisibility: { followers: visibility } } });
      expect(await f.consent(child)).toBe(false);
    }
  });

  it("supports an explicitly requested BRAND_ONLY minimum without promoting that consent to PUBLIC", async () => {
    const f = await snapshotSharingFixture(), child = await f.reviewed();
    await f.approve(child, { followers: "BRAND_ONLY" });
    expect(await f.consent(child, "followers", "BRAND_ONLY")).toBe(true);
    expect(await f.consent(child)).toBe(false);
    await f.approve(child, { followers: "PRIVATE" });
    expect(await f.consent(child, "followers", "BRAND_ONLY")).toBe(false);
  });

  it("replays the same actual owner command once without advancing account revision or consent history", async () => {
    const f = await snapshotSharingFixture(), child = await f.reviewed();
    const approval = await f.approve(child, { followers: "PUBLIC" }), before = await effects(f);
    expect(await approveMetricsSnapshot(f.owner, child.id, approval.command, { ...f.options, now: f.tick() })).toMatchObject({ replayed: true, snapshot: { id: child.id } });
    expect(await effects(f)).toEqual(before);
    expect(await f.consent(child)).toBe(true);
    await expect(approveMetricsSnapshot(f.owner, child.id, { ...approval.command, visibility: { followers: "PRIVATE" } }, { ...f.options, now: f.tick() })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(await effects(f)).toEqual(before);
  });

  it.each(["legacy binding", "bad hash", "wrong action", "wrong account", "wrong scope", "wrong mapping", "wrong expected revision", "future receipt"] as const)("rejects %s despite genuine approval flags and original private bytes", async failure => {
    const f = await snapshotSharingFixture(), child = await f.reviewed(), approval = await f.approve(child, { followers: "PUBLIC" });
    const metadata = { ...(approval.receipt.resultJson as Prisma.JsonObject) };
    let payloadHash = approval.receipt.payloadHash, createdAt = approval.receipt.createdAt;
    if (failure === "legacy binding") {
      for (const field of ["action", "accountId", "mappingRevision", "snapshotScopeHash", "expectedMappingRevision", "expectedEvidenceRevision", "visibility"]) delete metadata[field];
    }
    if (failure === "bad hash") payloadHash = "0".repeat(64);
    if (failure === "wrong action") metadata.action = "REVIEW_SCREENSHOT";
    if (failure === "wrong account") metadata.accountId = key();
    if (failure === "wrong scope") metadata.snapshotScopeHash = "0".repeat(64);
    if (failure === "wrong mapping") metadata.expectedMappingRevision = child.mappingRevision + 1;
    if (failure === "wrong expected revision") metadata.expectedEvidenceRevision = approval.command.expectedEvidenceRevision + 1;
    if (failure === "future receipt") createdAt = new Date(f.readTime().getTime() + 1000);
    await prisma.evidenceCommand.update({ where: { id: approval.receipt.id }, data: { resultJson: json(metadata), payloadHash, createdAt } });
    expect(await f.consent(child)).toBe(false);
  });

  it("rejects raw PUBLIC/facts flags without any authentic chosen-observation approval", async () => {
    const f = await snapshotSharingFixture(), child = await f.reviewed();
    await prisma.socialAccount.update({ where: { id: f.account.id }, data: { fieldVisibility: { followers: "PUBLIC" }, factsApprovedAt: f.tick() } });
    expect(await f.consent(child)).toBe(false);
  });

  it("does not accept consent copied onto a different observation with substituted followers", async () => {
    const f = await snapshotSharingFixture(), child = await f.reviewed(), approval = await f.approve(child, { followers: "PUBLIC" });
    const substitute = await prisma.metricsSnapshot.create({ data: { accountId: child.accountId, mappingRevision: child.mappingRevision,
      source: child.source, observedAt: child.observedAt, importedAt: child.importedAt, supersedesId: child.supersedesId,
      followers: BigInt(99999), averageViews: child.averageViews, evidenceAssetId: child.evidenceAssetId,
      approvedBy: child.approvedBy, approvedAt: child.approvedAt, reviewStatus: "VERIFIED" } });
    await prisma.evidenceCommand.update({ where: { id: approval.receipt.id }, data: { resourceId: substitute.id,
      resultJson: json({ ...(approval.receipt.resultJson as Prisma.JsonObject), resourceId: substitute.id }) } });
    expect(await f.consent(substitute)).toBe(false);
  });

  it.each(["remap", "owner transfer", "inactive owner", "wrong owner role"] as const)("rechecks %s before accepting saved approval", async failure => {
    const f = await snapshotSharingFixture(), child = await f.reviewed();
    await f.approve(child, { followers: "PUBLIC" });
    if (failure === "remap") await prisma.socialAccount.update({ where: { id: f.account.id }, data: { handle: "remapped_" + key().slice(0, 8), mappingRevision: { increment: 1 } } });
    if (failure === "owner transfer") await prisma.creator.update({ where: { id: f.creator.id }, data: { userId: f.outsider } });
    if (failure === "inactive owner") await prisma.user.update({ where: { id: f.owner }, data: { active: false } });
    if (failure === "wrong owner role") await prisma.user.update({ where: { id: f.owner }, data: { role: "BRAND" } });
    expect(await f.consent(child)).toBe(false);
  });

  it("requires valid approval chronology and an account evidence revision covering the approval", async () => {
    const f = await snapshotSharingFixture(), child = await f.reviewed(), approval = await f.approve(child, { followers: "PUBLIC" });
    const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    await prisma.socialAccount.update({ where: { id: account.id }, data: { factsApprovedAt: child.approvedAt } });
    expect(await f.consent(child)).toBe(false);
    await prisma.socialAccount.update({ where: { id: account.id }, data: { factsApprovedAt: account.factsApprovedAt, evidenceRevision: approval.command.expectedEvidenceRevision } });
    expect(await f.consent(child)).toBe(false);
    await prisma.socialAccount.update({ where: { id: account.id }, data: { evidenceRevision: account.evidenceRevision } });
    await prisma.evidenceCommand.update({ where: { id: approval.receipt.id }, data: { createdAt: new Date(child.approvedAt!.getTime() - 1) } });
    expect(await f.consent(child)).toBe(false);
  });

  it("fails closed on distinct valid approval bindings at the same account evidence revision", async () => {
    const f = await snapshotSharingFixture(), child = await f.reviewed(), approval = await f.approve(child, { followers: "PUBLIC" });
    const operationKey = key(), visibility = { followers: "PRIVATE" as const };
    await prisma.evidenceCommand.create({ data: { actorUserId: f.owner, operationKey, resourceType: "MetricsSnapshot", resourceId: child.id,
      createdAt: approval.at, resultJson: json({ ...(approval.receipt.resultJson as Prisma.JsonObject), visibility }),
      payloadHash: canonicalHash({ action: "APPROVE_SCREENSHOT_FIELDS", id: child.id, ...approval.command, operationKey, visibility }) } });
    expect(await f.consent(child)).toBe(false);
  });

  it("rejects same-revision distinct valid unrelated bindings but allows a later authentic chosen-field approval", async () => {
    const f = await snapshotSharingFixture(), child = await f.reviewed();
    const approval = await f.approve(child, { followers: "PUBLIC" });
    const operationKey = key(), visibility = { averageViews: "PUBLIC" as const };
    await prisma.evidenceCommand.create({ data: { actorUserId: f.owner, operationKey, resourceType: "MetricsSnapshot", resourceId: child.id,
      createdAt: approval.at, resultJson: json({ ...(approval.receipt.resultJson as Prisma.JsonObject), visibility }),
      payloadHash: canonicalHash({ action: "APPROVE_SCREENSHOT_FIELDS", id: child.id, ...approval.command, operationKey, visibility }) } });
    expect(await f.consent(child)).toBe(false);
    await f.approve(child, { followers: "PUBLIC" });
    expect(await f.consent(child)).toBe(true);
  });

  it("treats impossible duplicate unrelated commands at a higher revision as uncertainty rather than restoring an older field", async () => {
    const f = await snapshotSharingFixture(), child = await f.reviewed();
    const original = await f.approve(child, { followers: "PUBLIC" });
    const unrelated = await f.approve(child, { averageViews: "PUBLIC" });
    expect(unrelated.command.expectedEvidenceRevision).toBeGreaterThan(original.command.expectedEvidenceRevision);
    const operationKey = key(), visibility = { averageViews: "PRIVATE" as const };
    await prisma.evidenceCommand.create({ data: { actorUserId: f.owner, operationKey, resourceType: "MetricsSnapshot", resourceId: child.id,
      createdAt: unrelated.at, resultJson: json({ ...(unrelated.receipt.resultJson as Prisma.JsonObject), visibility }),
      payloadHash: canonicalHash({ action: "APPROVE_SCREENSHOT_FIELDS", id: child.id, ...unrelated.command, operationKey, visibility }) } });
    expect(await f.consent(child)).toBe(false);
    await f.approve(child, { followers: "PUBLIC" });
    expect(await f.consent(child)).toBe(true);
  });

  it("rolls back sharing, journal, audit and event when the actual owner session is revoked at final native session lock", async () => {
    const f = await snapshotSharingFixture(), child = await f.reviewed();
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: f.owner } });
    const token = await openSession(owner.id, owner.sessionVersion, owner.passwordHash), session = await resolveSession(token);
    if (!session) throw new Error("Synthetic native session setup failed");
    const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    const command = { operationKey: key(), expectedMappingRevision: account.mappingRevision, expectedEvidenceRevision: account.evidenceRevision, visibility: { followers: "PUBLIC" as const } };
    const peer = new PrismaClient();
    let release!: () => void, entered!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
    const holding = peer.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${session.sessionId} FOR UPDATE`;
      entered(); await released;
      await tx.authSession.update({ where: { id: session.sessionId }, data: { revokedAt: new Date() } });
    }, { timeout: 15000 });
    let writing: Promise<unknown> | undefined;
    try {
      await Promise.race([ready, holding.then(() => { throw new Error("Synthetic session holder completed before its lock was acquired"); })]);
      const before = await effects(f);
      writing = approveMetricsSnapshot(f.owner, child.id, command, { ...f.options, now: f.tick(), serverAuth: {
        userId: session.userId, role: session.role, sessionId: session.sessionId, sessionVersion: session.sessionVersion,
      } }).then(result => ({ code: "UNEXPECTED_COMMIT", result }), (error: unknown) => error);
      await waitForFinalSessionLock(writing);
      release(); await holding;
      expect(await writing).toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
      expect(await effects(f)).toEqual(before);
      expect(await f.consent(child)).toBe(false);
    } finally {
      release(); await holding.catch(() => {}); await writing?.catch(() => {}); await peer.$disconnect();
    }
  });
});

async function waitForFinalSessionLock(operation: Promise<unknown>) {
  let cancelled = false;
  const completed = operation.then(() => { throw new Error("Synthetic approval completed before the native session-lock witness"); });
  const observed = (async () => {
    const deadline = Date.now() + 5000;
    while (!cancelled && Date.now() < deadline) {
      const rows = await prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%"AuthSession"%' AND query LIKE '%FOR SHARE%'`;
      if (Number(rows[0]?.count ?? 0) > 0) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (cancelled) return;
    throw new Error("Synthetic final session-lock witness was not observed");
  })();
  try { await Promise.race([completed, observed]); } finally { cancelled = true; }
}
