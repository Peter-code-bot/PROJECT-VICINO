import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";
import bundleAnalyzer from "@next/bundle-analyzer";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
});

// A3 sub-fase 3.7: bundle analyzer solo activo con ANALYZE=true env.
// Builds normales (Vercel, dev) NO se afectan — pasa-through cuando enabled=false.
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

// Content-Security-Policy
//
// Starts as Report-Only so the PWA service-worker registration, Realtime
// websocket, and Leaflet tile loads cannot break production silently if a
// directive is misjudged. Promote to "Content-Security-Policy" (enforce)
// after monitoring the browser console for blocked requests for 1–2 days.
//
// connect-src must include both https://*.supabase.co (REST/Auth/Storage)
// AND wss://*.supabase.co (chat Realtime) — without wss the chat breaks.
// https://*.upstash.io is pre-listed for the rate-limit helper in Bloque 3.
// worker-src 'self' blob: is required by @ducanh2912/next-pwa, which can
// register the SW from a blob URL during hot-reload.
// manifest-src 'self' keeps the PWA manifest fetchable for "Add to Home".
const cspDirectives = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co https://firebasestorage.googleapis.com https://picsum.photos https://i.pravatar.cc https://images.unsplash.com https://*.googleusercontent.com https://*.tile.openstreetmap.org https://unpkg.com",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.upstash.io https://nominatim.openstreetmap.org",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "geolocation=(self), camera=(), microphone=()",
  },
  { key: "Content-Security-Policy-Report-Only", value: cspDirectives },
];

const nextConfig: NextConfig = {
  turbopack: {},
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
      {
        protocol: "https",
        hostname: "firebasestorage.googleapis.com",
      },
      {
        protocol: "https",
        hostname: "picsum.photos",
      },
      {
        protocol: "https",
        hostname: "i.pravatar.cc",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "**.googleusercontent.com",
      },
    ],
  },
  experimental: {
    // A3 sub-fase 3.2: tree-shake barrel exports of the UI libraries we actually
    // import. Confirmed against apps/web/package.json — only these 6 packages
    // are direct deps. Next.js will silently skip any package here that isn't
    // installed, so the list is safe even if a Radix dep is removed later.
    optimizePackageImports: [
      "lucide-react",
      "framer-motion",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-popover",
    ],
  },
};

// Sentry wraps PWA's transformed config (Sentry outermost). tunnelRoute keeps
// ingest requests same-origin so CSP/ad-blockers don't drop them; the
// middleware matcher excludes /sentry-tunnel so it stays a pass-through.
// A3 sub-fase 3.7: bundleAnalyzer en medio (entre Sentry y PWA) — solo
// intercepta build stats cuando ANALYZE=true; con enabled=false es identity.
export default withSentryConfig(withBundleAnalyzer(withPWA(nextConfig)), {
  org: "vicino-5r",
  project: "vicino-web",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  tunnelRoute: "/sentry-tunnel",
  // hideSourceMaps was removed in @sentry/nextjs 8+. The equivalent is now
  // nested under sourcemaps — uploads still happen, but the public client
  // bundle does not ship the .map files alongside.
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
  disableLogger: true,
  automaticVercelMonitors: false,
});
