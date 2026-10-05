import { Prisma, type Creator, type MetricsSnapshot, type SocialAccount } from "@prisma/client";
import type { EvidenceActorLocks } from "@/lib/evidence/readiness";
import type { EvidenceReceiptReader } from "@/lib/evidence/receipt-reader";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { DISCOVERY_LIMITS, DiscoveryError } from "./contracts";

export type PublicIdentityCreatorRef = Pick<Creator, "id" | "userId" | "primaryAccountId">;
export type PublicIdentityAccountRef = Pick<SocialAccount,
  "id" | "creatorId" | "platform" | "handle" | "providerAccountId" | "publicVisible"
  | "mappingRevision" | "evidenceRevision" | "ownershipReviewedBy">;
export type PublicIdentityObservationRef = Pick<MetricsSnapshot,
  "id" | "accountId" | "mappingRevision" | "source" | "reviewStatus" | "observedAt"
  | "importedAt" | "approvedAt" | "approvedBy" | "excludedAt" | "supersedesId">;
export type PublicIdentityRecord = {
  readonly creator: PublicIdentityCreatorRef;
  readonly accounts: readonly PublicIdentityAccountRef[];
  readonly choices: ReadonlyMap<string, PublicIdentityObservationRef | null>;
};
export type PublicIdentityCapture = { readonly asOf: string; readonly records: readonly PublicIdentityRecord[] };

const accountSelect = {
  id: true, creatorId: true, platform: true, handle: true, providerAccountId: true,
  publicVisible: true, mappingRevision: true, evidenceRevision: true, ownershipReviewedBy: true,
} as const;
const choiceSelect = {
  id: true, accountId: true, mappingRevision: true, source: true, reviewStatus: true,
  observedAt: true, importedAt: true, approvedAt: true, approvedBy: true, excludedAt: true, supersedesId: true,
} as const;
export const publicIdentityChoiceOrder = [{ observedAt: "desc" }, { importedAt: "desc" }, { id: "asc" }] as const;
const retry = (): never => { throw new DiscoveryError("RETRY_REQUIRED"); };

// Internal shared reads/fingerprints keep capture and locked rechecks identical.
export async function publicIdentityRead<T>(reader: EvidenceReceiptReader, query: () => Promise<T>): Promise<T> {
  reader.checkpoint();
  const value = await query();
  reader.checkpoint();
  return value;
}
export function publicIdentityAccountFingerprint(account: PublicIdentityAccountRef): string {
  return canonicalHash({ id: account.id, creatorId: account.creatorId, platform: account.platform,
    handle: account.handle, providerAccountId: account.providerAccountId, publicVisible: account.publicVisible,
    mappingRevision: account.mappingRevision, evidenceRevision: account.evidenceRevision, ownershipReviewedBy: account.ownershipReviewedBy });
}
export function publicIdentityObservationFingerprint(choice: PublicIdentityObservationRef | null): string | null {
  return choice ? canonicalHash({ id: choice.id, accountId: choice.accountId, mappingRevision: choice.mappingRevision,
    source: choice.source, reviewStatus: choice.reviewStatus, observedAt: choice.observedAt.toISOString(),
    importedAt: choice.importedAt.toISOString(), approvedAt: choice.approvedAt?.toISOString() ?? null,
    approvedBy: choice.approvedBy, excludedAt: choice.excludedAt?.toISOString() ?? null, supersedesId: choice.supersedesId }) : null;
}
export async function publicIdentityAccountReferences(
  tx: Prisma.TransactionClient, creator: PublicIdentityCreatorRef, reader: EvidenceReceiptReader,
): Promise<PublicIdentityAccountRef[]> {
  const publicAccounts = await publicIdentityRead(reader, () => tx.socialAccount.findMany({
    where: { creatorId: creator.id, publicVisible: true }, select: accountSelect,
    orderBy: { id: "asc" }, take: DISCOVERY_LIMITS.publicAccounts,
  }));
  if (publicAccounts.length === DISCOVERY_LIMITS.publicAccounts) {
    const tail = publicAccounts[publicAccounts.length - 1]!.id;
    const more = await publicIdentityRead(reader, () => tx.$queryRaw<Array<{ exists: boolean }>>`SELECT EXISTS (
      SELECT 1 FROM "SocialAccount" WHERE "creatorId"=${creator.id} AND "publicVisible"=true AND id>${tail}
    ) AS "exists"`);
    if (more.length !== 1 || typeof more[0]?.exists !== "boolean" || more[0].exists) retry();
  }
  if (creator.primaryAccountId && !publicAccounts.some(account => account.id === creator.primaryAccountId)) {
    const primary = await publicIdentityRead(reader, () => tx.socialAccount.findUnique({
      where: { id: creator.primaryAccountId!, creatorId: creator.id }, select: accountSelect,
    }));
    if (primary?.publicVisible) retry();
    if (primary) publicAccounts.push(primary);
  }
  return publicAccounts;
}

