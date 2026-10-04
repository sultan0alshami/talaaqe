import { defineConfig } from "@playwright/test";
import { taskState, assertLocalTarget } from "./scripts/task-state.mjs";
const state = taskState();
const databaseUrl = assertLocalTarget(state, "e2e");
if (process.env.DATABASE_URL !== databaseUrl) throw new Error("Playwright requires npm run test:e2e with the isolated E2E target");
export default defineConfig({
  testDir: "./e2e", fullyParallel: false, workers: 1, retries: 0,
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  projects: [
    { name: "arabic-mobile", use: { viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true } },
    { name: "english-desktop", use: { viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: { command: "npm run dev -- --port 3100", url: "http://localhost:3100", reuseExistingServer: false,
    env: { DATABASE_URL: databaseUrl, AUTH_SECRET: state.authSecret, INFAME_TASK_ID: state.id, INFAME_ENV: "test", DELIVERY_MODE: "fixture", EVIDENCE_STORAGE_MODE: "local", APP_ORIGIN: "http://localhost:3100", NEXT_BUILD_DIR: ".next-e2e" },
    timeout: 120000,
  },
});
