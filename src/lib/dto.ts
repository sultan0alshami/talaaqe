// Mappers from Prisma rows (with standard includes) to API DTOs.
import type { Prisma } from "@prisma/client";
import {
  PROVIDER_TYPE_LABELS,
  journeyStep,
  type ActivityDTO,
  type BriefDTO,
  type ChatMessage,
  type MatchDTO,
  type Milestone,
  type OpportunityDTO,
  type ProjectDetailDTO,
  type ProjectListItemDTO,
  type ProviderCardDTO,
} from "./domain";

export const providerCardInclude = {
  user: true,
  skills: { include: { skill: true } },
} satisfies Prisma.ProviderInclude;

type ProviderRow = Prisma.ProviderGetPayload<{ include: typeof providerCardInclude }>;

export function toProviderCard(p: ProviderRow): ProviderCardDTO {
  const type = PROVIDER_TYPE_LABELS[p.providerType];
  return {
    id: p.id,
    nameAr: p.user.name,
    nameEn: p.user.nameEn ?? p.user.name,
    typeAr: type.ar,
    typeEn: type.en,
    roleAr: p.roleTitleAr ?? "",
    roleEn: p.roleTitleEn ?? p.roleTitleAr ?? "",
    cityAr: p.locationAr ?? "",
    cityEn: p.locationEn ?? p.locationAr ?? "",
    rating: p.rating,
    years: p.experienceYears,
    priceMin: p.priceRangeMin,
    priceMax: p.priceRangeMax,
    skills: p.skills.map((s) => s.skill.name),
    verified: p.verifiedStatus === "APPROVED",
    avatarColor: p.avatarColor ?? "#1B3568",
    avatarInitial: p.avatarInitial ?? (p.user.name.trim().charAt(0) || "؟"),
    availability: p.availability,
  };
}

type BriefRow = Prisma.BriefGetPayload<Record<string, never>>;

export function toBriefDTO(b: BriefRow): BriefDTO {
  return {
    id: b.id,
    projectId: b.projectId,
    version: b.version,
    titleAr: b.titleAr,
    titleEn: b.titleEn,
    summaryAr: b.summaryAr,
    summaryEn: b.summaryEn,
    objectiveAr: b.objectiveAr,
    objectiveEn: b.objectiveEn,
    scopeAr: b.scopeAr,
    scopeEn: b.scopeEn,
    deliverablesAr: b.deliverablesAr,
    deliverablesEn: b.deliverablesEn,
    requiredSkills: b.requiredSkills,
    budgetMin: b.budgetMin,
    budgetMax: b.budgetMax,
    currency: b.currency,
    timelineAr: b.timelineAr,
    timelineEn: b.timelineEn,
    complexity: b.complexity,
    complexityPct: b.complexityPct,
    missingAr: b.missingAr,
    missingEn: b.missingEn,
    providerTypeAr: b.providerTypeAr,
    providerTypeEn: b.providerTypeEn,
    criteriaAr: b.criteriaAr,
    criteriaEn: b.criteriaEn,
    milestones: (b.milestones as Milestone[] | null) ?? [],
    qualityScore: b.qualityScore,
    approvedByClient: b.approvedByClient,
    editedByClient: b.editedByClient,
  };
}

export const projectListInclude = {
  category: true,
  brief: { select: { id: true } },
} satisfies Prisma.ProjectInclude;

type ProjectListRow = Prisma.ProjectGetPayload<{ include: typeof projectListInclude }>;

export function toProjectListItem(p: ProjectListRow): ProjectListItemDTO {
  return {
    id: p.id,
    titleAr: p.titleAr,
    titleEn: p.titleEn,
    categoryAr: p.category?.nameAr ?? null,
    categoryEn: p.category?.nameEn ?? null,
    status: p.status,
    budgetMin: p.budgetMin,
    budgetMax: p.budgetMax,
    timelineAr: p.timelineAr,
    timelineEn: p.timelineEn,
    createdAt: p.createdAt.toISOString(),
    hasBrief: !!p.brief,
  };
}

export const projectDetailInclude = {
  category: true,
  brief: true,
  matches: {
    include: { provider: { include: providerCardInclude } },
    orderBy: { matchScore: "desc" as const },
  },
  activity: { orderBy: { createdAt: "desc" as const } },
} satisfies Prisma.ProjectInclude;

type ProjectDetailRow = Prisma.ProjectGetPayload<{ include: typeof projectDetailInclude }>;

export function toMatchDTO(
  m: ProjectDetailRow["matches"][number]
): MatchDTO {
  return {
    id: m.id,
    matchScore: m.matchScore,
    reasonAr: m.reasonAr,
    reasonEn: m.reasonEn,
    status: m.status,
    provider: toProviderCard(m.provider),
  };
}

export function toActivityDTO(a: ProjectDetailRow["activity"][number]): ActivityDTO {
  return { id: a.id, type: a.type, textAr: a.textAr, textEn: a.textEn, createdAt: a.createdAt.toISOString() };
}

export function toProjectDetail(p: ProjectDetailRow): ProjectDetailDTO {
  return {
    id: p.id,
    titleAr: p.titleAr,
    titleEn: p.titleEn,
    categoryAr: p.category?.nameAr ?? null,
    categoryEn: p.category?.nameEn ?? null,
    status: p.status,
    budgetMin: p.budgetMin,
    budgetMax: p.budgetMax,
    timelineAr: p.timelineAr,
    timelineEn: p.timelineEn,
    createdAt: p.createdAt.toISOString(),
    hasBrief: !!p.brief,
    description: p.description,
    brief: p.brief ? toBriefDTO(p.brief) : null,
    matches: p.matches.map(toMatchDTO),
    activity: p.activity.map(toActivityDTO),
    journeyStep: journeyStep(p.status),
  };
}

export const opportunityInclude = {
  project: { include: { client: { include: { user: true } } } },
} satisfies Prisma.MatchInclude;

type OpportunityRow = Prisma.MatchGetPayload<{ include: typeof opportunityInclude }>;

export function toOpportunityDTO(m: OpportunityRow): OpportunityDTO {
  const clientUser = m.project.client.user;
  return {
    matchId: m.id,
    projectTitleAr: m.project.titleAr,
    projectTitleEn: m.project.titleEn,
    score: m.matchScore,
    budgetMin: m.project.budgetMin,
    budgetMax: m.project.budgetMax,
    timelineAr: m.project.timelineAr,
    timelineEn: m.project.timelineEn,
    skills: m.project.requiredSkills,
    clientAr: clientUser.companyName ?? clientUser.name,
    clientEn: clientUser.nameEn ?? clientUser.companyName ?? clientUser.name,
    noteAr: m.noteAr,
    noteEn: m.noteEn,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
  };
}

export function messagesOf(conversationMessages: unknown): ChatMessage[] {
  return Array.isArray(conversationMessages) ? (conversationMessages as ChatMessage[]) : [];
}
