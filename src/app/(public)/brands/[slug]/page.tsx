import { notFound } from "next/navigation";
import { publicBrand } from "@/lib/onboarding/profiles";
import { PublicPortfolio } from "@/components/infame/public-portfolio";
import { BRAND } from "@/lib/brand";
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const brand = await publicBrand((await params).slug);
  return brand ? { title: `${brand.name} | ${BRAND.nameAr}`, alternates: { canonical: `${BRAND.url}/brands/${brand.slug}` } } : { title: "إنفيم", robots: { index: false, follow: false } };
}
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const brand = await publicBrand((await params).slug);
  if (!brand) notFound();
  return <PublicPortfolio brand={brand} />;
}
