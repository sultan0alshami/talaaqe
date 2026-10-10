import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { checkProfileActor, withProfileActorTransaction, withOrganizationTransaction, type OrganizationActor } from "@/lib/organizations/context";
import { getPublicationReadiness } from "@/lib/readiness";
import { PublicationReadinessSchema } from "@/lib/readiness/contracts";
import * as receiptReaders from "@/lib/evidence/receipt-reader";
import { submitBusinessVerification, reviewBusinessVerification } from "@/lib/evidence/service";
import { reviewedEvidenceOptions, uploadSyntheticEvidence } from "../helpers/reviewed-evidence";
import { canonicalHash, stateOf } from "@/lib/onboarding/drafts";
import { profileCommand, publicCreator } from "@/lib/onboarding/profiles";
import { assertPublicationPrerequisites,
  type PublicationPrerequisiteInput } from "@/lib/onboarding/publication-prerequisites";
import { lockEvidenceActors } from "@/lib/evidence/readiness";
import type { EvidenceReceiptReader } from "@/lib/evidence/receipt-reader";
import { reviewedOwnershipFixture, reviewedRepresentativeFixture, cleanupReviewedEvidence } from "../helpers/reviewed-evidence";

// IGNORED native draft; eventual tests/readiness/publication.test.ts.
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

