"use server";

import { createClient } from "@/lib/supabase/server";
import type { FeedProduct } from "@/types/feed";
import { parseFeedCursor, makeFeedCursor } from "@/lib/feed-cursor";
import { enforce, getClientIp, readHeavyRateLimit } from "@/lib/rate-limit";
import { headers, cookies } from "next/headers";
import { parseRadiusCookie } from "@/lib/geo/radius";

/**
 * A5.2: cursor-based load-more for the home "Mas productos" flat section.
 *
 * Returns products strictly OLDER than `cursor` (ISO timestamp of the
 * boundary item -- typically the oldest of the initial 150 fetched by
 * the home Server Component), ordered DESC so the call-site can append
 * directly. `nextCursor` is the OLDEST returned `created_at` (the last
 * item, since DESC) when the page filled; null otherwise.
 *
 * The SELECT shape mirrors the initial 150 fetch in
 * apps/web/app/(marketplace)/page.tsx so the result feeds ProductCard
 * via the same normalizeCardCategories helper.
 *
 * Out of scope by design:
 *  - No filtering by user / category here -- this is the global Para ti
 *    flat feed. The carousels above already do the grouping work on the
 *    initial 150; pages 2..N are intentionally flat and ordered by
 *    recency. See proposal.md Constraint and design.md Option C.
 *
 * SI lleva cuota por IP, y este docstring afirmaba lo contrario hasta el
 * 12-sep-2026 -- "No rate limit guard -- this is a READ" -- cuatro lineas por
 * encima del guard que si existia. Que sea una lectura no la deja fuera de la
 * cuota: lo caro aqui no es exponer el dato (el catalogo ya es publico) sino
 * la CPU y el egress de repetir la consulta a ritmo de script.
 */
