import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { projectListInclude, toProjectListItem } from "@/lib/dto";
import { ProjectsScreen } from "@/components/screens/client/projects-screen";

export default async function ClientProjectsPage() {
  const session = (await getSession())!; // proxy.ts guarantees CLIENT
  const client = await prisma.client.findUnique({ where: { userId: session.userId } });
  const projects = client
    ? await prisma.project.findMany({
        where: { clientId: client.id },
        include: projectListInclude,
        orderBy: { createdAt: "desc" },
      })
    : [];

  return <ProjectsScreen projects={projects.map(toProjectListItem)} />;
}
