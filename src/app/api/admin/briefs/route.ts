import { prisma } from "@/lib/prisma";
import { handler, ok, requireRole } from "@/lib/api";
import { toBriefDTO } from "@/lib/dto";

export const GET = handler(async () => {
  await requireRole("ADMIN");
  const briefs = await prisma.brief.findMany({
    include: { project: { include: { client: { include: { user: true } }, category: true } } },
    orderBy: { createdAt: "desc" },
  });
  return ok({
    briefs: briefs.map((b) => ({
      ...toBriefDTO(b),
      clientAr: b.project.client.user.companyName ?? b.project.client.user.name,
      clientEn: b.project.client.user.nameEn ?? b.project.client.user.companyName ?? b.project.client.user.name,
      categoryAr: b.project.category?.nameAr ?? null,
      categoryEn: b.project.category?.nameEn ?? null,
      createdAt: b.createdAt.toISOString(),
    })),
  });
});
