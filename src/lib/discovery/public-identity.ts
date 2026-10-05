import { Prisma, type MetricsSnapshot } from "@prisma/client";
import { bandForFollowers, REACH_TAXONOMY_VERSION } from "@/lib/commercial/contracts";
import { CountryCodeSchema } from "@/lib/contracts/vocabulary";
import { acceptedSnapshotFieldConsent } from "@/lib/evidence/metrics-consent";
import { acceptedScreenshotProof } from "@/lib/evidence/metrics-readiness";
import { lockEvidenceDomain, type EvidenceActorLocks } from "@/lib/evidence/readiness";
import type { EvidenceReceiptReader } from "@/lib/evidence/receipt-reader";
import { creatorPublicationCore } from "@/lib/onboarding/public-creator-core";
import { DISCOVERY_FRESHNESS_MS, DISCOVERY_LIMITS, DiscoveryError, PublicDiscoveryCreatorSchema,
  type PublicDiscoveryAccount, type PublicDiscoveryCreator } from "./contracts";
import { capturePublicCreatorIdentities, lockPublicIdentityUsers, publicIdentityActors,
  publicIdentityAccountReferences, publicIdentityRead, publicIdentityChoiceOrder as choiceOrder,
  publicIdentityAccountFingerprint as accountFingerprint, publicIdentityObservationFingerprint as choiceFingerprint,
  type PublicIdentityCapture } from "./public-identity-capture";

const retry = (): never => { throw new DiscoveryError("RETRY_REQUIRED"); };

export async function loadPublicCreatorIdentities(
  tx: Prisma.TransactionClient, creatorIds: readonly string[], now: Date, reader: EvidenceReceiptReader,
): Promise<PublicDiscoveryCreator[]> {
  reader.checkpoint();
  try {
    const capture = await capturePublicCreatorIdentities(tx, creatorIds, now, reader);
    const actors = await lockPublicIdentityUsers(tx, capture, reader);
    return await projectPublicCreatorIdentities(tx, capture, actors, reader);
  } finally { reader.checkpoint(); }
}

export async function projectPublicCreatorIdentities(
  tx: Prisma.TransactionClient, capture: PublicIdentityCapture,
  actors: EvidenceActorLocks, reader: EvidenceReceiptReader,
): Promise<PublicDiscoveryCreator[]> {
  reader.checkpoint();
  try {
    const expected = publicIdentityActors(capture);
    if (typeof actors?.ownerIds?.has !== "function" || typeof actors?.reviewerIds?.has !== "function"
      || typeof actors?.creatorOwners?.has !== "function" || typeof actors?.creatorOwners?.get !== "function") return retry();
    // A trusted outer bridge may supply additional actors; captured scope must
    // still be present with the exact creator-owner mappings.
    for (const owner of expected.ownerIds) {
      reader.checkpoint();
      if (!actors.ownerIds.has(owner)) retry();
    }
    for (const reviewer of expected.reviewerIds) {
      reader.checkpoint();
      if (!actors.reviewerIds.has(reviewer)) retry();
    }
    for (const [id, owner] of expected.creatorOwners) {
      reader.checkpoint();
      if (!actors.creatorOwners.has(id) || actors.creatorOwners.get(id) !== owner) retry();
    }
    const captures = capture.records, now = new Date(capture.asOf);
    if (!captures.length) return [];
    const checked = <T>(query: () => Promise<T>) => publicIdentityRead(reader, query);
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
      const current = await publicIdentityAccountReferences(tx, capture.creator, reader);
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
