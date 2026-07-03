// AI chat assistant (client) — server page. Resumes a conversation when
// ?project=<id> is given (ownership enforced), otherwise starts fresh.
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { messagesOf } from "@/lib/dto";
import { ChatScreen } from "@/components/screens/client/chat-screen";

export default async function ClientChatPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project: projectId } = await searchParams;
  const session = (await getSession())!; // proxy.ts guarantees CLIENT
  const aiEnabled = !!process.env.ANTHROPIC_API_KEY;

  if (projectId) {
    const client = await prisma.client.findUnique({ where: { userId: session.userId } });
    const project = client
      ? await prisma.project.findFirst({
          where: { id: projectId, clientId: client.id },
          include: { conversation: true, brief: { select: { id: true } } },
        })
      : null;
    if (project?.conversation) {
      return (
        <ChatScreen
          aiEnabled={aiEnabled}
          initialProjectId={project.id}
          initialMessages={messagesOf(project.conversation.messages)}
          initialQuestionsAsked={project.conversation.questionsAsked}
          initialReady={project.conversation.readyForBrief}
          hasBrief={!!project.brief}
        />
      );
    }
  }

  return (
    <ChatScreen
      aiEnabled={aiEnabled}
      initialProjectId={null}
      initialMessages={[]}
      initialQuestionsAsked={0}
      initialReady={false}
      hasBrief={false}
    />
  );
}
