import { VerifiedStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DashboardShell, type NavSpec } from "@/components/shells/dashboard-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const pending = await prisma.provider.count({ where: { verifiedStatus: VerifiedStatus.PENDING } });

  const nav: NavSpec[] = [
    { key: "overview", labelKey: "aNavOverview", href: "/admin" },
    { key: "users", labelKey: "aNavUsers", href: "/admin/users" },
    { key: "providers", labelKey: "aNavProviders", href: "/admin/providers", badge: pending > 0 ? String(pending) : null },
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
    >
      {children}
    </DashboardShell>
  );
}
