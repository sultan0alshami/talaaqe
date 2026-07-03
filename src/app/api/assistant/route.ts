import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { handler, ok, fail, parseBody, ApiError } from "@/lib/api";
import { aiEnabled, CHAT_MODEL } from "@/lib/ai";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

// Public visitor assistant. Answers questions about the Talaqi platform only.
// Uses the same Anthropic key as the rest of the app (server-side), Haiku model.
const schema = z.object({
  lang: z.enum(["ar", "en"]).default("ar"),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(2000),
      })
    )
    .min(1)
    .max(20),
});

const KNOWLEDGE = `About Talaqi (تلاقي):
- Talaqi is an AI Procurement & Execution Platform for the Saudi/GCC market — the intelligent operating system for professional services. It is NOT a freelance marketplace.
- Flow: the client describes a need in plain language → the AI asks up to 5 clarifying questions → it generates a structured 13-item Project Brief (scope, deliverables, budget, timeline, complexity, milestones, evaluation criteria) → the client edits/approves it → a matching engine recommends the best-fit verified providers with a match score and a clear reason → the client requests proposals and executes.
- For clients: no need to be a procurement expert — describe the need and Talaqi handles scoping, budget estimation and matching, with a documented brief and a short, explained shortlist instead of long lists.
- For providers: receive documented opportunities with client-approved briefs, matched to their skills/rates/availability — less time on dead-end bids. Providers create a profile, get verified by an admin review, then receive matched opportunities.
- 16 service categories (e.g. e-commerce development, web development, mobile apps, UI/UX, branding, digital marketing, content, data analysis, cybersecurity, AI solutions, business/legal consulting, accounting, photography).
- Subscription plans (SAR per month): Free (0) — basic project request, simple brief, limited recommendations; Pro Client (99) — advanced brief, budget & timeline estimation, wider recommendations, priority matching; Business (349) — multiple projects, team access, advanced dashboard, AI procurement assistant, dedicated support; Provider Pro (149) — enhanced profile, more visibility, matching insights, portfolio optimization.
- To start, visitors sign up as a client or a provider from the "Sign up" / "سجل الآن" button.`;

const systemPrompt = (lang: "ar" | "en") => `You are "مساعد تلاقي" / the Talaqi assistant — a friendly, professional support assistant embedded on the Talaqi marketing website to help visitors understand the platform.
Reply in ${
  lang === "ar"
    ? "a warm, natural Saudi Arabic dialect (لهجة سعودية ودودة ومهنية) — the way Saudis actually talk (وش، تبي، ودّك، الحين، تقدر، أبشر)، friendly but professional, not stiff Fus'ha. When asking the user to describe something, use the imperative \"اوصف\" (never \"وصف\")"
    : "friendly, natural English"
} — but always follow the visitor's language if they switch.
Be concise and warm: 1–4 short sentences, no markdown, no bullet symbols. When helpful, gently invite the visitor to sign up (as a client to post a need, or as a provider to receive opportunities).
Only answer questions about Talaqi, its services, how it works, pricing/subscriptions, and getting started. If asked something unrelated or something you don't know, say briefly that you can only help with questions about Talaqi and suggest contacting the team via the Contact page. Never invent features, prices, or guarantees beyond the facts below.

${KNOWLEDGE}`;

let client: Anthropic | null = null;

export const POST = handler(async (req: Request) => {
  const { lang, messages } = await parseBody(req, schema);

  const rl = rateLimit(`assistant:${getClientIp(req)}`, 20);
  if (!rl.ok) return fail(429, "Too many messages", { retryAfterSec: rl.retryAfterSec });

  if (!aiEnabled()) {
    return ok({
      reply:
        lang === "ar"
          ? "المساعد الذكي غير متاح حاليًا. يمكنك تصفّح الموقع أو التواصل معنا عبر صفحة تواصل معنا."
          : "The assistant is unavailable right now. Please browse the site or reach us via the Contact page.",
    });
  }

  try {
    client ??= new Anthropic();
    const res = await client.messages.create({
      model: CHAT_MODEL,
      max_tokens: 500,
      system: systemPrompt(lang),
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    const raw = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    // The bubbles are plain text — strip any markdown the model slips in.
    const reply = raw
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/^\s*#{1,6}\s+/gm, "")
      .replace(/^\s*[-*]\s+/gm, "• ")
      .trim();
    return ok({ reply });
  } catch (e) {
    console.error("[assistant] failed", e);
    throw new ApiError(502, "assistant_error");
  }
});
