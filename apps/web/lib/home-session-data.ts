import "server-only";
import { cookies } from "next/headers";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { usuarioOInvitado } from "@/lib/session-auth";
import { primaryCategorySlug } from "@vicino/shared";
import type { FeedProduct } from "@/types/feed";
import type { FollowedStore } from "@/components/home/following-rail";
import { makeFeedCursor } from "@/lib/feed-cursor";
import { consultarProductosCercanos, type ConsultaCercanosResult } from "@/lib/geo/consulta-cercanos";
import { catalogFailure, type CatalogFailure } from "@/lib/catalogo/estado-consulta";
import { parseRadiusCookie } from "@/lib/geo/radius";
import { cursorDeUltimo, leerEstadoCuota } from "@/lib/comunidades/tipos";
import { traducirErrorComunidad } from "@/lib/comunidades/errores";
import type { SubTabComunidades } from "@/components/comunidades/sub-tabs";

/**
 * Parametros de busqueda que acepta el inicio, tanto en la URL de la pagina
 * como en GET /api/session/home. Un solo esquema para los dos: si divergieran,
 * la semilla que siembra page.tsx y lo que la API devuelve para la misma clave
 * podrian no ser el mismo feed.
 */
export const homeSearchSchema = z.object({
  feed: z.enum(["parati", "following", "solicitudes", "comunidades"]).optional(),
  tab: z.enum(["muro", "mias", "descubrir"]).optional(),
  cats: z.string().max(1000).optional(),
});
export type HomeSearchInput = z.infer<typeof homeSearchSchema>;

/**
 * Cliente y usuario que el llamador ya resolvio en el mismo render. La pagina
 * del inicio crea el cliente y llama a auth.getUser() una sola vez; sin esto
 * el cargador repetiria el viaje a Auth que la pagina acaba de hacer.
 */
export interface HomeSessionContext {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: User | null;
}