// Reference capture is neither a public DTO nor an authorization/lock claim.
export async function capturePublicCreatorIdentities(
  tx: Prisma.TransactionClient, creatorIds: readonly string[], now: Date, reader: EvidenceReceiptReader,
): Promise<PublicIdentityCapture> {
  reader.checkpoint();
  try {
    if (!Array.isArray(creatorIds) || creatorIds.length > DISCOVERY_LIMITS.creators
      || creatorIds.some(id => typeof id !== "string" || !id.length || id.length > 200)
      || new Set(creatorIds).size !== creatorIds.length || !(now instanceof Date) || !Number.isFinite(now.getTime())) retry();
    const ids = [...creatorIds], asOf = now.toISOString(), records: PublicIdentityRecord[] = [];
    if (!ids.length) return { asOf, records };
    const references = await publicIdentityRead(reader, () => tx.creator.findMany({ where: { id: { in: ids } },
      select: { id: true, userId: true, primaryAccountId: true }, take: DISCOVERY_LIMITS.creators }));
    const byId = new Map(references.map(creator => [creator.id, creator]));
    for (const id of ids) {
      reader.checkpoint();
      const creator = byId.get(id);
      if (!creator) continue;
      const accounts = await publicIdentityAccountReferences(tx, creator, reader);
      const choices = new Map<string, PublicIdentityObservationRef | null>();
      for (const account of accounts) {
        reader.checkpoint();
        if (!account.publicVisible) continue;
        const choice = await publicIdentityRead(reader, () => tx.metricsSnapshot.findFirst({
          where: { accountId: account.id, mappingRevision: account.mappingRevision, excludedAt: null },
          orderBy: [...publicIdentityChoiceOrder], select: choiceSelect,
        }));
        choices.set(account.id, choice);
      }
      records.push({ creator, accounts, choices });
    }
    const capture = { asOf, records };
    publicIdentityActors(capture);
    return capture;
  } finally { reader.checkpoint(); }
}
export function publicIdentityActors(capture: PublicIdentityCapture): EvidenceActorLocks {
  if (!capture || !Array.isArray(capture.records) || capture.records.length > DISCOVERY_LIMITS.creators
    || !Number.isFinite(new Date(capture.asOf).getTime())) retry();
  const ownerIds = new Set<string>(), reviewerIds = new Set<string>(), creatorOwners = new Map<string, string | null>();
  for (const record of capture.records) {
    if (creatorOwners.has(record.creator.id) || record.accounts.length > DISCOVERY_LIMITS.publicAccounts + 1) retry();
    creatorOwners.set(record.creator.id, record.creator.userId);
    if (record.creator.userId) ownerIds.add(record.creator.userId);
    const publicAccounts = record.accounts.filter(account => account.publicVisible);
    const privateAccounts = record.accounts.filter(account => !account.publicVisible);
    if (publicAccounts.length > DISCOVERY_LIMITS.publicAccounts || privateAccounts.length > 1
      || privateAccounts.some(account => account.id !== record.creator.primaryAccountId)
      || new Set(record.accounts.map(account => account.id)).size !== record.accounts.length
      || record.choices.size !== publicAccounts.length) retry();
    for (const account of record.accounts) {
      if (account.creatorId !== record.creator.id) retry();
      if (account.ownershipReviewedBy) reviewerIds.add(account.ownershipReviewedBy);
      if (!account.publicVisible) continue;
      if (!record.choices.has(account.id)) retry();
      const choice = record.choices.get(account.id);
      if (choice && (choice.accountId !== account.id || choice.mappingRevision !== account.mappingRevision || choice.excludedAt)) retry();
      if (choice?.approvedBy) reviewerIds.add(choice.approvedBy);
    }
  }
  for (const owner of ownerIds) reviewerIds.delete(owner);
  if (ownerIds.size > DISCOVERY_LIMITS.ownerUsers || reviewerIds.size > DISCOVERY_LIMITS.reviewerUsers) retry();
  return { ownerIds: new Set([...ownerIds].sort()), reviewerIds: new Set([...reviewerIds].sort()), creatorOwners, brandOwners: new Map() };
}
export async function lockPublicIdentityUsers(
  tx: Prisma.TransactionClient, capture: PublicIdentityCapture, reader: EvidenceReceiptReader,
): Promise<EvidenceActorLocks> {
  reader.checkpoint();
  try {
    const actors = publicIdentityActors(capture), owners = [...actors.ownerIds], reviewers = [...actors.reviewerIds];
    if (owners.length) await publicIdentityRead(reader, () => tx.$queryRaw(Prisma.sql`SELECT id FROM "User"
      WHERE id IN (${Prisma.join(owners)}) ORDER BY id FOR SHARE`));
    if (reviewers.length) await publicIdentityRead(reader, () => tx.$queryRaw(Prisma.sql`SELECT id FROM "User"
      WHERE id IN (${Prisma.join(reviewers)}) ORDER BY id FOR SHARE`));
    return actors;
  } finally { reader.checkpoint(); }
}
