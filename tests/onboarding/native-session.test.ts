import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { captureOrganizationActor, type OrganizationActor } from "@/lib/organizations/context";
import { applyDraftCommand, canonicalHash, createOrResumeDraft, getDraft, type DraftDTO } from "@/lib/onboarding/drafts";
import { profileCommand, profileForOwner } from "@/lib/onboarding/profiles";
import { completeSourceJob, queueSourceJob, startSourceJob } from "@/lib/onboarding/jobs";
import type { OnboardingReadOptions, OnboardingCommandOptions } from "@/lib/onboarding/session";

// Exactly three native groups. Root adopts/runs against the guarded test target.
// JWT/User/AuthSession and PostgreSQL blocking/writes are genuine owned synthetic
// fixtures, never live identity/provider/publication proof. No auth/time/query
// mock, registered .test import, source DB or reset is used.
// First missing-metadata cases exercise the CURRENT bare-userId source and can
// establish its genuine accepted/wrong400/404 vs401 baseline. Reflect.apply only
// permits compiling the future typed options contract before source activation;
// it is not a legacy service compatibility path. Later wait/expiry cases require
// the adopted options API; a preactivation argument-shape error is not auth RED.
const users = new Set<string>();
const key = () => randomUUID(), words = "كلماتي الأصلية للاختبار Native original words";
const instagram = { platform: "INSTAGRAM", providerAccountId: "synthetic-session-account", normalizedHandle: "session_account", confirmedOrigin: null };
beforeAll(async () => {
  const taskId = process.env.INFAME_TASK_ID;
  if (!taskId || !/^infame_[a-f0-9]{12}$/.test(taskId) || process.env.INFAME_ENV !== "test" || process.env.NODE_ENV === "production") throw new Error("Onboarding session witnesses require the guarded test task");
  const rows = await prisma.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]?.id !== taskId || rows[0]?.kind !== "test" || rows[0]?.db !== taskId + "_test" || rows[0]?.host !== "127.0.0.1") throw new Error("Onboarding session disposable identity mismatch");
});
afterEach(async () => {
  if (users.size) await prisma.outboxEvent.deleteMany({ where: { OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await prisma.creator.deleteMany({ where: { userId: { in: [...users] } } });
  await prisma.brand.deleteMany({ where: { userId: { in: [...users] } } });
  await prisma.user.deleteMany({ where: { id: { in: [...users] } } }); users.clear();
});
async function signed(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const token = await openSession(user.id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Owned onboarding native session did not resolve");
  return { actor: captureOrganizationActor(session), token };
}
async function fixture(role: "CREATOR" | "BRAND" | "ADMIN" = "CREATOR", withProfile = true) {
  const id = key(), suffix = key().replaceAll("-", "").slice(0, 16); users.add(id);
  const user = await prisma.user.create({ data: { id, name: "Synthetic onboarding native session", email: `${id}@example.invalid`, passwordHash: "not-a-login", role, active: true, isTest: true } });
  if (withProfile && role === "CREATOR") await prisma.creator.create({ data: { userId: id, handle: "ns_" + suffix, displayName: words, bio: words, state: "PRIVATE", isTest: true } });
  if (withProfile && role === "BRAND") await prisma.brand.create({ data: { userId: id, slug: "ns-" + suffix, name: words, description: words, state: "PRIVATE", isTest: true } });
  // Structural owned draft establishes the baseline without calling an
  // interactive export to authorize fixture setup. It is not public evidence.
  const draft = await prisma.onboardingDraft.create({ data: { userId: id, kind: role, input: { answers: { privateCanary: words } } } });
  return { user, draft, suffix, ...await signed(id) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function invoke<F extends (...args: never[]) => unknown>(fn: F, args: unknown[]): Promise<Awaited<ReturnType<F>>> {
  return await Reflect.apply(fn, undefined, args) as Awaited<ReturnType<F>>;
}
function opts(f: Pick<Fixture, "actor">, client: PrismaClient = prisma, channel: "FORM" | "VOICE" = "FORM"): OnboardingCommandOptions { return { client, serverAuth: f.actor, channel }; }
function readOpts(f: Pick<Fixture, "actor">, client: PrismaClient = prisma): OnboardingReadOptions { return { client, serverAuth: f.actor }; }
async function read(f: Fixture): Promise<DraftDTO> {
  const draft = await invoke(getDraft, [f.user.id, f.draft.id, readOpts(f)]);
  if (!draft) throw new Error("Exact owned draft unexpectedly returned null");
  return draft;
}
function profilePayload(f: Fixture) {
  return f.user.role === "CREATOR"
    ? { displayName: words, infameHandle: "ns_" + f.suffix, bio: words, location: { countryCode: "EG", cityKey: null, cityLabel: null, timeZone: "Africa/Cairo" }, languages: ["ar"], dialects: [], nicheSlugs: ["tech"], fameIndustries: [], contentStyles: [], preferredCurrency: "KWD", minimumMinor: "12005", availability: { status: "UNKNOWN", startsAt: null, endsAt: null }, travelWilling: false, ratesVisibility: "PRIVATE", rates: [{ platform: "INSTAGRAM", format: "REEL", currencyCode: "KWD", amountMinor: "12005" }], primarySourceKey: null }
    : { companyName: words, brandSlug: "ns-" + f.suffix, description: words, location: { countryCode: "EG", cityKey: null, cityLabel: null, timeZone: "Africa/Cairo" }, noWebsite: true, website: null, contactName: "ممثل للاختبار", representativeRole: "مالك", targetMarkets: ["SA", "EG"], languages: ["ar"], preferredCurrency: "EGP" };
}
function profileInput(f: Fixture, expectedRevision: number) { return { operationKey: key(), expectedRevision, action: "SAVE_PROFILE", payload: profilePayload(f) }; }
async function image(userId: string) {
  const drafts = await prisma.onboardingDraft.findMany({ where: { userId }, orderBy: { id: "asc" } }), ids = drafts.map(row => row.id);
  const data = { drafts,
    receipts: await prisma.draftCommand.findMany({ where: { draftId: { in: ids } }, orderBy: { id: "asc" } }),
    jobs: await prisma.sourceJob.findMany({ where: { draftId: { in: ids } }, orderBy: { id: "asc" } }),
    creators: await prisma.creator.findMany({ where: { userId }, include: { accounts: true, rates: true, portfolios: true }, orderBy: { id: "asc" } }),
    brands: await prisma.brand.findMany({ where: { userId }, include: { portfolios: true }, orderBy: { id: "asc" } }),
    outbox: await prisma.outboxEvent.findMany({ where: { payload: { path: ["actorUserId"], equals: userId } }, orderBy: { id: "asc" } }) };
  // Compare hashes only so failed matchers cannot dump original private fixture
  // words or job execution tokens. Prisma BigInts are normalized for this image.
  return createHash("sha256").update(JSON.stringify(data, (_name, value: unknown) => typeof value === "bigint" ? value.toString() : value)).digest("hex");
}
async function settled(operation: () => Promise<unknown>) {
  try { await operation(); return { accepted: true, code: "ACCEPTED", status: 200 }; }
  catch (error) { const detail = error as { code?: string; status?: number }; return { accepted: false, code: detail.code ?? "OTHER_ERROR", status: detail.status ?? 0 }; }
}
function six(f: Fixture, metadata?: unknown, client: PrismaClient = prisma, malformed = false) {
  const options = { client, serverAuth: metadata }, draftInput = malformed ? { malformed: true } : { operationKey: key(), expectedRevision: f.draft.revision, action: "SAVE_DRAFT", payload: {} };
  const args = (legacy: unknown[]) => metadata === undefined ? legacy : [...legacy, options];
  return [
    () => invoke(createOrResumeDraft, args([f.user.id])),
    () => invoke(getDraft, args([f.user.id, f.draft.id])),
    () => invoke(applyDraftCommand, args([f.user.id, f.draft.id, draftInput])),
    () => invoke(profileCommand, args([f.user.id, f.draft.id, malformed ? { malformed: true } : profileInput(f, f.draft.revision)])),
    () => invoke(profileForOwner, args([f.user.id])),
    () => invoke(queueSourceJob, args([f.user.id, f.draft.id, malformed ? { malformed: true } : { operationKey: key(), expectedRevision: f.draft.revision, sourceKey: "instagram" }])),
  ];
}
async function deniedSix(f: Fixture, metadata?: unknown, status = 401, code = "UNAUTHENTICATED", malformed = false) {
  const results = [];
  for (const operation of six(f, metadata, prisma, malformed)) results.push(await settled(operation));
  expect(results).toEqual(Array.from({ length: 6 }, () => ({ accepted: false, code, status })));
}
async function sourceReady(f: Fixture, website = false): Promise<DraftDTO> {
  const identity = website ? { platform: null, providerAccountId: null, normalizedHandle: null, confirmedOrigin: "https://native-source.example.com" } : instagram;
  const sourceKey = website ? "website" : "instagram", source = website ? "WEBSITE" : "INSTAGRAM";
  let draft = await read(f);
  for (const [action, payload] of [
    ["SET_ANSWER", { field: "sourceMapping", value: { sourceKey, source, identity } }],
    ["CONFIRM_ACCOUNT", { sourceKey, identity }],
    ["GRANT_IMPORT_CONSENT", { sourceKey, identity, scopes: ["public-profile"], consentVersion: "native-session-v1", granted: true }],
  ] as const) draft = (await invoke(applyDraftCommand, [f.user.id, f.draft.id, { operationKey: key(), expectedRevision: draft.revision, action, payload }, opts(f)])).draft;
  return draft;
}
function latch() { let release!: () => void; return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() }; }
async function blockedBy(pid: number, table: "User" | "AuthSession" | "OutboxEvent") {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ pid: number }>>`SELECT a.pid FROM pg_stat_activity a WHERE a.datname=current_database() AND a.wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(a.pid)) AND a.query LIKE ${`%"${table}"%`}`;
    if (rows.length) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Interactive onboarding never reached its actual held PostgreSQL lock");
}

describe("interactive onboarding native sessions", () => {
  it("defaults all six exports to401 before input/private work, keeps real BRAND/CREATOR hashes and renewed-session exact replay", async () => {
    const first = await fixture(), before = await image(first.user.id);
    await deniedSix(first); // Genuine current bare-userId baseline FIRST.
    expect(await image(first.user.id)).toBe(before);
    const other = await fixture();
    const badTuples: unknown[] = [null, {}, { ...first.actor, sessionId: "malformed" }, { ...first.actor, sessionVersion: first.actor.sessionVersion + 1 },
      { ...first.actor, sessionId: randomBytes(32).toString("base64url") }, { ...first.actor, sessionId: other.actor.sessionId }, other.actor];
    const sql: string[] = [], observed = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
    observed.$on("query", event => { sql.push(event.query); }); // Never params or original words.
    try {
      for (const metadata of badTuples) {
        for (const operation of six(first, metadata, observed, true)) expect(await settled(operation)).toEqual({ accepted: false, code: "UNAUTHENTICATED", status: 401 });
      }
      const domainReads = sql.filter(statement => /\bSELECT\b/i.test(statement) && /"(?:OnboardingDraft|SourceJob|DraftCommand|Creator|Brand|PortfolioVersion|BrandPortfolioVersion)"/.test(statement));
      expect(domainReads.some(statement => /"(?:input|transcript|consent|identity|result|content|bio|description|displayName)"/.test(statement))).toBe(false);
    } finally { await observed.$disconnect(); }
    expect(await image(first.user.id)).toBe(before);
    const admin = await fixture("ADMIN"); await deniedSix(admin, admin.actor, 403, "FORBIDDEN", true);
    const noProfile = await fixture("BRAND", false);
    expect(await invoke(profileForOwner, [noProfile.user.id, readOpts(noProfile)])).toBeNull();
    // The new internal null selector is a read, including a genuinely empty
    // owner/kind slot. Delete only this fresh unused owned structural fixture.
    await prisma.onboardingDraft.delete({ where: { id: noProfile.draft.id } });
    expect(await invoke(getDraft, [noProfile.user.id, null, readOpts(noProfile)])).toBeNull();
    expect(await prisma.onboardingDraft.count({ where: { userId: noProfile.user.id } })).toBe(0);
    await prisma.authSession.update({ where: { id: noProfile.actor.sessionId }, data: { revokedAt: new Date() } });
    await expect(invoke(profileForOwner, [noProfile.user.id, readOpts(noProfile)])).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    await expect(invoke(getDraft, [noProfile.user.id, null, readOpts(noProfile)])).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    for (const role of ["BRAND", "CREATOR"] as const) {
      const f = await fixture(role), resumed = await invoke(createOrResumeDraft, [f.user.id, readOpts(f)]); expect(resumed.id).toBe(f.draft.id);
      const answer = { operationKey: key(), expectedRevision: resumed.revision, action: "SET_ANSWER", payload: { field: role === "BRAND" ? "companyName" : "displayName", value: words } };
      const saved = await invoke(applyDraftCommand, [f.user.id, f.draft.id, answer, opts(f)]); expect(saved.replayed).toBe(false);
      expect(saved.draft.input.answers[answer.payload.field]).toBe(words);
      const profileBody = profileInput(f, saved.draft.revision), profile = await invoke(profileCommand, [f.user.id, f.draft.id, profileBody, opts(f)]); expect(profile.replayed).toBe(false);
      expect((await invoke(profileForOwner, [f.user.id, readOpts(f)]))?.profile.displayName).toBe(words);
      const ready = await sourceReady(f), queueBody = { operationKey: key(), expectedRevision: ready.revision, sourceKey: "instagram" };
      const queued = await invoke(queueSourceJob, [f.user.id, f.draft.id, queueBody, opts(f)]); expect(queued.replayed).toBe(false);
      const receipts = await prisma.draftCommand.findMany({ where: { draftId: f.draft.id } });
      for (const [prefix, body, hashBody] of [["draft:", answer, { ...answer, channel: "FORM" }], ["profile:", profileBody, profileBody], ["import:", queueBody, { ...queueBody, channel: "FORM" }]] as const) {
        const receipt = receipts.find(row => row.operationKey === prefix + body.operationKey); expect(receipt?.payloadHash).toBe(canonicalHash(hashBody));
      }
      const job = await prisma.sourceJob.findUniqueOrThrow({ where: { id: queued.job.id } }); expect(job.payloadHash).toBe(canonicalHash({ ...queueBody, channel: "FORM" }));
      const stored = JSON.stringify({ receipts, job }); for (const secret of [f.actor.sessionId, f.token, "serverAuth", "sessionVersion"]) expect(stored.includes(secret)).toBe(false);
      await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { revokedAt: new Date() } }); expect(await resolveSession(f.token)).toBeNull();
      const renewed = { ...f, ...await signed(f.user.id) }, stable = await image(f.user.id);
      expect(await invoke(applyDraftCommand, [f.user.id, f.draft.id, { ...answer, payload: { value: words, field: answer.payload.field } }, opts(renewed)])).toEqual({ ...saved, replayed: true });
      expect(await invoke(profileCommand, [f.user.id, f.draft.id, profileBody, opts(renewed)])).toEqual({ ...profile, replayed: true });
      expect(await invoke(queueSourceJob, [f.user.id, f.draft.id, queueBody, opts(renewed)])).toEqual({ ...queued, replayed: true }); expect(await image(f.user.id)).toBe(stable);
      await expect(invoke(profileCommand, [f.user.id, f.draft.id, { ...profileBody, operationKey: key(), expectedRevision: queued.draft.revision }, opts(renewed, prisma, "VOICE")])).rejects.toMatchObject({ code: "EXPLICIT_CONFIRMATION_REQUIRED", status: 400 });
      await expect(invoke(queueSourceJob, [f.user.id, f.draft.id, { ...queueBody, operationKey: key(), expectedRevision: queued.draft.revision }, opts(renewed, prisma, "VOICE")])).rejects.toMatchObject({ code: "EXPLICIT_CONFIRMATION_REQUIRED", status: 400 });
      await expect(invoke(profileCommand, [f.user.id, f.draft.id, { action: "PUBLISH", operationKey: key(), expectedRevision: queued.draft.revision, payload: { consent: true, portfolioVersion: 1 } }, opts(renewed)])).rejects.toMatchObject({ code: "EMAIL_VERIFICATION_REQUIRED" });
      expect(await image(f.user.id)).toBe(stable);
    }
  }, 60000);

  it("rejects real session revocation and User-version ABA after native read/write/replay waits, with immutable captured auth and no effects", async () => {
    for (const kind of ["READ_LOGOUT", "WRITE_ABA", "PROFILE_REPLAY_LOGOUT"] as const) {
      const f = await fixture(), alternate = await signed(f.user.id); let replayBody: ReturnType<typeof profileInput> | undefined;
      if (kind === "PROFILE_REPLAY_LOGOUT") { replayBody = profileInput(f, f.draft.revision); await invoke(profileCommand, [f.user.id, f.draft.id, replayBody, opts(f)]); }
      const prior = await image(f.user.id), peer = new PrismaClient(), held = latch(), release = latch(); let holderPid = 0;
      const table = kind === "WRITE_ABA" ? "User" : "AuthSession";
      const holding = peer.$transaction(async tx => {
        holderPid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`)[0]!.pid;
        if (table === "User") await tx.$queryRaw`SELECT id FROM "User" WHERE id=${f.user.id} FOR UPDATE`;
        else await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${f.actor.sessionId} FOR UPDATE`;
        held.release(); await release.promise;
        if (kind === "WRITE_ABA") {
          await tx.user.update({ where: { id: f.user.id }, data: { active: false, sessionVersion: { increment: 1 } } });
          await tx.user.update({ where: { id: f.user.id }, data: { active: true } });
        } else await tx.authSession.update({ where: { id: f.actor.sessionId }, data: { revokedAt: new Date() } });
      }, { timeout: 15000 });
      let operation: Promise<Awaited<ReturnType<typeof settled>>> | undefined;
      const mutableAuth: OrganizationActor = { ...f.actor }, options: OnboardingCommandOptions = { serverAuth: mutableAuth, client: prisma, channel: "FORM" };
      try {
        await held.promise;
        operation = settled(() => kind === "READ_LOGOUT" ? invoke(getDraft, [f.user.id, f.draft.id, options])
          : kind === "WRITE_ABA" ? invoke(applyDraftCommand, [f.user.id, f.draft.id, { operationKey: key(), expectedRevision: f.draft.revision, action: "SAVE_DRAFT", payload: {} }, options])
          : invoke(profileCommand, [f.user.id, f.draft.id, replayBody, options]));
        await blockedBy(holderPid, table);
        // A second legitimate session cannot replace the original captured
        // revoked session merely by mutating trusted caller objects mid-wait.
        if (kind === "READ_LOGOUT") mutableAuth.sessionId = alternate.actor.sessionId;
        release.release(); await holding; expect(await operation).toEqual({ accepted: false, code: "UNAUTHENTICATED", status: 401 });
        expect(await image(f.user.id)).toBe(prior);
        await expect(read(f)).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
      } finally { release.release(); await holding; await operation; await peer.$disconnect(); }
      const renewed = { ...f, ...await signed(f.user.id) }; expect((await read(renewed)).id).toBe(f.draft.id);
    }
  }, 60000);

  it("rolls back actual profile/journal/outbox work on real expiry, renews exact-key recovery, and preserves accepted token workers after logout", async () => {
    const f = await fixture(), input = profileInput(f, f.draft.revision), before = await image(f.user.id);
    const peer = new PrismaClient(), held = latch(), release = latch(); let holderPid = 0;
    const holding = peer.$transaction(async tx => {
      holderPid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`)[0]!.pid;
      await tx.$executeRaw`LOCK TABLE "OutboxEvent" IN ACCESS EXCLUSIVE MODE`; held.release(); await release.promise;
    }, { timeout: 15000 });
    let operation: Promise<Awaited<ReturnType<typeof settled>>> | undefined;
    try {
      await held.promise; const expiresAt = new Date(Date.now() + 3000);
      await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { expiresAt } });
      operation = settled(() => invoke(profileCommand, [f.user.id, f.draft.id, input, opts(f)]));
      await blockedBy(holderPid, "OutboxEvent"); expect(Date.now() < expiresAt.getTime()).toBe(true);
      await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 30)));
      release.release(); await holding; expect(await operation).toEqual({ accepted: false, code: "UNAUTHENTICATED", status: 401 });
      expect(await image(f.user.id)).toBe(before); expect(await prisma.draftCommand.count({ where: { draftId: f.draft.id, operationKey: "profile:" + input.operationKey } })).toBe(0);
      expect(await resolveSession(f.token)).toBeNull();
      await expect(invoke(profileCommand, [f.user.id, f.draft.id, input, opts(f)])).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    } finally { release.release(); await holding; await operation; await peer.$disconnect(); }
    const renewed = { ...f, ...await signed(f.user.id) }, committed = await invoke(profileCommand, [f.user.id, f.draft.id, input, opts(renewed)]);
    expect(committed.replayed).toBe(false); expect(committed.draft.revision).toBe(f.draft.revision + 1);
    expect((await invoke(profileCommand, [f.user.id, f.draft.id, input, opts(renewed)])).replayed).toBe(true);
    const receipt = await prisma.draftCommand.findUniqueOrThrow({ where: { draftId_operationKey: { draftId: f.draft.id, operationKey: "profile:" + input.operationKey } } }); expect(receipt.payloadHash).toBe(canonicalHash(input));
    expect(await prisma.outboxEvent.count({ where: { deduplicationKey: `profile:${f.draft.id}:${input.operationKey}` } })).toBe(1);
    const owner = await fixture("BRAND"), ready = await sourceReady(owner, true);
    const queued = await invoke(queueSourceJob, [owner.user.id, owner.draft.id, { operationKey: key(), expectedRevision: ready.revision, sourceKey: "website" }, opts(owner)]);
    const running = await startSourceJob(owner.user.id, queued.job.id); expect(running.acquired).toBe(true); expect(typeof running.executionToken === "string").toBe(true);
    await prisma.authSession.update({ where: { id: owner.actor.sessionId }, data: { revokedAt: new Date() } }); expect(await resolveSession(owner.token)).toBeNull();
    await expect(read(owner)).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    const completion = { executionToken: running.executionToken!, status: "SUCCEEDED", completedItems: 1, totalItems: 1,
      facts: [{ fieldKey: "website.pageTitle", value: words, unit: null, source: "PUBLIC_IMPORT", evidenceAt: null, retrievedAt: new Date().toISOString(), sourceHash: "a".repeat(64), sourceReference: "https://native-source.example.com/" }] };
    const worker = await completeSourceJob(owner.user.id, queued.job.id, completion); expect(worker.job.status).toBe("SUCCEEDED"); expect(worker.replayed).toBe(false);
    expect((await completeSourceJob(owner.user.id, queued.job.id, completion)).replayed).toBe(true);
    await expect(completeSourceJob(owner.user.id, queued.job.id, { ...completion, executionToken: randomBytes(32).toString("hex") })).rejects.toMatchObject({ code: "EXECUTION_NOT_AUTHORIZED", status: 403 });
    const storedJob = await prisma.sourceJob.findUniqueOrThrow({ where: { id: queued.job.id } }); expect(JSON.stringify(storedJob.result).includes(running.executionToken!)).toBe(false);
    const currentOwner = { ...owner, ...await signed(owner.user.id) }, current = await read(currentOwner);
    await invoke(applyDraftCommand, [owner.user.id, owner.draft.id, { action: "SET_ANSWER", operationKey: key(), expectedRevision: current.revision,
      payload: { field: "sourceMapping", value: { sourceKey: "website", source: "WEBSITE", identity: { platform: null, providerAccountId: null, normalizedHandle: null, confirmedOrigin: "https://corrected-source.example.com" } } } }, opts(currentOwner)]);
    expect((await completeSourceJob(owner.user.id, queued.job.id, completion)).job.status).toBe("STALE");
    expect((await read(currentOwner)).input.facts.website).toBeUndefined();
    // Existing seven suites retain source owner/kind/consent and uncertain-
    // billing fences; their explicit real-session fixture plumbing is separate.
  }, 60000);
});
