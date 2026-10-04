import { notFound } from "next/navigation";
import { publicCreator } from "@/lib/onboarding/profiles";
import { PublicPortfolio } from "@/components/infame/public-portfolio";
import { BRAND } from "@/lib/brand";
export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const creator = handle.startsWith("@") ? await publicCreator(handle.slice(1)) : null;
  return creator ? { title: `${creator.displayName} | ${BRAND.nameAr}`, alternates: { canonical: `${BRAND.url}/@${creator.handle}` } } : { title: "إنفيم", robots: { index: false, follow: false } };
}
export default async function Page({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  if (!handle.startsWith("@")) notFound();
  const creator = await publicCreator(handle.slice(1));
  if (!creator) notFound();
  return <PublicPortfolio creator={creator} />;
}
