import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function safeNext(rawNext: string | null, origin: string): string {
  const candidate = rawNext ?? "/";
  try {
    const target = new URL(candidate, origin);
    if (target.origin !== origin) return "/";
    return target.pathname + target.search + target.hash;
  } catch {
    return "/";
  }
}

// F4 (optimize-auth-session-hydration): all redirects use status 303 (See Other,
// RFC 6749 recommendation for OAuth PRG) and Cache-Control: private, no-store.
// The PKCE code is single-use — a cached redirect would fail on retry. The
// header does not affect the Set-Cookie header for the Supabase session, which
// is delivered as a separate header on the same response.
const NO_CACHE_REDIRECT_INIT = {
  status: 303 as const,
  headers: { "Cache-Control": "private, no-store" },
};

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"), origin);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`, NO_CACHE_REDIRECT_INIT);
    }
  }

  // Auth error — redirect to login with error
  return NextResponse.redirect(
    `${origin}/login?error=auth_callback_failed`,
    NO_CACHE_REDIRECT_INIT,
  );
}
