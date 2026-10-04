import type { Metadata } from "next";
import { LandingScreen } from "@/components/talaqee-site/landing";
import { NICHE_TAXONOMY } from "@/lib/contracts/taxonomy";

export const metadata: Metadata = { alternates: { canonical: "/classic" } };

export default function ClassicPage() {
  const categories = NICHE_TAXONOMY.filter((item) => item.parentSlug === null).slice(0, 16).map((item) => ({ id: item.slug, nameAr: item.labelAr, nameEn: item.labelEn }));
  return <LandingScreen categories={categories} />;
}
