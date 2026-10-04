import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  distDir: process.env.NEXT_BUILD_DIR === ".next-e2e" ? ".next-e2e" : ".next",
  // Task credentials, browser profiles, database clusters and licensed research
  // are local development data and must never enter deployment file traces.
  outputFileTracingExcludes: {
    "/*": ["./.infame/**/*", "./.research/**/*", "./.git/**/*", "./.pgdata/**/*", "./.env*"],
  },
  // Pin the workspace root — a stray lockfile higher up otherwise makes
  // Turbopack guess the wrong root (it warns on dev startup).
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
