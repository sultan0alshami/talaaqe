import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { signup } from "@/lib/identity";
import { createOrResumeDraft, applyDraftCommand, canonicalHash } from "@/lib/onboarding/drafts";
import { profileCommand, profileForOwner, publicCreator, publicBrand } from "@/lib/onboarding/profiles";
import { cleanupReviewedEvidence, reviewedOwnershipFixture } from "../helpers/reviewed-evidence";

const users: string[] = [];
afterAll(async () => { await prisma.creator.deleteMany({ where: { userId: { in: users } } }); await cleanupReviewedEvidence(prisma, users, "test"); await prisma.user.deleteMany({ where: { id: { in: users } } }); });
async function fixture(role: "CREATOR" | "BRAND") {
  const suffix = randomBytes(6).toString("hex");
  const user = await signup({ name: "Synthetic ملف عربي", email: `profile-${suffix}@example.invalid`, password: "Profile fixture password 19", role });
  users.push(user.id);
  return { user, draft: await createOrResumeDraft(user.id), handle: `test_${suffix}` };
}
async function reviewer() {
  const id = randomBytes(12).toString("hex");
  const user = await prisma.user.create({ data: { id, email: `reviewer-${id}@example.invalid`, passwordHash: "test-only-no-login", name: "Synthetic evidence reviewer", role: "ADMIN", active: true, isTest: true } });
  users.push(user.id);
  return user;
}
function profile(handle: string) {
  return { displayName: "اختبار إنفيم", infameHandle: handle, bio: "محتوى أصلي", location: { countryCode: "EG", cityKey: null, cityLabel: "القاهرة", timeZone: "Africa/Cairo" }, languages: ["ar"], dialects: [], nicheSlugs: ["tech"], fameIndustries: [], contentStyles: [], preferredCurrency: "KWD", minimumMinor: "12005", availability: { status: "AVAILABLE", startsAt: "2026-10-01T00:00:00.000Z", endsAt: "2027-10-01T00:00:00.000Z" }, travelWilling: false, ratesVisibility: "BRAND_ONLY", rates: [{ platform: "INSTAGRAM", format: "REEL", currencyCode: "KWD", amountMinor: "12005" }], primarySourceKey: null };
}
describe("owner profile and explicit publication", () => {
  it.each(["CREATOR", "BRAND"] as const)("rechecks %s ownership before projecting a new owner's private portfolio", async role => {
    const f = await fixture(role), replacement = randomBytes(12).toString("hex");
    users.push(replacement);
    await prisma.user.create({ data: { id: replacement, email: `replacement-${replacement}@example.invalid`, passwordHash: "test-only-no-login", name: "Synthetic replacement owner", role } });
    let ready!: () => void, release!: () => void;
    const selected = new Promise<void>(resolve => { ready = resolve; }), unblocked = new Promise<void>(resolve => { release = resolve; });
    const reading = prisma.$extends({ query: {
      creator: { async findUnique({ args, query }) { const result = await query(args); if (role === "CREATOR" && args.where.userId === f.user.id) { ready(); await unblocked; } return result; } },
      brand: { async findUnique({ args, query }) { const result = await query(args); if (role === "BRAND" && args.where.userId === f.user.id) { ready(); await unblocked; } return result; } },
    } });
    const projection = profileForOwner(f.user.id, reading as unknown as PrismaClient);
    const observed = projection.then(value => ({ value }), error => ({ error }));
    try {
      await selected;
      const content = { title: "Synthetic private replacement profile", bio: "Private content supplied only by the replacement owner", sections: [], method: "APPROVED_FACT_TEMPLATE" };
      await prisma.$transaction(async tx => {
        if (role === "CREATOR") {
          const creator = await tx.creator.update({ where: { userId: f.user.id }, data: { userId: replacement, bio: content.bio } });
          await tx.portfolioVersion.create({ data: { creatorId: creator.id, version: 1, inputRevision: 1, content } });
        } else {
          const brand = await tx.brand.update({ where: { userId: f.user.id }, data: { userId: replacement, description: content.bio } });
          await tx.brandPortfolioVersion.create({ data: { brandId: brand.id, version: 1, inputRevision: 1, content } });
        }
      });
      release();
      const result = await observed;
      expect("error" in result).toBe(false);
      expect("value" in result && result.value === null).toBe(true);
    } finally { release(); await observed; }
  });
  it("saves exact private profile/rates, replays safely, rejects stale and preserves original Arabic", async () => {
    const f = await fixture("CREATOR"), command = { operationKey: "save-one", expectedRevision: f.draft.revision, action: "SAVE_PROFILE", payload: profile(f.handle) };
    const result = await profileCommand(f.user.id, f.draft.id, command);
    expect(result.replayed).toBe(false);
    expect((await profileCommand(f.user.id, f.draft.id, command)).replayed).toBe(true);
    const saved = await profileForOwner(f.user.id);
    expect(saved?.profile.displayName).toBe("اختبار إنفيم");
    expect(saved?.rates[0]?.amountMinor).toBe("12005");
    expect(saved?.profile.state).toBe("PRIVATE");
    expect(await publicCreator(f.handle)).toBeNull();
    await expect(profileCommand(f.user.id, f.draft.id, { ...command, operationKey: "stale" })).rejects.toMatchObject({ code: "STALE_VERSION" });
    await expect(profileCommand(f.user.id, f.draft.id, { ...command, payload: { ...command.payload, bio: "changed" } })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("requires verified email, reviewed primary ownership, current approved portfolio and explicit consent", async () => {
    const f = await fixture("CREATOR");
    let result = await profileCommand(f.user.id, f.draft.id, { operationKey: "save", expectedRevision: f.draft.revision, action: "SAVE_PROFILE", payload: profile(f.handle) });
    const publish = () => profileCommand(f.user.id, f.draft.id, { operationKey: `publish-${result.draft.revision}`, expectedRevision: result.draft.revision, action: "PUBLISH", payload: { consent: true, portfolioVersion: 1 } });
    await expect(publish()).rejects.toMatchObject({ code: "EMAIL_VERIFICATION_REQUIRED" });
    await prisma.user.update({ where: { id: f.user.id }, data: { emailVerifiedAt: new Date(), isTest: false } });
    await prisma.creator.update({ where: { userId: f.user.id }, data: { isTest: false } });
    await expect(publish()).rejects.toMatchObject({ code: "PRIMARY_OWNERSHIP_REQUIRED" });
    const creator = await prisma.creator.findUniqueOrThrow({ where: { userId: f.user.id } });
    const admin = await reviewer();
    const account = await prisma.socialAccount.create({ data: { creatorId: creator.id, platform: "INSTAGRAM", handle: f.handle, intendedConfirmedAt: new Date(), consentAt: new Date(), supportedFormats: ["REEL"] } });
    await prisma.creator.update({ where: { id: creator.id }, data: { primaryAccountId: account.id } });
    const identity = { platform: "INSTAGRAM", normalizedHandle: f.handle, providerAccountId: null, confirmedOrigin: null };
    await prisma.socialAccount.update({ where: { id: account.id }, data: { ownershipStatus: "VERIFIED", ownershipReviewedBy: admin.id, ownershipReviewedAt: new Date(), ownershipIdentityHash: canonicalHash(identity) } });
    await expect(publish()).rejects.toMatchObject({ code: "PRIMARY_OWNERSHIP_REQUIRED" });
    const proof = await reviewedOwnershipFixture(prisma, f.user.id, admin.id, account.id, "test", new Date());
    await expect(publish()).rejects.toMatchObject({ code: "PORTFOLIO_APPROVAL_REQUIRED" });
    result = await profileCommand(f.user.id, f.draft.id, { operationKey: "generate", expectedRevision: result.draft.revision, action: "GENERATE_PORTFOLIO", payload: {} });
    result = await profileCommand(f.user.id, f.draft.id, { operationKey: "approve", expectedRevision: result.draft.revision, action: "APPROVE_PORTFOLIO", payload: { portfolioVersion: 1, content: result.portfolio?.content } });
    await expect(profileCommand(f.user.id, f.draft.id, { operationKey: "no-consent", expectedRevision: result.draft.revision, action: "PUBLISH", payload: { consent: false, portfolioVersion: 1 } })).rejects.toMatchObject({ code: "PUBLICATION_CONSENT_REQUIRED" });
    result = await publish();
    const visible = await publicCreator(f.handle);
    expect(visible?.displayName).toBe("اختبار إنفيم");
    expect(JSON.stringify(visible)).not.toContain(f.user.email);
    expect(JSON.stringify(visible)).not.toContain("ownershipProofAssetId");
    expect(visible?.rates).toHaveLength(0);
    await prisma.privateAsset.update({ where: { id: proof.proofId }, data: { deletedAt: new Date() } });
    await expect(publish()).rejects.toMatchObject({ code: "PRIMARY_OWNERSHIP_REQUIRED" });
    expect(await publicCreator(f.handle)).toBeNull();
    await prisma.privateAsset.update({ where: { id: proof.proofId }, data: { deletedAt: null } });
    await profileCommand(f.user.id, f.draft.id, { operationKey: "hide", expectedRevision: result.draft.revision, action: "HIDE", payload: {} });
    expect(await publicCreator(f.handle)).toBeNull();
  });
  it("keeps confirmed unproved account private and detaches its publication eligibility after remapping", async () => {
    const f = await fixture("CREATOR");
    const identity = { platform: "INSTAGRAM", normalizedHandle: "synthetic_one", providerAccountId: null, confirmedOrigin: null };
    let r = await applyDraftCommand(f.user.id, f.draft.id, { operationKey: "mapping", expectedRevision: f.draft.revision, action: "SET_ANSWER", payload: { field: "sourceMapping", value: { sourceKey: "instagram", source: "INSTAGRAM", identity } } });
    r = await applyDraftCommand(f.user.id, f.draft.id, { operationKey: "confirm", expectedRevision: r.draft.revision, action: "CONFIRM_ACCOUNT", payload: { sourceKey: "instagram", identity } });
    r = await applyDraftCommand(f.user.id, f.draft.id, { operationKey: "consent", expectedRevision: r.draft.revision, action: "GRANT_IMPORT_CONSENT", payload: { sourceKey: "instagram", identity, scopes: ["public-profile"], consentVersion: "public-v1", granted: true } });
    await profileCommand(f.user.id, f.draft.id, { operationKey: "save", expectedRevision: r.draft.revision, action: "SAVE_PROFILE", payload: { ...profile(f.handle), primarySourceKey: "instagram" } });
    const owner = await profileForOwner(f.user.id);
    expect(owner?.accounts[0]?.ownershipStatus).toBe("UNPROVED");
    expect(owner?.accounts[0]?.publicVisible).toBe(false);
    expect(owner?.accounts[0]?.brandVisible).toBe(false);
  });
  it("supports no-website private brands without equating a website or registration proof to representative authority", async () => {
    const f = await fixture("BRAND");
    let r = await profileCommand(f.user.id, f.draft.id, { operationKey: "save", expectedRevision: f.draft.revision, action: "SAVE_PROFILE", payload: { companyName: "شركة اختبار", brandSlug: f.handle.replace("_", "-"), description: "وصف أصلي", location: { countryCode: "EG", cityKey: null, cityLabel: null, timeZone: "Africa/Cairo" }, noWebsite: true, website: null, contactName: "ممثل", representativeRole: "مالك", targetMarkets: ["SA", "EG"], languages: ["ar"], preferredCurrency: "EGP" } });
    expect((await profileForOwner(f.user.id))?.profile.website).toBeNull();
    await prisma.user.update({ where: { id: f.user.id }, data: { emailVerifiedAt: new Date(), isTest: false } });
    const brand = await prisma.brand.update({ where: { userId: f.user.id }, data: { isTest: false } });
    await prisma.businessVerification.create({ data: { brandId: brand.id, kind: "BUSINESS_REGISTRATION", status: "VERIFIED", reviewedAt: new Date() } });
    await expect(profileCommand(f.user.id, f.draft.id, { operationKey: "publish", expectedRevision: r.draft.revision, action: "PUBLISH", payload: { consent: true, portfolioVersion: 1 } })).rejects.toMatchObject({ code: "REPRESENTATION_REQUIRED" });
    expect(await publicBrand(brand.slug)).toBeNull();
    r = await profileCommand(f.user.id, f.draft.id, { operationKey: "generate", expectedRevision: r.draft.revision, action: "GENERATE_PORTFOLIO", payload: {} });
    expect(JSON.stringify(r.portfolio?.content)).toContain("شركة اختبار");
  });
  it("blocks other owners, invalid currency precision/unsupported rates and voice-controlled publication", async () => {
    const f = await fixture("CREATOR"), outsider = await fixture("CREATOR");
    const command = { operationKey: "save", expectedRevision: f.draft.revision, action: "SAVE_PROFILE", payload: profile(f.handle) };
    await expect(profileCommand(outsider.user.id, f.draft.id, command)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(profileCommand(f.user.id, f.draft.id, { ...command, payload: { ...command.payload, rates: [{ platform: "TIKTOK", format: "STORY", currencyCode: "USD", amountMinor: "100" }] } })).rejects.toMatchObject({ code: "INVALID_COMMAND" });
    await expect(profileCommand(f.user.id, f.draft.id, command, prisma, { channel: "VOICE" })).rejects.toMatchObject({ code: "EXPLICIT_CONFIRMATION_REQUIRED" });
  });
  it("publishes only explicitly selected proved accounts and withdraws an inactive reviewer's proof", async () => {
    const f = await fixture("CREATOR"), admin = await reviewer();
    let r = await profileCommand(f.user.id, f.draft.id, { operationKey: "save", expectedRevision: f.draft.revision, action: "SAVE_PROFILE", payload: profile(f.handle) });
    await prisma.user.update({ where: { id: f.user.id }, data: { emailVerifiedAt: new Date(), isTest: false } });
    const creator = await prisma.creator.update({ where: { userId: f.user.id }, data: { isTest: false } });
    const account = async (platform: "INSTAGRAM" | "TIKTOK") => {
      const row = await prisma.socialAccount.create({ data: { creatorId: creator.id, platform, handle: f.handle, intendedConfirmedAt: new Date(), consentAt: new Date() } });
      await reviewedOwnershipFixture(prisma, f.user.id, admin.id, row.id, "test", new Date());
      return row;
    };
    const primary = await account("INSTAGRAM"), extra = await account("TIKTOK");
    await prisma.creator.update({ where: { id: creator.id }, data: { primaryAccountId: primary.id } });
    r = await profileCommand(f.user.id, f.draft.id, { operationKey: "generate", expectedRevision: r.draft.revision, action: "GENERATE_PORTFOLIO", payload: {} });
    r = await profileCommand(f.user.id, f.draft.id, { operationKey: "approve", expectedRevision: r.draft.revision, action: "APPROVE_PORTFOLIO", payload: { portfolioVersion: 1, content: r.portfolio!.content } });
    r = await profileCommand(f.user.id, f.draft.id, { operationKey: "publish-primary", expectedRevision: r.draft.revision, action: "PUBLISH", payload: { consent: true, portfolioVersion: 1 } });
    expect((await publicCreator(f.handle))?.accounts.map((a) => a.platform)).toEqual(["INSTAGRAM"]);
    expect((await prisma.socialAccount.findUniqueOrThrow({ where: { id: extra.id } })).publicVisible).toBe(false);
    r = await profileCommand(f.user.id, f.draft.id, { operationKey: "publish-extra", expectedRevision: r.draft.revision, action: "PUBLISH", payload: { consent: true, portfolioVersion: 1, visibleAccountIds: [primary.id, extra.id] } });
    expect((await publicCreator(f.handle))?.accounts).toHaveLength(2);
    await prisma.user.update({ where: { id: admin.id }, data: { active: false } });
    expect(await publicCreator(f.handle)).toBeNull();
    await expect(profileCommand(f.user.id, f.draft.id, { operationKey: "inactive-reviewer", expectedRevision: r.draft.revision, action: "PUBLISH", payload: { consent: true, portfolioVersion: 1 } })).rejects.toMatchObject({ code: "PRIMARY_OWNERSHIP_REQUIRED" });
  });
});
