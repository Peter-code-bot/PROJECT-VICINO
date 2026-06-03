import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { oauthCallbackRateLimit, check, getClientIp } from "@/lib/rate-limit";

// MED-3 (CODEX Tanda A SEC/AUTH follow-up): replace the previous plain-text
// 429 response ("Demasiadas solicitudes...") with the same 303 redirect +
// Cache-Control contract that apps/web/app/auth/callback-server/route.ts
// uses for failed OAuth code exchanges. A raw 429 tab with body text was a
// UX dead end -- the user landed on a stranded error page with no path
// forward. The redirect lands them on /login where the rest of the auth
// surface (sign-in form, recover link, register link) is present.
//
// The redirect uses status 303 (See Other, RFC 6749 recommendation for
// OAuth PRG) and Cache-Control: private, no-store -- mirrors the
// callback-server contract so a cached error redirect cannot replay.
// /login?error=too_many_requests is the query convention the auth surface
// already uses (oauth-url-listener.tsx redirects with ?error= for
// auth_callback_failed). NOTE: today the login page does NOT render the
// ?error= query (documented as a follow-up below in auth-mobile/spec.md
// under "F-followup -- login error rendering"). Users will land on a
// clean /login until that follow-up ships, which is still better than
// the raw 429 dead end.
function tooManyRequests(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "?error=too_many_requests";
  return NextResponse.redirect(url, {
    status: 303 as const,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // OAuth and recovery callbacks get their own permissive tier (20/min IP)
  // so a legitimate Supabase OAuth retry storm doesn't lock the user out
  // mid-auth. Same tier covers password-recovery email clicks (which now
  // also land on /auth/callback-server after the forgot-password fix).
  //
  // Password-based auth (signInWithPassword, signUp, resetPasswordForEmail)
  // is throttled inside the server actions in app/(auth)/actions.ts — NOT
  // here at the page level. A middleware tier on /login page loads is
  // bypassable (the supabase-js client posts to *.supabase.co directly,
  // never through Next) and would lock legitimate users out after 5 page
  // navigations.
  //
  // Path: /auth/callback-server is the actual server route handler that
  // runs exchangeCodeForSession. /auth/callback (without -server) is the
  // client loader page used as an APK safety net (no code exchange there),
  // so rate-limiting that path achieved nothing. Pre-fix the path was
  // wrong; PKCE single-use mitigated abuse but the guard was idle.
  if (path === "/auth/callback-server") {
    const ip = getClientIp(request.headers);
    const { success } = await check(oauthCallbackRateLimit, ip);
    if (!success) return tooManyRequests(request);
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
