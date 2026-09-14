import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import {
  oauthCallbackRateLimit,
  readHeavyRateLimit,
  check,
  getClientIp,
} from "@/lib/rate-limit";

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

  // Las dos superficies mas caras del sitio, y las unicas dos que no tenian
  // cuota en ninguna capa.
  //
  // El home hace en su primer render una RPC de 150 filas con dos subconsultas
  // JSONB por fila, otra de 20 para "Cerca de ti", el getUser, el perfil y la
  // verificacion. /buscar suma un ilike '%...%' sobre profiles por cada
  // termino distinto. Y el unico guard de lectura pesada que existia
  // (getMoreFeedProducts) protege la pagina 2 en adelante: la 1, que es la
  // cara, estaba abierta a un bucle de curl.
  //
  // Va AQUI y no dentro de las paginas por dos razones. Cortar en el
  // middleware ahorra el render entero, no solo las consultas; y el matcher
  // compilado lleva el sufijo de RSC, asi que esto cubre tambien la navegacion
  // por cliente y los prefetch, que cuestan lo mismo que una visita.
  //
  // Identificador propio (`pagina:`) y no `feed:` ni `read:`: son cubos
  // distintos a proposito, con el mismo criterio que ya documenta
  // (marketplace)/actions.ts — raspar el feed no debe dejar sin home a quien
  // comparte NAT.
  //
  // 60/min por IP viene de readHeavyRateLimit. Es holgado a proposito: una IP
  // no es una persona (Telcel e Izzi meten barrios enteros detras del mismo
  // NAT), y 60 cargas de pagina por minuto desde una sola IP ya no es gente
  // navegando. Si aparecieran falsos positivos, el arreglo es subir el tope,
  // no volver a dejarlo pasar.
  //
  // OJO: hoy esto es un no-op en produccion. Sin UPSTASH_REDIS_REST_URL ni
  // UPSTASH_REDIS_REST_TOKEN, check() devuelve success siempre. El codigo
  // queda listo y empieza a frenar el dia que existan esas credenciales.
  if (path === "/" || path === "/buscar") {
    const ip = getClientIp(request.headers);
    const { success } = await check(readHeavyRateLimit, `pagina:${ip}`);
    if (!success) return demasiadasPaginas();
  }

  return await updateSession(request);
}

/**
 * 429 para las paginas publicas.
 *
 * NO reusa tooManyRequests(): ese redirige a /login, que para un rastreador en
 * el home no tiene ningun sentido, y para una persona seria peor todavia —
 * mandarla a iniciar sesion cuando lo que pasa es que hay que esperar un
 * minuto. Aqui se responde en el sitio, con Retry-After y una pagina minima
 * que se explica.
 */
function demasiadasPaginas(): NextResponse {
  return new NextResponse(
    `<!doctype html><html lang="es"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>Demasiadas solicitudes — VICINO</title>` +
      `<style>body{margin:0;min-height:100dvh;display:grid;place-items:center;` +
      `font:16px/1.5 system-ui,sans-serif;background:#faf9f7;color:#1b1b1b;padding:24px}` +
      `main{max-width:28rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}` +
      `p{margin:0;color:#5b5b5b}</style></head><body><main>` +
      `<h1>Demasiadas solicitudes</h1>` +
      `<p>Hemos recibido muchas peticiones desde tu conexión. ` +
      `Espera un minuto y vuelve a intentarlo.</p>` +
      `</main></body></html>`,
    {
      status: 429,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Retry-After": "60",
        "Cache-Control": "private, no-store",
      },
    },
  );
}

export const config = {
  matcher: [
    /*
     * Lo que NO casa aqui se ahorra el proxy entero, y con el la llamada de red
     * que updateSession hace a supabase.auth.getUser() en CADA peticion.
     *
     * Importa mas de lo que parece: el matcher compilado lleva un sufijo
     * opcional (.json|.rsc|.segments/....segment.rsc), asi que tambien casaba
     * cada peticion RSC y cada prefetch por segmento, no solo la navegacion
     * visible. Cada envio a Sentry por /sentry-tunnel pagaba tambien su getUser,
     * pese a que next.config.ts afirmaba que esa ruta estaba excluida.
     *
     * La semantica de autenticacion NO cambia: las rutas que updateSession
     * vigila (/login, /register, /perfil, /historial, /favoritos,
     * /notificaciones, /vender, /seller, /admin) y /auth/callback-server siguen
     * pasando por aqui, igual que el resto de paginas. Lo que sale es lo que
     * nunca fue una navegacion:
     *   - api: cada route handler resuelve su propia autenticacion, y el cron
     *     usa CRON_SECRET. Ninguno depende de que el proxy refresque la cookie.
     *   - sentry-tunnel, sw.js, workbox-*.js, theme-init.js, manifest.json,
     *     icons/ y los estaticos de _next.
     */
    "/((?!api|sentry-tunnel|sw\\.js|workbox-[^/]*\\.js|theme-init\\.js|manifest\\.json|icons/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)",
  ],
};