async function ready(f: Fixture, query: unknown = {}, client?: PrismaClient) {
  const result = await getPublicationReadiness(f.owner.actor, query, { client });
  expect(PublicationReadinessSchema.safeParse(result).success).toBe(true); return result;
}
async function blocked(f: Fixture, code: string, kind: string, step: number | null, query: unknown = {}) {
  const result = await ready(f, query); expect(result).toMatchObject({ status: "BLOCKED", blockerCode: code, requiresExplicitPublicationConsent: true });
  expect(result.remedies).toEqual([expect.objectContaining({ kind, onboardingStep: step })]); return result;
}
function latch<T>() { let resolve!: (value: T | PromiseLike<T>) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function hold(table: "User" | "AdminAudit", id?: string, follow?: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  const peer = new PrismaClient(), monitor = new PrismaClient(), selected = latch<number>(), release = latch<void>(), stop = new AbortController();
  const holding = peer.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
    if (table === "User") await tx.$queryRaw`SELECT id FROM "User" WHERE id=${id!} FOR UPDATE`;
    else await tx.$executeRaw`LOCK TABLE "AdminAudit" IN ACCESS EXCLUSIVE MODE`;
    selected.resolve(rows[0]!.pid); await release.promise; if (follow) return follow(tx);
  }, { maxWait: 5000, timeout: 12000 }); void holding.catch(() => {});
  let waiting: Promise<void> | undefined;
  let pid: number;
  try { pid = await Promise.race([selected.promise, holding.then(() => { throw new Error("Synthetic holder completed before native lock publication"); })]); }
  catch (error) { release.resolve(); stop.abort(); await holding.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); throw error; }
  return { holding, release: () => release.resolve(), wait() {
    waiting = (async () => { const end = performance.now() + 4000;
      while (performance.now() < end) {
        if (stop.signal.aborted) throw new Error("Synthetic native wait witness cancelled");
        const rows = await monitor.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
          AND wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid)) AND query LIKE ${`%"${table}"%`}`;
        if (rows.length) return; await delay(20);
      } throw new Error("Synthetic readiness did not enter its actual native lock wait");
    })(); return waiting;
  }, async close() { release.resolve(); stop.abort(); await holding.catch(() => {}); await waiting?.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); } };
}

describe("publication readiness: independent current native self-profile scope", () => {
  it("returns CREATOR/BRAND ready-for-review without publishing, upsert or private draft/job/rate hydration", async () => {
    for (const role of ["CREATOR", "BRAND"] as const) {
      const f = await fixture(role); expect(await prerequisites(f)).toMatchObject({ version: 1 });
      const before = { draft: await prisma.onboardingDraft.findUniqueOrThrow({ where: { id: f.draft.id } }),
        profile: role === "CREATOR" ? await prisma.creator.findUniqueOrThrow({ where: { id: f.profileId } }) : await prisma.brand.findUniqueOrThrow({ where: { id: f.profileId } }) };
      const models: string[] = [], mutations: string[] = [], draftRows: unknown[] = [], accountRows: unknown[] = [];
      const client = prisma.$extends({ query: { async $allOperations({ model, operation, args, query }) {
        if (model) models.push(model);
        if (model && model !== "AdminAudit" && /^(create|upsert|update|delete)/.test(operation)) mutations.push(`${model}.${operation}`);
        const result = await query(args);
        if (model === "OnboardingDraft" || operation === "$queryRaw") draftRows.push(result);
        if (model === "SocialAccount" && (operation === "findMany" || operation === "findUnique" || operation === "findUniqueOrThrow")) accountRows.push(result);
        return result;
      } } }) as unknown as PrismaClient;
      const result = await ready(f, {}, client);
      expect(result).toMatchObject({ scope: "OWN_PROFILE", role, profileId: f.profileId, draftId: f.draft.id, draftRevision: 1,
        portfolioVersion: 1, status: "READY_FOR_REVIEW", blockerCode: null, remedies: [], requiresExplicitPublicationConsent: true });
      expect(mutations).toEqual([]); expect(models).not.toContain("SourceJob"); expect(models).not.toContain("CreatorRate");
      for (const values of accountRows) for (const row of Array.isArray(values) ? values : [values]) {
        if (row && typeof row === "object") {
          expect(Object.keys(row)).not.toContain("avatarUrl"); expect(Object.keys(row)).not.toContain("fieldVisibility");
          expect(Object.keys(row)).not.toContain("profileUrl"); expect(Object.keys(row)).not.toContain("raw");
        }
      }
      for (const values of draftRows) for (const row of Array.isArray(values) ? values : [values]) {
        if (row && typeof row === "object" && "input" in row) {
          expect(Object.keys(row)).not.toContain("transcript"); const value = Reflect.get(row, "input");
          expect(Object.keys(value ?? {})).not.toContain("answers"); expect(Object.keys(value ?? {})).not.toContain("facts");
          expect(JSON.stringify(value)).not.toContain(canary);
        }
      }
      expect(JSON.stringify(result)).not.toContain(canary);
      expect(await prisma.onboardingDraft.findUniqueOrThrow({ where: { id: f.draft.id } })).toEqual(before.draft);
      expect(role === "CREATOR" ? await prisma.creator.findUniqueOrThrow({ where: { id: f.profileId } }) : await prisma.brand.findUniqueOrThrow({ where: { id: f.profileId } })).toEqual(before.profile);
      if (role === "CREATOR") {
        const published = await profileCommand(f.owner.user.id, f.draft.id, { operationKey: key(), expectedRevision: 1, action: "PUBLISH", payload: { consent: true, portfolioVersion: 1 } }, { serverAuth: f.owner.actor });
        expect(published.replayed).toBe(false); const c = await prisma.creator.findUniqueOrThrow({ where: { id: f.profileId } }); expect(await publicCreator(c.handle)).toBeNull();
      }
    }
  });

  it("allows only fixed CREATOR/BRAND self-profile actors while old organization stays BRAND-only and current auth precedes input", async () => {
    const creator = await fixture("CREATOR"), brand = await fixture("BRAND");
    for (const f of [creator, brand]) {
      await expect(checkProfileActor(f.owner.actor)).resolves.toBeUndefined();
      expect(await withProfileActorTransaction(f.owner.actor, {}, { write: false, reviewerIds: [f.admin.user.id] }, async (_tx, owners, reviewers) => {
        expect(owners.has(f.owner.user.id)).toBe(true); expect(reviewers.has(f.admin.user.id)).toBe(true); return true;
      })).toBe(true);
    }
    await expect(withOrganizationTransaction(creator.owner.actor, {}, { write: false }, async () => true)).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    const admin = await person("ADMIN"); await expect(getPublicationReadiness(admin.actor, { invalid: true })).rejects.toMatchObject({ status: 403 });
    await expect(getPublicationReadiness({ ...creator.owner.actor, sessionVersion: creator.owner.actor.sessionVersion + 1 }, { invalid: true })).rejects.toMatchObject({ status: 401 });
    await expect(getPublicationReadiness({ ...admin.actor, role: "CREATOR" }, {})).rejects.toMatchObject({ status: 401 });
    await expect(getPublicationReadiness(creator.owner.actor, { userId: brand.owner.user.id })).rejects.toMatchObject({ status: 422 });
    await prisma.authSession.update({ where: { id: creator.owner.actor.sessionId }, data: { revokedAt: new Date() } });
    await expect(getPublicationReadiness(creator.owner.actor, { userId: brand.owner.user.id })).rejects.toMatchObject({ status: 401 });
  });

  it("reports a missing own draft without creating one and never infers another user's profile", async () => {
    const f = await fixture("CREATOR"); await prisma.onboardingDraft.delete({ where: { id: f.draft.id } });
    const result = await blocked(f, "DRAFT_REQUIRED", "ONBOARDING", 0);
    expect(result).toMatchObject({ draftId: null, draftRevision: null }); expect(result.remedies[0]!.href).toBe("/creator/onboarding");
    expect(await prisma.onboardingDraft.count({ where: { userId: f.owner.user.id } })).toBe(0);
    const createdId = key(), held = await hold("User", f.owner.user.id, tx => tx.onboardingDraft.create({ data: {
      id: createdId, userId: f.owner.user.id, kind: "CREATOR", step: "PREVIEW", input: JSON.parse(JSON.stringify(f.draft.input)),
    } }));
    const reading = ready(f); void reading.catch(() => {});
    try {
      await Promise.race([held.wait(), reading.then(() => { throw new Error("Synthetic no-draft capture completed before actual owner wait"); })]);
      held.release(); await held.holding;
      // The newly created draft requires fresh captured reviewer scope. A stale
      // DRAFT_REQUIRED result or late User locks cannot substitute for retry.
      await expect(reading).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
      expect(await ready(f)).toMatchObject({ draftId: createdId, status: "READY_FOR_REVIEW" });
    } finally { await held.close(); await reading.catch(() => {}); }
    const noProfile = await person("CREATOR"); await expect(getPublicationReadiness(noProfile.actor)).rejects.toMatchObject({ status: 404 });
    expect(await prisma.creator.count({ where: { userId: noProfile.user.id } })).toBe(0);
  });

  it("returns actual first CREATOR blockers and linked remedies instead of trusting VERIFIED labels", async () => {
    const f = await fixture("CREATOR"); await prisma.user.update({ where: { id: f.owner.user.id }, data: { emailVerifiedAt: new Date(Date.now() + 60000) } });
    expect((await blocked(f, "EMAIL_VERIFICATION_REQUIRED", "EMAIL", null)).remedies[0]!.href).toBe("/creator");
    await prisma.user.update({ where: { id: f.owner.user.id }, data: { emailVerifiedAt: f.owner.at } });
    const original = await prisma.creator.findUniqueOrThrow({ where: { id: f.profileId } });
    const falseLabel = await prisma.socialAccount.create({ data: { creatorId: f.profileId, platform: "INSTAGRAM", handle: "label_" + key().replace(/-/g, "").slice(0, 16),
      ownershipStatus: "VERIFIED", intendedConfirmedAt: f.owner.at, consentAt: f.owner.at, ownershipReviewedBy: f.admin.user.id, ownershipReviewedAt: f.owner.at } });
    await prisma.creator.update({ where: { id: f.profileId }, data: { primaryAccountId: falseLabel.id, currency: null } });
    expect((await blocked(f, "PRIMARY_OWNERSHIP_REQUIRED", "OWNERSHIP", null)).remedies[0]!.href).toBe("/creator/evidence#evidence-ownership-title");
    await prisma.creator.update({ where: { id: f.profileId }, data: { primaryAccountId: f.accountId } });
    await blocked(f, "PROFILE_ESSENTIALS_REQUIRED", "ESSENTIALS", 3);
    await prisma.creator.update({ where: { id: f.profileId }, data: { currency: original.currency, profileFacts: { mappingHash: "changed" } } });
    await blocked(f, "ACCOUNT_MAPPING_CHANGED", "MAPPING", 1);
    await prisma.creator.update({ where: { id: f.profileId }, data: { profileFacts: original.profileFacts as Prisma.InputJsonValue } });
    const saved = await prisma.onboardingDraft.findUniqueOrThrow({ where: { id: f.draft.id } });
    await prisma.onboardingDraft.update({ where: { id: f.draft.id }, data: { input: { ...JSON.parse(JSON.stringify(saved.input)), generatedSectionsStale: true } } });
    await blocked(f, "PORTFOLIO_APPROVAL_REQUIRED", "PORTFOLIO", 4);
  });

  it("requires genuine current BRAND representation, including natural expired proof and actual withdrawal", async () => {
    const f = await fixture("BRAND"), options = await reviewedEvidenceOptions(prisma, "test", f.owner.at), note = { text: "Synthetic review only", language: "en" };
    await reviewBusinessVerification(f.admin.user.id, f.verificationId!, { operationKey: key(), expectedRevision: 2, decision: "REVOKED", note }, options);
    const expiredAt = new Date(f.owner.at.getTime() + 60000), asset = await uploadSyntheticEvidence(prisma, f.owner.user.id, "REPRESENTATIVE", "test", f.owner.at);
    const submitted = await submitBusinessVerification(f.owner.user.id, { operationKey: key(), brandId: f.profileId, kind: "REPRESENTATIVE", jurisdiction: "KW",
      identifier: "Synthetic expiring representation", evidenceAssetId: asset.id, expiresAt: expiredAt.toISOString() }, options);
    await reviewBusinessVerification(f.admin.user.id, submitted.verification.id, { operationKey: key(), expectedRevision: 1, decision: "VERIFIED", note }, options);
    expect(expiredAt.getTime()).toBeLessThan(Date.now());
    const result = await blocked(f, "REPRESENTATION_REQUIRED", "REPRESENTATION", null);
    expect(result.remedies[0]!.href).toBe("/brand/evidence#brand-representative-title");
    await reviewedRepresentativeFixture(prisma, f.owner.user.id, f.admin.user.id, f.profileId, "test", f.owner.at);
    expect((await ready(f)).status).toBe("READY_FOR_REVIEW");
    await prisma.evidenceCommand.deleteMany({ where: { resourceType: "BusinessVerification", actorUserId: { in: [f.owner.user.id, f.admin.user.id] } } });
    await blocked(f, "REPRESENTATION_REQUIRED", "REPRESENTATION", null);
    const soon = await fixture("BRAND"), atReview = await reviewedEvidenceOptions(prisma, "test", soon.owner.at);
    await reviewBusinessVerification(soon.admin.user.id, soon.verificationId!, { operationKey: key(), expectedRevision: 2, decision: "REVOKED", note }, atReview);
    const proof = await uploadSyntheticEvidence(prisma, soon.owner.user.id, "REPRESENTATIVE", "test", soon.owner.at);
    const expiresAt = new Date(Date.now() + 2000);
    const pending = await submitBusinessVerification(soon.owner.user.id, { operationKey: key(), brandId: soon.profileId, kind: "REPRESENTATIVE", jurisdiction: "KW",
      identifier: "Synthetic naturally expiring review", evidenceAssetId: proof.id, expiresAt: expiresAt.toISOString() }, atReview);
    await reviewBusinessVerification(soon.admin.user.id, pending.verification.id, { operationKey: key(), expectedRevision: 1, decision: "VERIFIED", note }, atReview);
    const before = await prisma.businessVerification.findUniqueOrThrow({ where: { id: pending.verification.id } });
    const held = await hold("User", soon.owner.user.id), reading = ready(soon); void reading.catch(() => {});
    try {
      await Promise.race([held.wait(), reading.then(() => { throw new Error("Synthetic expiring proof completed before actual owner wait"); })]);
      await delay(Math.max(0, expiresAt.getTime() - Date.now() + 50)); held.release(); await held.holding;
      expect(await reading).toMatchObject({ status: "BLOCKED", blockerCode: "REPRESENTATION_REQUIRED" });
      expect(await prisma.businessVerification.findUniqueOrThrow({ where: { id: pending.verification.id } })).toEqual(before);
    } finally { await held.close(); await reading.catch(() => {}); }
  });

  it("uses only the latest portfolio and exact selected-account consent, preserving default/empty selections", async () => {
    const f = await fixture("CREATOR"), other = await fixture("CREATOR");
    expect((await ready(f, { visibleAccountIds: [] })).status).toBe("READY_FOR_REVIEW");
    await blocked(f, "ACCOUNT_PUBLICATION_NOT_ALLOWED", "ACCOUNT_SELECTION", 1, { visibleAccountIds: [other.accountId] });
    await prisma.portfolioVersion.create({ data: { creatorId: f.profileId, version: 2, inputRevision: 1, content: f.content } });
    await blocked(f, "PORTFOLIO_APPROVAL_REQUIRED", "PORTFOLIO", 4);
    await prisma.portfolioVersion.update({ where: { creatorId_version: { creatorId: f.profileId, version: 2 } }, data: { approvedAt: f.owner.at } });
    expect(await ready(f)).toMatchObject({ status: "READY_FOR_REVIEW", portfolioVersion: 2 });
    await blocked(f, "PORTFOLIO_APPROVAL_REQUIRED", "PORTFOLIO", 4, { portfolioVersion: 1 });
    await prisma.socialAccount.update({ where: { id: f.accountId! }, data: { consentAt: new Date(Date.now() + 60000) } });
    await blocked(f, "PRIMARY_OWNERSHIP_REQUIRED", "OWNERSHIP", null);
    await prisma.socialAccount.update({ where: { id: f.accountId! }, data: { consentAt: f.owner.at } });
    await prisma.portfolioVersion.create({ data: { creatorId: f.profileId, version: 3, inputRevision: 1, approvedAt: f.owner.at, content: { invalid: true } } });
    await blocked(f, "PORTFOLIO_APPROVAL_REQUIRED", "PORTFOLIO", 4);
  });

  it("rejects changed captured owner/reviewer without late User locks and fails closed on101 candidate metadata rows", async () => {
    for (const change of ["owner", "reviewer"] as const) {
      const f = await fixture("CREATOR"), replacement = await person(change === "owner" ? "CREATOR" : "ADMIN"), locks: unknown[] = [];
      const client = prisma.$extends({ query: { async $queryRaw({ args, query }) { if (/FROM\s+"User"[\s\S]*FOR\s+(?:UPDATE|SHARE)/i.test(args.sql)) locks.push(...args.values.flat(Infinity)); return query(args); } } }) as unknown as PrismaClient;
      const held = await hold("User", f.owner.user.id, tx => change === "owner"
        ? tx.creator.update({ where: { id: f.profileId }, data: { userId: replacement.user.id } })
        : tx.socialAccount.update({ where: { id: f.accountId! }, data: { ownershipReviewedBy: replacement.user.id } }));
      const reading = ready(f, {}, client); void reading.catch(() => {});
      try {
        await Promise.race([held.wait(), reading.then(() => { throw new Error("Synthetic readiness completed before actual captured owner wait"); })]);
        held.release(); await held.holding; await expect(reading).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 }); expect(locks).not.toContain(replacement.user.id);
      } finally { await held.close(); await reading.catch(() => {}); }
    }
    const f = await fixture("CREATOR"), suffix = key().replace(/-/g, "").slice(0, 8);
    await prisma.socialAccount.createMany({ data: Array.from({ length: 100 }, (_, i) => ({ creatorId: f.profileId, platform: "INSTAGRAM" as const,
      handle: `bound_${i}_${suffix}`, ownershipStatus: "VERIFIED" as const, ownershipReviewedBy: f.admin.user.id, ownershipReviewedAt: f.owner.at,
      intendedConfirmedAt: f.owner.at, consentAt: f.owner.at })) });
    await expect(ready(f)).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
    const brand = await fixture("BRAND"), lockedRows: number[] = [];
    // Storage-only unreviewed registration history, not representation proof.
    // Current publication still uses the actual reviewed representative fixture.
    await prisma.businessVerification.createMany({ data: Array.from({ length: 120 }, (_, i) => ({ brandId: brand.profileId,
      kind: "BUSINESS_REGISTRATION", jurisdiction: "KW", identifier: `synthetic unrelated history ${i}` })) });
    const boundedClient = prisma.$extends({ query: { async $queryRaw({ args, query }) {
      const result = await query(args);
      if (/FROM\s+"BusinessVerification"/i.test(args.sql) && /FOR\s+SHARE/i.test(args.sql) && Array.isArray(result)) lockedRows.push(result.length);
      return result;
    } } }) as unknown as PrismaClient;
    expect((await ready(brand, {}, boundedClient)).status).toBe("READY_FOR_REVIEW");
    expect(lockedRows.length).toBeGreaterThan(0); expect(lockedRows.every(count => count <= 100)).toBe(true);
  });

  it("enforces final native session expiry rollback and one real reader deadline across actual scope waiting", async () => {
    const f = await fixture("CREATOR"), expiry = new Date(Date.now() + 1500); await prisma.authSession.update({ where: { id: f.owner.actor.sessionId }, data: { expiresAt: expiry } });
    const heldAudit = await hold("AdminAudit");
    const writing = withProfileActorTransaction(f.owner.actor, {}, { write: false }, tx => tx.adminAudit.create({ data: { actorUserId: f.owner.user.id,
      action: "synthetic.publication.expiry", resourceType: "SyntheticPublication", resourceId: f.profileId, snapshot: { synthetic: true } } })); void writing.catch(() => {});
    try {
      await Promise.race([heldAudit.wait(), writing.then(() => { throw new Error("Synthetic profile callback completed before actual audit wait"); })]);
      await delay(Math.max(0, expiry.getTime() - Date.now() + 50)); heldAudit.release(); await heldAudit.holding;
      await expect(writing).rejects.toMatchObject({ status: 401 }); expect(await prisma.adminAudit.count({ where: { actorUserId: f.owner.user.id, action: "synthetic.publication.expiry" } })).toBe(0);
    } finally { await heldAudit.close(); await writing.catch(() => {}); }
    const fresh = await fixture("CREATOR"), originalFactory = receiptReaders.createEvidenceReceiptReader;
    const spy = vi.spyOn(receiptReaders, "createEvidenceReceiptReader").mockImplementation(options => originalFactory({ ...options, maxElapsedMs: 300 }));
    const heldUser = await hold("User", fresh.owner.user.id), started = performance.now(), reading = ready(fresh); void reading.catch(() => {});
    try {
      await Promise.race([heldUser.wait(), reading.then(() => { throw new Error("Synthetic readiness completed before actual reader deadline wait"); })]);
      await delay(Math.max(0, started + 350 - performance.now())); heldUser.release(); await heldUser.holding;
      await expect(reading).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 }); expect(spy).toHaveBeenCalledTimes(1);
    } finally { await heldUser.close(); await reading.catch(() => {}); spy.mockRestore(); }
  });
});
