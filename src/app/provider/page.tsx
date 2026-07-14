// Provider dashboard (opportunities) — server page.
// Fetches the provider's matched opportunities + stat inputs, passes plain
// JSON to the client screen (spec provider-admin §1).
import { MatchStatus } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { opportunityInclude, toOpportunityDTO } from "@/lib/dto";
import { ProviderHomeScreen } from "@/components/screens/provider/home-screen";

export default async function ProviderHomePage() {
  const session = (await getSession())!; // proxy.ts guarantees PROVIDER
  const provider = await prisma.provider.findUnique({
    where: { userId: session.userId },
    include: { user: true },
  });

  if (!provider) {
    return <ProviderHomeScreen nameAr="" nameEn="" rating={0} opportunities={[]} proposalSentCount={0} />;
  }

  const [matches, proposalSentCount] = await Promise.all([
    prisma.match.findMany({
      where: {
        providerId: provider.id,
        status: { in: [MatchStatus.RECOMMENDED, MatchStatus.ACCEPTED, MatchStatus.DECLINED] },
      },
      include: opportunityInclude,
      orderBy: { matchScore: "desc" },
    }),
    prisma.match.count({ where: { providerId: provider.id, status: MatchStatus.PROPOSAL_SENT } }),
  ]);

  return (
    <ProviderHomeScreen
      nameAr={provider.user.name}
      nameEn={provider.user.nameEn ?? provider.user.name}
      rating={provider.rating}
      opportunities={matches.map(toOpportunityDTO)}
      proposalSentCount={proposalSentCount}
    />
  );
}
