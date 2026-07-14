// Deterministic weighted matching engine (README §9).
// Runs on brief approval over APPROVED providers; no AI required — an
// optional AI layer (rerankMatches in ai.ts) re-orders the top candidates
// and writes richer reasons, falling back to these results untouched.

export type MatchableProvider = {
  id: string;
  nameAr: string;
  nameEn: string;
  skills: string[];
  categoryIds: string[];
  priceRangeMin: number | null;
  priceRangeMax: number | null;
  experienceYears: number;
  availability: string | null; // now | 1_week | 2_weeks | 1_month
  rating: number;
  portfolioTitles: string[];
};

export type MatchableBrief = {
  requiredSkills: string[];
  budgetMin: number;
  budgetMax: number;
  categoryId: string | null;
  categoryNames: string[]; // Ar + En names of the project category, for portfolio keyword match
  titleEn: string;
  titleAr: string;
};

export type ScoreBreakdown = {
  skills: number;
  category: number;
  budget: number;
  experience: number;
  availability: number;
  rating: number;
  portfolio: number;
};

export type MatchResult = {
  providerId: string;
  matchScore: number;
  breakdown: ScoreBreakdown;
  reasonAr: string;
  reasonEn: string;
};

export const WEIGHTS: Record<keyof ScoreBreakdown, number> = {
  skills: 0.3,
  category: 0.15,
  budget: 0.15,
  experience: 0.1,
  availability: 0.1,
  rating: 0.1,
  portfolio: 0.1,
};

const AVAILABILITY_SCORE: Record<string, number> = {
  now: 1,
  "1_week": 0.75,
  "2_weeks": 0.5,
  "1_month": 0.25,
};

const norm = (s: string) => s.toLowerCase().replace(/[ً-ْ]/g, "").trim();

/** A brief skill matches a provider skill on exact or containment (≥4 chars) overlap. */
function skillMatches(briefSkill: string, providerSkills: string[]): boolean {
  // Brief skills may be compound ("Shopify / WooCommerce") — any part matching counts.
  const parts = briefSkill.split(/[/,،]/).map(norm).filter(Boolean);
  return providerSkills.some((ps) => {
    const p = norm(ps);
    return parts.some(
      (b) => b === p || (b.length >= 4 && p.includes(b)) || (p.length >= 4 && b.includes(p))
    );
  });
}

function budgetFit(
  pMin: number | null,
  pMax: number | null,
  bMin: number,
  bMax: number
): number {
  if (pMin == null || pMax == null || pMax <= pMin || bMax <= bMin) return 0.5; // unknown → neutral
  const overlap = Math.max(0, Math.min(pMax, bMax) - Math.max(pMin, bMin));
  if (overlap <= 0) return 0;
  // Fraction of the smaller range covered — full containment scores 1.
  return Math.min(1, overlap / Math.min(pMax - pMin, bMax - bMin));
}

function portfolioRelevance(brief: MatchableBrief, titles: string[]): number {
  if (titles.length === 0) return 0;
  const keywords = [
    ...brief.requiredSkills.flatMap((s) => s.split(/[/,،\s]+/)),
    ...brief.categoryNames.flatMap((c) => c.split(/\s+/)),
    ...brief.titleEn.split(/\s+/),
    ...brief.titleAr.split(/\s+/),
  ]
    .map(norm)
    .filter((w) => w.length >= 4);
  const hits = titles.filter((t) => {
    const tt = norm(t);
    return keywords.some((k) => tt.includes(k));
  }).length;
  return Math.min(1, hits / 2);
}

export function scoreProvider(brief: MatchableBrief, p: MatchableProvider): { breakdown: ScoreBreakdown; matchScore: number } {
  const reqSkills = brief.requiredSkills.filter(Boolean);
  const breakdown: ScoreBreakdown = {
    skills:
      reqSkills.length === 0
        ? 0.5
        : reqSkills.filter((s) => skillMatches(s, p.skills)).length / reqSkills.length,
    category: brief.categoryId && p.categoryIds.includes(brief.categoryId) ? 1 : 0,
    budget: budgetFit(p.priceRangeMin, p.priceRangeMax, brief.budgetMin, brief.budgetMax),
    experience: Math.min(p.experienceYears / 10, 1),
    availability: AVAILABILITY_SCORE[p.availability ?? ""] ?? 0.5,
    rating: Math.max(0, Math.min(p.rating / 5, 1)),
    portfolio: portfolioRelevance(brief, p.portfolioTitles),
  };
  const score = (Object.keys(WEIGHTS) as (keyof ScoreBreakdown)[]).reduce(
    (sum, k) => sum + WEIGHTS[k] * breakdown[k],
    0
  );
  return { breakdown, matchScore: Math.round(score * 100) };
}

