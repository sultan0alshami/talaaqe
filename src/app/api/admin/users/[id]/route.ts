import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, ok, parseBody, requireRole, ApiError } from "@/lib/api";

const schema = z.object({ active: z.boolean() });

// Suspend / reactivate a user.
export const PATCH = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireRole("ADMIN");
  const { id } = await params;
  const { active } = await parseBody(req, schema);
  if (id === session.userId) throw new ApiError(400, "Cannot change your own account status");
  const user = await prisma.user.update({ where: { id }, data: { active } });
  return ok({ user: { id: user.id, active: user.active } });
});
