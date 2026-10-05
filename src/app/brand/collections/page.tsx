import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { collectionPageError, getCollectionPageContext, type CollectionPageContext } from "@/lib/collections/page-context";
import { discoveryCountryOptions } from "@/lib/discovery/presentation";
import { CreatorCollectionsScreen } from "@/components/infame/creator-collections";

export default async function BrandCollectionsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePageSession("BRAND");
  const search = await searchParams;
  let context: CollectionPageContext = { scope: null, initialPage: null, planAuthority: null }, initialError: string | null = null;
  try { context = await getCollectionPageContext(actor, search); }
  catch (error) { initialError = collectionPageError(error); if (initialError === "UNAUTHENTICATED") redirect("/login"); }
  return <CreatorCollectionsScreen key={`${actor.userId}:${search.clientId ?? "own"}`} {...context}
    initialError={initialError} countryOptions={discoveryCountryOptions()} />;
}
