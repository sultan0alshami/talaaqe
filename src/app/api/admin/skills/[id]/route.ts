import { prisma } from "@/lib/prisma";
import { handler, ok, requireRole, ApiError } from "@/lib/api";

export const DELETE = handler(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireRole("ADMIN");
  const { id } = await params;
  await prisma.skill.delete({ where: { id } }).catch(() => {
    throw new ApiError(404, "Skill not found");
  });
  return ok({ ok: true });
});
