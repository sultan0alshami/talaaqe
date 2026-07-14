import { prisma } from "@/lib/prisma";
import { handler, ok, requireRole } from "@/lib/api";

export const GET = handler(async () => {
  await requireRole("ADMIN");
  const projects = await prisma.project.findMany({
    include: { client: { include: { user: true } }, category: true },
    orderBy: { createdAt: "desc" },
  });
  return ok({
    projects: projects.map((p) => ({
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
    })),
  });
});
