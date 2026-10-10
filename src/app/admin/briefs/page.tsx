import { requirePageSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getAdminBriefs } from "@/lib/admin/briefs";
import { AdminReadError } from "@/lib/admin/contracts";
import type { AdminBriefsDTO } from "@/lib/admin/briefs-contracts";
import { BriefsScreen } from "@/components/screens/admin/briefs-screen";

export default async function AdminBriefsPage() {
  const actor = await requirePageSession("ADMIN");
  let initialBriefs: AdminBriefsDTO | null = null, errorCode: string | null = null;
  try { initialBriefs = await getAdminBriefs(actor); }
  catch (error) {
    if (!(error instanceof AdminReadError)) throw error;
    if (error.status === 401 || error.status === 403) redirect("/login");
    errorCode = error.code;
  }
  return <BriefsScreen key={actor.userId} initialBriefs={initialBriefs} errorCode={errorCode} />;
}
