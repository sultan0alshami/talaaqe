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
  async headers() {
    return [
      { source: "/sw.js", headers: [
        { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Service-Worker-Allowed", value: "/" },
        { key: "Content-Security-Policy", value: "default-src 'none'; script-src 'self'; connect-src 'self'" },
      ] },
      { source: "/offline.html", headers: [
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Robots-Tag", value: "noindex, noarchive" },
        { key: "Content-Security-Policy", value: "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" },
      ] },
    ];
  },
};

export default nextConfig;
