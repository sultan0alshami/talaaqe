import { Prisma, type Creator, type MetricsSnapshot } from "@prisma/client";
import { bandForFollowers, REACH_TAXONOMY_VERSION } from "@/lib/commercial/contracts";
import { CountryCodeSchema } from "@/lib/contracts/vocabulary";
import { acceptedSnapshotFieldConsent } from "@/lib/evidence/metrics-consent";
import { acceptedScreenshotProof } from "@/lib/evidence/metrics-readiness";
import { lockEvidenceDomain, type EvidenceActorLocks } from "@/lib/evidence/readiness";
import type { EvidenceReceiptReader } from "@/lib/evidence/receipt-reader";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { creatorPublicationCore } from "@/lib/onboarding/public-creator-core";
import { DISCOVERY_FRESHNESS_MS, DISCOVERY_LIMITS, DiscoveryError, PublicDiscoveryCreatorSchema,
  type PublicDiscoveryAccount, type PublicDiscoveryCreator } from "./contracts";

const accountSelect = {
  id: true, creatorId: true, platform: true, handle: true, providerAccountId: true,
  publicVisible: true, mappingRevision: true, evidenceRevision: true, ownershipReviewedBy: true,
} as const;
const choiceSelect = {
  id: true, accountId: true, mappingRevision: true, source: true, reviewStatus: true,
  observedAt: true, importedAt: true, approvedAt: true, approvedBy: true, excludedAt: true, supersedesId: true,
} as const;
const choiceOrder = [{ observedAt: "desc" }, { importedAt: "desc" }, { id: "asc" }] as const;
type CreatorRef = Pick<Creator, "id" | "userId" | "primaryAccountId">;
type AccountRef = Prisma.SocialAccountGetPayload<{ select: typeof accountSelect }>;
type Choice = Prisma.MetricsSnapshotGetPayload<{ select: typeof choiceSelect }>;
type Capture = { creator: CreatorRef; accounts: AccountRef[]; choices: Map<string, Choice | null> };
const retry = (): never => { throw new DiscoveryError("RETRY_REQUIRED"); };

function accountFingerprint(account: AccountRef): string {
  return canonicalHash({ id: account.id, creatorId: account.creatorId, platform: account.platform,
    handle: account.handle, providerAccountId: account.providerAccountId, publicVisible: account.publicVisible,
    mappingRevision: account.mappingRevision, evidenceRevision: account.evidenceRevision, ownershipReviewedBy: account.ownershipReviewedBy });
}
function choiceFingerprint(choice: Choice | null): string | null {
  return choice ? canonicalHash({ id: choice.id, accountId: choice.accountId, mappingRevision: choice.mappingRevision,
    source: choice.source, reviewStatus: choice.reviewStatus, observedAt: choice.observedAt.toISOString(),
    importedAt: choice.importedAt.toISOString(), approvedAt: choice.approvedAt?.toISOString() ?? null,
    approvedBy: choice.approvedBy, excludedAt: choice.excludedAt?.toISOString() ?? null, supersedesId: choice.supersedesId }) : null;
}

