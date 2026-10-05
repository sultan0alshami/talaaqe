import { describe, expect, it } from "vitest";
import { decodeDiscoveryCursor, encodeDiscoveryCursor } from "@/lib/discovery/cursor";
import { DiscoveryQuerySchema, PublicFollowersSchema } from "@/lib/discovery/contracts";

const secret = "synthetic-test-only-discovery-key-".repeat(3);
const now = new Date("2026-10-05T09:00:00.000Z");
const query = DiscoveryQuerySchema.parse({ q: "اسم أصلي", platform: "INSTAGRAM", limit: 6 });
const actor = "synthetic-brand-user", hiddenId = "synthetic-hidden-scanned-creator";
describe("public discovery continuation", () => {
  it("authenticates and encrypts scanned identity, scope, actor and original query", () => {
    const first = encodeDiscoveryCursor(hiddenId, actor, query, now, secret);
    const second = encodeDiscoveryCursor(hiddenId, actor, query, now, secret);
    expect(first).not.toBe(second); expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first.length).toBeLessThanOrEqual(2048);
    const visible = Buffer.from(first, "base64url").toString("utf8");
    for (const value of [hiddenId, actor, query.q]) expect(visible).not.toContain(value);
    expect(decodeDiscoveryCursor(first, actor, query, now, secret)).toBe(hiddenId);
  });
  it("binds every effective filter and limit while excluding only the continuation itself", () => {
    const token = encodeDiscoveryCursor(hiddenId, actor, query, now, secret);
    for (const changed of [
      { ...query, q: "different" }, { ...query, platform: "TIKTOK" as const },
      { ...query, residenceCountryCode: "SA" }, { ...query, reachBand: "NANO" as const }, { ...query, limit: 12 },
    ]) expect(() => decodeDiscoveryCursor(token, actor, changed, now, secret)).toThrow(expect.objectContaining({ code: "VALIDATION", status: 422 }));
    expect(decodeDiscoveryCursor(token, actor, { ...query, cursor: token }, now, secret)).toBe(hiddenId);
    expect(() => decodeDiscoveryCursor(token, "another-user", query, now, secret)).toThrow();
    expect(() => decodeDiscoveryCursor(token, actor, query, now, secret + "wrong")).toThrow();
  });
  it("expires at the exact30-minute boundary and rejects a clock earlier than issue", () => {
    const token = encodeDiscoveryCursor(hiddenId, actor, query, now, secret);
    expect(decodeDiscoveryCursor(token, actor, query, new Date(now.getTime() + 30 * 60 * 1000 - 1), secret)).toBe(hiddenId);
    for (const changed of [new Date(now.getTime() - 1), new Date(now.getTime() + 30 * 60 * 1000), new Date(NaN)]) {
      expect(() => decodeDiscoveryCursor(token, actor, query, changed, secret)).toThrow(expect.objectContaining({ code: "VALIDATION", status: 422 }));
    }
  });
  it("rejects malformed or modified authenticated payloads without disclosing scope fields", () => {
    const token = encodeDiscoveryCursor(hiddenId, actor, query, now, secret);
    const bytes = Buffer.from(token, "base64url"); bytes[bytes.length - 1] ^= 1;
    for (const invalid of ["", "!", "A".repeat(2049), token.slice(0, -4), bytes.toString("base64url")]) {
      let error: unknown; try { decodeDiscoveryCursor(invalid, actor, query, now, secret); } catch (failure) { error = failure; }
      expect(error).toMatchObject({ code: "VALIDATION", status: 422 });
      for (const value of [hiddenId, actor, query.q, secret]) expect(JSON.stringify(error)).not.toContain(value);
    }
  });
  it("normalizes supported query syntax and rejects unknown scopes, extra fields or oversized scans", () => {
    expect(DiscoveryQuerySchema.parse({ q: "  hello  ", limit: "6" })).toMatchObject({ q: "hello", limit: 6, scope: "PUBLIC_PROFILES" });
    for (const bad of [{ scope: "PRIVATE" }, { limit: 13 }, { limit: 0 }, { q: "a".repeat(121) }, { email: "private@example.invalid" }]) {
      expect(DiscoveryQuerySchema.safeParse(bad).success).toBe(false);
    }
  });
  it("keeps invalid counts as validation failures and dated bands exact beyond floating-point precision", () => {
    const observation = { followers: "9007199254740993", source: "SCREENSHOT_VERIFIED", observedAt: now.toISOString(),
      taxonomyVersion: "infame-reach-v2", band: "MEGA" };
    expect(PublicFollowersSchema.parse(observation).followers).toBe(observation.followers);
    for (const followers of ["bad", "-1", "01", "9223372036854775808"]) expect(() => {
      expect(PublicFollowersSchema.safeParse({ ...observation, followers }).success).toBe(false);
    }).not.toThrow();
    expect(PublicFollowersSchema.safeParse({ ...observation, followers: "0", band: null }).success).toBe(true);
    expect(PublicFollowersSchema.safeParse({ ...observation, followers: "0", band: "NANO" }).success).toBe(false);
  });
});
