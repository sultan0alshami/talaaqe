import { DealList } from "@/components/infame/deal-list";
import { requirePageSession } from "@/lib/auth";
import { listDeals } from "@/lib/deals/service";

export default async function BrandDealsPage() {
  const actor = await requirePageSession("BRAND");
  const data = await listDeals(actor.userId, {}, { serverAuth: actor });
  return (
    <DealList
      initialDeals={data.deals}
      initialCursor={data.nextCursor}
      role="BRAND"
    />
  );
}
