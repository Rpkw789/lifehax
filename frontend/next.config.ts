import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emits .next/standalone with a self-contained server.js, so the runtime
  // image carries no node_modules. Keeps us inside Artifact Registry's free
  // 0.5 GB.
  output: "standalone",
  // The dashboard route imports the contracts under shared/, which lives
  // outside the frontend package root.
  experimental: { externalDir: true },
};

export default nextConfig;
