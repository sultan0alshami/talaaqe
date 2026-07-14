// AI integration (README §8). Three server-side flows:
//   A. Clarification chat  — fast model, one focused question/turn, ≤5 total.
//   B. Brief generation    — strong model, forced JSON matching the Brief model.
//   C. Match re-ranking    — strong model re-orders the deterministic top
//      candidates and writes per-provider recommendation reasons.
// Providers: the catalog in ./ai-providers (Claude, Gemini, OpenAI, DeepSeek,
// NVIDIA NIM, Grok, Groq, Mistral, OpenRouter). The admin picks the active
// one in Admin → Settings (stored in AppSetting); "auto" mode uses the first
// provider with a usable key — DB-saved or env var. Every flow falls back to
// its non-AI result (scripted script, scripted brief, deterministic ranking)
// when no provider is configured or the API call fails.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { prisma } from "./prisma";
import { getAiConfig, type ResolvedAi } from "./ai-providers";
import { CHAT_SCRIPT, CHAT_DONE, BRIEF, I18N } from "./talaqi-data";
import type { ChatMessage, ExtractedRequirements, Milestone } from "./domain";
import type { Lang } from "./i18n";
import type { MatchResult, MatchableProvider } from "./matching";

// Free-tier Gemini keys have zero quota on pro models, so both tiers run on
// flash; the -lite fallback absorbs the primary's free-tier "high demand" 503s.
const GEMINI_FALLBACK_MODEL = "gemini-3.1-flash-lite";

export async function aiEnabled(): Promise<boolean> {
  return (await getAiConfig()) !== null;
}

// The admin can rotate keys at runtime, so cache the SDK client per key.
let _anthropic: { key: string; client: Anthropic } | null = null;
function anthropicClient(apiKey: string): Anthropic {
  if (_anthropic?.key !== apiKey) _anthropic = { key: apiKey, client: new Anthropic({ apiKey }) };
  return _anthropic.client;
}

// ── Provider-neutral LLM call ───────────────────────────────────────
export type LlmMessage = { role: "user" | "assistant"; content: string };
export type LlmOptions = {
  tier: "chat" | "brief";
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
  jsonSchema?: Record<string, unknown>;
};
export type LlmResult = {
  text: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
};

/**
 * One text-in/text-out completion against the active provider.
 * With `jsonSchema` the returned text is guaranteed-shape JSON: Anthropic via
 * a forced tool call, Gemini via structured output (responseJsonSchema),
 * OpenAI-compatible providers via json_object mode + schema-in-prompt.
 */
export async function llmText(opts: LlmOptions): Promise<LlmResult> {
  const cfg = await getAiConfig();
  if (!cfg) throw new Error("No AI provider configured");
  return llmTextFor(cfg, opts);
}

/** Same completion against an explicit provider (admin "test connection"). */
export async function llmTextFor(cfg: ResolvedAi, opts: LlmOptions): Promise<LlmResult> {
  switch (cfg.def.kind) {
    case "anthropic":
      return anthropicText(cfg, opts);
    case "gemini":
      return geminiText(cfg, opts);
    case "openai-compat":
      return openaiCompatText(cfg, opts);
  }
}

async function anthropicText(
  cfg: ResolvedAi,
  { tier, system, messages, maxTokens, jsonSchema }: LlmOptions
): Promise<LlmResult> {
  const model = tier === "chat" ? cfg.chatModel : cfg.briefModel;
  const req: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: maxTokens,
    system,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };
  if (jsonSchema) {
    // Forced tool use guarantees schema-valid JSON output.
    req.tools = [
      {
        name: "emit_json",
        description: "Emit the complete result object.",
        input_schema: jsonSchema as Anthropic.Tool.InputSchema,
      },
    ];
    req.tool_choice = { type: "tool", name: "emit_json" };
  }
  const res = await anthropicClient(cfg.apiKey).messages.create(req);
  const usage = { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens };
  if (jsonSchema) {
    const toolUse = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    return { text: toolUse ? JSON.stringify(toolUse.input) : "", model, usage };
  }
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return { text, model, usage };
}

