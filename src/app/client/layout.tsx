import { MatchStatus } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DashboardShell, type NavSpec } from "@/components/shells/dashboard-shell";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const session = (await getSession())!; // proxy.ts guarantees CLIENT
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { client: true },
  });
  // Latest project with a brief drives the Brief/Matches sidebar badges.
  const latestBriefed = user?.client
    ? await prisma.project.findFirst({
        where: { clientId: user.client.id, brief: { isNot: null } },
        orderBy: { updatedAt: "desc" },
        include: { _count: { select: { matches: { where: { status: { not: MatchStatus.DECLINED } } } } } },
      })
    : null;

  const nav: NavSpec[] = [
    { key: "home", labelKey: "cNavHome", href: "/client" },
    { key: "chat", labelKey: "cNavNew", href: "/client/chat" },
    { key: "brief", labelKey: "cNavBrief", href: "/client/brief", badge: latestBriefed ? "1" : null },
    {
      key: "matches",
      labelKey: "cNavMatches",
      href: "/client/matches",
      badge: latestBriefed && latestBriefed._count.matches > 0 ? String(latestBriefed._count.matches) : null,
    },
    { key: "projects", labelKey: "cNavProjects", href: "/client/projects" },
    { key: "profile", labelKey: "cpTitle", href: "/client/profile" },
    { key: "settings", labelKey: "cNavSettings", href: "/client/settings" },
  ];

  const title = user?.companyName ?? user?.name ?? "";
  return (
    <DashboardShell
      role="client"
      sidebarTitle={{ ar: title, en: user?.nameEn && user.companyName ? user.companyName : title }}
      nav={nav}
      userInitial={(user?.name ?? "أ").trim().charAt(0)}
    >
      {children}
    </DashboardShell>
  );
}
