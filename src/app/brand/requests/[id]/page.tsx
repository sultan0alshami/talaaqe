import { notFound, redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { getManagedRequestDetailPageContext } from "@/lib/managed/page-context";
import { ManagedRequestDetailScreen } from "@/components/infame/managed-order";
export default async function RequestPage({ params, searchParams }: { params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageSession("BRAND"), { id } = await params;
  let page;
  try { page = await getManagedRequestDetailPageContext(actor, id, await searchParams); }
  catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : null;
    if (code === "UNAUTHENTICATED") redirect("/login");
    if (code === "NOT_FOUND" || code === "VALIDATION") notFound();
    throw error;
  }
  return <ManagedRequestDetailScreen key={`${actor.userId}:${page.scope?.kind === "CLIENT" ? page.scope.clientId : "own"}:${id}`} {...page} />;
}
