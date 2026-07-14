import { z } from "zod";
import { handler, ok, parseBody, requireRole } from "@/lib/api";
import { AI_PROVIDER_IDS, resolveProvider } from "@/lib/ai-providers";
import { llmTextFor } from "@/lib/ai";

// Admin "test connection": one tiny completion against the chosen provider
// (whether or not it is the active one). Provider failures are reported as
// { ok:false, error } rather than HTTP errors so the UI can show the reason.
export const POST = handler(async (req: Request) => {
  await requireRole("ADMIN");
  const { provider } = await parseBody(req, z.object({ provider: z.enum(AI_PROVIDER_IDS) }));

  const cfg = await resolveProvider(provider);
  if (!cfg) return ok({ ok: false, error: "No API key configured for this provider" });

  const started = Date.now();
  try {
    const res = await llmTextFor(cfg, {
      tier: "chat",
      system: "You are a connectivity test. Reply with exactly: OK",
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 64,
    });
    return ok({ ok: true, model: res.model, latencyMs: Date.now() - started });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return ok({ ok: false, error: message.slice(0, 300) });
  }
});
