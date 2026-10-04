import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { AdminReadError, type AdminOverviewDTO } from "@/lib/admin/contracts";
import { getAdminOverview } from "@/lib/admin/overview";
import { OverviewScreen } from "@/components/screens/admin/overview-screen";

export default async function AdminOverviewPage() {
  const actor = await requirePageSession("ADMIN");
  let overview: AdminOverviewDTO | null = null;
  let errorCode: string | null = null;
  try {
    overview = await getAdminOverview(actor);
  } catch (error) {
    if (!(error instanceof AdminReadError)) throw error;
    if (error.status === 401 || error.status === 403) redirect("/login");
    errorCode = error.code;
  }
  return <OverviewScreen initialOverview={overview} errorCode={errorCode} />;
}
