import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {},
  outputFileTracingIncludes: {
    '/api/**': ['./data/**/*', './node_modules/sql.js/dist/sql-wasm.wasm'],
  },
};

export default nextConfig;
