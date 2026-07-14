import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, ok, parseBody, requireRole } from "@/lib/api";

export const GET = handler(async () => {
  await requireRole("ADMIN");
  const categories = await prisma.category.findMany({
    include: { _count: { select: { skills: true, providers: true, projects: true } } },
    orderBy: { sortOrder: "asc" },
  });
  return ok({
    categories: categories.map((c) => ({
      id: c.id,
      nameAr: c.nameAr,
      nameEn: c.nameEn,
      count: c.demoCount,
      skills: c._count.skills,
      providers: c._count.providers,
      projects: c._count.projects,
    })),
  });
});

const schema = z.object({
  nameAr: z.string().min(2).max(80),
  nameEn: z.string().min(2).max(80),
  description: z.string().max(500).optional(),
});

export const POST = handler(async (req: Request) => {
  await requireRole("ADMIN");
  const body = await parseBody(req, schema);
  const last = await prisma.category.findFirst({ orderBy: { sortOrder: "desc" } });
  const category = await prisma.category.create({
    data: { ...body, sortOrder: (last?.sortOrder ?? 0) + 1 },
  });
  return ok({ category });
});
