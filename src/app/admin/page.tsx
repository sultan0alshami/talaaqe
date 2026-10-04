import { requirePageSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OverviewScreen } from "@/components/screens/admin/overview-screen";
import { sevenDaysAgo } from "@/lib/clock";

// Admin overview — mirrors GET /api/admin/overview.
export default async function AdminOverviewPage() {
  await requirePageSession("ADMIN");
  const weekAgo = sevenDaysAgo();
  const [users, clients, providers, projects, weekly, briefs, pending, avgScore, topCats, pendingProviders] =
    await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { role: "BRAND" } }),
      prisma.user.count({ where: { role: "CREATOR" } }),
      prisma.project.count(),
      prisma.project.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.brief.count(),
      prisma.provider.count({ where: { verifiedStatus: "PENDING" } }),
      prisma.match.aggregate({ _avg: { matchScore: true } }),
      prisma.category.findMany({ orderBy: { demoCount: "desc" }, take: 6 }),
      prisma.provider.findMany({
        where: { verifiedStatus: "PENDING" },
        include: { user: true },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
    ]);

  return (
    <OverviewScreen
      users={users}
      clients={clients}
      providers={providers}
      projects={projects}
      weekly={weekly}
      briefs={briefs}
      pending={pending}
      matchRate={Math.round(avgScore._avg.matchScore ?? 0)}
      topCats={topCats.map((c) => ({ ar: c.nameAr, en: c.nameEn, v: c.demoCount }))}
      pendingProviders={pendingProviders.map((p) => ({
        id: p.id,
        nameAr: p.user.name,
        nameEn: p.user.nameEn ?? p.user.name,
        roleAr: p.roleTitleAr ?? "",
        roleEn: p.roleTitleEn ?? "",
        cityAr: p.locationAr ?? "",
        cityEn: p.locationEn ?? "",
        date: p.createdAt.toISOString(),
      }))}
    />
  );
}
