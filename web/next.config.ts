import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `@collabcanvas/shared` is a source-only TS workspace package (no build step),
  // so Next.js must transpile it like app code.
  transpilePackages: ["@collabcanvas/shared"],
};

export default nextConfig;
