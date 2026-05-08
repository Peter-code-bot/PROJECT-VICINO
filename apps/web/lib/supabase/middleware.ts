import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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

  // Redirect authenticated users away from auth pages
  if (user && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
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
  // authenticated users. Users who haven't opted in to seller mode are
  // redirected to /perfil/editar?prompt=seller-mode where they can activate
  // the toggle. Defense-in-depth — seller layout also redirects.
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
      url.pathname = "/perfil/editar";
      url.searchParams.set("prompt", "seller-mode");
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
