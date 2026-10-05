import { afterAll, beforeAll, vi } from "vitest";
import { now } from "./fixtures";

// Unit-only deterministic business clock. Native timers, DB connections and
// lock waits stay real; the shared E2E fixture keeps its actual current clock.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
});
afterAll(() => vi.useRealTimers());
