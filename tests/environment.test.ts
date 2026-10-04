import { describe, expect, it } from "vitest";
import { runtimeConfig } from "@/lib/env";
const production = { NODE_ENV: "production", INFAME_ENV: "production", DATABASE_URL: "postgresql://service:private@db.example.invalid/infame", AUTH_SECRET: "a".repeat(64), APP_ORIGIN: "https://infame.sa", DELIVERY_MODE: "unavailable" };
describe("production configuration boundary", () => {
  it("accepts honest unavailable capabilities and rejects fixture/local identities", () => {
    expect(runtimeConfig(production).DELIVERY_MODE).toBe("unavailable");
    for (const invalid of [{ ...production, DELIVERY_MODE: "fixture" }, { ...production, SMS_PROVIDER: "fixture" }, { ...production, INFAME_ENV: "test" }, { ...production, DATABASE_URL: "postgresql://service:private@127.0.0.1/infame" }, { ...production, APP_ORIGIN: "http://infame.sa" }]) expect(() => runtimeConfig(invalid)).toThrow();
  });
  it("refuses missing live delivery credentials and placeholder secrets", () => {
    expect(() => runtimeConfig({ ...production, DELIVERY_MODE: "resend" })).toThrow();
    expect(() => runtimeConfig({ ...production, AUTH_SECRET: "REPLACE_WITH_A_RANDOM_64_CHARACTER_SECRET" })).toThrow();
  });
});
