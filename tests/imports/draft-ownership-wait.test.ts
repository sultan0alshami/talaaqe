import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { applyDraftCommand, createOrResumeDraft, getDraft } from "@/lib/onboarding/drafts";
import { completeSourceJob, queueSourceJob, startSourceJob } from "@/lib/onboarding/jobs";

const users: string[] = [], origin = "https://brand.example.com";
afterEach(async () => { await prisma.user.deleteMany({ where: { id: { in: users.splice(0) } } }); });
function latch() {
  let release!: () => void;
  return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
}
async function fixture() {
  const owner = randomUUID(), replacement = randomUUID(); users.push(owner, replacement);
  await prisma.user.createMany({ data: [owner, replacement].map(id => ({ id, name: "Synthetic draft ownership wait", email: `${id}@example.invalid`, passwordHash: "not-a-login", role: "BRAND" as const, isTest: true })) });
  let draft = await createOrResumeDraft(owner);
  const identity = { platform: null, providerAccountId: null, normalizedHandle: null, confirmedOrigin: origin };
  draft = (await applyDraftCommand(owner, draft.id, { action: "SET_ANSWER", operationKey: randomUUID(), expectedRevision: draft.revision,
    payload: { field: "sourceMapping", value: { sourceKey: "website", source: "WEBSITE", identity } } })).draft;
  draft = (await applyDraftCommand(owner, draft.id, { action: "CONFIRM_ACCOUNT", operationKey: randomUUID(), expectedRevision: draft.revision, payload: { sourceKey: "website", identity } })).draft;
  draft = (await applyDraftCommand(owner, draft.id, { action: "GRANT_IMPORT_CONSENT", operationKey: randomUUID(), expectedRevision: draft.revision,
    payload: { sourceKey: "website", identity, scopes: ["public-profile"], consentVersion: "synthetic-public-v1", granted: true } })).draft;
  const queued = await queueSourceJob(owner, draft.id, { sourceKey: "website", operationKey: randomUUID(), expectedRevision: draft.revision });
  const running = await startSourceJob(owner, queued.job.id);
  return { owner, replacement, draft, jobId: queued.job.id, executionToken: running.executionToken! };
}

describe("draft authorization after an actual PostgreSQL row-lock wait", () => {
  it.each(["OWNER", "KIND"] as const)("withdraws old-owner GET access after concurrent draft %s reassignment", async change => {
    const source = await fixture(), held = latch(), release = latch(), selected = latch();
    const client = prisma.$extends({ query: { onboardingDraft: { async findFirst({ args, query }) {
      const row = await query(args);
      if (args.where?.id === source.draft.id && args.where?.userId === source.owner) selected.release();
      return row;
    } } } }) as unknown as PrismaClient;
    const holding = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "OnboardingDraft" WHERE id=${source.draft.id} FOR UPDATE`;
      held.release(); await release.promise;
      await tx.onboardingDraft.update({ where: { id: source.draft.id }, data: change === "OWNER" ? { userId: source.replacement } : { kind: "CREATOR" } });
    }, { timeout: 10_000 });
    try {
      await held.promise;
      const operation = getDraft(source.owner, source.draft.id, client).then(value => ({ code: "EXPOSED", value }), (error: unknown) => error);
      await selected.promise; release.release(); await holding;
      expect(await operation).toMatchObject({ code: "NOT_FOUND", status: 404 });
    } finally { release.release(); await holding; }
  });
  it.each(["OWNER", "KIND"] as const)("refuses website fact adoption after concurrent draft %s reassignment", async change => {
    const source = await fixture(), held = latch(), release = latch(), selected = latch();
    const client = prisma.$extends({ query: { onboardingDraft: { async findFirst({ args, query }) {
      const row = await query(args);
      if (args.where?.id === source.draft.id && args.where?.userId === source.owner) selected.release();
      return row;
    } } } }) as unknown as PrismaClient;
    const holding = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "OnboardingDraft" WHERE id=${source.draft.id} FOR UPDATE`;
      held.release(); await release.promise;
      await tx.onboardingDraft.update({ where: { id: source.draft.id }, data: change === "OWNER" ? { userId: source.replacement } : { kind: "CREATOR" } });
    }, { timeout: 10_000 });
    try {
      await held.promise;
      const operation = completeSourceJob(source.owner, source.jobId, { executionToken: source.executionToken,
        facts: [{ fieldKey: "website.pageTitle", value: "Synthetic old actor's unauthorized observation", unit: null, source: "PUBLIC_IMPORT", evidenceAt: null,
          retrievedAt: new Date().toISOString(), sourceHash: "a".repeat(64), sourceReference: `${origin}/` }], status: "SUCCEEDED", completedItems: 1, totalItems: 1 }, client)
        .then(value => ({ code: "ADOPTED", value }), (error: unknown) => error);
      await selected.promise; release.release(); await holding;
      expect(await operation).toMatchObject({ code: "NOT_FOUND", status: 404 });
      const draft = await prisma.onboardingDraft.findUniqueOrThrow({ where: { id: source.draft.id } });
      expect(JSON.stringify(draft.input)).not.toContain("unauthorized observation");
      expect((await prisma.sourceJob.findUniqueOrThrow({ where: { id: source.jobId } })).status).toBe("RUNNING");
    } finally { release.release(); await holding; }
  });
});
