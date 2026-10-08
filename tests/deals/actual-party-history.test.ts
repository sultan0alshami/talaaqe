import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolveSession } from "@/lib/identity";
import { parseBriefContent } from "@/lib/campaigns/contracts";
import { canonicalHash, record } from "@/lib/onboarding/drafts";
import { CreateDealSchema, DealCommandSchema, type DealOptions } from "@/lib/deals/contracts";
import { getDeal, listDeals, applyDealCommand, createDealOffer, type DealDTO } from "@/lib/deals/service";
import { getDealComposeContext } from "@/lib/deals/readiness";
import { cleanup, fixture, user } from "./fixtures";
import { nativeDealActor } from "./native-actors";

// Exactly three guarded native groups, against CURRENT existing exports.
// Real owned sessions, PostgreSQL rows/queries/locks and domain producers; no
// global clock/auth/DB mock, provider call or admission bypass. The existing
// syntheticPolicy fixture is explicitly synthetic legal text, NOT live legal,
// qualification, provider or admission acceptance. Root alone adopts/runs.
afterEach(cleanup);
const key = () => randomUUID();
type Signed = Awaited<ReturnType<typeof nativeDealActor>>;
function options(f: { options: { policyVerifier: DealOptions["policyVerifier"] } }, signed: Signed, client: PrismaClient = prisma): DealOptions {
  return { policyVerifier: f.options.policyVerifier, serverAuth: signed.actor, client };
}
function message(deal: DealDTO, text = "  Original private history words\nكلمات تاريخية أصلية  ") {
  return DealCommandSchema.parse({ action: "MESSAGE", operationKey: key(), expectedVersion: deal.version, text: { text, language: "ar" } });
}
async function historyFixture() {
  const f = await fixture(2, "10001", { now: new Date(), target: "test" });
  // Explicit synthetic publication after the actual reviewed-proof fixture.
  await prisma.creator.update({ where: { id: f.target.id }, data: { state: "PUBLISHED", brandVisible: true } });
  const brand = await nativeDealActor(f.brandUserId), creator = await nativeDealActor(f.target.userId);
  const made = await createDealOffer(f.brandUserId, f.input, options(f, brand));
  const accept = DealCommandSchema.parse({ action: "ACCEPT", operationKey: key(), expectedVersion: made.deal.version,
    offerId: made.deal.currentOffer.id, expectedOfferVersion: made.deal.currentOffer.version, language: "ar" });
  const accepted = (await applyDealCommand(f.target.userId, made.deal.id, accept, options(f, creator))).deal;
  const send = message(accepted), posted = await applyDealCommand(f.brandUserId, accepted.id, send, options(f, brand));
  const row = await prisma.campaignBrief.findUniqueOrThrow({ where: { campaignId_version: { campaignId: f.campaign.id, version: posted.deal.briefVersion } } });
  const agreementRow = await prisma.agreementSnapshot.findUniqueOrThrow({ where: { id: posted.deal.agreement!.id } });
  const approvedBrief = { id: row.id, campaignId: row.campaignId, version: row.version, inputRevision: row.inputRevision,
    content: parseBriefContent(row.content), approvedAt: row.approvedAt?.toISOString() ?? null,
    approvedByUserId: row.approvedByUserId, createdAt: row.createdAt.toISOString() };
  return { ...f, brand, creator, made, accept, send, posted, deal: posted.deal, approvedBrief, agreementContent: structuredClone(agreementRow.content) };
}
type Fixture = Awaited<ReturnType<typeof historyFixture>>;
function compose(f: Fixture, signed: Signed, client: PrismaClient = prisma) {
  return getDealComposeContext(signed.actor.userId, { campaignId: f.campaign.id, creatorId: f.target.id, dealId: f.deal.id },
    client, undefined, { serverAuth: signed.actor });
}
async function transfer(f: Fixture, mode: "BRAND" | "CREATOR" | "BOTH") {
  const replacements: Signed[] = [];
  if (mode !== "CREATOR") {
    const id = await user("BRAND"), signed = await nativeDealActor(id);
    await prisma.brand.update({ where: { id: f.brandId }, data: { userId: id } }); replacements.push(signed);
  }
  if (mode !== "BRAND") {
    const id = await user("CREATOR"), signed = await nativeDealActor(id);
    await prisma.creator.update({ where: { id: f.target.id }, data: { userId: id, state: "PRIVATE", brandVisible: false } }); replacements.push(signed);
  }
  return replacements;
}
async function raw(f: Fixture) {
  const where = { dealId: f.deal.id }, orderBy = { id: "asc" as const };
  return { campaign: await prisma.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } }),
    briefs: await prisma.campaignBrief.findMany({ where: { campaignId: f.campaign.id }, orderBy }),
    deal: await prisma.deal.findUniqueOrThrow({ where: { id: f.deal.id } }),
    offers: await prisma.dealOffer.findMany({ where, orderBy }), agreements: await prisma.agreementSnapshot.findMany({ where, orderBy }),
    confirmations: await prisma.agreementConfirmation.findMany({ where, orderBy }), messages: await prisma.dealMessage.findMany({ where, orderBy }),
    ratings: await prisma.dealRating.findMany({ where, orderBy }), commands: await prisma.dealCommand.findMany({ where, orderBy }),
    events: await prisma.dealEvent.findMany({ where, orderBy }),
    outbox: await prisma.outboxEvent.findMany({ where: { payload: { path: ["aggregateId"], equals: f.deal.id } }, orderBy }) };
}
function expectedHistory(f: Fixture) {
  return { id: f.deal.id, campaignId: f.campaign.id, creatorId: f.target.id, briefVersion: f.deal.briefVersion,
    approvedBrief: f.approvedBrief, agreement: f.deal.agreement, offers: f.deal.offers, messages: f.deal.messages };
}
async function expectOriginalHistory(f: Fixture, signed: Signed, client: PrismaClient = prisma) {
  expect(await resolveSession(signed.token)).not.toBeNull();
  const result = await getDeal(signed.actor.userId, f.deal.id, options(f, signed, client));
  expect(result).toMatchObject(expectedHistory(f));
  const listed = await listDeals(signed.actor.userId, { limit: 20 }, options(f, signed, client));
  expect(listed.deals.find(deal => deal.id === f.deal.id)).toMatchObject(expectedHistory(f));
  const history = await compose(f, signed, client);
  expect(history).toMatchObject({ kind: "HISTORY_ONLY", dealId: f.deal.id, approvedBrief: f.approvedBrief,
    campaign: { id: f.campaign.id, title: f.approvedBrief.content.requirements.title, briefVersion: f.deal.briefVersion },
    parties: { brand: { userId: f.brandUserId }, creator: { userId: f.target.userId } },
    readiness: { canSend: false, blockedReasons: ["HISTORY_ONLY"] }, origin: f.deal.origin, matchRunId: f.deal.matchRunId });
  for (const field of ["revision", "currentBriefVersion"]) expect(Object.hasOwn(history.campaign, field)).toBe(false);
  for (const field of ["draft", "templates", "creator", "requirements"]) expect(Object.hasOwn(history, field)).toBe(false);
  return result;
}

