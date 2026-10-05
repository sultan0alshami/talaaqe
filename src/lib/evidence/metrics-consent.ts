import { Prisma, type EvidenceCommand, type MetricsSnapshot, type SocialAccount } from "@prisma/client";
import { canonicalHash, record } from "@/lib/onboarding/drafts";
import { SnapshotSharingCommandSchema, metricFields } from "./metrics-sharing-contract";
import { snapshotScopeHash } from "./metrics-readiness";
import { accountIdentityHash, currentCreatorOwner, lockEvidenceActors, lockEvidenceDomain, type EvidenceActorLocks } from "./readiness";
import type { EvidenceReceiptReader } from "./receipt-reader";

type Tx = Prisma.TransactionClient;
type Approval = { revision: number; at: Date; visibility: Record<string, "PRIVATE" | "BRAND_ONLY" | "PUBLIC"> };
const revision = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 2147483647;
function approvalBinding(row: EvidenceCommand, account: SocialAccount, snapshot: MetricsSnapshot, owner: string): Approval | null {
  const metadata = record(row.resultJson);
  const parsed = SnapshotSharingCommandSchema.safeParse({
    operationKey: row.operationKey, expectedMappingRevision: metadata.expectedMappingRevision,
    expectedEvidenceRevision: metadata.expectedEvidenceRevision, visibility: metadata.visibility,
  });
  if (!parsed.success || metadata.action !== "APPROVE_SCREENSHOT_FIELDS" || metadata.resourceId !== snapshot.id
    || metadata.ownerUserId !== owner || metadata.accountId !== account.id || metadata.mappingRevision !== account.mappingRevision
    || metadata.identityHash !== accountIdentityHash(account) || metadata.snapshotScopeHash !== snapshotScopeHash(snapshot)
    || parsed.data.expectedMappingRevision !== account.mappingRevision || !revision(metadata.revision)
    || metadata.revision !== parsed.data.expectedEvidenceRevision + 1 || metadata.revision > account.evidenceRevision
    || Object.keys(parsed.data.visibility).some(field => !metricFields(snapshot).includes(field))) return null;
  try {
    if (row.payloadHash !== canonicalHash({ action: "APPROVE_SCREENSHOT_FIELDS", id: snapshot.id, ...parsed.data })) return null;
  } catch { return null; }
  return { revision: metadata.revision, at: row.createdAt, visibility: parsed.data.visibility };
}

export async function acceptedSnapshotFieldConsent(
  tx: Tx, account: SocialAccount, snapshot: MetricsSnapshot,
  owner: string, field: string, now: Date, minimumVisibility: "PUBLIC" | "BRAND_ONLY" = "PUBLIC",
  locked?: EvidenceActorLocks, reader?: EvidenceReceiptReader,
): Promise<boolean> {
  reader?.checkpoint();
  try {
    if (!Number.isFinite(now.getTime()) || !["PUBLIC", "BRAND_ONLY"].includes(minimumVisibility)
      || !metricFields(snapshot).includes(field) || snapshot.accountId !== account.id || snapshot.mappingRevision !== account.mappingRevision) return false;
    const actors = locked ?? await lockEvidenceActors(tx, { creatorIds: [account.creatorId] });
    reader?.checkpoint();
    await lockEvidenceDomain(tx, "Creator", [account.creatorId]);
    reader?.checkpoint();
    await lockEvidenceDomain(tx, "SocialAccount", [account.id]);
    reader?.checkpoint();
    await tx.$queryRaw`SELECT id FROM "MetricsSnapshot" WHERE id=${snapshot.id} FOR SHARE`;
    reader?.checkpoint();
    const creator = await tx.creator.findUnique({ where: { id: account.creatorId }, select: { id: true, userId: true } });
    reader?.checkpoint();
    const current = await tx.socialAccount.findUnique({ where: { id: account.id } });
    reader?.checkpoint();
    const observation = await tx.metricsSnapshot.findUnique({ where: { id: snapshot.id } });
    reader?.checkpoint();
    if (!creator || creator.userId !== owner || !currentCreatorOwner(actors, creator) || !current
      || current.creatorId !== account.creatorId || current.mappingRevision !== account.mappingRevision
      || current.evidenceRevision !== account.evidenceRevision || accountIdentityHash(current) !== accountIdentityHash(account)
      || !observation || observation.accountId !== account.id || observation.mappingRevision !== current.mappingRevision
      || observation.excludedAt || observation.observedAt > now || observation.importedAt > now
      || !observation.approvedAt || observation.approvedAt > now || observation.reviewStatus !== "VERIFIED"
      || snapshotScopeHash(observation) !== snapshotScopeHash(snapshot) || !current.factsApprovedAt || current.factsApprovedAt > now) return false;
    reader?.checkpoint();
    const user = await tx.user.findUnique({ where: { id: owner }, select: { active: true, role: true } });
    reader?.checkpoint();
    if (!user?.active || user.role !== "CREATOR") return false;
    const accepts = (visibility: unknown) => visibility === "PUBLIC" || minimumVisibility === "BRAND_ONLY" && visibility === "BRAND_ONLY";
    if (!accepts(record(current.fieldVisibility)[field])) return false;

    const scope = { resourceType: "MetricsSnapshot", resourceId: observation.id, actorUserId: owner };
    const rows: EvidenceCommand[] = reader ? [] : await tx.evidenceCommand.findMany({ where: scope });
    if (reader) for await (const row of reader.scan(tx, scope)) rows.push(row);
    let selected: Approval | null = null;
    const revisionCounts = new Map<number, number>();
    const opaque: EvidenceCommand[] = [];
    for (const row of rows) {
      reader?.checkpoint();
      // Future/out-of-chronology history cannot validate or silently revive an
      // older permission. Preserve it as an uncertainty barrier.
      const validTime = row.createdAt >= observation.importedAt
        && row.createdAt <= current.factsApprovedAt && row.createdAt <= now;
      const candidate = validTime ? approvalBinding(row, current, observation, owner) : null;
      if (!candidate) { opaque.push(row); continue; }
      revisionCounts.set(candidate.revision, (revisionCounts.get(candidate.revision) ?? 0) + 1);
      if (!Object.hasOwn(candidate.visibility, field)) continue;
      if (!selected || candidate.revision > selected.revision) selected = candidate;
    }
    if (!selected || !accepts(selected.visibility[field])) return false;
    if ([...revisionCounts].some(([value, count]) => {
      reader?.checkpoint();
      return value >= selected!.revision && count > 1;
    })) return false;
    // An opaque newer receipt could have withdrawn this field. A subsequent
    // complete chosen-field approval may supersede older uncertainty.
    return !opaque.some(row => {
      reader?.checkpoint();
      const value = record(row.resultJson).revision;
      return row.createdAt >= selected!.at || revision(value) && value >= selected!.revision;
    });
  } finally { reader?.checkpoint(); }
}
