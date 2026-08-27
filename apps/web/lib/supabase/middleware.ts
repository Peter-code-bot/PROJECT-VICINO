import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Construida, no escrita: escapar una barra invertida dentro de un literal
// es facil de equivocar y el error no falla, solo cambia lo que casa.
const BARRA_INVERTIDA = String.fromCharCode(92);

export async function updateSession(request: NextRequest, nonce?: string) {
  // Forward nonce to Server Components via request headers
  const forwardHeaders = new Headers(request.headers);
  if (nonce) forwardHeaders.set("x-nonce", nonce);

  let supabaseResponse = NextResponse.next({
    request: { headers: forwardHeaders },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Redirect authenticated users away from auth pages.
  //
  // Se respeta el ?next=, que este mismo middleware pone en siete sitios. Antes
  // se mandaba a "/" siempre, asi que quien ya tenia sesion y caia en /login
  // perdia el destino igual que lo perdia el formulario.
  //
  // Solo se acepta una ruta interna simple: barra inicial, sin doble barra
  // (seria otro dominio), sin barra invertida (algunos navegadores la
  // normalizan a barra) y sin ? ni #, porque aqui solo se asigna el pathname y
  // esos caracteres acabarian codificados dentro de la ruta.
  if (user && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    const next = request.nextUrl.searchParams.get("next");
    const destinoValido =
      !!next &&
      next.startsWith("/") &&
      !next.startsWith("//") &&
      !next.includes(BARRA_INVERTIDA) &&
      !next.includes("?") &&
      !next.includes("#");
    url.pathname = destinoValido ? next! : "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (user && pathname.startsWith("/register")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // Protect seller routes
  if (!user && pathname.startsWith("/seller")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Protect admin routes
  if (!user && pathname.startsWith("/admin")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Protect account routes
  if (!user && pathname.startsWith("/historial")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (!user && pathname.startsWith("/perfil")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (!user && pathname.startsWith("/favoritos")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (!user && pathname.startsWith("/notificaciones")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Protect /vender for unauthenticated users (matches existing pattern above).
  if (!user && pathname.startsWith("/vender")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
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
    const { data: gateProfile } = await supabase
      .from("profiles")
      .select("es_vendedor")
      .eq("id", user.id)
      .single();
    if (!gateProfile?.es_vendedor) {
      const url = request.nextUrl.clone();
      url.pathname = "/empezar-a-vender";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