export async function loadPublicCreatorIdentities(
  tx: Prisma.TransactionClient, creatorIds: readonly string[], now: Date, reader: EvidenceReceiptReader,
): Promise<PublicDiscoveryCreator[]> {
  reader.checkpoint();
  try {
    if (!Array.isArray(creatorIds) || creatorIds.length > DISCOVERY_LIMITS.creators
      || creatorIds.some(id => typeof id !== "string" || !id.length || id.length > 200)
      || new Set(creatorIds).size !== creatorIds.length || !Number.isFinite(now.getTime())) retry();
    const ids = [...creatorIds];
    if (!ids.length) return [];
    async function checked<T>(query: () => Promise<T>): Promise<T> {
      reader.checkpoint();
      const value = await query();
      reader.checkpoint();
      return value;
    }
    async function accountsFor(creator: CreatorRef): Promise<AccountRef[]> {
      const publicAccounts = await checked(() => tx.socialAccount.findMany({
        where: { creatorId: creator.id, publicVisible: true }, select: accountSelect,
        orderBy: { id: "asc" }, take: DISCOVERY_LIMITS.publicAccounts,
      }));
      if (publicAccounts.length === DISCOVERY_LIMITS.publicAccounts) {
        const tail = publicAccounts[publicAccounts.length - 1]!.id;
        const more = await checked(() => tx.$queryRaw<Array<{ exists: boolean }>>`SELECT EXISTS (
          SELECT 1 FROM "SocialAccount" WHERE "creatorId"=${creator.id} AND "publicVisible"=true AND id>${tail}
        ) AS "exists"`);
        if (more.length !== 1 || typeof more[0]?.exists !== "boolean" || more[0].exists) retry();
      }
      if (creator.primaryAccountId && !publicAccounts.some(account => account.id === creator.primaryAccountId)) {
        const primary = await checked(() => tx.socialAccount.findUnique({
          where: { id: creator.primaryAccountId!, creatorId: creator.id }, select: accountSelect,
        }));
        if (primary?.publicVisible) retry();
        if (primary) publicAccounts.push(primary);
      }
      return publicAccounts;
    }

    const references = await checked(() => tx.creator.findMany({ where: { id: { in: ids } },
      select: { id: true, userId: true, primaryAccountId: true }, take: DISCOVERY_LIMITS.creators }));
    const byId = new Map(references.map(creator => [creator.id, creator]));
    const captures: Capture[] = [];
    const ownerIds = new Set<string>(), reviewerIds = new Set<string>();
    for (const id of ids) {
      reader.checkpoint();
      const creator = byId.get(id);
      if (!creator) continue;
      if (creator.userId) ownerIds.add(creator.userId);
      const accounts = await accountsFor(creator), choices = new Map<string, Choice | null>();
      for (const account of accounts) {
        reader.checkpoint();
        if (account.ownershipReviewedBy) reviewerIds.add(account.ownershipReviewedBy);
        if (!account.publicVisible) continue;
        const choice = await checked(() => tx.metricsSnapshot.findFirst({
          where: { accountId: account.id, mappingRevision: account.mappingRevision, excludedAt: null },
          orderBy: [...choiceOrder], select: choiceSelect,
        }));
        choices.set(account.id, choice);
        if (choice?.approvedBy) reviewerIds.add(choice.approvedBy);
      }
      captures.push({ creator, accounts, choices });
    }
    if (!captures.length) return [];
    for (const owner of ownerIds) reviewerIds.delete(owner);
    if (ownerIds.size > DISCOVERY_LIMITS.ownerUsers || reviewerIds.size > DISCOVERY_LIMITS.reviewerUsers) retry();
    // Finish the entire batch's User locking before taking any domain lock.
    const owners = [...ownerIds].sort(), reviewers = [...reviewerIds].sort();
    if (owners.length) await checked(() => tx.$queryRaw(Prisma.sql`SELECT id FROM "User"
      WHERE id IN (${Prisma.join(owners)}) ORDER BY id FOR SHARE`));
    if (reviewers.length) await checked(() => tx.$queryRaw(Prisma.sql`SELECT id FROM "User"
      WHERE id IN (${Prisma.join(reviewers)}) ORDER BY id FOR SHARE`));
    const actors: EvidenceActorLocks = { ownerIds, reviewerIds,
      creatorOwners: new Map(captures.map(capture => [capture.creator.id, capture.creator.userId])), brandOwners: new Map() };
    const selectedCreatorIds = captures.map(capture => capture.creator.id);
    await checked(() => lockEvidenceDomain(tx, "Creator", selectedCreatorIds));
    const creators = await checked(() => tx.creator.findMany({ where: { id: { in: selectedCreatorIds } },
      include: { user: { select: { active: true, role: true, isTest: true, emailVerifiedAt: true } } }, take: DISCOVERY_LIMITS.creators }));
    const currentCreators = new Map(creators.map(creator => [creator.id, creator]));
    for (const capture of captures) {
      reader.checkpoint();
      const current = currentCreators.get(capture.creator.id);
      if (!current || current.userId !== capture.creator.userId || current.primaryAccountId !== capture.creator.primaryAccountId) retry();
    }

    const selectedAccountIds = captures.flatMap(capture => capture.accounts.map(account => account.id));
    await checked(() => lockEvidenceDomain(tx, "SocialAccount", selectedAccountIds));
    for (const capture of captures) {
      reader.checkpoint();
      const current = await accountsFor(capture.creator);
      if (current.length !== capture.accounts.length) retry();
      for (let index = 0; index < current.length; index++) {
        reader.checkpoint();
        if (accountFingerprint(current[index]!) !== accountFingerprint(capture.accounts[index]!)) retry();
      }
    }
    const accountModels = selectedAccountIds.length ? await checked(() => tx.socialAccount.findMany({
      where: { id: { in: selectedAccountIds }, creatorId: { in: selectedCreatorIds } }, orderBy: { id: "asc" },
      take: selectedAccountIds.length,
    })) : [];
    const currentAccounts = new Map(accountModels.map(account => [account.id, account]));
    for (const capture of captures) for (const reference of capture.accounts) {
      reader.checkpoint();
      const current = currentAccounts.get(reference.id);
      if (!current || accountFingerprint(current) !== accountFingerprint(reference)) retry();
    }

    const portfolioRefs = new Map<string, { id: string; version: number } | null>();
    for (const capture of captures) {
      portfolioRefs.set(capture.creator.id, await checked(() => tx.portfolioVersion.findFirst({
        where: { creatorId: capture.creator.id }, orderBy: { version: "desc" }, select: { id: true, version: true },
      })));
    }
    const portfolioIds = [...portfolioRefs.values()].flatMap(value => value ? [value.id] : []).sort();
    if (portfolioIds.length) await checked(() => tx.$queryRaw(Prisma.sql`SELECT id FROM "PortfolioVersion"
      WHERE id IN (${Prisma.join(portfolioIds)}) ORDER BY id FOR SHARE`));
    const snapshotIds = [...new Set(captures.flatMap(capture => [...capture.choices.values()].flatMap(choice => choice ? [choice.id] : [])))].sort();
    if (snapshotIds.length) await checked(() => tx.$queryRaw(Prisma.sql`SELECT id FROM "MetricsSnapshot"
      WHERE id IN (${Prisma.join(snapshotIds)}) ORDER BY id FOR SHARE`));

    const currentChoices = new Map<string, MetricsSnapshot | null>();
    for (const capture of captures) for (const reference of capture.accounts) {
      reader.checkpoint();
      if (!reference.publicVisible) continue;
      const current = await checked(() => tx.metricsSnapshot.findFirst({
        where: { accountId: reference.id, mappingRevision: reference.mappingRevision, excludedAt: null },
        orderBy: [...choiceOrder],
      }));
      if (choiceFingerprint(current) !== choiceFingerprint(capture.choices.get(reference.id) ?? null)) retry();
      currentChoices.set(reference.id, current);
    }

    const result: PublicDiscoveryCreator[] = [];
    for (const capture of captures) {
      reader.checkpoint();
      const creator = currentCreators.get(capture.creator.id)!;
      const selectedPortfolio = portfolioRefs.get(creator.id) ?? null;
      const latest = await checked(() => tx.portfolioVersion.findFirst({ where: { creatorId: creator.id },
        orderBy: { version: "desc" }, select: { id: true, version: true } }));
      if (latest?.id !== selectedPortfolio?.id || latest?.version !== selectedPortfolio?.version) retry();
      const portfolio = latest ? await checked(() => tx.portfolioVersion.findUnique({ where: { id: latest.id, creatorId: creator.id },
        select: { content: true, approvedAt: true } })) : null;
      const accounts = capture.accounts.map(account => currentAccounts.get(account.id)!);
      const publication = await checked(() => creatorPublicationCore(tx, {
        initialId: creator.id, creator, accounts, portfolio, actors, now, reader,
      }));
      if (!publication) continue;
      const publicAccounts: PublicDiscoveryAccount[] = [];
      for (const account of publication.accounts) {
        reader.checkpoint();
        const choice = currentChoices.get(account.id) ?? null;
        let followersObservation: PublicDiscoveryAccount["followersObservation"] = null;
        if (choice?.source === "SCREENSHOT_VERIFIED" && choice.followers !== null && choice.followers >= BigInt(0)
          && choice.observedAt <= now && now.getTime() - choice.observedAt.getTime() <= DISCOVERY_FRESHNESS_MS
          && await checked(() => acceptedScreenshotProof(tx, account, choice, creator.userId!, now, actors, reader))
          && await checked(() => acceptedSnapshotFieldConsent(tx, account, choice, creator.userId!, "followers", now, "PUBLIC", actors, reader))) {
          followersObservation = { followers: choice.followers.toString(), source: "SCREENSHOT_VERIFIED",
            observedAt: choice.observedAt.toISOString(), taxonomyVersion: REACH_TAXONOMY_VERSION, band: bandForFollowers(choice.followers) };
        }
        publicAccounts.push({ platform: account.platform, handle: account.handle, ownership: "VERIFIED", followersObservation });
      }
      const country = CountryCodeSchema.safeParse(creator.countryCode);
      const parsed = PublicDiscoveryCreatorSchema.safeParse({ id: creator.id, handle: creator.handle,
        displayName: creator.displayName, bio: publication.portfolio.bio, residenceCountryCode: country.success ? country.data : null,
        languages: creator.languages, nicheSlugs: creator.nicheIds, accounts: publicAccounts });
      reader.checkpoint();
      if (!parsed.success) return retry();
      result.push(parsed.data);
    }
    return result;
  } finally { reader.checkpoint(); }
}
