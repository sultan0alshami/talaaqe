import { z } from "zod";
import { MatchStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { handler, ok, parseBody, requireRole, ApiError } from "@/lib/api";
import { getOwnProvider } from "@/lib/ownership";
import { logActivity } from "@/lib/activity";

// Declining requires a reason (captured on the match + activity log). Serves
// both the opportunities list and the proposal-requests list.
const schema = z.object({ reason: z.string().trim().min(3).max(500) });

export const POST = handler(async (req: Request, { params }: { params: Promise<{ matchId: string }> }) => {
  const session = await requireRole("PROVIDER");
  const { matchId } = await params;
  const { reason } = await parseBody(req, schema);
  const provider = await getOwnProvider(session.userId);
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match || match.providerId !== provider.id) throw new ApiError(404, "Opportunity not found");
  if (match.status !== MatchStatus.RECOMMENDED && match.status !== MatchStatus.PROPOSAL_REQUESTED) {
    throw new ApiError(409, `Cannot decline from status ${match.status}`);
  }
  await prisma.match.update({
    where: { id: matchId },
    data: { status: MatchStatus.DECLINED, declineReason: reason },
  });
  await logActivity(
    match.projectId,
    "opportunity_declined",
    `اعتذر ${provider.user.name} عن الفرصة — السبب: ${reason}`,
    `${provider.user.nameEn ?? provider.user.name} declined — reason: ${reason}`
  );
  return ok({ status: MatchStatus.DECLINED });
});
