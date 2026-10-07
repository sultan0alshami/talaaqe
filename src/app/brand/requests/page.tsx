import { notFound, redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { getManagedRequestListPageContext } from "@/lib/managed/page-context";
import { ManagedRequestListScreen } from "@/components/infame/managed-order";
export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageSession("BRAND");
  let page;
  try { page = await getManagedRequestListPageContext(actor, await searchParams); }
  catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : null;
    if (code === "UNAUTHENTICATED") redirect("/login");
    if (code === "NOT_FOUND" || code === "VALIDATION") notFound();
    throw error;
  }
  return <ManagedRequestListScreen key={`${actor.userId}:${page.scope?.kind === "CLIENT" ? page.scope.clientId : "own"}`} {...page} />;
}
