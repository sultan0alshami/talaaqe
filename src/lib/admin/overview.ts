import { Prisma } from "@prisma/client";
import { AdminOverviewSchema, type AdminOverviewDTO } from "./contracts";
import { adminRead, type AdminActor, type AdminOptions } from "./context";

async function pendingCounts(tx: Prisma.TransactionClient): Promise<AdminOverviewDTO["pending"]> {
  const counts = await Promise.all([
    tx.ownershipChallenge.count({ where: { status: "PENDING" } }),
    tx.metricsSnapshot.count({ where: { reviewStatus: "PENDING", source: { in: ["SELF_REPORTED", "SCREENSHOT_VERIFIED"] }, evidenceAssetId: { not: null } } }),
    tx.advertisingLicence.count({ where: { status: "PENDING" } }),
    tx.businessVerification.count({ where: { status: "PENDING", kind: "REPRESENTATIVE" } }),
    tx.businessVerification.count({ where: { status: "PENDING", kind: "BUSINESS_REGISTRATION" } }),
  ]);
  return (["OWNERSHIP", "SCREENSHOT", "ADVERTISING_LICENCE", "REPRESENTATIVE", "BUSINESS_REGISTRATION"] as const).map((kind, index) => ({ kind, count: counts[index] }));
}

export async function getAdminPendingCount(actor: AdminActor, options: AdminOptions = {}) {
  return adminRead(actor, options, async tx => (await pendingCounts(tx)).reduce((sum, row) => sum + row.count, 0));
}

export async function getAdminOverview(actor: AdminActor, options: AdminOptions = {}): Promise<AdminOverviewDTO> {
  return adminRead(actor, options, async (tx, asOf) => {
    // Stored records include all states/private/test/suspended rows. These
    // canonical counts do not assert traction, eligibility or current trust.
    const users = await tx.user.count();
    const [brandAccounts, creatorAccounts, campaigns, weeklyCampaigns, briefVersions, deals, pending, challenges] = await Promise.all([
      tx.user.count({ where: { role: "BRAND" } }), tx.user.count({ where: { role: "CREATOR" } }), tx.campaign.count(),
      tx.campaign.count({ where: { createdAt: { gte: new Date(asOf.getTime() - 7 * 86400000), lte: asOf } } }), tx.campaignBrief.count(), tx.deal.count(), pendingCounts(tx),
      tx.ownershipChallenge.findMany({ where: { status: "PENDING" }, orderBy: { id: "asc" }, take: 8, select: { id: true, accountId: true, createdAt: true, proofAssetId: true } }),
    ]);
    const accounts = await tx.socialAccount.findMany({ where: { id: { in: challenges.map(row => row.accountId) } }, select: { id: true, platform: true, handle: true } });
    const result = AdminOverviewSchema.parse({ asOf: asOf.toISOString(), scope: "ALL_STORED_RECORDS", counts: { users, brandAccounts, creatorAccounts, campaigns, weeklyCampaigns, briefVersions, deals, pendingEvidence: pending.reduce((sum, row) => sum + row.count, 0) }, pending,
      ownershipPreview: challenges.map(row => { const account = accounts.find(item => item.id === row.accountId); return { id: row.id, platform: account?.platform ?? "UNKNOWN", handle: account?.handle ?? "—", startedAt: row.createdAt.toISOString(), hasEvidenceReference: row.proofAssetId !== null }; }),
    });
    await tx.adminAudit.create({ data: { actorUserId: actor.userId, action: "admin.overview_accessed", resourceType: "AdminOverview", resourceId: "platform", snapshot: { asOf: result.asOf, scope: result.scope, counts: result.counts } } });
    return result;
  });
}