async function geminiText(
  cfg: ResolvedAi,
  { tier, system, messages, jsonSchema }: LlmOptions
): Promise<LlmResult> {
  const key = cfg.apiKey;
  // Gemini expects the conversation to open with a user turn; the fixed
  // assistant hello carries no client information, so drop it.
  const contents = messages
    .filter((m, i) => !(i === 0 && m.role === "assistant"))
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const generationConfig: Record<string, unknown> = {};
  if (jsonSchema) {
    const schema = { ...jsonSchema };
    delete schema.$schema; // zod's dialect marker — not part of the payload schema
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseJsonSchema = schema;
  }
  // maxTokens is intentionally not forwarded: Gemini 3.x models spend
  // "thinking" tokens from the same maxOutputTokens budget, and a low cap
  // truncates the visible reply (or the JSON) mid-stream.
  const primary = tier === "chat" ? cfg.chatModel : cfg.briefModel;
  let lastError: unknown;
  for (const model of [...new Set([primary, GEMINI_FALLBACK_MODEL])]) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents,
            ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
          }),
          signal: AbortSignal.timeout(60_000),
        }
      );
      const data = await res.json();
      if (!res.ok)
        throw new Error(`gemini ${model}: HTTP ${res.status} — ${data?.error?.message ?? "unknown error"}`);
      const parts: Array<{ text?: string; thought?: boolean }> = data.candidates?.[0]?.content?.parts ?? [];
      const text = parts
        .filter((p) => !p.thought && typeof p.text === "string")
        .map((p) => p.text)
        .join("");
      if (!text.trim())
        throw new Error(
          `gemini ${model}: empty response (${data.candidates?.[0]?.finishReason ?? "no candidate"})`
        );
      const u = data.usageMetadata ?? {};
      return {
        text,
        model,
        usage: {
          input_tokens: u.promptTokenCount ?? 0,
          output_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
        },
      };
    } catch (e) {
      // Typically a free-tier "high demand" rejection — try the next model.
      console.error(`[ai] ${String(e)}`);
      lastError = e;
    }
  }
  throw lastError ?? new Error("no Gemini model configured");
}

