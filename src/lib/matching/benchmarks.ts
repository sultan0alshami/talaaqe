import type { Platform } from "../contracts/vocabulary";
import type { Criterion } from "./types";

// Reproducibility hypotheses from handoff §10.4 / decisions D032–D035, not market facts.
// Every changed assumption requires a new strategy and hypothesis version.
export const STRATEGY_ID = "infame-fit-v1-confidence-floor";
export const HYPOTHESIS_VERSION = "infame-platform-hypotheses-v1";
export const WEIGHTS: Readonly<Record<Criterion, number>> = Object.freeze({ age: .25, niche: .20, geography: .15, gender: .10, engagement: .10, budget: .10, exposure: .10 });
export const UNKNOWN_SUBSTITUTION = .5;
export const THRESHOLD = 60;
export const MAX_RESULTS = 12;
export const FRESHNESS_MS = 90 * 24 * 60 * 60 * 1000;
export const SOURCE_CONFIDENCE = Object.freeze({ API: 1, SCREENSHOT_VERIFIED: .7, SELF_REPORTED: .4, PUBLIC_IMPORT: .4 });
export const ENGAGEMENT_BASELINES: Readonly<Record<Platform, number>> = Object.freeze({ INSTAGRAM: 1.6, TIKTOK: 4.6, YOUTUBE: 1.8, SNAPCHAT: 2.5, X: .6 });
export const VIEW_FALLBACKS: Readonly<Record<Platform, number>> = Object.freeze({ INSTAGRAM: .30, TIKTOK: .50, YOUTUBE: .25, SNAPCHAT: .35, X: .10 });
// One explicit story/post/video/short/reel may use the platform hypothesis. LIVE and
// CAMPAIGN have no defensible duration/package definition, so need an observed format average.
export const FALLBACK_FORMATS = new Set(["STORY", "POST", "VIDEO", "SHORT", "REEL"]);
export { FAME_RELATED_NICHES } from "../contracts/taxonomy";