const REASON_PHRASES: Record<
  keyof ScoreBreakdown,
  (p: MatchableProvider, brief: MatchableBrief) => { ar: string; en: string }
> = {
  skills: (p, brief) => {
    const matched = brief.requiredSkills
      .filter((s) => skillMatches(s, p.skills))
      .slice(0, 3)
      .join("، ");
    return {
      ar: `تطابق قوي في المهارات المطلوبة (${matched})`,
      en: `strong fit on the required skills (${brief.requiredSkills
        .filter((s) => skillMatches(s, p.skills))
        .slice(0, 3)
        .join(", ")})`,
    };
  },
  category: (_p, brief) => ({
    ar: `تخصص مباشر في ${brief.categoryNames[0] ?? "مجال المشروع"}`,
    en: `direct specialty in ${brief.categoryNames[1] ?? brief.categoryNames[0] ?? "the project domain"}`,
  }),
  budget: () => ({
    ar: "نطاق أسعاره متوافق تمامًا مع ميزانيتك المقترحة",
    en: "pricing squarely within your proposed budget",
  }),
  experience: (p) => ({
    ar: `خبرة عملية تمتد ${p.experienceYears} سنوات`,
    en: `${p.experienceYears} years of hands-on experience`,
  }),
  availability: (p) => ({
    ar: p.availability === "now" ? "متاح للبدء فورًا" : "توفر قريب يناسب جدولك",
    en: p.availability === "now" ? "available to start immediately" : "availability that fits your timeline",
  }),
  rating: (p) => ({
    ar: `تقييم مرتفع من العملاء (${p.rating.toFixed(1)}★)`,
    en: `highly rated by clients (${p.rating.toFixed(1)}★)`,
  }),
  portfolio: () => ({
    ar: "أعمال سابقة وثيقة الصلة بطبيعة مشروعك",
    en: "closely related past work",
  }),
};

/** v1 reason: one Arabic + one English sentence from the top-2 weighted contributions. */
export function buildReason(brief: MatchableBrief, p: MatchableProvider, breakdown: ScoreBreakdown): { ar: string; en: string } {
  const ranked = (Object.keys(WEIGHTS) as (keyof ScoreBreakdown)[])
    .map((k) => ({ k, contribution: WEIGHTS[k] * breakdown[k] }))
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 2);
  const [first, second] = ranked.map(({ k }) => REASON_PHRASES[k](p, brief));
  const ar = second ? `${first.ar}، مع ${second.ar}` : first.ar;
  const enBody = second ? `${first.en}, plus ${second.en}` : first.en;
  return { ar, en: enBody.charAt(0).toUpperCase() + enBody.slice(1) };
}

/** Score and sort ALL providers for a brief, best first (no cut applied). */
export function scoreAllProviders(brief: MatchableBrief, providers: MatchableProvider[]): MatchResult[] {
  return providers
    .map((p) => {
      const { breakdown, matchScore } = scoreProvider(brief, p);
      const reason = buildReason(brief, p, breakdown);
      return { providerId: p.id, matchScore, breakdown, reasonAr: reason.ar, reasonEn: reason.en };
    })
    .sort((a, b) => b.matchScore - a.matchScore);
}

/**
 * Recommendation cut: the top 6 with score ≥ 60; if fewer than 3 clear the
 * threshold, falls back to the top 3 overall so the client always gets
 * recommendations (acceptance criteria §15.1).
 */
export function cutRecommendations(scored: MatchResult[]): MatchResult[] {
  const passing = scored.filter((s) => s.matchScore >= 60).slice(0, 6);
  return passing.length >= 3 ? passing : scored.slice(0, 3);
}

/** Rank APPROVED providers for a brief: score everything, apply the cut. */
export function rankProviders(brief: MatchableBrief, providers: MatchableProvider[]): MatchResult[] {
  return cutRecommendations(scoreAllProviders(brief, providers));
}
