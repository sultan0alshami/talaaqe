import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { getDiscoveryPage } from "@/lib/discovery/service";
import type { DiscoveryPage } from "@/lib/discovery/contracts";
import { discoveryCountryOptions } from "@/lib/discovery/presentation";
import { CreatorDiscoveryScreen } from "@/components/infame/creator-discovery";
import { collectionPageError, getCollectionPageContext, type CollectionPageContext } from "@/lib/collections/page-context";

export default async function BrandCreatorsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageSession("BRAND");
  let page: DiscoveryPage | null = null;
  let initialError: string | null = null;
  let collections: CollectionPageContext = { scope: null, initialPage: null, planAuthority: null };
  const search = await searchParams;
  try {
    page = await getDiscoveryPage(actor);
  } catch (error) {
    const status = error instanceof Error && "status" in error ? error.status : 500;
    if (status === 401) redirect("/login");
    initialError = status === 403 ? "FORBIDDEN" : "RETRY_REQUIRED";
  }
  try { collections = await getCollectionPageContext(actor, search); }
  catch (error) { const code = collectionPageError(error); if (code === "UNAUTHENTICATED") redirect("/login"); }
  return <CreatorDiscoveryScreen key={`${actor.userId}:${search.clientId ?? "own"}`} initialPage={page} initialError={initialError}
    collectionScope={collections.scope} planAuthority={collections.planAuthority}
    countryOptions={discoveryCountryOptions()} />;
}
