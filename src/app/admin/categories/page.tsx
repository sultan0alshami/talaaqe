import { prisma } from "@/lib/prisma";
import { CategoriesScreen } from "@/components/screens/admin/categories-screen";

// Admin categories & skills — mirrors GET /api/admin/categories + /api/admin/skills.
export default async function AdminCategoriesPage() {
  const [categories, skills] = await Promise.all([
    prisma.category.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.skill.findMany({ include: { category: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <CategoriesScreen
      categories={categories.map((c) => ({
        id: c.id,
        nameAr: c.nameAr,
        nameEn: c.nameEn,
        count: c.demoCount,
      }))}
      skills={skills.map((s) => ({
        id: s.id,
        name: s.name,
        categoryId: s.categoryId,
        categoryAr: s.category.nameAr,
        categoryEn: s.category.nameEn,
      }))}
    />
  );
}