export async function getHomeSession(
  searchParams: { feed?: string; cats?: string; tab?: string },
  ctx?: HomeSessionContext,
) {
  const { feed: feedParam, cats: catsParam, tab: tabParam } = searchParams;
  const feed: "parati" | "following" | "solicitudes" | "comunidades" =
    feedParam === "following"
      ? "following"
      : feedParam === "solicitudes"
        ? "solicitudes"
        : feedParam === "comunidades"
          ? "comunidades"
          : "parati";
  const subTabComunidades: SubTabComunidades =
    tabParam === "mias" ? "mias" : tabParam === "descubrir" ? "descubrir" : "muro";

  // Con ctx no se crea otro cliente ni se vuelve a Auth: quien llama ya lo
  // hizo en este mismo render. Las cookies de zona se leen aqui igual en los
  // dos casos, porque no viajan en el ctx.
  const supabase = ctx ? ctx.supabase : await createClient();
  // Un fallo de Auth (red, 5xx, 429) NO es un visitante: si se tratara como
  // tal, la API respondería con userId vacío y el cliente con sesión lo
  // leería como cuenta ajena, vaciaría la memoria y lo mandaría a /login. Se
  // lanza para que la ruta responda 503 y el cliente conserve lo que tenía.
  const user = ctx ? ctx.user : await usuarioOInvitado(supabase);

  const cookieStore = await cookies();
  const locationCookie = cookieStore.get("vicino_location")?.value;
  const radiusCookie = cookieStore.get("vicino_radius")?.value;
  // Esta era la unica de las cuatro lecturas del radio que estaba bien. Ahora
  // las cuatro comparten la misma funcion, para que no vuelvan a divergir: el P0
  // del feed de agosto fue exactamente eso, un `validRadius = 2000` en una
  // pagina contra los 50 km que el usuario tenia configurados.
  const validRadius = parseRadiusCookie(radiusCookie);

  let userLat: number | null = null;
  let userLng: number | null = null;
  if (locationCookie) {
    const [latStr, lngStr] = locationCookie.split(",");
    const lat = parseFloat(latStr ?? "");
    const lng = parseFloat(lngStr ?? "");
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    ) {
      userLat = lat;
      userLng = lng;
    }
  }
  const hasLocation = userLat !== null && userLng !== null;

  // Estas consultas son independientes. Cada una puede fallar sin borrar
  // el resultado de las otras; el feed conserva su propio estado de error.
  const feedPromise = (async (): Promise<{
    products: FeedProduct[] | null;
    failure: CatalogFailure | null;
  }> => {
    if (feed !== "parati") return { products: [], failure: null };
    try {
      if (hasLocation) {
        const { data, error } = await supabase.rpc("search_nearby_products_v4", {
          user_lat: userLat!,
          user_lng: userLng!,
          radius_meters: validRadius,
          result_limit: 150,
        }).throwOnError();
        if (error) {
          Sentry.captureException(error, {
            tags: { action: "feed_nearby_products", section: "para_ti" },
          });
          return { products: null, failure: catalogFailure(error) };
        }
        return { products: data as FeedProduct[], failure: null };
      }

      const { data } = await supabase
        .from("products_services")
        .select(
          `
        id,
        titulo,
        precio,
        imagen_principal,
        categoria,
        slug,
        created_at,
        precio_negociable,
        modo_precio,
        profiles!inner(nombre, trust_level, average_rating, reviews_count),
        product_categories(is_primary, categories(slug, nombre))
          `
        ).throwOnError()
        .eq("estatus", "disponible")
        .order("created_at", { ascending: false })
        .limit(150);
      return { products: data as FeedProduct[] | null, failure: null };
    } catch (error) {
      Sentry.captureException(error, { tags: { action: "feed_initial", section: "para_ti" } });
      return { products: null, failure: catalogFailure(error) };
    }
  })();

  const perfilPromise = user && feed === "parati"
    ? supabase.from("profiles").select("es_vendedor").throwOnError().eq("id", user.id).single()
    : Promise.resolve(null);

  const verificacionPromise = user && feed === "parati"
    ? supabase
        .from("seller_verification")
        .select("university_name").throwOnError()
        .eq("user_id", user.id)
        .eq("status", "approved")
        .eq("document_type", "Credencial Universitaria")
        .maybeSingle()
    : Promise.resolve(null);

  // La seccion «Cerca de ti» se trae AQUI, en el servidor, y no desde un
  // efecto del cliente como hasta ahora.
  //
  // Antes esa seccion no existia en el HTML: estaba entera detras de
  // `{position && ...}` y `position` es null hasta que hidrata, asi que salia
  // despues de descargar y ejecutar el JS, y solo ENTONCES pedia los productos.
  // De ahi que aparecieran primero las categorias —que son marcado del
  // servidor— y «Cerca de ti» despues.
  //
  // Entra en el grupo concurrente y no en una espera aparte: es una consulta mas en
  // PARALELO, no una cascada. Y usa el mismo RPC y el mismo difuminado de
  // coordenadas que usaba el cliente, solo que ordenando por distancia; la
  // unica diferencia es quien lo pide.
  const cercaDeTiPromise: Promise<ConsultaCercanosResult> = hasLocation && feed === "parati"
    ? consultarProductosCercanos({
        lat: userLat!,
        lng: userLng!,
        radiusMeters: validRadius,
        limit: 20,
      })
    : Promise.resolve({ products: [] });

  const [feedSettled, perfilSettled, verificacionSettled, cercaSettled] =
    await Promise.allSettled([
      feedPromise,
      perfilPromise,
      verificacionPromise,
      cercaDeTiPromise,
    ]);

  const feedResultado = feedSettled.status === "fulfilled"
    ? feedSettled.value : { products: null, failure: catalogFailure(feedSettled.reason) };
  const perfilResultado = perfilSettled.status === "fulfilled" ? perfilSettled.value : null;
  const verificacionResultado = verificacionSettled.status === "fulfilled" ? verificacionSettled.value : null;
  const cercaDeTiResultado: ConsultaCercanosResult = cercaSettled.status === "fulfilled"
    ? cercaSettled.value : { products: [], error: "No se pudo consultar cercanía" };

  const viewerIsVendedor = perfilResultado?.data?.es_vendedor ?? false;
  const viewerUniversity: string | null =
    verificacionResultado?.data?.university_name ?? null;

  // F10: IIFE so TypeScript infers universityProducts directly from the
  // Supabase SELECT result. Single source of truth; if the SELECT shape
  // changes the consumers fail to compile.
  const universityProducts = await (async () => {
    if (!viewerUniversity) return [];
    const { data: uniSellers } = await supabase
      .from("seller_verification")
      .select("user_id").throwOnError()
      .eq("university_name", viewerUniversity)
      .eq("status", "approved");

    const sellerIds = uniSellers?.map(s => s.user_id) || [];
    if (sellerIds.length === 0) return [];

    let uProducts: FeedProduct[] | null = null;
    let rpcFailed = false;
    if (hasLocation) {
      const { data, error } = await supabase.rpc("search_nearby_products_v4", {
        user_lat: userLat!,
        user_lng: userLng!,
        radius_meters: validRadius,
        result_limit: 20,
        seller_ids: sellerIds,
        restrict_seller_mode: true,
      }).throwOnError();
      if (error) {
        Sentry.captureException(error, { tags: { action: "feed_nearby_products", section: "university" } });
        rpcFailed = true;
      } else {
        uProducts = data as FeedProduct[];
      }
    }
    
    if (!hasLocation) {
      const { data } = await supabase
        .from("products_services")
        .select(`
          id,
          titulo,
          precio,
          imagen_principal,
          categoria,
          slug,
          created_at,
          precio_negociable,
          modo_precio,
          profiles!inner(nombre, trust_level, average_rating, reviews_count),
          product_categories(is_primary, categories(slug, nombre))
        `).throwOnError()
        .eq("estatus", "disponible")
        .in("creador_id", sellerIds)
        .order("created_at", { ascending: false })
        .limit(20);
      uProducts = data as FeedProduct[] | null;
    }

    return uProducts ?? [];
  })().catch((error) => {
    Sentry.captureException(error, { tags: { action: "feed_initial", section: "university" } });
    return [];
  });

  // El feed ya se resolvio arriba, en paralelo con perfil y verificacion.
  const products = feedResultado.products;
  const feedRpcFailed = feedResultado.failure !== null;

  const showGeoEmptyState = hasLocation;

  const all = products ?? [];

  // A5.2: cursor for <MasProductos>. The DESC fetch above puts the
  // OLDEST of the initial 150 at the end of the array; getMoreFeedProducts
  // filters strictly `< cursor` so the flat section starts at product
  // 151 and never overlaps the carousels above. When the catalog is
  // smaller than the initial 150 (length < 150), there is nothing more
  // to load -> initialCursor null -> the section renders nothing.
  const INITIAL_HOME_PAGE_SIZE = 150;
  const masProductosInitialCursor =
    all.length === INITIAL_HOME_PAGE_SIZE && all[all.length - 1]
      ? makeFeedCursor(all[all.length - 1]!.created_at as string, all[all.length - 1]!.id)
      : null;

  // MP#08 #4 Fase 1A: agrupamos por la PRIMARY del pivote en vez de por
  // categoria TEXT. El embed product_categories ya viene en el SELECT (5c-4).
  // Fallback al TEXT preserva agrupacion para edge cases sin pivote (Fase 1A
  // graceful; el writer-stop es 1C). Productos sin primary NI TEXT caen a
  // "sin-categoria" y NO desaparecen del grouping (filter de carousels los
  // descartara despues si <1 productos comparten ese bucket).
  const byCategory = all.reduce<Record<string, typeof all>>((acc, p) => {
    const key = primaryCategorySlug((p as { product_categories?: unknown }).product_categories)
      ?? p.categoria
      ?? "sin-categoria";
    (acc[key] ??= []).push(p);
    return acc;
  }, {});

  const categoryCarousels = Object.entries(byCategory)
    .filter(([, ps]) => ps.length >= 1)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 15);

  const firstSelectedCategory = (typeof catsParam === "string" ? catsParam : "")
    .split(",").find(slug => categoryCarousels.some(([available]) => available === slug));

  // Fetch "Siguiendo" data.
  // F10: single IIFE that returns the 4 vars so each is inferred from its
  // actual Supabase SELECT result (no manual any[]). The three exit paths
  // (not on following / no follows / has follows) each return a consistent
  // shape; TypeScript unifies and widens to the broadest array type.
  const { followingPosts, followedStoresData, noFollows, nearbyStores } =
    await (async () => {
      if (feed !== "following" || !user) {
        return {
          followingPosts: [],
          followedStoresData: [] as FollowedStore[],
          noFollows: false,
          nearbyStores: [],
        };
      }
      const { data: follows } = await supabase
        .from("store_follows")
        .select("store_id, profiles!store_id(id, nombre, foto)").throwOnError()
        .eq("follower_id", user.id);

      if (!follows || follows.length === 0) {
        // Fetch some suggestions
        const { data: suggestions } = await supabase
          .from("profiles")
          .select("id, nombre, foto, trust_level").throwOnError()
          .eq("es_vendedor", true)
          .limit(3);
        return {
          followingPosts: [],
          followedStoresData: [] as FollowedStore[],
          noFollows: true,
          nearbyStores: suggestions ?? [],
        };
      }
      const storeIds = follows.map((f) => f.store_id);

      const { data: posts } = await supabase
        .from("products_services")
        .select(`
          id,
          creador_id,
          titulo,
          precio,
          imagen_principal,
          categoria,
          slug,
          created_at,
          precio_negociable,
          modo_precio,
          profiles!inner(id, nombre, foto, trust_level, average_rating, reviews_count),
          product_categories(is_primary, categories(slug, nombre))
        `).throwOnError()
        .eq("estatus", "disponible")
        .in("creador_id", storeIds)
        .order("created_at", { ascending: false })
        .limit(50);

      // F10: normalize the `profiles` embed from supabase-js's default
      // "array embed" shape into a single object so the JSX consumers
      // (StorePost props at the bottom of this file) can keep accessing
      // post.profiles.nombre etc. without per-site Array.isArray guards.
      // The flatMap drops the (rare) row whose joined profile is missing,
      // which a `posts.map` would have left as a half-built record.
      const followingPosts = (posts ?? []).flatMap((p) => {
        const profile = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;
        return profile ? [{ ...p, profiles: profile }] : [];
      });

      // F10: `f` is now inferred from the typed `follows` array (was `f: any`).
      // The `f.profiles` embed is typed as an array by supabase-js (it doesn't
      // statically know the FK is single-target) -- narrow via the same
      // Array.isArray pattern used elsewhere in the codebase. Filter the rare
      // empty-embed case so the resulting list never has a half-built entry.
      const followedStoresData: FollowedStore[] = follows.flatMap((f) => {
        const store = Array.isArray(f.profiles) ? f.profiles[0] : f.profiles;
        if (!store) return [];
        const hasPosts = followingPosts.some((p) => p.creador_id === store.id);
        return [{
          id: store.id,
          name: store.nombre,
          letter: store.nombre.charAt(0).toUpperCase(),
          imgUrl: store.foto,
          hasRecentPosts: hasPosts,
        }];
      });

      return {
        followingPosts,
        followedStoresData,
        noFollows: false,
        nearbyStores: [],
      };
    })();

  // Feed de comunidades: cinco lecturas independientes en PARALELO, solo
  // cuando esta pestana esta activa y hay sesion (las RPC exigen auth.uid()).
  // allSettled y no all: que falle Descubrir no debe tirar el muro. Cada
  // error se traduce en un solo sitio y llega al cliente como texto.
  const comunidades = await (async () => {
    if (feed !== "comunidades" || !user) return null;
    const [perfil, muroR, miasR, solicitudesR, cuotaR, cercanasR] = await Promise.allSettled([
      supabase.from("profiles").select("nombre, foto").eq("id", user.id).maybeSingle(),
      supabase.rpc("feed_comunidades_explorar", { result_limit: 30 }),
      supabase.rpc("mis_comunidades"),
      supabase.rpc("mis_solicitudes_union"),
      supabase.rpc("estado_cuota_fundacion"),
      hasLocation
        ? supabase.rpc("descubrir_comunidades", { p_lat: userLat!, p_lng: userLng!, result_limit: 30 })
        : Promise.resolve(null),
    ]);

    const valor = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === "fulfilled" ? r.value : null);
    const perfilData = valor(perfil)?.data ?? null;
    const muroData = valor(muroR);
    const miasData = valor(miasR);
    const solicitudesData = valor(solicitudesR);
    const cuotaData = valor(cuotaR);
    const cercanasData = valor(cercanasR);

    for (const [nombre, r] of [
      ["feed_comunidades_explorar", muroData],
      ["mis_comunidades", miasData],
      ["descubrir_comunidades", cercanasData],
    ] as const) {
      if (r?.error) Sentry.captureException(r.error, { tags: { action: nombre, section: "comunidades" } });
    }

    const posts = muroData?.data ?? [];
    return {
      user: { id: user.id, nombre: perfilData?.nombre ?? "Tú", foto: perfilData?.foto ?? null },
      muro: { posts, cursor: cursorDeUltimo(posts, 30) },
      mias: miasData?.data ?? [],
      misSolicitudes: solicitudesData?.data ?? [],
      cercanas: hasLocation && cercanasData && !cercanasData.error ? (cercanasData.data ?? []) : null,
      cuota: leerEstadoCuota(cuotaData?.error ? null : cuotaData?.data),
      errores: {
        muro: muroData?.error ? traducirErrorComunidad(muroData.error) : undefined,
        mias: miasData?.error ? traducirErrorComunidad(miasData.error) : undefined,
        cercanas: cercanasData?.error ? traducirErrorComunidad(cercanasData.error) : undefined,
      },
    };
  })();

  // Un feed caido NO se lanza: el valor lleva `feedResultado.failure` y el
  // consumidor pinta CatalogQueryState con la causa (lo que master ensenaba
  // dentro del home). La API decide aparte si eso merece un 503 (ver
  // app/api/session/[resource]/route.ts): asi la revalidacion en segundo
  // plano conserva lo que habia, y la primera visita explica que paso.
  return { userId: user?.id ?? "", value: { feed, subTabComunidades, userLat, userLng, validRadius, hasLocation, viewerIsVendedor, viewerUniversity, universityProducts, all, categoryCarousels, firstSelectedCategory, masProductosInitialCursor, feedRpcFailed, feedResultado, cercaDeTiResultado, showGeoEmptyState, followingPosts, followedStoresData, noFollows, nearbyStores, comunidades, user: user ? { id: user.id } : null } };
}

/**
 * Lo que el inicio pinta. Es la misma forma que viaja como semilla desde
 * page.tsx y como respuesta de GET /api/session/home; el consumidor cliente
 * la importa solo como tipo, nunca el cargador (este modulo es server-only).
 */
export type HomeSessionValue = Awaited<ReturnType<typeof getHomeSession>>["value"];
