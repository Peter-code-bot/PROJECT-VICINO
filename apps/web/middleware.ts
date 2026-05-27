import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { oauthCallbackRateLimit, check, getClientIp } from "@/lib/rate-limit";

function tooManyRequests(): NextResponse {
  return new NextResponse(
    "Demasiadas solicitudes. Espera un momento e intenta de nuevo.",
    { status: 429, headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // OAuth callback retries get their own permissive tier (20/min IP) so a
  // legitimate Supabase OAuth retry storm doesn't lock the user out mid-auth.
  //
  // Password-based auth (signInWithPassword, signUp, resetPasswordForEmail)
  // is throttled inside the server actions in app/(auth)/actions.ts — NOT
  // here at the page level. A middleware tier on /login page loads is
  // bypassable (the supabase-js client posts to *.supabase.co directly,
  // never through Next) and would lock legitimate users out after 5 page
  // navigations.
  if (path === "/auth/callback") {
    const ip = getClientIp(request.headers);
    const { success } = await check(oauthCallbackRateLimit, ip);
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
    "/((?!_next/static|_next/image|favicon.ico|sentry-tunnel|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
