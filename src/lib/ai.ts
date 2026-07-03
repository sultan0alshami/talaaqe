// AI integration (README §8). Two server-side flows:
//   A. Clarification chat  — Haiku, one focused question/turn, ≤5 total.
//   B. Brief generation    — Sonnet, forced JSON matching the Brief model.
// Both fall back to the prototype's scripted perfume-store flow when no
// ANTHROPIC_API_KEY is configured or the API call fails.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { prisma } from "./prisma";
import { CHAT_SCRIPT, CHAT_DONE, BRIEF, I18N } from "./talaqi-data";
import type { ChatMessage, ExtractedRequirements, Milestone } from "./domain";
import type { Lang } from "./i18n";

export const CHAT_MODEL = "claude-haiku-4-5";
export const BRIEF_MODEL = "claude-sonnet-4-6";

export function aiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

async function logUsage(
  userId: string,
  projectId: string | null,
  flow: "chat" | "brief",
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

const chatSystem = (lang: Lang, questionsAsked: number) => `You are the AI procurement consultant of "Talaqi" (تلاقي), a Saudi platform that turns a client's service need into a documented project brief.
Rules:
- Reply in ${lang === "ar" ? "Modern Standard Arabic (الفصحى المعاصرة)" : "English"} — the client's language.
- Be professional and warm, concise: at most 3 short lines of prose.
- PLAIN TEXT ONLY — no markdown, no asterisks, no bullet points, no headings.
- Ask exactly ONE focused clarifying question per turn. You have asked ${questionsAsked} of a maximum of 5 questions so far.
- Relevant angles: product/service specifics, brand assets, integrations (payments: mada/Apple Pay/STC Pay; local shipping carriers), budget range in SAR, launch timing.
- When requirements are sufficiently covered OR you have asked 5 questions, do NOT ask another question — instead state (in the client's language) that you have the full picture and are ready to generate the Project Brief.
After your visible reply, output a line containing only ===JSON=== followed by a single JSON object (no markdown fence):
{"serviceType":string,"businessContext":string,"objective":string,"deliverables":string[],"budget":string,"timeline":string,"technicalRequirements":string[],"designPreferences":string,"targetAudience":string,"requiredSkills":string[],"riskFactors":string[],"missing":string[],"readyForBrief":boolean}
Fill it cumulatively from the whole conversation; put still-unknown essentials in "missing". Set "readyForBrief" true only when missing is trivial or 5 questions were asked.`;

function parseChatOutput(text: string): { reply: string; extracted: ExtractedRequirements; ready: boolean } {
  const idx = text.indexOf("===JSON===");
  if (idx === -1) return { reply: text.trim(), extracted: {}, ready: false };
  const reply = text.slice(0, idx).trim();
  let extracted: ExtractedRequirements = {};
  let ready = false;
  try {
    const raw = text.slice(idx + "===JSON===".length).trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    const parsed = JSON.parse(raw.slice(start, end + 1)) as ExtractedRequirements & { readyForBrief?: boolean };
    ready = !!parsed.readyForBrief;
    delete (parsed as Record<string, unknown>).readyForBrief;
    extracted = parsed;
  } catch {
    // Keep the reply; extraction is best-effort.
  }
  return { reply, extracted, ready };
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
  if (!preferLive || !aiEnabled()) return scriptedChatTurn(questionsAsked);
  try {
    const messages: Anthropic.MessageParam[] = [
      ...history.map((m) => ({
        role: m.role,
        content: lang === "ar" ? m.ar : m.en,
      })),
      { role: "user" as const, content: userMessage },
    ];
    const res = await client().messages.create({
      model: CHAT_MODEL,
      max_tokens: 700,
      system: chatSystem(lang, questionsAsked),
      messages,
    });
    await logUsage(userId, projectId, "chat", CHAT_MODEL, res.usage);
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const { reply, extracted, ready } = parseChatOutput(text);
    // Hard stop at 5 questions regardless of model judgment.
    return { replyAr: reply, replyEn: reply, extracted, ready: ready || questionsAsked + 1 >= 5, mode: "live" };
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
You receive a client conversation and extracted requirements. Produce a complete, professional, BILINGUAL brief (Modern Standard Arabic + English) by calling the emit_brief tool exactly once.
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
  if (!aiEnabled()) return { brief: scriptedBrief(), mode: "scripted" };

  const transcript = history
    .map((m) => `${m.role === "user" ? "CLIENT" : "CONSULTANT"}: ${lang === "ar" ? m.ar : m.en}`)
    .join("\n");
  const userContent = `Original need: ${description}\n\nConversation:\n${transcript}\n\nExtracted requirements JSON:\n${JSON.stringify(extracted, null, 2)}\n\nCall emit_brief with the complete brief now.`;

  // Forced tool use guarantees schema-valid JSON output.
  const briefTool: Anthropic.Tool = {
    name: "emit_brief",
    description: "Persist the generated 13-item bilingual project brief.",
    input_schema: z.toJSONSchema(briefGenSchema) as Anthropic.Tool.InputSchema,
  };

  const attempt = async (feedback?: string): Promise<BriefGen> => {
    const res = await client().messages.create({
      model: BRIEF_MODEL,
      max_tokens: 4000,
      system: briefSystem,
      messages: [
        {
          role: "user",
          content: feedback
            ? `${userContent}\n\nYour previous tool call was invalid: ${feedback}. Call emit_brief again with corrected input.`
            : userContent,
        },
      ],
      tools: [briefTool],
      tool_choice: { type: "tool", name: "emit_brief" },
    });
    await logUsage(userId, projectId, "brief", BRIEF_MODEL, res.usage);
    const toolUse = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!toolUse) throw new ValidationRetry("no emit_brief tool call in response");
    const parsed = briefGenSchema.safeParse(toolUse.input);
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

/** The hello message that opens every new conversation. */
export function helloMessage(): ChatMessage {
  return { role: "assistant", ar: I18N.ar.chatHello, en: I18N.en.chatHello, ts: Date.now() };
}
