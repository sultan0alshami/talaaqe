import { prisma } from "@/lib/prisma";
import { ProjectsScreen } from "@/components/screens/admin/projects-screen";

// Admin projects — mirrors GET /api/admin/projects.
export default async function AdminProjectsPage() {
  const projects = await prisma.project.findMany({
    include: { client: { include: { user: true } }, category: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <ProjectsScreen
      projects={projects.map((p) => ({
        id: p.id,
        titleAr: p.titleAr,
        titleEn: p.titleEn,
        clientAr: p.client.user.companyName ?? p.client.user.name,
        clientEn: p.client.user.nameEn ?? p.client.user.companyName ?? p.client.user.name,
        categoryAr: p.category?.nameAr ?? null,
        categoryEn: p.category?.nameEn ?? null,
        status: p.status,
        budgetMin: p.budgetMin,
        budgetMax: p.budgetMax,
        createdAt: p.createdAt.toISOString(),
      }))}
    />
  );
}
