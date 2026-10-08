import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import type { OrganizationActor } from "@/lib/organizations/context";
import { CreateDealSchema, DealCommandSchema, type DealOptions, type DealPolicyVerifier } from "@/lib/deals/contracts";
import { createDealOffer, getDeal, listDeals, applyDealCommand, type DealDTO } from "@/lib/deals/service";
import { getOfferDraft, saveOfferDraft } from "@/lib/deals/drafts";
import { getDealComposeContext } from "@/lib/deals/readiness";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { cleanup, fixture, user } from "./fixtures";

// Exactly three guarded native groups. Sessions, PostgreSQL locks and legacy
// domain producers are real owned synthetic records. The existing fixture's
// explicitly synthetic policy verifier is not live professional/legal proof.
// No ./clock import, Date/auth/domain mock, source reset or .test registration.
// The callback wrapper below changes scheduling only and delegates its result.
afterEach(cleanup);
const key = () => randomUUID();
async function signed(userId: string) {
  const saved = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const token = await openSession(saved.id, saved.sessionVersion, saved.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Owned native deal session failed to resolve");
  const actor: OrganizationActor = { userId: session.userId, role: session.role, sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  return { token, actor };
}
type Signed = Awaited<ReturnType<typeof signed>>;
async function nativeFixture() {
  const f = await fixture(2, "10001", { now: new Date(), target: "test" });
  // Same explicit synthetic publication flag as the accepted native M03 legacy
  // fixture; reviewed proof production may invalidate the prior profile state.
  await prisma.creator.update({ where: { id: f.target.id }, data: { state: "PUBLISHED", brandVisible: true } });
  return { ...f, brand: await signed(f.brandUserId), creator: await signed(f.target.userId) };
}
type Fixture = Awaited<ReturnType<typeof nativeFixture>>;
function options(f: Fixture, auth?: OrganizationActor): DealOptions {
  // Business observations and native authentication both use their real clocks.
  // In particular, do not reuse the earlier fixture-start observation as now.
  return { policyVerifier: f.options.policyVerifier, serverAuth: auth };
}
async function compose(f: Fixture, actor: string, auth: OrganizationActor | undefined, dealId?: string) {
  const result = await getDealComposeContext(actor, { campaignId: f.campaign.id, creatorId: f.target.id, ...(dealId ? { dealId, view: "CURRENT_EXECUTION" } : {}) },
    prisma, undefined, { serverAuth: auth });
  if (result.kind !== "CURRENT") throw new Error("Native readiness witness requires the current compose lane");
  return result;
}
function message(deal: DealDTO, text = "  Private native message\nOriginal preserved words  ") {
  return DealCommandSchema.parse({ action: "MESSAGE", operationKey: key(), expectedVersion: deal.version, text: { text, language: "en" } });
}
function draftCommand(f: Fixture, text = "  Native private offer draft  ") {
  return { campaignId: f.campaign.id, creatorId: f.target.id, operationKey: key(), expectedRevision: 0, patch: { note: { text, language: "en" } } };
}
async function unauthenticated(operation: Promise<unknown>) { await expect(operation).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" }); }
async function raw(f: Fixture) {
  const deal = { campaignId: f.campaign.id }, ordered = { id: "asc" as const };
  return { campaign: await prisma.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } }),
    deals: await prisma.deal.findMany({ where: deal, orderBy: ordered }), offers: await prisma.dealOffer.findMany({ where: { deal }, orderBy: ordered }),
    agreements: await prisma.agreementSnapshot.findMany({ where: { deal }, orderBy: ordered }), confirmations: await prisma.agreementConfirmation.findMany({ where: { deal }, orderBy: ordered }),
    commands: await prisma.dealCommand.findMany({ where: { deal }, orderBy: ordered }), events: await prisma.dealEvent.findMany({ where: { deal }, orderBy: ordered }),
    messages: await prisma.dealMessage.findMany({ where: { deal }, orderBy: ordered }), ratings: await prisma.dealRating.findMany({ where: { deal }, orderBy: ordered }),
    drafts: await prisma.offerDraft.findMany({ where: { campaignId: f.campaign.id }, orderBy: ordered }),
    draftCommands: await prisma.offerDraftCommand.findMany({ where: { draft: { campaignId: f.campaign.id } }, orderBy: ordered }),
    decisions: await prisma.matchDecisionRecord.findMany({ where: { campaignId: f.campaign.id }, orderBy: ordered }),
    outbox: await prisma.outboxEvent.findMany({ where: { OR: [f.brandUserId, f.target.userId].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) }, orderBy: ordered }) };
}
function latch<T>() { let resolve!: (value: T | PromiseLike<T>) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
type WaitTable = "User" | "AuthSession" | "Campaign" | "Deal" | "DealCommand" | "OfferDraftCommand" | "DealMessage";
type WaitOperation = "SELECT" | "INSERT";
async function hold(table: WaitTable, id: string | null, operation: WaitOperation = "SELECT", afterRelease?: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  const peer = new PrismaClient(), monitor = new PrismaClient(), ready = latch<number>(), release = latch<void>(), stop = new AbortController();
  const holding = peer.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout='4s'`;
    if (id !== null) await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw('"' + table + '"')} WHERE id=${id} FOR UPDATE`);
    else if (operation === "INSERT") await tx.$executeRaw(Prisma.sql`LOCK TABLE ${Prisma.raw('"' + table + '"')} IN SHARE MODE`);
    else await tx.$executeRaw(Prisma.sql`LOCK TABLE ${Prisma.raw('"' + table + '"')} IN ACCESS EXCLUSIVE MODE`);
    const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
    ready.resolve(rows[0]!.pid); await release.promise; if (afterRelease) await afterRelease(tx);
  }, { maxWait: 5000, timeout: 12000 }); void holding.catch(() => {});
  let pid: number;
  try { pid = await Promise.race([ready.promise, holding.then(() => { throw new Error("Owned blocker ended before its native lock"); })]); }
  catch (error) { release.resolve(); await holding.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); throw error; }
  let waiting: Promise<number> | undefined;
  return { holding, release: () => release.resolve(), wait() { waiting = (async () => {
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline) {
      if (stop.signal.aborted) throw new Error("Native deal wait observer cancelled");
      const rows = await monitor.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid))
          AND query LIKE ${`%"${table}"%`} AND query ILIKE ${`%${operation}%`} ORDER BY pid`;
      if (rows.length) return rows[0]!.pid; await delay(20);
    }
    throw new Error("Deal operation did not reach the required actual native wait");
  })(); return waiting; }, async close() { release.resolve(); stop.abort(); await holding.catch(() => {}); await waiting?.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); } };
}
async function observed(held: Awaited<ReturnType<typeof hold>>, operation: Promise<unknown>) {
  expect(await Promise.race([held.wait(), operation.then(() => { throw new Error("Deal operation returned private output before the required native wait"); })])).toBeGreaterThan(0);
}
async function waitUntilExpired(subject: Signed, expiresAt: Date) {
  while (Date.now() <= expiresAt.getTime()) await delay(Math.min(50, expiresAt.getTime() - Date.now() + 1));
  expect(await resolveSession(subject.token)).toBeNull();
}
async function expiresDuringWait(f: Fixture, subject: Signed, table: WaitTable, id: string | null, operation: WaitOperation,
  begin: () => Promise<unknown>) {
  const before = await raw(f), expiresAt = new Date(Date.now() + 2500);
  await prisma.authSession.update({ where: { id: subject.actor.sessionId }, data: { expiresAt } });
  expect(await resolveSession(subject.token)).not.toBeNull();
  const held = await hold(table, id, operation), working = begin(); void working.catch(() => {});
  try {
    await observed(held, working); expect(Date.now()).toBeLessThan(expiresAt.getTime()); await waitUntilExpired(subject, expiresAt);
    held.release(); await held.holding; await unauthenticated(working); expect(await raw(f)).toEqual(before);
  } finally { await held.close(); await working.catch(() => {}); }
}

describe("legacy deals require native current and final sessions", () => {
  it("requires real metadata on every entrypoint, rejects forged/current-invalid tuples before input, and preserves genuine BRAND/CREATOR capabilities", async () => {
    const f = await nativeFixture(), created = await createDealOffer(f.brandUserId, f.input, options(f, f.brand.actor)), offered = created.deal;
    expect(created.replayed).toBe(false);
    expect(offered.currentOffer).toMatchObject({ proposerUserId: f.brandUserId, recipientUserId: f.target.userId, terms: f.terms });
    const brandSave = draftCommand(f), brandDraft = await saveOfferDraft(f.brandUserId, brandSave, options(f, f.brand.actor));
    const beforeDenials = await raw(f), deniedMessage = message(offered);
    const missing: Array<() => Promise<unknown>> = [
      () => createDealOffer(f.brandUserId, f.input, options(f)), () => getDeal(f.brandUserId, offered.id, options(f)),
      () => listDeals(f.brandUserId, {}, options(f)), () => applyDealCommand(f.brandUserId, offered.id, deniedMessage, options(f)),
      () => getOfferDraft(f.brandUserId, brandDraft.draft.id, options(f)),
      () => saveOfferDraft(f.brandUserId, { ...brandSave, operationKey: key(), expectedRevision: 1 }, options(f)),
      () => compose(f, f.brandUserId, undefined, offered.id),
    ];
    for (const begin of missing) await unauthenticated(begin());
    // Missing metadata wins over malformed command/query/resource validation.
    await unauthenticated(createDealOffer(f.brandUserId, null, options(f)));
    await unauthenticated(getDeal(f.brandUserId, "", options(f)));
    await unauthenticated(applyDealCommand(f.brandUserId, "", null, options(f)));
    await unauthenticated(saveOfferDraft(f.brandUserId, null, options(f)));
    await unauthenticated(getOfferDraft(f.brandUserId, "", options(f)));
    await unauthenticated(listDeals(f.brandUserId, { limit: 0 }, options(f)));
    await unauthenticated(getDealComposeContext(f.brandUserId, null, prisma, undefined, {}));
    await unauthenticated(createDealOffer(f.brandUserId, { ...f.input, serverAuth: f.brand.actor }, options(f)));
    await unauthenticated(getDealComposeContext(f.brandUserId, { campaignId: f.campaign.id, creatorId: f.target.id, serverAuth: f.brand.actor }, prisma, undefined, {}));
    expect(CreateDealSchema.safeParse({ ...f.input, serverAuth: f.brand.actor }).success).toBe(false);
    expect(DealCommandSchema.safeParse({ ...deniedMessage, serverAuth: f.brand.actor }).success).toBe(false);
    for (const forged of [{ ...f.brand.actor, sessionId: "x".repeat(43) }, { ...f.brand.actor, sessionVersion: f.brand.actor.sessionVersion + 1 },
      { ...f.brand.actor, role: "CREATOR" as const }, f.creator.actor]) await unauthenticated(getDeal(f.brandUserId, offered.id, options(f, forged)));
    const expired = await signed(f.brandUserId), revoked = await signed(f.brandUserId);
    await prisma.authSession.update({ where: { id: expired.actor.sessionId }, data: { expiresAt: new Date(Date.now() - 1) } });
    await prisma.authSession.update({ where: { id: revoked.actor.sessionId }, data: { revokedAt: new Date() } });
    expect(await resolveSession(expired.token)).toBeNull(); expect(await resolveSession(revoked.token)).toBeNull();
    for (const subject of [expired, revoked]) await unauthenticated(getDeal(f.brandUserId, offered.id, options(f, subject.actor)));
    const admin = await signed(await user("ADMIN"));
    await expect(getDeal(admin.actor.userId, offered.id, options(f, admin.actor))).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(await raw(f)).toEqual(beforeDenials);

    const acceptedCommand = DealCommandSchema.parse({ action: "ACCEPT", operationKey: key(), expectedVersion: offered.version,
      offerId: offered.currentOffer.id, expectedOfferVersion: offered.currentOffer.version, language: "ar" });
    let current = (await applyDealCommand(f.target.userId, offered.id, acceptedCommand, options(f, f.creator.actor))).deal;
    expect(current.status).toBe("ACCEPTED"); expect(current.agreement?.partiesSnapshot).toMatchObject({ brandUserId: f.brandUserId, creatorUserId: f.target.userId });
    current = (await applyDealCommand(f.brandUserId, current.id, message(current), options(f, f.brand.actor))).deal;
    current = (await applyDealCommand(f.target.userId, current.id, message(current, "Creator original native support words"), options(f, f.creator.actor))).deal;
    const creatorDraft = await saveOfferDraft(f.target.userId, draftCommand(f, "Creator private original draft"), options(f, f.creator.actor));
    for (const subject of [f.brand, f.creator]) {
      expect((await getDeal(subject.actor.userId, current.id, options(f, subject.actor))).id).toBe(current.id);
      expect((await listDeals(subject.actor.userId, {}, options(f, subject.actor))).deals.map(row => row.id)).toEqual([current.id]);
      const composed = await compose(f, subject.actor.userId, subject.actor, current.id);
      expect(composed.campaign.id).toBe(f.campaign.id); expect(composed.requirements?.version).toBe(current.briefVersion);
      expect(composed.readiness.canSend).toBe(false); // No live policy/publication readiness is fabricated by this fixture.
    }
    expect((await getOfferDraft(f.brandUserId, brandDraft.draft.id, options(f, f.brand.actor))).terms).toEqual(brandSave.patch);
    expect((await getOfferDraft(f.target.userId, creatorDraft.draft.id, options(f, f.creator.actor))).terms.note?.text).toBe("Creator private original draft");
    expect((await createDealOffer(f.brandUserId, f.input, options(f, f.brand.actor))).replayed).toBe(true);
    expect((await applyDealCommand(f.target.userId, current.id, acceptedCommand, options(f, f.creator.actor))).replayed).toBe(true);
    expect((await saveOfferDraft(f.brandUserId, brandSave, options(f, f.brand.actor))).replayed).toBe(true);
  }, 60000);

  it("rechecks native User/AuthSession/domain waits, captures caller metadata before waiting, and denies expired complete list/compose output without effects", async () => {
    const f = await nativeFixture(), offered = (await createDealOffer(f.brandUserId, f.input, options(f, f.brand.actor))).deal;
    const captured = { ...f.brand.actor }, beforeCapture = await raw(f), heldCapture = await hold("User", f.brandUserId);
    const reading = getDeal(f.brandUserId, offered.id, options(f, captured)); void reading.catch(() => {});
    try { await observed(heldCapture, reading); Object.assign(captured, f.creator.actor); heldCapture.release(); await heldCapture.holding;
      expect((await reading).id).toBe(offered.id); expect(await raw(f)).toEqual(beforeCapture);
    } finally { await heldCapture.close(); await reading.catch(() => {}); }
    const session = await signed(f.brandUserId), beforeRevocation = await raw(f);
    const heldSession = await hold("AuthSession", session.actor.sessionId, "SELECT", tx => tx.authSession.update({ where: { id: session.actor.sessionId }, data: { revokedAt: new Date() } }));
    const revokedRead = getDeal(f.brandUserId, offered.id, options(f, session.actor)); void revokedRead.catch(() => {});
    try { await observed(heldSession, revokedRead); heldSession.release(); await heldSession.holding; await unauthenticated(revokedRead);
      expect(await resolveSession(session.token)).toBeNull(); expect(await raw(f)).toEqual(beforeRevocation);
    } finally { await heldSession.close(); await revokedRead.catch(() => {}); }
    const roleSession = await signed(f.target.userId), beforeRole = await raw(f);
    const heldUser = await hold("User", f.target.userId, "SELECT", tx => tx.user.update({ where: { id: f.target.userId }, data: { role: "ADMIN" } }));
    const lostRole = applyDealCommand(f.target.userId, offered.id, message(offered), options(f, roleSession.actor)); void lostRole.catch(() => {});
    try { await observed(heldUser, lostRole); heldUser.release(); await heldUser.holding; await unauthenticated(lostRole); expect(await raw(f)).toEqual(beforeRole); }
    finally { await heldUser.close(); await lostRole.catch(() => {}); }
    // Keep the changed owned account as-is; use a separate valid BRAND session.
    const pageSession = await signed(f.brandUserId);
    await expiresDuringWait(f, pageSession, "Deal", offered.id, "SELECT", () => listDeals(f.brandUserId, {}, options(f, pageSession.actor)));
    const composeSession = await signed(f.brandUserId);
    await expiresDuringWait(f, composeSession, "Campaign", f.campaign.id, "SELECT", () => compose(f, f.brandUserId, composeSession.actor, offered.id));
  }, 60000);

  it("rolls back journal/callback/final DTO expiry and preserves exact/conflicting committed replay, original parties and legacy payload hashes", async () => {
    const journal = await nativeFixture();
    await expiresDuringWait(journal, journal.brand, "DealCommand", null, "INSERT", () => createDealOffer(journal.brandUserId, journal.input, options(journal, journal.brand.actor)));
    const draft = await nativeFixture(), draftInput = draftCommand(draft);
    await expiresDuringWait(draft, draft.brand, "OfferDraftCommand", null, "INSERT", () => saveOfferDraft(draft.brandUserId, draftInput, options(draft, draft.brand.actor)));
    const dto = await nativeFixture();
    // CREATE does not INSERT DealMessage: this actual SELECT wait is after its
    // tentative offer/event/command writes, at the final private DTO projection.
    await expiresDuringWait(dto, dto.brand, "DealMessage", null, "SELECT", () => createDealOffer(dto.brandUserId, dto.input, options(dto, dto.brand.actor)));

    const callback = await nativeFixture(), beforeCallback = await raw(callback), entered = latch<void>(), release = latch<void>();
    const expiresAt = new Date(Date.now() + 2500); await prisma.authSession.update({ where: { id: callback.brand.actor.sessionId }, data: { expiresAt } });
    const schedulingOnly: DealPolicyVerifier = async (...args) => { const result = await callback.options.policyVerifier(...args); entered.resolve(); await release.promise; return result; };
    const callbackWrite = createDealOffer(callback.brandUserId, callback.input, { ...options(callback, callback.brand.actor), policyVerifier: schedulingOnly }); void callbackWrite.catch(() => {});
    try {
      await Promise.race([entered.promise, callbackWrite.then(() => { throw new Error("Deal completed before its actual policy callback"); })]);
      expect(Date.now()).toBeLessThan(expiresAt.getTime()); await waitUntilExpired(callback.brand, expiresAt); release.resolve();
      await unauthenticated(callbackWrite); expect(await raw(callback)).toEqual(beforeCallback);
    } finally { release.resolve(); await callbackWrite.catch(() => {}); }

    const f = await nativeFixture(), made = await createDealOffer(f.brandUserId, f.input, options(f, f.brand.actor));
    const accept = DealCommandSchema.parse({ action: "ACCEPT", operationKey: key(), expectedVersion: made.deal.version,
      offerId: made.deal.currentOffer.id, expectedOfferVersion: made.deal.currentOffer.version, language: "ar" });
    const accepted = (await applyDealCommand(f.target.userId, made.deal.id, accept, options(f, f.creator.actor))).deal;
    const send = message(accepted), posted = await applyDealCommand(f.brandUserId, accepted.id, send, options(f, f.brand.actor));
    const savedInput = draftCommand(f), saved = await saveOfferDraft(f.brandUserId, savedInput, options(f, f.brand.actor));
    const beforeReplay = await raw(f), renewed = await signed(f.brandUserId);
    expect((await createDealOffer(f.brandUserId, f.input, options(f, renewed.actor))).replayed).toBe(true);
    expect(await applyDealCommand(f.brandUserId, accepted.id, send, options(f, renewed.actor))).toEqual({ ...posted, replayed: true });
    expect(await saveOfferDraft(f.brandUserId, savedInput, options(f, renewed.actor))).toEqual({ ...saved, replayed: true });
    await expect(applyDealCommand(f.brandUserId, accepted.id, { ...send, text: { text: "Changed conflicting original words", language: "en" } }, options(f, renewed.actor)))
      .rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_CONFLICT" });
    expect(await raw(f)).toEqual(beforeReplay);
    const createRow = beforeReplay.commands.find(row => row.operationKey === f.input.operationKey)!;
    const acceptRow = beforeReplay.commands.find(row => row.operationKey === accept.operationKey)!;
    const sendRow = beforeReplay.commands.find(row => row.operationKey === send.operationKey)!;
    const draftRow = beforeReplay.draftCommands.find(row => row.operationKey === savedInput.operationKey)!;
    expect(createRow.payloadHash).toBe(canonicalHash({ action: "CREATE", ...CreateDealSchema.parse(f.input) }));
    expect(acceptRow.payloadHash).toBe(canonicalHash({ dealId: made.deal.id, ...accept }));
    expect(sendRow.payloadHash).toBe(canonicalHash({ dealId: made.deal.id, ...send })); expect(draftRow.payloadHash).toBe(canonicalHash(savedInput));
    expect(beforeReplay.offers[0]).toMatchObject({ proposerUserId: f.brandUserId, recipientUserId: f.target.userId });
    expect(accepted.agreement?.partiesSnapshot).toMatchObject({ brandUserId: f.brandUserId, creatorUserId: f.target.userId });
    const stored = JSON.stringify([...beforeReplay.commands, ...beforeReplay.draftCommands]);
    for (const metadata of [f.brand.token, renewed.token, f.brand.actor.sessionId, renewed.actor.sessionId, '"serverAuth"', '"sessionId"', '"sessionVersion"']) expect(stored.includes(metadata)).toBe(false);
    const replaySession = await signed(f.brandUserId);
    await expiresDuringWait(f, replaySession, "DealCommand", null, "SELECT", () => applyDealCommand(f.brandUserId, accepted.id, send, options(f, replaySession.actor)));
    expect(await raw(f)).toEqual(beforeReplay);
  }, 90000);
});