export async function getMoreFeedProducts(
  cursor: string,
  limit: number = 30,
  lat?: number,
  lng?: number,
): Promise<{
  items: FeedProduct[];
  nextCursor: string | null;
  error?: string;
}> {
  const parsedCursor = parseFeedCursor(cursor);
  if (!parsedCursor.ok) {
    return { items: [], nextCursor: null, error: "Cursor invalido" };
  }

  // Cuota de lectura pesada por IP. Ahora corta.
  //
  // Hasta el 12-sep-2026 este bloque DETECTABA el exceso y seguia: un
  // captureMessage y derecho a la consulta. Con eso el limitador era
  // decorativo. De los 49 guards de enforce() que hay en apps/web, este era
  // el UNICO que no cortaba; el hermano mas cercano, getNearbyProducts en
  // lib/geo/actions.ts, usa este mismo limitador sobre otra lectura publica no
  // autenticada y devuelve el error.
  //
  // Ojo con lo que significa "el mismo limitador": readHeavyRateLimit es UN
  // objeto Ratelimit, pero Upstash forma la clave con prefijo + identificador,
  // y los identificadores son distintos -- aqui `feed:`, alli `read:`. O sea
  // DOS cubetas independientes de 60/min por IP, no una compartida: una misma
  // IP puede gastar 60 aqui y otras 60 en los cercanos. Es a proposito, para
  // que raspar el feed no deje sin feed de proximidad a quien comparte salida
  // NAT, pero el techo real de lecturas pesadas por IP es 120/min, no 60.
  //
  // El "fail-open para no romper ventas" que justificaba dejar pasar ya lo
  // hace enforce() por dentro, y dos veces: sin credenciales de Upstash
  // devuelve ok, y ante un error de red contra Upstash tambien. Lo unico que
  // llega aqui como ok:false es un exceso REAL de peticiones, que es
  // justamente el caso que no hay que dejar pasar.
  //
  // Se fue tambien el Promise.race contra un timeout de 800 ms. No daba
  // tolerancia a FALLOS (ver parrafo anterior) sino a LENTITUD, y de paso
  // descartaba un ok:false legitimo que llegara en el milisegundo 801; su
  // setTimeout ademas quedaba colgado aunque la carrera la ganase Upstash.
  //
  // Lo que SI se pierde con el race es el unico techo de latencia que habia
  // hacia Upstash: Redis.fromEnv() no lleva timeout propio, asi que un Upstash
  // lento -- lento, no caido, que ese caso ya lo cubre el fail-open de
  // enforce() -- se suma ahora entero al tiempo de la accion. Se acepta: un
  // techo de latencia que resuelve "pasa" es un fail-open por lentitud, que es
  // la puerta que este cambio venia a cerrar. Si la p99 de Upstash se nota en
  // el scroll, el sitio de arreglarlo es el cliente de Redis, no aqui.
  //
  // Y se fue el try/catch: ningun otro de los 49 guards envuelve esto, y
  // enforce() no lanza. headers() en teoria si podria, y antes quedaba tragado
  // en silencio; ahora sube, y lo absorbe el try/catch de loadMore en
  // use-infinite-cursor.ts, que pinta "No se pudo cargar mas contenido".
  //
  // Ya no se manda un evento a Sentry por peticion bloqueada. El escenario
  // que este guard existe para frenar --un script raspando-- es exactamente
  // el que habria inundado Sentry; el volumen vive en las analytics de
  // Upstash, que es donde no cuesta cuota de errores.
  //
  // LO QUE ESTO NO CUBRE: search_nearby_products_v4 es SECURITY DEFINER con
  // GRANT EXECUTE a anon, y la anon key viaja en el bundle del cliente. Quien
  // quiera raspar el catalogo llama a /rest/v1/rpc/search_nearby_products_v4
  // contra Supabase y no pasa por aqui jamas. Esta cuota cierra la puerta de
  // la aplicacion; la de PostgREST sigue abierta hasta que se revoque ese
  // EXECUTE y el servidor llame con service_role.
  //
  // 60/min por IP (rl:read, en lib/rate-limit.ts) = 1.800 productos por minuto
  // desde una sola IP. Ninguna persona se acerca; una IP compartida -- CGNAT
  // movil, un cafe, una oficina -- si puede. Si aparecen falsos positivos, el
  // arreglo es subir el tope de ese bucket, no volver a dejar pasar.
  const ip = getClientIp(await headers());
  const rate = await enforce(readHeavyRateLimit, `feed:${ip}`);
  if (!rate.ok) {
    return { items: [], nextCursor: null, error: rate.error };
  }

  // CODEX H2 fix: clamp limit. The default is 30; cap at 50 so a
  // direct caller cannot request thousands of rows with joined
  // profiles + product_categories embeds.
  const safeLimit = Math.min(Math.max(1, limit), 50);

  const supabase = await createClient();

  let data = null;
  let error = null;

  if (lat !== undefined && lng !== undefined) {
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return { items: [], nextCursor: null, error: "Coordenadas inválidas" };
    }
    // El radio sale de la MISMA cookie que usa el feed inicial. Estaba
    // escrito a mano en 50.000 mientras la primera pagina usaba el radio del
    // usuario, asi que al seguir bajando aparecian publicaciones de hasta 50 km
    // que la primera pagina habia excluido a proposito. Nadie lo veia como un
    // fallo: parecia que "cargaban mas cosas".
    const cookieStore = await cookies();
    const radioDelUsuario = parseRadiusCookie(
      cookieStore.get("vicino_radius")?.value,
    );

    const res = await supabase.rpc("search_nearby_products_v4", {
      user_lat: lat,
      user_lng: lng,
      radius_meters: radioDelUsuario,
      cursor_time: parsedCursor.cursor.createdAt,
      cursor_id: parsedCursor.cursor.id,
      result_limit: safeLimit,
      sort_by_distance: false,
    });
    data = res.data;
    error = res.error;
  } else {
    // Fallback no-geo
    const res = await supabase
      .from("products_services")
      .select(`
        id, titulo, precio, imagen_principal, categoria, slug, created_at, precio_negociable, modo_precio,
        profiles!inner(nombre, trust_level, average_rating, reviews_count),
        product_categories(is_primary, categories(slug, nombre))
      `)
      .eq("estatus", "disponible")
      .or(`created_at.lt.${parsedCursor.cursor.createdAt},and(created_at.eq.${parsedCursor.cursor.createdAt},id.lt.${parsedCursor.cursor.id})`)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(safeLimit);
    data = res.data;
    error = res.error;
  }

  if (error) return { items: [], nextCursor: null, error: error.message };

  const items = (data ?? []) as FeedProduct[];

  const nextCursor =
    items.length === safeLimit 
      ? makeFeedCursor(items[items.length - 1]!.created_at, items[items.length - 1]!.id)
      : null;
  return { items, nextCursor };
}
