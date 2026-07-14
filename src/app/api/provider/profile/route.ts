import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, ok, parseBody, requireRole, ApiError } from "@/lib/api";
import { getOwnProvider } from "@/lib/ownership";
import { PROVIDER_TYPE_LABELS } from "@/lib/domain";

export const GET = handler(async () => {
  const session = await requireRole("PROVIDER");
  const p = await getOwnProvider(session.userId);
  const type = PROVIDER_TYPE_LABELS[p.providerType];
  return ok({
    profile: {
      id: p.id,
      nameAr: p.user.name,
      nameEn: p.user.nameEn ?? p.user.name,
      email: p.user.email,
      phone: p.user.phone,
      typeAr: type.ar,
      typeEn: type.en,
      providerType: p.providerType,
      roleAr: p.roleTitleAr ?? "",
      roleEn: p.roleTitleEn ?? "",
      bio: p.bio,
      years: p.experienceYears,
      priceMin: p.priceRangeMin,
      priceMax: p.priceRangeMax,
      availability: p.availability,
      rating: p.rating,
      verifiedStatus: p.verifiedStatus,
      cityAr: p.locationAr ?? "",
      cityEn: p.locationEn ?? "",
      languages: p.languages,
      avatarColor: p.avatarColor ?? "#1B3568",
      avatarInitial: p.avatarInitial ?? p.user.name.charAt(0),
      skills: p.skills.map((s) => s.skill.name),
      categories: p.categories.map((c) => ({ id: c.category.id, nameAr: c.category.nameAr, nameEn: c.category.nameEn })),
      portfolio: p.portfolio.map((i) => ({ id: i.id, title: i.title, titleEn: i.titleEn, url: i.url })),
    },
  });
});

const patchSchema = z.object({
  bio: z.string().max(2000).optional(),
  roleAr: z.string().max(120).optional(),
  roleEn: z.string().max(120).optional(),
  years: z.number().int().min(0).max(60).optional(),
  priceMin: z.number().int().positive().optional(),
  priceMax: z.number().int().positive().optional(),
  availability: z.enum(["now", "1_week", "2_weeks", "1_month"]).optional(),
  cityAr: z.string().max(80).optional(),
  cityEn: z.string().max(80).optional(),
  languages: z.array(z.enum(["ar", "en"])).optional(),
  skills: z.array(z.string().min(1).max(60)).max(30).optional(),
  portfolio: z
    .array(z.object({ title: z.string().min(1).max(200), titleEn: z.string().max(200).optional(), url: z.string().url().optional() }))
    .max(20)
    .optional(),
  categoryIds: z.array(z.string()).max(5).optional(),
});

export const PATCH = handler(async (req: Request) => {
  const session = await requireRole("PROVIDER");
  const body = await parseBody(req, patchSchema);
  const p = await getOwnProvider(session.userId);

  // Cross-field price check, including partial updates against stored values.
  const nextMin = body.priceMin ?? p.priceRangeMin;
  const nextMax = body.priceMax ?? p.priceRangeMax;
  if (nextMin != null && nextMax != null && nextMin > nextMax) {
    throw new ApiError(400, "priceMin must be ≤ priceMax");
  }

  await prisma.provider.update({
    where: { id: p.id },
    data: {
      ...(body.bio !== undefined ? { bio: body.bio } : {}),
      ...(body.roleAr !== undefined ? { roleTitleAr: body.roleAr } : {}),
      ...(body.roleEn !== undefined ? { roleTitleEn: body.roleEn } : {}),
      ...(body.years !== undefined ? { experienceYears: body.years } : {}),
      ...(body.priceMin !== undefined ? { priceRangeMin: body.priceMin } : {}),
      ...(body.priceMax !== undefined ? { priceRangeMax: body.priceMax } : {}),
      ...(body.availability !== undefined ? { availability: body.availability } : {}),
      ...(body.cityAr !== undefined ? { locationAr: body.cityAr } : {}),
      ...(body.cityEn !== undefined ? { locationEn: body.cityEn } : {}),
      ...(body.languages !== undefined ? { languages: body.languages } : {}),
    },
  });

  if (body.skills) {
    // Skills are an admin-curated global taxonomy — reject unknown names
    // instead of letting providers create rows (POST /api/admin/skills owns that).
    const names = [...new Set(body.skills)];
    const found = await prisma.skill.findMany({ where: { name: { in: names } } });
    if (found.length !== names.length) {
      const known = new Set(found.map((s) => s.name));
      throw new ApiError(400, `Unknown skills: ${names.filter((n) => !known.has(n)).join(", ")}`);
    }
    await prisma.$transaction([
      prisma.providerSkill.deleteMany({ where: { providerId: p.id } }),
      prisma.providerSkill.createMany({ data: found.map((s) => ({ providerId: p.id, skillId: s.id })) }),
    ]);
  }
  if (body.categoryIds) {
    const ids = [...new Set(body.categoryIds)];
    const found = await prisma.category.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (found.length !== ids.length) throw new ApiError(400, "Unknown categoryId");
    await prisma.$transaction([
      prisma.providerCategory.deleteMany({ where: { providerId: p.id } }),
      prisma.providerCategory.createMany({ data: ids.map((categoryId) => ({ providerId: p.id, categoryId })) }),
    ]);
  }
  if (body.portfolio) {
    await prisma.$transaction([
      prisma.portfolioItem.deleteMany({ where: { providerId: p.id } }),
      prisma.portfolioItem.createMany({
        data: body.portfolio.map((item) => ({
          providerId: p.id,
          title: item.title,
          titleEn: item.titleEn,
          url: item.url,
        })),
      }),
    ]);
  }
  return ok({ ok: true });
});
