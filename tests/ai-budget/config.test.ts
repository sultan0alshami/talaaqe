import { describe, expect, it } from "vitest";
import { AiContextSchema, AiPricingSchema, calculateUsageCostMicros, readAiBudgetCaps } from "@/lib/ai-budget/contracts";

describe("trusted exact AI budget configuration and usage prices", () => {
  it("requires explicit production/preview caps and supplies documented conservative test defaults", () => {
    expect(readAiBudgetCaps({ INFAME_ENV: "test" })).toEqual({ userDailyMicros: "1000000", platformDailyMicros: "10000000" });
    for (const INFAME_ENV of ["production", "preview"]) {
      expect(() => readAiBudgetCaps({ INFAME_ENV })).toThrow();
      expect(readAiBudgetCaps({ INFAME_ENV, AI_USER_DAILY_CAP_MICROS: "9007199254740993", AI_PLATFORM_DAILY_CAP_MICROS: "9223372036854775807" })).toEqual({ userDailyMicros: "9007199254740993", platformDailyMicros: "9223372036854775807" });
    }
    expect(() => readAiBudgetCaps({ NODE_ENV: "production", INFAME_ENV: "development" })).toThrow();
    for (const value of ["-1", "0.5", "1e6", "9223372036854775808", "", "00"]) expect(() => readAiBudgetCaps({ INFAME_ENV: "test", AI_USER_DAILY_CAP_MICROS: value })).toThrow();
  });
  it("calculates bounded exact price ratios with upward micro-unit rounding and no floating-point conversion", () => {
    const pricing = { version: "synthetic-v1", modelId: "synthetic-model", asOf: "2091-04-01", currency: "USD", prices: [{ unit: "INPUT_TOKENS", quantity: "1000000", priceMicros: "3" }] };
    expect(calculateUsageCostMicros([{ unit: "INPUT_TOKENS", quantity: "1" }], pricing)).toBe("1");
    expect(calculateUsageCostMicros([{ unit: "INPUT_TOKENS", quantity: "9007199254740993" }], pricing)).toBe(((BigInt("9007199254740993") * BigInt(3) + BigInt(999999)) / BigInt(1000000)).toString());
    expect(() => calculateUsageCostMicros([{ unit: "OUTPUT_TOKENS", quantity: "1" }], pricing)).toThrow();
    expect(() => calculateUsageCostMicros([{ unit: "INPUT_TOKENS", quantity: "1" }, { unit: "INPUT_TOKENS", quantity: "2" }], pricing)).toThrow();
  });
  it("requires opaque references rather than URLs in model and private source context metadata", () => {
    expect(() => AiContextSchema.parse({ resourceType: "CAMPAIGN", resourceId: "https://private.example.invalid", sourceRevision: 1 })).toThrow();
    expect(() => AiPricingSchema.parse({ version: "synthetic-v1", modelId: "https://private.example.invalid", asOf: "2091-04-01", currency: "USD", prices: [{ unit: "INPUT_TOKENS", quantity: "1", priceMicros: "1" }] })).toThrow();
  });
});