// One client covers every OpenAI-compatible provider in the catalog (OpenAI,
// DeepSeek, NVIDIA NIM, Grok, Groq, Mistral, OpenRouter) — only baseUrl, key
// and model names differ.
type OpenAiCompatResponse = {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

async function openaiCompatText(
  cfg: ResolvedAi,
  { tier, system, messages, jsonSchema }: LlmOptions
): Promise<LlmResult> {
  const model = tier === "chat" ? cfg.chatModel : cfg.briefModel;
  let sys = system;
  if (jsonSchema) {
    // Schema in the prompt works everywhere; response_format json_object is
    // added where the provider reliably supports it (also satisfies OpenAI's
    // "mention JSON in the messages" requirement). Zod re-validates upstream.
    sys += `\n\nOUTPUT FORMAT: respond with ONLY one valid JSON object — no markdown fence, no commentary — conforming exactly to this JSON Schema:\n${JSON.stringify(jsonSchema)}`;
  }
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: sys },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  };
  if (jsonSchema && cfg.def.jsonMode) body.response_format = { type: "json_object" };
  // maxTokens is intentionally not forwarded: reasoning models (GPT-5, R1…)
  // spend thinking tokens from the same budget, and newer OpenAI models
  // renamed the parameter (max_completion_tokens) — a low cap truncates the
  // reply or rejects the request outright.
  const res = await fetch(`${cfg.def.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const data = (await res.json().catch(() => ({}))) as OpenAiCompatResponse;
  if (!res.ok)
    throw new Error(`${cfg.def.id} ${model}: HTTP ${res.status} — ${data.error?.message ?? "unknown error"}`);
  let text = (data.choices?.[0]?.message?.content ?? "").trim();
  if (jsonSchema) {
    // Some models fence the JSON despite instructions.
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) text = fenced[1].trim();
  }
  if (!text) throw new Error(`${cfg.def.id} ${model}: empty response`);
  const u = data.usage ?? {};
  return {
    text,
    model,
    usage: { input_tokens: u.prompt_tokens ?? 0, output_tokens: u.completion_tokens ?? 0 },
  };
}

async function logUsage(
  userId: string,
  projectId: string | null,
  flow: "chat" | "brief" | "match",
  model: string,
  usage: { input_tokens: number; output_tokens: number }
) {
  try {
    await prisma.aiUsageLog.create({
      data: {
        userId,
        projectId,
        flow,
        model,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
      },
    });
  } catch (e) {
    console.error("[ai] usage log failed", e);
  }
}

// ── Flow A: clarification chat ──────────────────────────────────────
export type ChatTurnResult = {
  replyAr: string;
  replyEn: string;
  ready: boolean;
  extracted: ExtractedRequirements;
  mode: "live" | "scripted";
  chips?: { ar: string; en: string }[];
};

const chatSystem = (lang: Lang, questionsAsked: number) => `You are "مساعد تلاقي" — the AI procurement consultant of Talaqi (تلاقي), a Saudi platform that turns a client's service need into a documented project brief.
Rules:
- Reply in ${
  lang === "ar"
    ? "a warm, natural Saudi Arabic dialect (لهجة سعودية ودودة ومهنية) — the way Saudis actually talk: friendly and approachable but still professional. Use everyday Saudi words (مثل: وش، تبي، ودّك، الحين، عطني، زين، تمام، أبشر) instead of stiff formal Fus'ha. When you ask the user to describe something, use the Saudi imperative \"اوصف\" (never \"وصف\")"
    : "friendly, natural English"
} — always match the client's language.
- Be warm and concise: at most 3 short lines of prose. PLAIN TEXT ONLY — no markdown, asterisks, bullets, or headings.
- Your visible reply (the text before ===JSON===) is REQUIRED on EVERY turn and must never be empty. Always acknowledge what the client just said before doing anything else.
- Ask exactly ONE focused clarifying question per turn. You have asked ${questionsAsked} of a maximum of 5 questions so far.
- Relevant angles: product/service specifics, brand assets, integrations (payments: mada/Apple Pay/STC Pay; local shipping carriers), budget range in SAR, launch timing.
- When requirements are sufficiently covered OR you have asked 5 questions (readyForBrief=true), do NOT ask another question. Instead your visible reply MUST: (1) briefly confirm you got the client's last answer, (2) recap the plan in one or two short lines — the service plus the key specifics you captured (like budget, timeline, main features), and (3) clearly say you're ready to generate the executive brief now. Keep it warm and short (2–3 lines, Saudi dialect for Arabic), and set "options" to [].
After your visible reply, output a line containing only ===JSON=== followed by a single JSON object (no markdown fence):
{"serviceType":string,"businessContext":string,"objective":string,"deliverables":string[],"budget":string,"timeline":string,"technicalRequirements":string[],"designPreferences":string,"targetAudience":string,"requiredSkills":string[],"riskFactors":string[],"missing":string[],"options":string[],"readyForBrief":boolean}
- "options": 2 to 4 SHORT, concrete, mutually-distinct suggested answers to the question you JUST asked, in the client's language (Saudi dialect for Arabic), so they can tap one instead of typing. Each under ~6 words. Use an empty array when readyForBrief is true (no question was asked).
Fill the rest cumulatively from the whole conversation; put still-unknown essentials in "missing". Set "readyForBrief" true only when missing is trivial or 5 questions were asked.`;

function parseChatOutput(text: string): {
  reply: string;
  extracted: ExtractedRequirements;
  ready: boolean;
  options: string[];
} {
  const idx = text.indexOf("===JSON===");
  if (idx === -1) return { reply: text.trim(), extracted: {}, ready: false, options: [] };
  const reply = text.slice(0, idx).trim();
  let extracted: ExtractedRequirements = {};
  let ready = false;
  let options: string[] = [];
  try {
    const raw = text.slice(idx + "===JSON===".length).trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    const parsed = JSON.parse(raw.slice(start, end + 1)) as ExtractedRequirements & {
      readyForBrief?: boolean;
      options?: unknown;
    };
    ready = !!parsed.readyForBrief;
    options = Array.isArray(parsed.options)
      ? parsed.options.filter((o): o is string => typeof o === "string" && o.trim().length > 0).slice(0, 4)
      : [];
    delete (parsed as Record<string, unknown>).readyForBrief;
    delete (parsed as Record<string, unknown>).options;
    extracted = parsed;
  } catch {
    // Keep the reply; extraction is best-effort.
  }
  return { reply, extracted, ready, options };
}

/** Scripted fallback: replay the perfume-store interview from the prototype. */
export function scriptedChatTurn(questionsAsked: number): ChatTurnResult {
  if (questionsAsked < CHAT_SCRIPT.length) {
    const q = CHAT_SCRIPT[questionsAsked];
    return {
      replyAr: q.qAr,
      replyEn: q.qEn,
      ready: false,
      extracted: {},
      mode: "scripted",
      chips: q.chips,
    };
  }
  return {
    replyAr: CHAT_DONE.ar,
    replyEn: CHAT_DONE.en,
    ready: true,
    extracted: {},
    mode: "scripted",
  };
}

export async function chatTurn(opts: {
  userId: string;
  projectId: string;
  history: ChatMessage[];
  userMessage: string;
  questionsAsked: number;
  lang: Lang;
  preferLive: boolean;
}): Promise<ChatTurnResult> {
  const { userId, projectId, history, userMessage, questionsAsked, lang, preferLive } = opts;
  if (!preferLive || !(await aiEnabled())) return scriptedChatTurn(questionsAsked);
  try {
    const messages: LlmMessage[] = [
      ...history.map((m) => ({
        role: m.role,
        content: lang === "ar" ? m.ar : m.en,
      })),
      { role: "user" as const, content: userMessage },
    ];
    const res = await llmText({
      tier: "chat",
      system: chatSystem(lang, questionsAsked),
      messages,
      maxTokens: 700,
    });
    await logUsage(userId, projectId, "chat", res.model, res.usage);
    const { reply, extracted, ready, options } = parseChatOutput(res.text);
    // Hard stop at 5 questions regardless of model judgment.
    const done = ready || questionsAsked + 1 >= 5;
    // The model occasionally emits only the JSON block on the final turn,
    // leaving an empty bubble. Guarantee a visible confirmation message.
    const hasReply = !!reply && reply.trim().length >= 2;
    const replyAr = hasReply
      ? reply
      : done
        ? CHAT_DONE.ar
        : "تمام، عطني تفاصيل أكثر عشان أكمّل الصورة.";
    const replyEn = hasReply
      ? reply
      : done
        ? CHAT_DONE.en
        : "Got it — tell me a bit more so I can complete the picture.";
    return {
      replyAr,
      replyEn,
      extracted,
      ready: done,
      mode: "live",
      // Answer options for the question just asked (AskUserQuestion-style chips).
      chips: done || options.length === 0 ? undefined : options.map((o) => ({ ar: o, en: o })),
    };
  } catch (e) {
    console.error("[ai] chat turn failed, falling back to script", e);
    return scriptedChatTurn(questionsAsked);
  }
}

// ── Flow B: brief generation ────────────────────────────────────────
const milestoneSchema = z.object({ tAr: z.string(), tEn: z.string(), dAr: z.string(), dEn: z.string() });
export const briefGenSchema = z.object({
  titleAr: z.string().min(2),
  titleEn: z.string().min(2),
  summaryAr: z.string().min(10),
  summaryEn: z.string().min(10),
  objectiveAr: z.string().min(5),
  objectiveEn: z.string().min(5),
  scopeAr: z.array(z.string()).min(3).max(10),
  scopeEn: z.array(z.string()).min(3).max(10),
  deliverablesAr: z.array(z.string()).min(2).max(8),
  deliverablesEn: z.array(z.string()).min(2).max(8),
  requiredSkills: z.array(z.string()).min(2).max(8),
  budgetMin: z.number().int().positive(),
  budgetMax: z.number().int().positive(),
  timelineAr: z.string(),
  timelineEn: z.string(),
  complexity: z.enum(["low", "medium", "high"]),
  complexityPct: z.number().min(0).max(100),
  missingAr: z.array(z.string()).max(5),
  missingEn: z.array(z.string()).max(5),
  providerTypeAr: z.string(),
  providerTypeEn: z.string(),
  criteriaAr: z.array(z.string()).min(2).max(6),
  criteriaEn: z.array(z.string()).min(2).max(6),
  milestones: z.array(milestoneSchema).min(2).max(8),
});
export type BriefGen = z.infer<typeof briefGenSchema>;

const briefSystem = `You generate the 13-item Project Brief for "Talaqi" (تلاقي), an AI procurement platform for the Saudi/GCC market.
You receive a client conversation and extracted requirements. Produce a complete, professional, BILINGUAL brief (Modern Standard Arabic + English) as a single JSON object that matches the required schema exactly.
Constraints:
- budgetMin/budgetMax MUST be a realistic SAR range grounded in the budget the client stated (never contradict it; if none stated, estimate from market norms and note it in missing questions).
- timeline must be a realistic range consistent with scope (e.g. "3 – 5 أسابيع" / "3–5 weeks").
- complexity ∈ low|medium|high with complexityPct (0-100) matching it (low≈25, medium≈55, high≈80).
- scope items are ordered, concrete and measurable; skills are short skill names in English (they render as chips).
- Arabic must be professional Fus'ha, not a literal translation. Plain text in every field — no markdown.`;

/** Scripted fallback brief: the prototype's perfume-store BRIEF. */
export function scriptedBrief(): BriefGen {
  return {
    titleAr: BRIEF.titleAr,
    titleEn: BRIEF.titleEn,
    summaryAr: BRIEF.summaryAr,
    summaryEn: BRIEF.summaryEn,
    objectiveAr: BRIEF.objectiveAr,
    objectiveEn: BRIEF.objectiveEn,
    scopeAr: BRIEF.scopeAr,
    scopeEn: BRIEF.scopeEn,
    deliverablesAr: BRIEF.deliverablesAr,
    deliverablesEn: BRIEF.deliverablesEn,
    requiredSkills: BRIEF.skills,
    budgetMin: 4000,
    budgetMax: 8000,
    timelineAr: BRIEF.timelineAr,
    timelineEn: BRIEF.timelineEn,
    complexity: "medium",
    complexityPct: BRIEF.complexityPct,
    missingAr: BRIEF.missingAr,
    missingEn: BRIEF.missingEn,
    providerTypeAr: BRIEF.providerTypeAr,
    providerTypeEn: BRIEF.providerTypeEn,
    criteriaAr: BRIEF.criteriaAr,
    criteriaEn: BRIEF.criteriaEn,
    milestones: BRIEF.milestonesAr.map((m, i) => ({
      tAr: m.t,
      tEn: BRIEF.milestonesEn[i].t,
      dAr: m.d,
      dEn: BRIEF.milestonesEn[i].d,
    })) as Milestone[],
  };
}

export async function generateBrief(opts: {
  userId: string;
  projectId: string;
  description: string;
  history: ChatMessage[];
  extracted: ExtractedRequirements;
  lang: Lang;
}): Promise<{ brief: BriefGen; mode: "live" | "scripted" }> {
  const { userId, projectId, description, history, extracted, lang } = opts;
  if (!(await aiEnabled())) return { brief: scriptedBrief(), mode: "scripted" };

  const transcript = history
    .map((m) => `${m.role === "user" ? "CLIENT" : "CONSULTANT"}: ${lang === "ar" ? m.ar : m.en}`)
    .join("\n");
  const userContent = `Original need: ${description}\n\nConversation:\n${transcript}\n\nExtracted requirements JSON:\n${JSON.stringify(extracted, null, 2)}\n\nProduce the complete brief now.`;

  const jsonSchema = z.toJSONSchema(briefGenSchema) as Record<string, unknown>;

  const attempt = async (feedback?: string): Promise<BriefGen> => {
    const res = await llmText({
      tier: "brief",
      system: briefSystem,
      messages: [
        {
          role: "user",
          content: feedback
            ? `${userContent}\n\nYour previous output was invalid: ${feedback}. Produce the corrected, complete JSON now.`
            : userContent,
        },
      ],
      maxTokens: 4000,
      jsonSchema,
    });
    await logUsage(userId, projectId, "brief", res.model, res.usage);
    let raw: unknown;
    try {
      raw = JSON.parse(res.text);
    } catch {
      throw new ValidationRetry("output was not a valid JSON object");
    }
    const parsed = briefGenSchema.safeParse(raw);
    if (!parsed.success) throw new ValidationRetry(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    return parsed.data;
  };

  try {
    return { brief: await attempt(), mode: "live" };
  } catch (e) {
    if (e instanceof ValidationRetry) {
      try {
        return { brief: await attempt(e.message), mode: "live" }; // retry once on invalid JSON (README §8B)
      } catch (e2) {
        console.error("[ai] brief retry failed, falling back to scripted", e2);
        return { brief: scriptedBrief(), mode: "scripted" };
      }
    }
    console.error("[ai] brief generation failed, falling back to scripted", e);
    return { brief: scriptedBrief(), mode: "scripted" };
  }
}

class ValidationRetry extends Error {}

// ── Flow C: AI match re-ranking ─────────────────────────────────────
// Takes the deterministic engine's top candidates, re-orders them by true
// fit and writes one specific bilingual reason per provider. Returns null
// (→ caller keeps the deterministic ranking) when AI is off or fails.
export type RerankCandidate = {
  result: MatchResult; // deterministic score + breakdown (kept for explainability)
  profile: MatchableProvider;
  roleTitleAr: string | null;
  roleTitleEn: string | null;
  providerType: string;
  locationEn: string | null;
};

export type RerankedMatch = {
  providerId: string;
  matchScore: number;
  reasonAr: string;
  reasonEn: string;
  breakdown: MatchResult["breakdown"];
};

const rerankSchema = z.object({
  selections: z
    .array(
      z.object({
        index: z.number().int().min(1),
        score: z.number().int().min(0).max(100),
        reasonAr: z.string().min(10),
        reasonEn: z.string().min(10),
      })
    )
    .min(3)
    .max(6),
});

const rerankSystem = `You are the recommendation-quality layer of "Talaqi" (تلاقي), an AI procurement platform for the Saudi/GCC market.
You receive an approved project brief and a numbered shortlist of candidate service providers, each with a base score from a deterministic keyword-matching engine.
Your job:
1. Re-rank by TRUE fit that keyword matching cannot see: semantic skill relevance, domain relevance of portfolio work, price realism against the budget, availability against the timeline, and provider-type suitability for the project size.
2. Select the best 3–6 candidates (prefer 6 when at least 6 are genuinely suitable), ordered best-first. A score of 60 is the platform's recommendation bar: drop candidates that merit less than 60 — unless fewer than 3 candidates reach 60, in which case return the best 3 overall with their honest scores.
3. Give each a final integer score 0–100. Stay within ±12 of its base score unless a concrete mismatch or advantage justifies more; scores must strictly decrease with your ordering (no ties).
4. Write ONE specific sentence per candidate explaining why THIS provider fits THIS project: "reasonAr" in professional Arabic Fus'ha and "reasonEn" in natural English. Cite concrete factors (a matching skill, a relevant portfolio item, price fit, availability). Plain text, no markdown. Never write a generic sentence that could apply to any provider.`;

export async function rerankMatches(opts: {
  userId: string;
  projectId: string;
  brief: {
    titleAr: string;
    titleEn: string;
    summaryEn?: string | null;
    requiredSkills: string[];
    budgetMin: number;
    budgetMax: number;
    timelineEn?: string | null;
    categoryEn?: string | null;
  };
  candidates: RerankCandidate[];
}): Promise<RerankedMatch[] | null> {
  const { userId, projectId, brief, candidates } = opts;
  if (!(await aiEnabled()) || candidates.length < 3) return null;

  const AVAIL_LABEL: Record<string, string> = { now: "now", "1_week": "in 1 week", "2_weeks": "in 2 weeks", "1_month": "in 1 month" };
  const lines = candidates.map((c, i) => {
    const p = c.profile;
    return [
      `#${i + 1} — base score ${c.result.matchScore}`,
      `Name: ${p.nameEn} | ${p.nameAr} (${c.providerType}${c.locationEn ? `, ${c.locationEn}` : ""})`,
      `Role: ${c.roleTitleEn ?? c.roleTitleAr ?? "-"}`,
      `Experience: ${p.experienceYears} years | Price range: ${p.priceRangeMin ?? "?"}–${p.priceRangeMax ?? "?"} SAR | Available: ${AVAIL_LABEL[p.availability ?? ""] ?? "unknown"} | Rating: ${p.rating.toFixed(1)}/5`,
      `Skills: ${p.skills.join(", ") || "-"}`,
      `Portfolio: ${p.portfolioTitles.join("; ") || "-"}`,
    ].join("\n");
  });
  const userContent = `PROJECT BRIEF
Title: ${brief.titleEn} | ${brief.titleAr}
${brief.categoryEn ? `Category: ${brief.categoryEn}\n` : ""}${brief.summaryEn ? `Summary: ${brief.summaryEn}\n` : ""}Required skills: ${brief.requiredSkills.join(", ")}
Budget: ${brief.budgetMin}–${brief.budgetMax} SAR${brief.timelineEn ? `\nTimeline: ${brief.timelineEn}` : ""}

CANDIDATES (${candidates.length})
${lines.join("\n\n")}

Return your selections now.`;

  const jsonSchema = z.toJSONSchema(rerankSchema) as Record<string, unknown>;
  const attempt = async (feedback?: string) => {
    const res = await llmText({
      tier: "brief",
      system: rerankSystem,
      messages: [
        {
          role: "user",
          content: feedback
            ? `${userContent}\n\nYour previous output was invalid: ${feedback}. Return corrected selections now.`
            : userContent,
        },
      ],
      maxTokens: 2500,
      jsonSchema,
    });
    await logUsage(userId, projectId, "match", res.model, res.usage);
    let raw: unknown;
    try {
      raw = JSON.parse(res.text);
    } catch {
      throw new ValidationRetry("output was not a valid JSON object");
    }
    const parsed = rerankSchema.safeParse(raw);
    if (!parsed.success) throw new ValidationRetry(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const seen = new Set<number>();
    for (const s of parsed.data.selections) {
      if (s.index > candidates.length) throw new ValidationRetry(`index ${s.index} is out of range (1–${candidates.length})`);
      if (seen.has(s.index)) throw new ValidationRetry(`index ${s.index} appears more than once`);
      seen.add(s.index);
    }
    return parsed.data.selections;
  };

  try {
    let selections;
    try {
      selections = await attempt();
    } catch (e) {
      if (!(e instanceof ValidationRetry)) throw e;
      selections = await attempt(e.message); // one retry with validation feedback
    }
    return selections
      .map((s) => {
        const c = candidates[s.index - 1];
        return {
          providerId: c.profile.id,
          matchScore: Math.max(0, Math.min(100, Math.round(s.score))),
          reasonAr: s.reasonAr.trim(),
          reasonEn: s.reasonEn.trim(),
          breakdown: c.result.breakdown,
        };
      })
      .sort((a, b) => b.matchScore - a.matchScore);
  } catch (e) {
    console.error("[ai] match re-ranking failed, using deterministic ranking", e);
    return null;
  }
}

/** The hello message that opens every new conversation. */
export function helloMessage(): ChatMessage {
  return { role: "assistant", ar: I18N.ar.chatHello, en: I18N.en.chatHello, ts: Date.now() };
}
