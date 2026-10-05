import { randomUUID } from "node:crypto";
import type { Prisma, Platform, PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { lockEvidenceActors, lockEvidenceDomain, type EvidenceActorLocks } from "@/lib/evidence/readiness";
import { createEvidenceReceiptReader, type EvidenceReceiptReader } from "@/lib/evidence/receipt-reader";
import { canonicalHash, inputJson, record } from "@/lib/onboarding/drafts";
import { creatorPublicationCore, type CreatorPublicationInput } from "@/lib/onboarding/public-creator-core";
import { ProfileTextSchema, PortfolioContentSchema } from "@/lib/onboarding/portfolio-contract";
import { publicCreator, PortfolioContentSchema as ExistingPortfolioContentSchema } from "@/lib/onboarding/profiles";
import { cleanupReviewedEvidence, reviewedOwnershipFixture } from "../helpers/reviewed-evidence";

// Independently authored; root alone executes guarded targets.
// Actual ownership commands review local
// synthetic uploaded bytes; publication/User/portfolio flags below are explicit
// synthetic persisted compatibility fixtures, never live/public discovery proof.
// Do not import a .test.ts fixture or replace real Date/publicCreator behavior.
const actors = new Set<string>(), creators = new Set<string>();
afterEach(async () => {
  await prisma.creator.deleteMany({ where: { id: { in: [...creators] } } });
  await cleanupReviewedEvidence(prisma, [...actors], "test");
  await prisma.user.deleteMany({ where: { id: { in: [...actors] } } });
  actors.clear(); creators.clear();
});

const originalContent = {
  title: "  عنوان أصلي / Original title  ",
  bio: "  سيرة أصلية\nOriginal English biography  ",
  sections: [{ heading: "  قسم أصلي / Original section  ", text: "\n  نص أصلي محفوظ / Original unchanged text\t " }],
  method: "APPROVED_FACT_TEMPLATE",
};
const parsedContent = { ...originalContent, title: originalContent.title.trim(), sections: [{ ...originalContent.sections[0]!, heading: originalContent.sections[0]!.heading.trim() }] };

async function actor(role: "CREATOR" | "ADMIN", past: Date) {
  const id = randomUUID(); actors.add(id);
  return prisma.user.create({ data: { id, role, name: "Synthetic private publication owner " + id,
    email: `synthetic-public-core-${id}@example.invalid`, passwordHash: "not-a-login", active: true,
    isTest: true, emailVerifiedAt: past, createdAt: past } });
}

async function fixture() {
  // Actual past UTC is essential: publicCreator deliberately captures a real
  // new Date(), while the shared evidence fixture's fixed12:00Z may be future.
  const past = new Date(Date.now() - 60_000), owner = await actor("CREATOR", past), admin = await actor("ADMIN", past);
  const suffix = randomUUID().replace(/-/g, "").slice(0, 16);
  const creator = await prisma.creator.create({ data: { userId: owner.id, handle: `core_${suffix}`,
    displayName: "اسم أصلي / Original alias", bio: "This saved biography is superseded by the approved portfolio biography",
    countryCode: "KW", languages: ["ar", "en"], nicheIds: ["tech"], state: "PUBLISHED", isTest: false,
    publicConsentAt: past, brandVisible: false, profileFacts: { ratesVisibility: "PUBLIC" }, createdAt: past } });
  creators.add(creator.id);
  async function account(platform: Platform, publicVisible: boolean, reviewed = true) {
    const value = await prisma.socialAccount.create({ data: { creatorId: creator.id, platform,
      handle: `proof_${platform.toLowerCase()}_${randomUUID().replace(/-/g, "").slice(0, 8)}`,
      providerAccountId: "synthetic-private-provider-" + randomUUID(), intendedConfirmedAt: past, consentAt: past,
      publicVisible, brandVisible: false, createdAt: past } });
    const proof = reviewed ? await reviewedOwnershipFixture(prisma, owner.id, admin.id, value.id, "test", past) : null;
    if (reviewed) {
      // Ownership submission withdraws visibility. Restore only the explicit
      // synthetic publication/selection fixture after actual review commands.
      await prisma.socialAccount.update({ where: { id: value.id }, data: { publicVisible, brandVisible: false } });
      await prisma.creator.update({ where: { id: creator.id }, data: { state: "PUBLISHED", publicConsentAt: past } });
    }
    return { account: await prisma.socialAccount.findUniqueOrThrow({ where: { id: value.id } }), proof };
  }
  const primary = await account("INSTAGRAM", true);
  await prisma.creator.update({ where: { id: creator.id }, data: { primaryAccountId: primary.account.id, state: "PUBLISHED", publicConsentAt: past } });
  await prisma.user.update({ where: { id: owner.id }, data: { isTest: false } });
  const portfolio = await prisma.portfolioVersion.create({ data: { creatorId: creator.id, version: 1,
    inputRevision: 37, content: originalContent, approvedAt: past, createdAt: past } });
  let version = 1;
  async function latest(content: unknown = originalContent, approvedAt: Date | null = past) {
    return prisma.portfolioVersion.create({ data: { creatorId: creator.id, version: ++version,
      inputRevision: 97, content: inputJson(content), approvedAt, createdAt: past } });
  }
  return { past, owner, admin, creator, primary, portfolio, account, latest };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type InputChange = (input: CreatorPublicationInput) => CreatorPublicationInput;

async function core(f: Fixture, options: { now?: Date; reader?: EvidenceReceiptReader; change?: InputChange } = {}) {
  return prisma.$transaction(async tx => {
    const captured = await lockEvidenceActors(tx, { creatorIds: [f.creator.id] });
    await lockEvidenceDomain(tx, "Creator", [f.creator.id]);
    await tx.$queryRaw`SELECT id FROM "SocialAccount" WHERE "creatorId"=${f.creator.id} ORDER BY id FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "PortfolioVersion" WHERE "creatorId"=${f.creator.id} ORDER BY id FOR SHARE`;
    const creator = await tx.creator.findUnique({ where: { id: f.creator.id }, include: {
      user: { select: { active: true, role: true, isTest: true, emailVerifiedAt: true } },
    } });
    const accounts = await tx.socialAccount.findMany({ where: { creatorId: f.creator.id }, orderBy: { id: "asc" } });
    const portfolio = await tx.portfolioVersion.findFirst({ where: { creatorId: f.creator.id }, orderBy: { version: "desc" } });
    const input: CreatorPublicationInput = { initialId: f.creator.id, creator, accounts, portfolio,
      actors: captured, now: options.now ?? new Date(), reader: options.reader };
    const selected = options.change ? options.change(input) : input;
    const result = await creatorPublicationCore(tx, selected);
    return { result, input: selected };
  });
}
async function projected(f: Fixture, options?: Parameters<typeof core>[1]) { return (await core(f, options)).result; }
async function legacy(f: Fixture) { return publicCreator(f.creator.handle); }
async function assertOriginalEligible(f: Fixture) { expect(await legacy(f)).toMatchObject({ id: f.creator.id, portfolio: parsedContent }); }

function sources(f: Fixture) {
  return {
    instagram: { source: "INSTAGRAM", identity: { platform: "INSTAGRAM", providerAccountId: f.primary.account.providerAccountId,
      normalizedHandle: f.primary.account.handle, confirmedOrigin: null }, revision: f.primary.account.mappingRevision, confirmedAt: f.past.toISOString() },
    unselected: { source: "YOUTUBE", identity: { platform: "YOUTUBE", providerAccountId: null,
      normalizedHandle: "synthetic_unconfirmed_other", confirmedOrigin: null }, revision: 3, confirmedAt: null },
    website: { source: "WEBSITE", identity: { platform: null, providerAccountId: null,
      normalizedHandle: null, confirmedOrigin: "https://example.invalid/synthetic-source" }, revision: 2, confirmedAt: f.past.toISOString() },
  };
}
async function draft(f: Fixture, mapped: unknown) {
  const input = { version: 1, answers: {}, sources: mapped, facts: {}, mappingRevision: 17, factsRevision: 23, generatedSectionsStale: true };
  const value = await prisma.onboardingDraft.create({ data: { userId: f.owner.id, kind: "CREATOR", input: inputJson(input) } });
  await prisma.creator.update({ where: { id: f.creator.id }, data: { profileFacts: { ratesVisibility: "PUBLIC", mappingHash: canonicalHash(mapped) } } });
  return { value, input };
}

describe("shared creator publication core: native synthetic D056", () => {
  it("accepts genuinely reviewed current ownership without a draft or command-only publication prerequisites", async () => {
    const f = await fixture(); await assertOriginalEligible(f);
    expect(await prisma.onboardingDraft.findUnique({ where: { userId_kind: { userId: f.owner.id, kind: "CREATOR" } } })).toBeNull();
    const { result, input } = await core(f);
    expect(result).toEqual({ portfolio: parsedContent, accounts: input.accounts });
    expect(result!.accounts[0]!.id).toBe(f.primary.account.id);
    expect(result!.accounts[0]!.providerAccountId).toBe(f.primary.account.providerAccountId);
    expect(result!.portfolio.bio).toBe(originalContent.bio);
    expect(result!.portfolio.sections[0]!.text).toBe(originalContent.sections[0]!.text);
    expect(input.creator!.languages).toEqual(["ar", "en"]);
    expect(input.creator!.publishedAt).toBeNull();
  });

  it("keeps exact date inclusivity at the provided clock without mocking the legacy real clock", async () => {
    const f = await fixture(); await assertOriginalEligible(f);
    expect(await projected(f, { now: f.past })).toMatchObject({ portfolio: parsedContent });
  });

  it.each(["DRAFT", "PRIVATE", "HIDDEN"] as const)("denies stored creator state %s", async state => {
    const f = await fixture(); await assertOriginalEligible(f);
    await prisma.creator.update({ where: { id: f.creator.id }, data: { state } });
    expect(await projected(f)).toBeNull(); expect(await legacy(f)).toBeNull();
  });

  it.each(["creator test", "owner inactive", "owner test", "owner wrong role", "unclaimed", "public consent missing", "public consent future", "email missing", "email future"] as const)("preserves the %s public identity barrier", async failure => {
    const f = await fixture(); await assertOriginalEligible(f);
    const future = new Date(Date.now() + 60_000);
    if (failure === "creator test") await prisma.creator.update({ where: { id: f.creator.id }, data: { isTest: true } });
    if (failure === "owner inactive") await prisma.user.update({ where: { id: f.owner.id }, data: { active: false } });
    if (failure === "owner test") await prisma.user.update({ where: { id: f.owner.id }, data: { isTest: true } });
    if (failure === "owner wrong role") await prisma.user.update({ where: { id: f.owner.id }, data: { role: "BRAND" } });
    if (failure === "unclaimed") await prisma.creator.update({ where: { id: f.creator.id }, data: { userId: null } });
    if (failure === "public consent missing" || failure === "public consent future") await prisma.creator.update({ where: { id: f.creator.id }, data: { publicConsentAt: failure.endsWith("future") ? future : null } });
    if (failure === "email missing" || failure === "email future") await prisma.user.update({ where: { id: f.owner.id }, data: { emailVerifiedAt: failure.endsWith("future") ? future : null } });
    expect(await projected(f)).toBeNull(); expect(await legacy(f)).toBeNull();
  });

  it.each(["null creator", "different candidate", "missing projected user", "captured owner changed", "owner was not locked"] as const)("denies %s in the trusted preloaded input", async failure => {
    const f = await fixture(); await assertOriginalEligible(f);
    const change: InputChange = input => {
      if (failure === "null creator") return { ...input, creator: null };
      if (failure === "different candidate") return { ...input, initialId: randomUUID() };
      if (failure === "missing projected user") return { ...input, creator: { ...input.creator!, user: null } };
      const captured: EvidenceActorLocks = failure === "captured owner changed"
        ? { ...input.actors, creatorOwners: new Map([[f.creator.id, randomUUID()]]) }
        : { ...input.actors, ownerIds: new Set() };
      return { ...input, actors: captured };
    };
    expect(await projected(f, { change })).toBeNull();
  });

  it.each(["intent missing", "intent future", "consent missing", "consent future", "unproved", "deleted asset", "inactive reviewer", "wrong reviewer role"] as const)("denies selected primary with %s", async failure => {
    const f = await fixture(); await assertOriginalEligible(f);
    const future = new Date(Date.now() + 60_000);
    if (failure.startsWith("intent")) await prisma.socialAccount.update({ where: { id: f.primary.account.id }, data: { intendedConfirmedAt: failure.endsWith("future") ? future : null } });
    if (failure.startsWith("consent")) await prisma.socialAccount.update({ where: { id: f.primary.account.id }, data: { consentAt: failure.endsWith("future") ? future : null } });
    if (failure === "unproved") await prisma.socialAccount.update({ where: { id: f.primary.account.id }, data: { ownershipStatus: "UNPROVED" } });
    if (failure === "deleted asset") await prisma.privateAsset.update({ where: { id: f.primary.proof!.proofId }, data: { deletedAt: new Date() } });
    if (failure === "inactive reviewer") await prisma.user.update({ where: { id: f.admin.id }, data: { active: false } });
    if (failure === "wrong reviewer role") await prisma.user.update({ where: { id: f.admin.id }, data: { role: "CREATOR" } });
    expect(await projected(f)).toBeNull(); expect(await legacy(f)).toBeNull();
  });

  it("requires the selected primary even when no account is exposed publicly", async () => {
    const f = await fixture();
    await prisma.socialAccount.update({ where: { id: f.primary.account.id }, data: { publicVisible: false } });
    await assertOriginalEligible(f);
    expect(await projected(f)).toEqual({ portfolio: parsedContent, accounts: [] });
    expect((await legacy(f))!.accounts).toEqual([]);
    await prisma.creator.update({ where: { id: f.creator.id }, data: { primaryAccountId: null } });
    expect(await projected(f)).toBeNull(); expect(await legacy(f)).toBeNull();
  });

  it("denies an absent or foreign primary in preloaded accounts rather than inferring it from a handle", async () => {
    const f = await fixture(); await assertOriginalEligible(f);
    expect(await projected(f, { change: input => ({ ...input, accounts: [] }) })).toBeNull();
    const other = await actor("CREATOR", f.past);
    const foreignCreator = await prisma.creator.create({ data: { userId: other.id, handle: "core_" + randomUUID().replace(/-/g, "").slice(0, 16), displayName: "Synthetic foreign creator" } });
    creators.add(foreignCreator.id);
    const foreign = await prisma.socialAccount.create({ data: { creatorId: foreignCreator.id, platform: "INSTAGRAM", handle: "proof_instagram_" + randomUUID().replace(/-/g, "").slice(0, 8), intendedConfirmedAt: f.past, consentAt: f.past } });
    // DB enforces stored primary scope. This adversarial preloaded substitution
    // leaves the genuine persisted creator/profile unchanged.
    expect(await projected(f, { change: input => ({ ...input, creator: { ...input.creator!, primaryAccountId: foreign.id }, accounts: [...input.accounts, foreign] }) })).toBeNull();
    await assertOriginalEligible(f);
  });

  it("keeps proved public secondaries and omits private or failed secondaries without denying the valid primary", async () => {
    const f = await fixture(), publicSecondary = await f.account("TIKTOK", true), privateSecondary = await f.account("YOUTUBE", false);
    const failed = await f.account("X", true, false);
    const { result, input } = await core(f);
    const selected = input.accounts.filter(account => [f.primary.account.id, publicSecondary.account.id].includes(account.id));
    expect(result).toEqual({ portfolio: parsedContent, accounts: selected });
    expect(result!.accounts.map(account => account.id)).not.toContain(privateSecondary.account.id);
    expect(result!.accounts.map(account => account.id)).not.toContain(failed.account.id);
    expect((await legacy(f))!.accounts.map(account => account.handle).sort()).toEqual(selected.map(account => account.handle).sort());
  });

  it("does not use another creator owner's historical proof after a genuine native owner transfer", async () => {
    const f = await fixture(); await assertOriginalEligible(f);
    const replacement = await actor("CREATOR", f.past);
    await prisma.user.update({ where: { id: replacement.id }, data: { isTest: false } });
    await prisma.creator.update({ where: { id: f.creator.id }, data: { userId: replacement.id } });
    expect(await projected(f)).toBeNull(); expect(await legacy(f)).toBeNull();
  });

  it("accepts the whole matching sources hash with empty essentials, stale generated sections and an unrelated input revision", async () => {
    const f = await fixture(), mapped = sources(f); await draft(f, mapped);
    await assertOriginalEligible(f);
    expect(await projected(f)).toMatchObject({ portfolio: parsedContent });
    expect(f.portfolio.inputRevision).toBe(37);
  });

  it("uses canonical whole-source hashing across object and nested identity key order", async () => {
    const f = await fixture(), mapped = sources(f), saved = await draft(f, mapped);
    const identity = mapped.instagram.identity;
    const reordered = { website: mapped.website, unselected: mapped.unselected, instagram: { confirmedAt: mapped.instagram.confirmedAt,
      revision: mapped.instagram.revision, identity: { confirmedOrigin: identity.confirmedOrigin, normalizedHandle: identity.normalizedHandle,
        providerAccountId: identity.providerAccountId, platform: identity.platform }, source: mapped.instagram.source } };
    expect(canonicalHash(reordered)).toBe(canonicalHash(mapped));
    await prisma.onboardingDraft.update({ where: { id: saved.value.id }, data: { input: inputJson({ ...saved.input, sources: reordered }) } });
    expect(await projected(f)).toMatchObject({ portfolio: parsedContent }); await assertOriginalEligible(f);
  });

  it("hydrates only matching draft sources for a supplied reader while retaining the legacy full draft query", async () => {
    const f = await fixture(), mapped = sources(f), saved = await draft(f, mapped);
    const transcriptCanary = "SYNTHETIC_PRIVATE_DRAFT_TRANSCRIPT_CANARY", answerCanary = "SYNTHETIC_PRIVATE_DRAFT_ANSWER_CANARY", factCanary = "SYNTHETIC_PRIVATE_DRAFT_FACT_CANARY";
    await prisma.onboardingDraft.update({ where: { id: saved.value.id }, data: {
      input: inputJson({ ...saved.input, answers: { privateAnswer: answerCanary }, facts: { privateFacts: Array.from({ length: 20 }, () => ({ value: factCanary.repeat(100) })) } }),
      transcript: [{ speaker: "USER", text: transcriptCanary }],
    } });
    const hydrated: unknown[] = [];
    const client = prisma.$extends({ query: {
      onboardingDraft: { async findUnique({ args, query }) { const row = await query(args); if (row) hydrated.push(row); return row; } },
      async $queryRaw({ args, query }) {
        const result = await query(args);
        if (args.sql.includes('"OnboardingDraft"') && Array.isArray(result)) hydrated.push(...result);
        return result;
      },
    } }) as unknown as PrismaClient;
    const result = await client.$transaction(async tx => {
      const captured = await lockEvidenceActors(tx, { creatorIds: [f.creator.id] });
      await lockEvidenceDomain(tx, "Creator", [f.creator.id]);
      await tx.$queryRaw`SELECT id FROM "SocialAccount" WHERE "creatorId"=${f.creator.id} ORDER BY id FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "PortfolioVersion" WHERE "creatorId"=${f.creator.id} ORDER BY id FOR SHARE`;
      const creator = await tx.creator.findUnique({ where: { id: f.creator.id }, include: { user: { select: { active: true, role: true, isTest: true, emailVerifiedAt: true } } } });
      const accounts = await tx.socialAccount.findMany({ where: { creatorId: f.creator.id }, orderBy: { id: "asc" } });
      const portfolio = await tx.portfolioVersion.findFirst({ where: { creatorId: f.creator.id }, orderBy: { version: "desc" } });
      return creatorPublicationCore(tx, { initialId: f.creator.id, creator, accounts, portfolio, actors: captured, now: new Date(), reader: createEvidenceReceiptReader() });
    });
    expect(result).toMatchObject({ portfolio: parsedContent });
    expect(hydrated.length).toBeGreaterThan(0);
    for (const row of hydrated) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Native draft projection was not an object");
      expect(Object.keys(row)).toEqual(["input"]);
      const input = Reflect.get(row, "input");
      expect(Object.keys(input)).toEqual(["sources"]);
      expect(Reflect.get(input, "sources")).toEqual(mapped);
      for (const privateValue of [transcriptCanary, answerCanary, factCanary]) expect(JSON.stringify(row)).not.toContain(privateValue);
    }
    hydrated.length = 0;
    expect(await publicCreator(f.creator.handle, client)).toMatchObject({ portfolio: parsedContent });
    expect(hydrated.some(row => JSON.stringify(row).includes(transcriptCanary) && JSON.stringify(row).includes(answerCanary) && JSON.stringify(row).includes(factCanary))).toBe(true);
  });

  it.each(["unselected revision", "website origin", "primary confirmation", "removed source", "added source", "missing hash"] as const)("withdraws identity for changed %s instead of comparing only selected sources", async failure => {
    const f = await fixture(), mapped = sources(f), saved = await draft(f, mapped); await assertOriginalEligible(f);
    const changed = structuredClone(mapped) as Record<string, Prisma.JsonValue>;
    if (failure === "unselected revision") changed.unselected = { ...record(changed.unselected), revision: 4 };
    if (failure === "website origin") changed.website = { ...record(changed.website), identity: { ...record(record(changed.website).identity), confirmedOrigin: "https://example.invalid/changed" } };
    if (failure === "primary confirmation") changed.instagram = { ...record(changed.instagram), confirmedAt: new Date(f.past.getTime() - 1).toISOString() };
    if (failure === "removed source") delete changed.website;
    if (failure === "added source") changed.additional = { source: "X", identity: { platform: "X", normalizedHandle: "synthetic_added", providerAccountId: null, confirmedOrigin: null }, revision: 1, confirmedAt: null };
    if (failure === "missing hash") await prisma.creator.update({ where: { id: f.creator.id }, data: { profileFacts: { ratesVisibility: "PUBLIC" } } });
    else await prisma.onboardingDraft.update({ where: { id: saved.value.id }, data: { input: inputJson({ ...saved.input, sources: changed }) } });
    expect(await projected(f)).toBeNull(); expect(await legacy(f)).toBeNull();
  });

  it.each(["unapproved", "future approval", "invalid content"] as const)("lets the latest %s portfolio mask an older approved valid version", async failure => {
    const f = await fixture(); await assertOriginalEligible(f);
    await f.latest(failure === "invalid content" ? { ...originalContent, method: "UNAPPROVED_GENERATOR" } : originalContent,
      failure === "unapproved" ? null : failure === "future approval" ? new Date(Date.now() + 60_000) : f.past);
    expect(await projected(f)).toBeNull(); expect(await legacy(f)).toBeNull();
  });

  it("rejects missing latest portfolio and uses inclusive approval time without requiring command revision equality", async () => {
    const f = await fixture(); await assertOriginalEligible(f);
    expect(await projected(f, { now: f.past })).toMatchObject({ portfolio: parsedContent });
    await prisma.portfolioVersion.deleteMany({ where: { creatorId: f.creator.id } });
    expect(await projected(f)).toBeNull(); expect(await legacy(f)).toBeNull();
  });

  it("retains text transforms, maximum lengths and original untrimmed biography/section text", async () => {
    expect(ExistingPortfolioContentSchema).toBe(PortfolioContentSchema);
    expect(ProfileTextSchema.parse(" \tأصلي\nEnglish \r ")).toBe("أصلي\nEnglish");
    expect(ProfileTextSchema.safeParse("أ".repeat(500)).success).toBe(true);
    expect(ProfileTextSchema.safeParse("أ".repeat(501)).success).toBe(false);
    expect(ProfileTextSchema.safeParse("original\u000bcontrol").success).toBe(false);
    const f = await fixture(), boundary = { title: "أ".repeat(200), bio: "ب".repeat(1000), method: "APPROVED_FACT_TEMPLATE",
      sections: Array.from({ length: 20 }, () => ({ heading: "ع".repeat(100), text: "ن".repeat(2000) })) };
    await f.latest(boundary);
    expect((await projected(f))!.portfolio).toEqual(boundary); expect((await legacy(f))!.portfolio).toEqual(boundary);
    const untrimmed = { ...originalContent, bio: " \u000boriginal\n ", sections: [{ heading: "Heading", text: " \u000bsection\t " }] };
    await f.latest(untrimmed);
    expect((await projected(f))!.portfolio.bio).toBe(untrimmed.bio);
    expect((await projected(f))!.portfolio.sections[0]!.text).toBe(untrimmed.sections[0]!.text);
  });

  it("preserves internal preloaded record aliases without mutating creator, portfolio or original language content", async () => {
    const f = await fixture(), before = await prisma.creator.findUniqueOrThrow({ where: { id: f.creator.id } });
    const { input, result } = await core(f);
    expect(result!.accounts[0]).toEqual(input.accounts[0]);
    expect(result!.portfolio.bio).toBe(originalContent.bio);
    expect(await prisma.creator.findUniqueOrThrow({ where: { id: f.creator.id } })).toEqual(before);
    expect((await prisma.portfolioVersion.findUniqueOrThrow({ where: { id: f.portfolio.id } })).content).toEqual(originalContent);
  });

  it("propagates one shared optional budget through private primary and public secondary proof families", async () => {
    const f = await fixture(); await prisma.socialAccount.update({ where: { id: f.primary.account.id }, data: { publicVisible: false } });
    const secondary = await f.account("TIKTOK", true); await assertOriginalEligible(f);
    // reviewedOwnershipFixture intentionally shares one past timestamp. Each
    // owner revision scan hydrates both start/submission receipts: 2 + 2 owner
    // rows + 1 reviewer + 1 asset = 6 per account, charged at every native fetch.
    expect((await projected(f, { reader: createEvidenceReceiptReader({ maxRows: 12 }) }))!.accounts.map(account => account.id)).toEqual([secondary.account.id]);
    await expect(projected(f, { reader: createEvidenceReceiptReader({ maxRows: 11 }) })).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
    expect((await legacy(f))!.accounts.map(account => account.handle)).toEqual([secondary.account.handle]);
  });

  it("keeps the legacy explicit public DTO, exact public rates and approved public work free of contacts/private proof metadata", async () => {
    const f = await fixture();
    await prisma.creatorRate.create({ data: { creatorId: f.creator.id, platform: "INSTAGRAM", format: "REEL", currency: "KWD", amountMinor: BigInt(12005) } });
    const work = { title: "عمل عربي أصلي", description: "  وصف أصلي\nOriginal description  ", url: "https://example.invalid/synthetic-public-work" };
    await prisma.creatorWork.create({ data: { creatorId: f.creator.id, ...work, approvedAt: f.past, publicVisible: true, assetId: f.primary.proof!.proofId } });
    await prisma.creatorWork.create({ data: { creatorId: f.creator.id, title: "Synthetic private work canary", approvedAt: f.past, publicVisible: false } });
    await prisma.creatorWork.create({ data: { creatorId: f.creator.id, title: "Synthetic future work canary", approvedAt: new Date(Date.now() + 60_000), publicVisible: true } });
    await prisma.creatorWork.create({ data: { creatorId: f.creator.id, title: "Synthetic unapproved work canary", publicVisible: true } });
    const value = await legacy(f);
    expect(value).toEqual({ id: f.creator.id, handle: f.creator.handle, displayName: f.creator.displayName, bio: originalContent.bio,
      countryCode: "KW", languages: ["ar", "en"], nicheSlugs: ["tech"], portfolio: parsedContent,
      accounts: [{ platform: "INSTAGRAM", handle: f.primary.account.handle, ownership: "VERIFIED" }],
      rates: [{ platform: "INSTAGRAM", format: "REEL", currencyCode: "KWD", amountMinor: "12005" }], work: [work] });
    const serialized = JSON.stringify(value);
    for (const privateValue of [f.owner.id, f.owner.email, f.owner.name, f.admin.id, f.primary.account.id,
      f.primary.account.providerAccountId!, f.primary.proof!.proofId, f.primary.proof!.challengeId,
      "Synthetic private work canary", "Synthetic future work canary", "Synthetic unapproved work canary"]) expect(serialized).not.toContain(privateValue);
    for (const privateKey of ["userId", "email", "providerAccountId", "ownershipProofAssetId", "ownershipReviewedBy", "storageKey", "payloadHash", "operationKey", "assetId"]) expect(serialized).not.toContain(`"${privateKey}"`);
    await prisma.creator.update({ where: { id: f.creator.id }, data: { profileFacts: { ratesVisibility: "BRAND_ONLY" } } });
    expect((await legacy(f))!.rates).toEqual([]);
    expect(await projected(f)).toMatchObject({ portfolio: parsedContent });
  });
});
