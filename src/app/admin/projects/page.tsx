import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { AdminReadError, type AdminCampaignsDTO } from "@/lib/admin/contracts";
import { getAdminCampaigns, parseAdminCampaignsQuery } from "@/lib/admin/campaigns";
import { ProjectsScreen } from "@/components/screens/admin/projects-screen";

export default async function AdminProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageSession("ADMIN");
  const query = await searchParams;
  let campaigns: AdminCampaignsDTO | null = null, errorCode: string | null = null, after: string | undefined;
  try {
    after = parseAdminCampaignsQuery(query).after;
    campaigns = await getAdminCampaigns(actor, after ? { after } : {});
  } catch (error) {
    if (!(error instanceof AdminReadError)) throw error;
    if (error.status === 401 || error.status === 403) redirect("/login");
    errorCode = error.code;
  }
  return <ProjectsScreen key={after === undefined ? "first" : "after:" + after} initialCampaigns={campaigns} after={after} errorCode={errorCode} />;
}
