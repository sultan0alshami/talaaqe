import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { applyDraftCommand, createOrResumeDraft, getDraft, OnboardingError } from "@/lib/onboarding/drafts";
import { queueSourceJob, startSourceJob, checkpointSourceJob, completeSourceJob, failSourceJob } from "@/lib/onboarding/jobs";

const users: string[] = [];
async function actor(role: "CREATOR" | "BRAND" | "ADMIN" = "CREATOR") {
  const id = randomUUID();
  await prisma.user.create({ data: { id, name: "Synthetic onboarding", email: `${id}@example.invalid`, passwordHash: "not-a-login-hash", role, isTest: true } });
  users.push(id);
  return id;
}
afterAll(async () => { await prisma.user.deleteMany({ where: { id: { in: users } } }); });

const instagramIdentity = { platform: "INSTAGRAM", providerAccountId: "synthetic-provider-1", normalizedHandle: "synthetic_one", confirmedOrigin: null };
const tiktokIdentity = { platform: "TIKTOK", providerAccountId: "synthetic-provider-2", normalizedHandle: "synthetic_two", confirmedOrigin: null };
const observed = { fieldKey: "followers", value: 1000, unit: "accounts", source: "SELF_REPORTED", evidenceAt: "2026-10-01T10:00:00.000Z", sourceReference: null };

async function sourceReady(userId: string, draftId: string, sourceKey = "instagram", identity = instagramIdentity) {
  let draft = await getDraft(userId, draftId);
  draft = (await applyDraftCommand(userId, draftId, { action: "SET_ANSWER", operationKey: randomUUID(), expectedRevision: draft.revision,
    payload: { field: "sourceMapping", value: { sourceKey, source: identity.platform, identity } } })).draft;
  draft = (await applyDraftCommand(userId, draftId, { action: "CONFIRM_ACCOUNT", operationKey: randomUUID(), expectedRevision: draft.revision,
    payload: { sourceKey, identity } })).draft;
  draft = (await applyDraftCommand(userId, draftId, { action: "GRANT_IMPORT_CONSENT", operationKey: randomUUID(), expectedRevision: draft.revision,
    payload: { sourceKey, identity, scopes: ["public-profile"], consentVersion: "synthetic-consent-v1", granted: true } })).draft;
  return draft;
}

