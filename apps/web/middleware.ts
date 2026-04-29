import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rate-limit";
import { logSecurityEvent } from "@/lib/security/audit";

export async function middleware(request: NextRequest) {
  // Rate limit before doing any auth/session work — count once, reuse for headers.
  const path = request.nextUrl.pathname;
  const limit = RATE_LIMITS[path];
  let rateLimitResult: ReturnType<typeof checkRateLimit> | null = null;

  if (limit) {
    const ip = getClientIp(request);
    const key = `${ip}:${path}`;
    rateLimitResult = checkRateLimit(key, limit.max, limit.windowMs);
    if (!rateLimitResult.allowed) {
      logSecurityEvent({ type: "rate_limit_exceeded", path, ip });
      const retryAfterSec = Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000);
      return new NextResponse(
        JSON.stringify({ error: "Too many requests", retryAfter: retryAfterSec }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(retryAfterSec),
            "X-RateLimit-Limit": String(limit.max),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.ceil(rateLimitResult.resetAt / 1000)),
          },
        }
      );
    }
  }

  // Use Web Crypto API — Buffer is not available in Edge/middleware runtime
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = btoa(String.fromCharCode(...nonceBytes));

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https://*.supabase.co",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://nominatim.openstreetmap.org",
    "font-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  const response = await updateSession(request, nonce);

  const cspMode = process.env.CSP_MODE ?? "report-only";
  if (cspMode !== "off") {
    const headerName =
      cspMode === "report-only"
        ? "Content-Security-Policy-Report-Only"
        : "Content-Security-Policy";
    response.headers.set(headerName, csp);
  }

  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(self)"
  );
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload"
  );

  if (limit && rateLimitResult) {
    response.headers.set("X-RateLimit-Limit", String(limit.max));
    response.headers.set("X-RateLimit-Remaining", String(rateLimitResult.remaining));
    response.headers.set("X-RateLimit-Reset", String(Math.ceil(rateLimitResult.resetAt / 1000)));
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (favicon file)
     * - public files (svg, png, jpg, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
