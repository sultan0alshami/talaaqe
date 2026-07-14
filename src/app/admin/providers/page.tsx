import { prisma } from "@/lib/prisma";
import { PROVIDER_TYPE_LABELS } from "@/lib/domain";
import { ProvidersScreen } from "@/components/screens/admin/providers-screen";

// Admin providers — mirrors GET /api/admin/providers.
export default async function AdminProvidersPage() {
  const providers = await prisma.provider.findMany({
    include: { user: true },
    orderBy: [{ verifiedStatus: "asc" }, { rating: "desc" }],
  });

  return (
    <ProvidersScreen
      providers={providers.map((p) => {
        const type = PROVIDER_TYPE_LABELS[p.providerType];
        return {
          id: p.id,
          nameAr: p.user.name,
          nameEn: p.user.nameEn ?? p.user.name,
          roleAr: p.roleTitleAr ?? "",
          roleEn: p.roleTitleEn ?? "",
          typeAr: type.ar,
          typeEn: type.en,
          cityAr: p.locationAr ?? "",
          cityEn: p.locationEn ?? "",
          rating: p.rating,
          priceMin: p.priceRangeMin,
          priceMax: p.priceRangeMax,
          verifiedStatus: p.verifiedStatus,
          avatarColor: p.avatarColor ?? "#1B3568",
          avatarInitial: p.avatarInitial ?? p.user.name.charAt(0),
        };
      })}
    />
  );
}
