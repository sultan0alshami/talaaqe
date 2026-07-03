// ActivityLog helper — every project transition appends an entry (README §10).
import { prisma } from "./prisma";

export async function logActivity(
  projectId: string,
  type: string,
  textAr: string,
  textEn: string
) {
  await prisma.activityLog.create({ data: { projectId, type, textAr, textEn } });
}
