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
    
    // If PKCE verification fails (common when an email in-app browser opens the link, 
    // missing the PKCE cookie from the app/main browser), DO NOT redirect to /login.
    // Redirecting drops the `code` from the URL, breaking the flow if the user later 
    // switches to the app. Returning 200 OK HTML preserves the URL so Android App Links 
    // can pass the `code` to the app successfully.
    if (error.message.includes("PKCE") || error.message.includes("verifier")) {
      const urlWithoutScheme = request.url.replace(/^https?:\/\//, '');
      const intentUrl = `intent://${urlWithoutScheme}#Intent;scheme=https;package=com.vicino.mx;end`;
      
      return new NextResponse(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Continuar en VICINO</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #0A0F0E; color: #FFF8F0; text-align: center; padding: 20px; }
            h2 { font-size: 24px; margin-bottom: 12px; }
            p { font-size: 16px; color: #A0A0A0; margin-bottom: 32px; max-width: 400px; line-height: 1.5; }
            a { padding: 14px 28px; background-color: #1F5A4E; color: white; text-decoration: none; border-radius: 12px; font-weight: 600; display: inline-block; width: 100%; max-width: 300px; box-sizing: border-box; margin-bottom: 16px; }
            .secondary { background-color: transparent; border: 1px solid #1F5A4E; color: #FFF8F0; }
          </style>
        </head>
        <body>
          <h2>Casi listo</h2>
          <p>Para proteger tu seguridad, este enlace debe abrirse en la aplicación o navegador donde lo solicitaste.</p>
          <a href="${intentUrl}">Abrir en la app (Android)</a>
          <a href="${request.url}" class="secondary">Abrir en la app (iOS) / Reintentar</a>
          <script>
            // Intentar abrir la app automáticamente en Android
            if (/android/i.test(navigator.userAgent)) {
              window.location.href = "${intentUrl}";
            }
          </script>
        </body>
        </html>
      `, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" }
      });
    }
  }

  // Auth error — redirect to login with error
  return NextResponse.redirect(
    `${origin}/login?error=auth_callback_failed`,
    NO_CACHE_REDIRECT_INIT,
  );
}
