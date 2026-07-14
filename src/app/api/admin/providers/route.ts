import { prisma } from "@/lib/prisma";
import { handler, ok, requireRole } from "@/lib/api";
import { PROVIDER_TYPE_LABELS } from "@/lib/domain";

export const GET = handler(async () => {
  await requireRole("ADMIN");
  const providers = await prisma.provider.findMany({
    include: { user: true },
    orderBy: [{ verifiedStatus: "asc" }, { rating: "desc" }],
  });
  return ok({
    providers: providers.map((p) => {
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
    }),
  });
});
