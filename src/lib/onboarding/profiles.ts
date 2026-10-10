import { Prisma, PrismaClient, type Creator, type Brand, type OnboardingDraft } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AvailabilitySchema, ArabicDialectSchema, ContentLanguageSchema, ContentStyleSchema, CountryCodeSchema, FameIndustrySchema, LocationSchema, normalizeBrandSlug, normalizeInfameHandle, PLATFORM_FORMATS, PlatformSchema, DealFormatSchema, UtcDateTimeSchema } from "@/lib/contracts/vocabulary";
import { CurrencyCodeSchema, MoneySchema } from "@/lib/contracts/money";
import { NICHE_BY_SLUG } from "@/lib/contracts/taxonomy";
import { acceptedRepresentativeProof, currentBrandOwner, currentCreatorOwner, lockEvidenceActors, lockEvidenceDomain, type EvidenceActorLocks } from "@/lib/evidence/readiness";
import { canonicalHash, checkedJson, CommandBaseSchema, commandReplay, consentOf, draftDTO, inputJson, OnboardingError, parse, persistCommand, record, requireRevision, stateOf, withOwnedDraft, type DraftDTO, type Json, type Transaction } from "./drafts";
import { ProfileTextSchema as text, PortfolioContentSchema, type PortfolioContent } from "./portfolio-contract";
import { beginOnboardingSession, lockOnboardingSession, withOnboardingSession,
  type OnboardingReadOptions, type OnboardingCommandOptions } from "./session";
import { creatorPublicationCore } from "./public-creator-core";
import { assertPublicationPrerequisites, assertPublicationAccountSelection,
  currentPublicationPortfolio as currentPortfolio, type PublicationPortfolio as PortfolioDTO } from "./publication-prerequisites";
export { PortfolioContentSchema, type PortfolioContent } from "./portfolio-contract";

