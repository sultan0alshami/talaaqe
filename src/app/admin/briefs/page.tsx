import { prisma } from "@/lib/prisma";
import { toBriefDTO } from "@/lib/dto";
import { BriefsScreen } from "@/components/screens/admin/briefs-screen";

// Admin briefs review — mirrors GET /api/admin/briefs.
export default async function AdminBriefsPage() {
  const briefs = await prisma.brief.findMany({
    include: { project: { include: { client: { include: { user: true } }, category: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <BriefsScreen
      briefs={briefs.map((b) => ({
        ...toBriefDTO(b),
        clientAr: b.project.client.user.companyName ?? b.project.client.user.name,
        clientEn: b.project.client.user.nameEn ?? b.project.client.user.companyName ?? b.project.client.user.name,
        categoryAr: b.project.category?.nameAr ?? null,
        categoryEn: b.project.category?.nameEn ?? null,
        createdAt: b.createdAt.toISOString(),
      }))}
    />
  );
}
