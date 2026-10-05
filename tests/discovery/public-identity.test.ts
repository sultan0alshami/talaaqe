import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { PrismaClient, type MetricsSnapshot, type Platform, type Prisma, type SocialAccount } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createEvidenceReceiptReader, type EvidenceReceiptReader } from "@/lib/evidence/receipt-reader";
import { loadPublicCreatorIdentities } from "@/lib/discovery/public-identity";
import { DISCOVERY_FRESHNESS_MS, PublicDiscoveryCreatorSchema, type PublicDiscoveryCreator } from "@/lib/discovery/contracts";
import { publicCreator } from "@/lib/onboarding/profiles";
import { cleanupReviewedEvidence, reviewedEvidenceOptions, reviewedOwnershipFixture } from "../helpers/reviewed-evidence";
import { uploadPrivateAsset, submitMetricsScreenshot, reviewMetricsScreenshot, approveMetricsSnapshot } from "@/lib/evidence/service";

// Independently authored; root alone executes guarded targets.
// Real commands over synthetic local
// bytes are native fixtures, never live creator/audience/provider acceptance.
// Stored publication flags, opaque history and direct race edits are explicitly
// synthetic compatibility/adversarial metadata. No Date/API replacement.
const actorIds = new Set<string>(), creatorIds = new Set<string>();
afterEach(async () => {
  await prisma.creator.deleteMany({ where: { id: { in: [...creatorIds] } } });
  await cleanupReviewedEvidence(prisma, [...actorIds], "test");
  await prisma.user.deleteMany({ where: { id: { in: [...actorIds] } } });
  actorIds.clear(); creatorIds.clear();
});
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1kAAAAASUVORK5CYII=", "base64");
const key = () => randomUUID();
const content = { title: "  أصل عربي / Original title  ", bio: "  سيرة أصلية\nOriginal biography  ", sections: [], method: "APPROVED_FACT_TEMPLATE" };
const note = { text: "مراجعة مصطنعة لاختبار اكتشاف عام محدود فقط", language: "ar" };

async function actor(role: "CREATOR" | "ADMIN", at: Date) {
  const id = key(); actorIds.add(id);
  return prisma.user.create({ data: { id, role, name: "SYNTHETIC_PRIVATE_OWNER_NAME_" + id,
    email: `synthetic-discovery-${id}@example.invalid`, passwordHash: "not-a-login", active: true,
    isTest: role === "ADMIN", emailVerifiedAt: at, createdAt: at } });
}

