import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, ok, parseBody, requireRole, ApiError } from "@/lib/api";

export const GET = handler(async () => {
  await requireRole("ADMIN");
  const skills = await prisma.skill.findMany({ include: { category: true }, orderBy: { name: "asc" } });
  return ok({
    skills: skills.map((s) => ({
      id: s.id,
      name: s.name,
      categoryId: s.categoryId,
      categoryAr: s.category.nameAr,
      categoryEn: s.category.nameEn,
    })),
  });
});

const schema = z.object({ name: z.string().min(1).max(60), categoryId: z.string() });

export const POST = handler(async (req: Request) => {
  await requireRole("ADMIN");
  const { name, categoryId } = await parseBody(req, schema);
  const exists = await prisma.skill.findUnique({ where: { name } });
  if (exists) throw new ApiError(409, "Skill already exists");
  const skill = await prisma.skill.create({ data: { name, categoryId } });
  return ok({ skill });
});
