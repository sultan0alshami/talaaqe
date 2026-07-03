import { MatchStatus } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DashboardShell, type NavSpec } from "@/components/shells/dashboard-shell";

export default async function ProviderLayout({ children }: { children: React.ReactNode }) {
  const session = (await getSession())!; // proxy.ts guarantees PROVIDER
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { provider: true },
  });
  const providerId = user?.provider?.id;
  const [ops, reqs] = providerId
    ? await Promise.all([
        prisma.match.count({ where: { providerId, status: MatchStatus.RECOMMENDED } }),
        prisma.match.count({ where: { providerId, status: MatchStatus.PROPOSAL_REQUESTED } }),
      ])
    : [0, 0];

  const nav: NavSpec[] = [
    { key: "home", labelKey: "pNavHome", href: "/provider", badge: ops > 0 ? String(ops) : null },
    { key: "requests", labelKey: "pNavRequests", href: "/provider/requests", badge: reqs > 0 ? String(reqs) : null },
    { key: "profile", labelKey: "pNavProfile", href: "/provider/profile" },
    { key: "settings", labelKey: "pNavSettings", href: "/provider/settings" },
  ];

  return (
    <DashboardShell
      role="provider"
      sidebarTitle={{ ar: user?.name ?? "", en: user?.nameEn ?? user?.name ?? "" }}
      nav={nav}
      userInitial={(user?.name ?? "ع").trim().charAt(0)}
    >
      {children}
    </DashboardShell>
  );
}
