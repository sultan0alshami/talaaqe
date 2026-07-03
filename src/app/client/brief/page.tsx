// Project brief (client) — server page. Resolves ?project=<id> (ownership
// enforced) or falls back to the latest project that has a brief.
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toBriefDTO } from "@/lib/dto";
import { BriefScreen } from "@/components/screens/client/brief-screen";

export default async function ClientBriefPage({
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
          include: { brief: true },
        })
      : await prisma.project.findFirst({
          where: { clientId: client.id, brief: { isNot: null } },
          orderBy: { updatedAt: "desc" },
          include: { brief: true },
        })
    : null;

  if (!project?.brief) {
    return <BriefScreen brief={null} projectId={null} />;
  }
  return <BriefScreen brief={toBriefDTO(project.brief)} projectId={project.id} />;
}
