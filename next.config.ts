import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Errors still open the dev overlay; this only hides the floating badge.
  devIndicators: false,
  // PGlite ships WebAssembly and data files, and playwright-core drives a local
  // browser for PDF reports. Both must be loaded with Node's require, not bundled.
  serverExternalPackages: ["@electric-sql/pglite", "playwright-core"],
  async redirects() {
    return [
      { source: "/app", destination: "/app/dashboard", permanent: false },
      { source: "/admin/clients", destination: "/admin", permanent: false },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
