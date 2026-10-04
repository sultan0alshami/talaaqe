import { describe, expect, it } from "vitest";
import {
  RoleSchema, ProfileStateSchema, DeliverableSchema, DeliverablesSchema,
  CountryCodeSchema, LocationSchema, TimeZoneSchema, DateRangeSchema, ChatMessageSchema,
  normalizeInfameHandle, normalizeBrandSlug, resolveLocalDateTime, SAUDI_CITIES,
} from "../src/lib/contracts/vocabulary";

describe("canonical global vocabulary", () => {
  it("freezes roles/database adapter states and platform format combinations", () => {
    expect(RoleSchema.parse("CREATOR")).toBe("CREATOR");
    expect(RoleSchema.safeParse("PROVIDER").success).toBe(false);
    expect(ProfileStateSchema.parse("PRIVATE")).toBe("PRIVATE");
    expect(DeliverableSchema.safeParse({ platform: "X", format: "REEL", count: 1 }).success).toBe(false);
    expect(DeliverablesSchema.parse([{ platform: "INSTAGRAM", format: "REEL", count: 2 }, { platform: "INSTAGRAM", format: "REEL", count: 3 }])).toEqual([{ platform: "INSTAGRAM", format: "REEL", count: 5 }]);
    expect(DeliverableSchema.safeParse({ platform: "TIKTOK", format: "VIDEO", count: 0 }).success).toBe(false);
  });

  it("accepts non-Saudi country-only locations without inventing audience city", () => {
    expect(CountryCodeSchema.parse("EG")).toBe("EG");
    expect(CountryCodeSchema.safeParse("ZZ").success).toBe(false);
    expect(LocationSchema.parse({ countryCode: "EG", cityKey: null, cityLabel: "مدينة صغيرة", timeZone: "Africa/Cairo" }).cityKey).toBeNull();
    expect(LocationSchema.safeParse({ countryCode: "EG", cityKey: "SA:riyadh", cityLabel: null, timeZone: "Africa/Cairo" }).success).toBe(false);
    expect(LocationSchema.safeParse({ countryCode: "EG", cityKey: "EG:uncurated", cityLabel: null, timeZone: "Africa/Cairo" }).success).toBe(false);
    expect(SAUDI_CITIES).toHaveLength(24);
    expect(TimeZoneSchema.safeParse("+03:00").success).toBe(false);
  });

  it("normalizes Infame handles once and protects reserved/conflicting URL grammar", () => {
    expect(normalizeInfameHandle(" @Creator_24 ")).toBe("creator_24");
    for (const handle of ["admin", "@API", "@@user", "ab", "a/b", "a b", "إنفيم", "https://example.com/me"]) {
      expect(() => normalizeInfameHandle(handle)).toThrow();
    }
    expect(normalizeBrandSlug(" Brand-Name ")).toBe("brand-name");
    expect(() => normalizeBrandSlug("brand--name")).toThrow();
  });

  it("keeps chat original-language text and milliseconds without paired translations", () => {
    expect(ChatMessageSchema.parse({ role: "user", text: "هذه نبذتي الأصلية", ts: 1790856000000 })).toEqual({ role: "user", text: "هذه نبذتي الأصلية", ts: 1790856000000 });
    expect(ChatMessageSchema.safeParse({ role: "user", ar: "مرحبا", en: "Hello", ts: 0 }).success).toBe(false);
  });

  it("validates UTC ranges and rejects nonexistent/ambiguous local wall time", () => {
    expect(DateRangeSchema.safeParse({ startsAt: "2026-02-30T10:00:00.000Z", endsAt: "2026-03-01T10:00:00.000Z", timeZone: "UTC" }).success).toBe(false);
    expect(DateRangeSchema.safeParse({ startsAt: "2026-10-01T10:00:00.000Z", endsAt: "2026-10-01T09:00:00.000Z", timeZone: "Asia/Riyadh" }).success).toBe(false);
    expect(() => resolveLocalDateTime("2026-03-08T02:30:00", "America/New_York")).toThrow(/nonexistent/i);
    expect(() => resolveLocalDateTime("2026-11-01T01:30:00", "America/New_York")).toThrow(/ambiguous/i);
    expect(resolveLocalDateTime("2026-11-01T01:30:00", "America/New_York", -240)).toBe("2026-11-01T05:30:00.000Z");
    expect(resolveLocalDateTime("2026-11-01T01:30:00", "America/New_York", -300)).toBe("2026-11-01T06:30:00.000Z");
    expect(resolveLocalDateTime("2026-10-01T12:00:00", "Asia/Riyadh")).toBe("2026-10-01T09:00:00.000Z");
  });
});
