import { Prisma, type AdvertisingLicence, type Brand, type BusinessVerification, type Creator, type EvidenceCommand, type PrivateAsset, type SocialAccount } from "@prisma/client";
import { canonicalHash, record } from "@/lib/onboarding/drafts";
import { MAX_EVIDENCE_BYTES } from "./limits";
import type { EvidenceReceiptReader } from "./receipt-reader";

type Tx = Prisma.TransactionClient;
export type EvidenceActorLocks = { ownerIds: ReadonlySet<string>; reviewerIds: ReadonlySet<string>; creatorOwners: ReadonlyMap<string, string | null>; brandOwners: ReadonlyMap<string, string> };
type ActorScope = { creatorIds?: readonly string[]; brandIds?: readonly string[]; otherOwnerIds?: readonly string[]; includePolicies?: boolean; updateOwners?: boolean };

// Discover actors before any domain row is locked. Recheck the captured owner and
// reviewer sets on use: a new reviewer is never locked later, out of order.
export async function lockEvidenceActors(tx: Tx, scope: ActorScope): Promise<EvidenceActorLocks> {
  const creators = await tx.creator.findMany({ where: { id: { in: [...(scope.creatorIds ?? [])] } }, select: { id: true, userId: true, accounts: { select: { ownershipReviewedBy: true, snapshots: { where: { source: "SCREENSHOT_VERIFIED", approvedBy: { not: null } }, select: { approvedBy: true } } } }, licences: { select: { reviewedBy: true } } } });
  const brands = await tx.brand.findMany({ where: { id: { in: [...(scope.brandIds ?? [])] } }, select: { id: true, userId: true, verifications: { select: { reviewedBy: true } } } });
  const policies = scope.includePolicies ? await tx.policyVersion.findMany({ where: { kind: { in: ["MARKET", "GOVERNING_TERMS", "PHONE_FALLBACK"] }, status: "VERIFIED" }, select: { reviewedBy: true } }) : [];
  const ownerIds = new Set([...creators.flatMap(c => c.userId ? [c.userId] : []), ...brands.map(b => b.userId), ...(scope.otherOwnerIds ?? [])].sort());
  const fallbacks = scope.includePolicies ? await tx.verificationFallback.findMany({ where: { userId: { in: [...ownerIds] }, status: "VERIFIED" }, select: { reviewedBy: true } }) : [];
  const reviewerIds = new Set([...creators.flatMap(c => [...c.accounts.flatMap(a => [...(a.ownershipReviewedBy ? [a.ownershipReviewedBy] : []), ...a.snapshots.flatMap(s => s.approvedBy ? [s.approvedBy] : [])]), ...c.licences.flatMap(l => l.reviewedBy ? [l.reviewedBy] : [])]), ...brands.flatMap(b => b.verifications.flatMap(v => v.reviewedBy ? [v.reviewedBy] : [])), ...policies.flatMap(p => p.reviewedBy ? [p.reviewedBy] : []), ...fallbacks.flatMap(f => f.reviewedBy ? [f.reviewedBy] : [])].filter(id => !ownerIds.has(id)).sort());
  if (ownerIds.size) {
    const ids = [...ownerIds];
    if (scope.updateOwners) await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
    else await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`);
  }
  if (reviewerIds.size) await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join([...reviewerIds])}) ORDER BY id FOR SHARE`);
  return { ownerIds, reviewerIds, creatorOwners: new Map(creators.map(c => [c.id, c.userId])), brandOwners: new Map(brands.map(b => [b.id, b.userId])) };
}
export async function lockEvidenceDomain(tx: Tx, table: "Creator" | "Brand" | "SocialAccount" | "BusinessVerification" | "AdvertisingLicence" | "OwnershipChallenge" | "PrivateAsset", ids: readonly string[]): Promise<void> {
  if (ids.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw('"' + table + '"')} WHERE id IN (${Prisma.join([...new Set(ids)].sort())}) ORDER BY id FOR SHARE`);
}
export const accountIdentityHash = (a: SocialAccount) => canonicalHash({ platform: a.platform, normalizedHandle: a.handle, providerAccountId: a.providerAccountId, confirmedOrigin: null });
export const currentCreatorOwner = (actors: EvidenceActorLocks, c: Pick<Creator, "id" | "userId">) => actors.creatorOwners.has(c.id) && actors.creatorOwners.get(c.id) === c.userId && (!c.userId || actors.ownerIds.has(c.userId));
export const currentBrandOwner = (actors: EvidenceActorLocks, b: Pick<Brand, "id" | "userId">) => actors.brandOwners.get(b.id) === b.userId && actors.ownerIds.has(b.userId);
async function reviewerActive(tx: Tx, id: string, actors: EvidenceActorLocks) {
  if (!actors.reviewerIds.has(id)) return false;
  const user = await tx.user.findUnique({ where: { id }, select: { active: true, role: true } });
  return user?.active === true && user.role === "ADMIN";
}
async function ownerActive(tx: Tx, id: string, role: "CREATOR" | "BRAND", actors: EvidenceActorLocks) {
  if (!actors.ownerIds.has(id)) return false;
  const user = await tx.user.findUnique({ where: { id }, select: { active: true, role: true } });
  return user?.active === true && user.role === role;
}
export function evidenceJournalMatches(row: EvidenceCommand, id: string, revision: number): boolean {
  const metadata = record(row.resultJson);
  return metadata.resourceId === id && metadata.revision === revision && /^[a-f0-9]{64}$/.test(row.payloadHash);
}
export async function evidenceJournal(tx: Tx, type: string, id: string, actor: string, revision: number, at: Date, reader?: EvidenceReceiptReader) {
  reader?.checkpoint();
  try {
    const scope = { resourceType: type, resourceId: id, actorUserId: actor, createdAt: at };
    const rows: EvidenceCommand[] = reader ? [] : await tx.evidenceCommand.findMany({ where: scope });
    if (reader) for await (const row of reader.scan(tx, scope)) rows.push(row);
    return rows.filter(row => { reader?.checkpoint(); return evidenceJournalMatches(row, id, revision); });
  } finally { reader?.checkpoint(); }
}
function verifiedReview(row: EvidenceCommand, action: string, id: string, revision: number, note: string | null, extra: Record<string, string> = {}) {
  const language = record(row.resultJson).noteLanguage;
  return note !== null && (language === "ar" || language === "en") && row.payloadHash === canonicalHash({ action, id, operationKey: row.operationKey, expectedRevision: revision - 1, decision: "VERIFIED", note: { text: note, language }, ...extra });
}
export async function privateAssetAccepted(tx: Tx, id: string, owner: string, purpose: string, through: Date, reader?: EvidenceReceiptReader): Promise<PrivateAsset | null> {
  reader?.checkpoint();
  try {
    await lockEvidenceDomain(tx, "PrivateAsset", [id]);
    reader?.checkpoint();
    const asset = await tx.privateAsset.findUnique({ where: { id } });
    reader?.checkpoint();
    if (!asset || asset.ownerUserId !== owner || asset.purpose !== purpose || asset.deletedAt || asset.createdAt > through || asset.size <= 0 || asset.size > MAX_EVIDENCE_BYTES || !["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(asset.contentType) || !/^[a-f0-9]{64}$/.test(asset.checksum)) return null;
    const uploads = await evidenceJournal(tx, "PrivateAsset", id, owner, 1, asset.createdAt, reader);
    return uploads.some(row => {
      reader?.checkpoint();
      return row.payloadHash === canonicalHash({ operationKey: row.operationKey, purpose, contentType: asset.contentType, size: asset.size, checksum: asset.checksum });
    }) ? asset : null;
  } finally { reader?.checkpoint(); }
}

// Reads only database metadata. The accepted review checked actual bytes; GET
// never imports storage/provider code or rereads private evidence bytes.
export async function acceptedOwnershipProof(tx: Tx, account: SocialAccount, ownerUserId: string, now: Date, locked?: EvidenceActorLocks, reader?: EvidenceReceiptReader): Promise<boolean> {
  reader?.checkpoint();
  try {
    if (!Number.isFinite(now.getTime()) || account.ownershipStatus !== "VERIFIED" || !account.ownershipReviewedBy || !account.ownershipReviewedAt || account.ownershipReviewedAt > now || !account.ownershipProofAssetId || account.ownershipIdentityHash !== accountIdentityHash(account)) return false;
    reader?.checkpoint();
    const actors = locked ?? await lockEvidenceActors(tx, { creatorIds: [account.creatorId] });
    reader?.checkpoint();
    if (!locked) {
      await lockEvidenceDomain(tx, "Creator", [account.creatorId]);
      reader?.checkpoint();
      await lockEvidenceDomain(tx, "SocialAccount", [account.id]);
      reader?.checkpoint();
    }
    const creator = await tx.creator.findUnique({ where: { id: account.creatorId }, select: { id: true, userId: true } });
    reader?.checkpoint();
    const current = await tx.socialAccount.findUnique({ where: { id: account.id } });
    reader?.checkpoint();
    if (!creator || creator.userId !== ownerUserId || !currentCreatorOwner(actors, creator) || !current || current.creatorId !== account.creatorId || current.mappingRevision !== account.mappingRevision || current.evidenceRevision !== account.evidenceRevision || current.ownershipStatus !== account.ownershipStatus || current.ownershipProofAssetId !== account.ownershipProofAssetId || current.ownershipReviewedBy !== account.ownershipReviewedBy || current.ownershipReviewedAt?.getTime() !== account.ownershipReviewedAt.getTime() || current.ownershipIdentityHash !== account.ownershipIdentityHash || accountIdentityHash(current) !== accountIdentityHash(account)) return false;
    reader?.checkpoint();
    const owner = await tx.user.findUnique({ where: { id: ownerUserId }, select: { active: true, role: true } });
    reader?.checkpoint();
    if (!owner?.active || owner.role !== "CREATOR" || !await reviewerActive(tx, account.ownershipReviewedBy, actors)) return false;
    reader?.checkpoint();
    const candidates = await tx.ownershipChallenge.findMany({ where: { accountId: account.id, ownerUserId, status: "VERIFIED", mappingRevision: account.mappingRevision, identityHash: account.ownershipIdentityHash, proofAssetId: account.ownershipProofAssetId, reviewedBy: account.ownershipReviewedBy, reviewedAt: account.ownershipReviewedAt }, orderBy: { id: "asc" }, take: 2 });
    reader?.checkpoint();
    if (candidates.length !== 1) return false;
    await lockEvidenceDomain(tx, "OwnershipChallenge", [candidates[0]!.id]);
    reader?.checkpoint();
    const c = await tx.ownershipChallenge.findUniqueOrThrow({ where: { id: candidates[0]!.id } });
    reader?.checkpoint();
    if (c.status !== "VERIFIED" || c.ownerUserId !== ownerUserId || c.accountId !== account.id || c.mappingRevision !== account.mappingRevision || c.identityHash !== accountIdentityHash(account) || canonicalHash(c.identity) !== c.identityHash || c.proofAssetId !== account.ownershipProofAssetId || c.reviewedBy !== account.ownershipReviewedBy || !c.reviewedAt || c.reviewedAt.getTime() !== account.ownershipReviewedAt.getTime() || !c.submittedAt || c.submittedAt < c.createdAt || c.submittedAt > c.reviewedAt || c.reviewedAt >= c.expiresAt || c.revision !== 3) return false;
    reader?.checkpoint();
    const starts = await evidenceJournal(tx, "OwnershipChallenge", c.id, ownerUserId, 1, c.createdAt, reader);
    const originalIdentity = starts.some(row => {
      reader?.checkpoint();
      const metadata = record(row.resultJson), expectedEvidenceRevision = metadata.expectedEvidenceRevision;
      return metadata.ownerUserId === ownerUserId && metadata.accountId === account.id && metadata.mappingRevision === account.mappingRevision && metadata.identityHash === accountIdentityHash(account) && typeof expectedEvidenceRevision === "number" && Number.isSafeInteger(expectedEvidenceRevision) && expectedEvidenceRevision > 0 && row.payloadHash === canonicalHash({ action: "START_OWNERSHIP", operationKey: row.operationKey, accountId: account.id, expectedMappingRevision: account.mappingRevision, expectedEvidenceRevision });
    });
    const submitted = await evidenceJournal(tx, "OwnershipChallenge", c.id, ownerUserId, 2, c.submittedAt, reader);
    if (!originalIdentity || !submitted.some(row => {
      reader?.checkpoint();
      return row.payloadHash === canonicalHash({ action: "SUBMIT_OWNERSHIP", id: c.id, operationKey: row.operationKey, expectedRevision: 1, assetId: c.proofAssetId });
    }) || !(await evidenceJournal(tx, "OwnershipChallenge", c.id, c.reviewedBy, c.revision, c.reviewedAt, reader)).some(row => {
      reader?.checkpoint();
      return verifiedReview(row, "REVIEW_OWNERSHIP", c.id, c.revision, c.reviewNote, { observedChallengeCode: c.challengeCode });
    })) return false;
    return !!await privateAssetAccepted(tx, account.ownershipProofAssetId, ownerUserId, "OWNERSHIP_PROOF", c.submittedAt, reader);
  } finally { reader?.checkpoint(); }
}
function businessScope(b: BusinessVerification) { return { kind: b.kind, jurisdiction: b.jurisdiction, identifier: b.identifier, evidenceAssetId: b.evidenceAssetId, expiresAt: b.expiresAt?.toISOString() ?? null }; }
export async function acceptedRepresentativeProof(tx: Tx, brand: Brand, verification: BusinessVerification, now: Date, actors: EvidenceActorLocks): Promise<boolean> {
  const b = verification;
  if (!currentBrandOwner(actors, brand) || b.brandId !== brand.id || b.kind !== "REPRESENTATIVE" || b.jurisdiction !== brand.countryCode || b.status !== "VERIFIED" || b.revision !== 2 || !b.reviewedBy || !b.reviewedAt || b.reviewedAt < b.createdAt || b.reviewedAt > now || b.expiresAt && b.expiresAt <= now || !b.evidenceAssetId || !await reviewerActive(tx, b.reviewedBy, actors)) return false;
  if (!await ownerActive(tx, brand.userId, "BRAND", actors)) return false;
  const submissions = await evidenceJournal(tx, "BusinessVerification", b.id, brand.userId, 1, b.createdAt);
  if (!submissions.some(row => { const m = record(row.resultJson); return m.ownerUserId === brand.userId && m.brandCountryCode === brand.countryCode && m.scopeHash === canonicalHash(businessScope(b)); }) || !(await evidenceJournal(tx, "BusinessVerification", b.id, b.reviewedBy, b.revision, b.reviewedAt)).some(row => verifiedReview(row, "REVIEW_BUSINESS_PROOF", b.id, b.revision, b.reviewNote))) return false;
  return !!await privateAssetAccepted(tx, b.evidenceAssetId, brand.userId, "REPRESENTATIVE", b.createdAt);
}
function licenceScope(l: AdvertisingLicence) { return { jurisdiction: l.jurisdiction, issuer: l.issuer, holderName: l.holderName, licenceNumber: l.licenceNumber, type: l.type, scope: l.scope, accountIds: [...l.accountIds].sort(), platformScope: [...l.platformScope].sort(), evidenceAssetId: l.evidenceAssetId, validFrom: l.validFrom?.toISOString() ?? null, expiresAt: l.expiresAt?.toISOString() ?? null }; }
export async function acceptedLicenceProof(tx: Tx, creator: Creator, l: AdvertisingLicence, accounts: readonly SocialAccount[], now: Date, actors: EvidenceActorLocks): Promise<boolean> {
  if (!creator.userId || !currentCreatorOwner(actors, creator) || l.creatorId !== creator.id || l.status !== "VERIFIED" || l.revision !== 2 || !l.policyVersion || l.reviewMethod !== "MANUAL_REVIEW" || !l.reviewedBy || !l.reviewedAt || l.reviewedAt < l.createdAt || l.reviewedAt > now || !l.validFrom || l.validFrom > now || !l.expiresAt || l.expiresAt <= now || !l.evidenceAssetId || !l.accountIds.length || !l.platformScope.length || !await reviewerActive(tx, l.reviewedBy, actors)) return false;
  if (!await ownerActive(tx, creator.userId, "CREATOR", actors)) return false;
  const submissions = await evidenceJournal(tx, "AdvertisingLicence", l.id, creator.userId, 1, l.createdAt);
  const metadata = submissions.map(row => record(row.resultJson)).find(m => m.ownerUserId === creator.userId && m.creatorCountryCode === creator.countryCode && m.scopeHash === canonicalHash(licenceScope(l)));
  if (!metadata || !Array.isArray(metadata.scopeBindings) || metadata.scopeBindings.length !== l.accountIds.length || new Set(l.accountIds).size !== l.accountIds.length || new Set(l.platformScope).size !== l.platformScope.length) return false;
  const bindings = metadata.scopeBindings.map(b => record(b)), seen = new Set<string>();
  for (const binding of bindings) {
    if (typeof binding.accountId !== "string" || seen.has(binding.accountId) || !l.accountIds.includes(binding.accountId)) return false;
    const account = accounts.find(a => a.id === binding.accountId);
    if (!account || account.creatorId !== creator.id || !l.platformScope.includes(account.platform) || binding.mappingRevision !== account.mappingRevision || binding.identityHash !== accountIdentityHash(account)) return false;
    seen.add(account.id);
  }
  if (l.platformScope.some(p => !accounts.some(a => l.accountIds.includes(a.id) && a.platform === p))) return false;
  const reviews = await evidenceJournal(tx, "AdvertisingLicence", l.id, l.reviewedBy, l.revision, l.reviewedAt);
  const review = reviews.find(row => { const policyVersionId = record(row.resultJson).reviewedMarketVersionId; return typeof policyVersionId === "string" && verifiedReview(row, "REVIEW_LICENCE", l.id, l.revision, l.reviewNote, { policyVersionId }); });
  if (!review) return false;
  const policyId = record(review.resultJson).reviewedMarketVersionId as string;
  await tx.$queryRaw`SELECT id FROM "PolicyVersion" WHERE id=${policyId} FOR SHARE`;
  const policy = await tx.policyVersion.findUnique({ where: { id: policyId } }), content = record(policy?.content);
  if (!policy || policy.kind !== "MARKET" || content.kind !== "MARKET" || content.licencePolicyId !== l.policyVersion || content.marketCountryCode !== l.jurisdiction) return false;
  return !!await privateAssetAccepted(tx, l.evidenceAssetId, creator.userId, "ADVERTISING_LICENCE", l.createdAt);
}
