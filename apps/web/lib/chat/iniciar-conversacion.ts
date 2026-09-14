import { createHash } from "node:crypto";

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

/** Ventana de la clave de respaldo, en milisegundos. Una hora. */
const VENTANA_CLAVE_HEREDADA_MS = 60 * 60 * 1000;

/**
 * Clave de idempotencia DERIVADA, para enlaces antiguos.
 *
 * El contrato exige clave cuando la intencion es de compra, y los enlaces que
 * ya estan por ahi —un WhatsApp reenviado, una pestana abierta desde ayer, un
 * marcador— no la llevan: nacieron antes de que existiera. Rechazarlos seria
 * romper el momento de mayor intencion de compra de la app por un parametro
 * que el comprador nunca vio; dejarlos pasar sin clave devolveria justo el
 * duplicado que este contrato viene a cerrar.
 *
 * La salida es determinista sobre (comprador, vendedor, producto, hora), asi
 * que un F5 o un doble toque dentro de la misma hora reusan la clave y no
 * duplican. Pasada la hora, la clave cambia y un aviso nuevo vuelve a ser
 * posible: sin ese corte, un enlace viejo quedaria inservible para siempre
 * despues del primer uso.
 *
 * Es una red de seguridad, no el camino principal. Los CTA de la ficha mandan
 * `k` y consiguen idempotencia exacta, sin depender del reloj.
 *
 * `ahoraMs` se inyecta para poder probar el borde de la ventana.
 */
export function claveHeredada(
  compradorId: string,
  vendedorId: string,
  productoId: string,
  ahoraMs: number = Date.now(),
): string {
  const ventana = Math.floor(ahoraMs / VENTANA_CLAVE_HEREDADA_MS);
  const material = `vicino:intencion-heredada:${compradorId}:${vendedorId}:${productoId}:${ventana}`;
  const h = createHash("sha256").update(material).digest();
  // Formato UUID v8 (variante RFC 4122): la columna es `uuid`, asi que el
  // valor tiene que ser un UUID valido, no un hash cualquiera. Se marcan los
  // bits de version y variante para que ningun generador aleatorio pueda
  // producir por accidente una de estas claves.
  const b = Buffer.from(h.subarray(0, 16));
  b.writeUInt8((b.readUInt8(6) & 0x0f) | 0x80, 6); // version 8
  b.writeUInt8((b.readUInt8(8) & 0x3f) | 0x80, 8); // variante RFC 4122
  const hex = b.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
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
