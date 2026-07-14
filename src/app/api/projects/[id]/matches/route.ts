import { prisma } from "@/lib/prisma";
import { handler, ok, requireRole } from "@/lib/api";
import { getOwnedProject } from "@/lib/ownership";
import { providerCardInclude, toMatchDTO } from "@/lib/dto";

export const GET = handler(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireRole("CLIENT");
  const { id } = await params;
  await getOwnedProject(session.userId, id);
  const matches = await prisma.match.findMany({
    where: { projectId: id },
    include: { provider: { include: providerCardInclude } },
    orderBy: { matchScore: "desc" },
  });
  return ok({ matches: matches.map(toMatchDTO) });
});