async function fixture(sharedAdmin?: Awaited<ReturnType<typeof actor>>) {
  const now = new Date(Date.now() - 60_000), base = new Date(now.getTime() - 60_000);
  let time = base.getTime();
  const tick = () => new Date(time += 1000);
  const owner = await actor("CREATOR", base), admin = sharedAdmin ?? await actor("ADMIN", base), metricAdmin = await actor("ADMIN", base);
  const creator = await prisma.creator.create({ data: { userId: owner.id, handle: "disc_" + key().replace(/-/g, "").slice(0, 16),
    displayName: "اسم عربي / Original alias", countryCode: "KW", languages: ["ar", "en"], nicheIds: ["tech"],
    state: "PRIVATE", isTest: false, publicConsentAt: base, profileFacts: { ratesVisibility: "PUBLIC" }, createdAt: base } });
  creatorIds.add(creator.id);
  const restore = () => prisma.creator.update({ where: { id: creator.id }, data: { state: "PUBLISHED", publicConsentAt: base } });
  async function account(platform: Platform = "INSTAGRAM", publicVisible = true, reviewed = true) {
    const row = await prisma.socialAccount.create({ data: { creatorId: creator.id, platform,
      handle: `proof_${platform.toLowerCase()}_${key().replace(/-/g, "").slice(0, 8)}`,
      providerAccountId: "SYNTHETIC_PRIVATE_PROVIDER_" + key(), intendedConfirmedAt: base, consentAt: base,
      publicVisible, createdAt: base } });
    const proof = reviewed ? await reviewedOwnershipFixture(prisma, owner.id, admin.id, row.id, "test", tick()) : null;
    if (reviewed) await prisma.socialAccount.update({ where: { id: row.id }, data: { publicVisible } });
    await restore();
    return { account: await prisma.socialAccount.findUniqueOrThrow({ where: { id: row.id } }), proof };
  }
  const primary = await account();
  await prisma.creator.update({ where: { id: creator.id }, data: { primaryAccountId: primary.account.id } });
  const portfolio = await prisma.portfolioVersion.create({ data: { creatorId: creator.id, version: 1,
    inputRevision: 31, approvedAt: base, createdAt: base, content } });
  async function approve(snapshot: MetricsSnapshot, visibility: Record<string, "PUBLIC" | "BRAND_ONLY" | "PRIVATE">) {
    const current = await prisma.socialAccount.findUniqueOrThrow({ where: { id: snapshot.accountId } });
    const options = await reviewedEvidenceOptions(prisma, "test", tick());
    await approveMetricsSnapshot(owner.id, snapshot.id, { operationKey: key(), expectedMappingRevision: current.mappingRevision,
      expectedEvidenceRevision: current.evidenceRevision, visibility }, options);
    await restore();
  }
  async function screenshot(followers: string | null = "10000", options: { accountId?: string; observedAt?: Date; visibility?: "PUBLIC" | "BRAND_ONLY" | "PRIVATE" | null } = {}) {
    const accountId = options.accountId ?? primary.account.id;
    const uploaded = await uploadPrivateAsset(owner.id, { operationKey: key(), purpose: "SCREENSHOT", contentType: "image/png", bytes: png }, await reviewedEvidenceOptions(prisma, "test", tick()));
    const current = await prisma.socialAccount.findUniqueOrThrow({ where: { id: accountId } });
    const parent = (await submitMetricsScreenshot(owner.id, { operationKey: key(), accountId,
      expectedMappingRevision: current.mappingRevision, expectedEvidenceRevision: current.evidenceRevision,
      evidenceAssetId: uploaded.asset.id, observedAt: (options.observedAt ?? new Date(base.getTime() - 1000)).toISOString(),
      ...(followers === null ? { averageViews: "1234" } : { followers }),
    }, await reviewedEvidenceOptions(prisma, "test", tick()))).snapshot;
    const submitted = await prisma.socialAccount.findUniqueOrThrow({ where: { id: accountId } });
    const child = (await reviewMetricsScreenshot(metricAdmin.id, parent.id, { operationKey: key(), expectedEvidenceRevision: submitted.evidenceRevision,
      decision: "VERIFIED", note }, await reviewedEvidenceOptions(prisma, "test", tick()))).snapshot;
    const row = await prisma.metricsSnapshot.findUniqueOrThrow({ where: { id: child.id } });
    if (options.visibility !== null) await approve(row, { [followers === null ? "averageViews" : "followers"]: options.visibility ?? "PUBLIC" });
    await restore();
    return { child: row, parentId: parent.id, assetId: uploaded.asset.id };
  }
  return { now, base, owner, admin, metricAdmin, creator, primary, portfolio, account, screenshot, approve, restore };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function load(fixtures: readonly Fixture[], options: { client?: PrismaClient; reader?: EvidenceReceiptReader; now?: Date } = {}) {
  const reader = options.reader ?? createEvidenceReceiptReader();
  return (options.client ?? prisma).$transaction(tx => loadPublicCreatorIdentities(tx, fixtures.map(f => f.creator.id), options.now ?? new Date(), reader), { maxWait: 5000, timeout: 12000 });
}
const observation = (followers: string, at: Date, band: string | null) => ({ followers, source: "SCREENSHOT_VERIFIED", observedAt: at.toISOString(), taxonomyVersion: "infame-reach-v2", band });
function accountOf(card: PublicDiscoveryCreator | undefined, account: SocialAccount) { return card?.accounts.find(value => value.platform === account.platform && value.handle === account.handle); }

async function rawSnapshot(f: Fixture, overrides: Partial<Prisma.MetricsSnapshotUncheckedCreateInput> = {}) {
  const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: f.primary.account.id } });
  return prisma.metricsSnapshot.create({ data: { accountId: account.id, mappingRevision: account.mappingRevision, source: "SELF_REPORTED",
    observedAt: new Date(f.base.getTime() - 500), importedAt: f.base, followers: BigInt(77777), reviewStatus: "PENDING", ...overrides } });
}

