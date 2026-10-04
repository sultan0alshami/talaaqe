import { z } from "zod";
const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(32).refine((value) => !/REPLACE|EXAMPLE|PLACEHOLDER/i.test(value), "Replace placeholder authentication secret"),
  APP_ORIGIN: z.url(),
  INFAME_ENV: z.enum(["development", "test", "preview", "production"]),
  DELIVERY_MODE: z.enum(["fixture", "unavailable", "resend"]).default("unavailable"),
  RESEND_API_KEY: z.string().optional(), EMAIL_FROM: z.string().optional(),
});
export function runtimeConfig(input: Record<string, string | undefined> = process.env) {
  const config = ConfigSchema.parse(input);
  const database = new URL(config.DATABASE_URL);
  const origin = new URL(config.APP_ORIGIN);
  if (!["postgres:", "postgresql:"].includes(database.protocol) || !database.pathname.slice(1)) throw new Error("Unsupported database configuration");
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("APP_ORIGIN must be a clean origin");
  if (input.NODE_ENV === "production") {
    if (config.INFAME_ENV !== "production" && config.INFAME_ENV !== "preview") throw new Error("Production server refuses development/test environment");
    if (config.DELIVERY_MODE === "fixture" || Object.entries(input).some(([key, value]) => /PROVIDER|MODE$/.test(key) && value === "fixture")) throw new Error("Production server refuses fixture capabilities");
    if (["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) || /^infame_[a-f0-9]{12}_(dev|test|e2e)$/.test(database.pathname.slice(1))) throw new Error("Production server refuses disposable task database");
    if (origin.protocol !== "https:") throw new Error("Production origin requires HTTPS");
  }
  if (config.DELIVERY_MODE === "resend" && (!config.RESEND_API_KEY || !config.EMAIL_FROM)) throw new Error("Email provider configuration incomplete");
  return config;
}
