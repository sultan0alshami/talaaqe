import { Prisma, type EvidenceCommand, type MetricsSnapshot, type SocialAccount } from "@prisma/client";
import { OriginalTextSchema } from "@/lib/contracts/vocabulary";
import { canonicalHash, record } from "@/lib/onboarding/drafts";
import { accountIdentityHash, currentCreatorOwner, evidenceJournal, evidenceJournalMatches, lockEvidenceDomain, privateAssetAccepted, type EvidenceActorLocks } from "./readiness";
import { EvidenceReceiptReadError, type EvidenceReceiptReader } from "./receipt-reader";

type Tx = Prisma.TransactionClient;
type Observation = Pick<MetricsSnapshot, "accountId" | "mappingRevision" | "observedAt" | "followers" | "averageViews" | "engagementRate" | "demographics" | "formatMetrics" | "engagementContext" | "evidenceAssetId">;
const Note = OriginalTextSchema.refine(n => n.text.trim().length > 0 && n.text.length <= 4000);
const metricKeys = ["followers", "averageViews", "engagementRate", "demographics", "formatMetrics", "engagementContext"];
const revision = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 2147483647;

// Parent and reviewed child carry the same immutable observation. Review time,
// source, exclusion and approval flags are deliberately checked separately.
export function snapshotScopeHash(s: Observation): string {
  return canonicalHash({ accountId: s.accountId, mappingRevision: s.mappingRevision, observedAt: s.observedAt.toISOString(),
    followers: s.followers?.toString() ?? null, averageViews: s.averageViews?.toString() ?? null, engagementRate: s.engagementRate?.toString() ?? null,
    demographics: s.demographics, formatMetrics: s.formatMetrics, engagementContext: s.engagementContext, evidenceAssetId: s.evidenceAssetId });
}
function submittedScopeHash(parent: MetricsSnapshot, metrics: Record<string, Prisma.JsonValue>): string | null {
  if (!Object.keys(metrics).length || Object.keys(metrics).some(k => !metricKeys.includes(k))) return null;
  // This mirrors only the persistence transformation. The exact command hash
  // below proves these are the original, already-validated parsed fields.
  try {
    return canonicalHash({ accountId: parent.accountId, mappingRevision: parent.mappingRevision, observedAt: parent.observedAt.toISOString(),
      followers: metrics.followers ?? null, averageViews: metrics.averageViews ?? null,
      engagementRate: typeof metrics.engagementRate === "string" ? new Prisma.Decimal(metrics.engagementRate).toString() : null,
      demographics: metrics.demographics ? Object.fromEntries(Object.entries(record(metrics.demographics)).map(([k, v]) => [k, v ? { ...record(v), visibility: "PUBLIC" } : null])) : null,
      formatMetrics: Array.isArray(metrics.formatMetrics) ? metrics.formatMetrics.map(v => ({ ...record(v), visibility: "PUBLIC" })) : null,
      engagementContext: metrics.engagementContext ? { ...record(metrics.engagementContext), visibility: "PUBLIC" } : null, evidenceAssetId: parent.evidenceAssetId });
  } catch { return null; }
}
async function journals(tx: Tx, id: string, actor: string, at: Date, reader?: EvidenceReceiptReader): Promise<EvidenceCommand[]> {
  if (reader) {
    reader.checkpoint();
    try {
      const accepted: EvidenceCommand[] = [];
      for await (const row of reader.scan(tx, { resourceType: "MetricsSnapshot", resourceId: id, actorUserId: actor, createdAt: at })) {
        reader.checkpoint();
        const value = record(row.resultJson).revision;
        if (revision(value) && evidenceJournalMatches(row, id, value)) accepted.push(row);
      }
      return accepted;
    } finally { reader.checkpoint(); }
  }
  const rows = await tx.evidenceCommand.findMany({ where: { resourceType: "MetricsSnapshot", resourceId: id, actorUserId: actor, createdAt: at } });
  const revisions = [...new Set(rows.map(row => record(row.resultJson).revision).filter(revision))];
  const accepted: EvidenceCommand[] = [];
  for (const value of revisions) accepted.push(...await evidenceJournal(tx, "MetricsSnapshot", id, actor, value, at));
  return accepted;
}
function boundMetadata(row: EvidenceCommand, account: SocialAccount, owner: string, scopeHash: string) {
  const metadata = record(row.resultJson), expected = metadata.expectedEvidenceRevision;
  return metadata.ownerUserId === owner && metadata.accountId === account.id && metadata.mappingRevision === account.mappingRevision
    && metadata.identityHash === accountIdentityHash(account) && metadata.snapshotScopeHash === scopeHash && revision(expected)
    && metadata.revision === expected + 1 && metadata.revision <= account.evidenceRevision;
}
function screenshotSubmissionMatches(row: EvidenceCommand, account: SocialAccount, ownerId: string, parent: MetricsSnapshot, scope: string): boolean {
  if (!boundMetadata(row, account, ownerId, scope)) return false;
  const metadata = record(row.resultJson), metrics = record(metadata.submittedMetrics);
  return row.payloadHash === canonicalHash({ action: "SUBMIT_SCREENSHOT", operationKey: row.operationKey, accountId: account.id,
    expectedMappingRevision: account.mappingRevision, expectedEvidenceRevision: metadata.expectedEvidenceRevision,
    evidenceAssetId: parent.evidenceAssetId, observedAt: parent.observedAt.toISOString(), ...metrics }) && submittedScopeHash(parent, metrics) === scope;
}
function screenshotReviewMatches(row: EvidenceCommand, account: SocialAccount, ownerId: string, parent: MetricsSnapshot, scope: string, submissionRevision: number): boolean {
  if (!boundMetadata(row, account, ownerId, scope)) return false;
  const metadata = record(row.resultJson), note = Note.safeParse(metadata.note);
  return metadata.decision === "VERIFIED" && metadata.parentId === parent.id && note.success && metadata.noteLanguage === note.data.language
    && (metadata.expectedEvidenceRevision as number) >= submissionRevision
    && row.payloadHash === canonicalHash({ action: "REVIEW_SCREENSHOT", id: parent.id, operationKey: row.operationKey,
      expectedEvidenceRevision: metadata.expectedEvidenceRevision, decision: "VERIFIED", note: note.data });
}