describe("durable server-owned onboarding on guarded PostgreSQL", () => {
  it("resumes one draft, binds kind to current role and refuses another actor/inactive account", async () => {
    const owner = await actor();
    const first = await createOrResumeDraft(owner);
    expect((await createOrResumeDraft(owner)).id).toBe(first.id);
    expect(first.role).toBe("CREATOR");
    const other = await actor();
    await expect(getDraft(other, first.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await prisma.user.update({ where: { id: owner }, data: { active: false } });
    await expect(getDraft(owner, first.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createOrResumeDraft(await actor("ADMIN"))).rejects.toBeInstanceOf(OnboardingError);
  });

  it("replays identical canonical payload without a new revision, conflicts on changed payload and preserves original language", async () => {
    const owner = await actor();
    const draft = await createOrResumeDraft(owner);
    const command = { action: "SET_ANSWER", operationKey: randomUUID(), expectedRevision: draft.revision,
      payload: { field: "displayName", value: "اسمي الأصلي" } };
    const first = await applyDraftCommand(owner, draft.id, command);
    const replay = await applyDraftCommand(owner, draft.id, { ...command, payload: { value: "اسمي الأصلي", field: "displayName" } });
    expect(replay.replayed).toBe(true);
    expect(replay.draft.revision).toBe(first.draft.revision);
    expect((await getDraft(owner, draft.id)).input.answers.displayName).toBe("اسمي الأصلي");
    await expect(applyDraftCommand(owner, draft.id, { ...command, payload: { field: "displayName", value: "Changed" } })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(applyDraftCommand(owner, draft.id, { ...command, action: "SAVE_DRAFT", payload: {} })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(applyDraftCommand(owner, draft.id, { action: "PUBLISH", operationKey: randomUUID(), expectedRevision: first.draft.revision, payload: {} })).rejects.toThrow();
  });

  it("uses separate database connections so concurrent same-revision commands have exactly one winner", async () => {
    const owner = await actor();
    const draft = await createOrResumeDraft(owner);
    const second = new PrismaClient();
    try {
      const results = await Promise.allSettled([
        applyDraftCommand(owner, draft.id, { action: "SET_ANSWER", operationKey: randomUUID(), expectedRevision: draft.revision, payload: { field: "displayName", value: "One" } }, prisma),
        applyDraftCommand(owner, draft.id, { action: "SET_ANSWER", operationKey: randomUUID(), expectedRevision: draft.revision, payload: { field: "displayName", value: "Two" } }, second),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const failure = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
      expect(failure.reason).toMatchObject({ code: "STALE_VERSION" });
      expect((await getDraft(owner, draft.id)).revision).toBe(draft.revision + 1);
    } finally { await second.$disconnect(); }
  });

  it("returns one stored result for a concurrent identical command replay", async () => {
    const owner = await actor();
    const draft = await createOrResumeDraft(owner);
    const second = new PrismaClient();
    const command = { action: "SET_ANSWER", operationKey: randomUUID(), expectedRevision: draft.revision, payload: { field: "displayName", value: "Concurrent original" } };
    try {
      const results = await Promise.all([applyDraftCommand(owner, draft.id, command), applyDraftCommand(owner, draft.id, command, second)]);
      expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
      expect(await prisma.draftCommand.count({ where: { draftId: draft.id } })).toBe(1);
      expect(results[0].draft).toEqual(results[1].draft);
    } finally { await second.$disconnect(); }
  });

  it("requires confirmed exact source and scoped consent before queueing and prevents voice authorizing imports", async () => {
    const owner = await actor();
    const draft = await createOrResumeDraft(owner);
    await expect(queueSourceJob(owner, draft.id, { sourceKey: "instagram", operationKey: randomUUID(), expectedRevision: draft.revision })).rejects.toMatchObject({ code: "SOURCE_NOT_CONFIRMED" });
    const mapped = (await applyDraftCommand(owner, draft.id, { action: "SET_ANSWER", operationKey: randomUUID(), expectedRevision: draft.revision,
      payload: { field: "sourceMapping", value: { sourceKey: "instagram", source: "INSTAGRAM", identity: instagramIdentity } } })).draft;
    await expect(applyDraftCommand(owner, draft.id, { action: "CONFIRM_ACCOUNT", channel: "VOICE", operationKey: randomUUID(), expectedRevision: mapped.revision, payload: { sourceKey: "instagram", identity: instagramIdentity } })).rejects.toMatchObject({ code: "EXPLICIT_CONFIRMATION_REQUIRED" });
    await expect(applyDraftCommand(owner, draft.id, { action: "CONFIRM_ACCOUNT", channel: "FORM", operationKey: randomUUID(), expectedRevision: mapped.revision, payload: { sourceKey: "instagram", identity: instagramIdentity } }, prisma, { channel: "VOICE" })).rejects.toMatchObject({ code: "EXPLICIT_CONFIRMATION_REQUIRED" });
    await expect(queueSourceJob(owner, draft.id, { sourceKey: "instagram", operationKey: randomUUID(), expectedRevision: mapped.revision, channel: "FORM" }, prisma, { channel: "VOICE" })).rejects.toMatchObject({ code: "EXPLICIT_CONFIRMATION_REQUIRED" });
    const confirmed = (await applyDraftCommand(owner, draft.id, { action: "CONFIRM_ACCOUNT", operationKey: randomUUID(), expectedRevision: mapped.revision, payload: { sourceKey: "instagram", identity: instagramIdentity } })).draft;
    await expect(queueSourceJob(owner, draft.id, { sourceKey: "instagram", operationKey: randomUUID(), expectedRevision: confirmed.revision })).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
  });

  it("queues once and grants only one execution acquisition across separate connections", async () => {
    const owner = await actor();
    const draft = await createOrResumeDraft(owner);
    const ready = await sourceReady(owner, draft.id);
    const input = { sourceKey: "instagram", operationKey: randomUUID(), expectedRevision: ready.revision };
    const queued = await queueSourceJob(owner, draft.id, input);
    expect((await queueSourceJob(owner, draft.id, input)).job.id).toBe(queued.job.id);
    const second = new PrismaClient();
    try {
      const claims = await Promise.all([startSourceJob(owner, queued.job.id), startSourceJob(owner, queued.job.id, second)]);
      expect(claims.filter((claim) => claim.acquired)).toHaveLength(1);
      expect(claims.filter((claim) => claim.executionToken)).toHaveLength(1);
      expect(claims[0].job.attempts).toBe(1);
    } finally { await second.$disconnect(); }
  });

  it("rejects old-handle completion as STALE and never attaches its old facts", async () => {
    const owner = await actor();
    const draft = await createOrResumeDraft(owner);
    const ready = await sourceReady(owner, draft.id);
    const queued = await queueSourceJob(owner, draft.id, { sourceKey: "instagram", operationKey: randomUUID(), expectedRevision: ready.revision });
    const running = await startSourceJob(owner, queued.job.id);
    const current = await getDraft(owner, draft.id);
    await applyDraftCommand(owner, draft.id, { action: "SET_ANSWER", operationKey: randomUUID(), expectedRevision: current.revision,
      payload: { field: "sourceMapping", value: { sourceKey: "instagram", source: "INSTAGRAM", identity: { ...instagramIdentity, providerAccountId: "corrected", normalizedHandle: "corrected" } } } });
    const finished = await completeSourceJob(owner, queued.job.id, { executionToken: running.executionToken!, facts: [observed], status: "SUCCEEDED", completedItems: 1, totalItems: 1 });
    expect(finished.job.status).toBe("STALE");
    expect((await getDraft(owner, draft.id)).input.facts.instagram).toBeUndefined();
  });

  it("retains successful other-source and checkpoint facts through partial failure and refresh", async () => {
    const owner = await actor();
    const draft = await createOrResumeDraft(owner);
    await sourceReady(owner, draft.id);
    const ready = await sourceReady(owner, draft.id, "tiktok", tiktokIdentity);
    const first = await queueSourceJob(owner, draft.id, { sourceKey: "instagram", operationKey: randomUUID(), expectedRevision: ready.revision });
    const firstClaim = await startSourceJob(owner, first.job.id);
    const current = await getDraft(owner, draft.id);
    const second = await queueSourceJob(owner, draft.id, { sourceKey: "tiktok", operationKey: randomUUID(), expectedRevision: current.revision });
    const secondClaim = await startSourceJob(owner, second.job.id);
    await completeSourceJob(owner, first.job.id, { executionToken: firstClaim.executionToken!, facts: [observed], status: "SUCCEEDED", completedItems: 1, totalItems: 1 });
    await checkpointSourceJob(owner, second.job.id, { executionToken: secondClaim.executionToken!, facts: [{ ...observed, value: 2000 }], completedItems: 1, totalItems: 2 });
    await failSourceJob(owner, second.job.id, { executionToken: secondClaim.executionToken!, errorCode: "PROVIDER_TIMEOUT", billingUncertain: true });
    const resumed = await createOrResumeDraft(owner);
    expect(resumed.input.facts.instagram[0].value).toBe(1000);
    expect(resumed.input.facts.tiktok[0].value).toBe(2000);
    expect(resumed.jobs.find((job) => job.id === second.job.id)?.status).toBe("FAILED");
    expect(resumed.jobs.find((job) => job.id === second.job.id)?.billingUncertain).toBe(true);
    expect(resumed.input.facts.instagram[0].reviewStatus).toBe("PROPOSED");
    expect(JSON.stringify(resumed)).not.toContain(secondClaim.executionToken!);
  });

  it("replays completed results, rejects changed completion and loses no data in completion/edit race", async () => {
    const owner = await actor();
    const draft = await createOrResumeDraft(owner);
    const ready = await sourceReady(owner, draft.id);
    const queued = await queueSourceJob(owner, draft.id, { sourceKey: "instagram", operationKey: randomUUID(), expectedRevision: ready.revision });
    const claim = await startSourceJob(owner, queued.job.id);
    const completion = { executionToken: claim.executionToken!, facts: [observed], status: "SUCCEEDED", completedItems: 1, totalItems: 1 };
    const completed = await completeSourceJob(owner, queued.job.id, completion);
    expect((await completeSourceJob(owner, queued.job.id, completion)).replayed).toBe(true);
    await expect(completeSourceJob(owner, queued.job.id, { ...completion, facts: [{ ...observed, value: 9999 }] })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(completed.job.completedItems).toBe(1);
    const newer = await getDraft(owner, draft.id);
    const nextJob = await queueSourceJob(owner, draft.id, { sourceKey: "instagram", operationKey: randomUUID(), expectedRevision: newer.revision });
    const nextClaim = await startSourceJob(owner, nextJob.job.id);
    const latest = await getDraft(owner, draft.id);
    const second = new PrismaClient();
    try {
      await Promise.all([
        completeSourceJob(owner, nextJob.job.id, { ...completion, executionToken: nextClaim.executionToken! }, second),
        applyDraftCommand(owner, draft.id, { action: "SET_ANSWER", operationKey: randomUUID(), expectedRevision: latest.revision, payload: { field: "sourceMapping", value: { sourceKey: "instagram", source: "INSTAGRAM", identity: { ...instagramIdentity, providerAccountId: "replacement", normalizedHandle: "replacement" } } } }),
      ]);
      expect((await getDraft(owner, draft.id)).input.facts.instagram).toBeUndefined();
      expect((await prisma.sourceJob.findUniqueOrThrow({ where: { id: nextJob.job.id } })).status).toBe("STALE");
    } finally { await second.$disconnect(); }
  });

  it("validates identity/consent atomically and invalidates running work when consent is revoked", async () => {
    const owner = await actor(), draft = await createOrResumeDraft(owner), ready = await sourceReady(owner, draft.id);
    const forged = { action: "GRANT_IMPORT_CONSENT", operationKey: randomUUID(), expectedRevision: ready.revision,
      payload: { sourceKey: "instagram", identity: { ...instagramIdentity, providerAccountId: "forged" }, scopes: ["public-profile"], consentVersion: "synthetic-v1", granted: true } };
    await expect(applyDraftCommand(owner, draft.id, forged)).rejects.toMatchObject({ code: "SOURCE_IDENTITY_MISMATCH" });
    expect((await getDraft(owner, draft.id)).revision).toBe(ready.revision);
    expect(await prisma.draftCommand.count({ where: { draftId: draft.id, operationKey: `draft:${forged.operationKey}` } })).toBe(0);
    const queued = await queueSourceJob(owner, draft.id, { sourceKey: "instagram", operationKey: randomUUID(), expectedRevision: ready.revision });
    const claim = await startSourceJob(owner, queued.job.id);
    await checkpointSourceJob(owner, queued.job.id, { executionToken: claim.executionToken!, facts: [observed], completedItems: 1, totalItems: 2 });
    const current = await getDraft(owner, draft.id);
    const revoked = await applyDraftCommand(owner, draft.id, { action: "GRANT_IMPORT_CONSENT", operationKey: randomUUID(), expectedRevision: current.revision,
      payload: { sourceKey: "instagram", identity: instagramIdentity, scopes: [], consentVersion: "synthetic-v1", granted: false } });
    expect(revoked.draft.consent.instagram).toBeUndefined();
    expect(revoked.draft.input.facts.instagram).toBeUndefined();
    expect((await completeSourceJob(owner, queued.job.id, { executionToken: claim.executionToken!, facts: [observed], status: "SUCCEEDED", completedItems: 2, totalItems: 2 })).job.status).toBe("STALE");
    await expect(queueSourceJob(owner, draft.id, { sourceKey: "instagram", operationKey: randomUUID(), expectedRevision: revoked.draft.revision })).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
  });

  it("does not allow an unrelated actor, forged execution token or suspended owner to attach facts", async () => {
    const owner = await actor(), draft = await createOrResumeDraft(owner), ready = await sourceReady(owner, draft.id);
    const queued = await queueSourceJob(owner, draft.id, { sourceKey: "instagram", operationKey: randomUUID(), expectedRevision: ready.revision });
    const claim = await startSourceJob(owner, queued.job.id);
    const input = { executionToken: claim.executionToken!, facts: [observed], status: "SUCCEEDED", completedItems: 1, totalItems: 1 };
    await expect(completeSourceJob(await actor(), queued.job.id, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(completeSourceJob(owner, queued.job.id, { ...input, executionToken: "a".repeat(64) })).rejects.toMatchObject({ code: "EXECUTION_NOT_AUTHORIZED" });
    const publicLoader = JSON.stringify(await getDraft(owner, draft.id));
    expect(publicLoader).not.toContain(claim.executionToken!);
    expect(publicLoader).not.toContain("executionTokenHash");
    await prisma.user.update({ where: { id: owner }, data: { active: false } });
    await expect(completeSourceJob(owner, queued.job.id, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await prisma.sourceJob.findUniqueOrThrow({ where: { id: queued.job.id } })).status).toBe("RUNNING");
  });

  it("retains a resumable terminal PARTIAL result and rejects changing observed evidence or regressing progress", async () => {
    const owner = await actor(), draft = await createOrResumeDraft(owner), ready = await sourceReady(owner, draft.id);
    const queued = await queueSourceJob(owner, draft.id, { sourceKey: "instagram", operationKey: randomUUID(), expectedRevision: ready.revision });
    const claim = await startSourceJob(owner, queued.job.id);
    const checkpoint = { executionToken: claim.executionToken!, facts: [observed], completedItems: 1, totalItems: 3 };
    await checkpointSourceJob(owner, queued.job.id, checkpoint);
    await expect(checkpointSourceJob(owner, queued.job.id, { ...checkpoint, facts: [{ ...observed, value: 2000 }] })).rejects.toMatchObject({ code: "IMMUTABLE_OBSERVATION_CONFLICT" });
    await expect(checkpointSourceJob(owner, queued.job.id, { ...checkpoint, completedItems: 0 })).rejects.toMatchObject({ code: "INVALID_PROGRESS" });
    const partial = await completeSourceJob(owner, queued.job.id, { ...checkpoint, status: "PARTIAL" });
    expect(partial.job.status).toBe("PARTIAL");
    expect((await startSourceJob(owner, queued.job.id)).acquired).toBe(false);
    expect((await createOrResumeDraft(owner)).input.facts.instagram[0].value).toBe(1000);
    expect((await createOrResumeDraft(owner)).jobs[0].completedItems).toBe(1);
  });

  it("does not retry an uncertain billed failure using a fresh operation key or refreshed consent", async () => {
    const owner = await actor(), draft = await createOrResumeDraft(owner), ready = await sourceReady(owner, draft.id);
    const queued = await queueSourceJob(owner, draft.id, { sourceKey: "instagram", operationKey: randomUUID(), expectedRevision: ready.revision });
    const claim = await startSourceJob(owner, queued.job.id);
    await failSourceJob(owner, queued.job.id, { executionToken: claim.executionToken!, errorCode: "UNKNOWN_PROVIDER_OUTCOME", billingUncertain: true });
    expect((await startSourceJob(owner, queued.job.id)).acquired).toBe(false);
    let current = await getDraft(owner, draft.id);
    await expect(queueSourceJob(owner, draft.id, { sourceKey: "instagram", operationKey: randomUUID(), expectedRevision: current.revision })).rejects.toMatchObject({ code: "BILLING_RECONCILIATION_REQUIRED" });
    current = (await applyDraftCommand(owner, draft.id, { action: "GRANT_IMPORT_CONSENT", operationKey: randomUUID(), expectedRevision: current.revision,
      payload: { sourceKey: "instagram", identity: instagramIdentity, scopes: ["public-profile"], consentVersion: "synthetic-v2", granted: true } })).draft;
    await expect(queueSourceJob(owner, draft.id, { sourceKey: "instagram", operationKey: randomUUID(), expectedRevision: current.revision })).rejects.toMatchObject({ code: "BILLING_RECONCILIATION_REQUIRED" });
  });

  it("rejects cross-role fields, arbitrary properties, voice mapping and invalid website identities", async () => {
    const owner = await actor("BRAND"), draft = await createOrResumeDraft(owner);
    const command = { action: "SET_ANSWER", operationKey: randomUUID(), expectedRevision: draft.revision, payload: { field: "displayName", value: "Wrong role" } };
    await expect(applyDraftCommand(owner, draft.id, command)).rejects.toMatchObject({ code: "INVALID_FIELD" });
    await expect(applyDraftCommand(owner, draft.id, { ...command, payload: { field: "toString", value: "Cannot call inherited properties" } })).rejects.toMatchObject({ code: "INVALID_FIELD" });
    await expect(applyDraftCommand(owner, draft.id, { ...command, payload: { field: "companyName", value: "شركة أصلية", active: false } })).rejects.toMatchObject({ code: "INVALID_COMMAND" });
    await expect(applyDraftCommand(owner, draft.id, { ...command, channel: "VOICE", payload: { field: "sourceMapping", value: { sourceKey: "instagram", source: "INSTAGRAM", identity: instagramIdentity } } })).rejects.toMatchObject({ code: "EXPLICIT_CONFIRMATION_REQUIRED" });
    await expect(applyDraftCommand(owner, draft.id, { ...command, payload: { field: "sourceMapping", value: { sourceKey: "website", source: "WEBSITE", identity: { platform: null, providerAccountId: null, normalizedHandle: null, confirmedOrigin: "https://user:secret@example.invalid" } } } })).rejects.toMatchObject({ code: "INVALID_SOURCE" });
    expect((await getDraft(owner, draft.id)).revision).toBe(draft.revision);
    const saved = (await applyDraftCommand(owner, draft.id, { ...command, payload: { field: "companyName", value: "شركة أصلية" } })).draft;
    expect(saved.input.answers.companyName).toBe("شركة أصلية");
  });
});
