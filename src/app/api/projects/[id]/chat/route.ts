import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, ok, parseBody, requireRole, ApiError } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { chatTurn } from "@/lib/ai";
import { messagesOf } from "@/lib/dto";
import { getOwnedProject } from "@/lib/ownership";
import type { ChatMessage, ExtractedRequirements } from "@/lib/domain";

const schema = z.object({
  message: z.string().min(1).max(2000),
  mode: z.enum(["live", "scripted"]).default("scripted"),
  lang: z.enum(["ar", "en"]).default("ar"),
});

// Send a chat message → AI clarification reply (README §7/§8A).
export const POST = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireRole("CLIENT");
  const { id } = await params;
  const { message, mode, lang } = await parseBody(req, schema);

  const rl = rateLimit(`chat:${session.userId}`);
  if (!rl.ok) throw new ApiError(429, `Rate limited — retry in ${rl.retryAfterSec}s`);

  const { project } = await getOwnedProject(session.userId, id);
  const conversation = project.conversation;
  if (!conversation) throw new ApiError(409, "Conversation not started");

  const history = messagesOf(conversation.messages);
  const turn = await chatTurn({
    userId: session.userId,
    projectId: id,
    history,
    userMessage: message,
    questionsAsked: conversation.questionsAsked,
    lang,
    preferLive: mode === "live",
  });

  const userMsg: ChatMessage = { role: "user", ar: message, en: message, ts: Date.now() };
  const assistantMsg: ChatMessage = {
    role: "assistant",
    ar: turn.replyAr,
    en: turn.replyEn,
    ...(turn.chips ? { chips: turn.chips } : {}),
    ts: Date.now(),
  };
  const messages = [...history, userMsg, assistantMsg];

  const prevExtracted = (conversation.extractedRequirements ?? {}) as ExtractedRequirements;
  const merged = { ...prevExtracted, ...turn.extracted };

  await prisma.conversation.update({
    where: { projectId: id },
    data: {
      messages: messages as object[],
      extractedRequirements: merged as object,
      questionsAsked: conversation.questionsAsked + 1,
      readyForBrief: conversation.readyForBrief || turn.ready,
    },
  });

  return ok({
    messages,
    ready: conversation.readyForBrief || turn.ready,
    mode: turn.mode,
    chips: turn.chips ?? null,
  });
});
