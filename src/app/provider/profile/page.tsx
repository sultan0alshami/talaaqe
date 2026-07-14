// Provider profile — server page (spec provider-admin §2).
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ProviderProfileScreen, type ProviderProfileProps } from "@/components/screens/provider/profile-screen";

export default async function ProviderProfilePage() {
  const session = (await getSession())!; // proxy.ts guarantees PROVIDER
  const p = await prisma.provider.findUnique({
    where: { userId: session.userId },
    include: {
      user: true,
      skills: { include: { skill: true } },
      categories: { include: { category: true } },
      portfolio: true,
    },
  });

  if (!p) return null;

  const props: ProviderProfileProps = {
    nameAr: p.user.name,
    nameEn: p.user.nameEn ?? p.user.name,
    roleAr: p.roleTitleAr ?? "",
    roleEn: p.roleTitleEn ?? p.roleTitleAr ?? "",
    verified: p.verifiedStatus === "APPROVED",
    rating: p.rating,
    providerType: p.providerType,
    cityAr: p.locationAr ?? "",
    cityEn: p.locationEn ?? p.locationAr ?? "",
    years: p.experienceYears,
    languages: p.languages,
    priceMin: p.priceRangeMin,
    priceMax: p.priceRangeMax,
    availability: p.availability,
    avatarColor: p.avatarColor ?? "#1B3568",
    avatarInitial: p.avatarInitial ?? (p.user.name.trim().charAt(0) || "؟"),
    skills: p.skills.map((s) => s.skill.name),
    portfolio: p.portfolio.map((i) => ({ id: i.id, title: i.title, titleEn: i.titleEn })),
  };

  return <ProviderProfileScreen {...props} />;
}
