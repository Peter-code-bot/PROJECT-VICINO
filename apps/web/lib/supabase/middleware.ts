import { createServerClient } from "@supabase/ssr";
import { fetchConLimite } from "./fetch-con-limite";
import type { Database } from "@/types/database.types";
import { NextResponse, type NextRequest } from "next/server";
import { destinoAutenticadoSeguro } from "../auth/destino-seguro";
import { usuarioOInvitado } from "../session-auth";
import { CABECERA_RUTA } from "../navigation/rutas-legales";
import { requiereSesion, loginPara, COOKIE_DESTINO_ONBOARDING } from "../auth/acceso-invitado";

export async function updateSession(request: NextRequest, nonce?: string) {
  // Forward nonce to Server Components via request headers
  const forwardHeaders = new Headers(request.headers);
  if (nonce) forwardHeaders.set("x-nonce", nonce);
  // La ruta real para los layouts, que no la reciben. SIEMPRE se sobrescribe:
  // un valor que mandara el cliente no llega nunca a los Server Components.
  forwardHeaders.set(CABECERA_RUTA, request.nextUrl.pathname + request.nextUrl.search);

  let supabaseResponse = NextResponse.next({
    request: { headers: forwardHeaders },
  });

  // El generic Database es lo que hace que tsc valide los nombres de columna
  // de cada .select(). Sin el, un select de una columna que no existe compila
  // y PostgREST devuelve { data: null, error }, que es como se perdieron cuatro
  // selects en silencio. Los tipos se regeneran con: node scripts/gen-types.mjs
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: fetchConLimite(fetch, process.env.NEXT_PUBLIC_SUPABASE_URL!) },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          forwardHeaders.set("cookie", request.cookies.toString());
          supabaseResponse = NextResponse.next({
            request: { headers: forwardHeaders },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session — important for Server Components
  let user;
  try {
    user = await usuarioOInvitado(supabase);
  } catch {
    const unavailable = new NextResponse("No pudimos comprobar tu sesión. Intenta de nuevo.", {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "5" },
    });
    for (const cookie of supabaseResponse.cookies.getAll()) unavailable.cookies.set(cookie);
    return unavailable;
  }

  const pathname = request.nextUrl.pathname;

  if (!user && requiereSesion(pathname + request.nextUrl.search)) {
    const response = NextResponse.redirect(new URL(loginPara(pathname + request.nextUrl.search), request.url));
    for (const cookie of supabaseResponse.cookies.getAll()) response.cookies.set(cookie);
    return response;
  }
  if (user && pathname === "/bienvenida" && request.nextUrl.searchParams.has("next")) {
    const next = destinoAutenticadoSeguro(request.nextUrl.searchParams.get("next"));
    supabaseResponse.cookies.set(COOKIE_DESTINO_ONBOARDING, next, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: 1800 });
  }

  // Redirect authenticated users away from auth pages.
  //
  // Se respeta el ?next= para volver a donde la persona iba, preservando destinos
  // legitimos (como /buscar?q=mesa o /vender) mediante destinoAutenticadoSeguro,
  // que descarta destinos que apunten de vuelta a /login, /register o /forgot-password
  // para evitar bucles de redireccion.
  //
  // Crucial: se copian las cookies renovadas por createServerClient al objeto
  // redirectResponse, para no perder la sesion recien emitida o refrescada.
  if (user && (pathname === "/login" || pathname.startsWith("/login/") ||
      pathname === "/register" || pathname.startsWith("/register/"))) {
    const next = request.nextUrl.searchParams.get("next");
    const destino = destinoAutenticadoSeguro(next);
    const redirectUrl = new URL(destino, request.url);
    const redirectResponse = NextResponse.redirect(redirectUrl);
    for (const cookie of supabaseResponse.cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }
    return redirectResponse;
  }

  // Phase 9: gate /vender and /seller/* on `profiles.es_vendedor` for
  // authenticated users. Defense-in-depth — seller layout also redirects.
  //
  // Ahora manda a /empezar-a-vender, la ruta dedicada del alta. Antes mandaba a
  // /perfil/editar?prompt=seller-mode, y ese parametro NO LO LEIA NADIE: la
  // persona aterrizaba en la pantalla generica de editar perfil con la casilla
  // que tenia que marcar por debajo de seis campos. Era el item 7 del backlog.
  //
  // No hay bucle: /empezar-a-vender manda a /vender a quien YA es vendedor, y
  // aqui solo entra quien no lo es.
  if (
    user &&
    (pathname === "/vender" ||
      pathname.startsWith("/vender/") ||
      pathname === "/seller" ||
      pathname.startsWith("/seller/"))
  ) {
    const { data: gateProfile, error: gateError } = await supabase
      .from("profiles")
      .select("es_vendedor, has_seen_onboarding")
      .eq("id", user.id)
      .maybeSingle();
    if (gateError) {
      const unavailable = new NextResponse("No se pudo verificar el acceso. Intenta de nuevo.", {
        status: 503,
        headers: { "Cache-Control": "no-store", "Retry-After": "5" },
      });
      for (const cookie of supabaseResponse.cookies.getAll()) unavailable.cookies.set(cookie);
      return unavailable;
    }
    if (gateProfile?.has_seen_onboarding === false) {
      const url = request.nextUrl.clone();
      const destino = destinoAutenticadoSeguro(url.pathname + url.search);
      url.pathname = "/bienvenida";
      url.search = new URLSearchParams({ next: destino }).toString();
      const response = NextResponse.redirect(url);
      for (const cookie of supabaseResponse.cookies.getAll()) response.cookies.set(cookie);
      return response;
    }
    if (!gateProfile?.es_vendedor) {
      const url = request.nextUrl.clone();
      url.pathname = "/empezar-a-vender";
      url.search = "";
      const response = NextResponse.redirect(url);
      for (const cookie of supabaseResponse.cookies.getAll()) response.cookies.set(cookie);
      return response;
    }
  }

  return supabaseResponse;
}
