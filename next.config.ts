import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  eslint: {
    ignoreDuringBuilds: true, // <--- This line disables build break on lint errors
  },
  experimental: {
    // @ts-expect-error: Not in Next.js type defs yet, but works at runtime
    outputFileTracingIncludes: {
      // For all API routes (adjust path as needed if you rename/move):
      "./src/app/api/process-pdf/route.ts": ["./test/data/05-versions-space.pdf"],
    },
  },
};

export default nextConfig;
