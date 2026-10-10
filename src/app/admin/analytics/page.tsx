import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { AdminReadError } from "@/lib/admin/contracts";
import type { AdminAnalyticsDTO } from "@/lib/admin/analytics-contracts";
import { getAdminAnalytics } from "@/lib/admin/analytics";
import { AnalyticsScreen } from "@/components/screens/admin/analytics-screen";

export default async function AdminAnalyticsPage() {
  const actor = await requirePageSession("ADMIN");
  let initialAnalytics: AdminAnalyticsDTO | null = null, errorCode: string | null = null;
  try { initialAnalytics = await getAdminAnalytics(actor); }
  catch (error) {
    if (!(error instanceof AdminReadError)) throw error;
    if (error.status === 401 || error.status === 403) redirect("/login");
    errorCode = error.code;
  }
  return <AnalyticsScreen key={actor.userId} initialAnalytics={initialAnalytics} errorCode={errorCode} />;
}
