import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { getClientGrants } from "@/lib/organizations/management";
import { OrganizationError } from "@/lib/organizations/contracts";
import { ClientGrantManagement } from "@/components/infame/client-grant-management";
export default async function ClientGrantsPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePageSession("BRAND"), { id } = await params, query = await searchParams;
  const input = Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined));
  let initial = null, initialError;
  try { initial = await getClientGrants(actor, id, input); }
  catch (error) {
    if (!(error instanceof OrganizationError)) throw error;
    if (error.code === "UNAUTHENTICATED") redirect("/login"); initialError = error.code;
  }
  const after = typeof query.after === "string" ? query.after : undefined;
  return <ClientGrantManagement key={JSON.stringify([id, after ?? null])} clientId={id} initial={initial} initialError={initialError} after={after} />;
}
