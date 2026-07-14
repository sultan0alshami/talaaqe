import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { projectDetailInclude, toProjectDetail } from "@/lib/dto";
import { ProjectDetailScreen } from "@/components/screens/client/project-detail-screen";

export default async function ClientProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = (await getSession())!; // proxy.ts guarantees CLIENT
  const client = await prisma.client.findUnique({ where: { userId: session.userId } });
  const project = await prisma.project.findUnique({
    where: { id },
    include: projectDetailInclude,
  });
  if (!client || !project || project.clientId !== client.id) notFound();

  return <ProjectDetailScreen project={toProjectDetail(project)} />;
}
