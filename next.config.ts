import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  eslint: {
    ignoreDuringBuilds: true, // <--- This line disables build break on lint errors
  },
};

export default nextConfig;
