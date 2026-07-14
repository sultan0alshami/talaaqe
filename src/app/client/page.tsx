import { MatchStatus, ProjectStatus } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { projectListInclude, toProjectListItem } from "@/lib/dto";
import { HomeScreen } from "@/components/screens/client/home-screen";

export default async function ClientHomePage() {
  const session = (await getSession())!; // proxy.ts guarantees CLIENT
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { client: true },
  });
  const clientId = user?.client?.id ?? "__none__";

  const [projects, activeCount, briefsCount, proposalsCount] = await Promise.all([
    prisma.project.findMany({
      where: { clientId },
      include: projectListInclude,
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.project.count({
      where: { clientId, status: { notIn: [ProjectStatus.COMPLETED, ProjectStatus.CANCELLED] } },
    }),
    prisma.brief.count({ where: { project: { clientId } } }),
    prisma.match.count({
      where: { status: MatchStatus.PROPOSAL_SENT, project: { clientId } },
    }),
  ]);

  const firstNameAr = (user?.name ?? "").trim().split(/\s+/)[0] ?? "";
  const firstNameEn = (user?.nameEn ?? user?.name ?? "").trim().split(/\s+/)[0] ?? "";

  return (
    <HomeScreen
      firstNameAr={firstNameAr}
      firstNameEn={firstNameEn}
      activeCount={activeCount}
      briefsCount={briefsCount}
      proposalsCount={proposalsCount}
      projects={projects.map(toProjectListItem)}
    />
  );
}
