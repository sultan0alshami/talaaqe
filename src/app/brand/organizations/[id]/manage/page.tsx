import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePageSession } from "@/lib/auth";
import { getOrganizationAssociations, getOrganizationMembers } from "@/lib/organizations/management";
import { OrganizationError, OrganizationIdSchema, parseOrganizationInput } from "@/lib/organizations/contracts";
import { OrganizationManagement, type OrganizationManagementSnapshot } from "@/components/infame/organization-management";
export default async function ManageOrganizationPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePageSession("BRAND"), { id } = await params, query = await searchParams;
  let initial: OrganizationManagementSnapshot | null = null, initialError;
  let membersAfter: string | undefined, clientsAfter: string | undefined;
  try {
    const input = parseOrganizationInput(z.object({ membersAfter: OrganizationIdSchema.optional(), clientsAfter: OrganizationIdSchema.optional() }).strict(),
      Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined)));
    membersAfter = input.membersAfter; clientsAfter = input.clientsAfter;
    const [members, associations] = await Promise.all([getOrganizationMembers(actor, id, { ...(membersAfter ? { after: membersAfter } : {}) }),
      getOrganizationAssociations(actor, id, { ...(clientsAfter ? { after: clientsAfter } : {}) })]);
    initial = { members, associations };
  } catch (error) {
    if (!(error instanceof OrganizationError)) throw error;
    if (error.code === "UNAUTHENTICATED") redirect("/login"); initialError = error.code;
  }
  return <OrganizationManagement key={JSON.stringify([id, membersAfter ?? null, clientsAfter ?? null])} organizationId={id} initial={initial} initialError={initialError} membersAfter={membersAfter} clientsAfter={clientsAfter} />;
}
