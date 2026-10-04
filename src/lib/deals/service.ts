import { randomUUID } from "node:crypto";
import { Prisma, type Brand, type Campaign, type Creator, type Deal, type DealOffer } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseBriefContent, type CampaignRequirementsDTO } from "@/lib/campaigns/contracts";
import { allocateMoney, MoneySchema } from "@/lib/contracts/money";
import { OfferTermsSchema, validateOfferTerms, type OfferTerms } from "@/lib/contracts/offers";
import { CountryCodeSchema, DateRangeSchema, OriginalTextSchema } from "@/lib/contracts/vocabulary";
import { canonicalHash, inputJson, record } from "@/lib/onboarding/drafts";
import { loadEligibleCreator } from "@/lib/matching/persistence";
import { AgreementContentSchema, CreateDealSchema, DealCommandSchema, DealError,
  type DealCommand, type DealOptions, type DealPolicyContext, type DealPolicyEvidence } from "./contracts";

type Tx = Prisma.TransactionClient;
type Context = { brand: Brand; creator: Creator; campaign: Campaign; brandUserId: string; creatorUserId: string | null; originalCreatorUserId?: string; role: "BRAND" | "CREATOR" };
const Id = z.string().min(1).max(200).regex(/^[\x21-\x7e]+$/);
const ACTIVE = ["OFFERED", "COUNTERED", "ACCEPTED", "AGREED", "DELIVERED"] as const;
const WEEK = 7 * 24 * 3600_000;
function parse<T>(schema: z.ZodType<T>, input: unknown, code = "INVALID_COMMAND"): T {
  const result = schema.safeParse(input); if (!result.success) throw new DealError(code, 400); return result.data;
}
function clock(options: DealOptions): Date {
  const now = options.now ?? new Date(); if (!Number.isFinite(now.getTime())) throw new DealError("INVALID_CLOCK", 400); return now;
}
const past = (value: Date | null, now: Date) => value !== null && value <= now;
async function context(tx: Tx, actor: string, campaignId: string, creatorId: string, write: boolean, originalCreatorUserId?: string): Promise<Context> {
  parse(Id, actor); parse(Id, campaignId); parse(Id, creatorId);
  const reference = await tx.campaign.findUnique({ where: { id: campaignId }, select: { brand: { select: { id: true, userId: true } } } });
  const target = await tx.creator.findUnique({ where: { id: creatorId }, select: { userId: true } });
  if (!reference || !target) throw new DealError("NOT_FOUND", 404);
  // The campaign's brand is the shared anchor with campaign/matching services.
  // Creator-first locking would invert their Brand User -> Campaign -> Creator
  // ordering. Actual participant identities and roles are reloaded after locks.
  if (write) await tx.$queryRaw`SELECT id FROM "User" WHERE id=${reference.brand.userId} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "User" WHERE id=${reference.brand.userId} FOR SHARE`;
  const creatorUsers = [...new Set([target.userId, originalCreatorUserId].filter((id): id is string => !!id && id !== reference.brand.userId))].sort();
  for (const creatorUserId of creatorUsers) {
    if (write) await tx.$queryRaw`SELECT id FROM "User" WHERE id=${creatorUserId} FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM "User" WHERE id=${creatorUserId} FOR SHARE`;
  }
  await tx.$queryRaw`SELECT id FROM "Brand" WHERE id=${reference.brand.id} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Creator" WHERE id=${creatorId} FOR SHARE`;
  if (write) await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id=${campaignId} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id=${campaignId} FOR SHARE`;
  const [campaign, brand, creator, user] = await Promise.all([
    tx.campaign.findUniqueOrThrow({ where: { id: campaignId } }), tx.brand.findUniqueOrThrow({ where: { id: reference.brand.id } }),
    tx.creator.findUniqueOrThrow({ where: { id: creatorId } }), tx.user.findUnique({ where: { id: actor } }),
  ]);
  if (brand.userId !== reference.brand.userId || creator.userId !== target.userId || campaign.brandId !== brand.id) throw new DealError("STALE_PARTICIPANTS");
  if (!user?.active || (user.role !== "BRAND" && user.role !== "CREATOR")) throw new DealError("FORBIDDEN", 403);
  if (actor !== brand.userId && actor !== creator.userId && actor !== originalCreatorUserId) throw new DealError("NOT_FOUND", 404);
  const role = actor === brand.userId ? "BRAND" : "CREATOR";
  if (user.role !== role) throw new DealError("FORBIDDEN", 403);
  return { brand, creator, campaign, brandUserId: brand.userId, creatorUserId: creator.userId, originalCreatorUserId, role };
}
// Domain-only helper for the private draft service. Server transports invoke the
// public commands, never supply a transaction callback or trusted policy context.
export const dealParticipantContext = context;
async function owned<T>(actor: string, dealId: string, options: DealOptions, write: boolean, operation: (tx: Tx, deal: Deal, ctx: Context, now: Date) => Promise<T>): Promise<T> {
  parse(Id, dealId); const client = options.client ?? prisma, now = clock(options);
  return client.$transaction(async tx => {
    const reference = await tx.deal.findUnique({ where: { id: dealId }, select: { campaignId: true, creatorId: true } });
    if (!reference) {
      const user = await tx.user.findUnique({ where: { id: actor }, select: { active: true, role: true } });
      if (!user?.active || !["BRAND", "CREATOR"].includes(user.role)) throw new DealError("FORBIDDEN", 403);
      throw new DealError("NOT_FOUND", 404);
    }
    const first = await tx.dealOffer.findUnique({ where: { dealId_version: { dealId, version: 1 } } });
    if (!first) throw new DealError("INVALID_DEAL_HISTORY");
    if (actor !== first.proposerUserId && actor !== first.recipientUserId) {
      const user = await tx.user.findUnique({ where: { id: actor }, select: { active: true, role: true } });
      if (!user?.active || !["BRAND", "CREATOR"].includes(user.role)) throw new DealError("FORBIDDEN", 403);
      throw new DealError("NOT_FOUND", 404);
    }
    const ctx = await context(tx, actor, reference.campaignId, reference.creatorId, write, first.recipientUserId);
    if (ctx.brandUserId !== first.proposerUserId) throw new DealError("STALE_PARTICIPANTS");
    if (write) await tx.$queryRaw`SELECT id FROM "Deal" WHERE id=${dealId} FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM "Deal" WHERE id=${dealId} FOR SHARE`;
    const deal = await tx.deal.findUniqueOrThrow({ where: { id: dealId } });
    if (deal.brandId !== ctx.brand.id || deal.creatorId !== ctx.creator.id || deal.campaignId !== ctx.campaign.id) throw new DealError("STALE_PARTICIPANTS");
    return operation(tx, deal, ctx, now);
  }, { maxWait: 10_000, timeout: 20_000 });
}
async function requirements(tx: Tx, ctx: Context, version: number, current: boolean, now: Date): Promise<CampaignRequirementsDTO> {
  const brief = await tx.campaignBrief.findUnique({ where: { campaignId_version: { campaignId: ctx.campaign.id, version } } });
  if (!brief || !past(brief.approvedAt, now) || brief.approvedByUserId !== ctx.brandUserId) throw new DealError("BRIEF_NOT_APPROVED");
  let content; try { content = parseBriefContent(brief.content); } catch { throw new DealError("INVALID_APPROVED_BRIEF"); }
  if (content.approvedByUserId !== ctx.brandUserId || content.requirements.campaignId !== ctx.campaign.id || content.requirements.version !== version || content.inputRevision !== brief.inputRevision) throw new DealError("INVALID_APPROVED_BRIEF");
  if (current && (ctx.campaign.currentBriefVersion !== version || record(ctx.campaign.input).fieldsRevision !== content.inputRevision || !["BRIEF_APPROVED", "SHORTLISTED", "IN_DEALS"].includes(ctx.campaign.status))) throw new DealError("STALE_BRIEF");
  if (current && ctx.brand.countryCode !== content.requirements.brandCountryCode) throw new DealError("STALE_BRIEF");
  return content.requirements;
}
async function executable(tx: Tx, ctx: Context, terms: OfferTerms, requirements: CampaignRequirementsDTO, now: Date, options: DealOptions): Promise<void> {
  const creator = ctx.creator;
  if (!creator.userId || creator.isTest || creator.state !== "PUBLISHED" || !creator.brandVisible || !past(creator.publicConsentAt, now) || !creator.primaryAccountId || !CountryCodeSchema.safeParse(creator.countryCode).success) throw new DealError("CREATOR_NOT_EXECUTABLE");
  const users = await tx.user.findMany({ where: { id: { in: [ctx.brandUserId, creator.userId] } } });
  if (users.some(user => !user.active || user.isTest || !past(user.emailVerifiedAt, now)) || users.find(u => u.id === creator.userId)?.role !== "CREATOR" || users.find(u => u.id === ctx.brandUserId)?.role !== "BRAND") throw new DealError("CREATOR_NOT_EXECUTABLE");
  await tx.$queryRaw`SELECT id FROM "SocialAccount" WHERE "creatorId"=${creator.id} ORDER BY id FOR SHARE`;
  const accounts = await tx.socialAccount.findMany({ where: { creatorId: creator.id } });
  const reviewers = new Set((await tx.user.findMany({ where: { id: { in: accounts.flatMap(a => a.ownershipReviewedBy ? [a.ownershipReviewedBy] : []) }, role: "ADMIN", active: true }, select: { id: true } })).map(u => u.id));
  const proof = (account: typeof accounts[number]) => account.ownershipStatus === "VERIFIED" && account.ownershipReviewedBy !== null && reviewers.has(account.ownershipReviewedBy)
    && past(account.ownershipReviewedAt, now) && past(account.intendedConfirmedAt, now) && past(account.consentAt, now)
    && account.ownershipIdentityHash === canonicalHash({ platform: account.platform, providerAccountId: account.providerAccountId, normalizedHandle: account.handle, confirmedOrigin: null });
  const primary = accounts.find(a => a.id === creator.primaryAccountId);
  if (!primary || !proof(primary)) throw new DealError("CREATOR_NOT_EXECUTABLE");
  const usable: typeof accounts = [];
  for (const account of accounts) {
    if (!account.brandVisible || !past(account.factsApprovedAt, now) || !proof(account)) continue;
    const snapshot = await tx.metricsSnapshot.findFirst({ where: { accountId: account.id, mappingRevision: account.mappingRevision, reviewStatus: "VERIFIED", approvedBy: { not: null },
      approvedAt: { not: null, lte: now }, excludedAt: null, observedAt: { gte: new Date(now.getTime() - 90 * 24 * 3600_000), lte: now } }, orderBy: [{ observedAt: "desc" }, { id: "asc" }] });
    if (snapshot && snapshot.approvedAt! >= snapshot.observedAt) usable.push(account);
  }
  for (const row of terms.deliverables) {
    if (!usable.some(a => a.platform === row.platform && a.supportedFormats.includes(row.format))) throw new DealError("UNSUPPORTED_DELIVERABLE");
    const requested = requirements.deliverables.find(d => d.platform === row.platform && d.format === row.format);
    if (!requested || requested.count < row.count) throw new DealError("UNSUPPORTED_DELIVERABLE");
  }
  const available = record(creator.availability), period = DateRangeSchema.safeParse({ startsAt: available.startsAt, endsAt: available.endsAt, timeZone: creator.timeZone });
  if (available.status !== "AVAILABLE" || typeof available.confirmedAt !== "string" || !Number.isFinite(Date.parse(available.confirmedAt)) || Date.parse(available.confirmedAt) > now.getTime() || !period.success
    || Date.parse(period.data.startsAt) > Date.parse(terms.period.startsAt) || Date.parse(period.data.endsAt) < Date.parse(terms.period.endsAt)) throw new DealError("AVAILABILITY_REQUIRED");
  if (!requirements.contentLanguages.some(language => creator.languages.includes(language)) || requirements.dialects.length && !requirements.dialects.some(dialect => creator.dialects.includes(dialect))) throw new DealError("CREATOR_NOT_EXECUTABLE");
  if (requirements.physicalPresenceRequired) {
    const travel = record(creator.travel), countries = Array.isArray(travel.countryCodes) ? travel.countryCodes : [];
    if (!requirements.presenceCountryCodes.includes(creator.countryCode!) && !(requirements.travelAllowed && travel.willing === true && requirements.presenceCountryCodes.some(country => countries.includes(country)))) throw new DealError("PRESENCE_REQUIRED");
  }
  // Identical current permission, source, tier, preferred licence and reviewed
  // safety eligibility for MATCH and direct execution, without producing a score.
  if (!await loadEligibleCreator(tx, requirements, creator.id, now, { policyReader: options.policyReader })) throw new DealError("CREATOR_NOT_ELIGIBLE");
}
function termsFor(value: unknown, r: CampaignRequirementsDTO): OfferTerms {
  try { const terms = validateOfferTerms(value, { currencyCode: r.budget.currencyCode });
    if (Date.parse(terms.period.startsAt) < Date.parse(r.period.startsAt) || Date.parse(terms.period.endsAt) > Date.parse(r.period.endsAt) || terms.period.timeZone !== r.period.timeZone) throw new Error("Period outside brief");
    return terms;
  } catch { throw new DealError("INVALID_TERMS", 400); }
}
async function verify(tx: Tx, actor: string, ctx: Context, terms: OfferTerms, stage: "OFFER" | "ACCEPT" | "CONFIRM", options: DealOptions, trusted: DealPolicyContext, language?: "ar" | "en"): Promise<DealPolicyEvidence> {
  if (!options.policyVerifier) throw new DealError("POLICY_UNAVAILABLE", 503);
  const evidence = await options.policyVerifier(tx, actor, ctx.campaign.id, ctx.creator.id, terms, stage, language, trusted);
  if (!evidence?.governingTerms || evidence.governingTerms.id !== terms.governingTermsVersionId || !["ar", "en"].includes(evidence.governingTerms.language)
    || !evidence.governingTerms.content.trim() || !evidence.policyVersion || !Array.isArray(evidence.licenceSnapshots) || !Array.isArray(evidence.marketPolicyVersions)) throw new DealError("POLICY_UNAVAILABLE", 503);
  inputJson(evidence); return evidence;
}
async function reserve(tx: Tx, ctx: Context, r: CampaignRequirementsDTO, terms: OfferTerms, current: Deal | null): Promise<number> {
  // Accepted obligations never disappear when a brief changes or an accepted
  // agreement is cancelled/completed. Terminal never-accepted offers release slots.
  const deals = await tx.deal.findMany({ where: { campaignId: ctx.campaign.id, OR: [{ acceptedOfferVersion: { not: null } }, { status: { in: [...ACTIVE] } }] }, include: { offers: true } });
  const others = deals.filter(d => d.id !== current?.id), occupied = new Set(others.flatMap(d => d.slotOrdinal === null ? [] : [d.slotOrdinal]));
  if (others.some(d => d.slotOrdinal === null)) throw new DealError("LEGACY_ALLOCATION_UNAVAILABLE");
  const ordinal = current?.slotOrdinal ?? Array.from({ length: r.desiredCreatorCount }, (_, i) => i).find(i => !occupied.has(i));
  if (ordinal === undefined || ordinal === null || ordinal >= r.desiredCreatorCount || occupied.has(ordinal)) throw new DealError("CAMPAIGN_SLOTS_FULL");
  let total = BigInt(terms.amount.amountMinor);
  for (const deal of others) {
    const offer = deal.offers.find(o => o.version === (deal.acceptedOfferVersion ?? deal.currentOfferVersion)), money = MoneySchema.safeParse(record(offer?.terms).amount);
    if (!money.success || money.data.currencyCode !== r.budget.currencyCode) throw new DealError("BUDGET_CURRENCY_CONFLICT");
    total += BigInt(money.data.amountMinor);
  }
  const allocation = allocateMoney(r.budget, r.desiredCreatorCount)[ordinal];
  if (BigInt(terms.amount.amountMinor) > BigInt(allocation.amountMinor) || total > BigInt(r.budget.amountMinor)) throw new DealError("BUDGET_EXCEEDED");
  return ordinal;
}
async function replay(tx: Tx, actor: string, key: string, hash: string, dealId?: string): Promise<string | null> {
  const previous = await tx.dealCommand.findUnique({ where: { actorUserId_operationKey: { actorUserId: actor, operationKey: key } } });
  if (previous) { if (previous.payloadHash !== hash || dealId && previous.dealId !== dealId) throw new DealError("IDEMPOTENCY_CONFLICT"); return previous.dealId; }
  if (dealId && await tx.dealCommand.findUnique({ where: { dealId_operationKey: { dealId, operationKey: key } } })) throw new DealError("IDEMPOTENCY_CONFLICT");
  return null;
}
async function event(tx: Tx, deal: Deal, actor: string, key: string, type: string, payload: unknown, now: Date): Promise<void> {
  const id = randomUUID(), envelope = { id, type, actorUserId: actor, aggregateType: "Deal", aggregateId: deal.id, aggregateVersion: deal.version, idempotencyKey: key, occurredAt: now.toISOString(), payload };
  await tx.dealEvent.create({ data: { id, dealId: deal.id, actorUserId: actor, type, snapshot: inputJson(envelope), createdAt: now } });
  await tx.outboxEvent.create({ data: { deduplicationKey: `deal:${deal.id}:${key}:${type}`, type, payload: inputJson(envelope), createdAt: now, availableAt: now } });
}
async function ledger(tx: Tx, deal: Deal, actor: string, key: string, hash: string, now: Date): Promise<void> {
  // Neutral receipt excludes actor-specific projections and sealed ratings.
  await tx.dealCommand.create({ data: { dealId: deal.id, actorUserId: actor, operationKey: key, payloadHash: hash, result: { dealId: deal.id, version: deal.version }, createdAt: now } });
}
function ratingVisible(deal: Deal, count: number, now: Date): boolean { return count === 2 || deal.firstRatingAt !== null && now.getTime() >= deal.firstRatingAt.getTime() + WEEK; }
function agreementHash(value: Record<string, unknown>): string { return canonicalHash(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "contentHash"))); }
export async function dealDTO(tx: Tx, deal: Deal, actor: string, now: Date) {
  const [offers, agreements, confirmations, messages, ratings, events] = await Promise.all([
    tx.dealOffer.findMany({ where: { dealId: deal.id }, orderBy: { version: "asc" } }), tx.agreementSnapshot.findMany({ where: { dealId: deal.id }, orderBy: { version: "asc" } }),
    tx.agreementConfirmation.findMany({ where: { dealId: deal.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }), tx.dealMessage.findMany({ where: { dealId: deal.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    tx.dealRating.findMany({ where: { dealId: deal.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }), tx.dealEvent.findMany({ where: { dealId: deal.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
  ]);
  const revealed = ratingVisible(deal, ratings.length, now);
  const offerDTO = (offer: DealOffer) => ({ id: offer.id, dealId: offer.dealId, version: offer.version, proposerUserId: offer.proposerUserId, recipientUserId: offer.recipientUserId, status: offer.status,
    terms: parse(OfferTermsSchema, offer.terms, "INVALID_STORED_TERMS"), createdAt: offer.createdAt.toISOString(), acceptedAt: offer.acceptedAt?.toISOString() ?? null });
  const currentOffer = offers.find(o => o.version === deal.currentOfferVersion); if (!currentOffer) throw new DealError("INVALID_DEAL_HISTORY");
  const agreement = agreements.find(a => a.version === deal.agreementVersion), content = agreement ? parse(AgreementContentSchema, agreement.content, "INVALID_AGREEMENT_HISTORY") : null;
  if (content && agreementHash(content) !== content.contentHash) throw new DealError("INVALID_AGREEMENT_HISTORY");
  return { id: deal.id, campaignId: deal.campaignId, creatorId: deal.creatorId, brandId: deal.brandId, status: deal.status, version: deal.version,
    briefVersion: deal.briefVersion, origin: deal.origin, matchRunId: deal.matchRunId, slotOrdinal: deal.slotOrdinal, currentOffer: offerDTO(currentOffer), offers: offers.map(offerDTO),
    agreement: agreement && content ? { id: agreement.id, dealId: deal.id, version: agreement.version, ...content, createdAt: agreement.createdAt.toISOString() } : null,
    confirmations: confirmations.map(c => ({ userId: c.userId, role: c.role, version: c.version, confirmedAt: c.createdAt.toISOString() })),
    messages: messages.map(m => ({ id: m.id, senderUserId: m.senderUserId, text: parse(OriginalTextSchema, { text: m.text, language: m.language }), createdAt: m.createdAt.toISOString() })),
    ratings: ratings.filter(r => revealed || r.userId === actor).map(r => ({ id: r.id, dealId: deal.id, authorUserId: r.userId, stars: r.score,
      comment: r.comment === null ? null : parse(OriginalTextSchema, { text: r.comment, language: r.language }), submittedAt: r.createdAt.toISOString() })),
    ratingsRevealed: revealed, ratingsRevealAt: deal.firstRatingAt ? new Date(deal.firstRatingAt.getTime() + WEEK).toISOString() : null,
    events: events.map(e => ({ id: e.id, type: e.type, actorUserId: e.actorUserId, occurredAt: e.createdAt.toISOString(), payload: record(e.snapshot).payload ?? null })),
    deliveredAt: deal.deliveredAt?.toISOString() ?? null, completedAt: deal.completedAt?.toISOString() ?? null,
    brandPaymentReportedAt: deal.brandPaymentReportedAt?.toISOString() ?? null, creatorReceiptReportedAt: deal.creatorReceiptReportedAt?.toISOString() ?? null,
    createdAt: deal.createdAt.toISOString(), updatedAt: deal.updatedAt.toISOString() };
}
export type DealDTO = Awaited<ReturnType<typeof dealDTO>>;
export async function createDealOffer(actor: string, input: unknown, options: DealOptions = {}): Promise<{ deal: DealDTO; replayed: boolean }> {
  const command = parse(CreateDealSchema, input), now = clock(options), hash = canonicalHash({ action: "CREATE", ...command });
  return (options.client ?? prisma).$transaction(async tx => {
    const ctx = await context(tx, actor, command.campaignId, command.creatorId, true);
    if (ctx.role !== "BRAND") throw new DealError("ROLE_ONLY", 403);
    const replayId = await replay(tx, actor, command.operationKey, hash);
    if (replayId) return { deal: await dealDTO(tx, await tx.deal.findUniqueOrThrow({ where: { id: replayId } }), actor, now), replayed: true };
    if (ctx.campaign.revision !== command.expectedCampaignRevision) throw new DealError("STALE_VERSION");
    const r = await requirements(tx, ctx, command.expectedBriefVersion, true, now), terms = termsFor(command.terms, r);
    if (command.origin === "MATCH") {
      const run = command.matchRunId && await tx.matchRun.findUnique({ where: { id: command.matchRunId } });
      const result = run && await tx.creatorMatch.findUnique({ where: { runId_creatorId: { runId: run.id, creatorId: ctx.creator.id } } }), snapshot = record(run && run.requirementSnapshot);
      if (!run || run.campaignId !== ctx.campaign.id || run.briefVersion !== r.version || snapshot.fieldsRevision !== record(ctx.campaign.input).fieldsRevision || !result || result.score < 60) throw new DealError("INVALID_MATCH_ORIGIN");
    } else if (command.matchRunId) throw new DealError("INVALID_MATCH_ORIGIN");
    await executable(tx, ctx, terms, r, now, options); await verify(tx, actor, ctx, terms, "OFFER", options, { requirements: r, dealId: null });
    if (await tx.deal.findFirst({ where: { campaignId: ctx.campaign.id, creatorId: ctx.creator.id, status: { in: [...ACTIVE] } } })) throw new DealError("ACTIVE_DEAL_EXISTS");
    const ordinal = await reserve(tx, ctx, r, terms, null);
    const deal = await tx.deal.create({ data: { campaignId: ctx.campaign.id, creatorId: ctx.creator.id, brandId: ctx.brand.id, briefVersion: r.version,
      origin: command.origin, matchRunId: command.matchRunId, slotOrdinal: ordinal, createdAt: now, updatedAt: now } });
    await tx.dealOffer.create({ data: { dealId: deal.id, version: 1, proposerUserId: actor, recipientUserId: ctx.creatorUserId!, terms: inputJson(terms), createdAt: now } });
    await tx.campaign.update({ where: { id: ctx.campaign.id }, data: { status: "IN_DEALS" } });
    if (command.matchRunId) await tx.matchDecisionRecord.upsert({ where: { campaignId_creatorId: { campaignId: ctx.campaign.id, creatorId: ctx.creator.id } },
      create: { campaignId: ctx.campaign.id, creatorId: ctx.creator.id, actorUserId: actor, decision: "OFFER_SENT", runId: command.matchRunId }, update: { actorUserId: actor, decision: "OFFER_SENT", runId: command.matchRunId, revision: { increment: 1 } } });
    await event(tx, deal, actor, command.operationKey, "deal.offered", { offerVersion: 1, origin: deal.origin, slotOrdinal: ordinal }, now);
    await ledger(tx, deal, actor, command.operationKey, hash, now);
    return { deal: await dealDTO(tx, deal, actor, now), replayed: false };
  }, { maxWait: 10_000, timeout: 20_000 });
}
export async function getDeal(actor: string, dealId: string, options: DealOptions = {}): Promise<DealDTO> {
  return owned(actor, dealId, options, false, (tx, deal, _ctx, now) => dealDTO(tx, deal, actor, now));
}
export async function listDeals(actor: string, input: unknown = {}, options: DealOptions = {}) {
  const query = parse(z.object({ limit: z.number().int().min(1).max(50).default(20), cursor: Id.optional() }).strict(), input), client = options.client ?? prisma;
  const user = await client.user.findUnique({ where: { id: actor }, select: { active: true, role: true } });
  if (!user?.active || (user.role !== "BRAND" && user.role !== "CREATOR")) throw new DealError("FORBIDDEN", 403);
  const where: Prisma.DealWhereInput = user.role === "BRAND" ? { brand: { userId: actor }, offers: { some: { version: 1, proposerUserId: actor } } }
    : { offers: { some: { version: 1, recipientUserId: actor } } };
  if (query.cursor && !await client.deal.findFirst({ where: { ...where, id: query.cursor } })) throw new DealError("INVALID_CURSOR", 400);
  const rows = await client.deal.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: query.limit + 1, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}) });
  return { deals: await Promise.all(rows.slice(0, query.limit).map(row => getDeal(actor, row.id, options))), nextCursor: rows.length > query.limit ? rows[query.limit - 1].id : null };
}
async function currentOffer(tx: Tx, deal: Deal, command: Extract<DealCommand, { action: "COUNTER" | "ACCEPT" | "DECLINE" }>): Promise<DealOffer> {
  if (!["OFFERED", "COUNTERED"].includes(deal.status)) throw new DealError("INVALID_STATE");
  const offer = await tx.dealOffer.findUniqueOrThrow({ where: { dealId_version: { dealId: deal.id, version: deal.currentOfferVersion } } });
  if (offer.version !== command.expectedOfferVersion || offer.id !== command.offerId || offer.status !== "PENDING") throw new DealError("STALE_OFFER");
  return offer;
}
function allowed(deal: Deal, states: string[]): void { if (!states.includes(deal.status)) throw new DealError("INVALID_STATE"); }
function requireRole(ctx: Context, role: Context["role"]): void { if (ctx.role !== role) throw new DealError("ROLE_ONLY", 403); }
async function agreementFor(tx: Tx, deal: Deal, ctx: Context, offer: DealOffer, terms: OfferTerms, r: CampaignRequirementsDTO, policy: DealPolicyEvidence, language: "ar" | "en", now: Date): Promise<void> {
  if (policy.governingTerms.language !== language) throw new DealError("REVIEWED_LANGUAGE_UNAVAILABLE", 503);
  const partiesSnapshot = { brandUserId: ctx.brandUserId, creatorUserId: ctx.creatorUserId!, brandId: ctx.brand.id, creatorId: ctx.creator.id,
    brandName: ctx.brand.name, creatorName: ctx.creator.displayName, creatorHandle: ctx.creator.handle }, content = policy.governingTerms.content;
  // Reviewed prose stays unchanged; exact obligations/identities are frozen beside
  // it. This is an app audit snapshot, with no generated law/e-signature claim.
  const agreement = { schemaVersion: 1, acceptedOfferId: offer.id, language, terms,
    brandCountryCode: parse(CountryCodeSchema, ctx.brand.countryCode), creatorCountryCode: parse(CountryCodeSchema, ctx.creator.countryCode),
    campaignMarketCountryCodes: r.marketCountryCodes, partiesSnapshot, reviewedLicenceSnapshots: policy.licenceSnapshots,
    marketPolicyVersions: policy.marketPolicyVersions, policyVersion: policy.policyVersion, governingTermsVersionId: policy.governingTerms.id,
    content, contentHash: "", acceptedAt: now.toISOString() };
  // Bind negotiated obligations, identity, jurisdiction, reviewed policy versions
  // and language as well as prose. Hashing the reusable template alone is unsafe.
  agreement.contentHash = agreementHash(agreement);
  parse(AgreementContentSchema, agreement);
  await tx.agreementSnapshot.create({ data: { dealId: deal.id, version: 1, offerVersion: offer.version, briefVersion: deal.briefVersion, content: inputJson(agreement), createdAt: now } });
}
export async function applyDealCommand(actor: string, dealId: string, input: unknown, options: DealOptions = {}): Promise<{ deal: DealDTO; replayed: boolean }> {
  const command = parse(DealCommandSchema, input), hash = canonicalHash({ dealId, ...command });
  return owned(actor, dealId, options, true, async (tx, deal, ctx, now) => {
    if (await replay(tx, actor, command.operationKey, hash, dealId)) return { deal: await dealDTO(tx, deal, actor, now), replayed: true };
    if (deal.version !== command.expectedVersion) throw new DealError("STALE_VERSION");
    if (ctx.creatorUserId !== ctx.originalCreatorUserId && !["CANCEL", "MESSAGE"].includes(command.action)) throw new DealError("STALE_PARTICIPANTS");
    const patch: Prisma.DealUpdateManyMutationInput = {}, emitted: { type: string; payload: unknown }[] = [];
    let unchanged = false;
    if (command.action === "COUNTER" || command.action === "ACCEPT" || command.action === "DECLINE") {
      const offer = await currentOffer(tx, deal, command);
      if (command.action !== "COUNTER" && (offer.recipientUserId !== actor || offer.proposerUserId === actor)) throw new DealError("RECIPIENT_ONLY", 403);
      if (command.action === "COUNTER") {
        const r = await requirements(tx, ctx, deal.briefVersion, true, now), terms = termsFor(command.terms, r);
        await executable(tx, ctx, terms, r, now, options); await verify(tx, actor, ctx, terms, "OFFER", options, { requirements: r, dealId }); await reserve(tx, ctx, r, terms, deal);
        await tx.dealOffer.update({ where: { id: offer.id }, data: { status: "SUPERSEDED" } });
        await tx.dealOffer.create({ data: { dealId, version: offer.version + 1, proposerUserId: actor, recipientUserId: actor === ctx.brandUserId ? ctx.creatorUserId! : ctx.brandUserId, terms: inputJson(terms), createdAt: now } });
        patch.status = "COUNTERED"; patch.currentOfferVersion = offer.version + 1; emitted.push({ type: "deal.countered", payload: { offerVersion: offer.version + 1 } });
      } else if (command.action === "ACCEPT") {
        const r = await requirements(tx, ctx, deal.briefVersion, true, now), terms = termsFor(offer.terms, r);
        await executable(tx, ctx, terms, r, now, options); const policy = await verify(tx, actor, ctx, terms, "ACCEPT", options, { requirements: r, dealId }, command.language); await reserve(tx, ctx, r, terms, deal);
        await agreementFor(tx, deal, ctx, offer, terms, r, policy, command.language, now);
        await tx.dealOffer.update({ where: { id: offer.id }, data: { status: "ACCEPTED", acceptedAt: now } });
        patch.status = "ACCEPTED"; patch.acceptedOfferVersion = offer.version; patch.agreementVersion = 1; emitted.push({ type: "deal.accepted", payload: { offerVersion: offer.version, agreementVersion: 1 } });
      } else {
        await tx.dealOffer.update({ where: { id: offer.id }, data: { status: "DECLINED" } }); patch.status = "DECLINED"; emitted.push({ type: "deal.declined", payload: { reason: command.reason, offerVersion: offer.version } });
      }
    } else if (command.action === "CONFIRM") {
      const agreement = await tx.agreementSnapshot.findUnique({ where: { id: command.agreementId } });
      if (!agreement || agreement.dealId !== dealId || agreement.version !== command.expectedAgreementVersion || deal.agreementVersion !== agreement.version) throw new DealError("STALE_AGREEMENT");
      const existing = await tx.agreementConfirmation.findUnique({ where: { dealId_version_userId: { dealId, version: agreement.version, userId: actor } } });
      if (existing) { allowed(deal, ["ACCEPTED", "AGREED"]); unchanged = true; }
      else {
        allowed(deal, ["ACCEPTED"]); const content = parse(AgreementContentSchema, agreement.content);
        const r = await requirements(tx, ctx, deal.briefVersion, false, now);
        await executable(tx, ctx, content.terms, r, now, options); await verify(tx, actor, ctx, content.terms, "CONFIRM", options, { requirements: r, dealId, agreement: content }, content.language);
        await tx.agreementConfirmation.create({ data: { dealId, version: agreement.version, userId: actor, role: ctx.role, createdAt: now } });
        emitted.push({ type: "agreement.confirmed", payload: { agreementVersion: agreement.version, role: ctx.role } });
        if (await tx.agreementConfirmation.count({ where: { dealId, version: agreement.version } }) === 2) { patch.status = "AGREED"; emitted.push({ type: "deal.agreed", payload: { agreementVersion: agreement.version } }); }
      }
    } else if (command.action === "DELIVER") {
      requireRole(ctx, "CREATOR"); allowed(deal, ["AGREED"]); patch.status = "DELIVERED"; patch.deliveredAt = now; emitted.push({ type: "deal.delivered", payload: { evidence: command.evidence } });
    } else if (command.action === "COMPLETE") {
      requireRole(ctx, "BRAND"); allowed(deal, ["DELIVERED"]); patch.status = "COMPLETED"; patch.completedAt = now; emitted.push({ type: "deal.completed", payload: {} });
    } else if (command.action === "CANCEL") {
      allowed(deal, ["OFFERED", "COUNTERED", "ACCEPTED", "AGREED"]); patch.status = "CANCELLED";
      await tx.dealOffer.updateMany({ where: { dealId, status: "PENDING" }, data: { status: "CANCELLED" } }); emitted.push({ type: "deal.cancelled", payload: { reason: command.reason } });
    } else if (command.action === "DECLARE_PAID" || command.action === "DECLARE_RECEIVED") {
      requireRole(ctx, command.action === "DECLARE_PAID" ? "BRAND" : "CREATOR"); allowed(deal, ["AGREED", "DELIVERED", "COMPLETED"]);
      const paid = command.action === "DECLARE_PAID", value = paid ? deal.brandPaymentReportedAt : deal.creatorReceiptReportedAt;
      if (value) unchanged = true;
      else { if (paid) patch.brandPaymentReportedAt = now; else patch.creatorReceiptReportedAt = now;
        emitted.push({ type: paid ? "payment.paid_declared" : "payment.received_declared", payload: { declaration: "USER_REPORTED" } }); }
    } else if (command.action === "RATE") {
      allowed(deal, ["COMPLETED"]);
      if (await tx.dealRating.findUnique({ where: { dealId_userId: { dealId, userId: actor } } })) throw new DealError("ALREADY_RATED");
      await tx.dealRating.create({ data: { dealId, userId: actor, role: ctx.role, score: command.stars, comment: command.comment?.text ?? null, language: command.comment?.language ?? null, createdAt: now } });
      patch.firstRatingAt = deal.firstRatingAt ?? now;
      emitted.push({ type: "rating.submitted", payload: { role: ctx.role, sealed: true } });
      if (await tx.dealRating.count({ where: { dealId } }) === 2) { patch.ratingsRevealedAt = now; emitted.push({ type: "ratings.revealed", payload: { reason: "BOTH_SUBMITTED" } }); }
    } else {
      // Postterminal party messages preserve support/history, never lifecycle jumps.
      await tx.dealMessage.create({ data: { dealId, senderUserId: actor, text: command.text.text, language: command.text.language, createdAt: now } });
      emitted.push({ type: "deal.message_posted", payload: { senderUserId: actor } });
    }
    let next = deal;
    if (!unchanged) {
      const result = await tx.deal.updateMany({ where: { id: dealId, version: command.expectedVersion }, data: { ...patch, version: { increment: 1 }, updatedAt: now } });
      if (result.count !== 1) throw new DealError("STALE_VERSION");
      next = await tx.deal.findUniqueOrThrow({ where: { id: dealId } });
      for (const e of emitted) await event(tx, next, actor, command.operationKey, e.type, e.payload, now);
    }
    await ledger(tx, next, actor, command.operationKey, hash, now);
    return { deal: await dealDTO(tx, next, actor, now), replayed: false };
  });
}
// Trusted internal job: elapsed-time rule matches reads, no score/comment payload.
export async function materializeRatingReveal(dealId: string, options: DealOptions = {}): Promise<{ revealed: boolean; changed: boolean }> {
  parse(Id, dealId); const now = clock(options);
  return (options.client ?? prisma).$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Deal" WHERE id=${dealId} FOR UPDATE`;
    const deal = await tx.deal.findUnique({ where: { id: dealId } }); if (!deal) throw new DealError("NOT_FOUND", 404);
    const ratings = await tx.dealRating.findMany({ where: { dealId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    if (!ratingVisible(deal, ratings.length, now)) return { revealed: false, changed: false };
    if (deal.ratingsRevealedAt) return { revealed: true, changed: false };
    const next = await tx.deal.update({ where: { id: dealId }, data: { ratingsRevealedAt: now, version: { increment: 1 }, updatedAt: now } });
    await event(tx, next, ratings[0].userId, "rating-reveal", "ratings.revealed", { reason: ratings.length === 2 ? "BOTH_SUBMITTED" : "SEVEN_DAYS_ELAPSED" }, now);
    return { revealed: true, changed: true };
  });
}