const MinorAmountSchema = MoneySchema.shape.amountMinor;
const rateSchema = z.object({ platform: PlatformSchema, format: DealFormatSchema, currencyCode: CurrencyCodeSchema, amountMinor: MinorAmountSchema.refine((value) => BigInt(value) > BigInt(0)) }).strict().refine((rate) => PLATFORM_FORMATS[rate.platform].includes(rate.format), "Unsupported format");
const availabilitySchema = z.object({ status: AvailabilitySchema, startsAt: UtcDateTimeSchema.nullable(), endsAt: UtcDateTimeSchema.nullable() }).strict().refine((value) => value.status !== "AVAILABLE" || (value.startsAt !== null && value.endsAt !== null && value.startsAt < value.endsAt), "Availability requires a confirmed period");
const languageSchema = ContentLanguageSchema.unwrap();
const visibilitySchema = z.enum(["PRIVATE", "BRAND_ONLY", "PUBLIC"]);
const CreatorProfileSchema = z.object({
  displayName: text.max(100), infameHandle: z.string().max(100), bio: text.nullable(), location: LocationSchema.nullable(), languages: z.array(languageSchema).max(20),
  dialects: z.array(ArabicDialectSchema).max(12), nicheSlugs: z.array(z.string().refine((slug) => Object.hasOwn(NICHE_BY_SLUG, slug))).max(20), fameIndustries: z.array(FameIndustrySchema).max(12), contentStyles: z.array(ContentStyleSchema).max(10),
  preferredCurrency: CurrencyCodeSchema.nullable(), minimumMinor: MinorAmountSchema.refine((value) => BigInt(value) > BigInt(0)).nullable(), availability: availabilitySchema, travelWilling: z.boolean(), ratesVisibility: visibilitySchema,
  rates: z.array(rateSchema).max(100), primarySourceKey: z.string().max(64).nullable(),
}).strict().refine((value) => value.minimumMinor === null || value.preferredCurrency !== null, "Minimum requires currency").refine((value) => new Set(value.rates.map((rate) => `${rate.platform}:${rate.format}:${rate.currencyCode}`)).size === value.rates.length, "Duplicate rate");
const BrandProfileSchema = z.object({
  companyName: text.max(200), brandSlug: z.string().max(100), description: text.nullable(), location: LocationSchema.nullable(), noWebsite: z.boolean(), website: z.string().max(500).nullable(),
  contactName: text.max(100), representativeRole: text.max(100), targetMarkets: z.array(CountryCodeSchema).max(50), languages: z.array(languageSchema).max(20), preferredCurrency: CurrencyCodeSchema.nullable(),
}).strict().refine((value) => value.noWebsite ? value.website === null : value.website !== null, "Choose website or no-website path");
const CommandSchema = CommandBaseSchema.extend({ action: z.enum(["SAVE_PROFILE", "GENERATE_PORTFOLIO", "APPROVE_PORTFOLIO", "PUBLISH", "HIDE"]), payload: z.unknown() }).strict();
type Result = { draft: DraftDTO; portfolio?: PortfolioDTO; replayed: boolean };
function handle(value: string, role: "CREATOR" | "BRAND") { try { return role === "CREATOR" ? normalizeInfameHandle(value) : normalizeBrandSlug(value); } catch { throw new OnboardingError("INVALID_HANDLE", 400); } }
function safeWebsite(value: string | null) {
  if (value === null) return null;
  let url: URL;
  try { url = new URL(value); } catch { throw new OnboardingError("INVALID_WEBSITE", 400); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) throw new OnboardingError("INVALID_WEBSITE", 400);
  // This value is a private declared link, never authorization to fetch it.
  return url.href;
}
function profileFact(value: Json, now: Date) { return { value, source: "SELF_REPORTED", evidenceAt: now.toISOString(), approvedAt: now.toISOString(), brandVisible: true, publicVisible: true }; }
const past = (date: Date | null, now: Date) => date !== null && date <= now;
async function syncMappedAccounts(tx: Transaction, creator: Creator, draft: OnboardingDraft, primarySourceKey: string | null) {
  const state = stateOf(draft), consents = consentOf(draft);
  let primaryAccountId: string | null = null;
  for (const [key, mapping] of Object.entries(state.sources)) {
    if (mapping.source === "WEBSITE" || !mapping.confirmedAt || !mapping.identity.normalizedHandle) continue;
    const declaredHandle = mapping.identity.normalizedHandle.trim().replace(/^@/, "");
    if (!declaredHandle || declaredHandle.length > 100 || /[\s\u0000-\u001f\u007f/:?#]/.test(declaredHandle)) throw new OnboardingError("INVALID_SOCIAL_HANDLE", 400);
    const consent = consents[key];
    const consentValid = consent?.sourceRevision === mapping.revision && consent.identityHash === canonicalHash(mapping.identity) && consent.scopes.includes("public-profile");
    const existing = await tx.socialAccount.findUnique({ where: { creatorId_platform_handle: { creatorId: creator.id, platform: mapping.source, handle: declaredHandle } } });
    const identityChanged = existing !== null && existing.providerAccountId !== mapping.identity.providerAccountId;
    const account = await tx.socialAccount.upsert({ where: { creatorId_platform_handle: { creatorId: creator.id, platform: mapping.source, handle: declaredHandle } },
      create: { creatorId: creator.id, platform: mapping.source, handle: declaredHandle, providerAccountId: mapping.identity.providerAccountId, intendedConfirmedAt: new Date(mapping.confirmedAt), consentAt: consentValid ? new Date(consent.grantedAt) : null, mappingRevision: mapping.revision, supportedFormats: [...PLATFORM_FORMATS[mapping.source]] },
      update: { intendedConfirmedAt: new Date(mapping.confirmedAt), consentAt: consentValid ? new Date(consent.grantedAt) : null, mappingRevision: mapping.revision,
        ...(identityChanged ? { providerAccountId: mapping.identity.providerAccountId, ownershipStatus: "UNPROVED", ownershipIdentityHash: null, ownershipReviewedAt: null, ownershipReviewedBy: null, ownershipProofAssetId: null } : {}),
        ...(existing?.mappingRevision === mapping.revision && consentValid ? {} : { publicVisible: false, brandVisible: false, factsApprovedAt: null }) } });
    if (key === primarySourceKey) primaryAccountId = account.id;
  }
  if (primarySourceKey !== null && primaryAccountId === null) throw new OnboardingError("PRIMARY_ACCOUNT_NOT_CONFIRMED");
  return primaryAccountId;
}

export async function profileCommand(actorUserId: string, draftId: string, input: unknown, options: OnboardingCommandOptions = {}): Promise<Result> {
  const session = await beginOnboardingSession(actorUserId, options);
  checkedJson(input);
  if (session.options.channel !== "FORM") throw new OnboardingError("EXPLICIT_CONFIRMATION_REQUIRED", 400);
  const command = parse(CommandSchema, input), operationKey = `profile:${command.operationKey}`, hash = canonicalHash(command);
  let evidenceActors!: EvidenceActorLocks;
  return withOwnedDraft(session, draftId, async (tx, draft, role) => {
    const replay = await commandReplay<Omit<Result, "replayed">>(tx, draft, operationKey, hash);
    if (replay) return { ...replay, replayed: true };
    requireRevision(draft, command.expectedRevision);
    const reference = role === "CREATOR" ? await tx.creator.findUnique({ where: { userId: actorUserId }, select: { id: true } }) : await tx.brand.findUnique({ where: { userId: actorUserId }, select: { id: true } });
    if (!reference) throw new OnboardingError("PROFILE_NOT_FOUND", 404);
    if (role === "CREATOR") await tx.$queryRaw`SELECT id FROM "Creator" WHERE id=${reference.id} FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM "Brand" WHERE id=${reference.id} FOR UPDATE`;
    const creator = role === "CREATOR" ? await tx.creator.findUnique({ where: { id: reference.id } }) : null;
    const brand = role === "BRAND" ? await tx.brand.findUnique({ where: { id: reference.id } }) : null;
    const profile = creator ?? brand;
    if (!profile || profile.userId !== actorUserId) throw new OnboardingError("STALE_OWNER");
    if (creator && !currentCreatorOwner(evidenceActors, creator) || brand && !currentBrandOwner(evidenceActors, brand)) throw new OnboardingError("STALE_OWNER");
    if (creator) await tx.$queryRaw`SELECT id FROM "SocialAccount" WHERE "creatorId"=${creator.id} ORDER BY id FOR SHARE`;
    else await tx.$queryRaw`SELECT id FROM "BusinessVerification" WHERE "brandId"=${brand!.id} ORDER BY id FOR SHARE`;
    const state = stateOf(draft), now = new Date();
    let portfolio: PortfolioDTO | null = null, step = draft.step;
    if (command.action === "SAVE_PROFILE") {
      if (creator) {
        const value = parse(CreatorProfileSchema, command.payload);
        const primaryAccountId = await syncMappedAccounts(tx, creator, draft, value.primarySourceKey);
        const facts = { ...record(creator.profileFacts), nicheSlugs: profileFact(value.nicheSlugs, now), fameIndustries: profileFact(value.fameIndustries, now), contentStyles: profileFact(value.contentStyles, now), ratesVisibility: value.ratesVisibility, mappingHash: canonicalHash(state.sources) };
        await tx.creator.update({ where: { id: creator.id }, data: {
          handle: handle(value.infameHandle, role), displayName: value.displayName, bio: value.bio, countryCode: value.location?.countryCode ?? null, city: value.location ? inputJson({ key: value.location.cityKey, label: value.location.cityLabel }) : Prisma.DbNull, timeZone: value.location?.timeZone ?? null,
          languages: value.languages, dialects: value.dialects, nicheIds: value.nicheSlugs, fameTags: value.fameIndustries, contentStyles: value.contentStyles, currency: value.preferredCurrency, minimumMinor: value.minimumMinor === null ? null : BigInt(value.minimumMinor),
          availability: inputJson({ ...value.availability, confirmedAt: now.toISOString() }), travel: inputJson({ willing: value.travelWilling }), primaryAccountId, state: "PRIVATE", brandVisible: false, profileFacts: inputJson(facts),
        } });
        await tx.creatorRate.deleteMany({ where: { creatorId: creator.id } });
        if (value.rates.length) await tx.creatorRate.createMany({ data: value.rates.map((rate) => ({ creatorId: creator.id, platform: rate.platform, format: rate.format, currency: rate.currencyCode, amountMinor: BigInt(rate.amountMinor) })) });
        state.answers = { ...state.answers, ...checkedJson(value) as Record<string, Json> };
      } else if (brand) {
        const value = parse(BrandProfileSchema, command.payload);
        await tx.brand.update({ where: { id: brand.id }, data: { slug: handle(value.brandSlug, role), name: value.companyName, description: value.description, countryCode: value.location?.countryCode ?? null, city: value.location ? inputJson({ key: value.location.cityKey, label: value.location.cityLabel }) : Prisma.DbNull, timeZone: value.location?.timeZone ?? null,
          website: safeWebsite(value.website), state: "PRIVATE", profileFacts: inputJson({ ...record(brand.profileFacts), targetMarkets: value.targetMarkets, languages: value.languages, preferredCurrency: value.preferredCurrency, contactName: value.contactName, representativeRole: value.representativeRole, noWebsite: value.noWebsite }) } });
        state.answers = { ...state.answers, ...checkedJson(value) as Record<string, Json> };
      }
      state.generatedSectionsStale = true;
      step = "MISSING_ESSENTIALS";
    } else if (command.action === "GENERATE_PORTFOLIO") {
      parse(z.object({}).strict(), command.payload);
      const content: PortfolioContent = creator ? { title: creator.displayName, bio: creator.bio ?? "", sections: [], method: "APPROVED_FACT_TEMPLATE" } : { title: brand!.name, bio: brand!.description ?? "", sections: [], method: "APPROVED_FACT_TEMPLATE" };
      const latest = await currentPortfolio(tx, role, profile.id), version = (latest?.version ?? 0) + 1;
      if (creator) await tx.portfolioVersion.create({ data: { creatorId: creator.id, version, content: inputJson(content), inputRevision: draft.revision + 1 } });
      else await tx.brandPortfolioVersion.create({ data: { brandId: brand!.id, version, content: inputJson(content), inputRevision: draft.revision + 1 } });
      portfolio = { version, content, approvedAt: null, inputRevision: draft.revision + 1 };
      // Approval prepares an asset; only a subsequent explicit publish operation
      // exposes its content. A fresh draft always returns to private visibility.
      if (creator) await tx.creator.update({ where: { id: creator.id }, data: { state: "PRIVATE", brandVisible: false } });
      else await tx.brand.update({ where: { id: brand!.id }, data: { state: "PRIVATE" } });
      state.generatedSectionsStale = false;
      step = "PORTFOLIO_DRAFT";
    } else if (command.action === "APPROVE_PORTFOLIO") {
      const value = parse(z.object({ portfolioVersion: z.number().int().positive(), content: PortfolioContentSchema }).strict(), command.payload);
      const latest = await currentPortfolio(tx, role, profile.id);
      if (!latest || latest.version !== value.portfolioVersion || state.generatedSectionsStale) throw new OnboardingError("PORTFOLIO_STALE");
      if (latest.approvedAt) {
        // An approved asset is immutable; further content edits create a new version.
        if (canonicalHash(latest.content) !== canonicalHash(value.content)) throw new OnboardingError("APPROVED_PORTFOLIO_IMMUTABLE");
        portfolio = latest;
      } else {
        const data = { content: inputJson(value.content), approvedAt: now, inputRevision: draft.revision + 1 };
        if (creator) await tx.portfolioVersion.update({ where: { creatorId_version: { creatorId: creator.id, version: latest.version } }, data });
        else await tx.brandPortfolioVersion.update({ where: { brandId_version: { brandId: brand!.id, version: latest.version } }, data });
        portfolio = { ...latest, content: value.content, approvedAt: now.toISOString(), inputRevision: draft.revision + 1 };
      }
      step = "PREVIEW";
    } else if (command.action === "PUBLISH") {
      const value = parse(z.object({ consent: z.boolean(), portfolioVersion: z.number().int().positive(), visibleAccountIds: z.array(z.string().min(1).max(200)).max(100).refine((ids) => new Set(ids).size === ids.length).optional() }).strict(), command.payload);
      portfolio = await assertPublicationPrerequisites(tx, { actorUserId,
        profile: creator ? { role: "CREATOR", creator } : { role: "BRAND", brand: brand! },
        state, payload: value, actors: evidenceActors, now });
      const publication = { state: "PUBLISHED" as const, publicConsentAt: now, publishedAt: now };
      if (creator) {
        await tx.creator.update({ where: { id: creator.id }, data: { ...publication, brandVisible: true } });
        const ids = await assertPublicationAccountSelection(tx, { actorUserId, creator, visibleAccountIds: value.visibleAccountIds, actors: evidenceActors, now });
        await tx.socialAccount.updateMany({ where: { creatorId: creator.id }, data: { publicVisible: false, brandVisible: false } });
        await tx.socialAccount.updateMany({ where: { id: { in: ids } }, data: { publicVisible: true, brandVisible: true } });
      } else await tx.brand.update({ where: { id: brand!.id }, data: publication });
      step = "PREVIEW";
    } else {
      parse(z.object({}).strict(), command.payload);
      if (creator) {
        await tx.creator.update({ where: { id: creator.id }, data: { state: "HIDDEN", brandVisible: false } });
        await tx.socialAccount.updateMany({ where: { creatorId: creator.id }, data: { publicVisible: false, brandVisible: false } });
      } else await tx.brand.update({ where: { id: brand!.id }, data: { state: "HIDDEN" } });
      step = "SAVED_DRAFT";
    }
    const result = await persistCommand(tx, draft, command.expectedRevision, operationKey, hash, { input: inputJson(state), step }, async (updated) => ({ draft: await draftDTO(tx, updated, role), ...(portfolio ? { portfolio } : {}) }));
    await tx.outboxEvent.create({ data: { deduplicationKey: `profile:${draft.id}:${command.operationKey}`, type: `profile.${command.action.toLowerCase()}`, payload: inputJson({ actorUserId, profileId: profile.id, role, revision: result.draft.revision }) } });
    return { ...result, replayed: false };
  }, async (tx, role) => {
    const profile = role === "CREATOR" ? await tx.creator.findUnique({ where: { userId: actorUserId }, select: { id: true } }) : await tx.brand.findUnique({ where: { userId: actorUserId }, select: { id: true } });
    evidenceActors = await lockEvidenceActors(tx, { creatorIds: role === "CREATOR" && profile ? [profile.id] : [], brandIds: role === "BRAND" && profile ? [profile.id] : [], otherOwnerIds: [actorUserId], updateOwners: true });
  });
}

export async function profileForOwner(actorUserId: string, options: OnboardingReadOptions = {}) {
  const session = await beginOnboardingSession(actorUserId, options);
  return withOnboardingSession(session, false, async tx => {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actorUserId} FOR SHARE`;
  await lockOnboardingSession(tx);
  const initialUser = await tx.user.findUnique({ where: { id: actorUserId }, select: { active: true, role: true } });
  if (!initialUser?.active || (initialUser.role !== "CREATOR" && initialUser.role !== "BRAND")) throw new OnboardingError("FORBIDDEN", 403);
  const reference = initialUser.role === "CREATOR" ? await tx.creator.findUnique({ where: { userId: actorUserId }, select: { id: true } }) : await tx.brand.findUnique({ where: { userId: actorUserId }, select: { id: true } });
  if (!reference) return null;
  await lockEvidenceDomain(tx, initialUser.role === "CREATOR" ? "Creator" : "Brand", [reference.id]);
  const user = await tx.user.findUnique({ where: { id: actorUserId }, select: { active: true, role: true } });
  if (!user?.active || user.role !== initialUser.role) throw new OnboardingError("FORBIDDEN", 403);
  const creator = user.role === "CREATOR" ? await tx.creator.findUnique({ where: { id: reference.id }, include: { accounts: true, rates: true } }) : null;
  const brand = user.role === "BRAND" ? await tx.brand.findUnique({ where: { id: reference.id } }) : null;
  if (!creator && !brand) return null;
  if ((creator ?? brand)?.userId !== actorUserId) return null;
  const profile = creator ? { id: creator.id, displayName: creator.displayName, handle: creator.handle, bio: creator.bio, state: creator.state, countryCode: creator.countryCode, city: creator.city, timeZone: creator.timeZone, languages: creator.languages, dialects: creator.dialects, nicheSlugs: creator.nicheIds, fameIndustries: creator.fameTags, contentStyles: creator.contentStyles, currency: creator.currency, minimumMinor: creator.minimumMinor?.toString() ?? null, availability: creator.availability, travel: creator.travel, facts: creator.profileFacts, primaryAccountId: creator.primaryAccountId, website: null }
    : { id: brand!.id, displayName: brand!.name, handle: brand!.slug, bio: brand!.description, state: brand!.state, countryCode: brand!.countryCode, city: brand!.city, timeZone: brand!.timeZone, languages: [], dialects: [], nicheSlugs: [], fameIndustries: [], contentStyles: [], currency: null, minimumMinor: null, availability: null, travel: null, facts: brand!.profileFacts, primaryAccountId: null, website: brand!.website };
  const portfolio = await currentPortfolio(tx, user.role as "CREATOR" | "BRAND", profile.id);
  return { role: user.role, profile, accounts: creator?.accounts.map((account) => ({ id: account.id, platform: account.platform, handle: account.handle, ownershipStatus: account.ownershipStatus, publicVisible: account.publicVisible, brandVisible: account.brandVisible, mappingRevision: account.mappingRevision, factsApprovedAt: account.factsApprovedAt?.toISOString() ?? null })) ?? [], rates: creator?.rates.map((rate) => ({ platform: rate.platform, format: rate.format, currencyCode: rate.currency, amountMinor: rate.amountMinor.toString() })) ?? [], portfolio };
  });
}
export type OwnerProfileDTO = NonNullable<Awaited<ReturnType<typeof profileForOwner>>>;

function profileReady(profile: Creator | Brand, now: Date) { return profile.state === "PUBLISHED" && !profile.isTest && past(profile.publicConsentAt, now); }
function readTransaction<T>(client: Transaction | PrismaClient, operation: (tx: Transaction) => Promise<T>): Promise<T> {
  return "$transaction" in client ? client.$transaction(operation, { maxWait: 10_000, timeout: 20_000 }) : operation(client);
}
export async function publicCreator(requestedHandle: string, client: Transaction | PrismaClient = prisma, locked?: EvidenceActorLocks) {
  let normalized: string;
  try { normalized = normalizeInfameHandle(requestedHandle); } catch { return null; }
  return readTransaction(client, async tx => {
    const initial = await tx.creator.findUnique({ where: { handle: normalized }, select: { id: true } });
    if (!initial) return null;
    const actors = locked ?? await lockEvidenceActors(tx, { creatorIds: [initial.id] });
    await lockEvidenceDomain(tx, "Creator", [initial.id]);
    await tx.$queryRaw`SELECT id FROM "SocialAccount" WHERE "creatorId"=${initial.id} ORDER BY id FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "PortfolioVersion" WHERE "creatorId"=${initial.id} ORDER BY id FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "CreatorRate" WHERE "creatorId"=${initial.id} ORDER BY id FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "CreatorWork" WHERE "creatorId"=${initial.id} ORDER BY id FOR SHARE`;
    const creator = await tx.creator.findUnique({ where: { handle: normalized }, include: { user: { select: { active: true, role: true, isTest: true, emailVerifiedAt: true } }, accounts: true, portfolios: { orderBy: { version: "desc" }, take: 1 }, rates: true, work: { where: { approvedAt: { not: null }, publicVisible: true } } } });
    const now = new Date();
    const publication = await creatorPublicationCore(tx, {
      initialId: initial.id, creator, accounts: creator?.accounts ?? [], portfolio: creator?.portfolios[0],
      actors, now,
    });
    if (!creator || !publication) return null;
    const accounts = publication.accounts.map(account => ({ platform: account.platform, handle: account.handle, ownership: "VERIFIED" as const }));
    return { id: creator.id, handle: creator.handle, displayName: creator.displayName, bio: publication.portfolio.bio, countryCode: creator.countryCode, languages: creator.languages, nicheSlugs: creator.nicheIds, portfolio: publication.portfolio, accounts,
      rates: record(creator.profileFacts).ratesVisibility === "PUBLIC" ? creator.rates.map(rate => ({ platform: rate.platform, format: rate.format, currencyCode: rate.currency, amountMinor: rate.amountMinor.toString() })) : [],
      work: creator.work.filter(work => past(work.approvedAt, now)).map(work => ({ title: work.title, description: work.description, url: work.url })) };
  });
}
export async function publicBrand(requestedSlug: string, client: Transaction | PrismaClient = prisma, locked?: EvidenceActorLocks) {
  let slug: string;
  try { slug = normalizeBrandSlug(requestedSlug); } catch { return null; }
  return readTransaction(client, async tx => {
    const initial = await tx.brand.findUnique({ where: { slug }, select: { id: true } });
    if (!initial) return null;
    const actors = locked ?? await lockEvidenceActors(tx, { brandIds: [initial.id] });
    await lockEvidenceDomain(tx, "Brand", [initial.id]);
    await tx.$queryRaw`SELECT id FROM "BusinessVerification" WHERE "brandId"=${initial.id} ORDER BY id FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "BrandPortfolioVersion" WHERE "brandId"=${initial.id} ORDER BY id FOR SHARE`;
    const brand = await tx.brand.findUnique({ where: { slug }, include: { user: { select: { active: true, role: true, isTest: true, emailVerifiedAt: true } }, verifications: true, portfolios: { orderBy: { version: "desc" }, take: 1 } } });
    const now = new Date();
    if (!brand || brand.id !== initial.id || !currentBrandOwner(actors, brand) || !profileReady(brand, now) || !brand.user.active || brand.user.role !== "BRAND" || brand.user.isTest || !past(brand.user.emailVerifiedAt, now)) return null;
    let accepted = false;
    for (const verification of brand.verifications) if (await acceptedRepresentativeProof(tx, brand, verification, now, actors)) { accepted = true; break; }
    if (!accepted) return null;
    const portfolio = brand.portfolios[0], parsed = PortfolioContentSchema.safeParse(portfolio?.content);
    if (!portfolio || !past(portfolio.approvedAt, now) || !parsed.success) return null;
    return { id: brand.id, slug: brand.slug, name: brand.name, description: parsed.data.bio, countryCode: brand.countryCode, website: brand.website, portfolio: parsed.data };
  });
}
