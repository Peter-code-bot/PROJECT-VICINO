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
/**
 * Endpoint de reportes de CSP, derivado del DSN de Sentry.
 *
 * La politica lleva meses en Report-Only con la intencion de "monitorear la
 * consola del navegador 1-2 dias y luego promoverla a enforce". Nunca se
 * promovio, y no por descuido: sin un destino donde reportar, las violaciones
 * solo aparecen en la consola de quien casualmente tenga las DevTools abiertas.
 * No hay forma de saber si es seguro promoverla.
 *
 * Con esto las violaciones llegan a Sentry y la decision pasa a tener datos.
 * Anadir report-uri no puede romper nada: los reportes de CSP no estan sujetos a
 * la propia CSP, asi que no hace falta tocar connect-src.
 *
 * Se usa report-uri y no el Report-To moderno a proposito: es lo que documenta
 * Sentry y lo que entienden todos los navegadores hoy.
 */
function sentryCspReportUri(): string | null {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return null;

  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, "");
    if (!projectId || !u.username) return null;
    return `${u.protocol}//${u.host}/api/${projectId}/security/?sentry_key=${u.username}`;
  } catch {
    // Un DSN mal formado no puede tumbar el build: se queda sin reportes y ya.
    return null;
  }
}

const cspReportUri = sentryCspReportUri();

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
  ...(cspReportUri ? [`report-uri ${cspReportUri}`] : []),
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
    // Sin estas dos listas, Next usa sus defaults: 8 deviceSizes + 8 imageSizes,
    // o sea hasta 16 anchos distintos por imagen, cada uno en avif y webp. Eso
    // no es un problema de velocidad, es de CUOTA: el plan Hobby de Vercel tiene
    // topes duros de optimizacion de imagenes y al superarlos pausa el proyecto
    // hasta el siguiente ciclo. Con un marketplace donde cada publicacion lleva
    // galeria, se llega antes de lo que parece.
    //
    // Se recortan los extremos que VICINO no usa:
    //   - 2048 y 3840 son pantallas 4K/5K. La app es movil primero y su vista
    //     mas ancha en escritorio es una tarjeta dentro de una rejilla.
    //   - de los imageSizes se quitan 16, 32 y 64: los avatares mas pequeños
    //     del producto son de 48 px, y por debajo de eso no hay nada.
    //
    // Degrada con gracia: si un componente pide un ancho que ya no esta, Next
    // sirve el siguiente mayor. Se ve igual, pesa un poco mas, no se rompe nada.
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [48, 96, 128, 256, 384],
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
    // A5.3: opt into the React 19 View Transition wrapper for App Router
    // navigations. With this flag set, Next wraps client navigations in
    // `document.startViewTransition` when the browser supports it. Pair
    // with `view-transition-name` styles on the shared element (product
    // card image -> detail hero) for the card-to-detail animation.
    // Kill-switch (Constraint C3 of openspec/changes/2026-06-03-instant-ux):
    // if the flag breaks build or SSR on the current toolchain it must be
    // reverted immediately rather than shipped behind a workaround.
    viewTransition: true,
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
