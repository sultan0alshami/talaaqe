import { prisma } from "@/lib/prisma";
import { handler, ok, requireRole, ApiError } from "@/lib/api";
import { projectDetailInclude, toProjectDetail, messagesOf } from "@/lib/dto";
import { getOwnedProject } from "@/lib/ownership";

export const GET = handler(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireRole("CLIENT");
  const { id } = await params;
  await getOwnedProject(session.userId, id);
  const row = await prisma.project.findUnique({ where: { id }, include: projectDetailInclude });
  if (!row) throw new ApiError(404, "Project not found");
  const conversation = await prisma.conversation.findUnique({ where: { projectId: id } });
  return ok({
    project: toProjectDetail(row),
    conversation: conversation
      ? {
          messages: messagesOf(conversation.messages),
          questionsAsked: conversation.questionsAsked,
          readyForBrief: conversation.readyForBrief,
        }
      : null,
  });
});
