import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { mapCoverageRequestSchema, mapCoverageResultSchema, type MapCoverageRequest } from "@vicino/shared";
import { createClient } from "@/lib/supabase/server";
import { usuarioOInvitado } from "@/lib/session-auth";
import { enforce, getClientIp, readHeavyRateLimit } from "@/lib/rate-limit";
import { frenoEnMemoria } from "@/lib/freno-en-memoria";
import { isPublicationMapEnabled } from "@/lib/publication-map-feature";
import { decimalesRejillaAproximada } from "@/lib/geo/ubicacion-publica";

export const dynamic = "force-dynamic";
const localQuota = frenoEnMemoria({ tope: 60, ventanaMs: 60_000 });
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
function reply(body: unknown, status: number, extra = {}) {
  return NextResponse.json(body, { status, headers: { ...headers, ...extra } });
}

/**
 * search_map_publications_v4 (migración 20261108210000): el contrato de v3 sobre
 * el punto público autorizado de cada publicación. Las que el vendedor marcó
 * como exactas salen en su punto; las aproximadas, en la rejilla que decide el
 * servidor con `VICINO_MAPA_RPC` (ver decimalesRejillaAproximada): ~1 km sin la
 * variable, ~110 m con `v3`. La rejilla entra en la petición que arma ESTA
 * ruta; el cliente nunca la elige.
 *
 * Si v4 todavía no existe (migración sin aplicar o sin `notify pgrst`), cae a
 * la RPC de siempre para esa rejilla: v3 (~110 m) o v2 (~1 km). Ninguna de las
 * dos sabe de puntos exactos, así que en la caída el mapa se ve como antes.
 */
const RPC_V4 = "search_map_publications_v4";
const RPC_PRECISA = "search_map_publications_v3";
const RPC_BASE = "search_map_publications_v2";
type RpcCaida = typeof RPC_PRECISA | typeof RPC_BASE;
// PostgREST: la función no está en la caché de esquema (migración sin aplicar o
// sin `notify pgrst`). Cualquier otro error se devuelve tal cual.
const CODIGO_FUNCION_AUSENTE = "PGRST202";
let avisadaCaida = false;

async function consultarMapa(supabase: Awaited<ReturnType<typeof createClient>>, request: MapCoverageRequest) {
  // Se lee por petición, no al cargar el módulo (en Vercel un cambio de
  // variable exige redeploy de todos modos; en local basta reiniciar).
  const rejilla = decimalesRejillaAproximada(process.env.VICINO_MAPA_RPC);
  const actual = await supabase
    .rpc(RPC_V4, { p_request: { ...request, rejilla } })
    .abortSignal(AbortSignal.timeout(10_000));
  if (!actual.error || actual.error.code !== CODIGO_FUNCION_AUSENTE) return actual;
  const caida: RpcCaida = rejilla === 3 ? RPC_PRECISA : RPC_BASE;
  if (!avisadaCaida) {
    avisadaCaida = true;
    Sentry.captureMessage(`mapa: ${RPC_V4} no existe en la base; se usa ${caida}`, {
      level: "warning", tags: { surface: "map", rpc: RPC_V4 },
    });
  }
  return supabase.rpc(caida, { p_request: request }).abortSignal(AbortSignal.timeout(10_000));
}

/** Read-only POST: the viewer's search center stays out of URLs and caches. */
export async function POST(request: Request) {
  if (!isPublicationMapEnabled()) return reply({ error: "El mapa estará disponible pronto." }, 503);
  const ip = getClientIp(request.headers);
  if (!localQuota.permitir(`map:${ip}`) || !(await enforce(readHeavyRateLimit, `map:${ip}`)).ok) {
    return reply({ error: "Espera un minuto antes de actualizar el mapa." }, 429, { "Retry-After": "60" });
  }
  let input: unknown;
  try {
    // Also cap chunked bodies; Content-Length alone is not a bound.
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: "Consulta inválida." }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 8192) { await reader.cancel(); return reply({ error: "Consulta demasiado grande." }, 413); }
      chunks.push(chunk.value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    input = JSON.parse(new TextDecoder().decode(body));
  } catch { return reply({ error: "Consulta inválida." }, 400); }
  const parsed = mapCoverageRequestSchema.safeParse(input);
  if (!parsed.success) return reply({ error: "Revisa el área y los filtros seleccionados." }, 400);
  try {
    const supabase = await createClient();
    // Auth transport failures must not silently turn a blocked viewer into a guest.
    if (!await usuarioOInvitado(supabase)) return reply({ error: "Inicia sesión para abrir el mapa." }, 401);
    const { data, error } = await consultarMapa(supabase, parsed.data);
    if (error) return reply({ error: error.code === "22023" ? "La búsqueda cambió. Vuelve a la primera página." : "No pudimos cargar las publicaciones. Intenta de nuevo." }, error.code === "22023" ? 409 : 503);
    // Zod strips unknown fields at every output level, including private data.
    const result = mapCoverageResultSchema.safeParse(data);
    if (!result.success) return reply({ error: "No pudimos cargar las publicaciones. Intenta de nuevo." }, 503);
    return reply(result.data, 200);
  } catch { return reply({ error: "No pudimos cargar las publicaciones. Intenta de nuevo." }, 503); }
}
