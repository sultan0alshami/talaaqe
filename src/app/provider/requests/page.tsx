// Proposal requests — server page (spec provider-admin §3).
import { MatchStatus } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { opportunityInclude, toOpportunityDTO } from "@/lib/dto";
import { ProviderRequestsScreen } from "@/components/screens/provider/requests-screen";

export default async function ProviderRequestsPage() {
  const session = (await getSession())!; // proxy.ts guarantees PROVIDER
  const provider = await prisma.provider.findUnique({ where: { userId: session.userId } });

  const matches = provider
    ? await prisma.match.findMany({
        where: {
          providerId: provider.id,
          status: { in: [MatchStatus.PROPOSAL_REQUESTED, MatchStatus.PROPOSAL_SENT] },
        },
        include: opportunityInclude,
        orderBy: { updatedAt: "desc" },
      })
    : [];

  return <ProviderRequestsScreen requests={matches.map(toOpportunityDTO)} />;
}
