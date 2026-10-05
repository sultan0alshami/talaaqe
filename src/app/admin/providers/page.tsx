import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { AdminReadError, type AdminCreatorsDTO } from "@/lib/admin/contracts";
import { getAdminCreators, parseAdminCreatorsQuery } from "@/lib/admin/creators";
import { ProvidersScreen } from "@/components/screens/admin/providers-screen";

export default async function AdminProvidersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageSession("ADMIN");
  const query = await searchParams;
  let creators: AdminCreatorsDTO | null = null, errorCode: string | null = null, after: string | undefined;
  try {
    after = parseAdminCreatorsQuery(query).after;
    creators = await getAdminCreators(actor, after ? { after } : {});
  } catch (error) {
    if (!(error instanceof AdminReadError)) throw error;
    if (error.status === 401 || error.status === 403) redirect("/login");
    errorCode = error.code;
  }
  return <ProvidersScreen key={after === undefined ? "first" : "after:" + after} initialCreators={creators} after={after} errorCode={errorCode} />;
}
