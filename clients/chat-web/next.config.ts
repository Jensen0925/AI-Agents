import path from "node:path";
import type { NextConfig } from "next";

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4001";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_API_BASE_URL: apiBaseUrl,
  },
  output: "standalone",
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  transpilePackages: ["@cloudsage/contracts"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiBaseUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
