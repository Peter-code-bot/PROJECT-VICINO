/**
 * Cliente de Supabase para pruebas: supabase-js DE VERDAD con un `fetch` que
 * contesta como PostgREST.
 *
 * Por que no un objeto con .from().select()... inventado: los fallos que esto
 * vigila viven justo en supabase-js. `.single()` con 0 filas no devuelve null:
 * PostgREST contesta 406 PGRST116 ("Cannot coerce the result to a single JSON
 * object") y, con `.throwOnError()`, postgrest-js LANZA un PostgrestError. Un
 * doble que devolviera `{ data: null }` daria por bueno exactamente el codigo
 * que fallaba en produccion.
 *
 * Lo que contesta el fetch:
 *   - GET /rest/v1/<tabla>: las filas configuradas (respeta `limit`, NO aplica
 *     los filtros: la prueba configura las filas que la consulta devolveria).
 *     Con Accept de objeto (lo que pide `.single()`), una fila o 406 PGRST116.
 *   - HEAD: el recuento en content-range.
 *   - POST /rest/v1/rpc/<nombre>: lo que diga el manejador configurado.
 * Nunca sale a la red.
 */
import { createClient } from "@supabase/supabase-js";

export type Fila = Record<string, unknown>;
export interface RespuestaFalsa {
  status: number;
  body: unknown;
}

export interface OpcionesSupabaseFalso {
  /** null = invitado (auth.getUser devuelve AuthSessionMissingError). */
  usuario: { id: string; email?: string } | null;
  tablas?: Record<string, Fila[]>;
  rpc?: Record<string, (cuerpo: unknown) => RespuestaFalsa>;
}

export interface Peticion {
  metodo: string;
  recurso: string;
  url: string;
}

const OBJETO = "application/vnd.pgrst.object+json";

function respuesta(status: number, body: unknown, cabeceras: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cabeceras },
  });
}

/** El error que manda PostgREST 12 cuando `.single()` no recibe exactamente una fila. */
export function errorNoEsUnaFila(filas: number) {
  return {
    code: "PGRST116",
    details: `The result contains ${filas} rows`,
    hint: null,
    message: "Cannot coerce the result to a single JSON object",
  };
}

export function crearSupabaseFalso(opciones: OpcionesSupabaseFalso) {
  const peticiones: Peticion[] = [];

  const fetchFalso = async (entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
    const metodo = (init?.method ?? "GET").toUpperCase();
    const cabeceras = new Headers(init?.headers);
    const recurso = url.pathname.replace(/^\/rest\/v1\//, "");
    peticiones.push({ metodo, recurso, url: url.toString() });

    if (recurso.startsWith("rpc/")) {
      const manejador = opciones.rpc?.[recurso.slice(4)];
      if (!manejador) return respuesta(404, { code: "PGRST202", message: `rpc ${recurso} sin manejador en la prueba` });
      const cuerpo = typeof init?.body === "string" && init.body ? JSON.parse(init.body) : undefined;
      const r = manejador(cuerpo);
      return respuesta(r.status, r.body);
    }

    const todas = opciones.tablas?.[recurso] ?? [];
    const limite = Number(url.searchParams.get("limit") ?? Number.NaN);
    const filas = Number.isInteger(limite) ? todas.slice(0, limite) : todas;
    const rango = { "Content-Range": `0-${Math.max(filas.length - 1, 0)}/${filas.length}` };

    if (metodo === "HEAD") return respuesta(200, undefined, rango);
    if (cabeceras.get("Accept") === OBJETO) {
      return filas.length === 1 ? respuesta(200, filas[0], rango) : respuesta(406, errorNoEsUnaFila(filas.length));
    }
    return respuesta(200, filas, rango);
  };

  const cliente = createClient("https://supabase-falso.invalid", "anon-de-prueba", {
    global: { fetch: fetchFalso },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const usuario = opciones.usuario;
  return {
    peticiones,
    cliente: {
      from: cliente.from.bind(cliente),
      rpc: cliente.rpc.bind(cliente),
      auth: {
        getUser: async () =>
          usuario
            ? { data: { user: usuario }, error: null }
            : {
                data: { user: null },
                error: Object.assign(new Error("Auth session missing!"), { name: "AuthSessionMissingError", status: 400 }),
              },
      },
    },
  };
}
