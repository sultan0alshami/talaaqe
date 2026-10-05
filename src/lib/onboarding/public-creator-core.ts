import type { Creator, PortfolioVersion, Prisma, SocialAccount, User } from "@prisma/client";
import { acceptedOwnershipProof, currentCreatorOwner, type EvidenceActorLocks } from "@/lib/evidence/readiness";
import type { EvidenceReceiptReader } from "@/lib/evidence/receipt-reader";
import { canonicalHash, record, stateOf } from "./drafts";
import { PortfolioContentSchema, type PortfolioContent } from "./portfolio-contract";

export type PublicationCreator = Creator & {
  user: Pick<User, "active" | "role" | "isTest" | "emailVerifiedAt"> | null;
};
export type CreatorPublicationInput = {
  initialId: string; creator: PublicationCreator | null; accounts: readonly SocialAccount[];
  portfolio: Pick<PortfolioVersion, "approvedAt" | "content"> | null | undefined;
  actors: EvidenceActorLocks; now: Date; reader?: EvidenceReceiptReader;
};
const past = (date: Date | null, now: Date) => date !== null && date <= now;

export async function creatorPublicationCore(
  tx: Prisma.TransactionClient, input: CreatorPublicationInput,
): Promise<{ portfolio: PortfolioContent; accounts: SocialAccount[] } | null> {
  const { initialId, creator, accounts, portfolio, actors, now, reader } = input;
  reader?.checkpoint();
  try {
    if (!creator || creator.id !== initialId || !currentCreatorOwner(actors, creator) || !creator.userId
      || creator.state !== "PUBLISHED" || creator.isTest || !past(creator.publicConsentAt, now)
      || !creator.user?.active || creator.user.role !== "CREATOR" || creator.user.isTest || !past(creator.user.emailVerifiedAt, now)) return null;
    reader?.checkpoint();

    const primary = accounts.find(account => account.id === creator.primaryAccountId);
    if (!primary || !past(primary.intendedConfirmedAt, now) || !past(primary.consentAt, now)) return null;
    reader?.checkpoint();
    const primaryAccepted = await acceptedOwnershipProof(tx, primary, creator.userId, now, actors, reader);
    reader?.checkpoint();
    if (!primaryAccepted) return null;

    // The caller's owner lock prevents draft edits during this projection.
    const draft = await tx.onboardingDraft.findUnique({ where: { userId_kind: { userId: creator.userId, kind: "CREATOR" } } });
    reader?.checkpoint();
    if (draft && record(creator.profileFacts).mappingHash !== canonicalHash(stateOf(draft).sources)) return null;
    reader?.checkpoint();
    const parsed = PortfolioContentSchema.safeParse(portfolio?.content);
    if (!portfolio || !past(portfolio.approvedAt, now) || !parsed.success) return null;
    reader?.checkpoint();

    const publicAccounts: SocialAccount[] = [];
    for (const account of accounts) {
      reader?.checkpoint();
      if (!account.publicVisible || !past(account.intendedConfirmedAt, now) || !past(account.consentAt, now)) continue;
      // Preserve the original second ownership check for a public primary.
      const accepted = await acceptedOwnershipProof(tx, account, creator.userId, now, actors, reader);
      reader?.checkpoint();
      if (accepted) publicAccounts.push(account);
    }
    return { portfolio: parsed.data, accounts: publicAccounts };
  } finally { reader?.checkpoint(); }
}