type LockEvent = { kind: "user" | "domain"; sql: string; users: string[] };
function observedClient() {
  const locks: LockEvent[] = [], accountRows: Array<{ id: string; creatorId: string; publicVisible: boolean }> = [], accountIds: string[] = [], userIds: string[] = [], portfolios: unknown[] = [], snapshots: unknown[] = [], unneededCollections: string[] = [];
  function ids(value: unknown, target: string[]) {
    if (Array.isArray(value)) { for (const row of value) ids(row, target); return; }
    if (!value || typeof value !== "object") return;
    const id = Reflect.get(value, "id"); if (typeof id === "string") target.push(id);
    for (const child of Object.values(value)) if (child && typeof child === "object") ids(child, target);
  }
  function rawAccounts(value: unknown) {
    if (Array.isArray(value)) { for (const row of value) rawAccounts(row); return; }
    if (!value || typeof value !== "object") return;
    const id = Reflect.get(value, "id"), creatorId = Reflect.get(value, "creatorId"), publicVisible = Reflect.get(value, "publicVisible");
    if (typeof id === "string" && typeof creatorId === "string" && typeof publicVisible === "boolean") accountRows.push({ id, creatorId, publicVisible });
    for (const child of Object.values(value)) if (child && typeof child === "object") rawAccounts(child);
  }
  function creatorRelations(value: unknown) {
    if (Array.isArray(value)) { for (const row of value) creatorRelations(row); return; }
    if (!value || typeof value !== "object") return;
    const accounts = Reflect.get(value, "accounts"), versions = Reflect.get(value, "portfolios");
    if (accounts !== undefined) { ids(accounts, accountIds); rawAccounts(accounts); }
    if (versions !== undefined) portfolios.push(versions);
    for (const name of ["rates", "work", "licences"]) if (Object.hasOwn(value, name)) unneededCollections.push(name);
  }
  const client = prisma.$extends({ query: {
    creator: { async findMany({ args, query }) { const rows = await query(args); creatorRelations(rows); return rows; }, async findUnique({ args, query }) { const row = await query(args); creatorRelations(row); return row; } },
    socialAccount: { async findMany({ args, query }) { const rows = await query(args); ids(rows, accountIds); rawAccounts(rows); return rows; },
      async findUnique({ args, query }) { const row = await query(args); ids(row, accountIds); rawAccounts(row); return row; } },
    user: { async findMany({ args, query }) { const rows = await query(args); ids(rows, userIds); return rows; }, async findUnique({ args, query }) { const row = await query(args); ids(row, userIds); return row; } },
    portfolioVersion: { async findMany({ args, query }) { const rows = await query(args); portfolios.push(...rows); return rows; }, async findFirst({ args, query }) { const row = await query(args); if (row) portfolios.push(row); return row; } },
    metricsSnapshot: { async findMany({ args, query }) { const rows = await query(args); snapshots.push(...rows); return rows; }, async findFirst({ args, query }) { const row = await query(args); if (row) snapshots.push(row); return row; } },
    async $queryRaw({ args, query }) {
      const sql = args.sql;
      if (/\bFROM\s+(?:"public"\.)?"User"[\s\S]*\bFOR\s+(?:SHARE|UPDATE)\b/i.test(sql)) locks.push({ kind: "user", sql, users: args.values.flat(Infinity).filter((value): value is string => typeof value === "string") });
      else if (/"(?:Creator|SocialAccount|PortfolioVersion|MetricsSnapshot)"[\s\S]*\bFOR\s+(?:SHARE|UPDATE)\b/i.test(sql)) locks.push({ kind: "domain", sql, users: [] });
      const result = await query(args);
      if (sql.includes('"SocialAccount"')) { ids(result, accountIds); rawAccounts(result); }
      if (sql.includes('"User"')) ids(result, userIds);
      if (sql.includes('"PortfolioVersion"')) portfolios.push(result);
      if (sql.includes('"MetricsSnapshot"')) snapshots.push(result);
      return result;
    },
  } }) as unknown as PrismaClient;
  return { client, locks, accountRows, accountIds, userIds, portfolios, snapshots, unneededCollections };
}

