import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import type { OrganizationActor } from "@/lib/organizations/context";
import { canonicalHash, stateOf } from "@/lib/onboarding/drafts";
import { profileCommand, publicCreator } from "@/lib/onboarding/profiles";
import { assertPublicationPrerequisites, assertPublicationAccountSelection, currentPublicationPortfolio,
  type PublicationPrerequisiteInput } from "@/lib/onboarding/publication-prerequisites";
import { lockEvidenceActors } from "@/lib/evidence/readiness";
import { createEvidenceReceiptReader, type EvidenceReceiptReader } from "@/lib/evidence/receipt-reader";
import { reviewedOwnershipFixture, reviewedRepresentativeFixture, cleanupReviewedEvidence } from "../helpers/reviewed-evidence";

// IGNORED native draft; eventual tests/onboarding/publication-prerequisites.test.ts.
// Root alone executes. Actual sessions/uploads/submit/review commands use owned
// synthetic data, never live identity/representation/legal acceptance.
const users = new Set<string>(), creatorIds = new Set<string>(), brandIds = new Set<string>();
const key = () => randomUUID(), canary = "synthetic private transcript/answers/facts canary";
afterEach(async () => {
  await prisma.creator.deleteMany({ where: { id: { in: [...creatorIds] } } });
  await prisma.brand.deleteMany({ where: { id: { in: [...brandIds] } } });
  await cleanupReviewedEvidence(prisma, [...users], "test");
  await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
  users.clear(); creatorIds.clear(); brandIds.clear();
});
async function person(role: "CREATOR" | "BRAND" | "ADMIN") {
  const id = key(), at = new Date(Date.now() - 120000); users.add(id);
  const user = await prisma.user.create({ data: { id, role, active: true, isTest: true, name: "Synthetic publication actor", email: `${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: at } });
  const token = await openSession(id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Synthetic publication native session did not resolve");
  const actor: OrganizationActor = { userId: id, role: session.role, sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  return { user, actor, at };
}
async function fixture(role: "CREATOR" | "BRAND") {
  const owner = await person(role), admin = await person("ADMIN"), suffix = key().replace(/-/g, "").slice(0, 16), at = owner.at;
  let profileId: string, accountId: string | null = null, verificationId: string | null = null;
  const sources = {};
  if (role === "CREATOR") {
    const creator = await prisma.creator.create({ data: { userId: owner.user.id, handle: "pub_" + suffix, displayName: "اسم أصلي Synthetic publication", state: "PRIVATE", isTest: true,
      countryCode: "KW", timeZone: "Asia/Kuwait", languages: ["ar"], nicheIds: ["tech"], currency: "KWD", profileFacts: { mappingHash: canonicalHash(sources) } } });
    creatorIds.add(creator.id); profileId = creator.id;
    const account = await prisma.socialAccount.create({ data: { creatorId: creator.id, platform: "INSTAGRAM", handle: "proof_" + suffix,
      intendedConfirmedAt: at, consentAt: at, providerAccountId: "synthetic-provider-" + suffix } }); accountId = account.id;
    await reviewedOwnershipFixture(prisma, owner.user.id, admin.user.id, account.id, "test", at);
    await prisma.creator.update({ where: { id: profileId }, data: { primaryAccountId: account.id, state: "PRIVATE" } });
  } else {
    const brand = await prisma.brand.create({ data: { userId: owner.user.id, slug: "pub-" + suffix, name: "شركة أصلية Synthetic publication", state: "PRIVATE", isTest: true,
      countryCode: "KW", timeZone: "Asia/Kuwait", profileFacts: { languages: ["ar"], targetMarkets: ["KW"], preferredCurrency: "KWD", contactName: canary } } });
    brandIds.add(brand.id); profileId = brand.id;
    verificationId = (await reviewedRepresentativeFixture(prisma, owner.user.id, admin.user.id, brand.id, "test", at)).verificationId;
  }
  const draft = await prisma.onboardingDraft.create({ data: { userId: owner.user.id, kind: role, step: "PREVIEW", input: {
    version: 1, sources, generatedSectionsStale: false, answers: { privateAnswer: canary },
    facts: { privateFact: [{ id: key(), jobId: "synthetic-job-reference", fieldKey: "bio", value: canary.repeat(30), unit: null,
      source: "SELF_REPORTED", evidenceAt: at.toISOString(), sourceReference: null, reviewStatus: "PROPOSED", visibility: "PRIVATE" }] },
  }, transcript: [{ role: "user", text: canary, ts: at.getTime() }] } });
  const content = { title: "Original portfolio title", bio: "  سيرة أصلية\nOriginal biography  ", sections: [], method: "APPROVED_FACT_TEMPLATE" };
  if (role === "CREATOR") await prisma.portfolioVersion.create({ data: { creatorId: profileId, version: 1, inputRevision: 999, approvedAt: new Date(Date.now() + 60000), content } });
  else await prisma.brandPortfolioVersion.create({ data: { brandId: profileId, version: 1, inputRevision: 999, approvedAt: new Date(Date.now() + 60000), content } });
  return { role, owner, admin, profileId, accountId, verificationId, draft, content };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function input(tx: Prisma.TransactionClient, f: Fixture, reader?: EvidenceReceiptReader, payload: Partial<PublicationPrerequisiteInput["payload"]> = {}): Promise<PublicationPrerequisiteInput> {
  const draft = await tx.onboardingDraft.findUniqueOrThrow({ where: { id: f.draft.id } });
  const profile: PublicationPrerequisiteInput["profile"] = f.role === "CREATOR"
    ? { role: "CREATOR", creator: await tx.creator.findUniqueOrThrow({ where: { id: f.profileId } }) }
    : { role: "BRAND", brand: await tx.brand.findUniqueOrThrow({ where: { id: f.profileId } }) };
  const actors = await lockEvidenceActors(tx, { creatorIds: f.role === "CREATOR" ? [f.profileId] : [], brandIds: f.role === "BRAND" ? [f.profileId] : [] });
  return { actorUserId: f.owner.user.id, profile, state: stateOf(draft), actors, now: new Date(), reader, payload: { consent: true, portfolioVersion: 1, ...payload } };
}
async function prerequisites(f: Fixture, payload: Partial<PublicationPrerequisiteInput["payload"]> = {}, reader?: EvidenceReceiptReader) {
  return prisma.$transaction(async tx => assertPublicationPrerequisites(tx, await input(tx, f, reader, payload)));
}

describe("publication prerequisite extraction: independent actual native parity", () => {
  it("keeps CREATOR PUBLISH action semantics for private/test profiles, future approval and unmatched input revision", async () => {
    const f = await fixture("CREATOR"), result = await prerequisites(f);
    expect(result).toMatchObject({ version: 1, inputRevision: 999, content: f.content }); expect(Date.parse(result.approvedAt!)).toBeGreaterThan(Date.now());
    const published = await profileCommand(f.owner.user.id, f.draft.id, { operationKey: key(), expectedRevision: 1, action: "PUBLISH", payload: { consent: true, portfolioVersion: 1, visibleAccountIds: [] } });
    expect(published.replayed).toBe(false); expect((await prisma.creator.findUniqueOrThrow({ where: { id: f.profileId } })).state).toBe("PUBLISHED");
    expect((await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.accountId! } })).publicVisible).toBe(false);
    const current = await prisma.creator.findUniqueOrThrow({ where: { id: f.profileId } }); expect(await publicCreator(current.handle)).toBeNull();
  });
  it("keeps BRAND parity and shares a bounded representative receipt/asset budget without trusting VERIFIED metadata alone", async () => {
    const f = await fixture("BRAND"); expect(await prerequisites(f, {}, createEvidenceReceiptReader({ maxRows: 3 }))).toMatchObject({ version: 1, inputRevision: 999 });
    await expect(prerequisites(f, {}, createEvidenceReceiptReader({ maxRows: 2 }))).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
    await prisma.evidenceCommand.deleteMany({ where: { resourceType: "BusinessVerification", resourceId: f.verificationId! } });
    expect((await prisma.businessVerification.findUniqueOrThrow({ where: { id: f.verificationId! } })).status).toBe("VERIFIED");
    await expect(prerequisites(f)).rejects.toMatchObject({ code: "REPRESENTATION_REQUIRED" });
  });
  it("preserves first-blocker order and latest malformed/unapproved portfolio masking", async () => {
    const f = await fixture("CREATOR"); await prisma.user.update({ where: { id: f.owner.user.id }, data: { emailVerifiedAt: null } });
    await expect(prerequisites(f, { consent: false })).rejects.toMatchObject({ code: "PUBLICATION_CONSENT_REQUIRED", status: 400 });
    await expect(prerequisites(f)).rejects.toMatchObject({ code: "EMAIL_VERIFICATION_REQUIRED" });
    await prisma.user.update({ where: { id: f.owner.user.id }, data: { emailVerifiedAt: f.owner.at } });
    await prisma.portfolioVersion.create({ data: { creatorId: f.profileId, version: 2, inputRevision: 1, content: f.content } });
    expect(await prisma.$transaction(tx => currentPublicationPortfolio(tx, "CREATOR", f.profileId))).toMatchObject({ version: 2, approvedAt: null });
    await expect(prerequisites(f)).rejects.toMatchObject({ code: "PORTFOLIO_APPROVAL_REQUIRED" });
    await prisma.portfolioVersion.create({ data: { creatorId: f.profileId, version: 3, inputRevision: 1, approvedAt: f.owner.at, content: { invalid: true } } });
    expect(await prisma.$transaction(tx => currentPublicationPortfolio(tx, "CREATOR", f.profileId))).toBeNull();
    await expect(prerequisites(f)).rejects.toMatchObject({ code: "PORTFOLIO_APPROVAL_REQUIRED" });
  });
  it("defaults selection to proved primary, accepts explicit empty and rejects future consent/foreign or label-only secondary", async () => {
    const f = await fixture("CREATOR"), other = await fixture("CREATOR");
    const selected = (ids?: string[]) => prisma.$transaction(async tx => {
      const value = await input(tx, f); if (value.profile.role !== "CREATOR") throw new Error("Synthetic creator fixture required");
      return assertPublicationAccountSelection(tx, { actorUserId: f.owner.user.id, creator: value.profile.creator, actors: value.actors, now: value.now, visibleAccountIds: ids });
    });
    expect(await selected()).toEqual([f.accountId]); expect(await selected([])).toEqual([]);
    await expect(selected([other.accountId!])).rejects.toMatchObject({ code: "ACCOUNT_PUBLICATION_NOT_ALLOWED", status: 400 });
    const account = await prisma.socialAccount.create({ data: { creatorId: f.profileId, platform: "INSTAGRAM", handle: "label_" + key().replace(/-/g, "").slice(0, 16),
      ownershipStatus: "VERIFIED", ownershipReviewedBy: f.admin.user.id, ownershipReviewedAt: f.owner.at, intendedConfirmedAt: f.owner.at, consentAt: f.owner.at } });
    await expect(selected([account.id])).rejects.toMatchObject({ code: "ACCOUNT_PUBLICATION_NOT_ALLOWED", status: 400 });
    await prisma.socialAccount.update({ where: { id: f.accountId! }, data: { consentAt: new Date(Date.now() + 60000) } });
    await expect(selected([f.accountId!])).rejects.toMatchObject({ code: "ACCOUNT_PUBLICATION_NOT_ALLOWED", status: 400 });
  });
});
