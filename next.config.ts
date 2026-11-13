import type { NextConfig } from "next";

/**
 * Security headers for every response. The Content-Security-Policy allows
 * scripts, styles and fonts from this site only, and network calls to this
 * site plus the Supabase project (REST, Auth and the Realtime websocket).
 * Next.js and the theme switch put small inline scripts in each page, so
 * `script-src` keeps 'unsafe-inline'; no script can be loaded from another
 * site, no plugin can run, and no other site can frame these pages.
 */
function securityHeaders() {
  const supabase = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321");
  const socket = `${supabase.protocol === "https:" ? "wss:" : "ws:"}//${supabase.host}`;
  const dev = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabase.origin} ${socket}`,
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ].join("; ");
  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
}

const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer"],
  // no "x-powered-by: Next.js", and no browser source maps in production
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  experimental: {
    // server actions run behind auth; allow larger PDF/form payloads
    serverActions: { bodySizeLimit: "2mb" },
    // A dashboard page visited in the last 30 s opens at once from the
    // router's cache instead of showing a skeleton while the server renders
    // it again. The page then re-reads its data in the background
    // (components/dashboard/RefreshOnRevisit.tsx); server actions and live
    // updates clear this cache, as before.
    staleTimes: { dynamic: 30 },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
};

export default nextConfig;
