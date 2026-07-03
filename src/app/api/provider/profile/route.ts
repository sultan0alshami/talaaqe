import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, ok, parseBody, requireRole } from "@/lib/api";
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
    // Replace the skill set; unknown skill names are created under the
    // provider's primary category (or the first category as fallback).
    const fallbackCat =
      p.categories[0]?.categoryId ?? (await prisma.category.findFirstOrThrow({ orderBy: { sortOrder: "asc" } })).id;
    await prisma.providerSkill.deleteMany({ where: { providerId: p.id } });
    for (const name of [...new Set(body.skills)]) {
      const skill =
        (await prisma.skill.findUnique({ where: { name } })) ??
        (await prisma.skill.create({ data: { name, categoryId: fallbackCat } }));
      await prisma.providerSkill.create({ data: { providerId: p.id, skillId: skill.id } });
    }
  }
  if (body.categoryIds) {
    await prisma.providerCategory.deleteMany({ where: { providerId: p.id } });
    for (const categoryId of [...new Set(body.categoryIds)]) {
      await prisma.providerCategory.create({ data: { providerId: p.id, categoryId } });
    }
  }
  if (body.portfolio) {
    await prisma.portfolioItem.deleteMany({ where: { providerId: p.id } });
    for (const item of body.portfolio) {
      await prisma.portfolioItem.create({
        data: { providerId: p.id, title: item.title, titleEn: item.titleEn, url: item.url },
      });
    }
  }
  return ok({ ok: true });
});
