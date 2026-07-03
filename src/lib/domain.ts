// Domain maps + API DTO shapes shared by route handlers and screens.
import type { ProjectStatus, ProviderType, MatchStatus, Complexity } from "@prisma/client";
import type { Dict } from "./i18n";

// ── Status chips (prototype statusMap, behaviors §7.4) ──────────────
export type StatusChip = { labelKey: keyof Dict; bg: string; fg: string };

const CHIPS = {
  draft: { labelKey: "stDraft", bg: "#F0F3F8", fg: "#7684A0" },
  brief: { labelKey: "stBrief", bg: "#EEF3FB", fg: "#1B3568" },
  matched: { labelKey: "stMatched", bg: "#E8F5F6", fg: "#0E7A81" },
  selected: { labelKey: "stSelected", bg: "#F7F0E3", fg: "#8A6D33" },
  inprogress: { labelKey: "stInprogress", bg: "#FDF9F0", fg: "#8A6D33" },
  completed: { labelKey: "stCompleted", bg: "#E9F6EF", fg: "#1F7A4D" },
} satisfies Record<string, StatusChip>;

export function statusChip(status: ProjectStatus): StatusChip {
  switch (status) {
    case "DRAFT":
      return CHIPS.draft;
    case "BRIEF_GENERATED":
    case "BRIEF_APPROVED":
      return CHIPS.brief;
    case "PROVIDERS_RECOMMENDED":
    case "PROPOSAL_REQUESTED":
      return CHIPS.matched;
    case "PROVIDER_SELECTED":
      return CHIPS.selected;
    case "IN_PROGRESS":
      return CHIPS.inprogress;
    case "COMPLETED":
      return CHIPS.completed;
    case "CANCELLED":
      return { labelKey: "stDraft", bg: "#FBEDEB", fg: "#B0433A" };
  }
}

/** 5-stop project journey index (README §10): مسودة → ملخص → مرشحون → طلب عروض → اختيار. */
export function journeyStep(status: ProjectStatus): number {
  switch (status) {
    case "DRAFT":
      return 0;
    case "BRIEF_GENERATED":
      return 1;
    case "BRIEF_APPROVED":
    case "PROVIDERS_RECOMMENDED":
      return 2;
    case "PROPOSAL_REQUESTED":
      return 3;
    default:
      return 4;
  }
}

/** Match score color coding (README §9). */
export function scoreColor(score: number): string {
  if (score >= 85) return "#0E7A81";
  if (score >= 78) return "#8A6D33";
  return "#7684A0";
}

export const PROVIDER_TYPE_LABELS: Record<ProviderType, { ar: string; en: string }> = {
  FREELANCER: { ar: "مستقل", en: "Freelancer" },
  AGENCY: { ar: "وكالة", en: "Agency" },
  COMPANY: { ar: "شركة", en: "Company" },
  CONSULTANT: { ar: "مستشار", en: "Consultant" },
};

export const AVAILABILITY_LABELS: Record<string, { ar: string; en: string }> = {
  now: { ar: "متاح الآن", en: "Available now" },
  "1_week": { ar: "متاح خلال أسبوع", en: "Available in 1 week" },
  "2_weeks": { ar: "متاح خلال أسبوعين", en: "Available in 2 weeks" },
  "1_month": { ar: "متاح خلال شهر", en: "Available in 1 month" },
};

export const COMPLEXITY_LABELS: Record<Complexity, { ar: string; en: string }> = {
  LOW: { ar: "منخفضة", en: "Low" },
  MEDIUM: { ar: "متوسطة", en: "Medium" },
  HIGH: { ar: "مرتفعة", en: "High" },
};

// ── DTOs returned by the REST API ───────────────────────────────────
export type Milestone = { tAr: string; tEn: string; dAr: string; dEn: string };

export type ChatChip = { ar: string; en: string };
export type ChatMessage = {
  role: "assistant" | "user";
  ar: string;
  en: string;
  chips?: ChatChip[];
  ts: number;
};

export type ExtractedRequirements = {
  serviceType?: string;
  businessContext?: string;
  objective?: string;
  deliverables?: string[];
  budget?: string;
  timeline?: string;
  technicalRequirements?: string[];
  designPreferences?: string;
  targetAudience?: string;
  requiredSkills?: string[];
  riskFactors?: string[];
  missing?: string[];
};

export type ProjectListItemDTO = {
  id: string;
  titleAr: string;
  titleEn: string;
  categoryAr: string | null;
  categoryEn: string | null;
  status: ProjectStatus;
  budgetMin: number | null;
  budgetMax: number | null;
  timelineAr: string | null;
  timelineEn: string | null;
  createdAt: string;
  hasBrief: boolean;
};

export type ActivityDTO = { id: string; type: string; textAr: string; textEn: string; createdAt: string };

export type BriefDTO = {
  id: string;
  projectId: string;
  version: number;
  titleAr: string;
  titleEn: string;
  summaryAr: string;
  summaryEn: string;
  objectiveAr: string;
  objectiveEn: string;
  scopeAr: string[];
  scopeEn: string[];
  deliverablesAr: string[];
  deliverablesEn: string[];
  requiredSkills: string[];
  budgetMin: number;
  budgetMax: number;
  currency: string;
  timelineAr: string;
  timelineEn: string;
  complexity: Complexity;
  complexityPct: number;
  missingAr: string[];
  missingEn: string[];
  providerTypeAr: string;
  providerTypeEn: string;
  criteriaAr: string[];
  criteriaEn: string[];
  milestones: Milestone[];
  qualityScore: number | null;
  approvedByClient: boolean;
  editedByClient: boolean;
};

export type ProviderCardDTO = {
  id: string;
  nameAr: string;
  nameEn: string;
  typeAr: string;
  typeEn: string;
  roleAr: string;
  roleEn: string;
  cityAr: string;
  cityEn: string;
  rating: number;
  years: number;
  priceMin: number | null;
  priceMax: number | null;
  skills: string[];
  verified: boolean;
  avatarColor: string;
  avatarInitial: string;
  availability: string | null;
};

export type MatchDTO = {
  id: string;
  matchScore: number;
  reasonAr: string;
  reasonEn: string;
  status: MatchStatus;
  provider: ProviderCardDTO;
};

export type ProjectDetailDTO = ProjectListItemDTO & {
  description: string;
  brief: BriefDTO | null;
  matches: MatchDTO[];
  activity: ActivityDTO[];
  journeyStep: number;
};

export type OpportunityDTO = {
  matchId: string;
  projectTitleAr: string;
  projectTitleEn: string;
  score: number;
  budgetMin: number | null;
  budgetMax: number | null;
  timelineAr: string | null;
  timelineEn: string | null;
  skills: string[];
  clientAr: string;
  clientEn: string;
  noteAr: string | null;
  noteEn: string | null;
  status: MatchStatus;
  createdAt: string;
};
