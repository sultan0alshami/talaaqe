import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { applyDraftCommand, createOrResumeDraft, getDraft } from "@/lib/onboarding/drafts";
import { profileCommand, publicCreator } from "@/lib/onboarding/profiles";
import { cleanupReviewedEvidence, reviewedOwnershipFixture } from "../helpers/reviewed-evidence";

// Independent review of coordinator-owned production modules. Synthetic local
// byte-reviewed records exercise ownership; they do not establish live-provider proof.
const users: string[] = [];
afterAll(async () => {
  await prisma.outboxEvent.deleteMany({ where: { OR: users.map((actorUserId) => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await prisma.creator.deleteMany({ where: { userId: { in: users } } });
  await cleanupReviewedEvidence(prisma, users, "test");
  await prisma.user.deleteMany({ where: { id: { in: users } } });
});
async function fixture() {
  const userId = randomUUID(), suffix = randomBytes(6).toString("hex"), handle = `review_${suffix}`, socialHandle = `synthetic_${suffix}`;
  await prisma.user.create({ data: { id: userId, name: "Synthetic independent review", email: `${userId}@example.invalid`, passwordHash: "not-a-login", role: "CREATOR", isTest: false, emailVerifiedAt: new Date() } });
  users.push(userId);
  const adminId = randomUUID();
  await prisma.user.create({ data: { id: adminId, name: "Synthetic independent reviewer", email: `${adminId}@example.invalid`, passwordHash: "not-a-login", role: "ADMIN", isTest: true, active: true } });
  users.push(adminId);
  await prisma.creator.create({ data: { userId, handle, displayName: "Synthetic independent review", isTest: false } });
  const draft = await createOrResumeDraft(userId);
  const identity = { platform: "INSTAGRAM", providerAccountId: `provider-a-${suffix}`, normalizedHandle: socialHandle, confirmedOrigin: null };
  async function map(nextIdentity = identity) {
    let current = await getDraft(userId, draft.id);
    current = (await applyDraftCommand(userId, draft.id, { action: "SET_ANSWER", expectedRevision: current.revision, operationKey: randomUUID(), payload: { field: "sourceMapping", value: { sourceKey: "instagram", source: "INSTAGRAM", identity: nextIdentity } } })).draft;
    current = (await applyDraftCommand(userId, draft.id, { action: "CONFIRM_ACCOUNT", expectedRevision: current.revision, operationKey: randomUUID(), payload: { sourceKey: "instagram", identity: nextIdentity } })).draft;
    return (await applyDraftCommand(userId, draft.id, { action: "GRANT_IMPORT_CONSENT", expectedRevision: current.revision, operationKey: randomUUID(), payload: { sourceKey: "instagram", identity: nextIdentity, scopes: ["public-profile"], consentVersion: "synthetic-v1", granted: true } })).draft;
  }
  async function command(action: string, payload: unknown) {
    const current = await getDraft(userId, draft.id);
    return profileCommand(userId, draft.id, { action, expectedRevision: current.revision, operationKey: randomUUID(), payload });
  }
  const profile = { displayName: "Synthetic independent review", infameHandle: handle, bio: "Reviewed original bio", location: { countryCode: "EG", cityKey: null, cityLabel: null, timeZone: "Africa/Cairo" }, languages: ["ar"], dialects: [], nicheSlugs: ["tech"], fameIndustries: [], contentStyles: [], preferredCurrency: "KWD", minimumMinor: null, availability: { status: "UNKNOWN", startsAt: null, endsAt: null }, travelWilling: false, ratesVisibility: "PRIVATE", rates: [], primarySourceKey: "instagram" };
  await map();
  await command("SAVE_PROFILE", profile);
  const creator = await prisma.creator.findUniqueOrThrow({ where: { userId } });
  const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: creator.primaryAccountId! } });
  await reviewedOwnershipFixture(prisma, userId, adminId, account.id, "test", new Date());
  return { userId, handle, draft, identity, map, command, profile, account };
}

describe("independent profile publication/proof regressions", () => {
  it("does not retain accepted proof after a same-handle stable provider identity changes", async () => {
    const f = await fixture();
    await f.map({ ...f.identity, providerAccountId: "different-reviewed-provider" });
    await f.command("SAVE_PROFILE", f.profile);
    const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    expect(account.ownershipStatus).not.toBe("VERIFIED");
  });
  it("does not publish edited replacement portfolio content through asset approval alone", async () => {
    const f = await fixture();
    let generated = await f.command("GENERATE_PORTFOLIO", {});
    await f.command("APPROVE_PORTFOLIO", { portfolioVersion: generated.portfolio!.version, content: generated.portfolio!.content });
    await f.command("PUBLISH", { consent: true, portfolioVersion: generated.portfolio!.version });
    expect(await publicCreator(f.handle)).not.toBeNull();
    generated = await f.command("GENERATE_PORTFOLIO", {});
    const marker = "Private replacement awaiting explicit publish";
    await f.command("APPROVE_PORTFOLIO", { portfolioVersion: generated.portfolio!.version, content: { ...generated.portfolio!.content, bio: marker } });
    expect(JSON.stringify(await publicCreator(f.handle))).not.toContain(marker);
  });
  it("preserves unrelated account approvals when one source mapping is corrected", async () => {
    const f = await fixture(), creator = await prisma.creator.findUniqueOrThrow({ where: { userId: f.userId } });
    const approvedAt = new Date();
    const other = await prisma.socialAccount.create({ data: { creatorId: creator.id, platform: "TIKTOK", handle: `other_${f.userId.slice(0, 8)}`, factsApprovedAt: approvedAt, ownershipStatus: "VERIFIED", ownershipReviewedAt: approvedAt, intendedConfirmedAt: approvedAt, consentAt: approvedAt } });
    await f.map({ ...f.identity, providerAccountId: "corrected-provider" });
    expect((await prisma.socialAccount.findUniqueOrThrow({ where: { id: other.id } })).factsApprovedAt).toEqual(approvedAt);
  });
});
