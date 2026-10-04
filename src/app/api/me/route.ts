import { prisma } from "@/lib/prisma";
import { requireSession, handler, ok } from "@/lib/api";
export const GET = handler(async () => {
  const session = await requireSession();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId }, select: {
    id: true, name: true, email: true, phone: true, role: true, language: true, countryCode: true,
    timeZone: true, emailVerifiedAt: true, phoneVerifiedAt: true, notificationPreferences: true,
    creator: { select: { id: true, handle: true, state: true } }, brand: { select: { id: true, slug: true, state: true } },
  } });
  return ok(user);
});
