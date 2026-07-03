import { MatchStatus, ProjectStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { handler, ok, requireRole, ApiError } from "@/lib/api";
import { logActivity } from "@/lib/activity";

// Client requests a proposal from a recommended provider (README §7).
export const POST = handler(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireRole("CLIENT");
  const { id } = await params;

  const match = await prisma.match.findUnique({
    where: { id },
    include: {
      project: { include: { client: true } },
      provider: { include: { user: true } },
    },
  });
  if (!match) throw new ApiError(404, "Match not found");
  const client = await prisma.client.findUnique({ where: { userId: session.userId } });
  if (!client || match.project.clientId !== client.id) throw new ApiError(404, "Match not found");
  if (match.status !== MatchStatus.RECOMMENDED && match.status !== MatchStatus.ACCEPTED) {
    throw new ApiError(409, `Cannot request a proposal from status ${match.status}`);
  }

  const updated = await prisma.match.update({
    where: { id },
    data: { status: MatchStatus.PROPOSAL_REQUESTED },
  });
  if (
    match.project.status === ProjectStatus.PROVIDERS_RECOMMENDED ||
    match.project.status === ProjectStatus.BRIEF_APPROVED
  ) {
    await prisma.project.update({
      where: { id: match.projectId },
      data: { status: ProjectStatus.PROPOSAL_REQUESTED },
    });
  }
  await logActivity(
    match.projectId,
    "proposal_requested",
    `طلب العميل عرضًا من ${match.provider.user.name}`,
    `Client requested a proposal from ${match.provider.user.nameEn ?? match.provider.user.name}`
  );
  return ok({ match: { id: updated.id, status: updated.status } });
});
