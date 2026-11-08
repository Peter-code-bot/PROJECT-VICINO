import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { usuarioOInvitado } from "@/lib/session-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { productMapZone } from "@/lib/geo/product-map-zone";
import { ENCUADRE_CERCANO, ENCUADRE_ZONA, productMapSnapshot } from "@/lib/geo/product-map-snapshot";
import { leerUbicacionPublica } from "@/lib/geo/ubicacion-publica-servidor";
import { decimalesRejillaAproximada } from "@/lib/geo/ubicacion-publica";
import { enforce, getClientIp, productMapRateLimit } from "@/lib/rate-limit";
import { frenoEnMemoria } from "@/lib/freno-en-memoria";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Suelo que existe SIN Upstash.
 *
 * Cada peticion que pasa el filtro cuesta una consulta con service_role y un
 * snapshot firmado de Apple Maps, que se cobra por llamada. En produccion los
 * limitadores compartidos son hoy un no-op (faltan las credenciales), asi que
 * un bucle por los ids publicos del feed abriria una factura. Este contador es
 * por instancia del proceso, no global: no sustituye a la cuota de Upstash,
 * que sigue delante, pero la acota mientras no exista.
 *
 * 20 por minuto e IP es holgado para alguien abriendo fichas a mano: una
 * imagen por ficha y por tema; las vistas siguientes son 304 sin Apple.
 */
const suelo = frenoEnMemoria({ tope: 20, ventanaMs: 60_000 });

const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
function unavailable(status: number, code: string, retryAfter?: string) {
  return Response.json({ code }, { status, headers: {
    ...privateHeaders, ...(retryAfter ? { "Retry-After": retryAfter } : {}),
  } });
}

/**
 * PNG del dato publico autorizado de una publicacion: el punto exacto que eligio
 * su vendedor o la celda aproximada (~1 km, o ~110 m con VICINO_MAPA_RPC=v3),
 * calculado por la base igual que en el mapa (ubicacion_publica_de_publicacion).
 *
 * La imagen no lleva coordenadas en la URL ni datos de nadie, y se cachea SOLO
 * en el navegador (`private`): una CDN compartida seguiria sirviendo el mapa de
 * una publicacion que su vendedor acaba de ocultar. `no-cache` + ETag hace que
 * cada vista vuelva aqui (RLS, bloqueos, revision) y reciba un 304 sin pedir
 * otra imagen a Apple si nada cambio; mover el pin o pasar de exacta a
 * aproximada cambia la revision y deja de servirse la imagen anterior. La URL
 * lleva `v=<revision>`; editar precio o fotos ya no la cambia.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return unavailable(404, "not_available");
  try {
    const ip = getClientIp(request.headers);
    if (!suelo.permitir(ip)) return unavailable(429, "rate_limited", "60");
    const limit = await enforce(productMapRateLimit, `product-map:${ip}`);
    if (!limit.ok) return unavailable(429, "rate_limited", "60");
    const supabase = await createClient();
    if (!await usuarioOInvitado(supabase)) return unavailable(401, "authentication_required");
    // RLS enforces status, visibility, blocks and creator access.
    const { data: visible, error } = await supabase.from("products_services")
      .select("id, updated_at").eq("id", id.data).neq("estatus", "eliminado").maybeSingle();
    if (error) return unavailable(503, "temporarily_unavailable", "5");
    if (!visible) return unavailable(404, "not_available");
    const dark = new URL(request.url).searchParams.get("theme") === "dark";
    const admin = createAdminClient();
    // Privileged read only after authorization.
    const lectura = await leerUbicacionPublica(admin, visible.id, decimalesRejillaAproximada(process.env.VICINO_MAPA_RPC));
    if (lectura.estado === "sin-funcion") return imagenSinMigracion(admin, visible, dark);
    if (lectura.estado === "error") return unavailable(503, "temporarily_unavailable", "5");
    const { ubicacion } = lectura;
    if (!ubicacion.punto) return unavailable(404, "location_missing");
    // Ni coordenadas ni nada derivado de ellas: un hash de una celda de 110 m
    // se puede forzar por diccionario. Solo la revision (secuencial) y el modo.
    const etag = `"u${ubicacion.revision}-${ubicacion.precision}-${ubicacion.decimales}-${dark ? "d" : "l"}"`;
    const cache = { ...privateHeaders, "Cache-Control": "private, no-cache", ETag: etag };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: cache });
    const encuadre = ubicacion.precision === "exacta" || ubicacion.decimales === 3 ? ENCUADRE_CERCANO : ENCUADRE_ZONA;
    const bytes = await productMapSnapshot(ubicacion.punto, dark, encuadre);
    return new Response(bytes, { headers: { ...cache, "Content-Type": "image/png" } });
  } catch {
    // No adjuntar excepciones del proveedor: pueden incluir URL firmada o clave.
    Sentry.captureException(new Error("Product location map unavailable"), {
      tags: { action: "productLocationMap", productId: id.data },
    });
    return unavailable(503, "temporarily_unavailable", "5");
  }
}

/**
 * Mientras la migracion 20261108210000 no este aplicada (el preview de la rama
 * apunta a la base de produccion): el camino de antes, celda de ~1 km desde
 * ubicacion_geo, fijado al updated_at ya autorizado para rechazar una edicion
 * concurrente. Se borra cuando la migracion este en produccion.
 */
async function imagenSinMigracion(
  admin: ReturnType<typeof createAdminClient>,
  visible: { id: string; updated_at: string | null },
  dark: boolean,
) {
  const query = admin.from("products_services").select("ubicacion_geo").eq("id", visible.id).neq("estatus", "eliminado");
  const { data: location, error: locationError } = await (visible.updated_at
    ? query.eq("updated_at", visible.updated_at) : query.is("updated_at", null)).maybeSingle();
  if (locationError) return unavailable(503, "temporarily_unavailable", "5");
  if (!location) return unavailable(409, "location_changed", "1");
  const zone = productMapZone(location.ubicacion_geo);
  if (!zone) return unavailable(404, "location_missing");
  const bytes = await productMapSnapshot(zone, dark);
  return new Response(bytes, {
    headers: { ...privateHeaders, "Cache-Control": "private, max-age=86400", "Content-Type": "image/png" },
  });
}
