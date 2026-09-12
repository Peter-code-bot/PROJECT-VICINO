export const LIMITE_LECTURA_MS = 15_000;

// Manifiesto de solo lectura: cuerpo efectivo STABLE de 20260826400000,
// firma antigua retirada en 20260826410000. Solo SELECT, funciones integradas,
// auth.uid y PostGIS; no mutaciones. Las demas RPC quedan excluidas.
const RPC_LECTURA = new Set(["/rest/v1/rpc/search_nearby_products_v4"]);

/** Adaptador PostgREST: bufferiza JSON, no sirve para Storage ni streaming.
 * El presupuesto incluye cuerpo y cabeceras, pero no la obtencion previa del
 * token por Supabase. Abort no implica rollback; no limita escrituras.
 */
export function fetchConLimite(original: typeof fetch, supabaseUrl: string): typeof fetch {
  const origin = new URL(supabaseUrl).origin;
  return async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(request ? request.url : String(input), origin);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const selected = url.origin === origin && (
      ((method === "GET" || method === "HEAD") && /^\/rest\/v1\/[^/]+$/.test(url.pathname) && url.pathname !== "/rest/v1/rpc") ||
      ((method === "GET" || method === "HEAD" || method === "POST") && RPC_LECTURA.has(url.pathname))
    );
    if (!selected) return original(input, init);

    const caller = init?.signal !== undefined ? init.signal : request?.signal;
    if (caller?.aborted) throw caller.reason;
    const controller = new AbortController();
    const cancel = () => controller.abort(caller?.reason);
    caller?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => {
      controller.abort(new DOMException("VICINO_READ_TIMEOUT", "TimeoutError"));
    }, LIMITE_LECTURA_MS);
    try {
      const response = await original(input, { ...init, signal: controller.signal });
      const bytes = await response.arrayBuffer();
      controller.signal.throwIfAborted();
      return new Response(method === "HEAD" || [204, 205, 304].includes(response.status) ? null : bytes, {
        status: response.status, statusText: response.statusText, headers: response.headers,
      });
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw error;
    } finally {
      clearTimeout(timer);
      caller?.removeEventListener("abort", cancel);
    }
  };
}
