import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root — a stray lockfile higher up otherwise makes
  // Turbopack guess the wrong root (it warns on dev startup).
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
