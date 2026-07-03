import { ProjectStatus, MatchStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { handler, ok, requireRole, ApiError } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { getOwnedProject } from "@/lib/ownership";
import { rankProviders, type MatchableBrief, type MatchableProvider } from "@/lib/matching";
import { providerCardInclude, toMatchDTO } from "@/lib/dto";

// Approve the brief → BRIEF_APPROVED, run the matching engine → PROVIDERS_RECOMMENDED.
export const POST = handler(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireRole("CLIENT");
  const { id } = await params;
  const { project } = await getOwnedProject(session.userId, id);
  const brief = project.brief;
  if (!brief) throw new ApiError(404, "Brief not generated yet");

  await prisma.brief.update({ where: { projectId: id }, data: { approvedByClient: true } });
  await prisma.project.update({ where: { id }, data: { status: ProjectStatus.BRIEF_APPROVED } });
  await logActivity(id, "brief_approved", "اعتمد العميل الملخص التنفيذي", "Client approved the Project Brief");

  // ── Matching engine (README §9) over APPROVED providers ──────────
  const providers = await prisma.provider.findMany({
    where: { verifiedStatus: "APPROVED", user: { active: true } },
    include: {
      user: true,
      skills: { include: { skill: true } },
      categories: true,
      portfolio: true,
    },
  });
  const matchable: MatchableProvider[] = providers.map((p) => ({
    id: p.id,
    nameAr: p.user.name,
    nameEn: p.user.nameEn ?? p.user.name,
    skills: p.skills.map((s) => s.skill.name),
    categoryIds: p.categories.map((c) => c.categoryId),
    priceRangeMin: p.priceRangeMin,
    priceRangeMax: p.priceRangeMax,
    experienceYears: p.experienceYears,
    availability: p.availability,
    rating: p.rating,
    portfolioTitles: p.portfolio.map((i) => `${i.title} ${i.titleEn ?? ""}`),
  }));
  const matchableBrief: MatchableBrief = {
    requiredSkills: brief.requiredSkills,
    budgetMin: brief.budgetMin,
    budgetMax: brief.budgetMax,
    categoryId: project.categoryId,
    categoryNames: project.category ? [project.category.nameAr, project.category.nameEn] : [],
    titleAr: brief.titleAr,
    titleEn: brief.titleEn,
  };
  const ranked = rankProviders(matchableBrief, matchable);

  // Re-approval after regeneration: refresh untouched recommendations only.
  await prisma.match.deleteMany({ where: { projectId: id, status: MatchStatus.RECOMMENDED } });
  const kept = await prisma.match.findMany({ where: { projectId: id }, select: { providerId: true } });
  const keptIds = new Set(kept.map((k) => k.providerId));
  for (const r of ranked) {
    if (keptIds.has(r.providerId)) continue;
    await prisma.match.create({
      data: {
        projectId: id,
        providerId: r.providerId,
        matchScore: r.matchScore,
        reasonAr: r.reasonAr,
        reasonEn: r.reasonEn,
        scoreBreakdown: r.breakdown,
        status: MatchStatus.RECOMMENDED,
      },
    });
  }

  await prisma.project.update({ where: { id }, data: { status: ProjectStatus.PROVIDERS_RECOMMENDED } });
  const total = await prisma.match.count({ where: { projectId: id } });
  await logActivity(
    id,
    "providers_recommended",
    `تم ترشيح ${total} مقدمي خدمة للمشروع`,
    `${total} providers recommended for the project`
  );

  const matches = await prisma.match.findMany({
    where: { projectId: id },
    include: { provider: { include: providerCardInclude } },
    orderBy: { matchScore: "desc" },
  });
  return ok({ matches: matches.map(toMatchDTO) });
});
