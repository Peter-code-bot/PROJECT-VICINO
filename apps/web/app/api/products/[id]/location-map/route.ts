import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { productMapZone } from "@/lib/geo/product-map-zone";
import { productMapSnapshot } from "@/lib/geo/product-map-snapshot";
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
 * imagen por ficha y por tema, y el navegador la guarda un dia.
 */
const suelo = frenoEnMemoria({ tope: 20, ventanaMs: 60_000 });

const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
function unavailable(status: number, code: string, retryAfter?: string) {
  return Response.json({ code }, { status, headers: {
    ...privateHeaders, ...(retryAfter ? { "Retry-After": retryAfter } : {}),
  } });
}

/**
 * PNG de la zona aproximada (celda de ~1 km) de una publicacion.
 *
 * La imagen no lleva coordenadas exactas ni datos de nadie, pero se cachea
 * SOLO en el navegador (`private`): una CDN compartida seguiria sirviendo el
 * mapa de una publicacion que su vendedor acaba de ocultar. Un dia basta: la
 * URL lleva `v=updated_at`, asi que mover el pin cambia la URL y nunca se ve
 * un mapa viejo.
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
    // RLS enforces status, visibility, blocks and creator access.
    const { data: visible, error } = await supabase.from("products_services")
      .select("id, updated_at").eq("id", id.data).neq("estatus", "eliminado").maybeSingle();
    if (error) return unavailable(503, "temporarily_unavailable", "5");
    if (!visible) return unavailable(404, "not_available");
    // Privileged geometry read only after authorization; pin its version to reject a concurrent edit.
    const query = createAdminClient().from("products_services").select("ubicacion_geo")
      .eq("id", visible.id).neq("estatus", "eliminado");
    const { data: location, error: locationError } = await (visible.updated_at
      ? query.eq("updated_at", visible.updated_at) : query.is("updated_at", null)).maybeSingle();
    if (locationError) return unavailable(503, "temporarily_unavailable", "5");
    if (!location) return unavailable(409, "location_changed", "1");
    const zone = productMapZone(location.ubicacion_geo);
    if (!zone) return unavailable(404, "location_missing");
    const bytes = await productMapSnapshot(zone, new URL(request.url).searchParams.get("theme") === "dark");
    return new Response(bytes, {
      headers: { ...privateHeaders, "Cache-Control": "private, max-age=86400", "Content-Type": "image/png" },
    });
  } catch {
    // No adjuntar excepciones del proveedor: pueden incluir URL firmada o clave.
    Sentry.captureException(new Error("Product location map unavailable"), {
      tags: { action: "productLocationMap", productId: id.data },
    });
    return unavailable(503, "temporarily_unavailable", "5");
  }
}
