import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  turbopack: {},
  outputFileTracingIncludes: {
    '/api/**': ['./data/**/*'],
  },
};

export default nextConfig;
