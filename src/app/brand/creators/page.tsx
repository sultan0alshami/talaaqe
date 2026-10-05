import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { getDiscoveryPage } from "@/lib/discovery/service";
import type { DiscoveryPage } from "@/lib/discovery/contracts";
import { discoveryCountryOptions } from "@/lib/discovery/presentation";
import { CreatorDiscoveryScreen } from "@/components/infame/creator-discovery";

export default async function BrandCreatorsPage() {
  const actor = await requirePageSession("BRAND");
  let page: DiscoveryPage | null = null;
  let initialError: string | null = null;
  try {
    page = await getDiscoveryPage(actor);
  } catch (error) {
    const status = error instanceof Error && "status" in error ? error.status : 500;
    if (status === 401) redirect("/login");
    initialError = status === 403 ? "FORBIDDEN" : "RETRY_REQUIRED";
  }
  return <CreatorDiscoveryScreen key={actor.userId} initialPage={page} initialError={initialError}
    countryOptions={discoveryCountryOptions()} />;
}
