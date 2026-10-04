import { requirePageSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RoleDashboard } from "@/components/infame/role-dashboard";
export default async function BrandPage() {
  const actor = await requirePageSession("BRAND");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { emailVerifiedAt: true, brand: { select: { state: true, _count: { select: { deals: true, campaigns: true } } } } } });
  return <RoleDashboard name={actor.name} role="BRAND" state={user.brand?.state ?? "DRAFT"} emailVerified={!!user.emailVerifiedAt} deals={user.brand?._count.deals ?? 0} campaigns={user.brand?._count.campaigns ?? 0} />;
}
