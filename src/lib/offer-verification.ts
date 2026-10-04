import { Prisma } from "@prisma/client";
import { z } from "zod";
import { CountryCodeSchema } from "@/lib/contracts/vocabulary";
import type { CampaignRequirementsDTO } from "@/lib/campaigns/contracts";
import { lockEvidenceActors, type EvidenceActorLocks } from "@/lib/evidence/readiness";

export const PhoneFallbackPolicySchema = z.object({ schemaVersion: z.literal(1), kind: z.literal("PHONE_FALLBACK"),
  countryCode: CountryCodeSchema, marketCountryCodes: z.array(CountryCodeSchema).min(1).max(249),
  reviewedBasis: z.literal("FOUNDER_APPROVED_LEGAL_REVIEW"), reviewReference: z.string().trim().min(1).max(1000),
  method: z.literal("DOCUMENTED_ADMIN_REVIEW"), description: z.string().trim().min(1).max(5000),
}).strict();

// The OTP adapter records this exact server-created binding only after actual
// provider confirmation. A timestamp or typed phone number alone is insufficient.
export function phoneVerificationTarget(phone: string, phoneCountryCode: string): string {
  z.string().regex(/^\+[1-9][0-9]{7,14}$/).parse(phone);
  CountryCodeSchema.parse(phoneCountryCode);
  return JSON.stringify({ phone, phoneCountryCode, provider: "twilio-verify" });
}
export async function offerVerificationSatisfied(tx: Prisma.TransactionClient, brandUserId: string,
  requirements: CampaignRequirementsDTO, now = new Date(), locked?: EvidenceActorLocks): Promise<boolean> {
  const actors = locked ?? await lockEvidenceActors(tx, { otherOwnerIds: [brandUserId], includePolicies: true });
  if (!actors.ownerIds.has(brandUserId)) return false;
  const user = await tx.user.findUnique({ where: { id: brandUserId } });
  if (!user?.active || user.role !== "BRAND" || !user.emailVerifiedAt || user.emailVerifiedAt > now) return false;
  const through = new Date(Math.max(Date.parse(requirements.period.endsAt), now.getTime()));
  if (user.phone && user.phoneVerifiedAt && user.phoneVerifiedAt <= now) {
    const tokens = await tx.authToken.findMany({ where: { userId: brandUserId, purpose: "PHONE_VERIFY", usedAt: user.phoneVerifiedAt, destination: { not: null } }, take: 5 });
    const supported = (process.env.SMS_SUPPORTED_COUNTRIES ?? "").split(",").map((c) => c.trim()).filter((c) => CountryCodeSchema.safeParse(c).success);
    if (tokens.some((t) => {
      if (t.expiresAt < t.usedAt! || t.attempts > t.maxAttempts || !/^[a-f0-9]{64}$/.test(t.tokenHash)) return false;
      try {
        const target = z.object({ phone: z.string(), phoneCountryCode: CountryCodeSchema, provider: z.literal("twilio-verify") }).strict().parse(JSON.parse(t.destination!));
        return target.phone === user.phone && supported.includes(target.phoneCountryCode) && t.destination === phoneVerificationTarget(user.phone!, target.phoneCountryCode);
      } catch { return false; }
    })) return true;
  }
  let fallbacks = await tx.verificationFallback.findMany({ where: { userId: brandUserId, countryCode: requirements.brandCountryCode, status: "VERIFIED", reviewedAt: { lte: now },
    reviewedBy: { not: null }, evidenceAssetId: { not: null }, OR: [{ expiresAt: null }, { expiresAt: { gte: through } }] } });
  const policyRefs = await tx.policyVersion.findMany({ where: { id: { in: fallbacks.map((f) => f.policyVersion) } }, select: { reviewedBy: true } });
  const reviewerIds = [...new Set([...fallbacks.map((f) => f.reviewedBy), ...policyRefs.map((p) => p.reviewedBy)].filter((id): id is string => id !== null))].sort();
  if (reviewerIds.some(id => !actors.reviewerIds.has(id))) return false;
  const fallbackIds = fallbacks.map((f) => f.id).sort();
  if (fallbackIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM "VerificationFallback" WHERE id IN (${Prisma.join(fallbackIds)}) ORDER BY id FOR SHARE`);
  const policyIds = [...new Set(fallbacks.map((f) => f.policyVersion))].sort();
  if (policyIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM "PolicyVersion" WHERE id IN (${Prisma.join(policyIds)}) ORDER BY id FOR SHARE`);
  fallbacks = await tx.verificationFallback.findMany({ where: { id: { in: fallbackIds }, status: "VERIFIED", reviewedAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gte: through } }] } });
  const currentPolicies = await tx.policyVersion.findMany({ where: { id: { in: policyIds } }, select: { evidenceAssetId: true } });
  const assetIds = [...new Set([...fallbacks.map((f) => f.evidenceAssetId), ...currentPolicies.map((p) => p.evidenceAssetId)].filter((id): id is string => id !== null))].sort();
  if (assetIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM "PrivateAsset" WHERE id IN (${Prisma.join(assetIds)}) ORDER BY id FOR SHARE`);
  for (const fallback of fallbacks) {
    if (fallback.userId !== brandUserId || fallback.countryCode !== requirements.brandCountryCode || !policyIds.includes(fallback.policyVersion) || !fallback.reviewedAt) continue;
    const [reviewer, policy, evidence] = await Promise.all([
      tx.user.findUnique({ where: { id: fallback.reviewedBy! }, select: { active: true, role: true } }),
      tx.policyVersion.findUnique({ where: { id: fallback.policyVersion } }),
      tx.privateAsset.findUnique({ where: { id: fallback.evidenceAssetId! } }),
    ]);
    const content = PhoneFallbackPolicySchema.safeParse(policy?.content);
    if (!actors.reviewerIds.has(fallback.reviewedBy!) || !reviewer?.active || reviewer.role !== "ADMIN" || !policy || policy.kind !== "PHONE_FALLBACK" || policy.status !== "VERIFIED" || !policy.reviewedBy || !actors.reviewerIds.has(policy.reviewedBy) || !policy.reviewedAt || policy.reviewedAt > now || policy.reviewedAt < policy.createdAt || !policy.evidenceAssetId || (policy.expiresAt && policy.expiresAt < through) || !policy.countryCodes.includes(requirements.brandCountryCode) || !content.success || content.data.countryCode !== requirements.brandCountryCode || !requirements.marketCountryCodes.every((c) => content.data.marketCountryCodes.includes(c))) continue;
    const [policyReviewer, policyEvidence] = await Promise.all([
      tx.user.findUnique({ where: { id: policy.reviewedBy }, select: { active: true, role: true } }),
      tx.privateAsset.findUnique({ where: { id: policy.evidenceAssetId } }),
    ]);
    if (policyReviewer?.active && policyReviewer.role === "ADMIN" && policyEvidence && !policyEvidence.deletedAt && policyEvidence.purpose === "LEGAL_POLICY_REVIEW" && policyEvidence.ownerUserId === policy.reviewedBy && evidence && !evidence.deletedAt && evidence.purpose === "CONTACT_VERIFICATION" && [brandUserId, fallback.reviewedBy!].includes(evidence.ownerUserId)) return true;
  }
  return false;
}
