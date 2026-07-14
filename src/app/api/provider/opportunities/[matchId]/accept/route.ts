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
  if (match.status !== MatchStatus.RECOMMENDED) throw new ApiError(409, `Cannot accept from status ${match.status}`);
  await prisma.match.update({ where: { id: matchId }, data: { status: MatchStatus.ACCEPTED } });
  await logActivity(
    match.projectId,
    "opportunity_accepted",
    `قبل ${provider.user.name} الفرصة`,
    `${provider.user.nameEn ?? provider.user.name} accepted the opportunity`
  );
  return ok({ status: MatchStatus.ACCEPTED });
});
