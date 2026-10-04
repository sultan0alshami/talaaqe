import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { assertLocalTarget, workspace } from "../scripts/task-state.mjs";
const originalInfameEnv = process.env.INFAME_ENV;
afterEach(() => { if (originalInfameEnv === undefined) delete process.env.INFAME_ENV; else process.env.INFAME_ENV = originalInfameEnv; });
const state = { id: "infame_aabbccddeeff", port: 5644, user: "test", password: "synthetic", cluster: path.join(workspace, ".infame", "infame_aabbccddeeff", "pgdata"), targets: { dev: "infame_aabbccddeeff_dev", test: "infame_aabbccddeeff_test", e2e: "infame_aabbccddeeff_e2e" } };
describe("disposable database boundary", () => {
  it("keeps dev, test and E2E targets distinct and off the source port", () => {
    const urls = ["dev", "test", "e2e"].map(kind => new URL(assertLocalTarget(state, kind)));
    expect(new Set(urls.map(url => url.pathname)).size).toBe(3);
    expect(urls.every(url => url.hostname === "127.0.0.1" && url.port !== "5544")).toBe(true);
  });
  it("refuses production even with a local task marker", () => {
    process.env.INFAME_ENV = "production";
    expect(() => assertLocalTarget(state, "test")).toThrow("production");
  });
  it("rejects a source database name, source port, ambiguous target and directory escape", () => {
    expect(() => assertLocalTarget({ ...state, targets: { ...state.targets, test: "talaqi" } }, "test")).toThrow();
    expect(() => assertLocalTarget({ ...state, port: 5544 }, "dev")).toThrow();
    expect(() => assertLocalTarget(state, "production")).toThrow();
    expect(() => assertLocalTarget({ ...state, cluster: path.resolve(workspace, "..", "Talaaqe") }, "dev")).toThrow();
  });
});
