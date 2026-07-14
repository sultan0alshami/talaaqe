import { prisma } from "@/lib/prisma";
import { handler, ok } from "@/lib/api";

// Public: categories for the landing grid and the signup specialty select.
export const GET = handler(async () => {
  const categories = await prisma.category.findMany({ orderBy: { sortOrder: "asc" } });
  return ok({
    categories: categories.map((c) => ({
      id: c.id,
      nameAr: c.nameAr,
      nameEn: c.nameEn,
      count: c.demoCount,
    })),
  });
});
