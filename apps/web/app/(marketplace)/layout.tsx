import { publicProfileName } from "@vicino/shared";
import { cookies, headers } from "next/headers";
import { CABECERA_RUTA, esRutaLegal } from "@/lib/navigation/rutas-legales";
import { SessionDataProvider } from "@/components/layout/session-data-provider";
import { NavigationPrefetch } from "@/components/layout/navigation-prefetch";
import { Suspense } from "react";
import { NavigationMetrics } from "@/components/layout/navigation-metrics";
import { Header } from "@/components/layout/header";
import { BottomNav } from "@/components/layout/bottom-nav";
import { ConditionalFooter } from "@/components/layout/conditional-footer";
import { Sidebar } from "@/components/layout/sidebar";
import { PageSwipeWrapper } from "@/components/layout/page-swipe-wrapper";
import { PullToRefreshWrapper } from "@/components/layout/pull-to-refresh-wrapper";
import { ChatUnreadProvider } from "@/components/layout/chat-unread-provider";
import { NotificationUnreadProvider } from "@/components/layout/notification-unread-provider";
import { FavoritesProvider } from "@/components/layout/favorites-provider";
import { MuroSesionProvider } from "@/components/auth/muro-sesion";
import { createClient } from "@/lib/supabase/server";

import { MainWrapper } from "@/components/layout/main-wrapper";
import { RegistroAceptacionLegal } from "@/components/legal/registro-aceptacion";
import { BannerCambioLegal, type AvisoLegal } from "@/components/legal/banner-cambio-legal";
import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";

/**
 * Un fallo de la consulta del perfil (no un perfil inexistente: eso llega como
 * data null sin error). Con `extra` para no perder el `details` de Postgres,
 * que es donde nombra la columna o la policy que rechazo.
 */
function reportarFalloPerfil(error: unknown): void {
  const { code, details, hint } = (error ?? {}) as { code?: unknown; details?: unknown; hint?: unknown };
  Sentry.captureException(error, {
    tags: { layout: "marketplace", query: "profiles" },
    extra: { code, details, hint },
  });
}

