import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api";
import { handler, ok, fail } from "@/lib/api";

export const GET = handler(async () => {
  const session = await requireSession();
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { client: true, provider: { include: { categories: true } } },
  });
  if (!user) return fail(404, "User not found");
  return ok({
    id: user.id,
    name: user.name,
    nameEn: user.nameEn,
    email: user.email,
    phone: user.phone,
    role: user.role,
    companyName: user.companyName,
    language: user.language,
    createdAt: user.createdAt,
    client: user.client,
    provider: user.provider,
  });
});
