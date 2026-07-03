import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, ok, parseBody, requireRole, ApiError } from "@/lib/api";

const schema = z.object({
  nameAr: z.string().min(2).max(80).optional(),
  nameEn: z.string().min(2).max(80).optional(),
  description: z.string().max(500).optional(),
});

export const PATCH = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireRole("ADMIN");
  const { id } = await params;
  const body = await parseBody(req, schema);
  const category = await prisma.category.update({ where: { id }, data: body }).catch(() => null);
  if (!category) throw new ApiError(404, "Category not found");
  return ok({ category });
});

export const DELETE = handler(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireRole("ADMIN");
  const { id } = await params;
  const inUse = await prisma.project.count({ where: { categoryId: id } });
  if (inUse > 0) throw new ApiError(409, "Category is used by projects");
  await prisma.category.delete({ where: { id } }).catch(() => {
    throw new ApiError(404, "Category not found");
  });
  return ok({ ok: true });
});