it("both immutable actual parties retain get/list/pinned history after Brand, Creator or both profile transfers, while replacements gain none", async () => {
  for (const mode of ["BRAND", "CREATOR", "BOTH"] as const) {
    const f = await historyFixture(), replacements = await transfer(f, mode), before = await raw(f);
    for (const signed of [f.brand, f.creator]) await expectOriginalHistory(f, signed);
    const unrelated = await nativeDealActor(await user("BRAND")), admin = await nativeDealActor(await user("ADMIN"));
    for (const signed of [...replacements, unrelated]) {
      await expect(getDeal(signed.actor.userId, f.deal.id, options(f, signed))).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
      await expect(compose(f, signed)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
      expect((await listDeals(signed.actor.userId, {}, options(f, signed))).deals.some(deal => deal.id === f.deal.id)).toBe(false);
    }
    await expect(getDeal(admin.actor.userId, f.deal.id, options(f, admin))).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(await raw(f)).toEqual(before);
  }
}, 90000);

function queryObserver() {
  const client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  const queries: string[] = [];
  client.$on("query", event => queries.push(event.query)); // Never collect params/credentials/bodies.
  return { client, queries, clear: () => { queries.length = 0; } };
}
function privateHydration(queries: string[]) {
  const violations = new Set<string>();
  for (const query of queries.filter(query => /\bSELECT\b/i.test(query))) {
    const projection = query.slice(0, query.search(/\bFROM\b/i));
    if (/"Campaign"\."input"/.test(projection) || /\bSELECT\s+\*\s+FROM\s+(?:"public"\.)?"Campaign"/i.test(query)) violations.add("Campaign.input");
    for (const model of ["Brand", "Creator"]) {
      const columns = [...projection.matchAll(new RegExp(`"${model}"\\."([^\"]+)"`, "g"))].map(match => match[1]);
      if (columns.some(column => column !== "id" && column !== "userId")
        || new RegExp(`\\bSELECT\\s+\\*\\s+FROM\\s+(?:"public"\\.)?"${model}"`, "i").test(query)) violations.add(`${model} private/current profile projection`);
    }
    for (const model of ["OfferDraft", "BrandContext", "BrandContextVersion", "CampaignPlanningState", "CampaignContextSelection",
      "PrivateAsset", "OwnershipChallenge", "SocialAccount", "MetricsSnapshot", "BusinessVerification", "AdvertisingLicence"]) {
      if (new RegExp(`\\b(?:FROM|JOIN)\\s+(?:"public"\\.)?"${model}"`, "i").test(query)) violations.add(`${model} current source query`);
    }
  }
  return [...violations]; // Only safe table/column categories appear on failure.
}
function latch<T>() { let resolve!: (value: T | PromiseLike<T>) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
type WaitTable = "AuthSession" | "DealRating";
async function hold(table: WaitTable, id: string | null, afterRelease?: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  const peer = new PrismaClient(), monitor = new PrismaClient(), ready = latch<number>(), release = latch<void>(), stop = new AbortController();
  const holding = peer.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout='4s'`;
    if (id) await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw('"' + table + '"')} WHERE id=${id} FOR UPDATE`);
    else await tx.$executeRaw(Prisma.sql`LOCK TABLE ${Prisma.raw('"' + table + '"')} IN ACCESS EXCLUSIVE MODE`);
    const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
    ready.resolve(rows[0]!.pid); await release.promise; if (afterRelease) await afterRelease(tx);
  }, { maxWait: 5000, timeout: 12000 }); void holding.catch(() => {});
  let pid: number;
  try { pid = await Promise.race([ready.promise, holding.then(() => { throw new Error("History blocker ended before its native lock"); })]); }
  catch (error) { release.resolve(); await holding.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); throw error; }
  let waiting: Promise<number> | undefined;
  return { holding, release: () => release.resolve(), wait() { waiting = (async () => {
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline) {
      if (stop.signal.aborted) throw new Error("History lock observer cancelled");
      const rows = await monitor.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid)) AND query LIKE ${`%"${table}"%`} AND query ILIKE '%SELECT%' ORDER BY pid`;
      if (rows.length) return rows[0]!.pid; await delay(20);
    }
    throw new Error("History operation never reached its required actual native wait");
  })(); return waiting; }, async close() { release.resolve(); stop.abort(); await holding.catch(() => {}); await waiting?.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); } };
}
async function observed(held: Awaited<ReturnType<typeof hold>>, operation: Promise<unknown>) {
  expect(await Promise.race([held.wait(), operation.then(() => { throw new Error("History returned before the required actual native wait"); })])).toBeGreaterThan(0);
}

it("historical queries avoid whole current campaign/profile sources and exact original CREATE/message receipts replay without effects", async () => {
  const f = await historyFixture(), observedClient = queryObserver();
  const currentInput = await prisma.campaign.findUniqueOrThrow({ where: { id: f.campaign.id }, select: { input: true } });
  const marker = `SYNTHETIC_CURRENT_PRIVATE_${key()}`;
  await prisma.campaign.update({ where: { id: f.campaign.id }, data: { title: marker,
    input: { ...record(currentInput.input), fields: { ...record(record(currentInput.input).fields), title: marker } } } });
  await prisma.brand.update({ where: { id: f.brandId }, data: { name: marker, description: marker, profileFacts: { privateHistoryProbe: marker } } });
  await transfer(f, "CREATOR");
  await prisma.creator.update({ where: { id: f.target.id }, data: { displayName: marker, availability: { status: "UNKNOWN", privateHistoryProbe: marker } } });
  try {
    const beforeDeniedConfirm = await raw(f);
    const deniedConfirm = DealCommandSchema.parse({ action: "CONFIRM", operationKey: key(), expectedVersion: f.deal.version,
      agreementId: f.deal.agreement!.id, expectedAgreementVersion: f.deal.agreement!.version });
    observedClient.clear();
    await expect(applyDealCommand(f.brandUserId, f.deal.id, deniedConfirm, options(f, f.brand, observedClient.client)))
      .rejects.toMatchObject({ status: 409, code: "STALE_PARTICIPANTS" });
    expect(observedClient.queries.length).toBeGreaterThan(0);
    // Reviewer/ownership ID discovery can be legitimate before a current-command
    // decision. This witness forbids only the three full private projections,
    // unlike the stricter no-current-source predicate for pure history below.
    const fullPrivateProjection = privateHydration(observedClient.queries).filter(category =>
      category === "Campaign.input" || category === "Brand private/current profile projection"
      || category === "Creator private/current profile projection");
    expect(fullPrivateProjection).toEqual([]);
    expect(await raw(f)).toEqual(beforeDeniedConfirm);
    observedClient.clear();
    // Original Creator remains a genuine recorded party. This call succeeds in
    // current source but its native query projections disclose the separate bug.
    const historical = await getDeal(f.target.userId, f.deal.id, options(f, f.creator, observedClient.client));
    expect(observedClient.queries.length).toBeGreaterThan(0);
    expect(privateHydration(observedClient.queries)).toEqual([]);
    expect(historical).toMatchObject(expectedHistory(f));
    const context = await compose(f, f.creator, observedClient.client);
    expect(context).toMatchObject({ kind: "HISTORY_ONLY", approvedBrief: f.approvedBrief,
      campaign: { title: f.approvedBrief.content.requirements.title }, readiness: { canSend: false, blockedReasons: ["HISTORY_ONLY"] } });
    expect(JSON.stringify([historical, context]).includes(marker)).toBe(false);
    expect(privateHydration(observedClient.queries)).toEqual([]);
    await transfer(f, "BRAND");
    const before = await raw(f); observedClient.clear();
    const createdReplay = await createDealOffer(f.brandUserId, f.input, options(f, f.brand, observedClient.client));
    expect(createdReplay.replayed).toBe(true); expect(createdReplay.deal).toMatchObject(expectedHistory(f));
    const commandReplay = await applyDealCommand(f.brandUserId, f.deal.id, f.send, options(f, f.brand, observedClient.client));
    expect(commandReplay.replayed).toBe(true); expect(commandReplay.deal).toMatchObject(expectedHistory(f));
    expect(privateHydration(observedClient.queries)).toEqual([]);
    await expect(applyDealCommand(f.brandUserId, f.deal.id, { ...f.send, text: { text: "Changed original command words", language: "en" } }, options(f, f.brand)))
      .rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_CONFLICT" });
    expect(await raw(f)).toEqual(before);
    const createRow = before.commands.find(row => row.operationKey === f.input.operationKey)!;
    const messageRow = before.commands.find(row => row.operationKey === f.send.operationKey)!;
    expect(createRow.payloadHash).toBe(canonicalHash({ action: "CREATE", ...CreateDealSchema.parse(f.input) }));
    expect(messageRow.payloadHash).toBe(canonicalHash({ dealId: f.deal.id, ...f.send }));
    expect(before.agreements[0].content).toEqual(f.agreementContent);
  } finally { await observedClient.client.$disconnect(); }
}, 60000);

it("historical output/replay still requires current native sessions and final DTO expiry rolls MESSAGE effects back", async () => {
  // Two representative waits only; the preceding native-session suite retains
  // its full User/session/domain/lease matrix. Capture every tuple once here.
  const revoked = await historyFixture(); await transfer(revoked, "BOTH");
  const beforeRevocation = await raw(revoked);
  const sessionBlock = await hold("AuthSession", revoked.brand.actor.sessionId,
    tx => tx.authSession.update({ where: { id: revoked.brand.actor.sessionId }, data: { revokedAt: new Date() } }));
  const reading = getDeal(revoked.brandUserId, revoked.deal.id, options(revoked, revoked.brand)); void reading.catch(() => {});
  try {
    await observed(sessionBlock, reading); sessionBlock.release(); await sessionBlock.holding;
    await expect(reading).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    expect(await resolveSession(revoked.brand.token)).toBeNull();
    await expect(listDeals(revoked.brandUserId, {}, options(revoked, revoked.brand))).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    await expect(compose(revoked, revoked.brand)).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    await expect(createDealOffer(revoked.brandUserId, revoked.input, options(revoked, revoked.brand))).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    expect(await raw(revoked)).toEqual(beforeRevocation);
  } finally { await sessionBlock.close(); await reading.catch(() => {}); }

  const expiry = await historyFixture(); await transfer(expiry, "CREATOR");
  const beforeExpiry = await raw(expiry), expiresAt = new Date(Date.now() + 2500), next = message(expiry.deal, "Original author final-boundary write");
  await prisma.authSession.update({ where: { id: expiry.brand.actor.sessionId }, data: { expiresAt } });
  expect(await resolveSession(expiry.brand.token)).not.toBeNull();
  // MESSAGE inserts its own row/journal/events before DealDTO SELECTs DealRating.
  // Holding DealRating proves final projection, not merely pre-write blocking.
  const dtoBlock = await hold("DealRating", null), writing = applyDealCommand(expiry.brandUserId, expiry.deal.id, next, options(expiry, expiry.brand));
  void writing.catch(() => {});
  try {
    await observed(dtoBlock, writing); expect(Date.now()).toBeLessThan(expiresAt.getTime());
    while (Date.now() <= expiresAt.getTime()) await delay(Math.min(50, expiresAt.getTime() - Date.now() + 1));
    expect(await resolveSession(expiry.brand.token)).toBeNull(); dtoBlock.release(); await dtoBlock.holding;
    await expect(writing).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    expect(await raw(expiry)).toEqual(beforeExpiry);
    await expect(applyDealCommand(expiry.brandUserId, expiry.deal.id, expiry.send, options(expiry, expiry.brand)))
      .rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    expect(await raw(expiry)).toEqual(beforeExpiry);
  } finally { await dtoBlock.close(); await writing.catch(() => {}); }
}, 60000);
