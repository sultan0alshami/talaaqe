// Multi-provider AI configuration (admin-switchable, Admin → Settings).
//
// The catalog below lists every supported provider. The active one is chosen
// by the admin (AppSetting "ai.provider") or — in "auto" mode — detected as
// the first catalog entry with a usable API key, which preserves the original
// env-based behavior (Anthropic wins over Gemini, etc.).
//
// API keys resolve DB-first (admin-entered in the UI, stored AES-GCM
// encrypted) and fall back to environment variables. Models are admin-
// overridable per provider with sensible catalog defaults.
//
// Server-only: imports prisma via ./settings. Client components may import
// the *types* only.
import { decryptSecret, maskSecret } from "./secrets";
import { getSettings } from "./settings";

export const AI_PROVIDER_IDS = [
  "anthropic",
  "gemini",
  "openai",
  "deepseek",
  "nvidia",
  "xai",
  "groq",
  "mistral",
  "openrouter",
] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];
export const AI_MODES = ["auto", ...AI_PROVIDER_IDS] as const;
export type AiMode = (typeof AI_MODES)[number];

// "anthropic" and "gemini" have dedicated call paths in ai.ts; everything
// else speaks the OpenAI /chat/completions dialect at a provider baseUrl.
export type AiProviderKind = "anthropic" | "gemini" | "openai-compat";

export type AiProviderDef = {
  id: AiProviderId;
  nameAr: string;
  nameEn: string;
  kind: AiProviderKind;
  /** /chat/completions base URL — openai-compat providers only. */
  baseUrl?: string;
  /** Env vars checked (in order) when no admin-entered key exists. */
  envKeys: string[];
  /** Where the admin can create an API key. */
  keyUrl: string;
  defaultChatModel: string;
  defaultBriefModel: string;
  /** Legacy env overrides for the default models (Gemini). */
  envModelVars?: { chat: string; brief: string };
  /** Provider reliably supports response_format {type:"json_object"}. */
  jsonMode?: boolean;
};

export const AI_PROVIDERS: AiProviderDef[] = [
  {
    id: "anthropic",
    nameAr: "كلود (Anthropic)",
    nameEn: "Claude (Anthropic)",
    kind: "anthropic",
    envKeys: ["ANTHROPIC_API_KEY"],
    keyUrl: "https://console.anthropic.com/settings/keys",
    defaultChatModel: "claude-haiku-4-5",
    defaultBriefModel: "claude-sonnet-4-6",
  },
  {
    id: "gemini",
    nameAr: "جيميني (Google)",
    nameEn: "Gemini (Google)",
    kind: "gemini",
    envKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    keyUrl: "https://aistudio.google.com/apikey",
    defaultChatModel: "gemini-3.5-flash",
    defaultBriefModel: "gemini-3.5-flash",
    envModelVars: { chat: "GEMINI_CHAT_MODEL", brief: "GEMINI_BRIEF_MODEL" },
  },
  {
    id: "openai",
    nameAr: "OpenAI (GPT)",
    nameEn: "OpenAI (GPT)",
    kind: "openai-compat",
    baseUrl: "https://api.openai.com/v1",
    envKeys: ["OPENAI_API_KEY"],
    keyUrl: "https://platform.openai.com/api-keys",
    defaultChatModel: "gpt-5-mini",
    defaultBriefModel: "gpt-5.1",
    jsonMode: true,
  },
  {
    id: "deepseek",
    nameAr: "ديب سيك DeepSeek",
    nameEn: "DeepSeek",
    kind: "openai-compat",
    baseUrl: "https://api.deepseek.com/v1",
    envKeys: ["DEEPSEEK_API_KEY"],
    keyUrl: "https://platform.deepseek.com/api_keys",
    defaultChatModel: "deepseek-chat",
    defaultBriefModel: "deepseek-chat",
    jsonMode: true,
  },
  {
    id: "nvidia",
    nameAr: "إنفيديا NVIDIA NIM",
    nameEn: "NVIDIA NIM",
    kind: "openai-compat",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    envKeys: ["NVIDIA_API_KEY"],
    keyUrl: "https://build.nvidia.com/settings/api-keys",
    defaultChatModel: "meta/llama-3.3-70b-instruct",
    defaultBriefModel: "meta/llama-3.3-70b-instruct",
    // json_object support varies per hosted model — rely on prompting.
  },
  {
    id: "xai",
    nameAr: "جروك xAI",
    nameEn: "Grok (xAI)",
    kind: "openai-compat",
    baseUrl: "https://api.x.ai/v1",
    envKeys: ["XAI_API_KEY"],
    keyUrl: "https://console.x.ai/",
    defaultChatModel: "grok-4-fast",
    defaultBriefModel: "grok-4",
    jsonMode: true,
  },
  {
    id: "groq",
    nameAr: "Groq",
    nameEn: "Groq",
    kind: "openai-compat",
    baseUrl: "https://api.groq.com/openai/v1",
    envKeys: ["GROQ_API_KEY"],
    keyUrl: "https://console.groq.com/keys",
    defaultChatModel: "llama-3.3-70b-versatile",
    defaultBriefModel: "llama-3.3-70b-versatile",
    jsonMode: true,
  },
  {
    id: "mistral",
    nameAr: "ميسترال Mistral",
    nameEn: "Mistral AI",
    kind: "openai-compat",
    baseUrl: "https://api.mistral.ai/v1",
    envKeys: ["MISTRAL_API_KEY"],
    keyUrl: "https://console.mistral.ai/api-keys",
    defaultChatModel: "mistral-small-latest",
    defaultBriefModel: "mistral-large-latest",
    jsonMode: true,
  },
  {
    id: "openrouter",
    nameAr: "أوبن راوتر OpenRouter",
    nameEn: "OpenRouter",
    kind: "openai-compat",
    baseUrl: "https://openrouter.ai/api/v1",
    envKeys: ["OPENROUTER_API_KEY"],
    keyUrl: "https://openrouter.ai/settings/keys",
    defaultChatModel: "openrouter/auto",
    defaultBriefModel: "openrouter/auto",
    // Routes to heterogeneous upstreams — json_object support varies.
  },
];

