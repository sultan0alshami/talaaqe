import { prisma } from "@/lib/prisma";
import { handler, ok, requireRole, ApiError } from "@/lib/api";

export const POST = handler(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireRole("ADMIN");
  const { id } = await params;
  const provider = await prisma.provider.findUnique({ where: { id } });
  if (!provider) throw new ApiError(404, "Provider not found");
  await prisma.provider.update({ where: { id }, data: { verifiedStatus: "REJECTED" } });
  return ok({ verifiedStatus: "REJECTED" });
});
