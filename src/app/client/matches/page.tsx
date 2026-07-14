// Recommended providers (client) — server page. Resolves ?project=<id>
// (ownership enforced) or falls back to the latest project with matches.
import { MatchStatus } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { providerCardInclude, toMatchDTO } from "@/lib/dto";
import { MatchesScreen } from "@/components/screens/client/matches-screen";

const matchesInclude = {
  matches: {
    where: { status: { not: MatchStatus.DECLINED } },
    include: { provider: { include: providerCardInclude } },
    orderBy: { matchScore: "desc" as const },
  },
};

export default async function ClientMatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project: projectId } = await searchParams;
  const session = (await getSession())!; // proxy.ts guarantees CLIENT
  const client = await prisma.client.findUnique({ where: { userId: session.userId } });

  const project = client
    ? projectId
      ? await prisma.project.findFirst({
          where: { id: projectId, clientId: client.id },
          include: matchesInclude,
        })
      : await prisma.project.findFirst({
          where: { clientId: client.id, matches: { some: {} } },
          orderBy: { updatedAt: "desc" },
          include: matchesInclude,
        })
    : null;

  if (!project || project.matches.length === 0) {
    return <MatchesScreen key="empty" matches={[]} projectId={null} titleAr="" titleEn="" />;
  }
  return (
    <MatchesScreen
      key={project.id} // remount so per-project optimistic state resets
      matches={project.matches.map(toMatchDTO)}
      projectId={project.id}
      titleAr={project.titleAr}
      titleEn={project.titleEn}
    />
  );
}
