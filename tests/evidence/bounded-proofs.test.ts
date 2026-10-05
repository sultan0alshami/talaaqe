import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { PrismaClient, type EvidenceCommand, type MetricsSnapshot, type Prisma, type PrivateAsset } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { canonicalHash, record } from "@/lib/onboarding/drafts";
import { createEvidenceReceiptReader, type EvidenceReceiptReader } from "@/lib/evidence/receipt-reader";
import { acceptedOwnershipProof, privateAssetAccepted, lockEvidenceActors } from "@/lib/evidence/readiness";
import { acceptedScreenshotProof } from "@/lib/evidence/metrics-readiness";
import { acceptedSnapshotFieldConsent } from "@/lib/evidence/metrics-consent";
import {
  createOwnershipChallenge, submitOwnershipProof, reviewOwnershipProof, uploadPrivateAsset,
  submitMetricsScreenshot, reviewMetricsScreenshot, approveMetricsSnapshot,
} from "@/lib/evidence/service";
import { cleanup, fixture, now, png } from "./fixtures";

// Independently authored; the coordinator alone executes guarded targets.
// Real domain commands over task-local synthetic uploaded bytes; no live
// ownership, provider, legal, audience or public-discovery acceptance claim.
// Directly minted noise is adversarial iterator history, never trusted proof.
afterEach(cleanup);
const key = () => randomUUID();
const note = { text: "مراجعة مصطنعة لاختبار حدود قارئ الإثبات فقط", language: "ar" };
type Visibility = "PRIVATE" | "BRAND_ONLY" | "PUBLIC";

async function prepared() {
  const f = await fixture();
  let time = now.getTime();
  const tick = () => new Date(time += 1000), readTime = () => new Date(time);
  const upload = async (purpose: string) => (await uploadPrivateAsset(f.owner, {
    operationKey: key(), purpose, contentType: "image/png", bytes: png,
  }, { ...f.options, now: tick() })).asset;
  const ownershipAsset = await upload("OWNERSHIP_PROOF");
  const challenge = (await createOwnershipChallenge(f.owner, { operationKey: key(), accountId: f.account.id,
    expectedMappingRevision: 1, expectedEvidenceRevision: 1 }, { ...f.options, now: tick() })).challenge;
  await submitOwnershipProof(f.owner, challenge.id, { operationKey: key(), expectedRevision: 1, assetId: ownershipAsset.id }, { ...f.options, now: tick() });
  await reviewOwnershipProof(f.admin, challenge.id, { operationKey: key(), expectedRevision: 2, decision: "VERIFIED",
    observedChallengeCode: challenge.challengeCode, note }, { ...f.options, now: tick() });

  async function reviewed(followers = "10000") {
    const screenshotAsset = await upload("SCREENSHOT");
    const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    const parent = (await submitMetricsScreenshot(f.owner, { operationKey: key(), accountId: account.id,
      expectedMappingRevision: account.mappingRevision, expectedEvidenceRevision: account.evidenceRevision,
      evidenceAssetId: screenshotAsset.id, observedAt: readTime().toISOString(), followers, averageViews: "1234",
    }, { ...f.options, now: tick() })).snapshot;
    const submitted = await prisma.socialAccount.findUniqueOrThrow({ where: { id: account.id } });
    const child = (await reviewMetricsScreenshot(f.admin, parent.id, { operationKey: key(),
      expectedEvidenceRevision: submitted.evidenceRevision, decision: "VERIFIED", note }, { ...f.options, now: tick() })).snapshot;
    return {
      screenshotAsset,
      parent: await prisma.metricsSnapshot.findUniqueOrThrow({ where: { id: parent.id } }),
      child: await prisma.metricsSnapshot.findUniqueOrThrow({ where: { id: child.id } }),
    };
  }
  async function approve(snapshot: MetricsSnapshot, visibility: Record<string, Visibility>) {
    const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    return approveMetricsSnapshot(f.owner, snapshot.id, { operationKey: key(), expectedMappingRevision: account.mappingRevision,
      expectedEvidenceRevision: account.evidenceRevision, visibility }, { ...f.options, now: tick() });
  }
  const screenshot = await reviewed();
  await approve(screenshot.child, { followers: "PUBLIC", averageViews: "PUBLIC" });
  return { ...f, ...screenshot, ownershipAsset, challenge, reviewed, approve, readTime };
}
type Prepared = Awaited<ReturnType<typeof prepared>>;

