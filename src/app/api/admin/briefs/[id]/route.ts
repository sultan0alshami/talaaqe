import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, ok, parseBody, requireRole, ApiError } from "@/lib/api";

const schema = z.object({ qualityScore: z.number().int().min(0).max(100) });

// Admin brief review: set/update the quality score (README §7).
export const PATCH = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireRole("ADMIN");
  const { id } = await params;
  const { qualityScore } = await parseBody(req, schema);
  const brief = await prisma.brief.findUnique({ where: { id } });
  if (!brief) throw new ApiError(404, "Brief not found");
  await prisma.brief.update({ where: { id }, data: { qualityScore } });
  return ok({ id, qualityScore });
});
