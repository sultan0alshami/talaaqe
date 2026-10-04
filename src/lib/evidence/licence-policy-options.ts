import { z } from "zod";
import { active, canonicalHash, Id, identityHash, lock, parse, record, transaction, type EvidenceOptions } from "./common";
import { EvidenceError } from "./storage";
import { MarketPolicyContentSchema } from "@/lib/policies";
import { privateAssetAccepted } from "./readiness";
import { licenceScope } from "./verifications";

export const LicencePolicyOptionsQuerySchema = z.object({ cursor: Id.optional(), limit: z.number().int().min(1).max(50).default(25) }).strict();
export type LicencePolicyOption = { id: string; licencePolicyId: string; marketCountryCode: string; reviewReference: string; reviewedAt: string; expiresAt: string | null };
export async function listLicencePolicyOptions(actor: string, licenceId: string, options: EvidenceOptions, query: unknown = {}) {
  parse(Id, licenceId); const input = parse(LicencePolicyOptionsQuerySchema, query);
  return transaction(options, actor, async (tx, _now, boundary) => {
    const actorBefore = await tx.user.findUnique({ where: { id: actor }, select: { active: true, role: true } });
    if (!actorBefore?.active || actorBefore.role !== "ADMIN") throw new EvidenceError("FORBIDDEN", 403);
    const initial = await tx.advertisingLicence.findUnique({ where: { id: licenceId } });
    const ownerBefore = initial ? await tx.creator.findUnique({ where: { id: initial.creatorId }, select: { userId: true } }) : null;
    if (!initial || !ownerBefore?.userId) throw new EvidenceError("NOT_FOUND", 404);
    const candidates = await tx.policyVersion.findMany({ where: { kind: "MARKET", status: "VERIFIED", countryCodes: { has: initial.jurisdiction },
      ...(input.cursor ? { id: { gt: input.cursor } } : {}) }, orderBy: { id: "asc" }, take: input.limit + 1 });
    // Same ordering as mutations: resource owner, sorted reviewers, domain rows.
    // Inactive candidate reviewers are retained only to be excluded after locks.
    await active(tx, ownerBefore.userId, "CREATOR");
    const reviewerIds = [...new Set([actor, ...candidates.flatMap(p => p.reviewedBy ? [p.reviewedBy] : [])])].sort();
    for (const id of reviewerIds) await lock(tx, "User", id, true);
    const reviewers = await tx.user.findMany({ where: { id: { in: reviewerIds }, active: true, role: "ADMIN" }, select: { id: true } });
    const activeReviewers = new Set(reviewers.map(r => r.id));
    if (!activeReviewers.has(actor)) throw new EvidenceError("FORBIDDEN", 403);
    await lock(tx, "Creator", initial.creatorId, true);
    await lock(tx, "AdvertisingLicence", licenceId, true);
    const creator = await tx.creator.findUniqueOrThrow({ where: { id: initial.creatorId } });
    const licence = await tx.advertisingLicence.findUniqueOrThrow({ where: { id: licenceId } });
    if (creator.userId !== ownerBefore.userId || licence.creatorId !== creator.id || licence.jurisdiction !== initial.jurisdiction) throw new EvidenceError("STALE_OWNER");
    const submission = await tx.evidenceCommand.findFirst({ where: { resourceType: "AdvertisingLicence", resourceId: licenceId, actorUserId: creator.userId }, orderBy: { createdAt: "asc" } });
    const metadata = record(submission?.resultJson);
    if (metadata.ownerUserId !== creator.userId || metadata.creatorCountryCode !== creator.countryCode || metadata.scopeHash !== canonicalHash(licenceScope(licence))) throw new EvidenceError("STALE_IDENTITY");
    const bindings = z.array(z.object({ accountId: Id, mappingRevision: z.number().int().positive(), identityHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(20).safeParse(metadata.scopeBindings);
    if (!bindings.success || bindings.data.length !== licence.accountIds.length || new Set(bindings.data.map(b => b.accountId)).size !== bindings.data.length) throw new EvidenceError("STALE_IDENTITY");
    for (const binding of [...bindings.data].sort((a, b) => a.accountId.localeCompare(b.accountId))) {
      await lock(tx, "SocialAccount", binding.accountId, true);
      const account = await tx.socialAccount.findUnique({ where: { id: binding.accountId } });
      if (!account || account.creatorId !== creator.id || !licence.accountIds.includes(account.id) || !licence.platformScope.includes(account.platform)
        || account.mappingRevision !== binding.mappingRevision || identityHash(account) !== binding.identityHash) throw new EvidenceError("STALE_IDENTITY");
    }
    const page = candidates.slice(0, input.limit);
    for (const candidate of [...page].sort((a, b) => a.id.localeCompare(b.id))) await lock(tx, "PolicyVersion", candidate.id, true);
    const now = await boundary.checkpoint(), available: LicencePolicyOption[] = [];
    for (const candidate of page) {
      const policy = await tx.policyVersion.findUnique({ where: { id: candidate.id } });
      const content = MarketPolicyContentSchema.safeParse(policy?.content);
      if (!policy || policy.kind !== "MARKET" || policy.status !== "VERIFIED" || policy.reviewedBy !== candidate.reviewedBy || !policy.reviewedBy || !activeReviewers.has(policy.reviewedBy)
        || !policy.reviewedAt || policy.reviewedAt > now || policy.reviewedAt < policy.createdAt || policy.expiresAt && policy.expiresAt <= now
        || !policy.evidenceAssetId || !policy.countryCodes.includes(licence.jurisdiction) || !content.success || !content.data.licencePolicyId
        || content.data.marketCountryCode !== licence.jurisdiction || !creator.countryCode || !content.data.creatorCountryCodes.includes(creator.countryCode)
        || !await privateAssetAccepted(tx, policy.evidenceAssetId, policy.reviewedBy, "LEGAL_POLICY_REVIEW", policy.reviewedAt)) continue;
      const reviewReference = record(policy.content).reviewReference;
      if (typeof reviewReference !== "string") continue;
      available.push({ id: policy.id, licencePolicyId: content.data.licencePolicyId, marketCountryCode: content.data.marketCountryCode,
        reviewReference, reviewedAt: policy.reviewedAt.toISOString(), expiresAt: policy.expiresAt?.toISOString() ?? null });
    }
    const finalNow = await boundary.checkpoint();
    const current = available.filter(p => !p.expiresAt || Date.parse(p.expiresAt) > finalNow.getTime());
    await tx.adminAudit.create({ data: { actorUserId: actor, action: "evidence.licence_policy_options_accessed", resourceType: "AdvertisingLicence", resourceId: licenceId,
      snapshot: { jurisdiction: licence.jurisdiction, creatorCountryCode: creator.countryCode, count: current.length }, createdAt: finalNow } });
    return { licenceId, jurisdiction: licence.jurisdiction, creatorCountryCode: creator.countryCode,
      options: current, nextCursor: candidates.length > input.limit ? page.at(-1)!.id : null };
  });
}
