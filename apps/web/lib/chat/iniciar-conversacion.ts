import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * Envoltorio de la RPC iniciar_conversacion (20260912300000).
 *
 * Nacio con un `as unknown as` porque database.types.ts se genera desde
 * produccion y la RPC no estaba aplicada todavia. Ya lo esta (ledger 162), los
 * tipos se regeneraron y el cast desaparecio: la llamada es directa y tipada.
 *
 * Lo que el envoltorio SIGUE aportando es la salida: la RPC devuelve `Json`,
 * asi que el codegen no puede prometer la forma del jsonb. `esResultado`
 * comprueba los cinco campos antes de que nadie los lea, y por eso este
 * archivo no se puede reducir a una linea.
 */
export type IntencionConversacion = "contacto" | "compra";

export interface IniciarConversacionArgs {
  p_vendedor_id: string;
  p_producto_id?: string;
  p_intencion?: IntencionConversacion;
  p_clave?: string;
}

/** Forma exacta del jsonb que devuelve la RPC. */
export interface IniciarConversacionResultado {
  chat_id: string;
  message_id: string | null;
  chat_nuevo: boolean;
  mensaje_nuevo: boolean;
  repetida: boolean;
}

export async function llamarIniciarConversacion(
  supabase: SupabaseClient<Database>,
  args: IniciarConversacionArgs,
): Promise<{ data: IniciarConversacionResultado | null; error: PostgrestError | null }> {
  // `undefined` hace que la clave no viaje en el JSON y Postgres aplique el
  // DEFAULT del argumento (mismo criterio que getOrCreateChat con p_producto_id).
  // NO `null`: el codegen de Supabase no declara nulables los argumentos de
  // RPC, asi que un null explicito viaja como null y no como "ausente".
  const { data, error } = await supabase.rpc("iniciar_conversacion", {
    p_vendedor_id: args.p_vendedor_id,
    p_producto_id: args.p_producto_id ?? undefined,
    p_intencion: args.p_intencion ?? "contacto",
    p_clave: args.p_clave ?? undefined,
  });
  if (error) return { data: null, error };
  return { data: esResultado(data) ? data : null, error: null };
}

function esResultado(v: unknown): v is IniciarConversacionResultado {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.chat_id === "string" &&
    (o.message_id === null || typeof o.message_id === "string") &&
    typeof o.chat_nuevo === "boolean" &&
    typeof o.mensaje_nuevo === "boolean" &&
    typeof o.repetida === "boolean"
  );
}

/**
 * Traduce los ERRCODE que la RPC levanta a proposito. Cualquier otro codigo es
 * un fallo de verdad: se registra en Sentry desde la accion y aqui solo se
 * devuelve un texto generico, nunca el mensaje crudo del motor.
 */
export function traducirErrorIniciarConversacion(error: PostgrestError): string {
  switch (error.code) {
    case "42501":
      return error.message.includes("suspendida")
        ? "Tu cuenta está suspendida."
        : "No tienes permiso para iniciar esta conversación.";
    case "22023":
      return "Datos inválidos para iniciar la conversación.";
    case "PT404":
      return "Este vendedor o producto ya no está disponible.";
    case "23514":
      return "Demasiadas intenciones de compra hoy. Inténtalo mañana.";
    case "PT409":
      // La misma clave con otro vendedor u otro producto: error del cliente.
      // Un 23505 real (unique_violation del motor) NO cae aqui: es un fallo y
      // la accion lo manda a Sentry con el texto generico.
      return "Esta operación ya se registró con otros datos. Vuelve a la publicación e inténtalo de nuevo.";
    default:
      return "No se pudo abrir la conversación. Inténtalo de nuevo en un momento.";
  }
}
