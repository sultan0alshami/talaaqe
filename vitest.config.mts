import { defineConfig } from "vitest/config";
import path from "node:path";
import { taskState, assertLocalTarget } from "./scripts/task-state.mjs";
const state = taskState();
const databaseUrl = assertLocalTarget(state, "test");
if (process.env.DATABASE_URL && process.env.DATABASE_URL !== databaseUrl) throw new Error("Vitest refuses a non-test database URL");
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"], maxWorkers: 1, testTimeout: 15000,
    globalSetup: ["./tests/setup.mjs"],
    env: { DATABASE_URL: databaseUrl, AUTH_SECRET: state.authSecret, INFAME_TASK_ID: state.id, INFAME_ENV: "test", DELIVERY_MODE: "fixture", APP_ORIGIN: "http://localhost:3100" },
  },
});
