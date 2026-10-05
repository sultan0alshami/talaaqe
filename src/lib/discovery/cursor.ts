import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { DISCOVERY_SCOPE, DiscoveryError, DiscoveryQuerySchema, type DiscoveryQuery } from "./contracts";

const PURPOSE = "infame/public-discovery/cursor/v1";
const TTL_MS = 30 * 60 * 1000;
const Id = z.string().min(1).max(200).regex(/^[\x21-\x7e]+$/);
const Payload = z.object({
  version: z.literal(1), scope: z.literal(DISCOVERY_SCOPE), actor: Id, after: Id,
  queryHash: z.string().regex(/^[a-f0-9]{64}$/), issuedAt: z.number().int().safe(),
  expiresAt: z.number().int().safe(),
}).strict();
function invalid(): never { throw new DiscoveryError("VALIDATION", 422); }
function timestamp(now: Date) {
  const value = now instanceof Date ? now.getTime() : NaN;
  if (!Number.isSafeInteger(value)) return invalid();
  return value;
}
function key(secret: string) {
  if (typeof secret !== "string" || secret.length < 32) return invalid();
  return createHash("sha256").update(PURPOSE).update("\0").update(secret).digest();
}
export function discoveryQueryHash(query: DiscoveryQuery) {
  const parsed = DiscoveryQuerySchema.safeParse(query);
  if (!parsed.success) return invalid();
  const q = parsed.data;
  return createHash("sha256").update(JSON.stringify({
    scope: q.scope, q: q.q, residenceCountryCode: q.residenceCountryCode ?? null,
    platform: q.platform ?? null, reachBand: q.reachBand ?? null, limit: q.limit,
  })).digest("hex");
}

export function encodeDiscoveryCursor(after: string, actor: string, query: DiscoveryQuery, now: Date, secret: string): string {
  try {
    const issuedAt = timestamp(now);
    const payload = Payload.parse({ version: 1, scope: DISCOVERY_SCOPE, actor, after,
      queryHash: discoveryQueryHash(query), issuedAt, expiresAt: issuedAt + TTL_MS });
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(secret), iv);
    cipher.setAAD(Buffer.from(PURPOSE));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
  } catch { return invalid(); }
}
export function decodeDiscoveryCursor(token: string, actor: string, query: DiscoveryQuery, now: Date, secret: string): string {
  try {
    const at = timestamp(now);
    if (typeof token !== "string" || token.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(token)) return invalid();
    const bytes = Buffer.from(token, "base64url");
    if (bytes.length <= 28 || bytes.toString("base64url") !== token) return invalid();
    const decipher = createDecipheriv("aes-256-gcm", key(secret), bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(PURPOSE)); decipher.setAuthTag(bytes.subarray(12, 28));
    const plaintext = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
    const payload = Payload.parse(JSON.parse(plaintext));
    if (payload.actor !== actor || payload.queryHash !== discoveryQueryHash(query)
      || payload.issuedAt > at || payload.expiresAt !== payload.issuedAt + TTL_MS || at >= payload.expiresAt) return invalid();
    return payload.after;
  } catch { return invalid(); }
}
