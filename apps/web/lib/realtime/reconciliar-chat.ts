import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

export type Mensaje = Pick<Database["public"]["Tables"]["messages"]["Row"],
  "id" | "chat_id" | "autor_id" | "texto" | "attachments" | "created_at" | "leido_por_comprador" | "leido_por_vendedor">;
export const CAMPOS_MENSAJE = "id, chat_id, autor_id, texto, attachments, created_at, leido_por_comprador, leido_por_vendedor";
export const CAMPOS_VENTA = "id, product_id, buyer_id, seller_id, precio_acordado, cantidad, metodo_pago, tipo_entrega, status, initiated_by, buyer_confirmed, seller_confirmed, created_at, products_services(titulo)";
export type Cursor = { created_at: string; id: string };
export type Intervalo = { desde: Cursor; hasta: Cursor };

// ISO de Postgres puede usar +00:00; Date pierde microsegundos. Normalizar a
// UTC con seis decimales conserva el orden del cursor sin truncar precision.
function fechaOrden(value: string) {
  const match = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new Error("VICINO_CHAT_INVALID_CURSOR");
  const base = new Date(`${match[1]}${match[3]}`).toISOString().slice(0, 19);
  return `${base}.${(match[2] ?? "").padEnd(6, "0")}Z`;
}
export function comparar(a: Cursor, b: Cursor) {
  const first = fechaOrden(a.created_at).localeCompare(fechaOrden(b.created_at));
  return first || a.id.localeCompare(b.id);
}
export function ultimoConfirmado(messages: Array<{ id: string; created_at: string | null }>): Cursor | null {
  return messages.reduce<Cursor | null>((last, m) => {
    if (m.id.startsWith("temp-") || !m.created_at) return last;
    const cursor = { id: m.id, created_at: m.created_at };
    return !last || comparar(cursor, last) > 0 ? cursor : last;
  }, null);
}

/** Lecturas solamente. La marca se devuelve, no se muta: una generacion
 * cancelada o un fallo de acuses no pueden adelantar el intervalo confirmado.
 */
export async function reconciliarChat(client: SupabaseClient<Database>, args: {
  chatId: string; userId: string; deletedAt: string | null;
  loadedIds: string[]; cursor: Cursor | null; intervalo: Intervalo | null;
}) {
  const { data: chat, error: membershipError } = await client.from("chats")
    .select("comprador_id, vendedor_id, deleted_at_comprador, deleted_at_vendedor")
    .eq("id", args.chatId).maybeSingle();
  if (membershipError) throw new Error("VICINO_CHAT_RECOVERY_PENDING");
  if (!chat || ![chat.comprador_id, chat.vendedor_id].includes(args.userId)) return { denied: true } as const;
  const deletedAt = (chat.comprador_id === args.userId ? chat.deleted_at_comprador : chat.deleted_at_vendedor) ?? args.deletedAt;
  const base = () => {
    const query = client.from("messages").select(CAMPOS_MENSAJE).eq("chat_id", args.chatId);
    return deletedAt ? query.gt("created_at", deletedAt) : query;
  };
  const snapshot = await base().order("created_at", { ascending: false, nullsFirst: false }).order("id", { ascending: false }).limit(50);
  if (snapshot.error) throw new Error("VICINO_CHAT_RECOVERY_PENDING");
  const messages = new Map((snapshot.data ?? []).map((m) => [m.id, m]));
  const latest = ultimoConfirmado(snapshot.data ?? []);
  let cursor = args.cursor;
  let interval = args.intervalo;
  // Inclusive del timestamp inicial: recoge tambien IDs menores del mismo instante.
  if (!interval && cursor && latest && comparar(latest, cursor) >= 0) {
    interval = { desde: { ...cursor, id: "" }, hasta: latest };
  }
  if (!interval && !cursor && latest) {
    interval = { desde: { created_at: deletedAt ?? "1970-01-01T00:00:00Z", id: "" }, hasta: latest };
  }
  if (interval) {
    for (let page = 0; page < 10; page++) {
      const desde: Cursor = interval.desde;
      const hasta: Cursor = interval.hasta;
      let query = base().gte("created_at", desde.created_at).lte("created_at", hasta.created_at);
      if (desde.id) query = query.or(`created_at.gt.${desde.created_at},and(created_at.eq.${desde.created_at},id.gt.${desde.id})`);
      const result = await query.order("created_at", { ascending: true }).order("id", { ascending: true }).limit(100);
      if (result.error) throw new Error("VICINO_CHAT_RECOVERY_PENDING");
      const rows = result.data ?? [];
      for (const row of rows) if (row.created_at && comparar({ created_at: row.created_at, id: row.id }, hasta) <= 0) messages.set(row.id, row);
      const end = ultimoConfirmado(rows);
      if (rows.length < 100 || !end || comparar(end, hasta) >= 0) {
        cursor = hasta;
        interval = null;
        break;
      }
      interval = { desde: end, hasta };
    }
  } else if (!cursor) cursor = latest;

  // Acuses de todas las paginas ya abiertas, no solo de la instantanea reciente.
  const ids = [...new Set([...args.loadedIds.filter((id) => !id.startsWith("temp-")), ...messages.keys()])];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const receipts = await base().in("id", ids.slice(offset, offset + 100));
    if (receipts.error) throw new Error("VICINO_CHAT_RECOVERY_PENDING");
    for (const row of receipts.data ?? []) messages.set(row.id, row);
  }
  const sales = await client.from("sale_confirmations").select(CAMPOS_VENTA).eq("chat_id", args.chatId)
    .in("status", ["pending_confirmation", "completed"])
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(5);
  if (sales.error) throw new Error("VICINO_CHAT_RECOVERY_PENDING");
  return { denied: false, messages: [...messages.values()], sales: sales.data ?? [], cursor, intervalo: interval, deletedAt } as const;
}

export function fusionarMensajes<T extends { id: string; created_at: string | null }>(
  previous: T[], snapshot: T[], changed: ReadonlyMap<string, T>, deletedAt: string | null,
) {
  const map = new Map(previous.map((m) => [m.id, m]));
  for (const m of snapshot) map.set(m.id, changed.get(m.id) ?? m);
  for (const [id, m] of changed) map.set(id, m);
  return [...map.values()].filter((m) => !deletedAt || m.id.startsWith("temp-") || (m.created_at && fechaOrden(m.created_at) > fechaOrden(deletedAt)))
    .sort((a, b) => a.created_at && b.created_at ? comparar({ ...a, created_at: a.created_at }, { ...b, created_at: b.created_at }) : a.id.localeCompare(b.id));
}
