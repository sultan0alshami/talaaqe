import { requirePageSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RoleDashboard } from "@/components/infame/role-dashboard";
import { listDeals } from "@/lib/deals/service";
import { getLegacyCampaignOverview } from "@/lib/campaign-planning/legacy";
export default async function BrandPage() {
  const actor = await requirePageSession("BRAND");
  const dealWhere = { brand: { userId: actor.userId }, offers: { some: { version: 1, proposerUserId: actor.userId } } };
  const [user, campaignOverview, deals, pendingDeals, activeDeals, completedDeals, recent] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { emailVerifiedAt: true, brand: { select: { state: true } } } }),
    getLegacyCampaignOverview(actor),
    prisma.deal.count({ where: dealWhere }),
    prisma.deal.count({ where: { ...dealWhere, status: { in: ["OFFERED", "COUNTERED"] } } }),
    prisma.deal.count({ where: { ...dealWhere, status: { in: ["ACCEPTED", "AGREED", "DELIVERED"] } } }),
    prisma.deal.count({ where: { ...dealWhere, status: "COMPLETED" } }),
    listDeals(actor.userId, { limit: 3 }, { serverAuth: actor }),
  ]);
  return <RoleDashboard name={actor.name} role="BRAND" state={user.brand?.state ?? "DRAFT"} emailVerified={!!user.emailVerifiedAt} deals={deals} campaigns={campaignOverview.campaignCount}
    pendingDeals={pendingDeals} activeDeals={activeDeals} completedDeals={completedDeals}
    recentCampaigns={campaignOverview.recentCampaigns}
    recentDeals={recent.deals.map(deal => ({ id: deal.id, campaignTitle: null, status: deal.status, amount: deal.currentOffer.terms.amount, offerVersion: deal.currentOffer.version, updatedAt: deal.updatedAt }))} />;
}
