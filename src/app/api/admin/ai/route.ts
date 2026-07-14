import { z } from "zod";
import { handler, ok, parseBody, requireRole, ApiError } from "@/lib/api";
import { AI_MODES, AI_PROVIDER_IDS, getAdminAiStatus } from "@/lib/ai-providers";
import { encryptSecret } from "@/lib/secrets";
import { setSettings } from "@/lib/settings";

// Admin AI-provider configuration: which provider serves requests, plus
// per-provider API keys (stored encrypted) and model overrides.
export const GET = handler(async () => {
  await requireRole("ADMIN");
  return ok(await getAdminAiStatus());
});

const schema = z
  .object({
    // "auto" or a provider id — switches the active provider.
    mode: z.enum(AI_MODES).optional(),
    // Target of the per-provider fields below.
    provider: z.enum(AI_PROVIDER_IDS).optional(),
    // string → save (encrypted), null → delete, undefined → unchanged.
    apiKey: z.string().trim().min(8).max(4000).nullable().optional(),
    // string → override, null/"" → back to default, undefined → unchanged.
    chatModel: z.string().trim().max(200).nullable().optional(),
    briefModel: z.string().trim().max(200).nullable().optional(),
  })
  .refine((b) => b.mode !== undefined || b.provider !== undefined, {
    message: "nothing to update",
  });

export const PUT = handler(async (req: Request) => {
  await requireRole("ADMIN");
  const body = await parseBody(req, schema);

  const entries: Record<string, string | null> = {};
  if (body.mode !== undefined) entries["ai.provider"] = body.mode === "auto" ? null : body.mode;

  const touchesProviderConfig =
    body.apiKey !== undefined || body.chatModel !== undefined || body.briefModel !== undefined;
  if (touchesProviderConfig) {
    if (!body.provider) throw new ApiError(400, "provider is required with apiKey/chatModel/briefModel");
    const p = body.provider;
    if (body.apiKey !== undefined) entries[`ai.${p}.apiKey`] = body.apiKey ? encryptSecret(body.apiKey) : null;
    if (body.chatModel !== undefined) entries[`ai.${p}.chatModel`] = body.chatModel || null;
    if (body.briefModel !== undefined) entries[`ai.${p}.briefModel`] = body.briefModel || null;
  }

  if (Object.keys(entries).length) await setSettings(entries);
  return ok(await getAdminAiStatus());
});
