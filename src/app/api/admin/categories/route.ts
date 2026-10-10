import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, ok, parseBody, requireRole } from "@/lib/api";

// Native catalog read only; inherited mutation below stays retired by handler.
export { loadAdminTaxonomy as GET } from "@/lib/admin/transport";

const schema = z.object({
  nameAr: z.string().min(2).max(80),
  nameEn: z.string().min(2).max(80),
  description: z.string().max(500).optional(),
});

export const POST = handler(async (req: Request) => {
  await requireRole("ADMIN");
  const body = await parseBody(req, schema);
  const last = await prisma.category.findFirst({ orderBy: { sortOrder: "desc" } });
  const category = await prisma.category.create({
    data: { ...body, sortOrder: (last?.sortOrder ?? 0) + 1 },
  });
  return ok({ category });
});
