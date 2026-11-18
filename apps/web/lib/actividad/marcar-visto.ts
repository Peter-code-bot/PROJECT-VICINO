/**
 * Un dia con sesion = una fila privada en public.actividad_diaria
 * (migracion 20261102120300). Es la medida de "usuarios activos" que reemplaza a
 * profiles.last_seen_at: ese campo nunca se actualizaba, y si se hubiera
 * actualizado cualquiera lo habria podido leer sin sesion (igual que
 * profiles.updated_at, que el trigger sella en cada UPDATE).
 *
 * La llama el proxy (lib/supabase/middleware.ts) en cada peticion con sesion,
 * pero solo escribe una vez por cuenta, dispositivo y dia: la cookie guarda
 * "<cuenta>:<dia>". Lleva la cuenta porque la app deja cambiar de cuenta en el
 * mismo dispositivo, y con solo el dia la segunda cuenta no se registraria
 * nunca. La base tampoco cuenta dos veces el mismo dia (llave primaria), asi
 * que la cookie solo ahorra peticiones.
 */
import { after, type NextRequest, type NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

export const COOKIE_VISTO = "vicino_visto";
/** Dia y medio: cubre el cambio de dia de CDMX sin depender de la hora exacta. */
const VIGENCIA_VISTO_S = 60 * 60 * 36;

const partesDelDia = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Mexico_City",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Dia calendario de CDMX como YYYY-MM-DD: el mismo corte que usa marcar_visto(). */
export function diaEnCdmx(instante: Date): string {
  const partes = Object.fromEntries(partesDelDia.formatToParts(instante).map((p) => [p.type, p.value]));
  return `${partes.year}-${partes.month}-${partes.day}`;
}

/** Valor de la cookie para una cuenta y un dia. */
export function valorVisto(userId: string, hoy: string): string {
  return `${userId}:${hoy}`;
}

/** Si esta cuenta todavia no marco el dia `hoy` en este dispositivo. */
export function faltaMarcarHoy(valorCookie: string | undefined, userId: string, hoy: string): boolean {
  return valorCookie !== valorVisto(userId, hoy);
}

export function marcarVistoHoy(
  supabase: SupabaseClient<Database>,
  request: NextRequest,
  response: NextResponse,
  userId: string
): void {
  const hoy = diaEnCdmx(new Date());
  if (!faltaMarcarHoy(request.cookies.get(COOKIE_VISTO)?.value, userId, hoy)) return;

  // La cookie va antes de saber si la base contesto. Si la llamada fallara (por
  // ejemplo, si este codigo llega a produccion antes que la migracion), lo
  // maximo es un intento por cuenta, dispositivo y dia, no uno en cada
  // navegacion. El costo: un fallo pasajero pierde ese dia.
  response.cookies.set(COOKIE_VISTO, valorVisto(userId, hoy), {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: VIGENCIA_VISTO_S,
  });

  // Despues de responder: la visita no espera a la base.
  after(async () => {
    const { error } = await supabase.rpc("marcar_visto");
    if (error) {
      Sentry.captureException(error, {
        tags: { surface: "proxy", action: "marcar_visto" },
        extra: { code: error.code },
      });
    }
  });
}
