"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { enforce, writeRateLimit } from "@/lib/rate-limit";
import { esClaveNotificacion } from "@/lib/notificaciones/claves";

/**
 * TODA exportacion de este archivo es un endpoint HTTP publico, asi que aqui
 * solo pueden vivir funciones async. Un `export type` o un `export const` en un
 * modulo "use server" no es un error de compilacion: es un 500 en runtime con
 * la pantalla pintada. Por eso el catalogo de claves NO vive aqui sino en
 * @/lib/notificaciones/claves (modulo normal, importable por las dos partes), y
 * el tipo de la respuesta se declara inline.
 *
 * El catalogo se comparte con el catalogo visual de preferencias-form.tsx a
 * proposito: antes eran dos listas de cadenas sueltas y una errata en una sola
 * de ellas compilaba limpio para fallar al primer toque. Ver el comentario de
 * claves.ts.
 */

/**
 * Convierte el jsonb en un diccionario de booleanos.
 *
 * La columna es jsonb: la base acepta ahi un arreglo, un escalar o NULL, y el
 * CHECK de la migracion solo entro en vigor con ella, asi que las filas que
 * existian antes pueden traer cualquier cosa. Lo que no sea un par
 * clave/booleano se descarta en la frontera en vez de llegar a la pantalla.
 */
function normalizar(valor: unknown): Record<string, boolean> {
  if (valor === null || typeof valor !== "object" || Array.isArray(valor)) return {};
  // El cast a Record<string, unknown> es lo que evita que Object.entries
  // devuelva `any` por su sobrecarga de `{}` y se cuele un valor sin comprobar.
  const entradas = Object.entries(valor as Record<string, unknown>).filter(
    (par): par is [string, boolean] => typeof par[1] === "boolean",
  );
  return Object.fromEntries(entradas);
}

/**
 * Las preferencias de quien pide, tal como estan guardadas.
 *
 * Una clave ausente significa ENCENDIDO (misma semantica que
 * public.acepta_notificacion). La pantalla no tiene que rellenar nada: lo que
 * no venga, va encendido.
 */
export async function obtenerPreferenciasNotificaciones(): Promise<{
  preferencias: Record<string, boolean> | null;
  error: string | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { preferencias: null, error: "No autenticado" };

  const { data, error } = await supabase
    .from("profiles")
    .select("notification_preferences")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    // Sentry ANTES de devolver, y con el `details` entero: es donde Postgres
    // nombra la columna o la policy que rechazo. Un 42501 aqui significa que la
    // migracion 20260916180000 no esta aplicada o que su GRANT por columna
    // falto, y sin el detalle eso se diagnostica a ciegas.
    Sentry.captureException(error, {
      tags: { action: "obtenerPreferenciasNotificaciones" },
      contexts: { supabase: { code: error.code, details: error.details, hint: error.hint } },
    });
    // El texto no habla de permisos ni de propiedad: es la leccion de
    // modo_precio, donde un mensaje que culpaba a la propiedad escondio durante
    // horas un privilegio de columna que faltaba.
    return { preferencias: null, error: "No pudimos cargar tus preferencias." };
  }

  // Sin fila no hay error en PostgREST. Devolver {} aqui pintaria todo
  // encendido y el primer guardado moriria con P0002 sin haber avisado.
  if (!data) {
    Sentry.captureException(
      new Error("perfil ausente al leer notification_preferences"),
      { tags: { action: "obtenerPreferenciasNotificaciones" } },
    );
    return { preferencias: null, error: "No pudimos cargar tus preferencias." };
  }

  return { preferencias: normalizar(data.notification_preferences), error: null };
}

/**
 * Enciende o apaga UN tipo.
 *
 * Manda solo la clave que cambia, nunca el objeto completo: la RPC concatena
 * con `||`, asi que dos interruptores tocados casi a la vez no se pisan. Con un
 * envio del objeto entero, el segundo llevaria la foto vieja del primero y lo
 * desharia.
 */
export async function guardarPreferenciaNotificacion(
  tipo: string,
  activa: boolean,
): Promise<{ success?: true; error?: string }> {
  // El tipo se comprueba ANTES que nada y sin confiar en TypeScript: esto es un
  // endpoint HTTP y se puede llamar sin pasar por la pantalla, asi que `tipo`
  // puede llegar como numero, null o una cadena de un megabyte.
  if (typeof activa !== "boolean" || !esClaveNotificacion(tipo)) {
    return { error: "No se pudo guardar esa preferencia." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  // La misma cuota que el resto de escrituras del repo. Sin credenciales de
  // Upstash el limitador es un no-op, pero la llamada se queda igual: el dia
  // que las credenciales entren, este endpoint ya esta frenado y no hay que
  // acordarse de volver.
  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const { error } = await supabase.rpc("guardar_preferencias_notificaciones", {
    p_preferencias: { [tipo]: activa },
  });

  if (error) {
    Sentry.captureException(error, {
      tags: { action: "guardarPreferenciaNotificacion", tipo },
      contexts: { supabase: { code: error.code, details: error.details, hint: error.hint } },
    });

    if (error.code === "P0002") {
      return {
        error:
          "Tu perfil aún no está listo. Espera unos segundos e inténtalo de nuevo.",
      };
    }
    // 22023 son las validaciones de la propia funcion. Su texto esta escrito
    // para quien lee logs, no para quien usa la app, asi que no se reenvia.
    return { error: "No se pudo guardar. Revisa tu conexión e inténtalo de nuevo." };
  }

  // next/cache A SECAS, y no el envoltorio de @/lib/revalidate-session.
  //
  // Ese envoltorio hace una cosa mas: rota la cookie vicino_data_revision, y el
  // proveedor de sesion compara esa revision en cada render y VACIA lo que el
  // cliente conserva en memoria cuando cambia (session-data-provider.tsx:15-17).
  // O sea que era una purga global de toda la app por cada interruptor tocado:
  // cuatro toques, cuatro purgas, y detras de cada una las peticiones que
  // vuelven a llenar lo vaciado (inicio, perfil, favoritos...).
  //
  // Aqui no hace falta nada de eso: lo que el cliente guarda del perfil es lo
  // que lee el layout del marketplace —nombre, foto, es_vendedor y
  // has_seen_onboarding (layout.tsx:62)— y notification_preferences no esta en
  // esa lista ni en ninguna otra memoria de sesion. El estado de esta pantalla
  // es local y optimista. Con purgar la cache del router de esta ruta basta para
  // que la siguiente visita llegue con lo guardado.
  revalidatePath("/configuracion/notificaciones");
  return { success: true };
}