export default async function MarketplaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // PostgREST builders are lazy thenables. Consume now so this request runs
  // alongside the authenticated batch, also for guests. Handle rejection now,
  // rather than leaving an unhandled promise until the batch finishes.
  const avisosPendientes = Promise.resolve(supabase.rpc("avisos_legales_pendientes"))
    .then(({ data }) => data, () => null);

  let profile = null;
  /** true solo si la consulta del perfil SALIO BIEN y devolvio 0 filas. */
  let sinFilaEnProfiles = false;
  let isAdmin = false;
  let unreadNotifications = 0;
  let unreadChatMessages = 0;
  let favoriteIds: string[] = [];

  if (user) {
    // F3 + fault-isolation (optimize-auth-session-hydration): the 5 DB queries
    // below all depend on user.id but are independent of each other. Run them
    // concurrently via Promise.allSettled — Promise.all would reject the whole
    // batch on a single query failure and crash the layout. allSettled
    // preserves the pre-F3 behavior where a failed/slow query just reduced to
    // the empty default (?? null / ?? 0) without taking the page down.
    const [
      profileResult,
      rolesResult,
      notifResult,
      buyerChatsResult,
      sellerChatsResult,
      favoritesResult,
    ] = await Promise.allSettled([
      // maybeSingle y no single: con single, 0 filas llega como error PGRST116
      // y no se distingue de un fallo real de la consulta.
      supabase
        .from("profiles")
        .select("nombre, foto, es_vendedor, has_seen_onboarding, username, seller_type, nombre_negocio")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .in("role", ["admin", "moderator"]),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("leida", false)
        .neq("tipo", "message"),
      supabase
        .from("chats")
        .select("no_leidos_comprador")
        .eq("comprador_id", user.id),
      supabase
        .from("chats")
        .select("no_leidos_vendedor")
        .eq("vendedor_id", user.id),
      // Solo los ids: es lo unico que necesita el corazon de la tarjeta, y
      // mantiene la consulta barata aunque el usuario tenga muchos guardados.
      supabase.from("favorites").select("producto_id").eq("usuario_id", user.id),
    ]);

    // profile === null junta dos cosas que el registro legal (abajo) no puede
    // confundir: que NO haya fila y que la consulta haya FALLADO. Solo lo
    // primero se sabe aqui con certeza: la consulta salio bien y no trajo nada.
    // El fallo, en cambio, se manda a Sentry: un GRANT de columna que falte en
    // este SELECT (la saga de has_seen_onboarding, 20260704000002) dejaba el
    // layout entero sin perfil para todos sin un solo evento.
    if (profileResult.status === "fulfilled") {
      const { data, error } = profileResult.value;
      profile = data;
      if (error) reportarFalloPerfil(error);
      else sinFilaEnProfiles = data === null;
    } else {
      reportarFalloPerfil(profileResult.reason);
    }
    isAdmin =
      rolesResult.status === "fulfilled" &&
      (rolesResult.value.data?.length ?? 0) > 0;
    unreadNotifications =
      notifResult.status === "fulfilled" ? notifResult.value.count ?? 0 : 0;
    const buyerCount =
      buyerChatsResult.status === "fulfilled"
        ? buyerChatsResult.value.data?.reduce(
            (sum, c) => sum + (c.no_leidos_comprador ?? 0),
            0,
          ) ?? 0
        : 0;
    const sellerCount =
      sellerChatsResult.status === "fulfilled"
        ? sellerChatsResult.value.data?.reduce(
            (sum, c) => sum + (c.no_leidos_vendedor ?? 0),
            0,
          ) ?? 0
        : 0;
    unreadChatMessages = buyerCount + sellerCount;
    favoriteIds =
      favoritesResult.status === "fulfilled"
        ? (favoritesResult.value.data ?? []).map((f) => f.producto_id)
        : [];
  }

  // Avisos del §18: versiones sustanciales publicadas que aun no entran en
  // vigor. Si la consulta falla, la lista queda vacia y no se anuncia nada: un
  // fallo de lectura no puede tumbar el marketplace entero.
  const avisosLegales = await avisosPendientes;

  const isVendedor = profile?.es_vendedor ?? false;

  // Only a profile that explicitly has not seen onboarding goes to /bienvenida.
  // profile === null bundles transient query failures (allSettled), the signup
  // trigger race and genuinely missing rows -- redirecting those loops the user
  // between / and /bienvenida (completeOnboarding updates 0 rows "successfully").
  //
  // Las paginas legales quedan fuera (S02-B, 27-sep): el alta de vendedor pide
  // aceptar Terminos y Aviso de Privacidad con enlaces a ellas, y /eliminar-cuenta
  // es la pagina publica de baja; con el onboarding a medias las tres rebotaban
  // a /bienvenida. La ruta la pone el proxy (updateSession), no el cliente.
  const ruta = (await headers()).get(CABECERA_RUTA) ?? "";
  if (user && profile && profile.has_seen_onboarding === false && !esRutaLegal(ruta)) {
    redirect(`/bienvenida?next=${encodeURIComponent(ruta || "/")}`);
  }

  return (
    <SessionDataProvider key={user?.id ?? "guest"} userId={user?.id ?? ""} revision={(await cookies()).get("vicino_data_revision")?.value ?? ""}>
    <ChatUnreadProvider userId={user?.id ?? ""} initialCount={unreadChatMessages}>
      <NotificationUnreadProvider
        userId={user?.id ?? ""}
        initialCount={unreadNotifications}
      >
        <FavoritesProvider key={user?.id ?? "guest"} initialIds={favoriteIds}>
        {/* El muro envuelve TODO el marketplace, no cada superficie: asi
            cualquier control que necesite sesion la puede pedir sin que haya
            que pasarle el usuario por props desde media docena de padres. */}
        <MuroSesionProvider haySesion={!!user}>
        <div className="flex min-h-screen">
          <NavigationPrefetch key={user?.id ?? "guest"} authenticated={!!user} isVendedor={isVendedor} />
          <Suspense fallback={null}><NavigationMetrics key={user?.id ?? "guest"} /></Suspense>
          <Sidebar
            user={user ? { id: user.id } : null}
            // es_vendedor admite NULL en la base (tiene DEFAULT, pero el tipo
            // no puede afirmar lo que la columna no garantiza). Se colapsa
            // aqui, en la frontera, con el mismo criterio que isVendedor -- no
            // saber si vende equivale a no vender -- y de paso el Sidebar
            // recibe solo los tres campos que pinta.
            profile={
              profile
                ? {
                    nombre: publicProfileName(profile),
                    foto: profile.foto,
                    es_vendedor: isVendedor,
                  }
                : null
            }
            isAdmin={isAdmin}
          />
          <div className="flex-1 min-w-0 flex flex-col">
            {/* El sticky va en este envoltorio y no solo en <header>: un
                sticky se queda dentro de su padre, y este div mide lo mismo
                que el header, asi que el header se iba con el scroll. La capa
                nativa de iOS (CromoNativo) coloca la capsula de acciones
                sobre la posicion de este header y no la re-mide al hacer
                scroll: si el header no esta fijo, la capsula se desalinea. */}
            <div className="md:hidden sticky top-0 z-40">
              <Header
                isAdmin={isAdmin}
                user={user ? { id: user.id } : null}
                profile={
                  profile
                    ? {
                        nombre: publicProfileName(profile),
                        foto: profile.foto,
                        username: profile.username,
                        es_vendedor: isVendedor,
                      }
                    : null
                }
              />
            </div>
            {/* Se salta SOLO cuando se sabe que no hay perfil (la consulta salio
                bien con 0 filas): legal_acceptances.user_id apunta a
                profiles(id), y una sesion sin perfil (cuenta borrada a medias)
                hacia fallar el RPC por la FK en cada carga (Sentry 7758342326).
                Si la consulta FALLO no se sabe nada, y saltarse el registro lo
                perderia en silencio mientras dure el fallo; ademas el layout no
                se vuelve a ejecutar al navegar en el cliente, asi que "la
                siguiente carga" puede no llegar en toda la pestaña. En ese caso
                se registra igual: si de verdad no hay perfil, la accion
                reconoce la FK por su nombre y la manda como aviso, no como
                error. */}
            {user && !sinFilaEnProfiles && <RegistroAceptacionLegal />}
            <BannerCambioLegal avisos={(avisosLegales ?? []) as AvisoLegal[]} />
            <MainWrapper>
              <PullToRefreshWrapper>
                <PageSwipeWrapper isVendedor={isVendedor}>{children}</PageSwipeWrapper>
              </PullToRefreshWrapper>
            </MainWrapper>
            <div className="hidden md:block">
              <ConditionalFooter isVendedor={isVendedor} />
            </div>
            <BottomNav isVendedor={isVendedor} />
          </div>
        </div>
        </MuroSesionProvider>
        </FavoritesProvider>
      </NotificationUnreadProvider>
    </ChatUnreadProvider>
    </SessionDataProvider>
  );
}
