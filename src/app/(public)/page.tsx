import { prisma } from "@/lib/prisma";
import { LandingScreen } from "@/components/screens/public/landing";

export default async function LandingPage() {
  const categories = await prisma.category.findMany({
    orderBy: { sortOrder: "asc" },
    select: { id: true, nameAr: true, nameEn: true, demoCount: true },
  });

  return (
    <LandingScreen
      categories={categories.map((c) => ({
        id: c.id,
        nameAr: c.nameAr,
        nameEn: c.nameEn,
        count: c.demoCount,
      }))}
    />
  );
}
