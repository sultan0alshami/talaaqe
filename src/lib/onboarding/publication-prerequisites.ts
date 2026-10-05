import type { Brand, Creator, Prisma } from "@prisma/client";
import { CurrencyCodeSchema } from "@/lib/contracts/money";
import { acceptedOwnershipProof, acceptedRepresentativeProof, ownershipProofAccountSelect, type EvidenceActorLocks } from "@/lib/evidence/readiness";
import type { EvidenceReceiptReader } from "@/lib/evidence/receipt-reader";
import { PortfolioContentSchema, type PortfolioContent } from "./portfolio-contract";
import { canonicalHash, OnboardingError, record, type DraftState } from "./drafts";

export type PublicationPortfolio = { version: number; content: PortfolioContent; approvedAt: string | null; inputRevision: number };
export type PublishCreator = Pick<Creator, "id" | "userId" | "primaryAccountId" | "countryCode" | "timeZone" | "languages" | "nicheIds" | "currency" | "profileFacts">;
export type PublishBrand = Pick<Brand, "id" | "userId" | "countryCode" | "timeZone" | "profileFacts">;
export type PublishProfile = { role: "CREATOR"; creator: PublishCreator } | { role: "BRAND"; brand: PublishBrand };
export type PublicationPayload = { consent: boolean; portfolioVersion: number; visibleAccountIds?: string[] };
export type PublicationPrerequisiteInput = {
  actorUserId: string; profile: PublishProfile; state: Pick<DraftState, "sources" | "generatedSectionsStale">;
  payload: PublicationPayload; actors: EvidenceActorLocks; now: Date; reader?: EvidenceReceiptReader;
};
export type PublicationSelectionInput = {
  actorUserId: string; creator: PublishCreator; visibleAccountIds?: string[];
  actors: EvidenceActorLocks; now: Date; reader?: EvidenceReceiptReader;
};
const past = (date: Date | null, now: Date) => date !== null && date <= now;
async function publicationRead<T>(reader: EvidenceReceiptReader | undefined, query: () => Promise<T>): Promise<T> {
  reader?.checkpoint();
  try { return await query(); } finally { reader?.checkpoint(); }
}
type PortfolioRecord = { version: number; content: Prisma.JsonValue; approvedAt: Date | null; inputRevision: number };
const portfolioSelect = { version: true, content: true, approvedAt: true, inputRevision: true } as const;
const publicationAccountSelect = { ...ownershipProofAccountSelect, intendedConfirmedAt: true, consentAt: true } as const;

