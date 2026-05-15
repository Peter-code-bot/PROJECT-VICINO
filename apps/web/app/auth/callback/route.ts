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

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"), origin);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Auth error — redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
