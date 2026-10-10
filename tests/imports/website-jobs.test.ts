import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { captureOrganizationActor, type OrganizationActor } from "@/lib/organizations/context";
import { applyDraftCommand as applyNativeDraftCommand, createOrResumeDraft as createNativeDraft, getDraft as getNativeDraft } from "@/lib/onboarding/drafts";
import { queueSourceJob as queueNativeSourceJob, startSourceJob, completeSourceJob, runWebsiteSourceJob } from "@/lib/onboarding/jobs";
import type { WebsiteDependencies } from "@/lib/imports/website/types";

const owners: string[] = [], origin = "https://brand.example.com", publicIp = "93.184.216.34";
const sessions = new Map<string, Readonly<OrganizationActor>>();
function serverAuth(userId: string) {
  const actor = sessions.get(userId);
  if (!actor) throw new Error("Owned website fixture is missing its captured native session");
  return actor;
}
// Only interactive requests forward the once-captured real fixture session.
// Accepted worker orchestration and execution-token calls keep their own lane.
const createOrResumeDraft = (userId: string, client: PrismaClient = prisma) => createNativeDraft(userId, { client, serverAuth: serverAuth(userId) });
const getDraft = (userId: string, draftId: string, client: PrismaClient = prisma) => getNativeDraft(userId, draftId, { client, serverAuth: serverAuth(userId) });
const applyDraftCommand = (userId: string, draftId: string, input: unknown, client: PrismaClient = prisma) => applyNativeDraftCommand(userId, draftId, input, { client, serverAuth: serverAuth(userId), channel: "FORM" });
const queueSourceJob = (userId: string, draftId: string, input: unknown, client: PrismaClient = prisma) => queueNativeSourceJob(userId, draftId, input, { client, serverAuth: serverAuth(userId), channel: "FORM" });
async function ready(website = true) {
  const id = randomUUID(); owners.push(id);
  const user = await prisma.user.create({ data: { id, name: "Synthetic website actor", email: `${id}@example.invalid`, passwordHash: "not-a-login-hash", role: website ? "BRAND" : "CREATOR", isTest: true } });
  const token = await openSession(id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Owned website fixture native session did not resolve");
  sessions.set(id, captureOrganizationActor(session));
  let draft = await createOrResumeDraft(id);
  const identity = website ? { platform: null, providerAccountId: null, normalizedHandle: null, confirmedOrigin: origin }
    : { platform: "INSTAGRAM", providerAccountId: "synthetic-account", normalizedHandle: "synthetic", confirmedOrigin: null };
  const sourceKey = website ? "website" : "instagram";
  draft = (await applyDraftCommand(id, draft.id, { action: "SET_ANSWER", operationKey: randomUUID(), expectedRevision: draft.revision,
    payload: { field: "sourceMapping", value: { sourceKey, source: website ? "WEBSITE" : "INSTAGRAM", identity } } })).draft;
  draft = (await applyDraftCommand(id, draft.id, { action: "CONFIRM_ACCOUNT", operationKey: randomUUID(), expectedRevision: draft.revision, payload: { sourceKey, identity } })).draft;
  draft = (await applyDraftCommand(id, draft.id, { action: "GRANT_IMPORT_CONSENT", operationKey: randomUUID(), expectedRevision: draft.revision,
    payload: { sourceKey, identity, scopes: ["public-profile"], consentVersion: "public-website-v1", granted: true } })).draft;
  const queued = await queueSourceJob(id, draft.id, { sourceKey, operationKey: randomUUID(), expectedRevision: draft.revision });
  return { owner: id, draft, job: queued.job, identity, sourceKey };
}
afterAll(async () => { await prisma.user.deleteMany({ where: { id: { in: owners } } }); sessions.clear(); });
function dependencies(): WebsiteDependencies {
  return { capability: { enabled: true, mode: "DEVELOPMENT_FIXTURE", reviewVersion: "synthetic-v1" },
    resolver: { resolve: async () => [{ address: publicIp, family: 4 }] },
    transport: { mode: "DEVELOPMENT_FIXTURE", reviewVersion: "synthetic-v1", get: vi.fn(async () => ({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, peerAddress: publicIp, body: Buffer.from("<html><title>Original brand words</title><body><h1>خدماتنا</h1><p>Original description</p></body></html>") })) },
    accessPolicy: { reviewVersion: "synthetic-v1", check: async (input) => ({ url: input.url, sourceId: input.sourceId, sourceRevision: input.sourceRevision, consentVersion: input.consentVersion, policyVersion: "synthetic-v1", checkedAt: new Date().toISOString(), access: "ALLOW", robots: "ALLOW" }) } };
}
function observation(overrides: Record<string, unknown> = {}) {
  return { fieldKey: "website.pageTitle", value: "Original words", unit: null, source: "PUBLIC_IMPORT", evidenceAt: null,
    retrievedAt: new Date().toISOString(), sourceHash: "a".repeat(64), sourceReference: `${origin}/`, ...overrides };
}

describe("trusted website jobs on guarded disposable PostgreSQL", () => {
  it("reports unavailable without a fake attempt or stuck queued job, and replays without I/O", async () => {
    const source = await ready();
    const result = await runWebsiteSourceJob(source.owner, source.job.id);
    expect(result.job).toMatchObject({ status: "FAILED", errorCode: "CAPABILITY_UNAVAILABLE", attempts: 0, startedAt: null, completedItems: 0 });
    expect((await runWebsiteSourceJob(source.owner, source.job.id)).replayed).toBe(true);
    expect((await getDraft(source.owner, source.draft.id)).input.facts.website).toBeUndefined();
  });
  it("authorizes the actor before lookup/capability, completes only private text proposals and never repeats acquisition", async () => {
    const source = await ready(), other = await ready(), deps = dependencies();
    await expect(runWebsiteSourceJob(other.owner, source.job.id, deps)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const result = await runWebsiteSourceJob(source.owner, source.job.id, deps);
    expect(result.job).toMatchObject({ status: "SUCCEEDED", attempts: 1, completedItems: 1, totalItems: 1 });
    const facts = (await getDraft(source.owner, source.draft.id)).input.facts.website;
    expect(facts.length).toBeGreaterThan(0);
    expect(facts[0]).toMatchObject({ source: "PUBLIC_IMPORT", evidenceAt: null, reviewStatus: "PROPOSED", visibility: "PRIVATE", sourceReference: `${origin}/` });
    expect(facts[0].retrievedAt).toMatch(/Z$/); expect(facts[0].sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect((await runWebsiteSourceJob(source.owner, source.job.id, deps)).replayed).toBe(true);
    expect(deps.transport!.get).toHaveBeenCalledTimes(1);
  });
  it("accepts an unknown original date only for scoped website text, keeping actual retrieval separate", async () => {
    const source = await ready(), running = await startSourceJob(source.owner, source.job.id), fact = observation();
    expect((await completeSourceJob(source.owner, source.job.id, { executionToken: running.executionToken, facts: [fact], status: "SUCCEEDED", completedItems: 1, totalItems: 1 })).job.status).toBe("SUCCEEDED");
    expect((await getDraft(source.owner, source.draft.id)).input.facts.website[0]).toMatchObject(fact);
  });
  it("rejects nullable social metrics and website metric/proof/source/date/hash/citation forgery", async () => {
    const social = await ready(false), socialRun = await startSourceJob(social.owner, social.job.id);
    await expect(completeSourceJob(social.owner, social.job.id, { executionToken: socialRun.executionToken, facts: [{ fieldKey: "followers", value: 100, source: "SELF_REPORTED", evidenceAt: null, unit: "accounts", sourceReference: null }], status: "SUCCEEDED", completedItems: 1, totalItems: 1 })).rejects.toThrow();
    const website = await ready(), running = await startSourceJob(website.owner, website.job.id);
    for (const override of [{ fieldKey: "followers", value: 100 }, { fieldKey: "website.ownershipVerified", value: true }, { source: "API" }, { evidenceAt: "2026-10-01T00:00:00.000Z" }, { retrievedAt: "2099-01-01T00:00:00.000Z" }, { retrievedAt: "2020-01-01T00:00:00.000Z" }, { sourceHash: "not-a-hash" }, { sourceReference: "https://other.example.com/" }, { sourceReference: `${origin}/?token=private` }]) {
      await expect(completeSourceJob(website.owner, website.job.id, { executionToken: running.executionToken, facts: [observation(override)], status: "SUCCEEDED", completedItems: 1, totalItems: 1 })).rejects.toThrow();
    }
    // Existing dated payload syntax must not let a website job invent API/proof.
    await expect(completeSourceJob(website.owner, website.job.id, { executionToken: running.executionToken, facts: [{ fieldKey: "ownershipVerified", value: true, source: "API", evidenceAt: "2026-10-01T00:00:00.000Z", unit: null, sourceReference: `${origin}/` }], status: "SUCCEEDED", completedItems: 1, totalItems: 1 })).rejects.toThrow();
  });
  it("stales a completed draft rather than attaching late observations", async () => {
    const source = await ready(), running = await startSourceJob(source.owner, source.job.id);
    await prisma.onboardingDraft.update({ where: { id: source.draft.id }, data: { completedAt: new Date() } });
    const result = await completeSourceJob(source.owner, source.job.id, { executionToken: running.executionToken,
      facts: [{ fieldKey: "website.pageTitle", value: "Old payload", unit: null, source: "PUBLIC_IMPORT", evidenceAt: "2026-10-01T00:00:00.000Z", sourceReference: `${origin}/` }], status: "SUCCEEDED", completedItems: 1, totalItems: 1 });
    expect(result.job.status).toBe("STALE");
    expect((await getDraft(source.owner, source.draft.id)).input.facts.website).toBeUndefined();
  });
  it("a revoked consent during acquisition preserves the stale job without adopting any page", async () => {
    const source = await ready(), deps = dependencies(), get = deps.transport!.get;
    deps.transport!.get = async (input) => {
      const draft = await getDraft(source.owner, source.draft.id);
      await applyDraftCommand(source.owner, draft.id, { action: "GRANT_IMPORT_CONSENT", operationKey: randomUUID(), expectedRevision: draft.revision,
        payload: { sourceKey: source.sourceKey, identity: source.identity, scopes: ["public-profile"], consentVersion: "public-website-v1", granted: false } });
      return get(input);
    };
    expect((await runWebsiteSourceJob(source.owner, source.job.id, deps)).job.status).toBe("STALE");
    expect((await getDraft(source.owner, source.draft.id)).input.facts.website).toBeUndefined();
  });
});
