import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { getOrganization, getOrganizationClients } from "@/lib/organizations/loaders";
import { OrganizationError } from "@/lib/organizations/contracts";
import { OrganizationClients } from "@/components/infame/organization-clients";
export default async function OrganizationPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePageSession("BRAND"), { id } = await params, query = await searchParams;
  const input = Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined));
  const key = `${id}:${typeof query.after === "string" ? `after:${query.after}` : "first"}`;
  let initial = null, organization = null, initialError;
  try {
    const clients = await getOrganizationClients(actor, id, input);
    const metadata = await getOrganization(actor, id);
    initial = clients; organization = metadata.organization;
  } catch (error) {
    if (!(error instanceof OrganizationError)) throw error;
    if (error.code === "UNAUTHENTICATED") redirect("/login");
    initialError = error.code;
  }
  return <OrganizationClients key={key} organizationId={id} organization={organization} initial={initial} initialError={initialError} after={typeof query.after === "string" ? query.after : undefined} />;
}
