import { createHash } from "node:crypto";
import { prisma } from "./prisma";
// Only an explicitly trusted deployment ingress may supply client IP headers.
export function getClientIp(req: Request): string {
  if (process.env.TRUST_PROXY_HEADERS !== "1") return "untrusted-ingress";
  const value = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "";
  return value.length <= 64 && /^[0-9a-fA-F:.]+$/.test(value) ? value : "unknown";
}
export async function rateLimit(key: string, max = 15, windowMs = 60000): Promise<{ ok: boolean; retryAfterSec: number }> {
  if (!Number.isInteger(max) || max < 1 || max > 100000 || !Number.isInteger(windowMs) || windowMs < 1000 || windowMs > 86400000) throw new Error("Invalid rate budget");
  const id = createHash("sha256").update(key).digest("hex");
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowMs);
  const rows = await prisma.$queryRaw<{ count: number; windowStart: Date }[]>`
    INSERT INTO "RateBucket" (key,"windowStart",count,"updatedAt") VALUES (${id},${now},1,${now})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN "RateBucket"."windowStart" <= ${cutoff} THEN 1 ELSE LEAST("RateBucket".count + 1, ${max + 1}) END,
      "windowStart" = CASE WHEN "RateBucket"."windowStart" <= ${cutoff} THEN ${now} ELSE "RateBucket"."windowStart" END,
      "updatedAt" = ${now}
    RETURNING count,"windowStart"
  `;
  return { ok: rows[0].count <= max, retryAfterSec: rows[0].count <= max ? 0 : Math.max(1, Math.ceil((rows[0].windowStart.getTime() + windowMs - now.getTime()) / 1000)) };
}
