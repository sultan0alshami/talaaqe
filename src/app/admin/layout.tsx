import { requirePageSession } from "@/lib/auth";
import { cookies } from "next/headers";
import { THEME_COOKIE } from "@/lib/brand";
import { getAdminPendingCount } from "@/lib/admin/overview";
import { AdminReadError } from "@/lib/admin/contracts";
import { redirect } from "next/navigation";
import { DashboardShell, type NavSpec } from "@/components/shells/dashboard-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePageSession("ADMIN");
  const theme = (await cookies()).get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";
  let pending: number | null = null;
  try { pending = await getAdminPendingCount(actor); }
  catch (error) {
    if (!(error instanceof AdminReadError)) throw error;
    if (error.status === 401 || error.status === 403) redirect("/login");
  }

  const nav: NavSpec[] = [
    { key: "overview", labelKey: "aNavOverview", href: "/admin" },
    { key: "evidence", label: { ar: "مراجعة الإثباتات", en: "Evidence review" }, href: "/admin/evidence", badge: pending !== null && pending > 0 ? String(pending) : null },
    { key: "users", labelKey: "aNavUsers", href: "/admin/users" },
    { key: "providers", labelKey: "aNavProviders", href: "/admin/providers" },
    { key: "projects", labelKey: "aNavProjects", href: "/admin/projects" },
    { key: "briefs", labelKey: "aNavBriefs", href: "/admin/briefs" },
    { key: "analytics", labelKey: "aNavAnalytics", href: "/admin/analytics" },
    { key: "cats", labelKey: "aNavCats", href: "/admin/categories" },
    { key: "settings", labelKey: "aNavSettings", href: "/admin/settings" },
  ];

  return (
    <DashboardShell
      role="admin"
      sidebarTitle={{ ar: "إدارة المنصة", en: "Platform admin" }}
      nav={nav}
      userInitial="م"
      initialTheme={theme}
    >
      {children}
    </DashboardShell>
  );
}
