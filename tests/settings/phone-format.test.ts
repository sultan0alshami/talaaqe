import { describe, expect, it } from "vitest";
import { normalizeSelectedPhone } from "@/lib/settings/phone-format";

describe("explicit country phone normalization", () => {
  it("normalizes national and international input without imposing Saudi residence", () => {
    expect(normalizeSelectedPhone("050 123 4567", "SA")).toEqual({ phone: "+966501234567", phoneCountryCode: "SA" });
    expect(normalizeSelectedPhone("+965 6000 0000", "KW")).toEqual({ phone: "+96560000000", phoneCountryCode: "KW" });
    expect(normalizeSelectedPhone("(213) 373-4253", "US")).toEqual({ phone: "+12133734253", phoneCountryCode: "US" });
  });
  it("requires the whole input to be a valid number for the explicitly selected country", () => {
    for (const [phone, country] of [["Call +966501234567", "SA"], ["+966501234567", "KW"], ["+966501234567 ext. 5", "SA"], ["+80012345678", "SA"], ["+9661", "SA"], ["+96560000000", "sa"], ["+96560000000", "ZZ"], ["1".repeat(200), "US"]]) {
      expect(() => normalizeSelectedPhone(phone!, country!)).toThrow();
    }
  });
});
