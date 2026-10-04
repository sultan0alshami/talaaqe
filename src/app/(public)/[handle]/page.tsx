import { notFound } from "next/navigation";
import { publicCreator } from "@/lib/onboarding/profiles";
import { PublicPortfolio } from "@/components/infame/public-portfolio";
import { BRAND } from "@/lib/brand";
import { normalizeInfameHandle } from "@/lib/contracts/vocabulary";

function routeHandle(segment: string): string | null {
  try {
    // Next's page params may encode the @ prefix while metadata params are raw.
    // Decode once; malformed, double-encoded and non-handle paths stay private.
    const decoded = decodeURIComponent(segment);
    if (!/^@[a-z0-9][a-z0-9_]{2,29}$/i.test(decoded)) return null;
    return normalizeInfameHandle(decoded.slice(1));
  } catch { return null; }
}
export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const normalized = routeHandle(handle);
  const creator = normalized ? await publicCreator(normalized) : null;
  return creator ? { title: `${creator.displayName} | ${BRAND.nameAr}`, alternates: { canonical: `${BRAND.url}/@${creator.handle}` } } : { title: "إنفيم", robots: { index: false, follow: false } };
}
export default async function Page({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const normalized = routeHandle(handle);
  if (!normalized) notFound();
  const creator = await publicCreator(normalized);
  if (!creator) notFound();
  return <PublicPortfolio creator={creator} />;
}
