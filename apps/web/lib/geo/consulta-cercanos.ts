import { publicProfileName } from "@vicino/shared";
/**
 * La consulta de productos cercanos, compartida por las dos superficies que la
 * necesitan: la server action del cliente y el render del servidor del home.
 *
 * ESTE ARCHIVO NO LLEVA "use server", Y ES LO IMPORTANTE DE QUE EXISTA.
 *
 * En un archivo con "use server" TODA exportacion se convierte en un endpoint
 * HTTP invocable desde fuera. Poner aqui la version sin rate limit —que es
 * justo lo que el render del servidor necesita, porque ahi limitar por IP
 * gastaria el presupuesto del propio usuario en cada carga de pagina— habria
 * publicado una consulta pesada de proximidad sin ninguna proteccion. Al vivir
 * en un modulo normal, `consultarProductosCercanos` solo se puede llamar desde
 * codigo de servidor que la importe, nunca por la red.
 *
 * El rate limit sigue estando donde tiene que estar: en la server action que la
 * envuelve (lib/geo/actions.ts), que es la que si es alcanzable desde el
 * navegador.
 */
import { createClient } from "@/lib/supabase/server";
import { fuzzCoordinate, fuzzDistance } from "./fuzz";

/**
 * Lectores para el JSONB que devuelve el RPC del feed.
 *
 * Las columnas `profiles` y `product_categories` de search_nearby_products_v4
 * son JSONB construido dentro de la funcion, asi que el codegen las declara
 * como `Json`: puede ser objeto, array, cadena, numero o nulo. Leerles un
 * campo directamente exige afirmar una forma que la base no garantiza.
 */
function leerObjeto(valor: unknown): Record<string, unknown> | null {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) return null;
  return valor as Record<string, unknown>;
}

function leerTexto(obj: Record<string, unknown> | null, campo: string): string | null {
  const v = obj?.[campo];
  return typeof v === "string" && v !== "" ? v : null;
}

function leerNumero(obj: Record<string, unknown> | null, campo: string): number | null {
  const v = obj?.[campo];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  // Postgres devuelve numeric como cadena en JSON; average_rating es numeric.
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export interface NearbyProduct {
  id: string;
  titulo: string;
  slug: string;
  precio: number | null;
  modo_precio: string | null;
  imagen_principal: string | null;
  categoria: string;
  tipo_entrega: string;
  distance_meters: number;
  vendedor_nombre: string;
  vendedor_trust: string;
  vendedor_rating: number;
  vendedor_reviews: number;
  /**
   * Los badges de categoria, tal como los devuelve el RPC: un JSONB con
   * {is_primary, categories:{slug, nombre}} por fila.
   *
   * Va como `unknown` y no como un tipo afirmado porque en la funcion es un
   * jsonb construido a mano, asi que el codegen lo declara `Json` — puede ser
   * objeto, array, cadena o nulo. Quien lo pinte lo estrecha; es el mismo
   * criterio que se sigue con `profiles`.
   */
  product_categories: unknown;
}

export interface ConsultaCercanosParams {
  lat: number;
  lng: number;
  radiusMeters?: number;
  limit?: number;
}

export interface ConsultaCercanosResult {
  products: NearbyProduct[];
  error?: string;
}

export async function consultarProductosCercanos(
  params: ConsultaCercanosParams,
): Promise<ConsultaCercanosResult> {
  if (!Number.isFinite(params.lat) || !Number.isFinite(params.lng)) {
    return { products: [], error: "Coordenadas inválidas" };
  }
  if (Math.abs(params.lat) > 90 || Math.abs(params.lng) > 180) {
    return { products: [], error: "Coordenadas fuera de rango" };
  }

  const radius = Math.min(Math.max(params.radiusMeters ?? 5000, 100), 50_000);
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);

  // Snap inputs to a 100m grid before the proximity filter runs.
  // Without this, an attacker can binary-search the exact distance to a
  // known listing by varying radiusMeters / lat / lng across calls and
  // observing inclusion in the result set — bucketing the output alone
  // does not stop that probe attack.
  //
  // The radius is rounded UP (ceil) and inflated by one extra 100m bucket
  // so that snapping the caller's coords (up to ~80m drift in this region)
  // cannot exclude listings that were inside the originally requested
  // radius. Probe granularity is still 100m, but no false negatives.
  const snapped = fuzzCoordinate(params.lat, params.lng);
  const snappedRadius = Math.ceil(radius / 100) * 100 + 100;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_nearby_products_v4", {
    user_lat: snapped.lat,
    user_lng: snapped.lng,
    radius_meters: snappedRadius,
    result_limit: limit,
    sort_by_distance: true,
  });

  if (error) return { products: [], error: error.message };

  // Mapeamos el output de V4 (profiles JSONB) a NearbyProduct.
  //
  // Aqui habia un `(p: any)`. El tipo generado para este RPC existe y es
  // exacto, asi que el any no simplificaba nada: tapaba. Si la funcion cambia
  // una columna de nombre, con `any` esto sigue compilando y el feed se pinta
  // con el campo vacio, que es como se pierde media hora buscando en el sitio
  // equivocado. Con el tipo generado deja de compilar, que es lo que se quiere.
  const products: NearbyProduct[] = (data ?? []).map((p) => {
    // `profiles` viene declarado como Json, porque en la funcion es un JSONB
    // construido a mano. Json puede ser objeto, array, cadena o nulo, asi que
    // se comprueba antes de leerle campos en vez de afirmar que es un objeto.
    const vendedor = leerObjeto(p.profiles);
    return {
      id: p.id,
      titulo: p.titulo,
      slug: p.slug,
      precio: p.precio,
      modo_precio: p.modo_precio ?? null,
      imagen_principal: p.imagen_principal,
      categoria: p.categoria,
      tipo_entrega: p.tipo_entrega,
      distance_meters: fuzzDistance(p.distance_meters),
      vendedor_nombre: publicProfileName(vendedor, "Vendedor"),
      vendedor_trust: leerTexto(vendedor, "trust_level") ?? "new",
      vendedor_rating: leerNumero(vendedor, "average_rating") ?? 0,
      vendedor_reviews: leerNumero(vendedor, "reviews_count") ?? 0,
      // El RPC ya trae esto en cada fila y hasta hace poco se tiraba aqui, en
      // el mapeo. No costaba una consulta de mas: costaba una consulta que ya
      // se pagaba y cuyo resultado se descartaba antes de llegar a la pantalla.
      product_categories: p.product_categories,
    };
  });

  return { products };
}