async function current(tx: Prisma.TransactionClient, f: Prepared) {
  const actors = await lockEvidenceActors(tx, { creatorIds: [f.creator.id] });
  const account = await tx.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
  const child = await tx.metricsSnapshot.findUniqueOrThrow({ where: { id: f.child.id } });
  return { actors, account, child };
}
async function ownership(f: Prepared, reader?: EvidenceReceiptReader) {
  return prisma.$transaction(async tx => {
    const { actors, account } = await current(tx, f);
    return acceptedOwnershipProof(tx, account, f.owner, f.readTime(), actors, reader);
  });
}
async function screenshot(f: Prepared, reader?: EvidenceReceiptReader) {
  return prisma.$transaction(async tx => {
    const { actors, account, child } = await current(tx, f);
    return acceptedScreenshotProof(tx, account, child, f.owner, f.readTime(), actors, reader);
  });
}
async function consent(f: Prepared, reader?: EvidenceReceiptReader) {
  return prisma.$transaction(async tx => {
    const { actors, account, child } = await current(tx, f);
    return acceptedSnapshotFieldConsent(tx, account, child, f.owner, "followers", f.readTime(), "PUBLIC", actors, reader);
  });
}
async function asset(f: Prepared, reader?: EvidenceReceiptReader) {
  return prisma.$transaction(tx => privateAssetAccepted(tx, f.ownershipAsset.id, f.owner, "OWNERSHIP_PROOF", f.readTime(), reader));
}
async function projection(f: Prepared, reader: EvidenceReceiptReader) {
  return prisma.$transaction(async tx => {
    const { actors, account, child } = await current(tx, f);
    return {
      ownership: await acceptedOwnershipProof(tx, account, f.owner, f.readTime(), actors, reader),
      screenshot: await acceptedScreenshotProof(tx, account, child, f.owner, f.readTime(), actors, reader),
      consent: await acceptedSnapshotFieldConsent(tx, account, child, f.owner, "followers", f.readTime(), "PUBLIC", actors, reader),
    };
  });
}

async function effects(f: Prepared) {
  const actors = [f.owner, f.admin];
  return {
    account: await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } }),
    creator: await prisma.creator.findUniqueOrThrow({ where: { id: f.creator.id } }),
    assets: await prisma.privateAsset.findMany({ where: { ownerUserId: f.owner }, orderBy: { id: "asc" } }),
    snapshots: await prisma.metricsSnapshot.findMany({ where: { accountId: f.account.id }, orderBy: { id: "asc" } }),
    challenge: await prisma.ownershipChallenge.findUniqueOrThrow({ where: { id: f.challenge.id } }),
    receipts: await prisma.evidenceCommand.findMany({ where: { actorUserId: { in: actors } }, orderBy: { id: "asc" } }),
    audits: await prisma.adminAudit.findMany({ where: { actorUserId: { in: actors } }, orderBy: { id: "asc" } }),
    events: await prisma.outboxEvent.findMany({ where: { OR: actors.map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) }, orderBy: { id: "asc" } }),
  };
}

async function addNoiseBefore(original: EvidenceCommand, count = 32) {
  const batch = key();
  const rows = Array.from({ length: count }, (_, index) => ({
    id: `a-reader-noise-${batch}-${String(index).padStart(3, "0")}`,
    actorUserId: original.actorUserId, operationKey: `synthetic-noise:${batch}:${index}`,
    payloadHash: "0".repeat(64), resourceType: original.resourceType, resourceId: original.resourceId,
    resultJson: original.resultJson as Prisma.InputJsonValue, createdAt: original.createdAt,
  }));
  expect(rows.every(row => row.id < original.id)).toBe(true);
  await prisma.evidenceCommand.createMany({ data: rows });
}

