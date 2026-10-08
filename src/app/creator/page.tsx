import { requirePageSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RoleDashboard } from "@/components/infame/role-dashboard";
import { listDeals } from "@/lib/deals/service";
export default async function CreatorPage() {
  const actor = await requirePageSession("CREATOR");
  const dealWhere = { offers: { some: { version: 1, recipientUserId: actor.userId } } };
  const [user, deals, pendingDeals, activeDeals, completedDeals, recent] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { emailVerifiedAt: true, creator: { select: { state: true } } } }),
    prisma.deal.count({ where: dealWhere }),
    prisma.deal.count({ where: { ...dealWhere, status: { in: ["OFFERED", "COUNTERED"] } } }),
    prisma.deal.count({ where: { ...dealWhere, status: { in: ["ACCEPTED", "AGREED", "DELIVERED"] } } }),
    prisma.deal.count({ where: { ...dealWhere, status: "COMPLETED" } }),
    listDeals(actor.userId, { limit: 5 }, { serverAuth: actor }),
  ]);
  return <RoleDashboard name={actor.name} role="CREATOR" state={user.creator?.state ?? "DRAFT"} emailVerified={!!user.emailVerifiedAt} deals={deals} campaigns={0}
    pendingDeals={pendingDeals} activeDeals={activeDeals} completedDeals={completedDeals}
    recentDeals={recent.deals.map(deal => ({ id: deal.id, campaignTitle: null, status: deal.status, amount: deal.currentOffer.terms.amount, offerVersion: deal.currentOffer.version, updatedAt: deal.updatedAt }))} />;
}
