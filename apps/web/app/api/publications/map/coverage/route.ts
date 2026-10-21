import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { mapCoverageRequestSchema, mapCoverageResultSchema, type MapCoverageRequest } from "@vicino/shared";
import { createClient } from "@/lib/supabase/server";
import { usuarioOInvitado } from "@/lib/session-auth";
import { enforce, getClientIp, readHeavyRateLimit } from "@/lib/rate-limit";
import { frenoEnMemoria } from "@/lib/freno-en-memoria";
import { isPublicationMapEnabled } from "@/lib/publication-map-feature";

export const dynamic = "force-dynamic";
const localQuota = frenoEnMemoria({ tope: 60, ventanaMs: 60_000 });
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
function reply(body: unknown, status: number, extra = {}) {
  return NextResponse.json(body, { status, headers: { ...headers, ...extra } });
}

/**
 * Proyección pública v2 (celdas de ~110 m, migración 20261020150000) con caída
 * a la v1 (~1 km). El tipo generado de la base aún no conoce v3 hasta que la
 * migración se aplique y se regeneren los tipos (node scripts/gen-types.mjs);
 * las dos funciones comparten firma y contrato, así que el nombre se tipa con
 * el de v2 en UN solo sitio. `projection_version` en la respuesta le dice al
 * cliente en qué unidades vienen las celdas.
 */
const RPC_ACTUAL = "search_map_publications_v3";
const RPC_RESPALDO = "search_map_publications_v2";
type RpcMapa = typeof RPC_RESPALDO;
// PostgREST: la función no está en la caché de esquema (migración sin aplicar o
// sin `notify pgrst`). Cualquier otro error se devuelve tal cual.
const CODIGO_FUNCION_AUSENTE = "PGRST202";
let avisadaCaida = false;

/**
 * Camino de vuelta sin tocar la base ni el código: `VICINO_MAPA_RPC=v2` en el
 * entorno (Vercel) devuelve el mapa a la proyección de ~1 km. Se lee por
 * petición, no al cargar el módulo, para que un cambio de variable baste.
 */
function rpcPreferida(): string {
  return process.env.VICINO_MAPA_RPC === "v2" ? RPC_RESPALDO : RPC_ACTUAL;
}

async function consultarMapa(supabase: Awaited<ReturnType<typeof createClient>>, request: MapCoverageRequest) {
  const llamar = (nombre: string) =>
    supabase.rpc(nombre as RpcMapa, { p_request: request }).abortSignal(AbortSignal.timeout(10_000));
  const preferida = rpcPreferida();
  const actual = await llamar(preferida);
  if (preferida === RPC_RESPALDO || !actual.error || actual.error.code !== CODIGO_FUNCION_AUSENTE) return actual;
  if (!avisadaCaida) {
    avisadaCaida = true;
    Sentry.captureMessage("mapa: search_map_publications_v3 no existe en la base; se usa v2 (~1 km)", {
      level: "warning", tags: { surface: "map", rpc: RPC_ACTUAL },
    });
  }
  return llamar(RPC_RESPALDO);
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
