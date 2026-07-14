import { z } from "zod";
import { ProjectStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { handler, ok, parseBody, requireRole, ApiError } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { chatTurn, helloMessage } from "@/lib/ai";
import { logActivity } from "@/lib/activity";
import { projectListInclude, toProjectListItem } from "@/lib/dto";
import type { ChatMessage } from "@/lib/domain";

export const GET = handler(async () => {
  const session = await requireRole("CLIENT");
  const client = await prisma.client.findUnique({ where: { userId: session.userId } });
  if (!client) throw new ApiError(404, "Client profile not found");
  const projects = await prisma.project.findMany({
    where: { clientId: client.id },
    include: projectListInclude,
    orderBy: { createdAt: "desc" },
  });
  return ok({ projects: projects.map(toProjectListItem) });
});

const createSchema = z.object({
  // A short opener ("هلا") is a legitimate way to start — the AI greets back
  // and asks what they need. Don't reject it.
  description: z.string().trim().min(1).max(2000),
  mode: z.enum(["live", "scripted"]).default("scripted"),
  lang: z.enum(["ar", "en"]).default("ar"),
});

// Create a draft project from the client's first chat message and run the
// first AI clarification turn (README §7: POST /api/projects).
export const POST = handler(async (req: Request) => {
  const session = await requireRole("CLIENT");
  const { description, mode, lang } = await parseBody(req, createSchema);

  const rl = rateLimit(`chat:${session.userId}`);
  if (!rl.ok) throw new ApiError(429, `Rate limited — retry in ${rl.retryAfterSec}s`);

  const client = await prisma.client.findUnique({ where: { userId: session.userId } });
  if (!client) throw new ApiError(404, "Client profile not found");

  const title = description.length > 70 ? description.slice(0, 67) + "…" : description;
  const project = await prisma.project.create({
    data: {
      clientId: client.id,
      titleAr: title,
      titleEn: title,
      description,
      status: ProjectStatus.DRAFT,
      requiredSkills: [],
    },
  });
  await logActivity(project.id, "chat_started", "بدأت محادثة توصيف الاحتياج", "Requirement conversation started");

  const userMsg: ChatMessage = { role: "user", ar: description, en: description, ts: Date.now() };
  const turn = await chatTurn({
    userId: session.userId,
    projectId: project.id,
    history: [],
    userMessage: description,
    questionsAsked: 0,
    lang,
    preferLive: mode === "live",
  });
  const assistantMsg: ChatMessage = {
    role: "assistant",
    ar: turn.replyAr,
    en: turn.replyEn,
    ...(turn.chips ? { chips: turn.chips } : {}),
    ts: Date.now(),
  };
  const messages: ChatMessage[] = [helloMessage(), userMsg, assistantMsg];

  await prisma.conversation.create({
    data: {
      projectId: project.id,
      clientId: client.id,
      messages: messages as object[],
      extractedRequirements: (turn.extracted ?? {}) as object,
      questionsAsked: 1,
      readyForBrief: turn.ready,
    },
  });

  return ok({
    projectId: project.id,
    messages,
    ready: turn.ready,
    mode: turn.mode,
    chips: turn.chips ?? null,
  });
});
