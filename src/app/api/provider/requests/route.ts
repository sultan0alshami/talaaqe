import { MatchStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { handler, ok, requireRole } from "@/lib/api";
import { getOwnProvider } from "@/lib/ownership";
import { opportunityInclude, toOpportunityDTO } from "@/lib/dto";

// Proposal requests: clients who asked this provider for a proposal.
// Includes PROPOSAL_SENT so the "sent ✓" state persists (prototype behavior).
export const GET = handler(async () => {
  const session = await requireRole("PROVIDER");
  const provider = await getOwnProvider(session.userId);
  const matches = await prisma.match.findMany({
    where: {
      providerId: provider.id,
      status: { in: [MatchStatus.PROPOSAL_REQUESTED, MatchStatus.PROPOSAL_SENT] },
    },
    include: opportunityInclude,
    orderBy: { updatedAt: "desc" },
  });
  return ok({ requests: matches.map(toOpportunityDTO) });
});
