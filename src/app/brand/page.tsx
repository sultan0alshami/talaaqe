import { requirePageSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RoleDashboard } from "@/components/infame/role-dashboard";
import { listDeals } from "@/lib/deals/service";
export default async function BrandPage() {
  const actor = await requirePageSession("BRAND");
  const dealWhere = { brand: { userId: actor.userId }, offers: { some: { version: 1, proposerUserId: actor.userId } } };
  const [user, campaigns, recentCampaigns, deals, pendingDeals, activeDeals, completedDeals, recent] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { emailVerifiedAt: true, brand: { select: { state: true } } } }),
    prisma.campaign.count({ where: { brand: { userId: actor.userId } } }),
    prisma.campaign.findMany({ where: { brand: { userId: actor.userId } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 5, select: { id: true, title: true, status: true, currentBriefVersion: true, updatedAt: true } }),
    prisma.deal.count({ where: dealWhere }),
    prisma.deal.count({ where: { ...dealWhere, status: { in: ["OFFERED", "COUNTERED"] } } }),
    prisma.deal.count({ where: { ...dealWhere, status: { in: ["ACCEPTED", "AGREED", "DELIVERED"] } } }),
    prisma.deal.count({ where: { ...dealWhere, status: "COMPLETED" } }),
    listDeals(actor.userId, { limit: 3 }),
  ]);
  return <RoleDashboard name={actor.name} role="BRAND" state={user.brand?.state ?? "DRAFT"} emailVerified={!!user.emailVerifiedAt} deals={deals} campaigns={campaigns}
    pendingDeals={pendingDeals} activeDeals={activeDeals} completedDeals={completedDeals}
    recentCampaigns={recentCampaigns.map(row => ({ ...row, updatedAt: row.updatedAt.toISOString() }))}
    recentDeals={recent.deals.map(deal => ({ id: deal.id, campaignTitle: null, status: deal.status, amount: deal.currentOffer.terms.amount, offerVersion: deal.currentOffer.version, updatedAt: deal.updatedAt }))} />;
}
