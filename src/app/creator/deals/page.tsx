import { DealList } from "@/components/infame/deal-list";
import { requirePageSession } from "@/lib/auth";
import { listDeals } from "@/lib/deals/service";

export default async function CreatorDealsPage() {
  const actor = await requirePageSession("CREATOR");
  const data = await listDeals(actor.userId, {});
  return (
    <DealList
      initialDeals={data.deals}
      initialCursor={data.nextCursor}
      role="CREATOR"
    />
  );
}
