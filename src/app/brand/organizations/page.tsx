import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { getOrganizationDirectory } from "@/lib/organizations/directory";
import { OrganizationError } from "@/lib/organizations/contracts";
import { OrganizationSettings } from "@/components/infame/organization-settings";
export default async function OrganizationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageSession("BRAND"), query = await searchParams;
  const input = Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined));
  const key = typeof query.after === "string" ? `after:${query.after}` : "first";
  let initial = null, initialError;
  try { initial = await getOrganizationDirectory(actor, input); }
  catch (error) {
    if (!(error instanceof OrganizationError)) throw error;
    if (error.code === "UNAUTHENTICATED") redirect("/login");
    initialError = error.code;
  }
  return <OrganizationSettings key={key} initial={initial} initialError={initialError} after={typeof query.after === "string" ? query.after : undefined} />;
}
