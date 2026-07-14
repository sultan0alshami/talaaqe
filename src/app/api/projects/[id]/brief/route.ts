import { z } from "zod";
import { ProjectStatus, Complexity } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { handler, ok, parseBody, requireRole, ApiError } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { generateBrief } from "@/lib/ai";
import { logActivity } from "@/lib/activity";
import { messagesOf, toBriefDTO } from "@/lib/dto";
import { getOwnedProject } from "@/lib/ownership";
import { CATEGORIES } from "@/lib/talaqi-data";
import type { ExtractedRequirements } from "@/lib/domain";

const COMPLEXITY_MAP = { low: Complexity.LOW, medium: Complexity.MEDIUM, high: Complexity.HIGH } as const;

/** Deterministic category inference from brief text (used for matching). */
async function inferCategoryId(text: string): Promise<string | null> {
  const lower = text.toLowerCase();
  // Rank categories by how many of their name tokens appear in the text.
  const ranked = CATEGORIES.map((c) => {
    const tokens = c.en.toLowerCase().split(/[\s&/]+/).filter((t) => t.length > 3 && t !== "development");
    const hits = tokens.filter((t) => lower.includes(t)).length;
    // Full-name hit gets priority.
    return { en: c.en, score: (lower.includes(c.en.toLowerCase()) ? 10 : 0) + hits };
  }).sort((a, b) => b.score - a.score);
  if (!ranked[0] || ranked[0].score === 0) return null;
  const row = await prisma.category.findFirst({ where: { nameEn: ranked[0].en } });
  return row?.id ?? null;
}

const genSchema = z.object({ lang: z.enum(["ar", "en"]).default("ar") });

// Generate (or regenerate) the 13-item brief from the conversation (README §8B).
export const POST = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireRole("CLIENT");
  const { id } = await params;
  const { lang } = await parseBody(req, genSchema).catch(() => ({ lang: "ar" as const }));

  const rl = rateLimit(`brief:${session.userId}`, 5);
  if (!rl.ok) throw new ApiError(429, `Rate limited — retry in ${rl.retryAfterSec}s`);

  const { project } = await getOwnedProject(session.userId, id);
  if (!project.conversation) throw new ApiError(409, "Conversation not started");

  const history = messagesOf(project.conversation.messages);
  const extracted = (project.conversation.extractedRequirements ?? {}) as ExtractedRequirements;

  const { brief: gen, mode } = await generateBrief({
    userId: session.userId,
    projectId: id,
    description: project.description,
    history,
    extracted,
    lang,
  });

  const existing = project.brief;
  const data = {
    titleAr: gen.titleAr,
    titleEn: gen.titleEn,
    summaryAr: gen.summaryAr,
    summaryEn: gen.summaryEn,
    objectiveAr: gen.objectiveAr,
    objectiveEn: gen.objectiveEn,
    scopeAr: gen.scopeAr,
    scopeEn: gen.scopeEn,
    deliverablesAr: gen.deliverablesAr,
    deliverablesEn: gen.deliverablesEn,
    requiredSkills: gen.requiredSkills,
    budgetMin: Math.min(gen.budgetMin, gen.budgetMax),
    budgetMax: Math.max(gen.budgetMin, gen.budgetMax),
    timelineAr: gen.timelineAr,
    timelineEn: gen.timelineEn,
    complexity: COMPLEXITY_MAP[gen.complexity],
    complexityPct: Math.round(gen.complexityPct),
    missingAr: gen.missingAr,
    missingEn: gen.missingEn,
    providerTypeAr: gen.providerTypeAr,
    providerTypeEn: gen.providerTypeEn,
    criteriaAr: gen.criteriaAr,
    criteriaEn: gen.criteriaEn,
    milestones: gen.milestones,
    approvedByClient: false,
    editedByClient: false,
  };
  const brief = existing
    ? await prisma.brief.update({
        where: { projectId: id },
        data: { ...data, version: existing.version + 1 }, // regeneration increments version (README §8B)
      })
    : await prisma.brief.create({ data: { ...data, projectId: id } });

  const categoryId =
    project.categoryId ??
    (await inferCategoryId(
      `${gen.titleEn} ${gen.summaryEn} ${gen.requiredSkills.join(" ")} ${(extracted.serviceType ?? "")}`
    ));

  await prisma.project.update({
    where: { id },
    data: {
      status: ProjectStatus.BRIEF_GENERATED,
      titleAr: gen.titleAr,
      titleEn: gen.titleEn,
      budgetMin: data.budgetMin,
      budgetMax: data.budgetMax,
      timelineAr: gen.timelineAr,
      timelineEn: gen.timelineEn,
      complexity: data.complexity,
      requiredSkills: gen.requiredSkills,
      ...(categoryId ? { categoryId } : {}),
    },
  });
  await logActivity(
    id,
    "brief_generated",
    "ولّد الذكاء الاصطناعي الملخص التنفيذي (13 بندًا)",
    "AI generated the Project Brief (13 items)"
  );

  return ok({ brief: toBriefDTO(brief), mode });
});

const editSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  summary: z.string().min(2).max(3000).optional(),
  budgetMin: z.number().int().positive().optional(),
  budgetMax: z.number().int().positive().optional(),
  timeline: z.string().min(1).max(120).optional(),
});

// Client edits (title/summary/budget/timeline) — flags editedByClient, no new version.
export const PATCH = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireRole("CLIENT");
  const { id } = await params;
  const edits = await parseBody(req, editSchema);
  const { project } = await getOwnedProject(session.userId, id);
  if (!project.brief) throw new ApiError(404, "Brief not generated yet");

  const budgetMin = edits.budgetMin ?? project.brief.budgetMin;
  const budgetMax = edits.budgetMax ?? project.brief.budgetMax;
  if (budgetMin > budgetMax) throw new ApiError(400, "budgetMin must be ≤ budgetMax");

  const brief = await prisma.brief.update({
    where: { projectId: id },
    data: {
      ...(edits.title ? { titleAr: edits.title, titleEn: edits.title } : {}),
      ...(edits.summary ? { summaryAr: edits.summary, summaryEn: edits.summary } : {}),
      budgetMin,
      budgetMax,
      ...(edits.timeline ? { timelineAr: edits.timeline, timelineEn: edits.timeline } : {}),
      editedByClient: true,
    },
  });
  await prisma.project.update({
    where: { id },
    data: {
      ...(edits.title ? { titleAr: edits.title, titleEn: edits.title } : {}),
      budgetMin,
      budgetMax,
      ...(edits.timeline ? { timelineAr: edits.timeline, timelineEn: edits.timeline } : {}),
    },
  });
  await logActivity(id, "brief_edited", "عدّل العميل الملخص التنفيذي", "Client edited the Project Brief");
  return ok({ brief: toBriefDTO(brief) });
});
