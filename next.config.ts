import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer"],
  experimental: {
    // server actions run behind auth; allow larger PDF/form payloads
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