describe("optional bounded receipt readers preserve actual synthetic proof commands", () => {
  it("accepts the same original ownership/upload/screenshot/sharing bindings while performing no mutation", async () => {
    const f = await prepared(), before = await effects(f);
    expect(await ownership(f)).toBe(true);
    expect(await ownership(f, createEvidenceReceiptReader({ maxRows: 4 }))).toBe(true);
    expect((await asset(f))?.id).toBe(f.ownershipAsset.id);
    expect((await asset(f, createEvidenceReceiptReader({ maxRows: 1 })))?.id).toBe(f.ownershipAsset.id);
    expect(await screenshot(f)).toBe(true);
    expect(await screenshot(f, createEvidenceReceiptReader({ maxRows: 3 }))).toBe(true);
    expect(await consent(f)).toBe(true);
    expect(await consent(f, createEvidenceReceiptReader({ maxRows: 1 }))).toBe(true);
    expect(await effects(f)).toEqual(before);
  });

  it("shares exactly eight hydrated original receipts across one ownership/confidence/consent projection", async () => {
    const f = await prepared(), before = await effects(f);
    expect(await projection(f, createEvidenceReceiptReader({ maxRows: 8 }))).toEqual({ ownership: true, screenshot: true, consent: true });
    expect(await effects(f)).toEqual(before);
  });

  it("throws retry when the final sharing family exceeds a projection-wide budget instead of returning partial confidence", async () => {
    const f = await prepared();
    await expect(projection(f, createEvidenceReceiptReader({ maxRows: 7 }))).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
    expect(await ownership(f)).toBe(true);
    expect(await screenshot(f)).toBe(true);
    expect(await consent(f)).toBe(true);
  });

  it.each(["ownership", "screenshot"] as const)("propagates exhaustion from the nested %s private-asset journal", async kind => {
    const f = await prepared();
    const proof = kind === "ownership" ? ownership : screenshot;
    // All preceding original proof receipts fit. The independently required
    // upload receipt is nonempty, so its scalar completion probe must throw.
    const budget = kind === "ownership" ? 3 : 2;
    await expect(proof(f, createEvidenceReceiptReader({ maxRows: budget }))).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
    expect(await proof(f)).toBe(true);
  });

  it("stops before reading private asset metadata after its actual native lock wait exhausts the deadline", async () => {
    const f = await prepared(), peer = new PrismaClient(), monitor = new PrismaClient();
    const held = latch<void>(), release = latch<void>(), backend = latch<number>(), monitoring = new AbortController();
    let assetReads = 0, hydratedAssets = 0, hydratedReceipts = 0, started = 0;
    const client = prisma.$extends({ query: {
      privateAsset: { async findUnique({ args, query }) {
        assetReads++;
        const row = await query(args);
        if (row) hydratedAssets++;
        return row;
      } },
      evidenceCommand: { async findMany({ args, query }) {
        const rows = await query(args);
        hydratedReceipts += rows.length;
        return rows;
      } },
    } }) as unknown as PrismaClient;
    const holding = peer.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "PrivateAsset" WHERE id=${f.ownershipAsset.id} FOR UPDATE`;
      held.resolve();
      await release.promise;
    }, { maxWait: 5000, timeout: 10000 });
    void holding.catch(() => {});
    let reading: Promise<PrivateAsset | null> | undefined, waiting: Promise<void> | undefined;
    try {
      await Promise.race([held.promise, holding.then(() => { throw new Error("Synthetic asset holder completed before native lock publication"); })]);
      reading = client.$transaction(async tx => {
        const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
        backend.resolve(rows[0]!.pid);
        started = performance.now();
        const reader = createEvidenceReceiptReader({ maxElapsedMs: 300 });
        return privateAssetAccepted(tx, f.ownershipAsset.id, f.owner, "OWNERSHIP_PROOF", f.readTime(), reader);
      }, { maxWait: 5000, timeout: 5000 });
      void reading.catch(() => {});
      const pid = await Promise.race([backend.promise, reading.then(() => { throw new Error("Synthetic asset reader completed before PID publication"); })]);
      waiting = waitForAssetShareLock(pid, monitor, monitoring.signal);
      await Promise.race([waiting, reading.then(() => { throw new Error("Synthetic asset reader completed before native share-lock waiting"); })]);
      await delay(Math.max(0, started + 350 - performance.now()));
      release.resolve(); await holding;
      await expect(reading).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
      expect(assetReads).toBe(0);
      expect(hydratedAssets).toBe(0);
      expect(hydratedReceipts).toBe(0);
    } finally {
      release.resolve(); monitoring.abort();
      await holding.catch(() => {});
      await reading?.catch(() => {});
      await waiting?.catch(() => {});
      await peer.$disconnect(); await monitor.$disconnect();
    }
  });

  it("rejects ambiguous valid-hash screenshot submissions only in the supplied bounded path", async () => {
    const f = await prepared();
    const original = await prisma.evidenceCommand.findFirstOrThrow({ where: {
      resourceType: "MetricsSnapshot", resourceId: f.parent.id, actorUserId: f.owner, createdAt: f.parent.importedAt,
    } });
    const operationKey = `synthetic-ambiguous:${key()}`, metadata = record(original.resultJson);
    // An adversarial database fixture can carry two individually canonical
    // original-command identities for the same immutable observation. It is
    // never described as a second actual user command or live proof.
    await prisma.evidenceCommand.create({ data: {
      id: `a-reader-ambiguous-${key()}`, actorUserId: original.actorUserId, operationKey,
      resourceType: original.resourceType, resourceId: original.resourceId, createdAt: original.createdAt,
      resultJson: original.resultJson as Prisma.InputJsonValue,
      payloadHash: canonicalHash({ action: "SUBMIT_SCREENSHOT", operationKey, accountId: f.account.id,
        expectedMappingRevision: f.parent.mappingRevision, expectedEvidenceRevision: metadata.expectedEvidenceRevision,
        evidenceAssetId: f.parent.evidenceAssetId, observedAt: f.parent.observedAt.toISOString(), ...record(metadata.submittedMetrics) }),
    } });
    const before = await effects(f);
    expect(await screenshot(f)).toBe(true);
    await expect(screenshot(f, createEvidenceReceiptReader({ maxRows: 4 }))).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
    expect(await effects(f)).toEqual(before);
  });

  it.each(["ownership-start", "asset-upload", "screenshot-submission", "screenshot-review"] as const)(
    "keeps original %s proof after 32 malformed receipts without truncating the family", async family => {
      const f = await prepared();
      let type: string, id: string, actor: string, timestamp: Date, proof: (reader?: EvidenceReceiptReader) => Promise<unknown>, ordinaryBudget: number;
      if (family === "ownership-start") {
        const challenge = await prisma.ownershipChallenge.findUniqueOrThrow({ where: { id: f.challenge.id } });
        type = "OwnershipChallenge"; id = challenge.id; actor = f.owner; timestamp = challenge.createdAt;
        proof = reader => ownership(f, reader); ordinaryBudget = 4;
      } else if (family === "asset-upload") {
        const upload = await prisma.privateAsset.findUniqueOrThrow({ where: { id: f.ownershipAsset.id } });
        type = "PrivateAsset"; id = upload.id; actor = f.owner; timestamp = upload.createdAt;
        proof = reader => asset(f, reader); ordinaryBudget = 1;
      } else if (family === "screenshot-submission") {
        type = "MetricsSnapshot"; id = f.parent.id; actor = f.owner; timestamp = f.parent.importedAt;
        proof = reader => screenshot(f, reader); ordinaryBudget = 3;
      } else {
        type = "MetricsSnapshot"; id = f.child.id; actor = f.admin; timestamp = f.child.approvedAt!;
        proof = reader => screenshot(f, reader); ordinaryBudget = 3;
      }
      const original = await prisma.evidenceCommand.findFirstOrThrow({ where: { resourceType: type, resourceId: id, actorUserId: actor, createdAt: timestamp } });
      await addNoiseBefore(original);
      const before = await effects(f);
      const bounded = await proof(createEvidenceReceiptReader({ maxRows: 32 + ordinaryBudget }));
      if (family === "asset-upload") expect(bounded).toMatchObject({ id: f.ownershipAsset.id });
      else expect(bounded).toBe(true);
      const legacy = await proof();
      if (family === "asset-upload") expect(legacy).toMatchObject({ id: f.ownershipAsset.id });
      else expect(legacy).toBe(true);
      await expect(proof(createEvidenceReceiptReader({ maxRows: 32 }))).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
      expect(await effects(f)).toEqual(before);
    },
  );

  it("does not bypass original proof hashes or resurrect a corrupt upload receipt in either path", async () => {
    const f = await prepared();
    const upload = await prisma.evidenceCommand.findFirstOrThrow({ where: { resourceType: "PrivateAsset", resourceId: f.ownershipAsset.id, actorUserId: f.owner } });
    // Explicit adversarial metadata fixture, never a legitimate receipt edit.
    // Both predicates must reject the corrupted original upload binding.
    await prisma.evidenceCommand.update({ where: { id: upload.id }, data: { payloadHash: "0".repeat(64) } });
    expect(await asset(f)).toBeNull();
    expect(await asset(f, createEvidenceReceiptReader({ maxRows: 1 }))).toBeNull();
    expect(await ownership(f)).toBe(false);
    expect(await ownership(f, createEvidenceReceiptReader({ maxRows: 4 }))).toBe(false);
  });

  it("keeps sharing separate from deleted screenshot confidence and preserves unrelated ownership", async () => {
    const f = await prepared();
    await prisma.privateAsset.update({ where: { id: f.screenshotAsset.id }, data: { deletedAt: f.readTime(), revision: { increment: 1 } } });
    expect(await screenshot(f)).toBe(false);
    expect(await screenshot(f, createEvidenceReceiptReader({ maxRows: 3 }))).toBe(false);
    expect(await ownership(f, createEvidenceReceiptReader({ maxRows: 4 }))).toBe(true);
    expect(await consent(f, createEvidenceReceiptReader({ maxRows: 1 }))).toBe(true);
  });

  it("rejects substituted current ownership in both paths without using a matching old receipt as authority", async () => {
    const f = await prepared();
    await prisma.creator.update({ where: { id: f.creator.id }, data: { userId: f.outsider } });
    expect(await ownership(f)).toBe(false);
    expect(await ownership(f, createEvidenceReceiptReader({ maxRows: 4 }))).toBe(false);
    expect(await screenshot(f, createEvidenceReceiptReader({ maxRows: 3 }))).toBe(false);
    expect(await consent(f, createEvidenceReceiptReader({ maxRows: 1 }))).toBe(false);
  });

  it("reads actual later PRIVATE consent before concluding, even when another observation restores account-wide PUBLIC", async () => {
    const f = await prepared();
    await f.approve(f.child, { followers: "PRIVATE" });
    const other = await f.reviewed("20000");
    await f.approve(other.child, { followers: "PUBLIC" });
    expect((await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } })).fieldVisibility).toMatchObject({ followers: "PUBLIC" });
    const before = await effects(f);
    expect(await consent(f)).toBe(false);
    expect(await consent(f, createEvidenceReceiptReader({ maxRows: 2 }))).toBe(false);
    await expect(consent(f, createEvidenceReceiptReader({ maxRows: 1 }))).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
    expect(await effects(f)).toEqual(before);
  });
});

function latch<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

async function waitForAssetShareLock(pid: number, monitor: PrismaClient, signal: AbortSignal) {
  const deadline = performance.now() + 4000;
  while (performance.now() < deadline) {
    if (signal.aborted) throw new Error("Synthetic private asset lock witness cancelled");
    const rows = await monitor.$queryRaw<Array<{ waiting: boolean }>>`SELECT (
      wait_event_type='Lock' AND query LIKE '%"PrivateAsset"%' AND query LIKE '%FOR SHARE%'
    ) AS waiting FROM pg_stat_activity WHERE pid=${pid}`;
    if (rows[0]?.waiting) return;
    await delay(20);
  }
  throw new Error("Synthetic private asset helper never reached its actual native share-lock wait");
}