// The mutation reviewed actual private bytes. This acceptance path is strictly
// database metadata: no filesystem, provider requests or private asset DTOs.
export async function acceptedScreenshotProof(tx: Tx, account: SocialAccount, snapshot: MetricsSnapshot, ownerId: string, now: Date, actors: EvidenceActorLocks, reader?: EvidenceReceiptReader): Promise<boolean> {
  reader?.checkpoint();
  try {
    if (!Number.isFinite(now.getTime()) || snapshot.source !== "SCREENSHOT_VERIFIED" || snapshot.reviewStatus !== "VERIFIED" || snapshot.excludedAt
      || !snapshot.approvedAt || snapshot.approvedAt > now || !snapshot.approvedBy || !actors.reviewerIds.has(snapshot.approvedBy)
      || !snapshot.supersedesId || !snapshot.evidenceAssetId || snapshot.accountId !== account.id || snapshot.mappingRevision !== account.mappingRevision
      || !actors.ownerIds.has(ownerId)) return false;
    await lockEvidenceDomain(tx, "Creator", [account.creatorId]);
    reader?.checkpoint();
    await lockEvidenceDomain(tx, "SocialAccount", [account.id]);
    reader?.checkpoint();
    const creator = await tx.creator.findUnique({ where: { id: account.creatorId }, select: { id: true, userId: true } });
    reader?.checkpoint();
    const currentAccount = await tx.socialAccount.findUnique({ where: { id: account.id } });
    reader?.checkpoint();
    if (!creator || creator.userId !== ownerId || !currentCreatorOwner(actors, creator) || !currentAccount || currentAccount.creatorId !== account.creatorId
      || currentAccount.mappingRevision !== account.mappingRevision || currentAccount.evidenceRevision !== account.evidenceRevision
      || accountIdentityHash(currentAccount) !== accountIdentityHash(account)) return false;
    reader?.checkpoint();
    const owner = await tx.user.findUnique({ where: { id: ownerId }, select: { active: true, role: true } });
    reader?.checkpoint();
    const reviewer = await tx.user.findUnique({ where: { id: snapshot.approvedBy }, select: { active: true, role: true } });
    reader?.checkpoint();
    if (!owner?.active || owner.role !== "CREATOR" || !reviewer?.active || reviewer.role !== "ADMIN") return false;

    const ids = [...new Set([snapshot.id, snapshot.supersedesId])].sort();
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "MetricsSnapshot" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`);
    reader?.checkpoint();
    const child = await tx.metricsSnapshot.findUnique({ where: { id: snapshot.id } });
    reader?.checkpoint();
    const parent = await tx.metricsSnapshot.findUnique({ where: { id: snapshot.supersedesId } });
    reader?.checkpoint();
    if (!child || !parent || child.source !== "SCREENSHOT_VERIFIED" || child.reviewStatus !== "VERIFIED" || child.excludedAt
      || child.supersedesId !== parent.id || child.approvedBy !== snapshot.approvedBy || child.approvedAt?.getTime() !== snapshot.approvedAt.getTime()
      || child.importedAt.getTime() !== snapshot.approvedAt.getTime() || child.jobId || child.providerObservationId
      || parent.source !== "SELF_REPORTED" || parent.reviewStatus !== "VERIFIED" || parent.supersedesId || parent.jobId || parent.providerObservationId
      || parent.excludedAt?.getTime() !== snapshot.approvedAt.getTime() || parent.observedAt > parent.importedAt || parent.importedAt > snapshot.approvedAt
      || parent.accountId !== account.id || parent.mappingRevision !== account.mappingRevision) return false;
    const scope = snapshotScopeHash(child);
    if (scope !== snapshotScopeHash(snapshot) || scope !== snapshotScopeHash(parent)) return false;
    reader?.checkpoint();

    const submissions = await journals(tx, parent.id, ownerId, parent.importedAt, reader);
    let submitted: EvidenceCommand | undefined;
    if (reader) {
      for (const row of submissions) {
        reader.checkpoint();
        if (!screenshotSubmissionMatches(row, account, ownerId, parent, scope)) continue;
        if (submitted) throw new EvidenceReceiptReadError();
        submitted = row;
      }
    } else submitted = submissions.find(row => screenshotSubmissionMatches(row, account, ownerId, parent, scope));
    if (!submitted) return false;
    const submissionRevision = record(submitted.resultJson).revision as number;
    const reviews = await journals(tx, child.id, child.approvedBy!, child.approvedAt!, reader);
    const reviewed = reviews.some(row => {
      reader?.checkpoint();
      return screenshotReviewMatches(row, account, ownerId, parent, scope, submissionRevision);
    });
    return reviewed && !!await privateAssetAccepted(tx, child.evidenceAssetId!, ownerId, "SCREENSHOT", parent.importedAt, reader);
  } finally { reader?.checkpoint(); }
}
