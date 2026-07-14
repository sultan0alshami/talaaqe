// Ownership guards shared by project route handlers.
import { prisma } from "./prisma";
import { ApiError } from "./api";

export async function getOwnedProject(userId: string, projectId: string) {
  const client = await prisma.client.findUnique({ where: { userId } });
  if (!client) throw new ApiError(404, "Client profile not found");
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { conversation: true, brief: true, category: true },
  });
  if (!project || project.clientId !== client.id) throw new ApiError(404, "Project not found");
  return { client, project };
}

export async function getOwnProvider(userId: string) {
  const provider = await prisma.provider.findUnique({
    where: { userId },
    include: { user: true, skills: { include: { skill: true } }, categories: { include: { category: true } }, portfolio: true },
  });
  if (!provider) throw new ApiError(404, "Provider profile not found");
  return provider;
}
