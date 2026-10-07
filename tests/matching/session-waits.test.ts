import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import type { OrganizationActor } from "@/lib/organizations/context";
import { createCampaign, applyCampaignMutation, generateCampaignBrief, approveCampaignBrief } from "@/lib/campaigns/service";
import { getCampaignMatches, runCampaignMatching, decideCampaignMatch } from "@/lib/matching/persistence";
import { resolveCampaignPolicyReview, reviewedMatchingPolicies } from "@/lib/policies";
import { uploadSyntheticEvidence, cleanupReviewedEvidence } from "../helpers/reviewed-evidence";
import { campaignFields } from "../campaigns/fixtures";

// Independent native matching-session witnesses. Root alone runs the guarded
// target. Signed records, actual matching reads/mutations and PG waits remain
// real; no Next/auth/provider/producer/Date mock or test-module fixture import.
// An owned draft has no run: authorized absence is a positive null, rather than
// a fabricated matching output or any live matching/provider acceptance claim.
const users = new Set<string>(), campaigns = new Set<string>();
const policies = new Set<string>();
afterEach(async () => {
  await prisma.matchDecisionRecord.deleteMany({ where: { campaignId: { in: [...campaigns] } } });
  await prisma.campaign.deleteMany({ where: { id: { in: [...campaigns] } } });
  await prisma.policyVersion.deleteMany({ where: { id: { in: [...policies] } } });
  await cleanupReviewedEvidence(prisma, [...users], "test");
  await prisma.brand.deleteMany({ where: { userId: { in: [...users] } } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
  if (users.size) await prisma.outboxEvent.deleteMany({ where: { OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await prisma.user.deleteMany({ where: { id: { in: [...users] } } }); users.clear(); campaigns.clear(); policies.clear();
});
async function fixture() {
  const id = randomUUID(); users.add(id);
  const user = await prisma.user.create({ data: { id, role: "BRAND", active: true, isTest: true,
    name: "Synthetic native matching session", email: `${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  await prisma.brand.create({ data: { userId: id, slug: "matching-wait-" + id.replace(/-/g, "").slice(0, 16), name: "Synthetic matching session company", countryCode: "KW", isTest: true } });
  const made = await createCampaign(id, { operationKey: randomUUID(), fields: { title: "PRIVATE SYNTHETIC MATCHING SESSION DRAFT" } }); campaigns.add(made.campaign.id);
  const token = await openSession(id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Synthetic actual matching session did not resolve");
  const actor: OrganizationActor = { userId: session.userId, role: session.role, sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  return { user, campaign: made.campaign, token, actor };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const nativeOptions = (actor: OrganizationActor) => ({ client: prisma, serverAuth: actor });
async function snapshot(f: Fixture) {
  return { campaign: await prisma.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } }),
    runs: await prisma.matchRun.findMany({ where: { campaignId: f.campaign.id }, orderBy: { id: "asc" } }),
    commands: await prisma.matchCommand.findMany({ where: { campaignId: f.campaign.id }, orderBy: { id: "asc" } }),
    decisions: await prisma.matchDecisionRecord.findMany({ where: { campaignId: f.campaign.id }, orderBy: { id: "asc" } }) };
}
function latch<T>() { let resolve!: (value: T | PromiseLike<T>) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
async function holdMatchRunReads() {
  const peer = new PrismaClient(), monitor = new PrismaClient(), ready = latch<number>(), release = latch<void>(), stop = new AbortController();
  const holding = peer.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout='4s'`;
    await tx.$executeRaw`LOCK TABLE "MatchRun" IN ACCESS EXCLUSIVE MODE`;
    const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
    ready.resolve(rows[0]!.pid); await release.promise;
  }, { maxWait: 5000, timeout: 12000 }); void holding.catch(() => {});
  let pid: number;
  try { pid = await Promise.race([ready.promise, holding.then(() => { throw new Error("Matching blocker finished before acquiring its native table lock"); })]); }
  catch (error) { release.resolve(); await holding.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); throw error; }
  let waiting: Promise<number> | undefined;
  return { holding, release: () => release.resolve(), wait() { waiting = (async () => {
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline) {
      if (stop.signal.aborted) throw new Error("Native matching wait observer cancelled");
      const rows = await monitor.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid)) AND query LIKE '%"MatchRun"%' AND query ILIKE '%SELECT%'`;
      if (rows.length) return rows[0]!.pid; await delay(20);
    }
    throw new Error("Matching read did not reach the actual native MatchRun SELECT wait");
  })(); return waiting; }, async close() { release.resolve(); stop.abort(); await holding.catch(() => {}); await waiting?.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); } };
}
async function approvedFixture() {
  const f = await fixture(), reviewerId = randomUUID(), reviewAt = new Date(Date.now() - 1000); users.add(reviewerId);
  await prisma.user.create({ data: { id: reviewerId, role: "ADMIN", active: true, isTest: true, name: "Synthetic native policy reviewer",
    email: `${reviewerId}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: reviewAt } });
  const evidence = await uploadSyntheticEvidence(prisma, reviewerId, "LEGAL_POLICY_REVIEW", "test", reviewAt), policyId = randomUUID(); policies.add(policyId);
  // Actual byte-backed guarded policy row, deliberately synthetic and never
  // legal/provider acceptance. FI avoids another task fixture's market scope.
  await prisma.policyVersion.create({ data: { id: policyId, kind: "MARKET", countryCodes: ["FI"], status: "VERIFIED", evidenceAssetId: evidence.id,
    reviewedBy: reviewerId, reviewedAt: reviewAt, createdAt: new Date(reviewAt.getTime() - 60000), expiresAt: new Date(campaignFields.period.endsAt),
    content: { schemaVersion: 1, kind: "MARKET", marketCountryCode: "FI", brandCountryCodes: ["KW"], creatorCountryCodes: ["FI"], licenceRequired: false,
      licencePolicyId: null, reviewReference: "Synthetic native session-boundary policy only", reviewedBasis: "FOUNDER_APPROVED_LEGAL_REVIEW" } } });
  const changed = await applyCampaignMutation(f.user.id, f.campaign.id, { operationKey: randomUUID(), expectedRevision: f.campaign.revision, action: "UPDATE_FIELDS",
    payload: { patch: { ...campaignFields, marketCountryCodes: ["FI"] } } }, undefined, { channel: "FORM", serverAuth: f.actor });
  const generated = await generateCampaignBrief(f.user.id, f.campaign.id, { operationKey: randomUUID(), expectedRevision: changed.campaign.revision }, undefined, f.actor);
  const approved = await approveCampaignBrief(f.user.id, f.campaign.id, { operationKey: randomUUID(), expectedRevision: generated.campaign.revision,
    briefId: generated.brief.id, expectedBriefVersion: generated.brief.version }, undefined, { channel: "FORM", serverAuth: f.actor, policyReviewResolver: resolveCampaignPolicyReview });
  expect(approved.brief.content.policyReview?.mandatoryPolicyVersionIds).toEqual([policyId]);
  return { ...f, campaign: approved.campaign, command: { operationKey: randomUUID(), expectedCampaignRevision: approved.campaign.revision, expectedBriefVersion: approved.brief.version } };
}
async function holdMatchCommands(operation: "INSERT" | "SELECT") {
  const peer = new PrismaClient(), monitor = new PrismaClient(), ready = latch<number>(), release = latch<void>(), stop = new AbortController();
  const holding = peer.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout='4s'`;
    if (operation === "INSERT") await tx.$executeRaw`LOCK TABLE "MatchCommand" IN SHARE MODE`;
    else await tx.$executeRaw`LOCK TABLE "MatchCommand" IN ACCESS EXCLUSIVE MODE`;
    const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`; ready.resolve(rows[0]!.pid); await release.promise;
  }, { maxWait: 5000, timeout: 12000 }); void holding.catch(() => {});
  let pid: number;
  try { pid = await Promise.race([ready.promise, holding.then(() => { throw new Error("Matching command blocker finished before its native lock"); })]); }
  catch (error) { release.resolve(); await holding.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); throw error; }
  let waiting: Promise<number> | undefined;
  return { holding, release: () => release.resolve(), wait() { waiting = (async () => {
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline) {
      if (stop.signal.aborted) throw new Error("Matching command observer cancelled");
      const rows = await monitor.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'
        AND ${pid}=ANY(pg_blocking_pids(pid)) AND query LIKE '%"MatchCommand"%' AND query ILIKE ${`%${operation}%`}`;
      if (rows.length) return rows[0]!.pid; await delay(20);
    }
    throw new Error("Matching did not reach its actual native command wait");
  })(); return waiting; }, async close() { release.resolve(); stop.abort(); await holding.catch(() => {}); await waiting?.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); } };
}

describe("matching current/final native server sessions", () => {
  it("requires the exact live signed session before read/run/decision and rejects revoked, expired, changed-version or foreign signed actors without effects", async () => {
    for (const scenario of ["revoked", "expired", "changed-version", "foreign-signed-session"] as const) {
      const f = await fixture(), before = await snapshot(f); expect(await getCampaignMatches(f.user.id, f.campaign.id, undefined, nativeOptions(f.actor))).toBeNull();
      let actor = f.actor;
      if (scenario === "revoked") await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { revokedAt: new Date() } });
      if (scenario === "expired") await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { expiresAt: new Date(Date.now() - 1) } });
      if (scenario === "changed-version") await prisma.user.update({ where: { id: f.user.id }, data: { sessionVersion: { increment: 1 } } });
      if (scenario === "foreign-signed-session") actor = (await fixture()).actor;
      else expect(await resolveSession(f.token)).toBeNull();
      const options = nativeOptions(actor), run = { operationKey: randomUUID(), expectedCampaignRevision: f.campaign.revision, expectedBriefVersion: 1 },
        decision = { operationKey: randomUUID(), creatorId: randomUUID(), runId: randomUUID(), expectedBriefVersion: 1, expectedDecisionRevision: 0, decision: "SAVED" };
      for (const action of [() => getCampaignMatches(f.user.id, f.campaign.id, undefined, options), () => runCampaignMatching(f.user.id, f.campaign.id, run, options), () => decideCampaignMatch(f.user.id, f.campaign.id, decision, options)]) {
        await expect(action()).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
      }
      expect(await snapshot(f)).toEqual(before);
    }
  });

  it("checks final actual-clock expiry after a genuine native matching SELECT wait before returning even authorized null absence", async () => {
    const f = await fixture(), before = await snapshot(f), expiresAt = new Date(Date.now() + 2500);
    expect(await getCampaignMatches(f.user.id, f.campaign.id, undefined, nativeOptions(f.actor))).toBeNull();
    await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { expiresAt } }); expect(await resolveSession(f.token)).not.toBeNull();
    const held = await holdMatchRunReads(), reading = getCampaignMatches(f.user.id, f.campaign.id, undefined, nativeOptions(f.actor)); void reading.catch(() => {});
    let settled = false; void reading.then(() => { settled = true; }, () => { settled = true; });
    try {
      expect(await Promise.race([held.wait(), reading.then(() => { throw new Error("Matching read completed before its actual native MatchRun wait"); })])).toBeGreaterThan(0);
      expect(Date.now()).toBeLessThan(expiresAt.getTime());
      while (Date.now() <= expiresAt.getTime()) await delay(Math.min(50, expiresAt.getTime() - Date.now() + 1));
      expect(await resolveSession(f.token)).toBeNull(); expect(settled).toBe(false);
      held.release(); await held.holding;
      await expect(reading).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" }); expect(await snapshot(f)).toEqual(before);
    } finally { await held.close(); await reading.catch(() => {}); }
  }, 15000);

  it("rolls back a real matching RUN on final expiry after journal waiting and denies an actual committed RUN replay after SELECT waiting", async () => {
    const f = await approvedFixture(), before = await snapshot(f), options = { ...nativeOptions(f.actor), policyReader: reviewedMatchingPolicies };
    const expiresAt = new Date(Date.now() + 2500); await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { expiresAt } });
    const held = await holdMatchCommands("INSERT"), writing = runCampaignMatching(f.user.id, f.campaign.id, f.command, options); void writing.catch(() => {});
    try {
      expect(await Promise.race([held.wait(), writing.then(() => { throw new Error("Real matching RUN completed before its native journal INSERT wait"); })])).toBeGreaterThan(0);
      expect(Date.now()).toBeLessThan(expiresAt.getTime()); while (Date.now() <= expiresAt.getTime()) await delay(Math.min(50, expiresAt.getTime() - Date.now() + 1));
      expect(await resolveSession(f.token)).toBeNull(); held.release(); await held.holding;
      await expect(writing).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 }); expect(await snapshot(f)).toEqual(before);
    } finally { await held.close(); await writing.catch(() => {}); }
    // Genuine renewal allows a real producer to commit once with the original
    // unconsumed key; no MatchRun/result/receipt is minted directly by a test.
    const currentUser = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } }), token = await openSession(currentUser.id, currentUser.sessionVersion, currentUser.passwordHash), session = await resolveSession(token);
    if (!session) throw new Error("Synthetic matching renewal did not resolve");
    const actor: OrganizationActor = { userId: session.userId, role: session.role, sessionId: session.sessionId, sessionVersion: session.sessionVersion };
    const renewed = { ...nativeOptions(actor), policyReader: reviewedMatchingPolicies }, committed = await runCampaignMatching(f.user.id, f.campaign.id, f.command, renewed);
    expect(committed.replayed).toBe(false); expect(await prisma.matchRun.count({ where: { campaignId: f.campaign.id } })).toBe(1);
    expect(await prisma.matchCommand.count({ where: { campaignId: f.campaign.id, operationKey: f.command.operationKey } })).toBe(1);
    const committedState = await snapshot(f), replayExpiry = new Date(Date.now() + 2500);
    await prisma.authSession.update({ where: { id: actor.sessionId }, data: { expiresAt: replayExpiry } });
    const blocked = await holdMatchCommands("SELECT"), replaying = runCampaignMatching(f.user.id, f.campaign.id, f.command, renewed); void replaying.catch(() => {});
    try {
      expect(await Promise.race([blocked.wait(), replaying.then(() => { throw new Error("Real matching replay completed before its native journal SELECT wait"); })])).toBeGreaterThan(0);
      expect(Date.now()).toBeLessThan(replayExpiry.getTime()); while (Date.now() <= replayExpiry.getTime()) await delay(Math.min(50, replayExpiry.getTime() - Date.now() + 1));
      expect(await resolveSession(token)).toBeNull(); blocked.release(); await blocked.holding;
      await expect(replaying).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 }); expect(await snapshot(f)).toEqual(committedState);
      expect(await prisma.matchRun.count({ where: { campaignId: f.campaign.id } })).toBe(1);
    } finally { await blocked.close(); await replaying.catch(() => {}); }
  }, 25000);
});