describe("bounded public discovery identity: native synthetic D057", () => {
  it("rejects a batch with13 unique candidate IDs before widening the declared12-creator scope", async () => {
    const ids = Array.from({ length: 13 }, () => key());
    await expect(prisma.$transaction(tx => loadPublicCreatorIdentities(tx, ids, new Date(), createEvidenceReceiptReader()))).rejects.toThrow();
  });

  it("returns only the strict public identity with original approved biography and unknown followers", async () => {
    const f = await fixture(), legacy = await publicCreator(f.creator.handle);
    expect(legacy).not.toBeNull();
    const cards = await load([f]);
    expect(cards).toEqual([{ id: f.creator.id, handle: f.creator.handle, displayName: f.creator.displayName, bio: content.bio,
      residenceCountryCode: "KW", languages: ["ar", "en"], nicheSlugs: ["tech"], accounts: [{ platform: "INSTAGRAM", handle: f.primary.account.handle, ownership: "VERIFIED", followersObservation: null }] }]);
    expect(PublicDiscoveryCreatorSchema.safeParse(cards[0]).success).toBe(true);
    const serialized = JSON.stringify(cards);
    for (const privateValue of [f.owner.id, f.owner.email, f.owner.name, f.admin.id, f.primary.account.id, f.primary.account.providerAccountId!, f.primary.proof!.proofId, f.primary.proof!.challengeId, f.portfolio.id]) expect(serialized).not.toContain(privateValue);
    for (const privateKey of ["userId", "email", "providerAccountId", "snapshotId", "accountId", "reviewedBy", "payloadHash", "storageKey", "portfolio", "rates", "work", "score"]) expect(serialized).not.toContain(`"${privateKey}"`);
  });

  it.each([["0", null], ["999", null], ["1000", "NANO"], ["9999", "NANO"], ["10000", "MICRO"], ["99999", "MICRO"], ["100000", "MID"], ["499999", "MID"], ["500000", "MACRO"], ["999999", "MACRO"], ["1000000", "MEGA"], ["9007199254740991", "MEGA"]] as const)("exposes exact dated %s followers with v2 band %s", async (followers, band) => {
    const f = await fixture(), metrics = await f.screenshot(followers);
    expect(accountOf((await load([f]))[0], f.primary.account)?.followersObservation).toEqual(observation(followers, metrics.child.observedAt, band));
  });

  it("uses inclusive90-day freshness and preserves unknown one millisecond later", async () => {
    const f = await fixture(), at = new Date(f.now.getTime() - DISCOVERY_FRESHNESS_MS), metrics = await f.screenshot("10000", { observedAt: at });
    expect(accountOf((await load([f], { now: f.now }))[0], f.primary.account)?.followersObservation).toEqual(observation("10000", metrics.child.observedAt, "MICRO"));
    expect(accountOf((await load([f], { now: new Date(f.now.getTime() + 1) }))[0], f.primary.account)?.followersObservation).toBeNull();
  });

  it.each(["no consent", "BRAND_ONLY", "PRIVATE", "deleted proof", "corrupt receipt", "inactive metrics reviewer"] as const)("keeps valid identity but unknown followers for %s", async failure => {
    const f = await fixture(), metrics = await f.screenshot("10000", { visibility: failure === "no consent" ? null : failure === "BRAND_ONLY" ? "BRAND_ONLY" : failure === "PRIVATE" ? "PRIVATE" : "PUBLIC" });
    if (failure === "deleted proof") await prisma.privateAsset.update({ where: { id: metrics.assetId }, data: { deletedAt: f.now } });
    if (failure === "corrupt receipt") await prisma.evidenceCommand.updateMany({ where: { resourceType: "MetricsSnapshot", resourceId: metrics.child.id, actorUserId: f.metricAdmin.id }, data: { payloadHash: "0".repeat(64) } });
    if (failure === "inactive metrics reviewer") await prisma.user.update({ where: { id: f.metricAdmin.id }, data: { active: false } });
    const card = (await load([f]))[0];
    expect(card?.id).toBe(f.creator.id); expect(accountOf(card, f.primary.account)?.followersObservation).toBeNull();
  });

  it.each(["pending", "unsupported", "future", "null"] as const)("never falls back past the newest chosen %s observation", async failure => {
    const f = await fixture(); await f.screenshot("10000");
    if (failure === "null") await f.screenshot(null, { observedAt: new Date(f.base.getTime() - 500) });
    else await rawSnapshot(f, { source: failure === "unsupported" ? "API" : "SELF_REPORTED", reviewStatus: failure === "unsupported" ? "VERIFIED" : "PENDING",
      observedAt: failure === "future" ? new Date(f.now.getTime() + 1) : new Date(f.base.getTime() - 500) });
    expect(accountOf((await load([f], { now: f.now }))[0], f.primary.account)?.followersObservation).toBeNull();
  });

  it("honors newest imported time and ascending ID tie-breaks without eligibility filtering", async () => {
    const f = await fixture(), at = new Date(f.base.getTime() - 1000);
    await f.screenshot("10000", { observedAt: at });
    const newer = await f.screenshot("20000", { observedAt: at });
    expect(accountOf((await load([f]))[0], f.primary.account)?.followersObservation).toEqual(observation("20000", newer.child.observedAt, "MICRO"));
    const tie = await rawSnapshot(f, { id: "a-tie-" + key(), source: "SELF_REPORTED", observedAt: at, importedAt: newer.child.importedAt });
    expect(tie.id < newer.child.id).toBe(true);
    expect(accountOf((await load([f]))[0], f.primary.account)?.followersObservation).toBeNull();
  });

  it("excludes other mappings and excluded rows before choosing but does not look through valid-current pending history", async () => {
    const f = await fixture(), metrics = await f.screenshot("10000");
    await rawSnapshot(f, { mappingRevision: f.primary.account.mappingRevision + 1, observedAt: new Date(f.base.getTime() + 100) });
    await rawSnapshot(f, { excludedAt: f.base, observedAt: new Date(f.base.getTime() + 200) });
    expect(accountOf((await load([f]))[0], f.primary.account)?.followersObservation).toEqual(observation("10000", metrics.child.observedAt, "MICRO"));
  });

  it("requires consent on the chosen newer screenshot even when account-wide PUBLIC came from an older one", async () => {
    const f = await fixture(); await f.screenshot("10000");
    await f.screenshot("20000", { observedAt: new Date(f.base.getTime() - 500), visibility: "PRIVATE" });
    // A complete later approval of only unrelated averageViews is unavailable
    // here; restore the current account ceiling as adversarial metadata while
    // preserving the actual chosen PRIVATE command receipt.
    await prisma.socialAccount.update({ where: { id: f.primary.account.id }, data: { fieldVisibility: { followers: "PUBLIC" } } });
    expect(accountOf((await load([f]))[0], f.primary.account)?.followersObservation).toBeNull();
  });

  it("reuses publication core for private primary and failed secondaries without exposing private account identity", async () => {
    const f = await fixture(); await prisma.socialAccount.update({ where: { id: f.primary.account.id }, data: { publicVisible: false } });
    const secondary = await f.account("TIKTOK", true), failed = await f.account("X", true, false);
    await f.screenshot("10000", { accountId: secondary.account.id });
    const card = (await load([f]))[0];
    expect(card?.accounts.map(account => account.handle)).toEqual([secondary.account.handle]);
    expect(JSON.stringify(card)).not.toContain(f.primary.account.handle); expect(JSON.stringify(card)).not.toContain(failed.account.handle);
    await prisma.privateAsset.update({ where: { id: f.primary.proof!.proofId }, data: { deletedAt: f.now } });
    expect(await load([f])).toEqual([]);
  });

  it.each(["test creator", "inactive owner", "hidden", "latest unapproved portfolio"] as const)("shares the core %s visibility gate", async failure => {
    const f = await fixture();
    if (failure === "test creator") await prisma.creator.update({ where: { id: f.creator.id }, data: { isTest: true } });
    if (failure === "inactive owner") await prisma.user.update({ where: { id: f.owner.id }, data: { active: false } });
    if (failure === "hidden") await prisma.creator.update({ where: { id: f.creator.id }, data: { state: "HIDDEN" } });
    if (failure === "latest unapproved portfolio") await prisma.portfolioVersion.create({ data: { creatorId: f.creator.id, version: 2, inputRevision: 1, content, approvedAt: null } });
    expect(await publicCreator(f.creator.handle)).toBeNull(); expect(await load([f])).toEqual([]);
  });

  it("maps an unknown residence to null without guessing audience or campaign market", async () => {
    const f = await fixture(); await prisma.creator.update({ where: { id: f.creator.id }, data: { countryCode: "ZZ" } });
    expect((await load([f]))[0]?.residenceCountryCode).toBeNull();
  });

  it("caps public selection at100 plus a separately scoped private primary and never hydrates unrelated private/history rows", async () => {
    const f = await fixture(); await prisma.socialAccount.update({ where: { id: f.primary.account.id }, data: { publicVisible: false } });
    const secondary = await f.account("TIKTOK", true), historyReviewer = await actor("ADMIN", f.base);
    const privateIds = Array.from({ length: 150 }, () => key()), publicIds = Array.from({ length: 99 }, () => key());
    await prisma.socialAccount.createMany({ data: [...privateIds.map(id => ({ id, creatorId: f.creator.id, platform: "X" as const, handle: "priv_" + id.replace(/-/g, "").slice(0, 12), publicVisible: false, ownershipReviewedBy: historyReviewer.id })),
      ...publicIds.map(id => ({ id, creatorId: f.creator.id, platform: "X" as const, handle: "pub_" + id.replace(/-/g, "").slice(0, 12), publicVisible: true }))] });
    const historicalIds: string[] = [];
    for (let version = 2; version <= 15; version++) {
      const row = await prisma.portfolioVersion.create({ data: { creatorId: f.creator.id, version, inputRevision: 1, approvedAt: f.base, content: { ...content, bio: version === 15 ? content.bio : "SYNTHETIC_PRIVATE_OLD_PORTFOLIO" } } });
      if (version !== 15) historicalIds.push(row.id);
    }
    await f.screenshot("10000", { accountId: secondary.account.id });
    await rawSnapshot(f, { accountId: secondary.account.id, observedAt: new Date(f.base.getTime() - DISCOVERY_FRESHNESS_MS), approvedBy: historyReviewer.id });
    const observed = observedClient();
    const card = (await load([f], { client: observed.client }))[0];
    expect(card?.accounts.map(account => account.handle)).toEqual([secondary.account.handle]);
    expect(new Set(observed.accountRows.filter(row => row.publicVisible).map(row => row.id)).size).toBeLessThanOrEqual(100);
    for (const id of privateIds) expect(observed.accountIds).not.toContain(id);
    for (const id of historicalIds) expect(JSON.stringify(observed.portfolios)).not.toContain(id);
    expect(JSON.stringify(observed.portfolios)).not.toContain("SYNTHETIC_PRIVATE_OLD_PORTFOLIO");
    expect(observed.userIds).not.toContain(historyReviewer.id);
    expect(observed.unneededCollections).toEqual([]);
    expect(observed.locks.filter(event => event.kind === "user").flatMap(event => event.users)).not.toContain(historyReviewer.id);
    await prisma.socialAccount.create({ data: { creatorId: f.creator.id, platform: "X", handle: "overflow_" + key().replace(/-/g, "").slice(0, 12), publicVisible: true } });
    const overflow = observedClient();
    await expect(load([f], { client: overflow.client })).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
    expect(new Set(overflow.accountRows.filter(row => row.publicVisible).map(row => row.id)).size).toBeLessThanOrEqual(100);
  });

  it("locks every batch owner before a shared reviewer and never takes a User lock after domains", async () => {
    const first = await fixture(), second = await fixture(first.admin), observed = observedClient();
    const owners = [first.owner.id, second.owner.id].sort(), held = await holdRow("User", owners[1]!);
    const reading = observed.client.$transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
      held.backend.resolve(rows[0]!.pid);
      return loadPublicCreatorIdentities(tx, [second.creator.id, first.creator.id], new Date(), createEvidenceReceiptReader());
    }, { maxWait: 5000, timeout: 10000 });
    void reading.catch(() => {});
    let cards: PublicDiscoveryCreator[] | undefined;
    try {
      const pid = await Promise.race([held.backend.promise, reading.then(() => { throw new Error("Synthetic batch completed before PID publication"); })]);
      await Promise.race([held.wait(pid, "User"), reading.then(() => { throw new Error("Synthetic batch completed before actual second-owner lock waiting"); })]);
      expect(observed.locks.filter(event => event.kind === "user").flatMap(event => event.users)).not.toContain(first.admin.id);
      held.release(); cards = await reading;
    } finally { await held.close(); await reading.catch(() => {}); }
    if (!cards) throw new Error("Synthetic batch did not return its native identity projection");
    expect(cards.map(card => card.id).sort()).toEqual([first.creator.id, second.creator.id].sort());
    const allUsers = observed.locks.filter(event => event.kind === "user");
    const reviewerIndex = allUsers.findIndex(event => event.users.includes(first.admin.id));
    expect(reviewerIndex).toBeGreaterThanOrEqual(0);
    expect([...new Set(allUsers.slice(0, reviewerIndex).flatMap(event => event.users).filter(id => owners.includes(id)))].sort()).toEqual(owners);
    const firstDomain = observed.locks.findIndex(event => event.kind === "domain");
    expect(firstDomain).toBeGreaterThanOrEqual(0);
    expect(observed.locks.slice(firstDomain).some(event => event.kind === "user")).toBe(false);
  });

  it("shares receipt exhaustion across the whole batch instead of returning an earlier identity", async () => {
    const first = await fixture(), second = await fixture(first.admin);
    // Same-clock ownership fixtures cost6 per ownership acceptance, and the
    // public primary receives the existing primary+public checks:12/card.
    expect(await load([first, second], { reader: createEvidenceReceiptReader({ maxRows: 24 }) })).toHaveLength(2);
    await expect(load([first, second], { reader: createEvidenceReceiptReader({ maxRows: 23 }) })).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
  });

  it.each(["owner", "reviewer", "account identity", "chosen observation"] as const)("rejects actual native %s preflight drift without late User locks", async change => {
    const f = await fixture(), metrics = await f.screenshot("10000"), replacement = await actor(change === "owner" ? "CREATOR" : "ADMIN", f.base);
    const observed = observedClient();
    const table = change === "owner" ? "Creator" : change === "chosen observation" ? "MetricsSnapshot" : "SocialAccount";
    const id = table === "Creator" ? f.creator.id : table === "MetricsSnapshot" ? metrics.child.id : f.primary.account.id;
    const held = await holdRow(table, id, async tx => {
      if (change === "owner") await tx.creator.update({ where: { id: f.creator.id }, data: { userId: replacement.id } });
      if (change === "reviewer") await tx.socialAccount.update({ where: { id: f.primary.account.id }, data: { ownershipReviewedBy: replacement.id } });
      if (change === "account identity") await tx.socialAccount.update({ where: { id: f.primary.account.id }, data: { handle: "drift_" + key().replace(/-/g, "").slice(0, 12), mappingRevision: { increment: 1 }, evidenceRevision: { increment: 1 } } });
      if (change === "chosen observation") await tx.metricsSnapshot.create({ data: { accountId: f.primary.account.id, mappingRevision: metrics.child.mappingRevision,
        source: "SELF_REPORTED", observedAt: new Date(metrics.child.observedAt.getTime() + 1), importedAt: f.base, followers: BigInt(99999), reviewStatus: "PENDING", approvedBy: replacement.id } });
    });
    const reading = observed.client.$transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
      held.backend.resolve(rows[0]!.pid);
      return loadPublicCreatorIdentities(tx, [f.creator.id], f.now, createEvidenceReceiptReader());
    }, { maxWait: 5000, timeout: 10000 });
    void reading.catch(() => {});
    try {
      const pid = await Promise.race([held.backend.promise, reading.then(() => { throw new Error("Synthetic drift projection completed before PID publication"); })]);
      await Promise.race([held.wait(pid, table), reading.then(() => { throw new Error("Synthetic drift projection completed before actual native lock waiting"); })]);
      held.release();
      await expect(reading).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
      expect(observed.locks.filter(event => event.kind === "user").flatMap(event => event.users)).not.toContain(replacement.id);
    } finally { await held.close(); await reading.catch(() => {}); }
  });

  it("expires on an actual owner lock wait before hydrating domain selections", async () => {
    const f = await fixture(), observed = observedClient(), held = await holdRow("User", f.owner.id);
    let started = 0;
    const reading = observed.client.$transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
      held.backend.resolve(rows[0]!.pid); started = performance.now();
      return loadPublicCreatorIdentities(tx, [f.creator.id], f.now, createEvidenceReceiptReader({ maxElapsedMs: 300 }));
    }, { maxWait: 5000, timeout: 5000 });
    void reading.catch(() => {});
    try {
      const pid = await Promise.race([held.backend.promise, reading.then(() => { throw new Error("Synthetic deadline projection completed before PID publication"); })]);
      await Promise.race([held.wait(pid, "User"), reading.then(() => { throw new Error("Synthetic deadline projection completed before owner lock waiting"); })]);
      await delay(Math.max(0, started + 350 - performance.now()));
      held.release(); await expect(reading).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
      expect(observed.locks.some(event => event.kind === "domain")).toBe(false);
    } finally { await held.close(); await reading.catch(() => {}); }
  });
});

