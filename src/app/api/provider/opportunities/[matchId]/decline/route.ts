import { MatchStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { handler, ok, requireRole, ApiError } from "@/lib/api";
import { getOwnProvider } from "@/lib/ownership";
import { logActivity } from "@/lib/activity";

export const POST = handler(async (_req: Request, { params }: { params: Promise<{ matchId: string }> }) => {
  const session = await requireRole("PROVIDER");
  const { matchId } = await params;
  const provider = await getOwnProvider(session.userId);
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match || match.providerId !== provider.id) throw new ApiError(404, "Opportunity not found");
  if (match.status !== MatchStatus.RECOMMENDED && match.status !== MatchStatus.PROPOSAL_REQUESTED) {
    throw new ApiError(409, `Cannot decline from status ${match.status}`);
  }
  await prisma.match.update({ where: { id: matchId }, data: { status: MatchStatus.DECLINED } });
  await logActivity(
    match.projectId,
    "opportunity_declined",
    `اعتذر ${provider.user.name} عن الفرصة`,
    `${provider.user.nameEn ?? provider.user.name} declined`
  );
  return ok({ status: MatchStatus.DECLINED });
});
