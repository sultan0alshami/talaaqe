import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { getOwnBrandAssociations, getOwnReferences } from "@/lib/organizations/management";
import { OrganizationError } from "@/lib/organizations/contracts";
import { BrandAgencyAccess, type BrandAgencySnapshot } from "@/components/infame/brand-agency-access";
export default async function AgencyAccessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageSession("BRAND"), query = await searchParams;
  const input = Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined));
  let initial: BrandAgencySnapshot | null = null, initialError;
  try {
    const [references, associations] = await Promise.all([getOwnReferences(actor), getOwnBrandAssociations(actor, input)]);
    if (references.brandId !== associations.brandId) throw new OrganizationError("RETRY_REQUIRED", 503);
    initial = { references, associations };
  } catch (error) {
    if (!(error instanceof OrganizationError)) throw error;
    if (error.code === "UNAUTHENTICATED") redirect("/login"); initialError = error.code;
  }
  const after = typeof query.after === "string" ? query.after : undefined;
  return <BrandAgencyAccess key={after === undefined ? "first" : `after:${after}`} initial={initial} initialError={initialError} after={after} />;
}
