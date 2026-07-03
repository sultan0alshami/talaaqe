import { prisma } from "@/lib/prisma";
import { handler, ok, requireRole } from "@/lib/api";

export const GET = handler(async () => {
  await requireRole("ADMIN");
  const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" } });
  return ok({
    users: users.map((u) => ({
      id: u.id,
      nameAr: u.name,
      nameEn: u.nameEn ?? u.name,
      email: u.email,
      role: u.role,
      active: u.active,
      joined: u.createdAt.toISOString(),
    })),
  });
});
