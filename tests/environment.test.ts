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
  it("requires explicit private storage activation and denies local storage in production", () => {
    const configured = { ...production, SUPABASE_URL: "https://storage.example.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic-storage-configuration", SUPABASE_EVIDENCE_BUCKET: "infame-evidence" };
    expect(runtimeConfig(configured).EVIDENCE_STORAGE_MODE).toBe("unavailable");
    expect(() => runtimeConfig({ ...configured, EVIDENCE_STORAGE_MODE: "local" })).toThrow();
    expect(() => runtimeConfig({ ...production, EVIDENCE_STORAGE_MODE: "supabase" })).toThrow();
    expect(runtimeConfig({ ...configured, EVIDENCE_STORAGE_MODE: "supabase" }).EVIDENCE_STORAGE_MODE).toBe("supabase");
    for (const SUPABASE_URL of ["http://storage.example.invalid", "https://account:password@storage.example.invalid", "https://storage.example.invalid/private", "https://storage.example.invalid?token=synthetic"]) expect(() => runtimeConfig({ ...configured, EVIDENCE_STORAGE_MODE: "supabase", SUPABASE_URL })).toThrow();
    expect(() => runtimeConfig({ ...configured, EVIDENCE_STORAGE_MODE: "supabase", SUPABASE_EVIDENCE_BUCKET: "../public" })).toThrow();
  });
  it("keeps private local storage limited to development/test environments", () => {
    const local = { ...production, NODE_ENV: "development", INFAME_ENV: "development", DATABASE_URL: "postgresql://service:synthetic@127.0.0.1/infame_synthetic_dev", APP_ORIGIN: "http://localhost:3210", EVIDENCE_STORAGE_MODE: "local" };
    expect(runtimeConfig(local).EVIDENCE_STORAGE_MODE).toBe("local");
    expect(() => runtimeConfig({ ...local, INFAME_ENV: "preview" })).toThrow();
    expect(() => runtimeConfig({ ...local, INFAME_ENV: "production" })).toThrow();
  });
});
