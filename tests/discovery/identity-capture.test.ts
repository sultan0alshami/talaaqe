import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma, PrismaClient, type MetricsSnapshot } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createEvidenceReceiptReader, type EvidenceReceiptReader } from "@/lib/evidence/receipt-reader";
import type { EvidenceActorLocks } from "@/lib/evidence/readiness";
import { capturePublicCreatorIdentities, publicIdentityActors, lockPublicIdentityUsers, type PublicIdentityCapture } from "@/lib/discovery/public-identity-capture";
import { loadPublicCreatorIdentities, projectPublicCreatorIdentities } from "@/lib/discovery/public-identity";
import { cleanupReviewedEvidence, reviewedEvidenceOptions, reviewedOwnershipFixture } from "../helpers/reviewed-evidence";
import { uploadPrivateAsset, submitMetricsScreenshot, reviewMetricsScreenshot, approveMetricsSnapshot } from "@/lib/evidence/service";

// Independently authored native C3a witness. Root alone
// activates/runs guarded targets. Real commands review synthetic local bytes;
// persisted PUBLISHED/non-test flags and direct drift are explicit synthetic
// compatibility/adversarial fixtures, never live identity/audience acceptance.
const users = new Set<string>(), creators = new Set<string>();
afterEach(async () => {
  await prisma.creator.deleteMany({ where: { id: { in: [...creators] } } });
  await cleanupReviewedEvidence(prisma, [...users], "test");
  await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
  users.clear(); creators.clear();
});
const key = () => randomUUID();
const canary = "SYNTHETIC_PRIVATE_CAPTURE_CONTENT";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1kAAAAASUVORK5CYII=", "base64");
async function user(role: "CREATOR" | "ADMIN", at: Date) {
  const id = key(); users.add(id);
  return prisma.user.create({ data: { id, role, name: canary + id, email: `${id}@example.invalid`, passwordHash: "not-a-login",
    active: true, isTest: role === "ADMIN", emailVerifiedAt: at, createdAt: at } });
}
async function fixture(options: { privatePrimary?: boolean; known?: boolean } = {}) {
  const at = new Date(Date.now() - 120000), owner = await user("CREATOR", at), admin = await user("ADMIN", at), metricsAdmin = await user("ADMIN", at);
  const creator = await prisma.creator.create({ data: { userId: owner.id, handle: "capture_" + key().replace(/-/g, "").slice(0, 16),
    displayName: "اسم أصلي Original alias", countryCode: "KW", languages: ["ar", "en"], nicheIds: ["tech"],
    isTest: false, publicConsentAt: at, profileFacts: { private: canary.repeat(100) }, createdAt: at } });
  creators.add(creator.id);
  async function account(platform: "INSTAGRAM" | "TIKTOK", publicVisible: boolean) {
    const row = await prisma.socialAccount.create({ data: { creatorId: creator.id, platform, handle: "proof_" + key().replace(/-/g, "").slice(0, 16),
      providerAccountId: "SYNTHETIC_PRIVATE_PROVIDER_" + key(), publicVisible: false, intendedConfirmedAt: at, consentAt: at, createdAt: at } });
    const proof = await reviewedOwnershipFixture(prisma, owner.id, admin.id, row.id, "test", at);
    await prisma.socialAccount.update({ where: { id: row.id }, data: { publicVisible } });
    return { row: await prisma.socialAccount.findUniqueOrThrow({ where: { id: row.id } }), proof };
  }
  const primary = await account("INSTAGRAM", !options.privatePrimary), visible = options.privatePrimary ? await account("TIKTOK", true) : primary;
  const portfolio = await prisma.portfolioVersion.create({ data: { creatorId: creator.id, version: 1, inputRevision: 9, approvedAt: at,
    content: { title: "Original approved title", bio: "سيرة أصلية\nOriginal biography", sections: [], method: "APPROVED_FACT_TEMPLATE" } } });
  let choice: MetricsSnapshot | null = null;
  if (options.known) {
    const t = (step: number) => new Date(at.getTime() + step * 1000);
    const uploaded = await uploadPrivateAsset(owner.id, { operationKey: key(), purpose: "SCREENSHOT", contentType: "image/png", bytes: png }, await reviewedEvidenceOptions(prisma, "test", t(1)));
    const current = await prisma.socialAccount.findUniqueOrThrow({ where: { id: visible.row.id } });
    const parent = (await submitMetricsScreenshot(owner.id, { operationKey: key(), accountId: current.id,
      expectedMappingRevision: current.mappingRevision, expectedEvidenceRevision: current.evidenceRevision,
      evidenceAssetId: uploaded.asset.id, observedAt: new Date(at.getTime() - 1000).toISOString(), followers: "0" }, await reviewedEvidenceOptions(prisma, "test", t(2)))).snapshot;
    const submitted = await prisma.socialAccount.findUniqueOrThrow({ where: { id: current.id } });
    const reviewed = (await reviewMetricsScreenshot(metricsAdmin.id, parent.id, { operationKey: key(), expectedEvidenceRevision: submitted.evidenceRevision,
      decision: "VERIFIED", note: { text: "مراجعة مصطنعة لاختبار مراحل الالتقاط فقط", language: "ar" } }, await reviewedEvidenceOptions(prisma, "test", t(3)))).snapshot;
    const afterReview = await prisma.socialAccount.findUniqueOrThrow({ where: { id: current.id } });
    await approveMetricsSnapshot(owner.id, reviewed.id, { operationKey: key(), expectedMappingRevision: afterReview.mappingRevision,
      expectedEvidenceRevision: afterReview.evidenceRevision, visibility: { followers: "PUBLIC" } }, await reviewedEvidenceOptions(prisma, "test", t(4)));
    choice = await prisma.metricsSnapshot.findUniqueOrThrow({ where: { id: reviewed.id } });
  }
  await prisma.creator.update({ where: { id: creator.id }, data: { primaryAccountId: primary.row.id, state: "PUBLISHED", publicConsentAt: at } });
  return { at, owner, admin, metricsAdmin, creator, primary, visible, portfolio, choice };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Operation = { model?: string; operation: string; sql: string; value: unknown };
function observe() {
  const operations: Operation[] = [];
  const client = prisma.$extends({ query: { async $allOperations({ model, operation, args, query }) {
    const sql = args && typeof args === "object" && "sql" in args && typeof args.sql === "string" ? args.sql : "";
    const value = await query(args); operations.push({ model, operation, sql, value }); return value;
  } } }) as unknown as PrismaClient;
  return { client, operations };
}
const userLock = (operation: Operation) => /\bFROM\s+(?:"public"\.)?"User"[\s\S]*\bFOR\s+(?:SHARE|UPDATE)\b/i.test(operation.sql);
const domainLock = (operation: Operation, table?: string) => new RegExp(`"${table ?? "(?:Creator|SocialAccount|PortfolioVersion|MetricsSnapshot|PrivateAsset|OwnershipChallenge)"}"[\\s\\S]*\\bFOR\\s+(?:SHARE|UPDATE)\\b`, "i").test(operation.sql);
async function capture(fixtures: readonly Fixture[], reader: EvidenceReceiptReader, client: PrismaClient = prisma, now = new Date()) {
  return client.$transaction(tx => capturePublicCreatorIdentities(tx, fixtures.map(f => f.creator.id), now, reader));
}
async function staged(batch: PublicIdentityCapture, reader: EvidenceReceiptReader, client: PrismaClient = prisma) {
  return client.$transaction(async tx => {
    const actors = await lockPublicIdentityUsers(tx, batch, reader);
    return projectPublicCreatorIdentities(tx, batch, actors, reader);
  }, { maxWait: 5000, timeout: 12000 });
}

describe("staged public identity capture: native synthetic C3a", () => {
  it("matches the unchanged public wrapper for two genuine identities with private primary, zero and unknown followers", async () => {
    const first = await fixture({ privatePrimary: true, known: true }), second = await fixture(), now = new Date(), originalClock = now.toISOString();
    const expected = await prisma.$transaction(tx => loadPublicCreatorIdentities(tx, [first.creator.id, second.creator.id], now, createEvidenceReceiptReader()));
    expect(expected).toHaveLength(2);
    const observed = observe(), reader = createEvidenceReceiptReader(), batch = await capture([first, second], reader, observed.client, now);
    expect(batch.asOf).toBe(originalClock);
    const pinned = batch.asOf; now.setTime(now.getTime() + 86400000);
    const actorStart = observed.operations.length;
    const actual = await observed.client.$transaction(async tx => {
      const actors = await lockPublicIdentityUsers(tx, batch, reader), projectStart = observed.operations.length;
      expect(actors.creatorOwners.get(first.creator.id)).toBe(first.owner.id);
      expect(actors.ownerIds.has(second.owner.id)).toBe(true);
      const result = await projectPublicCreatorIdentities(tx, batch, actors, reader);
      expect(observed.operations.slice(projectStart).some(userLock)).toBe(false);
      return result;
    });
    expect(batch.asOf).toBe(pinned); expect(actual).toEqual(expected);
    expect(actual[0]!.accounts.map(account => account.handle)).toEqual([first.visible.row.handle]);
    expect(actual[0]!.accounts[0]!.followersObservation?.followers).toBe("0");
    expect(actual[1]!.accounts[0]!.followersObservation).toBeNull();
    const projected = observed.operations.slice(actorStart);
    const firstPortfolio = projected.findIndex(operation => operation.model === "PortfolioVersion");
    expect(firstPortfolio).toBeGreaterThan(projected.findIndex(operation => domainLock(operation, "Creator")));
    expect(firstPortfolio).toBeGreaterThan(projected.findIndex(operation => domainLock(operation, "SocialAccount")));
  });

  it("captures only references without any User/domain lock, proof/private content or latest portfolio hydration", async () => {
    const f = await fixture({ privatePrimary: true, known: true }), observed = observe();
    const privateRow = await prisma.socialAccount.create({ data: { creatorId: f.creator.id, platform: "X", handle: "private_" + key().replace(/-/g, "").slice(0, 10), publicVisible: false } });
    const batch = await capture([f], createEvidenceReceiptReader(), observed.client);
    expect(batch.records).toHaveLength(1); expect(batch.asOf).toMatch(/Z$/);
    expect(batch.records[0]!.accounts.map(account => account.id).sort()).toEqual([f.primary.row.id, f.visible.row.id].sort());
    expect(batch.records[0]!.choices.has(f.primary.row.id)).toBe(false);
    expect(batch.records[0]!.choices.get(f.visible.row.id)?.id).toBe(f.choice!.id);
    expect(observed.operations.some(operation => userLock(operation) || domainLock(operation))).toBe(false);
    expect(observed.operations.some(operation => ["User", "PortfolioVersion", "OnboardingDraft", "EvidenceCommand", "PrivateAsset", "AdvertisingLicence"].includes(operation.model ?? ""))).toBe(false);
    const hydrated = JSON.stringify(observed.operations.map(operation => operation.value));
    expect(hydrated).not.toContain(canary); expect(hydrated).not.toContain(privateRow.id);
    for (const privateField of ["content", "profileFacts", "transcript", "answers", "followers", "evidenceAssetId"]) expect(hydrated).not.toContain(`"${privateField}"`);
    const actors = publicIdentityActors(batch);
    expect([...actors.ownerIds]).toEqual([f.owner.id]); expect(actors.reviewerIds.has(f.admin.id)).toBe(true); expect(actors.reviewerIds.has(f.metricsAdmin.id)).toBe(true);
    expect(actors.reviewerIds.has(f.owner.id)).toBe(false);
  });

  it.each(["owner", "account", "selected reviewer", "chosen observation"] as const)("rejects committed %s drift between unlocked capture and supplied-actor projection without adding User locks", async change => {
    const f = await fixture({ known: true }), reader = createEvidenceReceiptReader(), batch = await capture([f], reader), replacement = await user(change === "owner" ? "CREATOR" : "ADMIN", f.at);
    if (change === "owner") await prisma.creator.update({ where: { id: f.creator.id }, data: { userId: replacement.id } });
    if (change === "account") await prisma.socialAccount.update({ where: { id: f.primary.row.id }, data: { handle: "changed_" + key().replace(/-/g, "").slice(0, 10), mappingRevision: { increment: 1 }, evidenceRevision: { increment: 1 } } });
    if (change === "selected reviewer") await prisma.socialAccount.update({ where: { id: f.primary.row.id }, data: { ownershipReviewedBy: replacement.id } });
    if (change === "chosen observation") await prisma.metricsSnapshot.create({ data: { accountId: f.primary.row.id, mappingRevision: f.choice!.mappingRevision, source: "SELF_REPORTED",
      observedAt: new Date(f.choice!.observedAt.getTime() + 1), importedAt: f.at, followers: BigInt(123), reviewStatus: "PENDING", approvedBy: replacement.id } });
    const observed = observe();
    await expect(observed.client.$transaction(async tx => {
      const actors = await lockPublicIdentityUsers(tx, batch, reader), start = observed.operations.length;
      try { return await projectPublicCreatorIdentities(tx, batch, actors, reader); }
      finally { expect(observed.operations.slice(start).some(userLock)).toBe(false); }
    })).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
  });

  it("fails closed when supplied actors omit captured owners/reviewers or bind a different creator owner", async () => {
    const f = await fixture({ privatePrimary: true, known: true }), extra = await fixture({ known: true });
    const reader = createEvidenceReceiptReader(), batch = await capture([f], reader), additionalBatch = await capture([extra], reader);
    const observed = observe();
    await observed.client.$transaction(async tx => {
      const selected = publicIdentityActors(batch), additional = publicIdentityActors(additionalBatch);
      // Both selected account references use the same ownership reviewer. The
      // trusted outer union also repeats its input sets; every physical lock
      // group is deduplicated before ALL owners precede ALL reviewers.
      expect(selected.reviewerIds.size).toBe(2);
      const ownerIds = new Set([...selected.ownerIds, ...additional.ownerIds, ...selected.ownerIds].sort());
      const reviewerIds = new Set([...selected.reviewerIds, ...additional.reviewerIds, ...selected.reviewerIds]
        .filter(id => !ownerIds.has(id)).sort());
      expect(ownerIds.size).toBe(2); expect(reviewerIds.size).toBe(4);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join([...ownerIds])}) ORDER BY id FOR SHARE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join([...reviewerIds])}) ORDER BY id FOR SHARE`);
      const superset: EvidenceActorLocks = { ownerIds, reviewerIds,
        creatorOwners: new Map([...selected.creatorOwners, ...additional.creatorOwners]),
        brandOwners: new Map([...selected.brandOwners, ...additional.brandOwners]) };
      const start = observed.operations.length;
      const result = await projectPublicCreatorIdentities(tx, batch, superset, reader);
      expect(result.map(value => value.id)).toEqual([f.creator.id]);
      expect(result.some(value => value.id === extra.creator.id)).toBe(false);
      expect(result[0]!.accounts.map(value => value.handle)).toEqual([f.visible.row.handle]);
      expect(observed.operations.slice(start).some(userLock)).toBe(false);
    });
    await prisma.$transaction(async tx => {
      const actors = await lockPublicIdentityUsers(tx, batch, reader);
      const omitted: EvidenceActorLocks[] = [
        { ...actors, ownerIds: new Set() }, { ...actors, reviewerIds: new Set() },
        { ...actors, creatorOwners: new Map([[f.creator.id, key()]]) },
      ];
      for (const invalid of omitted) await expect(projectPublicCreatorIdentities(tx, batch, invalid, reader)).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
    });
  });

  it("uses one hydration/time budget across capture, native User waits and final projection", async () => {
    const first = await fixture({ privatePrimary: true, known: true }), second = await fixture();
    // Same-clock ownership families cost6/acceptance; private primary +public
    // secondary+metrics =16, public-primary unknown identity =12, total28.
    const reader = createEvidenceReceiptReader({ maxRows: 28 }), batch = await capture([first, second], reader);
    expect(await staged(batch, reader)).toHaveLength(2);
    const limited = createEvidenceReceiptReader({ maxRows: 27 }), limitedBatch = await capture([first, second], limited);
    await expect(staged(limitedBatch, limited)).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });

    const peer = new PrismaClient(), monitor = new PrismaClient(), ready = latch<void>(), release = latch<void>(), backend = latch<number>(), stop = new AbortController();
    const observed = observe(); let started = 0, waiting: Promise<void> | undefined;
    const holding = peer.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM "User" WHERE id=${first.owner.id} FOR UPDATE`; ready.resolve(); await release.promise; }, { maxWait: 5000, timeout: 10000 });
    void holding.catch(() => {}); let reading: Promise<unknown> | undefined;
    try {
      await Promise.race([ready.promise, holding.then(() => { throw new Error("Synthetic capture holder completed before lock publication"); })]);
      reading = observed.client.$transaction(async tx => {
        const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`; backend.resolve(rows[0]!.pid);
        started = performance.now(); const timed = createEvidenceReceiptReader({ maxElapsedMs: 300 });
        const captured = await capturePublicCreatorIdentities(tx, [first.creator.id], new Date(), timed);
        const actors = await lockPublicIdentityUsers(tx, captured, timed);
        return projectPublicCreatorIdentities(tx, captured, actors, timed);
      }, { maxWait: 5000, timeout: 5000 }); void reading.catch(() => {});
      const pid = await Promise.race([backend.promise, reading.then(() => { throw new Error("Synthetic capture read completed before PID publication"); })]);
      waiting = waitForUserLock(pid, monitor, stop.signal);
      await Promise.race([waiting, reading.then(() => { throw new Error("Synthetic staged read completed before actual native User wait"); })]);
      await delay(Math.max(0, started + 350 - performance.now())); release.resolve(); await holding;
      await expect(reading).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
      expect(observed.operations.some(operation => domainLock(operation))).toBe(false);
    } finally { release.resolve(); stop.abort(); await holding.catch(() => {}); await reading?.catch(() => {}); await waiting?.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); }
  });
});

function latch<T>() { let resolve!: (value: T | PromiseLike<T>) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
async function waitForUserLock(pid: number, monitor: PrismaClient, signal: AbortSignal) {
  const deadline = performance.now() + 4000;
  while (performance.now() < deadline) {
    if (signal.aborted) throw new Error("Synthetic staged User-lock witness cancelled");
    const rows = await monitor.$queryRaw<Array<{ waiting: boolean }>>`SELECT (wait_event_type='Lock' AND query LIKE '%"User"%') AS waiting FROM pg_stat_activity WHERE pid=${pid}`;
    if (rows[0]?.waiting) return;
    await delay(20);
  }
  throw new Error("Synthetic staged capture never reached its actual native User lock wait");
}