function latch<T>() { let resolve!: (value: T | PromiseLike<T>) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
type HeldTable = "User" | "Creator" | "SocialAccount" | "MetricsSnapshot";
async function holdRow(table: HeldTable, id: string, mutation?: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  const peer = new PrismaClient(), monitor = new PrismaClient(), ready = latch<void>(), released = latch<void>(), backend = latch<number>(), stop = new AbortController();
  const holding = peer.$transaction(async tx => {
    if (table === "User") await tx.$queryRaw`SELECT id FROM "User" WHERE id=${id} FOR UPDATE`;
    else if (table === "Creator") await tx.$queryRaw`SELECT id FROM "Creator" WHERE id=${id} FOR UPDATE`;
    else if (table === "SocialAccount") await tx.$queryRaw`SELECT id FROM "SocialAccount" WHERE id=${id} FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM "MetricsSnapshot" WHERE id=${id} FOR UPDATE`;
    ready.resolve(); await released.promise; if (mutation) await mutation(tx);
  }, { maxWait: 5000, timeout: 12000 });
  void holding.catch(() => {});
  await Promise.race([ready.promise, holding.then(() => { throw new Error("Synthetic holder completed before lock publication"); })]);
  let polling: Promise<void> | undefined;
  return { backend, release: () => released.resolve(), wait(pid: number, expected: HeldTable) {
    polling = (async () => {
      const deadline = performance.now() + 4000;
      while (performance.now() < deadline) {
        if (stop.signal.aborted) throw new Error("Synthetic native lock witness cancelled");
        const rows = await monitor.$queryRaw<Array<{ waiting: boolean }>>`SELECT (wait_event_type='Lock' AND query LIKE ${`%"${expected}"%`}) AS waiting FROM pg_stat_activity WHERE pid=${pid}`;
        if (rows[0]?.waiting) return;
        await delay(20);
      }
      throw new Error("Synthetic discovery projection never reached its actual native lock wait");
    })();
    return polling;
  }, async close() { released.resolve(); stop.abort(); await holding.catch(() => {}); await polling?.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); } };
}
