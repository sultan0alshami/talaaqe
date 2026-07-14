import { MatchStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { handler, ok, requireRole } from "@/lib/api";
import { getOwnProvider } from "@/lib/ownership";
import { opportunityInclude, toOpportunityDTO } from "@/lib/dto";

// Matched opportunities: recommendations + the provider's accept/decline states.
export const GET = handler(async () => {
  const session = await requireRole("PROVIDER");
  const provider = await getOwnProvider(session.userId);
  const matches = await prisma.match.findMany({
    where: {
      providerId: provider.id,
      status: { in: [MatchStatus.RECOMMENDED, MatchStatus.ACCEPTED, MatchStatus.DECLINED] },
    },
    include: opportunityInclude,
    orderBy: { matchScore: "desc" },
  });
  return ok({ opportunities: matches.map(toOpportunityDTO) });
});
