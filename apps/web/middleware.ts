import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { authRateLimit, oauthCallbackRateLimit, check } from "@/lib/rate-limit";

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

function tooManyRequests(): NextResponse {
  return new NextResponse(
    "Demasiadas solicitudes. Espera un momento e intenta de nuevo.",
    { status: 429, headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const ip = getClientIp(request);

  // OAuth callback retries get their own, more permissive tier (20/min IP)
  // so a legitimate Supabase OAuth retry storm doesn't trip the 5/15min login
  // limit and lock the user out mid-auth.
  if (path === "/auth/callback") {
    const { success } = await check(oauthCallbackRateLimit, ip);
    if (!success) return tooManyRequests();
  } else if (
    path.startsWith("/login") ||
    path.startsWith("/register") ||
    path.startsWith("/forgot-password")
  ) {
    const { success } = await check(authRateLimit, ip);
    if (!success) return tooManyRequests();
  }

  return await updateSession(request);
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