// Callers own native authorization and the captured owner/reviewer/domain locks.
// These helpers only extract the existing publication reads and predicates.
export async function currentPublicationPortfolio(
  tx: Prisma.TransactionClient, role: "CREATOR" | "BRAND", profileId: string, reader?: EvidenceReceiptReader,
): Promise<PublicationPortfolio | null> {
  reader?.checkpoint();
  try {
    const portfolio = await publicationRead<PortfolioRecord | null>(reader, () => role === "CREATOR"
      ? reader
        ? tx.portfolioVersion.findFirst({ where: { creatorId: profileId }, orderBy: { version: "desc" }, select: portfolioSelect })
        : tx.portfolioVersion.findFirst({ where: { creatorId: profileId }, orderBy: { version: "desc" } })
      : reader
        ? tx.brandPortfolioVersion.findFirst({ where: { brandId: profileId }, orderBy: { version: "desc" }, select: portfolioSelect })
        : tx.brandPortfolioVersion.findFirst({ where: { brandId: profileId }, orderBy: { version: "desc" } }));
    if (!portfolio) return null;
    const parsed = PortfolioContentSchema.safeParse(portfolio.content);
    reader?.checkpoint();
    if (!parsed.success) return null;
    return { version: portfolio.version, content: parsed.data, approvedAt: portfolio.approvedAt?.toISOString() ?? null,
      inputRevision: portfolio.inputRevision };
  } finally { reader?.checkpoint(); }
}
export async function assertPublicationPrerequisites(
  tx: Prisma.TransactionClient, input: PublicationPrerequisiteInput,
): Promise<PublicationPortfolio> {
  const { actorUserId, profile, state, payload, actors, now, reader } = input;
  reader?.checkpoint();
  try {
    if (!payload.consent) throw new OnboardingError("PUBLICATION_CONSENT_REQUIRED", 400);
    const user = await publicationRead<{ emailVerifiedAt: Date | null }>(reader, () => reader
      ? tx.user.findUniqueOrThrow({ where: { id: actorUserId }, select: { emailVerifiedAt: true } })
      : tx.user.findUniqueOrThrow({ where: { id: actorUserId } }));
    if (!past(user.emailVerifiedAt, now)) throw new OnboardingError("EMAIL_VERIFICATION_REQUIRED");
    if (profile.role === "CREATOR") {
      const creator = profile.creator;
      const primary = creator.primaryAccountId
        ? await publicationRead(reader, () => reader
          ? tx.socialAccount.findUnique({ where: { id: creator.primaryAccountId!, creatorId: creator.id }, select: publicationAccountSelect })
          : tx.socialAccount.findUnique({ where: { id: creator.primaryAccountId! } })) : null;
      if (!primary || primary.creatorId !== creator.id || !past(primary.intendedConfirmedAt, now) || !past(primary.consentAt, now)
        || !await publicationRead(reader, () => acceptedOwnershipProof(tx, primary, actorUserId, now, actors, reader))) {
        throw new OnboardingError("PRIMARY_OWNERSHIP_REQUIRED");
      }
      reader?.checkpoint();
      if (!creator.countryCode || !creator.timeZone || !creator.languages.length || !creator.nicheIds.length || !creator.currency) {
        throw new OnboardingError("PROFILE_ESSENTIALS_REQUIRED");
      }
      if (record(creator.profileFacts).mappingHash !== canonicalHash(state.sources)) throw new OnboardingError("ACCOUNT_MAPPING_CHANGED");
      reader?.checkpoint();
    } else {
      const brand = profile.brand;
      const rows = await publicationRead(reader, () => tx.businessVerification.findMany({ where: {
        brandId: brand.id, kind: "REPRESENTATIVE", status: "VERIFIED", reviewedAt: { lte: now }, reviewedBy: { not: null },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      } }));
      let accepted = false;
      for (const row of rows) {
        reader?.checkpoint();
        if (await publicationRead(reader, () => acceptedRepresentativeProof(tx, brand, row, now, actors, reader))) {
          accepted = true; break;
        }
      }
      if (!accepted) throw new OnboardingError("REPRESENTATION_REQUIRED");
      const facts = record(brand.profileFacts);
      reader?.checkpoint();
      if (!brand.countryCode || !brand.timeZone || !Array.isArray(facts.languages) || !facts.languages.length
        || !Array.isArray(facts.targetMarkets) || !facts.targetMarkets.length
        || !CurrencyCodeSchema.safeParse(facts.preferredCurrency).success) throw new OnboardingError("PROFILE_ESSENTIALS_REQUIRED");
      reader?.checkpoint();
    }
    const profileId = profile.role === "CREATOR" ? profile.creator.id : profile.brand.id;
    const portfolio = await currentPublicationPortfolio(tx, profile.role, profileId, reader);
    if (!portfolio?.approvedAt || portfolio.version !== payload.portfolioVersion || state.generatedSectionsStale) {
      throw new OnboardingError("PORTFOLIO_APPROVAL_REQUIRED");
    }
    return portfolio;
  } finally { reader?.checkpoint(); }
}
export async function assertPublicationAccountSelection(
  tx: Prisma.TransactionClient, input: PublicationSelectionInput,
): Promise<string[]> {
  const { actorUserId, creator, visibleAccountIds, actors, now, reader } = input;
  reader?.checkpoint();
  try {
    const where = { creatorId: creator.id, ownershipStatus: "VERIFIED" as const, intendedConfirmedAt: { not: null }, consentAt: { not: null } };
    const accounts = await publicationRead(reader, () => reader
      ? tx.socialAccount.findMany({ where, select: publicationAccountSelect })
      : tx.socialAccount.findMany({ where }));
    const allowed: string[] = [];
    for (const account of accounts) {
      reader?.checkpoint();
      if (past(account.intendedConfirmedAt, now) && past(account.consentAt, now)
        && await publicationRead(reader, () => acceptedOwnershipProof(tx, account, actorUserId, now, actors, reader))) allowed.push(account.id);
    }
    const ids = visibleAccountIds ?? [creator.primaryAccountId!];
    if (ids.some(id => { reader?.checkpoint(); return !allowed.includes(id); })) throw new OnboardingError("ACCOUNT_PUBLICATION_NOT_ALLOWED", 400);
    return ids;
  } finally { reader?.checkpoint(); }
}
