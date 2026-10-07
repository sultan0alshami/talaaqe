import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { brandContextPageError, getBrandContextPageContext } from "@/lib/brand-context/page-context";
import type { BrandContextScreenProps } from "@/lib/brand-context/ui-contract";
import { BrandContextScreen } from "@/components/infame/brand-context";

export default async function BrandContextPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePageSession("BRAND"), search = await searchParams;
  let context: BrandContextScreenProps = { scope: null, initialPage: null, planAuthority: null }, initialError: string | null = null;
  try { context = await getBrandContextPageContext(actor, search); }
  catch (error) { initialError = brandContextPageError(error); if (initialError === "UNAUTHENTICATED") redirect("/login"); }
  return <BrandContextScreen key={`${actor.userId}:${search.clientId ?? "own"}`} {...context} initialError={initialError} />;
}
