// Piezas puras de send-push, sin imports remotos: corren en Deno (la funcion)
// y en node:test (scripts/test-send-push-avisos.ts). PT07, 27-sep-2026.

// El cliente de supabase-js se usa solo por su forma: from().select()...
// deno-lint-ignore no-explicit-any
type Db = { from: (tabla: string) => any };

type FilaChat = Record<string, number | null | undefined>;

const sumar = (filas: FilaChat[] | null | undefined, columna: string) =>
  (filas ?? []).reduce((total, fila) => total + (Number(fila?.[columna]) || 0), 0);

/**
 * Pendientes del destinatario, con la MISMA semantica que la web
 * (apps/web/app/(marketplace)/layout.tsx): notificaciones sin leer que no son
 * de chat + mensajes sin leer como comprador + como vendedor. Devuelve null si
 * cualquiera de las tres consultas falla: un numero inventado en el globo es
 * peor que dejarlo como esta.
 */
export async function contarNoLeidos(db: Db, userId: string): Promise<number | null> {
  try {
    const [notificaciones, comoComprador, comoVendedor] = await Promise.all([
      db.from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("leida", false)
        .neq("tipo", "message"),
      db.from("chats").select("no_leidos_comprador").eq("comprador_id", userId),
      db.from("chats").select("no_leidos_vendedor").eq("vendedor_id", userId),
    ]);
    if (notificaciones.error || comoComprador.error || comoVendedor.error) return null;
    return (notificaciones.count ?? 0) +
      sumar(comoComprador.data, "no_leidos_comprador") +
      sumar(comoVendedor.data, "no_leidos_vendedor");
  } catch {
    return null;
  }
}

/**
 * aps del mensaje de iOS. Con badge null NO se manda la clave: iOS deja el
 * globo como esta (antes se mandaba siempre 1, que mentia en cuanto habia dos
 * pendientes). Un numero se recorta a entero >= 0.
 */
export function construirAps(titulo: string, cuerpo: string, badge: number | null): Record<string, unknown> {
  const aps: Record<string, unknown> = {
    alert: { title: titulo, body: cuerpo },
    sound: "default",
    "content-available": 1,
  };
  if (badge !== null && Number.isFinite(badge)) aps.badge = Math.max(0, Math.trunc(badge));
  return aps;
}

/**
 * FCM HTTP v1 responde 404 con errorCode UNREGISTERED cuando el token ya no
 * existe (app desinstalada, token rotado). Solo ese caso es "token muerto":
 * 400 INVALID_ARGUMENT, 403 SENDER_ID_MISMATCH o un 5xx NO lo son, y borrar el
 * token por ellos dejaria sin push a alguien que si lo tiene.
 */
export function esTokenMuerto(status: number, cuerpo: string): boolean {
  if (status !== 404) return false;
  try {
    const detalles = JSON.parse(cuerpo)?.error?.details;
    return Array.isArray(detalles) && detalles.some((d) => d?.errorCode === "UNREGISTERED");
  } catch {
    return false;
  }
}

/**
 * Suelta el token muerto SOLO si sigue siendo el mismo (compare-and-set): si
 * el usuario ya registro uno nuevo mientras tanto, no se toca. Un error del
 * UPDATE se devuelve como fallo, nunca como exito.
 */
export async function soltarTokenMuerto(
  db: Db,
  userId: string,
  token: string,
): Promise<{ ok: true; filas: number } | { ok: false; error: unknown }> {
  try {
    const { data, error } = await db.from("profiles")
      .update({ fcm_token: null })
      .eq("id", userId)
      .eq("fcm_token", token)
      .select("id");
    if (error) return { ok: false, error };
    return { ok: true, filas: Array.isArray(data) ? data.length : 0 };
  } catch (error) {
    return { ok: false, error };
  }
}