const byId = new Map(AI_PROVIDERS.map((p) => [p.id, p]));

export type ResolvedAi = {
  def: AiProviderDef;
  apiKey: string;
  chatModel: string;
  briefModel: string;
  keySource: "db" | "env";
};

// Settings access must never take the AI feature down harder than the old
// env-only path did: if the DB is unreachable, fall back to env resolution.
async function safeSettings(): Promise<Map<string, string>> {
  try {
    return await getSettings();
  } catch (e) {
    console.error("[ai] settings unavailable, using env-only config", e);
    return new Map();
  }
}

function resolveKey(def: AiProviderDef, settings: Map<string, string>): { apiKey: string; keySource: "db" | "env" } | null {
  const stored = settings.get(`ai.${def.id}.apiKey`);
  if (stored) {
    const plain = decryptSecret(stored);
    if (plain) return { apiKey: plain, keySource: "db" };
  }
  for (const envVar of def.envKeys) {
    const value = process.env[envVar];
    if (value) return { apiKey: value, keySource: "env" };
  }
  return null;
}

function resolveModel(def: AiProviderDef, settings: Map<string, string>, tier: "chat" | "brief"): string {
  const override = settings.get(`ai.${def.id}.${tier}Model`);
  if (override) return override;
  const envVar = def.envModelVars?.[tier];
  if (envVar && process.env[envVar]) return process.env[envVar]!;
  return tier === "chat" ? def.defaultChatModel : def.defaultBriefModel;
}

/** Resolve one specific provider (key + models), or null when it has no key. */
export async function resolveProvider(
  id: AiProviderId,
  settings?: Map<string, string>
): Promise<ResolvedAi | null> {
  const def = byId.get(id);
  if (!def) return null;
  const map = settings ?? (await safeSettings());
  const key = resolveKey(def, map);
  if (!key) return null;
  return {
    def,
    apiKey: key.apiKey,
    keySource: key.keySource,
    chatModel: resolveModel(def, map, "chat"),
    briefModel: resolveModel(def, map, "brief"),
  };
}

export async function getAiMode(): Promise<AiMode> {
  const settings = await safeSettings();
  const stored = settings.get("ai.provider");
  return stored && (AI_MODES as readonly string[]).includes(stored) ? (stored as AiMode) : "auto";
}

/**
 * The provider every AI flow uses right now, or null → scripted demo mode.
 * Admin-selected provider wins; if the admin picked one without a usable key
 * the feature is deliberately off (no silent fallback to another vendor).
 */
export async function getAiConfig(): Promise<ResolvedAi | null> {
  const settings = await safeSettings();
  const stored = settings.get("ai.provider");
  if (stored && stored !== "auto" && byId.has(stored as AiProviderId)) {
    return resolveProvider(stored as AiProviderId, settings);
  }
  for (const def of AI_PROVIDERS) {
    const resolved = await resolveProvider(def.id, settings);
    if (resolved) return resolved;
  }
  return null;
}

// ── Admin UI status (Admin → Settings) ──────────────────────────────
export type AdminAiProviderStatus = {
  id: AiProviderId;
  nameAr: string;
  nameEn: string;
  keyUrl: string;
  defaultChatModel: string;
  defaultBriefModel: string;
  /** Admin overrides (null → catalog/env default applies). */
  chatModel: string | null;
  briefModel: string | null;
  /** A key is available via environment variable. */
  envKey: boolean;
  /** Masked admin-entered key ("••••cdef"), null when none stored. */
  savedKey: string | null;
  configured: boolean;
};

export type AdminAiStatus = {
  mode: AiMode;
  /** Provider actually serving requests right now (null → scripted mode). */
  active: { id: AiProviderId; chatModel: string; briefModel: string; keySource: "db" | "env" } | null;
  providers: AdminAiProviderStatus[];
};

export async function getAdminAiStatus(): Promise<AdminAiStatus> {
  const settings = await safeSettings();
  const active = await getAiConfig();
  const providers = AI_PROVIDERS.map((def) => {
    const stored = settings.get(`ai.${def.id}.apiKey`);
    const plain = stored ? decryptSecret(stored) : null;
    const envKey = def.envKeys.some((v) => !!process.env[v]);
    return {
      id: def.id,
      nameAr: def.nameAr,
      nameEn: def.nameEn,
      keyUrl: def.keyUrl,
      defaultChatModel: def.defaultChatModel,
      defaultBriefModel: def.defaultBriefModel,
      chatModel: settings.get(`ai.${def.id}.chatModel`) ?? null,
      briefModel: settings.get(`ai.${def.id}.briefModel`) ?? null,
      envKey,
      savedKey: plain ? maskSecret(plain) : null,
      configured: envKey || !!plain,
    };
  });
  return {
    mode: await getAiMode(),
    active: active
      ? {
          id: active.def.id,
          chatModel: active.chatModel,
          briefModel: active.briefModel,
          keySource: active.keySource,
        }
      : null,
    providers,
  };
}
