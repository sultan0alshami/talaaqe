import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { publicCreator, publicBrand } from "@/lib/onboarding/profiles";
import { cleanupReviewedEvidence, reviewedOwnershipFixture, reviewedRepresentativeFixture } from "../helpers/reviewed-evidence";

const users: string[] = [];
async function actor(role: "CREATOR" | "BRAND" | "ADMIN") {
  const id = randomUUID(); users.push(id);
  await prisma.user.create({ data: { id, role, name: "Synthetic canonical proof actor", email: id + "@example.invalid", passwordHash: "not-a-login", emailVerifiedAt: new Date(), isTest: false } });
  return id;
}
async function fixture(proved = true) {
  const owner = await actor("CREATOR"), reviewer = await actor("ADMIN"), now = new Date(), handle = "proof_" + owner.slice(0, 8);
  const creator = await prisma.creator.create({ data: { userId: owner, handle, displayName: "Synthetic protected identity", countryCode: "KW", state: "PUBLISHED", isTest: false, publicConsentAt: now, brandVisible: true } });
  const account = await prisma.socialAccount.create({ data: { creatorId: creator.id, platform: "INSTAGRAM", handle, intendedConfirmedAt: now, consentAt: now, publicVisible: true, brandVisible: true } });
  const proof = proved ? await reviewedOwnershipFixture(prisma, owner, reviewer, account.id, "test", now) : null;
  if (!proved) await prisma.socialAccount.update({ where: { id: account.id }, data: { ownershipStatus: "VERIFIED", ownershipReviewedAt: now, ownershipReviewedBy: reviewer, ownershipIdentityHash: canonicalHash({ platform: "INSTAGRAM", normalizedHandle: handle, providerAccountId: null, confirmedOrigin: null }) } });
  await prisma.socialAccount.update({ where: { id: account.id }, data: { publicVisible: true, brandVisible: true } });
  await prisma.creator.update({ where: { id: creator.id }, data: { primaryAccountId: account.id } });
  await prisma.portfolioVersion.create({ data: { creatorId: creator.id, version: 1, inputRevision: 1, approvedAt: now, content: { title: "Synthetic identity", bio: "Synthetic original public bio", sections: [], method: "APPROVED_FACT_TEMPLATE" } } });
  return { owner, reviewer, handle, creator, account, proof };
}
afterEach(async () => {
  await prisma.creator.deleteMany({ where: { userId: { in: users } } });
  await prisma.brand.deleteMany({ where: { userId: { in: users } } });
  await cleanupReviewedEvidence(prisma, users, "test");
  await prisma.user.deleteMany({ where: { id: { in: users } } }); users.length = 0;
});
describe("canonical anonymous projections require current bound proof", () => {
  it("rejects raw VERIFIED and identity hash without a reviewed owner challenge", async () => {
    const f = await fixture(false);
    expect(await publicCreator(f.handle)).toBeNull();
  });
  it("withdraws a deleted proof and an inactive reviewer without exposing cached identity", async () => {
    const f = await fixture();
    expect(await publicCreator(f.handle)).not.toBeNull();
    await prisma.privateAsset.update({ where: { id: f.proof!.proofId }, data: { deletedAt: new Date() } });
    expect(await publicCreator(f.handle)).toBeNull();
    await prisma.privateAsset.update({ where: { id: f.proof!.proofId }, data: { deletedAt: null } });
    await prisma.user.update({ where: { id: f.reviewer }, data: { active: false } });
    expect(await publicCreator(f.handle)).toBeNull();
  });
  it("does not transfer another owner's accepted proof or publish changed mapping", async () => {
    const f = await fixture(), replacement = await actor("CREATOR");
    expect(await publicCreator(f.handle)).not.toBeNull();
    await prisma.creator.update({ where: { id: f.creator.id }, data: { userId: replacement } });
    expect(await publicCreator(f.handle)).toBeNull();
    await prisma.creator.update({ where: { id: f.creator.id }, data: { userId: f.owner } });
    await prisma.socialAccount.update({ where: { id: f.account.id }, data: { mappingRevision: 2 } });
    expect(await publicCreator(f.handle)).toBeNull();
  });
  it("waits behind reviewer suspension and projects only the committed current state", async () => {
    const f = await fixture(), held = new PrismaClient(), reading = new PrismaClient();
    let ready!: () => void, release!: () => void;
    const locked = new Promise<void>(r => { ready = r; }), unblocked = new Promise<void>(r => { release = r; });
    try {
      const suspension = held.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM "User" WHERE id=${f.reviewer} FOR UPDATE`; await tx.user.update({ where: { id: f.reviewer }, data: { active: false } }); ready(); await unblocked; });
      await locked;
      const projection = publicCreator(f.handle, reading);
      const observed = expect(projection).resolves.toBeNull();
      await new Promise(r => setTimeout(r, 50)); release(); await suspension; await observed;
    } finally { release(); await held.$disconnect(); await reading.$disconnect(); }
  });
  it("requires representative submission owner/country/asset binding, independently of registration", async () => {
    const owner = await actor("BRAND"), reviewer = await actor("ADMIN"), now = new Date();
    const brand = await prisma.brand.create({ data: { userId: owner, slug: "proof-brand-" + owner.slice(0, 8), name: "Synthetic protected company", countryCode: "KW", state: "PUBLISHED", isTest: false, publicConsentAt: now } });
    await prisma.brandPortfolioVersion.create({ data: { brandId: brand.id, version: 1, inputRevision: 1, approvedAt: now, content: { title: brand.name, bio: "Original synthetic company", sections: [], method: "APPROVED_FACT_TEMPLATE" } } });
    const raw = await prisma.businessVerification.create({ data: { brandId: brand.id, kind: "REPRESENTATIVE", jurisdiction: "KW", status: "VERIFIED", reviewedBy: reviewer, reviewedAt: now } });
    expect(await publicBrand(brand.slug)).toBeNull();
    await prisma.businessVerification.delete({ where: { id: raw.id } });
    const proof = await reviewedRepresentativeFixture(prisma, owner, reviewer, brand.id, "test", new Date());
    await prisma.brand.update({ where: { id: brand.id }, data: { state: "PUBLISHED" } });
    expect(await publicBrand(brand.slug)).not.toBeNull();
    await prisma.brand.update({ where: { id: brand.id }, data: { countryCode: "EG" } });
    expect(await publicBrand(brand.slug)).toBeNull();
    await prisma.brand.update({ where: { id: brand.id }, data: { countryCode: "KW" } });
    await prisma.privateAsset.update({ where: { id: proof.proofId }, data: { deletedAt: new Date() } });
    expect(await publicBrand(brand.slug)).toBeNull();
  });
});
