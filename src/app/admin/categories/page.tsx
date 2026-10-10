import { requirePageSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getAdminTaxonomy } from "@/lib/admin/taxonomy";
import { AdminReadError } from "@/lib/admin/contracts";
import type { AdminTaxonomyDTO } from "@/lib/admin/taxonomy-contracts";
import { CategoriesScreen } from "@/components/screens/admin/categories-screen";

export default async function AdminCategoriesPage() {
  const actor = await requirePageSession("ADMIN");
  let initialTaxonomy: AdminTaxonomyDTO | null = null, errorCode: string | null = null;
  try { initialTaxonomy = await getAdminTaxonomy(actor); }
  catch (error) {
    if (!(error instanceof AdminReadError)) throw error;
    if (error.status === 401 || error.status === 403) redirect("/login");
    errorCode = error.code;
  }
  return <CategoriesScreen key={actor.userId} initialTaxonomy={initialTaxonomy} errorCode={errorCode} />;
}
