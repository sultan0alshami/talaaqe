import { requirePageSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RoleDashboard } from "@/components/infame/role-dashboard";
export default async function CreatorPage() {
  const actor = await requirePageSession("CREATOR");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { emailVerifiedAt: true, creator: { select: { state: true, _count: { select: { deals: true } } } } } });
  return <RoleDashboard name={actor.name} role="CREATOR" state={user.creator?.state ?? "DRAFT"} emailVerified={!!user.emailVerifiedAt} deals={user.creator?._count.deals ?? 0} campaigns={0} />;
}
