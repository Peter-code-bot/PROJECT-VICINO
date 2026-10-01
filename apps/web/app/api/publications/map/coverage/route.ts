import { NextResponse } from "next/server";
import { mapCoverageRequestSchema, mapCoverageResultSchema } from "@vicino/shared";
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
    await usuarioOInvitado(supabase);
    const { data, error } = await supabase.rpc("search_map_publications_v2", { p_request: parsed.data })
      .abortSignal(AbortSignal.timeout(10_000));
    if (error) return reply({ error: error.code === "22023" ? "La búsqueda cambió. Vuelve a la primera página." : "No pudimos cargar las publicaciones. Intenta de nuevo." }, error.code === "22023" ? 409 : 503);
    // Zod strips unknown fields at every output level, including private data.
    const result = mapCoverageResultSchema.safeParse(data);
    if (!result.success) return reply({ error: "No pudimos cargar las publicaciones. Intenta de nuevo." }, 503);
    return reply(result.data, 200);
  } catch { return reply({ error: "No pudimos cargar las publicaciones. Intenta de nuevo." }, 503); }
}
